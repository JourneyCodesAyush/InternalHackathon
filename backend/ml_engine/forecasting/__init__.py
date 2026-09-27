"""Global spatiotemporal NO₂ forecasting engine.

This module adds a 30-minute recursive forecasting capability on top of the
existing downscaling pipeline.  It is purely additive — nothing in the existing
pipeline is modified.

Public surface
--------------
ForecastEngine   – high-level entry point; accepts a downscaled NO₂ map and
                   returns multi-horizon predictions every 30 minutes.
ForecastConfig   – dataclass with all tunable hyper-parameters.
"""

from .config import ForecastConfig
from .engine import ForecastEngine
from .inference import run_inference
from .metrics import ForecastMetrics

__all__ = ["ForecastConfig", "ForecastEngine", "run_inference", "ForecastMetrics"]
