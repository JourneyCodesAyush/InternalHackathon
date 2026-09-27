"""Central configuration for the NO2 gap-filling / downscaling / dispersion engine."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path

DEFAULT_CRS = "EPSG:4326"

# Nationally trained ground-level NO2 model shipped with the package (see ml_engine/national.py and
# pretrained/no2_surface_24h_report.json for its training data and validation).
PRETRAINED_SURFACE_MODEL = Path(__file__).resolve().parent / "pretrained" / "no2_surface_24h.joblib"

# Mumbai metropolitan region (west, south, east, north) in EPSG:4326.
DEFAULT_BBOX: tuple[float, float, float, float] = (72.77, 18.88, 73.12, 19.32)

# Molar mass of NO2 (g/mol). Used for column (mol/m^2) -> surface (ug/m^3) conversion.
NO2_MOLAR_MASS_G = 46.0055

# Engine-internal unit for tropospheric columns: umol/m^2 (1e-6 mol/m^2).
# Raw S5P values (~1e-5 .. 5e-4 mol/m^2) are tiny floats; scaling keeps trees well conditioned.
COLUMN_SCALE = 1e6


@dataclass
class GapFillConfig:
    min_day_coverage: float = 0.20  # below this clear-sky fraction a day uses the median-mosaic fallback
    rf_estimators: int = 200
    rf_max_depth: int | None = 18
    rf_min_samples_leaf: int = 2
    iterations: int = 3  # missForest-style refinement passes
    mosaic_windows_days: tuple[int, ...] = (7, 15, 31)  # expanding centred windows for the fallback
    holdout_fraction: float = 0.10  # clear pixels hidden to score the gap filler
    random_state: int = 42


@dataclass
class DownscaleConfig:
    n_estimators: int = 800
    max_depth: int = 6
    learning_rate: float = 0.05
    subsample: float = 0.8
    colsample_bytree: float = 0.8
    min_child_weight: float = 3.0
    early_stopping_rounds: int = 50
    validation_fraction: float = 0.2  # last 20% of days held out (temporal split)
    backprojection_iterations: int = 5  # mass-conserving residual correction passes
    random_state: int = 42


@dataclass
class DispersionConfig:
    horizons_h: tuple[float, ...] = (1.0, 3.0, 6.0)
    diffusivity_m2_s: float = 50.0  # horizontal eddy diffusivity at ~250 m scale
    lifetime_h: float = 4.0  # daytime NO2 chemical lifetime (OH oxidation)
    dt_s: float = 300.0
    emission_mode: str = "persistent"  # "persistent" keeps sources emitting, "none" = free plume


@dataclass
class ValidationConfig:
    cv_folds: int = 5  # station groups and date blocks for space-time blocked CV
    future_days_fraction: float = 0.2  # last share of days held out for the monitored-station check
    min_r2: float = 0.6  # acceptance thresholds reported as pass/fail
    max_rmse_ugm3: float = 15.0


@dataclass
class PipelineConfig:
    bbox: tuple[float, float, float, float] = DEFAULT_BBOX
    start_date: str = "2025-11-01"
    end_date: str = "2026-01-31"  # inclusive
    coarse_res_deg: float = 0.035  # ~3.9 km, close to the TROPOMI 3.5 x 5.5 km footprint
    refine_factor: int = 14  # 0.035 / 14 = 0.0025 deg ~ 270 m
    s5p_product: str = "OFFL"  # "OFFL" = reprocessed, best for training; "NRTI" = near real time (hours old)
    qa_threshold: float = 0.75
    max_cloud_fraction: float = 0.3  # used when the collection carries no qa_value band
    min_valid_subpixel_fraction: float = 0.5  # coarse cell kept only if >=50% of its S5P bins are clear
    crs: str = DEFAULT_CRS
    output_dir: Path = Path("outputs")
    model_dir: Path = Path("models/downscaler")
    cache_dir: Path = Path("cache")
    station_hours: tuple[int, int] | None = (12, 16)  # local hours averaged from hourly station data (S5P overpass ~13:30-14:30 IST); None = full day
    surface_model_path: Path | None = None  # pre-trained surface model (e.g. models/national/surface_model.joblib)
    fetch_osm_roads: bool = False  # replace GRIP4 road density with OSM major roads (slow, rate-limited)
    gapfill: GapFillConfig = field(default_factory=GapFillConfig)
    downscale: DownscaleConfig = field(default_factory=DownscaleConfig)
    dispersion: DispersionConfig = field(default_factory=DispersionConfig)
    validation: ValidationConfig = field(default_factory=ValidationConfig)

    @property
    def fine_res_deg(self) -> float:
        return self.coarse_res_deg / self.refine_factor

    def to_dict(self) -> dict:
        d = asdict(self)
        d["output_dir"] = str(self.output_dir)
        d["model_dir"] = str(self.model_dir)
        d["cache_dir"] = str(self.cache_dir)
        d["surface_model_path"] = str(self.surface_model_path) if self.surface_model_path else None
        return d
