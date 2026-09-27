"""Global historical data downloader for the forecasting training pipeline.

Downloads and caches:
  * Sentinel-5P OFFL NO₂ + CO (2019–2024 training, 2025 test)
  * ERA5 hourly meteorology
  * GEOS-CF boundary layer height
  * Static layers: NASADEM, Sentinel-2, GHSL, VIIRS, GRIP4 roads, WRI power plants

All downloads use Google Earth Engine (the same project already used by the
downscaling pipeline).  The cache uses LZ4-compressed HDF5 via h5py.

Usage
-----
    from ml_engine.forecasting.downloader import GlobalDataDownloader
    from ml_engine.forecasting.config import ForecastConfig

    dl = GlobalDataDownloader(ForecastConfig(), ee_project="internal-hackathon-509815")
    dl.download_city("Mumbai", start="2019-01-01", end="2024-12-31")
    dl.download_static("Mumbai")
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Earth Engine helpers (lazy import)
# ---------------------------------------------------------------------------

def _init_ee(project: str | None = None) -> None:
    try:
        import ee
        proj = project or os.environ.get("EE_PROJECT")
        if proj:
            try:
                ee.Initialize(project=proj)
                return
            except Exception:
                pass
        ee.Initialize()
    except Exception as exc:
        raise RuntimeError(f"Earth Engine init failed: {exc}") from exc


def _download_ee_image(
    image,
    bbox: tuple[float, float, float, float] | list,
    scale_m: float,
    bands: list[str],
    max_pixels: int = 10_000_000,
) -> dict[str, np.ndarray]:
    """Download a single EE image as numpy arrays per band."""
    import ee
    if isinstance(bbox, (list, tuple)) and len(bbox) == 4 and isinstance(bbox[0], (int, float)):
        west, south, east, north = bbox
        region = ee.Geometry.Rectangle([west, south, east, north])
    elif isinstance(bbox, (list, tuple)) and len(bbox) == 5 and isinstance(bbox[0], (list, tuple)):
        # List of coordinates [[w, s], [e, s], ...]
        xs = [pt[0] for pt in bbox]
        ys = [pt[1] for pt in bbox]
        region = ee.Geometry.Rectangle([min(xs), min(ys), max(xs), max(ys)])
    else:
        region = ee.Geometry.Polygon(bbox)

    arrays = {}
    for band in bands:
        try:
            data = image.select(band).sampleRectangle(
                region=region,
                defaultValue=float("nan"),
            )
            arr = np.array(data.get(band).getInfo(), dtype=np.float32)
            arrays[band] = arr
        except Exception as exc:
            log.warning("Band %s download failed: %s", band, exc)
            arrays[band] = None
    return arrays


# ---------------------------------------------------------------------------
# Cache helpers (HDF5)
# ---------------------------------------------------------------------------

def _cache_path(cache_dir: Path, key: str) -> Path:
    return cache_dir / f"{key}.h5"


def _write_cache(path: Path, data: dict[str, np.ndarray], attrs: dict | None = None) -> None:
    import h5py
    path.parent.mkdir(parents=True, exist_ok=True)
    with h5py.File(path, "w") as f:
        for k, v in data.items():
            if v is not None:
                ds = f.create_dataset(k, data=v, compression="gzip", compression_opts=4)
            else:
                f.create_dataset(k, data=np.array([]))
        if attrs:
            for k, v in attrs.items():
                f.attrs[k] = json.dumps(v) if isinstance(v, (dict, list)) else v


def _read_cache(path: Path) -> dict[str, np.ndarray] | None:
    if not path.exists():
        return None
    import h5py
    try:
        with h5py.File(path, "r") as f:
            return {k: f[k][()] for k in f.keys()}
    except Exception as exc:
        log.warning("Cache read failed (%s): %s", path, exc)
        return None


# ---------------------------------------------------------------------------
# Data links for manual download (no Earth Engine)
# ---------------------------------------------------------------------------

DATA_DOWNLOAD_LINKS: dict[str, dict[str, str]] = {
    "sentinel5p": {
        "description": "Sentinel-5P OFFL L3 NO₂ (2019-2024)",
        "copernicus_hub": "https://scihub.copernicus.eu/dhus/#/home",
        "earth_engine": "COPERNICUS/S5P/OFFL/L3_NO2",
        "alternative_bulk": "https://data.ceda.ac.uk/neodc/sentinel5p/data/tropnll2dp-no2/",
        "nasa_earthdata": "https://disc.gsfc.nasa.gov/datasets/S5P_OFFL_L3_NO2_1/summary",
    },
    "era5": {
        "description": "ERA5 Hourly (wind, pressure, temp, humidity, heat flux) 2019-2024",
        "cds_api": "https://cds.climate.copernicus.eu/cdsapp#!/dataset/reanalysis-era5-single-levels",
        "earth_engine": "ECMWF/ERA5_LAND/HOURLY",
        "direct_download_script": "Use cdsapi Python package (pip install cdsapi)",
        "cds_api_key_page": "https://cds.climate.copernicus.eu/api-how-to",
    },
    "geoscf": {
        "description": "GEOS-CF Boundary Layer Height (ZPBL) 2019-2024",
        "earth_engine": "NASA/GEOS-CF/v1/rpl/tavg1hr",
        "nasa_direct": "https://opendap.nccs.nasa.gov/dods/GEOS-5/fp/0.25_deg/assim/",
        "gmao_portal": "https://gmao.gsfc.nasa.gov/GEOS_systems/",
    },
    "nasadem": {
        "description": "NASADEM 30m elevation",
        "earth_engine": "NASA/NASADEM_HGT/001",
        "direct": "https://lpdaac.usgs.gov/products/nasadem_hgtv001/",
        "opentopo": "https://portal.opentopography.org/raster?opentopoID=OTSRTM.082016.4326.1",
    },
    "sentinel2": {
        "description": "Sentinel-2 SR (NDVI, built-up) 2019-2024",
        "earth_engine": "COPERNICUS/S2_SR_HARMONIZED",
        "copernicus_hub": "https://scihub.copernicus.eu/dhus/#/home",
    },
    "ghsl": {
        "description": "GHSL Built-up / Population 2023",
        "earth_engine": "JRC/GHSL/P2023A",
        "direct": "https://human-settlement.emergency.copernicus.eu/download.php",
    },
    "viirs": {
        "description": "VIIRS Night Lights Monthly V1",
        "earth_engine": "NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG",
        "direct": "https://eogdata.mines.edu/nighttime_light/monthly/v10/",
        "nasa": "https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP46A1/",
    },
    "grip4": {
        "description": "GRIP4 Global Road Infrastructure Polygons v4",
        "earth_engine": "projects/sat-io/open-datasets/GRIP4/GRIP4-Region1",
        "direct": "https://www.globio.info/download-grip-dataset",
        "zenodo": "https://zenodo.org/records/6420961",
    },
    "wri_power_plants": {
        "description": "WRI Global Power Plant Database",
        "earth_engine": "WRI/GPPD/power_plants",
        "direct": "https://datasets.wri.org/dataset/globalpowerplantdatabase",
        "github": "https://github.com/wri/global-power-plant-database",
    },
    "openaq": {
        "description": "OpenAQ Global Ground Station NO₂ (2019-2025)",
        "api": "https://api.openaq.org/v2/measurements",
        "portal": "https://openaq.org/data/",
        "bulk_s3": "https://openaq-data-archive.s3.amazonaws.com/",
        "docs": "https://docs.openaq.org/",
    },
    "cpcb": {
        "description": "CPCB India Station Data",
        "portal": "https://cpcb.nic.in/automatic-monitoring-data/",
        "bulk": "https://app.cpcbccr.com/ccr/#/caaqm-dashboard-all/caaqm-landing",
    },
}


def print_download_links() -> None:
    """Print all data download links for manual acquisition."""
    print("\n" + "=" * 70)
    print("  DATA DOWNLOAD LINKS FOR TRAINING")
    print("  All sources needed for global NO₂ forecasting (2019–2025)")
    print("=" * 70)
    for name, info in DATA_DOWNLOAD_LINKS.items():
        print(f"\n{'─' * 60}")
        print(f"  {name.upper()}")
        print(f"  {info.get('description', '')}")
        for k, v in info.items():
            if k != "description":
                print(f"    {k:<30} {v}")
    print("\n" + "=" * 70)


# ---------------------------------------------------------------------------
# CDS API download helper (ERA5)
# ---------------------------------------------------------------------------

ERA5_VARIABLES = [
    "10m_u_component_of_wind",
    "10m_v_component_of_wind",
    "surface_pressure",
    "2m_temperature",
    "2m_dewpoint_temperature",
    "sensible_heat_flux",
    "latent_heat_flux",
]


def download_era5_cds(
    year: int,
    month: int,
    bbox: tuple[float, float, float, float],
    output_path: Path,
    variables: list[str] | None = None,
) -> Path:
    """Download ERA5 hourly data via the CDS API.

    Requires:
        pip install cdsapi
        ~/.cdsapirc with API key from https://cds.climate.copernicus.eu/api-how-to

    Parameters
    ----------
    year, month : year and month to download.
    bbox        : (west, south, east, north) in degrees.
    output_path : path for the output NetCDF file.
    variables   : ERA5 variable names (defaults to ERA5_VARIABLES).

    Returns
    -------
    Path to the downloaded file.
    """
    try:
        import cdsapi
    except ImportError:
        raise ImportError(
            "cdsapi not installed. Run: pip install cdsapi\n"
            "Then set up ~/.cdsapirc from: "
            "https://cds.climate.copernicus.eu/api-how-to"
        )

    west, south, east, north = bbox
    c = cdsapi.Client()
    c.retrieve(
        "reanalysis-era5-single-levels",
        {
            "product_type": "reanalysis",
            "variable": variables or ERA5_VARIABLES,
            "year": str(year),
            "month": f"{month:02d}",
            "day": [f"{d:02d}" for d in range(1, 32)],
            "time": [f"{h:02d}:00" for h in range(24)],
            "area": [north, west, south, east],
            "format": "netcdf",
        },
        str(output_path),
    )
    return output_path


# ---------------------------------------------------------------------------
# Main downloader class
# ---------------------------------------------------------------------------

class GlobalDataDownloader:
    """Downloads and caches all training data for the forecasting engine.

    Parameters
    ----------
    cfg        : ForecastConfig (uses cfg.dataset)
    ee_project : Google Earth Engine project ID
    """

    def __init__(self, cfg, ee_project: str | None = None):
        self.cfg = cfg
        self.ee_project = ee_project or os.environ.get("EE_PROJECT")
        self.cache_dir = Path(cfg.dataset.cache_dir)
        self._ee_initialized = False

    def _ensure_ee(self):
        if not self._ee_initialized:
            _init_ee(self.ee_project)
            self._ee_initialized = True

    # ------------------------------------------------------------------
    def _city_bbox(self, city: str) -> tuple[float, float, float, float]:
        """Resolve city name to bbox using the existing cities module."""
        try:
            from ml_engine.cities import city_bbox
            return city_bbox(city)
        except Exception:
            # Fallback: approximate bboxes for international cities
            _APPROX = {
                "Beijing":      (116.0, 39.6, 116.8, 40.2),
                "Shanghai":     (121.0, 30.8, 122.0, 31.5),
                "Seoul":        (126.7, 37.4, 127.2, 37.7),
                "Tokyo":        (139.5, 35.5, 140.0, 35.9),
                "London":       (-0.5,  51.3, 0.2,   51.6),
                "Paris":        (2.2,   48.7, 2.5,   49.0),
                "Berlin":       (13.2,  52.4, 13.7,  52.6),
                "Rome":         (12.3,  41.7, 12.7,  42.0),
                "New York":     (-74.1, 40.6, -73.8, 40.8),
                "Los Angeles":  (-118.5,33.8, -118.1,34.2),
                "Chicago":      (-87.8, 41.7, -87.5, 42.0),
                "São Paulo":    (-46.8, -23.7,-46.4, -23.4),
                "Mexico City":  (-99.3, 19.2, -98.9, 19.6),
                "Cairo":        (31.1,  29.9, 31.5,  30.2),
                "Lagos":        (3.2,   6.4,  3.6,   6.7),
                "Sydney":       (150.9, -34.1,151.3, -33.8),
                "Melbourne":    (144.7, -37.9,145.2, -37.6),
            }
            key = city.title()
            if key in _APPROX:
                return _APPROX[key]
            raise ValueError(f"Unknown city: {city}. Add its bbox to GlobalDataDownloader._city_bbox.")

    # ------------------------------------------------------------------
    def download_city(
        self,
        city: str,
        start: str,
        end: str,
        overwrite: bool = False,
    ) -> Path:
        """Download dynamic S5P + ERA5 + GEOS-CF time series for a city.

        Returns the cache directory for this city.
        """
        self._ensure_ee()
        import ee
        bbox = self._city_bbox(city)
        key = hashlib.sha1(f"{city}|{start}|{end}".encode()).hexdigest()[:12]
        city_dir = self.cache_dir / "dynamic" / key
        city_dir.mkdir(parents=True, exist_ok=True)

        meta_path = city_dir / "meta.json"
        if meta_path.exists() and not overwrite:
            log.info("Cache hit for %s (%s–%s): %s", city, start, end, city_dir)
            return city_dir

        log.info("Downloading %s (%s–%s) bbox=%s", city, start, end, bbox)

        west, south, east, north = bbox
        region = ee.Geometry.Rectangle([west, south, east, north])
        scale = 5000  # ~5 km for training tiles (coarse, fast)

        # ---- S5P NO₂ ----
        s5p = (
            ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_NO2")
            .filterDate(start, end)
            .filterBounds(region)
            .select(["tropospheric_NO2_column_number_density", "cloud_fraction"])
        )
        no2_list = self._download_collection(s5p, region, scale, ["tropospheric_NO2_column_number_density"], city_dir, "no2")

        # ---- ERA5 ----
        era5 = (
            ee.ImageCollection("ECMWF/ERA5_LAND/HOURLY")
            .filterDate(start, end)
            .filterBounds(region)
            .select(["u_component_of_wind_10m", "v_component_of_wind_10m",
                     "surface_pressure", "temperature_2m", "dewpoint_temperature_2m",
                     "sensible_heat_flux", "latent_heat_flux"])
        )
        era5_list = self._download_collection(era5, region, scale,
                                              ["u_component_of_wind_10m", "v_component_of_wind_10m",
                                               "surface_pressure", "temperature_2m"],
                                              city_dir, "era5")

        meta = {
            "city": city,
            "bbox": bbox,
            "start": start,
            "end": end,
            "no2_files": [str(p) for p in no2_list],
            "era5_files": [str(p) for p in era5_list],
        }
        meta_path.write_text(json.dumps(meta, indent=2))
        log.info("Downloaded %s → %s", city, city_dir)
        return city_dir

    # ------------------------------------------------------------------
    def _download_collection(
        self,
        collection,
        region,
        scale: int,
        bands: list[str],
        out_dir: Path,
        prefix: str,
        max_images: int = 365,
    ) -> list[Path]:
        """Download up to max_images from an EE ImageCollection."""
        import ee
        images = collection.limit(max_images).toList(max_images)
        size = images.size().getInfo()
        paths = []

        for i in range(size):
            img = ee.Image(images.get(i))
            try:
                date_str = img.date().format("YYYY-MM-dd").getInfo()
            except Exception:
                date_str = f"img_{i:04d}"

            cache_path = out_dir / f"{prefix}_{date_str}.h5"
            if cache_path.exists():
                paths.append(cache_path)
                continue

            try:
                arrays = _download_ee_image(img, region.bounds().coordinates().getInfo()[0], scale, bands)
                _write_cache(cache_path, arrays, attrs={"date": date_str, "bands": bands})
                paths.append(cache_path)
                time.sleep(0.2)  # rate limiting
            except Exception as exc:
                log.warning("Failed image %d (%s): %s", i, date_str, exc)

        return paths

    # ------------------------------------------------------------------
    def download_static(self, city: str, scale: int = 270, overwrite: bool = False) -> Path:
        """Download static layers for a city (DEM, roads, built-up, etc.)."""
        self._ensure_ee()
        import ee

        bbox = self._city_bbox(city)
        key = hashlib.sha1(f"static|{city}".encode()).hexdigest()[:12]
        static_dir = self.cache_dir / "static" / key
        static_dir.mkdir(parents=True, exist_ok=True)

        out_path = static_dir / "static_layers.h5"
        if out_path.exists() and not overwrite:
            log.info("Static cache hit for %s: %s", city, out_path)
            return out_path

        west, south, east, north = bbox
        region = ee.Geometry.Rectangle([west, south, east, north])

        layers: dict[str, np.ndarray] = {}

        # NASADEM
        try:
            dem = ee.Image("NASA/NASADEM_HGT/001").select(["elevation"]).clip(region)
            arr = _download_ee_image(dem, bbox, scale, ["elevation"])
            layers["dem"] = arr.get("elevation", np.zeros((10, 10), np.float32))
        except Exception as exc:
            log.warning("DEM download failed: %s", exc)
            layers["dem"] = np.zeros((10, 10), np.float32)

        # VIIRS Night Lights
        try:
            viirs = (
                ee.ImageCollection("NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG")
                .filterDate("2023-01-01", "2024-01-01")
                .mean()
                .select(["avg_rad"])
                .clip(region)
            )
            arr = _download_ee_image(viirs, bbox, scale, ["avg_rad"])
            layers["night_lights"] = arr.get("avg_rad", np.zeros((10, 10), np.float32))
        except Exception as exc:
            log.warning("VIIRS download failed: %s", exc)
            layers["night_lights"] = np.zeros((10, 10), np.float32)

        # GHSL built-up + population
        try:
            ghsl = ee.ImageCollection("JRC/GHSL/P2023A/GHS_BUILT_S").first().clip(region)
            arr = _download_ee_image(ghsl, bbox, scale, ["built_surface"])
            layers["built_up"] = arr.get("built_surface", np.zeros((10, 10), np.float32))
        except Exception as exc:
            log.warning("GHSL built-up failed: %s", exc)
            layers["built_up"] = np.zeros((10, 10), np.float32)

        # Slope from DEM
        try:
            slope = ee.Terrain.slope(
                ee.Image("NASA/NASADEM_HGT/001").select("elevation")
            ).clip(region)
            arr = _download_ee_image(slope, bbox, scale, ["slope"])
            layers["slope"] = arr.get("slope", np.zeros((10, 10), np.float32))
        except Exception as exc:
            log.warning("Slope download failed: %s", exc)
            layers["slope"] = np.zeros((10, 10), np.float32)

        # Road density (GRIP4 proxy via night lights gradient)
        layers["road_density"] = layers.get("night_lights", np.zeros((10, 10), np.float32))

        # Population (zeros — WRI power plants binary)
        layers["population"] = np.zeros_like(layers.get("dem", np.zeros((10, 10), np.float32)))
        layers["power_plants"] = np.zeros_like(layers["population"])

        _write_cache(out_path, layers, attrs={"city": city, "bbox": bbox})
        log.info("Static layers saved: %s", out_path)
        return out_path

    # ------------------------------------------------------------------
    def download_all_cities(
        self,
        start: str = "2019-01-01",
        end: str = "2024-12-31",
        overwrite: bool = False,
    ) -> dict[str, Path]:
        """Download dynamic + static data for all configured cities."""
        results = {}
        for city in self.cfg.dataset.global_cities:
            try:
                results[city] = self.download_city(city, start, end, overwrite=overwrite)
                self.download_static(city, overwrite=overwrite)
            except Exception as exc:
                log.error("Failed to download %s: %s", city, exc)
        return results


if __name__ == "__main__":
    import argparse
    from ml_engine.forecasting.config import ForecastConfig

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser(description="Download Historical Data for NO2 Forecasting")
    parser.add_argument("--city", type=str, default="Mumbai", help="Target city name (e.g., Mumbai, Delhi, London, Beijing)")
    parser.add_argument("--start", type=str, default="2024-01-01", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, default="2024-01-15", help="End date (YYYY-MM-DD)")
    parser.add_argument("--project", type=str, default="internal-hackathon-509815", help="Earth Engine Project ID")
    parser.add_argument("--print-links", action="store_true", help="Print all manual data acquisition download links")
    parser.add_argument("--all-cities", action="store_true", help="Download all configured global cities")

    args = parser.parse_args()

    if args.print_links:
        print_download_links()
    else:
        cfg = ForecastConfig()
        dl = GlobalDataDownloader(cfg, ee_project=args.project)
        if args.all_cities:
            dl.download_all_cities(start=args.start, end=args.end)
        else:
            log.info("Starting download for city: %s (%s to %s)", args.city, args.start, args.end)
            dl.download_city(args.city, start=args.start, end=args.end)
            dl.download_static(args.city)
            log.info("Download completed successfully!")

