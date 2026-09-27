'use client';

import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';
import LocationSearch from './components/LocationSearch';
import TrendPanel from './components/TrendPanel';
import { calculateAttribution, PRESET_REGIONS } from '@/lib/constants';
import { PinpointAttributionResult } from '@/lib/types';

export default function HomePage() {
  const [mapCenter, setMapCenter] = useState<[number, number]>(PRESET_REGIONS[0].center);
  const [mapZoom, setMapZoom] = useState<number>(PRESET_REGIONS[0].zoom);
  const [selectedLocationName, setSelectedLocationName] = useState<string>('Shivaji Park, Mumbai');
  const [selectedCoords, setSelectedCoords] = useState<[number, number] | null>(PRESET_REGIONS[0].center);
  const [timeOffsetHours, setTimeOffsetHours] = useState<number>(0);

  // Active layers state
  const [activeLayers, setActiveLayers] = useState({
    downscaled: true,
    rawCoarse: false,
    cloudFilled: false,
    windVectors: true,
    pois: true,
  });

  // Pinpoint intelligence analysis data
  const [trendData, setTrendData] = useState<PinpointAttributionResult | null>(() =>
    calculateAttribution(PRESET_REGIONS[0].center[0], PRESET_REGIONS[0].center[1], 'Shivaji Park, Mumbai')
  );

  // Handle toggling of individual map layers
  const handleToggleLayer = (
    layerKey: 'downscaled' | 'rawCoarse' | 'cloudFilled' | 'windVectors' | 'pois'
  ) => {
    setActiveLayers((prev) => ({
      ...prev,
      [layerKey]: !prev[layerKey],
    }));
  };

  // Handle clicking benchmark preset regions
  const handleSelectRegion = (coords: [number, number], zoom: number) => {
    setMapCenter(coords);
    setMapZoom(zoom);
    setSelectedCoords(coords);
    const region = PRESET_REGIONS.find(
      (r) => r.center[0] === coords[0] && r.center[1] === coords[1]
    );
    const name = region?.name || 'Selected Benchmark Region';
    setSelectedLocationName(name);
    setTrendData(calculateAttribution(coords[0], coords[1], name));
  };

  // Handle selecting from location search bar or geocoding
  const handleSelectLocation = (name: string, coords: [number, number]) => {
    setMapCenter(coords);
    setMapZoom(13);
    setSelectedCoords(coords);
    setSelectedLocationName(name);
    setTrendData(calculateAttribution(coords[0], coords[1], name));
  };

  // Handle clicking directly on map coordinates
  const handleMapClick = (coords: [number, number]) => {
    setSelectedCoords(coords);
    const customName = `Pinpoint (${coords[0].toFixed(3)}°N, ${coords[1].toFixed(3)}°E)`;
    setSelectedLocationName(customName);
    setTrendData(calculateAttribution(coords[0], coords[1], customName));
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d0f15]">
      {/* Fixed Left Navigation & Controls */}
      <Sidebar
        activeLayers={activeLayers}
        onToggleLayer={handleToggleLayer}
        onSelectRegion={handleSelectRegion}
        selectedCoords={selectedCoords}
      />

      {/* Main Map Canvas Area */}
      <main className="relative flex-1 h-full w-full overflow-hidden">
        {/* Floating Top Bar: Location Search & Status Pill */}
        <div className="absolute top-4 left-4 z-30 flex items-center gap-3">
          <LocationSearch
            onSelectLocation={handleSelectLocation}
            selectedLocationName={selectedLocationName}
          />

          <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-[#141721]/90 border border-[#2e3547] rounded-md text-xs shadow-xl backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="font-mono text-zinc-300">TROPOMI NO₂ L3 / ERA5 Ingest</span>
          </div>
        </div>

        {/* The Leaflet Map Component */}
        <MapView
          center={mapCenter}
          zoom={mapZoom}
          activeLayers={activeLayers}
          selectedCoords={selectedCoords}
          onMapClick={handleMapClick}
          timeOffsetHours={timeOffsetHours}
        />

        {/* Slide-in Trend & Attribution Panel */}
        {trendData && (
          <TrendPanel
            data={trendData}
            onClose={() => setTrendData(null)}
            onTimeSliderChange={(offset) => setTimeOffsetHours(offset)}
          />
        )}
      </main>
    </div>
  );
}
