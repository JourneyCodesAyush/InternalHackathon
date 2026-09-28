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
  Factory,
  Compass,
  Zap,
} from 'lucide-react';
import type { TransboundaryResponse } from './transboundaryData';

interface Props {
  data: TransboundaryResponse | null;
  loading: boolean;
  activeRegion: string;
  onSelectRegion: (regionId: string) => void;
  onClose: () => void;
  onFocusRegion: (lat: number, lon: number, zoom?: number) => void;
}

const REGION_TABS = [
  { id: 'delhi', label: 'Delhi NCR', icon: MapPin },
  { id: 'punjab', label: 'Punjab & Indus', icon: Globe },
  { id: 'igp_east', label: 'IGP Eastern', icon: Wind },
  { id: 'singrauli_korba', label: 'Singrauli–Korba', icon: Zap },
  { id: 'legal', label: 'Legal Brief', icon: FileText },
];

export default function TransboundaryPanel({
  data,
  loading,
  activeRegion,
  onSelectRegion,
  onClose,
  onFocusRegion,
}: Props) {
  const [copied, setCopied] = useState(false);

  const summary = data?.summary || data?.delhi_summary;
  const gateways = data?.gateways || summary?.gateways || [];
  const corridors = summary?.corridors || [];
  const brief = data?.legal_evidence_brief || '';

  const handleCopy = () => {
    if (!brief) return;
    navigator.clipboard.writeText(brief);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRegionClick = (regionId: string) => {
    onSelectRegion(regionId);
    if (data?.center && data.region_id === regionId) {
      onFocusRegion(data.center[1], data.center[0], data.zoom || 8.5);
    }
  };

  return (
    <div
      className="absolute top-16 sm:top-20 right-2 sm:right-4 z-30 w-[95vw] sm:w-[35rem] md:w-[38rem] max-h-[82vh] flex flex-col rounded-2xl bg-[#0c101a]/95 border border-[#2b354f] backdrop-blur-2xl shadow-2xl text-xs text-zinc-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      role="region"
      aria-label="CAQM Transboundary Atmospheric NO2 Flux Analysis"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f2940] bg-[#111726]/90">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400">
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
              Boundary normal mass line integrals via Sentinel-5P + NOAA GFS 10 m wind
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close transboundary attribution panel"
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 cursor-pointer transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 4 Airshed Region Switcher + Legal Tab */}
      <div className="flex items-center border-b border-[#1f2940] bg-[#0e1320]/80 px-2 py-1.5 gap-1 text-[11px] overflow-x-auto scrollbar-none">
        {REGION_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeRegion === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleRegionClick(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40 font-semibold shadow-sm shadow-sky-500/10'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-sky-400' : 'text-zinc-400'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="p-4 rounded-xl bg-sky-950/20 border border-sky-500/30 text-sky-300 flex items-center gap-2">
            <Wind className="w-4 h-4 animate-spin text-sky-400" />
            <span>Computing boundary fluxes for selected airshed...</span>
          </div>
        )}

        {activeRegion !== 'legal' && summary && (
          <>
            {/* Primary Airshed Headline & Attribution Card */}
            <div className="p-3.5 rounded-xl bg-gradient-to-br from-sky-950/40 via-[#10192e] to-[#0c1322] border border-sky-500/30 shadow-inner space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-sky-400 text-[10px] font-semibold uppercase tracking-wider">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Whose Pollution Is It?
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
                    {summary.headline}
                  </h3>
                </div>
                <div className="text-right shrink-0">
                  <span className="inline-block px-2.5 py-1 rounded-lg bg-sky-500/25 text-sky-200 border border-sky-400/40 font-mono font-bold text-sm shadow-md">
                    {summary.external_attribution_pct}%
                  </span>
                  <span className="block text-[9px] text-zinc-400 uppercase tracking-wider mt-0.5">
                    External
                  </span>
                </div>
              </div>

              {/* Focus Airshed Button */}
              <div className="pt-1 flex items-center justify-between border-t border-[#1e2a44]">
                <p className="text-[11px] text-zinc-400 leading-relaxed pr-2">
                  Atmospheric flux line integral across border transects.
                </p>
                {data?.center && (
                  <button
                    type="button"
                    onClick={() => onFocusRegion(data.center![1], data.center![0], data.zoom || 8.5)}
                    className="px-3 py-1.5 rounded-lg bg-sky-600/25 hover:bg-sky-600/40 text-sky-200 border border-sky-500/40 text-[11px] font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer transition-all shadow-sm"
                  >
                    <Compass className="w-3.5 h-3.5 text-sky-400" />
                    <span>Focus Airshed</span>
                  </button>
                )}
              </div>
            </div>

            {/* Mass Balance Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-2.5 rounded-lg bg-[#111728] border border-[#232f48] text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-400 text-[10px] font-medium mb-1">
                  <ArrowDownRight className="w-3 h-3" /> Inflow
                </div>
                <div className="text-sm sm:text-base font-bold text-emerald-300 font-mono">
                  {summary.inflow_tonnes_day}
                </div>
                <div className="text-[9px] text-zinc-400">tonnes / day</div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#111728] border border-[#232f48] text-center">
                <div className="flex items-center justify-center gap-1 text-rose-400 text-[10px] font-medium mb-1">
                  <ArrowUpRight className="w-3 h-3" /> Outflow
                </div>
                <div className="text-sm sm:text-base font-bold text-rose-300 font-mono">
                  {summary.outflow_tonnes_day}
                </div>
                <div className="text-[9px] text-zinc-400">tonnes / day</div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#111728] border border-[#232f48] text-center">
                <div className="flex items-center justify-center gap-1 text-sky-400 text-[10px] font-medium mb-1">
                  <Wind className="w-3 h-3" /> Net Flux
                </div>
                <div className="text-sm sm:text-base font-bold text-sky-300 font-mono">
                  {summary.net_flux_tonnes_day > 0 ? `+${summary.net_flux_tonnes_day}` : summary.net_flux_tonnes_day}
                </div>
                <div className="text-[9px] text-zinc-400">
                  {summary.net_flux_tonnes_day >= 0 ? 'Accumulating' : 'Flushing'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#111728] border border-[#232f48] text-center">
                <div className="flex items-center justify-center gap-1 text-purple-400 text-[10px] font-medium mb-1">
                  <Globe className="w-3 h-3" /> Airshed Mass
                </div>
                <div className="text-sm sm:text-base font-bold text-purple-300 font-mono">
                  {summary.ambient_mass_tonnes}
                </div>
                <div className="text-[9px] text-zinc-400">active burden (t)</div>
              </div>
            </div>

            {/* Airshed Gateways / Border Checkpoint Hotspots */}
            {gateways.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-zinc-300">
                  <div className="flex items-center gap-1.5 font-semibold text-[11px] uppercase tracking-wider text-sky-400">
                    <MapPin className="w-3.5 h-3.5" />
                    Border Gateways & Checkpoints
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    Click to zoom in
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {gateways.map((gw) => {
                    let badgeColor = 'bg-sky-500/20 text-sky-300 border-sky-500/30';
                    if (gw.intensity === 'severe') badgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/30';
                    else if (gw.intensity === 'high') badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
                    else if (gw.intensity === 'low') badgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';

                    return (
                      <div
                        key={gw.id}
                        className="p-2.5 rounded-xl bg-[#101627] border border-[#23314f] hover:border-sky-500/50 transition-all flex flex-col justify-between space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-zinc-100 text-[11px]">
                              {gw.name}
                            </div>
                            <div className="text-[10px] text-sky-300 font-medium">
                              {gw.corridor}
                            </div>
                          </div>
                          {gw.flux_tonnes_day !== undefined && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${badgeColor}`}>
                              {gw.flux_tonnes_day} t/d
                            </span>
                          )}
                        </div>

                        <p className="text-[10px] text-zinc-400 line-clamp-2 leading-relaxed">
                          {gw.description}
                        </p>

                        <div className="pt-1 flex items-center justify-between border-t border-[#18233a] text-[10px]">
                          <span className="text-zinc-500 font-mono">
                            {gw.mean_no2_umol_m2 ? `${gw.mean_no2_umol_m2} µmol/m²` : ''}
                            {gw.wind_speed_ms ? ` · ${gw.wind_speed_ms} m/s` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => onFocusRegion(gw.coordinates[1], gw.coordinates[0], (data?.zoom || 8.5) + 1.2)}
                            className="px-2 py-0.5 rounded bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 font-medium flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <MapPin className="w-2.5 h-2.5" />
                            Zoom In
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ingress Corridors Breakdown Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="font-semibold text-[11px] uppercase tracking-wider text-zinc-400">
                  Border Ingress & Attribution Breakdown
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  State PCB Mandate
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
                    {corridors.map((c) => (
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

        {/* Legal Evidence Brief Tab */}
        {activeRegion === 'legal' && (
          <div className="space-y-3">
            <div className="p-3.5 rounded-xl bg-[#111728] border border-[#232f48] space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-zinc-100 text-xs">
                    Legal Evidence Brief for CAQM & Appellate Courts (NGT)
                  </span>
                  <p className="text-[10px] text-zinc-400">
                    Statutory attribution statement for inter-state disputes and judicial hearings
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold flex items-center gap-1.5 text-[11px] cursor-pointer transition-colors shadow"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy Brief'}
                </button>
              </div>
              <pre className="p-3.5 rounded-lg bg-[#090d16] border border-[#1a2336] font-mono text-[10px] text-zinc-200 whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-96">
                {brief}
              </pre>
            </div>
            <p className="text-[10px] text-zinc-500 leading-normal">
              Notice: Computed strictly via objective Sentinel-5P tropospheric density retrievals and NOAA GFS
              meteorological vector field integrations, compliant with Supreme Court MC Mehta environmental evidence guidelines.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 bg-[#0f1422] border-t border-[#1f2940] flex items-center justify-between text-[10px] text-zinc-500">
        <div className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-sky-400" />
          <span>Calculated on active 24-hour observation cycle</span>
        </div>
        {data?.center && (
          <button
            type="button"
            onClick={() => onFocusRegion(data.center![1], data.center![0], data.zoom || 8.5)}
            className="text-sky-400 hover:text-sky-300 font-medium cursor-pointer flex items-center gap-1"
          >
            Zoom into {data.region_name || 'Airshed'} <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
