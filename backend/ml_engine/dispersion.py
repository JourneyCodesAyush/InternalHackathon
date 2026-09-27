"""Stage 3 - short-range NO2 plume drift forecast with a 2-D advection-diffusion-reaction solver.

    dC/dt + u dC/dx + v dC/dy = K (d2C/dx2 + d2C/dy2) - C / tau + S

Solved on the fine grid with operator splitting per time step:
* advection  - semi-Lagrangian (back-trajectory + bilinear interpolation); unconditionally stable,
               so large wind speeds at 250 m cells need no CFL-limited sub-stepping;
* diffusion  - explicit 5-point Laplacian with zero-flux boundaries, sub-stepped to satisfy
               dt <= dx^2 / (4K);
* reaction   - exact exponential decay with NO2 chemical lifetime tau (OH oxidation);
* emissions  - "persistent": S = C0 / tau, i.e. sources keep emitting at the rate that sustains the
               observed field, so hotspots stay while their plumes drift downwind;
               "none": a freely drifting and decaying plume (release scenario).
Open boundaries replicate edge values, which acts as clean background inflow.
"""

from __future__ import annotations

import math

import numpy as np
import xarray as xr
from scipy import ndimage

from .config import DispersionConfig
from .grid import GridSpec


class AdvectionDiffusionSolver:
    def __init__(self, grid: GridSpec, cfg: DispersionConfig | None = None):
        self.grid = grid
        self.cfg = cfg or DispersionConfig()
        self.dx, self.dy = grid.pixel_size_m()
        if self.cfg.emission_mode not in ("persistent", "none"):
            raise ValueError("emission_mode must be 'persistent' or 'none'")
        rows, cols = np.mgrid[0 : grid.height, 0 : grid.width]
        self._rows = rows.astype(np.float64)
        self._cols = cols.astype(np.float64)

    # ---------------------------------------------------------------------------------------------
    def _advect(self, c: np.ndarray, u: np.ndarray, v: np.ndarray, dt: float) -> np.ndarray:
        # Row index grows southward, so northward wind (v>0) brings air from larger row indices.
        dep_c = self._cols - u * dt / self.dx
        dep_r = self._rows + v * dt / self.dy
        # Second-order (midpoint) back-trajectory using wind sampled at the half-way point.
        u_mid = ndimage.map_coordinates(u, [0.5 * (dep_r + self._rows), 0.5 * (dep_c + self._cols)], order=1, mode="nearest")
        v_mid = ndimage.map_coordinates(v, [0.5 * (dep_r + self._rows), 0.5 * (dep_c + self._cols)], order=1, mode="nearest")
        dep_c = self._cols - u_mid * dt / self.dx
        dep_r = self._rows + v_mid * dt / self.dy
        return ndimage.map_coordinates(c, [dep_r, dep_c], order=1, mode="nearest")

    def _diffuse(self, c: np.ndarray, dt: float) -> np.ndarray:
        k = self.cfg.diffusivity_m2_s
        if k <= 0:
            return c
        dt_max = 0.24 * min(self.dx, self.dy) ** 2 / k
        n_sub = max(1, math.ceil(dt / dt_max))
        h = dt / n_sub
        for _ in range(n_sub):
            p = np.pad(c, 1, mode="edge")
            lap = (p[1:-1, 2:] - 2 * c + p[1:-1, :-2]) / self.dx**2 + (p[2:, 1:-1] - 2 * c + p[:-2, 1:-1]) / self.dy**2
            c = c + h * k * lap
        return c

    # ---------------------------------------------------------------------------------------------
    def forecast(self, c0: np.ndarray, u: np.ndarray, v: np.ndarray, horizons_h=None) -> xr.DataArray:
        """Project ``c0`` forward. ``u``/``v`` are 10 m winds (m/s) on the fine grid, held constant."""
        cfg = self.cfg
        horizons = sorted(float(h) for h in (horizons_h or cfg.horizons_h))
        c0 = np.nan_to_num(np.asarray(c0, dtype=np.float64), nan=float(np.nanmean(c0)))
        u = np.broadcast_to(np.asarray(u, dtype=np.float64), c0.shape).copy()
        v = np.broadcast_to(np.asarray(v, dtype=np.float64), c0.shape).copy()
        tau = cfg.lifetime_h * 3600.0
        dt = cfg.dt_s
        decay = math.exp(-dt / tau)
        source_step = c0 * (1 - decay) if cfg.emission_mode == "persistent" else 0.0

        c = c0.copy()
        out = []
        t = 0.0
        for target in horizons:
            while t < target * 3600.0 - 1e-6:
                step = min(dt, target * 3600.0 - t)
                if step != dt:  # final partial step to land exactly on the horizon
                    d = math.exp(-step / tau)
                    src = c0 * (1 - d) if cfg.emission_mode == "persistent" else 0.0
                else:
                    d, src = decay, source_step
                c = self._advect(c, u, v, step)
                c = self._diffuse(c, step)
                c = c * d + src
                t += step
            out.append(np.clip(c, 0, None).astype(np.float32))
        return xr.DataArray(
            np.stack(out), coords={"horizon_h": horizons, "y": self.grid.y, "x": self.grid.x},
            dims=("horizon_h", "y", "x"), name="no2_forecast",
            attrs={"units": "ug m-3", "solver": "semi-Lagrangian advection-diffusion-decay",
                   "diffusivity_m2_s": cfg.diffusivity_m2_s, "lifetime_h": cfg.lifetime_h,
                   "emission_mode": cfg.emission_mode},
        )


def transport_summary(u: np.ndarray, v: np.ndarray) -> dict:
    """Domain-mean wind speed (m/s) and meteorological direction the plume travels *towards*."""
    um, vm = float(np.mean(u)), float(np.mean(v))
    speed = math.hypot(um, vm)
    towards = (math.degrees(math.atan2(um, vm)) + 360) % 360
    return {"mean_u_ms": um, "mean_v_ms": vm, "mean_speed_ms": speed, "plume_heading_deg": towards,
            "drift_km_per_hour": speed * 3.6}
