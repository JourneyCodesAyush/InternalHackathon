'use client';

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { KNOWN_POIS, SAMPLE_WIND_VECTORS, getHazardCategory } from '@/lib/constants';
import { loadGoogleMaps, DARK_MAP_STYLES } from '@/lib/googleMaps';

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

// Synthetic high-res 1km downscaled grid cells around active center
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

      const distFromCenter = Math.sqrt(
        Math.pow((cellCenterLat - centerLat) / latStep, 2) +
        Math.pow((cellCenterLng - centerLng) / lngStep, 2)
      );

      const baseNO2 = Math.max(
        22,
        Math.round(
          (135 - distFromCenter * 14 + Math.sin(r * 2.2 + c * 1.5) * 38) * timeMultiplier
        )
      );

      const cloudCover = Math.abs(Math.sin((r * 7 + c * 13) * 0.4)) * 100;
      const isCloudImputed = cloudCover > 55;

      cells.push({
        id: `grid-${r}-${c}`,
        bounds: { south, west, north, east },
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
        bounds: { south, west, north, east },
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
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const animFrameRef = useRef<number | null>(null);
  const isFirstRenderRef = useRef<boolean>(true);

  // Overlay references
  const coarseOverlaysRef = useRef<any[]>([]);
  const downscaledOverlaysRef = useRef<any[]>([]);
  const windMarkersRef = useRef<any[]>([]);
  const poiMarkersRef = useRef<any[]>([]);
  const selectedMarkerRef = useRef<any>(null);
  const selectedPulseCircleRef = useRef<any>(null);

  // Keep callback fresh in ref
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

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

  // Smooth cinematic camera flight controller
  const flyTo = useCallback((targetCenter: [number, number], targetZoom: number) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const currentCenter = map.getCenter();
    if (!currentCenter) {
      map.setCenter({ lat: targetCenter[0], lng: targetCenter[1] });
      map.setZoom(targetZoom);
      return;
    }

    const startLat = currentCenter.lat();
    const startLng = currentCenter.lng();
    const startZoom = typeof map.getZoom === 'function' ? map.getZoom() : targetZoom;

    const dLat = targetCenter[0] - startLat;
    const dLng = targetCenter[1] - startLng;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);

    // If already exactly at destination, skip animation
    if (dist < 0.00005 && Math.abs(startZoom - targetZoom) < 0.05) {
      return;
    }

    // Dynamic flight duration based on geographical distance
    const duration = dist < 0.05 ? 650 : dist < 2 ? 950 : Math.min(1600, Math.round(900 + dist * 65));

    // Mid-flight zoom out arc for long-distance transitions (cinematic feel)
    const minZoom = Math.min(startZoom, targetZoom);
    const zoomDipAmount = dist > 0.25 ? Math.min(4.5, Math.log2(dist * 2.8 + 1)) : 0;
    const midFlightZoom = Math.max(4.5, minZoom - zoomDipAmount);

    const startTime = performance.now();

    function easeInOutCubic(t: number): number {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeInOutCubic(progress);

      const curLat = startLat + dLat * eased;
      const curLng = startLng + dLng * eased;

      let curZoom: number;
      if (zoomDipAmount > 0) {
        const arc = Math.sin(progress * Math.PI);
        const linearZoom = startZoom + (targetZoom - startZoom) * eased;
        curZoom = linearZoom - (linearZoom - midFlightZoom) * arc * 0.85;
      } else {
        curZoom = startZoom + (targetZoom - startZoom) * eased;
      }

      if (typeof map.moveCamera === 'function') {
        map.moveCamera({
          center: { lat: curLat, lng: curLng },
          zoom: curZoom,
        });
      } else {
        map.setCenter({ lat: curLat, lng: curLng });
        if (progress === 1 || Math.abs(map.getZoom() - Math.round(curZoom)) >= 1) {
          map.setZoom(Math.round(curZoom));
        }
      }

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        if (typeof map.moveCamera === 'function') {
          map.moveCamera({
            center: { lat: targetCenter[0], lng: targetCenter[1] },
            zoom: targetZoom,
          });
        } else {
          map.setCenter({ lat: targetCenter[0], lng: targetCenter[1] });
          map.setZoom(targetZoom);
        }
        animFrameRef.current = null;
      }
    }

    animFrameRef.current = requestAnimationFrame(step);
  }, []);

  // 1. Initialize Google Map Instance
  useEffect(() => {
    let isCancelled = false;

    loadGoogleMaps()
      .then((googleMaps) => {
        if (isCancelled || !mapContainerRef.current) return;

        if (!mapInstanceRef.current) {
          const map = new googleMaps.Map(mapContainerRef.current, {
            center: { lat: center[0], lng: center[1] },
            zoom: zoom,
            isFractionalZoomEnabled: true,
            styles: DARK_MAP_STYLES,
            mapTypeId: 'roadmap',
            backgroundColor: '#0d0f15',
            disableDefaultUI: false,
            zoomControl: true,
            zoomControlOptions: {
              position: googleMaps.ControlPosition.RIGHT_BOTTOM,
            },
            mapTypeControl: true,
            mapTypeControlOptions: {
              style: googleMaps.MapTypeControlStyle.DROPDOWN_MENU,
              position: googleMaps.ControlPosition.TOP_RIGHT,
              mapTypeIds: ['roadmap', 'satellite', 'hybrid', 'terrain'],
            },
            streetViewControl: false,
            fullscreenControl: false,
            scaleControl: true,
          });

          infoWindowRef.current = new googleMaps.InfoWindow();

          // Map click handler
          map.addListener('click', (e: any) => {
            if (e.latLng && onMapClickRef.current) {
              const lat = e.latLng.lat();
              const lng = e.latLng.lng();
              onMapClickRef.current([lat, lng]);
            }
          });

          // Cancel flight animation if user interacts directly
          map.addListener('dragstart', () => {
            if (animFrameRef.current) {
              cancelAnimationFrame(animFrameRef.current);
              animFrameRef.current = null;
            }
          });

          mapInstanceRef.current = map;
          setMapInstance(map);
        }
      })
      .catch((err) => {
        console.error('Google Maps initialization failed:', err);
      });

    return () => {
      isCancelled = true;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []); // Run once on mount

  // 2. Smoothly move and zoom map when center or zoom changes
  useEffect(() => {
    if (!mapInstance) return;

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    flyTo(center, zoom);
  }, [center, zoom, mapInstance, flyTo]);

  // 3. Render LAYER 1: Raw Coarse Satellite Footprint (7km x 3.5km)
  useEffect(() => {
    const map = mapInstance;
    const google = (window as any).google;
    if (!map || !google?.maps) return;

    coarseOverlaysRef.current.forEach((rect) => rect.setMap(null));
    coarseOverlaysRef.current = [];

    if (activeLayers.rawCoarse) {
      coarseGrid.forEach((c) => {
        const rect = new google.maps.Rectangle({
          bounds: c.bounds,
          strokeColor: '#818cf8',
          strokeOpacity: 0.45,
          strokeWeight: 0.75,
          fillColor: '#6366f1',
          fillOpacity: 0.04,
          map: map,
          clickable: true,
        });

        rect.addListener('click', (e: any) => {
          if (infoWindowRef.current) {
            const content = `
              <div style="font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11px; padding: 6px 8px; background: #0c0f17; color: #e2e8f0; border: 1px solid #1e2638; border-radius: 6px; min-width: 210px;">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1e2638; padding-bottom: 4px; margin-bottom: 6px;">
                  <span style="font-size: 9px; font-weight: 700; color: #818cf8; text-transform: uppercase; letter-spacing: 0.08em; font-family: ui-monospace, monospace;">
                    S5P TROPOMI L2 SWATH
                  </span>
                  <span style="font-size: 9px; color: #94a3b8; font-family: ui-monospace, monospace;">
                    RAW 7km
                  </span>
                </div>
                <div style="font-family: ui-monospace, monospace; font-size: 13px; font-weight: 600; color: #f8fafc; margin-bottom: 3px;">
                  ${c.coarseNO2} <span style="font-size: 10px; color: #94a3b8; font-weight: normal;">µg/m³</span>
                </div>
                <div style="font-size: 10px; color: #94a3b8; font-family: ui-monospace, monospace; line-height: 1.4;">
                  Detector Footprint: ~7.0 × 3.5 km<br />
                  Center: ${c.center[0].toFixed(3)}°N, ${c.center[1].toFixed(3)}°E
                </div>
              </div>
            `;
            infoWindowRef.current.setContent(content);
            infoWindowRef.current.setPosition(e.latLng || { lat: c.center[0], lng: c.center[1] });
            infoWindowRef.current.open(map);
          }
        });

        coarseOverlaysRef.current.push(rect);
      });
    }

    return () => {
      coarseOverlaysRef.current.forEach((rect) => rect.setMap(null));
      coarseOverlaysRef.current = [];
    };
  }, [activeLayers.rawCoarse, coarseGrid, mapInstance]);

  // 4. Render LAYER 2: Fine Resolution AI/ML Downscaled Grid (1km)
  useEffect(() => {
    const map = mapInstance;
    const google = (window as any).google;
    if (!map || !google?.maps) return;

    downscaledOverlaysRef.current.forEach((rect) => rect.setMap(null));
    downscaledOverlaysRef.current = [];

    if (activeLayers.downscaled) {
      fineGrid.forEach((cell) => {
        const hazard = getHazardCategory(cell.no2);
        const isImputedVisible = activeLayers.cloudFilled && cell.isCloudImputed;

        const rect = new google.maps.Rectangle({
          bounds: cell.bounds,
          strokeColor: isImputedVisible ? '#f59e0b' : '#475569',
          strokeOpacity: isImputedVisible ? 0.85 : 0.25,
          strokeWeight: isImputedVisible ? 1.0 : 0.5,
          fillColor: hazard.color,
          fillOpacity: 0.20,
          map: map,
          clickable: true,
        });

        rect.addListener('click', (e: any) => {
          if (infoWindowRef.current) {
            const content = `
              <div style="font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11px; padding: 6px 8px; background: #0c0f17; color: #e2e8f0; border: 1px solid #1e2638; border-radius: 6px; min-width: 220px;">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1e2638; padding-bottom: 4px; margin-bottom: 6px;">
                  <span style="font-size: 9px; font-weight: 700; color: #60a5fa; text-transform: uppercase; letter-spacing: 0.08em; font-family: ui-monospace, monospace;">
                    AI DOWNSCALED 1km
                  </span>
                  <span style="font-size: 9px; padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, monospace; font-weight: 600; background-color: ${hazard.bgColor}; color: ${hazard.color}; border: 1px solid ${hazard.color}40;">
                    ${hazard.category}
                  </span>
                </div>
                <div style="display: flex; align-items: baseline; gap: 4px; margin-bottom: 4px;">
                  <span style="font-family: ui-monospace, monospace; font-size: 16px; font-weight: 700; color: #f8fafc;">
                    ${cell.no2}
                  </span>
                  <span style="font-size: 10px; color: #94a3b8;">µg/m³ NO₂</span>
                </div>
                <div style="font-size: 10px; color: #94a3b8; font-family: ui-monospace, monospace; line-height: 1.4;">
                  Grid Coord: ${cell.center[0].toFixed(3)}°N, ${cell.center[1].toFixed(3)}°E
                </div>
                ${
                  cell.isCloudImputed
                    ? `<div style="font-size: 9px; color: #f59e0b; font-family: ui-monospace, monospace; margin-top: 5px; padding-top: 4px; border-top: 1px dashed #334155; display: flex; align-items: center; justify-content: space-between;">
                        <span>Autoencoder Infilled</span>
                        <span>Cloud Cover: ${cell.cloudCover}%</span>
                      </div>`
                    : ''
                }
              </div>
            `;
            infoWindowRef.current.setContent(content);
            infoWindowRef.current.setPosition(e.latLng || { lat: cell.center[0], lng: cell.center[1] });
            infoWindowRef.current.open(map);
          }
        });

        downscaledOverlaysRef.current.push(rect);
      });
    }

    return () => {
      downscaledOverlaysRef.current.forEach((rect) => rect.setMap(null));
      downscaledOverlaysRef.current = [];
    };
  }, [activeLayers.downscaled, activeLayers.cloudFilled, fineGrid, mapInstance]);

  // 5. Render LAYER 3: Wind Vector Advection Arrows
  useEffect(() => {
    const map = mapInstance;
    const google = (window as any).google;
    if (!map || !google?.maps) return;

    windMarkersRef.current.forEach((marker) => marker.setMap(null));
    windMarkersRef.current = [];

    if (activeLayers.windVectors) {
      SAMPLE_WIND_VECTORS.forEach((w) => {
        const marker = new google.maps.Marker({
          position: { lat: w.lat, lng: w.lng },
          icon: {
            path: 'M 0 -11 L 2.5 0 L 0.8 0 L 0.8 9 L -0.8 9 L -0.8 0 L -2.5 0 Z',
            fillColor: '#38bdf8',
            fillOpacity: 0.85,
            strokeColor: '#0284c7',
            strokeWeight: 0.8,
            scale: 1.1,
            rotation: w.angleDeg,
            anchor: new google.maps.Point(0, 0),
          },
          map: map,
          title: `ERA5 Vector: ${w.magnitude} m/s @ ${w.angleDeg}°`,
        });

        marker.addListener('click', () => {
          if (infoWindowRef.current) {
            const content = `
              <div style="font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11px; padding: 6px 8px; background: #0c0f17; color: #e2e8f0; border: 1px solid #1e2638; border-radius: 6px;">
                <div style="font-size: 9px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.08em; font-family: ui-monospace, monospace; margin-bottom: 4px;">
                  ERA5 10m Wind Flow
                </div>
                <div style="color: #f1f5f9; font-family: ui-monospace, monospace; font-size: 12px; margin-bottom: 2px;">
                  Speed: <strong>${w.magnitude} m/s</strong>
                </div>
                <div style="color: #94a3b8; font-family: ui-monospace, monospace; font-size: 10px;">
                  Heading: ${w.angleDeg}° · u: ${w.uComponent}, v: ${w.vComponent}
                </div>
              </div>
            `;
            infoWindowRef.current.setContent(content);
            infoWindowRef.current.open(map, marker);
          }
        });

        windMarkersRef.current.push(marker);
      });
    }

    return () => {
      windMarkersRef.current.forEach((marker) => marker.setMap(null));
      windMarkersRef.current = [];
    };
  }, [activeLayers.windVectors, mapInstance]);

  // 6. Render LAYER 4: Pollution Source POIs (Factories, Highways, Power Plants)
  useEffect(() => {
    const map = mapInstance;
    const google = (window as any).google;
    if (!map || !google?.maps) return;

    poiMarkersRef.current.forEach((marker) => marker.setMap(null));
    poiMarkersRef.current = [];

    if (activeLayers.pois) {
      KNOWN_POIS.forEach((poi) => {
        const markerColor =
          poi.category === 'POWER_PLANT'
            ? '#f43f5e'
            : poi.category === 'TRAFFIC_CORRIDOR'
            ? '#38bdf8'
            : poi.category === 'FACTORY'
            ? '#fbbf24'
            : '#c084fc';

        const marker = new google.maps.Marker({
          position: { lat: poi.coordinates[0], lng: poi.coordinates[1] },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5.5,
            fillColor: markerColor,
            fillOpacity: 0.9,
            strokeColor: '#090d16',
            strokeWeight: 1.5,
          },
          map: map,
          title: poi.name,
        });

        marker.addListener('click', () => {
          if (infoWindowRef.current) {
            const content = `
              <div style="font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11px; max-width: 250px; padding: 6px 8px; background: #0c0f17; color: #e2e8f0; border: 1px solid #1e2638; border-radius: 6px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; border-bottom: 1px solid #1e2638; padding-bottom: 4px;">
                  <span style="font-weight: 600; color: #f8fafc;">${poi.name}</span>
                  <span style="font-size: 9px; font-family: ui-monospace, monospace; text-transform: uppercase; color: #94a3b8; background: #1e2638; padding: 1px 4px; border-radius: 2px;">
                    ${poi.category.replace('_', ' ')}
                  </span>
                </div>
                <p style="font-size: 10px; color: #cbd5e1; line-height: 1.4; margin-bottom: 6px;">
                  ${poi.details}
                </p>
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 9px; font-family: ui-monospace, monospace; color: #94a3b8; padding-top: 4px; border-top: 1px solid #1e2638;">
                  <span>Emission Factor: ${(poi.emissionFactor * 100).toFixed(0)}%</span>
                  <span style="color: #60a5fa;">PostGIS Spatial Point</span>
                </div>
              </div>
            `;
            infoWindowRef.current.setContent(content);
            infoWindowRef.current.open(map, marker);
          }
        });

        poiMarkersRef.current.push(marker);
      });
    }

    return () => {
      poiMarkersRef.current.forEach((marker) => marker.setMap(null));
      poiMarkersRef.current = [];
    };
  }, [activeLayers.pois, mapInstance]);

  // 7. Render Selected Coords Pinpoint Marker
  useEffect(() => {
    const map = mapInstance;
    const google = (window as any).google;
    if (!map || !google?.maps) return;

    if (selectedMarkerRef.current) {
      selectedMarkerRef.current.setMap(null);
      selectedMarkerRef.current = null;
    }
    if (selectedPulseCircleRef.current) {
      selectedPulseCircleRef.current.setMap(null);
      selectedPulseCircleRef.current = null;
    }

    if (selectedCoords) {
      const pulseCircle = new google.maps.Circle({
        strokeColor: '#3b82f6',
        strokeOpacity: 0.8,
        strokeWeight: 1.5,
        fillColor: '#3b82f6',
        fillOpacity: 0.15,
        map: map,
        center: { lat: selectedCoords[0], lng: selectedCoords[1] },
        radius: 350,
      });

      const marker = new google.maps.Marker({
        position: { lat: selectedCoords[0], lng: selectedCoords[1] },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#3b82f6',
          fillOpacity: 1.0,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        zIndex: 9999,
        map: map,
        title: 'Pinpoint Target',
      });

      marker.addListener('click', () => {
        if (infoWindowRef.current) {
          const content = `
            <div style="font-family: inherit; font-size: 12px; font-family: monospace; padding: 4px 6px;">
              <span style="font-weight: 700; color: #60a5fa;">Pinpointed Target</span>
              <div style="color: #e2e8f0; margin-top: 2px;">
                ${selectedCoords[0].toFixed(4)}°N, ${selectedCoords[1].toFixed(4)}°E
              </div>
            </div>
          `;
          infoWindowRef.current.setContent(content);
          infoWindowRef.current.open(map, marker);
        }
      });

      selectedMarkerRef.current = marker;
      selectedPulseCircleRef.current = pulseCircle;
    }

    return () => {
      if (selectedMarkerRef.current) {
        selectedMarkerRef.current.setMap(null);
        selectedMarkerRef.current = null;
      }
      if (selectedPulseCircleRef.current) {
        selectedPulseCircleRef.current.setMap(null);
        selectedPulseCircleRef.current = null;
      }
    };
  }, [selectedCoords, mapInstance]);

  return (
    <div className="relative w-full h-full bg-[#0d0f15]">
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
}
