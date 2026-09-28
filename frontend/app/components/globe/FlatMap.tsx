'use client';

import React, { useEffect, useRef } from 'react';
import { Map as MapLibreMap, setWorkerUrl, type ImageSource, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Position } from 'geojson';
import { MAX_COLUMN, MIN_COLUMN, type GlobeFrames, type HoverInfo, type MapView } from './GlobeCanvas';
import { worldCountries } from './countries';

setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

/**
 * 2-D view of the global NO₂ layer on MapLibre (Web Mercator). It uses no external map tiles: land, borders
 * (India's official boundary, see countries.ts) and graticule come from the same data as the 3-D globe, and
 * the NO₂ layer uses the globe's colour scale, so switching views changes only the projection.
 */
export interface FlatMapApi {
  jumpTo: (view: MapView) => void;
  getView: () => MapView;
  easeTo: (view: Partial<MapView>, durationMs?: number) => Promise<void>;
  /** Resolves once the style and the NO₂ layer are drawn. */
  ready: () => Promise<void>;
}

interface FlatMapProps {
  data: GlobeFrames | null;
  frameIndex: number;
  highlightNewest: boolean;
  newestHours: number;
  showWind: boolean;
  onHover: (info: HoverInfo | null) => void;
  onSelect: (point: { lat: number; lon: number } | null) => void;
  outline: number[][][] | null;
  apiRef: React.MutableRefObject<FlatMapApi | null>;
}

const MAX_LAT = 85.0511;
const CANVAS_SIZE = 1024; // NO₂ layer resampled to Web-Mercator rows
const WIND_PARTICLES = 2500;

// same stops as the globe shader's ramp()
const RAMP: [number, number, number][] = [
  [0.23, 0.1, 0.45],
  [0.62, 0.16, 0.55],
  [0.93, 0.35, 0.28],
  [0.99, 0.7, 0.22],
  [1.0, 0.96, 0.7],
];

function ramp(t: number): [number, number, number] {
  const x = Math.min(0.9999, Math.max(0, t)) * 4;
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Draw one (fractional) drift frame into a Web-Mercator canvas, as the globe shader colours it. */
function paint(
  canvas: HTMLCanvasElement,
  data: GlobeFrames,
  frameIndex: number,
  highlightNewest: boolean,
  newestHours: number,
) {
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE);
  const last = data.frames.length - 1;
  const f = Math.min(Math.max(frameIndex, 0), last);
  const i0 = Math.floor(f);
  const i1 = Math.min(last, i0 + 1);
  const m = f - i0;
  const A = data.frames[i0];
  const B = data.frames[i1];
  const { width, height } = data;
  const logRange = Math.log(MAX_COLUMN / MIN_COLUMN);
  const yMax = Math.log(Math.tan(Math.PI / 4 + (MAX_LAT * Math.PI) / 360));
  for (let y = 0; y < CANVAS_SIZE; y++) {
    const merc = yMax - ((y + 0.5) / CANVAS_SIZE) * 2 * yMax;
    const lat = (2 * Math.atan(Math.exp(merc)) - Math.PI / 2) * (180 / Math.PI);
    // bilinear between cell centres (as the globe's linear texture filter), longitude wraps
    const fy = Math.min(height - 1, Math.max(0, ((90 - lat) / 180) * height - 0.5));
    const j0 = Math.floor(fy);
    const j1 = Math.min(height - 1, j0 + 1);
    const wy = fy - j0;
    for (let x = 0; x < CANVAS_SIZE; x++) {
      const fx = ((x + 0.5) / CANVAS_SIZE) * width - 0.5;
      const i0 = (Math.floor(fx) + width) % width;
      const i1 = (i0 + 1) % width;
      const wx = fx - Math.floor(fx);
      const cells = [j0 * width + i0, j0 * width + i1, j1 * width + i0, j1 * width + i1];
      const w = [(1 - wx) * (1 - wy), wx * (1 - wy), (1 - wx) * wy, wx * wy];
      let value = 0;
      let conf = 0;
      for (let c = 0; c < 4; c++) {
        const kk = 2 * cells[c];
        value += w[c] * (A[kk] * (1 - m) + B[kk] * m);
        conf += w[c] * (A[kk + 1] * (1 - m) + B[kk + 1] * m);
      }
      const k = cells[0];
      const t = Math.min(1, Math.max(0, Math.log(Math.max(value, 0.01) / MIN_COLUMN) / logRange));
      let alpha = conf * smoothstep(0, 0.3, t) * 0.95;
      if (highlightNewest && !(data.ageH[k] <= newestHours)) alpha *= 0.22;
      if (alpha <= 0.004) continue;
      const [r, g, b] = ramp(t);
      const o = 4 * (y * CANVAS_SIZE + x);
      img.data[o] = r * 255;
      img.data[o + 1] = g * 255;
      img.data[o + 2] = b * 255;
      img.data[o + 3] = alpha * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function graticule(): GeoJSON.FeatureCollection {
  const lines: Position[][] = [];
  for (let lon = -180; lon <= 180; lon += 30) lines.push([[lon, -MAX_LAT], [lon, MAX_LAT]]);
  for (let lat = -60; lat <= 60; lat += 30) lines.push(Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]));
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }] };
}

export default function FlatMap({
  data,
  frameIndex,
  highlightNewest,
  newestHours,
  showWind,
  onHover,
  onSelect,
  outline,
  apiRef,
}: FlatMapProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const windRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef<Promise<void> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ onHover, onSelect, showWind, data });

  useEffect(() => {
    propsRef.current = { onHover, onSelect, showWind, data };
  }, [onHover, onSelect, showWind, data]);

  // Map setup (once)
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const no2Canvas = document.createElement('canvas');
    no2Canvas.width = CANVAS_SIZE;
    no2Canvas.height = CANVAS_SIZE;
    canvasRef.current = no2Canvas;
    const corners: [[number, number], [number, number], [number, number], [number, number]] = [
      [-180, MAX_LAT],
      [180, MAX_LAT],
      [180, -MAX_LAT],
      [-180, -MAX_LAT],
    ];
    const map = new MapLibreMap({
      container: mount,
      center: [78, 20],
      zoom: 1.6,
      minZoom: 0.4,
      maxZoom: 9,
      renderWorldCopies: true,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      style: {
        version: 8,
        sources: {
          countries: { type: 'geojson', data: worldCountries() },
          graticule: { type: 'geojson', data: graticule() },
          no2: { type: 'image', url: no2Canvas.toDataURL(), coordinates: corners },
          selected: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [
          { id: 'ocean', type: 'background', paint: { 'background-color': '#0a1120' } },
          { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': 'rgba(96,125,170,0.14)', 'line-width': 1 } },
          { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': '#18233a' } },
          { id: 'no2', type: 'raster', source: 'no2', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
          {
            id: 'borders',
            type: 'line',
            source: 'countries',
            paint: { 'line-color': 'rgba(165,185,220,0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.4] },
          },
          { id: 'selected', type: 'line', source: 'selected', paint: { 'line-color': '#7dd3fc', 'line-width': 2 } },
        ],
      },
    });
    mapRef.current = map;
    loadedRef.current = new Promise((resolve) => map.once('load', () => resolve()));

    map.on('mousemove', (e) => {
      const lon = ((((e.lngLat.lng + 180) % 360) + 360) % 360) - 180;
      propsRef.current.onHover({ lat: e.lngLat.lat, lon, x: e.point.x, y: e.point.y });
    });
    map.on('mouseout', () => propsRef.current.onHover(null));
    map.on('click', (e) => {
      const lon = ((((e.lngLat.lng + 180) % 360) + 360) % 360) - 180;
      propsRef.current.onSelect({ lat: e.lngLat.lat, lon });
    });

    apiRef.current = {
      jumpTo: ({ lat, lon, zoom }) => map.jumpTo({ center: [lon, lat], zoom, bearing: 0, pitch: 0 }),
      getView: () => {
        const c = map.getCenter();
        return { lat: c.lat, lon: c.wrap().lng, zoom: map.getZoom() };
      },
      easeTo: (view, ms = 700) =>
        new Promise((resolve) => {
          map.once('moveend', () => resolve());
          map.easeTo({
            ...(view.lat !== undefined && view.lon !== undefined ? { center: [view.lon, view.lat] as [number, number] } : {}),
            ...(view.zoom !== undefined ? { zoom: view.zoom } : {}),
            duration: ms,
          });
        }),
      ready: async () => {
        await loadedRef.current;
        if (!map.loaded()) await new Promise<void>((r) => map.once('idle', () => r()));
      },
    };

    // ---- wind particles on a canvas above the map (lon/lat advected on the GFS field, fading trails) ----
    const windCanvas = windRef.current!;
    const wctx = windCanvas.getContext('2d')!;
    const lat = new Float32Array(WIND_PARTICLES);
    const lon = new Float32Array(WIND_PARTICLES);
    const life = new Float32Array(WIND_PARTICLES);
    const seed = (p: number) => {
      const b = map.getBounds();
      lat[p] = Math.max(-80, Math.min(80, b.getSouth() + Math.random() * (b.getNorth() - b.getSouth())));
      lon[p] = b.getWest() + Math.random() * (b.getEast() - b.getWest());
      life[p] = 40 + Math.random() * 80;
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      windCanvas.width = mount.clientWidth * dpr;
      windCanvas.height = mount.clientHeight * dpr;
      wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    const clear = () => wctx.clearRect(0, 0, windCanvas.width, windCanvas.height);
    map.on('movestart', () => {
      clear();
      for (let p = 0; p < WIND_PARTICLES; p++) life[p] = 0;
    });
    for (let p = 0; p < WIND_PARTICLES; p++) seed(p);

    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      const field = propsRef.current.data;
      if (!propsRef.current.showWind || !field || map.isMoving()) {
        clear();
        return;
      }
      // fade the previous trails
      wctx.save();
      wctx.globalCompositeOperation = 'destination-in';
      wctx.fillStyle = 'rgba(0,0,0,0.93)';
      wctx.fillRect(0, 0, mount.clientWidth, mount.clientHeight);
      wctx.restore();
      wctx.lineWidth = 1.1;
      const res = 360 / field.width;
      // about 0.18 px per frame per m/s on screen, whatever the zoom
      const pxPerDeg = (512 * Math.pow(2, map.getZoom())) / 360;
      const scale = 0.18 / pxPerDeg;
      wctx.beginPath();
      for (let p = 0; p < WIND_PARTICLES; p++) {
        if (life[p] <= 0) {
          seed(p);
          continue;
        }
        const wrapped = ((((lon[p] + 180) % 360) + 360) % 360) - 180;
        const i = Math.min(field.width - 1, Math.max(0, Math.floor((wrapped + 180) / res)));
        const j = Math.min(field.height - 1, Math.max(0, Math.floor((90 - lat[p]) / res)));
        const k = j * field.width + i;
        const a = map.project([lon[p], lat[p]]);
        lon[p] += (field.u[k] * scale) / Math.max(0.15, Math.cos((lat[p] * Math.PI) / 180));
        lat[p] += field.v[k] * scale;
        life[p] -= 1;
        if (!(Math.abs(lat[p]) < 84) || !Number.isFinite(lon[p])) {
          life[p] = 0;
          continue;
        }
        const b = map.project([lon[p], lat[p]]);
        if (Math.abs(b.x - a.x) > 40) continue;
        wctx.moveTo(a.x, a.y);
        wctx.lineTo(b.x, b.y);
      }
      wctx.strokeStyle = 'rgba(205,225,255,0.55)';
      wctx.stroke();
    };
    step();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      apiRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [apiRef]);

  // NO₂ layer: repaint when the data, the drift frame (in 0.25 h steps) or the highlight changes
  const frameStep = Math.round(frameIndex * 4) / 4;
  useEffect(() => {
    const map = mapRef.current;
    const canvas = canvasRef.current;
    if (!map || !canvas || !data) return;
    let cancelled = false;
    loadedRef.current?.then(() => {
      if (cancelled) return;
      paint(canvas, data, frameStep, highlightNewest, newestHours);
      (map.getSource('no2') as ImageSource | undefined)?.updateImage({ url: canvas.toDataURL() });
    });
    return () => {
      cancelled = true;
    };
  }, [data, frameStep, highlightNewest, newestHours]);

  // Selected country outline
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    loadedRef.current?.then(() =>
      (map.getSource('selected') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: outline
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: outline } }]
          : [],
      }),
    );
  }, [outline]);

  return (
    <div className="absolute inset-0">
      {/* inline style: maplibre-gl.css sets .maplibregl-map { position: relative }, which beats Tailwind */}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <canvas ref={windRef} className="absolute inset-0 w-full h-full pointer-events-none" />
    </div>
  );
}
