'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { drawBaseMap } from './globeData';
import type { FluxVector, GatewayItem } from './transboundaryData';
import { FLUX_CASING, fluxArrows, fluxColour, hexToRgb } from './fluxStyle';

// Colour scale (log) in µmol/m²: clean background (~3-8) stays transparent, large polluted cities saturate.
// 1 µmol/m² = 6.02e13 molecules/cm², so 8 ≈ 5e14 and 160 ≈ 1e16 molecules/cm².
export const MIN_COLUMN = 8;
export const MAX_COLUMN = 160;

export interface GlobeFrames {
  width: number;
  height: number;
  frames: Float32Array[]; // RG: column, confidence (see globeFlow.worker)
  ageH: Float32Array;
  u: Float32Array;
  v: Float32Array;
}

export interface HoverInfo {
  lat: number;
  lon: number;
  x: number;
  y: number;
}

interface GlobeCanvasProps {
  data: GlobeFrames | null;
  /** Fractional frame index, e.g. 2.4 = 40% between frames 2 and 3. */
  frameIndex: number;
  highlightNewest: boolean;
  newestHours: number;
  autoRotate: boolean;
  showWind: boolean;
  fluxVectors?: FluxVector[] | null;
  gateways?: GatewayItem[] | null;
  showFlux?: boolean;
  onHover: (info: HoverInfo | null) => void;
  /** A tap (not a drag) on the globe, or null for a tap on empty space. */
  onSelect: (point: { lat: number; lon: number } | null) => void;
  /** Rings of [lon, lat] to outline (the selected country), or null. */
  outline: number[][][] | null;
  /** Filled with the controls for the 2-D <-> 3-D transition once the scene exists. */
  apiRef?: React.MutableRefObject<GlobeApi | null>;
}

/** Map view shared with the 2-D map: centre and MapLibre zoom (512 px world at zoom 0). */
export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

export interface GlobeApi {
  /** Unroll the sphere into a flat Web-Mercator map around the current view; resolves with the matching view. */
  flatten: (durationMs?: number) => Promise<MapView>;
  /** Show the flat map at ``view`` (instantly), ready to be rolled back up. */
  showFlat: (view: MapView) => void;
  /** Roll the flat map back into the globe. */
  roll: (durationMs?: number) => Promise<void>;
  /** Pause / resume rendering (paused while the 2-D map is shown). */
  setActive: (active: boolean) => void;
  /** Globe distance limits expressed as MapLibre zooms at ``lat`` (for easing the 2-D map before rolling up). */
  zoomRange: (lat: number) => [number, number];
  /**
   * Fly the camera to a point: along the surface (great circle), easing out to give context mid-flight on
   * long hops, ending at ``distance`` (globe radii from the centre). Resolves when the flight ends.
   */
  focus: (lat: number, lon: number, distance?: number) => Promise<void>;
  /** Shift the rendered globe left by ``px`` (to keep it centred beside a side panel), animated. */
  setViewShift: (px: number, durationMs?: number) => Promise<void>;
}

const FOV = 40;
const MIN_DISTANCE = 1.35;
const MAX_DISTANCE = 8;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Globe surface. uMorph blends each vertex from the sphere to a flat Web-Mercator sheet tangent at the view
// centre (uCenter, with its east/north axes), scaled so the centre keeps its size: the globe "unrolls".
const GLOBE_VERTEX = /* glsl */ `
  uniform float uMorph;
  uniform vec3 uCenter;
  uniform vec3 uEast;
  uniform vec3 uNorth;
  uniform float uLat0;
  uniform float uLon0;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vRel;
  varying float vRaw;
  const float PI = 3.141592653589793;
  float merc(float lat) {
    float l = clamp(lat, -1.4844, 1.4844); // +-85.05 deg
    return log(tan(PI / 4.0 + l / 2.0));
  }
  void main() {
    vUv = uv;
    float lon = uv.x * 2.0 * PI - PI;
    float lat = uv.y * PI - PI / 2.0;
    float raw = lon - uLon0;
    float rel = raw - 2.0 * PI * floor((raw + PI) / (2.0 * PI));
    vRel = rel;
    vRaw = raw;
    float k = cos(uLat0);
    vec3 sheet = uCenter + uEast * (rel * k) + uNorth * ((merc(lat) - merc(uLat0)) * k);
    vec3 p = mix(position, sheet, uMorph);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vNormal = normalize(mat3(modelMatrix) * mix(normal, uCenter, uMorph));
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Base map + NO2 layer. Data textures are north-up rows, so v is flipped; frames cross-fade on the GPU.
const FRAGMENT = /* glsl */ `
  uniform sampler2D uBase;
  uniform sampler2D uLines;
  uniform sampler2D uA;
  uniform sampler2D uB;
  uniform sampler2D uAge;
  uniform float uMix;
  uniform float uMin;
  uniform float uMax;
  uniform float uHighlight;
  uniform float uNewest;
  uniform float uHasData;
  uniform float uMorph;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vRel;
  varying float vRaw;

  vec3 ramp(float t) {
    // dark violet -> magenta -> orange -> pale yellow (perceptually ordered, readable on a dark globe)
    vec3 c0 = vec3(0.23, 0.10, 0.45);
    vec3 c1 = vec3(0.62, 0.16, 0.55);
    vec3 c2 = vec3(0.93, 0.35, 0.28);
    vec3 c3 = vec3(0.99, 0.70, 0.22);
    vec3 c4 = vec3(1.00, 0.96, 0.70);
    if (t < 0.25) return mix(c0, c1, t / 0.25);
    if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
    if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
    return mix(c3, c4, (t - 0.75) / 0.25);
  }

  void main() {
    if (uMorph > 0.0005) {
      // triangles straddling the seam opposite the view centre would stretch across the whole sheet:
      // inside them the wrapped and unwrapped longitudes differ by a non-whole number of turns
      float turns = (vRel - vRaw) / 6.283185307179586;
      if (abs(turns - floor(turns + 0.5)) > 0.001) discard;
    }
    vec3 base = texture2D(uBase, vUv).rgb;
    vec2 dUv = vec2(vUv.x, 1.0 - vUv.y);
    vec2 a = texture2D(uA, dUv).rg;
    vec2 b = texture2D(uB, dUv).rg;
    vec2 s = mix(a, b, uMix);
    float t = clamp(log(max(s.x, 0.01) / uMin) / log(uMax / uMin), 0.0, 1.0);
    float alpha = uHasData * s.y * smoothstep(0.0, 0.3, t) * 0.95;
    if (uHighlight > 0.5) {
      float age = texture2D(uAge, dUv).r;
      alpha *= age <= uNewest ? 1.0 : 0.22;
    }
    vec3 col = mix(base, ramp(t), alpha);
    // coastlines and borders on top: light over clean areas, dark over bright NO2 so they stay visible
    float line = texture2D(uLines, vUv).a;
    col = mix(col, mix(vec3(0.55, 0.66, 0.85), vec3(0.08, 0.05, 0.12), alpha), line * 0.75);
    // soft limb darkening + rim light
    float ndv = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    col *= mix(0.55 + 0.45 * pow(ndv, 0.6), 1.0, uMorph);
    col += vec3(0.20, 0.35, 0.70) * pow(1.0 - ndv, 3.0) * 0.35 * (1.0 - uMorph);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.5);
    gl_FragColor = vec4(0.30, 0.55, 1.0, 1.0) * rim * 0.9 * uOpacity;
  }
`;

// Cross-border flux "wind swoosh": a ribbon mesh with per-vertex position along it (0 tail .. 1 tip) and
// across it (-1 .. 1). The tail fades in, edges are soft, and bands of light sweep towards the tip.
const SWOOSH_VERTEX = /* glsl */ `
  attribute float along;
  attribute float across;
  attribute vec3 tint;
  varying float vAlong;
  varying float vAcross;
  varying vec3 vTint;
  void main() {
    vAlong = along;
    vAcross = across;
    vTint = tint;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SWOOSH_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uCasing;
  uniform vec3 uCasingColour;
  varying float vAlong;
  varying float vAcross;
  varying vec3 vTint;
  void main() {
    float tail = mix(0.25, 1.0, smoothstep(0.0, 0.3, vAlong));
    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vAcross));
    if (uCasing > 0.5) {
      gl_FragColor = vec4(uCasingColour, 0.55 * tail);
      return;
    }
    // two soft light bands travelling tail -> tip along the shaft
    float band = fract(vAlong * 1.6 - uTime * 0.55);
    float gust = smoothstep(0.0, 0.18, band) * (1.0 - smoothstep(0.18, 0.55, band)) * (1.0 - step(0.8, vAlong));
    vec3 col = mix(vTint, vec3(1.0), gust * 0.6 * edge);
    gl_FragColor = vec4(col, tail * mix(0.55, 1.0, edge));
  }
`;

const WIND_PARTICLES = 5000;
const WIND_SPEED_FACTOR = 0.012; // degrees of drift per frame per m/s (visual only)
const WIND_TAIL_FRAMES = 22; // segment length, in frames of motion

/** Unit-sphere position matching three's SphereGeometry UVs (u = 0 at 180°W, v = 1 at the North Pole). */
function toXYZ(lat: number, lon: number, r: number, out: THREE.Vector3): THREE.Vector3 {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const theta = ((90 - lat) / 180) * Math.PI;
  return out.set(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
}

function frameTexture(data: Float32Array, width: number, height: number, channels: 1 | 2): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, channels === 2 ? THREE.RGFormat : THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export default function GlobeCanvas({
  data,
  frameIndex,
  highlightNewest,
  newestHours,
  autoRotate,
  showWind,
  fluxVectors,
  gateways,
  showFlux,
  onHover,
  onSelect,
  outline,
  apiRef,
}: GlobeCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    material: THREE.ShaderMaterial;
    controls: OrbitControls;
    textures: THREE.DataTexture[];
    ageTexture: THREE.DataTexture | null;
    wind: THREE.LineSegments;
    highlight: THREE.LineSegments;
    fluxLines: THREE.Group;
    fluxLayers: THREE.Mesh[];
    windState: { lat: Float32Array; lon: Float32Array; life: Float32Array } | null;
    field: GlobeFrames | null;
  } | null>(null);
  const propsRef = useRef({ autoRotate, showWind, fluxVectors, showFlux, onHover, onSelect });

  useEffect(() => {
    propsRef.current = { autoRotate, showWind, fluxVectors, showFlux, onHover, onSelect };
  }, [autoRotate, showWind, fluxVectors, showFlux, onHover, onSelect]);

  // Scene setup (once)
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, mount.clientWidth / mount.clientHeight, 0.01, 100);
    // start over South Asia: look from the direction of 20°N 78°E
    camera.position.copy(toXYZ(20, 78, 4.4, new THREE.Vector3()));

    const maps = drawBaseMap(4096);
    const baseTexture = new THREE.CanvasTexture(maps.base);
    baseTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    baseTexture.colorSpace = THREE.SRGBColorSpace;
    const linesTexture = new THREE.CanvasTexture(maps.lines);
    linesTexture.anisotropy = baseTexture.anisotropy;
    const empty = frameTexture(new Float32Array(2), 1, 1, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: GLOBE_VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.DoubleSide,
      uniforms: {
        uMorph: { value: 0 },
        uCenter: { value: new THREE.Vector3(1, 0, 0) },
        uEast: { value: new THREE.Vector3(0, 0, 1) },
        uNorth: { value: new THREE.Vector3(0, 1, 0) },
        uLat0: { value: 0 },
        uLon0: { value: 0 },
        uBase: { value: baseTexture },
        uLines: { value: linesTexture },
        uA: { value: empty },
        uB: { value: empty },
        uAge: { value: frameTexture(new Float32Array(1), 1, 1, 1) },
        uMix: { value: 0 },
        uMin: { value: MIN_COLUMN },
        uMax: { value: MAX_COLUMN },
        uHighlight: { value: 0 },
        uNewest: { value: 6 },
        uHasData: { value: 0 },
      },
    });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), material);
    scene.add(globe);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.08, 96, 48),
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        uniforms: { uOpacity: { value: 1 } },
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    scene.add(atmosphere);

    // Wind particles: short segments (tail -> head) advected along the GFS wind
    const windGeometry = new THREE.BufferGeometry();
    windGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WIND_PARTICLES * 6), 3));
    windGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(WIND_PARTICLES * 6), 3));
    const wind = new THREE.LineSegments(
      windGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    wind.frustumCulled = false;
    scene.add(wind);

    // Selected-country outline
    const highlight = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    highlight.frustumCulled = false;
    scene.add(highlight);

    // Cross-border flux arrows: tapered "wind swoosh" ribbons (dark casing under a lit core) over the surface
    const swooshTime = { value: 0 };
    const swooshMaterial = (casing: boolean) =>
      new THREE.ShaderMaterial({
        vertexShader: SWOOSH_VERTEX,
        fragmentShader: SWOOSH_FRAGMENT,
        uniforms: { uTime: swooshTime, uCasing: { value: casing ? 1 : 0 }, uCasingColour: { value: new THREE.Color(FLUX_CASING) } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    const fluxLayers = [true, false].map((casing, i) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), swooshMaterial(casing));
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 + i;
      return mesh;
    });
    const fluxLines = new THREE.Group();
    fluxLayers.forEach((m) => fluxLines.add(m));
    fluxLines.visible = false;
    scene.add(fluxLines);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = MIN_DISTANCE;
    controls.maxDistance = MAX_DISTANCE;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.7;
    controls.autoRotateSpeed = 0.35;
    let lastInteraction = 0;
    controls.addEventListener('start', () => (lastInteraction = performance.now()));
    controls.addEventListener('end', () => (lastInteraction = performance.now()));

    sceneRef.current = { material, controls, textures: [], ageTexture: null, wind, highlight, fluxLines, fluxLayers, windState: null, field: null };

    // Hover picking: ray -> sphere UV -> lat/lon
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (material.uniforms.uMorph.value > 0) return { hit: undefined, rect }; // no picking while unrolled
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return { hit: raycaster.intersectObject(globe, false)[0], rect };
    };
    // a tap selects; a drag (moved > 6 px or held > 500 ms) only rotates
    let down: { x: number; y: number; t: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!down) return;
      const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 500;
      down = null;
      if (!tap) return;
      const { hit } = pick(e);
      propsRef.current.onSelect(hit?.uv ? { lat: hit.uv.y * 180 - 90, lon: hit.uv.x * 360 - 180 } : null);
    };
    const onPointerMove = (e: PointerEvent) => {
      const { hit, rect } = pick(e);
      if (!hit?.uv) {
        propsRef.current.onHover(null);
        return;
      }
      propsRef.current.onHover({
        lat: hit.uv.y * 180 - 90,
        lon: hit.uv.x * 360 - 180,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    const onPointerLeave = () => propsRef.current.onHover(null);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const resize = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      applyViewShift(); // also updates the projection matrix
    });
    resize.observe(mount);

    const v3 = new THREE.Vector3();
    const stepWind = () => {
      const s = sceneRef.current;
      if (!s?.windState || !s.field) return;
      const { lat, lon, life } = s.windState;
      const { u, v, width, height } = s.field;
      const pos = s.wind.geometry.getAttribute('position') as THREE.BufferAttribute;
      const col = s.wind.geometry.getAttribute('color') as THREE.BufferAttribute;
      const res = 360 / width;
      for (let p = 0; p < WIND_PARTICLES; p++) {
        const i = Math.min(width - 1, Math.max(0, Math.floor((lon[p] + 180) / res)));
        const j = Math.min(height - 1, Math.max(0, Math.floor((90 - lat[p]) / res)));
        const k = j * width + i;
        const speed = Math.hypot(u[k], v[k]);
        const cos = Math.max(0.1, Math.cos((lat[p] * Math.PI) / 180));
        const tailLat = lat[p];
        const tailLon = lon[p];
        lon[p] += (u[k] * WIND_SPEED_FACTOR) / cos;
        lat[p] += v[k] * WIND_SPEED_FACTOR;
        life[p] -= 1;
        if (life[p] <= 0 || Math.abs(lat[p]) > 85) {
          lat[p] = Math.asin(Math.random() * 2 - 1) * (180 / Math.PI);
          lon[p] = Math.random() * 360 - 180;
          life[p] = 60 + Math.random() * 120;
          continue;
        }
        if (lon[p] > 180) lon[p] -= 360;
        if (lon[p] < -180) lon[p] += 360;
        // stretch the segment so it is visible (tail trails the head by a few frames)
        let dLon = lon[p] - tailLon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        toXYZ(tailLat - (lat[p] - tailLat) * WIND_TAIL_FRAMES, lon[p] - dLon * (WIND_TAIL_FRAMES + 1), 1.004, v3);
        pos.setXYZ(2 * p, v3.x, v3.y, v3.z);
        toXYZ(lat[p], lon[p], 1.004, v3);
        pos.setXYZ(2 * p + 1, v3.x, v3.y, v3.z);
        const b = Math.min(1, 0.35 + speed / 12);
        col.setXYZ(2 * p, 0, 0, 0);
        col.setXYZ(2 * p + 1, b * 0.8, b * 0.9, b);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    };

    // ---- 2-D <-> 3-D: unroll the sphere into a Web-Mercator sheet and back ----
    const uniforms = material.uniforms;
    // horizontal screen shift of the whole view (px): the globe sits centred in the space left of a side panel
    let viewShift = 0;
    const applyViewShift = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (Math.abs(viewShift) < 0.5) camera.clearViewOffset();
      else camera.setViewOffset(w, h, viewShift, 0, w, h);
      camera.updateProjectionMatrix();
    };
    const atmosphereUniforms = (atmosphere.material as THREE.ShaderMaterial).uniforms;
    let active = true;
    let morphing = false;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const setMorph = (m: number) => {
      uniforms.uMorph.value = m;
      atmosphereUniforms.uOpacity.value = Math.max(0, 1 - m * 2.5);
      // wind streaks and the outline live on the sphere: fade them out as it unrolls
      const fade = Math.max(0, 1 - m * 4);
      (wind.material as THREE.LineBasicMaterial).opacity = 0.8 * fade;
      (highlight.material as THREE.LineBasicMaterial).opacity = 0.95 * fade;
    };
    const setFrame = (lat: number, lon: number) => {
      const center = toXYZ(lat, lon, 1, new THREE.Vector3());
      const phi = ((lon + 180) / 360) * Math.PI * 2;
      const east = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi)).normalize();
      uniforms.uCenter.value.copy(center);
      uniforms.uEast.value.copy(east);
      uniforms.uNorth.value.copy(new THREE.Vector3().crossVectors(center, east).normalize());
      uniforms.uLat0.value = (lat * Math.PI) / 180;
      uniforms.uLon0.value = (lon * Math.PI) / 180;
    };
    // flat-sheet height visible at camera distance d, and the MapLibre zoom showing the same scale
    const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);
    const zoomFor = (d: number, lat: number) =>
      Math.log2((2 * Math.PI * Math.cos((lat * Math.PI) / 180) * mount.clientHeight) / (2 * (d - 1) * tanHalf * 512));
    const distanceFor = (zoom: number, lat: number) =>
      1 + (2 * Math.PI * Math.cos((lat * Math.PI) / 180) * mount.clientHeight) / (512 * Math.pow(2, zoom) * 2 * tanHalf);
    const animate = (ms: number, step: (t: number) => void) =>
      new Promise<void>((resolve) => {
        const t0 = performance.now();
        const tick = () => {
          const t = Math.min(1, (performance.now() - t0) / ms);
          step(ease(t));
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
    const view = () => {
      const p = camera.position;
      const d = p.length();
      const lat = (Math.asin(p.y / d) * 180) / Math.PI;
      // inverse of toXYZ: x = -cos(phi), z = sin(phi)
      let lon = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180;
      if (lon < -180) lon += 360;
      return { lat, lon, d };
    };

    if (apiRef) {
      apiRef.current = {
        flatten: async (ms = 1300) => {
          morphing = true;
          controls.enabled = false;
          controls.autoRotate = false;
          const start = view();
          const { lon } = start;
          let { lat, d } = start;
          // keep the sheet within Web-Mercator latitudes: swing the view towards the equator first
          const target = Math.max(-68, Math.min(68, lat));
          if (Math.abs(target - lat) > 0.5) {
            const from = lat;
            await animate(450, (t) => camera.position.copy(toXYZ(from + (target - from) * t, lon, d, new THREE.Vector3())));
            lat = target;
          }
          setFrame(lat, lon);
          await animate(ms, setMorph);
          morphing = false;
          ({ d } = view());
          return { lat, lon, zoom: zoomFor(d, lat) };
        },
        showFlat: ({ lat, lon, zoom }) => {
          const d = distanceFor(zoom, lat);
          camera.position.copy(toXYZ(lat, lon, d, new THREE.Vector3()));
          camera.lookAt(0, 0, 0);
          setFrame(lat, lon);
          setMorph(1);
          renderer.render(scene, camera);
        },
        roll: async (ms = 1300) => {
          morphing = true;
          await animate(ms, (t) => setMorph(1 - t));
          morphing = false;
          controls.enabled = true;
          lastInteraction = performance.now();
        },
        setActive: (on) => {
          active = on;
        },
        zoomRange: (lat) => [zoomFor(MAX_DISTANCE, lat), zoomFor(MIN_DISTANCE + 0.25, lat)],
        focus: async (lat, lon, distance = 2.2) => {
          if (morphing || uniforms.uMorph.value > 0) return;
          const d1 = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE + 0.15, distance));
          const d0 = camera.position.length();
          const fromDir = camera.position.clone().normalize();
          const toDir = toXYZ(lat, lon, 1, new THREE.Vector3());
          const angle = fromDir.angleTo(toDir);
          // rotate along the great circle (never through the Earth) and pull back mid-flight on long hops
          const spin = new THREE.Quaternion().setFromUnitVectors(fromDir, toDir);
          const still = new THREE.Quaternion();
          const q = new THREE.Quaternion();
          const lift = Math.min(1.6, angle * 0.9);
          const ms = 900 + Math.min(900, angle * 700);
          controls.enabled = false;
          morphing = true; // pauses auto-rotate and control damping during the flight
          await animate(ms, (t) => {
            q.slerpQuaternions(still, spin, t);
            const dist = d0 + (d1 - d0) * t + lift * Math.sin(Math.PI * t);
            camera.position.copy(fromDir).applyQuaternion(q).multiplyScalar(dist);
            camera.lookAt(0, 0, 0);
          });
          morphing = false;
          controls.target.set(0, 0, 0);
          controls.update();
          controls.enabled = true;
          lastInteraction = performance.now();
        },
        setViewShift: async (px, ms = 450) => {
          const from = viewShift;
          if (Math.abs(px - from) < 0.5) return;
          await animate(ms, (t) => {
            viewShift = from + (px - from) * t;
            applyViewShift();
          });
        },
      };
    }

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (!active) return;
      const { autoRotate: rotate, showWind: windOn } = propsRef.current;
      controls.autoRotate = !morphing && uniforms.uMorph.value === 0 && rotate && performance.now() - lastInteraction > 4000;
      if (!morphing && uniforms.uMorph.value === 0) controls.update();
      wind.visible = windOn && uniforms.uMorph.value < 0.25;
      fluxLines.visible = Boolean(propsRef.current.showFlux) && uniforms.uMorph.value === 0;
      swooshTime.value = performance.now() / 1000;
      if (wind.visible) stepWind();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(frame);
      if (apiRef) apiRef.current = null;
      resize.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      sceneRef.current?.textures.forEach((t) => t.dispose());
      sceneRef.current?.ageTexture?.dispose();
      baseTexture.dispose();
      linesTexture.dispose();
      empty.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [apiRef]);

  // New data: upload every frame once as a GPU texture; animation only swaps uniforms afterwards
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !data) return;
    s.textures.forEach((t) => t.dispose());
    s.ageTexture?.dispose();
    s.textures = data.frames.map((f) => frameTexture(f, data.width, data.height, 2));
    const age = data.ageH.map((a) => (Number.isFinite(a) ? a : 999));
    s.ageTexture = frameTexture(age, data.width, data.height, 1);
    s.material.uniforms.uAge.value = s.ageTexture;
    s.material.uniforms.uHasData.value = 1;
    s.field = data;
    const lat = new Float32Array(WIND_PARTICLES);
    const lon = new Float32Array(WIND_PARTICLES);
    const life = new Float32Array(WIND_PARTICLES);
    for (let p = 0; p < WIND_PARTICLES; p++) {
      lat[p] = Math.asin(Math.random() * 2 - 1) * (180 / Math.PI); // uniform over the sphere
      lon[p] = Math.random() * 360 - 180;
      life[p] = Math.random() * 180;
    }
    s.windState = { lat, lon, life };
  }, [data]);

  // Selected country outline: ring vertices as line-segment pairs just above the surface
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const positions: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const ring of outline ?? []) {
      for (let i = 1; i < ring.length; i++) {
        const [lon0, lat0] = ring[i - 1];
        const [lon1, lat1] = ring[i];
        if (Math.abs(lon1 - lon0) > 180) continue; // dateline cut
        toXYZ(lat0, lon0, 1.003, a);
        toXYZ(lat1, lon1, 1.003, b);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    s.highlight.geometry.dispose();
    s.highlight.geometry = new THREE.BufferGeometry();
    s.highlight.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  }, [outline]);

  // Cross-border flux arrows: each a tapered ribbon along a great-circle arc lifted over the surface, thin and
  // faded at the upwind tail, widening towards a broad arrowhead (one mesh for the dark casing, one for the colour)
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const build = (grow: number) => {
      const pos: number[] = [];
      const along: number[] = [];
      const across: number[] = [];
      const tint: number[] = [];
      const index: number[] = [];
      if (showFlux) {
        const P = new THREE.Vector3();
        const Q = new THREE.Vector3();
        const T = new THREE.Vector3();
        const S = new THREE.Vector3();
        for (const { vec, start, end, weight } of fluxArrows(fluxVectors)) {
          const rgb = hexToRgb(fluxColour(vec.intensity));
          const from = toXYZ(start[1], start[0], 1, new THREE.Vector3());
          const to = toXYZ(end[1], end[0], 1, new THREE.Vector3());
          const angle = from.angleTo(to);
          const at = (t: number, out: THREE.Vector3) =>
            out.copy(from).lerp(to, t).normalize().multiplyScalar(1.003 + angle * 0.12 * Math.sin(Math.PI * t));
          const w0 = (0.0016 + 0.0006 * weight) * grow; // shaft half-width near the head (globe radii)
          const HEAD = 0.78;
          // width profile: tapered shaft, then a broad head closing to the tip (HEAD sampled twice = barbs)
          const stations: [number, number][] = [];
          for (let i = 0; i <= 26; i++) {
            const t = (i / 26) * HEAD;
            stations.push([t, w0 * (0.45 + 0.55 * Math.pow(t / HEAD, 0.8))]);
          }
          for (let i = 0; i <= 8; i++) {
            const t = HEAD + (i / 8) * (1 - HEAD);
            stations.push([t, w0 * 2.5 * (1 - (t - HEAD) / (1 - HEAD)) + (grow > 1 ? w0 * 0.25 : 0)]);
          }
          const first = pos.length / 3;
          for (const [t, w] of stations) {
            at(t, P);
            at(Math.min(1, t + 0.01), Q);
            T.subVectors(Q, P);
            if (T.lengthSq() < 1e-12) at(Math.max(0, t - 0.01), T).sub(P).negate();
            S.crossVectors(T, P).normalize().multiplyScalar(w);
            for (const side of [1, -1]) {
              pos.push(P.x + S.x * side, P.y + S.y * side, P.z + S.z * side);
              along.push(t);
              across.push(side);
              tint.push(...rgb);
            }
          }
          for (let k = 0; k < stations.length - 1; k++) {
            const i0 = first + 2 * k;
            index.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
      g.setAttribute('across', new THREE.Float32BufferAttribute(across, 1));
      g.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 3));
      g.setIndex(index);
      return g;
    };
    const [casing, core] = s.fluxLayers;
    casing.geometry.dispose();
    core.geometry.dispose();
    casing.geometry = build(1.6);
    core.geometry = build(1);
  }, [fluxVectors, showFlux]);

  // Animation state -> uniforms
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !s.textures.length) return;
    const last = s.textures.length - 1;
    const f = Math.min(Math.max(frameIndex, 0), last);
    const i0 = Math.floor(f);
    const i1 = Math.min(last, i0 + 1);
    s.material.uniforms.uA.value = s.textures[i0];
    s.material.uniforms.uB.value = s.textures[i1];
    s.material.uniforms.uMix.value = f - i0;
    s.material.uniforms.uHighlight.value = highlightNewest ? 1 : 0;
    s.material.uniforms.uNewest.value = newestHours;
  }, [frameIndex, highlightNewest, newestHours, data]);

  return <div ref={mountRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />;
}
