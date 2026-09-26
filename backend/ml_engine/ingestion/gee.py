"""Google Earth Engine ingestion: Sentinel-5P NO2, ERA5-Land meteorology, BLH, NASADEM and Sentinel-2.

All rasters are pulled with ``ee.data.computePixels`` directly onto the engine's own grids, so the
coarse (S5P / meteorology) and fine (static covariates) arrays nest exactly.

Dataset notes (verified against the Earth Engine catalog):
* ``COPERNICUS/S5P/OFFL/L3_NO2`` carries no ``qa_value`` band - pixels with QA < 0.75 are removed during
  Google's harpconvert L3 gridding. If a ``qa_value`` band is present (e.g. a custom L2 import) it is used;
  otherwise the per-pixel ``cloud_fraction`` band is thresholded as the additional cloud screen.
* ``ECMWF/ERA5_LAND/DAILY_AGGR`` has no ``boundary_layer_height`` band. BLH is taken from GEOS-CF
  (``NASA/GEOS-CF/v1/rpl/tavg1hr`` band ``ZPBL``) averaged around the S5P overpass; dates outside
  GEOS-CF coverage use a bulk parametrisation (see ``estimate_blh``).
"""

from __future__ import annotations

import logging
import time
from datetime import timedelta

import numpy as np
import pandas as pd
import xarray as xr

from ..config import COLUMN_SCALE, PipelineConfig
from ..grid import GridSpec, fill_nan_nearest

log = logging.getLogger(__name__)

S5P_COLLECTION = "COPERNICUS/S5P/OFFL/L3_NO2"
S5P_BAND = "tropospheric_NO2_column_number_density"
S5P_NATIVE_SCALE_M = 1113.2
ERA5_COLLECTION = "ECMWF/ERA5_LAND/DAILY_AGGR"
ERA5_BANDS = {
    "u10": "u_component_of_wind_10m",
    "v10": "v_component_of_wind_10m",
    "sp": "surface_pressure",
    "t2m": "temperature_2m",
}
ERA5_BLH_BAND = "boundary_layer_height"
GEOSCF_COLLECTION = "NASA/GEOS-CF/v1/rpl/tavg1hr"
GEOSCF_BLH_BAND = "ZPBL"
DEM_IMAGE = "NASA/NASADEM_HGT/001"
S2_COLLECTION = "COPERNICUS/S2_SR_HARMONIZED"

S2_MAX_SCENES = 40
VIIRS_COLLECTION = "NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG"
GHSL_BUILT_COLLECTION = "JRC/GHSL/P2023A/GHS_BUILT_S"
GHSL_POP_COLLECTION = "JRC/GHSL/P2023A/GHS_POP"
ACTIVITY_BANDS = ("night_lights", "ghsl_built", "population")

NODATA = -9999.0
DAYS_PER_REQUEST = 20


def initialize(project: str | None = None, service_account: str | None = None, key_file: str | None = None) -> None:
    """Initialise Earth Engine with a service account or the user's stored OAuth credentials."""
    import ee
    import truststore

    # Verify TLS against the OS certificate store, so networks with HTTPS inspection (corporate proxies,
    # antivirus) whose root CA is trusted by Windows/macOS but absent from certifi still work.
    truststore.inject_into_ssl()

    if service_account and key_file:
        credentials = ee.ServiceAccountCredentials(service_account, key_file)
        ee.Initialize(credentials, project=project)
        return
    try:
        ee.Initialize(project=project)
    except Exception:  # no stored credentials yet -> interactive browser flow, then retry
        ee.Authenticate()
        ee.Initialize(project=project)


def _ee():
    import ee

    return ee


def _grid(grid: GridSpec) -> dict:
    return {
        "dimensions": {"width": grid.width, "height": grid.height},
        "affineTransform": {
            "scaleX": grid.res,
            "shearX": 0.0,
            "translateX": grid.west,
            "shearY": 0.0,
            "scaleY": -grid.res,
            "translateY": grid.north,
        },
        "crsCode": grid.crs,
    }


# Deterministic "request too heavy" errors: retrying the same request cannot succeed, splitting it can.
_TOO_BIG_MARKERS = ("memory limit", "computation timed out", "request size", "too many pixels")
MIN_STRIP_ROWS = 4


def _compute_pixels(image, grid: GridSpec, band_names: list[str], retries: int = 4) -> np.ndarray:
    """Fetch a multi-band image as float32 (bands, rows, cols) with masked pixels -> NaN.

    Requests that exceed Earth Engine's per-request memory/time limits are split into horizontal strips
    recursively; transient errors (rate limits, backend hiccups) are retried with backoff.
    """
    ee = _ee()
    expression = image.unmask(NODATA, sameFootprint=False).toFloat()
    out = _compute_strip(ee, expression, grid, band_names, retries)
    out[np.isclose(out, NODATA)] = np.nan
    return out


def _compute_strip(ee, expression, grid: GridSpec, band_names: list[str], retries: int) -> np.ndarray:
    request = {"expression": expression, "fileFormat": "NUMPY_NDARRAY", "grid": _grid(grid)}
    for attempt in range(retries):
        try:
            arr = ee.data.computePixels(request)
            return np.stack([np.asarray(arr[name], dtype=np.float32) for name in band_names])
        except ee.EEException as exc:
            msg = str(exc).lower()
            if any(m in msg for m in _TOO_BIG_MARKERS):
                if grid.height < 2 * MIN_STRIP_ROWS:
                    raise
                top_rows = grid.height // 2
                log.info("Request too large for Earth Engine (%s); splitting %d rows into %d + %d",
                         exc, grid.height, top_rows, grid.height - top_rows)
                top = GridSpec(grid.west, grid.north, grid.res, grid.width, top_rows, grid.crs)
                bottom = GridSpec(grid.west, grid.north - top_rows * grid.res, grid.res, grid.width,
                                  grid.height - top_rows, grid.crs)
                return np.concatenate([_compute_strip(ee, expression, top, band_names, retries),
                                       _compute_strip(ee, expression, bottom, band_names, retries)], axis=1)
            if attempt == retries - 1:
                raise
            wait = 2 ** (attempt + 1)
            log.warning("computePixels failed (%s); retrying in %ss", exc, wait)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def _to_grid_mean(image, grid: GridSpec, native_scale_m: float | None = None, max_pixels: int = 1024):
    """Area-average an image onto ``grid`` (reduceResolution) rather than nearest-neighbour sampling."""
    ee = _ee()
    if native_scale_m is not None:
        image = image.setDefaultProjection(crs="EPSG:4326", scale=native_scale_m)
    return image.reduceResolution(reducer=ee.Reducer.mean(), maxPixels=max_pixels).reproject(
        crs=grid.crs, crsTransform=grid.crs_transform
    )


def _collection_bands(collection_id: str, start: str, end: str) -> list[str]:
    ee = _ee()
    first = ee.ImageCollection(collection_id).filterDate(start, end).limit(1)
    if first.size().getInfo() == 0:
        return []
    return ee.Image(first.first()).bandNames().getInfo()


def _empty(band: str):
    ee = _ee()
    return ee.Image.constant(0).toFloat().updateMask(ee.Image.constant(0)).rename(band)


# --------------------------------------------------------------------------------------------------
# Sentinel-5P
# --------------------------------------------------------------------------------------------------
def s5p_daily_image(day: pd.Timestamp, grid: GridSpec, cfg: PipelineConfig, has_qa: bool, name: str):
    """Daily S5P tropospheric NO2 composite on ``grid``, with cloudy / low-QA pixels masked."""
    ee = _ee()
    region = ee.Geometry.Rectangle(list(grid.bbox), proj=grid.crs, geodesic=False)
    col = (
        ee.ImageCollection(S5P_COLLECTION)
        .filterDate(day.strftime("%Y-%m-%d"), (day + timedelta(days=1)).strftime("%Y-%m-%d"))
        .filterBounds(region)
    )

    def screen(img):
        if has_qa:
            ok = img.select("qa_value").gt(cfg.qa_threshold)
        else:
            ok = img.select("cloud_fraction").lt(cfg.max_cloud_fraction)
        return img.select(S5P_BAND).updateMask(ok)

    composite = ee.Image(ee.Algorithms.If(col.size().gt(0), col.map(screen).mean(), _empty(S5P_BAND)))
    composite = composite.rename(S5P_BAND)
    coarse = _to_grid_mean(composite, grid, S5P_NATIVE_SCALE_M)
    # Fraction of native 1.1 km bins inside each coarse cell that survived screening.
    valid_frac = _to_grid_mean(composite.mask().rename("f"), grid, S5P_NATIVE_SCALE_M)
    return coarse.updateMask(valid_frac.gte(cfg.min_valid_subpixel_fraction)).rename(name)


def fetch_s5p(dates: pd.DatetimeIndex, grid: GridSpec, cfg: PipelineConfig) -> np.ndarray:
    ee = _ee()
    bands = _collection_bands(S5P_COLLECTION, str(dates[0].date()), str((dates[-1] + timedelta(days=1)).date()))
    if not bands:
        raise RuntimeError(f"No {S5P_COLLECTION} images between {dates[0].date()} and {dates[-1].date()}")
    has_qa = "qa_value" in bands
    log.info("S5P screening: %s", f"qa_value > {cfg.qa_threshold}" if has_qa else f"cloud_fraction < {cfg.max_cloud_fraction} (L3 is pre-filtered at QA>=0.75)")
    out = []
    for chunk in _chunks(dates, DAYS_PER_REQUEST):
        names = [f"d{i}" for i in range(len(chunk))]
        image = ee.Image.cat(*[s5p_daily_image(d, grid, cfg, has_qa, n) for d, n in zip(chunk, names)])
        out.append(_compute_pixels(image, grid, names))
        log.info("S5P fetched %s .. %s", chunk[0].date(), chunk[-1].date())
    return np.concatenate(out, axis=0) * COLUMN_SCALE


# --------------------------------------------------------------------------------------------------
# Meteorology
# --------------------------------------------------------------------------------------------------
def fetch_era5(dates: pd.DatetimeIndex, grid: GridSpec) -> dict[str, np.ndarray]:
    ee = _ee()
    keys = list(ERA5_BANDS)
    result = {k: [] for k in keys}
    for chunk in _chunks(dates, DAYS_PER_REQUEST):
        images, names = [], []
        for i, day in enumerate(chunk):
            col = ee.ImageCollection(ERA5_COLLECTION).filterDate(
                day.strftime("%Y-%m-%d"), (day + timedelta(days=1)).strftime("%Y-%m-%d")
            )
            day_names = [f"{k}_{i}" for k in keys]
            empty = ee.Image.cat(*[_empty(n) for n in day_names])
            img = ee.Image(
                ee.Algorithms.If(
                    col.size().gt(0),
                    ee.Image(col.first()).select(list(ERA5_BANDS.values()), day_names),
                    empty,
                )
            )
            images.append(img.resample("bilinear"))
            names.extend(day_names)
        arr = _compute_pixels(ee.Image.cat(*images).reproject(crs=grid.crs, crsTransform=grid.crs_transform), grid, names)
        arr = arr.reshape(len(chunk), len(keys), *grid.shape)
        for j, k in enumerate(keys):
            result[k].append(arr[:, j])
        log.info("ERA5-Land fetched %s .. %s", chunk[0].date(), chunk[-1].date())
    stacked = {k: np.concatenate(v, axis=0) for k, v in result.items()}
    # ERA5-Land is a land-only reanalysis: coastal/sea cells are masked, so fill them from the nearest land cell.
    for k, arr in stacked.items():
        for t in range(arr.shape[0]):
            arr[t] = fill_nan_nearest(arr[t])
    return stacked


def overpass_utc_hour(lon: float) -> float:
    """S5P crosses the equator at ~13:30 local solar time."""
    return (13.5 - lon / 15.0) % 24


def fetch_blh(dates: pd.DatetimeIndex, grid: GridSpec) -> np.ndarray:
    """Boundary layer height (m) around the S5P overpass; NaN where no source covers the date."""
    ee = _ee()
    era_bands = _collection_bands(ERA5_COLLECTION, str(dates[0].date()), str((dates[-1] + timedelta(days=1)).date()))
    if ERA5_BLH_BAND in era_bands:
        source, band, scale_hours = ERA5_COLLECTION, ERA5_BLH_BAND, None
    else:
        source, band = GEOSCF_COLLECTION, GEOSCF_BLH_BAND
        scale_hours = overpass_utc_hour((grid.west + grid.east) / 2.0)
    log.info("BLH source: %s/%s", source, band)

    out = []
    for chunk in _chunks(dates, DAYS_PER_REQUEST):
        names = [f"blh{i}" for i in range(len(chunk))]
        images = []
        for day, name in zip(chunk, names):
            if scale_hours is None:
                start, end = day, day + timedelta(days=1)
            else:
                centre = day + timedelta(hours=scale_hours)
                start, end = centre - timedelta(hours=2), centre + timedelta(hours=2)
            col = ee.ImageCollection(source).filterDate(start.isoformat(), end.isoformat()).select(band)
            img = ee.Image(ee.Algorithms.If(col.size().gt(0), col.mean().rename(name), _empty(name)))
            images.append(img.resample("bilinear"))
        arr = _compute_pixels(ee.Image.cat(*images).reproject(crs=grid.crs, crsTransform=grid.crs_transform), grid, names)
        out.append(arr)
    return np.concatenate(out, axis=0)


def estimate_blh(t2m_k: np.ndarray, u10: np.ndarray, v10: np.ndarray) -> np.ndarray:
    """Bulk midday mixed-layer height (m) for dates without reanalysis BLH.

    Convective growth scales with surface heating (proxied by 2 m temperature) and mechanical mixing
    with wind speed; the coefficients reproduce typical tropical-coastal midday values (600-1800 m).
    """
    ws = np.hypot(u10, v10)
    t_c = t2m_k - 273.15
    return np.clip(250.0 + 35.0 * np.clip(t_c, 0, 45) + 90.0 * ws, 200.0, 3000.0).astype(np.float32)


# --------------------------------------------------------------------------------------------------
# Static fine-scale covariates
# --------------------------------------------------------------------------------------------------
def fetch_static(grid: GridSpec, end_date: str) -> dict[str, np.ndarray]:
    """Elevation, slope, NDVI, built-up fraction and activity proxies at the fine grid resolution."""
    ee = _ee()
    region = ee.Geometry.Rectangle(list(grid.bbox), proj=grid.crs, geodesic=False)

    dem = ee.Image(DEM_IMAGE).select("elevation")
    slope = ee.Terrain.slope(dem).rename("slope")
    terrain = _to_grid_mean(dem.rename("elevation").addBands(slope), grid)
    terrain_arr = _compute_pixels(terrain, grid, ["elevation", "slope"])

    end = pd.Timestamp(end_date)
    s2 = (
        ee.ImageCollection(S2_COLLECTION)
        .filterBounds(region)
        .filterDate((end - timedelta(days=365)).strftime("%Y-%m-%d"), (end + timedelta(days=1)).strftime("%Y-%m-%d"))
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
        .select(["B4", "B8", "B11", "SCL"])
        # The clearest scenes are plenty for a land-cover composite and keep the median cheap.
        .sort("CLOUDY_PIXEL_PERCENTAGE")
        .limit(S2_MAX_SCENES)
    )
    if s2.size().getInfo() == 0:
        raise RuntimeError("No Sentinel-2 scenes with <20% cloud in the 12 months before end_date")

    def indices(img):
        scl = img.select("SCL")
        clear = scl.neq(3).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10)).And(scl.neq(11))
        ndvi = img.normalizedDifference(["B8", "B4"]).rename("ndvi")
        ndbi = img.normalizedDifference(["B11", "B8"]).rename("ndbi")
        built = ndbi.gt(0).And(ndvi.lt(0.3)).rename("built_up").toFloat()
        return ndvi.addBands(built).updateMask(clear)

    s2_proj = ee.Image(s2.first()).select("B4").projection()
    composite = s2.map(indices).median().setDefaultProjection(s2_proj)
    # Two-stage area mean 10 m -> 50 m -> 250 m (25 inputs per output each) instead of one 625-pixel
    # reduction, which exceeds per-request memory. built_up becomes a built-up *fraction*.
    s2_50m = composite.reduceResolution(reducer=ee.Reducer.mean(), maxPixels=64).reproject(s2_proj.atScale(50))
    s2_fine = s2_50m.reduceResolution(reducer=ee.Reducer.mean(), maxPixels=64).reproject(
        crs=grid.crs, crsTransform=grid.crs_transform
    )
    s2_arr = _compute_pixels(s2_fine, grid, ["ndvi", "built_up"])

    activity_arr = _compute_pixels(_activity_image(grid, end), grid, list(ACTIVITY_BANDS))

    names = ["elevation", "slope", "ndvi", "built_up", *ACTIVITY_BANDS]
    arr = np.concatenate([terrain_arr, s2_arr, activity_arr], axis=0)
    static = {n: fill_nan_nearest(arr[i]) for i, n in enumerate(names)}
    for n in ACTIVITY_BANDS:  # zero radiance / population / built surface over the sea
        static[n] = np.nan_to_num(static[n], nan=0.0)
    static["elevation"] = np.nan_to_num(static["elevation"], nan=0.0)  # NASADEM is void over open sea
    static["slope"] = np.nan_to_num(static["slope"], nan=0.0)
    return static


def _activity_image(grid: GridSpec, end: pd.Timestamp):
    """Human-activity proxies for NOx emissions (land-use-regression style covariates).

    * night_lights: VIIRS monthly night-time radiance, median of the 12 months before ``end`` -
      tracks traffic, commerce and industry intensity.
    * ghsl_built: GHSL built-up surface fraction (0-1) for the nearest 5-year epoch.
    * population: GHSL residents per 100 m cell for the same epoch.
    """
    ee = _ee()
    start = (end - timedelta(days=365)).strftime("%Y-%m-%d")
    stop = (end + timedelta(days=1)).strftime("%Y-%m-%d")
    lights_col = ee.ImageCollection(VIIRS_COLLECTION).filterDate(start, stop).select("avg_rad")
    lights = lights_col.median().setDefaultProjection(ee.Image(lights_col.first()).projection())

    epoch = min(2030, 5 * (end.year // 5))
    def ghsl(collection_id: str, band: str):
        img = ee.ImageCollection(collection_id).filter(ee.Filter.calendarRange(epoch, epoch, "year")).first()
        return ee.Image(img).select(band)

    built = ghsl(GHSL_BUILT_COLLECTION, "built_surface").divide(10_000)  # m^2 per 100 m cell -> fraction
    pop = ghsl(GHSL_POP_COLLECTION, "population_count")
    return ee.Image.cat(
        _to_grid_mean(lights.rename("night_lights"), grid),
        _to_grid_mean(built.rename("ghsl_built"), grid),
        _to_grid_mean(pop.rename("population"), grid),
    )


# --------------------------------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------------------------------
def load_gee(cfg: PipelineConfig, coarse: GridSpec, fine: GridSpec) -> tuple[xr.Dataset, xr.Dataset]:
    """Return (coarse daily dataset, fine static dataset) for the configured AOI and period."""
    dates = pd.date_range(cfg.start_date, cfg.end_date, freq="D")
    no2 = fetch_s5p(dates, coarse, cfg)
    met = fetch_era5(dates, coarse)
    blh = fetch_blh(dates, coarse)
    missing = ~np.isfinite(blh)
    if missing.any():
        log.warning("BLH unavailable for %.0f%% of cells/days; using bulk parametrisation there", 100 * missing.mean())
        blh = np.where(missing, estimate_blh(met["t2m"], met["u10"], met["v10"]), blh)

    coords = {"time": dates, "y": coarse.y, "x": coarse.x}
    dims = ("time", "y", "x")
    coarse_ds = xr.Dataset(
        {
            "no2": (dims, no2.astype(np.float32), {"units": "umol m-2", "long_name": "S5P tropospheric NO2 column"}),
            "u10": (dims, met["u10"], {"units": "m s-1"}),
            "v10": (dims, met["v10"], {"units": "m s-1"}),
            "sp": (dims, met["sp"], {"units": "Pa"}),
            "t2m": (dims, met["t2m"], {"units": "K"}),
            "blh": (dims, blh.astype(np.float32), {"units": "m"}),
        },
        coords=coords,
        attrs={"crs": coarse.crs, "source": "gee", "grid": str(coarse.to_dict())},
    )
    static = fetch_static(fine, cfg.end_date)
    static_ds = xr.Dataset(
        {k: (("y", "x"), v.astype(np.float32)) for k, v in static.items()},
        coords={"y": fine.y, "x": fine.x},
        attrs={"crs": fine.crs, "source": "gee", "grid": str(fine.to_dict())},
    )
    return coarse_ds, static_ds


def _chunks(dates: pd.DatetimeIndex, size: int):
    for i in range(0, len(dates), size):
        yield dates[i : i + size]
