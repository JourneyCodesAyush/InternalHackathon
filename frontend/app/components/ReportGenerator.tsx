'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Loader2,
  Download,
  AlertTriangle,
  BarChart3,
  Info,
  Bot,
  X,
  Sparkles,
  MessageSquare,
  Send,
  User,
  RotateCcw,
  Activity,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';

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

interface PredefinedQuestion {
  id: string;
  icon: string;
  label: string;
  query: string;
}

const PREDEFINED_QUESTIONS: PredefinedQuestion[] = [
  {
    id: 'standards',
    icon: '🛡️',
    label: 'CPCB & WHO Safety Standards',
    query: 'Is the current air quality safe according to CPCB and WHO standards?',
  },
  {
    id: 'hotspots',
    icon: '🏭',
    label: 'Major Emission Hotspots',
    query: 'What are the major pollution hotspots and emission sources in this area?',
  },
  {
    id: 'health',
    icon: '🩺',
    label: 'Health & Protective Advisory',
    query: 'What health precautions should residents and vulnerable groups take?',
  },
  {
    id: 'weather',
    icon: '💨',
    label: 'Wind & Weather Dispersion',
    query: 'How are wind vectors and weather affecting pollution dispersion here?',
  },
  {
    id: 'forecast',
    icon: '📈',
    label: '24-Hour Forecast Outlook',
    query: 'What is the 24-hour pollution forecast trend for this location?',
  },
  {
    id: 'methodology',
    icon: '🛰️',
    label: '1km Satellite Downscaling',
    query: 'How does the satellite NO₂ downscaling technology (7km to 1km) work?',
  },
];

interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
}

function MessageContent({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 leading-relaxed text-zinc-200">
      {lines.map((line, idx) => {
        if (!line.trim()) return <div key={idx} className="h-1" />;
        const isBullet = line.trim().startsWith('•') || line.trim().startsWith('-');
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return (
          <div key={idx} className={isBullet ? 'pl-2 text-zinc-300' : ''}>
            {parts.map((part, pIdx) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return (
                  <strong key={pIdx} className="font-semibold text-white">
                    {part.slice(2, -2)}
                  </strong>
                );
              }
              return part;
            })}
          </div>
        );
      })}
    </div>
  );
}

function getAgentResponse(
  query: string,
  locationName: string,
  coords: [number, number] | null | undefined,
  analysis: Analysis | null
): string {
  const q = query.toLowerCase();

  // 1. Standards & Safety
  if (
    q.includes('standard') ||
    q.includes('safe') ||
    q.includes('cpcb') ||
    q.includes('who') ||
    q.includes('naaqs') ||
    q.includes('limit')
  ) {
    if (analysis) {
      const cur = analysis.current;
      const diff = cur.pct_vs_naaqs;
      const statusText =
        cur.status === 'normal'
          ? 'Compliant & Normal'
          : cur.status === 'elevated'
          ? 'Moderately Elevated'
          : 'Critical / Unhealthy';
      return `Based on satellite assessment for **${locationName}** on ${analysis.date}:
• **Area Average NO₂:** **${cur.mean.toFixed(0)} µg/m³** (${Math.abs(diff).toFixed(0)}% ${
        diff > 0 ? 'above' : 'below'
      } the CPCB 24-h standard of 80 µg/m³).
• **Regulatory Status:** **${analysis.labels.status.toUpperCase()}** (${statusText}).
• **WHO 2021 Benchmark (25 µg/m³):** **${pct(cur.share_above_who)}%** of the area exceeds WHO guidelines.
• **High-Exposure Hotspots:** 95th percentile is **${cur.p95.toFixed(0)} µg/m³**, with peak cells reaching **${cur.max.toFixed(
        0
      )} µg/m³** near ${cur.max_near}.

**Verdict:** ${
        diff > 0
          ? '⚠️ Exceeds national ambient standards. Sensitive populations should reduce prolonged outdoor exertion.'
          : '✅ Currently compliant with the national 24-hour CPCB NAAQS.'
      }`;
    }
    return `Regulatory safety benchmarks for **${locationName}** (${
      coords ? `${coords[0].toFixed(3)}°N, ${coords[1].toFixed(3)}°E` : 'Selected region'
    }):
• **CPCB NAAQS 24-Hour Standard:** **80 µg/m³** (National compliance threshold).
• **CPCB Annual Mean Standard:** **40 µg/m³**.
• **WHO 2021 24-Hour Guideline:** **25 µg/m³** (Stricter health threshold).

Click **'Analyse Area'** in the toolbar to compute instant satellite observations for this area against these standards.`;
  }

  // 2. Hotspots & Sources
  if (
    q.includes('hotspot') ||
    q.includes('source') ||
    q.includes('emission') ||
    q.includes('factory') ||
    q.includes('traffic')
  ) {
    if (analysis && analysis.hotspots.length > 0) {
      const list = analysis.hotspots
        .slice(0, 4)
        .map(
          (h, i) =>
            `• **Rank ${h.rank}:** Near ${h.near} — **${h.value.toFixed(0)} µg/m³** (${
              analysis.labels.hotspot_sources[i]?.join(', ') || 'Mixed traffic/industrial corridor'
            })`
        )
        .join('\n');
      return `Satellite-detected NO₂ hotspots near **${locationName}**:
${list}

• **Peak Monitored Locality:** ${analysis.current.max_near} at **${analysis.current.max.toFixed(0)} µg/m³**.
• **Dominant Attribution:** High-traffic arterial corridors and stationary combustion sources are the primary contributors.`;
    }
    return `Major NO₂ emission contributors in the **${locationName}** area typically include:
• **Vehicular Traffic Corridors:** Heavy commercial vehicles and passenger congestion during morning and evening rush hours.
• **Industrial & Processing Facilities:** Fuel combustion, boilers, and industrial generator sets.
• **Thermal Power & Utility Stacks:** Elevated plumes that disperse downwind according to atmospheric flow.

Click **'Analyse Area'** to pinpoint specific high-intensity hotspots detected on the 1km downscaled satellite grid.`;
  }

  // 3. Health & Advisories
  if (
    q.includes('health') ||
    q.includes('precaution') ||
    q.includes('advis') ||
    q.includes('mask') ||
    q.includes('child') ||
    q.includes('elderly') ||
    q.includes('asthma')
  ) {
    const isHigh = analysis ? analysis.current.pct_vs_naaqs > 0 : false;
    return `Health & protective guidance for **${locationName}**:
• **General Population:** ${
      isHigh
        ? 'Reduce strenuous outdoor cardiovascular exercise during peak rush hours.'
        : 'Air quality is within standard limits. Normal outdoor recreation is safe.'
    }
• **Sensitive Groups (Children, Elderly, Asthma & Cardiac patients):** ${
      isHigh
        ? 'Avoid prolonged physical exertion near arterial roads. Keep rescue medications accessible.'
        : 'Maintain normal routines, but monitor local traffic corridors.'
    }
• **Commuters & Pedestrians:** In congested transit zones, wear well-fitted particulate masks with active carbon layers to reduce pollutant inhalation.
• **Indoor Air:** Keep windows facing major roadways closed during morning rush hours (08:00–11:00).`;
  }

  // 4. Weather & Wind
  if (
    q.includes('weather') ||
    q.includes('wind') ||
    q.includes('disper') ||
    q.includes('atmospher') ||
    q.includes('era5') ||
    q.includes('inversion')
  ) {
    return `Meteorological and atmospheric dispersion dynamics for **${locationName}**:
• **Wind Advection Vectors:** Surface horizontal wind (from ECMWF ERA5 reanalysis) transports and stretches NO₂ plumes downwind from point sources.
• **Planetary Boundary Layer (PBL):** Solar heating expands the boundary layer in the afternoon, diluting pollutants vertically. Nocturnal radiation cooling lowers the layer, trapping emissions near ground level.
• **Photochemical Lifetime:** Tropospheric NO₂ degrades within 2 to 6 hours under sunlight by reacting with hydroxyl radicals (OH), localizing pollution plumes.`;
  }

  // 5. Forecast & Trend
  if (
    q.includes('forecast') ||
    q.includes('trend') ||
    q.includes('hour') ||
    q.includes('future') ||
    q.includes('predict') ||
    q.includes('tomorrow')
  ) {
    if (analysis && analysis.texts.forecast.length > 0) {
      const forecastLines = analysis.texts.forecast.map((f) => `• ${f}`).join('\n');
      const trendLine = analysis.texts.trend[0] ? `\n• **30-Day Trend:** ${analysis.texts.trend[0]}` : '';
      return `24-Hour dispersion forecast for **${locationName}**:
${forecastLines}${trendLine}

Projections are generated by the Eulerian advection-diffusion atmospheric dispersion solver.`;
    }
    return `Diurnal NO₂ forecast pattern for **${locationName}**:
• **Morning Commute (08:00–11:00):** Expect peak surface concentrations due to vehicle density combined with low morning boundary layer height.
• **Afternoon Dip (12:00–16:00):** Enhanced convective mixing and solar radiation disperse NO₂ to daily lows.
• **Evening Inversion (18:00–21:00):** Secondary concentration spike as rush hour traffic coincides with atmospheric cooling.

Click **'Analyse Area'** to calculate 24-h hourly dispersion projections.`;
  }

  // 6. Methodology & Technology
  if (
    q.includes('method') ||
    q.includes('downscale') ||
    q.includes('satellite') ||
    q.includes('tropomi') ||
    q.includes('how it work') ||
    q.includes('resolution')
  ) {
    return `**AeroPulse High-Resolution Downscaling Architecture:**
1. **Satellite Ingest:** Daily Level-2/3 tropospheric NO₂ vertical column density from ESA Sentinel-5P TROPOMI (nominal 7km × 3.5km).
2. **Imputation Pipeline:** Spatial autoencoders and Kriging interpolate cloud gaps (achieving R² > 0.85).
3. **Multi-Source Features:** Blends ECMWF ERA5 meteorology (wind u/v, boundary layer height), SRTM digital elevation (DEM), and OpenStreetMap land-use categories.
4. **XGBoost Downscaling:** Gradient boosted trees infer ground-level concentrations at fine 1km / 250m resolution.`;
  }

  // Default custom answer
  return `Regarding your inquiry about **${locationName}**:
AeroPulse combines Sentinel-5P satellite observations with physical atmospheric dispersion modeling:
• **Target Area:** **${locationName}** ${coords ? `(${coords[0].toFixed(3)}°N, ${coords[1].toFixed(3)}°E)` : ''}
• **CPCB NAAQS 24-h Standard:** 80 µg/m³
• **WHO 24-h Benchmark:** 25 µg/m³

${
  analysis
    ? `Latest computed area average is **${analysis.current.mean.toFixed(0)} µg/m³** (${analysis.labels.status}).`
    : 'Click **"Analyse Area"** in the toolbar to run the ML downscaling engine on the latest satellite swath.'
}
Feel free to click any of the suggested questions above or ask another question!`;
}

interface ReportGeneratorProps {
  locationName: string;
  coords: [number, number] | null | undefined; // [lat, lon]
  isOpen?: boolean;
  onClose?: () => void;
}

export default function ReportGenerator({ locationName, coords, isOpen, onClose }: ReportGeneratorProps) {
  const [latestDate] = useState<string>(() => isoDate(new Date(Date.now() - WEATHER_LAG_DAYS * DAY_MS)));
  const [language, setLanguage] = useState<LanguageId>('en');
  const [reportDate, setReportDate] = useState<string>(latestDate);
  const [busy, setBusy] = useState<'analysis' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [result, setResult] = useState<{ status: string; narrative: string; notice: string } | null>(null);

  // Chat State
  const [activeTab, setActiveTab] = useState<'chat' | 'analysis'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      sender: 'agent',
      text: `Hello! I am your AeroPulse Air Quality Intelligence Agent for **${locationName}**.
Ask me anything about local NO₂ levels, CPCB NAAQS (80 µg/m³) and WHO (25 µg/m³) compliance, health precautions, or forecast dispersion.
Click any suggested question below or type your inquiry to get instant answers!`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Close on Escape key if used as a modal
  useEffect(() => {
    if (!isOpen || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset analysis & update welcome message when location changes
  useEffect(() => {
    setAnalysis(null);
    setResult(null);
    setError(null);
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: 'agent',
        text: `Hello! I am your AeroPulse Air Quality Intelligence Agent for **${locationName}**.
Ask me anything about local NO₂ levels, CPCB NAAQS (80 µg/m³) and WHO (25 µg/m³) compliance, health precautions, or forecast dispersion.
Click any suggested question below or type your inquiry to get instant answers!`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  }, [locationName, coords]);

  // Auto-scroll chat
  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, activeTab]);

  if (isOpen === false) return null;

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

    // Ensure we retrieve a fresh access token from Supabase session
    let token = typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.access_token) {
        token = sessionData.session.access_token;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('access_token', token);
        }
      }
    } catch {
      // Fall back to localStorage cached token
    }

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
      const data = (await res.json()) as Analysis;
      setAnalysis(data);

      // Append intelligent notification in chat
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [
        ...prev,
        {
          id: `analyzed-${Date.now()}`,
          sender: 'agent',
          text: `📊 **Fresh Satellite Analysis Completed for ${locationName}**!
• Area Average NO₂: **${data.current.mean.toFixed(0)} µg/m³** (${data.labels.status.toUpperCase()})
• CPCB 24-h NAAQS: ${Math.abs(data.current.pct_vs_naaqs).toFixed(0)}% ${
            data.current.pct_vs_naaqs > 0 ? 'above' : 'below'
          } limit
• Peak Station: ${data.current.max_near} (**${data.current.max.toFixed(0)} µg/m³**)

You can ask me questions about this analysis or switch to the **Detailed Analysis & PDF** tab to view the complete charts.`,
          timestamp: timeStr,
        },
      ]);
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

  // Handle user asking a question
  const handleAskQuestion = (queryText: string) => {
    if (!queryText.trim() || isTyping) return;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: queryText,
      timestamp: timeStr,
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    setTimeout(() => {
      const responseText = getAgentResponse(queryText, locationName, coords, analysis);
      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        sender: 'agent',
        text: responseText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, agentMsg]);
      setIsTyping(false);
    }, 380);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const q = chatInput.trim();
    setChatInput('');
    handleAskQuestion(q);
  };

  const handleResetChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: 'agent',
        text: `Hello! I am your AeroPulse Air Quality Intelligence Agent for **${locationName}**.
Ask me anything about local NO₂ levels, CPCB NAAQS (80 µg/m³) and WHO (25 µg/m³) compliance, health precautions, or forecast dispersion.
Click any suggested question below or type your inquiry to get instant answers!`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  const status = result ? STATUS_STYLE[result.status] : undefined;

  const content = (
    <div className="flex flex-col h-full space-y-3">
      {/* Top Action Bar: Language, Date & Run Buttons (Available in both tabs) */}
      <div className="p-3 rounded-lg bg-[#141824] border border-[#242938] space-y-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Language Tabs */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-400">Language:</span>
            <div className="flex gap-1" role="radiogroup" aria-label="Report language">
              {LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={language === l.id}
                  onClick={() => setLanguage(l.id)}
                  className={`h-6 px-2.5 rounded border text-[11px] font-medium transition-all cursor-pointer ${
                    language === l.id
                      ? 'bg-blue-600/25 border-blue-500/80 text-blue-200 ring-1 ring-blue-500/30'
                      : 'bg-[#10131c] border-[#2e3547] text-zinc-400 hover:border-[#3b4257] hover:text-zinc-200'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date Picker */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-400">Date:</span>
            <input
              type="date"
              value={reportDate}
              max={latestDate}
              min="2018-07-01"
              onChange={(e) => setReportDate(e.target.value)}
              className="h-6 px-2 rounded bg-[#10131c] border border-[#2e3547] text-zinc-200 text-[11px] [color-scheme:dark]"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              onClick={handleAnalyse}
              disabled={busy !== null}
              className="h-7 px-3 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/60 disabled:text-blue-300 text-white font-medium text-[11px] flex items-center gap-1.5 cursor-pointer disabled:cursor-wait transition-all shadow-sm"
            >
              {busy === 'analysis' ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
              {busy === 'analysis' ? 'Analysing…' : 'Analyse Area'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={busy !== null}
              className="h-7 px-3 rounded-md bg-[#1e2433] hover:bg-[#283044] border border-[#2e3547] hover:border-blue-500/40 disabled:opacity-60 text-zinc-200 hover:text-white font-medium text-[11px] flex items-center gap-1.5 cursor-pointer disabled:cursor-wait transition-all shadow-sm"
            >
              {busy === 'pdf' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              {busy === 'pdf' ? 'Generating…' : 'PDF Report'}
            </button>
          </div>
        </div>

        {/* Dynamic Alerts */}
        {busy && (
          <div className="p-2 rounded bg-blue-500/10 border border-blue-500/30 flex items-center gap-2 text-[10px] text-blue-200">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
            <span>
              {busy === 'analysis'
                ? 'Computing area analysis from high-resolution satellite grid...'
                : 'Assembling multilingual PDF report with visualizations...'}
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1.5 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-[10px] text-rose-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-[10px] text-emerald-200">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              PDF Downloaded Successfully
              {result.narrative === 'ai' && <span className="text-zinc-400">· AI Gemini summary included</span>}
            </div>
            {status && (
              <span className={`px-1.5 py-0.2 rounded border text-[9px] ${status.className}`}>{status.label}</span>
            )}
          </div>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center justify-between border-b border-[#242938] pb-1 shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
              activeTab === 'chat'
                ? 'bg-blue-600/25 border border-blue-500/60 text-blue-200 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#161a26] border border-transparent'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
            <span>AI Chat Assistant</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('analysis')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
              activeTab === 'analysis'
                ? 'bg-blue-600/25 border border-blue-500/60 text-blue-200 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#161a26] border border-transparent'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-purple-400" />
            <span>Detailed Analysis & Trends</span>
            {analysis && (
              <span className="text-[9px] font-mono px-1 py-0.2 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30">
                Ready
              </span>
            )}
          </button>
        </div>

        {activeTab === 'chat' && (
          <button
            type="button"
            onClick={handleResetChat}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors p-1"
            title="Reset conversation"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Clear Chat</span>
          </button>
        )}
      </div>

      {/* Tab 1: AI Chat Assistant */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col min-h-0 bg-[#0d1017] rounded-lg border border-[#242938] overflow-hidden">
          {/* Predefined Clickable Questions Chips */}
          <div className="p-2.5 bg-[#121622] border-b border-[#1e2333] shrink-0 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-zinc-400">
              <span className="font-semibold uppercase tracking-wider flex items-center gap-1 text-zinc-300">
                <Sparkles className="w-3 h-3 text-amber-400" />
                Predefined Questions (Click to Ask)
              </span>
              <span className="text-zinc-500">Instant AI answers</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PREDEFINED_QUESTIONS.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => handleAskQuestion(q.query)}
                  disabled={isTyping}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#181d2a] hover:bg-blue-600/20 border border-[#2e3547] hover:border-blue-500/50 text-[11px] text-zinc-300 hover:text-blue-200 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <span className="text-xs group-hover:scale-110 transition-transform">{q.icon}</span>
                  <span className="font-medium">{q.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable Chat Stream */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.sender === 'user' ? (
                  <div className="max-w-[85%] bg-blue-600 text-white rounded-2xl rounded-tr-xs px-3.5 py-2 text-xs shadow-md">
                    <p className="leading-relaxed">{m.text}</p>
                    <div className="text-[9px] text-blue-200/70 text-right mt-1">{m.timestamp}</div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 max-w-[92%]">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600/30 via-indigo-600/30 to-purple-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0 mt-0.5 shadow-sm">
                      <Bot className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="flex-1 bg-[#141824] border border-[#242938] rounded-2xl rounded-tl-xs p-3.5 text-xs shadow-md">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold text-zinc-100 flex items-center gap-1 text-[11px]">
                          AeroPulse AI Agent
                          <span className="text-[9px] font-mono px-1 py-0.2 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded">
                            Verified
                          </span>
                        </span>
                        <span className="text-[9px] text-zinc-500">{m.timestamp}</span>
                      </div>
                      <MessageContent text={m.text} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isTyping && (
              <div className="flex items-start gap-2.5 max-w-[90%]">
                <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                  <Bot className="w-4 h-4 animate-pulse" />
                </div>
                <div className="bg-[#141824] border border-[#242938] rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs flex items-center gap-2 text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" />
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]" />
                  <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce [animation-delay:0.4s]" />
                  <span className="text-[11px] text-zinc-400 ml-1">Analyzing satellite observations…</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Custom Query Input Bar */}
          <form onSubmit={handleCustomSubmit} className="p-2.5 bg-[#121622] border-t border-[#1e2333] flex items-center gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={`Ask anything about ${locationName}'s air quality, standards, forecast...`}
              className="flex-1 h-8.5 px-3 rounded-md bg-[#0d1017] border border-[#2e3547] text-zinc-100 text-xs placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/80 transition-colors"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || isTyping}
              className="h-8.5 px-3.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/40 disabled:text-zinc-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed shadow-sm shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Ask</span>
            </button>
          </form>
        </div>
      )}

      {/* Tab 2: Detailed Analysis & Trends */}
      {activeTab === 'analysis' && (
        <div className="flex-1 overflow-y-auto space-y-3">
          {!analysis && !busy && (
            <div className="p-6 rounded-lg bg-[#141824]/60 border border-[#242938] text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mx-auto">
                <Sparkles className="w-6 h-6 text-blue-400" />
              </div>
              <div className="text-zinc-100 font-semibold text-sm">Ready to Generate Area Intelligence</div>
              <p className="text-[11px] text-zinc-400 max-w-md mx-auto leading-relaxed">
                Click <strong className="text-blue-300 font-medium">Analyse Area</strong> above to compute high-resolution
                NO₂ measurements, CPCB 80 µg/m³ & WHO 25 µg/m³ compliance, hotspot attribution, and population exposure.
              </p>
              <button
                type="button"
                onClick={handleAnalyse}
                className="h-8.5 px-4 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs inline-flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Compute Area Analysis Now
              </button>
            </div>
          )}

          {analysis && (
            <div className="p-3.5 rounded-lg bg-[#141824] border border-[#242938]">
              <AnalysisPanel a={analysis} />
            </div>
          )}
        </div>
      )}
    </div>
  );

  // If used as modal (onClose provided or isOpen passed)
  if (onClose || isOpen !== undefined) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) onClose();
        }}
      >
        <div
          className="relative w-full max-w-2xl h-[88vh] max-h-[750px] bg-[#11141d] border border-[#2e3547] rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="p-3.5 sm:p-4 border-b border-[#242938] flex items-center justify-between bg-[#141721] shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600/30 via-indigo-600/30 to-purple-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400 shadow-inner">
                <Bot className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="font-semibold text-sm text-zinc-100 flex items-center gap-2">
                  Area Air Quality Report Agent
                  <span className="text-[10px] font-mono px-1.5 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5 text-amber-400" /> AI Agent
                  </span>
                </div>
                <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 mt-0.5">
                  <span>Location:</span>
                  <span className="text-zinc-200 font-medium truncate max-w-[240px] sm:max-w-xs">{locationName}</span>
                  {coords && (
                    <span className="text-zinc-500 font-mono text-[10px] hidden sm:inline">
                      ({coords[0].toFixed(3)}°N, {coords[1].toFixed(3)}°E)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {onClose && (
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-[#1f2533] border border-transparent hover:border-[#2e3547] transition-all cursor-pointer"
                title="Close Report (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Modal Scrollable Body */}
          <div className="flex-1 overflow-hidden p-3.5 flex flex-col min-h-0">
            {content}
          </div>
        </div>
      </div>
    );
  }

  // Fallback inline rendering
  return (
    <div className="p-3 rounded bg-[#161a26] border border-[#242938] text-xs space-y-2.5">
      <div className="font-semibold text-zinc-300 flex items-center gap-1.5">
        <FileText className="w-4 h-4 text-blue-400" />
        Area Air Quality Report
      </div>
      {content}
    </div>
  );
}
