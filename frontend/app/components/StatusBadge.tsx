import React from 'react';
import { HazardBand, UploadStatus } from '@/lib/types';

interface StatusBadgeProps {
  type?: 'hazard' | 'upload';
  value: HazardBand | UploadStatus | string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ type = 'hazard', value, size = 'sm' }: StatusBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  if (type === 'hazard') {
    switch (value) {
      case 'NORMAL':
        return (
          <span
            className={`inline-flex items-center gap-1.5 font-medium rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 ${sizeClasses}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Normal (Good)
          </span>
        );
      case 'MODERATE':
        return (
          <span
            className={`inline-flex items-center gap-1.5 font-medium rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 ${sizeClasses}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
            Moderate
          </span>
        );
      case 'UNHEALTHY':
        return (
          <span
            className={`inline-flex items-center gap-1.5 font-medium rounded border border-orange-500/30 bg-orange-500/10 text-orange-400 ${sizeClasses}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
            Unhealthy
          </span>
        );
      case 'HAZARDOUS':
        return (
          <span
            className={`inline-flex items-center gap-1.5 font-medium rounded border border-red-500/30 bg-red-500/10 text-red-400 ${sizeClasses}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
            Hazardous
          </span>
        );
      default:
        return (
          <span className={`inline-flex items-center font-medium rounded bg-gray-800 text-gray-300 ${sizeClasses}`}>
            {value}
          </span>
        );
    }
  }

  // Upload status styles
  switch (value) {
    case 'QUEUED':
      return (
        <span className={`inline-flex items-center font-medium rounded border border-zinc-700 bg-zinc-800/60 text-zinc-300 ${sizeClasses}`}>
          Queued
        </span>
      );
    case 'UPLOADING':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded border border-blue-500/30 bg-blue-500/10 text-blue-400 ${sizeClasses}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          Uploading
        </span>
      );
    case 'CLEANING_MODEL':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 ${sizeClasses}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-spin" />
          Cloud Gap Fill
        </span>
      );
    case 'DOWNSCALING':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 ${sizeClasses}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          ML Downscaling
        </span>
      );
    case 'COMPLETED':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 ${sizeClasses}`}>
          ✓ Ready
        </span>
      );
    case 'FAILED':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded border border-red-500/30 bg-red-500/10 text-red-400 ${sizeClasses}`}>
          ✕ Failed
        </span>
      );
    default:
      return (
        <span className={`inline-flex items-center font-medium rounded bg-zinc-800 text-zinc-400 ${sizeClasses}`}>
          {value}
        </span>
      );
  }
}
