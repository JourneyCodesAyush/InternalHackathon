'use client';

import React, { useState } from 'react';
import { FileText, Loader2, Download, AlertTriangle } from 'lucide-react';

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
};

const HALF_SIZE_DEG = 0.15; // report area around the selected point when no known city matches

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "Shivaji Park, Mumbai" -> "Mumbai"; "Mumbai (Shivaji Park / MMR)" -> "Mumbai" */
function guessCity(locationName: string): string | undefined {
  const withoutBrackets = locationName.replace(/\(.*?\)/g, '').trim();
  const last = withoutBrackets.split(',').pop()?.trim();
  return last && !/^pinpoint/i.test(last) ? last : undefined;
}

interface ReportGeneratorProps {
  locationName: string;
  coords: [number, number] | null | undefined; // [lat, lon]
}

export default function ReportGenerator({ locationName, coords }: ReportGeneratorProps) {
  const [language, setLanguage] = useState<LanguageId>('en');
  const [reportDate, setReportDate] = useState<string>(() => isoDate(new Date(Date.now() - 86_400_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; narrative: string; filename: string } | null>(null);

  const handleGenerate = async () => {
    if (!coords) {
      setError('Select a location on the map first.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const [lat, lon] = coords;
    const start = new Date(new Date(reportDate).getTime() - 29 * 86_400_000);
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

    try {
      const res = await fetch(`${API_BASE}/api/v1/reports/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        throw new Error('Please log in to generate reports.');
      }
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail ? String(detail.detail) : `Report failed (HTTP ${res.status}).`);
      }
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
        filename,
      });
    } catch (e) {
      if (e instanceof TypeError) {
        // fetch() rejects with TypeError when the server is unreachable (not running, wrong URL, CORS)
        setError(`Cannot reach the backend at ${API_BASE}. Is it running?`);
      } else {
        setError(e instanceof Error ? e.message : 'Report failed.');
      }
    } finally {
      setBusy(false);
    }
  };

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
          max={isoDate(new Date())}
          min="2018-07-01"
          onChange={(e) => setReportDate(e.target.value)}
          className="h-7 px-1.5 rounded bg-[#11141d] border border-[#2e3547] text-zinc-200 text-[11px] [color-scheme:dark]"
        />
      </label>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={busy}
        className="w-full h-8 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:text-blue-300 text-white font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-wait transition-colors"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {busy ? 'Generating…' : 'Generate report (PDF)'}
      </button>

      {busy && (
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          The first report for a new area or date can take a few minutes; repeats are instant.
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
            Downloaded
            {status && <span className={`px-1.5 py-0.5 rounded border text-[10px] ${status.className}`}>{status.label}</span>}
          </div>
          <div className="text-[10px] text-zinc-500">
            {result.narrative === 'ai' ? 'Narrative: AI summary (Gemini)' : 'Narrative: standard template'}
          </div>
        </div>
      )}
    </div>
  );
}
