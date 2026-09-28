'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Globe2, Map as MapIcon, Loader2, X, Info, Pause, Play, RefreshCw, AlertTriangle, Wind, RotateCw, Satellite } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { MAX_COLUMN, MIN_COLUMN, type GlobeApi, type GlobeFrames, type HoverInfo } from '../components/globe/GlobeCanvas';
import type { FlatMapApi } from '../components/globe/FlatMap';
import { fetchGlobalSnapshot, hoursAgo, syntheticSnapshot, type GlobalSnapshot } from '../components/globe/globeData';
import { explainRegion } from '../components/globe/regionInsights';
import type { FlowRequest, FlowResult, FlowProgress } from '../components/globe/globeFlow.worker';

// WebGL needs the browser: render the canvas on the client only
const GlobeCanvas = dynamic(() => import('../components/globe/GlobeCanvas'), { ssr: false });
const FlatMap = dynamic(() => import('../components/globe/FlatMap'), { ssr: false });

const FADE_MS = 450; // cross-fade between the unrolled globe and the 2-D map

const FRAME_HOURS = Array.from({ length: 13 }, (_, h) => h); // +0 .. +12 h
const NEWEST_HOURS = 6;
const PLAY_HOURS_PER_SECOND = 1.5;
const REFRESH_MS = 20 * 60 * 1000; // matches the backend cache
const LEGEND_GRADIENT =
  'linear-gradient(90deg, rgba(59,26,115,0) 0%, #3b1a73 18%, #9e298c 34%, #ed5947 55%, #fcb338 77%, #fff5b3 100%)';

type Phase = 'loading' | 'computing' | 'ready' | 'error';
type ViewMode = '3d' | '2d';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll for a ref that a dynamically loaded component fills in. */
async function whenSet<T>(ref: React.MutableRefObject<T | null>): Promise<T> {
  while (!ref.current) await wait(30);
  return ref.current;
}

function fmtAgo(h: number | null): string {
  if (h === null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min ago`;
  return `${h.toFixed(1)} h ago`;
}

function fmtUtc(iso: string | null): string {
  return iso ? `${iso.replace('T', ' ').replace('Z', '')} UTC` : '—';
}

/** Legend stops mirror the shader's log colour scale. */
function legendValue(t: number): number {
  return MIN_COLUMN * Math.pow(MAX_COLUMN / MIN_COLUMN, t);
}

export default function GlobePage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ lat: number; lon: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [snapshot, setSnapshot] = useState<GlobalSnapshot | null>(null);
  const [frames, setFrames] = useState<GlobeFrames | null>(null);
  const [filled, setFilled] = useState<Float32Array | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [highlightNewest, setHighlightNewest] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [showWind, setShowWind] = useState(true);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const workerRef = useRef<Worker | null>(null);
  const globeApi = useRef<GlobeApi | null>(null);
  const flatApi = useRef<FlatMapApi | null>(null);
  const [mode, setMode] = useState<ViewMode>('3d');
  const [transitioning, setTransitioning] = useState(false);
  const [flatMounted, setFlatMounted] = useState(false);
  const [flatVisible, setFlatVisible] = useState(false);

  /**
   * 3-D -> 2-D: the sphere unrolls into a Web-Mercator sheet around the current view, then the MapLibre map
   * (placed at exactly the same centre and scale) fades in over it. 2-D -> 3-D runs the same in reverse.
   */
  const toggleView = useCallback(async () => {
    if (transitioning) return;
    setTransitioning(true);
    setHover(null);
    try {
      const globe = await whenSet(globeApi);
      if (mode === '3d') {
        setFlatMounted(true);
        const [view, flat] = await Promise.all([globe.flatten(1300), whenSet(flatApi)]);
        flat.jumpTo(view);
        await flat.ready();
        setFlatVisible(true);
        await wait(FADE_MS);
        globe.setActive(false);
        setMode('2d');
      } else {
        const flat = await whenSet(flatApi);
        let view = flat.getView();
        view.lat = Math.max(-68, Math.min(68, view.lat));
        const [zMin, zMax] = globe.zoomRange(view.lat);
        const zoom = Math.max(zMin, Math.min(zMax, view.zoom));
        if (Math.abs(zoom - view.zoom) > 0.01 || view.lat !== flat.getView().lat) {
          await flat.easeTo({ ...view, zoom }, 650);
          view = { ...view, zoom };
        }
        globe.setActive(true);
        globe.showFlat(view);
        setFlatVisible(false);
        await wait(FADE_MS);
        await globe.roll(1300);
        setMode('3d');
      }
    } finally {
      setTransitioning(false);
    }
  }, [mode, transitioning]);

  const snapshotRef = useRef<GlobalSnapshot | null>(null);

  /** Fill gaps and precompute the drift frames for a snapshot (in the worker). */
  const compute = useCallback((snap: GlobalSnapshot) => {
    snapshotRef.current = snap;
    setSnapshot(snap);
    setNow(Date.now());
    setPhase('computing');
    setProgress(0);
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../components/globe/globeFlow.worker.ts', import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<FlowResult | FlowProgress>) => {
      if (e.data.type === 'PROGRESS') {
        setProgress(e.data.done / e.data.total);
        return;
      }
      setFrames({ width: snap.width, height: snap.height, frames: e.data.frames, ageH: snap.ageH, u: snap.u, v: snap.v });
      setFilled(e.data.filled);
      setFrameIndex(0);
      setPhase('ready');
      worker.terminate();
    };
    worker.onerror = () => {
      setError('The drift computation failed in this browser.');
      setPhase('error');
    };
    const request: FlowRequest = {
      type: 'COMPUTE',
      no2: snap.no2,
      u: snap.u,
      v: snap.v,
      width: snap.width,
      height: snap.height,
      resDeg: snap.resDeg,
      frameHours: FRAME_HOURS,
    };
    worker.postMessage(request);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!snapshotRef.current) setPhase('loading');
      setError(null);
      try {
        compute(await fetchGlobalSnapshot(24, signal));
        setLiveError(null);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setLiveError(e instanceof Error ? e.message : 'Live data unavailable.');
        // keep whatever is on screen (real or demo); on first load show the simulated demo layer
        if (!snapshotRef.current) compute(syntheticSnapshot());
      }
    },
    [compute],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on mount is the point of this effect
    load(controller.signal);
    const refresh = setInterval(() => load(), REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      controller.abort();
      clearInterval(refresh);
      clearInterval(clock);
      workerRef.current?.terminate();
    };
  }, [load]);

  // Drift playback: advance the fractional frame index; loop after +12 h
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setFrameIndex((f) => {
        const next = f + dt * PLAY_HOURS_PER_SECOND;
        return next > FRAME_HOURS.length - 1 ? 0 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const onHover = useCallback((info: HoverInfo | null) => setHover(info), []);
  const onSelect = useCallback((point: { lat: number; lon: number } | null) => setSelected(point), []);

  // Region explanation for the tapped point (country / ocean, stats from the observed layer, reasons)
  const insight = useMemo(() => {
    if (!selected) return null;
    const field =
      frames && filled && snapshot
        ? { width: frames.width, height: frames.height, resDeg: snapshot.resDeg, values: frames.frames[0], observed: filled }
        : null;
    const month = snapshot ? new Date(snapshot.fetchedAt.replace('Z', ':00Z')).getUTCMonth() + 1 : 1;
    return explainRegion(selected.lat, selected.lon, field, Number.isFinite(month) ? month : 1);
  }, [selected, frames, filled, snapshot]);

  // Hover readout from the frames the globe is showing
  let readout: { value: number | null; kind: string; age: number | null } | null = null;
  if (hover && frames && snapshot && filled) {
    const i = Math.min(frames.width - 1, Math.max(0, Math.floor((hover.lon + 180) / snapshot.resDeg)));
    const j = Math.min(frames.height - 1, Math.max(0, Math.floor((90 - hover.lat) / snapshot.resDeg)));
    const k = j * frames.width + i;
    const f = Math.round(frameIndex);
    const value = frames.frames[f][2 * k];
    const conf = frames.frames[f][2 * k + 1];
    const kind =
      f === 0
        ? filled[k] >= 1
          ? 'observed'
          : filled[k] > 0
            ? 'interpolated (cloud gap)'
            : 'no recent observation'
        : conf > 0.05
          ? `wind drift +${f} h (indicative)`
          : 'no recent observation';
    readout = { value: conf > 0.05 ? value : null, kind, age: f === 0 && filled[k] >= 1 ? snapshot.ageH[k] : null };
  }

  const newestAgo = snapshot ? hoursAgo(snapshot.newestObs, now) : null;
  const driftHours = Math.round(frameIndex * 10) / 10;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="hidden md:flex h-full">
        <Sidebar />
      </div>

      <main className="relative flex-1 h-full overflow-hidden bg-[radial-gradient(ellipse_at_center,#10182b_0%,#07090f_70%)]">
        <GlobeCanvas
          data={frames}
          frameIndex={frameIndex}
          highlightNewest={highlightNewest}
          newestHours={NEWEST_HOURS}
          autoRotate={autoRotate && !hover && !selected && mode === '3d' && !transitioning}
          showWind={showWind}
          onHover={onHover}
          onSelect={onSelect}
          outline={insight?.outline ?? null}
          apiRef={globeApi}
        />
        {flatMounted && (
          <div
            className="absolute inset-0 transition-opacity ease-out"
            style={{
              opacity: flatVisible ? 1 : 0,
              transitionDuration: `${FADE_MS}ms`,
              pointerEvents: flatVisible && !transitioning ? 'auto' : 'none',
            }}
          >
            <FlatMap
              data={frames}
              frameIndex={frameIndex}
              highlightNewest={highlightNewest}
              newestHours={NEWEST_HOURS}
              showWind={showWind && flatVisible}
              onHover={onHover}
              onSelect={onSelect}
              outline={insight?.outline ?? null}
              apiRef={flatApi}
            />
          </div>
        )}

        {/* 3-D globe <-> 2-D map */}
        <div
          role="radiogroup"
          aria-label="Globe or flat map"
          className="absolute z-10 right-3 sm:right-4 top-1/2 -translate-y-1/2 flex p-0.5 rounded-full bg-[#11141d]/90 border border-[#2e3547] backdrop-blur-md shadow-xl"
        >
          <span
            aria-hidden
            className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-full bg-blue-600 shadow transition-transform duration-500 ease-[cubic-bezier(0.65,0,0.35,1)]"
            style={{ transform: mode === '2d' ? 'translateX(100%)' : 'translateX(0)' }}
          />
          {(['3d', '2d'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={transitioning || phase !== 'ready'}
              onClick={() => mode !== m && toggleView()}
              className={`relative z-10 flex items-center justify-center gap-1.5 w-[4.25rem] h-8 rounded-full text-[11px] font-semibold transition-colors cursor-pointer disabled:cursor-wait ${
                mode === m ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {m === '3d' ? <Globe2 className="w-3.5 h-3.5" /> : <MapIcon className="w-3.5 h-3.5" />}
              {m === '3d' ? '3D' : '2D'}
            </button>
          ))}
        </div>

        {/* Title and data status */}
        <div className="absolute top-3 left-3 right-3 sm:right-auto sm:top-4 sm:left-4 z-10 sm:max-w-sm p-3 rounded-lg bg-[#11141d]/90 border border-[#2e3547] backdrop-blur-md shadow-xl text-xs space-y-2">
          <div className="flex items-center gap-2 font-semibold text-zinc-100 text-sm">
            <Globe2 className="w-4 h-4 text-blue-400" />
            Global NO₂ — Sentinel-5P
            <Link
              href="/"
              className="md:hidden ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#2e3547] text-[10px] text-zinc-300"
            >
              <MapIcon className="w-3 h-3" /> Map
            </Link>
            <span className="md:ml-auto px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono">
              {snapshot?.demo === 'simulated' ? 'NO₂' : 'NRTI'}
            </span>
          </div>
          {snapshot?.demo === 'simulated' ? (
            <p className="text-[11px] text-zinc-300">
              Typical NO₂ over the world&apos;s main emission regions, with the prevailing wind belts.
            </p>
          ) : snapshot ? (
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
              <span className="text-zinc-500">Newest orbit</span>
              <span className="text-zinc-200">
                {fmtUtc(snapshot.newestObs)} <span className="text-emerald-300">({fmtAgo(newestAgo)})</span>
              </span>
              <span className="text-zinc-500">Window</span>
              <span className="text-zinc-300">latest cloud-free pass per cell, last {snapshot.hours} h</span>
              <span className="text-zinc-500">Coverage</span>
              <span className="text-zinc-300">{Math.round(snapshot.coverage * 100)}% of the globe observed</span>
              <span className="text-zinc-500">Wind</span>
              <span className="text-zinc-300">{fmtUtc(snapshot.windAnalysis)} · GFS 10 m</span>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-400">Latest tropospheric NO₂ columns from every Sentinel-5P orbit.</p>
          )}
          <p className="text-[10px] text-sky-300/80">Tap a country or ocean to see why NO₂ is high or low there.</p>
          <p className="hidden sm:block text-[10px] text-zinc-500 leading-relaxed">
            Sentinel-5P images each place once a day (~13:30 local time) and near-real-time data arrives ~3 h later,
            so the newest strips are a few hours old.
          </p>
        </div>

        {/* Loading / error */}
        {phase !== 'ready' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto px-4 py-3 rounded-lg bg-[#11141d]/95 border border-[#2e3547] shadow-2xl text-xs text-zinc-300 flex items-center gap-2.5 max-w-sm">
              {phase === 'error' ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="flex-1">{error}</span>
                  <button
                    type="button"
                    onClick={() => load()}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                  </button>
                </>
              ) : (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
                  {phase === 'loading'
                    ? 'Fetching the latest Sentinel-5P orbits (up to ~30 s when new data arrived)…'
                    : `Filling cloud gaps and computing wind drift… ${Math.round(progress * 100)}%`}
                </>
              )}
            </div>
          </div>
        )}

        {/* Hover readout */}
        {hover && readout && (
          <div
            className="absolute z-20 pointer-events-none px-2.5 py-1.5 rounded bg-[#0b0d14]/95 border border-[#2e3547] text-[11px] shadow-xl"
            style={{ left: hover.x + 14, top: hover.y + 14 }}
          >
            <div className="font-mono text-zinc-400">
              {Math.abs(hover.lat).toFixed(1)}°{hover.lat >= 0 ? 'N' : 'S'} {Math.abs(hover.lon).toFixed(1)}°
              {hover.lon >= 0 ? 'E' : 'W'}
            </div>
            <div className="text-zinc-100 font-semibold">
              {readout.value === null ? '—' : `${readout.value.toFixed(1)} µmol/m²`}
            </div>
            <div className="text-zinc-400">
              {readout.kind}
              {readout.age !== null && ` · ${readout.age.toFixed(1)} h old`}
            </div>
          </div>
        )}

        {/* Tapped region: why NO2 is high or low here */}
        {insight && (
          <div className="absolute z-20 left-3 right-3 bottom-[9.5rem] sm:bottom-auto sm:left-auto sm:right-4 sm:top-4 lg:top-[8.5rem] sm:w-80 p-3 rounded-lg bg-[#11141d]/95 border border-sky-500/40 backdrop-blur-md shadow-2xl text-xs space-y-2">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-zinc-100 text-sm leading-tight">{insight.name}</div>
                <div className="text-[10px] text-zinc-500">
                  {insight.isOcean ? 'Ocean' : insight.continent ?? ''}
                  {insight.stats && (
                    <>
                      {' · '}avg <span className="text-zinc-300 font-mono">{insight.stats.mean.toFixed(1)}</span> µmol/m² ·{' '}
                      <span className={insight.stats.ratio >= 1.35 ? 'text-orange-300' : 'text-emerald-300'}>
                        {insight.stats.ratio.toFixed(1)}× background
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close region details"
                className="text-zinc-500 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ul className="space-y-1.5 text-[11px] text-zinc-300 leading-relaxed list-disc pl-4 marker:text-sky-500">
              {insight.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Legend */}
        <div className="hidden lg:block absolute top-4 right-4 z-10 w-56 p-3 rounded-lg bg-[#11141d]/90 border border-[#2e3547] backdrop-blur-md shadow-xl text-[10px] space-y-1.5">
          <div className="text-zinc-300 font-semibold text-[11px]">Tropospheric NO₂ column</div>
          <div
            className="h-2.5 rounded"
            style={{ background: LEGEND_GRADIENT }}
          />
          <div className="flex justify-between font-mono text-zinc-400">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <span key={t}>{legendValue(t).toFixed(0)}</span>
            ))}
          </div>
          <div className="text-zinc-500">
            µmol/m², log scale. Clean background below {MIN_COLUMN} is left clear; industrial regions and megacities
            reach 50–200+.
          </div>
        </div>

        {/* Controls */}
        <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-10 w-[min(640px,calc(100%-1.5rem))] p-3 rounded-lg bg-[#11141d]/90 border border-[#2e3547] backdrop-blur-md shadow-xl text-xs space-y-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              disabled={phase !== 'ready'}
              aria-label={playing ? 'Pause wind drift' : 'Play wind drift'}
              className="w-8 h-8 shrink-0 rounded-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white flex items-center justify-center cursor-pointer"
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <div className="flex-1">
              <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                <span>{driftHours === 0 ? 'Observed (latest passes)' : `Wind drift +${driftHours.toFixed(1)} h — indicative`}</span>
                <span className="font-mono">+{FRAME_HOURS[FRAME_HOURS.length - 1]} h</span>
              </div>
              <input
                type="range"
                min={0}
                max={FRAME_HOURS.length - 1}
                step={0.05}
                value={frameIndex}
                disabled={phase !== 'ready'}
                onChange={(e) => {
                  setPlaying(false);
                  setFrameIndex(Number(e.target.value));
                }}
                className="w-full accent-blue-500 cursor-pointer"
                aria-label="Wind drift hours"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { on: highlightNewest, set: setHighlightNewest, icon: Satellite, label: `Newest passes (≤${NEWEST_HOURS} h)` },
              { on: showWind, set: setShowWind, icon: Wind, label: 'Wind flow' },
              ...(mode === '3d' ? [{ on: autoRotate, set: setAutoRotate, icon: RotateCw, label: 'Auto-rotate' }] : []),
            ].map(({ on, set, icon: Icon, label }) => (
              <button
                key={label}
                type="button"
                onClick={() => set(!on)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 h-7 px-2.5 rounded border text-[11px] cursor-pointer transition-colors ${
                  on
                    ? 'bg-blue-600/25 border-blue-500/60 text-blue-200'
                    : 'bg-[#0d1017] border-[#2e3547] text-zinc-400 hover:border-[#3b4257]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => load()}
              disabled={phase === 'loading' || phase === 'computing'}
              className="ml-auto flex items-center gap-1.5 h-7 px-2.5 rounded border border-[#2e3547] bg-[#0d1017] text-zinc-400 hover:text-zinc-200 text-[11px] cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
          <div className="lg:hidden flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
            <span>{MIN_COLUMN}</span>
            <div className="flex-1 h-2 rounded" style={{ background: LEGEND_GRADIENT }} />
            <span>{MAX_COLUMN} µmol/m²</span>
          </div>
          <p className="hidden sm:block text-[10px] text-zinc-500 leading-relaxed">
            Drift: semi-Lagrangian advection on the GFS wind with eddy diffusion, relaxing to the observed map over
            NO₂&apos;s ~6 h lifetime — where today&apos;s plumes are heading, not a chemistry forecast. Satellite
            columns, not ground-level µg/m³.
          </p>
        </div>
      </main>
    </div>
  );
}
