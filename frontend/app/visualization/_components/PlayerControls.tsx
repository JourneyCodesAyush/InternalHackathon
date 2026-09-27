'use client';

import React, { useRef, useCallback } from 'react';
import { Play, Pause, FastForward, Clock, Activity } from 'lucide-react';

export interface PlayerControlsProps {
  timestamps: string[];
  currentIndex: number;
  t: number; // 0–1 progress within current interval
  isPlaying: boolean;
  speedMultiplier: 1 | 2 | 4 | 10;
  onPlayPause: () => void;
  onSpeedChange: (s: 1 | 2 | 4 | 10) => void;
  onSeek: (index: number) => void;
}

export default function PlayerControls({
  timestamps,
  currentIndex,
  t,
  isPlaying,
  speedMultiplier,
  onPlayPause,
  onSpeedChange,
  onSeek,
}: PlayerControlsProps) {
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  // Compute total fractional timeline position [0.0, 1.0]
  const totalFrames = timestamps.length > 0 ? timestamps.length : 1;
  const progressRatio = Math.max(0.0, Math.min(1.0, (currentIndex + t) / totalFrames));

  // Format ISO timestamp into `DD MMM YYYY HH:mm UTC`
  const formattedTimestamp = React.useMemo(() => {
    const raw = timestamps[currentIndex];
    if (!raw) return 'Loading timestamp...';
    try {
      const date = new Date(raw);
      if (isNaN(date.getTime())) return raw;
      const day = String(date.getUTCDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[date.getUTCMonth()];
      const year = date.getUTCFullYear();
      const hours = String(date.getUTCHours()).padStart(2, '0');
      const minutes = String(date.getUTCMinutes()).padStart(2, '0');
      return `${day} ${month} ${year} ${hours}:${minutes} UTC`;
    } catch {
      return raw;
    }
  }, [timestamps, currentIndex]);

  // Lead-time calculation (e.g. +30min / +60min / +X hrs)
  const forecastLeadLabel = React.useMemo(() => {
    const leadMinutes = Math.round(currentIndex * 30 + t * 30);
    if (leadMinutes === 0) return 'T+00m (Base)';
    const hrs = Math.floor(leadMinutes / 60);
    const mins = leadMinutes % 60;
    if (hrs > 0 && mins > 0) return `+${hrs}h ${mins}m`;
    if (hrs > 0) return `+${hrs}h`;
    return `+${mins}m`;
  }, [currentIndex, t]);

  // Handle click on progress bar for seeking
  const handleProgressBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = progressBarRef.current;
      if (!bar || timestamps.length === 0) return;
      const rect = bar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      const targetIndex = Math.floor(ratio * timestamps.length);
      onSeek(targetIndex);
    },
    [timestamps, onSeek]
  );

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-[#11141d]/95 backdrop-blur-md border-t border-[#242938] px-4 py-3 select-none text-[#f1f3f7] shadow-2xl">
      {/* Top Interactive Progress Bar */}
      <div
        ref={progressBarRef}
        onClick={handleProgressBarClick}
        className="w-full h-2.5 bg-[#1b202e] hover:bg-[#22283a] rounded-full cursor-pointer relative overflow-hidden mb-3 border border-[#242938] transition-colors"
        title="Click to seek animation frame"
      >
        {/* Progress fill */}
        <div
          className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-400 rounded-full transition-all duration-75 relative"
          style={{ width: `${progressRatio * 100}%` }}
        >
          {/* Glowing Playhead Pin */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-[0_0_10px_rgba(59,130,246,0.9)] border-2 border-blue-600" />
        </div>
      </div>

      {/* Control Buttons & Telemetry Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: Playback Controls */}
        <div className="flex items-center gap-2">
          {/* Play/Pause Button */}
          <button
            onClick={onPlayPause}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/30 transition-colors cursor-pointer"
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
          </button>

          {/* Speed Multiplier Segmented Buttons */}
          <div className="flex items-center bg-[#141721] p-0.5 rounded-lg border border-[#242938]">
            {([1, 2, 4, 10] as const).map((spd) => (
              <button
                key={spd}
                onClick={() => onSpeedChange(spd)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                  speedMultiplier === spd
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1c2233]'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          {/* Physics Simulation Status Indicator */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#161a26] border border-[#242938] text-[11px] text-zinc-300">
            <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
            <span className="font-mono">Navier-Stokes Advection (60 FPS)</span>
          </div>
        </div>

        {/* Center: Timestamp & Interval Display */}
        <div className="flex items-center gap-2 text-center">
          <Clock className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="font-mono text-xs text-white font-medium tracking-wide">
            {formattedTimestamp}
          </span>
          <span className="px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-300 font-mono text-[10px] font-semibold">
            {forecastLeadLabel}
          </span>
        </div>

        {/* Right: Frame Counter */}
        <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
          <FastForward className="w-3.5 h-3.5 text-zinc-500" />
          <span>
            Frame <span className="text-white font-semibold">{currentIndex + 1}</span> of{' '}
            <span className="text-zinc-300">{totalFrames}</span>
          </span>
          <span className="text-[10px] text-zinc-500">(30m Δt)</span>
        </div>
      </div>
    </div>
  );
}
