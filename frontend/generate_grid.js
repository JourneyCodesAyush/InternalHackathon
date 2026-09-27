const GeoTIFF = require('geotiff');
const fs = require('fs');

async function run() {
  const tiff = await GeoTIFF.fromFile('../backend/outputs/cleaned/cleaned_2025-11-28_no2_raw_coarse_2025-11-28.tif');
  const image = await tiff.getImage();
  const raster = await image.readRasters();
  const data = raster[0];
  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox();

  const minLng = bbox[0];
  const minLat = bbox[1];
  const maxLng = bbox[2];
  const maxLat = bbox[3];

  const lngStep = (maxLng - minLng) / width;
  const latStep = (maxLat - minLat) / height;

  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = data[y * width + x];
      if (val > 0 && val !== -9999) {
        const west = minLng + x * lngStep;
        const east = west + lngStep;
        const north = maxLat - y * latStep;
        const south = north - latStep;
        const latCenter = (south + north) / 2;
        const lngCenter = (west + east) / 2;
        
        cells.push({
          id: `grid-${x}-${y}`,
          bounds: { south, west, north, east },
          center: [latCenter, lngCenter],
          no2: Math.round(val),
          cloudCover: 0,
          isCloudImputed: false,
        });
      }
    }
  }

  fs.writeFileSync('public/heatmap_grid.json', JSON.stringify(cells));
  console.log(`Generated ${cells.length} grid cells.`);
}
run().catch(console.error);
