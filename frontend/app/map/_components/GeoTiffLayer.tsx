'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Deck } from '@deck.gl/core';
import { BitmapLayer } from '@deck.gl/layers';
import { fromArrayBuffer } from 'geotiff';
import chroma from 'chroma-js';
import { supabase } from '@/lib/supabase';
// ─── Stub switch ─────────────────────────────────────────────────────────────
/**
 * When true the component generates synthetic raster data in-memory and never
 * calls the backend. Flip to false when the ML pipeline is ready.
 */
const USE_STUB_DATA = false;

// ─── Constants ───────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:8000';

/** AQI-style NO₂ color scale matching the existing UI */
const NO2_SCALE = chroma
<<<<<<< HEAD
  .scale([
    '#00e400',
    '#ffff00',
    '#ff7e00',
    '#ff0000',
    '#8f3f97',
    '#7e0023',
  ])
=======
  .scale(['#10b981', '#eab308', '#f97316', '#ef4444', '#9333ea', '#6b1124'])
>>>>>>> d88a1492cb9d852eed42b61c499d9cd4749b91ee
  .domain([0, 40, 80, 120, 160, 200])
  .mode('lch');

/** Width / height of the stub grid */
const STUB_WIDTH = 100;
const STUB_HEIGHT = 100;

/** Mumbai bounding box used by both stub and real data */
const MUMBAI_BBOX: [number, number, number, number] = [
  72.7,
  18.8,
  73.2,
  19.3,
];

// ─── Types ───────────────────────────────────────────────────────────────────
export interface BandData {
  no2: Float32Array;
  u: Float32Array;
  v: Float32Array;
  width: number;
  height: number;
  bbox: [number, number, number, number];
}

export interface GeoTiffLayerProps {
  currentTimestamp: string | null;
  nextTimestamp: string | null;
  interpolationFactor: number;
  deckRef: React.MutableRefObject<Deck | null>;
  visible: boolean;
  onBandDataReady?: (
    current: BandData | null,
    next: BandData | null,
  ) => void;
}

/**
 * Response returned by:
 *
 * GET /api/v1/downscale/map
 */
interface DownscaleMapResponse {
  resolution: string;
  bbox: number[];
  timestamp: string;
  grid_url: string;
  format: string;
  date: string;
  units: string;
  raw_url?: string;
  gapfilled_url?: string;
  hazard_geojson_url?: string;
  netcdf_url?: string;
  metrics?: Record<string, unknown>;
}

// ─── Stub data generation ────────────────────────────────────────────────────
function smooth(
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
): number {
  const fx = x / w;
  const fy = y / h;

  const base =
    (Math.sin(fx * Math.PI * 3 + seed * 0.7) * 0.5 + 0.5) *
    (Math.cos(fy * Math.PI * 2.5 - seed * 0.4) * 0.5 + 0.5);

  const noise =
    Math.sin(fx * 31.7 + fy * 17.3 + seed) * 0.1;

  return Math.max(
    0,
    Math.min(250, (base + noise) * 160 + 20),
  );
}

function generateStubBandData(
  timestamp: string | null,
): BandData {
  const seed = timestamp
    ? (new Date(timestamp).getTime() -
      new Date('2024-01-01T00:00:00Z').getTime()) /
    1_800_000
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

      no2[i] = smooth(
        x,
        y,
        STUB_WIDTH,
        STUB_HEIGHT,
        seed,
      );

      u[i] =
        2 +
        Math.sin(fx * Math.PI + seed * 0.5) * 3;

      v[i] =
        1 +
        Math.cos(fy * Math.PI - seed * 0.3) * 2;
    }
  }

  return {
    no2,
    u,
    v,
    width: STUB_WIDTH,
    height: STUB_HEIGHT,
    bbox: MUMBAI_BBOX,
  };
}

// ─── GeoTIFF parsing ─────────────────────────────────────────────────────────
async function parseGeoTiff(
  buffer: ArrayBuffer,
): Promise<BandData> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();

  const rawBbox = image.getBoundingBox();

  const bbox: [
    number,
    number,
    number,
    number,
  ] = [
      rawBbox[0],
      rawBbox[1],
      rawBbox[2],
      rawBbox[3],
    ];

  const width = image.getWidth();
  const height = image.getHeight();

  const rasters = await image.readRasters();

  if (rasters.length < 1) {
    throw new Error(
      'GeoTIFF does not contain any raster bands.',
    );
  }

  /*
   * The backend currently returns a GeoTIFF.
   *
   * We use the first band as NO₂.
   *
   * If U/V wind bands are present, use them.
   * Otherwise create zero-filled arrays so the rest
   * of the rendering pipeline remains compatible.
   */
  const no2 = rasters[0] as Float32Array;

  const u =
    rasters.length > 1
      ? (rasters[1] as Float32Array)
      : new Float32Array(width * height);

  const v =
    rasters.length > 2
      ? (rasters[2] as Float32Array)
      : new Float32Array(width * height);

  return {
    no2,
    u,
    v,
    width,
    height,
    bbox,
  };
}

// ─── Pixel rendering ─────────────────────────────────────────────────────────
function bandDataToImageBitmap(
  dataA: BandData,
  dataB: BandData,
  t: number,
): ImageBitmap {
  const { width, height } = dataA;

  const rgba = new Uint8ClampedArray(
    width * height * 4,
  );

  for (let i = 0; i < width * height; i++) {
    const no2Val =
      dataA.no2[i] * (1 - t) +
      dataB.no2[i] * t;

    const [r, g, b] = NO2_SCALE(no2Val).rgb();

    const base = i * 4;

    rgba[base] = r;
    rgba[base + 1] = g;
    rgba[base + 2] = b;
    rgba[base + 3] = 178;
  }

  const canvas = new OffscreenCanvas(
    width,
    height,
  );

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error(
      'Could not create OffscreenCanvas 2D context.',
    );
  }

  const imageData = new ImageData(
    rgba,
    width,
    height,
  );

  ctx.putImageData(imageData, 0, 0);

  return canvas.transferToImageBitmap();
}

// ─── Error toast ─────────────────────────────────────────────────────────────
function showError(msg: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  const el = document.createElement('div');

  el.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #7f1d1d;
    color: #fee2e2;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 13px;
    z-index: 9999;
    pointer-events: none;
    border: 1px solid #991b1b;
    box-shadow: 0 4px 20px rgba(0,0,0,0.6);
  `;

  el.textContent = msg;

  document.body.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 5000);
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
  /**
   * Cache:
   *
   * timestamp -> parsed BandData
   */
  const cacheRef = useRef<Map<string, BandData>>(
    new Map(),
  );

  const currentBandRef =
    useRef<BandData | null>(null);

  const nextBandRef =
    useRef<BandData | null>(null);

  const [isLoading, setIsLoading] =
    useState(false);

  const imageBitmapRef =
    useRef<ImageBitmap | null>(null);

  const rafRef =
    useRef<number | null>(null);

  // Keep latest interpolation factor available
  // to the requestAnimationFrame loop.
  const tRef =
    useRef(interpolationFactor);

  tRef.current = interpolationFactor;

  const visibleRef =
    useRef(visible);

  visibleRef.current = visible;

  // ── Fetch / generate a single timestamp ──────────────────────────────────
  const getBandData = useCallback(
    async (ts: string): Promise<BandData> => {
      // Return cached data when available.
      if (cacheRef.current.has(ts)) {
        return cacheRef.current.get(ts)!;
      }

      // Use synthetic data when stub mode is enabled.
      if (USE_STUB_DATA) {
        const data =
          generateStubBandData(ts);

        cacheRef.current.set(ts, data);

        return data;
      }

      // ── Authentication ────────────────────────────────────────────────────
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        showError('Please log in to view map data.');
        throw new Error('Not authenticated');
      }

      const token = session.access_token;
      // ── Call the actual backend map endpoint ──────────────────────────────
      //
      // Backend route:
      //
      // GET /api/v1/downscale/map
      //
      // Required query parameters:
      //
      // bbox
      // timestamp
      //
      const params = new URLSearchParams({
        bbox: MUMBAI_BBOX.join(','),
        timestamp: ts,
      });

      const res = await fetch(
        `${API_BASE}/api/v1/downscale/map?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        },
      );

      if (!res.ok) {
        let detail = '';

        try {
          const errorBody = await res.json();

          if (
            errorBody &&
            typeof errorBody.detail === 'string'
          ) {
            detail = `: ${errorBody.detail}`;
          }
        } catch {
          // Ignore JSON parsing errors.
        }

        const msg =
          `Failed to load map data for ${ts} ` +
          `(${res.status})${detail}`;

        showError(msg);

        throw new Error(msg);
      }

      // The /map endpoint returns JSON metadata,
      // NOT the GeoTIFF itself.
      const mapData =
        (await res.json()) as DownscaleMapResponse;

      if (!mapData.grid_url) {
        const msg =
          `Backend did not return a GeoTIFF URL for ${ts}.`;

        showError(msg);

        throw new Error(msg);
      }

      // ── Download the actual GeoTIFF ───────────────────────────────────────
      //
      // Example backend response:
      //
      // grid_url: "/files/..."
      //
      // The FastAPI application mounts RUNS_ROOT at:
      //
      // /files
      //
      const gridUrl = mapData.grid_url.startsWith(
        'http://',
      ) ||
        mapData.grid_url.startsWith(
          'https://',
        )
        ? mapData.grid_url
        : `${API_BASE}${mapData.grid_url}`;

      const tiffRes = await fetch(
        gridUrl,
        {
          method: 'GET',
          headers: {
            Accept: 'image/tiff, application/octet-stream',
          },
        },
      );

      if (!tiffRes.ok) {
        const msg =
          `Failed to download GeoTIFF for ${ts} ` +
          `(${tiffRes.status})`;

        showError(msg);

        throw new Error(msg);
      }

      const buffer =
        await tiffRes.arrayBuffer();

      if (buffer.byteLength === 0) {
        const msg =
          `GeoTIFF response was empty for ${ts}.`;

        showError(msg);

        throw new Error(msg);
      }

      // Parse the actual GeoTIFF.
      const data =
        await parseGeoTiff(buffer);

      // Cache parsed raster.
      cacheRef.current.set(ts, data);

      return data;
    },
    [],
  );

  // ── Load current + next bands whenever timestamps change ─────────────────
  useEffect(() => {
    if (!currentTimestamp) {
      currentBandRef.current = null;
      nextBandRef.current = null;
      return;
    }

    let cancelled = false;

    setIsLoading(true);

    const load = async () => {
      try {
        const [curr, nxt] =
          await Promise.all([
            getBandData(currentTimestamp),
            nextTimestamp
              ? getBandData(nextTimestamp)
              : Promise.resolve(null),
          ]);

        if (cancelled) {
          return;
        }

        currentBandRef.current = curr;

        nextBandRef.current =
          nxt ?? curr;

        onBandDataReady?.(
          curr,
          nxt,
        );
      } catch {
        // Error is already displayed
        // by getBandData().
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [
    currentTimestamp,
    nextTimestamp,
    getBandData,
    onBandDataReady,
  ]);

  // ── rAF loop: re-render BitmapLayer whenever interpolation changes ────────
  useEffect(() => {
    async function renderFrame() {
      rafRef.current =
        requestAnimationFrame(
          renderFrame,
        );

      const deck = deckRef.current;
      const curr =
        currentBandRef.current;
      const nxt =
        nextBandRef.current;

      if (
        !deck ||
        !curr ||
        !nxt ||
        !visibleRef.current
      ) {
        return;
      }

      const t = tRef.current;

      try {
        const bitmap =
          bandDataToImageBitmap(
            curr,
            nxt,
            t,
          );

        // Revoke previous bitmap to
        // free GPU memory.
        if (
          imageBitmapRef.current
        ) {
          imageBitmapRef.current.close();
        }

        imageBitmapRef.current =
          bitmap;

        const layer =
          new BitmapLayer({
            id: 'no2-bitmap-layer',
            bounds: curr.bbox,
            image: bitmap,
            opacity: 0.75,
          });

        /**
         * MapContainer listens for this event
         * and updates the Deck.gl layer list.
         */
        const event =
          new CustomEvent(
            'geotiff-layer-update',
            {
              detail: layer,
            },
          );

        window.dispatchEvent(
          event,
        );
      } catch {
        // Silent because rendering can fail
        // during unmount.
      }
    }

    rafRef.current =
      requestAnimationFrame(
        renderFrame,
      );

    return () => {
      if (
        rafRef.current !== null
      ) {
        cancelAnimationFrame(
          rafRef.current,
        );
      }

      rafRef.current = null;

      if (
        imageBitmapRef.current
      ) {
        imageBitmapRef.current.close();
        imageBitmapRef.current = null;
      }
    };
  }, [deckRef]);

  // ── Loading overlay ───────────────────────────────────────────────────────
  if (!isLoading) {
    return null;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="bg-black/60 backdrop-blur rounded-xl px-5 py-3 flex items-center gap-3 border border-white/10">
        <div className="w-5 h-5 rounded-full border-2 border-sky-400/30 border-t-sky-400 animate-spin" />

        <span className="text-sm text-white/80 font-medium">
          Loading raster data…
        </span>
      </div>
    </div>
  );
}
