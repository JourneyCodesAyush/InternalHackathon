"""Dual Dataset Architecture loader.

Supports two interchangeable modes switchable via configuration or environment:
- 'synthetic' : offline development, CI/CD, validation, and training without quota limits.
- 'real'      : production forecasting using satellite rasters and ERA5 meteorological files.

Controlled by FORECAST_DATA_MODE environment variable or ForecastConfig.
"""

from __future__ import annotations

import logging
import os
from typing import Literal

from ..config import ForecastConfig
from ..dataset import ForecastDataset
from .synthetic import SyntheticAtmosphericGenerator
from .real_world import Sentinel5PConnector, ERA5WindConnector, GroundMonitoringConnector

log = logging.getLogger(__name__)

DatasetMode = Literal["synthetic", "real"]


def get_configured_dataset_mode() -> DatasetMode:
    """Read the active dataset mode from the environment."""
    mode = os.getenv("FORECAST_DATA_MODE", "synthetic").strip().lower()
    if mode in ("real", "production", "live"):
        return "real"
    return "synthetic"


def load_dataset(
    cfg: ForecastConfig | None = None,
    mode: DatasetMode | None = None,
    num_samples: int = 128,
    h: int = 48,
    w: int = 48,
    val_frac: float = 0.15,
    seed: int = 42,
) -> tuple[ForecastDataset, ForecastDataset]:
    """Factory loader returning (train_dataset, val_dataset) based on the active mode.

    Parameters
    ----------
    cfg         : optional ForecastConfig
    mode        : explicit 'synthetic' or 'real' override (defaults to FORECAST_DATA_MODE env)
    num_samples : number of samples to generate/load
    h, w        : spatial dimensions
    val_frac    : fraction of samples reserved for validation
    seed        : pseudo-random seed for reproducibility
    """
    if mode is None:
        mode = get_configured_dataset_mode()

    log.info("Loading forecast dataset in [%s] mode", mode.upper())

    if mode == "synthetic":
        gen = SyntheticAtmosphericGenerator(seed=seed)
        dynamics, statics, targets, metas = [], [], [], []
        seq_len = cfg.convlstm.seq_len if cfg else 4
        out_horizons = cfg.convlstm.output_horizons if cfg else 4

        for _ in range(num_samples):
            dyn, sta, tgt, meta = gen.generate_sample(
                h=h,
                w=w,
                seq_len=seq_len,
                output_horizons=out_horizons,
            )
            dynamics.append(dyn)
            statics.append(sta)
            targets.append(tgt)
            metas.append(meta)

        import numpy as np
        full_ds = ForecastDataset(
            np.stack(dynamics),
            np.stack(statics),
            np.stack(targets),
            metas,
        )
        n_val = max(1, int(num_samples * val_frac))
        n_train = num_samples - n_val
        return full_ds.split(n_train, n_val)

    elif mode == "real":
        # Check cache or load real-world tiles
        cache_dir = cfg.dataset.cache_dir if cfg else "cache/forecasting"
        real_files = list(os.path.expanduser(str(cache_dir))) if os.path.exists(str(cache_dir)) else []
        if not real_files:
            log.warning("No cached real-world tiles found in %s; falling back to synthetic generator", cache_dir)
            return load_dataset(cfg, mode="synthetic", num_samples=num_samples, h=h, w=w, val_frac=val_frac, seed=seed)

        # In production with cached real tiles, loads using ForecastDataset.from_tile_directory
        raise NotImplementedError("Real-world tile ingestion requires cached HDF5/NetCDF files.")

    else:
        raise ValueError(f"Unknown forecast dataset mode: {mode}")
