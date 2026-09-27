'use client';

import React, { useState } from 'react';
import { FileText, Loader2, Download, AlertTriangle, BarChart3, Info } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिंदी' },
  { id: 'mr', label: 'मराठी' },
] as const;
type LanguageId = (typeof LANGUAGES)[number]['id'];

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  normal: { label: 'Normal', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  elevated: { label: 'Elevated', className: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  critical: { label: 'Critical', className: 'bg-orange-500/15 text-orange-300 border-orange-500/40' },
  critical_spike: { label: 'Critical spike', className: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  unavailable: { label: 'No data', className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40' },
};

const BANDS = [
  { key: 'normal', label: 'Normal', range: '0–40', color: '#10b981' },
  { key: 'moderate', label: 'Moderate', range: '40–80', color: '#eab308' },
  { key: 'unhealthy', label: 'Unhealthy', range: '80–180', color: '#f97316' },
  { key: 'hazardous', label: 'Hazardous', range: '>180', color: '#ef4444' },
] as const;

const NAAQS_24H = 80;
const NAAQS_ANNUAL = 40;
const WHO_24H = 25;
const HALF_SIZE_DEG = 0.15; // report area around the selected point when no known city matches
const WEATHER_LAG_DAYS = 6; // weather data reaches the model ~6 days late (matches the backend)
const DAY_MS = 86_400_000;

/** The subset of POST /api/v1/reports/analysis the panel shows. */
interface Analysis {
  date: string;
  area: { name: string };
  current: {
    mean: number;
    p95: number;
    max: number;
    max_near: string;
    status: string;
    pct_vs_naaqs: number;
    share_above_naaqs: number;
    share_above_who: number;
    band_shares: Record<string, number>;
  };
  window_stats: { mean: number };
  hotspots: { rank: number; near: string; value: number; band: string }[];
  population: { total: number; above_naaqs: number; share_above_naaqs: number; weighted_mean: number } | null;
  trend: { dates: string[]; observed: number[]; adjusted: number[]; direction: string } | null;
  labels: { status: string; hotspot_sources: string[][] };
  texts: { summary: string; forecast: string[]; trend: string[]; recommendations: string[]; notice: string | null };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "Shivaji Park, Mumbai" -> "Mumbai"; "Mumbai (Shivaji Park / MMR)" -> "Mumbai" */
function guessCity(locationName: string): string | undefined {
  const withoutBrackets = locationName.replace(/\(.*?\)/g, '').trim();
  const last = withoutBrackets.split(',').pop()?.trim();
  return last && !/^pinpoint/i.test(last) ? last : undefined;
}

function pct(share: number): string {
  const p = share * 100;
  return p > 0 && p < 1 ? '<1' : p.toFixed(0);
}

function people(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)} crore`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} lakh`;
  return n.toLocaleString('en-IN');
}

function bandColor(value: number): string {
  if (value > 180) return BANDS[3].color;
  if (value > NAAQS_24H) return BANDS[2].color;
  if (value > NAAQS_ANNUAL) return BANDS[1].color;
  return BANDS[0].color;
}

/** Horizontal bar for one value with markers at the WHO (25) and CPCB 24-h (80) standards. */
function StandardBar({ label, value }: { label: string; value: number }) {
  const scale = Math.max(120, value * 1.1);
  const at = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const diff = ((value - NAAQS_24H) / NAAQS_24H) * 100;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-200 font-mono">
          {value.toFixed(0)} µg/m³{' '}
          <span className={diff > 0 ? 'text-rose-300' : 'text-emerald-300'}>
            ({diff > 0 ? '+' : ''}
            {diff.toFixed(0)}%)
          </span>
        </span>
      </div>
      <div className="relative h-2 rounded bg-[#0d1017] border border-[#242938]">
        <div className="absolute inset-y-0 left-0 rounded" style={{ width: at(value), background: bandColor(value) }} />
        <div className="absolute -inset-y-0.5 w-px bg-sky-300" style={{ left: at(WHO_24H) }} title="WHO 25 µg/m³" />
        <div className="absolute -inset-y-0.5 w-0.5 bg-white" style={{ left: at(NAAQS_24H) }} title="CPCB 80 µg/m³" />
      </div>
    </div>
  );
}

/** Daily area average: observed vs weather-adjusted, with the 80 µg/m³ standard. */
function TrendSparkline({ trend }: { trend: NonNullable<Analysis['trend']> }) {
  const w = 240;
  const h = 56;
  const values = [...trend.observed, ...trend.adjusted, NAAQS_24H].filter(Number.isFinite);
  const hi = Math.max(...values) * 1.05;
  const lo = Math.min(0, ...values);
  const x = (i: number) => (i / Math.max(1, trend.observed.length - 1)) * w;
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
  const path = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" role="img" aria-label="30-day NO₂ trend">
      <line x1={0} x2={w} y1={y(NAAQS_24H)} y2={y(NAAQS_24H)} stroke="#f87171" strokeDasharray="3 3" strokeWidth={1} />
      <path d={path(trend.observed)} fill="none" stroke="#60a5fa" strokeWidth={1.5} />
      <path d={path(trend.adjusted)} fill="none" stroke="#34d399" strokeWidth={1.5} />
    </svg>
  );
}

function AnalysisPanel({ a }: { a: Analysis }) {
  const cur = a.current;
  const status = STATUS_STYLE[cur.status];
  return (
    <div className="space-y-3 pt-1">
      {a.texts.notice && (
        <div className="flex items-start gap-1.5 p-2 rounded border border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-200 leading-relaxed">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{a.texts.notice}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${status?.className ?? ''}`}>
          {a.labels.status}
        </span>
        <span className="text-[10px] text-zinc-500">{a.date}</span>
      </div>

      <div>
        <div className="text-2xl font-bold text-zinc-100 font-mono">
          {cur.mean.toFixed(0)} <span className="text-xs font-normal text-zinc-400">µg/m³ area average</span>
        </div>
        <div className={`text-[11px] ${cur.pct_vs_naaqs > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
          {Math.abs(cur.pct_vs_naaqs).toFixed(0)}% {cur.pct_vs_naaqs > 0 ? 'above' : 'below'} the CPCB 24-h standard (80)
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Comparison with standards</div>
        <StandardBar label="Area average" value={cur.mean} />
        <StandardBar label="95th percentile (250 m)" value={cur.p95} />
        <StandardBar label={`Highest cell · ${cur.max_near}`} value={cur.max} />
        <div className="flex gap-3 text-[9px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-white inline-block" />CPCB 80</span>
          <span className="flex items-center gap-1"><span className="w-2 h-px bg-sky-300 inline-block" />WHO 25</span>
        </div>
        <table className="w-full text-[10px] mt-1">
          <tbody className="[&_td]:py-0.5">
            <tr>
              <td className="text-zinc-400">30-day average vs annual standard (40)</td>
              <td className="text-right font-mono text-zinc-200">{a.window_stats.mean.toFixed(0)}</td>
            </tr>
            <tr>
              <td className="text-zinc-400">Area above CPCB 80</td>
              <td className="text-right font-mono text-zinc-200">{pct(cur.share_above_naaqs)}%</td>
            </tr>
            <tr>
              <td className="text-zinc-400">Area above WHO 25</td>
              <td className="text-right font-mono text-zinc-200">{pct(cur.share_above_who)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Share of area by band</div>
        <div className="flex h-2.5 rounded overflow-hidden border border-[#242938]">
          {BANDS.map((b) => (
            <div key={b.key} style={{ width: `${(cur.band_shares[b.key] ?? 0) * 100}%`, background: b.color }} title={b.label} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-2 text-[10px] text-zinc-400">
          {BANDS.map((b) => (
            <span key={b.key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ background: b.color }} />
              {b.label} {pct(cur.band_shares[b.key] ?? 0)}%
            </span>
          ))}
        </div>
      </div>

      {a.population && (
        <div className="space-y-0.5 text-[10px]">
          <div className="uppercase tracking-wide text-zinc-500">Population exposure</div>
          <div className="text-zinc-300">
            <span className="font-mono text-zinc-100">{people(a.population.above_naaqs)}</span> people above 80 µg/m³ (
            {pct(a.population.share_above_naaqs)}% of {people(a.population.total)})
          </div>
          <div className="text-zinc-400">Population-weighted average: {a.population.weighted_mean.toFixed(0)} µg/m³</div>
        </div>
      )}

      {a.hotspots.length > 0 && (
        <div className="space-y-1 text-[10px]">
          <div className="uppercase tracking-wide text-zinc-500">Hotspots</div>
          {a.hotspots.map((h, i) => (
            <div key={h.rank} className="flex items-start justify-between gap-2">
              <div>
                <div className="text-zinc-200">
                  {h.rank}. {h.near}
                </div>
                <div className="text-zinc-500">{a.labels.hotspot_sources[i]?.join(', ')}</div>
              </div>
              <span className="font-mono shrink-0" style={{ color: bandColor(h.value) }}>
                {h.value.toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1 text-[10px]">
        <div className="uppercase tracking-wide text-zinc-500">Forecast alerts (24 h)</div>
        {a.texts.forecast.map((line) => (
          <p key={line} className="text-zinc-300 leading-relaxed">
            {line}
          </p>
        ))}
      </div>

      <div className="space-y-1 text-[10px]">
        <div className="uppercase tracking-wide text-zinc-500">Weather-adjusted trend</div>
        {a.trend && <TrendSparkline trend={a.trend} />}
        {a.trend && (
          <div className="flex gap-3 text-[9px] text-zinc-500">
            <span className="text-blue-400">— observed</span>
            <span className="text-emerald-400">— weather-adjusted</span>
            <span className="text-rose-400">- - 80 standard</span>
          </div>
        )}
        <p className="text-zinc-300 leading-relaxed">{a.texts.trend[0]}</p>
      </div>

      <p className="text-[9px] text-zinc-500 leading-relaxed">
        Model estimates at 250 m; typical error about ±23 µg/m³ per location and day. Use for trends and hotspots.
      </p>
    </div>
  );
}

interface ReportGeneratorProps {
  locationName: string;
  coords: [number, number] | null | undefined; // [lat, lon]
}

export default function ReportGenerator({ locationName, coords }: ReportGeneratorProps) {
  const [latestDate] = useState<string>(() => isoDate(new Date(Date.now() - WEATHER_LAG_DAYS * DAY_MS)));
  const [language, setLanguage] = useState<LanguageId>('en');
  const [reportDate, setReportDate] = useState<string>(latestDate);
  const [busy, setBusy] = useState<'analysis' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [result, setResult] = useState<{ status: string; narrative: string; notice: string } | null>(null);

  const request = async (path: 'analysis' | 'generate'): Promise<Response> => {
    if (!coords) throw new Error('Select a location on the map first.');
    const [lat, lon] = coords;
    const start = new Date(new Date(reportDate).getTime() - 29 * DAY_MS);
    const body = {
      region_name: locationName,
      bbox: [lon - HALF_SIZE_DEG, lat - HALF_SIZE_DEG, lon + HALF_SIZE_DEG, lat + HALF_SIZE_DEG]
        .map((v) => v.toFixed(4))
        .join(','),
      start_date: isoDate(start),
      end_date: reportDate,
      language,
      use_ai: true,
      city: guessCity(locationName),
    };
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : null;
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/v1/reports/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      // fetch() rejects when the server is unreachable (not running, wrong URL, CORS)
      throw new Error(`Cannot reach the backend at ${API_BASE}. Is it running?`);
    }
    if (res.status === 401) throw new Error('Please log in to use area reports.');
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail ? String(detail.detail) : `Request failed (HTTP ${res.status}).`);
    }
    return res;
  };

  const run = async (kind: 'analysis' | 'pdf', task: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleAnalyse = () =>
    run('analysis', async () => {
      setAnalysis(null);
      const res = await request('analysis');
      setAnalysis((await res.json()) as Analysis);
    });

  const handleDownload = () =>
    run('pdf', async () => {
      setResult(null);
      const res = await request('generate');
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const filename = /filename="?([^"]+)"?/.exec(disposition)?.[1] || `no2_report_${reportDate}_${language}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setResult({
        status: res.headers.get('X-Report-Status') || '',
        narrative: res.headers.get('X-Report-Narrative') || 'template',
        notice: res.headers.get('X-Report-Notice') || '',
      });
    });

  const status = result ? STATUS_STYLE[result.status] : undefined;

  return (
    <div className="p-3 rounded bg-[#161a26] border border-[#242938] text-xs space-y-2.5">
      <div className="font-semibold text-zinc-300 flex items-center gap-1.5">
        <FileText className="w-4 h-4 text-blue-400" />
        Area Air Quality Report
      </div>
      <p className="text-[11px] text-zinc-400 leading-relaxed">
        NO₂ vs national standard, hotspots, population exposure, forecast alerts and weather-adjusted trend for{' '}
        <span className="text-zinc-200">{locationName}</span>.
      </p>

      <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Report language">
        {LANGUAGES.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={language === l.id}
            onClick={() => setLanguage(l.id)}
            className={`h-7 rounded border text-[11px] transition-colors cursor-pointer ${
              language === l.id
                ? 'bg-blue-600/25 border-blue-500/60 text-blue-200 font-semibold'
                : 'bg-[#11141d] border-[#2e3547] text-zinc-400 hover:border-[#3b4257]'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
        Report date
        <input
          type="date"
          value={reportDate}
          max={latestDate}
          min="2018-07-01"
          onChange={(e) => setReportDate(e.target.value)}
          className="h-7 px-1.5 rounded bg-[#11141d] border border-[#2e3547] text-zinc-200 text-[11px] [color-scheme:dark]"
        />
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={handleAnalyse}
          disabled={busy !== null}
          className="h-8 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:text-blue-300 text-white font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-wait transition-colors"
        >
          {busy === 'analysis' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
          {busy === 'analysis' ? 'Analysing…' : 'Analyse'}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy !== null}
          className="h-8 rounded bg-[#1f2533] hover:bg-[#283043] border border-[#2e3547] disabled:opacity-60 text-zinc-100 font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-wait transition-colors"
        >
          {busy === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {busy === 'pdf' ? 'Generating…' : 'PDF report'}
        </button>
      </div>

      {busy && (
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          A new area or date can take a few minutes; repeats are instant. If new data is slow, the latest stored map is
          used.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-1.5 text-[11px] text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-1 text-[11px] text-zinc-400">
          <div className="flex items-center gap-1.5">
            PDF downloaded
            {status && <span className={`px-1.5 py-0.5 rounded border text-[10px] ${status.className}`}>{status.label}</span>}
          </div>
          <div className="text-[10px] text-zinc-500">
            {result.narrative === 'ai' ? 'Narrative: AI summary (Gemini)' : 'Narrative: standard template'}
            {result.notice === 'cached' && ' · uses the latest stored map (see notice in the PDF)'}
            {result.notice === 'unavailable' && ' · no map available: standards and guidance only'}
          </div>
        </div>
      )}

      {analysis && <AnalysisPanel a={analysis} />}
    </div>
  );
}
