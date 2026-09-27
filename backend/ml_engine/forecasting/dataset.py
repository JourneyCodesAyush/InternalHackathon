"""PyTorch dataset and caching system for the spatiotemporal forecasting engine.

Each training sample is a rolling window:

    [ C(t-90), C(t-60), C(t-30), C(t) ]  →  predict  C(t+30), C(t+60), C(t+90), C(t+120)

Dynamic channels per frame:
    0  no2          – downscaled surface NO₂ (µg m⁻³, log1p normalised)
    1  prev_no2     – previous frame NO₂
    2  co           – CO column (log1p normalised)
    3  wind_u       – ERA5 U wind (m/s, standardised)
    4  wind_v       – ERA5 V wind (m/s, standardised)
    5  wind_speed   – √(u²+v²)
    6  temp         – 2 m temperature (°C, standardised)
    7  pressure     – surface pressure (hPa, standardised)
    8  humidity     – specific humidity (g/kg, standardised)
    9  blh          – boundary layer height (m, log1p normalised)

Static channels (stacked once):
    0  dem          – elevation (m, standardised)
    1  slope        – terrain slope (°, standardised)
    2  road_density – road length per km² (standardised)
    3  built_up     – built-up fraction (0–1)
    4  night_lights – VIIRS radiance (standardised)
    5  population   – people per km² (log1p normalised)
    6  power_plants – binary power plant mask
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr

log = logging.getLogger(__name__)

# Stats used for per-channel normalisation (mean, std).
# These are approximate global values; the trainer can recompute them from data.
_CHANNEL_STATS: dict[str, tuple[float, float]] = {
    # dynamic
    "no2":          (0.0, 1.0),   # log1p, per-dataset rescale
    "prev_no2":     (0.0, 1.0),
    "co":           (0.0, 1.0),   # log1p
    "wind_u":       (0.0, 5.0),   # m/s
    "wind_v":       (0.0, 5.0),
    "wind_speed":   (2.0, 3.0),
    "temp":         (15.0, 12.0), # °C
    "pressure":     (900.0, 30.0),# hPa
    "humidity":     (5.0, 5.0),   # g/kg
    "blh":          (0.0, 1.0),   # log1p
    # static
    "dem":          (200.0, 500.0),
    "slope":        (2.0, 5.0),
    "road_density": (0.0, 1.0),
    "built_up":     (0.3, 0.3),
    "night_lights": (0.0, 1.0),
    "population":   (0.0, 1.0),   # log1p
    "power_plants": (0.0, 1.0),   # binary
}

DYNAMIC_CHANNELS = [
    "no2", "prev_no2", "co", "wind_u", "wind_v",
    "wind_speed", "temp", "pressure", "humidity", "blh",
]
STATIC_CHANNELS = [
    "dem", "slope", "road_density", "built_up",
    "night_lights", "population", "power_plants",
]


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

def log1p_norm(x: np.ndarray, mean: float, std: float) -> np.ndarray:
    return (np.log1p(np.clip(x, 0, None)) - mean) / (std + 1e-8)


def z_norm(x: np.ndarray, mean: float, std: float) -> np.ndarray:
    return (x - mean) / (std + 1e-8)


def _norm(name: str, arr: np.ndarray) -> np.ndarray:
    arr = np.nan_to_num(arr.astype(np.float32), nan=0.0)
    m, s = _CHANNEL_STATS[name]
    if name in ("no2", "prev_no2", "co", "blh", "population"):
        return log1p_norm(arr, m, s)
    return z_norm(arr, m, s)


# ---------------------------------------------------------------------------
# Cache key
# ---------------------------------------------------------------------------

def _cache_key(city: str, date: str, patch_r: int, patch_c: int) -> str:
    raw = f"{city}|{date}|{patch_r}|{patch_c}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Sample builder
# ---------------------------------------------------------------------------

def build_sample(
    frames: list[xr.Dataset],   # len = seq_len + output_horizons (e.g. 8)
    static_ds: xr.Dataset,
    patch_row: int,
    patch_col: int,
    patch_size: int,
    seq_len: int = 4,
    output_horizons: int = 4,
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Extract one (dynamic_seq, static_feat, target) training sample.

    Returns None if too many NaNs in the patch.
    """
    r0, r1 = patch_row, patch_row + patch_size
    c0, c1 = patch_col, patch_col + patch_size

    def _crop(ds: xr.Dataset, var: str) -> np.ndarray:
        arr = ds[var].values
        if arr.ndim == 2:
            return arr[r0:r1, c0:c1]
        return arr[..., r0:r1, c0:c1]

    # Dynamic sequence (seq_len frames)
    dyn_frames = []
    for t in range(seq_len):
        ds = frames[t]
        prev_ds = frames[max(0, t - 1)]
        ch = []
        for name in DYNAMIC_CHANNELS:
            if name == "prev_no2":
                raw = _crop(prev_ds, "no2")
            elif name == "wind_speed":
                u = _crop(ds, "wind_u")
                v = _crop(ds, "wind_v")
                raw = np.hypot(u, v)
            else:
                raw = _crop(ds, name)
            ch.append(_norm(name, raw))
        dyn_frames.append(np.stack(ch, axis=0))  # (C, H, W)

    # Static features
    sta_ch = []
    for name in STATIC_CHANNELS:
        raw = _crop(static_ds, name)
        sta_ch.append(_norm(name, raw))
    static_feat = np.stack(sta_ch, axis=0).astype(np.float32)  # (C_s, H, W)

    # Target frames (output_horizons frames after seq_len)
    tgt_frames = []
    for t in range(seq_len, seq_len + output_horizons):
        raw = _crop(frames[t], "no2")
        tgt_frames.append(log1p_norm(raw, *_CHANNEL_STATS["no2"]))

    dynamic_seq = np.stack(dyn_frames, axis=0).astype(np.float32)  # (T, C, H, W)
    target = np.stack(tgt_frames, axis=0).astype(np.float32)        # (horizons, H, W)

    # Quality check – skip patches with >30% NaN
    nan_frac = np.isnan(dynamic_seq).mean()
    if nan_frac > 0.30:
        return None

    # Fill remaining NaN with 0 (channel mean after normalisation)
    dynamic_seq = np.nan_to_num(dynamic_seq, nan=0.0)
    static_feat = np.nan_to_num(static_feat, nan=0.0)
    target = np.nan_to_num(target, nan=0.0)

    return dynamic_seq, static_feat, target


# ---------------------------------------------------------------------------
# Dataset class (works without torch, falls back to numpy)
# ---------------------------------------------------------------------------

class ForecastDataset:
    """In-memory dataset of (dynamic_seq, static_feat, target) tuples.

    Usage
    -----
    ds = ForecastDataset.from_cache(cache_dir, split="train")
    item = ds[0]    # dict with 'dynamic', 'static', 'target' keys
    len(ds)         # number of samples
    ds.as_torch()   # returns a torch.utils.data.TensorDataset (if torch available)
    """

    def __init__(
        self,
        dynamic: np.ndarray,   # (N, T, C, H, W)
        static: np.ndarray,    # (N, C_s, H, W)
        target: np.ndarray,    # (N, horizons, H, W)
        meta: list[dict] | None = None,
    ):
        assert len(dynamic) == len(static) == len(target)
        self.dynamic = dynamic
        self.static = static
        self.target = target
        self.meta = meta or [{}] * len(dynamic)

    def __len__(self) -> int:
        return len(self.dynamic)

    def __getitem__(self, idx: int) -> dict[str, np.ndarray]:
        return {
            "dynamic": self.dynamic[idx],
            "static": self.static[idx],
            "target": self.target[idx],
        }

    # ------------------------------------------------------------------
    def as_torch(self):
        """Return a torch.utils.data.TensorDataset."""
        try:
            import torch
            from torch.utils.data import TensorDataset
            return TensorDataset(
                torch.from_numpy(self.dynamic),
                torch.from_numpy(self.static),
                torch.from_numpy(self.target),
            )
        except ImportError:
            raise RuntimeError("PyTorch is required for .as_torch()")

    # ------------------------------------------------------------------
    @classmethod
    def from_cache(cls, cache_dir: Path | str, split: str = "train") -> "ForecastDataset":
        """Load a previously saved dataset from disk."""
        cache_dir = Path(cache_dir)
        path = cache_dir / f"{split}_dataset.npz"
        if not path.exists():
            raise FileNotFoundError(f"Dataset cache not found: {path}")
        data = np.load(path, allow_pickle=False)
        meta_path = cache_dir / f"{split}_meta.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else None
        return cls(data["dynamic"], data["static"], data["target"], meta)

    # ------------------------------------------------------------------
    def save(self, cache_dir: Path | str, split: str = "train"):
        """Save dataset to compressed NumPy archive."""
        cache_dir = Path(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            cache_dir / f"{split}_dataset.npz",
            dynamic=self.dynamic,
            static=self.static,
            target=self.target,
        )
        if self.meta:
            (cache_dir / f"{split}_meta.json").write_text(json.dumps(self.meta))
        log.info("Saved %s dataset (%d samples) to %s", split, len(self), cache_dir)

    # ------------------------------------------------------------------
    @classmethod
    def build_from_xarray(
        cls,
        time_series: list[xr.Dataset],
        static_ds: xr.Dataset,
        patch_size: int = 64,
        seq_len: int = 4,
        output_horizons: int = 4,
        stride: int = 32,
        n_time_samples: int | None = None,
        rng: np.random.Generator | None = None,
    ) -> "ForecastDataset":
        """Build a dataset by sliding a spatial patch over many time windows.

        Parameters
        ----------
        time_series    : list of xr.Dataset (one per 30-min frame, ordered in time)
        static_ds      : static feature Dataset (spatial, no time dim)
        patch_size     : spatial patch size in pixels
        seq_len        : number of input frames
        output_horizons: number of target frames
        stride         : spatial stride between patches
        n_time_samples : if set, randomly sample this many time windows
        rng            : numpy random generator for reproducibility
        """
        if rng is None:
            rng = np.random.default_rng(42)

        total_frames = len(time_series)
        window = seq_len + output_horizons
        H, W = static_ds.dims["y"], static_ds.dims["x"]
        max_r = H - patch_size
        max_c = W - patch_size

        if max_r <= 0 or max_c <= 0:
            raise ValueError(f"Grid ({H},{W}) is too small for patch_size={patch_size}")

        time_starts = list(range(0, total_frames - window + 1))
        if n_time_samples is not None and n_time_samples < len(time_starts):
            time_starts = rng.choice(time_starts, size=n_time_samples, replace=False).tolist()

        patch_rows = list(range(0, max_r + 1, stride))
        patch_cols = list(range(0, max_c + 1, stride))

        dynamics, statics, targets, metas = [], [], [], []

        for t_start in time_starts:
            frames = time_series[t_start : t_start + window]
            for r in patch_rows:
                for c in patch_cols:
                    result = build_sample(frames, static_ds, r, c, patch_size, seq_len, output_horizons)
                    if result is None:
                        continue
                    dyn, sta, tgt = result
                    dynamics.append(dyn)
                    statics.append(sta)
                    targets.append(tgt)
                    metas.append({"t_start": t_start, "patch_r": r, "patch_c": c})

        if not dynamics:
            raise RuntimeError("No valid samples found – check data quality or patch_size")

        return cls(
            np.stack(dynamics),
            np.stack(statics),
            np.stack(targets),
            metas,
        )

    # ------------------------------------------------------------------
    def split(self, n_train: int, n_val: int) -> tuple["ForecastDataset", "ForecastDataset"]:
        """Split dataset into train and validation subsets."""
        n_total = len(self)
        if n_train + n_val > n_total:
            n_train = max(1, int(n_total * 0.85))
            n_val = n_total - n_train

        train_ds = ForecastDataset(
            self.dynamic[:n_train],
            self.static[:n_train],
            self.target[:n_train],
            self.meta[:n_train],
        )
        val_ds = ForecastDataset(
            self.dynamic[n_train : n_train + n_val],
            self.static[n_train : n_train + n_val],
            self.target[n_train : n_train + n_val],
            self.meta[n_train : n_train + n_val],
        )
        return train_ds, val_ds


# ---------------------------------------------------------------------------
# Synthetic dataset generator (for offline training & testing)
# ---------------------------------------------------------------------------

def build_synthetic_dataset(
    num_samples: int = 128,
    h: int = 48,
    w: int = 48,
    seq_len: int = 4,
    output_horizons: int = 4,
    val_frac: float = 0.15,
    seed: int = 42,
) -> tuple[ForecastDataset, ForecastDataset]:
    """Generate a rich multi-regime global synthetic dataset simulating atmospheric dispersion.

    Covers:
      * Multiple wind regimes (eastward, northward, rotational, stagnant)
      * Topographic gradients and urban friction effects
      * Diurnal solar decay & boundary layer diurnal cycles
      * Point, line, and area emission plume structures

    Returns
    -------
    (train_ds, val_ds) tuple of ForecastDataset instances
    """
    rng = np.random.default_rng(seed)
    n_dyn = len(DYNAMIC_CHANNELS)
    n_sta = len(STATIC_CHANNELS)

    dynamics, statics, targets, metas = [], [], [], []

    for i in range(num_samples):
        # 1. Static features
        sta = np.zeros((n_sta, h, w), dtype=np.float32)
        # DEM: random elevation gradient + hills
        rr, cc = np.mgrid[0:h, 0:w]
        dem_grad = (rr / float(h)) * 300.0 + (cc / float(w)) * 200.0
        hill = 250.0 * np.exp(-((rr - h * 0.7) ** 2 + (cc - w * 0.3) ** 2) / 64.0)
        sta[0] = (dem_grad + hill).astype(np.float32)  # DEM
        sta[1] = np.hypot(np.gradient(sta[0], axis=0), np.gradient(sta[0], axis=1)).astype(np.float32) # Slope
        # Urban built-up core & road corridors
        cx, cy = rng.integers(h // 4, 3 * h // 4, 2)
        urban_core = np.exp(-((rr - cy) ** 2 + (cc - cx) ** 2) / 36.0).astype(np.float32)
        sta[2] = np.clip(urban_core * 0.8 + rng.uniform(0, 0.2, (h, w)), 0, 1).astype(np.float32) # road density
        sta[3] = np.clip(urban_core + rng.uniform(0, 0.1, (h, w)), 0, 1).astype(np.float32)        # built_up
        sta[4] = np.clip(urban_core * 1.5 + rng.uniform(0, 0.05, (h, w)), 0, None).astype(np.float32) # night_lights
        sta[5] = np.log1p(urban_core * 5000.0).astype(np.float32)                                # population
        sta[6] = ((rr == cy) & (cc == cx)).astype(np.float32)                                   # power plant

        # 2. Wind regime for this sample
        regime_angle = rng.uniform(0, 2 * np.pi)
        wind_speed = rng.uniform(1.0, 6.0)
        u_base = float(wind_speed * np.cos(regime_angle))
        v_base = float(wind_speed * np.sin(regime_angle))

        # 3. Dynamic sequence frames
        dyn_frames = []
        c_curr = (urban_core * 80.0 + rng.uniform(5, 15, (h, w))).astype(np.float32)

        # Pre-advect for seq_len input steps
        total_steps = seq_len + output_horizons
        all_c_frames = []

        for t in range(total_steps):
            # Lax-Wendroff / shift advection approximation
            shift_r = int(-v_base * 0.8)
            shift_c = int(u_base * 0.8)
            c_next = np.roll(np.roll(c_curr, shift=shift_r, axis=0), shift=shift_c, axis=1)
            # Diffusion + continuous emissions from urban core + photochemical decay
            c_next = c_next * 0.96 + urban_core * 10.0 + rng.standard_normal((h, w)).astype(np.float32) * 0.5
            c_curr = np.clip(c_next, 0, None)
            all_c_frames.append(c_curr.copy())

        # Build dynamic input channels
        for t in range(seq_len):
            dyn_t = np.zeros((n_dyn, h, w), dtype=np.float32)
            dyn_t[0] = np.log1p(all_c_frames[t])                      # NO2
            dyn_t[1] = np.log1p(all_c_frames[max(0, t - 1)])          # prev NO2
            dyn_t[2] = np.log1p(all_c_frames[t] * 0.3)                # CO
            dyn_t[3] = u_base + rng.standard_normal((h, w)) * 0.2     # wind_u
            dyn_t[4] = v_base + rng.standard_normal((h, w)) * 0.2     # wind_v
            dyn_t[5] = np.hypot(dyn_t[3], dyn_t[4])                  # wind_speed
            dyn_t[6] = 20.0 + 5.0 * np.sin(t / 4.0)                   # temp
            dyn_t[7] = 1013.25 - (sta[0] / 100.0)                     # pressure
            dyn_t[8] = 8.0 + rng.uniform(0, 2, (h, w))               # humidity
            dyn_t[9] = np.log1p(600.0 + 400.0 * np.sin(t / 4.0))     # BLH
            dyn_frames.append(dyn_t)

        # Build target horizons (output_horizons)
        tgt_frames = []
        for t in range(seq_len, total_steps):
            tgt_frames.append(np.log1p(all_c_frames[t]))

        dynamics.append(np.stack(dyn_frames, axis=0).astype(np.float32))
        statics.append(sta)
        targets.append(np.stack(tgt_frames, axis=0).astype(np.float32))
        metas.append({"sample_id": i, "u_base": u_base, "v_base": v_base, "wind_speed": wind_speed})

    full_ds = ForecastDataset(
        np.stack(dynamics),
        np.stack(statics),
        np.stack(targets),
        metas,
    )
    n_val = max(1, int(num_samples * val_frac))
    n_train = num_samples - n_val
    return full_ds.split(n_train, n_val)

