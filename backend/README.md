# Air Quality Downscaling & Analysis — Backend

FastAPI backend for the AI/ML Satellite-Based Air Quality Downscaling & Analysis System.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | ≥ 3.10 |
| [uv](https://github.com/astral-sh/uv) | ≥ 0.4.0 |
| Supabase project | with tables defined in the spec |

---

## Installation

Install all dependencies (including dev tools) with `uv`:

```bash
cd backend
uv sync
```

---

## Environment Setup

Copy the example environment file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret
```

> **Important**: The app will crash on startup with a clear validation error if any of these three variables are missing.

---

## Running the Development Server

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **Health check**: http://localhost:8000/health

---

## Running Tests

```bash
uv run pytest tests/ -v
```

With coverage:

```bash
uv run pytest tests/ -v --cov=app --cov-report=term-missing
```

---

## Linting

```bash
uv run ruff check app/ tests/
```

Auto-fix where possible:

```bash
uv run ruff check --fix app/ tests/
```

---

## API Overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/auth/login` | None | Authenticate and get access token |
| `GET` | `/api/v1/downscale/map` | User | Get downscaled air quality map metadata |
| `GET` | `/api/v1/trends/predict` | User | Get NO2 trend predictions |
| `POST` | `/api/v1/analyze/pinpoint` | User | Identify top pollution sources near a point |
| `POST` | `/api/v1/reports/generate` | User | Download a PDF air quality report |
| `GET` | `/api/v1/admin/users` | Admin | List all registered users |
| `POST` | `/api/v1/admin/users/block` | Admin | Block or unblock a user |
| `POST` | `/api/v1/admin/data/upload` | Admin | Upload a geospatial dataset |
| `GET` | `/health` | None | Health check |

---

## Project Structure

```
backend/
├── pyproject.toml          # Project metadata and dependencies
├── .env.example            # Environment variable template
├── app/
│   ├── main.py             # FastAPI app, CORS, router registration
│   ├── dependencies.py     # get_current_user, require_admin
│   ├── core/
│   │   ├── config.py       # Settings (pydantic-settings) + Supabase factory
│   │   └── security.py     # JWT decode utility
│   ├── models/             # Pydantic request/response models
│   ├── services/           # Business logic (async, accept supabase client)
│   └── api/v1/             # Route handlers (thin, delegate to services)
└── tests/                  # pytest async test suite
```

---

## Notes

- ML inference endpoints return **realistic stub data** with `# TODO: integrate ML engine` comments — replace with actual model calls when the ML engine is ready.
- CORS is configured to allow all origins (`*`) for development. Restrict `allow_origins` in production.
- Activity logging (`user_activity_logs`) is fault-tolerant — a logging failure will never break a user request.
