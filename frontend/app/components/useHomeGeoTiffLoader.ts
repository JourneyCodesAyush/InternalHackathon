'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { fromArrayBuffer } from 'geotiff';
import { DEFAULT_BBOX, generateSyntheticFrame } from '../visualization/_components/stubs';

export interface HomeGeoTiffData {
  no2: Float32Array;
  width: number;
  height: number;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

export interface UseHomeGeoTiffLoaderReturn {
  data: HomeGeoTiffData | null;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<HomeGeoTiffData>;
}

const API_BASE = 'http://localhost:8000';

/**
 * NO₂ grid for the home map. With ``date`` (one of the uploaded days from ``/downscale/dates``) it loads that
 * day's uploaded file exactly as the Plume Flow page does (``/downscale/geotiff?timestamp=<date>T00:00:00Z``).
 */
export function useHomeGeoTiffLoader(date?: string): UseHomeGeoTiffLoaderReturn {
  const [data, setData] = useState<HomeGeoTiffData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, HomeGeoTiffData>>(new Map());
  const cacheKey = date ?? 'latest';

  const load = useCallback(async (): Promise<HomeGeoTiffData> => {
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setData(cached);
      return cached;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const url = date
        ? `${API_BASE}/api/v1/downscale/geotiff?timestamp=${encodeURIComponent(`${date}T00:00:00Z`)}`
        : `${API_BASE}/api/v1/downscale/geotiff`;
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
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

      const loadedData: HomeGeoTiffData = {
        no2,
        width,
        height,
        bbox: frameBbox,
      };

      cacheRef.current.set(cacheKey, loadedData);
      setData(loadedData);
      return loadedData;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch GeoTIFF';
      console.warn(`Home GeoTIFF loader falling back to synthetic frame: ${errorMsg}`);
      setError(`Backend error (${errorMsg}). Using synthetic baseline.`);

      // Fallback: smooth synthetic frame (100x100 grid) matching Visualization page
      const synth = generateSyntheticFrame(100, 100, DEFAULT_BBOX, 0);
      const fallbackData: HomeGeoTiffData = {
        no2: synth.no2,
        width: synth.width,
        height: synth.height,
        bbox: synth.bbox,
      };

      cacheRef.current.set(cacheKey, fallbackData);
      setData(fallbackData);
      return fallbackData;
    } finally {
      setIsLoading(false);
    }
  }, [date, cacheKey]);

  useEffect(() => {
    if (date === '') return; // the uploaded dates are still loading
    load();
  }, [load, date]);

  return {
    data,
    isLoading,
    error,
    load,
  };
}
