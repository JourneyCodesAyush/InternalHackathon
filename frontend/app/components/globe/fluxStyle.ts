/**
 * Shared look of the cross-border flux arrows on the 3-D globe and the 2-D map.
 *
 * The flux computation returns short direction markers (~0.2°) centred on each corridor crossing; for
 * display they are stretched along the wind heading so they read at airshed zoom, and their width grows
 * with the flux. Colours are deep and saturated with a dark casing so they stand out on the NO₂ layer.
 */
import type { FluxVector, GatewayItem } from './transboundaryData';

type Intensity = FluxVector['intensity'];

export const FLUX_COLOURS: Record<Intensity, string> = {
  severe: '#dc2626',
  high: '#ea580c',
  moderate: '#0284c7',
  low: '#059669',
};
export const FLUX_CASING = '#04060c';

export function fluxColour(intensity: Intensity | undefined): string {
  return FLUX_COLOURS[intensity ?? 'moderate'];
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface DisplayArrow {
  vec: FluxVector;
  start: [number, number]; // [lon, lat]
  end: [number, number];
  weight: number; // 0..1 by flux magnitude
}

/**
 * Display arrows for an airshed's corridors. A border flux is the flow normal to that border, so each
 * arrow crosses its own corridor: it lies along the line from the airshed centre (mean of the crossings)
 * through the crossing, pointing in for inflow and out for outflow. The arrows fan out around the airshed,
 * one per border, instead of all following the single wind heading on top of each other.
 */
export function fluxArrows(vectors: FluxVector[] | null | undefined): DisplayArrow[] {
  if (!vectors?.length) return [];
  const cLon = vectors.reduce((t, v) => t + v.midpoint[0], 0) / vectors.length;
  const cLat = vectors.reduce((t, v) => t + v.midpoint[1], 0) / vectors.length;
  const cos = Math.max(0.2, Math.cos((cLat * Math.PI) / 180));
  return vectors.map((vec) => {
    const [mx, my] = vec.midpoint;
    const weight = Math.min(1, Math.abs(vec.flux_tonnes_day) / 40);
    // outward unit direction in local (east, north) degrees; the wind heading when the crossing is central
    let ex = (mx - cLon) * cos;
    let ny = my - cLat;
    const r = Math.hypot(ex, ny);
    if (r < 0.02) {
      const h = (vec.wind_heading_deg * Math.PI) / 180;
      [ex, ny] = vec.is_inflow ? [-Math.sin(h), -Math.cos(h)] : [Math.sin(h), Math.cos(h)];
    } else {
      ex /= r;
      ny /= r;
    }
    const outer = 1.1 + 0.9 * weight; // degrees outside the border
    const inner = 0.2; // degrees inside
    const at = (d: number): [number, number] => [mx + (ex * d) / cos, my + ny * d];
    return vec.is_inflow
      ? { vec, start: at(outer), end: at(-inner), weight }
      : { vec, start: at(-inner), end: at(outer), weight };
  });
}

export function fluxLabel(vec: FluxVector): string {
  const t = Math.abs(vec.flux_tonnes_day);
  return `${vec.from_jurisdiction} → ${vec.to_jurisdiction} · ${vec.is_inflow ? '+' : '−'}${t} t/d`;
}

export function gatewayColour(gw: GatewayItem): string {
  return fluxColour(gw.intensity);
}
