'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { drawBaseMap } from './globeData';

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
  onHover: (info: HoverInfo | null) => void;
  /** A tap (not a drag) on the globe, or null for a tap on empty space. */
  onSelect: (point: { lat: number; lon: number } | null) => void;
  /** Rings of [lon, lat] to outline (the selected country), or null. */
  outline: number[][][] | null;
}

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
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;

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
    col *= 0.55 + 0.45 * pow(ndv, 0.6);
    col += vec3(0.20, 0.35, 0.70) * pow(1.0 - ndv, 3.0) * 0.35;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.5);
    gl_FragColor = vec4(0.30, 0.55, 1.0, 1.0) * rim * 0.9;
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
  onHover,
  onSelect,
  outline,
}: GlobeCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    material: THREE.ShaderMaterial;
    controls: OrbitControls;
    textures: THREE.DataTexture[];
    ageTexture: THREE.DataTexture | null;
    wind: THREE.LineSegments;
    highlight: THREE.LineSegments;
    windState: { lat: Float32Array; lon: Float32Array; life: Float32Array } | null;
    field: GlobeFrames | null;
  } | null>(null);
  const propsRef = useRef({ autoRotate, showWind, onHover, onSelect });

  useEffect(() => {
    propsRef.current = { autoRotate, showWind, onHover, onSelect };
  }, [autoRotate, showWind, onHover, onSelect]);

  // Scene setup (once)
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, mount.clientWidth / mount.clientHeight, 0.1, 100);
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
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
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

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 1.35;
    controls.maxDistance = 8;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.7;
    controls.autoRotateSpeed = 0.35;
    let lastInteraction = 0;
    controls.addEventListener('start', () => (lastInteraction = performance.now()));
    controls.addEventListener('end', () => (lastInteraction = performance.now()));

    sceneRef.current = { material, controls, textures: [], ageTexture: null, wind, highlight, windState: null, field: null };

    // Hover picking: ray -> sphere UV -> lat/lon
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
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
      camera.updateProjectionMatrix();
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

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const { autoRotate: rotate, showWind: windOn } = propsRef.current;
      controls.autoRotate = rotate && performance.now() - lastInteraction > 4000;
      controls.update();
      wind.visible = windOn;
      if (windOn) stepWind();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(frame);
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
  }, []);

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
