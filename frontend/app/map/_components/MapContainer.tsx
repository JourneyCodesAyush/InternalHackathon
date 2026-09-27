'use client';

import { Map, setWorkerUrl, type CustomRenderMethodInput } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')

import { useEffect, useRef, useState, useCallback } from 'react'
import { Deck } from '@deck.gl/core'
import type { Layer } from '@deck.gl/core'
import type { BitmapLayer } from '@deck.gl/layers'

import { useFrameInterpolation, type FrameState } from './useFrameInterpolation'
import GeoTiffLayer, { type BandData } from './GeoTiffLayer'
import WindParticleLayer from './WindParticleLayer'
import TimeSlider from './TimeSlider'
import ColorLegend from './ColorLegend'
import LayerToggle from './LayerToggle'

const API_BASE = 'http://localhost:8000';
const MAP_CENTER: [number, number] = [72.85, 19.05]; // Mumbai
const MAP_ZOOM = 9;

// ── helpers ──────────────────────────────────────────────────────────────────
function getAuthHeaders(): Record<string, string> | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('access_token');
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export default function MapContainer() {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const deckRef = useRef<Deck | null>(null);

  // Current Deck.gl layers to render — kept in a ref so the map's custom-layer
  // render callback always reads the latest value without going stale.
  const layersRef = useRef<Layer[]>([]);

  // ── App state ─────────────────────────────────────────────────────────────
  const [timestamps, setTimestamps] = useState<string[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 2 | 4>(1);
  const [showNo2, setShowNo2] = useState(true);
  const [showWind, setShowWind] = useState(true);
  const [authError, setAuthError] = useState(false);

  // Frame state driven by the animation hook
  const [frameState, setFrameState] = useState<FrameState>({
    currentTimestamp: null,
    nextTimestamp: null,
    interpolationFactor: 0,
    currentIndex: 0,
  });

  // Band data lifted up from GeoTiffLayer so WindParticleLayer can use it
  const [currentBand, setCurrentBand] = useState<BandData | null>(null);
  const [nextBand, setNextBand] = useState<BandData | null>(null);

  // ── Fetch timestamps on mount ─────────────────────────────────────────────
  useEffect(() => {
    const headers = getAuthHeaders();
    if (!headers) {
      setAuthError(true);
      return;
    }

    fetch(`${API_BASE}/api/v1/downscale/timestamps`, { headers })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ timestamps: string[] }>;
      })
      .then(({ timestamps: ts }) => setTimestamps(ts))
      .catch(() => {
        // Fallback: generate 48 stub timestamps so the UI is still functional
        const base = new Date('2024-01-01T00:00:00Z');
        const stubs = Array.from({ length: 48 }, (_, i) => {
          const d = new Date(base.getTime() + i * 30 * 60 * 1000);
          return d.toISOString().replace('.000Z', 'Z');
        });
        setTimestamps(stubs);
      });
  }, []);

  // ── Animation hook ────────────────────────────────────────────────────────
  const handleStateChange = useCallback((state: FrameState) => {
    setFrameState(state);
  }, []);

  useFrameInterpolation({
    timestamps,
    isPlaying,
    speedMultiplier,
    secondsPerFrame: 3,
    onStateChange: handleStateChange,
  });

  // ── Manual seek ───────────────────────────────────────────────────────────
  const handleSeek = useCallback((index: number) => {
    // We cannot directly poke into the hook's refs from outside, so we achieve
    // "seek" by dispatching a custom event the hook listens to.
    window.dispatchEvent(
      new CustomEvent('frame-seek', { detail: { index } }),
    );
  }, []);

  // Allow external seek by listening for the event in the hook's parent.
  // We store the seek index in a ref and reset frameState via re-mount trick:
  // Simply update a seekIndex state so the hook re-seeds on the next useEffect.
  const [seekIndex, setSeekIndex] = useState<number | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { index } = (e as CustomEvent<{ index: number }>).detail;
      setSeekIndex(index);
      setIsPlaying(false);
    };
    window.addEventListener('frame-seek', handler);
    return () => window.removeEventListener('frame-seek', handler);
  }, []);

  // Apply seek by directly patching frameState when user drags the slider
  const handleSliderSeek = useCallback(
    (index: number) => {
      setIsPlaying(false);
      setFrameState({
        currentTimestamp: timestamps[index] ?? null,
        nextTimestamp: timestamps[(index + 1) % timestamps.length] ?? null,
        interpolationFactor: 0,
        currentIndex: index,
      });
    },
    [timestamps],
  );

  // ── GeoTIFF layer update via window event ─────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const layer = (e as CustomEvent<BitmapLayer>).detail;
      layersRef.current = [layer];
      // Force Deck.gl to re-render by triggering the map's render cycle
      mapRef.current?.triggerRepaint();
    };
    window.addEventListener('geotiff-layer-update', handler);
    return () => window.removeEventListener('geotiff-layer-update', handler);
  }, []);

  // ── MapLibre + Deck.gl initialization ────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapReady) return;

    const map = new Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      attributionControl: { compact: true },
    });

    mapRef.current = map;

    map.on('load', () => {
      // Add Deck.gl as a custom MapLibre layer so it shares the same WebGL context
      map.addLayer({
        id: 'deck-overlay',
        type: 'custom',
        renderingMode: '2d',

        onAdd(_map: Map, gl: WebGLRenderingContext) {
          const deck = new Deck({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            gl: gl as any,
            initialViewState: {
              longitude: MAP_CENTER[0],
              latitude: MAP_CENTER[1],
              zoom: MAP_ZOOM,
            },
            controller: false, // MapLibre handles camera
            layers: [],
            // Prevent Deck from creating its own canvas
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            parent: null as any,
          });
          deckRef.current = deck;
        },

        render(_gl: WebGLRenderingContext, _options: CustomRenderMethodInput) {
          const deck = deckRef.current;
          const map_ = mapRef.current;
          if (!deck || !map_) return;

          const center = map_.getCenter();
          deck.setProps({
            viewState: {
              longitude: center.lng,
              latitude: center.lat,
              zoom: map_.getZoom(),
              bearing: map_.getBearing(),
              pitch: map_.getPitch(),
            },
            layers: layersRef.current,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (deck as any).redraw(true);
        },
      });

      setMapReady(true);
    });

    // Resize Deck canvas when the window resizes
    const handleResize = () => map.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (deckRef.current) {
        deckRef.current.finalize();
        deckRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Layer / visibility control ────────────────────────────────────────────
  const handleLayerChange = useCallback((no2: boolean, wind: boolean) => {
    setShowNo2(no2);
    setShowWind(wind);
  }, []);

  // ── Band data lift from GeoTiffLayer ─────────────────────────────────────
  const handleBandDataReady = useCallback(
    (curr: BandData | null, nxt: BandData | null) => {
      setCurrentBand(curr);
      setNextBand(nxt);
    },
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0d0f15]">
      {/* Auth error banner */}
      {authError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-900/80 backdrop-blur
          border border-amber-600/40 text-amber-100 text-sm font-medium px-5 py-3 rounded-xl shadow-xl">
          ⚠️&nbsp; Please log in — map data requires authentication.
        </div>
      )}

      {/* Map container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Wind canvas + NO₂ bitmap (mounted only after map is ready) */}
      {mapReady && (
        <>
          {/* GeoTIFF raster — renders via window event, no DOM output */}
          <GeoTiffLayer
            currentTimestamp={frameState.currentTimestamp}
            nextTimestamp={frameState.nextTimestamp}
            interpolationFactor={frameState.interpolationFactor}
            deckRef={deckRef}
            visible={showNo2}
            onBandDataReady={handleBandDataReady}
          />

          {/* Wind particle canvas overlay */}
          {showWind && (
            <WindParticleLayer
              currentBand={currentBand}
              nextBand={nextBand}
              interpolationFactor={frameState.interpolationFactor}
              mapRef={mapRef}
              visible={showWind}
              numParticles={1800}
            />
          )}
        </>
      )}

      {/* Fixed UI panels */}
      <LayerToggle
        showNo2={showNo2}
        showWind={showWind}
        onChange={handleLayerChange}
      />

      <ColorLegend />

      <TimeSlider
        timestamps={timestamps}
        currentIndex={frameState.currentIndex}
        isPlaying={isPlaying}
        speedMultiplier={speedMultiplier}
        onSeek={handleSliderSeek}
        onPlayPause={() => setIsPlaying((p) => !p)}
        onSpeedChange={setSpeedMultiplier}
      />

      {/* Attribution override to keep it above the slider */}
      <style>{`
        .maplibregl-ctrl-bottom-right {
          bottom: 80px !important;
        }
        .maplibregl-ctrl-bottom-left {
          bottom: 80px !important;
        }
      `}</style>
    </div>
  );
}
