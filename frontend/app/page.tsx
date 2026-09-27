'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Layers, ChevronDown, Bot, Sparkles, LogIn, LogOut, User as UserIcon } from 'lucide-react';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';
import LocationSearch from './components/LocationSearch';
import TrendPanel from './components/TrendPanel';
import ReportGenerator from './components/ReportGenerator';
import { calculateAttribution, PRESET_REGIONS } from '@/lib/constants';
import { PinpointAttributionResult } from '@/lib/types';
import { sampleGrid } from '@/lib/modelOutput';
import { useHomeGeoTiffLoader } from './components/useHomeGeoTiffLoader';
import { useAuth } from '@/lib/auth-context';

export default function HomePage() {
  const { isAuthenticated, displayName, signOut } = useAuth();
  const [mapCenter, setMapCenter] = useState<[number, number]>(PRESET_REGIONS[0].center);
  const [mapZoom, setMapZoom] = useState<number>(PRESET_REGIONS[0].zoom);
  const [selectedLocationName, setSelectedLocationName] = useState<string>('Shivaji Park, Mumbai');
  const [selectedCoords, setSelectedCoords] = useState<[number, number] | null>(PRESET_REGIONS[0].center);
  const [timeOffsetHours, setTimeOffsetHours] = useState<number>(0);
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('roadmap');
  const [isMapTypeOpen, setIsMapTypeOpen] = useState<boolean>(false);
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false);
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

  const [panelClosed, setPanelClosed] = useState<boolean>(false);

  // The ML engine's newest ground-level NO₂ map (same data as the heatmap)
  const { data: modelMap } = useHomeGeoTiffLoader();

  // Pinpoint intelligence: the model's value at the selected point when it lies on the model map
  const trendData = useMemo<PinpointAttributionResult | null>(() => {
    if (!selectedCoords) return null;
    const [lat, lng] = selectedCoords;
    return calculateAttribution(lat, lng, selectedLocationName, sampleGrid(modelMap?.grid ?? null, lat, lng));
  }, [selectedCoords, selectedLocationName, modelMap]);

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
    setPanelClosed(false);
    const region = PRESET_REGIONS.find(
      (r) => r.center[0] === coords[0] && r.center[1] === coords[1]
    );
    const name = region?.name || 'Selected Benchmark Region';
    setSelectedLocationName(name);
  };

  // Handle selecting from location search bar or geocoding
  const handleSelectLocation = (name: string, coords: [number, number]) => {
    setMapCenter(coords);
    setMapZoom(14); // Fixed locality level
    setSelectedCoords(coords);
    setPanelClosed(false);
    setSelectedLocationName(name);
  };

  // Handle clicking directly on map coordinates (pin drop)
  const handleMapClick = (coords: [number, number]) => {
    setSelectedCoords(coords);
    setPanelClosed(false);
    setMapCenter(coords);
    const customName = `Pinpoint (${coords[0].toFixed(3)}°N, ${coords[1].toFixed(3)}°E)`;
    setSelectedLocationName(customName);
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#0d0f15]">
      {/* Fixed Left Navigation & Controls */}
      <Sidebar
        activeLayers={activeLayers}
        onToggleLayer={handleToggleLayer}
        onSelectRegion={handleSelectRegion}
        selectedCoords={selectedCoords}
        selectedLocationName={selectedLocationName}
      />

      {/* Main Map Canvas Area */}
      <main className="relative flex-1 h-full w-full overflow-hidden">
        {/* Floating Top Bar: Immediately to the right of the left slider at the top */}
        <div className="absolute top-4 left-4 z-30 flex items-center gap-2.5">
          {/* AI Bot Agent Icon - outside the left slider, to its right at the top */}
          <button
            id="ai-agent-bot-icon"
            onClick={() => setIsReportOpen(!isReportOpen)}
            className={`relative w-10 h-10 rounded-lg flex items-center justify-center shadow-xl backdrop-blur-md transition-all cursor-pointer select-none shrink-0 group border ${
              isReportOpen
                ? 'bg-blue-600/35 border-blue-400 text-white shadow-blue-500/30 ring-2 ring-blue-400/50'
                : 'bg-[#141721]/95 border-[#2e3547] hover:border-blue-400/80 hover:bg-[#1c2233] text-blue-400 hover:text-blue-300'
            }`}
            title="AeroPulse AI Agent (Chat, Analyse & PDF)"
            aria-label="AeroPulse AI Agent"
          >
            <Bot className="w-5 h-5 transition-transform group-hover:scale-110" />
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-[#141721]"></span>
            </span>
          </button>

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

        {/* Top Right Header Controls: Login / Account Action */}
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
          {isAuthenticated ? (
            <div className="flex items-center gap-2 h-10 px-3 bg-[#141721]/95 border border-[#2e3547] rounded-md text-xs shadow-xl backdrop-blur-md select-none">
              <div className="w-6 h-6 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400 font-semibold text-[11px]">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <span className="font-medium text-zinc-200 text-xs max-w-[130px] truncate" title={displayName}>
                {displayName}
              </span>
              <button
                onClick={() => signOut()}
                className="ml-1 p-1 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              id="top-right-login-btn"
              className="flex items-center gap-2 h-10 px-4 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs rounded-md shadow-xl transition-all duration-150 border border-blue-400/40 hover:border-blue-300 hover:shadow-blue-500/25 active:scale-[0.98] select-none shrink-0"
              title="Sign in to your account"
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              <span>Login</span>
            </Link>
          )}
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
        {trendData && !panelClosed && (
          <TrendPanel
            data={trendData}
            onClose={() => setPanelClosed(true)}
            onTimeSliderChange={(offset) => setTimeOffsetHours(offset)}
          />
        )}

        {/* Area Air Quality Report Agent (Analyse & PDF) Modal */}
        <ReportGenerator
          isOpen={isReportOpen}
          onClose={() => setIsReportOpen(false)}
          locationName={selectedLocationName}
          coords={selectedCoords}
        />
      </main>
    </div>
  );
}
