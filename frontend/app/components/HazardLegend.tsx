'use client';

import React from 'react';
import { REGULATORY_SCALES } from '@/lib/constants';

interface HazardLegendProps {
  compact?: boolean;
}

export default function HazardLegend({ compact = false }: HazardLegendProps) {
  if (compact) {
    return (
      <div className="flex flex-col gap-1.5 p-2 bg-[#141721]/90 border border-[#242938] rounded-md backdrop-blur-sm text-xs shadow-lg">
        <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-0.5">
          NO₂ Regulatory Index (µg/m³)
        </div>
        <div className="flex items-center gap-1 w-full">
          {REGULATORY_SCALES.map((scale) => (
            <div
              key={scale.category}
              className="flex-1 h-2 rounded-xs first:rounded-l last:rounded-r"
              style={{ backgroundColor: scale.color }}
              title={`${scale.category}: ${scale.label} (${scale.description})`}
            />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-zinc-400 font-mono mt-0.5">
          <span>0</span>
          <span>40</span>
          <span>80</span>
          <span>180+</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#141721] border border-[#242938] rounded-md p-3 text-xs shadow-md">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#242938]">
        <span className="font-semibold text-zinc-200 tracking-wide">
          NAAQS / WHO NO₂ Thresholds
        </span>
        <span className="text-[10px] font-mono text-zinc-400">µg/m³ standard</span>
      </div>

      {/* Atmospheric continuous gradient bar matching the heatmap overlay */}
      <div className="mb-3">
        <div
          className="h-2 w-full rounded-full border border-black/40 shadow-inner"
          style={{
            background:
              'linear-gradient(to right, #00e400 0%, #ffff00 20%, #ff7e00 40%, #ff0000 60%, #8f3f97 80%, #7e0023 100%)',
          }}
        />
        <div className="flex justify-between text-[9px] text-zinc-400 font-mono mt-1 px-0.5">
          <span>0</span>
          <span>40</span>
          <span>80</span>
          <span>120</span>
          <span>160</span>
          <span>200+</span>
        </div>
      </div>

      <div className="space-y-2">
        {REGULATORY_SCALES.map((scale) => (
          <div key={scale.category} className="flex items-start gap-2.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 shadow-xs"
              style={{ backgroundColor: scale.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="font-medium text-zinc-300 capitalize">
                  {scale.category.toLowerCase()}
                </span>
                <span className="text-[11px] font-mono text-zinc-400">{scale.label}</span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                {scale.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
