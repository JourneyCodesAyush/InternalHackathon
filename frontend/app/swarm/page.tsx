'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Globe2, Layers, Compass, ExternalLink } from 'lucide-react';
import Cesium3DViewer from './_components/Cesium3DViewer';

export default function Cesium3DPage() {
  return (
    <div className="flex flex-col h-screen w-full bg-[#0d0f15] text-[#f1f3f7] overflow-hidden select-none font-sans">
      {/* Top Header Bar */}
      <header className="bg-[#11141d] border-b border-[#242938] px-4 py-2.5 shrink-0 select-none">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Branding & Back Button */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-lg bg-[#161a26] hover:bg-[#1f2537] text-zinc-400 hover:text-white border border-[#242938] transition-colors"
              title="Return to Main Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-wide text-white flex items-center gap-1.5">
                  <Globe2 className="w-4 h-4 text-cyan-400" />
                  <span>Cesium 3D Geospatial Explorer</span>
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-semibold uppercase">
                  PERSPECTIVE 3D ENGINE
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 hidden sm:block">
                Oblique 3D perspective mapping across Mumbai with cloud-gap uncertainty decks and 3D architectural extrusions.
              </p>
            </div>
          </div>

          {/* Right: Quick Links */}
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg bg-[#161a26] hover:bg-[#1f2537] text-xs font-medium text-zinc-300 border border-[#242938] transition-colors"
            >
              2D Map View
            </Link>
            <Link
              href="/globe"
              className="px-3 py-1.5 rounded-lg bg-[#161a26] hover:bg-[#1f2537] text-xs font-medium text-zinc-300 border border-[#242938] transition-colors"
            >
              Global NO₂ Globe
            </Link>
          </div>
        </div>
      </header>

      {/* Main Cesium 3D Viewport */}
      <main className="flex-1 min-h-0 w-full relative p-3">
        <Cesium3DViewer />
      </main>
    </div>
  );
}
