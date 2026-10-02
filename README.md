# AirQ — AI/ML Satellite-Based Air Quality Platform

> **Internal Hackathon Project** · Satellite NO₂ downscaling, forecasting, drone simulation & real-time air quality intelligence for Indian cities.

---

## Overview

AirQ transforms coarse Sentinel-5P satellite NO₂ measurements (~3.9 km resolution, with cloud gaps) into **gap-free 250 m ground-level NO₂ maps** for any Indian city — then surfaces them through an interactive web dashboard with AI-generated area reports, plume forecasting, drone swarm simulation, and an LLM-powered chatbot.

### Key Capabilities

| Feature                | Description                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------ |
| **250 m NO₂ Maps**     | Gap-filled, downscaled ground-level NO₂ from Sentinel-5P via XGBoost + Random Forest |
| **Plume Forecasting**  | +1/+3/+6/+24 h advection–diffusion dispersion solver                                 |
| **AI Area Reports**    | Multilingual PDF reports (English, Hindi, Marathi) with optional Gemini narrative    |
| **Source Attribution** | XAI pinpoint analysis identifying pollution contributors near any point              |
| **Global NO₂ Globe**   | Interactive 3D globe showing global satellite NO₂                                    |
| **Drone Swarm Sim**    | Physics-based drone fleet simulation for air quality monitoring paths                |
| **Chatbot**            | Gemini-powered Q&A over local air quality data                                       |

---

## Repository Structure

```
CompsInternal/
├── backend/          # FastAPI backend + ML engine (Python / uv)
│   ├── app/          # API routes, services, dependencies
│   ├── ml_engine/    # Satellite pipeline: gap-fill → downscale → forecast → report
│   ├── data/         # Station CSVs, sample inputs, data documentation
│   └── tests/        # pytest async test suite
├── frontend/         # Next.js 16 web application (TypeScript)
│   ├── app/          # Pages: map, globe, chatbot, drone, reports, upload …
│   └── lib/          # Shared utilities and API client
└── Software Requirements Specification.docx
```

---

## Quick Start

### Prerequisites

| Tool                                  | Version | Purpose                    |
| ------------------------------------- | ------- | -------------------------- |
| Python                                | ≥ 3.12  | Backend / ML engine        |
| [uv](https://github.com/astral-sh/uv) | ≥ 0.4.0 | Python package manager     |
| Node.js                               | ≥ 20    | Frontend                   |
| Supabase project                      | —       | Auth + database            |
| Google Earth Engine                   | —       | Satellite data (free tier) |

### 1. Clone & configure environment

```bash
git clone <repo-url>
cd CompsInternal
```

**Backend:**
```bash
cd backend
cp .env.example .env
# Edit .env — add Supabase credentials, EE_PROJECT, and optionally GEMINI_API_KEY
```

**Frontend:**
```bash
cd frontend
cp .env.example .env.local
# Edit .env.local — add Supabase URL/key and Google Maps API key
```

### 2. Start the backend

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs → http://localhost:8000/docs

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

App → http://localhost:3000

---

## Environment Variables

### Backend (`backend/.env`)

See [`backend/.env.example`](backend/.env.example) for the full template.

| Variable              | Required | Description                                     |
| --------------------- | -------- | ----------------------------------------------- |
| `SUPABASE_URL`        | ✅        | Supabase project URL                            |
| `SUPABASE_KEY`        | ✅        | Supabase anon/publishable key                   |
| `SUPABASE_JWT_SECRET` | ✅        | JWT secret for token verification               |
| `EE_PROJECT`          | ✅        | Google Cloud project with Earth Engine enabled  |
| `OPENAQ_API_KEY`      | Optional | For downloading fresh OpenAQ station data       |
| `GEMINI_API_KEY`      | Optional | Enables AI narrative in PDF reports             |
| `LOCAL_DEMO_MODE`     | Optional | Skip login on a local machine                   |
| `ML_ENGINE_OFFLINE`   | Optional | Serve pre-warmed data only (no EE/Gemini calls) |

### Frontend (`frontend/.env.local`)

See [`frontend/.env.example`](frontend/.env.example) for the full template.

| Variable                               | Required | Description                    |
| -------------------------------------- | -------- | ------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | ✅        | Supabase project URL           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅        | Supabase publishable key       |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`      | ✅        | Google Maps JavaScript API key |
| `LOCAL_DEMO_MODE`                      | Optional | Skip login on a local machine  |

> **Never commit `.env` or `.env.local` files.** They are excluded by `.gitignore`.

---

## Architecture

```
                    ┌─────────────────────────────────┐
                    │          Frontend (Next.js)       │
                    │  Map · Globe · Reports · Chatbot  │
                    └────────────────┬─────────────────┘
                                     │ REST / JSON
                    ┌────────────────▼─────────────────┐
                    │         Backend (FastAPI)          │
                    │  Auth · Routes · Services          │
                    └──────┬──────────────┬─────────────┘
                           │              │
           ┌───────────────▼──┐     ┌─────▼─────────────┐
           │   ml_engine       │     │    Supabase         │
           │  Gap-fill         │     │  Auth · DB          │
           │  Downscale        │     └───────────────────-─┘
           │  Forecast         │
           │  Report (PDF)     │
           └──────┬────────────┘
                  │
     ┌────────────▼──────────┐
     │  Google Earth Engine   │
     │  Sentinel-5P · ERA5    │
     │  GEOS-CF · NASADEM     │
     └───────────────────────┘
```

---

## Documentation

- **[Backend README](backend/README.md)** — FastAPI setup, API reference, testing
- **[ML Engine README](backend/ml_engine/README.md)** — Pipeline details, Python API, accuracy metrics, offline demo mode
- **[Frontend README](frontend/README.md)** — Next.js setup, pages, environment config
- **[Data README](backend/data/README.md)** — Station data format, Earth Engine downloads, CPCB processing

---

## Security

- All secrets are loaded from environment variables — **no keys are committed to the repository**
- `.env` and `.env.local` files are in `.gitignore`
- Use `.env.example` files as templates (they contain only placeholder values)
- `LOCAL_DEMO_MODE=true` is for local development only — never use on a public server
- Restrict CORS `allow_origins` from `*` to specific domains before deploying to production
