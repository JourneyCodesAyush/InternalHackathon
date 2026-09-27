'use client';

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

  const options: { id: Mode; label: string; icon: string }[] = [
    { id: 'no2',  label: 'NO₂ Layer',   icon: '🌫' },
    { id: 'wind', label: 'Wind Layer',  icon: '💨' },
    { id: 'both', label: 'Both',        icon: '⚡' },
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
      className="fixed top-4 right-4 z-50 flex flex-col gap-1.5"
      style={{
        background: 'rgba(5, 7, 15, 0.82)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        padding: '10px 10px',
        minWidth: '140px',
      }}
    >
      <p className="text-[10px] font-semibold text-white/40 uppercase tracking-widest px-1 mb-0.5">
        Layers
      </p>
      {options.map(({ id, label, icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            id={`layer-toggle-${id}`}
            onClick={() => handleClick(id)}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium
              transition-all duration-150 text-left w-full ${
              isActive
                ? 'bg-[#3b82f6]/20 text-[#93c5fd] border border-[#3b82f6]/40'
                : 'text-white/50 hover:text-white/80 hover:bg-white/5 border border-transparent'
            }`}
          >
            <span className="text-base leading-none">{icon}</span>
            <span className="leading-none">{label}</span>
            {isActive && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse flex-shrink-0" />
            )}
          </button>
        );
      })}
    </div>
  );
}
