# Hybrid NO₂ Forecasting Engine

Productionized, physics-informed spatiotemporal forecasting engine combining atmospheric advection-diffusion-reaction modeling with a deep ConvLSTM residual correction neural network.

```
                           ┌────────────────────────────────────────┐
                           │         Downscaled Surface NO₂         │
                           │               C(t₀, x, y)              │
                           └───────────────────┬────────────────────┘
                                               │
                        ┌──────────────────────┴──────────────────────┐
                        ▼                                             ▼
       ┌─────────────────────────────────┐           ┌─────────────────────────────────┐
       │     Improved Physics Solver     │           │   ConvLSTM Residual AI Model    │
       │                                 │           │                                 │
       │  • Semi-Lagrangian Advection    │           │  • Multi-scale U-Net Encoder    │
       │  • Explicit Laplacian Diffusion │           │  • Static Feature Embedding     │
       │  • Dynamic Wind Interpolation   │           │  • Multi-horizon ConvLSTM Head  │
       │  • Terrain Flow Deflection      │           │  • Residual Learning: ΔNO₂      │
       │  • Categorized Persistent Source│           │                                 │
       │  • Strict Mass Conservation     │           │                                 │
       └────────────────┬────────────────┘           └────────────────┬────────────────┘
                        │ C_physics(t+k)                              │ Δ_AI(t+k)
                        └──────────────────────┬──────────────────────┘
                                               ▼
                                 ┌───────────────────────────┐
                                 │       Hybrid Output       │
                                 │ Ĉ(t+k) = max(0, C_phys+Δ) │
                                 └─────────────┬─────────────┘
                                               │
                     ┌─────────────────────────┼─────────────────────────┐
                     ▼                         ▼                         ▼
             ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
             │ 30-min Frames │         │ NetCDF Cube   │         │ Wind Vectors  │
             │   (GeoTIFF)   │         │  (xarray ds)  │         │   (GeoJSON)   │
             └───────────────┘         └───────────────┘         └───────────────┘
```

---

## 1. Mathematical Formulation

### 1.1 The Atmospheric Transport Equation
The physical evolution of nitrogen dioxide concentration $C(x, y, t)$ within the planetary boundary layer is governed by the 2D advection-diffusion-reaction partial differential equation (PDE):

$$\frac{\partial C}{\partial t} + u \frac{\partial C}{\partial x} + v \frac{\partial C}{\partial y} = K_h \nabla^2 C - \frac{C}{\tau} + S(x, y)$$

Where:
* $(u, v)$ is the horizontal wind velocity vector ($\text{m/s}$).
* $K_h$ is the horizontal eddy diffusivity ($\approx 50\,\text{m}^2/\text{s}$).
* $\tau$ is the effective photochemical lifetime of $\text{NO}_2$ via $\text{OH}$ radical oxidation ($\approx 4.0\,\text{hours}$).
* $S(x, y)$ represents localized emission sources ($\mu\text{g}/(\text{m}^3 \cdot \text{s})$).

---

### 1.2 Semi-Lagrangian Midpoint Advection
To ensure unconditional numerical stability without violating Courant-Friedrichs-Lewy (CFL) limits during high wind speeds, advection is computed via a backward trajectory Semi-Lagrangian scheme:

$$\vec{x}_{\text{dep}} = \vec{x} - \Delta t \cdot \vec{v}\left(\vec{x} - \frac{\Delta t}{2} \vec{v}(\vec{x})\right)$$

$$C_{\text{adv}}(\vec{x}, t + \Delta t) = \mathcal{I}\big(C(\cdot, t),\, \vec{x}_{\text{dep}}\big)$$

Where $\mathcal{I}(\cdot)$ denotes bilinear interpolation on the spatial grid.

---

### 1.3 Dynamic Hourly Wind Continuous Temporal Interpolation
ERA5 meteorological forecasts arrive at 1-hour intervals. For sub-hourly internal timesteps ($\Delta t = 300\,\text{s}$), the wind field is continuously interpolated:

$$\vec{v}(t) = (1 - \alpha) \vec{v}_{k} + \alpha \vec{v}_{k+1}, \quad \text{where } \alpha = \frac{t - t_k}{t_{k+1} - t_k}$$

---

### 1.4 Terrain-Aware Transport Deflection & Drag
Local topography (DEM and surface slope) alters boundary-layer wind trajectories through friction drag and ridge deflection:

$$\vec{v}_{\text{drag}} = \vec{v} \cdot \max\big(0.2,\, 1 - 0.4 \sin(\theta_{\text{slope}})\big)$$

$$\vec{v}_{\text{eff}} = (1 - \gamma) \vec{v}_{\text{drag}} + \gamma (\vec{v}_{\text{drag}} \cdot \hat{t}_{\text{ridge}}) \hat{t}_{\text{ridge}}$$

Where $\hat{t}_{\text{ridge}}$ is the contour tangent orthogonal to $\nabla(\text{DEM})$, and $\gamma \in [0, 0.3]$ is the deflection strength.

---

### 1.5 Categorized Persistent Source Modeling
Point and corridor emissions continue releasing pollutants over multi-hour forecasts:

$$S(x, y) = C_0(x, y) \cdot \Big(1 - e^{-\Delta t / \tau}\Big) \cdot \Big(0.8 + 0.4 \cdot \Psi_{\text{hotspot}}(x, y)\Big)$$

Where $\Psi_{\text{hotspot}}$ weights power plants, industrial zones, and traffic density.

---

### 1.6 Mass Conservation Enforcement
Numerical diffusion and interpolation can cause non-physical mass loss or drift. At each export interval, the mass is corrected:

$$M_0 = \iint_{\Omega} C_0(x, y) \, dx \, dy, \quad C_{\text{corrected}}(x, y) = C(x, y) \cdot \frac{M_0}{\iint_{\Omega} C(x, y) \, dx \, dy}$$

---

### 1.7 ConvLSTM Residual Correction Network
While the physics solver resolves bulk transport, unmodeled non-linear atmospheric interactions (e.g. boundary layer mixing, microclimates) are captured by the residual neural network:

$$\hat{C}(t + k) = \max\Big(0,\, C_{\text{physics}}(t + k) + \Delta_{\text{AI}}(t + k)\Big)$$

The network operates on:
* **Dynamic sequences** ($10$ channels across sequence length $T=4$): $\text{NO}_2$, $\text{CO}$, $u$, $v$, wind speed, temperature, pressure, humidity, boundary layer height.
* **Static embeddings** ($7$ channels): DEM elevation, slope, road density, built-up fraction, VIIRS night lights, population, power plant masks.

---

## 2. Dual Dataset Architecture

The system features an interchangeable dual dataset architecture switchable via configuration:

| Mode               | Configuration                  | Description                                                                                                                                                                |
| :----------------- | :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Synthetic Mode** | `FORECAST_DATA_MODE=synthetic` | Offline training, testing, and CI/CD generating realistic synthetic atmospheric scenarios (shifting winds, vortex rotation, plume merging/splitting, mountain deflection). |
| **Real Data Mode** | `FORECAST_DATA_MODE=real`      | Production mode consuming live or cached Sentinel-5P, ERA5, and ground-truth feeds.                                                                                        |

---

## 3. Configuration Reference

All settings can be configured via environment variables or `ForecastConfig`:

| Environment Variable           | Default     | Description                                                 |
| :----------------------------- | :---------- | :---------------------------------------------------------- |
| `FORECAST_DATA_MODE`           | `synthetic` | `synthetic` or `real` dataset mode                          |
| `FORECAST_INTERVAL`            | `30`        | Output cadence in minutes ($+30, +60, +90, +120$)           |
| `INTERNAL_TIMESTEP`            | `300`       | Solver internal simulation timestep ($\Delta t$ in seconds) |
| `ENABLE_DYNAMIC_WIND`          | `true`      | Enable continuous hourly wind interpolation                 |
| `ENABLE_TERRAIN_EFFECT`        | `true`      | Enable DEM and slope flow deflection                        |
| `ENABLE_SOURCE_PERSISTENCE`    | `true`      | Model continuous industrial and traffic emissions           |
| `PHOTOCHEMICAL_LIFETIME_HOURS` | `4.0`       | NO₂ chemical lifetime $\tau$ (hours)                        |
| `DIFFUSION_COEFFICIENT`        | `50.0`      | Eddy diffusivity $K_h$ ($\text{m}^2/\text{s}$)              |

---

## 4. Verification and Automated Testing

Run the test suite with:

```bash
uv run pytest ml_engine/forecasting/tests/test_forecasting.py -v
```
