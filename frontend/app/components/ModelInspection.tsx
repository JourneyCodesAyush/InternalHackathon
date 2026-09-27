'use client';

import React, { useEffect, useState } from 'react';
import { Download, Loader2, Sparkles, X } from 'lucide-react';
import type { UploadedSatelliteFile } from '@/lib/types';
import { fetchModelGrid, geotiffUrl, gridToDataUrl, type ModelGrid } from '@/lib/modelOutput';

// Same colour stops as the map heatmap (µg/m³) so the preview matches what the map shows
const SURFACE_STOPS: [number, [number, number, number]][] = [
  [0, [0, 228, 0]],
  [40, [255, 255, 0]],
  [80, [255, 126, 0]],
  [120, [255, 0, 0]],
  [160, [143, 63, 151]],
  [200, [126, 0, 35]],
];

function ramp(v: number, stops: [number, [number, number, number]][]): [number, number, number] {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i];
    const [x0, c0] = stops[i - 1];
    if (v <= x1) {
      const t = (v - x0) / (x1 - x0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + t * (c1[k] - c0[k]))) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

/** Satellite column (µmol/m²) in a violet ramp scaled to the scene's own range. */
function columnColor(lo: number, hi: number) {
  return (v: number): [number, number, number, number] => {
    const t = Math.min(1, Math.max(0, (v - lo) / Math.max(1e-6, hi - lo)));
    return [Math.round(60 + 170 * t), Math.round(30 + 60 * t), Math.round(110 + 110 * t), 255];
  };
}

function percentile(values: Float32Array, p: number): number {
  const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  return finite.length ? finite[Math.min(finite.length - 1, Math.floor(p * finite.length))] : 0;
}

async function download(url: string, filename: string) {
  const token = window.localStorage.getItem('access_token');
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

interface Preview {
  raw: { url: string; grid: ModelGrid; lo: number; hi: number } | null;
  surface: { url: string; grid: ModelGrid } | null;
}

export default function ModelInspection({ file, onClose }: { file: UploadedSatelliteFile; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = file.stats;

  useEffect(() => {
    if (!file.jobId) return;
    let cancelled = false;
    Promise.all([fetchModelGrid({ jobId: file.jobId, kind: 'raw' }), fetchModelGrid({ jobId: file.jobId, kind: 'surface' })])
      .then(([raw, surface]) => {
        if (cancelled) return;
        const lo = percentile(raw.values, 0.02);
        const hi = percentile(raw.values, 0.98);
        setPreview({
          raw: { url: gridToDataUrl(raw, columnColor(lo, hi)), grid: raw, lo, hi },
          surface: { url: gridToDataUrl(surface, (v) => [...ramp(v, SURFACE_STOPS), 255]), grid: surface },
        });
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load the model output'));
    return () => {
      cancelled = true;
    };
  }, [file.jobId]);

  const metric = (label: string, value: string, note: string, tone = 'text-zinc-100') => (
    <div className="p-2.5 rounded bg-[#161a26] border border-[#242938]">
      <div className="text-[10px] uppercase font-mono text-zinc-400">{label}</div>
      <div className={`text-base font-bold font-mono mt-0.5 ${tone}`}>{value}</div>
      <div className="text-[10px] text-zinc-400">{note}</div>
    </div>
  );

  const date = s?.lastDate ?? preview?.surface?.grid.date ?? '';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#11141d] border border-[#2e3547] rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-xs">
        <div className="p-4 border-b border-[#242938] flex items-center justify-between bg-[#141721]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <div>
              <h3 className="font-semibold text-sm text-zinc-100">Model Inference & Downscaling Inspection</h3>
              <div className="text-[11px] text-zinc-400 font-mono">
                {s?.days ? `${s.days} days · map for ${date}` : file.name}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {s && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {metric('Cloud gap-filling', s.gapfillR2 !== undefined ? `R² = ${s.gapfillR2.toFixed(2)}` : '—', 'Random Forest, held-out pixels', 'text-emerald-400')}
              {metric('Downscaling', s.downscaleR2 !== undefined ? `R² = ${s.downscaleR2.toFixed(2)}` : '—', 'XGBoost, held-out days')}
              {metric('Resolution', `${s.originalResolution} → ${s.downscaledResolution}`, 'ERA5, Sentinel-2, DEM, land use', 'text-blue-400')}
              {metric('Processing time', `${Math.round(s.processingDurationSec)} s`, 'whole time series', 'text-purple-400')}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 rounded bg-[#161a26] border border-[#242938] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-200">Satellite input ({date})</span>
                {s?.cloudCoverLastDay !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-[10px]">
                    {s.cloudCoverLastDay.toFixed(1)}% CLOUD
                  </span>
                )}
              </div>
              <div className="relative aspect-video rounded bg-[repeating-linear-gradient(45deg,#1a1d27_0,#1a1d27_6px,#11141d_6px,#11141d_12px)] border border-[#242938] overflow-hidden flex items-center justify-center">
                {preview?.raw ? (
                  // eslint-disable-next-line @next/next/no-img-element -- generated data URL
                  <img src={preview.raw.url} alt="Satellite NO2 column" className="h-full w-full object-contain [image-rendering:pixelated]" />
                ) : error ? (
                  <span className="text-rose-300 px-3 text-center">{error}</span>
                ) : (
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                )}
              </div>
              <div className="text-[11px] text-zinc-400 leading-snug">
                Sentinel-5P tropospheric NO₂ column at {s?.originalResolution ?? '~3.9 km'}
                {preview?.raw && ` (${preview.raw.lo.toFixed(0)}–${preview.raw.hi.toFixed(0)} µmol/m²)`}; hatched = cloud gaps.
              </div>
            </div>

            <div className="p-3 rounded bg-[#161a26] border border-blue-500/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-blue-400">Model output: ground-level NO₂</span>
                {s && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px]">
                    {s.cloudCoverCleaned.toFixed(1)}% GAPS
                  </span>
                )}
              </div>
              <div className="relative aspect-video rounded bg-[#0a0c12] border border-[#242938] overflow-hidden flex items-center justify-center">
                {preview?.surface ? (
                  // eslint-disable-next-line @next/next/no-img-element -- generated data URL
                  <img src={preview.surface.url} alt="Model NO2 map" className="h-full w-full object-contain" />
                ) : error ? null : (
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                )}
              </div>
              <div className="text-[11px] text-zinc-300 leading-snug">
                Gap-filled, downscaled to {s?.downscaledResolution ?? '250 m'} and converted to ground level (µg/m³)
                {s && `: mean ${s.meanNO2.toFixed(0)}, peak ${s.peakNO2.toFixed(0)} µg/m³`}. This is the layer the
                Geospatial Map shows.
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-[#242938] bg-[#141721] flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-zinc-400 font-mono">EXPORT: GEOTIFF (EPSG:4326)</div>
          <div className="flex items-center gap-2">
            {file.jobId && (
              <>
                <button
                  onClick={() => download(geotiffUrl({ jobId: file.jobId, kind: 'surface' }), `no2_ground_${date}.tif`).catch((e) => setError(e.message))}
                  className="px-3 py-1.5 rounded bg-[#1f2538] hover:bg-[#283049] border border-[#2e3547] text-zinc-200 text-xs font-medium flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  Model output (.tif)
                </button>
                <button
                  onClick={() => download(geotiffUrl({ jobId: file.jobId, kind: 'raw' }), `no2_satellite_${date}.tif`).catch((e) => setError(e.message))}
                  className="px-3 py-1.5 rounded bg-[#1f2538] hover:bg-[#283049] border border-[#2e3547] text-zinc-200 text-xs font-medium flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  Satellite input (.tif)
                </button>
              </>
            )}
            <button onClick={onClose} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
