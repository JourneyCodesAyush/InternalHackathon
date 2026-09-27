'use client';

import React, { useState } from 'react';
import { Layers, ChevronDown } from 'lucide-react';
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
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('roadmap');
  const [isMapTypeOpen, setIsMapTypeOpen] = useState<boolean>(false);
  const mapTypeDropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (mapTypeDropdownRef.current && !mapTypeDropdownRef.current.contains(e.target as Node)) {
        setIsMapTypeOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Active layers state - kept OFF by default on startup
  const [activeLayers, setActiveLayers] = useState({
    downscaled: false,
    rawCoarse: false,
    cloudFilled: false,
    windVectors: false,
    pois: false,
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
    setMapZoom(14); // Fixed locality level
    setSelectedCoords(coords);
    setSelectedLocationName(name);
    setTrendData(calculateAttribution(coords[0], coords[1], name));
  };

  // Handle clicking directly on map coordinates (pin drop)
  const handleMapClick = (coords: [number, number]) => {
    setSelectedCoords(coords);
    setMapCenter(coords);
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
        {/* Floating Top Bar: Location Search, Status Pill & Map Type Dropdown */}
        <div className="absolute top-4 left-4 z-30 flex items-center gap-2.5">
          <LocationSearch
            onSelectLocation={handleSelectLocation}
            selectedLocationName={selectedLocationName}
          />

          {/* TROPOMI Blinking Light Box - exact h-10, px-3, whitespace-nowrap */}
          <div className="hidden sm:flex items-center gap-2 h-10 px-3 bg-[#141721]/95 border border-[#2e3547] rounded-md text-xs shadow-xl backdrop-blur-md shrink-0 whitespace-nowrap select-none">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
            <span className="font-mono text-zinc-300 text-xs whitespace-nowrap">
              TROPOMI NO₂ L3 / ERA5 Ingest
            </span>
          </div>

          {/* Map Type Dropdown - exact h-10, px-3, whitespace-nowrap */}
          <div ref={mapTypeDropdownRef} className="relative shrink-0">
            <button
              onClick={() => setIsMapTypeOpen(!isMapTypeOpen)}
              className="flex items-center gap-2 h-10 px-3 bg-[#141721]/95 border border-[#2e3547] rounded-md text-xs shadow-xl backdrop-blur-md hover:border-[#3b4257] hover:bg-[#1b202e] text-zinc-200 transition-colors cursor-pointer shrink-0 whitespace-nowrap select-none"
            >
              <Layers className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="font-medium text-xs whitespace-nowrap">
                {mapTypeId === 'roadmap'
                  ? 'Dark Map'
                  : mapTypeId.charAt(0).toUpperCase() + mapTypeId.slice(1)}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            </button>

            {isMapTypeOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-36 bg-[#141721] border border-[#2e3547] rounded-md shadow-2xl overflow-hidden z-50 py-1">
                {(
                  [
                    { id: 'roadmap', label: 'Dark Map' },
                    { id: 'satellite', label: 'Satellite' },
                    { id: 'hybrid', label: 'Hybrid' },
                    { id: 'terrain', label: 'Terrain' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setMapTypeId(item.id);
                      setIsMapTypeOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[#1c2233] transition-colors cursor-pointer whitespace-nowrap ${
                      mapTypeId === item.id
                        ? 'text-blue-400 font-semibold bg-[#161a26]'
                        : 'text-zinc-300'
                    }`}
                  >
                    <span>{item.label}</span>
                    {mapTypeId === item.id && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* The Google Maps Component */}
        <MapView
          center={mapCenter}
          zoom={mapZoom}
          activeLayers={activeLayers}
          selectedCoords={selectedCoords}
          onMapClick={handleMapClick}
          timeOffsetHours={timeOffsetHours}
          mapTypeId={mapTypeId}
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
