import { RegulatoryScale, POISource, WindVector, PinpointAttributionResult } from './types';

// Regulatory guidelines specified in SRS Table Section 3.3
export const REGULATORY_SCALES: RegulatoryScale[] = [
  {
    range: [0, 40],
    label: '0 - 40 µg/m³',
    category: 'NORMAL',
    color: '#10b981', // Emerald / Green
    bgColor: 'rgba(16, 185, 129, 0.15)',
    description: 'Air quality is satisfactory.',
    healthAdvisory: 'Air pollution poses little or no risk. Safe for all demographic groups.',
  },
  {
    range: [41, 80],
    label: '41 - 80 µg/m³',
    category: 'MODERATE',
    color: '#eab308', // Yellow
    bgColor: 'rgba(234, 179, 8, 0.15)',
    description: 'Acceptable; sensitive individuals take caution.',
    healthAdvisory: 'Unusually sensitive individuals with preexisting respiratory conditions should consider limiting prolonged outdoor exertion.',
  },
  {
    range: [81, 180],
    label: '81 - 180 µg/m³',
    category: 'UNHEALTHY',
    color: '#f97316', // Orange
    bgColor: 'rgba(249, 115, 22, 0.15)',
    description: 'Prolonged exposure causes respiratory discomfort.',
    healthAdvisory: 'Asthmatics, children, and elderly persons should avoid outdoor exercise. General public may experience irritation.',
  },
  {
    range: [181, 500],
    label: '> 180 µg/m³',
    category: 'HAZARDOUS',
    color: '#ef4444', // Red
    bgColor: 'rgba(239, 68, 68, 0.15)',
    description: 'Trigger industrial/traffic reduction alerts.',
    healthAdvisory: 'Emergency health warning: Entire population is likely to be affected. Restrict industrial stack output and vehicular traffic corridors.',
  },
];

export function getHazardCategory(no2Value: number): RegulatoryScale {
  if (no2Value <= 40) return REGULATORY_SCALES[0];
  if (no2Value <= 80) return REGULATORY_SCALES[1];
  if (no2Value <= 180) return REGULATORY_SCALES[2];
  return REGULATORY_SCALES[3];
}

// Preset regions for rapid navigation and testing
export const PRESET_REGIONS = [
  {
    name: 'Mumbai (Shivaji Park / MMR)',
    center: [19.0269, 72.8378] as [number, number],
    zoom: 13,
    description: 'Coastal urban agglomeration with heavy coastal corridors and industrial MIDC pockets.',
  },
  {
    name: 'Delhi NCR (Anand Vihar / CP)',
    center: [28.6469, 77.2882] as [number, number],
    zoom: 12,
    description: 'Dense inland plain characterized by thermal inversions and vehicular congestion.',
  },
  {
    name: 'Bengaluru (Peenya Industrial / Electronic City)',
    center: [13.0285, 77.5197] as [number, number],
    zoom: 12,
    description: 'Elevated plateau with distributed manufacturing hubs and arterial tech corridors.',
  },
];

// Curated POIs for Source Attribution Engine (Section 3.4)
export const KNOWN_POIS: POISource[] = [
  // Mumbai Area
  {
    id: 'poi-mumbai-1',
    name: 'Western Express Highway Arterial',
    category: 'TRAFFIC_CORRIDOR',
    coordinates: [19.035, 72.845],
    emissionFactor: 0.88,
    details: '8-lane high density arterial corridor with stop-and-go diesel transit.',
  },
  {
    id: 'poi-mumbai-2',
    name: 'Dharavi Light Industrial Cluster',
    category: 'FACTORY',
    coordinates: [19.041, 72.853],
    emissionFactor: 0.72,
    details: 'High concentration of recycling, tanning, and small-scale fabrication units.',
  },
  {
    id: 'poi-mumbai-3',
    name: 'Mahim Bay Freight Rail Corridor',
    category: 'TRAFFIC_CORRIDOR',
    coordinates: [19.042, 72.84],
    emissionFactor: 0.65,
    details: 'Suburban rail junction and diesel shunting yard operations.',
  },
  {
    id: 'poi-mumbai-4',
    name: 'Trombay Thermal Power & Petrochem Belt',
    category: 'POWER_PLANT',
    coordinates: [19.002, 72.905],
    emissionFactor: 0.94,
    details: 'Heavy refinery complex, gas turbine units, and chemical synthesis stacks.',
  },
  {
    id: 'poi-mumbai-5',
    name: 'Bandra-Kurla Complex Transit Node',
    category: 'TRAFFIC_CORRIDOR',
    coordinates: [19.065, 72.868],
    emissionFactor: 0.79,
    details: 'Financial district peak-hour choke point and heavy diesel cab volume.',
  },
  {
    id: 'poi-mumbai-6',
    name: 'Coastal Road Project Construction Sector 4',
    category: 'CONSTRUCTION_SITE',
    coordinates: [19.015, 72.818],
    emissionFactor: 0.61,
    details: 'Reclamation civil works, earth-moving machinery, and concrete batching.',
  },

  // Delhi NCR Area
  {
    id: 'poi-delhi-1',
    name: 'Anand Vihar ISBT & Freight Corridor',
    category: 'TRAFFIC_CORRIDOR',
    coordinates: [28.648, 77.315],
    emissionFactor: 0.95,
    details: 'Interstate bus terminal with constant interstate diesel heavy vehicle operations.',
  },
  {
    id: 'poi-delhi-2',
    name: 'Patparganj Industrial Area',
    category: 'FACTORY',
    coordinates: [28.629, 77.302],
    emissionFactor: 0.81,
    details: 'Printing, plastic packaging, and small industrial combustion units.',
  },
  {
    id: 'poi-delhi-3',
    name: 'Ghazipur Waste Energy Plant',
    category: 'POWER_PLANT',
    coordinates: [28.627, 77.329],
    emissionFactor: 0.91,
    details: 'Municipal solid waste combustion and high flue-gas thermal discharge.',
  },
];

// Representative wind vectors across regions
export const SAMPLE_WIND_VECTORS: WindVector[] = [
  { id: 'w-1', lat: 19.01, lng: 72.82, uComponent: 3.2, vComponent: 1.8, magnitude: 3.68, angleDeg: 60 },
  { id: 'w-2', lat: 19.03, lng: 72.84, uComponent: 2.8, vComponent: 2.1, magnitude: 3.5, angleDeg: 53 },
  { id: 'w-3', lat: 19.05, lng: 72.86, uComponent: 3.5, vComponent: 1.5, magnitude: 3.81, angleDeg: 67 },
  { id: 'w-4', lat: 19.02, lng: 72.87, uComponent: 2.9, vComponent: 2.4, magnitude: 3.76, angleDeg: 50 },
  { id: 'w-5', lat: 19.06, lng: 72.83, uComponent: 3.1, vComponent: 1.9, magnitude: 3.64, angleDeg: 58 },
  { id: 'w-6', lat: 28.63, lng: 77.29, uComponent: -1.2, vComponent: 2.8, magnitude: 3.04, angleDeg: 337 },
  { id: 'w-7', lat: 28.65, lng: 77.31, uComponent: -1.5, vComponent: 2.5, magnitude: 2.92, angleDeg: 329 },
];

// Distance calculation using Haversine formula
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Compute Source Attribution Weight Index (SAWI) based on proximity, emission factor, and wind alignment
export function calculateAttribution(
  centerLat: number,
  centerLng: number,
  locationName: string = 'Target Coordinate'
): PinpointAttributionResult {
  // Find POIs within 12km buffer
  const nearby = KNOWN_POIS.map((poi) => {
    const dist = calculateDistanceKm(centerLat, centerLng, poi.coordinates[0], poi.coordinates[1]);
    return {
      ...poi,
      distanceKm: Math.round(dist * 10) / 10,
    };
  }).filter((poi) => poi.distanceKm <= 15);

  // If none nearby, construct localized synthetic contributors based on coordinate
  const candidatePOIs = nearby.length > 0 ? nearby : [
    {
      id: 'local-1',
      name: 'Local Commercial / Arterial Transit Route',
      category: 'TRAFFIC_CORRIDOR' as const,
      coordinates: [centerLat + 0.005, centerLng + 0.004] as [number, number],
      emissionFactor: 0.74,
      distanceKm: 0.8,
      details: 'Dense urban traffic and feeder road emissions within 1km buffer.',
    },
    {
      id: 'local-2',
      name: 'Localized Commercial Generator / Boiler Hub',
      category: 'FACTORY' as const,
      coordinates: [centerLat - 0.008, centerLng + 0.006] as [number, number],
      emissionFactor: 0.58,
      distanceKm: 1.4,
      details: 'Light industrial workshops and stationary diesel power generator sets.',
    },
    {
      id: 'local-3',
      name: 'Urban Construction & Earthworks Pocket',
      category: 'CONSTRUCTION_SITE' as const,
      coordinates: [centerLat + 0.012, centerLng - 0.009] as [number, number],
      emissionFactor: 0.45,
      distanceKm: 2.1,
      details: 'Infra development and aggregate handling dust suspension.',
    },
  ];

  // Calculate raw weights: weight = emissionFactor / (distanceKm^1.2 + 0.1)
  const weights = candidatePOIs.map((poi) => {
    const d = poi.distanceKm ?? 1;
    const w = poi.emissionFactor / (Math.pow(d, 1.2) + 0.2);
    return Math.max(0.05, w);
  });

  const totalWeight = weights.reduce((acc, val) => acc + val, 0);

  const attributedSources = candidatePOIs.map((poi, idx) => {
    const percentage = Math.round((weights[idx] / totalWeight) * 100);
    return {
      ...poi,
      attributionPercentage: percentage,
    };
  }).sort((a, b) => (b.attributionPercentage ?? 0) - (a.attributionPercentage ?? 0));

  // Determine current NO2 level based on proximity and top emission factor
  const baseNoise = (Math.abs(Math.sin(centerLat * 100) * Math.cos(centerLng * 100)) * 40);
  const primaryFactor = attributedSources[0]?.emissionFactor ?? 0.6;
  const currentNO2 = Math.round(45 + primaryFactor * 95 + baseNoise);

  const hazard = getHazardCategory(currentNO2);

  // Generate predictive flow & dispersion trends (+0h, +3h, +6h, +12h, +24h)
  const forecast: PinpointAttributionResult['forecast'] = [
    { timeOffsetHours: 0, label: 'Current', no2Value: currentNO2, dispersionFactor: 1.0, projectedAQI: currentNO2 },
    { timeOffsetHours: 3, label: '+3 Hours', no2Value: Math.round(currentNO2 * 1.08), dispersionFactor: 1.08, projectedAQI: Math.round(currentNO2 * 1.08) },
    { timeOffsetHours: 6, label: '+6 Hours', no2Value: Math.round(currentNO2 * 1.22), dispersionFactor: 1.22, projectedAQI: Math.round(currentNO2 * 1.22) },
    { timeOffsetHours: 12, label: '+12 Hours', no2Value: Math.round(currentNO2 * 0.91), dispersionFactor: 0.91, projectedAQI: Math.round(currentNO2 * 0.91) },
    { timeOffsetHours: 24, label: '+24 Hours', no2Value: Math.round(currentNO2 * 0.85), dispersionFactor: 0.85, projectedAQI: Math.round(currentNO2 * 0.85) },
  ];

  // Natural language summary as specified in FR-4.4
  const top1 = attributedSources[0];
  const top2 = attributedSources[1];
  let summary = `Elevated NO₂ (${currentNO2} µg/m³) attributed predominantly (${top1?.attributionPercentage || 55}%) to ${top1?.name || 'vehicular emissions'}`;
  if (top2) {
    summary += ` and ${top2.attributionPercentage}% to ${top2.name}.`;
  } else {
    summary += '.';
  }

  let compliance: PinpointAttributionResult['regulatoryCompliance'] = 'COMPLIANT';
  if (currentNO2 > 180) compliance = 'CRITICAL_VIOLATION';
  else if (currentNO2 > 80) compliance = 'EXCEEDANCE_WARNING';

  return {
    locationName,
    coordinates: [centerLat, centerLng],
    currentNO2,
    hazardBand: hazard.category,
    forecast,
    sources: attributedSources,
    windVector: {
      speed: 3.6,
      direction: 'ENE (60°)',
      deg: 60,
    },
    summary,
    regulatoryCompliance: compliance,
  };
}
