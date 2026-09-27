export interface AdvectMessage {
  type: 'ADVECT';
  no2A: Float32Array;
  no2B: Float32Array;
  uField: Float32Array;
  vField: Float32Array;
  width: number;
  height: number;
  t: number;
  dt: number;
  cellSizeMeters: number;
}

export interface AdvectResultMessage {
  type: 'ADVECT_RESULT';
  no2: Float32Array;
}

/**
 * Semi-Lagrangian Advection Solver for passive atmospheric scalar (NO₂).
 * Runs off the main thread inside a dedicated Web Worker at high framerates.
 */
self.onmessage = (event: MessageEvent<AdvectMessage>) => {
  const { data } = event;
  if (data?.type !== 'ADVECT') return;

  const {
    no2A,
    no2B,
    uField,
    vField,
    width,
    height,
    t,
    dt,
    cellSizeMeters,
  } = data;

  const totalCells = width * height;
  const result = new Float32Array(totalCells);

  const effectiveCellSize = cellSizeMeters > 0 ? cellSizeMeters : 1000.0;
  const clampedT = Math.max(0.0, Math.min(1.0, t));
  const oneMinusT = 1.0 - clampedT;

  for (let j = 0; j < height; j++) {
    const rowOffset = j * width;
    for (let i = 0; i < width; i++) {
      const idx = rowOffset + i;

      // 1. Local wind velocity component at (i, j)
      const u = uField[idx];
      const v = vField[idx];

      // 2. Trace particle path backwards in time along the local velocity vector
      // Displacement in grid cells = (velocity * dt) / cellSizeMeters
      const deltaCellsX = (u * dt) / effectiveCellSize;
      const deltaCellsY = (v * dt) / effectiveCellSize;

      const srcX = Math.max(0.0, Math.min(width - 1.0, i - deltaCellsX));
      const srcY = Math.max(0.0, Math.min(height - 1.0, j - deltaCellsY));

      // 3. Bilinear interpolation of no2A at sub-pixel coordinate (srcX, srcY)
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, width - 1);
      const y0 = Math.floor(srcY);
      const y1 = Math.min(y0 + 1, height - 1);

      const fx = srcX - x0;
      const fy = srcY - y0;
      const invFx = 1.0 - fx;
      const invFy = 1.0 - fy;

      const v00 = no2A[y0 * width + x0];
      const v10 = no2A[y0 * width + x1];
      const v01 = no2A[y1 * width + x0];
      const v11 = no2A[y1 * width + x1];

      const no2Advected =
        invFx * invFy * v00 +
        fx * invFy * v10 +
        invFx * fy * v01 +
        fx * fy * v11;

      // 4. Linearly blend the advected prior frame with the destination target frame
      const targetVal = no2B[idx];
      result[idx] = no2Advected * oneMinusT + targetVal * clampedT;
    }
  }

  // Transfer memory buffer back to main thread for maximum throughput
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(
    {
      type: 'ADVECT_RESULT',
      no2: result,
    } as AdvectResultMessage,
    [result.buffer]
  );
};
