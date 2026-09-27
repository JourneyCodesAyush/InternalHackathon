# Mumbai satellite NO₂ — daily GeoTIFFs, 1 Nov – 31 Dec 2025

Real Sentinel-5P satellite NO₂ over Mumbai, one GeoTIFF per day (61 files). This is the input the
ML engine turns into 250 m ground-level NO₂ maps.

## Run the pipeline on them

1. Unzip into the repo, e.g. `backend/data/inputs/mumbai_2025-11-01_to_2025-12-31/`.
2. From `backend/` (Earth Engine login needed — weather and land-use layers are fetched for this area):

```bash
uv run python -m ml_engine --source files --input-dir data/inputs/mumbai_2025-11-01_to_2025-12-31 --ee-project internal-hackathon-509815
```

Results go to `backend/outputs/files_<date>_<time>/` — the main result is
`daily/<date>/no2_surface_fine.tif` (250 m ground-level NO₂, µg/m³) for every day.

## What each file contains

| Property | Value |
|---|---|
| Files | `no2_raw_coarse_<YYYY-MM-DD>.tif`, one per day, 61 in total |
| Quantity | Sentinel-5P tropospheric NO₂ column (daily composite at the ~13:30 local satellite overpass) |
| Units | µmol/m² (GeoTIFF tag `units = umol m-2`) |
| Grid | EPSG:4326, 0.035° pixels (~3.9 km), 10 columns × 13 rows |
| Area | 72.77–73.12 °E, 18.865–19.32 °N (Mumbai; top row = north) |
| Clouds | No-data (NaN) where clouds blocked the satellite |
| Source | `COPERNICUS/S5P/OFFL/L3_NO2` via Google Earth Engine; pixels with cloud fraction ≥ 0.3 removed |

## Cloud cover

| Days | Cloud cover |
|---|---|
| 1–3 Nov 2025 | 100% (no data — the gap-filler reconstructs them) |
| 4 Nov 2025 | 78% |
| 28 Nov 2025 | 79% |
| 30 Nov, 2 Dec 2025 | 35% |
| 5 Nov 2025 | 17% |
| Other 53 days | clear or under 10% |

Open any file in QGIS to see it on a map. Values range roughly 30–400 µmol/m²; higher values mark the
dense central-east part of the city.
