'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Compass, RotateCcw, Crosshair, Cpu } from 'lucide-react';

interface Attitude3DProps {
  isSimulating: boolean;
}

export default function Attitude3D({ isSimulating }: Attitude3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [pitch, setPitch] = useState(0);
  const [roll, setRoll] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [isCalibrating, setIsCalibrating] = useState(false);

  // References for animation
  const droneGroupRef = useRef<THREE.Group | null>(null);
  const propsRef = useRef<THREE.Mesh[]>([]);
  const isSimulatingRef = useRef(isSimulating);
  const isCalibratingRef = useRef(false);

  useEffect(() => {
    isSimulatingRef.current = isSimulating;
  }, [isSimulating]);

  useEffect(() => {
    isCalibratingRef.current = isCalibrating;
  }, [isCalibrating]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();

    const width = container.clientWidth || 300;
    const height = container.clientHeight || 220;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 7, 11);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // 2. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0x38bdf8, 2.5);
    keyLight.position.set(5, 12, 7);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xef4444, 1.8);
    rimLight.position.set(-6, -4, -6);
    scene.add(rimLight);

    // 3. Grid & Horizon Reference (Betaflight / iNav ground ring)
    const gridHelper = new THREE.GridHelper(12, 12, 0x38bdf8, 0x1e293b);
    gridHelper.position.y = -2.2;
    scene.add(gridHelper);

    // Gimbal outer ring
    const ringGeo = new THREE.RingGeometry(3.8, 3.86, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = -2.18;
    scene.add(ringMesh);

    // 4. Build 3D Quadcopter Model
    const droneGroup = new THREE.Group();
    droneGroupRef.current = droneGroup;
    scene.add(droneGroup);

    // Materials
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      metalness: 0.8,
      roughness: 0.3,
    });

    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      metalness: 0.6,
      roughness: 0.4,
    });

    const motorMat = new THREE.MeshStandardMaterial({
      color: 0xd4d4d8,
      metalness: 0.9,
      roughness: 0.2,
    });

    const frontPropMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.85,
    });

    const rearPropMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
    });

    // A. Main Fuselage / Stacks
    const mainBodyGeo = new THREE.BoxGeometry(1.6, 0.35, 3.2);
    const mainBody = new THREE.Mesh(mainBodyGeo, plateMat);
    droneGroup.add(mainBody);

    const topPlateGeo = new THREE.BoxGeometry(1.4, 0.08, 2.8);
    const topPlate = new THREE.Mesh(topPlateGeo, plateMat);
    topPlate.position.y = 0.5;
    droneGroup.add(topPlate);

    // Standoff pillars
    const standoffGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8);
    const standoffMat = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.9 });
    const standoffOffsets = [
      [-0.6, -1.2],
      [0.6, -1.2],
      [-0.6, 1.2],
      [0.6, 1.2],
    ];
    standoffOffsets.forEach(([x, z]) => {
      const so = new THREE.Mesh(standoffGeo, standoffMat);
      so.position.set(x, 0.25, z);
      droneGroup.add(so);
    });

    // Flight controller / FC Chip with forward arrow decal
    const fcChipGeo = new THREE.BoxGeometry(0.9, 0.1, 0.9);
    const fcChipMat = new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.5 });
    const fcChip = new THREE.Mesh(fcChipGeo, fcChipMat);
    fcChip.position.y = 0.22;
    droneGroup.add(fcChip);

    // Forward direction indicator arrow on FC
    const arrowGeo = new THREE.ConeGeometry(0.2, 0.45, 3);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0.3, -0.1);
    droneGroup.add(arrow);

    // FPV Camera lens at front (-Z is forward)
    const camGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.4, 16);
    const camMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.2 });
    const cam = new THREE.Mesh(camGeo, camMat);
    cam.rotation.x = Math.PI / 2;
    cam.position.set(0, 0.2, -1.65);
    droneGroup.add(cam);

    // Rear VTX Antenna
    const antGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8);
    const ant = new THREE.Mesh(antGeo, standoffMat);
    ant.position.set(0, 0.6, 1.5);
    ant.rotation.x = 0.4;
    droneGroup.add(ant);

    // B. 4 Diagonal Arms (X-Frame)
    const armGeo = new THREE.BoxGeometry(0.25, 0.12, 3.4);
    const arm1 = new THREE.Mesh(armGeo, carbonMat);
    arm1.rotation.y = Math.PI / 4;
    droneGroup.add(arm1);

    const arm2 = new THREE.Mesh(armGeo, carbonMat);
    arm2.rotation.y = -Math.PI / 4;
    droneGroup.add(arm2);

    // C. 4 Motors and Propellers
    const motorGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 16);
    const propGeo = new THREE.BoxGeometry(2.2, 0.04, 0.25);

    const motorPositions = [
      { x: -1.7, z: -1.7, isFront: true }, // Front Left
      { x: 1.7, z: -1.7, isFront: true },  // Front Right
      { x: -1.7, z: 1.7, isFront: false }, // Rear Left
      { x: 1.7, z: 1.7, isFront: false },  // Rear Right
    ];

    const propMeshes: THREE.Mesh[] = [];

    motorPositions.forEach((pos, idx) => {
      // Motor Bell
      const motor = new THREE.Mesh(motorGeo, motorMat);
      motor.position.set(pos.x, 0.18, pos.z);
      droneGroup.add(motor);

      // Motor shaft
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x52525b })
      );
      shaft.position.set(pos.x, 0.4, pos.z);
      droneGroup.add(shaft);

      // Propeller
      const prop = new THREE.Mesh(propGeo, pos.isFront ? frontPropMat : rearPropMat);
      prop.position.set(pos.x, 0.42, pos.z);
      droneGroup.add(prop);
      propMeshes.push(prop);
    });

    propsRef.current = propMeshes;

    // 5. Interactive Mouse Orbit Controls (Lightweight Drag-to-Rotate)
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let orbitAzimuth = 0;
    let orbitPolar = 0.5;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouseX;
      const dy = e.clientY - prevMouseY;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      orbitAzimuth -= dx * 0.01;
      orbitPolar = Math.max(0.1, Math.min(Math.PI / 2.2, orbitPolar + dy * 0.01));

      const dist = 13;
      camera.position.x = dist * Math.sin(orbitAzimuth) * Math.cos(orbitPolar);
      camera.position.y = Math.max(2, dist * Math.sin(orbitPolar));
      camera.position.z = dist * Math.cos(orbitAzimuth) * Math.cos(orbitPolar);
      camera.lookAt(0, 0, 0);
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // 6. Animation Loop
    let animId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);

      const elapsedTime = clock.getElapsedTime();
      const simulating = isSimulatingRef.current;
      const calibrating = isCalibratingRef.current;

      if (droneGroupRef.current) {
        if (calibrating) {
          // Calibration leveling animation (quick settle to 0)
          droneGroupRef.current.rotation.x = THREE.MathUtils.lerp(droneGroupRef.current.rotation.x, 0, 0.15);
          droneGroupRef.current.rotation.z = THREE.MathUtils.lerp(droneGroupRef.current.rotation.z, 0, 0.15);
          droneGroupRef.current.rotation.y = THREE.MathUtils.lerp(droneGroupRef.current.rotation.y, 0, 0.15);
        } else if (simulating) {
          // Dynamic Betaflight attitude physics:
          // Forward pitch: -8° to -14°
          // Bank roll on turns: -10° to +10°
          // Continuous slow yaw spin to show compass heading
          const targetPitch = THREE.MathUtils.degToRad(-10 + Math.sin(elapsedTime * 1.5) * 3);
          const targetRoll = THREE.MathUtils.degToRad(Math.cos(elapsedTime * 1.2) * 8);
          const targetYaw = (elapsedTime * 0.4) % (Math.PI * 2);

          // Realistic IMU micro-vibration (motor jitter)
          const jitterX = (Math.random() - 0.5) * 0.008;
          const jitterZ = (Math.random() - 0.5) * 0.008;

          droneGroupRef.current.rotation.x = THREE.MathUtils.lerp(
            droneGroupRef.current.rotation.x,
            targetPitch + jitterX,
            0.1
          );
          droneGroupRef.current.rotation.z = THREE.MathUtils.lerp(
            droneGroupRef.current.rotation.z,
            targetRoll + jitterZ,
            0.1
          );
          droneGroupRef.current.rotation.y = targetYaw;

          // Propellers spin at high RPM
          propsRef.current.forEach((p, i) => {
            p.rotation.y += (i % 2 === 0 ? 0.45 : -0.45);
          });

          // Telemetry readout state (throttled)
          if (Math.floor(elapsedTime * 15) % 3 === 0) {
            setPitch(Number((THREE.MathUtils.radToDeg(droneGroupRef.current.rotation.x)).toFixed(1)));
            setRoll(Number((THREE.MathUtils.radToDeg(droneGroupRef.current.rotation.z)).toFixed(1)));
            setYaw(Number(((THREE.MathUtils.radToDeg(droneGroupRef.current.rotation.y) + 360) % 360).toFixed(0)));
          }
        } else {
          // Level at rest (0° level attitude)
          droneGroupRef.current.rotation.x = THREE.MathUtils.lerp(droneGroupRef.current.rotation.x, 0, 0.1);
          droneGroupRef.current.rotation.z = THREE.MathUtils.lerp(droneGroupRef.current.rotation.z, 0, 0.1);
          droneGroupRef.current.rotation.y = THREE.MathUtils.lerp(droneGroupRef.current.rotation.y, 0, 0.05);

          setPitch(0);
          setRoll(0);
          setYaw(0);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // 7. Resize handling
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  const handleCalibrate = () => {
    setIsCalibrating(true);
    setTimeout(() => {
      setIsCalibrating(false);
    }, 1200);
  };

  return (
    <div className="relative w-full aspect-video min-h-[220px] bg-[#090b10] rounded-xl overflow-hidden border border-white/10 flex flex-col justify-between p-3 select-none">
      {/* 3D Canvas Mount */}
      <div ref={mountRef} className="absolute inset-0 z-0 cursor-grab active:cursor-grabbing" />

      {/* TOP BAR: Betaflight Style IMU Readout */}
      <div className="relative z-10 flex items-center justify-between text-[11px] font-mono pointer-events-none">
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10">
          <Cpu className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-zinc-400">IMU:</span>
          <span className="text-white font-semibold">ICM-42688P</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-1" />
        </div>

        <div className="flex items-center gap-2.5 bg-black/80 backdrop-blur-md px-3 py-1 rounded-lg border border-white/10 font-bold text-[11px] shadow-lg">
          <span className="text-emerald-400">
            ROLL: {roll >= 0 ? `+${roll}` : roll}°
          </span>
          <span className="text-white/20">|</span>
          <span className="text-amber-400">
            PITCH: {pitch >= 0 ? `+${pitch}` : pitch}°
          </span>
          <span className="text-white/20">|</span>
          <span className="text-cyan-400">
            YAW: {yaw}°
          </span>
        </div>
      </div>

      {/* BOTTOM BAR: Calibrate Accel & Horizon Info */}
      <div className="relative z-10 flex items-center justify-between pointer-events-auto">
        <div className="flex items-center gap-1.5 text-[9px] font-mono text-zinc-500 bg-black/50 px-2 py-0.5 rounded border border-white/5">
          <Crosshair className="w-3 h-3 text-zinc-400" />
          <span>DRAG 3D MODEL TO ORBIT</span>
        </div>

        <button
          onClick={handleCalibrate}
          disabled={isCalibrating}
          className={`flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-all ${
            isCalibrating
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
              : 'bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border-white/10'
          }`}
          title="Calibrate Accelerometer & Reset Level"
        >
          <RotateCcw className={`w-3 h-3 ${isCalibrating ? 'animate-spin' : ''}`} />
          <span>{isCalibrating ? 'CALIBRATING...' : 'CALIBRATE ACC'}</span>
        </button>
      </div>
    </div>
  );
}
