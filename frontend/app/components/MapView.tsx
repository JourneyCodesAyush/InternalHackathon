'use client';

import React from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';

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
  mapTypeId?: 'roadmap' | 'satellite' | 'hybrid' | 'terrain';
}

export default function MapView(props: MapViewProps) {
  const [MapInnerComponent, setMapInnerComponent] = React.useState<React.ComponentType<MapViewProps> | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;
    import('./MapInner')
      .then((mod) => {
        if (isMounted) {
          setMapInnerComponent(() => mod.default);
        }
      })
      .catch((err) => {
        console.error('Failed to load Google Maps component:', err);
        if (isMounted) {
          setLoadError(err?.message || 'Failed to initialize Google Maps engine');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (loadError) {
    return (
      <div className="w-full h-full bg-[#0d0f15] flex flex-col items-center justify-center text-rose-400 gap-3 p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-rose-500 mb-1" />
        <div className="text-xs font-mono tracking-wider uppercase text-rose-400 font-semibold">
          Google Maps Engine Failed to Load
        </div>
        <div className="text-[11px] font-mono text-zinc-500 max-w-md">
          {loadError}
        </div>
      </div>
    );
  }

  if (!MapInnerComponent) {
    return (
      <div className="w-full h-full bg-[#0d0f15] flex flex-col items-center justify-center text-zinc-400 gap-3">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <div className="text-xs font-mono tracking-wider uppercase text-zinc-400">
          Initializing Google Maps Geospatial Engine...
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative overflow-hidden bg-[#0d0f15]">
      <MapInnerComponent {...props} />
    </div>
  );
}
