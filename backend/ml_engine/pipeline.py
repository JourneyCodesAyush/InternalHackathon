"""End-to-end orchestration of the five engine stages."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

from . import export
from .config import PipelineConfig
from .dispersion import AdvectionDiffusionSolver, transport_summary
from .downscaling import CALIBRATOR_FILE, NO2Downscaler, SurfaceCalibrator, column_to_surface
from .gapfill import SpatioTemporalGapFiller
from .grid import GridSpec, upsample_bilinear
from .ingestion import load_stations_csv, quality_control, road_density_from_geojson
from .validation import StationValidator, regression_metrics, sample_at_stations, split_stations

log = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    coarse: xr.Dataset
    static: xr.Dataset
    gapfilled: xr.Dataset
    column_fine: xr.DataArray
    surface: xr.DataArray
    forecast: xr.DataArray | None
    report: dict
    outputs: dict = field(default_factory=dict)


class NO2Pipeline:
    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg
        self.coarse_grid = GridSpec.from_bbox(cfg.bbox, cfg.coarse_res_deg, cfg.crs)
        self.fine_grid = self.coarse_grid.refine(cfg.refine_factor)
        self.timings: dict[str, float] = {}

    # ---------------------------------------------------------------- ingestion
    def ingest(self, source: str, stations_csv: str | None = None, roads_geojson: str | None = None,
               ee_project: str | None = None, seed: int = 0):
        truth = None
        self.station_qc = None
        stations = None
        if stations_csv:
            stations, self.station_qc = quality_control(load_stations_csv(stations_csv))
            log.info("Station QC: %d/%d stations kept, %d frozen readings removed, dropped=%s, flagged low=%s",
                     self.station_qc["stations_out"], self.station_qc["stations_in"],
                     self.station_qc["frozen_rows_removed"], list(self.station_qc["dropped_stations"]),
                     list(self.station_qc["flagged_low_stations"]))
        with self._timer("ingest"):
            if source == "synthetic":
                from .ingestion import synthetic

                coarse, static, syn_stations, truth = synthetic.generate(self.cfg, self.coarse_grid, self.fine_grid, seed)
                stations = stations if stations is not None else syn_stations
            elif source == "gee":
                from .ingestion import gee

                gee.initialize(project=ee_project)
                coarse, static = gee.load_gee(self.cfg, self.coarse_grid, self.fine_grid)
            else:
                raise ValueError(f"unknown source {source!r}")
            if roads_geojson:
                static["road_density"] = (("y", "x"), road_density_from_geojson(roads_geojson, self.fine_grid))
        log.info("Ingested %d days on coarse grid %s and fine grid %s", coarse.sizes["time"], self.coarse_grid.shape, self.fine_grid.shape)
        return coarse, static, stations, truth

    # ---------------------------------------------------------------- full run
    def run(self, source: str = "synthetic", stations_csv: str | None = None, roads_geojson: str | None = None,
            ee_project: str | None = None, seed: int = 0, export_outputs: bool = True) -> PipelineResult:
        cfg = self.cfg
        out_dir = Path(cfg.output_dir)
        coarse, static, stations, truth = self.ingest(source, stations_csv, roads_geojson, ee_project, seed)
        report: dict = {
            "source": source,
            "config": cfg.to_dict(),
            "grids": {"coarse": self.coarse_grid.to_dict(), "fine": self.fine_grid.to_dict()},
        }
        if self.station_qc:
            report["station_qc"] = self.station_qc

        # Stage 1 ------------------------------------------------------------------------------
        filler = SpatioTemporalGapFiller(cfg.gapfill)
        with self._timer("gapfill_validation"):
            report["gapfill_holdout"] = filler.evaluate(coarse)
        with self._timer("gapfill"):
            gf = filler.fill(coarse)
        report["gapfill"] = gf.report
        gapfilled = gf.to_dataset()

        # Stage 2 ------------------------------------------------------------------------------
        downscaler = NO2Downscaler(cfg.downscale)
        with self._timer("downscale_train"):
            report["downscaler"] = downscaler.fit(coarse, gf.filled, gf.flag, static, cfg.refine_factor)
        downscaler.save(cfg.model_dir)
        downscaler = NO2Downscaler.load(cfg.model_dir, static)  # round-trip proves the artefact is loadable
        with self._timer("downscale_inference"):
            column_fine = downscaler.predict(coarse, gf.filled, self.fine_grid.x, self.fine_grid.y)
        pbl_conc = downscaler.to_surface(column_fine, coarse, calibrator=None)

        # Stage 4 (calibration on training stations, validation on unseen ones) ----------------
        calibrator = None
        surface = pbl_conc
        if stations is not None and len(stations):
            train_st, test_st = split_stations(stations, cfg.validation.test_station_fraction, cfg.validation.random_state)
            report["stations"] = {"train_ids": sorted(train_st.station_id.unique().tolist()),
                                  "test_ids": sorted(test_st.station_id.unique().tolist())}
            train_pairs = sample_at_stations(pbl_conc, train_st, self.fine_grid)
            try:
                calibrator = SurfaceCalibrator().fit(train_pairs["predicted"].values, train_pairs["no2"].values)
                calibrator.save(Path(cfg.model_dir) / CALIBRATOR_FILE)
                report["surface_calibration"] = calibrator.info
                surface = downscaler.to_surface(column_fine, coarse, calibrator)
            except ValueError as exc:
                log.warning("Skipping station calibration: %s", exc)
            validator = StationValidator(self.fine_grid, cfg.validation.min_r2, cfg.validation.max_rmse_ugm3)
            with self._timer("validation"):
                val = validator.validate(surface, test_st)
                baseline = self._coarse_baseline(coarse, gf.filled, calibrator, test_st)
            matched = val.pop("matched")
            report["validation_unseen_stations"] = val
            report["validation_baseline_coarse_no_downscaling"] = baseline
            if truth is not None:  # best achievable score given the synthetic station noise
                ceiling = sample_at_stations(truth["surface"], test_st, self.fine_grid)
                report["validation_noise_ceiling_synthetic"] = regression_metrics(ceiling["no2"], ceiling["predicted"])
            if export_outputs:
                matched.to_csv(out_dir / "validation_station_pairs.csv", index=False)
        else:
            log.warning("No station data - surface NO2 is uncalibrated and station validation is skipped")

        if truth is not None:  # synthetic runs know the true 250 m field
            report["synthetic_fine_truth"] = {
                "column_downscaled_vs_truth": regression_metrics(truth["column"].values, column_fine.values),
                "column_bilinear_vs_truth": regression_metrics(
                    truth["column"].values, upsample_bilinear(gf.filled.values, cfg.refine_factor)),
            }

        # Stage 3 ------------------------------------------------------------------------------
        with self._timer("dispersion"):
            t_last = coarse.sizes["time"] - 1
            u = upsample_bilinear(coarse["u10"].values[t_last].astype(np.float64), cfg.refine_factor)
            v = upsample_bilinear(coarse["v10"].values[t_last].astype(np.float64), cfg.refine_factor)
            solver = AdvectionDiffusionSolver(self.fine_grid, cfg.dispersion)
            forecast = solver.forecast(surface.values[t_last], u, v)
            forecast = forecast.expand_dims(time=[surface.time.values[t_last]])
        report["dispersion"] = {
            "base_time": str(pd.Timestamp(surface.time.values[t_last]).date()),
            **transport_summary(u, v),
            "horizon_domain_mean_ugm3": {str(h): float(forecast.sel(horizon_h=h).mean()) for h in forecast.horizon_h.values},
        }

        report["timings_s"] = self.timings
        result = PipelineResult(coarse, static, gapfilled, column_fine, surface, forecast.isel(time=0), report)
        if export_outputs:
            with self._timer("export"):
                result.outputs = self.export(result, u, v)
            report["outputs"] = result.outputs
            export.write_json(report, out_dir / "report.json")
        return result

    # ---------------------------------------------------------------- stage 5
    def export(self, res: PipelineResult, u: np.ndarray, v: np.ndarray) -> dict:
        out = Path(self.cfg.output_dir)
        last = res.surface.isel(time=-1)
        date = str(pd.Timestamp(last.time.values).date())
        paths = {
            "coarse_raw_nc": export.to_netcdf(res.coarse, out / "coarse_raw.nc"),
            "gapfilled_nc": export.to_netcdf(res.gapfilled, out / "coarse_gapfilled.nc"),
            "column_fine_nc": export.to_netcdf(res.column_fine, out / "no2_column_fine.nc"),
            "surface_nc": export.to_netcdf(res.surface, out / "no2_surface_fine.nc"),
            "raw_tif": export.to_geotiff(res.coarse["no2"].isel(time=-1), out / f"no2_raw_coarse_{date}.tif"),
            "gapfilled_tif": export.to_geotiff(res.gapfilled["no2"].isel(time=-1), out / f"no2_gapfilled_coarse_{date}.tif"),
            "surface_tif": export.to_geotiff(last, out / f"no2_surface_fine_{date}.tif"),
            "forecast_tif": export.to_geotiff(res.forecast, out / f"no2_forecast_{date}.tif"),
            "surface_csv": export.to_csv_points(last, out / f"no2_surface_fine_{date}.csv"),
            "surface_points_geojson": export.write_geojson(
                export.raster_to_geojson_points(last, stride=2), out / f"no2_surface_points_{date}.geojson"),
            "hazard_geojson": export.write_geojson(
                export.hazard_polygons_geojson(last, self.fine_grid), out / f"no2_hazard_bands_{date}.geojson"),
            "wind_geojson": export.write_geojson(
                export.wind_vectors_geojson(u, v, self.fine_grid), out / f"wind_vectors_{date}.geojson"),
        }
        for h in res.forecast.horizon_h.values:
            paths[f"forecast_hazard_{h:g}h_geojson"] = export.write_geojson(
                export.hazard_polygons_geojson(res.forecast.sel(horizon_h=h), self.fine_grid),
                out / f"no2_hazard_bands_{date}_plus{h:g}h.geojson")
        return {k: str(p) for k, p in paths.items()}

    # ---------------------------------------------------------------- helpers
    def _coarse_baseline(self, coarse, filled, calibrator, stations) -> dict:
        """Same conversion + calibration but without downscaling: what 250 m buys over the raw pixel."""
        f = self.cfg.refine_factor
        col = upsample_bilinear(filled.values.astype(np.float64), f)
        conc = column_to_surface(col, upsample_bilinear(coarse["blh"].values.astype(np.float64), f))
        if calibrator is not None:
            conc = calibrator.transform(conc)
        da = xr.DataArray(conc, coords={"time": coarse.time.values, "y": self.fine_grid.y, "x": self.fine_grid.x},
                          dims=("time", "y", "x"))
        m = sample_at_stations(da, stations, self.fine_grid)
        return regression_metrics(m["no2"], m["predicted"])

    class _T:
        def __init__(self, sink, key):
            self.sink, self.key = sink, key

        def __enter__(self):
            self.t0 = time.perf_counter()

        def __exit__(self, *exc):
            self.sink[self.key] = round(time.perf_counter() - self.t0, 2)

    def _timer(self, key: str):
        return self._T(self.timings, key)
