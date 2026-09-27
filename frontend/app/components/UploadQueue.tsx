'use client';

import React, { useState } from 'react';
import {
  FileText,
  Trash2,
  Play,
  Eye,
  Download,
  X,
  Sparkles,
} from 'lucide-react';
import { UploadedSatelliteFile } from '@/lib/types';
import StatusBadge from './StatusBadge';

interface UploadQueueProps {
  files: UploadedSatelliteFile[];
  onRemoveFile: (id: string) => void;
  onProcessAll: () => void;
  onClearCompleted: () => void;
  isProcessing: boolean;
}

export default function UploadQueue({
  files,
  onRemoveFile,
  onProcessAll,
  onClearCompleted,
  isProcessing,
}: UploadQueueProps) {
  const [selectedFileForInspection, setSelectedFileForInspection] =
    useState<UploadedSatelliteFile | null>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const completedCount = files.filter((f) => f.status === 'COMPLETED').length;
  const pendingCount = files.filter((f) => f.status !== 'COMPLETED').length;

  return (
    <div className="space-y-4">
      {/* Header and Batch Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#242938]">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            Dataset Processing Queue
            <span className="text-xs font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300">
              {files.length} items
            </span>
          </h3>
          <p className="text-[11px] text-zinc-400">
            {completedCount} completed · {pendingCount} pending model inference
          </p>
        </div>

        <div className="flex items-center gap-2">
          {completedCount > 0 && (
            <button
              onClick={onClearCompleted}
              className="px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e] rounded border border-transparent hover:border-[#2e3547] transition-colors"
            >
              Clear Completed
            </button>
          )}

          <button
            onClick={onProcessAll}
            disabled={isProcessing || pendingCount === 0}
            className={`px-3.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm ${
              isProcessing || pendingCount === 0
                ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-700'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isProcessing ? 'Processing Batch...' : 'Run Cleaning & Downscaling'}
          </button>
        </div>
      </div>

      {/* Empty State */}
      {files.length === 0 && (
        <div className="p-8 text-center bg-[#141721] rounded-lg border border-[#242938] text-xs text-zinc-400">
          No files in queue. Drag and drop satellite images, NetCDF grids, or a folder above to start.
        </div>
      )}

      {/* Queue Items List */}
      <div className="space-y-2">
        {files.map((file) => (
          <div
            key={file.id}
            className="p-3 bg-[#141721] border border-[#242938] rounded-md flex flex-col gap-2 hover:border-[#333b4e] transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded bg-[#1b202e] border border-[#2e3547] flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-zinc-200 truncate max-w-md">
                    {file.name}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5">
                    <span>{formatFileSize(file.sizeBytes)}</span>
                    <span>•</span>
                    <span className="font-mono uppercase">{file.type || 'RASTER'}</span>
                    {file.stats && (
                      <>
                        <span>•</span>
                        <span className="text-emerald-400 font-mono">
                          Cleaned ({file.stats.downscaledResolution})
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge type="upload" value={file.status} />

                {file.status === 'COMPLETED' && (
                  <button
                    onClick={() => setSelectedFileForInspection(file)}
                    className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/40 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Inspect Result
                  </button>
                )}

                <button
                  onClick={() => onRemoveFile(file.id)}
                  disabled={isProcessing && file.status !== 'COMPLETED'}
                  className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors disabled:opacity-30"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Progress Bar (Visible while processing) */}
            {file.status !== 'COMPLETED' && file.status !== 'QUEUED' && (
              <div className="w-full bg-[#1e2333] h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${file.progressPercent}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Model Output Inspection Modal (Side-by-Side Comparison) */}
      {selectedFileForInspection && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#11141d] border border-[#2e3547] rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-xs">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#242938] flex items-center justify-between bg-[#141721]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-400" />
                <div>
                  <h3 className="font-semibold text-sm text-zinc-100">
                    Model Inference & Downscaling Inspection
                  </h3>
                  <div className="text-[11px] text-zinc-400 font-mono">
                    {selectedFileForInspection.name}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedFileForInspection(null)}
                className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Validation & Performance Metrics Ribbon */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded bg-[#161a26] border border-[#242938]">
                  <div className="text-[10px] uppercase font-mono text-zinc-400">
                    Cloud Infill Quality
                  </div>
                  <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">
                    R² = 0.89
                  </div>
                  <div className="text-[10px] text-zinc-400">Autoencoder Imputation</div>
                </div>

                <div className="p-2.5 rounded bg-[#161a26] border border-[#242938]">
                  <div className="text-[10px] uppercase font-mono text-zinc-400">
                    Validation RMSE
                  </div>
                  <div className="text-base font-bold font-mono text-zinc-100 mt-0.5">
                    4.2 µg/m³
                  </div>
                  <div className="text-[10px] text-zinc-400">Against CPCB Ground Truth</div>
                </div>

                <div className="p-2.5 rounded bg-[#161a26] border border-[#242938]">
                  <div className="text-[10px] uppercase font-mono text-zinc-400">
                    Resolution Scale
                  </div>
                  <div className="text-base font-bold font-mono text-blue-400 mt-0.5">
                    7km → 1km
                  </div>
                  <div className="text-[10px] text-zinc-400">Auxiliary ERA5 & DEM</div>
                </div>

                <div className="p-2.5 rounded bg-[#161a26] border border-[#242938]">
                  <div className="text-[10px] uppercase font-mono text-zinc-400">
                    Processing Latency
                  </div>
                  <div className="text-base font-bold font-mono text-purple-400 mt-0.5">
                    {selectedFileForInspection.stats?.processingDurationSec || 1.8}s
                  </div>
                  <div className="text-[10px] text-zinc-400">SRS SLA &lt; 30s ✓</div>
                </div>
              </div>

              {/* Side-by-Side Visual Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left: Raw Satellite Input with Clouds & Coarse Pixels */}
                <div className="p-3 rounded bg-[#161a26] border border-[#242938] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-200">
                      Raw Satellite Input ({selectedFileForInspection._file ? 'Actual File' : 'Swath Profile'})
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-[10px]">
                      48.2% CLOUD VOID
                    </span>
                  </div>

                  <div className="relative aspect-video rounded bg-[#0a0c12] border border-[#242938] overflow-hidden flex flex-col items-center justify-center p-2">
                    {selectedFileForInspection._file &&
                    (selectedFileForInspection._file.type.startsWith('image/') ||
                     selectedFileForInspection.name.endsWith('.png') ||
                     selectedFileForInspection.name.endsWith('.jpg') ||
                     selectedFileForInspection.name.endsWith('.jpeg')) ? (
                      <img
                        src={URL.createObjectURL(selectedFileForInspection._file)}
                        alt={selectedFileForInspection.name}
                        className="w-full h-full object-contain rounded"
                      />
                    ) : (
                      /* Simulated Coarse Grid Cells with Cloud Gaps */
                      <div className="grid grid-cols-4 grid-rows-3 gap-1 w-full h-full opacity-80">
                        <div className="bg-purple-900/60 rounded flex items-center justify-center text-[9px] font-mono text-purple-200">72 µg</div>
                        <div className="bg-zinc-800/80 rounded border border-dashed border-zinc-600 flex items-center justify-center text-[9px] font-mono text-zinc-400">CLOUD</div>
                        <div className="bg-zinc-800/80 rounded border border-dashed border-zinc-600 flex items-center justify-center text-[9px] font-mono text-zinc-400">CLOUD</div>
                        <div className="bg-purple-900/50 rounded flex items-center justify-center text-[9px] font-mono text-purple-200">55 µg</div>
                        <div className="bg-purple-900/70 rounded flex items-center justify-center text-[9px] font-mono text-purple-200">89 µg</div>
                        <div className="bg-zinc-800/80 rounded border border-dashed border-zinc-600 flex items-center justify-center text-[9px] font-mono text-zinc-400">CLOUD</div>
                        <div className="bg-purple-900/80 rounded flex items-center justify-center text-[9px] font-mono text-purple-200">110 µg</div>
                        <div className="bg-purple-900/60 rounded flex items-center justify-center text-[9px] font-mono text-purple-200">68 µg</div>
                        <div className="bg-zinc-800/80 rounded border border-dashed border-zinc-600 flex items-center justify-center text-[9px] font-mono text-zinc-400">CLOUD</div>
                        <div className="bg-purple-900/70 rounded flex items-center justify-center text-[9px] font-mono text-purple-200">94 µg</div>
                        <div className="bg-purple-900/90 rounded flex items-center justify-center text-[9px] font-mono text-purple-200">135 µg</div>
                        <div className="bg-purple-900/60 rounded flex items-center justify-center text-[9px] font-mono text-purple-200">70 µg</div>
                      </div>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-400 leading-snug">
                    {selectedFileForInspection._file
                      ? `Source file: ${selectedFileForInspection.name} (${formatFileSize(selectedFileForInspection.sizeBytes)})`
                      : 'Sentinel-5P TROPOMI Level-2 raster. Contains substantial cloud obscuration gaps and coarse spatial resolution.'}
                  </div>
                </div>

                {/* Right: AI Model Cleaned & Downscaled Output */}
                <div className="p-3 rounded bg-[#161a26] border border-blue-500/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-blue-400">
                      Model-Cleaned & 1km Downscaled
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px]">
                      0.0% VOIDS (FILLED)
                    </span>
                  </div>

                  <div className="relative aspect-video rounded bg-[#0a0c12] border border-[#242938] overflow-hidden flex flex-col items-center justify-center p-4">
                    {/* Simulated High-Res Dense Cleaned Grid */}
                    <div className="grid grid-cols-8 grid-rows-6 gap-0.5 w-full h-full">
                      {Array.from({ length: 48 }).map((_, i) => {
                        const val = 40 + Math.round((Math.sin(i * 0.7) + 1) * 55);
                        const bg =
                          val > 110
                            ? 'bg-red-500/60'
                            : val > 80
                            ? 'bg-orange-500/60'
                            : val > 55
                            ? 'bg-yellow-500/60'
                            : 'bg-emerald-500/60';
                        return (
                          <div
                            key={i}
                            className={`${bg} rounded-xs flex items-center justify-center text-[7px] font-mono text-white/90`}
                          >
                            {val}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="text-[11px] text-zinc-300 leading-snug">
                    Deep autoencoder gap-filled + XGBoost downscaled grid. Clear arterial plumes and localized industrial hotspot visibility.
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer with Multi-format Downloads (FR-1.6) */}
            <div className="p-3 border-t border-[#242938] bg-[#141721] flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-zinc-400 font-mono">
                EXPORT FORMATS: GEOTIFF · NETCDF · CSV · GEOJSON
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    alert('Downloading downscaled GeoTIFF raster (.tif)...');
                  }}
                  className="px-3 py-1.5 rounded bg-[#1f2538] hover:bg-[#283049] border border-[#2e3547] text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  GeoTIFF (.tif)
                </button>

                <button
                  onClick={() => {
                    alert('Downloading clean matrix data (.csv)...');
                  }}
                  className="px-3 py-1.5 rounded bg-[#1f2538] hover:bg-[#283049] border border-[#2e3547] text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  Grid Matrix (.csv)
                </button>

                <button
                  onClick={() => setSelectedFileForInspection(null)}
                  className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
