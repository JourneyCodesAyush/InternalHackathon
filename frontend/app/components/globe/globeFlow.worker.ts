/**
 * Global NO₂ flow worker: fills small cloud gaps and precomputes wind-drift frames on the sphere.
 *
 * Transport uses the same semi-Lagrangian advection as the map view's NavierStokesWorker (trace each cell
 * back along the wind, bilinear sample), adapted to a global lat/lon grid: longitudes wrap around the
 * dateline and east-west distances shrink with cos(latitude). Each step also applies horizontal eddy
 * diffusion and relaxes the column towards the observed map with NO₂'s daytime lifetime:
 *
 *   dc/dt = -u·∇c + K∇²c + (c_obs - c) / τ
 *
 * The relaxation term stands in for emissions and chemistry (sources keep emitting, transported NO₂ is
 * lost within hours), so sources stay lit while plumes stretch downwind. The frames are indicative drift
 * of today's field under the current wind, not a chemistry forecast.
 */

export interface FlowRequest {
  type: 'COMPUTE';
  no2: Float32Array; // µmol/m², NaN = no observation
  u: Float32Array; // m/s eastward
  v: Float32Array; // m/s northward
  width: number;
  height: number;
  resDeg: number;
  frameHours: number[]; // e.g. [0, 1, ..., 12]
}

export interface FlowProgress {
  type: 'PROGRESS';
  done: number;
  total: number;
}

export interface FlowResult {
  type: 'FRAMES';
  /** One RG float frame per entry of frameHours: R = column (µmol/m²), G = confidence 0..1. */
  frames: Float32Array[];
  /** Confidence before drift: 1 observed, (0, 1) interpolated gap, 0 no data nearby. */
  filled: Float32Array;
}

const EARTH_RADIUS_M = 6_371_000;
const STEP_S = 900; // 15-minute transport steps
const EDDY_DIFFUSIVITY = 3e4; // m²/s, horizontal mixing unresolved at 0.5°
const LIFETIME_S = 6 * 3600; // daytime NO₂ lifetime τ (e-folding)
const MAX_GAP_CELLS = 8; // fill gaps up to ~4° from an observation; farther cells stay transparent
const MIN_COS_LAT = 0.05;

// the DOM lib has no worker scope type; this is the worker's postMessage
const post = (message: FlowProgress | FlowResult, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(message, transfer);

/** Push-pull gap filling: nan-aware averages down a pyramid, then fill holes on the way back up. */
function pushPull(values: Float32Array, weights: Float32Array, w: number, h: number): Float32Array {
  if (w <= 2 || h <= 2) {
    let sum = 0;
    let sw = 0;
    for (let k = 0; k < values.length; k++) {
      sum += values[k] * weights[k];
      sw += weights[k];
    }
    return new Float32Array(values.length).fill(sw > 0 ? sum / sw : 0);
  }
  const cw = Math.ceil(w / 2);
  const ch = Math.ceil(h / 2);
  const cv = new Float32Array(cw * ch);
  const cwt = new Float32Array(cw * ch);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const c = (j >> 1) * cw + (i >> 1);
      cv[c] += values[k] * weights[k];
      cwt[c] += weights[k];
    }
  }
  for (let c = 0; c < cv.length; c++) {
    cv[c] = cwt[c] > 0 ? cv[c] / cwt[c] : 0;
    cwt[c] = Math.min(1, cwt[c]);
  }
  const coarse = pushPull(cv, cwt, cw, ch);
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    // bilinear upsample of the coarse level (cell centres), wrapping in longitude
    const cy = Math.min(ch - 1, Math.max(0, (j + 0.5) / 2 - 0.5));
    const y0 = Math.floor(cy);
    const y1 = Math.min(ch - 1, y0 + 1);
    const fy = cy - y0;
    for (let i = 0; i < w; i++) {
      const cx = (i + 0.5) / 2 - 0.5;
      const x0 = Math.floor(cx);
      const fx = cx - x0;
      const xa = (x0 + cw) % cw;
      const xb = (x0 + 1 + cw) % cw;
      const up =
        (1 - fx) * (1 - fy) * coarse[y0 * cw + xa] +
        fx * (1 - fy) * coarse[y0 * cw + xb] +
        (1 - fx) * fy * coarse[y1 * cw + xa] +
        fx * fy * coarse[y1 * cw + xb];
      const k = j * w + i;
      const wk = Math.min(1, weights[k]);
      out[k] = wk * values[k] + (1 - wk) * up;
    }
  }
  return out;
}

/** Grid distance (cells, 4-neighbour, wrapping in longitude) to the nearest observation, capped. */
function gapDistance(valid: Uint8Array, w: number, h: number, cap: number): Uint8Array {
  const dist = new Uint8Array(w * h).fill(cap + 1);
  let frontier: number[] = [];
  for (let k = 0; k < valid.length; k++) {
    if (valid[k]) {
      dist[k] = 0;
      frontier.push(k);
    }
  }
  for (let d = 1; d <= cap && frontier.length; d++) {
    const next: number[] = [];
    for (const k of frontier) {
      const j = Math.floor(k / w);
      const i = k - j * w;
      const neighbours = [j * w + ((i + 1) % w), j * w + ((i - 1 + w) % w)];
      if (j > 0) neighbours.push(k - w);
      if (j < h - 1) neighbours.push(k + w);
      for (const n of neighbours) {
        if (dist[n] > d) {
          dist[n] = d;
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

self.onmessage = (event: MessageEvent<FlowRequest>) => {
  const msg = event.data;
  if (msg?.type !== 'COMPUTE') return;
  const { no2, u, v, width: w, height: h, resDeg, frameHours } = msg;
  const n = w * h;

  // 1. Gap filling
  const valid = new Uint8Array(n);
  const weights = new Float32Array(n);
  const values = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (Number.isFinite(no2[k])) {
      valid[k] = 1;
      weights[k] = 1;
      values[k] = no2[k];
    }
  }
  let c = pushPull(values, weights, w, h);
  const observed = c; // c_obs: the relaxation target (never mutated; each step allocates new arrays)
  const dist = gapDistance(valid, w, h, MAX_GAP_CELLS);
  let conf = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    conf[k] = dist[k] === 0 ? 1 : dist[k] > MAX_GAP_CELLS ? 0 : 0.85 * (1 - dist[k] / (MAX_GAP_CELLS + 1));
  }
  const filled = conf.slice();
  const observedConf = filled;

  // 2. Per-row geometry: metres per cell and the clamped diffusion number
  const cellRad = (resDeg * Math.PI) / 180;
  const dyM = EARTH_RADIUS_M * cellRad;
  const cosLat = new Float32Array(h);
  const diffX = new Float32Array(h);
  const diffY = Math.min(0.2, (EDDY_DIFFUSIVITY * STEP_S) / (dyM * dyM));
  for (let j = 0; j < h; j++) {
    const lat = 90 - (j + 0.5) * resDeg;
    cosLat[j] = Math.max(MIN_COS_LAT, Math.cos((lat * Math.PI) / 180));
    const dxM = dyM * cosLat[j];
    diffX[j] = Math.min(0.2, (EDDY_DIFFUSIVITY * STEP_S) / (dxM * dxM));
  }
  const decay = Math.exp(-STEP_S / LIFETIME_S);

  const sample = (field: Float32Array, x: number, y: number): number => {
    const yc = Math.min(h - 1, Math.max(0, y));
    const y0 = Math.floor(yc);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = yc - y0;
    const x0f = Math.floor(x);
    const fx = x - x0f;
    const x0 = ((x0f % w) + w) % w;
    const x1 = (x0 + 1) % w;
    return (
      (1 - fx) * (1 - fy) * field[y0 * w + x0] +
      fx * (1 - fy) * field[y0 * w + x1] +
      (1 - fx) * fy * field[y1 * w + x0] +
      fx * fy * field[y1 * w + x1]
    );
  };

  const step = () => {
    const nc = new Float32Array(n);
    const nconf = new Float32Array(n);
    // semi-Lagrangian advection: source position = here - wind * dt (in cells)
    for (let j = 0; j < h; j++) {
      const cellsPerMx = 1 / (dyM * cosLat[j]);
      const cellsPerMy = 1 / dyM;
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const srcX = i - u[k] * STEP_S * cellsPerMx;
        const srcY = j + v[k] * STEP_S * cellsPerMy; // rows run southwards
        nc[k] = sample(c, srcX, srcY);
        nconf[k] = sample(conf, srcX, srcY);
      }
    }
    // eddy diffusion (explicit 5-point, clamped for stability) + relaxation towards the observed map
    const out = new Float32Array(n);
    for (let j = 0; j < h; j++) {
      const up = j > 0 ? j - 1 : j;
      const dn = j < h - 1 ? j + 1 : j;
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const lap =
          diffX[j] * (nc[j * w + ((i + 1) % w)] + nc[j * w + ((i - 1 + w) % w)] - 2 * nc[k]) +
          diffY * (nc[up * w + i] + nc[dn * w + i] - 2 * nc[k]);
        out[k] = observed[k] + (nc[k] + lap - observed[k]) * decay;
        nconf[k] = observedConf[k] + (nconf[k] - observedConf[k]) * decay;
      }
    }
    c = out;
    conf = nconf;
  };

  const pack = (): Float32Array => {
    const frame = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      frame[2 * k] = c[k];
      frame[2 * k + 1] = conf[k];
    }
    return frame;
  };

  const frames: Float32Array[] = [];
  const stepsPerHour = 3600 / STEP_S;
  const total = frameHours[frameHours.length - 1] * stepsPerHour;
  let done = 0;
  let hoursDone = 0;
  for (const target of frameHours) {
    while (hoursDone < target) {
      for (let s = 0; s < stepsPerHour; s++) step();
      hoursDone += 1;
      done += stepsPerHour;
      post({ type: 'PROGRESS', done, total } satisfies FlowProgress);
    }
    frames.push(pack());
  }

  post(
    { type: 'FRAMES', frames, filled } satisfies FlowResult,
    [...frames.map((f) => f.buffer), filled.buffer],
  );
};
