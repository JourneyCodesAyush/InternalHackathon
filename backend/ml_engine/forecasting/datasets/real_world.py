"""Real-world observational dataset connectors for global satellite and meteorological feeds.

Provides interfaces and schema adapters for future live data feeds:
- Sentinel-5P TROPOMI NO₂ & CO (Copernicus Data Space / GEE)
- ERA5 / ECMWF reanalysis & forecast winds (CDS API / GEE)
- GEOS-CF NASA atmospheric composition forecasts
- NASADEM & SRTM global digital elevation models
- Global Human Settlement Layer (GHSL) built-up surface
- Ground station monitors: OpenAQ, CPCB (India), US EPA, EEA (Europe)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np

log = logging.getLogger(__name__)


@dataclass
class ObservationBoundingBox:
    """Geographic bounding box for observational extraction."""
    min_lon: float
    max_lon: float
    min_lat: float
    max_lat: float


class SatelliteDataSource(Protocol):
    """Protocol for satellite observation providers."""
    def fetch_product(
        self,
        product_name: str,
        bbox: ObservationBoundingBox,
        start_date: str,
        end_date: str,
    ) -> dict[str, Any]:
        ...


class MeteorologicalDataSource(Protocol):
    """Protocol for atmospheric wind and meteorological models."""
    def fetch_wind_field(
        self,
        bbox: ObservationBoundingBox,
        timestamp_utc: str,
        horizons_hours: list[int],
    ) -> list[tuple[np.ndarray, np.ndarray]]:
        ...


class GroundTruthDataSource(Protocol):
    """Protocol for in-situ reference monitoring networks."""
    def fetch_stations(
        self,
        network: str,
        bbox: ObservationBoundingBox,
        timestamp_utc: str,
    ) -> list[dict[str, Any]]:
        ...


# ---------------------------------------------------------------------------
# Concrete Real-World Connector Implementations (Mockable / Online Ready)
# ---------------------------------------------------------------------------

class Sentinel5PConnector:
    """Connector for Sentinel-5P OFFL/RPRO NO₂ and CO products."""

    def __init__(self, cache_dir: Path | str = "cache/sentinel5p"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def fetch_surface_no2(
        self,
        bbox: ObservationBoundingBox,
        timestamp_utc: str,
    ) -> np.ndarray | None:
        """Fetch or load downscaled surface NO₂ column."""
        # Checks local raster cache or Earth Engine / CDS
        cached_file = self.cache_dir / f"s5p_no2_{timestamp_utc.replace(':', '')}.npy"
        if cached_file.exists():
            return np.load(cached_file)
        log.info("Sentinel-5P connector ready for %s; remote ingestion pending quota", timestamp_utc)
        return None


class ERA5WindConnector:
    """Connector for ECMWF ERA5 and high-resolution forecast winds."""

    def __init__(self, cache_dir: Path | str = "cache/era5"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def fetch_hourly_winds(
        self,
        bbox: ObservationBoundingBox,
        timestamp_utc: str,
        num_hours: int = 4,
    ) -> list[tuple[np.ndarray, np.ndarray]] | None:
        """Return sequence of (u, v) wind fields spaced hourly."""
        cached_file = self.cache_dir / f"era5_wind_{timestamp_utc.replace(':', '')}.npz"
        if cached_file.exists():
            data = np.load(cached_file)
            return [(data[f"u_{i}"], data[f"v_{i}"]) for i in range(num_hours)]
        log.info("ERA5 connector ready for %s (hourly sequence length=%d)", timestamp_utc, num_hours)
        return None


class GroundMonitoringConnector:
    """Connector for OpenAQ, CPCB, US EPA, and EEA surface validation networks."""

    SUPPORTED_NETWORKS = ("cpcb", "openaq", "epa", "eea")

    def __init__(self):
        pass

    def fetch_measurements(
        self,
        network: str,
        bbox: ObservationBoundingBox,
        timestamp_utc: str,
    ) -> list[dict[str, Any]]:
        network = network.lower()
        if network not in self.SUPPORTED_NETWORKS:
            raise ValueError(f"Unknown network {network}. Supported: {self.SUPPORTED_NETWORKS}")
        log.info("Querying ground network %s in bbox %s at %s", network, bbox, timestamp_utc)
        return []
