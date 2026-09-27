/**
 * The ML engine's outputs for the web app: upload daily NO₂ GeoTIFFs, follow the job, and load the model's
 * 250 m ground-level NO₂ map (µg/m³) that the Geospatial Map heatmap and pinpoint panel show.
 */
import { fromArrayBuffer } from 'geotiff';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface JobStats {
  days: number;
  first_date: string;
  last_date: string;
  bbox: [number, number, number, number];
  coarse_resolution_m: number;
  fine_resolution_m: number;
  cloud_cover_input_pct: number;
  cloud_cover_last_day_pct: number;
  cloud_cover_output_pct: number;
  mean_no2_ugm3: number;
  peak_no2_ugm3: number;
  gapfill_r2: number;
  downscale_r2: number;
  processing_seconds: number;
}

export interface JobStatus {
  job_id: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  stage: string;
  progress: number;
  error: string | null;
  stats: JobStats | null;
  first_date?: string;
  last_date?: string;
}

export interface ModelGrid {
  values: Float32Array; // row-major, north-up; NaN = no data
  width: number;
  height: number;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  date: string | null;
  source: string | null; // "upload" | "run"
  jobId: string | null;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorText(res: Response, what: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.detail ? String(body.detail) : `${what} failed (HTTP ${res.status})`;
}

export async function uploadFiles(files: File[]): Promise<JobStatus> {
  const form = new FormData();
  files.forEach((f) => form.append('files', f, f.name));
  const res = await fetch(`${API_BASE}/api/v1/downscale/upload`, { method: 'POST', headers: authHeaders(), body: form });
  if (!res.ok) throw new Error(await errorText(res, 'Upload'));
  return res.json();
}

export async function getJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${API_BASE}/api/v1/downscale/jobs/${jobId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await errorText(res, 'Job status'));
  return res.json();
}

export function geotiffUrl(opts: { jobId?: string | null; kind?: 'surface' | 'raw'; date?: string } = {}): string {
  const q = new URLSearchParams();
  if (opts.jobId) q.set('job_id', opts.jobId);
  if (opts.date) q.set('date', opts.date);
  if (opts.kind) q.set('kind', opts.kind);
  const qs = q.toString();
  return `${API_BASE}/api/v1/downscale/geotiff${qs ? `?${qs}` : ''}`;
}

/** Download and decode a model GeoTIFF (default: the newest model output). */
export async function fetchModelGrid(opts: { jobId?: string | null; kind?: 'surface' | 'raw' } = {}): Promise<ModelGrid> {
  const res = await fetch(geotiffUrl(opts), { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(await errorText(res, 'Model output'));
  const tiff = await fromArrayBuffer(await res.arrayBuffer());
  const image = await tiff.getImage();
  const [minX, minY, maxX, maxY] = image.getBoundingBox();
  const raster = (await image.readRasters())[0] as ArrayLike<number>;
  const noData = image.getGDALNoData();
  const values = new Float32Array(raster.length);
  for (let k = 0; k < raster.length; k++) {
    const v = raster[k];
    values[k] = Number.isFinite(v) && (noData === null || v !== noData) ? v : NaN;
  }
  return {
    values,
    width: image.getWidth(),
    height: image.getHeight(),
    bbox: [minX, minY, maxX, maxY],
    date: res.headers.get('X-Model-Date'),
    source: res.headers.get('X-Model-Source'),
    jobId: res.headers.get('X-Model-Job') || null,
  };
}

/** Model value at a point (bilinear-free: the containing 250 m cell), or null outside the map / in a gap. */
export function sampleGrid(grid: ModelGrid | null, lat: number, lng: number): number | null {
  if (!grid) return null;
  const [minX, minY, maxX, maxY] = grid.bbox;
  if (lng < minX || lng >= maxX || lat <= minY || lat > maxY) return null;
  const i = Math.floor(((lng - minX) / (maxX - minX)) * grid.width);
  const j = Math.floor(((maxY - lat) / (maxY - minY)) * grid.height);
  const v = grid.values[j * grid.width + i];
  return Number.isFinite(v) ? v : null;
}

// One shared download of the newest model output for the map page (heatmap + pinpoint panel)
let latestPromise: Promise<ModelGrid> | null = null;
let latestStarted = 0;
const REUSE_MS = 5000; // components mounting together share one download

export function loadLatestModelGrid(refresh = false): Promise<ModelGrid> {
  const recent = Date.now() - latestStarted < REUSE_MS;
  if (!latestPromise || (refresh && !recent)) {
    latestStarted = Date.now();
    latestPromise = fetchModelGrid().catch((e) => {
      latestPromise = null; // retry on the next request
      throw e;
    });
  }
  return latestPromise;
}

/** Render a grid to a PNG data URL with a colour function (for previews). */
export function gridToDataUrl(grid: ModelGrid, color: (v: number) => [number, number, number, number]): string {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(grid.width, grid.height);
  for (let k = 0; k < grid.values.length; k++) {
    const [r, g, b, a] = Number.isFinite(grid.values[k]) ? color(grid.values[k]) : [0, 0, 0, 0];
    img.data.set([r, g, b, a], k * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
