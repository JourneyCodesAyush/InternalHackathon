'use client';

import React from 'react';
import dynamic from 'next/dynamic';

const MapContainer = dynamic(() => import('./_components/MapContainer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#0d0f15]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-[#3b82f6]/30 border-t-[#3b82f6] animate-spin" />
        <span className="text-[#9da5b7] text-sm font-medium tracking-wide">
          Initialising map…
        </span>
      </div>
    </div>
  ),
});

export default function MapPage() {
  return (
    <main className="w-full h-full overflow-hidden">
      <MapContainer />
    </main>
  );
}
