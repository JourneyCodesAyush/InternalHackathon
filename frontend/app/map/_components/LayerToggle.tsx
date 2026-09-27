'use client';

import { Activity, Wind, Layers } from 'lucide-react';

interface LayerToggleProps {
  showNo2: boolean;
  showWind: boolean;
  onChange: (showNo2: boolean, showWind: boolean) => void;
}

type Mode = 'no2' | 'wind' | 'both';

function getMode(showNo2: boolean, showWind: boolean): Mode {
  if (showNo2 && showWind) return 'both';
  if (showNo2) return 'no2';
  return 'wind';
}

export default function LayerToggle({ showNo2, showWind, onChange }: LayerToggleProps) {
  const active = getMode(showNo2, showWind);

  const options = [
    {
      id: 'no2' as const,
      label: 'NO₂ Field',
      spec: 'TROPOMI L3',
      Icon: Activity,
    },
    {
      id: 'wind' as const,
      label: 'Wind Vector',
      spec: 'ERA5 10m',
      Icon: Wind,
    },
    {
      id: 'both' as const,
      label: 'Composite',
      spec: 'Dual Layer',
      Icon: Layers,
    },
  ];

  const handleClick = (mode: Mode) => {
    switch (mode) {
      case 'no2':  onChange(true, false);  break;
      case 'wind': onChange(false, true);  break;
      case 'both': onChange(true, true);   break;
    }
  };

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col gap-1.5 shadow-2xl"
      style={{
        background: 'rgba(9, 12, 19, 0.88)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        padding: '10px 10px',
        minWidth: '160px',
      }}
    >
      <div className="flex items-center justify-between px-1 mb-1 border-b border-white/6 pb-1.5">
        <span className="text-[10px] font-semibold text-white/40 uppercase tracking-widest font-mono">
          Sensors
        </span>
        <span className="text-[9px] font-mono text-blue-400/80 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
          ACTIVE
        </span>
      </div>
      {options.map(({ id, label, spec, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            id={`layer-toggle-${id}`}
            onClick={() => handleClick(id)}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium
              transition-all duration-150 text-left w-full cursor-pointer ${
              isActive
                ? 'bg-blue-600/20 text-blue-200 border border-blue-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-zinc-500'}`} />
            <div className="flex flex-col min-w-0">
              <span className="leading-tight truncate">{label}</span>
              <span className="text-[9px] font-mono text-zinc-500 leading-none mt-0.5">{spec}</span>
            </div>
            {isActive && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
            )}
          </button>
        );
      })}
    </div>
  );
}

