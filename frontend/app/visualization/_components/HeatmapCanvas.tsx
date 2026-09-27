'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import chroma from 'chroma-js';
import { useMapSync } from './useMapSync';

export interface HeatmapCanvasProps {
  no2: Float32Array | null;
  bbox: [number, number, number, number] | null;
  width: number;
  height: number;
  mapRef: React.RefObject<MapLibreMap | null>;
  opacity: number;
}

// AQI-aligned atmospheric NO₂ color gradient (0 to 200 µg/m³)
const NO2_COLOR_SCALE = chroma
  .scale(['#00e400', '#ffff00', '#ff7e00', '#ff0000', '#8f3f97', '#7e0023'])
  .domain([0, 40, 80, 120, 160, 200])
  .mode('lch');

// Precomputed 256-color lookup table for fast RGBA rendering
const COLOR_LUT: Uint8ClampedArray = new Uint8ClampedArray(256 * 4);
for (let i = 0; i < 256; i++) {
  const value = (i / 255.0) * 200.0;
  const rgb = NO2_COLOR_SCALE(value).rgb();
  const offset = i * 4;
  COLOR_LUT[offset] = rgb[0];
  COLOR_LUT[offset + 1] = rgb[1];
  COLOR_LUT[offset + 2] = rgb[2];
  COLOR_LUT[offset + 3] = 200; // ~78% base alpha
}

export default function HeatmapCanvas({
  no2,
  bbox,
  width,
  height,
  mapRef,
  opacity,
}: HeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Offscreen canvas for fast pixel rasterization
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  // Main render pass drawing the rasterized grid projected onto the MapLibre screen bounds
  const renderHeatmap = useCallback(() => {
    const map = mapRef.current;
    if (!map || !bbox || !no2) return;

    // Initialize or resize offscreen buffer if grid dimensions change
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
    }
    const offscreen = offscreenRef.current;
    if (offscreen.width !== width || offscreen.height !== height) {
      offscreen.width = width;
      offscreen.height = height;
    }

    const offscreenCtx = offscreen.getContext('2d');
    if (!offscreenCtx) return;

    // Populate offscreen ImageData from NO₂ scalar values
    const imgData = offscreenCtx.createImageData(width, height);
    const data32 = new Uint32Array(imgData.data.buffer);
    const totalPixels = width * height;

    for (let i = 0; i < totalPixels; i++) {
      const val = no2[i];
      // Normalize [0, 200] to LUT index [0, 255]
      const lutIndex = Math.max(0, Math.min(255, Math.round((val / 200.0) * 255)));
      const offset = lutIndex * 4;

      const r = COLOR_LUT[offset];
      const g = COLOR_LUT[offset + 1];
      const b = COLOR_LUT[offset + 2];
      const a = COLOR_LUT[offset + 3];

      // Little-endian packed ABGR
      data32[i] = (a << 24) | (b << 16) | (g << 8) | r;
    }

    offscreenCtx.putImageData(imgData, 0, 0);

    // Project geographic corners into map CSS pixel coordinates
    // bbox is [minLng, minLat, maxLng, maxLat]
    const pTopLeft = map.project([bbox[0], bbox[3]]);
    const pBottomRight = map.project([bbox[2], bbox[1]]);

    const screenX = pTopLeft.x;
    const screenY = pTopLeft.y;
    const screenW = pBottomRight.x - pTopLeft.x;
    const screenH = pBottomRight.y - pTopLeft.y;

    const mainCanvas = canvasRef.current;
    if (!mainCanvas) return;

    const mainCtx = mainCanvas.getContext('2d');
    if (!mainCtx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Reset and clear main display canvas
    mainCtx.save();
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

    // Apply high-DPI scaling matrix
    mainCtx.scale(dpr, dpr);

    // Configure smooth bilinear resampling for natural plume gradient
    mainCtx.imageSmoothingEnabled = true;
    mainCtx.imageSmoothingQuality = 'high';
    mainCtx.globalAlpha = Math.max(0.0, Math.min(1.0, opacity));

    // Stretch and project 100x100 grid onto map coordinates
    mainCtx.drawImage(offscreen, screenX, screenY, screenW, screenH);
    mainCtx.restore();
  }, [bbox, no2, width, height, mapRef, opacity, canvasRef]);

  const { mapReady } = useMapSync(mapRef, canvasRef, renderHeatmap);

  // Trigger render pass whenever NO₂, bounds, opacity, or map state updates
  useEffect(() => {
    if (mapReady) {
      renderHeatmap();
    }
  }, [mapReady, renderHeatmap]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-10 block"
      style={{
        width: '100%',
        height: '100%',
      }}
    />
  );
}
