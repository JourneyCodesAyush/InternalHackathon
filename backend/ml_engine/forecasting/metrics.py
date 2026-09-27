"""Validation metrics for the spatiotemporal forecasting engine.

Metrics computed per forecast horizon and aggregated globally:

RMSE          : root mean squared error (µg m⁻³)
MAE           : mean absolute error
R²            : coefficient of determination
SSIM          : structural similarity index (requires skimage)
IoU           : intersection over union of high-NO₂ pixels (>= WHO threshold)
MassError     : relative mass conservation error
PlumeCenter   : displacement of plume centroid (km)

All functions accept plain numpy arrays and return dicts so they can be used
without PyTorch.
"""

from __future__ import annotations

import math
import logging
from dataclasses import dataclass, asdict

import numpy as np

log = logging.getLogger(__name__)

WHO_NO2_THRESHOLD_UG_M3 = 40.0   # WHO annual mean guideline; used for IoU
EARTH_RADIUS_KM = 6371.0


# ---------------------------------------------------------------------------
# Individual metrics
# ---------------------------------------------------------------------------

def rmse(pred: np.ndarray, true: np.ndarray) -> float:
    mask = np.isfinite(pred) & np.isfinite(true)
    if not mask.any():
        return float("nan")
    return float(np.sqrt(np.mean((pred[mask] - true[mask]) ** 2)))


def mae(pred: np.ndarray, true: np.ndarray) -> float:
    mask = np.isfinite(pred) & np.isfinite(true)
    if not mask.any():
        return float("nan")
    return float(np.mean(np.abs(pred[mask] - true[mask])))


def r2(pred: np.ndarray, true: np.ndarray) -> float:
    mask = np.isfinite(pred) & np.isfinite(true)
    if mask.sum() < 2:
        return float("nan")
    p, t = pred[mask], true[mask]
    ss_res = np.sum((t - p) ** 2)
    ss_tot = np.sum((t - t.mean()) ** 2)
    if ss_tot < 1e-12:
        return float("nan")
    return float(1.0 - ss_res / ss_tot)


def ssim(pred: np.ndarray, true: np.ndarray) -> float:
    """Structural similarity (simplified, skimage-independent version)."""
    try:
        from skimage.metrics import structural_similarity as sk_ssim
        mask = np.isfinite(pred) & np.isfinite(true)
        p = np.where(mask, pred, 0.0)
        t = np.where(mask, true, 0.0)
        drange = float(max(t.max() - t.min(), 1.0))
        return float(sk_ssim(p, t, data_range=drange))
    except ImportError:
        # Fallback: simplified SSIM formula
        mu_p, mu_t = pred.mean(), true.mean()
        sig_p = pred.std()
        sig_t = true.std()
        sig_pt = float(np.mean((pred - mu_p) * (true - mu_t)))
        C1, C2 = 0.01**2, 0.03**2
        num = (2 * mu_p * mu_t + C1) * (2 * sig_pt + C2)
        den = (mu_p**2 + mu_t**2 + C1) * (sig_p**2 + sig_t**2 + C2)
        return float(num / (den + 1e-12))


def iou_high_no2(
    pred: np.ndarray,
    true: np.ndarray,
    threshold: float = WHO_NO2_THRESHOLD_UG_M3,
) -> float:
    """IoU of pixels exceeding the WHO NO₂ threshold."""
    p_bin = pred >= threshold
    t_bin = true >= threshold
    inter = (p_bin & t_bin).sum()
    union = (p_bin | t_bin).sum()
    if union == 0:
        return float("nan")
    return float(inter / union)


def mass_error(pred: np.ndarray, true: np.ndarray) -> float:
    """Relative mass conservation error."""
    m_pred = float(np.nansum(pred))
    m_true = float(np.nansum(true))
    if m_true < 1e-12:
        return float("nan")
    return float(abs(m_pred - m_true) / m_true)


def plume_centroid(arr: np.ndarray, lats: np.ndarray, lons: np.ndarray) -> tuple[float, float] | None:
    """Weighted centroid (lat, lon) of the concentration field."""
    total = float(np.nansum(arr))
    if total < 1e-12:
        return None
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    lat_c = float(np.nansum(lat_grid * arr) / total)
    lon_c = float(np.nansum(lon_grid * arr) / total)
    return lat_c, lon_c


def plume_center_displacement_km(
    pred: np.ndarray,
    true: np.ndarray,
    lats: np.ndarray,
    lons: np.ndarray,
) -> float:
    """Great-circle distance between plume centroids (km)."""
    c_pred = plume_centroid(pred, lats, lons)
    c_true = plume_centroid(true, lats, lons)
    if c_pred is None or c_true is None:
        return float("nan")
    lat1, lon1 = math.radians(c_pred[0]), math.radians(c_pred[1])
    lat2, lon2 = math.radians(c_true[0]), math.radians(c_true[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


# ---------------------------------------------------------------------------
# Aggregate metrics over all horizons
# ---------------------------------------------------------------------------

@dataclass
class HorizonMetrics:
    horizon_min: int
    rmse: float
    mae: float
    r2: float
    ssim: float
    iou_who: float
    mass_error: float
    plume_displacement_km: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ForecastMetrics:
    """Per-horizon and overall evaluation of forecast skill.

    Attributes
    ----------
    per_horizon : list of HorizonMetrics, one per forecast step
    overall     : aggregate metrics averaged across all horizons
    """

    per_horizon: list[HorizonMetrics]
    overall: dict[str, float]

    # ------------------------------------------------------------------
    @classmethod
    def compute(
        cls,
        pred: np.ndarray,        # (horizons, H, W)
        true: np.ndarray,        # (horizons, H, W)
        horizon_mins: list[int],
        lats: np.ndarray | None = None,
        lons: np.ndarray | None = None,
    ) -> "ForecastMetrics":
        """Compute all metrics for a single forecast evaluation."""
        assert pred.shape == true.shape
        n = pred.shape[0]
        assert n == len(horizon_mins)

        per_h = []
        for i, h_min in enumerate(horizon_mins):
            p, t = pred[i], true[i]
            pcd = (
                plume_center_displacement_km(p, t, lats, lons)
                if lats is not None and lons is not None
                else float("nan")
            )
            per_h.append(HorizonMetrics(
                horizon_min=h_min,
                rmse=rmse(p, t),
                mae=mae(p, t),
                r2=r2(p, t),
                ssim=ssim(p, t),
                iou_who=iou_high_no2(p, t),
                mass_error=mass_error(p, t),
                plume_displacement_km=pcd,
            ))

        # Overall averages (ignore nan)
        def _avg(key):
            vals = [getattr(h, key) for h in per_h]
            valid = [v for v in vals if not math.isnan(v)]
            return float(np.mean(valid)) if valid else float("nan")

        overall = {
            "rmse":                  _avg("rmse"),
            "mae":                   _avg("mae"),
            "r2":                    _avg("r2"),
            "ssim":                  _avg("ssim"),
            "iou_who":               _avg("iou_who"),
            "mass_error":            _avg("mass_error"),
            "plume_displacement_km": _avg("plume_displacement_km"),
        }
        return cls(per_horizon=per_h, overall=overall)

    # ------------------------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "per_horizon": [h.to_dict() for h in self.per_horizon],
            "overall": self.overall,
        }

    # ------------------------------------------------------------------
    def summary_str(self) -> str:
        o = self.overall
        lines = [
            "─── Forecast Metrics ────────────────────────────────",
            f"  RMSE          : {o['rmse']:.2f} µg m⁻³",
            f"  MAE           : {o['mae']:.2f} µg m⁻³",
            f"  R²            : {o['r2']:.3f}",
            f"  SSIM          : {o['ssim']:.3f}",
            f"  IoU (WHO≥40)  : {o['iou_who']:.3f}",
            f"  Mass error    : {o['mass_error']:.4f}",
            f"  Plume disp.   : {o['plume_displacement_km']:.1f} km",
            "─────────────────────────────────────────────────────",
        ]
        return "\n".join(lines)
