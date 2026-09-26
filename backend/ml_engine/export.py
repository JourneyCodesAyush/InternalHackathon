"""Stage 5 - export of rasters / vectors for Supabase storage and the web API (all EPSG:4326)."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import rioxarray  # noqa: F401  (registers the .rio accessor)
import xarray as xr
from rasterio import features

from .config import DEFAULT_CRS
from .grid import GridSpec

# SRS section 3.3 NO2 regulatory scale (ug/m^3).
HAZARD_BANDS = [
    {"code": 1, "category": "Normal", "color": "#2e7d32", "min": 0.0, "max": 40.0,
     "advice": "Air quality is satisfactory."},
    {"code": 2, "category": "Moderate", "color": "#f9a825", "min": 40.0, "max": 80.0,
     "advice": "Acceptable; sensitive individuals take caution."},
    {"code": 3, "category": "Unhealthy", "color": "#ef6c00", "min": 80.0, "max": 180.0,
     "advice": "Prolonged exposure causes respiratory discomfort."},
    {"code": 4, "category": "Hazardous", "color": "#c62828", "min": 180.0, "max": math.inf,
     "advice": "Trigger industrial/traffic reduction alerts."},
]


def _prepare(da: xr.DataArray, crs: str = DEFAULT_CRS) -> xr.DataArray:
    da = da.rio.set_spatial_dims(x_dim="x", y_dim="y", inplace=False)
    da = da.rio.write_crs(crs, inplace=False)
    return da.rio.write_nodata(np.nan, encoded=False, inplace=False) if np.issubdtype(da.dtype, np.floating) else da


def to_geotiff(da: xr.DataArray, path: str | Path, crs: str = DEFAULT_CRS, cog: bool = True) -> Path:
    """Write a 2-D or 3-D (band = time / horizon) DataArray as a (Cloud-Optimised) GeoTIFF."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    da = _prepare(da, crs)
    extra = [d for d in da.dims if d not in ("y", "x")]
    band_names = None
    if len(extra) > 1:
        raise ValueError(f"GeoTIFF export supports at most one non-spatial dim, got {extra}")
    if extra:
        band_names = [str(v)[:19] for v in da[extra[0]].values]
        da = da.rename({extra[0]: "band"}).transpose("band", "y", "x")
        da = da.assign_coords(band=np.arange(1, da.sizes["band"] + 1))
    kwargs = {"driver": "COG", "compress": "DEFLATE"} if cog else {"compress": "DEFLATE", "tiled": True}
    if band_names:
        da.attrs["long_name"] = tuple(band_names)
    da.attrs = {k: (v if isinstance(v, (str, int, float, tuple)) else str(v)) for k, v in da.attrs.items()}
    da.astype("float32" if np.issubdtype(da.dtype, np.floating) else da.dtype).rio.to_raster(path, **kwargs)
    return path


def to_netcdf(obj: xr.Dataset | xr.DataArray, path: str | Path, crs: str = DEFAULT_CRS) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    ds = obj.to_dataset() if isinstance(obj, xr.DataArray) else obj
    ds = ds.rio.write_crs(crs, inplace=False)
    encoding = {v: {"zlib": True, "complevel": 4} for v in ds.data_vars if ds[v].dtype.kind in "fiu"}
    ds.to_netcdf(path, engine="h5netcdf", encoding=encoding)
    return path


def to_csv_points(da: xr.DataArray, path: str | Path, stride: int = 1) -> Path:
    """Flatten a 2-D raster into lon, lat, value rows (downscaled point matrix, FR-6.2)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sub = da.isel(y=slice(None, None, stride), x=slice(None, None, stride))
    lon, lat = np.meshgrid(sub.x.values, sub.y.values)
    df = pd.DataFrame({"lon": lon.ravel(), "lat": lat.ravel(), da.name or "value": sub.values.ravel()})
    df.dropna().to_csv(path, index=False, float_format="%.6g")
    return path


def raster_to_geojson_points(da: xr.DataArray, stride: int = 2, value_name: str = "no2", precision: int = 3) -> dict:
    """Point FeatureCollection for heatmap layers (one feature per ``stride``-th cell)."""
    sub = da.isel(y=slice(None, None, stride), x=slice(None, None, stride))
    lon, lat = np.meshgrid(sub.x.values, sub.y.values)
    vals = sub.values
    feats = [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(float(x), 5), round(float(y), 5)]},
         "properties": {value_name: round(float(v), precision), "band": hazard_band(float(v))["category"]}}
        for x, y, v in zip(lon.ravel(), lat.ravel(), vals.ravel()) if np.isfinite(v)
    ]
    return {"type": "FeatureCollection", "features": feats}


def hazard_band(value: float) -> dict:
    for band in HAZARD_BANDS:
        if band["min"] <= value < band["max"]:
            return band
    return HAZARD_BANDS[0]


def classify_hazard(da: xr.DataArray) -> xr.DataArray:
    codes = np.zeros(da.shape, dtype=np.uint8)
    vals = da.values
    for band in HAZARD_BANDS:
        codes[(vals >= band["min"]) & (vals < band["max"])] = band["code"]
    return xr.DataArray(codes, coords=da.coords, dims=da.dims, name="hazard_band")


def hazard_polygons_geojson(surface_2d: xr.DataArray, grid: GridSpec) -> dict:
    """Dissolved hazard-band polygons (Normal / Moderate / Unhealthy / Hazardous) for map overlays."""
    codes = classify_hazard(surface_2d).values
    by_code = {b["code"]: b for b in HAZARD_BANDS}
    feats = []
    for geom, code in features.shapes(codes, mask=codes > 0, transform=grid.transform):
        band = by_code[int(code)]
        feats.append({"type": "Feature", "geometry": geom,
                      "properties": {"category": band["category"], "color": band["color"], "advice": band["advice"],
                                     "min_ugm3": band["min"], "max_ugm3": None if math.isinf(band["max"]) else band["max"]}})
    return {"type": "FeatureCollection", "features": feats}


def wind_vectors_geojson(u: np.ndarray, v: np.ndarray, grid: GridSpec, stride: int = 10, arrow_seconds: float = 900.0) -> dict:
    """LineString arrows (tail -> head) scaled to ``arrow_seconds`` of travel, for FR-2.3 flow overlays."""
    feats = []
    lat0 = math.radians((grid.north + grid.south) / 2)
    for r in range(stride // 2, grid.height, stride):
        for c in range(stride // 2, grid.width, stride):
            uu, vv = float(u[r, c]), float(v[r, c])
            x0, y0 = float(grid.x[c]), float(grid.y[r])
            x1 = x0 + uu * arrow_seconds / (111_320.0 * math.cos(lat0))
            y1 = y0 + vv * arrow_seconds / 110_574.0
            feats.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[round(x0, 5), round(y0, 5)], [round(x1, 5), round(y1, 5)]]},
                "properties": {"speed_ms": round(math.hypot(uu, vv), 2),
                               "heading_deg": round((math.degrees(math.atan2(uu, vv)) + 360) % 360, 1)},
            })
    return {"type": "FeatureCollection", "features": feats}


def write_geojson(obj: dict, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")))
    return path


def write_json(obj: dict, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=_json_default))
    return path


def _json_default(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, (pd.Timestamp, np.datetime64)):
        return str(o)
    if isinstance(o, Path):
        return str(o)
    raise TypeError(f"not JSON serialisable: {type(o)}")
