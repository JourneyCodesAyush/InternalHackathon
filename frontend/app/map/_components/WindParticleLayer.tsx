'use client';

import { useEffect, useRef } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { BandData } from './GeoTiffLayer';

interface Particle {
  lon: number;
  lat: number;
  age: number;
  maxAge: number;
  prevPixelX: number;
  prevPixelY: number;
}

export interface WindParticleLayerProps {
  currentBand: BandData | null;
  nextBand: BandData | null;
  interpolationFactor: number;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  visible: boolean;
  numParticles?: number;
}

// Bilinear sample of a Float32Array band at fractional grid coordinates (gx, gy)
function bilinearSample(
  band: Float32Array,
  width: number,
  height: number,
  gx: number,
  gy: number,
): number {
  const x0 = Math.max(0, Math.min(width - 2, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(height - 2, Math.floor(gy)));
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = gx - x0;
  const fy = gy - y0;

  const v00 = band[y0 * width + x0];
  const v10 = band[y0 * width + x1];
  const v01 = band[y1 * width + x0];
  const v11 = band[y1 * width + x1];

  return v00 * (1 - fx) * (1 - fy) +
         v10 * fx * (1 - fy) +
         v01 * (1 - fx) * fy +
         v11 * fx * fy;
}

function lngLatToGrid(
  lon: number,
  lat: number,
  bbox: [number, number, number, number],
  width: number,
  height: number,
): [number, number] {
  const [minX, minY, maxX, maxY] = bbox;
  const gx = ((lon - minX) / (maxX - minX)) * (width - 1);
  // GeoTIFF row 0 is top (maxY), so invert
  const gy = ((maxY - lat) / (maxY - minY)) * (height - 1);
  return [gx, gy];
}

function randomLon(bbox: [number, number, number, number]): number {
  return bbox[0] + Math.random() * (bbox[2] - bbox[0]);
}

function randomLat(bbox: [number, number, number, number]): number {
  return bbox[1] + Math.random() * (bbox[3] - bbox[1]);
}

function windSpeedColor(speed: number): string {
  // speed in m/s — 0→8 mapped to blue→cyan→white
  const t = Math.min(1, speed / 8);
  const r = Math.round(t * 220);
  const g = Math.round(120 + t * 135);
  const b = 255;
  return `rgba(${r},${g},${b},0.85)`;
}

export default function WindParticleLayer({
  currentBand,
  nextBand,
  interpolationFactor,
  mapRef,
  visible,
  numParticles = 2000,
}: WindParticleLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);

  // Keep live refs for values the rAF loop reads
  const currentBandRef = useRef<BandData | null>(currentBand);
  const nextBandRef = useRef<BandData | null>(nextBand);
  const tRef = useRef(interpolationFactor);
  const visibleRef = useRef(visible);

  useEffect(() => { currentBandRef.current = currentBand; }, [currentBand]);
  useEffect(() => { nextBandRef.current = nextBand; }, [nextBand]);
  useEffect(() => { tRef.current = interpolationFactor; }, [interpolationFactor]);
  useEffect(() => { visibleRef.current = visible; }, [visible]);

  // ── Create overlay canvas and size it to match the map container ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const container = map.getContainer();
    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    container.appendChild(canvas);
    canvasRef.current = canvas;

    const handleResize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      canvas.remove();
      canvasRef.current = null;
    };
  }, [mapRef]);

  // ── Seed particles once band data is available ────────────────────────────
  useEffect(() => {
    const band = currentBand ?? nextBand;
    if (!band) return;
    const bbox = band.bbox;
    particlesRef.current = Array.from({ length: numParticles }, () => ({
      lon: randomLon(bbox),
      lat: randomLat(bbox),
      age: Math.random() * 60,
      maxAge: 40 + Math.random() * 60,
      prevPixelX: 0,
      prevPixelY: 0,
    }));
  }, [currentBand, nextBand, numParticles]);

  // ── rAF animation loop ────────────────────────────────────────────────────
  useEffect(() => {
    const DT = 1 / 60; // seconds per frame
    const SPEED_SCALE = 0.0008; // degrees per (m/s * second)

    function animate() {
      rafRef.current = requestAnimationFrame(animate);

      const canvas = canvasRef.current;
      const map = mapRef.current;
      const currBand = currentBandRef.current;
      const nxtBand = nextBandRef.current;

      if (!canvas || !map || !currBand) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const band = nxtBand ?? currBand;
      const t = tRef.current;

      if (!visibleRef.current) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // Trail fade — partial clear creates the comet-tail effect
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const particles = particlesRef.current;
      const { width, height, bbox } = currBand;

      for (const p of particles) {
        const [gx, gy] = lngLatToGrid(p.lon, p.lat, bbox, width, height);
        const inBounds =
          p.lon >= bbox[0] && p.lon <= bbox[2] &&
          p.lat >= bbox[1] && p.lat <= bbox[3];

        if (!inBounds || p.age > p.maxAge) {
          // Reset to random position
          p.lon = randomLon(bbox);
          p.lat = randomLat(bbox);
          p.age = 0;
          p.maxAge = 40 + Math.random() * 60;
          const px = map.project([p.lon, p.lat] as [number, number]);
          p.prevPixelX = px.x;
          p.prevPixelY = px.y;
          continue;
        }

        // Interpolated U and V between current and next band
        const uA = bilinearSample(currBand.u, width, height, gx, gy);
        const vA = bilinearSample(currBand.v, width, height, gx, gy);
        const uB = bilinearSample(band.u, width, height, gx, gy);
        const vB = bilinearSample(band.v, width, height, gx, gy);
        const u = uA * (1 - t) + uB * t;
        const v = vA * (1 - t) + vB * t;

        // Advance position in lon/lat space
        p.lon += u * DT * SPEED_SCALE;
        p.lat += v * DT * SPEED_SCALE;
        p.age += 1;

        // Project to screen space
        const projected = map.project([p.lon, p.lat] as [number, number]);
        const px = projected.x;
        const py = projected.y;

        const speed = Math.sqrt(u * u + v * v);
        ctx.strokeStyle = windSpeedColor(speed);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.prevPixelX, p.prevPixelY);
        ctx.lineTo(px, py);
        ctx.stroke();

        p.prevPixelX = px;
        p.prevPixelY = py;
      }
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [mapRef]);

  // This component renders no React DOM — everything is on the canvas
  return null;
}
