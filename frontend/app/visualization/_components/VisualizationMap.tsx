'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Map, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Layers, ArrowLeft } from 'lucide-react';

import HeatmapCanvas from './HeatmapCanvas';
import PlayerControls from './PlayerControls';
import RegionInfo from './RegionInfo';
import ColorScale from './ColorScale';

import { useGeoTiffLoader } from './useGeoTiffLoader';
import { useAnimationEngine } from './useAnimationEngine';
import { DEFAULT_BBOX, USE_STUB_DATA, generateSyntheticTimestamps } from './stubs';

// Initialize MapLibre Worker from local public bundle
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const API_BASE = 'http://localhost:8000';
const MUMBAI_CENTER: [number, number] = [72.85, 19.05];
const INITIAL_ZOOM = 9;

export default function VisualizationMap() {
  const router = useRouter();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Application State
  const [timestamps, setTimestamps] = useState<string[]>([]);
  const [currentNo2, setCurrentNo2] = useState<Float32Array | null>(null);
  const [currentBbox, setCurrentBbox] = useState<[number, number, number, number] | null>(DEFAULT_BBOX);
  const [gridWidth, setGridWidth] = useState(100);
  const [gridHeight, setGridHeight] = useState(100);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 2 | 4 | 10>(1);
  const [opacity, setOpacity] = useState(0.75);

  // 1. Initialize Web Worker on client mount
  useEffect(() => {
    try {
      const worker = new Worker(new URL('./NavierStokesWorker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
    } catch (err) {
      console.error('Failed to initialize NavierStokesWorker:', err);
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // 2. Fetch or synthesize 30-minute timestamp intervals
  useEffect(() => {
    let isCancelled = false;

    async function loadTimestamps() {
      if (USE_STUB_DATA) {
        setTimestamps(generateSyntheticTimestamps(48));
        return;
      }

      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE}/api/v1/downscale/timestamps`, { headers });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!isCancelled) {
          if (Array.isArray(data?.timestamps) && data.timestamps.length > 0) {
            setTimestamps(data.timestamps);
          } else {
            setTimestamps(generateSyntheticTimestamps(48));
          }
        }
      } catch (err) {
        console.warn('Could not load timestamps from backend, using synthetic interval series:', err);
        if (!isCancelled) {
          setTimestamps(generateSyntheticTimestamps(48));
        }
      }
    }

    loadTimestamps();
    return () => {
      isCancelled = true;
    };
  }, []);

  // 3. Initialize MapLibre GL Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: MUMBAI_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 4. Data loader hook for GeoTIFF frame acquisition & caching
  const { frames, loadFrame } = useGeoTiffLoader(timestamps);

  // 5. Callback triggered by animation loop whenever advected grid is ready for display
  const handleFrameReady = useCallback(
    (
      no2: Float32Array,
      bbox: [number, number, number, number],
      width: number,
      height: number
    ) => {
      setCurrentNo2(no2);
      setCurrentBbox(bbox);
      setGridWidth(width);
      setGridHeight(height);
    },
    []
  );

  // 6. Animation Engine hook driving timeline progress and Navier-Stokes worker iterations
  const { currentIndex, t, seek } = useAnimationEngine({
    timestamps,
    frames,
    loadFrame,
    workerRef,
    isPlaying,
    speedMultiplier,
    onFrameReady: handleFrameReady,
  });

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0d0f15] select-none">
      {/* Layer 0: MapLibre GL Canvas Container */}
      <div ref={mapContainerRef} className="absolute inset-0 z-0 w-full h-full" />

      {/* Layer 10: Canvas 2D Advected Heatmap Overlay */}
      <HeatmapCanvas
        no2={currentNo2}
        bbox={currentBbox}
        width={gridWidth}
        height={gridHeight}
        mapRef={mapRef}
        opacity={opacity}
      />

      {/* Layer 20: Navigation / Back Button (Top-Left) */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#11141d]/95 hover:bg-[#1c2233] text-zinc-300 hover:text-white border border-[#242938] shadow-2xl backdrop-blur-md text-xs font-medium transition-colors cursor-pointer group"
          aria-label="Go back to previous page"
        >
          <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-blue-400 group-hover:-translate-x-0.5 transition-transform" />
          <span>Back</span>
        </button>
      </div>

      {/* Layer 20: Region & Telemetry Info Panel (Top-Left under Back button) */}
      <div className="absolute top-16 left-4 z-20">
        <RegionInfo bbox={currentBbox} no2={currentNo2} />
      </div>

      {/* Layer 20: Opacity & Display Slider Control (Top-Right) */}
      <div className="absolute top-4 right-4 z-20 bg-[#11141d]/95 backdrop-blur-md border border-[#242938] rounded-xl p-3 shadow-2xl text-[#f1f3f7] flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
          <Layers className="w-3.5 h-3.5 text-blue-400" />
          <span className="hidden sm:inline">Heatmap Opacity</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(opacity * 100)}
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            className="w-24 sm:w-32 h-1.5 bg-[#1b202e] rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <span className="text-xs font-mono font-bold text-blue-400 w-9 text-right">
            {Math.round(opacity * 100)}%
          </span>
        </div>
      </div>

      {/* Layer 20: NO₂ Atmospheric Legend Scale (Bottom-Right) */}
      <ColorScale />

      {/* Layer 20: Interactive Player Controls Panel (Fixed Bottom) */}
      <PlayerControls
        timestamps={timestamps}
        currentIndex={currentIndex}
        t={t}
        isPlaying={isPlaying}
        speedMultiplier={speedMultiplier}
        onPlayPause={() => setIsPlaying((p) => !p)}
        onSpeedChange={setSpeedMultiplier}
        onSeek={seek}
      />
    </div>
  );
}
