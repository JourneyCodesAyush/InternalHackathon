'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Map as MapIcon,
  UploadCloud,
  Layers,
  Wind,
  Factory,
  Compass,
  Cpu,
  Eye,
  Sliders,
  Sparkles,
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
}

export default function Sidebar({
  activeLayers = {
    downscaled: true,
    rawCoarse: false,
    cloudFilled: false,
    windVectors: true,
    pois: true,
  },
  onToggleLayer,
  onSelectRegion,
  selectedCoords,
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
              AEROPULSE
              <span className="text-[10px] uppercase font-mono px-1 py-0.2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded">
                v2.4
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
      </nav>

      {/* Scrollable Sub-controls */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {isMapPage && (
          <>
            {/* Quick Preset Regions */}
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                <Sliders className="w-3.5 h-3.5" />
                Benchmark Regions
              </div>
              <div className="space-y-1">
                {PRESET_REGIONS.map((region) => {
                  const isSelected =
                    selectedCoords &&
                    Math.abs(selectedCoords[0] - region.center[0]) < 0.01 &&
                    Math.abs(selectedCoords[1] - region.center[1]) < 0.01;

                  return (
                    <button
                      key={region.name}
                      onClick={() => onSelectRegion?.(region.center, region.zoom)}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-blue-600/20 border border-blue-500/80 text-white shadow-sm ring-1 ring-blue-500/30'
                          : 'text-zinc-300 bg-[#161a26] border border-[#242938] hover:border-zinc-500 hover:bg-[#1c2233]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-medium truncate ${isSelected ? 'text-blue-200' : 'text-zinc-200'}`}>
                          {region.name}
                        </span>
                        {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate mt-0.5">{region.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Map Layer Toggles */}
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                <Layers className="w-3.5 h-3.5" />
                Layer Stack
              </div>

              <div className="space-y-1.5">
                {/* Downscaled Layer */}
                <label className="flex items-center justify-between p-2 rounded bg-[#161a26] border border-[#242938] hover:border-[#3b4257] cursor-pointer text-xs text-zinc-300">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                    <div>
                      <div className="font-medium text-zinc-200">AI Fine Grid (1km)</div>
                      <div className="text-[10px] text-zinc-400">XGBoost ML Downscaled</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={activeLayers.downscaled}
                    onChange={() => onToggleLayer?.('downscaled')}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-blue-600"
                  />
                </label>

                {/* Cloud-Filled Gap Imputation */}
                <label className="flex items-center justify-between p-2 rounded bg-[#161a26] border border-[#242938] hover:border-[#3b4257] cursor-pointer text-xs text-zinc-300">
                  <div className="flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5 text-amber-400" />
                    <div>
                      <div className="font-medium text-zinc-200">Cloud Gap Infilling</div>
                      <div className="text-[10px] text-zinc-400">Kriging / Autoencoder</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={activeLayers.cloudFilled}
                    onChange={() => onToggleLayer?.('cloudFilled')}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-blue-600"
                  />
                </label>

                {/* Raw Coarse Layer */}
                <label className="flex items-center justify-between p-2 rounded bg-[#161a26] border border-[#242938] hover:border-[#3b4257] cursor-pointer text-xs text-zinc-300">
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-purple-400" />
                    <div>
                      <div className="font-medium text-zinc-200">Raw Sentinel-5P (7km)</div>
                      <div className="text-[10px] text-zinc-400">Coarse Satellite Swath</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={activeLayers.rawCoarse}
                    onChange={() => onToggleLayer?.('rawCoarse')}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-blue-600"
                  />
                </label>

                {/* Wind Vectors Layer */}
                <label className="flex items-center justify-between p-2 rounded bg-[#161a26] border border-[#242938] hover:border-[#3b4257] cursor-pointer text-xs text-zinc-300">
                  <div className="flex items-center gap-2">
                    <Wind className="w-3.5 h-3.5 text-teal-400" />
                    <div>
                      <div className="font-medium text-zinc-200">Wind Advection Flow</div>
                      <div className="text-[10px] text-zinc-400">Atmospheric u,v vectors</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={activeLayers.windVectors}
                    onChange={() => onToggleLayer?.('windVectors')}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-blue-600"
                  />
                </label>

                {/* POI Sources Layer */}
                <label className="flex items-center justify-between p-2 rounded bg-[#161a26] border border-[#242938] hover:border-[#3b4257] cursor-pointer text-xs text-zinc-300">
                  <div className="flex items-center gap-2">
                    <Factory className="w-3.5 h-3.5 text-rose-400" />
                    <div>
                      <div className="font-medium text-zinc-200">Point Sources (POIs)</div>
                      <div className="text-[10px] text-zinc-400">Industrial & Corridors</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={activeLayers.pois}
                    onChange={() => onToggleLayer?.('pois')}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-blue-600"
                  />
                </label>
              </div>
            </div>

            {/* Standard AQI Scale */}
            <div>
              <HazardLegend />
            </div>
          </>
        )}

        {!isMapPage && (
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
