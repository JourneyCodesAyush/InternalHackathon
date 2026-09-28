'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Compass, ShieldAlert, Cpu, Radio, Gauge, Box } from 'lucide-react';
import Attitude3D from './Attitude3D';

export default function Instruments() {
  const [pitch, setPitch] = useState<number>(0);
  const [roll, setRoll] = useState<number>(0);
  const [heading, setHeading] = useState<number>(0);
  const [cardinal, setCardinal] = useState<string>('N');
  const [fcConnected, setFcConnected] = useState<boolean>(false);
  const [magAvailable, setMagAvailable] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'gauges' | '3d'>('gauges');

  useEffect(() => {
    let isSubscribed = true;
    let ws: WebSocket | null = null;
    let pollInterval: NodeJS.Timeout | null = null;

    const host = typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost';
    const httpUrl = `http://${host}:8000/api/v1/drone/attitude`;
    const wsUrl = `ws://${host}:8000/api/v1/drone/ws/attitude`;

    const handleData = (data: any) => {
      if (!isSubscribed) return;
      setPitch(data.pitch || 0);
      setRoll(data.roll || 0);
      // Corrected heading (reversed mapping from FC)
      const rawHeading = data.heading !== undefined ? data.heading : ((-data.yaw % 360 + 360) % 360);
      setHeading(Math.round(rawHeading));
      setCardinal(data.cardinal || 'N');
      setFcConnected(Boolean(data.connected));

      // Magnetometer detection check
      const isMagDetected = data.mag_available !== undefined
        ? Boolean(data.mag_available)
        : Boolean(data.mag?.detected);
      setMagAvailable(isMagDetected);
    };

    const startPollingFallback = () => {
      if (pollInterval) return;
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch(httpUrl);
          if (!res.ok) return;
          const data = await res.json();
          handleData(data);
        } catch {
          if (isSubscribed) setFcConnected(false);
        }
      }, 35); // ~30Hz
    };

    try {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleData(data);
        } catch {
          // ignore
        }
      };

      ws.onerror = () => startPollingFallback();
      ws.onclose = () => startPollingFallback();
    } catch {
      startPollingFallback();
    }

    return () => {
      isSubscribed = false;
      if (ws) ws.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  // Compass numbers: 0=N, 3=30°, 6=60°, E=90°, 12=120°, 15=150°, S=180°, 21=210°, 24=240°, W=270°, 30=300°, 33=330°
  const compassLabels = [
    { deg: 0, text: 'N', isRed: true },
    { deg: 30, text: '3' },
    { deg: 60, text: '6' },
    { deg: 90, text: 'E', isRed: true },
    { deg: 120, text: '12' },
    { deg: 150, text: '15' },
    { deg: 180, text: 'S', isRed: true },
    { deg: 210, text: '21' },
    { deg: 240, text: '24' },
    { deg: 270, text: 'W', isRed: true },
    { deg: 300, text: '30' },
    { deg: 330, text: '33' },
  ];

  // All 72 ticks (every 5 degrees)
  const compassTicks = Array.from({ length: 72 }, (_, i) => ({
    deg: i * 5,
    isMajor: (i * 5) % 10 === 0,
    isCardinal: (i * 5) % 90 === 0,
  }));

  // Bank angle ticks at top of attitude indicator: 0, ±10, ±20, ±30, ±45, ±60
  const bankTicks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];

  // Clamped pitch translation for SVG (1.8px per degree, max 55px)
  const pitchPx = Math.max(-55, Math.min(55, pitch * 1.8));

  return (
    <div className="bg-[#12151d] border border-white/10 rounded-xl overflow-hidden shadow-2xl select-none">
      {/* HEADER: Exactly like iNav Instruments */}
      <div className="bg-[#1a1f2c] px-4 py-2.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-white tracking-wide text-sm">Instruments</span>
          <span
            className={`w-2 h-2 rounded-full ${
              fcConnected ? 'bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400' : 'bg-zinc-600'
            }`}
            title={fcConnected ? 'Live iNav Telemetry Active' : 'FC Disconnected'}
          />

          {/* View Mode Switcher: Gauges (Default) vs 3D Quad */}
          <div className="flex items-center bg-black/40 rounded-lg p-0.5 border border-white/10 ml-2">
            <button
              onClick={() => setViewMode('gauges')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                viewMode === 'gauges'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Gauge className="w-3 h-3" />
              <span>Gauges</span>
            </button>
            <button
              onClick={() => setViewMode('3d')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                viewMode === '3d'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Box className="w-3 h-3" />
              <span>3D Model</span>
            </button>
          </div>
        </div>

        {/* Telemetry Readout & Sensor Status */}
        <div className="flex items-center gap-2.5 text-[11px] font-mono">
          <span className="text-zinc-400">
            P: <span className="text-white font-bold">{pitch >= 0 ? `+${pitch}` : pitch}°</span>
          </span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-400">
            R: <span className="text-white font-bold">{roll >= 0 ? `+${roll}` : roll}°</span>
          </span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-400">
            HDG: <span className="text-amber-400 font-bold">{heading.toString().padStart(3, '0')}°</span>
          </span>

          {/* Magnetometer Status Tag */}
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold border flex items-center gap-1 ${
              magAvailable
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse'
            }`}
          >
            {magAvailable ? (
              <span>MAG: ACTIVE</span>
            ) : (
              <>
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span>MAG: NOT AVAILABLE</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* CONTENT AREA: Gauges View vs 3D Model View */}
      {viewMode === '3d' ? (
        <div className="p-4">
          <Attitude3D />
        </div>
      ) : (
        <div className="p-4 sm:p-6 flex flex-wrap items-center justify-around gap-6 bg-gradient-to-b from-[#141822] to-[#0c0e14]">
          {/* ======================================================== */}
          {/* GAUGE 1: ARTIFICIAL HORIZON / ATTITUDE INDICATOR         */}
          {/* ======================================================== */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative w-44 h-44 sm:w-48 sm:h-48 rounded-full p-1 bg-gradient-to-b from-[#2e323b] via-[#1a1c22] to-[#0a0b0e] shadow-[0_8px_20px_rgba(0,0,0,0.8),inset_0_2px_4px_rgba(255,255,255,0.15)] flex items-center justify-center">
              <div className="absolute inset-1 rounded-full border border-black/80 bg-[#12141a] overflow-hidden">
                <svg viewBox="0 0 200 200" className="w-full h-full">
                  <defs>
                    <clipPath id="horizon-clip">
                      <circle cx="100" cy="100" r="92" />
                    </clipPath>

                    <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#2c72b8" />
                      <stop offset="100%" stopColor="#629ad0" />
                    </linearGradient>

                    <linearGradient id="groundGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#784724" />
                      <stop offset="100%" stopColor="#4d2b14" />
                    </linearGradient>

                    <radialGradient id="gaugeVignette" cx="50%" cy="50%" r="50%">
                      <stop offset="70%" stopColor="#000000" stopOpacity="0" />
                      <stop offset="100%" stopColor="#000000" stopOpacity="0.65" />
                    </radialGradient>
                  </defs>

                  {/* MOVING HORIZON BALL */}
                  <g clipPath="url(#horizon-clip)">
                    <g
                      transform={`rotate(${-roll}, 100, 100) translate(0, ${pitchPx})`}
                      style={{ transition: 'transform 0.08s ease-out' }}
                    >
                      {/* Sky Half */}
                      <rect x="-100" y="-300" width="400" height="400" fill="url(#skyGrad)" />

                      {/* Ground Half */}
                      <rect x="-100" y="100" width="400" height="400" fill="url(#groundGrad)" />

                      {/* White Horizon Line */}
                      <line x1="-100" y1="100" x2="300" y2="100" stroke="#ffffff" strokeWidth="2.5" />

                      {/* Pitch Ladder */}
                      <line x1="80" y1="64" x2="120" y2="64" stroke="#ffffff" strokeWidth="1.5" />
                      <text x="70" y="67" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="end" fontFamily="sans-serif">20</text>
                      <text x="130" y="67" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="start" fontFamily="sans-serif">20</text>

                      <line x1="86" y1="82" x2="114" y2="82" stroke="#ffffff" strokeWidth="1.5" />
                      <text x="76" y="85" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="end" fontFamily="sans-serif">10</text>
                      <text x="124" y="85" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="start" fontFamily="sans-serif">10</text>

                      <line x1="86" y1="118" x2="114" y2="118" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="3 2" />
                      <text x="76" y="121" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="end" fontFamily="sans-serif">10</text>
                      <text x="124" y="121" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="start" fontFamily="sans-serif">10</text>

                      <line x1="80" y1="136" x2="120" y2="136" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="3 2" />
                      <text x="70" y="139" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="end" fontFamily="sans-serif">20</text>
                      <text x="130" y="139" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="start" fontFamily="sans-serif">20</text>
                    </g>

                    <circle cx="100" cy="100" r="92" fill="url(#gaugeVignette)" pointerEvents="none" />
                  </g>

                  {/* FIXED FOREGROUND OVERLAYS */}
                  {bankTicks.map((deg) => (
                    <line
                      key={deg}
                      x1="100"
                      y1="10"
                      x2="100"
                      y2={deg === 0 ? '20' : deg % 30 === 0 ? '18' : '15'}
                      stroke="#ffffff"
                      strokeWidth={deg === 0 ? '2' : '1.5'}
                      transform={`rotate(${deg}, 100, 100)`}
                    />
                  ))}

                  <polygon points="100,24 95,14 105,14" fill="#ffffff" />

                  <line x1="100" y1="184" x2="100" y2="194" stroke="#ffffff" strokeWidth="2" />
                  <line x1="84" y1="187" x2="84" y2="193" stroke="#ffffff" strokeWidth="1.5" />
                  <line x1="116" y1="187" x2="116" y2="193" stroke="#ffffff" strokeWidth="1.5" />

                  {/* Fixed Center Orange Aircraft Wings */}
                  <g filter="drop-shadow(0px 2px 3px rgba(0,0,0,0.8))">
                    <rect x="52" y="97" width="34" height="6" rx="2" fill="#ff7700" stroke="#000000" strokeWidth="1" />
                    <rect x="114" y="97" width="34" height="6" rx="2" fill="#ff7700" stroke="#000000" strokeWidth="1" />
                    <circle cx="100" cy="100" r="3.5" fill="#ff7700" stroke="#000000" strokeWidth="1" />
                    <polygon points="100,88 94,100 106,100" fill="#ff7700" stroke="#000000" strokeWidth="1" />
                  </g>

                  <circle cx="100" cy="100" r="92" fill="none" stroke="#22242c" strokeWidth="3" />
                  <circle cx="100" cy="100" r="95" fill="none" stroke="#000000" strokeWidth="4" />
                </svg>
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">Attitude</span>
          </div>

          {/* ======================================================== */}
          {/* GAUGE 2: DIRECTIONAL GYRO / HEADING INDICATOR (COMPASS)  */}
          {/* ======================================================== */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative w-44 h-44 sm:w-48 sm:h-48 rounded-full p-1 bg-gradient-to-b from-[#2e323b] via-[#1a1c22] to-[#0a0b0e] shadow-[0_8px_20px_rgba(0,0,0,0.8),inset_0_2px_4px_rgba(255,255,255,0.15)] flex items-center justify-center">
              <div className="absolute inset-1 rounded-full border border-black/80 bg-[#0f1117] overflow-hidden">
                <svg viewBox="0 0 200 200" className="w-full h-full">
                  {/* ROTATING COMPASS CARD */}
                  <g
                    transform={`rotate(${-heading}, 100, 100)`}
                    style={{ transition: 'transform 0.08s ease-out' }}
                  >
                    <circle cx="100" cy="100" r="94" fill="#0d0f15" />

                    {compassTicks.map((t) => (
                      <line
                        key={t.deg}
                        x1="100"
                        y1="10"
                        x2="100"
                        y2={t.isCardinal ? '22' : t.isMajor ? '19' : '15'}
                        stroke={t.isCardinal ? '#ffffff' : t.isMajor ? '#ffffff' : '#888f9c'}
                        strokeWidth={t.isCardinal ? '2' : t.isMajor ? '1.5' : '1'}
                        transform={`rotate(${t.deg}, 100, 100)`}
                      />
                    ))}

                    <polygon points="100,23 96,29 104,29" fill="#ef4444" transform="rotate(0, 100, 100)" />
                    <polygon points="100,23 96,29 104,29" fill="#ef4444" transform="rotate(90, 100, 100)" />
                    <polygon points="100,23 96,29 104,29" fill="#ef4444" transform="rotate(180, 100, 100)" />
                    <polygon points="100,23 96,29 104,29" fill="#ef4444" transform="rotate(270, 100, 100)" />

                    {compassLabels.map((item) => (
                      <text
                        key={item.deg}
                        x="100"
                        y="42"
                        fill={item.isRed ? '#ef4444' : '#ffffff'}
                        fontSize={item.isRed ? '13' : '11'}
                        fontWeight="bold"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontFamily="sans-serif"
                        transform={`rotate(${item.deg}, 100, 100)`}
                      >
                        {item.text}
                      </text>
                    ))}
                  </g>

                  {/* FIXED FOREGROUND AIRPLANE SILHOUETTE */}
                  <g filter="drop-shadow(0px 0px 4px rgba(255,69,0,0.6))">
                    <path
                      d="M 100 48
                         L 102 66
                         L 104 80
                         L 138 98
                         L 138 105
                         L 105 97
                         L 105 125
                         L 118 137
                         L 118 143
                         L 100 139
                         L 82 143
                         L 82 137
                         L 95 125
                         L 95 97
                         L 62 105
                         L 62 98
                         L 96 80
                         L 98 66
                         Z"
                      fill="#151822"
                      stroke="#ff4500"
                      strokeWidth="2.4"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    <circle cx="100" cy="48" r="2" fill="#ff4500" />
                  </g>

                  <circle cx="100" cy="100" r="92" fill="none" stroke="#22242c" strokeWidth="3" />
                  <circle cx="100" cy="100" r="95" fill="none" stroke="#000000" strokeWidth="4" />
                </svg>

                {/* ======================================================== */}
                {/* MAGNETOMETER UNAVAILABLE OVERLAY BADGE ON GAUGE CLUSTER */}
                {/* ======================================================== */}
                {!magAvailable && (
                  <div className="absolute inset-x-2 bottom-3 z-30 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm border border-amber-500/60 rounded px-2 py-1 shadow-lg pointer-events-none animate-pulse">
                    <div className="flex items-center gap-1 text-amber-400 font-mono font-bold text-[9px] tracking-wider">
                      <AlertTriangle className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                      <span>MAG NOT AVAILABLE</span>
                    </div>
                    <span className="text-[7.5px] text-zinc-400 font-mono">GYRO ESTIMATE ONLY</span>
                  </div>
                )}
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">Heading</span>
          </div>
        </div>
      )}
    </div>
  );
}
