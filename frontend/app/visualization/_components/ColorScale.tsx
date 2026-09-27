'use client';

import React from 'react';

const COLOR_STOPS = [
  { value: 200, label: 'Hazardous', color: '#7e0023' },
  { value: 160, label: 'Severe', color: '#8f3f97' },
  { value: 120, label: 'Very Unhealthy', color: '#ff0000' },
  { value: 80, label: 'Unhealthy', color: '#ff7e00' },
  { value: 40, label: 'Moderate', color: '#ffff00' },
  { value: 0, label: 'Good', color: '#00e400' },
];

export default function ColorScale() {
  return (
    <div className="absolute bottom-20 right-4 z-20 bg-[#11141d]/95 backdrop-blur-md border border-[#242938] rounded-xl p-3 shadow-2xl text-[#f1f3f7] select-none w-52">
      {/* Title */}
      <div className="text-[11px] font-semibold text-white tracking-wide uppercase font-mono mb-2 flex items-center justify-between border-b border-[#242938] pb-1.5">
        <span>NO₂ Concentration</span>
        <span className="text-[10px] text-zinc-400 font-normal">µg/m³</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Continuous Color Gradient Bar */}
        <div
          className="w-3.5 h-44 rounded-full border border-black/40 shadow-inner shrink-0"
          style={{
            background:
              'linear-gradient(to bottom, #7e0023 0%, #8f3f97 20%, #ff0000 40%, #ff7e00 60%, #ffff00 80%, #00e400 100%)',
          }}
        />

        {/* Ticks & Category Labels */}
        <div className="flex-1 flex flex-col justify-between h-44 py-0.5 text-[10px]">
          {COLOR_STOPS.map((stop) => (
            <div key={stop.value} className="flex items-center justify-between leading-none">
              <span className="font-mono text-zinc-300 font-bold w-6">{stop.value}</span>
              <span className="text-[10px] text-zinc-400 truncate text-right">{stop.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Advisory footnote */}
      <div className="mt-2 pt-1.5 border-t border-[#242938] text-[9px] text-zinc-400 text-center font-mono">
        WHO / CPCB Regulatory AQI Scale
      </div>
    </div>
  );
}
