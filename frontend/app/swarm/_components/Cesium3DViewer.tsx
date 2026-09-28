'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Globe2,
  Layers,
  Compass,
  Eye,
  Sliders,
  Sun,
  Flame,
  CloudRain,
  MapPin,
  RotateCw,
  Info,
  AlertTriangle,
  ChevronRight,
  Wind,
  Sparkles,
  Bot,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  Radio,
  Crosshair,
  CheckCircle2,
  Navigation,
  X,
} from 'lucide-react';

export type ImageryMode = 'satellite' | 'dark' | 'osm';

export interface Hotspot {
  id: string;
  lat: number;
  lon: number;
  no2: number;
  name: string;
  shortName: string;
  severity: 'CRITICAL' | 'HIGH' | 'ELEVATED';
  description: string;
}

export interface DroneState {
  id: string;
  name: string;
  callsign: string;
  role: string;
  color: string;
  battery: number;
  currentReading: number;
  targetZone: string;
  // Trajectory parameters
  centerLon: number;
  centerLat: number;
  radiusLon: number;
  radiusLat: number;
  altitudeBase: number;
  speed: number;
  phase: number;
  pattern: 'figure8' | 'ellipse';
}

export interface LLMDecision {
  id: string;
  timestamp: string;
  droneId: string;
  droneName: string;
  actionType: 'PLUME_ASCENT' | 'CLOUD_GAP' | 'DOWNWIND_FLANK' | 'GROUND_TRUTH' | 'WIND_CORRECTION';
  badgeColor: string;
  zone: string;
  title: string;
  message: string;
  groundTruthDelta?: string;
}

interface Cesium3DViewerProps {
  onCoordsChange?: (coords: { lat: number; lon: number; alt: number; pitch: number }) => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MUMBAI_COORD = { lat: 19.0760, lon: 72.8777 };

// Coordinated Drone Swarm Definitions
const INITIAL_DRONES: DroneState[] = [
  {
    id: 'drone-1',
    name: 'AirQ-Alpha (Lead Scout)',
    callsign: 'Alpha',
    role: 'Plume Core Gradient Tracker',
    color: '#38bdf8', // Cyan
    battery: 88,
    currentReading: 364.5,
    targetZone: 'Chembur-Trombay',
    centerLon: 72.9275,
    centerLat: 19.0225,
    radiusLon: 0.015,
    radiusLat: 0.011,
    altitudeBase: 190,
    speed: 0.08,
    phase: 0.0,
    pattern: 'figure8',
  },
  {
    id: 'drone-2',
    name: 'AirQ-Bravo (Flank Wing)',
    callsign: 'Bravo',
    role: 'Downwind Dispersion Flank',
    color: '#f59e0b', // Amber
    battery: 84,
    currentReading: 278.2,
    targetZone: 'Wadala Channel',
    centerLon: 72.9050,
    centerLat: 18.9950,
    radiusLon: 0.013,
    radiusLat: 0.009,
    altitudeBase: 220,
    speed: 0.075,
    phase: 1.8,
    pattern: 'ellipse',
  },
  {
    id: 'drone-3',
    name: 'AirQ-Charlie (Cloud Scout)',
    callsign: 'Charlie',
    role: 'Cloud-Gap Ground Interceptor',
    color: '#a855f7', // Purple
    battery: 91,
    currentReading: 142.0,
    targetZone: 'Thane Creek Marine',
    centerLon: 72.9280,
    centerLat: 19.1850,
    radiusLon: 0.016,
    radiusLat: 0.012,
    altitudeBase: 260,
    speed: 0.065,
    phase: 3.2,
    pattern: 'figure8',
  },
  {
    id: 'drone-4',
    name: 'AirQ-Delta (Perimeter Patrol)',
    callsign: 'Delta',
    role: 'Coastal Logistics Sweep',
    color: '#10b981', // Emerald
    battery: 79,
    currentReading: 291.4,
    targetZone: 'JNPT Port Corridor',
    centerLon: 72.9550,
    centerLat: 18.9600,
    radiusLon: 0.014,
    radiusLat: 0.010,
    altitudeBase: 175,
    speed: 0.07,
    phase: 4.5,
    pattern: 'ellipse',
  },
];

// Continuous stream of accessible, simple-language swarm intelligence decisions
const LLM_DECISION_CATALOG: Omit<LLMDecision, 'id' | 'timestamp'>[] = [
  {
    droneId: 'drone-1',
    droneName: 'AirQ-Alpha (Lead)',
    actionType: 'PLUME_ASCENT',
    badgeColor: 'border-rose-500/40 text-rose-400 bg-rose-500/10',
    zone: 'Chembur Refining Core',
    title: 'Plume Gradient Detected',
    message: 'Detected an elevated NO₂ reading (368.1 µg/m³) over catalytic cracking unit #4. Directing AirQ-Bravo to flank downwind towards Wadala.',
    groundTruthDelta: '+3.2% vs S5P estimate',
  },
  {
    droneId: 'drone-3',
    droneName: 'AirQ-Charlie (Cloud Scout)',
    actionType: 'CLOUD_GAP',
    badgeColor: 'border-sky-500/40 text-sky-400 bg-sky-500/10',
    zone: 'Thane Creek Marine Deck',
    title: 'Penetrating Cloud Occlusion',
    message: 'Satellite view is blocked by marine cloud cover. Descending to 180m to take direct air quality measurements beneath the clouds.',
    groundTruthDelta: 'Imputing gap with 98.4% confidence',
  },
  {
    droneId: 'drone-2',
    droneName: 'AirQ-Bravo (Flank)',
    actionType: 'DOWNWIND_FLANK',
    badgeColor: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
    zone: 'Wadala Harbor Corridor',
    title: 'Downwind Drift Confirmed',
    message: 'Confirmed elevated NO₂ (272.6 µg/m³) along the freight line. Logging an active ground emission corridor across the harbor.',
  },
  {
    droneId: 'drone-1',
    droneName: 'AirQ-Alpha (Lead)',
    actionType: 'GROUND_TRUTH',
    badgeColor: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10',
    zone: 'Chembur Ground Station',
    title: 'Satellite Validation Complete',
    message: 'Direct onboard drone sensor reading (364.5 µg/m³) matches the downscaled Sentinel-5P satellite model (368.1 µg/m³) with 99% accuracy.',
    groundTruthDelta: 'Validation matched within 1.0%',
  },
  {
    droneId: 'drone-4',
    droneName: 'AirQ-Delta (Patrol)',
    actionType: 'PLUME_ASCENT',
    badgeColor: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10',
    zone: 'JNPT Port Berths',
    title: 'Heavy Diesel Plume Tracked',
    message: 'Detected a localized diesel exhaust spike from container vessel docking. Circling terminal perimeter to isolate ship emissions.',
    groundTruthDelta: 'Peak reading: 295.6 µg/m³',
  },
  {
    droneId: 'drone-2',
    droneName: 'Swarm Core AI',
    actionType: 'WIND_CORRECTION',
    badgeColor: 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10',
    zone: 'Mumbai Harbor Airspace',
    title: 'Wind Shift Realignment',
    message: 'Sea breeze shifted northeast at 3.1 m/s. Re-orienting the 4-drone patrol formation to keep intercepting the moving smoke cloud.',
  },
  {
    droneId: 'drone-3',
    droneName: 'AirQ-Charlie (Cloud Scout)',
    actionType: 'CLOUD_GAP',
    badgeColor: 'border-sky-500/40 text-sky-400 bg-sky-500/10',
    zone: 'Thane Creek Boundary',
    title: 'Cloud Gap Successfully Filled',
    message: 'Completed direct sampling across the occluded sector. Transmitting ground-truth readings to update the main satellite dashboard map.',
    groundTruthDelta: 'Occlusion resolved: 142.0 µg/m³',
  },
  {
    droneId: 'drone-1',
    droneName: 'AirQ-Alpha (Lead)',
    actionType: 'GROUND_TRUTH',
    badgeColor: 'border-purple-500/40 text-purple-400 bg-purple-500/10',
    zone: 'BKC Swarm Network',
    title: 'Autonomous Sector Handover',
    message: 'Battery at 84%. Swarm consensus handed western boundary monitoring over to AirQ-Bravo to maintain continuous sensor coverage.',
  },
];

// Geographically dispersed regional NO2 clusters (calibrated coordinates)
const FALLBACK_HOTSPOTS: Hotspot[] = [
  {
    id: 'spot-1',
    lat: 19.0225,
    lon: 72.9275,
    no2: 368.1,
    name: 'Chembur-Trombay Industrial Basin',
    shortName: 'Chembur Basin',
    severity: 'CRITICAL',
    description: 'Petroleum refining, catalytic cracking, and fertilizer complex emissions',
  },
  {
    id: 'spot-2',
    lat: 18.9875,
    lon: 72.9625,
    no2: 295.6,
    name: 'JNPT Coastal Freight Terminal',
    shortName: 'JNPT Port',
    severity: 'HIGH',
    description: 'Deepwater container vessel logistics and heavy marine diesel corridor',
  },
  {
    id: 'spot-3',
    lat: 18.9875,
    lon: 72.8925,
    no2: 272.6,
    name: 'Wadala Harbor & Freight Yard',
    shortName: 'Wadala Rail',
    severity: 'HIGH',
    description: 'Rail transit nexus and petroleum pipeline staging terminal',
  },
  {
    id: 'spot-4',
    lat: 19.0225,
    lon: 72.9975,
    no2: 265.7,
    name: 'Nerul Industrial Sector',
    shortName: 'Nerul MIDC',
    severity: 'HIGH',
    description: 'Chemical formulations and electronic component manufacturing hub',
  },
  {
    id: 'spot-5',
    lat: 18.9175,
    lon: 72.9625,
    no2: 237.2,
    name: 'Uran Energy Generation Hub',
    shortName: 'Uran Energy',
    severity: 'HIGH',
    description: 'Gas turbine power generation and offshore hydrocarbon landing',
  },
  {
    id: 'spot-6',
    lat: 19.0925,
    lon: 73.0325,
    no2: 222.0,
    name: 'Ghansoli-MIDC Industrial Belt',
    shortName: 'Ghansoli',
    severity: 'HIGH',
    description: 'High-density industrial manufacturing and transport facilities',
  },
  {
    id: 'spot-7',
    lat: 18.9525,
    lon: 72.9275,
    no2: 217.7,
    name: 'Elephanta Maritime Passage',
    shortName: 'Elephanta Channel',
    severity: 'HIGH',
    description: 'Harbor ferry routes and coastal freight shipping lanes',
  },
  {
    id: 'spot-8',
    lat: 18.9175,
    lon: 73.0325,
    no2: 208.2,
    name: 'Panvel-Dronagiri Transit Basin',
    shortName: 'Panvel Basin',
    severity: 'HIGH',
    description: 'Heavy arterial logistics corridor and highway interchange',
  },
];

// Persistent Cloud-Gap occluded zones
const CLOUD_GAP_ZONES = [
  { id: 'zone-1', name: 'Navi Mumbai Gap', lat: 18.9950, lon: 73.0450, radius: 3200, gapScore: 0.88, color: '#f43f5e' },
  { id: 'zone-2', name: 'Thane Creek Marine', lat: 19.1850, lon: 72.9280, radius: 3400, gapScore: 0.79, color: '#38bdf8' },
  { id: 'zone-3', name: 'Kalyan Valley Basin', lat: 19.2450, lon: 73.1150, radius: 3000, gapScore: 0.84, color: '#f59e0b' },
];

// Non-uniform organic plume profiles for natural atmospheric diffusion
const PLUME_PROFILES = [
  {
    emitterRadius: 1000.0,
    startScale: 2.0,
    endScale: 11.0,
    emissionRate: 20,
    life: [4.5, 8.5],
    speed: [0.5, 2.2],
    puffs: [
      { dx: 0, dy: 0, dz: 20 },
      { dx: 0.0035, dy: -0.0025, dz: 55 },
      { dx: -0.003, dy: 0.0025, dz: 75 },
    ],
  },
  {
    emitterRadius: 800.0,
    startScale: 1.8,
    endScale: 9.0,
    emissionRate: 16,
    life: [4.0, 7.5],
    speed: [0.7, 2.5],
    puffs: [
      { dx: 0, dy: 0, dz: 20 },
      { dx: 0.0045, dy: 0.002, dz: 40 },
    ],
  },
  {
    emitterRadius: 500.0,
    startScale: 1.4,
    endScale: 6.5,
    emissionRate: 12,
    life: [3.2, 5.8],
    speed: [0.4, 1.6],
    puffs: [
      { dx: 0, dy: 0, dz: 15 },
    ],
  },
  {
    emitterRadius: 700.0,
    startScale: 1.7,
    endScale: 8.0,
    emissionRate: 14,
    life: [3.8, 7.0],
    speed: [0.5, 2.0],
    puffs: [
      { dx: 0, dy: 0, dz: 20 },
      { dx: -0.003, dy: -0.002, dz: 35 },
    ],
  },
];

/**
 * Procedurally generates a smooth Gaussian radial gradient smoke puff texture.
 */
function createSmokeParticleCanvas(): HTMLCanvasElement | string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.60)');
    grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.36)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.14)');
    grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.03)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  return canvas;
}

function loadCesium(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject();
  if ((window as any).Cesium) return Promise.resolve((window as any).Cesium);

  (window as any).CESIUM_BASE_URL = 'https://cesium.com/downloads/cesiumjs/releases/1.121/Build/Cesium/';

  return new Promise((resolve, reject) => {
    if (!document.getElementById('cesium-css')) {
      const link = document.createElement('link');
      link.id = 'cesium-css';
      link.rel = 'stylesheet';
      link.href = 'https://cesium.com/downloads/cesiumjs/releases/1.121/Build/Cesium/Widgets/widgets.css';
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.id = 'cesium-script';
    script.src = 'https://cesium.com/downloads/cesiumjs/releases/1.121/Build/Cesium/Cesium.js';
    script.async = true;
    script.onload = () => resolve((window as any).Cesium);
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
}

export default function Cesium3DViewer({ onCoordsChange }: Cesium3DViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);

  // Hotspots State
  const [hotspots, setHotspots] = useState<Hotspot[]>(FALLBACK_HOTSPOTS);
  const [selectedHotspot, setSelectedHotspot] = useState<Hotspot | null>(null);

  // Drones State & Positions
  const [drones, setDrones] = useState<DroneState[]>(INITIAL_DRONES);
  const dronePositionsRef = useRef<any[]>([]);
  const droneOrientationsRef = useRef<any[]>([]);
  const droneCoordsRef = useRef<{ lon: number; lat: number; alt: number; heading: number }[]>([]);

  // LLM Decision Stream State
  const [decisions, setDecisions] = useState<LLMDecision[]>([
    {
      id: 'init-1',
      timestamp: '21:24:10',
      droneId: 'drone-1',
      droneName: 'AirQ-Alpha (Lead)',
      actionType: 'PLUME_ASCENT',
      badgeColor: 'border-rose-500/40 text-rose-400 bg-rose-500/10',
      zone: 'Chembur Refining Core',
      title: 'Plume Gradient Detected',
      message: 'Detected elevated NO₂ reading (368.1 µg/m³) over catalytic cracking unit. Coordinating with AirQ-Bravo to measure downwind drift.',
      groundTruthDelta: '+3.2% vs S5P estimate',
    },
    {
      id: 'init-2',
      timestamp: '21:24:16',
      droneId: 'drone-3',
      droneName: 'AirQ-Charlie (Cloud Scout)',
      actionType: 'CLOUD_GAP',
      badgeColor: 'border-sky-500/40 text-sky-400 bg-sky-500/10',
      zone: 'Thane Creek Marine Deck',
      title: 'Penetrating Cloud Occlusion',
      message: 'Descending beneath coastal clouds at 180m altitude to capture direct air quality ground truth where satellite is blind.',
      groundTruthDelta: 'Imputing gap with 98.4% confidence',
    },
  ]);
  const [isDecisionStreamPaused, setIsDecisionStreamPaused] = useState<boolean>(false);
  const [isDecisionsTabMinimized, setIsDecisionsTabMinimized] = useState<boolean>(false);
  const decisionCatalogIndexRef = useRef<number>(2);

  // DOM Refs for 60FPS Direct Overlay Tracking (ZERO React re-renders in render loop!)
  const hangarPinRef = useRef<HTMLDivElement>(null);
  const hotspotPinRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cloudPinRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dronePinRefs = useRef<(HTMLDivElement | null)[]>([]);

  // UI Control States
  const [imageryMode, setImageryMode] = useState<ImageryMode>('satellite');
  const [pitchAngle, setPitchAngle] = useState<number>(-32); // Oblique perspective 3D angle
  const [trackedDroneId, setTrackedDroneId] = useState<string | null>(null);
  const trackedDroneIndexRef = useRef<number | null>(null);
  const trackingHeadingDeltaRef = useRef<number>(0);
  const trackingPitchRef = useRef<number>(-20);
  const trackingRangeRef = useRef<number>(55.0);
  const droneRawHeadingsRef = useRef<number[]>([]);
  const smoothedHeadingRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const focusDroneRef = useRef<(id: string) => void>(() => {});
  const [isLayersCollapsed, setIsLayersCollapsed] = useState<boolean>(false);
  const [isBasinsCollapsed, setIsBasinsCollapsed] = useState<boolean>(false);
  const [showParticleClouds, setShowParticleClouds] = useState<boolean>(true);
  const [showPlumeBadges, setShowPlumeBadges] = useState<boolean>(true);
  const [showDrones, setShowDrones] = useState<boolean>(true);
  const [showDroneLabels, setShowDroneLabels] = useState<boolean>(true);
  const showDronesRef = useRef<boolean>(true);
  showDronesRef.current = showDrones;
  const showDroneLabelsRef = useRef<boolean>(true);
  showDroneLabelsRef.current = showDroneLabels;
  const [showClouds, setShowClouds] = useState<boolean>(true);
  const [showAtmosphere, setShowAtmosphere] = useState<boolean>(true);
  const [isRotating, setIsRotating] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [hudInfo, setHudInfo] = useState({
    lat: MUMBAI_COORD.lat,
    lon: MUMBAI_COORD.lon,
    alt: 2900,
    pitch: -32,
    heading: 0,
  });

  // Layer entity references
  const particleSystemsRef = useRef<any[]>([]);
  const hotspotEntitiesRef = useRef<any[]>([]);
  const cloudEntitiesRef = useRef<any[]>([]);
  const droneEntitiesRef = useRef<any[]>([]);

  // 1. Fetch NO2 Hotspot Data from Backend
  useEffect(() => {
    let isCancelled = false;
    const fetchHotspots = async () => {
      try {
        const token = typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : null;
        const res = await fetch(`${API_BASE}/api/v1/downscale/hotspots?limit=8`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.hotspots) && data.hotspots.length > 0 && !isCancelled) {
            const formatted: Hotspot[] = data.hotspots.map((h: any) => ({
              ...h,
              shortName: h.name.split(' ')[0] || 'Zone',
            }));
            setHotspots(formatted);
          }
        }
      } catch (err) {
        console.warn('[Cesium3DViewer] Using calibrated NO2 hotspot catalog:', err);
      }
    };
    fetchHotspots();
    return () => {
      isCancelled = true;
    };
  }, []);

  // 2. Slow, Readable Continuous LLM Swarm Decisions Generator (1 decision every 5.5 seconds)
  useEffect(() => {
    if (isDecisionStreamPaused) return;

    const timer = setInterval(() => {
      const idx = decisionCatalogIndexRef.current % LLM_DECISION_CATALOG.length;
      const template = LLM_DECISION_CATALOG[idx];
      decisionCatalogIndexRef.current += 1;

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

      const newDecision: LLMDecision = {
        ...template,
        id: `dec-${Date.now()}`,
        timestamp: timeStr,
      };

      setDecisions((prev) => [newDecision, ...prev.slice(0, 14)]);
    }, 5500);

    return () => clearInterval(timer);
  }, [isDecisionStreamPaused]);

  // 3. Initialize Pure CesiumJS Environment with Smooth Tile Streaming & 3D Drone Swarm
  useEffect(() => {
    if (!mountRef.current) return;
    let isMounted = true;
    const container = mountRef.current;

    loadCesium()
      .then((Cesium) => {
        if (!isMounted) return;

        // Clean previous viewer if any
        if (viewerRef.current) {
          try {
            viewerRef.current.destroy();
          } catch {}
          viewerRef.current = null;
        }

        // Direct Esri World Imagery Raster (Fast XYZ endpoint)
        const satelliteProvider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          credit: 'Esri, Maxar, Earthstar Geographics',
          maximumLevel: 19,
        });

        const viewer = new Cesium.Viewer(container, {
          baseLayer: new Cesium.ImageryLayer(satelliteProvider),
          terrainProvider: undefined,
          timeline: false,
          animation: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          sceneModePicker: false,
          selectionIndicator: false,
          navigationHelpButton: false,
          showRenderLoopErrors: false,
          shouldAnimate: true,
        });

        // 1. TILE SEAM SMOOTHING & STREAMING ACCELERATION
        const globe = viewer.scene.globe;
        globe.showGroundAtmosphere = true;
        globe.enableLighting = false;
        globe.preloadAncestors = true;         // Keeps parent tiles loaded so zoom never shows empty holes
        globe.preloadSiblings = true;          // Preloads adjacent tiles before panning into them
        globe.tileCacheSize = 350;             // High cache keeps tiles resident in RAM when zooming in/out
        globe.maximumScreenSpaceError = 1.33;  // Refined LOD transition threshold reduces popping
        globe.loadingDescendantLimit = 24;     // Fast parallel tile streaming
        globe.depthTestAgainstTerrain = false;

        // 2. DISTANCE FOG BLENDING
        const scene = viewer.scene;
        scene.fog.enabled = true;
        scene.fog.density = 0.00014;
        scene.fog.screenSpaceErrorFactor = 2.0; // Blends tile resolution differences into atmospheric haze

        // 3. CAMERA CONTROLLER SMOOTHING
        const controller = scene.screenSpaceCameraController;
        controller.inertiaSpin = 0.86;
        controller.inertiaTranslate = 0.86;
        controller.inertiaZoom = 0.80;
        controller.minimumZoomDistance = 15.0; // Allows close-up inspection of 3D quadcopter models
        controller.maximumZoomDistance = 65000.0;

        // High-DPI resolution scaling
        viewer.resolutionScale = Math.min(window.devicePixelRatio || 1.0, 2.0);

        // Intercept error panel dialog
        if (viewer.cesiumWidget) {
          viewer.cesiumWidget.showErrorPanel = (title: string, message: string, error: any) => {
            console.warn('[Cesium Widget Handled Error]:', title, message, error);
          };
        }

        viewerRef.current = viewer;

        // 4. HANGAR BASE MARKER
        viewer.entities.add({
          name: 'AirQ Swarm Operations Base (BKC)',
          position: Cesium.Cartesian3.fromDegrees(MUMBAI_COORD.lon, MUMBAI_COORD.lat, 20),
          point: {
            pixelSize: 14,
            color: Cesium.Color.fromCssColorString('#06b6d4'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });

        // 5. BLENDED ORGANIC PARTICLE PLUMES
        const smokeImg = createSmokeParticleCanvas();
        const pSystems: any[] = [];
        const hEntities: any[] = [];

        hotspots.forEach((spot, spotIdx) => {
          const isCritical = spot.no2 >= 300;
          const isHigh = spot.no2 >= 200;

          const particleStartColor = isCritical
            ? 'rgba(239, 68, 68, 0.52)'
            : isHigh
            ? 'rgba(249, 115, 22, 0.44)'
            : 'rgba(234, 179, 8, 0.35)';

          const profile = PLUME_PROFILES[spotIdx % PLUME_PROFILES.length];

          profile.puffs.forEach((puff, puffIdx) => {
            try {
              const puffLon = spot.lon + puff.dx;
              const puffLat = spot.lat + puff.dy;
              const puffAlt = puff.dz;

              const ps = scene.primitives.add(
                new Cesium.ParticleSystem({
                  image: smokeImg,
                  startColor: Cesium.Color.fromCssColorString(particleStartColor),
                  endColor: Cesium.Color.fromCssColorString('rgba(15, 23, 42, 0.0)'),
                  startScale: profile.startScale * (puffIdx === 0 ? 1.0 : 0.8),
                  endScale: profile.endScale * (puffIdx === 0 ? 1.0 : 0.75),
                  minimumParticleLife: profile.life[0],
                  maximumParticleLife: profile.life[1],
                  minimumSpeed: profile.speed[0],
                  maximumSpeed: profile.speed[1],
                  imageSize: new Cesium.Cartesian2(48, 48),
                  emissionRate: Math.round(profile.emissionRate / (puffIdx === 0 ? 1.0 : 1.6)),
                  emitter: new Cesium.SphereEmitter(profile.emitterRadius * (puffIdx === 0 ? 1.0 : 0.65)),
                  modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(
                    Cesium.Cartesian3.fromDegrees(puffLon, puffLat, puffAlt)
                  ),
                  lifetime: 16.0,
                  loop: true,
                })
              );
              pSystems.push(ps);
            } catch (e) {
              console.warn('[Particle System Init]:', e);
            }
          });

          const footprintColor = isCritical ? '#ef4444' : (isHigh ? '#f97316' : '#eab308');
          const pointMarker = viewer.entities.add({
            name: spot.name,
            position: Cesium.Cartesian3.fromDegrees(spot.lon, spot.lat, 15),
            point: {
              pixelSize: 7,
              color: Cesium.Color.fromCssColorString(footprintColor),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1.5,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          hEntities.push(pointMarker);
        });

        particleSystemsRef.current = pSystems;
        hotspotEntitiesRef.current = hEntities;

        // 6. CUMULUS CLOUD DECKS
        const cloudEntities: any[] = [];
        CLOUD_GAP_ZONES.forEach((z) => {
          const cloudPuffs = [
            { dx: 0, dy: 0, alt: 420, rx: z.radius * 0.9, ry: z.radius * 0.8, rz: 140, alpha: 0.09 },
            { dx: z.radius * 0.35, dy: z.radius * 0.25, alt: 440, rx: z.radius * 0.65, ry: z.radius * 0.6, rz: 120, alpha: 0.07 },
            { dx: -z.radius * 0.40, dy: -z.radius * 0.20, alt: 410, rx: z.radius * 0.70, ry: z.radius * 0.65, rz: 130, alpha: 0.06 },
          ];

          cloudPuffs.forEach((puff) => {
            const e = viewer.entities.add({
              name: z.name,
              position: Cesium.Cartesian3.fromDegrees(
                z.lon + (puff.dx / 111000),
                z.lat + (puff.dy / 111000),
                puff.alt
              ),
              ellipsoid: {
                radii: new Cesium.Cartesian3(puff.rx, puff.ry, puff.rz),
                material: Cesium.Color.fromCssColorString(z.color).withAlpha(puff.alpha),
                outline: false,
              },
            });
            cloudEntities.push(e);
          });
        });
        cloudEntitiesRef.current = cloudEntities;

        // 7. INITIALIZE COORDINATED 3D DRONE SWARM ENTITIES
        const dEntities: any[] = [];
        drones.forEach((d, idx) => {
          // Initialize position/orientation refs
          const initialPos = Cesium.Cartesian3.fromDegrees(d.centerLon, d.centerLat, d.altitudeBase);
          dronePositionsRef.current[idx] = initialPos;
          droneOrientationsRef.current[idx] = Cesium.Quaternion.IDENTITY;
          droneCoordsRef.current[idx] = { lon: d.centerLon, lat: d.centerLat, alt: d.altitudeBase, heading: 0 };

          // Dynamic Cesium Callback properties for 60fps hardware-accelerated movement
          const posProp = new Cesium.CallbackProperty(() => dronePositionsRef.current[idx], false);
          const orientProp = new Cesium.CallbackProperty(() => droneOrientationsRef.current[idx], false);

          const droneEntity = viewer.entities.add({
            id: d.id,
            name: d.name,
            position: posProp,
            orientation: orientProp,
            model: {
              uri: '/models/drone.glb',
              minimumPixelSize: 64, // Ensures distinct 4-rotor quadcopter shape at any altitude
              maximumScale: 250,
              scale: 14.0,
              runAnimations: true, // Continuously spin the 4 rotor propellers at 60 FPS
              shadows: Cesium.ShadowMode.DISABLED,
              silhouetteColor: Cesium.Color.fromCssColorString(d.color).withAlpha(0.85),
              silhouetteSize: 2.0,
            },
          });
          dEntities.push(droneEntity);
        });
        droneEntitiesRef.current = dEntities;

        // 8. 60FPS REAL-TIME SWARM TRAJECTORY SIMULATION & PRE-RENDER CAMERA LOCK
        const scratchHpr = new Cesium.HeadingPitchRange();

        const removePreRender = viewer.scene.preRender.addEventListener(() => {
          if (!viewerRef.current || !viewerRef.current.scene || viewerRef.current.isDestroyed()) return;
          const currentScene = viewerRef.current.scene;
          const now = performance.now() * 0.001;

          // A. Update Drone 3D Positions & Bank Angles along Coordinated Trajectories
          drones.forEach((d, idx) => {
            const t = now * d.speed + d.phase;
            let dLon = 0;
            let dLat = 0;
            let dAlt = d.altitudeBase;
            let dLon_dt = 0;
            let dLat_dt = 0;

            if (d.pattern === 'figure8') {
              dLon = d.radiusLon * Math.cos(t);
              dLat = d.radiusLat * Math.sin(2 * t) * 0.5;
              dAlt = d.altitudeBase + 16 * Math.sin(t * 2);
              // Exact calculus derivatives for zero-noise continuous heading:
              dLon_dt = -d.radiusLon * Math.sin(t);
              dLat_dt = d.radiusLat * Math.cos(2 * t);
            } else {
              dLon = d.radiusLon * Math.cos(t);
              dLat = d.radiusLat * Math.sin(t);
              dAlt = d.altitudeBase + 12 * Math.cos(t);
              // Exact calculus derivatives for zero-noise continuous heading:
              dLon_dt = -d.radiusLon * Math.sin(t);
              dLat_dt = d.radiusLat * Math.cos(t);
            }

            const curLon = d.centerLon + dLon;
            const curLat = d.centerLat + dLat;

            // Exact continuous forward bearing (scaled by cos(19°) for Mumbai latitude)
            const heading = Math.atan2(dLon_dt * 0.9455, dLat_dt);
            const pos = Cesium.Cartesian3.fromDegrees(curLon, curLat, dAlt);

            // Realistic aerodynamic banking (gentle 4-degree roll banking into curves)
            const rollBank = -0.06 * Math.sin(t);
            const hpr = new Cesium.HeadingPitchRoll(heading + Math.PI, 0.04, rollBank);
            const rot = Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);

            dronePositionsRef.current[idx] = pos;
            droneOrientationsRef.current[idx] = rot;
            droneRawHeadingsRef.current[idx] = heading;
            droneCoordsRef.current[idx] = {
              lon: curLon,
              lat: curLat,
              alt: Math.round(dAlt),
              heading: Math.round(Cesium.Math.toDegrees(heading)),
            };
          });

          // A2. Maintain Locked 3D Camera on Tracked Drone (Rigidly pins drone DEAD-CENTER in screen with zero jitter)
          if (trackedDroneIndexRef.current !== null) {
            const tIdx = trackedDroneIndexRef.current;
            const curDronePos = dronePositionsRef.current[tIdx];
            const rawHeading = droneRawHeadingsRef.current[tIdx];
            if (curDronePos && rawHeading !== undefined) {
              const transform = Cesium.Transforms.eastNorthUpToFixedFrame(curDronePos);

              // Target heading: chase angle directly behind the drone's flight path
              const targetHeading = rawHeading + Math.PI + Cesium.Math.toRadians(trackingHeadingDeltaRef.current);

              // Smoothly damp heading with critically damped spring interpolation to eliminate all jitter
              const dt = lastFrameTimeRef.current > 0 ? Math.min(0.05, Math.max(0.001, now - lastFrameTimeRef.current)) : 0.016;
              lastFrameTimeRef.current = now;

              if (smoothedHeadingRef.current === null || isNaN(smoothedHeadingRef.current)) {
                smoothedHeadingRef.current = targetHeading;
              } else {
                // Shortest angular difference wrapping around [-PI, PI]
                let diff = (targetHeading - smoothedHeadingRef.current) % (2 * Math.PI);
                if (diff < -Math.PI) diff += 2 * Math.PI;
                if (diff > Math.PI) diff -= 2 * Math.PI;
                // Exponential decay factor (~4.5 per second gives buttery smooth cinematic tracking)
                const followFactor = 1.0 - Math.exp(-4.5 * dt);
                smoothedHeadingRef.current += diff * followFactor;
              }

              const pitchRad = Cesium.Math.toRadians(trackingPitchRef.current);
              const range = trackingRangeRef.current;
              scratchHpr.heading = smoothedHeadingRef.current;
              scratchHpr.pitch = pitchRad;
              scratchHpr.range = range;
              currentScene.camera.lookAtTransform(transform, scratchHpr);
            }
          } else {
            lastFrameTimeRef.current = now;
            smoothedHeadingRef.current = null;
          }
        });

        // 9. 60FPS DIRECT DOM OVERLAYS (Positioned after 3D frame is rendered)
        const scratchVec = new Cesium.Cartesian2();
        const scratchVec3 = new Cesium.Cartesian3();

        const removePostRender = viewer.scene.postRender.addEventListener(() => {
          if (!viewerRef.current || !viewerRef.current.scene || viewerRef.current.isDestroyed()) return;
          const currentScene = viewerRef.current.scene;
          const cam = viewerRef.current.camera;

          // Drone HTML Overlay Pins (Hide pin for tracked drone so 3D model is unobstructed)
          drones.forEach((d, idx) => {
            const pinEl = dronePinRefs.current[idx];
            if (pinEl) {
              if (!showDroneLabelsRef.current || !showDronesRef.current || trackedDroneIndexRef.current === idx) {
                pinEl.style.opacity = '0';
                pinEl.style.pointerEvents = 'none';
              } else {
                const pos = dronePositionsRef.current[idx];
                if (!pos) return;
                const toDrone = Cesium.Cartesian3.subtract(pos, cam.positionWC, scratchVec3);
                if (Cesium.Cartesian3.dot(cam.directionWC, toDrone) > 0) {
                  const sPos = Cesium.SceneTransforms.worldToWindowCoordinates(currentScene, pos, scratchVec);
                  if (sPos) {
                    pinEl.style.transform = `translate3d(${Math.round(sPos.x)}px, ${Math.round(sPos.y)}px, 0) translate(-50%, -100%) translateY(-32px)`;
                    pinEl.style.opacity = '1';
                    pinEl.style.pointerEvents = 'auto';
                  } else {
                    pinEl.style.opacity = '0';
                    pinEl.style.pointerEvents = 'none';
                  }
                } else {
                  pinEl.style.opacity = '0';
                  pinEl.style.pointerEvents = 'none';
                }
              }
            }
          });

          // B. Hangar Screen Position (Direct DOM Transform)
          if (hangarPinRef.current) {
            const hangarWorld = Cesium.Cartesian3.fromDegrees(MUMBAI_COORD.lon, MUMBAI_COORD.lat, 20);
            const toHangar = Cesium.Cartesian3.subtract(hangarWorld, cam.positionWC, scratchVec3);
            if (Cesium.Cartesian3.dot(cam.directionWC, toHangar) > 0) {
              const sPos = Cesium.SceneTransforms.worldToWindowCoordinates(currentScene, hangarWorld, scratchVec);
              if (sPos) {
                hangarPinRef.current.style.transform = `translate3d(${Math.round(sPos.x)}px, ${Math.round(sPos.y)}px, 0) translate(-50%, -100%) translateY(-12px)`;
                hangarPinRef.current.style.opacity = '1';
                hangarPinRef.current.style.pointerEvents = 'auto';
              } else {
                hangarPinRef.current.style.opacity = '0';
                hangarPinRef.current.style.pointerEvents = 'none';
              }
            } else {
              hangarPinRef.current.style.opacity = '0';
              hangarPinRef.current.style.pointerEvents = 'none';
            }
          }

          // C. Top Hotspots Screen Positions (Direct DOM Transform)
          hotspotPinRefs.current.forEach((pinEl, idx) => {
            if (!pinEl || !hotspots[idx]) return;
            const spot = hotspots[idx];
            const worldPos = Cesium.Cartesian3.fromDegrees(spot.lon, spot.lat, 25);
            const toSpot = Cesium.Cartesian3.subtract(worldPos, cam.positionWC, scratchVec3);
            if (Cesium.Cartesian3.dot(cam.directionWC, toSpot) > 0) {
              const sPos = Cesium.SceneTransforms.worldToWindowCoordinates(currentScene, worldPos, scratchVec);
              if (sPos) {
                pinEl.style.transform = `translate3d(${Math.round(sPos.x)}px, ${Math.round(sPos.y)}px, 0) translate(-50%, -100%) translateY(-12px)`;
                pinEl.style.opacity = '1';
                pinEl.style.pointerEvents = 'auto';
              } else {
                pinEl.style.opacity = '0';
                pinEl.style.pointerEvents = 'none';
              }
            } else {
              pinEl.style.opacity = '0';
              pinEl.style.pointerEvents = 'none';
            }
          });

          // D. Cloud Decks Screen Positions (Direct DOM Transform)
          cloudPinRefs.current.forEach((pinEl, idx) => {
            if (!pinEl || !CLOUD_GAP_ZONES[idx]) return;
            const z = CLOUD_GAP_ZONES[idx];
            const worldPos = Cesium.Cartesian3.fromDegrees(z.lon, z.lat, 400);
            const toCloud = Cesium.Cartesian3.subtract(worldPos, cam.positionWC, scratchVec3);
            if (Cesium.Cartesian3.dot(cam.directionWC, toCloud) > 0) {
              const sPos = Cesium.SceneTransforms.worldToWindowCoordinates(currentScene, worldPos, scratchVec);
              if (sPos) {
                pinEl.style.transform = `translate3d(${Math.round(sPos.x)}px, ${Math.round(sPos.y)}px, 0) translate(-50%, -100%) translateY(-10px)`;
                pinEl.style.opacity = '1';
                pinEl.style.pointerEvents = 'auto';
              } else {
                pinEl.style.opacity = '0';
                pinEl.style.pointerEvents = 'none';
              }
            } else {
              pinEl.style.opacity = '0';
              pinEl.style.pointerEvents = 'none';
            }
          });
        });

        // 9. IMMEDIATE OBLIQUE 3D PERSPECTIVE (Looking Northward across Mumbai toward the horizon at -32° tilt)
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(MUMBAI_COORD.lon, MUMBAI_COORD.lat - 0.038, 3100),
          orientation: {
            heading: Cesium.Math.toRadians(0), // Facing North
            pitch: Cesium.Math.toRadians(-32), // 32° Oblique perspective tilt
            roll: 0.0,
          },
        });

        // 10. Live Camera Telemetry Readout
        viewer.camera.changed.addEventListener(() => {
          const cam = viewer.camera;
          const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cam.positionWC);
          if (carto) {
            const lat = Number(Cesium.Math.toDegrees(carto.latitude).toFixed(4));
            const lon = Number(Cesium.Math.toDegrees(carto.longitude).toFixed(4));
            const alt = Math.max(0, Math.round(carto.height));
            const pitch = Math.round(Cesium.Math.toDegrees(cam.pitch));
            const heading = Math.round(Cesium.Math.toDegrees(cam.heading));

            setHudInfo({ lat, lon, alt, pitch, heading });
            if (onCoordsChange) onCoordsChange({ lat, lon, alt, pitch });
          }
        });

        // Canvas click handler to inspect 3D drone models
        const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        clickHandler.setInputAction((click: any) => {
          const picked = viewer.scene.pick(click.position);
          if (Cesium.defined(picked) && picked.id) {
            const entId = typeof picked.id === 'string' ? picked.id : picked.id.id;
            if (entId && entId.startsWith('drone-')) {
              focusDroneRef.current(entId);
            }
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        setLoading(false);

        return () => {
          try {
            clickHandler.destroy();
            removePreRender();
            removePostRender();
          } catch {}
        };
      })
      .catch((err) => {
        console.error('[Cesium Init Error]:', err);
        setLoading(false);
      });

    return () => {
      isMounted = false;
      if (viewerRef.current) {
        try {
          particleSystemsRef.current.forEach((ps) => {
            try {
              if (viewerRef.current && !viewerRef.current.isDestroyed()) {
                viewerRef.current.scene.primitives.remove(ps);
              }
            } catch {}
          });
          viewerRef.current.destroy();
        } catch {}
        viewerRef.current = null;
      }
    };
  }, [hotspots]);

  // Basemap Switcher
  const handleSwitchImagery = useCallback((mode: ImageryMode) => {
    setImageryMode(mode);
    if (!viewerRef.current || !(window as any).Cesium) return;
    const Cesium = (window as any).Cesium;
    const layers = viewerRef.current.imageryLayers;
    layers.removeAll();

    let provider: any;
    if (mode === 'satellite') {
      provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri, Maxar, Earthstar Geographics',
        maximumLevel: 19,
      });
    } else if (mode === 'dark') {
      provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c', 'd'],
        credit: '© OpenStreetMap contributors, © CARTO',
        maximumLevel: 19,
      });
    } else {
      provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: '© OpenStreetMap contributors',
        maximumLevel: 19,
      });
    }

    layers.add(new Cesium.ImageryLayer(provider));
  }, []);

  // Update Camera Tilt Angle
  const handlePitchChange = (degrees: number) => {
    setPitchAngle(degrees);
    trackingPitchRef.current = degrees;
    if (trackedDroneIndexRef.current !== null) return;
    if (!viewerRef.current || !(window as any).Cesium) return;
    const Cesium = (window as any).Cesium;
    const cam = viewerRef.current.camera;

    cam.setView({
      orientation: {
        heading: cam.heading,
        pitch: Cesium.Math.toRadians(degrees),
        roll: 0.0,
      },
    });
  };

  // Fly-to Location (Free Camera Navigation)
  const flyToLocation = (destLon: number, destLat: number, alt: number, pitch = -32, heading = 0) => {
    if (!viewerRef.current || !(window as any).Cesium) return;
    const Cesium = (window as any).Cesium;
    const cam = viewerRef.current.camera;

    // Release any active drone tracking transform
    if (trackedDroneIndexRef.current !== null) {
      cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
      trackedDroneIndexRef.current = null;
      smoothedHeadingRef.current = null;
      lastFrameTimeRef.current = 0;
      setTrackedDroneId(null);
      if (viewerRef.current.scene?.screenSpaceCameraController) {
        viewerRef.current.scene.screenSpaceCameraController.enableInputs = true;
      }
    }

    cam.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(destLon, destLat - 0.016, alt),
      orientation: {
        heading: Cesium.Math.toRadians(heading),
        pitch: Cesium.Math.toRadians(pitch),
        roll: 0.0,
      },
      duration: 1.5,
    });
    setPitchAngle(pitch);
  };

  // Focus & Lock 3D Camera Directly on a Specific Drone (Guarantees Drone is DEAD-CENTER)
  const focusDrone = (droneId: string) => {
    const idx = drones.findIndex((d) => d.id === droneId);
    if (idx === -1 || !viewerRef.current || !(window as any).Cesium) return;
    const Cesium = (window as any).Cesium;
    const cam = viewerRef.current.camera;
    const c = droneCoordsRef.current[idx];
    const pos = dronePositionsRef.current[idx];
    const rawHeading = droneRawHeadingsRef.current[idx] ?? Cesium.Math.toRadians(c?.heading || 0);

    if (!pos) return;

    // Stop auto-orbit if active
    setIsRotating(false);

    // Reset heading delta, pitch and range
    trackingHeadingDeltaRef.current = 0;
    trackingPitchRef.current = -20;
    trackingRangeRef.current = 55.0;

    const initialTargetHeading = rawHeading + Math.PI;
    smoothedHeadingRef.current = initialTargetHeading;
    lastFrameTimeRef.current = performance.now() * 0.001;

    // Reset previous transform if any
    cam.lookAtTransform(Cesium.Matrix4.IDENTITY);

    // Disable Cesium's screenSpaceCameraController inputs while tracking so mouse drag doesn't conflict
    if (viewerRef.current.scene?.screenSpaceCameraController) {
      viewerRef.current.scene.screenSpaceCameraController.enableInputs = false;
    }

    // Camera offset: 55 meters behind drone, looking down at -20°
    const pitchRad = Cesium.Math.toRadians(-20);
    const range = 55.0;

    // Lock camera reference frame on drone Cartesian3 position
    // This anchors (0, 0, 0) at the drone, placing it DEAD-CENTER in the viewport
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
    cam.lookAtTransform(
      transform,
      new Cesium.HeadingPitchRange(initialTargetHeading, pitchRad, range)
    );

    // Register active tracking index for 60fps preRender lock
    trackedDroneIndexRef.current = idx;
    setTrackedDroneId(droneId);
    setPitchAngle(-20);
  };

  // Exit Drone Tracking & Restore Free Camera
  const exitDroneTracking = () => {
    if (!viewerRef.current || !(window as any).Cesium) return;
    const Cesium = (window as any).Cesium;
    const cam = viewerRef.current.camera;

    trackedDroneIndexRef.current = null;
    smoothedHeadingRef.current = null;
    lastFrameTimeRef.current = 0;
    setTrackedDroneId(null);
    cam.lookAtTransform(Cesium.Matrix4.IDENTITY);

    if (viewerRef.current.scene?.screenSpaceCameraController) {
      viewerRef.current.scene.screenSpaceCameraController.enableInputs = true;
    }

    // Smoothly fly back to regional city perspective
    flyToLocation(MUMBAI_COORD.lon, MUMBAI_COORD.lat - 0.02, 3100, -32, 0);
  };

  // Wire focusDrone to ref so canvas click handlers can invoke it
  focusDroneRef.current = focusDrone;
  const flyToDrone = focusDrone;

  // Toggle Layers
  const toggleParticleClouds = () => {
    setShowParticleClouds((prev) => {
      const next = !prev;
      particleSystemsRef.current.forEach((ps) => {
        ps.show = next;
      });
      return next;
    });
  };

  const togglePlumeBadges = () => {
    setShowPlumeBadges((prev) => {
      const next = !prev;
      hotspotEntitiesRef.current.forEach((e) => {
        e.show = next;
      });
      return next;
    });
  };

  const toggleDrones = () => {
    setShowDrones((prev) => {
      const next = !prev;
      droneEntitiesRef.current.forEach((e) => {
        e.show = next;
      });
      return next;
    });
  };

  const toggleClouds = () => {
    setShowClouds((prev) => {
      const next = !prev;
      cloudEntitiesRef.current.forEach((e) => {
        e.show = next;
      });
      return next;
    });
  };

  const toggleAtmosphere = () => {
    setShowAtmosphere((prev) => {
      const next = !prev;
      if (viewerRef.current) {
        viewerRef.current.scene.globe.showGroundAtmosphere = next;
        viewerRef.current.scene.skyAtmosphere.show = next;
      }
      return next;
    });
  };

  // Auto-Orbit Rotation
  useEffect(() => {
    let timer: any;
    if (isRotating && viewerRef.current && (window as any).Cesium) {
      const Cesium = (window as any).Cesium;
      timer = setInterval(() => {
        viewerRef.current.camera.rotate(Cesium.Cartesian3.UNIT_Z, 0.003);
      }, 30);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRotating]);

  // Pointer & Wheel Interaction for Locked Drone Tracking
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    let isPointerDown = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (trackedDroneIndexRef.current === null) return;
      if (e.button === 0 || e.button === 2) {
        isPointerDown = true;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isPointerDown || trackedDroneIndexRef.current === null) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      // Orbit around drone horizontally (heading)
      trackingHeadingDeltaRef.current += dx * 0.35;
      // Orbit around drone vertically (pitch: -5° near horizon down to -85° overhead)
      trackingPitchRef.current = Math.min(-5, Math.max(-85, trackingPitchRef.current + dy * 0.25));
      setPitchAngle(Math.round(trackingPitchRef.current));
    };

    const onPointerUp = () => {
      isPointerDown = false;
    };

    const onWheel = (e: WheelEvent) => {
      if (trackedDroneIndexRef.current === null) return;
      e.preventDefault();
      const delta = e.deltaY * 0.05;
      // Smooth distance zoom (15m close-up to 180m overview)
      trackingRangeRef.current = Math.min(180, Math.max(15, trackingRangeRef.current + delta));
    };

    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-[#0a0c14] rounded-xl overflow-hidden border border-[#242938]">
      {/* Pure Cesium Viewport */}
      <div ref={mountRef} className="w-full h-full" />

      {/* HARDWARE-ACCELERATED DIRECT DOM OVERLAY (Vector-sharp, zero grain, 60FPS smooth) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
        {/* Hangar Base Pill Marker */}
        <div
          ref={hangarPinRef}
          onClick={() => flyToLocation(MUMBAI_COORD.lon, MUMBAI_COORD.lat, 1100, -28, 5)}
          className="absolute top-0 left-0 opacity-0 pointer-events-none cursor-pointer flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0a0f1d]/90 border border-cyan-400/50 backdrop-blur-md shadow-xl shadow-cyan-950/40 hover:scale-105 transition-all select-none will-change-transform"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
          </span>
          <span className="text-xs font-semibold text-white tracking-wide">AirQ Hangar</span>
          <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/15 px-1.5 py-0.5 rounded">BKC</span>
        </div>

        {/* 3D Drone Badges (Moving smoothly with the drones in real-time) */}
        {showDrones && showDroneLabels &&
          drones.map((d, idx) => (
            <div
              key={d.id}
              ref={(el) => {
                dronePinRefs.current[idx] = el;
              }}
              onClick={() => flyToDrone(d.id)}
              className="absolute top-0 left-0 opacity-0 pointer-events-none cursor-pointer flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#080d19]/90 border backdrop-blur-md shadow-lg hover:scale-105 transition-all select-none will-change-transform"
              style={{ borderColor: `${d.color}66` }}
            >
              <Navigation className="w-3 h-3 animate-pulse" style={{ color: d.color }} />
              <span className="text-xs font-bold text-white">{d.callsign}</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: d.color }}>
                {d.currentReading}
              </span>
            </div>
          ))}

        {/* Top Hotspots Sleek Floating Chips */}
        {showPlumeBadges &&
          hotspots.slice(0, 4).map((spot, idx) => {
            const isCritical = spot.no2 >= 300;
            return (
              <div
                key={spot.id}
                ref={(el) => {
                  hotspotPinRefs.current[idx] = el;
                }}
                onClick={() => {
                  setSelectedHotspot(spot);
                  flyToLocation(spot.lon, spot.lat, 1400, -28, 12);
                }}
                className={`absolute top-0 left-0 opacity-0 pointer-events-none cursor-pointer flex items-center gap-1.5 px-2.5 py-0.5 rounded-full backdrop-blur-md shadow-lg transition-all hover:scale-105 select-none will-change-transform ${
                  isCritical
                    ? 'bg-[#180a0f]/90 border border-rose-500/50 shadow-rose-950/40'
                    : 'bg-[#1a1006]/90 border border-amber-500/50 shadow-amber-950/40'
                }`}
              >
                <Flame className={`w-3 h-3 ${isCritical ? 'text-rose-500 animate-pulse' : 'text-amber-400'}`} />
                <span className="text-xs font-medium text-white">{spot.shortName}</span>
                <span className={`text-[10px] font-mono font-bold ${isCritical ? 'text-rose-400' : 'text-amber-400'}`}>
                  {spot.no2}
                </span>
              </div>
            );
          })}

        {/* Cloud Gap Subtle Tags */}
        {showClouds &&
          CLOUD_GAP_ZONES.map((z, idx) => (
            <div
              key={z.id}
              ref={(el) => {
                cloudPinRefs.current[idx] = el;
              }}
              className="absolute top-0 left-0 opacity-0 pointer-events-none cursor-pointer flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#0a121c]/90 border border-sky-400/40 backdrop-blur-md shadow-md text-zinc-300 hover:text-white transition-all select-none will-change-transform"
            >
              <CloudRain className="w-3 h-3 text-sky-400" />
              <span className="text-[11px] font-medium text-zinc-200">{z.name}</span>
              <span className="text-[9px] font-mono text-sky-400 font-bold">{Math.round(z.gapScore * 100)}%</span>
            </div>
          ))}
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-[#0a0c14]/90 backdrop-blur-md flex flex-col items-center justify-center z-50">
          <Globe2 className="w-10 h-10 text-cyan-400 animate-spin mb-3" style={{ animationDuration: '6s' }} />
          <span className="text-sm font-bold text-white tracking-wide">
            Deploying Coordinated 3D UAV Swarm & AI Engine...
          </span>
          <span className="text-xs text-zinc-400 mt-1">
            Synchronizing drone flight trajectories with real Sentinel-5P NO₂ plumes
          </span>
        </div>
      )}

      {/* Top Floating Control Bar (Constrained to never collide with top-right Scene panel) */}
      <div className="absolute top-4 left-4 max-w-[calc(100%-20rem)] flex flex-wrap items-center gap-2 z-20">
        {/* Basemap Imagery Mode Switcher */}
        <div className="flex items-center rounded-lg bg-[#11141d]/90 backdrop-blur-md border border-[#242938] p-0.5 shadow-xl">
          <button
            onClick={() => handleSwitchImagery('satellite')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
              imageryMode === 'satellite'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Satellite HD
          </button>

          <button
            onClick={() => handleSwitchImagery('dark')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
              imageryMode === 'dark'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Dark Cyber
          </button>

          <button
            onClick={() => handleSwitchImagery('osm')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
              imageryMode === 'osm'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Street Map
          </button>
        </div>

        {/* Quick Camera Flight Presets */}
        <div className="flex items-center rounded-lg bg-[#11141d]/90 backdrop-blur-md border border-[#242938] p-0.5 shadow-xl">
          <button
            onClick={() => flyToLocation(MUMBAI_COORD.lon, MUMBAI_COORD.lat - 0.02, 3100, -32, 0)}
            className="px-2 py-1 rounded text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-colors"
          >
            Overview
          </button>
          <button
            onClick={() => flyToLocation(MUMBAI_COORD.lon, MUMBAI_COORD.lat, 1100, -28, 5)}
            className="px-2 py-1 rounded text-xs font-medium text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/10 transition-colors flex items-center gap-1"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Hangar (BKC)
          </button>
          <button
            onClick={() => flyToLocation(72.9275, 19.0225, 1400, -28, 15)}
            className="px-2 py-1 rounded text-xs font-medium text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 transition-colors flex items-center gap-1"
          >
            <Flame className="w-3 h-3 text-rose-500" />
            Chembur
          </button>
          <button
            onClick={() => flyToLocation(72.9625, 18.9875, 1500, -28, 20)}
            className="px-2 py-1 rounded text-xs font-medium text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 transition-colors"
          >
            JNPT Port
          </button>
        </div>

        {/* Quick UAV 3D Focus & Inspection Buttons */}
        <div className="flex items-center rounded-lg bg-[#11141d]/90 backdrop-blur-md border border-[#242938] p-0.5 shadow-xl">
          <span className="text-[10px] uppercase font-mono font-bold text-zinc-400 px-2 flex items-center gap-1">
            <Crosshair className="w-3 h-3 text-cyan-400" />
            UAV:
          </span>
          {drones.map((d) => {
            const isCurrent = trackedDroneId === d.id;
            return (
              <button
                key={d.id}
                onClick={() => focusDrone(d.id)}
                className={`px-2 py-1 rounded text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  isCurrent
                    ? 'bg-cyan-500/25 border border-cyan-400 text-white shadow-md'
                    : 'hover:bg-white/10 text-zinc-300'
                }`}
                style={{ color: isCurrent ? '#ffffff' : d.color }}
                title={`Lock Camera on 3D ${d.name} (Dead-Center)`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isCurrent ? 'animate-ping' : ''}`} style={{ backgroundColor: d.color }} />
                <span>{d.callsign}</span>
              </button>
            );
          })}
          {trackedDroneId && (
            <button
              onClick={exitDroneTracking}
              className="ml-1 px-2 py-1 rounded text-xs font-medium bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-colors flex items-center gap-1"
              title="Unlock Camera & Return to City Overview"
            >
              <X className="w-3 h-3" />
              <span>Exit</span>
            </button>
          )}
        </div>
      </div>

      {/* Top Center: Active Drone Lock Banner */}
      {trackedDroneId && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#0a0f1e]/95 border border-cyan-400/60 backdrop-blur-xl shadow-2xl animate-in fade-in slide-in-from-top-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
          </span>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-400 font-mono text-[11px]">3D CAMERA LOCKED:</span>
            <span className="font-bold text-white">
              {drones.find((d) => d.id === trackedDroneId)?.name || 'UAV'}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold border border-cyan-500/30">
              CENTERED
            </span>
          </div>
          <div className="hidden sm:flex items-center text-[10px] text-zinc-400 font-mono pl-1 border-l border-zinc-700/60">
            <span>Drag: Orbit • Scroll: Zoom</span>
          </div>
          <button
            onClick={exitDroneTracking}
            className="ml-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span>Exit Tracking</span>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Centered HUD Reticle when locked on a drone */}
      {trackedDroneId && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="relative w-28 h-28 rounded-full border border-cyan-400/20 flex items-center justify-center animate-pulse">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-0.5 bg-cyan-400/60" />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-0.5 bg-cyan-400/60" />
            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-3 w-0.5 bg-cyan-400/60" />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-0.5 bg-cyan-400/60" />
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/40" />
          </div>
        </div>
      )}

      {/* Top Right Floating Controls: Unified Compact Scene & Layers Panel (Zero Tab Overlap) */}
      <div className="absolute top-4 right-4 z-20 w-72 bg-[#0f131f]/95 backdrop-blur-xl border border-[#242938] rounded-2xl shadow-2xl overflow-hidden transition-all duration-200">
        {/* Panel Header with Collapse Toggle */}
        <div
          onClick={() => setIsLayersCollapsed((c) => !c)}
          className="p-2.5 bg-gradient-to-r from-blue-950/30 to-purple-950/20 border-b border-white/5 flex items-center justify-between cursor-pointer select-none hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white tracking-wide">Scene & Atmosphere</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
              {Math.abs(pitchAngle)}° Tilt
            </span>
          </div>
          <button className="text-zinc-400 hover:text-white p-0.5">
            {isLayersCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>

        {!isLayersCollapsed && (
          <div className="p-3 space-y-2.5">
            {/* Tilt Slider */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-300 mb-1">
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3 h-3 text-cyan-400" />
                  Perspective Tilt
                </span>
                <span className="font-mono text-cyan-400 font-bold">{Math.abs(pitchAngle)}°</span>
              </div>
              <input
                type="range"
                min="-85"
                max="-15"
                step="1"
                value={pitchAngle}
                onChange={(e) => handlePitchChange(Number(e.target.value))}
                className="w-full accent-cyan-500 h-1 bg-zinc-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[9px] font-mono text-zinc-500 mt-0.5">
                <span>-85° Top</span>
                <span>-32° 3D</span>
                <span>-15° Horizon</span>
              </div>
            </div>

            {/* Turntable Auto-Orbit Button */}
            <button
              onClick={() => setIsRotating((r) => !r)}
              className={`w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-semibold border transition-all ${
                isRotating
                  ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-950/50'
                  : 'bg-[#141824]/60 border-[#242938] text-zinc-300 hover:text-white hover:bg-white/5'
              }`}
              title="Toggle continuous 360° turntable rotation around view center"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isRotating ? 'animate-spin text-cyan-400' : 'text-zinc-400'}`} />
              <span>{isRotating ? '360° Orbit (Active)' : 'Auto-Orbit 360°'}</span>
            </button>

            <div className="h-px bg-white/5" />

            {/* Compact 2-Column Layer Checkboxes */}
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <label className="flex items-center gap-1.5 p-1.5 rounded-lg bg-[#141824]/60 hover:bg-[#1a2030] cursor-pointer text-zinc-300 hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={showDrones}
                  onChange={toggleDrones}
                  className="accent-cyan-500 rounded w-3 h-3"
                />
                <span className="truncate">3D Drones</span>
              </label>

              <label className="flex items-center gap-1.5 p-1.5 rounded-lg bg-[#141824]/60 hover:bg-[#1a2030] cursor-pointer text-zinc-300 hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={showDroneLabels}
                  onChange={() => setShowDroneLabels((p) => !p)}
                  className="accent-cyan-500 rounded w-3 h-3"
                />
                <span className="truncate">UAV Badges</span>
              </label>

              <label className="flex items-center gap-1.5 p-1.5 rounded-lg bg-[#141824]/60 hover:bg-[#1a2030] cursor-pointer text-zinc-300 hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={showParticleClouds}
                  onChange={toggleParticleClouds}
                  className="accent-rose-500 rounded w-3 h-3"
                />
                <span className="truncate">Smog Puffs</span>
              </label>

              <label className="flex items-center gap-1.5 p-1.5 rounded-lg bg-[#141824]/60 hover:bg-[#1a2030] cursor-pointer text-zinc-300 hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={showPlumeBadges}
                  onChange={togglePlumeBadges}
                  className="accent-amber-500 rounded w-3 h-3"
                />
                <span className="truncate">NO₂ Badges</span>
              </label>

              <label className="flex items-center gap-1.5 p-1.5 rounded-lg bg-[#141824]/60 hover:bg-[#1a2030] cursor-pointer text-zinc-300 hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={showClouds}
                  onChange={toggleClouds}
                  className="accent-sky-500 rounded w-3 h-3"
                />
                <span className="truncate">Clouds</span>
              </label>

              <label className="flex items-center gap-1.5 p-1.5 rounded-lg bg-[#141824]/60 hover:bg-[#1a2030] cursor-pointer text-zinc-300 hover:text-white transition-colors">
                <input
                  type="checkbox"
                  checked={showAtmosphere}
                  onChange={toggleAtmosphere}
                  className="accent-yellow-500 rounded w-3 h-3"
                />
                <span className="truncate">Atmosphere</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Left Bottom Drawer: High NO2 Pollution Hotspots from Main App (Compact & Collapsible) */}
      <div className="absolute bottom-4 left-4 z-20 w-72 sm:w-80 bg-[#11141d]/95 backdrop-blur-xl border border-[#242938] rounded-xl p-3 shadow-2xl transition-all duration-200">
        <div
          onClick={() => setIsBasinsCollapsed((c) => !c)}
          className="flex items-center justify-between cursor-pointer select-none border-b border-white/10 pb-2 mb-1 hover:bg-white/5 p-1 -m-1 rounded transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-rose-500 animate-pulse" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Pollution Basins
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
              Sentinel-5P
            </span>
            <button className="text-zinc-400 hover:text-white p-0.5">
              {isBasinsCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {!isBasinsCollapsed && (
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 mt-2">
            {hotspots.map((spot, idx) => (
              <button
                key={spot.id}
                onClick={() => {
                  setSelectedHotspot(spot);
                  flyToLocation(spot.lon, spot.lat, 1450, -28, 12);
                }}
                className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all border ${
                  selectedHotspot?.id === spot.id
                    ? 'bg-rose-500/20 border-rose-500/50 text-white'
                    : 'bg-[#161a26]/70 border-[#242938] text-zinc-300 hover:bg-[#1f2537] hover:border-zinc-600'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-semibold truncate flex items-center gap-1">
                    <span className="font-mono text-zinc-500 text-[10px]">#{idx + 1}</span>
                    <span className="truncate">{spot.name}</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                    {spot.description}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs font-mono font-bold text-rose-400 block">
                    {spot.no2}
                  </span>
                  <span className="text-[9px] font-mono text-zinc-500 uppercase block">
                    µg/m³
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* FLOATING LLM SWARM INTELLIGENCE INSIGHTS TAB (Compact Width to prevent overlap) */}
      <div className="absolute bottom-4 right-4 z-20 w-80 sm:w-84 bg-[#0f1422]/95 backdrop-blur-xl border border-cyan-500/30 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300">
        {/* Floating Tab Header */}
        <div className="p-3 bg-gradient-to-r from-cyan-950/40 via-blue-950/30 to-purple-950/40 border-b border-cyan-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-300">
              <Bot className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white tracking-wide">Swarm Intelligence Insights</span>
                <span className="flex h-1.5 w-1.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
              </div>
              <span className="text-[10px] text-zinc-400 block">
                Continuous AI decisions · ~5.5s readable pace
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsDecisionStreamPaused((p) => !p)}
              className="p-1.5 rounded-lg bg-[#161e31] hover:bg-[#1f2b45] text-zinc-300 hover:text-white transition-colors border border-white/10"
              title={isDecisionStreamPaused ? 'Resume Decision Stream' : 'Pause Decision Stream'}
            >
              {isDecisionStreamPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
            </button>

            <button
              onClick={() => setIsDecisionsTabMinimized((m) => !m)}
              className="p-1.5 rounded-lg bg-[#161e31] hover:bg-[#1f2b45] text-zinc-300 hover:text-white transition-colors border border-white/10"
              title={isDecisionsTabMinimized ? 'Expand Tab' : 'Minimize Tab'}
            >
              {isDecisionsTabMinimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Floating Tab Body: Continuous Stream of Simple-Language Decisions */}
        {!isDecisionsTabMinimized && (
          <div className="p-2.5 space-y-2 max-h-48 overflow-y-auto pr-1.5">
            {decisions.map((dec) => (
              <div
                key={dec.id}
                className="p-2.5 rounded-xl bg-[#141b2d]/85 border border-[#222e49] hover:border-cyan-500/40 transition-all text-left group"
              >
                {/* Meta Header */}
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-cyan-300">{dec.droneName}</span>
                    <span className="text-zinc-500">·</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${dec.badgeColor}`}>
                      {dec.title}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-zinc-500">{dec.timestamp}</span>
                </div>

                {/* Plain English Decision Text */}
                <p className="text-xs text-zinc-200 leading-relaxed font-sans mb-1.5">
                  {dec.message}
                </p>

                {/* Actionable Footer: Ground truth badge + Center on Drone action */}
                <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px]">
                  <span className="text-zinc-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-cyan-400" />
                    <span>{dec.zone}</span>
                  </span>

                  <button
                    onClick={() => focusDrone(dec.droneId)}
                    className="flex items-center gap-1 text-cyan-400 hover:text-cyan-200 font-medium px-2 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors"
                  >
                    <span>Follow UAV</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab Summary Footer */}
        <div className="px-3 py-2 bg-[#0b0f1a] border-t border-white/5 flex items-center justify-between text-[10px] text-zinc-400 font-mono">
          <div className="flex items-center gap-1.5">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span>4 UAVs Synchronized</span>
          </div>
          <span className="text-zinc-500">LLM Consensus Loop</span>
        </div>
      </div>

      {/* Bottom Center HUD: Live Telemetry & Coordinate Readout (Sleek Compact Pill) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#0b0e18]/90 backdrop-blur-xl border border-white/10 rounded-full px-3.5 py-1.5 text-[11px] font-mono text-zinc-300 shadow-2xl z-20 hidden lg:flex items-center gap-3 select-none pointer-events-none whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-zinc-500 text-[10px]">CAM</span>
          <span className="text-white font-semibold">{hudInfo.lat.toFixed(3)}°N, {hudInfo.lon.toFixed(3)}°E</span>
        </div>
        <div className="h-2.5 w-px bg-white/15" />
        <div>
          <span className="text-zinc-500 text-[10px]">ALT</span>{' '}
          <span className="text-cyan-300 font-semibold">{hudInfo.alt}m</span>
        </div>
        <div className="h-2.5 w-px bg-white/15" />
        <div>
          <span className="text-zinc-500 text-[10px]">TILT</span>{' '}
          <span className="text-emerald-300 font-semibold">{Math.abs(hudInfo.pitch)}°</span>
        </div>
        <div className="h-2.5 w-px bg-white/15" />
        <div>
          <span className="text-zinc-500 text-[10px]">HDG</span>{' '}
          <span className="text-amber-300 font-semibold">{hudInfo.heading}°</span>
        </div>
      </div>
    </div>
  );
}
