/**
 * "Why is NO₂ high or low here?" for a tapped point: the country (or ocean) and continent, current
 * statistics from the displayed layer, and curated explanations of the main sources and sinks.
 * Everything is local (no API calls), so it also works in offline / demo mode.
 */
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import { worldCountries } from './countries';

type Continent = 'Asia' | 'Europe' | 'Africa' | 'North America' | 'South America' | 'Oceania' | 'Antarctica';

const CONTINENT_OF: Record<Continent, string[]> = {
  Asia: ['Afghanistan', 'Armenia', 'Azerbaijan', 'Bangladesh', 'Bhutan', 'Brunei', 'Cambodia', 'China', 'Cyprus',
    'Georgia', 'India', 'Indonesia', 'Iran', 'Iraq', 'Israel', 'Japan', 'Jordan', 'Kazakhstan', 'Kuwait',
    'Kyrgyzstan', 'Laos', 'Lebanon', 'Malaysia', 'Mongolia', 'Myanmar', 'N. Cyprus', 'Nepal', 'North Korea', 'Oman',
    'Pakistan', 'Palestine', 'Philippines', 'Qatar', 'Saudi Arabia', 'South Korea', 'Sri Lanka', 'Syria', 'Taiwan',
    'Tajikistan', 'Thailand', 'Timor-Leste', 'Turkey', 'Turkmenistan', 'United Arab Emirates', 'Uzbekistan',
    'Vietnam', 'Yemen'],
  Europe: ['Albania', 'Austria', 'Belarus', 'Belgium', 'Bosnia and Herz.', 'Bulgaria', 'Croatia', 'Czechia', 'Denmark',
    'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Italy', 'Kosovo', 'Latvia',
    'Lithuania', 'Luxembourg', 'Macedonia', 'Moldova', 'Montenegro', 'Netherlands', 'Norway', 'Poland', 'Portugal',
    'Romania', 'Russia', 'Serbia', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Ukraine',
    'United Kingdom'],
  Africa: ['Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cameroon', 'Central African Rep.',
    'Chad', 'Congo', "Côte d'Ivoire", 'Dem. Rep. Congo', 'Djibouti', 'Egypt', 'Eq. Guinea', 'Eritrea', 'Ethiopia',
    'Gabon', 'Gambia', 'Ghana', 'Guinea', 'Guinea-Bissau', 'Kenya', 'Lesotho', 'Liberia', 'Libya', 'Madagascar',
    'Malawi', 'Mali', 'Mauritania', 'Morocco', 'Mozambique', 'Namibia', 'Niger', 'Nigeria', 'Rwanda', 'S. Sudan',
    'Senegal', 'Sierra Leone', 'Somalia', 'Somaliland', 'South Africa', 'Sudan', 'Tanzania', 'Togo', 'Tunisia',
    'Uganda', 'W. Sahara', 'Zambia', 'Zimbabwe', 'eSwatini'],
  'North America': ['Bahamas', 'Belize', 'Canada', 'Costa Rica', 'Cuba', 'Dominican Rep.', 'El Salvador', 'Greenland',
    'Guatemala', 'Haiti', 'Honduras', 'Jamaica', 'Mexico', 'Nicaragua', 'Panama', 'Puerto Rico',
    'Trinidad and Tobago', 'United States of America'],
  'South America': ['Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Ecuador', 'Falkland Is.', 'Guyana',
    'Paraguay', 'Peru', 'Suriname', 'Uruguay', 'Venezuela'],
  Oceania: ['Australia', 'Fiji', 'New Caledonia', 'New Zealand', 'Papua New Guinea', 'Solomon Is.', 'Vanuatu'],
  Antarctica: ['Antarctica', 'Fr. S. Antarctic Lands'],
};

const CONTINENT_BY_COUNTRY = new Map<string, Continent>(
  (Object.entries(CONTINENT_OF) as [Continent, string[]][]).flatMap(([c, names]) => names.map((n) => [n, c] as const)),
);

const DISPLAY_NAME: Record<string, string> = {
  'United States of America': 'United States',
  'Dem. Rep. Congo': 'DR Congo',
  'Central African Rep.': 'Central African Republic',
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Dominican Rep.': 'Dominican Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  'S. Sudan': 'South Sudan',
  'W. Sahara': 'Western Sahara',
  'Macedonia': 'North Macedonia',
};

interface Knowledge {
  /** Main sources where NO₂ is high. */
  sources: string;
  /** Why much of the area is lower. */
  cleaner: string;
  /** Optional seasonal note: months (1-12) when it applies. */
  season?: { months: number[]; text: string }[];
}

const COUNTRY: Record<string, Knowledge> = {
  India: {
    sources:
      'Coal power plant clusters (Singrauli, Korba, Talcher), heavy industry and dense traffic across the Indo-Gangetic Plain and big cities make northern and eastern India one of the largest NO₂ regions on Earth.',
    cleaner:
      'The Himalaya, the Thar Desert and the forested north-east have few sources, so values there stay near background.',
    season: [
      { months: [10, 11, 12, 1, 2], text: 'Winter: a shallow boundary layer, slower NO₂ loss and crop-residue and household burning push columns towards their yearly high.' },
      { months: [6, 7, 8, 9], text: 'Monsoon: rain, clouds and faster chemistry keep columns lower, and clouds hide much of the country from the satellite.' },
    ],
  },
  China: {
    sources:
      'The North China Plain (Beijing–Tianjin–Hebei), the Yangtze River Delta and the Pearl River Delta combine coal power, heavy industry and traffic, producing some of the highest NO₂ columns in the world.',
    cleaner:
      'Tibet, the Xinjiang deserts and Inner Mongolia are sparsely populated, and emission controls since the 2010s have lowered levels in the east.',
    season: [{ months: [11, 12, 1, 2, 3], text: 'Heating season: coal-fired heating and a shallow winter boundary layer raise columns across northern China.' }],
  },
  'United States of America': {
    sources:
      'Traffic and power generation around large metros (Los Angeles, New York, Chicago, Houston) and oil and gas fields such as the Permian Basin are the main hotspots.',
    cleaner:
      'Decades of vehicle and power-plant controls have steadily cut US NO₂; the Great Plains, deserts and Alaska sit near background.',
  },
  Russia: {
    sources:
      'Moscow, St Petersburg, Urals industry and Siberian oil, gas and metal smelting (e.g. Norilsk) are the main sources.',
    cleaner: 'Most of the country is forest and tundra with almost no combustion, so the national average is close to background.',
    season: [{ months: [11, 12, 1, 2], text: 'In winter the low sun and snow limit satellite retrievals over much of Russia.' }],
  },
  Canada: {
    sources: 'The Toronto–Montreal corridor and the Alberta oil sands are the strongest NO₂ sources.',
    cleaner: 'The vast boreal forest and Arctic north are almost free of emissions.',
  },
  Brazil: {
    sources:
      'São Paulo and Rio de Janeiro traffic and industry are the main urban hotspots; farmland and forest-edge fires add NO₂ in the dry season.',
    cleaner: 'The intact Amazon rainforest has little combustion outside the fire season.',
    season: [{ months: [8, 9, 10], text: 'Fire season (August–October): burning along the southern Amazon and Cerrado raises columns well away from cities.' }],
  },
  Australia: {
    sources: 'Coal power stations in the Hunter and Latrobe valleys and Sydney and Melbourne traffic are the main sources.',
    cleaner: 'The dry interior has almost no emissions, so most of the continent is at background.',
  },
  Indonesia: {
    sources: "Jakarta's traffic and Java's coal power plants dominate; peat and forest fires add NO₂ in dry years.",
    cleaner: 'Much of Borneo, Sumatra and Papua is forest, and frequent tropical clouds limit satellite coverage.',
  },
  Japan: {
    sources: 'The Tokyo–Osaka megalopolis, industrial coastline and busy shipping lanes are the main sources.',
    cleaner: 'Strict vehicle standards and a mountainous, forested interior keep much of the country low.',
  },
  'South Korea': {
    sources: 'The Seoul metropolitan area, heavy industry at Ulsan and Pohang and coal power on the west coast drive high columns.',
    cleaner: 'Mountains in the east are cleaner; part of the NO₂ also arrives with westerly winds from mainland Asia.',
  },
  Germany: {
    sources: 'The Ruhr industrial region, a dense motorway network and lignite power plants are the main sources.',
    cleaner: 'EU vehicle and power-plant standards are lowering levels year on year; rural areas are near background.',
  },
  'United Kingdom': {
    sources: 'London, the motorway corridors and industry in the Midlands and North are the hotspots, plus North Sea shipping.',
    cleaner: 'Frequent Atlantic winds disperse pollution, and Scotland and Wales have few sources.',
  },
  France: {
    sources: 'Paris and the Rhône valley (Lyon) are the main hotspots, driven by traffic and industry.',
    cleaner: 'Nuclear power means few coal plants, so rural France is relatively clean.',
  },
  Italy: {
    sources: 'The Po Valley combines industry, traffic and farming in a basin surrounded by the Alps that traps pollution.',
    cleaner: 'The south and islands have fewer sources and better ventilation.',
  },
  Spain: {
    sources: 'Madrid and Barcelona traffic and heavy ship traffic through the Strait of Gibraltar are the main sources.',
    cleaner: 'The sparsely populated interior plateau stays close to background.',
  },
  Poland: {
    sources: 'Coal-dominated power and heating (Silesia, Bełchatów) make southern Poland one of Europe’s NO₂ hotspots.',
    cleaner: 'The north-east is mostly farmland and forest with few sources.',
  },
  Netherlands: {
    sources: 'The port of Rotterdam, dense traffic and industry make the Netherlands one of Europe’s highest NO₂ areas.',
    cleaner: 'Sea breezes help, but the country is small and densely built, so few areas are truly clean.',
  },
  Belgium: {
    sources: 'Antwerp’s port and petrochemical cluster, Brussels traffic and dense motorways give high columns.',
    cleaner: 'The Ardennes in the south-east are the cleanest part of the country.',
  },
  Turkey: {
    sources: 'Istanbul and Ankara traffic, coal power and industry in the north-west are the main sources.',
    cleaner: 'Central and eastern Anatolia are sparsely populated and cleaner.',
  },
  Iran: {
    sources: 'Tehran’s traffic trapped in a mountain basin, and oil and gas production in Khuzestan and on the Gulf coast, drive high columns.',
    cleaner: 'The central deserts (Dasht-e Kavir, Dasht-e Lut) have almost no emissions.',
  },
  'Saudi Arabia': {
    sources: 'Oil and gas production, power and desalination plants on the Gulf coast (Jubail, Dammam) and Riyadh traffic are the main sources.',
    cleaner: 'The Empty Quarter and other deserts are at background.',
  },
  Iraq: {
    sources: 'Gas flaring at oil fields around Basra, power generation and Baghdad traffic produce strong NO₂.',
    cleaner: 'The western desert is largely free of sources.',
  },
  Kuwait: {
    sources: 'Oil production, refineries and power plants concentrated in a small area give very high columns.',
    cleaner: 'Few parts of Kuwait are far from these sources.',
  },
  Qatar: {
    sources: 'Gas liquefaction at Ras Laffan, power plants and Doha traffic make Qatar a strong NO₂ source for its size.',
    cleaner: 'Desert inland is cleaner, though the country is small.',
  },
  'United Arab Emirates': {
    sources: 'Oil and gas, aluminium smelting, power and desalination plants and Dubai–Abu Dhabi traffic dominate.',
    cleaner: 'The inland desert is close to background.',
  },
  Egypt: {
    sources: 'Greater Cairo, one of Africa’s largest cities, and industry along the Nile valley and delta concentrate NO₂.',
    cleaner: 'Over 90% of Egypt is desert with almost no emissions.',
  },
  'South Africa': {
    sources:
      'The Mpumalanga Highveld coal power stations are one of the strongest NO₂ hotspots in the world, next to Johannesburg–Pretoria traffic and industry.',
    cleaner: 'The Karoo, Northern Cape and coasts away from cities are clean.',
    season: [{ months: [6, 7, 8], text: 'Winter: temperature inversions over the Highveld trap emissions near the ground and raise columns.' }],
  },
  Nigeria: {
    sources: 'Lagos traffic and gas flaring in the Niger Delta are the main sources; dry-season burning adds more in the north.',
    cleaner: 'The rural north and east have fewer sources, and tropical clouds limit coverage in the wet season.',
    season: [{ months: [12, 1, 2], text: 'Dry season: savanna and agricultural fires raise NO₂ over the north.' }],
  },
  Pakistan: {
    sources: 'Lahore and the Punjab plain continue the Indo-Gangetic pollution belt; Karachi’s traffic and industry add another hotspot.',
    cleaner: 'Balochistan and the northern mountains have few sources.',
    season: [{ months: [10, 11, 12, 1], text: 'Winter: crop-residue burning and stagnant air bring the highest levels over Punjab.' }],
  },
  Bangladesh: {
    sources: 'Dhaka’s traffic, thousands of brick kilns and one of the world’s highest population densities drive high NO₂.',
    cleaner: 'Monsoon rain and clouds lower columns and satellite coverage from June to September.',
  },
  Mexico: {
    sources: 'The Mexico City basin (2,240 m altitude, ringed by mountains) traps pollution; Monterrey industry is another hotspot.',
    cleaner: 'Northern deserts and the Yucatán have few sources.',
  },
  Argentina: {
    sources: 'Buenos Aires traffic and industry are the main source.',
    cleaner: 'The Pampas and Patagonia are sparsely populated and windy, so values are near background.',
  },
  Kazakhstan: {
    sources: 'Coal power and metallurgy around Ekibastuz and Karaganda, and Almaty traffic, are the main sources.',
    cleaner: 'The vast steppe and deserts have almost no emissions.',
  },
  Thailand: {
    sources: 'Bangkok traffic and industry dominate; agricultural burning adds NO₂ in the dry season.',
    cleaner: 'Rural and forested areas are cleaner, especially in the wet season.',
    season: [{ months: [2, 3, 4], text: 'Late dry season: crop and forest burning raises columns across the north.' }],
  },
  Vietnam: {
    sources: 'Hanoi and Ho Chi Minh City traffic, industry and coal power in the north are the main sources.',
    cleaner: 'The central highlands and mountains are cleaner.',
  },
  Ukraine: {
    sources: 'Heavy industry and coal power in the east (Donbas) and around Dnipro and Kyiv are the main sources.',
    cleaner: 'Farmland across the centre and west has fewer sources.',
  },
  'Dem. Rep. Congo': {
    sources: 'Seasonal savanna and agricultural fires in the south are the largest source; Kinshasa adds an urban hotspot.',
    cleaner: 'The central rainforest has little combustion and frequent clouds.',
    season: [{ months: [6, 7, 8, 9], text: 'Southern dry season: widespread fires raise NO₂ across the south of the Congo basin.' }],
  },
  Mongolia: {
    sources: 'Ulaanbaatar’s coal heating and power make it a winter NO₂ hotspot.',
    cleaner: 'The steppe and Gobi Desert are almost free of emissions.',
  },
  Chile: {
    sources: 'Santiago, in a basin between the Andes and the coastal range, traps traffic emissions; copper smelters add more.',
    cleaner: 'The Atacama and Patagonia are near background.',
  },
  Antarctica: {
    sources: 'There are no significant NO₂ sources on the continent.',
    cleaner: 'Values are at background, and polar night hides it from the satellite for months each year.',
  },
  Greenland: {
    sources: 'There are almost no NO₂ sources on the ice sheet.',
    cleaner: 'Values are at background; low sun limits satellite retrievals outside summer.',
  },
};

const CONTINENT_TEXT: Record<Continent, string> = {
  Asia: 'Asia holds the world’s largest NO₂ regions — eastern China, northern India and the Persian Gulf — driven by coal power, industry and traffic in densely populated lowlands.',
  Europe: 'Europe’s NO₂ is concentrated in the Benelux–Ruhr–London–Po Valley cluster and big cities, and is falling thanks to EU vehicle and power-plant standards.',
  Africa: 'Africa is mostly low apart from South Africa’s Highveld coal plants, oil and gas flaring, big cities such as Cairo and Lagos, and seasonal savanna fires.',
  'North America': 'North America’s NO₂ comes from large metros, power plants and oil and gas fields; levels have fallen for decades under emission controls.',
  'South America': 'South America is mostly low; São Paulo, Buenos Aires, Santiago and seasonal forest and farmland fires are the main sources.',
  Oceania: 'Oceania is among the cleanest regions; Australian coal plants and big cities are the only notable sources.',
  Antarctica: 'Antarctica has no significant NO₂ sources and sits at background.',
};

const LEVEL_TEXT = {
  high: 'Columns this high usually come from coal power plants, heavy industry, oil and gas operations or dense city traffic.',
  elevated: 'This points to cities, industry or seasonal fires within the area, above the level of clean surroundings.',
  background: 'Few large combustion sources are active here, so the column is close to the natural background from soils and lightning.',
};

function oceanName(lat: number, lon: number): string {
  if (lat > 66) return 'Arctic Ocean';
  if (lat < -60) return 'Southern Ocean';
  if (lon >= 20 && lon < 120 && lat < 30) return 'Indian Ocean';
  if (lon >= -70 && lon < 20) return 'Atlantic Ocean';
  if (lon >= -100 && lon < -70 && lat > 8) return 'Atlantic Ocean';
  return 'Pacific Ocean';
}

// ------------------------------------------------------------------------------------------ geometry
type Rings = Position[][]; // polygon: outer ring + holes

interface CountryShape {
  name: string;
  polygons: Rings[];
  bbox: [number, number, number, number]; // west, south, east, north
}

let shapes: CountryShape[] | null = null;

function countryShapes(): CountryShape[] {
  if (shapes) return shapes;

  const fc = worldCountries();
  shapes = (fc.features as Feature<Polygon | MultiPolygon, { name: string }>[]).map((f) => {
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const poly of polygons)
      for (const [x, y] of poly[0]) {
        w = Math.min(w, x);
        e = Math.max(e, x);
        s = Math.min(s, y);
        n = Math.max(n, y);
      }
    return { name: f.properties.name, polygons, bbox: [w, s, e, n] };
  });
  return shapes;
}

function inRing(lon: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inShape(lon: number, lat: number, shape: CountryShape): boolean {
  const [w, s, e, n] = shape.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return false;
  return shape.polygons.some((rings) => inRing(lon, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lon, lat, h)));
}

// ------------------------------------------------------------------------------------------ insight
export interface RegionField {
  width: number;
  height: number;
  resDeg: number;
  values: Float32Array; // RG frame 0: [column, confidence] per cell
  observed: Float32Array; // 1 = observed in the window
}

export interface RegionInsight {
  name: string;
  continent: string | null;
  isOcean: boolean;
  lines: string[];
  outline: Position[][]; // rings to highlight on the globe
  stats: { mean: number; max: number; coverage: number; background: number; ratio: number } | null;
}

function globalBackground(field: RegionField): number {
  const picked: number[] = [];
  for (let k = 0; k < field.observed.length; k += 11) if (field.observed[k] >= 1) picked.push(field.values[2 * k]);
  if (!picked.length) return 5;
  picked.sort((a, b) => a - b);
  return Math.max(1, picked[picked.length >> 1]);
}

function regionStats(field: RegionField, contains: (lon: number, lat: number) => boolean, bbox: [number, number, number, number]) {
  const { width, height, resDeg } = field;
  const i0 = Math.max(0, Math.floor((bbox[0] + 180) / resDeg));
  const i1 = Math.min(width - 1, Math.ceil((bbox[2] + 180) / resDeg));
  const j0 = Math.max(0, Math.floor((90 - bbox[3]) / resDeg));
  const j1 = Math.min(height - 1, Math.ceil((90 - bbox[1]) / resDeg));
  let cells = 0;
  let seen = 0;
  let sum = 0;
  let max = -Infinity;
  for (let j = j0; j <= j1; j++) {
    const lat = 90 - (j + 0.5) * resDeg;
    for (let i = i0; i <= i1; i++) {
      const lon = -180 + (i + 0.5) * resDeg;
      if (!contains(lon, lat)) continue;
      cells++;
      const k = j * width + i;
      if (field.observed[k] >= 1) {
        seen++;
        const v = field.values[2 * k];
        sum += v;
        max = Math.max(max, v);
      }
    }
  }
  return { cells, seen, mean: seen ? sum / seen : NaN, max };
}

function fmt(v: number): string {
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}

/** Explanation for the tapped point, or null when the field is not loaded. */
export function explainRegion(lat: number, lon: number, field: RegionField | null, month: number): RegionInsight {
  const shape = countryShapes().find((c) => inShape(lon, lat, c)) ?? null;
  const background = field ? globalBackground(field) : 5;
  const lines: string[] = [];
  let stats: RegionInsight['stats'] = null;

  if (!shape) {
    const name = oceanName(lat, lon);
    if (field) {
      const box: [number, number, number, number] = [lon - 5, lat - 5, lon + 5, lat + 5];
      const s = regionStats(field, (x, y) => Math.abs(x - lon) <= 5 && Math.abs(y - lat) <= 5, box);
      if (s.seen > 3) {
        stats = { mean: s.mean, max: s.max, coverage: s.seen / s.cells, background, ratio: s.mean / background };
        lines.push(`Around this point the column averages ${fmt(s.mean)} µmol/m², ${stats.ratio.toFixed(1)}× the global background (${fmt(background)}).`);
      }
    }
    lines.push('The open ocean has no combustion sources, so NO₂ stays near background.');
    lines.push('Faint enhancements can appear along busy shipping lanes and where polluted air flows off nearby coasts.');
    return { name, continent: null, isOcean: true, lines, outline: [], stats };
  }

  const continent = CONTINENT_BY_COUNTRY.get(shape.name) ?? null;
  const name = DISPLAY_NAME[shape.name] ?? shape.name;
  const knowledge = COUNTRY[shape.name];

  let level: keyof typeof LEVEL_TEXT = 'background';
  if (field) {
    const s = regionStats(field, (x, y) => inShape(x, y, shape), shape.bbox);
    if (s.cells && s.seen / s.cells >= 0.03) {
      stats = { mean: s.mean, max: s.max, coverage: s.seen / s.cells, background, ratio: s.mean / background };
      level = stats.ratio >= 2.2 || s.max >= background * 8 ? 'high' : stats.ratio >= 1.35 ? 'elevated' : 'background';
      const verdict = level === 'high' ? 'high by world standards' : level === 'elevated' ? 'above the global background' : 'close to the global background';
      lines.push(
        `${name} averages ${fmt(s.mean)} µmol/m² over the ${Math.round(stats.coverage * 100)}% seen in the last passes — ${verdict} (${stats.ratio.toFixed(1)}× the global ${fmt(background)}), peaking at ${fmt(s.max)}.`,
      );
    } else {
      lines.push(`Clouds or darkness hid ${name} from the satellite in the latest passes, so there is no current value; the usual pattern is:`);
    }
  }

  if (knowledge) {
    lines.push(knowledge.sources, knowledge.cleaner);
    const seasonal = knowledge.season?.find((s) => s.months.includes(month));
    if (seasonal) lines.push(seasonal.text);
  } else {
    if (continent) lines.push(CONTINENT_TEXT[continent]);
    lines.push(LEVEL_TEXT[level]);
  }

  const outline = shape.polygons.map((rings) => rings[0]);
  return { name, continent, isOcean: false, lines: lines.slice(0, 4), outline, stats };
}
