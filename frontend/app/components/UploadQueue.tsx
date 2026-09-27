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
import ModelInspection from './ModelInspection';
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
          No files in queue. Drag and drop daily NO₂ GeoTIFFs, or a folder of them, above to start.
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

            {file.stage && file.status !== 'COMPLETED' && file.status !== 'FAILED' && (
              <div className="text-[11px] text-blue-300">{file.stage}…</div>
            )}
            {file.status === 'FAILED' && file.error && (
              <div className="text-[11px] text-rose-300">{file.error}</div>
            )}

            {/* Progress Bar (Visible while processing) */}
            {file.status !== 'COMPLETED' && file.status !== 'QUEUED' && file.status !== 'FAILED' && (
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

      {/* Model output inspection: the job's real metrics, input and output rasters */}
      {selectedFileForInspection && (
        <ModelInspection file={selectedFileForInspection} onClose={() => setSelectedFileForInspection(null)} />
      )}
    </div>
  );
}
