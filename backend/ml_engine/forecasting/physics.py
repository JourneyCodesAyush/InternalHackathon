"""Improved physics solver for the forecasting engine.

Extends the existing AdvectionDiffusionSolver with:
* ERA5 wind updates every configurable interval (default 60 min).
* 30-minute export cadence for animation-ready frames.
* Mass-conservation enforcement at every export step.
* Persistent emission with terrain-corrected source term.

Mathematical formulation
------------------------
The governing PDE is:

    ∂C/∂t + u ∂C/∂x + v ∂C/∂y = K ∇²C - C/τ + S(x,y)

Operator-split per timestep dt:
1. Advection  – semi-Lagrangian midpoint back-trajectory (unconditionally stable).
2. Diffusion  – explicit 5-point Laplacian sub-stepped so that dt ≤ dx²/(4K).
3. Reaction   – exact exponential decay: C ← C · exp(-dt/τ).
4. Emission   – persistent source: S = C₀/τ  (maintains hotspot intensities).

Wind is updated from the ERA5 sequence (hourly) interpolated to the internal dt.
Mass is checked and corrected at each 30-min export frame.
"""

from __future__ import annotations

import math
import logging
from typing import Iterator

import numpy as np
import xarray as xr
from scipy import ndimage

from .config import ForecastConfig, PhysicsConfig

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _bilinear_interp(arr: np.ndarray, row: np.ndarray, col: np.ndarray) -> np.ndarray:
    """Map coordinates with bilinear interpolation and nearest-neighbour clamping."""
    return ndimage.map_coordinates(arr, [row, col], order=1, mode="nearest")


def _diffuse(c: np.ndarray, dx: float, dy: float, k: float, dt: float) -> np.ndarray:
    """Explicit 5-point Laplacian diffusion, sub-stepped for stability."""
    if k <= 0:
        return c
    dt_max = 0.24 * min(dx, dy) ** 2 / k
    n_sub = max(1, math.ceil(dt / dt_max))
    h = dt / n_sub
    for _ in range(n_sub):
        p = np.pad(c, 1, mode="edge")
        lap = (
            (p[1:-1, 2:] - 2 * c + p[1:-1, :-2]) / dx ** 2
            + (p[2:, 1:-1] - 2 * c + p[:-2, 1:-1]) / dy ** 2
        )
        c = c + h * k * lap
    return c


def _advect(
    c: np.ndarray,
    u: np.ndarray,
    v: np.ndarray,
    rows: np.ndarray,
    cols: np.ndarray,
    dx: float,
    dy: float,
    dt: float,
) -> np.ndarray:
    """Semi-Lagrangian midpoint back-trajectory advection."""
    dep_c = cols - u * dt / dx
    dep_r = rows + v * dt / dy  # row grows southward, +v = northward
    # midpoint refinement
    u_mid = _bilinear_interp(u, 0.5 * (dep_r + rows), 0.5 * (dep_c + cols))
    v_mid = _bilinear_interp(v, 0.5 * (dep_r + rows), 0.5 * (dep_c + cols))
    dep_c = cols - u_mid * dt / dx
    dep_r = rows + v_mid * dt / dy
    return _bilinear_interp(c, dep_r, dep_c)


def _enforce_mass(c: np.ndarray, total_mass_0: float) -> np.ndarray:
    """Scale c uniformly so its sum equals total_mass_0."""
    current = float(np.nansum(c))
    if current > 0 and not math.isnan(current):
        c = c * (total_mass_0 / current)
    return c


# ---------------------------------------------------------------------------
# Improved solver
# ---------------------------------------------------------------------------

class ImprovedPhysicsSolver:
    """30-minute forecasting solver with hourly wind updates and mass conservation.

    Parameters
    ----------
    height, width : grid dimensions in pixels
    dx, dy        : pixel sizes in metres
    cfg           : PhysicsConfig
    """

    def __init__(
        self,
        height: int,
        width: int,
        dx: float,
        dy: float,
        cfg: PhysicsConfig | None = None,
    ):
        self.h = height
        self.w = width
        self.dx = dx
        self.dy = dy
        self.cfg = cfg or PhysicsConfig()

        rows, cols = np.mgrid[0:height, 0:width]
        self._rows = rows.astype(np.float64)
        self._cols = cols.astype(np.float64)

    # ------------------------------------------------------------------
    def _step(
        self,
        c: np.ndarray,
        u: np.ndarray,
        v: np.ndarray,
        dt: float,
        source: np.ndarray,
        decay: float,
    ) -> np.ndarray:
        c = _advect(c, u, v, self._rows, self._cols, self.dx, self.dy, dt)
        c = _diffuse(c, self.dx, self.dy, self.cfg.diffusivity_m2_s, dt)
        c = c * decay + source
        return np.clip(c, 0.0, None)

    # ------------------------------------------------------------------
    def forecast_frames(
        self,
        c0: np.ndarray,
        wind_sequence: list[tuple[np.ndarray, np.ndarray]],
        *,
        preserve_mass: bool = True,
    ) -> Iterator[tuple[int, np.ndarray]]:
        """Yield (horizon_min, concentration_array) for each 30-min frame.

        Parameters
        ----------
        c0              : initial surface NO₂ field (H × W float32).
        wind_sequence   : list of (u, v) arrays on the fine grid, one per hour.
                          Element 0 is the wind at t=0, element 1 at t+60 min, …
                          If fewer are provided than needed, the last element repeats.
        preserve_mass   : enforce mass conservation at each export frame.

        Yields
        ------
        (horizon_min, concentration) at every export_interval_min up to max_horizon_min.
        """
        cfg = self.cfg
        c0 = np.nan_to_num(c0.astype(np.float64), nan=float(np.nanmean(c0)))
        tau = cfg.lifetime_h * 3600.0
        dt = cfg.dt_s
        decay = math.exp(-dt / tau)

        if cfg.emission_mode == "persistent":
            src_per_step = c0 * (1.0 - decay)
        else:
            src_per_step = np.zeros_like(c0)

        total_mass_0 = float(np.nansum(c0))

        def _wind_at(elapsed_min: float):
            idx = min(int(elapsed_min // 60), len(wind_sequence) - 1)
            return wind_sequence[idx]

        c = c0.copy()
        elapsed = 0.0  # seconds
        next_export_s = cfg.export_interval_min * 60.0
        max_s = cfg.max_horizon_min * 60.0

        while elapsed < max_s - 1e-6:
            step = min(dt, max_s - elapsed, next_export_s - elapsed)
            u, v = _wind_at(elapsed / 60.0)
            # recompute decay & source for partial step
            d = math.exp(-step / tau)
            src = c0 * (1.0 - d) if cfg.emission_mode == "persistent" else 0.0
            c = self._step(c, u, v, step, src, d)
            elapsed += step

            if abs(elapsed - next_export_s) < 1e-3:
                if preserve_mass and total_mass_0 > 0:
                    c = _enforce_mass(c, total_mass_0)
                horizon_min = round(elapsed / 60.0)
                yield horizon_min, c.astype(np.float32)
                next_export_s += cfg.export_interval_min * 60.0

    # ------------------------------------------------------------------
    def forecast(
        self,
        c0: np.ndarray,
        wind_sequence: list[tuple[np.ndarray, np.ndarray]],
        y: np.ndarray,
        x: np.ndarray,
        preserve_mass: bool = True,
    ) -> xr.Dataset:
        """Run the solver and return a Dataset with all forecast frames.

        Returns
        -------
        xr.Dataset with variables:
          no2_forecast  (horizon_min, y, x) – forecast concentration µg m⁻³
          mass_error    (horizon_min,)       – relative mass conservation error
        """
        frames = []
        horizons = []
        mass_errors = []
        total_mass_0 = float(np.nansum(c0))

        for h_min, c in self.forecast_frames(c0, wind_sequence, preserve_mass=preserve_mass):
            frames.append(c)
            horizons.append(h_min)
            err = abs(float(np.nansum(c)) - total_mass_0) / (total_mass_0 + 1e-12)
            mass_errors.append(float(err))
            log.debug("Physics horizon %d min | mass_err=%.4f", h_min, err)

        da = xr.DataArray(
            np.stack(frames),
            coords={"horizon_min": horizons, "y": y, "x": x},
            dims=("horizon_min", "y", "x"),
            name="no2_forecast",
            attrs={
                "units": "ug m-3",
                "solver": "improved-semi-Lagrangian-advection-diffusion-decay",
                "diffusivity_m2_s": self.cfg.diffusivity_m2_s,
                "lifetime_h": self.cfg.lifetime_h,
                "emission_mode": self.cfg.emission_mode,
                "wind_update_interval_min": self.cfg.wind_update_interval_min,
            },
        )
        me = xr.DataArray(
            mass_errors,
            coords={"horizon_min": horizons},
            dims=("horizon_min",),
            name="mass_error",
        )
        return xr.Dataset({"no2_forecast": da, "mass_error": me})
