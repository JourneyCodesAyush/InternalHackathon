"""Regular lat/lon grid definitions and coarse <-> fine resampling helpers."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import xarray as xr
from rasterio.transform import Affine
from scipy import ndimage

from .config import DEFAULT_CRS


@dataclass(frozen=True)
class GridSpec:
    """North-up regular grid. Pixel (row 0, col 0) is the north-west corner."""

    west: float
    north: float
    res: float
    width: int
    height: int
    crs: str = DEFAULT_CRS

    @classmethod
    def from_bbox(cls, bbox: tuple[float, float, float, float], res: float, crs: str = DEFAULT_CRS) -> "GridSpec":
        west, south, east, north = bbox
        if east <= west or north <= south:
            raise ValueError(f"Invalid bbox {bbox}: expected (west, south, east, north)")
        width = max(1, math.ceil(round((east - west) / res, 9)))
        height = max(1, math.ceil(round((north - south) / res, 9)))
        return cls(west=west, north=north, res=res, width=width, height=height, crs=crs)

    @property
    def east(self) -> float:
        return self.west + self.width * self.res

    @property
    def south(self) -> float:
        return self.north - self.height * self.res

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return (self.west, self.south, self.east, self.north)

    @property
    def shape(self) -> tuple[int, int]:
        return (self.height, self.width)

    @property
    def x(self) -> np.ndarray:
        """Pixel-centre longitudes."""
        return self.west + self.res * (np.arange(self.width) + 0.5)

    @property
    def y(self) -> np.ndarray:
        """Pixel-centre latitudes (descending, north first)."""
        return self.north - self.res * (np.arange(self.height) + 0.5)

    @property
    def transform(self) -> Affine:
        return Affine(self.res, 0.0, self.west, 0.0, -self.res, self.north)

    @property
    def crs_transform(self) -> list[float]:
        """Earth Engine style [scaleX, shearX, translateX, shearY, scaleY, translateY]."""
        return [self.res, 0.0, self.west, 0.0, -self.res, self.north]

    def refine(self, factor: int) -> "GridSpec":
        return GridSpec(self.west, self.north, self.res / factor, self.width * factor, self.height * factor, self.crs)

    def pixel_size_m(self) -> tuple[float, float]:
        """Approximate (dx, dy) in metres at the grid's central latitude."""
        lat0 = math.radians((self.north + self.south) / 2.0)
        dy = self.res * 110_574.0
        dx = self.res * 111_320.0 * math.cos(lat0)
        return dx, dy

    def lonlat_mesh(self) -> tuple[np.ndarray, np.ndarray]:
        return np.meshgrid(self.x, self.y)

    def index_of(self, lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Row/col of the pixel containing each point plus an in-bounds mask."""
        col = np.floor((np.asarray(lon) - self.west) / self.res).astype(int)
        row = np.floor((self.north - np.asarray(lat)) / self.res).astype(int)
        inside = (row >= 0) & (row < self.height) & (col >= 0) & (col < self.width)
        return row, col, inside

    def empty(self, name: str, times=None, attrs: dict | None = None) -> xr.DataArray:
        if times is None:
            data = np.full(self.shape, np.nan, dtype="float32")
            return xr.DataArray(data, coords={"y": self.y, "x": self.x}, dims=("y", "x"), name=name, attrs=attrs or {})
        data = np.full((len(times), *self.shape), np.nan, dtype="float32")
        return xr.DataArray(
            data, coords={"time": times, "y": self.y, "x": self.x}, dims=("time", "y", "x"), name=name, attrs=attrs or {}
        )

    def to_dict(self) -> dict:
        return {"west": self.west, "north": self.north, "res": self.res, "width": self.width, "height": self.height, "crs": self.crs}


def block_mean(arr: np.ndarray, factor: int) -> np.ndarray:
    """NaN-aware mean over non-overlapping factor x factor blocks on the last two axes."""
    *lead, h, w = arr.shape
    if h % factor or w % factor:
        raise ValueError(f"Shape {(h, w)} is not divisible by factor {factor}")
    blocks = arr.reshape(*lead, h // factor, factor, w // factor, factor)
    with np.errstate(invalid="ignore"), _quiet_nanmean():
        return np.nanmean(blocks, axis=(-3, -1))


def upsample_bilinear(arr: np.ndarray, factor: int) -> np.ndarray:
    """Bilinear upsampling of cell-centred coarse values onto the nested fine grid (last two axes).

    Edge cells are extrapolated with nearest values so the output never grows NaN borders.
    """
    *lead, h, w = arr.shape
    fine_r = (np.arange(h * factor) + 0.5) / factor - 0.5
    fine_c = (np.arange(w * factor) + 0.5) / factor - 0.5
    rr, cc = np.meshgrid(fine_r, fine_c, indexing="ij")
    flat = arr.reshape(-1, h, w)
    out = np.empty((flat.shape[0], h * factor, w * factor), dtype=np.float32)
    for i, layer in enumerate(flat):
        out[i] = ndimage.map_coordinates(layer.astype(np.float64), [rr, cc], order=1, mode="nearest")
    return out.reshape(*lead, h * factor, w * factor)


def fill_nan_nearest(arr: np.ndarray) -> np.ndarray:
    """Replace NaNs in a 2-D array with the value of the nearest valid pixel."""
    mask = ~np.isfinite(arr)
    if not mask.any():
        return arr
    if mask.all():
        return arr
    _, (ri, ci) = ndimage.distance_transform_edt(mask, return_indices=True)
    return arr[ri, ci]


def nan_neighbourhood_mean(arr: np.ndarray, size: int, exclude_centre: bool = True) -> np.ndarray:
    """NaN-aware moving-window mean (2-D), optionally excluding the centre pixel."""
    valid = np.isfinite(arr).astype(np.float64)
    vals = np.where(np.isfinite(arr), arr, 0.0).astype(np.float64)
    kernel = np.ones((size, size))
    if exclude_centre:
        kernel[size // 2, size // 2] = 0.0
    s = ndimage.convolve(vals, kernel, mode="constant", cval=0.0)
    n = ndimage.convolve(valid, kernel, mode="constant", cval=0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = s / n
    out[n == 0] = np.nan
    return out


class _quiet_nanmean:
    """Suppress 'Mean of empty slice' warnings, which are expected for fully cloudy blocks."""

    def __enter__(self):
        import warnings

        self._ctx = warnings.catch_warnings()
        self._ctx.__enter__()
        warnings.simplefilter("ignore", category=RuntimeWarning)

    def __exit__(self, *exc):
        return self._ctx.__exit__(*exc)
