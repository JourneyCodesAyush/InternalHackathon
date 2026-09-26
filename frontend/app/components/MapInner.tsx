'use client';

import React, { useEffect, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  Rectangle,
  Marker,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import { KNOWN_POIS, SAMPLE_WIND_VECTORS, getHazardCategory } from '@/lib/constants';

interface MapInnerProps {
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

// Controller to smoothly animate map to new coordinates
function FlyToController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, {
      duration: 1.2,
      easeLinearity: 0.25,
    });
  }, [center, zoom, map]);
  return null;
}

// Event handler for clicking map locations
function MapClickHandler({ onMapClick }: { onMapClick: (coords: [number, number]) => void }) {
  useMapEvents({
    click(e) {
      onMapClick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

// Synthetic high-res 1km downscaled grid cells around the active center
function generateSyntheticGrid(centerLat: number, centerLng: number, timeMultiplier: number = 1.0) {
  const cells = [];
  const latStep = 0.012; // ~1.3km
  const lngStep = 0.014; // ~1.4km
  const rows = 9;
  const cols = 9;

  const startLat = centerLat - (rows / 2) * latStep;
  const startLng = centerLng - (cols / 2) * lngStep;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const south = startLat + r * latStep;
      const north = south + latStep;
      const west = startLng + c * lngStep;
      const east = west + lngStep;
      const cellCenterLat = (south + north) / 2;
      const cellCenterLng = (west + east) / 2;

      // Realistic synthetic distribution with urban hotspotting
      const distFromCenter = Math.sqrt(
        Math.pow((cellCenterLat - centerLat) / latStep, 2) +
        Math.pow((cellCenterLng - centerLng) / lngStep, 2)
      );

      // NO2 value influenced by urban center + noise + time horizon shift
      const baseNO2 = Math.max(
        22,
        Math.round(
          (135 - distFromCenter * 14 + Math.sin(r * 2.2 + c * 1.5) * 38) * timeMultiplier
        )
      );

      // Cloud cover gap simulation (cells with > 50% cloud cover were filled by ML)
      const cloudCover = Math.abs(Math.sin((r * 7 + c * 13) * 0.4)) * 100;
      const isCloudImputed = cloudCover > 55;

      cells.push({
        id: `grid-${r}-${c}`,
        bounds: [
          [south, west],
          [north, east],
        ] as [[number, number], [number, number]],
        center: [cellCenterLat, cellCenterLng] as [number, number],
        no2: baseNO2,
        cloudCover: Math.round(cloudCover),
        isCloudImputed,
      });
    }
  }
  return cells;
}

// Synthetic coarse 7km raw satellite footprint
function generateCoarseGrid(centerLat: number, centerLng: number) {
  const coarseCells = [];
  const latStep = 0.05; // ~5.5km
  const lngStep = 0.06; // ~6km

  for (let r = -2; r <= 1; r++) {
    for (let c = -2; c <= 1; c++) {
      const south = centerLat + r * latStep;
      const north = south + latStep;
      const west = centerLng + c * lngStep;
      const east = west + lngStep;

      coarseCells.push({
        id: `coarse-${r}-${c}`,
        bounds: [
          [south, west],
          [north, east],
        ] as [[number, number], [number, number]],
        center: [(south + north) / 2, (west + east) / 2] as [number, number],
        coarseNO2: Math.round(75 + (r + c) * 12),
      });
    }
  }
  return coarseCells;
}

export default function MapInner({
  center,
  zoom,
  activeLayers,
  selectedCoords,
  onMapClick,
  timeOffsetHours = 0,
}: MapInnerProps) {
  // Time offset multiplier for dispersion simulation
  const timeMultiplier =
    timeOffsetHours === 0
      ? 1.0
      : timeOffsetHours === 3
      ? 1.08
      : timeOffsetHours === 6
      ? 1.22
      : timeOffsetHours === 12
      ? 0.91
      : 0.85;

  const fineGrid = useMemo(
    () => generateSyntheticGrid(center[0], center[1], timeMultiplier),
    [center, timeMultiplier]
  );

  const coarseGrid = useMemo(
    () => generateCoarseGrid(center[0], center[1]),
    [center]
  );

  // Dynamic SVG wind arrow icon generator
  const createWindIcon = (deg: number) => {
    return L.divIcon({
      className: 'wind-arrow-marker',
      html: `
        <div style="transform: rotate(${deg}deg); display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L17 12H13V22H11V12H7L12 2Z" fill="#2dd4bf" fill-opacity="0.85" stroke="#134e4a" stroke-width="1.2"/>
          </svg>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  };

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={center}
        zoom={zoom}
        zoomControl={false}
        attributionControl={false}
        className="w-full h-full"
        style={{ height: '100%', width: '100%' }}
      >
        {/* Crisp Dark Basemap Tiles (CartoDB Dark Matter with OSM Fallback) */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
        />

        {/* Dynamic FlyTo controller */}
        <FlyToController center={center} zoom={zoom} />

        {/* Map Click Handler */}
        <MapClickHandler onMapClick={onMapClick} />

        {/* LAYER 1: Raw Coarse Satellite Footprint (7km x 3.5km) */}
        {activeLayers.rawCoarse &&
          coarseGrid.map((c) => (
            <Rectangle
              key={c.id}
              bounds={c.bounds}
              pathOptions={{
                color: '#a855f7',
                weight: 1.5,
                dashArray: '5, 5',
                fillColor: '#9333ea',
                fillOpacity: 0.12,
              }}
            >
              <Popup>
                <div className="font-sans text-xs">
                  <div className="font-semibold text-purple-400 uppercase tracking-wider text-[10px]">
                    Raw TROPOMI Satellite Pixel
                  </div>
                  <div className="font-mono text-zinc-200 mt-1">
                    Spatial Footprint: ~7.0km × 3.5km
                  </div>
                  <div className="font-mono text-zinc-300">
                    Coarse Column NO₂: {c.coarseNO2} µg/m³
                  </div>
                </div>
              </Popup>
            </Rectangle>
          ))}

        {/* LAYER 2: Fine Resolution AI/ML Downscaled Grid (1km) */}
        {activeLayers.downscaled &&
          fineGrid.map((cell) => {
            const hazard = getHazardCategory(cell.no2);
            const isImputedVisible = activeLayers.cloudFilled && cell.isCloudImputed;

            return (
              <Rectangle
                key={cell.id}
                bounds={cell.bounds}
                pathOptions={{
                  color: isImputedVisible ? '#f59e0b' : hazard.color,
                  weight: isImputedVisible ? 1.5 : 0.6,
                  dashArray: isImputedVisible ? '3, 3' : undefined,
                  fillColor: hazard.color,
                  fillOpacity: 0.38,
                }}
              >
                <Popup>
                  <div className="font-sans text-xs space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-zinc-200">
                        Downscaled 1km Grid Cell
                      </span>
                      <span
                        className="px-1.5 py-0.2 rounded font-mono text-[10px]"
                        style={{ backgroundColor: hazard.bgColor, color: hazard.color }}
                      >
                        {hazard.category}
                      </span>
                    </div>
                    <div className="text-zinc-300 font-mono text-sm font-bold">
                      {cell.no2} <span className="text-xs text-zinc-400 font-normal">µg/m³</span>
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      Coordinates: {cell.center[0].toFixed(3)}°N, {cell.center[1].toFixed(3)}°E
                    </div>
                    {cell.isCloudImputed && (
                      <div className="text-[10px] text-amber-400 font-mono pt-1 border-t border-[#242938]">
                        ⚡ Imputed: Cloud Cover was {cell.cloudCover}%
                      </div>
                    )}
                  </div>
                </Popup>
              </Rectangle>
            );
          })}

        {/* LAYER 3: Wind Vector Advection Arrows */}
        {activeLayers.windVectors &&
          SAMPLE_WIND_VECTORS.map((w) => {
            return (
              <Marker
                key={w.id}
                position={[w.lat, w.lng]}
                icon={createWindIcon(w.angleDeg)}
              >
                <Popup>
                  <div className="font-sans text-xs">
                    <div className="font-semibold text-teal-400">
                      Atmospheric Wind Vector
                    </div>
                    <div className="text-zinc-300 font-mono mt-0.5">
                      Speed: {w.magnitude} m/s
                    </div>
                    <div className="text-zinc-400 font-mono text-[11px]">
                      Direction: {w.angleDeg}° (u: {w.uComponent}, v: {w.vComponent})
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

        {/* LAYER 4: Pollution Source POIs (Factories, Highways, Power Plants) */}
        {activeLayers.pois &&
          KNOWN_POIS.map((poi) => {
            const markerColor =
              poi.category === 'POWER_PLANT'
                ? '#f43f5e'
                : poi.category === 'TRAFFIC_CORRIDOR'
                ? '#38bdf8'
                : poi.category === 'FACTORY'
                ? '#fbbf24'
                : '#c084fc';

            return (
              <CircleMarker
                key={poi.id}
                center={poi.coordinates}
                radius={7}
                pathOptions={{
                  color: markerColor,
                  fillColor: markerColor,
                  fillOpacity: 0.8,
                  weight: 2,
                }}
              >
                <Popup>
                  <div className="font-sans text-xs max-w-xs space-y-1">
                    <div className="font-semibold text-zinc-100 flex items-center justify-between">
                      <span>{poi.name}</span>
                      <span className="text-[10px] font-mono uppercase text-zinc-400">
                        {poi.category.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-snug">{poi.details}</p>
                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 pt-1 border-t border-[#242938]">
                      <span>Emission Factor: {(poi.emissionFactor * 100).toFixed(0)}%</span>
                      <span className="text-blue-400">PostGIS POI</span>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

        {/* Selected Click Pinpoint Marker */}
        {selectedCoords && (
          <CircleMarker
            center={selectedCoords}
            radius={9}
            pathOptions={{
              color: '#ffffff',
              fillColor: '#3b82f6',
              fillOpacity: 0.9,
              weight: 3,
            }}
          >
            <Popup>
              <div className="font-sans text-xs font-mono">
                <span className="font-semibold text-blue-400">Pinpointed Target</span>
                <div>{selectedCoords[0].toFixed(4)}°N, {selectedCoords[1].toFixed(4)}°E</div>
              </div>
            </Popup>
          </CircleMarker>
        )}
      </MapContainer>
    </div>
  );
}
