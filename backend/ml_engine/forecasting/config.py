"""Configuration for the spatiotemporal NO₂ forecasting engine.

All physical constants, architecture hyper-parameters and output settings
are collected here so that a single ForecastConfig object fully specifies
an experiment.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


# ---------------------------------------------------------------------------
# Physics
# ---------------------------------------------------------------------------

@dataclass
class PhysicsConfig:
    """Parameters for the improved advection-diffusion-reaction solver."""

    # Internal timestep (seconds). Default 300s (5 min).
    dt_s: float = 300.0

    # Output interval. The solver accumulates steps and exports at every 30-min mark.
    export_interval_min: int = 30

    # Maximum forecast horizon in minutes.
    max_horizon_min: int = 120

    # Horizontal eddy diffusivity (m²/s). Default 50.0.
    diffusivity_m2_s: float = 50.0

    # Daytime NO₂ chemical lifetime via OH oxidation (hours). Default 4.0h.
    lifetime_h: float = 4.0

    # Emission mode: "persistent" = sources keep emitting, "none" = free plume.
    emission_mode: str = "persistent"

    # How often ERA5 winds are refreshed.
    wind_update_interval_min: int = 60

    # Mass-conservation tolerance: back-projection is skipped if the relative
    # mass error is already below this threshold.
    mass_tol: float = 1e-4

    # Dynamic hourly wind continuous temporal interpolation
    enable_dynamic_wind: bool = True

    # Lightweight terrain-aware flow deflection & stagnation using DEM and slope
    enable_terrain_effect: bool = True

    # Source persistence with categorization (power plants, industrial, traffic)
    enable_source_persistence: bool = True

    @property
    def horizon_steps(self) -> list[int]:
        """Export times in minutes: [30, 60, 90, 120, ...]."""
        return list(range(
            self.export_interval_min,
            self.max_horizon_min + 1,
            self.export_interval_min,
        ))

    @classmethod
    def from_env(cls) -> "PhysicsConfig":
        """Build PhysicsConfig reading environment overrides if present."""
        import os
        dt = float(os.getenv("INTERNAL_TIMESTEP", "300"))
        interval = int(os.getenv("FORECAST_INTERVAL", "30"))
        max_h = int(os.getenv("MAX_FORECAST_HORIZON", "120"))
        diff = float(os.getenv("DIFFUSION_COEFFICIENT", "50.0"))
        life = float(os.getenv("PHOTOCHEMICAL_LIFETIME_HOURS", "4.0"))
        dyn_wind = os.getenv("ENABLE_DYNAMIC_WIND", "true").lower() in ("true", "1", "yes")
        terrain = os.getenv("ENABLE_TERRAIN_EFFECT", "true").lower() in ("true", "1", "yes")
        persist = os.getenv("ENABLE_SOURCE_PERSISTENCE", "true").lower() in ("true", "1", "yes")
        return cls(
            dt_s=dt,
            export_interval_min=interval,
            max_horizon_min=max_h,
            diffusivity_m2_s=diff,
            lifetime_h=life,
            enable_dynamic_wind=dyn_wind,
            enable_terrain_effect=terrain,
            enable_source_persistence=persist,
        )


# ---------------------------------------------------------------------------
# ConvLSTM residual model
# ---------------------------------------------------------------------------

@dataclass
class ConvLSTMConfig:
    """Architecture of the ConvLSTM residual correction network."""

    # Sequence length fed to the network (number of 30-min frames before t0).
    seq_len: int = 4  # t-90, t-60, t-30, t0

    # Spatial patch size (pixels) around each cell (must be odd).
    patch_size: int = 64

    # ConvLSTM hidden channels.
    hidden_channels: int = 64

    # Number of ConvLSTM layers.
    num_layers: int = 3

    # Kernel size for ConvLSTM cell convolutions.
    kernel_size: int = 3

    # Whether to add a U-Net encoder before the ConvLSTM.
    use_unet_encoder: bool = True

    # U-Net encoder depths (out_channels at each scale).
    unet_channels: tuple[int, ...] = (32, 64, 128)

    # Dropout rate applied after each ConvLSTM layer.
    dropout: float = 0.1

    # Number of dynamic input channels per frame.
    # [NO₂, prev_NO₂, CO, wind_u, wind_v, wind_speed, temp, pressure, humidity, BLH]
    dynamic_channels: int = 10

    # Number of static input channels (stacked once).
    # [DEM, slope, road_density, built_up, night_lights, population, power_plants]
    static_channels: int = 7

    # Output channels: residual correction for each of the 4 horizons.
    output_horizons: int = 4


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

@dataclass
class TrainerConfig:
    """Training loop hyper-parameters."""

    # Batch size (number of spatial patches per gradient step).
    batch_size: int = 8

    # Maximum epochs before stopping.
    max_epochs: int = 100

    # Learning rate for AdamW.
    learning_rate: float = 3e-4

    # Weight decay.
    weight_decay: float = 1e-4

    # Gradient clipping max norm.
    grad_clip: float = 1.0

    # Early-stopping patience (epochs without improvement on validation loss).
    patience: int = 10

    # Whether to use mixed precision (torch.cuda.amp).
    use_amp: bool = True

    # Checkpoint directory.
    checkpoint_dir: Path = Path("models/forecasting")

    # How often to save a checkpoint (epochs).
    save_every: int = 5

    # Random seed for reproducibility.
    seed: int = 42

    # Train / validation split (fraction of sequences used for validation).
    val_fraction: float = 0.15

    # Device configuration ("auto", "mps", "cuda", "cpu").
    # On Apple Silicon Macs, "auto" resolves to "mps" with fallback to "cpu".
    device: str = "auto"

    # TensorBoard logging directory and toggle.
    log_dir: Path = Path("runs/forecasting")
    use_tensorboard: bool = True

    # Loss weights.
    loss_mse_weight: float = 1.0
    loss_gradient_weight: float = 0.3
    loss_mass_weight: float = 0.2


# ---------------------------------------------------------------------------
# Data / dataset
# ---------------------------------------------------------------------------

@dataclass
class DatasetConfig:
    """Settings for the global historical data downloader and caching system."""

    # Root for all cached HDF5 / NetCDF tiles.
    cache_dir: Path = Path("cache/forecasting")

    # Training period.
    train_start: str = "2019-01-01"
    train_end: str = "2024-12-31"

    # Test period (no leakage — entirely after training).
    test_start: str = "2025-01-01"
    test_end: str = "2025-12-31"

    # Sentinel-5P product type for downloads.
    s5p_product: str = "OFFL"

    # ERA5 variables to download.
    era5_variables: tuple[str, ...] = (
        "u_component_of_wind",
        "v_component_of_wind",
        "surface_pressure",
        "2m_temperature",
        "2m_dewpoint_temperature",
        "specific_humidity",
        "sensible_heat_flux",
        "latent_heat_flux",
    )

    # GEOS-CF variable.
    geoscf_variable: str = "ZPBL"

    # Spatial resolution for training tiles (degrees).
    tile_res_deg: float = 0.0025

    # Number of tiles to generate per city per month.
    tiles_per_city_month: int = 10

    # Cities to include in the global training set.
    # Extend this list to add new regions without changing the pipeline.
    global_cities: tuple[str, ...] = (
        # India (already have CPCB ground truth)
        "Mumbai", "Delhi", "Kolkata", "Chennai", "Bangalore",
        "Pune", "Hyderabad", "Ahmedabad", "Jaipur", "Lucknow",
        # International (plug-in ground truth later)
        "Beijing", "Shanghai", "Seoul", "Tokyo",
        "London", "Paris", "Berlin", "Rome",
        "New York", "Los Angeles", "Chicago",
        "São Paulo", "Mexico City",
        "Cairo", "Lagos",
        "Sydney", "Melbourne",
    )


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

@dataclass
class OutputConfig:
    """File export settings."""

    # Root directory for forecast outputs.
    output_dir: Path = Path("outputs/forecasts")

    # Coordinate reference system.
    crs: str = "EPSG:4326"

    # Whether to write GeoTIFF files.
    write_geotiff: bool = True

    # Whether to write NetCDF files.
    write_netcdf: bool = True

    # Whether to write GeoJSON wind vectors.
    write_wind_geojson: bool = True

    # Whether to write confidence maps.
    write_confidence: bool = True

    # Filename stem pattern.  {horizon:04d} → forecast_0030, forecast_0060, …
    filename_pattern: str = "forecast_{horizon:04d}"

    # GeoJSON wind vector grid stride (skip every N pixels to thin arrows).
    wind_arrow_stride: int = 20


# ---------------------------------------------------------------------------
# Master config
# ---------------------------------------------------------------------------

@dataclass
class ForecastConfig:
    """Master configuration object for the spatiotemporal forecasting engine."""

    physics: PhysicsConfig = field(default_factory=PhysicsConfig)
    convlstm: ConvLSTMConfig = field(default_factory=ConvLSTMConfig)
    trainer: TrainerConfig = field(default_factory=TrainerConfig)
    dataset: DatasetConfig = field(default_factory=DatasetConfig)
    output: OutputConfig = field(default_factory=OutputConfig)

    # Earth Engine project (overridden by EE_PROJECT env var at runtime).
    ee_project: str | None = None

    # If True, the ConvLSTM residual is added on top of physics output.
    # If False, only the physics solver runs (useful for ablation / no-data).
    use_ai_residual: bool = True

    # If True, log detailed step-by-step timing.
    verbose: bool = False

    @classmethod
    def physics_only(cls) -> "ForecastConfig":
        """Convenience constructor: physics solver only, no AI residual."""
        cfg = cls()
        cfg.use_ai_residual = False
        return cfg
