'use client';

import React, { useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  FileText,
  Gavel,
  Globe,
  Info,
  MapPin,
  ShieldAlert,
  Wind,
  X,
} from 'lucide-react';
import type { TransboundaryResponse } from './transboundaryData';

interface Props {
  data: TransboundaryResponse | null;
  loading: boolean;
  onClose: () => void;
  onFocusRegion: (lat: number, lon: number, zoom?: number) => void;
}

export default function TransboundaryPanel({
  data,
  loading,
  onClose,
  onFocusRegion,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'delhi' | 'punjab' | 'legal'>('delhi');

  if (loading || !data) {
    return (
      <div className="absolute top-16 right-4 z-30 w-96 p-4 rounded-xl bg-[#0f1422]/95 border border-[#2e3a59] backdrop-blur-xl shadow-2xl text-xs text-zinc-300">
        <div className="flex items-center gap-2">
          <Wind className="w-4 h-4 text-sky-400 animate-spin" />
          <span>Calculating boundary normal NO₂ fluxes and airshed attribution…</span>
        </div>
      </div>
    );
  }

  const { delhi_summary: delhi, punjab_international: punjab, legal_evidence_brief: brief } = data;

  const handleCopy = () => {
    navigator.clipboard.writeText(brief);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      className="absolute top-14 sm:top-16 right-2 sm:right-4 z-30 w-[95vw] sm:w-[32rem] md:w-[36rem] max-h-[85vh] flex flex-col rounded-2xl bg-[#0c101a]/95 border border-[#2b354f] backdrop-blur-2xl shadow-2xl text-xs text-zinc-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      role="region"
      aria-label="CAQM Transboundary NO2 Flux Analysis"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f2940] bg-[#111726]/80">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400">
            <Gavel className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-zinc-100 text-sm tracking-wide">
                Transboundary Atmospheric Flux
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                CAQM / SPCB
              </span>
            </div>
            <p className="text-[10px] text-zinc-400">
              Cross-border mass line integrals via Sentinel-5P + NOAA GFS 10 m wind
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close transboundary attribution panel"
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 cursor-pointer transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-[#1f2940] bg-[#0e1320]/60 px-4 pt-2 gap-2 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('delhi')}
          className={`pb-2 px-2.5 font-medium flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'delhi'
              ? 'border-sky-400 text-sky-300 font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <MapPin className="w-3.5 h-3.5 text-sky-400" />
          Delhi NCR Attribution
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('punjab')}
          className={`pb-2 px-2.5 font-medium flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'punjab'
              ? 'border-sky-400 text-sky-300 font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Globe className="w-3.5 h-3.5 text-amber-400" />
          Punjab (PK → IN)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('legal')}
          className={`pb-2 px-2.5 font-medium flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'legal'
              ? 'border-sky-400 text-sky-300 font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-emerald-400" />
          Legal Evidence Brief
        </button>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'delhi' && (
          <>
            {/* Primary Headline Card */}
            <div className="p-3.5 rounded-xl bg-gradient-to-br from-sky-950/40 via-[#10192e] to-[#0c1322] border border-sky-500/30 shadow-inner space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-sky-400 text-[11px] font-semibold uppercase tracking-wider">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Whose Pollution Is It?
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
                    {delhi.headline}
                  </h3>
                </div>
                <div className="text-right shrink-0">
                  <span className="inline-block px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-300 border border-sky-400/40 font-mono font-bold text-sm">
                    {delhi.external_attribution_pct}%
                  </span>
                  <span className="block text-[9px] text-zinc-400 uppercase tracking-wider mt-0.5">
                    External
                  </span>
                </div>
              </div>

              {/* Quick Jump Action */}
              <div className="pt-1 flex items-center justify-between">
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Based on daily horizontal flux line integrals across Delhi&apos;s perimeter borders.
                </p>
                <button
                  type="button"
                  onClick={() => onFocusRegion(28.6139, 77.209, 8.5)}
                  className="px-2 py-1 rounded bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 text-[10px] font-medium flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
                >
                  <MapPin className="w-3 h-3" /> Focus Delhi
                </button>
              </div>
            </div>

            {/* Mass Balance Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-2.5 rounded-lg bg-[#111728] border border-[#232f48] text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-400 text-[10px] font-medium mb-1">
                  <ArrowDownRight className="w-3 h-3" /> Inflow
                </div>
                <div className="text-sm sm:text-base font-bold text-emerald-300 font-mono">
                  {delhi.inflow_tonnes_day}
                </div>
                <div className="text-[9px] text-zinc-400">tonnes / day</div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#111728] border border-[#232f48] text-center">
                <div className="flex items-center justify-center gap-1 text-rose-400 text-[10px] font-medium mb-1">
                  <ArrowUpRight className="w-3 h-3" /> Outflow
                </div>
                <div className="text-sm sm:text-base font-bold text-rose-300 font-mono">
                  {delhi.outflow_tonnes_day}
                </div>
                <div className="text-[9px] text-zinc-400">tonnes / day</div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#111728] border border-[#232f48] text-center">
                <div className="flex items-center justify-center gap-1 text-sky-400 text-[10px] font-medium mb-1">
                  <Wind className="w-3 h-3" /> Net Flux
                </div>
                <div className="text-sm sm:text-base font-bold text-sky-300 font-mono">
                  {delhi.net_flux_tonnes_day > 0 ? `+${delhi.net_flux_tonnes_day}` : delhi.net_flux_tonnes_day}
                </div>
                <div className="text-[9px] text-zinc-400">
                  {delhi.net_flux_tonnes_day >= 0 ? 'Accumulating' : 'Flushing'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#111728] border border-[#232f48] text-center">
                <div className="flex items-center justify-center gap-1 text-purple-400 text-[10px] font-medium mb-1">
                  <Globe className="w-3 h-3" /> Airshed Mass
                </div>
                <div className="text-sm sm:text-base font-bold text-purple-300 font-mono">
                  {delhi.ambient_mass_tonnes}
                </div>
                <div className="text-[9px] text-zinc-400">active burden (t)</div>
              </div>
            </div>

            {/* Ingress Corridors Breakdown Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="font-semibold text-[11px] uppercase tracking-wider text-zinc-400">
                  Border Ingress & Attribution Breakdown
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  CAQM Action Hierarchy
                </span>
              </div>

              <div className="rounded-xl border border-[#232f48] overflow-hidden bg-[#0d121f]">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-[#232f48] bg-[#141b2d] text-zinc-400 font-mono text-[10px]">
                      <th className="py-2 px-3 font-medium">Upwind Jurisdiction</th>
                      <th className="py-2 px-2 font-medium">Corridor / Landmarks</th>
                      <th className="py-2 px-2 text-right font-medium">Inflow (t/d)</th>
                      <th className="py-2 px-3 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e273c]">
                    {delhi.corridors.map((c) => (
                      <tr key={c.id} className="hover:bg-[#151e33] transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-zinc-100">
                          <div>{c.from_jurisdiction}</div>
                          <div className="text-[9px] text-zinc-400 font-normal font-mono">
                            {c.wind_direction}
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="text-zinc-200 font-medium">{c.corridor_name}</div>
                          <div className="text-[10px] text-zinc-400 line-clamp-1">
                            {c.key_landmarks}
                          </div>
                          <div className="text-[9px] text-amber-300/80 mt-0.5 line-clamp-1">
                            {c.policy_mandate}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono font-semibold text-emerald-400">
                          {c.inflow_tonnes_day}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-sky-300">
                          {c.share_of_external_pct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeTab === 'punjab' && (
          <div className="space-y-3">
            <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-xs">
                  <Globe className="w-4 h-4" />
                  International Transboundary Transport
                </div>
                <button
                  type="button"
                  onClick={() => onFocusRegion(31.62, 74.57, 7.5)}
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-medium flex items-center gap-1 cursor-pointer"
                >
                  <MapPin className="w-3 h-3" /> Focus Lahore–Amritsar
                </button>
              </div>

              <h4 className="text-sm font-bold text-zinc-100">
                {punjab.from_jurisdiction} → {punjab.to_jurisdiction}
              </h4>
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                The Lahore–Amritsar transboundary airshed spans the international Radcliffe boundary.
                During post-monsoon and winter seasons, emissions from Lahore, Gujranwala, and Kasur
                enter Indian Punjab under westerly winds, while easterly reversal transports plumes towards Pakistan.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-3 rounded-lg bg-[#111728] border border-[#232f48]">
                <div className="text-[10px] text-zinc-400 uppercase font-mono">
                  Border Flux Rate
                </div>
                <div className="text-lg font-bold text-amber-300 font-mono mt-0.5">
                  {punjab.inflow_tonnes_day} t/day
                </div>
                <div className="text-[10px] text-zinc-400">
                  {punjab.net_flux_tonnes_day >= 0 ? 'Entering India' : 'Exiting India'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#111728] border border-[#232f48]">
                <div className="text-[10px] text-zinc-400 uppercase font-mono">
                  Wind Transport Vector
                </div>
                <div className="text-lg font-bold text-sky-300 font-mono mt-0.5">
                  {punjab.wind_speed_ms} m/s
                </div>
                <div className="text-[10px] text-zinc-400 font-mono">
                  {punjab.wind_direction}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#111728] border border-[#232f48] space-y-1">
              <div className="text-zinc-200 font-semibold text-[11px]">
                Airshed Governance & Bilateral Context
              </div>
              <p className="text-[10px] text-zinc-400 leading-relaxed">
                {punjab.policy_implication}
              </p>
            </div>
          </div>
        )}

        {activeTab === 'legal' && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-[#111728] border border-[#232f48] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-200 text-xs">
                  Evidence Text for CAQM & Courts (NGT)
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center gap-1 text-[11px] cursor-pointer transition-colors shadow"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy Brief'}
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-[#090d16] border border-[#1a2336] font-mono text-[10px] text-zinc-300 whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {brief}
              </pre>
            </div>
            <p className="text-[10px] text-zinc-500 leading-normal">
              Notice: Computed strictly via objective satellite tropospheric density retrievals and NOAA meteorological
              vector field integrations, compliant with Supreme Court MC Mehta environmental evidence guidelines.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 bg-[#0f1422] border-t border-[#1f2940] flex items-center justify-between text-[10px] text-zinc-500">
        <div className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-sky-400" />
          <span>Calculated on current 24-hour observation cycle</span>
        </div>
        <button
          type="button"
          onClick={() => onFocusRegion(28.6139, 77.209, 8.5)}
          className="text-sky-400 hover:text-sky-300 font-medium cursor-pointer flex items-center gap-1"
        >
          View Delhi Airshed <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
