'use client';

import { useState, useRef, useCallback } from 'react';
import { fromArrayBuffer } from 'geotiff';
import { USE_STUB_DATA, DEFAULT_BBOX, generateSyntheticFrame } from './stubs';

export type Frame = {
  no2: Float32Array;
  u: Float32Array;
  v: Float32Array;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  timestamp: string;
};

export type UseGeoTiffLoaderReturn = {
  frames: Map<string, Frame>;
  loadFrame: (timestamp: string) => Promise<Frame>;
  isLoading: boolean;
  error: string | null;
  bbox: [number, number, number, number] | null;
};

const API_BASE = 'http://localhost:8000';

function getSeedFromTimestamp(ts: string): number {
  const time = new Date(ts).getTime();
  if (isNaN(time)) return 0;
  return (time - new Date('2024-01-01T00:00:00Z').getTime()) / (30 * 60 * 1000);
}

export function useGeoTiffLoader(timestamps: string[] = []): UseGeoTiffLoaderReturn {
  const cacheRef = useRef<Map<string, Frame>>(new Map());
  const [frames, setFrames] = useState<Map<string, Frame>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(DEFAULT_BBOX);

  // Fetch or generate frame implementation
  const fetchSingleFrame = useCallback(async (timestamp: string): Promise<Frame> => {
    // 1. Check local in-memory cache first
    if (cacheRef.current.has(timestamp)) {
      return cacheRef.current.get(timestamp)!;
    }

    // 2. If stub mode is explicitly enabled, return synthetic data immediately
    if (USE_STUB_DATA) {
      const seed = getSeedFromTimestamp(timestamp);
      const synth = generateSyntheticFrame(100, 100, DEFAULT_BBOX, seed);
      const frame: Frame = {
        no2: synth.no2,
        u: synth.u,
        v: synth.v,
        width: synth.width,
        height: synth.height,
        bbox: synth.bbox,
        timestamp,
      };

      cacheRef.current.set(timestamp, frame);
      setFrames(new Map(cacheRef.current));
      setBbox(frame.bbox);
      return frame;
    }

    // 3. Attempt remote fetch from FastAPI backend
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const url = `${API_BASE}/api/v1/downscale/geotiff?timestamp=${encodeURIComponent(timestamp)}`;
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status} for timestamp ${timestamp}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const tiff = await fromArrayBuffer(arrayBuffer);
      const image = await tiff.getImage();

      const rawBbox = image.getBoundingBox();
      const frameBbox: [number, number, number, number] = [
        rawBbox[0],
        rawBbox[1],
        rawBbox[2],
        rawBbox[3],
      ];

      const width = image.getWidth();
      const height = image.getHeight();
      const rasters = await image.readRasters();

      if (rasters.length === 0) {
        throw new Error('GeoTIFF contained no raster bands');
      }

      const no2 = rasters[0] as Float32Array;
      const u = rasters.length > 1 ? (rasters[1] as Float32Array) : new Float32Array(width * height).fill(3.0);
      const v = rasters.length > 2 ? (rasters[2] as Float32Array) : new Float32Array(width * height).fill(2.0);

      const frame: Frame = {
        no2,
        u,
        v,
        width,
        height,
        bbox: frameBbox,
        timestamp,
      };

      cacheRef.current.set(timestamp, frame);
      setFrames(new Map(cacheRef.current));
      setBbox(frameBbox);
      setError(null);

      return frame;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch GeoTIFF frame';
      console.warn(`Falling back to synthetic frame: ${errorMsg}`);
      setError(`Backend error (${errorMsg}). Using physics simulation.`);

      // Fallback to synthetic frame on backend failure
      const seed = getSeedFromTimestamp(timestamp);
      const synth = generateSyntheticFrame(100, 100, DEFAULT_BBOX, seed);
      const fallbackFrame: Frame = {
        no2: synth.no2,
        u: synth.u,
        v: synth.v,
        width: synth.width,
        height: synth.height,
        bbox: synth.bbox,
        timestamp,
      };

      cacheRef.current.set(timestamp, fallbackFrame);
      setFrames(new Map(cacheRef.current));
      setBbox(fallbackFrame.bbox);
      return fallbackFrame;
    }
  }, []);

  const loadFrame = useCallback(
    async (timestamp: string): Promise<Frame> => {
      setIsLoading(true);
      try {
        const frame = await fetchSingleFrame(timestamp);

        // Opportunistic prefetch of the subsequent timestamp
        const currentIndex = timestamps.indexOf(timestamp);
        if (currentIndex >= 0 && currentIndex + 1 < timestamps.length) {
          const nextTs = timestamps[currentIndex + 1];
          if (!cacheRef.current.has(nextTs)) {
            fetchSingleFrame(nextTs).catch(() => {});
          }
        }

        return frame;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchSingleFrame, timestamps]
  );

  return {
    frames,
    loadFrame,
    isLoading,
    error,
    bbox,
  };
}
