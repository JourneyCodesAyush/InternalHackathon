'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

interface MapViewProps {
  center: [number, number];
  zoom: number;
  activeLayers: {
    downscaled: boolean;
    rawCoarse: boolean;
    cloudFilled: boolean;
    windVectors: boolean;
    pois: boolean;
  };
  selectedCoords?: [number, number] | null;
  onMapClick: (coords: [number, number]) => void;
  timeOffsetHours?: number;
}

// Dynamically import MapInner to disable SSR for Leaflet window object requirements
const MapInner = dynamic(() => import('./MapInner'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#0d0f15] flex flex-col items-center justify-center text-zinc-400 gap-3">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      <div className="text-xs font-mono tracking-wider uppercase text-zinc-400">
        Initializing Geospatial Map Engine...
      </div>
    </div>
  ),
});

export default function MapView(props: MapViewProps) {
  return (
    <div className="w-full h-full relative overflow-hidden">
      <MapInner {...props} />
    </div>
  );
}
