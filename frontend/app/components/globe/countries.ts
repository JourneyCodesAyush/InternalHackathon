/**
 * World country polygons (Natural Earth 110 m via world-atlas) with India drawn as officially depicted by
 * the Government of India: the whole of Jammu & Kashmir and Ladakh, including Gilgit-Baltistan, the
 * Pakistan-administered part of Kashmir, the Shaksgam valley and Aksai Chin. The source data follows the
 * de-facto lines of control, so those areas are cut from Pakistan and China and merged into India.
 *
 * Shared by the 3-D globe (base map borders), the 2-D map and the tap-a-region lookup, so all three agree.
 * At 110 m (global) scale the claim outline below is a generalised trace of the official boundary.
 */
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import polygonClipping, { type MultiPolygon as ClipMulti } from 'polygon-clipping';
import countriesTopo from 'world-atlas/countries-110m.json';

export type CountryFeature = Feature<Polygon | MultiPolygon, { name: string }>;

/**
 * Outer boundary of the Union Territories of Jammu & Kashmir and Ladakh as shown on the official map of
 * India ([lon, lat]). Its southern side lies inside India, so only its west, north and east edges matter:
 * west along Khyber Pakhtunkhwa / Chitral, north along the Wakhan corridor, north-east along the Kun Lun
 * (Shaksgam, Aksai Chin), east down to Lanak La and the Pangong / Chushul sector.
 */
const JK_LADAKH_OFFICIAL: Position[] = [
  [74.05, 32.95], // Bhimber, south tip of PoK
  [73.65, 33.2],
  [73.45, 33.6],
  [73.4, 33.95],
  [73.3, 34.25],
  [73.55, 34.62], // Kunhar / Kaghan side
  [73.95, 34.9],
  [74.05, 35.15], // Babusar
  [73.65, 35.3],
  [73.3, 35.6],
  [72.9, 35.85],
  [72.55, 36.1], // Shandur (Chitral border)
  [72.9, 36.5],
  [73.35, 36.88],
  [74.0, 36.95], // Wakhan corridor
  [74.55, 37.05],
  [74.9, 37.25], // Kilik / Mintaka, tri-junction with Afghanistan and China
  [75.35, 37.2],
  [75.5, 36.95],
  [76.2, 36.75],
  [76.8, 36.45], // Shaksgam valley
  [77.5, 36.15],
  [78.1, 35.95],
  [78.8, 36.05],
  [79.4, 35.95], // Aksai Chin, northern edge along the Kun Lun
  [80.05, 35.75],
  [80.3, 35.4],
  [80.1, 34.95],
  [79.55, 34.4], // Lanak La
  [79.1, 34.1],
  [78.8, 33.6], // Pangong / Chushul
  [78.9, 33.0],
  [78.4, 32.5], // south closure inside India (Himachal / Punjab)
  [76.0, 32.3],
  [74.8, 32.55], // Jammu - Sialkot border
  [74.35, 32.78],
  [74.05, 32.95],
];

let cache: FeatureCollection<Polygon | MultiPolygon, { name: string }> | null = null;

const toClip = (g: Polygon | MultiPolygon): ClipMulti =>
  (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as ClipMulti;
const fromClip = (m: ClipMulti): Polygon | MultiPolygon =>
  m.length === 1 ? { type: 'Polygon', coordinates: m[0] } : { type: 'MultiPolygon', coordinates: m };

/** All countries, with India's official boundary (memoised). */
export function worldCountries(): FeatureCollection<Polygon | MultiPolygon, { name: string }> {
  if (cache) return cache;
  const topo = countriesTopo as unknown as Topology;
  const fc = feature(topo, topo.objects.countries as GeometryCollection) as FeatureCollection<
    Polygon | MultiPolygon,
    { name: string }
  >;
  const claim: ClipMulti = [[JK_LADAKH_OFFICIAL as [number, number][]]];
  const india = fc.features.find((f) => f.properties.name === 'India');
  let gained: ClipMulti = [];
  const features = fc.features.map((f) => {
    if (f.properties.name !== 'Pakistan' && f.properties.name !== 'China') return f;
    const geom = toClip(f.geometry);
    gained = polygonClipping.union(gained, polygonClipping.intersection(geom, claim));
    const rest = polygonClipping.difference(geom, claim);
    return { ...f, geometry: fromClip(rest) } as CountryFeature;
  });
  if (india) {
    const merged = polygonClipping.union(toClip(india.geometry), gained);
    const idx = features.indexOf(india);
    features[idx] = { ...india, geometry: fromClip(merged) };
  }
  cache = { type: 'FeatureCollection', features };
  return cache;
}

/** Every country ring as a line (shared borders are drawn by both neighbours). */
export function countryRings(): Position[][] {
  return worldCountries().features.flatMap((f) =>
    (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flat(),
  );
}
