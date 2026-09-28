import chroma from 'chroma-js';

export interface NO2HeatmapOverlayOptions {
  no2: Float32Array;
  width: number;
  height: number;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  opacity?: number;
  /** 'cpcb' (default, home map): 0-320 µg/m³ hazard scale. 'vivid' (simulator): standard AQI steps
   * capped at 200 µg/m³, so exceedances above the CPCB limit (80) turn red and >160 deep red/purple. */
  palette?: HeatmapPalette;
}

export type HeatmapPalette = 'cpcb' | 'vivid';

// Colour lookup tables (256 steps) for fast RGBA rendering.
interface Palette {
  lut: Uint8ClampedArray;
  max: number;
}

function buildPalette(colours: string[], domain: number[], max: number): Palette {
  const scale = chroma.scale(colours).domain(domain).mode('lab');
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const value = (i / 255.0) * max;
    const rgb = scale(value).rgb();
    const offset = i * 4;
    lut[offset] = rgb[0];
    lut[offset + 1] = rgb[1];
    lut[offset + 2] = rgb[2];
    lut[offset + 3] = value < 20 ? Math.round(140 + (value / 20) * 65) : 215;
  }
  return { lut, max };
}

const PALETTES: Record<HeatmapPalette, Palette> = {
  // CPCB hazard-based gradient (0 to 320 µg/m³): green 0-40, yellow 40-80, orange 80-180, red 180-280, purple >280
  cpcb: buildPalette(['#10b981', '#facc15', '#f97316', '#ef4444', '#9333ea'], [0, 40, 80, 180, 320], 320),
  // AQI-style steps capped at 200 µg/m³: moderate exceedances go orange/red, extremes deep red/purple
  vivid: buildPalette(
    ['#10b981', '#eab308', '#f97316', '#ef4444', '#dc2626', '#9333ea'],
    [0, 40, 80, 120, 160, 200],
    200,
  ),
};

export interface INO2HeatmapOverlay {
  setMap(map: any): void;
  updateData(options: { no2: Float32Array; width: number; height: number; bbox: [number, number, number, number] }): void;
  setOpacity(opacity: number): void;
}

/**
 * Factory function creating a custom google.maps.OverlayView instance
 * that renders a smooth Canvas 2D NO₂ heatmap over the given geographic bounds.
 */
export function createNO2HeatmapOverlay(options: NO2HeatmapOverlayOptions): INO2HeatmapOverlay {
  const google = (typeof window !== 'undefined' ? (window as any).google : null);
  if (!google?.maps?.OverlayView) {
    throw new Error('Google Maps SDK OverlayView is not available yet');
  }

  class ConcreteNO2HeatmapOverlay extends google.maps.OverlayView implements INO2HeatmapOverlay {
    private no2: Float32Array;
    private gridWidth: number;
    private gridHeight: number;
    private bbox: [number, number, number, number];
    private opacity: number;
    private palette: Palette;

    private containerDiv: HTMLDivElement | null = null;
    private displayCanvas: HTMLCanvasElement | null = null;
    private offscreenCanvas: HTMLCanvasElement | null = null;

    constructor(opts: NO2HeatmapOverlayOptions) {
      super();
      this.no2 = opts.no2;
      this.gridWidth = opts.width;
      this.gridHeight = opts.height;
      this.bbox = opts.bbox;
      this.opacity = opts.opacity ?? 0.75;
      this.palette = PALETTES[opts.palette ?? 'cpcb'];
    }

    onAdd(): void {
      const div = document.createElement('div');
      div.style.position = 'absolute';
      div.style.pointerEvents = 'none';
      div.style.overflow = 'visible';

      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.pointerEvents = 'none';
      canvas.style.display = 'block';

      div.appendChild(canvas);
      this.containerDiv = div;
      this.displayCanvas = canvas;

      // Offscreen canvas for rasterizing the NO2 grid with LUT
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = this.gridWidth;
      this.offscreenCanvas.height = this.gridHeight;

      this.rasterizeGrid();

      // Attach to overlayLayer pane so it renders above the base map tiles but below controls
      const panes = this.getPanes();
      if (panes?.overlayLayer) {
        panes.overlayLayer.appendChild(div);
      }
    }

    private rasterizeGrid(): void {
      if (!this.offscreenCanvas) return;
      const ctx = this.offscreenCanvas.getContext('2d');
      if (!ctx) return;

      const imgData = ctx.createImageData(this.gridWidth, this.gridHeight);
      const data32 = new Uint32Array(imgData.data.buffer);
      const totalPixels = this.gridWidth * this.gridHeight;
      const { lut, max } = this.palette;

      for (let i = 0; i < totalPixels; i++) {
        const val = this.no2[i];
        const lutIndex = Math.max(0, Math.min(255, Math.round((val / max) * 255)));
        const offset = lutIndex * 4;

        const r = lut[offset];
        const g = lut[offset + 1];
        const b = lut[offset + 2];
        const a = lut[offset + 3];

        // Little-endian packed ABGR
        data32[i] = (a << 24) | (b << 16) | (g << 8) | r;
      }

      ctx.putImageData(imgData, 0, 0);
    }

    draw(): void {
      const projection = this.getProjection();
      if (!projection || !this.containerDiv || !this.displayCanvas || !this.offscreenCanvas) {
        return;
      }

      // bbox is [minLng, minLat, maxLng, maxLat]
      const sw = new google.maps.LatLng(this.bbox[1], this.bbox[0]);
      const ne = new google.maps.LatLng(this.bbox[3], this.bbox[2]);

      const swPixel = projection.fromLatLngToDivPixel(sw);
      const nePixel = projection.fromLatLngToDivPixel(ne);

      if (!swPixel || !nePixel) return;

      // Calculate pixel bounds on div
      const left = Math.min(swPixel.x, nePixel.x);
      const top = Math.min(swPixel.y, nePixel.y);
      const width = Math.abs(nePixel.x - swPixel.x);
      const height = Math.abs(swPixel.y - nePixel.y);

      if (width <= 0 || height <= 0) return;

      // Position container div at the top-left of the bounding box
      this.containerDiv.style.left = `${left}px`;
      this.containerDiv.style.top = `${top}px`;
      this.containerDiv.style.width = `${width}px`;
      this.containerDiv.style.height = `${height}px`;

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);

      if (this.displayCanvas.width !== pixelWidth || this.displayCanvas.height !== pixelHeight) {
        this.displayCanvas.width = pixelWidth;
        this.displayCanvas.height = pixelHeight;
      }

      this.displayCanvas.style.width = `${width}px`;
      this.displayCanvas.style.height = `${height}px`;

      const ctx = this.displayCanvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pixelWidth, pixelHeight);

      // Scale context for high-DPI rendering
      ctx.scale(dpr, dpr);

      // Bilinear interpolation for smooth continuous gradient
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = Math.max(0.0, Math.min(1.0, this.opacity));

      // Stretch offscreen raster across the bounding box pixels
      ctx.drawImage(this.offscreenCanvas, 0, 0, width, height);
      ctx.restore();
    }

    onRemove(): void {
      if (this.containerDiv?.parentNode) {
        this.containerDiv.parentNode.removeChild(this.containerDiv);
      }
      this.containerDiv = null;
      this.displayCanvas = null;
      this.offscreenCanvas = null;
    }

    updateData(opts: { no2: Float32Array; width: number; height: number; bbox: [number, number, number, number] }): void {
      this.no2 = opts.no2;
      this.gridWidth = opts.width;
      this.gridHeight = opts.height;
      this.bbox = opts.bbox;

      if (this.offscreenCanvas) {
        this.offscreenCanvas.width = this.gridWidth;
        this.offscreenCanvas.height = this.gridHeight;
        this.rasterizeGrid();
      }
      this.draw();
    }

    setOpacity(opacity: number): void {
      this.opacity = opacity;
      this.draw();
    }

    setMap(map: any): void {
      super.setMap(map);
    }
  }

  return new ConcreteNO2HeatmapOverlay(options);
}
