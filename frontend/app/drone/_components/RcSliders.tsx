'use client';

import React, { useEffect, useState } from 'react';

interface RcSlidersProps {
  isSimulating: boolean;
}

export default function RcSliders({ isSimulating }: RcSlidersProps) {
  const [channels, setChannels] = useState({
    throttle: 0,
    roll: 0,
    pitch: 0,
    yaw: 0
  });

  useEffect(() => {
    if (!isSimulating) {
      setChannels({ throttle: 0, roll: 0, pitch: 0, yaw: 0 });
      return;
    }

    const interval = setInterval(() => {
      setChannels({
        throttle: 50 + Math.random() * 20, // 50-70% throttle
        roll: (Math.random() - 0.5) * 10,  // -5 to +5 roll
        pitch: 20 + Math.random() * 10,    // forward pitch
        yaw: (Math.random() - 0.5) * 5     // slight yaw corrections
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isSimulating]);

  const renderSlider = (label: string, value: number, isCenter: boolean = true) => {
    // Value is assumed to be -100 to 100 for center, or 0 to 100 for throttle
    const percentage = isCenter ? 50 + (value / 2) : value;
    
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="text-[10px] font-mono text-zinc-400 uppercase">{label}</div>
        <div className="relative w-8 h-32 bg-black/40 rounded border border-white/10 overflow-hidden">
          {/* Center line */}
          {isCenter && <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-white/20" />}
          
          {/* Bar */}
          <div 
            className="absolute bottom-0 left-0 right-0 bg-blue-500/80 transition-all duration-75"
            style={{ height: `${percentage}%` }}
          />
        </div>
        <div className="text-[9px] font-mono text-blue-400">
          {Math.round(value)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex gap-4 p-4 bg-[#090c13] rounded-lg border border-white/5 shadow-inner">
      {renderSlider('THR', channels.throttle, false)}
      {renderSlider('ROL', channels.roll)}
      {renderSlider('PIT', channels.pitch)}
      {renderSlider('YAW', channels.yaw)}
    </div>
  );
}
