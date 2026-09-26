"""End-to-end orchestration of the five engine stages."""

from __future__ import annotations

import hashlib
import json
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
from .downscaling import NO2Downscaler
from .gapfill import SpatioTemporalGapFiller
from .grid import GridSpec, upsample_bilinear
from .ingestion import load_stations_csv, quality_control, road_density_from_geojson
from .surface import SurfaceFeatureBuilder, SurfaceModel, select_surface_model
from .validation import acceptance, regression_metrics, sample_at_stations, summarize_predictions

log = logging.getLogger(__name__)

SURFACE_MODEL_FILE = "surface_model.joblib"
GEE_CACHE_VERSION = 5  # bump when the set of ingested layers changes


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
            stations, self.station_qc = quality_control(load_stations_csv(stations_csv, self.cfg.station_hours))
            log.info("Station QC: %d/%d stations kept, %d frozen readings removed, dropped=%s",
                     self.station_qc["stations_out"], self.station_qc["stations_in"],
                     self.station_qc["frozen_rows_removed"], list(self.station_qc["dropped_stations"]))
        with self._timer("ingest"):
            if source == "synthetic":
                from .ingestion import synthetic

                coarse, static, syn_stations, truth = synthetic.generate(self.cfg, self.coarse_grid, self.fine_grid, seed)
                stations = stations if stations is not None else syn_stations
            elif source == "gee":
                coarse, static = self._load_gee_cached(ee_project)
                if not roads_geojson and self.cfg.fetch_osm_roads:
                    from .ingestion.osm import fetch_major_roads

                    roads_geojson = fetch_major_roads(self.fine_grid.bbox, self.cfg.cache_dir)
            else:
                raise ValueError(f"unknown source {source!r}")
            if roads_geojson:
                static["road_density"] = (("y", "x"), road_density_from_geojson(roads_geojson, self.fine_grid))
        log.info("Ingested %d days on coarse grid %s and fine grid %s", coarse.sizes["time"], self.coarse_grid.shape, self.fine_grid.shape)
        return coarse, static, stations, truth

    def _load_gee_cached(self, ee_project: str | None) -> tuple[xr.Dataset, xr.Dataset]:
        """Earth Engine download, cached on disk per (AOI, period, grid, screening) so reruns are instant."""
        from .ingestion import gee

        cfg = self.cfg
        key = hashlib.sha1(json.dumps([GEE_CACHE_VERSION, cfg.s5p_product, cfg.bbox, cfg.start_date, cfg.end_date, cfg.coarse_res_deg, cfg.refine_factor,
                                       cfg.qa_threshold, cfg.max_cloud_fraction, cfg.min_valid_subpixel_fraction]
                                      ).encode()).hexdigest()[:12]
        cache_dir = Path(cfg.cache_dir)
        coarse_path, static_path = cache_dir / f"gee_{key}_coarse.nc", cache_dir / f"gee_{key}_static.nc"
        if coarse_path.exists() and static_path.exists():
            log.info("Using cached Earth Engine data %s", coarse_path)
            return xr.load_dataset(coarse_path, engine="h5netcdf"), xr.load_dataset(static_path, engine="h5netcdf")
        gee.initialize(project=ee_project)
        coarse, static = gee.load_gee(cfg, self.coarse_grid, self.fine_grid)
        cache_dir.mkdir(parents=True, exist_ok=True)
        coarse.to_netcdf(coarse_path, engine="h5netcdf")
        static.to_netcdf(static_path, engine="h5netcdf")
        return coarse, static

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
        pbl_conc = downscaler.to_surface(column_fine, coarse)

        # Stage 4 - station-trained surface model, scored on unseen stations (leave-stations-out CV)
        surface = pbl_conc
        if cfg.surface_model_path:
            surface = self._apply_pretrained_surface(cfg, static, coarse, gf, column_fine, stations, report, out_dir,
                                                     export_outputs)
        elif stations is not None and len(stations):
            with self._timer("surface_model"):
                builder = SurfaceFeatureBuilder(static, coarse, gf.filled, column_fine, cfg.refine_factor)
                table = builder.station_table(stations, self.fine_grid)
                surface_model, selection, oof = select_surface_model(
                    table, builder.names, cfg.validation.cv_folds, cfg.validation.future_days_fraction)
                surface_model.save(Path(cfg.model_dir) / SURFACE_MODEL_FILE)
                surface = builder.predict_map(surface_model)
            best = selection["candidates"][selection["selected"]]
            best["acceptance"] = acceptance(best["overall"], cfg.validation.min_r2, cfg.validation.max_rmse_ugm3)
            future = selection["future_days_monitored_stations"]["model"]
            future["acceptance"] = acceptance(future["overall"], cfg.validation.min_r2, cfg.validation.max_rmse_ugm3)
            report["surface_model"] = selection
            if truth is not None:  # best achievable score given the synthetic station noise
                ceiling = sample_at_stations(truth["surface"], stations, self.fine_grid)
                report["validation_noise_ceiling_synthetic"] = regression_metrics(ceiling["no2"], ceiling["predicted"])
            if export_outputs:
                oof.to_csv(out_dir / "validation_unseen_station_predictions.csv", index=False)
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

    def _apply_pretrained_surface(self, cfg, static, coarse, gf, column_fine, stations, report, out_dir, export_outputs):
        """Map with a surface model trained elsewhere (e.g. ``ml_engine.national``); local stations, if given,
        become an independent test of this period (their locations may also appear in the training set)."""
        model = SurfaceModel.load(cfg.surface_model_path)
        builder = SurfaceFeatureBuilder(static, coarse, gf.filled, column_fine, cfg.refine_factor)
        missing = [f for f in model.input_features if f not in builder.names]
        if missing:
            raise ValueError(f"Pre-trained surface model needs inputs this run lacks: {missing}")
        with self._timer("surface_model"):
            surface = builder.predict_map(model)
        info = {"source": str(cfg.surface_model_path), "model": model.name}
        if stations is not None and len(stations):
            table = builder.station_table(stations, self.fine_grid)
            table["pred"] = model.predict(table)
            summary = summarize_predictions(table, pred_col="pred")
            summary["acceptance"] = acceptance(summary["overall"], cfg.validation.min_r2, cfg.validation.max_rmse_ugm3)
            info["independent_test"] = summary
            if export_outputs:
                table[["station_id", "lat", "lon", "date", "no2", "pred"]].to_csv(
                    out_dir / "independent_test_station_predictions.csv", index=False)
        report["pretrained_surface_model"] = info
        return surface

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
    class _T:
        def __init__(self, sink, key):
            self.sink, self.key = sink, key

        def __enter__(self):
            self.t0 = time.perf_counter()

        def __exit__(self, *exc):
            self.sink[self.key] = round(time.perf_counter() - self.t0, 2)

    def _timer(self, key: str):
        return self._T(self.timings, key)
