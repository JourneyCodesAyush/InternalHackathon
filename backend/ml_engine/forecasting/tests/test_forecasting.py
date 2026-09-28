"""Automated tests for the spatiotemporal forecasting engine.

Tests cover:
  * recursive forecasting (correct horizon progression)
  * physics consistency (puff displacement, mass conservation)
  * ConvLSTM forward pass (shape + no NaN)
  * dataset building (sample shapes)
  * loss functions (positive values)
  * metrics computation (valid ranges)
  * inference pipeline (end-to-end, physics-only)
  * output generation (GeoTIFF / NetCDF / GeoJSON)
  * API endpoint schema (response fields exist)
"""

from __future__ import annotations

import math
import tempfile
from pathlib import Path

import numpy as np
import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def small_grid():
    """A tiny 16×16 grid for fast tests."""
    H, W = 16, 16
    lat_center = 19.0
    res = 0.0025
    y = np.array([lat_center + res * (H / 2 - i - 0.5) for i in range(H)], dtype=np.float32)
    x = np.array([72.8 + res * (j + 0.5) for j in range(W)], dtype=np.float32)
    return H, W, y, x


@pytest.fixture
def gaussian_field(small_grid):
    """A Gaussian concentration field centred on the grid."""
    H, W, y, x = small_grid
    cx, cy = W // 2, H // 2
    rr, cc = np.mgrid[0:H, 0:W]
    c = 100.0 * np.exp(-((rr - cy) ** 2 + (cc - cx) ** 2) / 8.0)
    return c.astype(np.float32)


@pytest.fixture
def constant_wind(small_grid):
    """Uniform eastward wind of 3 m/s, northward of 2 m/s."""
    H, W, *_ = small_grid
    u = np.full((H, W), 3.0, dtype=np.float32)
    v = np.full((H, W), 2.0, dtype=np.float32)
    return u, v


# ---------------------------------------------------------------------------
# 1. Physics — horizon progression
# ---------------------------------------------------------------------------

class TestPhysicsHorizons:
    def test_correct_horizons_produced(self, small_grid, gaussian_field, constant_wind):
        from ml_engine.forecasting.physics import ImprovedPhysicsSolver
        from ml_engine.forecasting.config import PhysicsConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        cfg = PhysicsConfig(
            dt_s=300.0,
            export_interval_min=30,
            max_horizon_min=120,
        )
        solver = ImprovedPhysicsSolver(H, W, 277.0, 277.0, cfg)
        ds = solver.forecast(gaussian_field, [(u, v)], y, x)

        horizons = list(ds["horizon_min"].values)
        assert horizons == [30, 60, 90, 120], f"Got horizons: {horizons}"

    def test_output_shape(self, small_grid, gaussian_field, constant_wind):
        from ml_engine.forecasting.physics import ImprovedPhysicsSolver

        H, W, y, x = small_grid
        u, v = constant_wind
        solver = ImprovedPhysicsSolver(H, W, 277.0, 277.0)
        ds = solver.forecast(gaussian_field, [(u, v)], y, x)

        assert ds["no2_forecast"].shape == (4, H, W)

    def test_no_negative_concentrations(self, small_grid, gaussian_field, constant_wind):
        from ml_engine.forecasting.physics import ImprovedPhysicsSolver

        H, W, y, x = small_grid
        u, v = constant_wind
        solver = ImprovedPhysicsSolver(H, W, 277.0, 277.0)
        ds = solver.forecast(gaussian_field, [(u, v)], y, x)

        assert float(ds["no2_forecast"].min()) >= 0.0


# ---------------------------------------------------------------------------
# 2. Physics — mass conservation
# ---------------------------------------------------------------------------

class TestMassConservation:
    def test_mass_conserved_persistent_emissions(self, small_grid, gaussian_field, constant_wind):
        """With persistent emissions, mass should be conserved (within 1%)."""
        from ml_engine.forecasting.physics import ImprovedPhysicsSolver
        from ml_engine.forecasting.config import PhysicsConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        cfg = PhysicsConfig(
            emission_mode="persistent",
            diffusivity_m2_s=0.0,   # no diffusion → pure advection
            lifetime_h=1000.0,       # essentially no decay
            dt_s=300.0,
            export_interval_min=30,
            max_horizon_min=30,      # just one frame
        )
        solver = ImprovedPhysicsSolver(H, W, 277.0, 277.0, cfg)
        ds = solver.forecast(gaussian_field, [(u, v)], y, x, preserve_mass=True)

        m0 = float(np.nansum(gaussian_field))
        m1 = float(np.nansum(ds["no2_forecast"].values[0]))
        err = abs(m1 - m0) / (m0 + 1e-12)
        assert err < 0.01, f"Mass error {err:.4f} exceeds 1%"

    def test_mass_error_reported(self, small_grid, gaussian_field, constant_wind):
        from ml_engine.forecasting.physics import ImprovedPhysicsSolver

        H, W, y, x = small_grid
        u, v = constant_wind
        solver = ImprovedPhysicsSolver(H, W, 277.0, 277.0)
        ds = solver.forecast(gaussian_field, [(u, v)], y, x)

        me = ds["mass_error"].values
        assert len(me) == 4
        assert all(0.0 <= float(e) < 1.0 for e in me if not math.isnan(float(e)))


# ---------------------------------------------------------------------------
# 3. Physics — puff advection correctness
# ---------------------------------------------------------------------------

class TestAdvection:
    def test_puff_moves_with_wind(self, small_grid):
        """A point puff should move in the wind direction."""
        from ml_engine.forecasting.physics import ImprovedPhysicsSolver
        from ml_engine.forecasting.config import PhysicsConfig

        H, W = 48, 48
        lat_center, res = 19.0, 0.0025
        y = np.array([lat_center + res * (H / 2 - i - 0.5) for i in range(H)], dtype=np.float32)
        x = np.array([72.8 + res * (j + 0.5) for j in range(W)], dtype=np.float32)

        cfg = PhysicsConfig(
            emission_mode="none",    # free plume
            diffusivity_m2_s=0.0,
            lifetime_h=1000.0,
            dt_s=30.0,
            export_interval_min=30,
            max_horizon_min=30,
        )
        # Place puff near west side (col 5)
        c0 = np.zeros((H, W), dtype=np.float32)
        r0, c_idx = H // 2, 5
        c0[r0, c_idx] = 1000.0

        dx = 277.0  # ~250 m cells
        u_speed = 3.0  # m/s eastward
        u = np.full((H, W), u_speed, dtype=np.float32)
        v = np.zeros((H, W), dtype=np.float32)

        solver = ImprovedPhysicsSolver(H, W, dx, dx, cfg)
        ds = solver.forecast(c0, [(u, v)], y, x, preserve_mass=False)

        frame = ds["no2_forecast"].values[0]  # t+30 min
        cmax = np.unravel_index(np.argmax(frame), frame.shape)
        expected_col_shift = round(u_speed * 1800.0 / dx)  # pixels in 30 min

        # Allow ±2 pixel tolerance
        assert abs(cmax[1] - (c_idx + expected_col_shift)) <= 2, (
            f"Puff column: expected ~{c_idx + expected_col_shift}, got {cmax[1]}"
        )


# ---------------------------------------------------------------------------
# 4. Metrics
# ---------------------------------------------------------------------------

class TestMetrics:
    def test_rmse_perfect(self):
        from ml_engine.forecasting.metrics import rmse
        a = np.random.rand(10, 10).astype(np.float32)
        assert rmse(a, a) == pytest.approx(0.0, abs=1e-6)

    def test_r2_perfect(self):
        from ml_engine.forecasting.metrics import r2
        a = np.random.rand(10, 10).astype(np.float32)
        assert r2(a, a) == pytest.approx(1.0, abs=1e-5)

    def test_mass_error_zero(self):
        from ml_engine.forecasting.metrics import mass_error
        a = np.ones((10, 10), np.float32) * 5.0
        assert mass_error(a, a) == pytest.approx(0.0, abs=1e-6)

    def test_iou_all_above_threshold(self):
        from ml_engine.forecasting.metrics import iou_high_no2
        a = np.full((10, 10), 100.0, np.float32)
        assert iou_high_no2(a, a) == pytest.approx(1.0, abs=1e-5)

    def test_plume_displacement_same(self):
        from ml_engine.forecasting.metrics import plume_center_displacement_km
        y = np.linspace(19.0, 19.1, 10)
        x = np.linspace(72.8, 72.9, 10)
        a = np.random.rand(10, 10).astype(np.float32) + 1.0
        d = plume_center_displacement_km(a, a, y, x)
        assert d == pytest.approx(0.0, abs=0.01)

    def test_forecast_metrics_compute(self, small_grid, gaussian_field):
        from ml_engine.forecasting.metrics import ForecastMetrics
        _, _, y, x = small_grid
        pred = np.stack([gaussian_field * 0.9] * 4, axis=0)
        true = np.stack([gaussian_field] * 4, axis=0)
        metrics = ForecastMetrics.compute(pred, true, [30, 60, 90, 120], y, x)
        assert len(metrics.per_horizon) == 4
        assert metrics.overall["rmse"] > 0
        assert -1 <= metrics.overall["r2"] <= 1.0


# ---------------------------------------------------------------------------
# 5. Dataset
# ---------------------------------------------------------------------------

class TestDataset:
    def test_sample_shapes(self):
        from ml_engine.forecasting.dataset import build_sample, DYNAMIC_CHANNELS, STATIC_CHANNELS
        import xarray as xr

        H, W = 32, 32
        seq_len = 4
        out_h = 4
        patch = 16
        total = seq_len + out_h

        # Build minimal xr.Dataset frames
        def _frame():
            coords = {"y": np.arange(H, dtype=float), "x": np.arange(W, dtype=float)}
            data = {
                "no2":       (["y", "x"], np.random.rand(H, W).astype(np.float32) * 50),
                "co":        (["y", "x"], np.random.rand(H, W).astype(np.float32)),
                "wind_u":    (["y", "x"], np.random.rand(H, W).astype(np.float32) * 5),
                "wind_v":    (["y", "x"], np.random.rand(H, W).astype(np.float32) * 5),
                "temp":      (["y", "x"], np.random.rand(H, W).astype(np.float32) * 30),
                "pressure":  (["y", "x"], np.random.rand(H, W).astype(np.float32) * 100 + 900),
                "humidity":  (["y", "x"], np.random.rand(H, W).astype(np.float32) * 10),
                "blh":       (["y", "x"], np.random.rand(H, W).astype(np.float32) * 1000),
            }
            return xr.Dataset(data, coords=coords)

        def _static():
            coords = {"y": np.arange(H, dtype=float), "x": np.arange(W, dtype=float)}
            data = {
                "dem":         (["y", "x"], np.random.rand(H, W).astype(np.float32) * 500),
                "slope":       (["y", "x"], np.random.rand(H, W).astype(np.float32) * 10),
                "road_density":(["y", "x"], np.random.rand(H, W).astype(np.float32)),
                "built_up":    (["y", "x"], np.random.rand(H, W).astype(np.float32)),
                "night_lights":(["y", "x"], np.random.rand(H, W).astype(np.float32)),
                "population":  (["y", "x"], np.random.rand(H, W).astype(np.float32) * 1000),
                "power_plants":(["y", "x"], np.zeros((H, W), np.float32)),
            }
            return xr.Dataset(data, coords=coords)

        frames = [_frame() for _ in range(total)]
        static = _static()
        result = build_sample(frames, static, 0, 0, patch, seq_len, out_h)
        assert result is not None
        dyn, sta, tgt = result
        assert dyn.shape == (seq_len, len(DYNAMIC_CHANNELS), patch, patch)
        assert sta.shape == (len(STATIC_CHANNELS), patch, patch)
        assert tgt.shape == (out_h, patch, patch)

    def test_dataset_save_load(self, tmp_path):
        from ml_engine.forecasting.dataset import ForecastDataset
        N, T, C, C_s, H, W, out_h = 5, 4, 10, 7, 16, 16, 4
        dyn = np.random.rand(N, T, C, H, W).astype(np.float32)
        sta = np.random.rand(N, C_s, H, W).astype(np.float32)
        tgt = np.random.rand(N, out_h, H, W).astype(np.float32)
        ds = ForecastDataset(dyn, sta, tgt)
        ds.save(tmp_path, "test")
        ds2 = ForecastDataset.from_cache(tmp_path, "test")
        np.testing.assert_array_equal(ds2.dynamic, dyn)
        assert len(ds2) == N


# ---------------------------------------------------------------------------
# 6. Losses (requires torch)
# ---------------------------------------------------------------------------

class TestLosses:
    def test_mse_loss_positive(self):
        pytest.importorskip("torch")
        import torch
        from ml_engine.forecasting.losses import mse_loss
        p = torch.rand(2, 4, 8, 8)
        t = torch.rand(2, 4, 8, 8)
        assert float(mse_loss(p, t)) >= 0.0

    def test_gradient_loss_zero_for_constant(self):
        pytest.importorskip("torch")
        import torch
        from ml_engine.forecasting.losses import gradient_loss
        p = torch.ones(2, 4, 8, 8)
        t = torch.ones(2, 4, 8, 8)
        assert float(gradient_loss(p, t)) < 1e-6

    def test_mass_conservation_loss_zero(self):
        pytest.importorskip("torch")
        import torch
        from ml_engine.forecasting.losses import mass_conservation_loss
        a = torch.rand(2, 4, 8, 8)
        assert float(mass_conservation_loss(a, a)) < 1e-6

    def test_combined_loss_returns_dict(self):
        pytest.importorskip("torch")
        import torch
        from ml_engine.forecasting.losses import ForecastLoss
        criterion = ForecastLoss()
        p = torch.rand(2, 4, 8, 8)
        t = torch.rand(2, 4, 8, 8)
        losses = criterion(p, t)
        assert "total" in losses
        assert float(losses["total"]) > 0.0


# ---------------------------------------------------------------------------
# 7. ConvLSTM model (requires torch)
# ---------------------------------------------------------------------------

class TestConvLSTM:
    def test_forward_shape(self):
        pytest.importorskip("torch")
        import torch
        from ml_engine.forecasting.config import ForecastConfig
        from ml_engine.forecasting.convlstm import ConvLSTMResidualModel

        cfg = ForecastConfig()
        cfg.convlstm.use_unet_encoder = False  # faster
        cfg.convlstm.hidden_channels = 8
        cfg.convlstm.num_layers = 1
        model = ConvLSTMResidualModel(cfg.convlstm)

        T, C, C_s, H, W = 4, 10, 7, 16, 16
        dyn = np.random.rand(T, C, H, W).astype(np.float32)
        sta = np.random.rand(C_s, H, W).astype(np.float32)
        out = model.predict(dyn, sta)
        assert out.shape == (cfg.convlstm.output_horizons, H, W)
        assert not np.any(np.isnan(out))

    def test_parameter_count(self):
        pytest.importorskip("torch")
        from ml_engine.forecasting.config import ForecastConfig
        from ml_engine.forecasting.convlstm import ConvLSTMResidualModel

        cfg = ForecastConfig()
        model = ConvLSTMResidualModel(cfg.convlstm)
        n = model.count_parameters()
        assert n > 0
        print(f"  ConvLSTM params: {n:,}")


# ---------------------------------------------------------------------------
# 8. End-to-end inference (physics only — no torch required)
# ---------------------------------------------------------------------------

class TestInferencePipeline:
    def test_physics_only_run(self, small_grid, gaussian_field, constant_wind):
        from ml_engine.forecasting.inference import run_inference
        from ml_engine.forecasting.config import ForecastConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        cfg = ForecastConfig.physics_only()

        result = run_inference(
            c0=gaussian_field,
            wind_sequence=[(u, v)],
            dynamic_history=None,
            static_feat=None,
            y=y, x=x,
            cfg=cfg,
        )
        assert result.horizons_min == [30, 60, 90, 120]
        assert result.no2_hybrid.shape == (4, H, W)
        assert float(result.no2_hybrid.min()) >= 0.0

    def test_residual_is_zero_without_checkpoint(self, small_grid, gaussian_field, constant_wind):
        """With no checkpoint, residual should be zeros (fallback)."""
        from ml_engine.forecasting.inference import run_inference
        from ml_engine.forecasting.config import ForecastConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        cfg = ForecastConfig()
        cfg.use_ai_residual = True

        result = run_inference(
            c0=gaussian_field,
            wind_sequence=[(u, v)],
            dynamic_history=np.zeros((4, 10, H, W), dtype=np.float32),
            static_feat=np.zeros((7, H, W), dtype=np.float32),
            y=y, x=x,
            cfg=cfg,
            checkpoint_path=None,  # no trained model
        )
        # Hybrid == physics when residual is zero or fallback
        np.testing.assert_allclose(
            result.no2_hybrid, result.no2_physics, rtol=1e-4, atol=1e-4
        )

    def test_confidence_in_valid_range(self, small_grid, gaussian_field, constant_wind):
        from ml_engine.forecasting.inference import run_inference
        from ml_engine.forecasting.config import ForecastConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        result = run_inference(gaussian_field, [(u, v)], None, None, y, x, ForecastConfig.physics_only())
        assert result.confidence.min() >= 0.0
        assert result.confidence.max() <= 1.0


# ---------------------------------------------------------------------------
# 9. Output generation
# ---------------------------------------------------------------------------

class TestOutputGeneration:
    def test_geotiff_created(self, small_grid, gaussian_field, constant_wind, tmp_path):
        pytest.importorskip("rasterio")
        from ml_engine.forecasting.inference import run_inference, export_geotiff
        from ml_engine.forecasting.config import ForecastConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        result = run_inference(gaussian_field, [(u, v)], None, None, y, x, ForecastConfig.physics_only())
        paths = export_geotiff(result, tmp_path)
        assert len(paths) == 4
        for p in paths:
            assert Path(p).exists()
            assert Path(p).stat().st_size > 0

    def test_netcdf_created(self, small_grid, gaussian_field, constant_wind, tmp_path):
        from ml_engine.forecasting.inference import run_inference, export_netcdf
        from ml_engine.forecasting.config import ForecastConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        result = run_inference(gaussian_field, [(u, v)], None, None, y, x, ForecastConfig.physics_only())
        path = export_netcdf(result, tmp_path)
        assert Path(path).exists()
        import xarray as xr
        ds = xr.open_dataset(path, engine="h5netcdf")
        assert "no2_hybrid" in ds

    def test_wind_geojson_created(self, small_grid, gaussian_field, constant_wind, tmp_path):
        import json
        from ml_engine.forecasting.inference import run_inference, export_wind_geojson
        from ml_engine.forecasting.config import ForecastConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        result = run_inference(gaussian_field, [(u, v)], None, None, y, x, ForecastConfig.physics_only())
        path = export_wind_geojson(result, tmp_path, stride=4)
        assert Path(path).exists()
        gj = json.loads(Path(path).read_text())
        assert gj["type"] == "FeatureCollection"
        assert len(gj["features"]) > 0
        feat = gj["features"][0]
        assert "speed_ms" in feat["properties"]

    def test_to_xarray_structure(self, small_grid, gaussian_field, constant_wind):
        from ml_engine.forecasting.inference import run_inference
        from ml_engine.forecasting.config import ForecastConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        result = run_inference(gaussian_field, [(u, v)], None, None, y, x, ForecastConfig.physics_only())
        ds = result.to_xarray()
        for var in ["no2_physics", "no2_hybrid", "confidence", "mass_error"]:
            assert var in ds


# ---------------------------------------------------------------------------
# 10. ForecastEngine high-level API
# ---------------------------------------------------------------------------

class TestForecastEngine:
    def test_predict_returns_result(self, small_grid, gaussian_field, constant_wind):
        from ml_engine.forecasting.engine import ForecastEngine

        H, W, y, x = small_grid
        u, v = constant_wind
        engine = ForecastEngine()
        result = engine.predict(gaussian_field, u, v, y, x)
        assert result.horizons_min == [30, 60, 90, 120]

    def test_predict_and_export(self, small_grid, gaussian_field, constant_wind, tmp_path):
        from ml_engine.forecasting.engine import ForecastEngine

        H, W, y, x = small_grid
        u, v = constant_wind
        engine = ForecastEngine()
        result, paths = engine.predict_and_export(gaussian_field, u, v, y, x, output_dir=tmp_path)
        assert "netcdf" in paths
        assert Path(paths["netcdf"]).exists()


# ---------------------------------------------------------------------------
# 11. Extended Physics Tests: Dynamic Wind, Terrain & Categorized Sources
# ---------------------------------------------------------------------------

class TestExtendedPhysics:
    def test_dynamic_hourly_wind_interpolation(self, small_grid, gaussian_field):
        from ml_engine.forecasting.physics import ImprovedPhysicsSolver
        from ml_engine.forecasting.config import PhysicsConfig

        H, W, y, x = small_grid
        # Hour 0 wind is purely eastward (+3, 0)
        u0 = np.full((H, W), 3.0, dtype=np.float32)
        v0 = np.full((H, W), 0.0, dtype=np.float32)
        # Hour 1 wind shifts to northward (0, +3)
        u1 = np.full((H, W), 0.0, dtype=np.float32)
        v1 = np.full((H, W), 3.0, dtype=np.float32)

        cfg = PhysicsConfig(enable_dynamic_wind=True)
        solver = ImprovedPhysicsSolver(H, W, 277.0, 277.0, cfg)
        ds = solver.forecast(gaussian_field, [(u0, v0), (u1, v1)], y, x)

        assert ds["no2_forecast"].shape == (4, H, W)
        assert not np.isnan(ds["no2_forecast"].values).any()

    def test_terrain_aware_transport_deflection(self, small_grid, gaussian_field, constant_wind):
        from ml_engine.forecasting.physics import ImprovedPhysicsSolver
        from ml_engine.forecasting.config import PhysicsConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        # Steep DEM ridge along center
        rr, cc = np.mgrid[0:H, 0:W]
        dem = (500.0 * np.exp(-((cc - W // 2) ** 2) / 8.0)).astype(np.float32)
        slope = np.hypot(np.gradient(dem, axis=0), np.gradient(dem, axis=1)).astype(np.float32)

        cfg = PhysicsConfig(enable_terrain_effect=True)
        solver = ImprovedPhysicsSolver(H, W, 277.0, 277.0, cfg)
        ds_terrain = solver.forecast(gaussian_field, [(u, v)], y, x, dem=dem, slope=slope)
        ds_flat = solver.forecast(gaussian_field, [(u, v)], y, x)

        # Output with terrain should physically differ from flat terrain
        diff = np.max(np.abs(ds_terrain["no2_forecast"].values - ds_flat["no2_forecast"].values))
        assert diff > 0.0

    def test_persistent_emission_sources(self, small_grid, gaussian_field, constant_wind):
        from ml_engine.forecasting.physics import ImprovedPhysicsSolver
        from ml_engine.forecasting.config import PhysicsConfig

        H, W, y, x = small_grid
        u, v = constant_wind
        power_plants = np.zeros((H, W), dtype=np.float32)
        power_plants[H // 2, W // 2] = 1.0

        cfg = PhysicsConfig(enable_source_persistence=True, emission_mode="persistent")
        solver = ImprovedPhysicsSolver(H, W, 277.0, 277.0, cfg)
        ds = solver.forecast(
            gaussian_field,
            [(u, v)],
            y,
            x,
            emission_sources={"power_plants": power_plants},
        )
        assert ds["no2_forecast"].shape == (4, H, W)
        assert float(ds["no2_forecast"].values[-1, H // 2, W // 2]) > 0.0


# ---------------------------------------------------------------------------
# 12. Synthetic Atmospheric Sequence Generator & Dual Loader Tests
# ---------------------------------------------------------------------------

class TestSyntheticAndDualLoader:
    @pytest.mark.parametrize("scenario", [
        "shifting_wind",
        "rotating_vortex",
        "plume_merging",
        "plume_splitting",
        "mountain_deflection",
        "urban_hotspot",
    ])
    def test_synthetic_scenarios(self, scenario):
        from ml_engine.forecasting.datasets.synthetic import SyntheticAtmosphericGenerator

        gen = SyntheticAtmosphericGenerator(seed=42)
        dyn, sta, tgt, meta = gen.generate_sample(h=32, w=32, seq_len=4, output_horizons=4, scenario=scenario)

        assert dyn.shape == (4, 10, 32, 32)
        assert sta.shape == (7, 32, 32)
        assert tgt.shape == (4, 32, 32)
        assert meta["scenario"] == scenario
        assert not np.isnan(dyn).any()
        assert not np.isnan(tgt).any()

    def test_dual_dataset_loader_synthetic_mode(self):
        from ml_engine.forecasting.datasets.loader import load_dataset

        train_ds, val_ds = load_dataset(mode="synthetic", num_samples=8, h=24, w=24)
        assert len(train_ds) > 0
        assert len(val_ds) > 0
        sample = train_ds[0]
        assert sample["dynamic"].shape[1:] == (10, 24, 24)

