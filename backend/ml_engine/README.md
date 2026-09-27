# ml_engine — satellite NO₂ gap-filling, downscaling and forecasting

Turns coarse Sentinel-5P satellite NO₂ (~3.9 km, with cloud gaps) into **gap-free 250 m ground-level
NO₂ maps (µg/m³)** for any Indian city, plus short-range plume forecasts and hazard-band layers.

| Stage | What it does |
|---|---|
| 1. Gap-filling | Random Forest fills cloud-masked satellite pixels (median-mosaic fallback for long cloudy spells) |
| 2. Downscaling | XGBoost sharpens ~3.9 km → ~270 m using land use and weather; corrected so it still averages to the satellite measurement |
| 3. Ground-level model | Nationally trained model converts the satellite column + weather + land use to µg/m³ at ground level |
| 4. Dispersion | Advection–diffusion solver drifts the map with the wind (+1/+3/+6 h, or any horizons) |
| 5. Export | GeoTIFF (COG), NetCDF, GeoJSON (hazard bands, wind arrows, points), CSV |

## Setup

From `backend/`:

```bash
uv sync                      # add --system-certs on networks with HTTPS inspection
uv run earthengine authenticate
```

Your Google account needs access to the Earth Engine project (IAM roles *Earth Engine Resource Viewer*
and *Service Usage Consumer*). Set `EE_PROJECT` (or pass `--ee-project`).

## Quick start

```bash
# offline smoke test on synthetic data (no Earth Engine)
uv run python -m ml_engine --source synthetic

# real data for a city
uv run python -m ml_engine --source gee --city Pune --start 2025-11-01 --end 2025-12-31

# ... and check it against ground stations (CPCB CSV)
uv run python -m ml_engine --source gee --city Mumbai --start 2025-11-01 --end 2025-12-31 --stations data/cpcb_mumbai.csv
```

```bash
# your own satellite GeoTIFFs instead of the Earth Engine download (sample folder included)
uv run python -m ml_engine --source files --input-dir data/sample_inputs/mumbai_2025-11-24_to_2025-12-07
```

`data/sample_inputs/README.md` describes the sample files and the format your own GeoTIFFs need.
`uv run python -m ml_engine --list-cities` prints the ~280 supported city names (bounding boxes come from
CPCB station locations; `--bbox WEST SOUTH EAST NORTH` works anywhere in India).

## Inputs

| You provide | Notes |
|---|---|
| Area: `--city` or `--bbox` | India (road data covers South Asia) |
| Dates: `--start`, `--end` | Sentinel-5P exists from mid-2018. Best before 2 Jan 2026 (boundary-layer height source ends then; later dates use an estimate) |
| `--stations` (optional) | Ground-station CSV `station_id,lat,lon,date,no2` for an independent accuracy check. See `data/README.md` |

Pulled automatically from Google Earth Engine: Sentinel-5P NO₂ and CO, ERA5-Land weather (at the
satellite overpass hour), GEOS-CF boundary-layer height, NASADEM elevation, Sentinel-2 vegetation and
built-up area, VIIRS night lights, GHSL built surface and population, GRIP4 roads, WRI power plants.
Downloads are cached in `cache/`.

## Outputs (`outputs/<run>/`)

| File | Content |
|---|---|
| `daily/<date>/no2_surface_fine.tif` | **Main product**: 250 m ground-level NO₂ (µg/m³), one per day |
| `daily/<date>/no2_raw_coarse.tif`, `no2_gapfilled_coarse.tif` | Satellite column before/after cloud filling |
| `daily/<date>/no2_hazard_bands.geojson` | Normal / Moderate / Unhealthy / Hazardous zones (SRS thresholds) |
| `no2_surface_fine.nc` | All days in one NetCDF (time slider, downloads) |
| `no2_forecast_<last date>.tif` | Plume forecast, one band per horizon |
| `wind_vectors_<last date>.geojson` | Wind arrows for the flow overlay |
| `report.json` | Every metric and processing decision |

All rasters are EPSG:4326 Cloud-Optimised GeoTIFFs, float32, NaN = no data.

## Python API (for the FastAPI backend)

```python
from ml_engine.service import generate_map, forecast_point

m = generate_map(city="Mumbai", date="2025-12-15")   # or bbox=(west, south, east, north)
m["surface_tif"], m["hazard_geojson"], m["metrics"]

f = forecast_point(19.07, 72.87, hours=24)           # every 3 h: NO2, wind speed/direction, confidence
```

Both block for ~1–3 minutes the first time an area/period is requested (Earth Engine download + model
fitting) and return instantly afterwards (cached in `outputs/runs/`, override with `ML_ENGINE_RUNS_DIR`).
From async endpoints call them with `await asyncio.to_thread(generate_map, ...)`.

They back two API endpoints (`app/services/downscale_service.py`, `app/services/trends_service.py`):

| Endpoint | Returns |
|---|---|
| `GET /api/v1/downscale/map?bbox=min_lon,min_lat,max_lon,max_lat&timestamp=2025-12-31` | `grid_url` (250 m GeoTIFF), `raw_url`, `gapfilled_url`, `hazard_geojson_url`, `netcdf_url`, `resolution`, `metrics` |
| `GET /api/v1/trends/predict?lat=19.07&lon=72.87&hours=24` | NO₂, wind speed, wind direction (from) and confidence every 3 h |

Files are served from the `/files/...` static mount in `app/main.py`. Set `EE_PROJECT` in `backend/.env`.

## The national ground-level model

`pretrained/no2_surface_24h.joblib` (24-hour mean NO₂) is used by default for `--source gee`. It was
trained with `ml_engine.national` on OpenAQ's mirror of India's CPCB network (2019–2022, COVID lockdown
excluded, 212 stations in 115 cities after quality control). To retrain:

```bash
uv run python -m ml_engine.ingestion.openaq --start 2019-01-01 --end 2022-12-31 -o data/openaq_india_no2_hourly.csv   # needs OPENAQ_API_KEY in backend/.env
uv run python -m ml_engine.national --stations data/openaq_india_no2_hourly.csv --start 2019-01-01 --end 2022-12-31 --station-hours all
```

## Accuracy (all measured on data the model never saw)

| Check | R² | Typical error |
|---|---|---|
| Cloud gap-filling (hidden clear pixels) | 0.93 | — |
| Downscaling (held-out days, satellite scale) | 0.92 | — |
| Ground-level NO₂ — unseen cities (leave-one-city-out) | 0.23 | ±23 µg/m³ |
| Ground-level NO₂ — unseen stations and dates | 0.18 | ±24 µg/m³ |
| Mumbai, Nov–Dec 2025 (period unseen) | −0.13 | bias −0.3 µg/m³, day-to-day r = 0.63 |

R² = 1 is perfect, 0 is no better than always predicting the average. The satellite stages are reliable;
the ground-level values capture **trends and hotspots** but single station-days can be off by ~±23 µg/m³
(the SRS target of R² ≥ 0.6 is not met — ground-station data is sparse and inconsistent between networks).
Validation is leakage-free: models are always scored on stations *and* dates excluded from training.

## Area reports (PDF — English, Hindi, Marathi)

`ml_engine.report` turns a run into a formal report for officials and researchers. Every number is
computed in code (`report/analysis.py`); the language model only phrases them.

| Section | Content |
|---|---|
| Status | Normal / Elevated / Critical / Critical Spike from the SRS bands and the CPCB 24 h standard (80 µg/m³) |
| Comparison with standards | Area average, 95th percentile, highest cell and share of area vs CPCB NAAQS (80 / 40) and WHO (25) |
| Map and hotspots | 250 m map with the top 3 hotspots, named after the nearest CPCB station, with likely contributors (roads, power plants, dense activity) |
| Population exposure | People living in each hazard band (GHSL), population-weighted average |
| Forecast alerts | +3/+6/+12/+24 h from the dispersion solver: exceedance expected / persisting / improving |
| Weather-adjusted trend | 30-day series with the weather effect removed (ridge regression on boundary layer, wind, temperature, rain) |
| Risk context, recommendations | Gemini narrative when available, otherwise built-in templates |
| Method and limitations | Data sources, accuracy (R² 0.23 on unseen cities, ±23 µg/m³) |

```python
from ml_engine.report import generate_report
pdf_bytes, meta = generate_report(city="Mumbai", date="2025-12-31", language="hi")   # or bbox=(...)
```

API: `POST /api/v1/reports/generate` with `region_name, bbox, start_date, end_date, language (en|hi|mr),
use_ai, city` streams the PDF; headers `X-Report-Status`, `X-Report-Narrative` (ai/template),
`X-Report-Language`, `X-Report-Notice` (empty/cached/unavailable). `POST /api/v1/reports/analysis` (same body)
returns the same analysis as JSON (no Gemini call); the frontend's **Area Air Quality Report** card (sidebar)
shows it on screen (**Analyse**) and downloads the PDF (**PDF report**).

**A report is always produced.** If the fresh run fails (Earth Engine quota, not configured, outage) or takes
longer than `REPORT_RUN_WAIT_S` (default 5 s; the run then continues in the background and is cached), the
report uses the latest stored model map covering the area and says so in a notice. With no stored map, the
PDF gives the standards, hazard bands and health guidance. A section that fails on its own (forecast, trend,
hotspots, population, map figure) is left out, and a Gemini failure falls back to the templates.
Reports come back within `REPORT_TIME_BUDGET_S` (default 15 s): analyses are cached per run and date, and
Gemini only gets the time left (else templates). Dates later than today − 6 days are moved back to that day
(ERA5-Land weather is published ~6 days late).

**Gemini (optional):** set `GEMINI_API_KEY` in `backend/.env` (free key from Google AI Studio). One call per
report, cached on disk (`cache/report_llm/`), at most `GEMINI_DAILY_LIMIT` calls a day (default 40), a
2-minute pause after a quota error, and a fact check: any AI sentence containing a number that is not in
the computed facts is replaced by the template. Without a key the report is complete from templates.

**Hindi/Marathi fonts:** a Devanagari TrueType font is needed on the server. Found automatically on
Windows (Nirmala UI) and on Linux with `fonts-noto` / Lohit installed; otherwise set
`REPORT_FONT_REGULAR` / `REPORT_FONT_BOLD` to font files. Without one, reports fall back to English.

## Tests

```bash
uv run pytest ml_engine/tests -q
```

## Known limitations

- Boundary-layer height after 2 Jan 2026 comes from a bulk estimate (less accurate ground-level values).
- Earth Engine's free tier has a monthly compute quota; large new areas/periods can hit "restricted mode".
- Outside India the road layer is missing and the ground-level model is untrained.

## Presenting without Earth Engine (quota-proof demos)

The free Earth Engine tier has a monthly compute quota; when it runs out the project goes into "restricted
mode" (low priority, requests may be slow or refused). For a presentation, prepare everything the day before
and switch the app to offline mode:

```bash
# 1. the day before: full runs, all languages, Gemini narratives, global snapshot (uses quota once)
uv run python -m ml_engine.prewarm --globe --ai --report Mumbai:2025-12-31 --report Delhi:2025-12-31
# 2. check everything is stored
uv run python -m ml_engine.prewarm --check --globe --report Mumbai:2025-12-31 --report Delhi:2025-12-31
# 3. before presenting: add ML_ENGINE_OFFLINE=true to backend/.env (read per request, no restart)
```

In offline mode nothing calls Earth Engine or Gemini: prepared reports come back in ~2-3 s, other dates use the
nearest stored map with a notice, unprepared areas get the standards-and-guidance document, and the globe
shows the stored snapshot labelled "live updates paused". Reports select areas by city name, so prepare the
cities you will click on the map.
