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
  mapTypeId?: 'roadmap' | 'satellite' | 'hybrid' | 'terrain';
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
  mapTypeId = 'roadmap',
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

  // Robust, reliable camera movement controller
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
      map.setZoom(Math.round(targetZoom));
      return;
    }

    const startLat = currentCenter.lat();
    const startLng = currentCenter.lng();
    const currentZoom = Math.round(typeof map.getZoom === 'function' ? map.getZoom() : targetZoom);

    const dLat = targetCenter[0] - startLat;
    const dLng = targetCenter[1] - startLng;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);

    // If practically already at destination, skip
    if (dist < 0.00005) {
      return;
    }

    // Dynamic viewport visibility check across any device screen size
    const bounds = typeof map.getBounds === 'function' ? map.getBounds() : null;
    const google = (window as any).google;
    const targetLatLng = google?.maps?.LatLng
      ? new google.maps.LatLng(targetCenter[0], targetCenter[1])
      : { lat: targetCenter[0], lng: targetCenter[1] };

    const isWithinView = bounds ? bounds.contains(targetLatLng) : dist < 0.04;

    // SCENARIO 1: Target is visible within current view (e.g. pin drop anywhere in view)
    // The level of zoom DOES NOT CHANGE; smoothly pan to center on the target.
    if (isWithinView) {
      map.panTo({ lat: targetCenter[0], lng: targetCenter[1] });
      return;
    }

    // SCENARIO 2: Target is outside current view (search or far benchmark region)
    // Zoom out, move across to the new location, and zoom back in to fixed locality level (14)
    const targetLocalityZoom = 14; // Fixed level that clearly shows the locality

    // Determine how far to zoom out based on distance
    const dipZoom =
      dist > 3.0
        ? Math.max(5, Math.min(currentZoom, targetLocalityZoom) - 4)
        : dist > 0.6
        ? Math.max(7, Math.min(currentZoom, targetLocalityZoom) - 3)
        : Math.max(9, Math.min(currentZoom, targetLocalityZoom) - 2);

    const duration = dist > 3.0 ? 1400 : dist > 0.6 ? 1000 : 750;
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

      map.setCenter({ lat: curLat, lng: curLng });

      // Phase 1 (0 to 35%): Zoom out to dip zoom
      if (progress < 0.35) {
        const outProgress = progress / 0.35;
        const z = Math.round(currentZoom + (dipZoom - currentZoom) * outProgress);
        if (map.getZoom() !== z) map.setZoom(z);
      }
      // Phase 2 (35% to 65%): Glide across terrain at dip zoom
      else if (progress < 0.65) {
        if (map.getZoom() !== dipZoom) map.setZoom(dipZoom);
      }
      // Phase 3 (65% to 100%): Swoop in to target locality zoom
      else {
        const inProgress = (progress - 0.65) / 0.35;
        const z = Math.round(dipZoom + (targetLocalityZoom - dipZoom) * inProgress);
        if (map.getZoom() !== z) map.setZoom(z);
      }

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        map.setCenter({ lat: targetCenter[0], lng: targetCenter[1] });
        map.setZoom(targetLocalityZoom);
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
            zoom: Math.round(zoom),
            styles: DARK_MAP_STYLES,
            mapTypeId: mapTypeId,
            backgroundColor: '#0d0f15',
            disableDefaultUI: false,
            zoomControl: true,
            zoomControlOptions: {
              position: googleMaps.ControlPosition.RIGHT_BOTTOM,
            },
            // Native dropdown disabled; custom styled dropdown is in the top bar beside TROPOMI box
            mapTypeControl: false,
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

  // 3. Update map type when prop changes
  useEffect(() => {
    if (mapInstance && mapTypeId) {
      mapInstance.setMapTypeId(mapTypeId);
    }
  }, [mapTypeId, mapInstance]);

  // 4. Render LAYER 1: Raw Coarse Satellite Footprint (7km x 3.5km)
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
          strokeColor: '#a855f7',
          strokeOpacity: 0.9,
          strokeWeight: 1.5,
          fillColor: '#9333ea',
          fillOpacity: 0.12,
          map: map,
          clickable: true,
        });

        rect.addListener('click', (e: any) => {
          if (infoWindowRef.current) {
            const content = `
              <div style="font-family: inherit; font-size: 12px; padding: 4px 6px;">
                <div style="font-weight: 700; color: #c084fc; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px;">
                  Raw TROPOMI Satellite Pixel
                </div>
                <div style="font-family: monospace; color: #e2e8f0; margin-top: 5px;">
                  Spatial Footprint: ~7.0km × 3.5km
                </div>
                <div style="font-family: monospace; color: #cbd5e1; margin-top: 2px;">
                  Coarse Column NO₂: <strong>${c.coarseNO2} µg/m³</strong>
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

  // 5. Render LAYER 2: Fine Resolution AI/ML Downscaled Grid (1km)
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
          strokeColor: isImputedVisible ? '#f59e0b' : hazard.color,
          strokeOpacity: isImputedVisible ? 1.0 : 0.7,
          strokeWeight: isImputedVisible ? 2.0 : 0.8,
          fillColor: hazard.color,
          fillOpacity: 0.38,
          map: map,
          clickable: true,
        });

        rect.addListener('click', (e: any) => {
          if (infoWindowRef.current) {
            const content = `
              <div style="font-family: inherit; font-size: 12px; padding: 4px 6px; min-width: 190px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                  <span style="font-weight: 600; color: #f1f5f9;">Downscaled 1km Grid Cell</span>
                  <span style="padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 10px; font-weight: 600; background-color: ${hazard.bgColor}; color: ${hazard.color};">
                    ${hazard.category}
                  </span>
                </div>
                <div style="font-family: monospace; font-size: 16px; font-weight: 700; color: #f8fafc; margin-bottom: 4px;">
                  ${cell.no2} <span style="font-size: 11px; color: #94a3b8; font-weight: normal;">µg/m³</span>
                </div>
                <div style="font-size: 11px; color: #94a3b8; font-family: monospace;">
                  Coordinates: ${cell.center[0].toFixed(3)}°N, ${cell.center[1].toFixed(3)}°E
                </div>
                ${
                  cell.isCloudImputed
                    ? `<div style="font-size: 10px; color: #fbbf24; font-family: monospace; margin-top: 6px; padding-top: 6px; border-top: 1px solid #334155;">
                        ⚡ Imputed: Cloud Cover was ${cell.cloudCover}%
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

  // 6. Render LAYER 3: Wind Vector Advection Arrows
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
            path: 'M 0 -10 L 4 1 L 1.2 1 L 1.2 10 L -1.2 10 L -1.2 1 L -4 1 Z',
            fillColor: '#2dd4bf',
            fillOpacity: 0.9,
            strokeColor: '#0f766e',
            strokeWeight: 1.2,
            scale: 1.4,
            rotation: w.angleDeg,
            anchor: new google.maps.Point(0, 0),
          },
          map: map,
          title: `Wind: ${w.magnitude} m/s @ ${w.angleDeg}°`,
        });

        marker.addListener('click', () => {
          if (infoWindowRef.current) {
            const content = `
              <div style="font-family: inherit; font-size: 12px; padding: 4px 6px;">
                <div style="font-weight: 600; color: #2dd4bf; margin-bottom: 2px;">
                  Atmospheric Wind Vector
                </div>
                <div style="color: #f1f5f9; font-family: monospace; font-size: 12px;">
                  Speed: <strong>${w.magnitude} m/s</strong>
                </div>
                <div style="color: #94a3b8; font-family: monospace; font-size: 11px; margin-top: 3px;">
                  Direction: ${w.angleDeg}° (u: ${w.uComponent}, v: ${w.vComponent})
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

  // 7. Render LAYER 4: Pollution Source POIs (Factories, Highways, Power Plants)
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
            scale: 8,
            fillColor: markerColor,
            fillOpacity: 0.85,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
          map: map,
          title: poi.name,
        });

        marker.addListener('click', () => {
          if (infoWindowRef.current) {
            const content = `
              <div style="font-family: inherit; font-size: 12px; max-width: 250px; padding: 4px 6px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                  <span style="font-weight: 600; color: #f8fafc;">${poi.name}</span>
                  <span style="font-size: 10px; font-family: monospace; text-transform: uppercase; color: #94a3b8;">
                    ${poi.category.replace('_', ' ')}
                  </span>
                </div>
                <p style="font-size: 11px; color: #cbd5e1; line-height: 1.4; margin-bottom: 6px;">
                  ${poi.details}
                </p>
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10px; font-family: monospace; color: #94a3b8; padding-top: 6px; border-top: 1px solid #334155;">
                  <span>Emission Factor: ${(poi.emissionFactor * 100).toFixed(0)}%</span>
                  <span style="color: #60a5fa;">PostGIS POI</span>
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

  // 8. Render Selected Coords Pinpoint Marker
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
