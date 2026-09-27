'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { loadGoogleMaps, DARK_MAP_STYLES } from '@/lib/googleMaps';
import { Cloud, Radio, Navigation, CheckCircle2, ShieldAlert } from 'lucide-react';
import RcSliders from './RcSliders';

interface SimulationMapProps {
  isSimulating: boolean;
}

export interface CloudZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  cloudCover: number;
  imputedNO2?: string;
  description?: string;
}

const MUMBAI_COORD = { lat: 19.0760, lng: 72.8777 };

// Custom SVG path for an aerial Quadcopter:
// Central avionics fuselage + forward nose pod + 4 diagonal motor arms + 4 rotor guards + propeller blades
const QUADCOPTER_SVG_PATH = (
  'M 0,-10 L 5,-4 L 4,5 L -4,5 L -5,-4 Z '
  + 'M 0,-15 L 3.5,-9 L -3.5,-9 Z '
  + 'M -3,-3 L -13,-13 '
  + 'M 3,-3 L 13,-13 '
  + 'M -3,3 L -13,13 '
  + 'M 3,3 L 13,13 '
  + 'M -7.5,-13 A 5.5 5.5 0 1 1 -18.5,-13 A 5.5 5.5 0 1 1 -7.5,-13 '
  + 'M 18.5,-13 A 5.5 5.5 0 1 1 7.5,-13 A 5.5 5.5 0 1 1 18.5,-13 '
  + 'M -7.5,13 A 5.5 5.5 0 1 1 -18.5,13 A 5.5 5.5 0 1 1 -7.5,13 '
  + 'M 18.5,13 A 5.5 5.5 0 1 1 7.5,13 A 5.5 5.5 0 1 1 18.5,13 '
  + 'M -17,-13 L -9,-13 '
  + 'M 9,-13 L 17,-13 '
  + 'M -17,13 L -9,13 '
  + 'M 9,13 L 17,13'
);

const getQuadcopterSymbol = (googleMaps: any, rotationDeg: number, isSim: boolean) => ({
  path: QUADCOPTER_SVG_PATH,
  fillColor: isSim ? '#ef4444' : '#94a3b8',
  fillOpacity: 1,
  strokeColor: isSim ? '#ffffff' : '#cbd5e1',
  strokeWeight: 1.5,
  scale: 1.35,
  rotation: Math.round(rotationDeg),
  anchor: new googleMaps.Point(0, 0),
});

export default function SimulationMap({ isSimulating }: SimulationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const googleMapsRef = useRef<any>(null);
  const droneMarkerRef = useRef<any>(null);
  const flightPathRef = useRef<any>(null);
  const zoneOverlaysRef = useRef<{ circle: any; marker: any; id: string }[]>([]);
  const animRef = useRef<number | null>(null);

  const [cloudZones, setCloudZones] = useState<CloudZone[]>([]);
  const [activeZone, setActiveZone] = useState<CloudZone | null>(null);
  const [visitedZoneIds, setVisitedZoneIds] = useState<string[]>([]);
  const [missionPhase, setMissionPhase] = useState<'IDLE' | 'TRANSIT' | 'LOITER' | 'COMPLETED_PATROL'>('IDLE');
  const [loiterProgress, setLoiterProgress] = useState<number>(0);
  const [currentSensorNO2, setCurrentSensorNO2] = useState<number>(38.4);
  const [speed, setSpeed] = useState<number>(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Mutable refs for high-frequency animation loop
  const dronePosRef = useRef<{ lat: number; lng: number }>(MUMBAI_COORD);
  const headingRef = useRef<number>(0);
  const visitedRef = useRef<Set<string>>(new Set());
  const activeZoneRef = useRef<CloudZone | null>(null);
  const missionPhaseRef = useRef<'IDLE' | 'TRANSIT' | 'LOITER' | 'COMPLETED_PATROL'>('IDLE');
  const cloudZonesRef = useRef<CloudZone[]>([]);
  const speedRef = useRef<number>(speed);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // 1. Fetch Cloud Covered Zones from Backend / Satellite Dataset
  useEffect(() => {
    fetch('http://localhost:8000/api/v1/drone/cloud_zones')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.zones && Array.isArray(data.zones)) {
          setCloudZones(data.zones);
          cloudZonesRef.current = data.zones;
        }
      })
      .catch((err) => {
        console.warn('Could not fetch cloud zones from API, using regional dataset fallback:', err);
        const fallback = [
          {
            id: 'zone-1',
            name: 'Navi Mumbai Industrial Cloud Gap',
            lat: 18.9875,
            lng: 73.0325,
            radius: 3200,
            cloudCover: 0.88,
            imputedNO2: '64.2 µg/m³',
            description: 'Dense cloud occlusion over JNPT / industrial belt; high gap-fill imputation',
          },
          {
            id: 'zone-2',
            name: 'Thane Creek Cloud Cell',
            lat: 19.2030,
            lng: 72.9017,
            radius: 3600,
            cloudCover: 0.79,
            imputedNO2: '58.1 µg/m³',
            description: 'Marine haze and cumulus deck along the northern creek passage',
          },
          {
            id: 'zone-3',
            name: 'Kalyan-Dombivli Cloud Pocket',
            lat: 19.2675,
            lng: 73.1025,
            radius: 3000,
            cloudCover: 0.84,
            imputedNO2: '71.5 µg/m³',
            description: 'Persistent valley cloud gap masking ground emissions',
          },
          {
            id: 'zone-4',
            name: 'South Mumbai Maritime Cloud Deck',
            lat: 18.9335,
            lng: 72.8794,
            radius: 3400,
            cloudCover: 0.81,
            imputedNO2: '46.3 µg/m³',
            description: 'Coastal stratus boundary layer obscuring S5P retrieval',
          },
        ];
        setCloudZones(fallback);
        cloudZonesRef.current = fallback;
      });
  }, []);

  // 2. Initialize Google Map with DARK_MAP_STYLES
  useEffect(() => {
    let isCancelled = false;

    loadGoogleMaps()
      .then((googleMaps) => {
        if (isCancelled || !mapContainerRef.current) return;
        googleMapsRef.current = googleMaps;

        if (!mapRef.current) {
          const map = new googleMaps.Map(mapContainerRef.current, {
            center: MUMBAI_COORD,
            zoom: 11,
            styles: DARK_MAP_STYLES,
            backgroundColor: '#0d0f15',
            disableDefaultUI: false,
            zoomControl: true,
            zoomControlOptions: {
              position: googleMaps.ControlPosition.RIGHT_BOTTOM,
            },
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            scaleControl: true,
          });

          // Drone vector marker (arrow symbol with rotation)
          const droneMarker = new googleMaps.Marker({
            position: MUMBAI_COORD,
            map: map,
            icon: getQuadcopterSymbol(googleMaps, 0, isSimulating),
            title: 'AeroScale Drone (Autonomous Sentinel)',
            zIndex: 1000,
          });

          // Flight path polyline
          const flightPath = new googleMaps.Polyline({
            path: [MUMBAI_COORD],
            geodesic: true,
            strokeColor: '#38bdf8',
            strokeOpacity: 0.85,
            strokeWeight: 2.5,
            map: map,
          });

          mapRef.current = map;
          droneMarkerRef.current = droneMarker;
          flightPathRef.current = flightPath;
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setLoadError(err?.message || 'Failed to initialize Google Maps SDK');
        }
      });

    return () => {
      isCancelled = true;
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
      }
    };
  }, []);

  // 3. Render and Update Cloud Zone Circles and Badges on Map
  useEffect(() => {
    const map = mapRef.current;
    const googleMaps = googleMapsRef.current;
    if (!map || !googleMaps || cloudZones.length === 0) return;

    // Clear existing overlays
    zoneOverlaysRef.current.forEach((z) => {
      z.circle.setMap(null);
      z.marker.setMap(null);
    });
    zoneOverlaysRef.current = [];

    const infoWindow = new googleMaps.InfoWindow();

    cloudZones.forEach((zone) => {
      const isCurrentActive = activeZone?.id === zone.id;
      const isVisited = visitedZoneIds.includes(zone.id);

      // Color coding:
      // Active -> Amber glowing ring
      // Visited -> Emerald green verified ring
      // Pending -> Cyan atmospheric cloud deck ring
      const strokeColor = isCurrentActive ? '#fbbf24' : isVisited ? '#10b981' : '#38bdf8';
      const fillColor = isCurrentActive ? '#f59e0b' : isVisited ? '#10b981' : '#60a5fa';
      const fillOpacity = isCurrentActive ? 0.28 : isVisited ? 0.16 : 0.18;
      const strokeWeight = isCurrentActive ? 2.5 : 1.5;

      const circle = new googleMaps.Circle({
        strokeColor: strokeColor,
        strokeOpacity: 0.85,
        strokeWeight: strokeWeight,
        fillColor: fillColor,
        fillOpacity: fillOpacity,
        map: map,
        center: { lat: zone.lat, lng: zone.lng },
        radius: zone.radius,
        clickable: true,
      });

      // Label Marker at center of zone
      const labelMarker = new googleMaps.Marker({
        position: { lat: zone.lat, lng: zone.lng },
        map: map,
        icon: {
          path: googleMaps.SymbolPath.CIRCLE,
          scale: isCurrentActive ? 7 : 5,
          fillColor: strokeColor,
          fillOpacity: 1,
          strokeColor: '#0f172a',
          strokeWeight: 2,
        },
        title: zone.name,
      });

      const clickHandler = () => {
        const content = `
          <div style="font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px; padding: 6px 8px; background: #0c0f17; color: #f1f5f9; border-radius: 8px; min-width: 220px; border: 1px solid #1e293b;">
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1e293b; padding-bottom: 4px; margin-bottom: 6px;">
              <span style="font-weight: 700; color: ${strokeColor}; font-size: 11px;">${zone.name}</span>
              <span style="font-family: ui-monospace, monospace; font-size: 9px; padding: 2px 5px; border-radius: 4px; background: ${fillColor}33; color: ${strokeColor};">
                ${isCurrentActive ? 'ACTIVE TARGET' : isVisited ? 'SAMPLED' : 'CLOUD GAP'}
              </span>
            </div>
            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">
              Cloud Cover: <strong style="color: #f1f5f9;">${Math.round(zone.cloudCover * 100)}%</strong> · Radius: <strong style="color: #f1f5f9;">${(zone.radius / 1000).toFixed(1)} km</strong>
            </div>
            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">
              Imputed NO2: <strong style="color: #38bdf8;">${zone.imputedNO2 || 'Estimated'}</strong>
            </div>
            <p style="font-size: 9.5px; color: #64748b; margin: 0; line-height: 1.3;">
              ${zone.description || 'Persistent cloud-covered zone requiring autonomous drone inspection.'}
            </p>
          </div>
        `;
        infoWindow.setContent(content);
        infoWindow.open(map, labelMarker);
      };

      circle.addListener('click', clickHandler);
      labelMarker.addListener('click', clickHandler);

      zoneOverlaysRef.current.push({ circle, marker: labelMarker, id: zone.id });
    });

    return () => {
      zoneOverlaysRef.current.forEach((z) => {
        z.circle.setMap(null);
        z.marker.setMap(null);
      });
      zoneOverlaysRef.current = [];
    };
  }, [cloudZones, activeZone, visitedZoneIds]);

  // 4. Autonomous Navigation & Loitering Engine
  const findNearestUnvisited = useCallback(
    (curLat: number, curLng: number, zones: CloudZone[], visited: Set<string>): CloudZone | null => {
      let unvisited = zones.filter((z) => !visited.has(z.id));
      if (unvisited.length === 0) {
        if (zones.length === 0) return null;
        // Loop back after full patrol
        visited.clear();
        setVisitedZoneIds([]);
        unvisited = zones;
      }

      let best: CloudZone = unvisited[0];
      let minDist = Infinity;

      for (const z of unvisited) {
        const dLat = z.lat - curLat;
        const dLng = (z.lng - curLng) * Math.cos((curLat * Math.PI) / 180);
        const dist = Math.hypot(dLat, dLng);
        if (dist < minDist) {
          minDist = dist;
          best = z;
        }
      }
      return best;
    },
    []
  );

  useEffect(() => {
    if (!isSimulating) {
      // Reset simulation state
      setMissionPhase('IDLE');
      missionPhaseRef.current = 'IDLE';
      setActiveZone(null);
      activeZoneRef.current = null;
      setLoiterProgress(0);
      setVisitedZoneIds([]);
      visitedRef.current.clear();
      dronePosRef.current = MUMBAI_COORD;
      headingRef.current = 0;

      if (droneMarkerRef.current && googleMapsRef.current) {
        droneMarkerRef.current.setPosition(MUMBAI_COORD);
        droneMarkerRef.current.setIcon(
          getQuadcopterSymbol(googleMapsRef.current, 0, false)
        );
      }

      if (flightPathRef.current) {
        flightPathRef.current.setPath([MUMBAI_COORD]);
      }

      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      return;
    }

    const zones = cloudZonesRef.current;
    if (zones.length === 0) return;

    // Initialize first target zone: nearest to starting base
    const initialTarget = findNearestUnvisited(
      dronePosRef.current.lat,
      dronePosRef.current.lng,
      zones,
      visitedRef.current
    );

    if (initialTarget) {
      setActiveZone(initialTarget);
      activeZoneRef.current = initialTarget;
      setMissionPhase('TRANSIT');
      missionPhaseRef.current = 'TRANSIT';
    }

    let lastTimestamp = performance.now();
    let loiterStartAngle = 0;
    let loiterTraversedAngle = 0;
    const pathHistory: { lat: number; lng: number }[] = [dronePosRef.current];

    const runSimulationLoop = (currentTimestamp: number) => {
      const dt = Math.min((currentTimestamp - lastTimestamp) / 1000, 0.1);
      lastTimestamp = currentTimestamp;

      const currentActive = activeZoneRef.current;
      const currentSpeedMultiplier = speedRef.current;
      const curPos = dronePosRef.current;

      if (currentActive) {
        // --- PHASE 1: TRANSIT TO CLOUD ZONE ---
        if (missionPhaseRef.current === 'TRANSIT') {
          const dLat = currentActive.lat - curPos.lat;
          const dLng = (currentActive.lng - curPos.lng) * Math.cos((curPos.lat * Math.PI) / 180);
          const distMeters = Math.hypot(dLat, dLng) * 111000;

          // Desired heading (degrees from North)
          const bearingRad = Math.atan2(
            currentActive.lng - curPos.lng,
            currentActive.lat - curPos.lat
          );
          const bearingDeg = ((bearingRad * 180) / Math.PI + 360) % 360;
          headingRef.current = bearingDeg;

          // Transit speed: ~600 m/s scaled by speed selector
          const transitStepMeters = 550 * currentSpeedMultiplier * dt;

          // Boundary of loitering orbit (~60% of zone radius)
          const loiterOrbitRadiusMeters = Math.max(currentActive.radius * 0.55, 1500);

          if (distMeters > loiterOrbitRadiusMeters) {
            const ratio = transitStepMeters / distMeters;
            const nextLat = curPos.lat + (currentActive.lat - curPos.lat) * ratio;
            const nextLng = curPos.lng + (currentActive.lng - curPos.lng) * ratio;
            dronePosRef.current = { lat: nextLat, lng: nextLng };

            // Baseline sensor value during transit
            setCurrentSensorNO2(36 + Math.sin(currentTimestamp / 800) * 3);
          } else {
            // Reached loiter perimeter! Switch to LOITER
            missionPhaseRef.current = 'LOITER';
            setMissionPhase('LOITER');

            // Entry angle from zone center
            loiterStartAngle = Math.atan2(
              curPos.lat - currentActive.lat,
              (curPos.lng - currentActive.lng) * Math.cos((currentActive.lat * Math.PI) / 180)
            );
            loiterTraversedAngle = 0;
            setLoiterProgress(0);
          }
        }

        // --- PHASE 2: LOITER WITHIN ZONE (FULL 360° ROUND) ---
        else if (missionPhaseRef.current === 'LOITER') {
          const loiterOrbitRadiusMeters = Math.max(currentActive.radius * 0.55, 1500);
          const radiusLatDeg = loiterOrbitRadiusMeters / 111000;
          const radiusLngDeg = radiusLatDeg / Math.cos((currentActive.lat * Math.PI) / 180);

          // Angular velocity: 1 full 360° round in ~12 seconds at 1x
          const angularSpeed = ((2 * Math.PI) / 12) * currentSpeedMultiplier;
          loiterTraversedAngle += angularSpeed * dt;

          const currentAngle = loiterStartAngle + loiterTraversedAngle;
          const nextLat = currentActive.lat + radiusLatDeg * Math.sin(currentAngle);
          const nextLng = currentActive.lng + radiusLngDeg * Math.cos(currentAngle);

          dronePosRef.current = { lat: nextLat, lng: nextLng };

          // Tangent heading along the circular orbit
          const tangentHeadingRad = currentAngle + Math.PI / 2;
          headingRef.current = ((tangentHeadingRad * 180) / Math.PI + 360) % 360;

          // Progress calculation: 0 -> 100%
          const pct = Math.min(100, Math.round((loiterTraversedAngle / (2 * Math.PI)) * 100));
          setLoiterProgress(pct);

          // Elevated NO2 sensor value inside cloud gap
          const baseImputed = currentActive.cloudCover * 65;
          setCurrentSensorNO2(baseImputed + Math.sin(loiterTraversedAngle * 3) * 6);

          // Check if full round completed!
          if (loiterTraversedAngle >= 2 * Math.PI) {
            // Mark completed
            visitedRef.current.add(currentActive.id);
            setVisitedZoneIds(Array.from(visitedRef.current));

            // Select next nearest unvisited zone
            const nextTarget = findNearestUnvisited(
              dronePosRef.current.lat,
              dronePosRef.current.lng,
              cloudZonesRef.current,
              visitedRef.current
            );

            if (nextTarget) {
              setActiveZone(nextTarget);
              activeZoneRef.current = nextTarget;
              missionPhaseRef.current = 'TRANSIT';
              setMissionPhase('TRANSIT');
              setLoiterProgress(0);
            }
          }
        }
      }

      // Update Drone Marker on Map
      if (droneMarkerRef.current && googleMapsRef.current) {
        droneMarkerRef.current.setPosition(dronePosRef.current);
        droneMarkerRef.current.setIcon(
          getQuadcopterSymbol(googleMapsRef.current, headingRef.current, true)
        );
      }

      // Record path history (capped for memory efficiency)
      pathHistory.push({ ...dronePosRef.current });
      if (pathHistory.length > 500) {
        pathHistory.splice(0, pathHistory.length - 500);
      }

      if (flightPathRef.current) {
        flightPathRef.current.setPath(pathHistory);
      }

      animRef.current = requestAnimationFrame(runSimulationLoop);
    };

    animRef.current = requestAnimationFrame(runSimulationLoop);

    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    };
  }, [isSimulating, findNearestUnvisited]);

  return (
    <div className="relative w-full h-full bg-[#0d0f15]">
      {/* Google Map Container */}
      <div ref={mapContainerRef} className="absolute inset-0 z-0 w-full h-full" />

      {loadError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0d0f15]/90 text-rose-400 p-4 text-center">
          <ShieldAlert className="w-8 h-8 text-rose-500 mb-2" />
          <p className="text-sm font-semibold mb-1">Failed to initialize Google Maps</p>
          <p className="text-xs text-zinc-500 max-w-sm">{loadError}</p>
        </div>
      )}

      {/* TOP-LEFT: Autonomous Cloud Mission Telemetry HUD */}
      <div className="absolute top-4 left-4 z-[40] max-w-sm pointer-events-auto">
        <div className="bg-[#0b0e14]/85 backdrop-blur-md border border-white/10 p-3.5 rounded-xl text-xs font-mono shadow-2xl space-y-2.5">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Radio
                className={`w-4 h-4 ${
                  isSimulating ? 'text-emerald-400 animate-pulse' : 'text-zinc-500'
                }`}
              />
              <span className="font-semibold text-white tracking-wide uppercase text-[10px]">
                Autonomous Sentinel Link
              </span>
            </div>
            <span
              className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                missionPhase === 'LOITER'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : missionPhase === 'TRANSIT'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                  : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {missionPhase === 'LOITER'
                ? 'Loitering & Sampling'
                : missionPhase === 'TRANSIT'
                ? 'En Route Transit'
                : 'Standby'}
            </span>
          </div>

          {activeZone ? (
            <div className="space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-zinc-400 text-[10px]">Target Cloud Zone:</span>
                <span className="text-white font-medium text-right text-[11px] text-blue-300 truncate max-w-[170px]">
                  {activeZone.name}
                </span>
              </div>

              {missionPhase === 'LOITER' && (
                <div>
                  <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                    <span>Loiter Orbit Round:</span>
                    <span className="text-amber-400 font-bold">{loiterProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden border border-white/10">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-all duration-100"
                      style={{ width: `${loiterProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-[10px] pt-1">
                <span className="text-zinc-400">Onboard DCP / In-Situ NO₂:</span>
                <span className="font-bold text-emerald-400 font-mono">
                  {currentSensorNO2.toFixed(1)} µg/m³
                </span>
              </div>
            </div>
          ) : (
            <p className="text-zinc-500 text-[11px]">
              {isSimulating
                ? 'Detecting nearest cloud-gap vector...'
                : 'Connect Flight Controller to begin cloud-gap patrol.'}
            </p>
          )}

          {/* Zones Visited Pill Summary */}
          <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Cloud className="w-3.5 h-3.5 text-blue-400" />
              Zones Patrol:
            </span>
            <span className="font-medium text-white">
              {visitedZoneIds.length} / {cloudZones.length} Sampled
            </span>
          </div>
        </div>
      </div>

      {/* BOTTOM-RIGHT: Sim Speed & RC Sliders */}
      <div className="absolute bottom-4 right-4 z-[40] flex gap-4 items-end pointer-events-auto">
        <div className="bg-[#0b0e14]/85 backdrop-blur-md border border-white/10 p-2.5 rounded-xl text-xs font-mono shadow-2xl">
          <div className="text-white/50 mb-1 uppercase tracking-widest text-[9px] font-semibold">
            Sim Speed
          </div>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="bg-zinc-900 border border-white/10 text-white rounded px-2 py-1 outline-none text-xs font-mono cursor-pointer"
          >
            <option value={1}>1x Real-Time</option>
            <option value={2}>2x Speed</option>
            <option value={5}>5x Fast Patrol</option>
            <option value={10}>10x Hyper</option>
          </select>
        </div>

        <RcSliders isSimulating={isSimulating} />
      </div>
    </div>
  );
}
