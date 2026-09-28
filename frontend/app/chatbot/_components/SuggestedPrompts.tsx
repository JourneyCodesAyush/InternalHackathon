'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  BarChart3,
  MapPin,
  FileText,
  Search,
  ShieldCheck,
  Plane,
  AlertTriangle,
  Clock,
  HelpCircle,
} from 'lucide-react';

export interface PresetQueryItem {
  id: string;
  label: string;
  query: string;
  icon: React.ReactNode;
  category: 'forecast' | 'report' | 'hotspots' | 'compliance' | 'drone' | 'anomaly';
  tag: string;
}

export const PRESET_QUERIES: PresetQueryItem[] = [
  {
    id: 'forecast-mumbai',
    label: '6-Hour Forecast (Mumbai)',
    query: 'Forecast air quality in Mumbai for 6 hours',
    icon: <BarChart3 className="w-3.5 h-3.5" />,
    category: 'forecast',
    tag: 'ML Model',
  },
  {
    id: 'map-delhi',
    label: 'NO₂ Satellite Map (Delhi)',
    query: 'Generate a NO₂ map for Delhi on 2025-11-05',
    icon: <MapPin className="w-3.5 h-3.5" />,
    category: 'forecast',
    tag: 'Downscaling',
  },
  {
    id: 'report-pune',
    label: 'Area Report (Pune)',
    query: 'Create an air quality report for Pune',
    icon: <FileText className="w-3.5 h-3.5" />,
    category: 'report',
    tag: 'PDF Export',
  },
  {
    id: 'hotspots-bangalore',
    label: 'Pollution Hotspots (Bangalore)',
    query: 'Find pollution hotspots in Bangalore',
    icon: <Search className="w-3.5 h-3.5" />,
    category: 'hotspots',
    tag: 'Attribution',
  },
  {
    id: 'standards-check',
    label: 'CPCB & WHO Compliance Check',
    query: 'Is the current air quality within CPCB 80 µg/m³ and WHO 25 µg/m³ limits?',
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    category: 'compliance',
    tag: 'Standards',
  },
  {
    id: 'anomaly-investigation',
    label: 'Suspicious / Industrial Spikes',
    query: 'Identify any suspicious or unusual pollution activity and industrial spike clusters',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    category: 'anomaly',
    tag: 'Anomalies',
  },
  {
    id: 'drone-recon',
    label: 'Pre-Inspection Drone Missions',
    query: 'Generate a pre-inspection drone flight plan for high-emission industrial zones',
    icon: <Plane className="w-3.5 h-3.5" />,
    category: 'drone',
    tag: 'Pi Drone',
  },
  {
    id: 'trend-24h',
    label: '24h Trajectory & Exposure',
    query: 'What is the 24-hour NO₂ trajectory and how many people are exposed?',
    icon: <Clock className="w-3.5 h-3.5" />,
    category: 'forecast',
    tag: 'Exposure',
  },
];

interface SuggestedPromptsProps {
  onSelect: (text: string) => void;
  className?: string;
  defaultOpen?: boolean;
}

export default function SuggestedPrompts({
  onSelect,
  className = '',
  defaultOpen = false,
}: SuggestedPromptsProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`w-full max-w-2xl mx-auto ${className}`}>
      {/* Clean trigger button */}
      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`group flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-medium transition-all cursor-pointer shadow-sm select-none ${
            isOpen
              ? 'bg-blue-600/25 border-blue-500/80 text-blue-200 ring-1 ring-blue-500/30 shadow-blue-500/20'
              : 'bg-[#141824] hover:bg-[#1c2233] border-[#2e3547] hover:border-blue-500/50 text-zinc-300 hover:text-white'
          }`}
        >
          <Sparkles className={`w-3.5 h-3.5 ${isOpen ? 'text-amber-300' : 'text-amber-400'}`} />
          <span className="font-semibold tracking-wide">Preset Questions & Intelligence Inquiries</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-semibold ${
              isOpen ? 'bg-blue-500/30 text-blue-200' : 'bg-[#1e2433] text-zinc-400'
            }`}
          >
            {PRESET_QUERIES.length}
          </span>
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5 ml-0.5 text-blue-200 group-hover:-translate-y-0.5 transition-transform" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 ml-0.5 text-zinc-400 group-hover:translate-y-0.5 transition-transform" />
          )}
        </button>
      </div>

      {/* Structured preset questions card modal/dropdown */}
      {isOpen && (
        <div className="mt-3 p-3.5 rounded-xl bg-[#11141d]/95 backdrop-blur-md border border-[#2e3547] shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150 text-left">
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-[#222838]">
            <div className="flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Choose a Preset Question
              </span>
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">Click to launch query</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PRESET_QUERIES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onSelect(item.query);
                }}
                className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#151926] hover:bg-[#1d2336] border border-[#252c3e] hover:border-blue-500/60 text-left transition-all cursor-pointer group shadow-sm"
              >
                <div className="p-1.5 rounded-md bg-blue-600/15 border border-blue-500/25 text-blue-400 group-hover:bg-blue-600/30 group-hover:text-blue-300 group-hover:scale-105 shrink-0 transition-all">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-medium text-xs text-zinc-200 group-hover:text-white transition-colors truncate">
                      {item.label}
                    </span>
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#10131d] text-zinc-400 border border-[#242938] shrink-0">
                      {item.tag}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 group-hover:text-zinc-300 line-clamp-1">
                    {item.query}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
