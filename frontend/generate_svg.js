const fs = require('fs');

const cells = JSON.parse(fs.readFileSync('public/heatmap_grid.json', 'utf8'));

// The grid was 40x52.
const width = 40;
const height = 52;

// The bounds from the TIF
const bbox = [ 72.77, 18.865, 73.11999999999999, 19.32 ];
const minLng = bbox[0];
const minLat = bbox[1];
const maxLng = bbox[2];
const maxLat = bbox[3];

function getHazardColor(no2) {
  if (no2 <= 40) return '#4ade80';
  if (no2 <= 65) return '#facc15';
  if (no2 <= 120) return '#fb923c';
  if (no2 <= 200) return '#ef4444';
  return '#9f1239';
}

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n`;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const id = `grid-${x}-${y}`;
    const cell = cells.find(c => c.id === id);
    if (cell && cell.no2 > 0) {
      const color = getHazardColor(cell.no2);
      svg += `  <rect x="${x}" y="${y}" width="1" height="1" fill="${color}" opacity="0.6" />\n`;
    }
  }
}

svg += `</svg>`;

fs.writeFileSync('public/heatmap_overlay.svg', svg);
console.log('SVG generated.');
