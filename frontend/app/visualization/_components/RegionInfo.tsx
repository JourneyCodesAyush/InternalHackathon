'use client';

import React, { useMemo } from 'react';
import { Compass, BarChart2 } from 'lucide-react';

export interface RegionInfoProps {
  bbox: [number, number, number, number] | null;
  no2: Float32Array | null;
}

export default function RegionInfo({ bbox, no2 }: RegionInfoProps) {
  // Determine region name based on bounding box
  const regionName = useMemo(() => {
    if (!bbox) return 'Global Coordinate Domain';
    const isMumbai =
      Math.abs(bbox[0] - 72.7) < 0.15 &&
      Math.abs(bbox[1] - 18.8) < 0.15 &&
      Math.abs(bbox[2] - 73.2) < 0.15 &&
      Math.abs(bbox[3] - 19.3) < 0.15;

    if (isMumbai) return 'Mumbai Metropolitan Region';
    return `Domain [${bbox[0].toFixed(2)}°, ${bbox[1].toFixed(2)}° to ${bbox[2].toFixed(2)}°, ${bbox[3].toFixed(2)}°]`;
  }, [bbox]);

  // Compute min, max, and mean NO₂ statistics for active advected frame
  const stats = useMemo(() => {
    if (!no2 || no2.length === 0) {
      return { min: 0, max: 0, mean: 0 };
    }

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    const len = no2.length;

    for (let i = 0; i < len; i++) {
      const val = no2[i];
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
    }

    return {
      min: Math.round(min * 10) / 10,
      max: Math.round(max * 10) / 10,
      mean: Math.round((sum / len) * 10) / 10,
    };
  }, [no2]);

  // Determine hazard classification badge based on WHO/CPCB breakpoints
  const hazardBadge = useMemo(() => {
    const { mean } = stats;
    if (mean <= 40) {
      return {
        label: 'Good Air Quality',
        textColor: 'text-emerald-300',
        bgColor: 'bg-emerald-950/60',
        borderColor: 'border-emerald-500/40',
        dotColor: 'bg-emerald-400',
      };
    }
    if (mean <= 80) {
      return {
        label: 'Moderate Hazard',
        textColor: 'text-amber-300',
        bgColor: 'bg-amber-950/60',
        borderColor: 'border-amber-500/40',
        dotColor: 'bg-amber-400',
      };
    }
    if (mean <= 120) {
      return {
        label: 'Unhealthy for Sensitive',
        textColor: 'text-orange-300',
        bgColor: 'bg-orange-950/60',
        borderColor: 'border-orange-500/40',
        dotColor: 'bg-orange-400',
      };
    }
    return {
      label: 'Critical / Hazardous',
      textColor: 'text-rose-300',
      bgColor: 'bg-rose-950/60',
      borderColor: 'border-rose-500/40',
      dotColor: 'bg-rose-500',
    };
  }, [stats]);

  return (
    <div className="w-80 sm:w-96 bg-[#11141d]/95 backdrop-blur-md border border-[#242938] rounded-xl p-3.5 shadow-2xl text-[#f1f3f7] select-none">
      {/* Header with Source Pill */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-[#242938] min-w-0">
        <div className="flex items-center gap-1.5 font-semibold text-xs tracking-wide text-white min-w-0 flex-1">
          <Compass className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="truncate">{regionName}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-[10px] text-blue-300 font-mono shrink-0 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>ML Prediction</span>
        </div>
      </div>

      {/* Hazard Level Badge */}
      <div
        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs mb-3 font-medium ${hazardBadge.bgColor} ${hazardBadge.borderColor} ${hazardBadge.textColor}`}
      >
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${hazardBadge.dotColor}`} />
          {hazardBadge.label}
        </span>
        <span className="font-mono text-[11px] font-bold">
          {stats.mean} <span className="text-[9px] font-normal">µg/m³</span>
        </span>
      </div>

      {/* Telemetry Stats Grid */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-[#161a26] border border-[#242938] rounded-lg p-1.5">
          <div className="text-[10px] text-zinc-400 uppercase font-mono">Min NO₂</div>
          <div className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
            {stats.min}
          </div>
          <div className="text-[9px] text-zinc-400">µg/m³</div>
        </div>

        <div className="bg-[#161a26] border border-[#242938] rounded-lg p-1.5">
          <div className="text-[10px] text-zinc-400 uppercase font-mono flex items-center justify-center gap-0.5">
            <BarChart2 className="w-2.5 h-2.5 text-blue-400" />
            <span>Mean</span>
          </div>
          <div className="text-xs font-mono font-bold text-white mt-0.5">
            {stats.mean}
          </div>
          <div className="text-[9px] text-zinc-400">µg/m³</div>
        </div>

        <div className="bg-[#161a26] border border-[#242938] rounded-lg p-1.5">
          <div className="text-[10px] text-zinc-400 uppercase font-mono">Peak NO₂</div>
          <div className="text-xs font-mono font-bold text-rose-400 mt-0.5">
            {stats.max}
          </div>
          <div className="text-[9px] text-zinc-400">µg/m³</div>
        </div>
      </div>
    </div>
  );
}
