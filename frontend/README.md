# AirQ Frontend — Next.js Web Application

Interactive air quality dashboard built with Next.js 16, TypeScript, and deck.gl / MapLibre GL.

---

## Prerequisites

| Tool    | Version |
| ------- | ------- |
| Node.js | ≥ 20    |
| npm     | ≥ 10    |

---

## Installation

```bash
cd frontend
npm install
```

---

## Environment Setup

Copy the example file and fill in your credentials:

```bash
cp .env.example .env.local
```

### Variables

| Variable                               | Required | Description                                                                                   |
| -------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | ✅        | Supabase project URL (`https://<ref>.supabase.co`)                                            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅        | Supabase publishable (anon) key                                                               |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`      | ✅        | Google Maps JavaScript API key ([get one](https://console.cloud.google.com/google/maps-apis)) |
| `LOCAL_DEMO_MODE`                      | Optional | Set to `true` to bypass login — **local development only**                                    |

> **Never commit `.env.local`** — it is excluded by `.gitignore`.

---

## Running Locally

```bash
npm run dev
```

App → http://localhost:3000

The dev server starts with `next dev -H 0.0.0.0` so it is accessible from other devices on your network.

> **Note:** A MapLibre worker script is automatically copied before each dev/build run (`scripts/copy-maplibre-worker.mjs`). This is wired into the `predev` and `prebuild` scripts in `package.json` — no manual step needed.

---

## Production Build

```bash
npm run build
npm run start
```

---

## Linting

```bash
npm run lint
```

---

## Pages

| Route            | Description                                       |
| ---------------- | ------------------------------------------------- |
| `/`              | Landing page / dashboard home                     |
| `/map`           | Interactive 250 m NO₂ map (deck.gl + MapLibre GL) |
| `/globe`         | Global satellite NO₂ 3D globe (Three.js)          |
| `/visualization` | Data visualisation and trend charts               |
| `/reports`       | Area air quality PDF report generator             |
| `/chatbot`       | Gemini-powered air quality chatbot                |
| `/drone`         | Single-drone air quality monitoring simulation    |
| `/swarm`         | Multi-drone swarm simulation                      |
| `/simulator`     | Pollution dispersion simulator                    |
| `/upload`        | Admin: upload geospatial datasets                 |
| `/keys`          | Admin: manage Google Maps API key pool            |
| `/login`         | Authentication                                    |
| `/signup`        | New user registration                             |

---

## Key Dependencies

| Package                     | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `next` 16                   | React framework with App Router               |
| `@supabase/supabase-js`     | Auth and database client                      |
| `@deck.gl/*`                | WebGL-powered geospatial visualisation layers |
| `maplibre-gl`               | Open-source WebGL map renderer                |
| `three`                     | 3D globe rendering                            |
| `leaflet` + `react-leaflet` | Fallback 2D map tiles                         |
| `chroma-js`                 | Colour scale utilities for NO₂ heatmaps       |
| `lucide-react`              | Icon library                                  |
| `react-dropzone`            | File upload drag-and-drop                     |
| `geotiff`                   | Client-side GeoTIFF parsing                   |
| `tailwindcss` v4            | Utility-first CSS                             |

---

## Project Structure

```
frontend/
├── .env.example              # Environment variable template (safe to commit)
├── next.config.ts            # Next.js configuration
├── app/
│   ├── layout.tsx            # Root layout (fonts, global providers)
│   ├── globals.css           # Global styles
│   ├── page.tsx              # Landing page
│   ├── map/                  # NO₂ map page
│   ├── globe/                # 3D NO₂ globe page
│   ├── visualization/        # Charts and trend data
│   ├── reports/              # PDF report UI
│   ├── chatbot/              # LLM chatbot UI
│   ├── drone/                # Single-drone simulation
│   ├── swarm/                # Drone swarm simulation
│   ├── simulator/            # Dispersion simulator
│   ├── upload/               # Admin dataset upload
│   ├── keys/                 # Admin API key management
│   ├── login/                # Auth pages
│   ├── signup/
│   ├── api/                  # Next.js API routes (thin proxies to FastAPI)
│   └── components/           # Shared UI components
├── lib/                      # API client, utilities, type definitions
├── public/                   # Static assets
└── scripts/
    └── copy-maplibre-worker.mjs  # Pre-build worker script
```

---

## Connecting to the Backend

The frontend expects the FastAPI backend at `http://localhost:8000` by default.
To change this, update the base URL in `lib/` (look for the API client configuration).

Ensure the backend is running before using the map, reports, or chatbot features.

---

## Notes

- The Google Maps API key is managed in two places: the `.env.local` file (for server-side and initial load) and optionally via the `/keys` admin page (for runtime rotation from a key pool stored in Supabase).
- `LOCAL_DEMO_MODE=true` disables the login requirement — useful for demos on a local machine, but **never deploy with this enabled**.
