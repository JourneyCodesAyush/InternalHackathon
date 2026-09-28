import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import landTopo from 'world-atlas/land-110m.json';
import { countryRings } from './countries';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/** GET /api/v1/globe/no2, decoded. Grids are north-up rows from 90°N, columns from 180°W. */
export interface GlobalSnapshot {
  fetchedAt: string;
  newestObs: string | null;
  oldestObs: string | null;
  windAnalysis: string | null;
  windSource: string;
  quantity: string;
  units: string;
  coverage: number;
  stale: boolean;
  frozen: boolean; // offline mode: the stored snapshot, no live refresh
  /** 'bundled': real snapshot shipped with the backend; 'simulated': generated in the browser. */
  demo: 'bundled' | 'simulated' | null;
  hours: number;
  resDeg: number;
  width: number;
  height: number;
  no2: Float32Array; // NaN = no observation
  ageH: Float32Array; // hours before fetchedAt, NaN = no observation
  u: Float32Array;
  v: Float32Array;
}

interface Field {
  scale: number;
  data: string;
}

function decode(field: Field, nodata: number, n: number): Float32Array {
  const bytes = Uint8Array.from(atob(field.data), (ch) => ch.charCodeAt(0));
  const ints = new Int16Array(bytes.buffer, 0, n);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = ints[k] === nodata ? NaN : ints[k] * field.scale;
  return out;
}

export async function fetchGlobalSnapshot(hours = 24, signal?: AbortSignal): Promise<GlobalSnapshot> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : null;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/globe/no2?hours=${hours}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new Error(`Cannot reach the backend at ${API_BASE}. Is it running?`);
  }
  if (res.status === 401) throw new Error('Please log in to view the global layer.');
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ? String(body.detail) : `Global NO₂ request failed (HTTP ${res.status}).`);
  }
  const j = await res.json();
  const n = j.width * j.height;
  const nan = (a: Float32Array) => a.map((x) => (Number.isFinite(x) ? x : 0));
  return {
    fetchedAt: j.fetched_at,
    newestObs: j.newest_obs,
    oldestObs: j.oldest_obs,
    windAnalysis: j.wind_analysis,
    windSource: j.wind_source,
    quantity: j.quantity,
    units: j.units,
    coverage: j.coverage,
    stale: j.stale,
    frozen: Boolean(j.frozen),
    demo: j.demo ? 'bundled' : null,
    hours: j.hours,
    resDeg: j.res_deg,
    width: j.width,
    height: j.height,
    no2: decode(j.fields.no2, j.nodata, n),
    ageH: decode(j.fields.age_h, j.nodata, n),
    u: nan(decode(j.fields.u, j.nodata, n)),
    v: nan(decode(j.fields.v, j.nodata, n)),
  };
}

/**
 * Equirectangular base layers (north at the top, 180°W at the left): ``base`` is ocean, graticule and land;
 * ``lines`` is coastlines and borders on transparent, drawn by the globe shader above the NO₂ layer so
 * the geography stays readable under dense pollution.
 */
export function drawBaseMap(width = 4096): { base: HTMLCanvasElement; lines: HTMLCanvasElement } {
  const height = width / 2;
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return { canvas, ctx: canvas.getContext('2d')! };
  };
  const px = ([lon, lat]: Position): [number, number] => [((lon + 180) / 360) * width, ((90 - lat) / 180) * height];
  const traceRing = (ctx: CanvasRenderingContext2D, ring: Position[]) => {
    ring.forEach((p, idx) => {
      const [x, y] = px(p);
      // break segments that jump across the dateline instead of drawing a line around the world
      if (idx === 0 || Math.abs(p[0] - ring[idx - 1][0]) > 180) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  };

  const base = make();
  base.ctx.fillStyle = '#0a1120';
  base.ctx.fillRect(0, 0, width, height);
  base.ctx.strokeStyle = 'rgba(96, 125, 170, 0.12)';
  base.ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    base.ctx.beginPath();
    base.ctx.moveTo(...px([lon, 90]));
    base.ctx.lineTo(...px([lon, -90]));
    base.ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    base.ctx.beginPath();
    base.ctx.moveTo(...px([-180, lat]));
    base.ctx.lineTo(...px([180, lat]));
    base.ctx.stroke();
  }

  const lines = make();
  const landTopology = landTopo as unknown as Topology;
  const land = feature(landTopology, landTopology.objects.land as GeometryCollection);
  base.ctx.fillStyle = '#18233a';
  lines.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  lines.ctx.lineWidth = 2.2;
  for (const f of land.features) {
    const g = f.geometry as Polygon | MultiPolygon;
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polygons) {
      base.ctx.beginPath();
      lines.ctx.beginPath();
      poly.forEach((ring) => {
        traceRing(base.ctx, ring);
        traceRing(lines.ctx, ring);
      });
      base.ctx.fill('evenodd');
      lines.ctx.stroke();
    }
  }

  lines.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  lines.ctx.lineWidth = 1.2;
  lines.ctx.beginPath();
  for (const ring of countryRings()) traceRing(lines.ctx, ring); // India's official boundary (see countries.ts)
  lines.ctx.stroke();
  return { base: base.canvas, lines: lines.canvas };
}

export function hoursAgo(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.replace('Z', ':00Z'));
  return Number.isFinite(t) ? (now - t) / 3_600_000 : null;
}

// ------------------------------------------------------------------------------------------ demo layer
/** Major NO₂ regions: [lat, lon, peak µmol/m² above background, radius °]. */
const DEMO_HOTSPOTS: [number, number, number, number][] = [
  [26.5, 81, 70, 4], [23.5, 86, 80, 2], [24.1, 82.6, 90, 1.2], [28.6, 77.2, 110, 1.2], [19.1, 72.9, 60, 0.8],
  [13, 77.6, 45, 0.8], [22.6, 88.4, 70, 1], [31.5, 74.3, 70, 1.2], [24.9, 67, 45, 0.8], [23.8, 90.4, 60, 1],
  [37.5, 115.5, 140, 3], [39.9, 116.4, 150, 1.2], [31.2, 121, 130, 1.5], [23, 113.3, 100, 1.2], [30.6, 114.3, 80, 1],
  [34.3, 108.9, 70, 1], [41.8, 123.4, 80, 1.5], [37.5, 127, 110, 1], [35.5, 139.5, 90, 1], [34.7, 135.5, 70, 0.8],
  [26.2, 50.2, 90, 1.5], [29.3, 48, 90, 1], [25.3, 51.5, 70, 0.8], [25.2, 55.3, 80, 1], [35.7, 51.4, 100, 1],
  [30.5, 48.5, 70, 1.2], [24.7, 46.7, 70, 1], [30.1, 31.3, 90, 1], [41, 29, 70, 1], [55.8, 37.6, 80, 1.2],
  [51.4, 7, 90, 1.5], [51.5, -0.1, 80, 1], [52, 4.5, 90, 1], [48.9, 2.35, 70, 1], [45.4, 9.5, 70, 1.5],
  [50.3, 19, 60, 1.2], [-26.3, 29.2, 130, 1.5], [-26.2, 28, 90, 0.8], [6.5, 3.4, 60, 1], [4.8, 6.9, 45, 1.2],
  [40.7, -74, 90, 1.2], [34, -118.2, 100, 1], [41.9, -87.6, 70, 1], [29.8, -95.4, 60, 1], [32, -102, 45, 1.5],
  [19.4, -99.1, 100, 1], [25.7, -100.3, 55, 0.8], [43.7, -79.4, 55, 0.8], [57, -111.5, 45, 1], [-23.5, -46.6, 80, 1],
  [-22.9, -43.2, 55, 0.8], [-34.6, -58.4, 60, 0.8], [-33.4, -70.6, 60, 0.8], [-6.2, 106.8, 80, 1], [13.8, 100.5, 60, 0.8],
  [21, 105.8, 55, 0.8], [10.8, 106.7, 50, 0.8], [-33.9, 151, 50, 0.8], [-37.8, 145, 40, 0.8], [-32.4, 151, 60, 0.6],
  [-38.2, 146.5, 55, 0.5], [47.9, 106.9, 60, 0.8], [43.2, 76.9, 45, 0.8], [51.7, 75.3, 50, 1], [48, 37.8, 50, 1.2],
  [-10, 25, 35, 6], [-12, 17, 30, 5], [-9, -55, 30, 6], [9, 8, 30, 5],
];

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * A plausible stand-in layer for when neither Earth Engine nor the backend is reachable: background column,
 * the major emission regions above, satellite-like cloud gaps and a daily swath age pattern, and the
 * climatological wind belts (trade easterlies, mid-latitude westerlies, polar easterlies). Clearly flagged
 * as demo data; the values are illustrative, not observations.
 */
export function syntheticSnapshot(now = Date.now()): GlobalSnapshot {
  const width = 720;
  const height = 360;
  const res = 0.5;
  const rand = seeded(20260927);
  const waves = Array.from({ length: 6 }, () => ({ kx: 1 + rand() * 6, ky: 1 + rand() * 5, p: rand() * Math.PI * 2 }));
  const no2 = new Float32Array(width * height);
  const ageH = new Float32Array(width * height);
  const u = new Float32Array(width * height);
  const v = new Float32Array(width * height);
  const utcHours = (now / 3_600_000) % 24;
  for (let j = 0; j < height; j++) {
    const lat = 90 - (j + 0.5) * res;
    const phi = (lat * Math.PI) / 180;
    // zonal wind belts (m/s) with a little meridional structure
    const absLat = Math.abs(lat);
    const zonal = absLat < 28 ? -6 * Math.cos((absLat / 28) * (Math.PI / 2)) : absLat < 62 ? 9 * Math.sin(((absLat - 28) / 34) * Math.PI) : -3;
    for (let i = 0; i < width; i++) {
      const lon = -180 + (i + 0.5) * res;
      const lam = (lon * Math.PI) / 180;
      const k = j * width + i;
      let texture = 0;
      for (const w of waves) texture += Math.sin(w.kx * lam + w.p) * Math.cos(w.ky * phi + w.p * 0.7);
      let c = 4 + 1.5 * (texture / waves.length) + rand() * 1.2;
      for (const [hl, hn, peak, r] of DEMO_HOTSPOTS) {
        const dLat = lat - hl;
        if (Math.abs(dLat) > r * 12) continue;
        let dLon = lon - hn;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const dx = dLon * Math.cos(phi);
        const d2 = dx * dx + dLat * dLat;
        // sharp core plus a broad regional haze (industrial belts, outflow), as in the real columns
        if (d2 < 16 * r * r) c += peak * Math.exp(-d2 / (2 * r * r)) * (0.75 + 0.5 * rand());
        if (d2 < 144 * r * r) c += 0.12 * peak * Math.exp(-d2 / (18 * r * r)) * (0.8 + 0.4 * rand());
      }
      // clouds: smooth pseudo-random gaps (~45%), none of the polar night in the south
      const cloud = Math.sin(3.1 * lam + 2 * phi + 1.3) + Math.sin(5.3 * lam - 4 * phi) + Math.sin(7.7 * phi + 0.5 * lam + 4);
      const observed = cloud < 0.55 && lat > -68 && lat < 80;
      no2[k] = observed ? c : NaN;
      // local overpass ~13:30: age = hours since 13:30 local solar time at this longitude
      const localHours = (utcHours + lon / 15 + 24) % 24;
      ageH[k] = observed ? ((localHours - 13.5 + 24) % 24) + 3 : NaN;
      u[k] = zonal + 2 * Math.sin(3 * lam + phi * 2);
      v[k] = 2.5 * Math.sin(2 * lam - phi * 3) * Math.cos(phi);
    }
  }
  const iso = new Date(now).toISOString().slice(0, 16) + 'Z';
  return {
    fetchedAt: iso,
    newestObs: null,
    oldestObs: null,
    windAnalysis: null,
    windSource: 'climatological wind belts (demo)',
    quantity: 'Simulated tropospheric NO₂ column (demo)',
    units: 'µmol/m²',
    coverage: 0.45,
    stale: true,
    frozen: false,
    demo: 'simulated',
    hours: 24,
    resDeg: res,
    width,
    height,
    no2,
    ageH,
    u,
    v,
  };
}
