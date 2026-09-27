'use client';

// NO₂ AQI breakpoints and labels — must mirror the chroma scale in GeoTiffLayer
const LEGEND_STOPS = [
  { value: 0,   color: '#10b981', label: '0',    category: 'Satisfactory' },
  { value: 40,  color: '#eab308', label: '40',   category: 'Moderate' },
  { value: 80,  color: '#f97316', label: '80',   category: 'Unhealthy' },
  { value: 120, color: '#ef4444', label: '120',  category: 'Very Unhealthy' },
  { value: 160, color: '#9333ea', label: '160',  category: 'Severe' },
  { value: 200, color: '#6b1124', label: '200+', category: 'Hazardous' },
];

const GRADIENT = LEGEND_STOPS.map((s) => s.color).join(', ');

export default function ColorLegend() {
  return (
    <div
      className="fixed z-40 flex flex-col gap-2 shadow-2xl"
      style={{
        right: '16px',
        bottom: '96px', // above the TimeSlider (~80px tall)
        background: 'rgba(9, 12, 19, 0.88)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        padding: '12px 12px',
        width: '142px',
      }}
    >
      {/* Title */}
      <p className="text-[11px] font-semibold text-white/70 uppercase tracking-widest leading-none text-center">
        NO₂ (µg/m³)
      </p>

      {/* Gradient bar + tick marks */}
      <div className="flex items-stretch gap-2 mt-1">
        {/* Vertical gradient bar */}
        <div
          className="w-4 rounded-sm flex-shrink-0"
          style={{
            background: `linear-gradient(to top, ${GRADIENT})`,
            minHeight: '144px',
          }}
        />

        {/* Tick labels */}
        <div className="flex flex-col justify-between flex-1">
          {[...LEGEND_STOPS].reverse().map((stop) => (
            <div key={stop.value} className="flex items-center gap-1.5">
              <span
                className="text-[11px] font-mono font-semibold leading-none"
                style={{ color: stop.color === '#ffff00' ? '#d4c800' : stop.color }}
              >
                {stop.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Category labels */}
      <div className="flex flex-col gap-1 mt-1 pt-2 border-t border-white/8">
        {LEGEND_STOPS.map((stop) => (
          <div key={stop.value} className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ background: stop.color }}
            />
            <span className="text-[10px] text-white/60 leading-none truncate">
              {stop.category}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
