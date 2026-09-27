# Ground-station data guide

The ML engine learns the satellite → ground-level NO₂ relationship from CPCB monitoring stations.
More days and overpass-time (hourly) readings are what improve it most. This guide explains exactly
what to download and how to add it.

## 1. What to download (in priority order)

| Priority | What | Why |
|---|---|---|
| **1** | **Mumbai, hourly NO₂, 1 Jan 2023 – 31 Dec 2025**, for the 19 stations listed below | Hourly data lets the model use only 12:00–16:00, when the satellite passes; 3 years gives ~18× more training days than now |
| 2 | Delhi (≈40 stations), then Pune, Hyderabad or Bengaluru: same settings | Many more locations with different land use; network quirks average out (joint multi-city training is the next code step; download is already useful) |

**End date must be on or before 31 Dec 2025** — the boundary-layer-height source (GEOS-CF) ends on 2 Jan 2026.

### Mumbai stations to download (passed quality control)

```
Bandra Kurla Complex, Mumbai - IITM          Kherwadi_Bandra East, Mumbai - MPCB
Bandra Kurla Complex, Mumbai - MPCB          Khindipada-Bhandup West, Mumbai - IITM
Borivali East, Mumbai - IITM                 Malad West, Mumbai - IITM
Byculla, Mumbai - BMC                        Mazgaon, Mumbai - IITM
Chakala-Andheri East, Mumbai - IITM          Mindspace-Malad West, Mumbai - MPCB
Chembur, Mumbai - MPCB                       Navy Nagar-Colaba, Mumbai - IITM
Deonar, Mumbai - IITM                        Shivaji Nagar, Mumbai - BMC
Ghatkopar, Mumbai - BMC                      Siddharth Nagar-Worli, Mumbai - IITM
Kandivali West, Mumbai - BMC                 Sion, Mumbai - MPCB
Vile Parle West, Mumbai - MPCB
```

**Skip** (failed QC in Nov–Dec 2025 — stuck, near-zero or contradicting neighbours): Colaba-MPCB,
Mulund West, Powai, Borivali East-MPCB, Kandivali East, Kurla, Sewri, Worli-MPCB, Airport T2.
The pipeline re-checks every station automatically, so downloading one of these by mistake is harmless.

## 2. How to download from CPCB (one station at a time)

1. Open <https://airquality.cpcb.gov.in/ccr> → menu **Data** → **All India CAAQMS Data**
   (the *Advance Search* page). **Not** "AQI Data Repository" — that contains AQI, not NO₂.
2. Solve the CAPTCHA and click **Verify**.
3. Fill in the form:
   - **State:** Maharashtra — *check this; it defaults to Delhi*
   - **City:** Mumbai
   - **Station:** one station from the list above
   - **Parameter:** **NO2 only** (the converter expects exactly one NO2 column)
   - **Criteria / averaging:** **1 Hours**
   - **Date range:** 01-01-2023 00:00 → 31-12-2025 23:59. If the site rejects the range or the file is cut
     short, download **one year per file** (2023, 2024, 2025) — the converter merges them.
4. **Submit**, then download the report as **Excel**.
5. Open the file and check the header block before moving on:
   `Station` = the station you chose, `Parameter` = NO2, `AvgPeriod` = 1H (or 1 Hours), `From`/`To` = your range.

## 3. Where to save the files

Keep the original `RealTimeReport_….xlsx` names; organise by city (sub-folders are read recursively):

```
backend/data/cpcb_raw/
├── mumbai/        ← hourly 2023-2025 files
└── delhi/         ← later
```

The existing Nov–Dec 2025 daily files sit directly in `cpcb_raw/` and are not read when you convert
`cpcb_raw/mumbai`. Don't put daily and hourly files for the same station and days in one folder.

## 4. Convert and train

From `backend/`:

```bash
uv run python -m ml_engine.ingestion.cpcb data/cpcb_raw/mumbai data/cpcb_stations.csv -o data/cpcb_mumbai_hourly.csv
```

The converter prints one line per station. A `Skipping … not in data/cpcb_stations.csv` warning means a
station has no coordinates: add a row `"<exact station name>",<lat>,<lon>` to `data/cpcb_stations.csv`
(it already holds ~550 CPCB stations across India) and run it again.

```bash
uv run python -m ml_engine --source gee --ee-project internal-hackathon-509815 --start 2023-01-01 --end 2025-12-31 --stations data/cpcb_mumbai_hourly.csv
```

- Hourly readings are averaged over **12:00–16:00 local time** by default (`--station-hours 12-16`);
  `--station-hours all` uses the full day instead.
- The first run downloads three years from Earth Engine (expect roughly 15–30 minutes); reruns use the cache.
- Monsoon months (Jun–Sep) are heavily clouded; the gap-filler handles them, but they carry less
  satellite information.

## 5. Sharing data with the team

Commit the raw files and the converted CSV so everyone trains on the same data:

```bash
git add backend/data
git commit -m "data: add CPCB hourly NO2 2023-2025 for Mumbai"
git push
```

## Common mistakes

| Symptom | Cause |
|---|---|
| Station name ends in `Delhi - DPCC` | State/City left on the Delhi default |
| Values ~60–300, very smooth hour to hour | Downloaded from the AQI repository (AQI index, not NO₂) |
| `expected exactly one 'NO2' column` | Several parameters or several stations in one report |
| Only one row per day | Criteria was 24 Hours instead of 1 Hours |
