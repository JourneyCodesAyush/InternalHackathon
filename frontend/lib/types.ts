export type HazardBand = 'NORMAL' | 'MODERATE' | 'UNHEALTHY' | 'HAZARDOUS';

export interface RegulatoryScale {
  range: [number, number];
  label: string;
  category: HazardBand;
  color: string;
  bgColor: string;
  description: string;
  healthAdvisory: string;
}

export interface MapLayerConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  opacity: number;
}

export interface POISource {
  id: string;
  name: string;
  category: 'FACTORY' | 'TRAFFIC_CORRIDOR' | 'POWER_PLANT' | 'CONSTRUCTION_SITE';
  coordinates: [number, number]; // [lat, lng]
  emissionFactor: number; // 0.0 - 1.0
  distanceKm?: number;
  attributionPercentage?: number;
  details: string;
}

export interface GridCell {
  id: string;
  bounds: [[number, number], [number, number]]; // [[south, west], [north, east]]
  center: [number, number];
  rawCoarseNO2: number; // µg/m³
  downscaledNO2: number; // high-res µg/m³
  cloudCoverPercent: number; // 0 - 100%
  interpolated: boolean;
  windSpeedMs: number;
  windDirectionDeg: number;
}

export interface WindVector {
  id: string;
  lat: number;
  lng: number;
  uComponent: number; // m/s
  vComponent: number; // m/s
  magnitude: number;  // m/s
  angleDeg: number;   // meteorological degrees
}

export interface TrendForecastPoint {
  timeOffsetHours: number; // e.g., 0, 3, 6, 12, 24
  label: string;
  no2Value: number;
  dispersionFactor: number;
  projectedAQI: number;
}

export interface PinpointAttributionResult {
  locationName: string;
  coordinates: [number, number];
  currentNO2: number;
  hazardBand: HazardBand;
  forecast: TrendForecastPoint[];
  sources: POISource[];
  windVector: {
    speed: number;
    direction: string;
    deg: number;
  };
  summary: string;
  regulatoryCompliance: 'COMPLIANT' | 'EXCEEDANCE_WARNING' | 'CRITICAL_VIOLATION';
}

export type UploadStatus = 'QUEUED' | 'UPLOADING' | 'CLEANING_MODEL' | 'DOWNSCALING' | 'COMPLETED' | 'FAILED';

export interface UploadedSatelliteFile {
  id: string;
  name: string;
  sizeBytes: number;
  type: string;
  lastModified: number;
  status: UploadStatus;
  progressPercent: number;
  previewUrl?: string;
  processedResultUrl?: string;
  stats?: {
    cloudCoverInitial: number; // %
    cloudCoverCleaned: number; // %
    originalResolution: string; // e.g. "7km x 3.5km"
    downscaledResolution: string; // e.g. "1km x 1km"
    meanNO2: number; // µg/m³
    peakNO2: number; // µg/m³
    processingDurationSec: number;
  };
  error?: string;
}
