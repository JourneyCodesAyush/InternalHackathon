'use client';

import dynamic from 'next/dynamic';

const VisualizationMap = dynamic(
  () => import('./_components/VisualizationMap'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-[#0d0f15] flex flex-col items-center justify-center text-white gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin" />
        <span className="text-sm font-medium text-zinc-400 tracking-wide">
          Loading visualization engine...
        </span>
      </div>
    ),
  }
);

export default function VisualizationPage() {
  return (
    <div className="w-full h-full overflow-hidden">
      <VisualizationMap />
    </div>
  );
}
