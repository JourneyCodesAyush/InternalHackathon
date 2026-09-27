const GeoTIFF = require('geotiff');
const fs = require('fs');
const path = require('path');

const dir = '/home/revo/Desktop/InternalHackathon/backend/data/mumbai_no2_2025/';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.tif'));

async function run() {
  let sum = null;
  let count = null;
  let width = 0, height = 0;
  let bbox = null;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const tiff = await GeoTIFF.fromFile(filePath);
    const image = await tiff.getImage();
    const raster = await image.readRasters();
    const data = raster[0];
    
    if (!sum) {
      width = image.getWidth();
      height = image.getHeight();
      bbox = image.getBoundingBox();
      sum = new Float32Array(width * height);
      count = new Int32Array(width * height);
    }
    
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== -9999 && !isNaN(data[i])) {
        sum[i] += data[i];
        count[i]++;
      }
    }
  }

  const avg = new Float32Array(width * height);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < width * height; i++) {
    if (count[i] > 0) {
      avg[i] = sum[i] / count[i];
      if (avg[i] < min) min = avg[i];
      if (avg[i] > max) max = avg[i];
    } else {
      avg[i] = 0;
    }
  }

  const result = {
    width,
    height,
    bbox,
    min,
    max,
    data: Array.from(avg)
  };

  fs.writeFileSync('public/heatmap_average.json', JSON.stringify(result));
  console.log(`Processed ${files.length} files.`);
  console.log(`Grid: ${width}x${height}, Min: ${min.toFixed(2)}, Max: ${max.toFixed(2)}`);
}
run().catch(console.error);
