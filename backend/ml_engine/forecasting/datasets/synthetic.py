"""Realistic synthetic atmospheric sequence generator for the NO₂ forecasting engine.

Generates physically grounded synthetic atmospheric sequences simulating:
1. Shifting & rotating wind regimes (vortex flow, directional shear, calm stagnation).
2. Multiple emission sources (power plants, industrial clusters, major traffic arteries).
3. Plume merging (adjacent plumes combining downwind).
4. Plume splitting (plume dividing around an obstacle or divergent wind).
5. Mountain deflection (topographic barrier redirecting pollutant flow).
6. Urban hotspots with diurnal emission pulses and photochemical decay.
"""

from __future__ import annotations

import math
import logging
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

# Standard channel definitions
DYNAMIC_CHANNELS = [
    "no2", "prev_no2", "co", "wind_u", "wind_v",
    "wind_speed", "temp", "pressure", "humidity", "blh",
]
STATIC_CHANNELS = [
    "dem", "slope", "road_density", "built_up",
    "night_lights", "population", "power_plants",
]


class SyntheticAtmosphericGenerator:
    """Parametric realistic atmospheric dispersion generator.

    Produces paired (dynamic_sequence, static_features, target_horizons)
    emulating realistic atmospheric advection-diffusion-reaction dynamics.
    """

    def __init__(self, seed: int = 42):
        self.rng = np.random.default_rng(seed)

    def generate_sample(
        self,
        h: int = 48,
        w: int = 48,
        seq_len: int = 4,
        output_horizons: int = 4,
        scenario: str | None = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
        """Generate a single physically realistic sample under a specific atmospheric regime.

        Supported scenarios:
        * 'shifting_wind': wind direction shifts continuously over time.
        * 'rotating_vortex': cyclonic/rotational wind field around a low-pressure area.
        * 'plume_merging': two distinct industrial point sources whose plumes merge downwind.
        * 'plume_splitting': a large plume dividing around a topographic obstacle / divergent flow.
        * 'mountain_deflection': steep ridge deflecting wind and trapping pollutant upstream.
        * 'urban_hotspot': multi-source urban core with traffic corridors and power plant.
        """
        rng = self.rng
        scenarios = [
            "shifting_wind",
            "rotating_vortex",
            "plume_merging",
            "plume_splitting",
            "mountain_deflection",
            "urban_hotspot",
        ]
        if scenario is None or scenario not in scenarios:
            scenario = rng.choice(scenarios)

        rr, cc = np.mgrid[0:h, 0:w]
        total_steps = seq_len + output_horizons

        # -------------------------------------------------------------
        # 1. Static features
        # -------------------------------------------------------------
        sta = np.zeros((len(STATIC_CHANNELS), h, w), dtype=np.float32)

        # Base DEM
        if scenario == "mountain_deflection":
            # Steep ridge in the center
            ridge_c = w // 2
            ridge_width = max(3.0, w / 12.0)
            dem = 800.0 * np.exp(-((cc - ridge_c) ** 2) / (2.0 * ridge_width ** 2))
            dem += rng.uniform(0.0, 50.0, (h, w))
        else:
            dem = (rr / float(h)) * 150.0 + (cc / float(w)) * 100.0
            dem += 100.0 * np.exp(-((rr - h * 0.8) ** 2 + (cc - w * 0.2) ** 2) / 64.0)

        sta[0] = dem.astype(np.float32)
        gy, gx = np.gradient(sta[0])
        sta[1] = np.hypot(gy, gx).astype(np.float32)  # slope

        # Urban & source geometries
        cy, cx = h // 2, w // 2
        urban_core = np.exp(-((rr - cy) ** 2 + (cc - cx) ** 2) / 36.0).astype(np.float32)
        traffic_line = np.exp(-((rr - cy) ** 2) / 4.0).astype(np.float32)  # horizontal highway

        # Power plant / point sources
        power_plants = np.zeros((h, w), dtype=np.float32)
        if scenario == "plume_merging":
            # Two point sources 10 pixels apart
            power_plants[max(0, cy - 8), max(0, cx - 10)] = 1.0
            power_plants[min(h - 1, cy + 8), max(0, cx - 10)] = 1.0
        elif scenario == "plume_splitting":
            # One large point source upstream of obstacle
            power_plants[cy, max(0, cx - 12)] = 1.0
        else:
            power_plants[cy, cx] = 1.0

        sta[2] = np.clip(traffic_line * 0.7 + urban_core * 0.5, 0.0, 1.0)  # road_density
        sta[3] = np.clip(urban_core * 0.9 + 0.1, 0.0, 1.0)               # built_up
        sta[4] = np.clip(urban_core * 2.0 + power_plants * 3.0, 0.0, None) # night_lights
        sta[5] = np.log1p(urban_core * 6000.0 + traffic_line * 1000.0)    # population
        sta[6] = power_plants                                              # power_plants

        # -------------------------------------------------------------
        # 2. Time-evolving Wind Field
        # -------------------------------------------------------------
        u_seq = []
        v_seq = []
        base_speed = rng.uniform(2.5, 5.0)

        for t in range(total_steps):
            t_rel = t / max(1, total_steps - 1)
            if scenario == "shifting_wind":
                # Angle shifts by 60 degrees over time
                angle = (t_rel * math.pi / 3.0) + 0.2
                u_t = np.full((h, w), base_speed * math.cos(angle), dtype=np.float32)
                v_t = np.full((h, w), base_speed * math.sin(angle), dtype=np.float32)
            elif scenario == "rotating_vortex":
                # Cyclonic rotation about center
                rx = (cc - cx).astype(np.float32)
                ry = (rr - cy).astype(np.float32)
                dist = np.hypot(rx, ry) + 1e-4
                u_t = (-ry / dist) * base_speed + base_speed * 0.3
                v_t = (rx / dist) * base_speed
            elif scenario == "plume_splitting":
                # Convergent or divergent wind field: flows around center
                u_t = np.full((h, w), base_speed, dtype=np.float32)
                v_t = np.sign(rr - cy).astype(np.float32) * (base_speed * 0.4)
            elif scenario == "mountain_deflection":
                # Eastward wind deflected northward along ridge
                u_t = np.full((h, w), base_speed, dtype=np.float32)
                v_t = np.zeros((h, w), dtype=np.float32)
                # Deflection where slope is high
                deflect_mask = np.exp(-((cc - w // 2) ** 2) / 16.0)
                u_t = u_t * (1.0 - 0.7 * deflect_mask)
                v_t = v_t + deflect_mask * (base_speed * 0.8)
            else:
                # Urban hotspot steady advection with minor shear
                u_t = np.full((h, w), base_speed, dtype=np.float32)
                v_t = np.full((h, w), base_speed * 0.3 + 0.5 * np.sin(rr / 4.0), dtype=np.float32)

            u_seq.append(u_t)
            v_seq.append(v_t)

        # -------------------------------------------------------------
        # 3. Simulate concentration advection, diffusion, sources, decay
        # -------------------------------------------------------------
        c_curr = (urban_core * 60.0 + power_plants * 120.0 + traffic_line * 25.0).astype(np.float64)
        c_history = []

        tau_decay = 0.96  # Photochemical loss per step
        emission_rate = (urban_core * 12.0 + power_plants * 35.0 + traffic_line * 6.0).astype(np.float64)

        for t in range(total_steps):
            u_t = u_seq[t]
            v_t = v_seq[t]
            # Semi-Lagrangian back-trajectory step
            dep_r = np.clip(rr - v_t * 0.6, 0, h - 1)
            dep_c = np.clip(cc - u_t * 0.6, 0, w - 1)
            # Bilinear sampling
            r0 = dep_r.astype(int)
            r1 = np.clip(r0 + 1, 0, h - 1)
            c0 = dep_c.astype(int)
            c1 = np.clip(c0 + 1, 0, w - 1)
            dr = dep_r - r0
            dc = dep_c - c0
            c_advected = (
                (1 - dr) * (1 - dc) * c_curr[r0, c0]
                + dr * (1 - dc) * c_curr[r1, c0]
                + (1 - dr) * dc * c_curr[r0, c1]
                + dr * dc * c_curr[r1, c1]
            )

            # Explicit Laplacian diffusion
            pad = np.pad(c_advected, 1, mode="edge")
            lap = (pad[1:-1, 2:] + pad[1:-1, :-2] + pad[2:, 1:-1] + pad[:-2, 1:-1] - 4 * c_advected)
            c_diff = c_advected + 0.12 * lap

            # Continuous emissions and photochemical decay
            c_curr = c_diff * tau_decay + emission_rate + rng.standard_normal((h, w)) * 0.2
            c_curr = np.clip(c_curr, 0.0, None)
            c_history.append(c_curr.copy())

        # -------------------------------------------------------------
        # 4. Assemble dynamic input and target tensors
        # -------------------------------------------------------------
        dyn_frames = []
        for t in range(seq_len):
            dyn_t = np.zeros((len(DYNAMIC_CHANNELS), h, w), dtype=np.float32)
            c_f = c_history[t]
            prev_f = c_history[max(0, t - 1)]
            dyn_t[0] = np.log1p(c_f)                              # no2
            dyn_t[1] = np.log1p(prev_f)                          # prev_no2
            dyn_t[2] = np.log1p(c_f * 0.35)                      # co
            dyn_t[3] = u_seq[t]                                  # wind_u
            dyn_t[4] = v_seq[t]                                  # wind_v
            dyn_t[5] = np.hypot(u_seq[t], v_seq[t])              # wind_speed
            dyn_t[6] = 22.0 + 4.0 * np.sin(t / 4.0)              # temp
            dyn_t[7] = 1013.25 - (sta[0] / 100.0)                # pressure
            dyn_t[8] = 9.0 + rng.uniform(0.0, 1.5, (h, w))       # humidity
            dyn_t[9] = np.log1p(650.0 + 300.0 * np.sin(t / 4.0)) # blh
            dyn_frames.append(dyn_t)

        tgt_frames = []
        for t in range(seq_len, total_steps):
            tgt_frames.append(np.log1p(c_history[t]))

        dynamic_tensor = np.stack(dyn_frames, axis=0).astype(np.float32)
        static_tensor = sta.astype(np.float32)
        target_tensor = np.stack(tgt_frames, axis=0).astype(np.float32)

        meta = {
            "scenario": scenario,
            "base_wind_speed": float(base_speed),
            "h": h,
            "w": w,
        }
        return dynamic_tensor, static_tensor, target_tensor, meta
