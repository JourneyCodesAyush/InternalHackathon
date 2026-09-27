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

S5P_COLLECTION = "COPERNICUS/S5P/{product}/L3_NO2"  # product: OFFL (reprocessed) or NRTI (near real time)
S5P_BAND = "tropospheric_NO2_column_number_density"
S5P_CO_COLLECTION = "COPERNICUS/S5P/OFFL/L3_CO"
S5P_CO_BAND = "CO_column_number_density"
CO_SCALE = 1e3  # mol/m^2 -> mmol/m^2
S5P_NATIVE_SCALE_M = 1113.2
ERA5_COLLECTION = "ECMWF/ERA5_LAND/DAILY_AGGR"
ERA5_HOURLY_COLLECTION = "ECMWF/ERA5_LAND/HOURLY"
OVERPASS_WINDOW_H = 1.5  # hours either side of the S5P overpass averaged for meteorology
ERA5_BANDS = {
    "u10": "u_component_of_wind_10m",
    "v10": "v_component_of_wind_10m",
    "sp": "surface_pressure",
    "t2m": "temperature_2m",
}
# Extra drivers of NO2 lifetime and mixing: sunlight (photolysis / OH), rain (washout), surface heating.
# key -> (hourly band, scale to units), (daily-aggregate band, scale to the same units)
ERA5_FLUX_BANDS = {
    "ssrd": (("surface_solar_radiation_downwards_hourly", 1 / 3600), ("surface_solar_radiation_downwards_sum", 1 / 86400)),  # W m-2
    "tp": (("total_precipitation_hourly", 1000.0), ("total_precipitation_sum", 1000.0 / 24)),  # mm h-1
    "sshf": (("surface_sensible_heat_flux_hourly", 1 / 3600), ("surface_sensible_heat_flux_sum", 1 / 86400)),  # W m-2
}
GPPD_COLLECTION = "WRI/GPPD/power_plants"
# GRIP4 global roads (community catalog). Road type GP_RTP: 1 highway, 2 primary, 3 secondary, 4 tertiary, 5 local.
GRIP4_COLLECTION = "projects/sat-io/open-datasets/GRIP4/South-East-Asia"  # covers the Indian subcontinent
ROAD_TYPE_WEIGHTS = [0.0, 3.0, 2.0, 1.5, 1.0, 0.3]  # index = GP_RTP; heavier traffic -> more NOx
ROAD_PAINT_SCALE_M = 30
COMBUSTION_FUELS = ("Coal", "Gas", "Oil", "Biomass", "Waste", "Petcoke", "Cogeneration")
POWER_PLANT_SIGMA_KM = 3.0
ERA5_BLH_BAND = "boundary_layer_height"
GEOSCF_COLLECTION = "NASA/GEOS-CF/v1/rpl/tavg1hr"
GEOSCF_BLH_BAND = "ZPBL"
DEM_IMAGE = "NASA/NASADEM_HGT/001"
S2_COLLECTION = "COPERNICUS/S2_SR_HARMONIZED"

S2_SCENES_PER_TILE = 8  # clearest complete scenes kept from EACH Sentinel-2 tile touching the area
S2_MAX_NODATA_PCT = 10  # skip swath-edge scenes that are mostly empty
S2_MAX_GAP_FRACTION = 0.02  # warn if more of the area than this has no Sentinel-2 data
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
def s5p_daily_image(day: pd.Timestamp, grid: GridSpec, cfg: PipelineConfig, name: str, collection_id: str,
                    band: str, mask_fn=None):
    """Daily S5P composite of ``band`` on ``grid``; ``mask_fn(img)`` returns the per-pixel keep mask.

    A coarse cell is kept only if at least ``cfg.min_valid_subpixel_fraction`` of its native 1.1 km bins
    survive, so partly-cloudy cells are not represented by a few edge pixels.
    """
    ee = _ee()
    region = ee.Geometry.Rectangle(list(grid.bbox), proj=grid.crs, geodesic=False)
    col = (
        ee.ImageCollection(collection_id)
        .filterDate(day.strftime("%Y-%m-%d"), (day + timedelta(days=1)).strftime("%Y-%m-%d"))
        .filterBounds(region)
    )

    def screen(img):
        out = img.select(band)
        return out.updateMask(mask_fn(img)) if mask_fn else out

    composite = ee.Image(ee.Algorithms.If(col.size().gt(0), col.map(screen).mean(), _empty(band))).rename(band)
    coarse = _to_grid_mean(composite, grid, S5P_NATIVE_SCALE_M)
    valid_frac = _to_grid_mean(composite.mask().rename("f"), grid, S5P_NATIVE_SCALE_M)
    return coarse.updateMask(valid_frac.gte(cfg.min_valid_subpixel_fraction)).rename(name)


def _fetch_s5p_band(dates, grid, cfg, collection_id, band, mask_fn, label) -> np.ndarray:
    ee = _ee()
    out = []
    for chunk in _chunks(dates, DAYS_PER_REQUEST):
        names = [f"d{i}" for i in range(len(chunk))]
        image = ee.Image.cat(*[s5p_daily_image(d, grid, cfg, n, collection_id, band, mask_fn)
                               for d, n in zip(chunk, names)])
        out.append(_compute_pixels(image, grid, names))
        log.info("%s fetched %s .. %s", label, chunk[0].date(), chunk[-1].date())
    return np.concatenate(out, axis=0)


def fetch_s5p(dates: pd.DatetimeIndex, grid: GridSpec, cfg: PipelineConfig) -> np.ndarray:
    """Tropospheric NO2 (umol/m^2), cloud-screened.

    L3 collections carry no qa_value band - QA >= 0.75 is applied during Google's L3 gridding - so the
    per-pixel ``cloud_fraction`` is thresholded on top. A ``qa_value`` band, if present, is used instead.
    """
    collection_id = S5P_COLLECTION.format(product=cfg.s5p_product)
    bands = _collection_bands(collection_id, str(dates[0].date()), str((dates[-1] + timedelta(days=1)).date()))
    if not bands:
        raise RuntimeError(f"No {collection_id} images between {dates[0].date()} and {dates[-1].date()}")
    if "qa_value" in bands:
        log.info("S5P %s screening: qa_value > %s", cfg.s5p_product, cfg.qa_threshold)
        mask_fn = lambda img: img.select("qa_value").gt(cfg.qa_threshold)
    else:
        log.info("S5P %s screening: cloud_fraction < %s (L3 is pre-filtered at QA>=0.75)",
                 cfg.s5p_product, cfg.max_cloud_fraction)
        mask_fn = lambda img: img.select("cloud_fraction").lt(cfg.max_cloud_fraction)
    return _fetch_s5p_band(dates, grid, cfg, collection_id, S5P_BAND, mask_fn, f"S5P NO2 {cfg.s5p_product}") * COLUMN_SCALE


def fetch_co(dates: pd.DatetimeIndex, grid: GridSpec, cfg: PipelineConfig) -> np.ndarray:
    """S5P total CO column (mmol/m^2), gap-free.

    CO is co-emitted with NOx by combustion but lives for weeks, so it marks polluted air masses sitting
    over the city. The L3 product is already QA-filtered; remaining gaps are filled spatially (nearest
    cell) and, for fully missing days, by linear interpolation in time.
    """
    arr = _fetch_s5p_band(dates, grid, cfg, S5P_CO_COLLECTION, S5P_CO_BAND, None, "S5P CO") * CO_SCALE
    for t in range(arr.shape[0]):
        if np.isfinite(arr[t]).any():
            arr[t] = fill_nan_nearest(arr[t])
    flat = pd.DataFrame(arr.reshape(arr.shape[0], -1)).interpolate(limit_direction="both")
    if flat.isna().all().all():
        log.warning("No S5P CO retrievals in the period; CO feature disabled")
        return np.full(arr.shape, np.nan, dtype=np.float32)
    return flat.to_numpy(np.float32).reshape(arr.shape)


# --------------------------------------------------------------------------------------------------
# Meteorology
# --------------------------------------------------------------------------------------------------
def fetch_era5(dates: pd.DatetimeIndex, grid: GridSpec) -> dict[str, np.ndarray]:
    """Wind, pressure and temperature averaged over the S5P overpass window (ERA5-Land hourly), so the
    meteorology matches the atmosphere the satellite sampled. Days not yet in the hourly collection
    fall back to the daily aggregate."""
    ee = _ee()
    keys = [*ERA5_BANDS, *ERA5_FLUX_BANDS]
    hourly_bands = [*ERA5_BANDS.values(), *(h[0] for h, _ in ERA5_FLUX_BANDS.values())]
    daily_bands = [*ERA5_BANDS.values(), *(d[0] for _, d in ERA5_FLUX_BANDS.values())]
    hourly_scale = ee.Image.constant([1.0] * len(ERA5_BANDS) + [h[1] for h, _ in ERA5_FLUX_BANDS.values()])
    daily_scale = ee.Image.constant([1.0] * len(ERA5_BANDS) + [d[1] for _, d in ERA5_FLUX_BANDS.values()])
    result = {k: [] for k in keys}
    utc_hour = overpass_utc_hour((grid.west + grid.east) / 2.0)
    for chunk in _chunks(dates, DAYS_PER_REQUEST):
        images, names = [], []
        for i, day in enumerate(chunk):
            centre = day + timedelta(hours=utc_hour)
            hourly = ee.ImageCollection(ERA5_HOURLY_COLLECTION).filterDate(
                (centre - timedelta(hours=OVERPASS_WINDOW_H)).isoformat(),
                (centre + timedelta(hours=OVERPASS_WINDOW_H)).isoformat(),
            )
            daily = ee.ImageCollection(ERA5_COLLECTION).filterDate(
                day.strftime("%Y-%m-%d"), (day + timedelta(days=1)).strftime("%Y-%m-%d")
            )
            day_names = [f"{k}_{i}" for k in keys]
            empty = ee.Image.cat(*[_empty(n) for n in day_names])
            img = ee.Image(
                ee.Algorithms.If(
                    hourly.size().gt(0),
                    hourly.select(hourly_bands).mean().multiply(hourly_scale).rename(day_names),
                    ee.Algorithms.If(daily.size().gt(0),
                                     ee.Image(daily.first()).select(daily_bands).multiply(daily_scale).rename(day_names),
                                     empty),
                )
            )
            images.append(img.resample("bilinear"))
            names.extend(day_names)
        arr = _compute_pixels(ee.Image.cat(*images).reproject(crs=grid.crs, crsTransform=grid.crs_transform), grid, names)
        arr = arr.reshape(len(chunk), len(keys), *grid.shape)
        for j, k in enumerate(keys):
            result[k].append(arr[:, j])
        log.info("ERA5-Land (overpass hours) fetched %s .. %s", chunk[0].date(), chunk[-1].date())
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
    candidates = (
        ee.ImageCollection(S2_COLLECTION)
        .filterBounds(region)
        .filterDate((end - timedelta(days=365)).strftime("%Y-%m-%d"), (end + timedelta(days=1)).strftime("%Y-%m-%d"))
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
        .filter(ee.Filter.lt("NODATA_PIXEL_PERCENTAGE", S2_MAX_NODATA_PCT))
    )
    # Pick the clearest scenes per MGRS tile: a single global "clearest N" can come entirely from a
    # neighbouring tile that only clips the area, leaving most of it without data.
    tiles = candidates.aggregate_array("MGRS_TILE").distinct().getInfo()
    if not tiles:
        raise RuntimeError("No complete Sentinel-2 scenes with <20% cloud in the 12 months before end_date")
    s2 = ee.ImageCollection([])
    for tile in tiles:
        s2 = s2.merge(candidates.filter(ee.Filter.eq("MGRS_TILE", tile)).sort("CLOUDY_PIXEL_PERCENTAGE")
                      .limit(S2_SCENES_PER_TILE))
    s2 = s2.select(["B4", "B8", "B11", "SCL"])
    log.info("Sentinel-2 composite from %d tiles: %s", len(tiles), ", ".join(sorted(tiles)))

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

    activity_arr = _compute_pixels(_activity_image(grid, end).addBands(road_density_image(grid)), grid,
                                   [*ACTIVITY_BANDS, "road_density"])

    gaps = float(np.isnan(s2_arr[0]).mean())
    if gaps > S2_MAX_GAP_FRACTION:
        log.warning("Sentinel-2 composite leaves %.0f%% of the area without data; vegetation / built-up there "
                    "are filled from the nearest pixel", 100 * gaps)
    names = ["elevation", "slope", "ndvi", "built_up", *ACTIVITY_BANDS, "road_density"]
    arr = np.concatenate([terrain_arr, s2_arr, activity_arr], axis=0)
    static = {n: fill_nan_nearest(arr[i]) for i, n in enumerate(names)}
    for n in (*ACTIVITY_BANDS, "road_density"):  # zero radiance / population / built surface / roads over the sea
        static[n] = np.nan_to_num(static[n], nan=0.0)
    static["elevation"] = np.nan_to_num(static["elevation"], nan=0.0)  # NASADEM is void over open sea
    static["slope"] = np.nan_to_num(static["slope"], nan=0.0)
    return static


def road_density_image(grid: GridSpec):
    """Traffic-weighted road density on ``grid`` from GRIP4: roads are painted 1 px wide at 30 m with a
    weight per road class, then area-averaged - an absolute density (comparable between cities), unlike
    a per-area normalised raster."""
    ee = _ee()
    pad = 0.05
    region = ee.Geometry.Rectangle([grid.west - pad, grid.south - pad, grid.east + pad, grid.north + pad])
    weights = ee.List(ROAD_TYPE_WEIGHTS)
    roads = ee.FeatureCollection(GRIP4_COLLECTION).filterBounds(region).map(
        lambda f: f.set("w", weights.get(ee.Number(f.get("GP_RTP")).int())))
    painted = ee.Image.constant(0).toFloat().paint(roads, "w", 1).rename("road_density")
    painted = painted.reproject(crs="EPSG:4326", scale=ROAD_PAINT_SCALE_M)
    return painted.reduceResolution(reducer=ee.Reducer.mean(), maxPixels=1024).reproject(
        crs=grid.crs, crsTransform=grid.crs_transform)


def fetch_power_plants(grid: GridSpec) -> np.ndarray:
    """Capacity-weighted combustion power-plant influence (MW-weighted Gaussian kernel, sigma 3 km, log1p).

    Plants within ~50 km of the AOI are included so sources just outside the box still count.
    """
    ee = _ee()
    pad = 0.5
    region = ee.Geometry.Rectangle([grid.west - pad, grid.south - pad, grid.east + pad, grid.north + pad])
    fc = ee.FeatureCollection(GPPD_COLLECTION).filterBounds(region).filter(
        ee.Filter.inList("fuel1", list(COMBUSTION_FUELS)))
    plants = [f["properties"] for f in fc.getInfo()["features"]]
    lon, lat = grid.lonlat_mesh()
    kx = 111.32 * np.cos(np.radians((grid.north + grid.south) / 2))
    field = np.zeros(grid.shape)
    for p in plants:
        d2 = ((lon - p["longitude"]) * kx) ** 2 + ((lat - p["latitude"]) * 110.57) ** 2
        field += float(p.get("capacitymw") or 0.0) * np.exp(-d2 / (2 * POWER_PLANT_SIGMA_KM**2))
    log.info("Power plants: %d combustion plants within %.1f deg of the AOI", len(plants), pad)
    return np.log1p(field).astype(np.float32)


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
def load_gee(cfg: PipelineConfig, coarse: GridSpec, fine: GridSpec,
             no2: np.ndarray | None = None, with_static: bool = True):
    """Return (coarse daily dataset, fine static dataset) for the configured AOI and period.

    ``no2`` (time, y, x in umol/m^2) replaces the Sentinel-5P download, e.g. with local GeoTIFFs.
    """
    dates = pd.date_range(cfg.start_date, cfg.end_date, freq="D")
    no2 = fetch_s5p(dates, coarse, cfg) if no2 is None else no2
    met = fetch_era5(dates, coarse)
    blh = fetch_blh(dates, coarse)
    co = fetch_co(dates, coarse, cfg)
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
            "co": (dims, co, {"units": "mmol m-2", "long_name": "S5P total CO column"}),
            "ssrd": (dims, met["ssrd"], {"units": "W m-2", "long_name": "surface solar radiation downwards"}),
            "tp": (dims, met["tp"], {"units": "mm h-1", "long_name": "total precipitation"}),
            "sshf": (dims, met["sshf"], {"units": "W m-2", "long_name": "surface sensible heat flux"}),
        },
        coords=coords,
        attrs={"crs": coarse.crs, "source": "gee", "grid": str(coarse.to_dict())},
    )
    return (coarse_ds, load_static(cfg, fine)) if with_static else coarse_ds


def load_static(cfg: PipelineConfig, fine: GridSpec) -> xr.Dataset:
    """Fine-grid land use, terrain, activity and power-plant layers for the area."""
    static = fetch_static(fine, cfg.end_date)
    static["power_plants"] = fetch_power_plants(fine)
    return xr.Dataset(
        {k: (("y", "x"), v.astype(np.float32)) for k, v in static.items()},
        coords={"y": fine.y, "x": fine.x},
        attrs={"crs": fine.crs, "source": "gee", "grid": str(fine.to_dict())},
    )


def _chunks(dates: pd.DatetimeIndex, size: int):
    for i in range(0, len(dates), size):
        yield dates[i : i + size]
