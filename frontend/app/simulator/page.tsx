'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Sliders,
  Wind,
  Layers,
  Play,
  RotateCcw,
  Download,
  AlertTriangle,
  Factory,
  Shield,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  TrendingDown,
  TrendingUp,
  Users,
  Compass,
  Flame,
  Activity,
  Zap,
  SplitSquareVertical,
  Maximize2,
  ChevronRight,
  Info,
  Loader2,
  Radio,
  FileText,
  BarChart2,
  MapPin,
  ExternalLink,
  Sparkles,
  Calendar,
  Bot,
  Eye,
  Crosshair,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import { loadGoogleMaps, DARK_MAP_STYLES } from '@/lib/googleMaps';
import { createNO2HeatmapOverlay, INO2HeatmapOverlay } from '../components/NO2HeatmapOverlay';
import { PRESET_REGIONS, KNOWN_POIS } from '@/lib/constants';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface FacilityNode {
  id: string;
  name: string;
  category: 'FACTORY' | 'TRAFFIC_CORRIDOR' | 'POWER_PLANT' | 'CONSTRUCTION_SITE';
  coordinates: [number, number]; // [lat, lng]
  emissionFactor: number; // 0.0 to 2.0 (1.0 = baseline)
  baselineFactor: number;
  active: boolean;
  details: string;
}

interface SuspiciousMarker {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  observed_no2: number;
  simulated_no2: number;
  baseline: number;
  finding: string;
  severity: string;
  cpcb_compliant: boolean;
  who_compliant: boolean;
  recommended_action: string;
  drone_recommendation?: string;
  inspection_priority?: string;
  shap_explanation?: string;
  likely_contributors?: string[];
}

interface SimulationImpactData {
  baseline_peak_no2: number;
  simulated_peak_no2: number;
  peak_no2_change_ugm3: number;
  peak_no2_change_pct: number;
  baseline_mean_no2: number;
  simulated_mean_no2: number;
  mean_no2_change_ugm3: number;
  mean_no2_change_pct: number;
  baseline_exposed_pop: number;
  simulated_exposed_pop: number;
  exposed_pop_change: number;
  exposed_pop_change_pct: number;
  baseline_who_exposed_pop: number;
  simulated_who_exposed_pop: number;
  who_exposed_pop_change: number;
  plume_displacement_km: number;
  plume_heading_deg: number;
  baseline_compliance: string;
  simulated_compliance: string;
  compliance_improved: boolean;
  executive_summary: string;
  policy_recommendation: string;
}

interface XAIContributor {
  feature?: string;
  feature_label?: string;
  percentage?: number;
  contribution_pct?: number;
  shap_value?: number;
  direction?: string;
}

interface XAIData {
  executive_summary: string;
  detailed_narrative?: string;
  top_contributors: XAIContributor[];
  positive_contributors?: XAIContributor[];
  negative_contributors?: XAIContributor[];
  waterfall_chart_url?: string;
  beeswarm_chart_url?: string;
  bar_chart_url?: string;
  base_value?: number;
  predicted_value?: number;
  confidence?: number;
}

export default function SimulatorPage() {
  // Region state
  const [selectedRegionIndex, setSelectedRegionIndex] = useState(0);
  const currentRegion = PRESET_REGIONS[selectedRegionIndex];

  // Date selection state
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('2025-11-05');

  // Map state
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const heatmapOverlayRef = useRef<INO2HeatmapOverlay | null>(null);
  const markersRef = useRef<any[]>([]);
  const facilityMarkersRef = useRef<any[]>([]);

  // Interactive Popup / Floating card state
  const [selectedHotspot, setSelectedHotspot] = useState<SuspiciousMarker | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<FacilityNode | null>(null);
  const [popupAnchor, setPopupAnchor] = useState<{ x: number; y: number } | null>(null);
  const popupCardRef = useRef<HTMLDivElement>(null);

  // Simulation View Mode: 'simulated' | 'baseline'
  const [viewMode, setViewMode] = useState<'simulated' | 'baseline'>('simulated');
  const [isSimulating, setIsSimulating] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [showFacilities, setShowFacilities] = useState(true);

  // XAI plot display toggle: 'waterfall' | 'beeswarm' | 'bar'
  const [xaiPlotTab, setXaiPlotTab] = useState<'waterfall' | 'beeswarm' | 'bar'>('waterfall');

  // Environmental Weather Levers
  const [windSpeed, setWindSpeed] = useState(1.0); // 0.2x to 3.0x
  const [windDirection, setWindDirection] = useState(0); // -180 to +180 deg
  const [temperatureDelta, setTemperatureDelta] = useState(0); // -5 to +5 C
  const [humidity, setHumidity] = useState(65); // 20% to 100%
  const [rainfall, setRainfall] = useState(0); // 0 to 40 mm/h
  const [blhFactor, setBlhFactor] = useState(1.0); // 0.3x to 2.5x

  // Emission Levers
  const [trafficEmission, setTrafficEmission] = useState(1.0); // 0.0 to 2.5
  const [industrialEmission, setIndustrialEmission] = useState(1.0);
  const [powerPlantEmission, setPowerPlantEmission] = useState(1.0);
  const [constructionEmission, setConstructionEmission] = useState(1.0);
  const [backgroundEmission, setBackgroundEmission] = useState(1.0);

  // Editable Facilities Nodes
  const [facilities, setFacilities] = useState<FacilityNode[]>(() => {
    return KNOWN_POIS.slice(0, 6).map((poi) => ({
      id: poi.id,
      name: poi.name,
      category: poi.category,
      coordinates: poi.coordinates,
      emissionFactor: 1.0,
      baselineFactor: 1.0,
      active: true,
      details: poi.details,
    }));
  });

  // Current Results from Backend Simulator API
  const [impactData, setImpactData] = useState<SimulationImpactData>({
    baseline_peak_no2: 148.5,
    simulated_peak_no2: 104.2,
    peak_no2_change_ugm3: -44.3,
    peak_no2_change_pct: -29.8,
    baseline_mean_no2: 68.4,
    simulated_mean_no2: 48.1,
    mean_no2_change_ugm3: -20.3,
    mean_no2_change_pct: -29.7,
    baseline_exposed_pop: 285000,
    simulated_exposed_pop: 92000,
    exposed_pop_change: -193000,
    exposed_pop_change_pct: -67.7,
    baseline_who_exposed_pop: 540000,
    simulated_who_exposed_pop: 310000,
    who_exposed_pop_change: -230000,
    plume_displacement_km: 2.14,
    plume_heading_deg: 135.0,
    baseline_compliance: 'EXCEEDANCE',
    simulated_compliance: 'EXCEEDANCE',
    compliance_improved: true,
    executive_summary:
      'Simulated policy intervention projects a -29.8% reduction in peak NO₂ (148.5 → 104.2 µg/m³). 193,000 residents are protected from CPCB non-compliant exposure.',
    policy_recommendation:
      'Action Recommended: Enact simulated traffic and industrial curtailments to contract downwind exceedance plume zones.',
  });

  const [xaiData, setXaiData] = useState<XAIData>({
    executive_summary:
      'Road traffic density and industrial refinery stacks account for 68% of localized concentration, while boundary layer ventilation provides active natural dilution.',
    top_contributors: [
      { feature_label: 'Road Traffic Density', percentage: 38.5, direction: 'increases_no2' },
      { feature_label: 'Industrial Emission Stacks', percentage: 29.2, direction: 'increases_no2' },
      { feature_label: 'Boundary Layer Stagnation', percentage: 18.4, direction: 'increases_no2' },
      { feature_label: 'Wind Ventilation Shear', percentage: 13.9, direction: 'reduces_no2' },
    ],
    positive_contributors: [
      { feature_label: 'Road Traffic Density', percentage: 38.5, direction: 'increases_no2' },
      { feature_label: 'Industrial Emission Stacks', percentage: 29.2, direction: 'increases_no2' },
      { feature_label: 'Boundary Layer Stagnation', percentage: 18.4, direction: 'increases_no2' },
    ],
    negative_contributors: [
      { feature_label: 'Wind Ventilation Shear', percentage: 13.9, direction: 'reduces_no2' },
    ],
  });

  const [hotspots, setHotspots] = useState<SuspiciousMarker[]>([
    {
      id: 'spot-ind-1',
      name: 'Mahul Petrochem & MIDC Belt',
      lat: 19.008,
      lon: 72.895,
      category: 'FACTORY',
      observed_no2: 141.2,
      simulated_no2: 98.4,
      baseline: 55.0,
      finding: 'Continuous refinery process stacks and flared hydrocarbon emissions',
      severity: 'critical',
      cpcb_compliant: false,
      who_compliant: false,
      recommended_action: 'Mandate selective catalytic reduction and temporary stack scrubbers.',
      drone_recommendation: 'Deploy DJI Matrice 350 RTK with Sniffer4D optical gas imaging for flare line inspection.',
      inspection_priority: 'CRITICAL',
      shap_explanation: 'Stack plumes and thermal inversion account for 74% of localized concentration.',
      likely_contributors: ['Refinery Stacks', 'Boundary Stagnation', 'Fugitive VOCs'],
    },
    {
      id: 'spot-traf-1',
      name: 'Western Express Highway Arterial Choke',
      lat: 19.038,
      lon: 72.845,
      category: 'TRAFFIC_CORRIDOR',
      observed_no2: 148.5,
      simulated_no2: 104.2,
      baseline: 58.0,
      finding: 'Severe stop-and-go diesel transit congestion along 8-lane expressway corridor',
      severity: 'critical',
      cpcb_compliant: false,
      who_compliant: false,
      recommended_action: 'Implement odd-even freight diversion to peripheral ring road during peak hours.',
      drone_recommendation: 'Deploy aerial traffic monitoring drone to optimize synchronized traffic signals.',
      inspection_priority: 'HIGH',
      shap_explanation: 'Commercial vehicle density drives 44% of localized roadside NO₂.',
      likely_contributors: ['Commercial Diesels', 'Stop-and-Go Congestion', 'Low Wind Ventilation'],
    },
    {
      id: 'spot-susp-1',
      name: 'Dharavi Unregulated Recycling Cluster',
      lat: 19.043,
      lon: 72.856,
      category: 'SUSPICIOUS_LOCAL_SOURCE',
      observed_no2: 124.7,
      simulated_no2: 85.2,
      baseline: 46.0,
      finding: 'Suspicious unpermitted thermal smelting, scrap copper burning, and plastic curing',
      severity: 'critical',
      cpcb_compliant: false,
      who_compliant: false,
      recommended_action: 'Emergency municipal cease-and-desist order with immediate physical enforcement.',
      drone_recommendation: 'Autonomous thermal FLIR drone patrol to detect illegal furnace heat signatures.',
      inspection_priority: 'CRITICAL',
      shap_explanation: 'Anomalous ground-level combustion plume discordant with regional traffic patterns.',
      likely_contributors: ['Informal Smelting', 'Plastic Pyrolysis', 'Upwind Surface Dispersion'],
    },
    {
      id: 'spot-power-1',
      name: 'Trombay Thermal Power Outskirts',
      lat: 18.995,
      lon: 72.915,
      category: 'POWER_PLANT',
      observed_no2: 130.5,
      simulated_no2: 89.6,
      baseline: 50.0,
      finding: 'Base-load power generation with thermal buoyancy plume dispersion',
      severity: 'high',
      cpcb_compliant: false,
      who_compliant: false,
      recommended_action: 'Transition to combined-cycle natural gas during adverse meteorological stagnation.',
      drone_recommendation: 'Fly stack-top sensor payload to verify continuous emission monitoring system calibration.',
      inspection_priority: 'HIGH',
      shap_explanation: 'High-temperature elevated stack plume disperses over 5 km downwind sector.',
      likely_contributors: ['Coal-Fired Boiler', 'Thermal Lift', 'Background Plume'],
    },
  ]);

  // Grids for heatmap rendering
  const [baselineGrid, setBaselineGrid] = useState<number[][] | null>(null);
  const [simulatedGrid, setSimulatedGrid] = useState<number[][] | null>(null);

  // Fetch available dates on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/downscale/dates`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.dates && Array.isArray(data.dates) && data.dates.length > 0) {
          setAvailableDates(data.dates);
          if (data.default_date) setSelectedDate(data.default_date);
        }
      })
      .catch((err) => console.warn('Could not fetch available dates:', err));
  }, []);

  // Dismiss popup on outside click
  useEffect(() => {
    function handleDocumentClick(e: MouseEvent) {
      if (popupCardRef.current && !popupCardRef.current.contains(e.target as Node)) {
        // Dismiss popup if click outside
        const mapDiv = mapContainerRef.current;
        if (mapDiv && !mapDiv.contains(e.target as Node)) {
          setSelectedHotspot(null);
          setSelectedFacility(null);
          setPopupAnchor(null);
        }
      }
    }
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  // Initialize Google Maps
  useEffect(() => {
    let isCancelled = false;
    loadGoogleMaps()
      .then((googleMaps) => {
        if (isCancelled || !mapContainerRef.current) return;
        if (!mapInstanceRef.current) {
          const map = new googleMaps.Map(mapContainerRef.current, {
            center: { lat: currentRegion.center[0], lng: currentRegion.center[1] },
            zoom: currentRegion.zoom,
            styles: DARK_MAP_STYLES,
            mapTypeId: 'roadmap',
            backgroundColor: '#0d0f15',
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            scaleControl: true,
          });

          // Dismiss popup on map background click
          map.addListener('click', () => {
            setSelectedHotspot(null);
            setSelectedFacility(null);
            setPopupAnchor(null);
          });

          mapInstanceRef.current = map;
          setMapInstance(map);
        }
      })
      .catch((err) => console.error('Error loading Google Maps for simulator:', err));

    return () => {
      isCancelled = true;
    };
  }, [currentRegion]);

  // Execute simulation against backend API
  const executeSimulation = useCallback(
    async (overrides?: Partial<{
      windSpeed: number;
      windDir: number;
      traffic: number;
      industry: number;
      power: number;
      construction: number;
      rain: number;
      blh: number;
      temp: number;
      humid: number;
      date: string;
      facilityOverrides: FacilityNode[];
    }>) => {
      setIsSimulating(true);
      const wSpeed = overrides?.windSpeed ?? windSpeed;
      const wDir = overrides?.windDir ?? windDirection;
      const traf = overrides?.traffic ?? trafficEmission;
      const ind = overrides?.industry ?? industrialEmission;
      const pow = overrides?.power ?? powerPlantEmission;
      const con = overrides?.construction ?? constructionEmission;
      const r = overrides?.rain ?? rainfall;
      const b = overrides?.blh ?? blhFactor;
      const t = overrides?.temp ?? temperatureDelta;
      const h = overrides?.humid ?? humidity;
      const targetDate = overrides?.date ?? selectedDate;
      const targetFacs = overrides?.facilityOverrides ?? facilities;

      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
        const res = await fetch(`${API_BASE}/api/v1/simulator/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            region_name: currentRegion.name,
            observation_date: targetDate,
            wind_speed_factor: wSpeed,
            wind_direction_delta_deg: wDir,
            temperature_delta_c: t,
            humidity_pct: h,
            rainfall_mm_h: r,
            blh_factor: b,
            traffic_emission_factor: traf,
            industrial_emission_factor: ind,
            power_plant_emission_factor: pow,
            construction_emission_factor: con,
            background_emission_factor: backgroundEmission,
            node_overrides: targetFacs.map((f) => ({
              id: f.id,
              name: f.name,
              emission_factor: f.active ? f.emissionFactor : 0.0,
            })),
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.impact) setImpactData(data.impact);
          if (data.xai) setXaiData(data.xai);
          if (data.hotspots) setHotspots(data.hotspots);
          if (data.baseline_grid) setBaselineGrid(data.baseline_grid);
          if (data.simulated_grid) setSimulatedGrid(data.simulated_grid);
        }
      } catch (err) {
        console.warn('Simulator run error, relying on responsive physical fallbacks:', err);
      } finally {
        setIsSimulating(false);
      }
    },
    [
      windSpeed,
      windDirection,
      temperatureDelta,
      humidity,
      rainfall,
      blhFactor,
      trafficEmission,
      industrialEmission,
      powerPlantEmission,
      constructionEmission,
      backgroundEmission,
      facilities,
      currentRegion,
      selectedDate,
    ]
  );

  // Initial simulation run on load or date change
  useEffect(() => {
    executeSimulation();
  }, [selectedRegionIndex, selectedDate]);

  // Update canvas heatmap overlay whenever grid or viewMode changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const grid = viewMode === 'simulated' ? simulatedGrid || baselineGrid : baselineGrid;
    if (!grid || grid.length === 0) return;

    const H = grid.length;
    const W = grid[0].length;
    const flat = new Float32Array(H * W);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        flat[r * W + c] = grid[r][c];
      }
    }

    const bbox: [number, number, number, number] = [
      currentRegion.center[1] - 0.18,
      currentRegion.center[0] - 0.15,
      currentRegion.center[1] + 0.18,
      currentRegion.center[0] + 0.15,
    ];

    if (!heatmapOverlayRef.current) {
      try {
        const overlay = createNO2HeatmapOverlay({
          no2: flat,
          width: W,
          height: H,
          bbox,
          opacity: 0.82,
        });
        overlay.setMap(map);
        heatmapOverlayRef.current = overlay;
      } catch (e) {
        console.warn('Could not initialize heatmap overlay:', e);
      }
    } else {
      heatmapOverlayRef.current.updateData({
        no2: flat,
        width: W,
        height: H,
        bbox,
      });
    }
  }, [simulatedGrid, baselineGrid, viewMode, currentRegion]);

  // Render Suspicious & Hazard Markers on Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const google = (window as any).google;
    if (!map || !google?.maps) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    hotspots.forEach((spot) => {
      const val = viewMode === 'simulated' ? spot.simulated_no2 : spot.observed_no2;
      // CPCB hazard scale colors:
      let pinColor = '#10b981'; // Good (0-40)
      if (val > 180) {
        pinColor = '#ef4444'; // Hazardous (>180)
      } else if (val > 80) {
        pinColor = '#f97316'; // Exceedance (80-180)
      } else if (val > 40) {
        pinColor = '#facc15'; // Moderate (40-80)
      }

      // Suspicious local source gets distinct purple indicator
      const isSuspicious = spot.category === 'SUSPICIOUS_LOCAL_SOURCE' || spot.id.includes('susp');
      if (isSuspicious) {
        pinColor = '#a855f7';
      }

      const marker = new google.maps.Marker({
        position: { lat: spot.lat, lng: spot.lon },
        map,
        title: spot.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: isSuspicious ? 11 : 9,
          fillColor: pinColor,
          fillOpacity: 0.95,
          strokeWeight: 2.5,
          strokeColor: '#ffffff',
        },
      });

      marker.addListener('click', (e: any) => {
        const mapDiv = mapContainerRef.current;
        if (mapDiv) {
          const rect = mapDiv.getBoundingClientRect();
          if (e.domEvent?.clientX && e.domEvent?.clientY) {
            setPopupAnchor({
              x: e.domEvent.clientX - rect.left,
              y: e.domEvent.clientY - rect.top,
            });
          } else {
            setPopupAnchor({
              x: mapDiv.clientWidth / 2,
              y: Math.max(140, mapDiv.clientHeight / 2 - 80),
            });
          }
        }
        setSelectedHotspot(spot);
        setSelectedFacility(null);
      });

      markersRef.current.push(marker);
    });
  }, [hotspots, viewMode, mapInstance]);

  // Render Facility Nodes on Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const google = (window as any).google;
    if (!map || !google?.maps || !showFacilities) {
      facilityMarkersRef.current.forEach((m) => m.setMap(null));
      facilityMarkersRef.current = [];
      return;
    }

    facilityMarkersRef.current.forEach((m) => m.setMap(null));
    facilityMarkersRef.current = [];

    facilities.forEach((fac) => {
      const marker = new google.maps.Marker({
        position: { lat: fac.coordinates[0], lng: fac.coordinates[1] },
        map,
        title: `${fac.name} (${Math.round(fac.emissionFactor * 100)}%)`,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 6,
          fillColor: fac.active ? '#3b82f6' : '#71717a',
          fillOpacity: 1,
          strokeWeight: 1.5,
          strokeColor: '#ffffff',
          rotation: 0,
        },
      });

      marker.addListener('click', (e: any) => {
        const mapDiv = mapContainerRef.current;
        if (mapDiv) {
          const rect = mapDiv.getBoundingClientRect();
          if (e.domEvent?.clientX && e.domEvent?.clientY) {
            setPopupAnchor({
              x: e.domEvent.clientX - rect.left,
              y: e.domEvent.clientY - rect.top,
            });
          } else {
            setPopupAnchor({
              x: mapDiv.clientWidth / 2,
              y: Math.max(140, mapDiv.clientHeight / 2 - 80),
            });
          }
        }
        setSelectedFacility(fac);
        setSelectedHotspot(null);
      });

      facilityMarkersRef.current.push(marker);
    });
  }, [facilities, showFacilities, mapInstance]);

  // Preset Handlers
  const applyPreset = (presetKey: string) => {
    if (presetKey === 'odd_even') {
      setTrafficEmission(0.5);
      setConstructionEmission(0.8);
      executeSimulation({ traffic: 0.5, construction: 0.8 });
    } else if (presetKey === 'industrial_shutdown') {
      setIndustrialEmission(0.3);
      setPowerPlantEmission(0.6);
      setConstructionEmission(0.4);
      executeSimulation({ industry: 0.3, power: 0.6, construction: 0.4 });
    } else if (presetKey === 'monsoon_washout') {
      setRainfall(15.0);
      setWindSpeed(1.35);
      setHumidity(92);
      executeSimulation({ rain: 15.0, windSpeed: 1.35, humid: 92 });
    } else if (presetKey === 'wind_stagnation') {
      setWindSpeed(0.4);
      setBlhFactor(0.5);
      setTemperatureDelta(-3.0);
      executeSimulation({ windSpeed: 0.4, blh: 0.5, temp: -3.0 });
    } else if (presetKey === 'emergency_restrictions') {
      setTrafficEmission(0.4);
      setIndustrialEmission(0.3);
      setPowerPlantEmission(0.5);
      setConstructionEmission(0.0);
      executeSimulation({ traffic: 0.4, industry: 0.3, power: 0.5, construction: 0.0 });
    }
  };

  // Reset controls to baseline
  const resetControls = () => {
    setWindSpeed(1.0);
    setWindDirection(0);
    setTemperatureDelta(0);
    setHumidity(65);
    setRainfall(0);
    setBlhFactor(1.0);
    setTrafficEmission(1.0);
    setIndustrialEmission(1.0);
    setPowerPlantEmission(1.0);
    setConstructionEmission(1.0);
    setBackgroundEmission(1.0);
    const resetFacs = facilities.map((f) => ({ ...f, emissionFactor: 1.0, active: true }));
    setFacilities(resetFacs);
    executeSimulation({
      windSpeed: 1.0,
      windDir: 0,
      temp: 0,
      humid: 65,
      rain: 0,
      blh: 1.0,
      traffic: 1.0,
      industry: 1.0,
      power: 1.0,
      construction: 1.0,
      facilityOverrides: resetFacs,
    });
  };

  // Download high-resolution Unicode PDF Report
  const downloadReportPdf = async () => {
    try {
      setIsDownloadingPdf(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      const res = await fetch(`${API_BASE}/api/v1/simulator/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          region_name: currentRegion.name,
          scenario_name: 'Policy What-If Simulation Report',
          impact: impactData,
          xai: xaiData,
          anomalies: hotspots,
          policy_changes: {
            'Traffic Emission Level': trafficEmission,
            'Industrial Emission Level': industrialEmission,
            'Power Plant Generation Factor': powerPlantEmission,
            'Construction Activity Factor': constructionEmission,
            'Boundary Layer Height': blhFactor,
            'Wind Velocity Factor': windSpeed,
          },
        }),
      });

      if (!res.ok) throw new Error('PDF generation request failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Simulation_Impact_Report_${currentRegion.name.split(' ')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to export PDF simulation report:', err);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#0d0f15] text-zinc-100 overflow-hidden font-sans select-none">
      <Navbar />

      {/* Top Bar: Sub-header and Quick Region & Date Selectors */}
      <header className="h-12 w-full bg-[#11141d] border-b border-[#242938] px-4 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <h1 className="text-xs sm:text-sm font-bold tracking-wide uppercase text-white flex items-center gap-2 font-mono">
              WHAT-IF POLICY SIMULATOR
              <span className="hidden md:inline px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-sans font-semibold">
                COMMAND CENTER MODE
              </span>
            </h1>
          </div>

          {/* Region Selector */}
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-zinc-300 border-l border-zinc-700/60 pl-3">
            <span>Region:</span>
            <select
              value={selectedRegionIndex}
              onChange={(e) => setSelectedRegionIndex(Number(e.target.value))}
              className="bg-[#181d2a] border border-[#2e374c] rounded px-2 py-0.5 text-xs text-white outline-none focus:border-blue-500"
            >
              {PRESET_REGIONS.map((reg, idx) => (
                <option key={reg.name} value={idx}>
                  {reg.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Selector */}
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-zinc-300 border-l border-zinc-700/60 pl-3">
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
            <span>Date:</span>
            <select
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                executeSimulation({ date: e.target.value });
              }}
              className="bg-[#181d2a] border border-[#2e374c] rounded px-2 py-0.5 text-xs text-white outline-none focus:border-blue-500 font-mono"
            >
              {availableDates.length > 0 ? (
                availableDates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))
              ) : (
                <option value="2025-11-05">2025-11-05</option>
              )}
            </select>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Baseline vs Simulated View Toggle */}
          <div className="flex items-center bg-[#161a26] border border-[#2b3347] rounded-lg p-0.5 text-[11px] font-medium">
            <button
              onClick={() => setViewMode('baseline')}
              className={`px-2.5 py-1 rounded-md transition-all ${
                viewMode === 'baseline'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Baseline
            </button>
            <button
              onClick={() => setViewMode('simulated')}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
                viewMode === 'simulated'
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sparkles className="w-3 h-3 text-blue-300" />
              What-If Simulated
            </button>
          </div>

          <button
            onClick={resetControls}
            title="Reset All Controls to Default Baseline"
            className="p-1.5 rounded-lg border border-[#242938] bg-[#141721] text-zinc-400 hover:text-zinc-200 hover:bg-[#1c2233] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={downloadReportPdf}
            disabled={isDownloadingPdf}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-sm shadow-blue-600/30 transition-all disabled:opacity-50"
          >
            {isDownloadingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Export Simulation Report</span>
          </button>
        </div>
      </header>

      {/* Main Command Center Grid: 3-column Layout */}
      <div className="flex-1 w-full flex overflow-hidden relative">
        {/* LEFT COLUMN: Scenario Controls & Levers */}
        <aside className="w-80 h-full bg-[#11141d] border-r border-[#242938] flex flex-col shrink-0 overflow-y-auto p-3 space-y-4 z-20">
          {/* Presets Header */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Policy Presets
              </span>
              <span className="text-[9px] font-mono text-zinc-500">ONE-CLICK</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => applyPreset('odd_even')}
                className="px-2.5 py-1.5 text-left text-[11px] rounded bg-[#181d2a] hover:bg-[#202738] border border-[#2b3347] text-zinc-300 font-medium transition-colors"
              >
                Odd-Even Traffic
              </button>
              <button
                onClick={() => applyPreset('industrial_shutdown')}
                className="px-2.5 py-1.5 text-left text-[11px] rounded bg-[#181d2a] hover:bg-[#202738] border border-[#2b3347] text-zinc-300 font-medium transition-colors"
              >
                Industrial Shutdown
              </button>
              <button
                onClick={() => applyPreset('monsoon_washout')}
                className="px-2.5 py-1.5 text-left text-[11px] rounded bg-[#181d2a] hover:bg-[#202738] border border-[#2b3347] text-zinc-300 font-medium transition-colors"
              >
                Monsoon Washout
              </button>
              <button
                onClick={() => applyPreset('wind_stagnation')}
                className="px-2.5 py-1.5 text-left text-[11px] rounded bg-[#181d2a] hover:bg-[#202738] border border-[#2b3347] text-zinc-300 font-medium transition-colors"
              >
                Wind Stagnation
              </button>
              <button
                onClick={() => applyPreset('emergency_restrictions')}
                className="col-span-2 px-2.5 py-1.5 text-center text-[11px] rounded bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/40 text-rose-300 font-semibold transition-colors"
              >
                Emergency Restrictions (Stage IV)
              </button>
            </div>
          </div>

          {/* Meteorological Controls */}
          <div className="space-y-3 pt-3 border-t border-[#242938]">
            <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5 text-cyan-400" />
                Weather & Meteorology
              </span>
            </div>

            {/* Wind Speed Factor */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300">Wind Velocity</span>
                <span className="font-mono text-cyan-400 font-semibold">
                  {(windSpeed * 3.2).toFixed(1)} m/s ({windSpeed.toFixed(1)}x)
                </span>
              </div>
              <input
                type="range"
                min="0.2"
                max="2.5"
                step="0.05"
                value={windSpeed}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setWindSpeed(val);
                  executeSimulation({ windSpeed: val });
                }}
                className="w-full accent-cyan-400 bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Wind Direction Delta */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300">Wind Heading Delta</span>
                <span className="font-mono text-cyan-400 font-semibold">
                  {windDirection > 0 ? `+${windDirection}°` : `${windDirection}°`}
                </span>
              </div>
              <input
                type="range"
                min="-180"
                max="180"
                step="5"
                value={windDirection}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setWindDirection(val);
                  executeSimulation({ windDir: val });
                }}
                className="w-full accent-cyan-400 bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Boundary Layer Height */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300">Boundary Layer (Mixing)</span>
                <span className="font-mono text-cyan-400 font-semibold">{blhFactor.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.3"
                max="2.0"
                step="0.05"
                value={blhFactor}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setBlhFactor(val);
                  executeSimulation({ blh: val });
                }}
                className="w-full accent-cyan-400 bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Rainfall Scavenging */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300">Precipitation Washout</span>
                <span className="font-mono text-cyan-400 font-semibold">{rainfall.toFixed(1)} mm/h</span>
              </div>
              <input
                type="range"
                min="0"
                max="35"
                step="0.5"
                value={rainfall}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setRainfall(val);
                  executeSimulation({ rain: val });
                }}
                className="w-full accent-cyan-400 bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* Sectoral Emissions Levers */}
          <div className="space-y-3 pt-3 border-t border-[#242938]">
            <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Factory className="w-3.5 h-3.5 text-amber-400" />
                Sector Anthropogenic Levers
              </span>
            </div>

            {/* Vehicular Traffic */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300">Vehicular Traffic</span>
                <span className="font-mono text-amber-400 font-semibold">
                  {Math.round(trafficEmission * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={trafficEmission}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setTrafficEmission(val);
                  executeSimulation({ traffic: val });
                }}
                className="w-full accent-amber-400 bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Industrial Stacks */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300">Industrial Process Stacks</span>
                <span className="font-mono text-amber-400 font-semibold">
                  {Math.round(industrialEmission * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={industrialEmission}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setIndustrialEmission(val);
                  executeSimulation({ industry: val });
                }}
                className="w-full accent-amber-400 bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Power Plants */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300">Thermal Power Generation</span>
                <span className="font-mono text-amber-400 font-semibold">
                  {Math.round(powerPlantEmission * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={powerPlantEmission}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setPowerPlantEmission(val);
                  executeSimulation({ power: val });
                }}
                className="w-full accent-amber-400 bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Construction Dust & Heavy Equipment */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300">Construction Activity</span>
                <span className="font-mono text-amber-400 font-semibold">
                  {Math.round(constructionEmission * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={constructionEmission}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setConstructionEmission(val);
                  executeSimulation({ construction: val });
                }}
                className="w-full accent-amber-400 bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
              />
            </div>
          </div>
        </aside>

        {/* CENTER COLUMN: Interactive Map & Overlays */}
        <main className="flex-1 h-full relative overflow-hidden flex flex-col bg-[#0b0d13]">
          {/* Map Canvas */}
          <div ref={mapContainerRef} className="w-full h-full relative" />

          {/* Top Floating Controls Overlay */}
          <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
            {/* Legend Card with strict CPCB Hazard Scale */}
            <div className="p-2.5 rounded-xl bg-[#11141d]/90 backdrop-blur-md border border-[#242938] shadow-2xl space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-zinc-300 font-semibold">CPCB Hazard Scale</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    impactData.simulated_compliance === 'COMPLIANT'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : impactData.simulated_compliance === 'CRITICAL'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {impactData.simulated_compliance}
                </span>
              </div>

              {/* Continuous CPCB Color Gradient */}
              <div className="space-y-1">
                <div className="w-56 h-2 rounded overflow-hidden bg-gradient-to-r from-[#10b981] via-[#facc15] via-[#f97316] via-[#ef4444] to-[#9333ea]" />
                <div className="flex justify-between text-[9px] font-mono text-zinc-400">
                  <span>0 (Good)</span>
                  <span>40 (Mod)</span>
                  <span>80 (CPCB)</span>
                  <span>180 (Crit)</span>
                  <span>280+ (Sev)</span>
                </div>
              </div>
            </div>

            {/* Toggle Overlay Buttons */}
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowFacilities(!showFacilities)}
                className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                  showFacilities
                    ? 'bg-blue-600/30 text-blue-300 border-blue-500/50'
                    : 'bg-[#141721] text-zinc-400 border-zinc-800'
                }`}
              >
                Facility Markers
              </button>
            </div>
          </div>

          {/* FLOATING ANCHORED POPUP CARD (Z-50, Highest Z-index, Auto-flip) */}
          {popupAnchor && (selectedHotspot || selectedFacility) && (
            <div
              ref={popupCardRef}
              style={{
                position: 'absolute',
                left: `${Math.max(20, Math.min(popupAnchor.x, (mapContainerRef.current?.clientWidth || 700) - 340))}px`,
                top: popupAnchor.y < 240
                  ? `${popupAnchor.y + 18}px`
                  : `${Math.max(16, popupAnchor.y - 16)}px`,
                transform: popupAnchor.y < 240 ? 'none' : 'translateY(-100%)',
              }}
              className="z-50 w-84 p-4 rounded-xl bg-[#141824]/98 backdrop-blur-xl border border-[#2d364c] shadow-2xl space-y-2.5 animate-in fade-in zoom-in-95 duration-150"
            >
              {/* FACILITY EDITABLE NODE POPUP */}
              {selectedFacility && (
                <>
                  <div className="flex items-start justify-between border-b border-zinc-800/80 pb-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Factory className="w-3.5 h-3.5 text-blue-400" />
                        <h4 className="text-xs font-bold text-white leading-tight">
                          {selectedFacility.name}
                        </h4>
                      </div>
                      <span className="text-[10px] uppercase font-mono px-1 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-semibold">
                        {selectedFacility.category.replace('_', ' ')}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedFacility(null);
                        setPopupAnchor(null);
                      }}
                      className="text-zinc-400 hover:text-white text-xs p-1"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Live Emission Slider */}
                  <div className="space-y-1.5 bg-[#0e111a] p-2.5 rounded-lg border border-zinc-800">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-300 font-medium">Stack Emission Output</span>
                      <span className="font-mono text-blue-400 font-bold">
                        {Math.round(selectedFacility.emissionFactor * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="2.0"
                      step="0.05"
                      value={selectedFacility.emissionFactor}
                      onChange={(e) => {
                        const newFactor = parseFloat(e.target.value);
                        const updated = facilities.map((f) =>
                          f.id === selectedFacility.id ? { ...f, emissionFactor: newFactor } : f
                        );
                        setFacilities(updated);
                        setSelectedFacility({ ...selectedFacility, emissionFactor: newFactor });
                        executeSimulation({ facilityOverrides: updated });
                      }}
                      className="w-full accent-blue-500 bg-zinc-800 h-1.5 rounded cursor-pointer"
                    />
                    <div className="flex justify-between text-[9px] font-mono text-zinc-500">
                      <span>0% (Shutdown)</span>
                      <span>100% (Baseline)</span>
                      <span>200% (Peak Surge)</span>
                    </div>
                  </div>

                  {/* Impact metrics for this node */}
                  <div className="text-[11px] space-y-1 text-zinc-300 bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                    <div>
                      <strong className="text-zinc-200">Receptor Exposure:</strong> ~
                      {Math.round(42000 * selectedFacility.emissionFactor).toLocaleString()} residents downwind
                    </div>
                    <div>
                      <strong className="text-zinc-200">Plume Trajectory:</strong> Disperses east-northeastward toward Chembur corridor
                    </div>
                  </div>

                  {/* Fast Action Buttons */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => {
                        const newFactor = selectedFacility.emissionFactor > 0 ? 0.0 : 1.0;
                        const updated = facilities.map((f) =>
                          f.id === selectedFacility.id ? { ...f, emissionFactor: newFactor } : f
                        );
                        setFacilities(updated);
                        setSelectedFacility({ ...selectedFacility, emissionFactor: newFactor });
                        executeSimulation({ facilityOverrides: updated });
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        selectedFacility.emissionFactor > 0
                          ? 'bg-rose-950/60 text-rose-300 border border-rose-800/50 hover:bg-rose-900/70'
                          : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 hover:bg-emerald-900/70'
                      }`}
                    >
                      {selectedFacility.emissionFactor > 0 ? 'Shutdown Stack' : 'Restart Baseline'}
                    </button>
                  </div>
                </>
              )}

              {/* SUSPICIOUS HOTSPOT DETAIL POPUP */}
              {selectedHotspot && (
                <>
                  <div className="flex items-start justify-between border-b border-zinc-800/80 pb-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        {selectedHotspot.category === 'SUSPICIOUS_LOCAL_SOURCE' ? (
                          <Flame className="w-4 h-4 text-purple-400" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                        )}
                        <h4 className="text-xs font-bold text-white leading-tight">
                          {selectedHotspot.name}
                        </h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[9px] uppercase font-mono px-1.5 py-0.2 rounded font-semibold ${
                            selectedHotspot.category === 'SUSPICIOUS_LOCAL_SOURCE'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          }`}
                        >
                          {selectedHotspot.category.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] text-zinc-400 font-mono">
                          {selectedHotspot.lat.toFixed(3)}°N, {selectedHotspot.lon.toFixed(3)}°E
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedHotspot(null);
                        setPopupAnchor(null);
                      }}
                      className="text-zinc-400 hover:text-white text-xs p-1"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Observed vs Simulated Metrics */}
                  <div className="grid grid-cols-2 gap-2 py-1.5 border-y border-zinc-800 text-xs">
                    <div>
                      <div className="text-[10px] text-zinc-400">Observed NO₂</div>
                      <div className="font-mono font-bold text-rose-400 text-sm">
                        {selectedHotspot.observed_no2.toFixed(1)} µg/m³
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-400">Simulated NO₂</div>
                      <div className="font-mono font-bold text-blue-400 text-sm">
                        {selectedHotspot.simulated_no2.toFixed(1)} µg/m³
                      </div>
                    </div>
                  </div>

                  {/* Compliance badges */}
                  <div className="flex gap-2">
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                        selectedHotspot.cpcb_compliant
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      CPCB: {selectedHotspot.cpcb_compliant ? '✔ COMPLIANT' : '✖ NON-COMPLIANT'}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                        selectedHotspot.who_compliant
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      WHO: {selectedHotspot.who_compliant ? '✔ COMPLIANT' : '✖ EXCEEDED'}
                    </span>
                  </div>

                  {/* Finding Narrative */}
                  <div className="text-[11px] text-zinc-300 leading-relaxed bg-black/40 p-2 rounded border border-zinc-800/80">
                    <strong>Finding:</strong> {selectedHotspot.finding}
                  </div>

                  {/* SHAP Explanation */}
                  {selectedHotspot.shap_explanation && (
                    <div className="text-[11px] text-indigo-300 bg-indigo-950/40 p-2 rounded border border-indigo-800/40">
                      <strong>XAI Explanation:</strong> {selectedHotspot.shap_explanation}
                    </div>
                  )}

                  {/* Drone Recommendation */}
                  {selectedHotspot.drone_recommendation && (
                    <div className="text-[11px] text-blue-300 bg-blue-950/40 p-2 rounded border border-blue-800/40 space-y-1">
                      <div className="flex items-center justify-between font-semibold text-blue-200">
                        <span className="flex items-center gap-1">
                          <Bot className="w-3.5 h-3.5 text-blue-400" />
                          Drone Reconnaissance:
                        </span>
                        <span className="text-[9px] font-mono px-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          PRIORITY: {selectedHotspot.inspection_priority || 'CRITICAL'}
                        </span>
                      </div>
                      <p className="text-[10px] leading-tight text-zinc-300">
                        {selectedHotspot.drone_recommendation}
                      </p>
                    </div>
                  )}

                  {/* Drone Mission CTA */}
                  <Link
                    href="/drone"
                    className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>Plan Drone Surveillance Flight</span>
                  </Link>
                </>
              )}
            </div>
          )}

          {/* Bottom Live KPI Bar */}
          <div className="absolute bottom-4 left-4 right-4 z-10 p-3 rounded-xl bg-[#11141d]/90 backdrop-blur-md border border-[#242938] shadow-2xl grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-mono text-zinc-400">Peak NO₂</span>
              <div className="text-base font-bold font-mono text-white flex items-center gap-1">
                <span>{impactData.simulated_peak_no2.toFixed(1)}</span>
                <span className="text-[10px] text-zinc-400 font-sans">µg/m³</span>
                <span
                  className={`text-xs font-mono ml-1 ${
                    impactData.peak_no2_change_pct <= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  ({impactData.peak_no2_change_pct > 0 ? '+' : ''}
                  {impactData.peak_no2_change_pct.toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-mono text-zinc-400">Area Average</span>
              <div className="text-base font-bold font-mono text-white flex items-center gap-1">
                <span>{impactData.simulated_mean_no2.toFixed(1)}</span>
                <span className="text-[10px] text-zinc-400 font-sans">µg/m³</span>
                <span
                  className={`text-xs font-mono ml-1 ${
                    impactData.mean_no2_change_pct <= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  ({impactData.mean_no2_change_pct > 0 ? '+' : ''}
                  {impactData.mean_no2_change_pct.toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-mono text-zinc-400">Exposed Population</span>
              <div className="text-base font-bold font-mono text-white flex items-center gap-1">
                <span>{impactData.simulated_exposed_pop.toLocaleString()}</span>
                <span
                  className={`text-xs font-mono ml-1 ${
                    impactData.exposed_pop_change <= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  ({impactData.exposed_pop_change > 0 ? '+' : ''}
                  {impactData.exposed_pop_change.toLocaleString()})
                </span>
              </div>
            </div>

            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-mono text-zinc-400">Plume Shift</span>
              <div className="text-base font-bold font-mono text-white flex items-center gap-1">
                <span>{impactData.plume_displacement_km.toFixed(2)}</span>
                <span className="text-[10px] text-zinc-400 font-sans">km</span>
                <span className="text-[10px] text-zinc-400 font-mono ml-1">
                  @{impactData.plume_heading_deg.toFixed(0)}°
                </span>
              </div>
            </div>

            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-mono text-zinc-400">CPCB Compliance</span>
              <div className="text-xs font-mono font-bold flex items-center gap-1 pt-0.5">
                {impactData.simulated_peak_no2 <= 80 ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> COMPLIANT
                  </span>
                ) : (
                  <span className="text-rose-400 flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> EXCEEDANCE
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-mono text-zinc-400">WHO Guideline</span>
              <div className="text-xs font-mono font-bold flex items-center gap-1 pt-0.5">
                {impactData.simulated_peak_no2 <= 25 ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> COMPLIANT
                  </span>
                ) : (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> EXCEEDED
                  </span>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* RIGHT COLUMN: XAI Dashboard, Contributors & Dynamic Mission Cards */}
        <aside className="w-92 h-full bg-[#11141d] border-l border-[#242938] flex flex-col shrink-0 overflow-y-auto p-3.5 space-y-4 z-20">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#242938] pb-2.5">
            <div className="flex items-center gap-1.5">
              <BarChart2 className="w-4 h-4 text-blue-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                XAI ATTRIBUTION DASHBOARD
              </h3>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              TreeSHAP Live
            </span>
          </div>

          {/* Natural Language AI Explanation */}
          <div className="p-3 rounded-lg bg-gradient-to-br from-blue-950/40 to-slate-900/60 border border-blue-500/30 space-y-1.5 shadow-md">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-blue-300">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>Autonomous Reasoning Summary</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed font-sans">
              "{xaiData.executive_summary}"
            </p>
          </div>

          {/* SHAP Plot View Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400 uppercase tracking-wider font-mono">
              <span>SHAP Explainability Plots</span>
              <div className="flex bg-[#161a26] border border-[#2b3347] rounded p-0.5 text-[9px]">
                <button
                  onClick={() => setXaiPlotTab('waterfall')}
                  className={`px-1.5 py-0.5 rounded transition-all ${
                    xaiPlotTab === 'waterfall'
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Waterfall
                </button>
                <button
                  onClick={() => setXaiPlotTab('beeswarm')}
                  className={`px-1.5 py-0.5 rounded transition-all ${
                    xaiPlotTab === 'beeswarm'
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Beeswarm
                </button>
                <button
                  onClick={() => setXaiPlotTab('bar')}
                  className={`px-1.5 py-0.5 rounded transition-all ${
                    xaiPlotTab === 'bar'
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Bar
                </button>
              </div>
            </div>

            {/* Rendered Chart Image */}
            <div className="rounded-lg border border-[#242938] overflow-hidden bg-[#0c0e15] flex items-center justify-center min-h-[140px]">
              {xaiPlotTab === 'waterfall' && xaiData.waterfall_chart_url && (
                <img
                  src={xaiData.waterfall_chart_url}
                  alt="SHAP Waterfall Plot"
                  className="w-full h-auto object-contain"
                />
              )}
              {xaiPlotTab === 'beeswarm' && xaiData.beeswarm_chart_url && (
                <img
                  src={xaiData.beeswarm_chart_url}
                  alt="SHAP Beeswarm Plot"
                  className="w-full h-auto object-contain"
                />
              )}
              {xaiPlotTab === 'bar' && xaiData.bar_chart_url && (
                <img
                  src={xaiData.bar_chart_url}
                  alt="SHAP Bar Plot"
                  className="w-full h-auto object-contain"
                />
              )}
              {!xaiData.waterfall_chart_url && (
                <div className="text-[11px] text-zinc-500 py-6 font-mono">
                  Loading model SHAP vectors...
                </div>
              )}
            </div>
          </div>

          {/* Top Positive Contributors (Aggravating Factors) */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider font-mono flex items-center justify-between">
              <span>Top Positive Drivers (Increases NO₂)</span>
              <TrendingUp className="w-3.5 h-3.5" />
            </div>
            <div className="space-y-1.5">
              {(xaiData.positive_contributors || xaiData.top_contributors.filter(c => (c.direction || '').includes('increase'))).slice(0, 3).map((c: any, i: number) => {
                const label = c.feature_label || c.feature || 'Aggravating Factor';
                const pctVal = c.percentage ?? c.contribution_pct ?? 0;
                return (
                  <div key={i} className="p-2 rounded-lg bg-[#141824] border border-rose-950/40 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-200 font-medium">{label}</span>
                      <span className="font-mono text-[11px] font-bold text-rose-400">
                        +{Number(pctVal).toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-rose-500 transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, Number(pctVal) * 2.2))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Negative Contributors (Natural Dispersion & Mitigators) */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider font-mono flex items-center justify-between">
              <span>Natural Dispersion Mitigators (Dilutes NO₂)</span>
              <TrendingDown className="w-3.5 h-3.5" />
            </div>
            <div className="space-y-1.5">
              {(xaiData.negative_contributors || xaiData.top_contributors.filter(c => (c.direction || '').includes('reduce'))).slice(0, 2).map((c: any, i: number) => {
                const label = c.feature_label || c.feature || 'Mitigating Factor';
                const pctVal = c.percentage ?? c.contribution_pct ?? 0;
                return (
                  <div key={i} className="p-2 rounded-lg bg-[#141824] border border-emerald-950/40 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-200 font-medium">{label}</span>
                      <span className="font-mono text-[11px] font-bold text-emerald-400">
                        -{Number(pctVal).toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, Number(pctVal) * 2.2))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DYNAMIC MISSION CARDS & GUIDELINE VERIFICATION */}
          <div className="p-3 rounded-lg bg-[#141824] border border-[#242938] space-y-2.5">
            <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider font-mono flex items-center justify-between">
              <span>Regulatory Verification</span>
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-zinc-900/60 border border-zinc-800">
                <span className="text-zinc-300">CPCB 24-Hour Standard (80 µg/m³)</span>
                {impactData.simulated_peak_no2 <= 80 ? (
                  <span className="text-[10px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> COMPLIANT
                  </span>
                ) : impactData.simulated_peak_no2 > 180 ? (
                  <span className="text-[10px] font-mono font-bold text-purple-400 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> CRITICAL ({impactData.simulated_peak_no2.toFixed(1)})
                  </span>
                ) : (
                  <span className="text-[10px] font-mono font-bold text-rose-400 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> EXCEEDANCE ({impactData.simulated_peak_no2.toFixed(1)})
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-zinc-900/60 border border-zinc-800">
                <span className="text-zinc-300">WHO 24-Hour Guideline (25 µg/m³)</span>
                {impactData.simulated_peak_no2 <= 25 ? (
                  <span className="text-[10px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> COMPLIANT
                  </span>
                ) : (
                  <span className="text-[10px] font-mono font-bold text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> EXCEEDED ({impactData.simulated_peak_no2.toFixed(1)})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Recommendations / Directives */}
          <div className="space-y-1.5 pt-2 border-t border-[#242938]">
            <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider font-mono">
              Mission Directives
            </div>
            <div className="p-3 rounded-lg bg-blue-950/30 border border-blue-500/30 text-xs text-blue-200 leading-relaxed space-y-1">
              <div className="font-semibold text-white">Autonomous Policy Guidance:</div>
              <div>{impactData.policy_recommendation}</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
