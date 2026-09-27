'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import MspPanel from './_components/MspPanel';
import SimulationMap from './_components/SimulationMap';
import WebcamHaze from './_components/WebcamHaze';
import Attitude3D from './_components/Attitude3D';

export default function DronePortalPage() {
  const [isSimulating, setIsSimulating] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);

  // Backdoor: Press 'v' or 'V' to toggle simulation override even without physical FC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea/select
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setManualOverride((prevOverride) => {
          const next = !prevOverride;
          setIsSimulating(next);
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <main className="min-h-screen bg-[#0d0f15] text-[#f1f3f7] p-6 font-sans">
      <header className="mb-8 border-b border-white/10 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-all border border-white/10 flex items-center justify-center group shrink-0"
            title="Back to Main Dashboard"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-wide text-blue-400">
              Raspberry Pi Drone Portal
            </h1>
            <p className="text-zinc-400 text-sm mt-0.5">
              Hardware MSP connection, real-time Haze DCP evaluation, and Cloud-Gap target simulation.
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Status & Camera */}
        <div className="space-y-6">
          <section className="bg-white/5 border border-white/10 rounded-xl p-5 shadow-lg backdrop-blur-sm">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Hardware Link</h2>
            <MspPanel
              isSimulating={isSimulating}
              manualOverride={manualOverride}
              onSimulationChange={setIsSimulating}
            />
          </section>

          <section className="bg-white/5 border border-white/10 rounded-xl p-5 shadow-lg backdrop-blur-sm">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">IMU Attitude & Leveling (3D)</h2>
            <Attitude3D isSimulating={isSimulating} />
          </section>

          <section className="bg-white/5 border border-white/10 rounded-xl p-5 shadow-lg backdrop-blur-sm">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Onboard Camera (DCP Haze)</h2>
            <WebcamHaze isSimulating={isSimulating} />
          </section>
        </div>

        {/* Right Column: Map Simulation */}
        <div className="lg:col-span-2">
          <section className="bg-white/5 border border-white/10 rounded-xl p-5 shadow-lg backdrop-blur-sm h-full flex flex-col">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Cloud-Gap Nav Simulation</h2>
            <div className="flex-1 min-h-[500px] relative rounded-lg overflow-hidden border border-white/10">
              <SimulationMap isSimulating={isSimulating} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
