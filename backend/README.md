# Air Quality Backend — FastAPI + ML Engine

FastAPI backend for the AirQ AI/ML Satellite-Based Air Quality Downscaling & Analysis System.

---

## Prerequisites

| Tool                                  | Version                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| Python                                | ≥ 3.12                                                               |
| [uv](https://github.com/astral-sh/uv) | ≥ 0.4.0                                                              |
| Supabase project                      | with tables defined in the SRS                                       |
| Google Earth Engine account           | IAM roles: *Earth Engine Resource Viewer* + *Service Usage Consumer* |

---

## Installation

```bash
cd backend
uv sync
```

For networks with HTTPS inspection (e.g., corporate proxies):
```bash
uv sync --system-certs
```

---

## Environment Setup

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

### Required Variables

| Variable              | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `SUPABASE_URL`        | Your Supabase project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_KEY`        | Supabase anon / publishable key                         |
| `SUPABASE_JWT_SECRET` | JWT secret (from Supabase → Project Settings → API)     |
| `EE_PROJECT`          | Google Cloud project ID with Earth Engine enabled       |

The app will crash on startup with a clear validation error if the three Supabase variables are missing.

### Optional Variables

| Variable                          | Default                 | Description                                                                              |
| --------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `OPENAQ_API_KEY`                  | —                       | Required to re-download OpenAQ station data                                              |
| `GEMINI_API_KEY`                  | —                       | Enables AI narrative in PDF reports ([get free key](https://aistudio.google.com/apikey)) |
| `GEMINI_MODEL`                    | `gemini-2.0-flash-lite` | Gemini model name                                                                        |
| `GEMINI_DAILY_LIMIT`              | `40`                    | Max Gemini calls per day                                                                 |
| `LOCAL_DEMO_MODE`                 | `false`                 | Skip login check — **local development only**                                            |
| `ML_ENGINE_OFFLINE`               | `false`                 | Serve pre-warmed runs only; never calls EE or Gemini                                     |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | —                       | Google Maps API key                                                                      |

> **Never commit your `.env` file.** It is excluded by `.gitignore`.

---

## Running the Development Server

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

| URL                          | Description                           |
| ---------------------------- | ------------------------------------- |
| http://localhost:8000/docs   | Swagger UI (interactive API explorer) |
| http://localhost:8000/redoc  | ReDoc documentation                   |
| http://localhost:8000/health | Health check                          |

---

## Google Earth Engine Setup

```bash
uv run earthengine authenticate
```

Your Google account must have access to the Earth Engine project set in `EE_PROJECT`.
Set this in `backend/.env` before running the ML pipeline.

---

## Running Tests

```bash
uv run pytest tests/ -v
```

With coverage:
```bash
uv run pytest tests/ -v --cov=app --cov-report=term-missing
```

ML engine tests:
```bash
uv run pytest ml_engine/tests -q
```

---

## Linting

```bash
uv run ruff check app/ tests/
uv run ruff check --fix app/ tests/   # auto-fix where possible
```

---

## API Reference

### Auth

| Method | Path                 | Auth | Description                  |
| ------ | -------------------- | ---- | ---------------------------- |
| `POST` | `/api/v1/auth/login` | None | Authenticate and receive JWT |

### ML / Analysis

| Method | Path                       | Auth | Description                             |
| ------ | -------------------------- | ---- | --------------------------------------- |
| `GET`  | `/api/v1/downscale/map`    | User | 250 m NO₂ map for an area and date      |
| `GET`  | `/api/v1/trends/predict`   | User | NO₂ plume forecast for a point          |
| `POST` | `/api/v1/analyze/pinpoint` | User | Top pollution sources near a coordinate |
| `POST` | `/api/v1/reports/generate` | User | Stream PDF air quality report           |
| `POST` | `/api/v1/reports/analysis` | User | Report data as JSON (no Gemini call)    |

### Admin

| Method | Path                        | Auth  | Description                 |
| ------ | --------------------------- | ----- | --------------------------- |
| `GET`  | `/api/v1/admin/users`       | Admin | List all registered users   |
| `POST` | `/api/v1/admin/users/block` | Admin | Block or unblock a user     |
| `POST` | `/api/v1/admin/data/upload` | Admin | Upload a geospatial dataset |

### Static Files

Produced ML engine outputs (GeoTIFFs, GeoJSON, NetCDF) are served under `/files/...`.

---

## Project Structure

```
backend/
├── .env.example              # Environment variable template (safe to commit)
├── pyproject.toml            # Project metadata and dependencies
├── main.py                   # Entry point
├── app/
│   ├── main.py               # FastAPI app, CORS, router registration
│   ├── dependencies.py       # get_current_user, require_admin
│   ├── core/
│   │   ├── config.py         # Settings (pydantic-settings) + Supabase factory
│   │   └── security.py       # JWT decode utility
│   ├── models/               # Pydantic request/response models
│   ├── services/             # Business logic (async, accept supabase client)
│   ├── agent/                # LangGraph agent for chatbot
│   └── api/v1/               # Route handlers (thin, delegate to services)
├── ml_engine/                # Satellite processing pipeline
│   ├── README.md             # ML engine documentation
│   ├── pipeline.py           # End-to-end orchestration
│   ├── service.py            # Python API: generate_map(), forecast_point()
│   ├── gap_fill.py           # Random Forest cloud gap-filling
│   ├── downscaling/          # XGBoost 250 m downscaling
│   ├── forecasting/          # Dispersion solver + global downloader
│   ├── report/               # PDF report generation (English/Hindi/Marathi)
│   ├── ingestion/            # OpenAQ + CPCB data downloaders
│   └── pretrained/           # Pre-trained model weights
├── data/                     # Station CSVs, sample GeoTIFFs
└── tests/                    # pytest async test suite
```

---

## ML Engine Quick Reference

```bash
# Offline smoke test — no Earth Engine needed
uv run python -m ml_engine --source synthetic

# Run on a real city (requires EE_PROJECT in .env)
uv run python -m ml_engine --source gee --city Mumbai --start 2025-11-01 --end 2025-12-31

# Run on local GeoTIFF files
uv run python -m ml_engine --source files --input-dir data/inputs/mumbai_2025-11-01_to_2025-12-31

# Pre-warm for offline presentation
uv run python -m ml_engine.prewarm --globe --ai --report Mumbai:2025-12-31
```

See [`ml_engine/README.md`](ml_engine/README.md) for full documentation.

---

## Notes

- CORS is set to `allow_origins=["*"]` for development — **restrict to specific domains in production**.
- Activity logging (`user_activity_logs`) is fault-tolerant: a logging failure never breaks a user request.
- `LOCAL_DEMO_MODE=true` bypasses authentication — **never use on a public-facing server**.
