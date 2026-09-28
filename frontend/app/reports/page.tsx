'use client';

import React from 'react';
import Navbar from '../components/Navbar';
import ReportGenerator from '../components/ReportGenerator';
import { PRESET_REGIONS } from '@/lib/constants';

export default function ReportsPage() {
  return (
    <div className="flex flex-col h-screen w-full bg-[#0d0f15] text-zinc-100 overflow-hidden">
      <Navbar />
      <div className="flex-1 w-full overflow-hidden flex flex-col p-4 sm:p-6 max-w-7xl mx-auto">
        <div className="mb-4">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            Environmental Intelligence Reports
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-mono font-medium">
              CPCB / WHO COMPLIANCE
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Generate and inspect comprehensive multi-lingual satellite air quality audits, weather-adjusted trends, drone haze observations, and what-if simulation dossiers.
          </p>
        </div>

        <div className="flex-1 bg-[#11141d] border border-[#242938] rounded-xl overflow-hidden shadow-2xl relative">
          <ReportGenerator
            isOpen={true}
            onClose={() => {}}
            locationName={PRESET_REGIONS[0].name}
            coords={PRESET_REGIONS[0].center}
            selectedDate={new Date().toISOString().split('T')[0]}
          />
        </div>
      </div>
    </div>
  );
}
