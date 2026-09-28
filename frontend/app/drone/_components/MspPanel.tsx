'use client';

import React, { useEffect, useState } from 'react';
import { Plug, Unplug, Zap } from 'lucide-react';

interface MspPanelProps {
  isSimulating: boolean;
  manualOverride?: boolean;
  onSimulationChange: (state: boolean) => void;
}

export default function MspPanel({ isSimulating, manualOverride = false, onSimulationChange }: MspPanelProps) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('http://localhost:8000/api/v1/drone/status');
        if (!res.ok) throw new Error('API down');
        const data = await res.json();
        const isConn = Boolean(data.connected);
        setConnected(isConn);
        setError(null);
        if (!manualOverride) {
          onSimulationChange(isConn);
        }
      } catch (err) {
        setConnected(false);
        if (!manualOverride) {
          onSimulationChange(false);
        }
        setError('Backend unavailable');
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 300);

    return () => clearInterval(interval);
  }, [manualOverride, onSimulationChange]);

  const isFcActive = connected || manualOverride;

  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <div className={`p-4 rounded-full mb-4 ${isFcActive ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
        {isFcActive ? <Plug className="w-8 h-8" /> : <Unplug className="w-8 h-8" />}
      </div>
      
      <h3 className="text-lg font-medium text-white mb-1">
        {isFcActive ? 'FC Connected' : 'FC Disconnected'}
      </h3>
      
      <p className="text-zinc-500 text-sm mb-4 max-w-[220px]">
        {isFcActive 
          ? 'SpeedyBee F405 V4 detected via MSP. Simulation active.' 
          : 'Waiting for USB serial connection on /dev/ttyACM0...'}
      </p>

      {error && !isFcActive && (
        <div className="text-xs text-red-400/80 bg-red-400/10 px-3 py-1.5 rounded">
          {error}
        </div>
      )}

      {isFcActive && (
        <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded border border-emerald-400/20 mt-2">
          <Zap className="w-3.5 h-3.5" />
          Receiving Telemetry
        </div>
      )}
    </div>
  );
}
