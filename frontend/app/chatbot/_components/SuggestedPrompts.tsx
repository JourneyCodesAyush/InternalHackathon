'use client';

import React from 'react';
import { MapPin, BarChart3, FileText, Search, Sparkles } from 'lucide-react';

const PROMPTS = [
  {
    text: 'Forecast air quality in Mumbai for 6 hours',
    icon: <BarChart3 className="w-3.5 h-3.5" />,
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
  {
    text: 'Generate a NO₂ map for Delhi on 2025-11-05',
    icon: <MapPin className="w-3.5 h-3.5" />,
    color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  },
  {
    text: 'Create an air quality report for Pune',
    icon: <FileText className="w-3.5 h-3.5" />,
    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  },
  {
    text: 'Find pollution hotspots in Bangalore',
    icon: <Search className="w-3.5 h-3.5" />,
    color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  },
];

interface SuggestedPromptsProps {
  onSelect: (text: string) => void;
}

export default function SuggestedPrompts({ onSelect }: SuggestedPromptsProps) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1.5 mb-3">
        <Sparkles className="w-3 h-3 text-[#5e6678]" />
        <span className="text-[11px] text-[#5e6678] font-medium uppercase tracking-wider">
          Suggested Queries
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl mx-auto">
        {PROMPTS.map(({ text, icon, color }) => (
          <button
            key={text}
            onClick={() => onSelect(text)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-xs font-medium hover:scale-[1.02] active:scale-[0.98] transition-all ${color}`}
          >
            {icon}
            <span className="flex-1 min-w-0 truncate">{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
