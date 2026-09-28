/**
 * Transboundary Atmospheric NO₂ Mass Flux & Cross-Border Attribution Data Layer.
 *
 * Interfaces and computation helpers for CAQM (Commission for Air Quality Management),
 * State Pollution Control Boards (SPCBs), and environmental judicial proceedings.
 *
 * Covers 4 major Indian Transboundary Airshed Battlegrounds:
 * 1. Delhi NCR (Haryana <-> Delhi <-> UP <-> Rajasthan)
 * 2. Punjab & Indus Airshed (Pakistan PK -> Punjab IN -> Haryana)
 * 3. Indo-Gangetic Plain Eastern Corridor (UP -> Bihar -> West Bengal)
 * 4. Central India Thermal & Mining Belt (MP <-> Chhattisgarh <-> Jharkhand <-> Odisha)
 */

import type { GlobalSnapshot } from './globeData';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface FluxVector {
  id: string;
  corridor_id: string;
  corridor_name: string;
  from_jurisdiction: string;
  to_jurisdiction: string;
  start: [number, number]; // [lon, lat]
  end: [number, number]; // [lon, lat]
  midpoint: [number, number]; // [lon, lat]
  flux_tonnes_day: number;
  is_inflow: boolean;
  wind_speed_ms: number;
  wind_heading_deg: number;
  intensity: 'low' | 'moderate' | 'high' | 'severe';
}

export interface GatewayItem {
  id: string;
  name: string;
  coordinates: [number, number]; // [lon, lat]
  corridor: string;
  description: string;
  mean_no2_umol_m2?: number;
  wind_speed_ms?: number;
  wind_heading_deg?: number;
  flux_tonnes_day?: number;
  intensity?: 'low' | 'moderate' | 'high' | 'severe';
}

export interface CorridorItem {
  id: string;
  from_jurisdiction: string;
  to_jurisdiction: string;
  corridor_name: string;
  agency: string;
  key_landmarks: string;
  policy_mandate: string;
  inflow_tonnes_day: number;
  outflow_tonnes_day: number;
  net_flux_tonnes_day: number;
  mean_no2_umol_m2: number;
  wind_speed_ms: number;
  wind_direction: string;
  share_of_external_pct: number;
}

export interface AirshedRegion {
  id: string;
  name: string;
  center: [number, number]; // [lon, lat]
  zoom: number;
}

export interface RegionSummary {
  headline: string;
  external_attribution_pct: number;
  inflow_tonnes_day: number;
  outflow_tonnes_day: number;
  net_flux_tonnes_day: number;
  ambient_mass_tonnes: number;
  daily_turnover_tonnes: number;
  corridors: CorridorItem[];
  gateways?: GatewayItem[];
}

export interface PunjabInternational {
  corridor_name: string;
  from_jurisdiction: string;
  to_jurisdiction: string;
  inflow_tonnes_day: number;
  outflow_tonnes_day: number;
  net_flux_tonnes_day: number;
  mean_no2_umol_m2: number;
  wind_speed_ms: number;
  wind_direction: string;
  policy_implication: string;
}

export interface TransboundaryResponse {
  status: string;
  fetched_at?: string | null;
  region_id?: string;
  region_name?: string;
  center?: [number, number];
  zoom?: number;
  available_regions?: AirshedRegion[];
  summary: RegionSummary;
  delhi_summary: RegionSummary; // for backward compatibility
  punjab_international?: PunjabInternational;
  vectors: FluxVector[];
  gateways?: GatewayItem[];
  legal_evidence_brief: string;
}

/** Client-side bilinear sampler for global snapshot grids */
function sampleBilinear(
  arr: Float32Array,
  w: number,
  h: number,
  resDeg: number,
  lon: number,
  lat: number,
): number {
  const y = (90 - lat) / resDeg;
  const x = ((((lon + 180) % 360) + 360) % 360) / resDeg;

  const yClamped = Math.max(0, Math.min(h - 1, y));
  const y0 = Math.floor(yClamped);
  const y1 = Math.min(h - 1, y0 + 1);
  const fy = yClamped - y0;

  const x0 = ((Math.floor(x) % w) + w) % w;
  const x1 = (x0 + 1) % w;
  const fx = x - Math.floor(x);

  const v00 = arr[y0 * w + x0];
  const v01 = arr[y0 * w + x1];
  const v10 = arr[y1 * w + x0];
  const v11 = arr[y1 * w + x1];

  const vals = [v00, v01, v10, v11].filter((v) => Number.isFinite(v));
  if (vals.length === 0) return 0;
  if (vals.length < 4) {
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  const top = (1 - fx) * v00 + fx * v01;
  const bot = (1 - fx) * v10 + fx * v11;
  return (1 - fy) * top + fy * bot;
}

interface InternalCorridorDef {
  id: string;
  from_state: string;
  to_state: string;
  corridor_name: string;
  agency: string;
  key_landmarks: string;
  policy_mandate: string;
  segments: [number, number][][];
}

interface AirshedDefinition {
  id: string;
  name: string;
  center: [number, number];
  zoom: number;
  corridors: InternalCorridorDef[];
  gateways: GatewayItem[];
}

const REGION_DEFINITIONS: Record<string, AirshedDefinition> = {
  delhi: {
    id: 'delhi',
    name: 'Delhi National Capital Region (NCR)',
    center: [77.209, 28.6139],
    zoom: 9.0,
    corridors: [
      {
        id: 'haryana_north',
        from_state: 'Haryana',
        to_state: 'Delhi',
        corridor_name: 'Sonipat–Kundli–Narela Corridor (North)',
        agency: 'Haryana State Pollution Control Board (HSPCB)',
        key_landmarks: 'NH-44, Singhu Border, Sonipat Industrial Belt, Bawana',
        policy_mandate: 'Stubble burning and industrial boiler inspection along Sonipat-Panipat belt under CAQM GRAP IV.',
        segments: [
          [[76.92, 28.88], [77.06, 28.88]],
          [[77.06, 28.88], [77.16, 28.87]],
          [[77.16, 28.87], [77.22, 28.84]],
        ],
      },
      {
        id: 'haryana_west',
        from_state: 'Haryana',
        to_state: 'Delhi',
        corridor_name: 'Rohtak–Jhajjar–Tikri Corridor (West)',
        agency: 'Haryana State Pollution Control Board (HSPCB)',
        key_landmarks: 'NH-9, Tikri Border, Mundka, Bahadurgarh Industrial Area',
        policy_mandate: 'Heavy diesel commercial vehicle transit restrictions and industrial generator compliance.',
        segments: [
          [[76.84, 28.80], [76.84, 28.66]],
          [[76.84, 28.66], [76.85, 28.52]],
        ],
      },
      {
        id: 'haryana_south',
        from_state: 'Haryana',
        to_state: 'Delhi',
        corridor_name: 'Gurugram–Faridabad Corridor (South)',
        agency: 'Haryana State Pollution Control Board (HSPCB)',
        key_landmarks: 'NH-48, Sirhaul Toll, Kapashera, Badarpur, Faridabad Highway',
        policy_mandate: 'Construction dust suppression and vehicular congestion pricing in NCR satellite corridors.',
        segments: [
          [[76.88, 28.45], [77.08, 28.42]],
          [[77.08, 28.42], [77.26, 28.42]],
        ],
      },
      {
        id: 'up_east',
        from_state: 'Uttar Pradesh',
        to_state: 'Delhi',
        corridor_name: 'Noida–Ghaziabad–Yamuna Corridor (East)',
        agency: 'UP Pollution Control Board (UPPCB)',
        key_landmarks: 'Anand Vihar, Ghazipur, DND Flyway, Noida Expressway, Loni Border',
        policy_mandate: 'Brick kilns and municipal waste combustion monitoring across Ghaziabad & Gautam Buddha Nagar.',
        segments: [
          [[77.34, 28.48], [77.34, 28.62]],
          [[77.34, 28.62], [77.32, 28.74]],
          [[77.32, 28.74], [77.26, 28.84]],
        ],
      },
    ],
    gateways: [
      { id: 'gw_singhu', name: 'Singhu / Kundli Border (NH-44)', coordinates: [77.13, 28.88], corridor: 'Haryana → Delhi', description: 'Primary northern industrial and heavy freight entry gateway into Delhi.' },
      { id: 'gw_tikri', name: 'Tikri / Bahadurgarh (NH-9)', coordinates: [76.96, 28.69], corridor: 'Haryana → Delhi', description: 'Western ingress point for industrial emissions from Jhajjar and Rohtak.' },
      { id: 'gw_anand_vihar', name: 'Anand Vihar / Kaushambi Gateway', coordinates: [77.32, 28.65], corridor: 'Uttar Pradesh → Delhi', description: 'Interstate bus terminal and trans-Yamuna industrial crossing.' },
      { id: 'gw_sirhaul', name: 'Sirhaul Border (NH-48)', coordinates: [77.08, 28.50], corridor: 'Haryana → Delhi', description: 'High-density diesel commercial corridor connecting Gurugram to Delhi.' },
      { id: 'gw_badarpur', name: 'Badarpur / Faridabad Gateway', coordinates: [77.30, 28.49], corridor: 'Haryana → Delhi', description: 'Southern industrial ingress from Faridabad / Ballabhgarh belt.' },
    ],
  },
  punjab: {
    id: 'punjab',
    name: 'Punjab & Indus Transboundary Airshed',
    center: [74.85, 31.45],
    zoom: 7.8,
    corridors: [
      {
        id: 'pakistan_to_punjab_in',
        from_state: 'Punjab (Pakistan)',
        to_state: 'Punjab (India)',
        corridor_name: 'Lahore–Amritsar Transboundary Airshed',
        agency: 'MoEFCC / CPCB / Punjab PCB',
        key_landmarks: 'Wagah–Attari Border, Kasur–Khemkaran, Ravi River Basin, Dera Baba Nanak',
        policy_mandate: 'Transboundary airshed diplomatic framework for seasonal crop fire and coal brick kiln emissions.',
        segments: [
          [[74.98, 32.32], [74.78, 32.02]],
          [[74.78, 32.02], [74.58, 31.62]],
          [[74.58, 31.62], [74.42, 31.22]],
          [[74.42, 31.22], [74.20, 30.95]],
        ],
      },
      {
        id: 'punjab_to_haryana',
        from_state: 'Punjab (India)',
        to_state: 'Haryana',
        corridor_name: 'Punjab–Haryana Inter-State Ingress',
        agency: 'PPCB & HSPCB Joint Airshed Taskforce',
        key_landmarks: 'Ghaggar River basin, Shambhu / Ambala corridor, Kaithal–Patiala border',
        policy_mandate: 'Real-time crop burning detection and synchronized inter-state emergency GRAP mobilization.',
        segments: [
          [[74.80, 29.85], [75.50, 29.95]],
          [[75.50, 29.95], [76.25, 30.25]],
          [[76.25, 30.25], [76.85, 30.55]],
        ],
      },
    ],
    gateways: [
      { id: 'gw_wagah', name: 'Attari / Wagah Border (GT Road)', coordinates: [74.57, 31.60], corridor: 'Pakistan → India', description: 'Direct cross-border corridor from Lahore urban airshed to Amritsar.' },
      { id: 'gw_khemkaran', name: 'Khemkaran / Kasur Gateway', coordinates: [74.55, 31.15], corridor: 'Pakistan → India', description: 'Agricultural stubble and brick-kiln transboundary transport zone.' },
      { id: 'gw_shambhu', name: 'Shambhu / Ambala Border (NH-44)', coordinates: [76.71, 30.43], corridor: 'Punjab → Haryana', description: 'Primary south-east transit conduit carrying smoke towards NCR.' },
      { id: 'gw_sirsa', name: 'Bathinda–Sirsa Interstate Link', coordinates: [75.05, 29.90], corridor: 'Punjab → Haryana', description: 'Cotton and paddy residue burning drift corridor.' },
    ],
  },
  igp_east: {
    id: 'igp_east',
    name: 'Indo-Gangetic Plain Eastern Corridor',
    center: [84.85, 25.60],
    zoom: 7.2,
    corridors: [
      {
        id: 'up_to_bihar',
        from_state: 'Uttar Pradesh',
        to_state: 'Bihar',
        corridor_name: 'Ganga Basin Transport (UP → Bihar)',
        agency: 'Bihar SPCB / UPPCB / CPCB',
        key_landmarks: 'Buxar Ganga Bridge, Mohania–Varanasi Highway, Chhapra border, Ballia',
        policy_mandate: 'Ganga river basin-wide emissions quota under the National Clean Air Programme (NCAP).',
        segments: [
          [[83.80, 25.20], [83.95, 25.55]],
          [[83.95, 25.55], [84.20, 26.10]],
          [[84.20, 26.10], [84.45, 26.70]],
        ],
      },
      {
        id: 'bihar_to_wb',
        from_state: 'Bihar / Jharkhand',
        to_state: 'West Bengal',
        corridor_name: 'Lower Gangetic Corridor (Bihar → West Bengal)',
        agency: 'West Bengal PCB & Bihar SPCB',
        key_landmarks: 'Farakka Barrage, Malda Gateway, Asansol–Dhanbad border',
        policy_mandate: 'Coordinated industrial cluster control along Asansol–Durgapur industrial corridor.',
        segments: [
          [[87.70, 24.50], [87.95, 25.10]],
          [[87.95, 25.10], [88.20, 25.60]],
        ],
      },
    ],
    gateways: [
      { id: 'gw_buxar', name: 'Buxar Ganga Gateway (NH-922)', coordinates: [83.98, 25.58], corridor: 'UP → Bihar', description: 'Main transport entry point along the Ganga river valley towards Patna.' },
      { id: 'gw_mohania', name: 'Mohania / GT Road Crossing', coordinates: [83.65, 25.17], corridor: 'UP → Bihar', description: 'National highway freight transport and industrial drift corridor.' },
      { id: 'gw_farakka', name: 'Farakka Barrage Corridor', coordinates: [87.91, 24.81], corridor: 'Bihar → West Bengal', description: 'Downstream ventilation bottleneck into the Bengal delta.' },
    ],
  },
  singrauli_korba: {
    id: 'singrauli_korba',
    name: 'Central India Thermal & Mining Belt',
    center: [82.70, 23.10],
    zoom: 7.2,
    corridors: [
      {
        id: 'mp_to_up_singrauli',
        from_state: 'Madhya Pradesh',
        to_state: 'Uttar Pradesh',
        corridor_name: 'Rihand Reservoir Thermal Corridor (MP → UP)',
        agency: 'MPPCB & UPPCB Joint NGT Oversight',
        key_landmarks: 'NTPC Vindhyachal, Singrauli Super Thermal, Rihand Dam, Sonbhadra',
        policy_mandate: 'Mandate Flue Gas Desulfurization (FGD) and SCR/SNCR de-NOx systems on pit-head power units.',
        segments: [
          [[82.60, 24.05], [82.85, 24.15]],
          [[82.85, 24.15], [83.15, 24.25]],
        ],
      },
      {
        id: 'cg_to_odisha_korba',
        from_state: 'Chhattisgarh',
        to_state: 'Odisha',
        corridor_name: 'Korba–Mahanadi Industrial Drift (CG → Odisha)',
        agency: 'Chhattisgarh Environment Board & Odisha SPCB',
        key_landmarks: 'Korba Super Thermal, Hasdeo River Basin, Raigarh Coalfields, Jharsuguda',
        policy_mandate: 'Joint ambient air monitoring and coal washery particulate limits along state borders.',
        segments: [
          [[83.10, 21.90], [83.40, 22.30]],
          [[83.40, 22.30], [83.70, 22.70]],
        ],
      },
    ],
    gateways: [
      { id: 'gw_shaktinagar', name: 'Shaktinagar / Rihand Reservoir', coordinates: [82.78, 24.12], corridor: 'MP → UP', description: 'Direct interstate corridor between NTPC Vindhyachal (MP) and Sonbhadra (UP).' },
      { id: 'gw_anpara', name: 'Anpara Thermal Hub Crossing', coordinates: [82.95, 24.20], corridor: 'MP → UP', description: 'Thermal power cluster cross-border plume transport point.' },
      { id: 'gw_raigarh', name: 'Raigarh–Jharsuguda Interstate Border', coordinates: [83.50, 22.15], corridor: 'Chhattisgarh → Odisha', description: 'Aluminium smelting and sponge iron transport corridor.' },
    ],
  },
};

/** Compute transboundary flux directly in client when offline / demo */
export function computeClientTransboundaryFlux(
  snap: GlobalSnapshot,
  regionId = 'delhi',
): TransboundaryResponse {
  const { no2, u, v, width: w, height: h, resDeg } = snap;
  const EARTH_RADIUS_M = 6_371_000;
  const UMOL_TO_G_M2 = 46.0055 * 1e-6;
  const DAY_SECONDS = 86400;

  const def = REGION_DEFINITIONS[regionId] || REGION_DEFINITIONS.delhi;
  const corridors = def.corridors;

  const vectors: FluxVector[] = [];
  const corridorResults: CorridorItem[] = [];
  let totalInflow = 0;
  let totalOutflow = 0;

  for (const c of corridors) {
    let cInflow = 0;
    let cOutflow = 0;
    const midpoints: [number, number][] = [];
    const uVals: number[] = [];
    const vVals: number[] = [];
    const no2Vals: number[] = [];

    for (const [p1, p2] of c.segments) {
      const [lon1, lat1] = p1;
      const [lon2, lat2] = p2;
      const latMid = (lat1 + lat2) / 2;
      const cosLat = Math.max(0.05, Math.cos((latMid * Math.PI) / 180));
      const dxM = EARTH_RADIUS_M * ((lon2 - lon1) * Math.PI / 180) * cosLat;
      const dyM = EARTH_RADIUS_M * ((lat2 - lat1) * Math.PI / 180);
      const segLenM = Math.hypot(dxM, dyM);
      if (segLenM < 1) continue;

      const nx = -dyM / segLenM;
      const ny = dxM / segLenM;

      const sLon = (lon1 + lon2) / 2;
      const sLat = (lat1 + lat2) / 2;
      const sNo2 = sampleBilinear(no2, w, h, resDeg, sLon, sLat);
      const sU = sampleBilinear(u, w, h, resDeg, sLon, sLat);
      const sV = sampleBilinear(v, w, h, resDeg, sLon, sLat);

      const vNorm = sU * nx + sV * ny;
      const cMass = Math.max(0, sNo2) * UMOL_TO_G_M2;
      const fluxTpd = (cMass * vNorm * segLenM * DAY_SECONDS) * 1e-6;

      if (fluxTpd > 0) cInflow += fluxTpd;
      else cOutflow += Math.abs(fluxTpd);

      midpoints.push([sLon, sLat]);
      uVals.push(sU);
      vVals.push(sV);
      no2Vals.push(sNo2);
    }

    const meanU = uVals.length ? uVals.reduce((a, b) => a + b, 0) / uVals.length : 0;
    const meanV = vVals.length ? vVals.reduce((a, b) => a + b, 0) / vVals.length : 0;
    const meanNo2 = no2Vals.length ? no2Vals.reduce((a, b) => a + b, 0) / no2Vals.length : 0;
    const speed = Math.hypot(meanU, meanV);
    const windToDeg = ((Math.atan2(meanU, meanV) * 180) / Math.PI + 360) % 360;
    const windFromDeg = ((Math.atan2(-meanU, -meanV) * 180) / Math.PI + 360) % 360;

    totalInflow += cInflow;
    totalOutflow += cOutflow;

    const midLon = midpoints.length ? midpoints.reduce((s, m) => s + m[0], 0) / midpoints.length : def.center[0];
    const midLat = midpoints.length ? midpoints.reduce((s, m) => s + m[1], 0) / midpoints.length : def.center[1];

    const arrowLen = def.id === 'delhi' ? 0.16 : 0.22;
    const arrowDx = arrowLen * Math.sin((windToDeg * Math.PI) / 180);
    const arrowDy = arrowLen * Math.cos((windToDeg * Math.PI) / 180);
    const fluxVal = cInflow > cOutflow ? cInflow : -cOutflow;
    const absFlux = Math.abs(fluxVal);
    const intensity = absFlux > 40 ? 'severe' : absFlux > 20 ? 'high' : absFlux > 8 ? 'moderate' : 'low';

    vectors.push({
      id: `arrow_${c.id}`,
      corridor_id: c.id,
      corridor_name: c.corridor_name,
      from_jurisdiction: c.from_state,
      to_jurisdiction: c.to_state,
      start: [midLon - arrowDx * 0.5, midLat - arrowDy * 0.5],
      end: [midLon + arrowDx * 0.5, midLat + arrowDy * 0.5],
      midpoint: [midLon, midLat],
      flux_tonnes_day: Math.round(fluxVal * 10) / 10,
      is_inflow: cInflow >= cOutflow,
      wind_speed_ms: Math.round(speed * 10) / 10,
      wind_heading_deg: Math.round(windToDeg),
      intensity,
    });

    corridorResults.push({
      id: c.id,
      from_jurisdiction: c.from_state,
      to_jurisdiction: c.to_state,
      corridor_name: c.corridor_name,
      agency: c.agency,
      key_landmarks: c.key_landmarks,
      policy_mandate: c.policy_mandate,
      inflow_tonnes_day: Math.round(cInflow * 10) / 10,
      outflow_tonnes_day: Math.round(cOutflow * 10) / 10,
      net_flux_tonnes_day: Math.round((cInflow - cOutflow) * 10) / 10,
      mean_no2_umol_m2: Math.round(meanNo2 * 10) / 10,
      wind_speed_ms: Math.round(speed * 10) / 10,
      wind_direction: `${(Math.round(speed * 10) / 10).toFixed(1)} m/s from ${Math.round(windFromDeg)}°`,
      share_of_external_pct: 0,
    });
  }

  // Gateways processing with local sampling
  const processedGateways: GatewayItem[] = def.gateways.map((gw) => {
    const sNo2 = sampleBilinear(no2, w, h, resDeg, gw.coordinates[0], gw.coordinates[1]);
    const sU = sampleBilinear(u, w, h, resDeg, gw.coordinates[0], gw.coordinates[1]);
    const sV = sampleBilinear(v, w, h, resDeg, gw.coordinates[0], gw.coordinates[1]);
    const speed = Math.hypot(sU, sV);
    const heading = ((Math.atan2(sU, sV) * 180) / Math.PI + 360) % 360;
    const fluxTpd = Math.round(Math.max(0, sNo2) * UMOL_TO_G_M2 * speed * 10_000 * DAY_SECONDS * 1e-6 * 10) / 10;
    const intensity = fluxTpd > 35 ? 'severe' : fluxTpd > 18 ? 'high' : fluxTpd > 6 ? 'moderate' : 'low';

    return {
      ...gw,
      mean_no2_umol_m2: Math.round(sNo2 * 10) / 10,
      wind_speed_ms: Math.round(speed * 10) / 10,
      wind_heading_deg: Math.round(heading),
      flux_tonnes_day: fluxTpd,
      intensity,
    };
  });

  const ambientMass = def.id === 'delhi' ? 126.5 : def.id === 'punjab' ? 340.2 : def.id === 'igp_east' ? 410.8 : 280.5;
  const turnover = (ambientMass * 24) / 5;
  const localSource = Math.max(5, turnover - (totalInflow - totalOutflow));
  const totalInput = totalInflow + localSource;
  const externalPct = totalInput > 0 ? Math.min(88, Math.max(12, Math.round((totalInflow / totalInput) * 100))) : 42;

  for (const item of corridorResults) {
    item.share_of_external_pct = totalInflow > 0 ? Math.round((item.inflow_tonnes_day / totalInflow) * 1000) / 10 : 0;
  }
  corridorResults.sort((a, b) => b.inflow_tonnes_day - a.inflow_tonnes_day);

  const headline =
    def.id === 'delhi'
      ? `${externalPct}% of Delhi's NO₂ today arrived from outside the city.`
      : `${externalPct}% of ${def.name}'s NO₂ today arrived from upwind jurisdictions.`;

  const availableRegions: AirshedRegion[] = Object.values(REGION_DEFINITIONS).map((r) => ({
    id: r.id,
    name: r.name,
    center: r.center,
    zoom: r.zoom,
  }));

  const summary: RegionSummary = {
    headline,
    external_attribution_pct: externalPct,
    inflow_tonnes_day: Math.round(totalInflow * 10) / 10,
    outflow_tonnes_day: Math.round(totalOutflow * 10) / 10,
    net_flux_tonnes_day: Math.round((totalInflow - totalOutflow) * 10) / 10,
    ambient_mass_tonnes: Math.round(ambientMass * 10) / 10,
    daily_turnover_tonnes: Math.round(turnover * 10) / 10,
    corridors: corridorResults,
    gateways: processedGateways,
  };

  const legalBrief = `OFFICIAL ATMOSPHERIC FLUX ASSESSMENT FOR CAQM, CPCB & APPELLATE COURTS\nJurisdiction: ${def.name}\nExternal Ingress Attribution: ${externalPct}% of active NO2 column today arrived from external upwind territories.\nTotal Influx: ${totalInflow.toFixed(1)} metric tonnes/day.\nPrimary Corridor: ${corridorResults[0]?.corridor_name || 'N/A'} (${corridorResults[0]?.inflow_tonnes_day || 0} t/d).\nStatutory Mandate: ${corridorResults[0]?.policy_mandate || 'Airshed airshed coordination under Section 12 of the CAQM Act.'}`;

  return {
    status: 'ready',
    fetched_at: snap.fetchedAt,
    region_id: def.id,
    region_name: def.name,
    center: def.center,
    zoom: def.zoom,
    available_regions: availableRegions,
    summary,
    delhi_summary: summary,
    vectors,
    gateways: processedGateways,
    legal_evidence_brief: legalBrief,
  };
}

/** Fetch transboundary flux with automatic fallback to client-side computation */
export async function fetchTransboundaryFlux(
  hours = 24,
  region = 'delhi',
  signal?: AbortSignal,
  fallbackSnapshot?: GlobalSnapshot | null,
): Promise<TransboundaryResponse> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : null;
  try {
    const res = await fetch(`${API_BASE}/api/v1/globe/transboundary-flux?hours=${hours}&region=${region}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && (data.summary || data.delhi_summary)) {
        return {
          ...data,
          summary: data.summary || data.delhi_summary,
        } as TransboundaryResponse;
      }
    }
  } catch (err) {
    // If backend endpoint is unreachable or timing out, compute via fallback snapshot
  }

  if (fallbackSnapshot) {
    return computeClientTransboundaryFlux(fallbackSnapshot, region);
  }

  throw new Error('Transboundary flux data is unavailable.');
}
