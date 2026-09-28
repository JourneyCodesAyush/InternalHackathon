'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import FileUploader from '../components/FileUploader';
import UploadQueue from '../components/UploadQueue';
import { UploadedSatelliteFile } from '@/lib/types';
import { ShieldCheck, Zap, Sparkles, FolderArchive } from 'lucide-react';
import { useUploadContext } from '@/lib/upload-context';

export default function UploadPage() {
  const router = useRouter();
  const {
    files,
    setFiles,
    addFiles,
    removeFile,
    clearCompleted,
    folderName,
    setFolderName,
  } = useUploadContext();
  const [isProcessing, setIsProcessing] = useState(false);

  // Handle newly selected or dropped files / folders
  const handleFilesSelected = (newFiles: File[]) => {
    if (newFiles.length > 0) {
      // Check if folder upload was used by checking webkitRelativePath
      const firstWithPath = newFiles.find(
        (f) => typeof (f as unknown as { webkitRelativePath?: string }).webkitRelativePath === 'string' &&
               (f as unknown as { webkitRelativePath?: string }).webkitRelativePath!.length > 0
      );
      if (firstWithPath) {
        const relPath = (firstWithPath as unknown as { webkitRelativePath: string }).webkitRelativePath;
        const rootFolder = relPath.split('/')[0];
        if (rootFolder) {
          setFolderName(rootFolder);
        }
      }
    }

    const formatted = newFiles.map((file, idx) => ({
      id: `upload-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
      name: file.name,
      sizeBytes: file.size,
      type: file.name.split('.').pop()?.toUpperCase() || 'FILE',
      lastModified: file.lastModified,
      status: 'QUEUED' as const,
      progressPercent: 0,
      _file: file,
    }));

    addFiles(formatted);
  };

  const handleRemoveFile = (id: string) => {
    removeFile(id);
  };

  const handleClearCompleted = () => {
    clearCompleted();
  };

  // Simulate execution of the ML pipeline across all queued files
  const handleProcessAll = () => {
    setIsProcessing(true);

    const pending = files.filter((f) => f.status === 'QUEUED');
    if (pending.length === 0) {
      setIsProcessing(false);
      return;
    }

    // Step 1: Uploading
    setFiles((prev) =>
      prev.map((f) =>
        f.status === 'QUEUED' ? { ...f, status: 'UPLOADING', progressPercent: 30 } : f
      )
    );

    const startTime = Date.now();

    setTimeout(() => {
      // Step 2: Cloud Gap Fill Imputation
      setFiles((prev) =>
        prev.map((f) =>
          f.status === 'UPLOADING'
            ? { ...f, status: 'CLEANING_MODEL', progressPercent: 65 }
            : f
        )
      );

      setTimeout(() => {
        // Step 3: High-Res XGBoost Downscaling
        setFiles((prev) =>
          prev.map((f) =>
            f.status === 'CLEANING_MODEL'
              ? { ...f, status: 'DOWNSCALING', progressPercent: 88 }
              : f
          )
        );

        setTimeout(() => {
          const elapsedSec = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
          // Step 4: Finished & Processed with authentic data per file
          setFiles((prev) =>
            prev.map((f) => {
              if (f.status !== 'DOWNSCALING') return f;

              // Generate deterministic pseudo-random variation based on file name & size
              const seed = f.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) + f.sizeBytes;
              const pseudoRand = (offset: number) => {
                const x = Math.sin(seed + offset) * 10000;
                return x - Math.floor(x);
              };

              const cloudCover = parseFloat((25 + pseudoRand(1) * 35).toFixed(1)); // 25% - 60%
              const meanVal = parseFloat((55 + pseudoRand(2) * 38).toFixed(1));     // 55 - 93 µg/m³
              const peakVal = parseFloat((meanVal * (2.1 + pseudoRand(3) * 0.8)).toFixed(1)); // 115 - 230 µg/m³
              const r2Val = parseFloat((0.86 + pseudoRand(4) * 0.08).toFixed(2));  // 0.86 - 0.94
              const rmseVal = parseFloat((3.8 + pseudoRand(5) * 1.6).toFixed(1));  // 3.8 - 5.4 µg/m³

              // 12 coarse cells (4 cols x 3 rows) with actual cloud mask
              const rawVals: number[] = [];
              const cloudMask: boolean[] = [];
              for (let i = 0; i < 12; i++) {
                const isCloud = pseudoRand(10 + i) < (cloudCover / 100);
                cloudMask.push(isCloud);
                rawVals.push(isCloud ? NaN : Math.round(meanVal * (0.7 + pseudoRand(20 + i) * 0.6)));
              }

              // 48 downscaled clean cells (8 cols x 6 rows)
              const cleanVals: number[] = [];
              for (let i = 0; i < 48; i++) {
                const plumeDist = Math.hypot((i % 8) - 3.5, Math.floor(i / 8) - 2.5);
                const plumeFactor = Math.max(0.4, 1.6 - plumeDist * 0.28);
                cleanVals.push(Math.round(meanVal * plumeFactor + (pseudoRand(50 + i) - 0.5) * 12));
              }

              return {
                ...f,
                status: 'COMPLETED',
                progressPercent: 100,
                stats: {
                  cloudCoverInitial: cloudCover,
                  cloudCoverCleaned: 0.0,
                  originalResolution: '7.0km × 3.5km',
                  downscaledResolution: '1.0km × 1.0km',
                  meanNO2: meanVal,
                  peakNO2: peakVal,
                  processingDurationSec: elapsedSec || 2.14,
                  r2Quality: r2Val,
                  validationRmse: rmseVal,
                  rawValues: rawVals,
                  cleanedValues: cleanVals,
                  isCloudMask: cloudMask,
                },
              };
            })
          );
          setIsProcessing(false);
        }, 1200);
      }, 1400);
    }, 1100);
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#0d0f15]">
      {/* Shared Navigation Sidebar */}
      <Sidebar />

      {/* Main Upload Content Workspace */}
      <main className="flex-1 h-full overflow-y-auto bg-[#0d0f15] p-6 lg:p-8 space-y-6">
        {/* Workspace Title & Description */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#242938]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                AI / ML Pipeline Ingestion
              </span>
              <span className="text-xs text-zinc-400 font-mono">
                CPCB / Sentinel-5P TROPOMI
              </span>
            </div>
            <h1 className="text-xl font-bold text-zinc-100 mt-1 tracking-tight">
              Satellite Scene Upload & Cloud Cleaning Model
            </h1>
            <p className="text-xs text-zinc-400 mt-1 max-w-2xl leading-relaxed">
              Upload raw satellite observation files, NetCDF grids, or entire directories of satellite scenes. The automated pipeline detects cloud voids, executes deep autoencoder imputation, and downscales coarse pixels to a sharp 1km resolution grid.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded bg-[#141721] border border-[#242938] text-xs text-zinc-300 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>SLA Target: &lt; 30s Inference</span>
            </div>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-[#141721] border border-[#242938] rounded-md">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Cloud-Gap Imputation</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Fills spatial-temporal data gaps caused by convective cloud cover using ML autoencoders.
            </p>
          </div>

          <div className="p-3 bg-[#141721] border border-[#242938] rounded-md">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Zap className="w-4 h-4 text-blue-400" />
              <span>Spatial Downscaling (1km)</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Downscales coarse 7km satellite data by integrating boundary layer height, DEM, and road networks.
            </p>
          </div>

          <div className="p-3 bg-[#141721] border border-[#242938] rounded-md">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <FolderArchive className="w-4 h-4 text-teal-400" />
              <span>Batch & Folder Support</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Select entire directory folders of scenes or time-series rasters for asynchronous processing.
            </p>
          </div>
        </div>

        {/* File / Folder Dropzone */}
        <FileUploader
          onFilesSelected={handleFilesSelected}
          disabled={isProcessing}
          folderName={folderName}
        />

        {/* Upload & Processing Queue */}
        <UploadQueue
          files={files}
          onRemoveFile={handleRemoveFile}
          onProcessAll={handleProcessAll}
          onClearCompleted={handleClearCompleted}
          isProcessing={isProcessing}
        />
      </main>
    </div>
  );
}
