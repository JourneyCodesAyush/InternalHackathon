import chroma from 'chroma-js';

export interface NO2HeatmapOverlayOptions {
  no2: Float32Array;
  width: number;
  height: number;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  opacity?: number;
}

// AQI-aligned atmospheric NO₂ color gradient (0 to 200 µg/m³), matching Visualization page
const NO2_COLOR_SCALE = chroma
  .scale(['#00e400', '#ffff00', '#ff7e00', '#ff0000', '#8f3f97', '#7e0023'])
  .domain([0, 40, 80, 120, 160, 200])
  .mode('lch');

// Precomputed 256-color lookup table for fast RGBA rendering (~78% base alpha = 200)
const COLOR_LUT = new Uint8ClampedArray(256 * 4);
for (let i = 0; i < 256; i++) {
  const value = (i / 255.0) * 200.0;
  const rgb = NO2_COLOR_SCALE(value).rgb();
  const offset = i * 4;
  COLOR_LUT[offset] = rgb[0];
  COLOR_LUT[offset + 1] = rgb[1];
  COLOR_LUT[offset + 2] = rgb[2];
  COLOR_LUT[offset + 3] = 200;
}

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

      for (let i = 0; i < totalPixels; i++) {
        const val = this.no2[i];
        const lutIndex = Math.max(0, Math.min(255, Math.round((val / 200.0) * 255)));
        const offset = lutIndex * 4;

        const r = COLOR_LUT[offset];
        const g = COLOR_LUT[offset + 1];
        const b = COLOR_LUT[offset + 2];
        const a = COLOR_LUT[offset + 3];

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
