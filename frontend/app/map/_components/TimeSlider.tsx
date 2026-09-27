'use client';

import { useCallback } from 'react';

interface TimeSliderProps {
  timestamps: string[];
  currentIndex: number;
  isPlaying: boolean;
  speedMultiplier: 1 | 2 | 4;
  onSeek: (index: number) => void;
  onPlayPause: () => void;
  onSpeedChange: (speed: 1 | 2 | 4) => void;
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      hour12: false,
    }) + ' UTC';
  } catch {
    return ts;
  }
}

export default function TimeSlider({
  timestamps,
  currentIndex,
  isPlaying,
  speedMultiplier,
  onSeek,
  onPlayPause,
  onSpeedChange,
}: TimeSliderProps) {
  const total = timestamps.length;
  const currentTimestamp = timestamps[currentIndex];

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSeek(Number(e.target.value));
    },
    [onSeek],
  );

  if (total === 0) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{
        background: 'rgba(5, 7, 15, 0.82)',
        backdropFilter: 'blur(16px)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      {/* Progress bar */}
      <div className="px-4 pt-4 pb-1">
        <input
          id="time-slider"
          type="range"
          min={0}
          max={total - 1}
          step={1}
          value={currentIndex}
          onChange={handleSeek}
          className="w-full h-1.5 appearance-none rounded-full cursor-pointer"
          style={{
            // Custom track & thumb via inline CSS (Tailwind can't target pseudo-elements)
            background: `linear-gradient(to right,
              #3b82f6 0%,
              #3b82f6 ${(currentIndex / (total - 1)) * 100}%,
              rgba(255,255,255,0.12) ${(currentIndex / (total - 1)) * 100}%,
              rgba(255,255,255,0.12) 100%)`,
            outline: 'none',
          }}
        />
      </div>

      {/* Controls row */}
      <div className="px-4 pb-4 flex items-center gap-4">
        {/* Play / Pause */}
        <button
          id="play-pause-btn"
          onClick={onPlayPause}
          title={isPlaying ? 'Pause' : 'Play'}
          className="flex items-center justify-center w-9 h-9 rounded-full transition-all duration-150
            bg-[#3b82f6] hover:bg-[#2563eb] active:scale-95 shadow-lg shadow-blue-900/40 flex-shrink-0"
        >
          {isPlaying ? (
            // Pause icon
            <svg width="12" height="14" viewBox="0 0 12 14" fill="white">
              <rect x="0" y="0" width="4" height="14" rx="1" />
              <rect x="8" y="0" width="4" height="14" rx="1" />
            </svg>
          ) : (
            // Play icon
            <svg width="12" height="14" viewBox="0 0 12 14" fill="white">
              <polygon points="0,0 12,7 0,14" />
            </svg>
          )}
        </button>

        {/* Speed selector */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5 border border-white/8">
          {([1, 2, 4] as const).map((s) => (
            <button
              key={s}
              id={`speed-${s}x-btn`}
              onClick={() => onSpeedChange(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all duration-150 ${
                speedMultiplier === s
                  ? 'bg-[#3b82f6] text-white shadow-sm'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* Timestamp display */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-white/40 uppercase tracking-widest font-medium leading-none mb-0.5">
            Time
          </p>
          <p className="text-white text-sm font-semibold font-mono truncate leading-none">
            {formatTimestamp(currentTimestamp)}
          </p>
        </div>

        {/* Frame counter */}
        <div className="text-right flex-shrink-0">
          <p className="text-[11px] text-white/40 uppercase tracking-widest font-medium leading-none mb-0.5">
            Frame
          </p>
          <p className="text-white/80 text-sm font-semibold font-mono leading-none">
            {currentIndex + 1}&nbsp;<span className="text-white/30">/</span>&nbsp;{total}
          </p>
        </div>
      </div>

      {/* Range input thumb styles injected once */}
      <style>{`
        #time-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #3b82f6;
          border: 2px solid #fff;
          box-shadow: 0 0 8px rgba(59,130,246,0.7);
          cursor: pointer;
        }
        #time-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #3b82f6;
          border: 2px solid #fff;
          box-shadow: 0 0 8px rgba(59,130,246,0.7);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
