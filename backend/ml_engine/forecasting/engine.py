"""High-level ForecastEngine: the main entry point for the forecasting module.

Usage
-----
    from ml_engine.forecasting import ForecastEngine, ForecastConfig

    engine = ForecastEngine(cfg)
    result = engine.predict(c0, wind_u, wind_v, y, x)
    engine.export(result, output_dir="outputs/forecasts/run_001")

The engine is a thin orchestrator that:
1. Prepares wind sequence (single pair → list for future ERA5 multi-hour support).
2. Delegates to run_inference (physics + optional AI residual).
3. Returns a ForecastResult and writes outputs.
"""

from __future__ import annotations

import logging
import math
from pathlib import Path

import numpy as np

from .config import ForecastConfig
from .inference import ForecastResult, run_inference, export_all

log = logging.getLogger(__name__)


class ForecastEngine:
    """Orchestrates a full 30-minute recursive NO₂ forecast.

    Parameters
    ----------
    cfg             : ForecastConfig master configuration.
    checkpoint_path : path to a trained ConvLSTM checkpoint (.pt file).
                      If None (default), only the physics solver runs.
    """

    def __init__(
        self,
        cfg: ForecastConfig | None = None,
        checkpoint_path: str | Path | None = None,
    ):
        self.cfg = cfg or ForecastConfig()
        if checkpoint_path is None:
            default_cp = Path("models/forecasting/checkpoint_best.pt")
            if default_cp.exists():
                checkpoint_path = default_cp
        self.checkpoint_path = checkpoint_path

    # ------------------------------------------------------------------
    def predict(
        self,
        c0: np.ndarray,
        wind_u: np.ndarray,
        wind_v: np.ndarray,
        y: np.ndarray,
        x: np.ndarray,
        wind_sequence: list[tuple[np.ndarray, np.ndarray]] | None = None,
        dynamic_history: np.ndarray | None = None,
        static_feat: np.ndarray | None = None,
        preserve_mass: bool = True,
        base_skill: float = 0.63,
    ) -> ForecastResult:
        """Run the forecasting pipeline and return a ForecastResult.

        Parameters
        ----------
        c0              : (H, W) float32 – downscaled surface NO₂ at t0.
        wind_u, wind_v  : (H, W) float32 – ERA5 winds at t0 (m/s).
        y, x            : coordinate arrays for the fine grid.
        wind_sequence   : optional multi-hour wind sequence [(u₀,v₀),(u₁,v₁),…].
                          Defaults to [( wind_u, wind_v )] (constant wind).
        dynamic_history : (seq_len, dyn_channels, H, W) for AI correction.
        static_feat     : (static_channels, H, W) for AI correction.
        preserve_mass   : enforce mass conservation at each 30-min frame.
        base_skill      : temporal correlation used to scale confidence maps.

        Returns
        -------
        ForecastResult
        """
        if wind_sequence is None:
            wind_sequence = [(wind_u, wind_v)]

        result = run_inference(
            c0=c0,
            wind_sequence=wind_sequence,
            dynamic_history=dynamic_history,
            static_feat=static_feat,
            y=y,
            x=x,
            cfg=self.cfg,
            checkpoint_path=self.checkpoint_path,
            preserve_mass=preserve_mass,
            base_skill=base_skill,
        )

        log.info(
            "Forecast complete | horizons=%s min | "
            "mean mass_err=%.4f | AI=%s",
            result.horizons_min,
            float(np.mean(result.mass_error)) if result.mass_error else 0.0,
            self.cfg.use_ai_residual and self.checkpoint_path is not None,
        )
        return result

    # ------------------------------------------------------------------
    def export(
        self,
        result: ForecastResult,
        output_dir: str | Path = "outputs/forecasts",
    ) -> dict:
        """Export GeoTIFF / NetCDF / GeoJSON outputs.

        Returns dict of exported file paths keyed by format.
        """
        return export_all(result, output_dir, self.cfg)

    # ------------------------------------------------------------------
    def predict_and_export(
        self,
        c0: np.ndarray,
        wind_u: np.ndarray,
        wind_v: np.ndarray,
        y: np.ndarray,
        x: np.ndarray,
        output_dir: str | Path = "outputs/forecasts",
        **kwargs,
    ) -> tuple[ForecastResult, dict]:
        """Convenience: predict then export, return (result, file_paths)."""
        result = self.predict(c0, wind_u, wind_v, y, x, **kwargs)
        paths  = self.export(result, output_dir)
        return result, paths
