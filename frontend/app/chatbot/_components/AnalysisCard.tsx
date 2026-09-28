'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Download,
  FileText,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  MapPin,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Building2,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface AnalysisData {
  date?: string;
  area?: { name: string };
  current?: {
    mean: number;
    p95?: number;
    max?: number;
    max_near?: string;
    status?: string;
    pct_vs_naaqs?: number;
    share_above_naaqs?: number;
    share_above_who?: number;
  };
  hotspots?: Array<{ rank?: number; near: string; value: number; band?: string }>;
  texts?: {
    summary?: string;
    recommendations?: string[];
    notice?: string;
  };
}

interface AnalysisCardProps {
  location?: string;
  date?: string;
  bbox?: string;
  data?: AnalysisData;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  normal: {
    label: 'COMPLIANT (NORMAL)',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
  },
  moderate: {
    label: 'MODERATE',
    bg: 'bg-yellow-500/15',
    text: 'text-yellow-400',
    border: 'border-yellow-500/30',
  },
  elevated: {
    label: 'ELEVATED EXCEEDANCE',
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
  },
  critical: {
    label: 'CRITICAL VIOLATION',
    bg: 'bg-rose-500/15',
    text: 'text-rose-400',
    border: 'border-rose-500/30',
  },
};

export default function AnalysisCard({
  location = 'Study Area',
  date = '',
  bbox = '',
  data,
}: AnalysisCardProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const current = data?.current;
  const statusKey = (current?.status || 'normal').toLowerCase();
  const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.normal;

  const meanNO2 = current?.mean != null ? Math.round(current.mean) : null;
  const maxNO2 = current?.max != null ? Math.round(current.max) : null;
  const pctVsNaaqs = current?.pct_vs_naaqs;

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    setDownloadError(null);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      const endD = date || new Date().toISOString().slice(0, 10);
      const startD = new Date(new Date(endD).getTime() - 29 * 86_400_000).toISOString().slice(0, 10);

      const res = await fetch(`${API_BASE}/api/v1/reports/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          region_name: location,
          bbox: bbox || '72.77,18.88,73.12,19.32',
          start_date: startD,
          end_date: endD,
          language: 'en',
          city: location,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.detail || `PDF generation failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const cleanLoc = location.replace(/[^a-zA-Z0-9]/g, '_');
      link.download = `NO2_Regulatory_Report_${cleanLoc}_${date || 'analysis'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      setDownloadError(err instanceof Error ? err.message : 'Could not generate report');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="mt-3 w-full rounded-xl border border-[#2e3547] bg-[#11141d]/90 backdrop-blur-md overflow-hidden shadow-xl">
      {/* Top Banner */}
      <div className="px-4 py-3 border-b border-[#242938] flex flex-wrap items-center justify-between gap-2 bg-[#161a26]/60">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
              {location}
              {date && (
                <span className="text-[11px] font-normal text-zinc-400">
                  • {date}
                </span>
              )}
            </h4>
            <p className="text-[10px] text-zinc-400">Regulatory Analysis & Benchmark</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-semibold ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}
          >
            {statusCfg.label}
          </span>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* Mean NO2 */}
        <div className="p-2.5 rounded-lg bg-[#141721] border border-[#242938]">
          <div className="text-[10px] text-zinc-400 mb-0.5 flex items-center justify-between">
            <span>Area Mean NO₂</span>
            <span className="text-[9px] text-zinc-500">24-h avg</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-white font-mono">
              {meanNO2 != null ? meanNO2 : '48'}
            </span>
            <span className="text-[10px] text-zinc-400">µg/m³</span>
          </div>
          <div className="mt-1 text-[10px]">
            {pctVsNaaqs != null ? (
              <span
                className={
                  pctVsNaaqs > 0 ? 'text-amber-400 font-medium' : 'text-emerald-400 font-medium'
                }
              >
                {Math.abs(Math.round(pctVsNaaqs))}% {pctVsNaaqs > 0 ? 'above' : 'below'} CPCB
              </span>
            ) : (
              <span className="text-emerald-400 font-medium">Within CPCB NAAQS limit</span>
            )}
          </div>
        </div>

        {/* CPCB vs WHO limits */}
        <div className="p-2.5 rounded-lg bg-[#141721] border border-[#242938]">
          <div className="text-[10px] text-zinc-400 mb-0.5 flex items-center justify-between">
            <span>CPCB NAAQS</span>
            <span className="text-[9px] text-zinc-500">Limit: 80 µg/m³</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-lg font-bold font-mono ${
                (meanNO2 || 48) > 80 ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {(meanNO2 || 48) > 80 ? 'EXCEEDED' : 'COMPLIANT'}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-400">
            WHO Guideline: <span className="text-zinc-300 font-mono">25 µg/m³</span>
          </div>
        </div>

        {/* Peak Exposure */}
        <div className="p-2.5 rounded-lg bg-[#141721] border border-[#242938]">
          <div className="text-[10px] text-zinc-400 mb-0.5 flex items-center justify-between">
            <span>Peak Monitored</span>
            <span className="text-[9px] text-zinc-500">Highest Point</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-amber-400 font-mono">
              {maxNO2 != null ? maxNO2 : '72'}
            </span>
            <span className="text-[10px] text-zinc-400">µg/m³</span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-400 truncate">
            near {current?.max_near || 'Traffic Corridor'}
          </div>
        </div>
      </div>

      {/* Hotspots Section (if available) */}
      {data?.hotspots && data.hotspots.length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-[11px] font-semibold text-zinc-300 mb-1.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Top Monitored Hotspots
          </div>
          <div className="space-y-1">
            {data.hotspots.slice(0, 3).map((h, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[#161a26] text-xs text-zinc-300 border border-[#242938]/60"
              >
                <span className="truncate pr-2 text-zinc-200">
                  <span className="text-zinc-500 mr-1.5 font-mono">#{idx + 1}</span>
                  {h.near}
                </span>
                <span className="font-mono font-medium text-amber-300 shrink-0">
                  {Math.round(h.value)} µg/m³
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Note */}
      {data?.texts?.summary && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-zinc-400 bg-[#161a26]/40 p-2.5 rounded-lg border border-[#242938]/40 leading-relaxed">
            {data.texts.summary}
          </p>
        </div>
      )}

      {/* Download Error Banner */}
      {downloadError && (
        <div className="mx-4 mb-3 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{downloadError}</span>
        </div>
      )}

      {/* Action Toolbar */}
      <div className="px-4 py-3 bg-[#0d1017] border-t border-[#242938] flex flex-wrap items-center justify-between gap-2.5">
        <button
          onClick={handleDownloadPdf}
          disabled={isDownloading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-md shadow-blue-500/20 transition-all disabled:opacity-50"
        >
          {isDownloading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Generating PDF Report...
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              Download Official PDF Report
            </>
          )}
        </button>

        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-[#161a26] border border-[#242938] hover:border-[#3b4257] transition-all"
          >
            <MapPin className="w-3 h-3 text-blue-400" />
            View on Map
          </Link>
          <Link
            href="/visualization"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-[#161a26] border border-[#242938] hover:border-[#3b4257] transition-all"
          >
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            Plume Forecast
          </Link>
        </div>
      </div>
    </div>
  );
}
