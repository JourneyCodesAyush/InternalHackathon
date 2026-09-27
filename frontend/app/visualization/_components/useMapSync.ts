'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

export type UseMapSyncReturn = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  geoToPixel: (lng: number, lat: number) => { x: number; y: number };
  pixelToGeo: (x: number, y: number) => { lng: number; lat: number };
  mapReady: boolean;
};

export function useMapSync(
  mapRef: React.RefObject<MapLibreMap | null>,
  externalCanvasRef?: React.RefObject<HTMLCanvasElement | null>,
  onSyncRender?: () => void
): UseMapSyncReturn {
  const internalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = externalCanvasRef ?? internalCanvasRef;
  const [mapReady, setMapReady] = useState(false);

  // Synchronize canvas size and DPR with the map container dimensions
  const syncCanvasDimensions = useCallback(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    if (!canvas || !map) return;

    const container = map.getContainer();
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Set high-DPI physical resolution if changed
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    onSyncRender?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, onSyncRender]);

  // Project longitude/latitude into canvas CSS pixel coordinates
  const geoToPixel = useCallback(
    (lng: number, lat: number): { x: number; y: number } => {
      const map = mapRef.current;
      if (!map) return { x: 0, y: 0 };
      const point = map.project([lng, lat]);
      return { x: point.x, y: point.y };
    },
    [mapRef]
  );

  // Unproject canvas CSS pixel coordinates into longitude/latitude
  const pixelToGeo = useCallback(
    (x: number, y: number): { lng: number; lat: number } => {
      const map = mapRef.current;
      if (!map) return { lng: 0, lat: 0 };
      const lngLat = map.unproject([x, y]);
      return { lng: lngLat.lng, lat: lngLat.lat };
    },
    [mapRef]
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleReady = () => {
      setMapReady(true);
      syncCanvasDimensions();
    };

    if (map.loaded()) {
      handleReady();
    } else {
      map.once('load', handleReady);
    }

    const handleUpdate = () => {
      syncCanvasDimensions();
    };

    map.on('move', handleUpdate);
    map.on('zoom', handleUpdate);
    map.on('resize', handleUpdate);
    map.on('render', handleUpdate);

    const handleWindowResize = () => {
      syncCanvasDimensions();
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      map.off('move', handleUpdate);
      map.off('zoom', handleUpdate);
      map.off('resize', handleUpdate);
      map.off('render', handleUpdate);
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [mapRef, syncCanvasDimensions]);

  return {
    canvasRef,
    geoToPixel,
    pixelToGeo,
    mapReady,
  };
}
