export const DEFAULT_BBOX: [number, number, number, number] = [
  72.7, 18.8, 73.2, 19.3,
]; // Mumbai region: [minX, minY, maxX, maxY]

export const USE_STUB_DATA = false;

export interface SyntheticFrameData {
  no2: Float32Array;
  u: Float32Array;
  v: Float32Array;
  width: number;
  height: number;
  bbox: [number, number, number, number];
}

/**
 * Generate synthetic spatially-smooth NO₂ and wind fields using overlapping sine harmonics.
 *
 * @param width Grid width in cells (typically 100)
 * @param height Grid height in cells (typically 100)
 * @param bbox Bounding box [minLng, minLat, maxLng, maxLat]
 * @param seed Numeric seed derived from timestamp to provide continuous evolution
 */
export function generateSyntheticFrame(
  width: number,
  height: number,
  bbox: [number, number, number, number] = DEFAULT_BBOX,
  seed: number = 0
): SyntheticFrameData {
  const totalCells = width * height;
  const no2 = new Float32Array(totalCells);
  const u = new Float32Array(totalCells);
  const v = new Float32Array(totalCells);

  const phase = seed * 0.15;

  for (let j = 0; j < height; j++) {
    const fy = j / height;
    for (let i = 0; i < width; i++) {
      const fx = i / width;
      const idx = j * width + i;

      // 1. Spatially smooth NO₂ concentration between 20 and 180 µg/m³
      // Combination of 3 multi-frequency sinusoidal waves with phase shifts
      const wave1 = Math.sin(fx * Math.PI * 2.5 + phase) * Math.cos(fy * Math.PI * 2.0 - phase * 0.8);
      const wave2 = Math.sin(fx * Math.PI * 5.0 - phase * 1.2 + 0.5) * Math.sin(fy * Math.PI * 4.2 + phase * 0.7) * 0.5;
      const wave3 = Math.cos((fx + fy) * Math.PI * 3.3 + phase * 0.5) * 0.3;

      // Combined normalized harmonic in range [-1.8, 1.8]
      const rawNormalized = (wave1 + wave2 + wave3) / 1.8;
      // Remap to [0, 1] with center bias towards urban core (near Mumbai central)
      const distFromCenter = Math.sqrt((fx - 0.45) * (fx - 0.45) + (fy - 0.55) * (fy - 0.55));
      const urbanHeatBias = Math.max(0, 1.0 - distFromCenter * 1.5) * 0.4;
      const normalizedConcentration = Math.max(0, Math.min(1, (rawNormalized * 0.5 + 0.5) + urbanHeatBias));

      no2[idx] = 20.0 + normalizedConcentration * 160.0;

      // 2. U component: eastward wind between 2.0 and 8.0 m/s with gentle spatial variance
      const uBase = 4.5 + Math.sin(fy * Math.PI * 2.0 + phase * 0.4) * 2.0;
      const uTurbulence = Math.cos(fx * Math.PI * 3.5 - phase * 0.3) * 0.8;
      u[idx] = Math.max(2.0, Math.min(8.0, uBase + uTurbulence));

      // 3. V component: northward wind between 1.0 and 5.0 m/s
      const vBase = 2.8 + Math.cos(fx * Math.PI * 2.2 + phase * 0.6) * 1.5;
      const vTurbulence = Math.sin(fy * Math.PI * 3.0 + phase * 0.5) * 0.6;
      v[idx] = Math.max(1.0, Math.min(5.0, vBase + vTurbulence));
    }
  }

  return {
    no2,
    u,
    v,
    width,
    height,
    bbox,
  };
}

/**
 * 61 dates corresponding to all daily satellite GeoTIFF files in backend/data/test_data
 * (1 Nov 2025 to 31 Dec 2025).
 */
export const DEFAULT_AVAILABLE_DATES: string[] = [
  '2025-11-01', '2025-11-02', '2025-11-03', '2025-11-04', '2025-11-05',
  '2025-11-06', '2025-11-07', '2025-11-08', '2025-11-09', '2025-11-10',
  '2025-11-11', '2025-11-12', '2025-11-13', '2025-11-14', '2025-11-15',
  '2025-11-16', '2025-11-17', '2025-11-18', '2025-11-19', '2025-11-20',
  '2025-11-21', '2025-11-22', '2025-11-23', '2025-11-24', '2025-11-25',
  '2025-11-26', '2025-11-27', '2025-11-28', '2025-11-29', '2025-11-30',
  '2025-12-01', '2025-12-02', '2025-12-03', '2025-12-04', '2025-12-05',
  '2025-12-06', '2025-12-07', '2025-12-08', '2025-12-09', '2025-12-10',
  '2025-12-11', '2025-12-12', '2025-12-13', '2025-12-14', '2025-12-15',
  '2025-12-16', '2025-12-17', '2025-12-18', '2025-12-19', '2025-12-20',
  '2025-12-21', '2025-12-22', '2025-12-23', '2025-12-24', '2025-12-25',
  '2025-12-26', '2025-12-27', '2025-12-28', '2025-12-29', '2025-12-30',
  '2025-12-31',
];

/**
 * Generate synthetic 30-minute ISO timestamps starting from a reference date.
 */
export function generateSyntheticTimestamps(count: number = 48, baseDate: string = '2025-11-05'): string[] {
  const parsed = new Date(`${baseDate}T00:00:00Z`).getTime();
  const baseTime = isNaN(parsed) ? new Date('2025-11-05T00:00:00Z').getTime() : parsed;
  const stepMs = 30 * 60 * 1000; // 30 minutes
  const timestamps: string[] = [];

  for (let i = 0; i < count; i++) {
    timestamps.push(new Date(baseTime + i * stepMs).toISOString());
  }

  return timestamps;
}
