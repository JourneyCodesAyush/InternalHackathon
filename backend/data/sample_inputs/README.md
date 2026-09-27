# Sample inputs — satellite NO₂ GeoTIFFs

Real Sentinel-5P satellite NO₂ for **Mumbai, 24 Nov – 7 Dec 2025** (14 days), ready to feed into the ML
engine. Use them to try the pipeline end to end, or to see what the raw input looks like in QGIS.

## Run the pipeline on them

From `backend/` (Earth Engine login still needed: weather and land-use layers are fetched for this area
and period):

```bash
uv run python -m ml_engine --source files --input-dir data/sample_inputs/mumbai_2025-11-24_to_2025-12-07
```

Results land in `outputs/files_<timestamp>/`: a 250 m ground-level NO₂ map per day in
`daily/<date>/no2_surface_fine.tif` (see `ml_engine/README.md` for every output).

## What the files contain

| Property | Value |
|---|---|
| Files | `no2_raw_coarse_<YYYY-MM-DD>.tif`, one per day |
| Quantity | Sentinel-5P tropospheric NO₂ column, daily composite at the ~13:30 local overpass |
| Units | µmol/m² (tag `units = umol m-2`) |
| Grid | EPSG:4326, 0.035° pixels (~3.9 km), 10 × 13 pixels, bounds 72.77–73.12 °E, 18.865–19.32 °N |
| Clouds | No-data (NaN) where the satellite could not see |
| Source | `COPERNICUS/S5P/OFFL/L3_NO2` via Google Earth Engine, cloud fraction < 0.3 |

| Date | Cloud cover |
|---|---|
| 28 Nov 2025 | 79% |
| 30 Nov 2025 | 35% |
| 2 Dec 2025 | 35% |
| 25–26 Nov, 6 Dec | 2–5% |
| All other days | clear |

The cloudy days show the gap-filling at work: those pixels come back filled in the outputs.

## Using your own GeoTIFFs

Any folder works if the files are:

- one per day, with the date (`YYYY-MM-DD`) in the file or folder name;
- all on the same EPSG:4326 grid with square pixels (any resolution; outputs are ~270 m);
- tropospheric NO₂ column in µmol/m² or mol/m² (detected automatically), clouds as no-data.

Missing days are treated as fully cloudy. Two weeks or more give the gap-filler and downscaler enough
history to learn from.
