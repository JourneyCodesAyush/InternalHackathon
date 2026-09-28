'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Map as MapIcon,
  Globe2,
  UploadCloud,
  Layers,
  Wind,
  Factory,
  Compass,
  Cpu,
  ScanLine,
  Sliders,
  Grid3x3,
  Satellite,
  Navigation,
  Bot,
  Radio,
} from 'lucide-react';
import HazardLegend from './HazardLegend';
import { PRESET_REGIONS } from '@/lib/constants';

interface SidebarProps {
  activeLayers?: {
    downscaled: boolean;
    rawCoarse: boolean;
    cloudFilled: boolean;
    windVectors: boolean;
    pois: boolean;
  };
  onToggleLayer?: (layerKey: 'downscaled' | 'rawCoarse' | 'cloudFilled' | 'windVectors' | 'pois') => void;
  onSelectRegion?: (coords: [number, number], zoom: number) => void;
  selectedCoords?: [number, number] | null;
  selectedLocationName?: string;
}

export default function Sidebar({
  activeLayers = {
    downscaled: false,
    rawCoarse: false,
    cloudFilled: false,
    windVectors: false,
    pois: false,
  },
  onToggleLayer,
  onSelectRegion,
  selectedCoords,
  selectedLocationName = 'Selected area',
}: SidebarProps) {
  const pathname = usePathname();
  const isMapPage = pathname === '/';

  return (
    <aside className="w-64 h-full bg-[#11141d] border-r border-[#242938] flex flex-col shrink-0 z-20 select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-[#242938]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <div className="font-semibold text-sm tracking-wide text-zinc-100 flex items-center gap-1.5">
              AirQ Insight
              <span className="text-[10px] uppercase font-mono px-1 py-0.2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded font-semibold">
                GEO-INTEL
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 leading-tight">
              TROPOMI Downscaling Engine
            </div>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="p-3 border-b border-[#242938] space-y-1">
        <Link
          href="/"
          className={`flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
            isMapPage
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e]'
          }`}
        >
          <MapIcon className="w-4 h-4" />
          Geospatial Map
        </Link>
        <Link
          href="/upload"
          className={`flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
            pathname === '/upload'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e]'
          }`}
        >
          <UploadCloud className="w-4 h-4" />
          Model Upload & Clean
        </Link>
        <Link
          href="/visualization"
          className={`flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
            pathname === '/visualization'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e]'
          }`}
        >
          <Wind className="w-4 h-4" />
          Plume Flow
        </Link>
        <Link
          href="/globe"
          className={`flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
            pathname === '/globe'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e]'
          }`}
        >
          <Globe2 className="w-4 h-4" />
          Global NO₂ Globe
        </Link>
        <Link
          href="/drone"
          className={`flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
            pathname === '/drone'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e]'
          }`}
        >
          <Navigation className="w-4 h-4" />
          Pi Drone Portal
        </Link>
        <Link
          href="/swarm"
          className={`flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
            pathname === '/swarm'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e]'
          }`}
        >
          <Globe2 className="w-4 h-4 text-cyan-400" />
          Cesium 3D View
        </Link>
        <Link
          href="/chatbot"
          className={`flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
            pathname === '/chatbot'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e]'
          }`}
        >
          <Bot className="w-4 h-4" />
          AI Chatbot Portal
        </Link>
      </nav>

      {/* Scrollable Sub-controls */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {isMapPage && (
          <>
            {/* Quick Preset Regions */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                <span className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  Benchmark Regions
                </span>
                <span className="text-[9px] font-mono text-zinc-500">CALIBRATED</span>
              </div>
              <div className="space-y-1.5">
                {PRESET_REGIONS.map((region) => {
                  const isSelected =
                    selectedCoords &&
                    Math.abs(selectedCoords[0] - region.center[0]) < 0.01 &&
                    Math.abs(selectedCoords[1] - region.center[1]) < 0.01;

                  return (
                    <button
                      key={region.name}
                      onClick={() => onSelectRegion?.(region.center, region.zoom)}
                      className={`w-full text-left p-2.5 rounded-lg text-xs transition-all cursor-pointer border ${
                        isSelected
                          ? 'bg-[#141926] border-blue-500/70 border-l-2 border-l-blue-500 text-white shadow-sm ring-1 ring-blue-500/20'
                          : 'text-zinc-300 bg-[#11141d]/90 border-[#1f2535] hover:border-[#2e384e] hover:bg-[#151926]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className={`font-medium truncate ${isSelected ? 'text-blue-200' : 'text-zinc-200'}`}>
                          {region.name}
                        </span>
                        {isSelected ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0 animate-pulse" />
                        ) : (
                          <span className="font-mono text-[9px] text-zinc-500">
                            {region.center[0].toFixed(1)}°,{region.center[1].toFixed(1)}°
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate mt-0.5">{region.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Map Layer Toggles */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  Layer Stack
                </span>
                <span className="text-[9px] font-mono text-zinc-500">FILTERS</span>
              </div>

              <div className="space-y-1.5">
                {/* Downscaled Layer */}
                <label
                  htmlFor="layer-downscaled"
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer text-xs ${
                    activeLayers.downscaled
                      ? 'bg-[#141926] border-[#29354d] border-l-2 border-l-blue-500 shadow-sm'
                      : 'bg-[#11141d]/90 border-[#1f2535] hover:border-[#2e384e] opacity-75 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Grid3x3 className={`w-3.5 h-3.5 shrink-0 ${activeLayers.downscaled ? 'text-blue-400' : 'text-zinc-500'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-zinc-200 truncate">AI Fine Grid (1km)</span>
                        <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                          1km RES
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">XGBoost ML Downscaled</div>
                    </div>
                  </div>
                  <div className="relative inline-flex items-center cursor-pointer shrink-0 ml-2">
                    <input
                      type="checkbox"
                      id="layer-downscaled"
                      checked={activeLayers.downscaled}
                      onChange={() => onToggleLayer?.('downscaled')}
                      className="sr-only peer"
                    />
                    <div className={`w-7 h-4 rounded-full transition-colors duration-150 ${
                      activeLayers.downscaled ? 'bg-blue-600' : 'bg-[#1e2434] border border-[#2e374d]'
                    }`}>
                      <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-150 mt-[2px] ml-[2px] ${
                        activeLayers.downscaled ? 'translate-x-3' : 'translate-x-0'
                      }`} />
                    </div>
                  </div>
                </label>

                {/* Cloud-Filled Gap Imputation */}
                <label
                  htmlFor="layer-cloudFilled"
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer text-xs ${
                    activeLayers.cloudFilled
                      ? 'bg-[#141926] border-[#29354d] border-l-2 border-l-amber-500 shadow-sm'
                      : 'bg-[#11141d]/90 border-[#1f2535] hover:border-[#2e384e] opacity-75 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ScanLine className={`w-3.5 h-3.5 shrink-0 ${activeLayers.cloudFilled ? 'text-amber-400' : 'text-zinc-500'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-zinc-200 truncate">Cloud Gap Infilling</span>
                        <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                          GAP-FILL
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">Kriging / Autoencoder</div>
                    </div>
                  </div>
                  <div className="relative inline-flex items-center cursor-pointer shrink-0 ml-2">
                    <input
                      type="checkbox"
                      id="layer-cloudFilled"
                      checked={activeLayers.cloudFilled}
                      onChange={() => onToggleLayer?.('cloudFilled')}
                      className="sr-only peer"
                    />
                    <div className={`w-7 h-4 rounded-full transition-colors duration-150 ${
                      activeLayers.cloudFilled ? 'bg-amber-600' : 'bg-[#1e2434] border border-[#2e374d]'
                    }`}>
                      <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-150 mt-[2px] ml-[2px] ${
                        activeLayers.cloudFilled ? 'translate-x-3' : 'translate-x-0'
                      }`} />
                    </div>
                  </div>
                </label>

                {/* Raw Coarse Layer */}
                <label
                  htmlFor="layer-rawCoarse"
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer text-xs ${
                    activeLayers.rawCoarse
                      ? 'bg-[#141926] border-[#29354d] border-l-2 border-l-indigo-500 shadow-sm'
                      : 'bg-[#11141d]/90 border-[#1f2535] hover:border-[#2e384e] opacity-75 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Satellite className={`w-3.5 h-3.5 shrink-0 ${activeLayers.rawCoarse ? 'text-indigo-400' : 'text-zinc-500'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-zinc-200 truncate">Raw Sentinel-5P</span>
                        <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                          7km SWATH
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">Coarse Satellite Swath</div>
                    </div>
                  </div>
                  <div className="relative inline-flex items-center cursor-pointer shrink-0 ml-2">
                    <input
                      type="checkbox"
                      id="layer-rawCoarse"
                      checked={activeLayers.rawCoarse}
                      onChange={() => onToggleLayer?.('rawCoarse')}
                      className="sr-only peer"
                    />
                    <div className={`w-7 h-4 rounded-full transition-colors duration-150 ${
                      activeLayers.rawCoarse ? 'bg-indigo-600' : 'bg-[#1e2434] border border-[#2e374d]'
                    }`}>
                      <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-150 mt-[2px] ml-[2px] ${
                        activeLayers.rawCoarse ? 'translate-x-3' : 'translate-x-0'
                      }`} />
                    </div>
                  </div>
                </label>

                {/* Wind Vectors Layer */}
                <label
                  htmlFor="layer-windVectors"
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer text-xs ${
                    activeLayers.windVectors
                      ? 'bg-[#141926] border-[#29354d] border-l-2 border-l-sky-500 shadow-sm'
                      : 'bg-[#11141d]/90 border-[#1f2535] hover:border-[#2e384e] opacity-75 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Wind className={`w-3.5 h-3.5 shrink-0 ${activeLayers.windVectors ? 'text-sky-400' : 'text-zinc-500'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-zinc-200 truncate">Wind Advection Flow</span>
                        <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 shrink-0">
                          ERA5 10m
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">Atmospheric u,v vectors</div>
                    </div>
                  </div>
                  <div className="relative inline-flex items-center cursor-pointer shrink-0 ml-2">
                    <input
                      type="checkbox"
                      id="layer-windVectors"
                      checked={activeLayers.windVectors}
                      onChange={() => onToggleLayer?.('windVectors')}
                      className="sr-only peer"
                    />
                    <div className={`w-7 h-4 rounded-full transition-colors duration-150 ${
                      activeLayers.windVectors ? 'bg-sky-600' : 'bg-[#1e2434] border border-[#2e374d]'
                    }`}>
                      <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-150 mt-[2px] ml-[2px] ${
                        activeLayers.windVectors ? 'translate-x-3' : 'translate-x-0'
                      }`} />
                    </div>
                  </div>
                </label>

                {/* POI Sources Layer */}
                <label
                  htmlFor="layer-pois"
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer text-xs ${
                    activeLayers.pois
                      ? 'bg-[#141926] border-[#29354d] border-l-2 border-l-rose-500 shadow-sm'
                      : 'bg-[#11141d]/90 border-[#1f2535] hover:border-[#2e384e] opacity-75 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Factory className={`w-3.5 h-3.5 shrink-0 ${activeLayers.pois ? 'text-rose-400' : 'text-zinc-500'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-zinc-200 truncate">Point Sources (POIs)</span>
                        <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 shrink-0">
                          POSTGIS
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">Industrial & Corridors</div>
                    </div>
                  </div>
                  <div className="relative inline-flex items-center cursor-pointer shrink-0 ml-2">
                    <input
                      type="checkbox"
                      id="layer-pois"
                      checked={activeLayers.pois}
                      onChange={() => onToggleLayer?.('pois')}
                      className="sr-only peer"
                    />
                    <div className={`w-7 h-4 rounded-full transition-colors duration-150 ${
                      activeLayers.pois ? 'bg-rose-600' : 'bg-[#1e2434] border border-[#2e374d]'
                    }`}>
                      <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-150 mt-[2px] ml-[2px] ${
                        activeLayers.pois ? 'translate-x-3' : 'translate-x-0'
                      }`} />
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Standard AQI Scale */}
            <div>
              <HazardLegend />
            </div>
          </>
        )}

        {pathname === '/upload' && (
          <div className="p-3 rounded bg-[#161a26] border border-[#242938] text-xs space-y-2">
            <div className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-blue-400" />
              Pipeline Specifications
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Accepts Level-2 / Level-3 TROPOMI products in NetCDF (.nc), GeoTIFF (.tif), HDF5, or imagery bands (.png, .jpg).
            </p>
            <ul className="text-[11px] text-zinc-400 space-y-1 list-disc list-inside">
              <li>Cloud Gap Imputation: R² &gt; 0.85</li>
              <li>Spatial Resolution: 7km → 1km</li>
              <li>Auxiliary inputs: ERA5, DEM</li>
            </ul>
          </div>
        )}
      </div>

      {/* Engine Status Footer */}
      <div className="p-3 border-t border-[#242938] bg-[#0c0e14] text-[11px]">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            ML Inference Ready
          </span>
          <span className="font-mono text-[10px] text-zinc-400">LATENCY 42ms</span>
        </div>
      </div>
    </aside>
  );
}
