'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadLatestModelGrid, type ModelGrid } from '@/lib/modelOutput';

export interface HomeGeoTiffData {
  no2: Float32Array; // µg/m³, ground level, 250 m (the ML engine's output)
  width: number;
  height: number;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  date: string | null;
  source: string | null; // "upload" (Model Upload page) | "run" (stored model run)
  grid: ModelGrid;
}

export interface UseHomeGeoTiffLoaderReturn {
  data: HomeGeoTiffData | null;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<HomeGeoTiffData | null>;
}

/**
 * The newest ML engine output (latest finished upload, else the newest stored run) for the map heatmap.
 * Refetched on mount so a just-finished upload shows up; there is no synthetic fallback: if the model
 * output cannot be loaded the heatmap is simply not drawn.
 */
export function useHomeGeoTiffLoader(): UseHomeGeoTiffLoaderReturn {
  const [data, setData] = useState<HomeGeoTiffData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false): Promise<HomeGeoTiffData | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const grid = await loadLatestModelGrid(refresh);
      const loaded: HomeGeoTiffData = {
        no2: grid.values,
        width: grid.width,
        height: grid.height,
        bbox: grid.bbox,
        date: grid.date,
        source: grid.source,
        grid,
      };
      setData(loaded);
      return loaded;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load the model output';
      console.warn(`Model output for the map is unavailable: ${message}`);
      setError(message);
      setData(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on mount is the point of this effect
    load(true);
  }, [load]);

  return { data, isLoading, error, load: () => load(true) };
}
