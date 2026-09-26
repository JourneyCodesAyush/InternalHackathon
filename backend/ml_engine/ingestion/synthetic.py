"""Physically-plausible synthetic scenes for offline end-to-end testing (no Earth Engine account needed).

A fine-scale "true" NO2 column is built from emission proxies (roads, built-up land, industrial point
sources) advected downwind and diluted by the boundary layer. The coarse satellite view is the block
mean of that truth plus retrieval noise, then masked by spatially-coherent clouds (including a
multi-day overcast spell to exercise the fallback filler). Stations sample the true surface field.
Because the fine truth is known, the synthetic run can also score the downscaler at 250 m directly.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import xarray as xr
from scipy import ndimage

from ..config import NO2_MOLAR_MASS_G, PipelineConfig
from ..grid import GridSpec, block_mean

SURFACE_SHAPE_FACTOR = 3.0  # surface / PBL-mean ratio used to generate station truth
SURFACE_BACKGROUND = 8.0  # ug/m^3


def _smooth_field(rng: np.random.Generator, shape, sigma: float) -> np.ndarray:
    f = ndimage.gaussian_filter(rng.standard_normal(shape), sigma)
    return (f - f.mean()) / (f.std() + 1e-12)


def _draw_line(canvas: np.ndarray, r0, c0, r1, c1, weight: float) -> None:
    n = int(max(abs(r1 - r0), abs(c1 - c0))) * 2 + 2
    rr = np.clip(np.round(np.linspace(r0, r1, n)).astype(int), 0, canvas.shape[0] - 1)
    cc = np.clip(np.round(np.linspace(c0, c1, n)).astype(int), 0, canvas.shape[1] - 1)
    canvas[rr, cc] = np.maximum(canvas[rr, cc], weight)


def make_static(fine: GridSpec, rng: np.random.Generator) -> dict[str, np.ndarray]:
    h, w = fine.shape
    rows, cols = np.mgrid[0:h, 0:w]
    dx, _ = fine.pixel_size_m()

    # Terrain rises towards the east (Western Ghats foothills / Sanjay Gandhi NP style ridges).
    elevation = np.clip(40 + 220 * (cols / w) ** 2 + 60 * _smooth_field(rng, (h, w), 12), 0, None)
    gy, gx = np.gradient(elevation, dx)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))

    # Dense urban core in the south-west, sprawl along a north-south axis.
    core = np.exp(-(((rows - 0.7 * h) / (0.45 * h)) ** 2 + ((cols - 0.35 * w) / (0.35 * w)) ** 2))
    built_up = 1 / (1 + np.exp(-(3.5 * core + 0.8 * _smooth_field(rng, (h, w), 6) - 1.6)))
    built_up = np.clip(built_up * (1 - 0.6 * (elevation > 180)), 0, 1)
    ndvi = np.clip(0.65 - 0.6 * built_up + 0.08 * _smooth_field(rng, (h, w), 4) + 0.1 * (elevation > 150), -0.1, 0.85)

    roads = np.zeros((h, w))
    for _ in range(6):  # arterial corridors (express highways)
        c0, c1 = rng.uniform(0.1, 0.9, 2) * w
        _draw_line(roads, 0, c0, h - 1, c1, 1.0)
    for _ in range(10):  # cross links
        r0, r1 = rng.uniform(0.05, 0.95, 2) * h
        _draw_line(roads, r0, 0, r1, w - 1, 0.6)
    road_density = ndimage.gaussian_filter(roads, 2.0) * (0.3 + 0.7 * built_up)
    road_density = np.clip(road_density / np.percentile(road_density, 99.5), 0, 1)

    return {
        "elevation": elevation.astype(np.float32),
        "slope": slope.astype(np.float32),
        "ndvi": ndvi.astype(np.float32),
        "built_up": built_up.astype(np.float32),
        "road_density": road_density.astype(np.float32),
    }


def _emissions(static: dict[str, np.ndarray], rng: np.random.Generator) -> np.ndarray:
    h, w = static["built_up"].shape
    rows, cols = np.mgrid[0:h, 0:w]
    industry = np.zeros((h, w))
    for _ in range(4):  # industrial estates / power plant stacks
        r, c = rng.uniform(0.15, 0.85) * h, rng.uniform(0.15, 0.85) * w
        industry += rng.uniform(0.6, 1.2) * np.exp(-(((rows - r) ** 2 + (cols - c) ** 2) / (2 * (0.03 * h) ** 2)))
    e = 0.55 * static["road_density"] + 0.35 * static["built_up"] + 0.5 * industry
    return e / e.max()


def make_meteorology(dates: pd.DatetimeIndex, coarse: GridSpec, rng: np.random.Generator) -> dict[str, np.ndarray]:
    n = len(dates)
    h, w = coarse.shape
    ar = lambda sd, phi=0.8: _ar1(rng, n, sd, phi)
    u_day = -1.5 + ar(1.8)  # winter land breeze has a mean easterly (negative u) component
    v_day = 0.8 + ar(1.5)
    blh_day = np.clip(1000 + ar(250, 0.7), 350, 2000)
    t_day = 300.5 + ar(1.5)
    sp_day = 100900 + ar(250)
    gy, gx = np.mgrid[0:h, 0:w]
    grad = (gx / max(w - 1, 1) - 0.5)[None]
    out = {
        "u10": u_day[:, None, None] + 0.4 * grad + 0.1 * rng.standard_normal((n, h, w)),
        "v10": v_day[:, None, None] - 0.3 * grad + 0.1 * rng.standard_normal((n, h, w)),
        "blh": blh_day[:, None, None] * (1 + 0.08 * grad),
        "t2m": t_day[:, None, None] - 0.8 * grad,
        "sp": sp_day[:, None, None] - 150 * grad,
    }
    return {k: v.astype(np.float32) for k, v in out.items()}


def _ar1(rng, n, sd, phi):
    x = np.zeros(n)
    for i in range(1, n):
        x[i] = phi * x[i - 1] + np.sqrt(1 - phi**2) * sd * rng.standard_normal()
    return x


def make_truth(emis, met_fine, dates, fine: GridSpec, rng) -> np.ndarray:
    """Fine-scale true tropospheric column (umol/m^2) per day."""
    dx, dy = fine.pixel_size_m()
    truth = np.empty((len(dates), *fine.shape), dtype=np.float32)
    smoothed = ndimage.gaussian_filter(emis, 2.5)
    smoothed /= smoothed.max()  # hotspots reach ~260 umol/m^2, typical of Mumbai TROPOMI columns
    for t, day in enumerate(dates):
        u = float(met_fine["u10"][t].mean())
        v = float(met_fine["v10"][t].mean())
        blh = met_fine["blh"][t]
        plume = smoothed
        # Displace the plume ~1.5 h downwind (rows increase southward, hence -v).
        shift = (-v * 5400 / dy, u * 5400 / dx)
        plume = 0.6 * plume + 0.4 * ndimage.shift(plume, shift, mode="nearest", order=1)
        weekday = 1.0 if day.dayofweek < 5 else 0.8
        dilution = (900.0 / blh) ** 0.6
        truth[t] = 30.0 + 230.0 * plume * dilution * weekday * rng.uniform(0.85, 1.15)
    return truth


def make_clouds(n_days: int, coarse: GridSpec, rng) -> np.ndarray:
    """Boolean (time, y, x) cloud mask with a prolonged overcast spell."""
    h, w = coarse.shape
    mask = np.zeros((n_days, h, w), dtype=bool)
    spell_start = int(rng.integers(n_days // 3, max(n_days // 3 + 1, n_days - 6)))
    spell = set(range(spell_start, min(n_days, spell_start + 5)))
    for t in range(n_days):
        if t in spell:
            cover = rng.uniform(0.9, 1.0)
        else:
            cover = rng.choice([rng.uniform(0.0, 0.2), rng.uniform(0.2, 0.6)], p=[0.6, 0.4])
        field = ndimage.gaussian_filter(rng.standard_normal((h, w)), 1.5)
        mask[t] = field > np.quantile(field, 1 - cover) if cover > 0 else False
    return mask


def make_stations(fine: GridSpec, static, truth_surface, dates, rng, n_stations: int = 24) -> pd.DataFrame:
    h, w = fine.shape
    p = (static["built_up"] ** 2).ravel()
    idx = rng.choice(h * w, size=n_stations, replace=False, p=p / p.sum())
    rows, cols = np.unravel_index(idx, (h, w))
    records = []
    lon, lat = fine.x[cols], fine.y[rows]
    for s in range(n_stations):
        bias = rng.normal(0, 2)  # per-site calibration offset of a reference analyser
        for t, day in enumerate(dates):
            if rng.random() < 0.08:  # instrument downtime
                continue
            val = truth_surface[t, rows[s], cols[s]] + bias + rng.normal(0, 3)
            records.append({"station_id": f"SYN{s:03d}", "name": f"Synthetic station {s}", "lat": lat[s],
                            "lon": lon[s], "date": day, "no2": max(val, 1.0)})
    return pd.DataFrame.from_records(records)


def generate(cfg: PipelineConfig, coarse: GridSpec, fine: GridSpec, seed: int = 0, n_stations: int = 24):
    """Return (coarse daily dataset, fine static dataset, stations dataframe, fine truth dataset)."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range(cfg.start_date, cfg.end_date, freq="D")
    f = cfg.refine_factor

    static = make_static(fine, rng)
    emis = _emissions(static, rng)
    met = make_meteorology(dates, coarse, rng)
    met_fine = {k: np.repeat(np.repeat(v, f, axis=1), f, axis=2) for k, v in met.items()}
    truth = make_truth(emis, met_fine, dates, fine, rng)

    coarse_true = block_mean(truth, f)
    obs = coarse_true + rng.normal(0, 6.0, coarse_true.shape)  # TROPOMI retrieval noise ~6 umol/m^2
    obs[make_clouds(len(dates), coarse, rng)] = np.nan

    surface = truth * 1e-6 * NO2_MOLAR_MASS_G * 1e6 / met_fine["blh"] * SURFACE_SHAPE_FACTOR + SURFACE_BACKGROUND
    stations = make_stations(fine, static, surface, dates, rng, n_stations)

    dims = ("time", "y", "x")
    coarse_ds = xr.Dataset(
        {"no2": (dims, obs.astype(np.float32), {"units": "umol m-2"})}
        | {k: (dims, v) for k, v in met.items()},
        coords={"time": dates, "y": coarse.y, "x": coarse.x},
        attrs={"crs": coarse.crs, "source": "synthetic"},
    )
    static_ds = xr.Dataset({k: (("y", "x"), v) for k, v in static.items()}, coords={"y": fine.y, "x": fine.x},
                           attrs={"crs": fine.crs, "source": "synthetic"})
    truth_ds = xr.Dataset(
        {"column": (dims, truth, {"units": "umol m-2"}), "surface": (dims, surface.astype(np.float32), {"units": "ug m-3"})},
        coords={"time": dates, "y": fine.y, "x": fine.x},
    )
    return coarse_ds, static_ds, stations, truth_ds
