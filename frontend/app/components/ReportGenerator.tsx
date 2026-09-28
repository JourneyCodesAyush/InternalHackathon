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
  User,
  RotateCcw,
  Activity,
  Send,
} from 'lucide-react';

import DatePicker from '../visualization/_components/DatePicker';
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
  labels: { status: string; hotspot_sources: string[][]; anomaly_kinds?: string[][]; anomaly_title?: string };
  texts: {
    summary: string;
    forecast: string[];
    trend: string[];
    recommendations: string[];
    notice: string | null;
    /** Unusual activity: places breaking the limit or rising far above their usual level, with likely causes. */
    anomalies?: string[];
    /** Drone camera haze (DCP) combined with the NO₂ model. */
    haze?: string;
    /** One line per pre-inspection drone flight plan (full plans are in the PDF). */
    flight_plans?: string[];
  };
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
      <div className="flex justify-between text-[13px]">
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
        <div className="flex items-start gap-1.5 p-2 rounded border border-amber-500/40 bg-amber-500/10 text-[13px] text-amber-200 leading-relaxed">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{a.texts.notice}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className={`px-1.5 py-0.5 rounded border text-[13px] font-semibold ${status?.className ?? ''}`}>
          {a.labels.status}
        </span>
        <span className="text-[13px] text-zinc-500">{a.date}</span>
      </div>

      <div>
        <div className="text-3xl font-bold text-zinc-100 font-mono">
          {cur.mean.toFixed(0)} <span className="text-sm font-normal text-zinc-400">µg/m³ area average</span>
        </div>
        <div className={`text-[14px] ${cur.pct_vs_naaqs > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
          {Math.abs(cur.pct_vs_naaqs).toFixed(0)}% {cur.pct_vs_naaqs > 0 ? 'above' : 'below'} the CPCB 24-h standard (80)
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[13px] uppercase tracking-wide text-zinc-500">
          <AlertTriangle className={`w-3 h-3 ${a.texts.anomalies?.length ? 'text-rose-400' : 'text-emerald-400'}`} />
          {a.labels.anomaly_title ?? 'Unusual activity and likely causes'}
        </div>
        {a.texts.anomalies?.length ? (
          a.texts.anomalies.map((line, i) => (
            <div key={line} className="p-2 rounded border border-rose-500/40 bg-rose-500/10 text-[13px] leading-relaxed">
              <div className="flex flex-wrap gap-1 mb-1">
                {(a.labels.anomaly_kinds?.[i] ?? []).map((k) => (
                  <span key={k} className="px-1 py-0.5 rounded bg-rose-500/20 text-rose-200 text-[12px] font-semibold">
                    {k}
                  </span>
                ))}
              </div>
              <span className="text-rose-100">{line}</span>
            </div>
          ))
        ) : (
          <p className="text-[13px] text-emerald-300">
            No unusual activity: no place breaks the 80 µg/m³ limit or rises far above its own recent levels.
          </p>
        )}
      </div>

      {a.texts.haze && (
        <div className="space-y-1">
          <div className="text-[13px] uppercase tracking-wide text-zinc-500">Haze (drone camera) + NO₂</div>
          <p className="text-[13px] text-zinc-300 leading-relaxed">{a.texts.haze}</p>
        </div>
      )}

      {a.texts.flight_plans && a.texts.flight_plans.length > 0 && (
        <div className="space-y-1">
          <div className="text-[13px] uppercase tracking-wide text-zinc-500">Pre-inspection drone flights</div>
          {a.texts.flight_plans.map((line) => (
            <div key={line} className="p-2 rounded border border-sky-500/40 bg-sky-500/10 text-[13px] text-sky-100">
              {line}
            </div>
          ))}
          <p className="text-[12px] text-zinc-500">Full flight plans (map, wind, elevation, battery, waypoints) are in the PDF report.</p>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-[13px] uppercase tracking-wide text-zinc-500">Comparison with standards</div>
        <StandardBar label="Area average" value={cur.mean} />
        <StandardBar label="95th percentile (250 m)" value={cur.p95} />
        <StandardBar label={`Highest cell · ${cur.max_near}`} value={cur.max} />
        <div className="flex gap-3 text-[12px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-white inline-block" />CPCB 80</span>
          <span className="flex items-center gap-1"><span className="w-2 h-px bg-sky-300 inline-block" />WHO 25</span>
        </div>
        <table className="w-full text-[13px] mt-1">
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
        <div className="text-[13px] uppercase tracking-wide text-zinc-500">Share of area by band</div>
        <div className="flex h-2.5 rounded overflow-hidden border border-[#242938]">
          {BANDS.map((b) => (
            <div key={b.key} style={{ width: `${(cur.band_shares[b.key] ?? 0) * 100}%`, background: b.color }} title={b.label} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-2 text-[13px] text-zinc-400">
          {BANDS.map((b) => (
            <span key={b.key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ background: b.color }} />
              {b.label} {pct(cur.band_shares[b.key] ?? 0)}%
            </span>
          ))}
        </div>
      </div>

      {a.population && (
        <div className="space-y-0.5 text-[13px]">
          <div className="uppercase tracking-wide text-zinc-500">Population exposure</div>
          <div className="text-zinc-300">
            <span className="font-mono text-zinc-100">{people(a.population.above_naaqs)}</span> people above 80 µg/m³ (
            {pct(a.population.share_above_naaqs)}% of {people(a.population.total)})
          </div>
          <div className="text-zinc-400">Population-weighted average: {a.population.weighted_mean.toFixed(0)} µg/m³</div>
        </div>
      )}

      {a.hotspots.length > 0 && (
        <div className="space-y-1 text-[13px]">
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

      <div className="space-y-1 text-[13px]">
        <div className="uppercase tracking-wide text-zinc-500">Forecast alerts (24 h)</div>
        {a.texts.forecast.map((line) => (
          <p key={line} className="text-zinc-300 leading-relaxed">
            {line}
          </p>
        ))}
      </div>

      <div className="space-y-1 text-[13px]">
        <div className="uppercase tracking-wide text-zinc-500">Weather-adjusted trend</div>
        {a.trend && <TrendSparkline trend={a.trend} />}
        {a.trend && (
          <div className="flex gap-3 text-[12px] text-zinc-500">
            <span className="text-blue-400">— observed</span>
            <span className="text-emerald-400">— weather-adjusted</span>
            <span className="text-rose-400">- - 80 standard</span>
          </div>
        )}
        <p className="text-zinc-300 leading-relaxed">{a.texts.trend[0]}</p>
      </div>

      <p className="text-[12px] text-zinc-500 leading-relaxed">
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

/** The questions the agent answers, each from the AI model's analysis and the stored guideline templates. */
const PREDEFINED_QUESTIONS: PredefinedQuestion[] = [
  {
    id: 'fullcheck',
    icon: '🩻',
    label: 'Full check at this spot',
    query: 'What is the NO₂ level here, is it dangerous by WHO standards, how will it change, what does this exposure do to me, how should I protect my health, and what is the main contributor?',
  },
  { id: 'standards', icon: '🛡️', label: 'Within CPCB & WHO limits?', query: 'Is the air here within the CPCB and WHO limits?' },
  { id: 'hotspots', icon: '🏭', label: 'Hotspots & their causes', query: 'Where are the NO₂ hotspots and what is causing them?' },
  { id: 'unusual', icon: '🚨', label: 'Suspicious / unusual activity', query: 'Is there any suspicious or unusual pollution activity?' },
  { id: 'forecast', icon: '📈', label: 'Next 24 hours', query: 'What will NO₂ do over the next 24 hours?' },
  { id: 'trend', icon: '📉', label: 'Getting better or worse?', query: 'Is pollution here getting better or worse?' },
  { id: 'exposure', icon: '🩺', label: 'People exposed & precautions', query: 'How many people are exposed and what precautions should they take?' },
  { id: 'drone', icon: '🛸', label: 'Drone inspection needed?', query: 'Does any site here need a drone inspection before officials visit?' },
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

function fmtPeople(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)} crore`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} lakh`;
  return n.toLocaleString('en-IN');
}

/** GET /api/v1/trends/point: the day's value at the point and the forecasting model's predictions. */
interface PointCheck {
  date: string;
  inside: boolean;
  value: number;
  horizons: { hours: number; no2: number; confidence: number }[];
  wind: { speed: number; deg: number; direction: string };
}

interface SourcePoint {
  name: string;
  category: string;
  coordinates: [number, number];
  emissionFactor: number;
}

interface SourceLine {
  name: string;
  kind: string;
  emissionFactor: number;
  path: [number, number][];
}

const CONTRIBUTOR_LABEL: Record<string, string> = {
  FACTORY: 'industrial / factory emissions',
  POWER_PLANT: 'power plant combustion',
  motorway: 'heavy traffic on motorways',
  trunk: 'traffic on major arterial roads',
  railway: 'diesel rail traffic',
};

function distKm(a: [number, number], b: [number, number]): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function bearingDeg(a: [number, number], b: [number, number]): number {
  const [la1, lo1, la2, lo2] = [a[0], a[1], b[0], b[1]].map((v) => (v * Math.PI) / 180);
  const y = Math.sin(lo2 - lo1) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Main contributor at a point: mapped sources within 3 km weighted by emission factor and distance, and
 * counted 1.5x when they lie upwind (the day's wind carries their NO₂ to the point).
 */
function mainContributor(
  here: [number, number],
  windFromDeg: number,
  points: SourcePoint[],
  lines: SourceLine[]
): { category: string; example: string; distance: number; upwind: boolean; share: number; count: number } | null {
  const scores: Record<string, { score: number; example: string; distance: number; upwind: boolean; names: Set<string> }> = {};
  const add = (category: string, name: string, pos: [number, number], factor: number) => {
    const d = distKm(here, pos);
    if (d > 3) return;
    const diff = Math.abs(((bearingDeg(here, pos) - windFromDeg + 540) % 360) - 180);
    const upwind = diff < 60;
    const w = (factor / Math.pow(d + 0.3, 1.5)) * (upwind ? 1.5 : 1);
    const cur = scores[category] ?? { score: 0, example: name, distance: d, upwind, names: new Set<string>() };
    cur.score += w;
    cur.names.add(name);
    if (d < cur.distance) Object.assign(cur, { example: name, distance: d, upwind });
    scores[category] = cur;
  };
  points.forEach((p) => add(p.category, p.name, p.coordinates, p.emissionFactor));
  lines.forEach((l) => {
    const nearest = l.path.reduce((best, pt) => (distKm(here, pt) < distKm(here, best) ? pt : best), l.path[0]);
    add(l.kind, l.name, nearest, l.emissionFactor);
  });
  const total = Object.values(scores).reduce((t, v) => t + v.score, 0);
  const top = Object.entries(scores).sort((x, y) => y[1].score - x[1].score)[0];
  if (!top || total <= 0) return null;
  const { names, ...rest } = top[1];
  return { category: top[0], ...rest, count: names.size, share: top[1].score / total };
}

function healthAdvice(level: number): string {
  if (level <= 25) return 'Air is within the WHO guideline: normal outdoor activity is fine for everyone.';
  if (level <= 80)
    return 'Above the WHO guideline: children, older adults and people with asthma or heart disease should limit long or strenuous outdoor exercise near busy roads; others can continue normally.';
  if (level <= 180)
    return 'Unhealthy: sensitive groups should avoid outdoor exertion; everyone should reduce time near traffic, keep windows on the road side closed at rush hour, and consider a well-fitted mask outdoors.';
  return 'Hazardous: stay indoors where possible, avoid all outdoor exercise, keep asthma medication at hand, and follow local health alerts.';
}

/** What breathing air at this NO₂ level does to the body (short-term, and if it persists). */
function exposureEffects(level: number): string {
  if (level <= 25)
    return 'At this level NO₂ is not expected to harm healthy people, even with daily exposure; very sensitive asthmatics rarely notice anything.';
  if (level <= 80)
    return `• **Short term (hours–days):** mild irritation of the airways; people with asthma may cough or wheeze more and need their inhaler more often.
• **If days like this are common:** long-term exposure above the WHO guideline is linked to more respiratory infections, children developing asthma and slightly reduced lung growth.`;
  if (level <= 180)
    return `• **Short term (hours–days):** inflamed airways — coughing, sore throat, chest tightness, shortness of breath; asthma attacks become more likely and lungs react more strongly to allergens and infections.
• **Most at risk:** children, older adults, pregnant women, and people with asthma, COPD or heart disease (more hospital visits on such days).
• **If exposure continues for weeks/months:** higher risk of chronic bronchitis, asthma in children, reduced lung function and heart disease.`;
  return `• **Short term (hours):** strong airway inflammation — breathlessness, persistent cough and wheezing even in healthy adults; serious asthma or COPD attacks and chest pain in heart patients are likely.
• **Most at risk:** children, older adults, pregnant women and anyone with lung or heart disease may need medical care.
• **If exposure continues:** lasting lung damage, chronic respiratory disease, more heart attacks and strokes, and earlier death across the population.`;
}

function fullCheckAnswer(
  place: string,
  here: [number, number],
  pc: PointCheck,
  contributor: ReturnType<typeof mainContributor>,
  fallbackSource: string | null
): string {
  const v = pc.value;
  const who = v / 25;
  const danger =
    v <= 25
      ? '**Not dangerous** — within the WHO 24-hour guideline (25 µg/m³).'
      : v <= 80
        ? `**Elevated** — ${who.toFixed(1)}× the WHO guideline (25 µg/m³) but within India's CPCB limit (80 µg/m³). Not dangerous for most people; sensitive groups should take care.`
        : v <= 180
          ? `**Unhealthy** — ${who.toFixed(1)}× the WHO guideline and above the CPCB limit (80 µg/m³).`
          : `**Dangerous** — ${who.toFixed(1)}× the WHO guideline and far above the CPCB limit.`;
  const peak = pc.horizons.reduce((m, h) => Math.max(m, h.no2), v);
  const forecast = pc.horizons
    .map((h) => `+${h.hours} h: **${h.no2.toFixed(0)}**${h.no2 > 25 ? '' : ' ✓'}`)
    .join(' · ');
  const direction =
    peak > v * 1.1 ? 'rising over the coming hours' : pc.horizons.at(-1)!.no2 < v * 0.9 ? 'easing over the day' : 'roughly steady';
  const contrib = contributor
    ? `**${CONTRIBUTOR_LABEL[contributor.category] ?? contributor.category}** — nearest: ${contributor.example} (${contributor.distance.toFixed(1)} km${
        contributor.upwind ? ', upwind of you' : ''
      }); ${contributor.count} named source(s) of this kind within 3 km give about ${(contributor.share * 100).toFixed(0)}% of the weighted influence here.`
    : fallbackSource
      ? `**${fallbackSource}** (from the model's top hotspot in this area).`
      : 'No mapped industrial, power or traffic source within 3 km; the level is mostly background urban NO₂ carried by the wind.';
  return `**${place}** (${here[0].toFixed(3)}°N, ${here[1].toFixed(3)}°E) · ${pc.date}
**1. NO₂ level now:** ${v.toFixed(0)} µg/m³
**2. Is it dangerous?** ${danger}
**3. Forecast** (forecast model, wind ${pc.wind.speed} m/s from ${pc.wind.direction}): ${forecast} — ${direction}.
**4. What this exposure does to you** (at ${v.toFixed(0)} µg/m³):
${exposureEffects(v)}
**5. Health advice:** ${healthAdvice(Math.max(v, peak))}
**6. Main contributor:** ${contrib}`;
}

/** The predefined question closest to a typed one (used when no AI answer is available). */
function closestQuestion(text: string): string {
  const t = text.toLowerCase();
  const rules: [string, RegExp][] = [
    ['drone', /drone|fly|flight|inspect/],
    ['unusual', /unusual|suspicious|anomal|illegal|spike|sudden|strange/],
    ['forecast', /forecast|tomorrow|tonight|next|later|hour|predict|will it/],
    ['trend', /trend|better|worse|improv|week|month|over time|history/],
    ['hotspots', /hotspot|where|worst|highest|area.*(most|high)/],
    ['exposure', /how many|people|population|exposed|precaution/],
    ['standards', /limit|standard|cpcb|naaqs|who|guideline|within|comply|complian/],
  ];
  return rules.find(([, re]) => re.test(t))?.[0] ?? 'fullcheck';
}

/** Answer one of the fixed questions from the analysis (AI model output + guideline templates). */
function answerQuestion(id: string, a: Analysis): string {
  const cur = a.current;
  const head = `**${a.area.name}** · ${a.date}`;
  const pctAbove = (share: number) => `${(share * 100).toFixed(0)}%`;
  switch (id) {
    case 'standards': {
      const verdict =
        cur.max > 80
          ? `Some places exceed the CPCB 24-hour limit; the area as a whole is **${a.labels.status}**.`
          : cur.mean > 25
            ? 'The area is **within the CPCB limit** but above the stricter WHO guideline.'
            : 'The area is **within both the CPCB limit and the WHO guideline**.';
      return `${head}
• **Area average:** ${cur.mean.toFixed(0)} µg/m³ — ${Math.abs(cur.pct_vs_naaqs).toFixed(0)}% ${cur.pct_vs_naaqs > 0 ? 'above' : 'below'} the CPCB 24-h limit (80 µg/m³)
• **95th percentile:** ${cur.p95.toFixed(0)} µg/m³ · **Highest 250 m cell:** ${cur.max.toFixed(0)} µg/m³ near ${cur.max_near}
• **Area above CPCB 80:** ${pctAbove(cur.share_above_naaqs)} · **Area above WHO 25:** ${pctAbove(cur.share_above_who)}
• **Period average vs CPCB annual limit (40):** ${a.window_stats.mean.toFixed(0)} µg/m³

**Verdict:** ${verdict}`;
    }
    case 'hotspots': {
      if (!a.hotspots.length) return `${head}\nNo distinct hotspots stand out on this day.`;
      const lines = a.hotspots.map(
        (h, i) =>
          `• **${h.rank}. ${h.near}** — ${h.value.toFixed(0)} µg/m³ (${h.band}); likely contributors: ${
            a.labels.hotspot_sources[i]?.join(', ') || 'general urban background'
          }`
      );
      return `${head}\n**Top hotspots on the 250 m model map:**\n${lines.join('\n')}\n\nContributors are read from the model's inputs at each spot (road density, power plants, built-up area and night lights).`;
    }
    case 'unusual': {
      const lines = a.texts.anomalies ?? [];
      return lines.length
        ? `${head}\n**${lines.length} place(s) flagged** (above the CPCB limit, far above their own last 7 days, or producing NO₂ against the wind):\n${lines
            .map((l) => `• ${l}`)
            .join('\n')}`
        : `${head}\nNo unusual activity: no place breaks the 80 µg/m³ limit or rises far above its own recent levels.`;
    }
    case 'forecast': {
      const lines = a.texts.forecast ?? [];
      return `${head}\n**24-hour outlook** (dispersion model with the day's wind):\n${lines.map((l) => `• ${l}`).join('\n')}`;
    }
    case 'trend': {
      const tr = a.trend;
      const lines = a.texts.trend ?? [];
      const range =
        tr && tr.observed.length
          ? `\n• **Daily area average over the period:** ${Math.min(...tr.observed).toFixed(0)}–${Math.max(...tr.observed).toFixed(0)} µg/m³ across ${tr.observed.length} days`
          : '';
      return `${head}\n**Weather-adjusted trend:**\n${lines.map((l) => `• ${l}`).join('\n')}${range}`;
    }
    case 'exposure': {
      const pop = a.population;
      const people = pop
        ? `• **Population in the area:** ${fmtPeople(pop.total)}\n• **Living above the CPCB limit (80):** ${fmtPeople(pop.above_naaqs)} (${pctAbove(pop.share_above_naaqs)})\n• **Population-weighted average:** ${pop.weighted_mean.toFixed(0)} µg/m³`
        : '• Population data is not available for this area.';
      const recs = (a.texts.recommendations ?? []).map((r) => `• ${r}`).join('\n');
      return `${head}\n${people}\n\n**Recommended precautions:**\n${recs}`;
    }
    case 'drone': {
      const plans = a.texts.flight_plans ?? [];
      const haze = a.texts.haze ? `\n\n**Haze (drone camera) + NO₂:** ${a.texts.haze}` : '';
      return plans.length
        ? `${head}\n**Pre-inspection drone flights planned for ${plans.length} site(s):**\n${plans
            .map((l) => `• ${l}`)
            .join('\n')}\n\nThe PDF report has each full flight plan: map, wind, elevation, battery (mAh), waypoints and checklist.${haze}`
        : `${head}\nNo site needs a drone inspection on this day (nothing above the CPCB limit or flagged as unusual).${haze}`;
    }
    default:
      return 'Please pick one of the questions above.';
  }
}

interface ReportGeneratorProps {
  locationName: string;
  coords: [number, number] | null | undefined; // [lat, lon]
  isOpen?: boolean;
  onClose?: () => void;
  /** Uploaded days (from /downscale/dates): when given, reports are made for these days of the uploaded data. */
  availableDates?: string[];
  selectedDate?: string;
  onDateChange?: (date: string) => void;
}

export default function ReportGenerator({
  locationName,
  coords,
  isOpen,
  onClose,
  availableDates,
  selectedDate,
  onDateChange,
}: ReportGeneratorProps) {
  const [latestDate] = useState<string>(() => isoDate(new Date(Date.now() - WEATHER_LAG_DAYS * DAY_MS)));
  const [language, setLanguage] = useState<LanguageId>('en');
  const [ownDate, setOwnDate] = useState<string>(latestDate);
  const useUploaded = Boolean(availableDates && availableDates.length > 0);
  // with uploaded data the date is shared with the map and the pinpoint card
  const reportDate = useUploaded && selectedDate ? selectedDate : ownDate;
  const setReportDate = (d: string) => (useUploaded && onDateChange ? onDateChange(d) : setOwnDate(d));
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
Pick a question below or type your own: I answer from the AI model's analysis of this area (CPCB 80 µg/m³ and WHO 25 µg/m³ limits, hotspots, unusual activity, forecast, trend, exposure, health effects and drone inspections).
The analysis runs automatically with your first question.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>('');
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
Pick a question below or type your own: I answer from the AI model's analysis of this area (CPCB 80 µg/m³ and WHO 25 µg/m³ limits, hotspots, unusual activity, forecast, trend, exposure, health effects and drone inspections).
The analysis runs automatically with your first question.`,
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
      ...(useUploaded ? { data_source: 'upload' } : {}),
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
      setActiveTab('analysis'); // show the full analysis (flags, comparison, exposure, forecast, trend)

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

  const authHeaders = async (): Promise<Record<string, string>> => {
    let token = typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      token = sessionData?.session?.access_token ?? token;
    } catch {
      // not signed in through Supabase: keep the stored token
    }
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // The pinned point: the day's NO₂ and the forecast model (GET /trends/point) plus the main nearby source
  const getSpot = async (): Promise<{
    pc: PointCheck;
    contributor: ReturnType<typeof mainContributor>;
    fallback: string | null;
  } | null> => {
    if (!coords) return null;
    const [lat, lon] = coords;
    const headers = await authHeaders();
    const dateParam = useUploaded && reportDate ? `&date=${reportDate}` : '';
    const pointRes = await fetch(`${API_BASE}/api/v1/trends/point?lat=${lat}&lon=${lon}${dateParam}`, { headers });
    if (!pointRes.ok) throw new Error(`NO₂ lookup failed (HTTP ${pointRes.status})`);
    const pc = (await pointRes.json()) as PointCheck;
    if (!pc.inside) return null;
    let contributor: ReturnType<typeof mainContributor> = null;
    try {
      const d = 0.03; // ~3 km around the pin
      const bbox = [lon - d, lat - d, lon + d, lat + d].map((v) => v.toFixed(4)).join(',');
      const poiRes = await fetch(`${API_BASE}/api/v1/analyze/pois?bbox=${bbox}`, { headers });
      if (poiRes.ok) {
        const pois = await poiRes.json();
        contributor = mainContributor([lat, lon], pc.wind.deg, pois.points ?? [], pois.corridors ?? []);
      }
    } catch {
      // mapped sources unavailable: fall back to the model's hotspot analysis below
    }
    // no mapped source nearby: use the contributors the model found at the area's top hotspot
    const fallback = !contributor && analysis?.hotspots.length ? analysis.labels.hotspot_sources[0]?.join(', ') || null : null;
    return { pc, contributor, fallback };
  };

  // Full check at the pin: value, WHO comparison, forecast, exposure effects, advice, main contributor
  const fullCheck = async (): Promise<string> => {
    if (!coords) return 'Select a location on the map first.';
    const spot = await getSpot();
    if (!spot) {
      return `**${locationName}** is outside the uploaded data area, so there is no measured NO₂ value here. Pick a location inside the uploaded region (e.g. Mumbai) on the map.`;
    }
    return fullCheckAnswer(locationName, coords, spot.pc, spot.contributor, spot.fallback);
  };

  // Typed question: Gemini answers from the model output (area analysis + pinned point); without AI the
  // closest predefined question answers it from the templates
  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = chatInput.trim();
    if (!question || isTyping) return;
    setChatInput('');
    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const history = messages.filter((m) => !m.id.startsWith('welcome')).slice(-6).map(({ sender, text }) => ({ sender, text }));
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, sender: 'user', text: question, timestamp: now() }]);
    setIsTyping(true);
    let current = analysis;
    let text: string | null = null;
    try {
      const [analysisResult, spotResult] = await Promise.allSettled([
        current ? Promise.resolve(current) : request('analysis').then((r) => r.json() as Promise<Analysis>),
        getSpot(),
      ]);
      if (analysisResult.status === 'fulfilled') {
        current = analysisResult.value;
        if (!analysis) setAnalysis(current);
      }
      const spot = spotResult.status === 'fulfilled' ? spotResult.value : null;
      const context = {
        location: { name: locationName, lat: coords?.[0], lon: coords?.[1] },
        date: reportDate,
        units: 'µg/m³ (ground-level NO₂ from the downscaling model)',
        pinned_point: spot
          ? {
              no2_now: spot.pc.value,
              forecast_model: spot.pc.horizons,
              wind: spot.pc.wind,
              main_contributor: spot.contributor
                ? { ...spot.contributor, label: CONTRIBUTOR_LABEL[spot.contributor.category] ?? spot.contributor.category }
                : spot.fallback,
            }
          : 'outside the uploaded data area or unavailable',
        area_analysis: current
          ? { current: current.current, window_stats: current.window_stats, hotspots: current.hotspots,
              hotspot_sources: current.labels.hotspot_sources, status: current.labels.status,
              population: current.population, trend: current.trend, texts: current.texts }
          : 'unavailable',
      };
      try {
        const res = await fetch(`${API_BASE}/api/v1/reports/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ question, language, context, history }),
          signal: AbortSignal.timeout(40000),
        });
        if (res.ok) text = ((await res.json()) as { answer: string | null }).answer;
      } catch {
        // AI unavailable: answered from the templates below
      }
      if (!text) {
        const id = closestQuestion(question);
        if (id === 'fullcheck') text = await fullCheck();
        else if (current) text = answerQuestion(id, current);
        else text = 'I could not analyse this area right now. Please try one of the questions above.';
      }
    } catch (err) {
      text = `I could not answer that: ${err instanceof Error ? err.message : 'request failed'}.`;
    } finally {
      setMessages((prev) => [...prev, { id: `agent-${Date.now()}`, sender: 'agent', text: text ?? '', timestamp: now() }]);
      setIsTyping(false);
    }
  };

  // Answer a fixed question; runs the analysis first if it has not been run for this area and date
  const handleAskQuestion = async (q: PredefinedQuestion) => {
    if (isTyping) return;
    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, sender: 'user', text: q.query, timestamp: now() }]);
    setIsTyping(true);
    let current = analysis;
    try {
      if (q.id === 'fullcheck') {
        const text = await fullCheck();
        setMessages((prev) => [...prev, { id: `agent-${Date.now()}`, sender: 'agent', text, timestamp: now() }]);
        return;
      }
      if (!current) {
        const res = await request('analysis');
        current = (await res.json()) as Analysis;
        setAnalysis(current);
      }
      const text = answerQuestion(q.id, current);
      setMessages((prev) => [...prev, { id: `agent-${Date.now()}`, sender: 'agent', text, timestamp: now() }]);
    } catch (e) {
      const text = `I could not analyse this area: ${e instanceof Error ? e.message : 'request failed'}.`;
      setMessages((prev) => [...prev, { id: `agent-${Date.now()}`, sender: 'agent', text, timestamp: now() }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleResetChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: 'agent',
        text: `Hello! I am your AeroPulse Air Quality Intelligence Agent for **${locationName}**.
Pick a question below or type your own: I answer from the AI model's analysis of this area (CPCB 80 µg/m³ and WHO 25 µg/m³ limits, hotspots, unusual activity, forecast, trend, exposure, health effects and drone inspections).
The analysis runs automatically with your first question.`,
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
            {useUploaded ? (
              <DatePicker availableDates={availableDates!} selectedDate={reportDate} onDateChange={setReportDate} />
            ) : (
              <input
                type="date"
                value={reportDate}
                max={latestDate}
                min="2018-07-01"
                onChange={(e) => setReportDate(e.target.value)}
                className="h-6 px-2 rounded bg-[#10131c] border border-[#2e3547] text-zinc-200 text-[11px] [color-scheme:dark]"
              />
            )}
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
                Ask the agent (answers from the AI model&apos;s analysis)
              </span>
              <span className="text-zinc-500">{PREDEFINED_QUESTIONS.length} questions</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PREDEFINED_QUESTIONS.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => handleAskQuestion(q)}
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

          {/* Typed questions: answered by Gemini from the model output */}
          <form onSubmit={handleCustomSubmit} className="p-2.5 bg-[#121622] border-t border-[#1e2333] flex items-center gap-2">
            <input
              type="text"
              value={chatInput}
              maxLength={600}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={`Ask anything about NO₂ at ${locationName}: health, sources, forecast, standards…`}
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
