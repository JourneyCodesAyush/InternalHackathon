'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Deck } from '@deck.gl/core';
import { BitmapLayer } from '@deck.gl/layers';
import { fromArrayBuffer } from 'geotiff';
import chroma from 'chroma-js';

// ─── Stub switch ─────────────────────────────────────────────────────────────
/**
 * When true the component generates synthetic raster data in-memory and never
 * calls the backend. Flip to false when the ML pipeline is ready.
 */
const USE_STUB_DATA = false;

// ─── Constants ────────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:8000';

/** AQI-style NO₂ color scale matching the WHO / EPA breakpoints */
const NO2_SCALE = chroma
  .scale(['#10b981', '#eab308', '#f97316', '#ef4444', '#9333ea', '#6b1124'])
  .domain([0, 40, 80, 120, 160, 200])
  .mode('lch');

/** Width / height of the stub grid */
const STUB_WIDTH = 100;
const STUB_HEIGHT = 100;
/** Mumbai bounding box used by both stub and real data */
const MUMBAI_BBOX: [number, number, number, number] = [72.7, 18.8, 73.2, 19.3];

// ─── Types ───────────────────────────────────────────────────────────────────
export interface BandData {
  no2: Float32Array;
  u: Float32Array;
  v: Float32Array;
  width: number;
  height: number;
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
}

export interface GeoTiffLayerProps {
  currentTimestamp: string | null;
  nextTimestamp: string | null;
  interpolationFactor: number;
  deckRef: React.MutableRefObject<Deck | null>;
  visible: boolean;
  onBandDataReady?: (current: BandData | null, next: BandData | null) => void;
}

// ─── Stub data generation ────────────────────────────────────────────────────
function smooth(x: number, y: number, w: number, h: number, seed: number): number {
  const fx = x / w;
  const fy = y / h;
  const base =
    (Math.sin(fx * Math.PI * 3 + seed * 0.7) * 0.5 + 0.5) *
    (Math.cos(fy * Math.PI * 2.5 - seed * 0.4) * 0.5 + 0.5);
  const noise = Math.sin(fx * 31.7 + fy * 17.3 + seed) * 0.1;
  return Math.max(0, Math.min(250, (base + noise) * 160 + 20));
}

function generateStubBandData(timestamp: string | null): BandData {
  const seed = timestamp
    ? (new Date(timestamp).getTime() - new Date('2024-01-01T00:00:00Z').getTime()) / 1_800_000
    : 0;

  const n = STUB_WIDTH * STUB_HEIGHT;
  const no2 = new Float32Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);

  for (let y = 0; y < STUB_HEIGHT; y++) {
    for (let x = 0; x < STUB_WIDTH; x++) {
      const i = y * STUB_WIDTH + x;
      const fx = x / STUB_WIDTH;
      const fy = y / STUB_HEIGHT;
      no2[i] = smooth(x, y, STUB_WIDTH, STUB_HEIGHT, seed);
      u[i] = 2 + Math.sin(fx * Math.PI + seed * 0.5) * 3;
      v[i] = 1 + Math.cos(fy * Math.PI - seed * 0.3) * 2;
    }
  }

  return { no2, u, v, width: STUB_WIDTH, height: STUB_HEIGHT, bbox: MUMBAI_BBOX };
}

// ─── GeoTIFF parsing ─────────────────────────────────────────────────────────
async function parseGeoTiff(buffer: ArrayBuffer): Promise<BandData> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const rawBbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
  const bbox: [number, number, number, number] = [
    rawBbox[0],
    rawBbox[1],
    rawBbox[2],
    rawBbox[3],
  ];
  const width = image.getWidth();
  const height = image.getHeight();

  // readRasters returns one TypedArray per band
  const rasters = await image.readRasters();
  const no2 = rasters[0] as Float32Array;
  const u = rasters[1] as Float32Array;
  const v = rasters[2] as Float32Array;

  return { no2, u, v, width, height, bbox };
}

// ─── Pixel rendering ─────────────────────────────────────────────────────────
function bandDataToImageBitmap(
  dataA: BandData,
  dataB: BandData,
  t: number,
): ImageBitmap {
  const { width, height } = dataA;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const no2Val = dataA.no2[i] * (1 - t) + dataB.no2[i] * t;
    const [r, g, b] = NO2_SCALE(no2Val).rgb();
    const base = i * 4;
    rgba[base] = r;
    rgba[base + 1] = g;
    rgba[base + 2] = b;
    rgba[base + 3] = 178; // ~70% opacity (0.7 * 255)
  }

  // Use OffscreenCanvas for performance (no DOM painting)
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const imageData = new ImageData(rgba, width, height);
  ctx.putImageData(imageData, 0, 0);
  // transferToImageBitmap is synchronous — returns ImageBitmap directly
  return canvas.transferToImageBitmap();
}

// ─── Error toast (no external lib) ───────────────────────────────────────────
function showError(msg: string): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed;top:20px;left:50%;transform:translateX(-50%);
    background:#7f1d1d;color:#fee2e2;padding:10px 20px;border-radius:8px;
    font-size:13px;z-index:9999;pointer-events:none;
    border:1px solid #991b1b;box-shadow:0 4px 20px rgba(0,0,0,0.6);
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function GeoTiffLayer({
  currentTimestamp,
  nextTimestamp,
  interpolationFactor,
  deckRef,
  visible,
  onBandDataReady,
}: GeoTiffLayerProps) {
  /** Cache: timestamp → parsed BandData */
  const cacheRef = useRef<Map<string, BandData>>(new Map());
  const currentBandRef = useRef<BandData | null>(null);
  const nextBandRef = useRef<BandData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const imageBitmapRef = useRef<ImageBitmap | null>(null);
  const rafRef = useRef<number | null>(null);

  // Keep a ref of the latest interpolationFactor so the rAF loop doesn't stale
  const tRef = useRef(interpolationFactor);
  tRef.current = interpolationFactor;

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // ── Fetch / generate a single timestamp ──────────────────────────────────
  const getBandData = useCallback(async (ts: string): Promise<BandData> => {
    if (cacheRef.current.has(ts)) return cacheRef.current.get(ts)!;

    if (USE_STUB_DATA) {
      const data = generateStubBandData(ts);
      cacheRef.current.set(ts, data);
      return data;
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
      showError('Please log in to view map data.');
      throw new Error('Not authenticated');
    }

    const res = await fetch(
      `${API_BASE}/api/v1/downscale/geotiff?timestamp=${encodeURIComponent(ts)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      const msg = `Failed to load data for ${ts} (${res.status})`;
      showError(msg);
      throw new Error(msg);
    }

    const buffer = await res.arrayBuffer();
    const data = await parseGeoTiff(buffer);
    cacheRef.current.set(ts, data);
    return data;
  }, []);

  // ── Load current + next bands whenever timestamps change ─────────────────
  useEffect(() => {
    if (!currentTimestamp) return;

    let cancelled = false;
    setIsLoading(true);

    const load = async () => {
      try {
        const [curr, nxt] = await Promise.all([
          getBandData(currentTimestamp),
          nextTimestamp ? getBandData(nextTimestamp) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        currentBandRef.current = curr;
        nextBandRef.current = nxt ?? curr; // fallback to same frame if no next
        onBandDataReady?.(curr, nxt);
      } catch {
        // error already shown via showError
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [currentTimestamp, nextTimestamp, getBandData, onBandDataReady]);

  // ── rAF loop: re-render BitmapLayer whenever interpolation changes ────────
  useEffect(() => {
    async function renderFrame() {
      rafRef.current = requestAnimationFrame(renderFrame);

      const deck = deckRef.current;
      const curr = currentBandRef.current;
      const nxt = nextBandRef.current;
      if (!deck || !curr || !nxt || !visibleRef.current) return;

      const t = tRef.current;

      // Build new bitmap and push as Deck.gl layer
      try {
        const bitmap = bandDataToImageBitmap(curr, nxt, t);
        // Revoke previous bitmap to free GPU memory
        if (imageBitmapRef.current) imageBitmapRef.current.close();
        imageBitmapRef.current = bitmap;

        const layer = new BitmapLayer({
          id: 'no2-bitmap-layer',
          bounds: curr.bbox,
          image: bitmap,
          opacity: 0.75,
        });

        // Update Deck.gl layers list — deck.setProps is called by MapContainer's
        // render callback, so we store the layer in a ref the container reads.
        // We dispatch a custom event to signal an update is ready.
        const event = new CustomEvent('geotiff-layer-update', { detail: layer });
        window.dispatchEvent(event);
      } catch {
        // silent — may fail on unmount when OffscreenCanvas is gone
      }
    }

    rafRef.current = requestAnimationFrame(renderFrame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [deckRef]);

  // ── Loading overlay ───────────────────────────────────────────────────────
  if (!isLoading) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="bg-black/60 backdrop-blur rounded-xl px-5 py-3 flex items-center gap-3 border border-white/10">
        <div className="w-5 h-5 rounded-full border-2 border-sky-400/30 border-t-sky-400 animate-spin" />
        <span className="text-sm text-white/80 font-medium">Loading raster data…</span>
      </div>
    </div>
  );
}
