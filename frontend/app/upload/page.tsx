'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import FileUploader from '../components/FileUploader';
import UploadQueue from '../components/UploadQueue';
import { UploadedSatelliteFile } from '@/lib/types';
import { ShieldCheck, Zap, Sparkles, FolderArchive } from 'lucide-react';
import { useUploadContext } from '@/lib/upload-context';
import { getJob, uploadFiles, type JobStatus } from '@/lib/modelOutput';

const MIN_DAYS = 7; // matches the backend: the model trains on the other days of the series

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
  const [notice, setNotice] = useState<string | null>(null);

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

    // the model reads daily GeoTIFFs only (folder uploads can bring along READMEs, previews, etc.)
    const tiffs = newFiles.filter((f) => /\.tiff?$/i.test(f.name));
    const skipped = newFiles.length - tiffs.length;
    setNotice(skipped ? `Skipped ${skipped} file${skipped > 1 ? 's' : ''} that ${skipped > 1 ? 'are' : 'is'} not a GeoTIFF (.tif).` : null);

    const formatted = tiffs.map((file, idx) => ({
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

  // Run the ML engine on all queued files (one batch = one time series = one job)
  const handleProcessAll = async () => {
    const pending = files.filter((f) => f.status === 'QUEUED');
    const ready = pending.filter((f) => f._file);
    const ids = new Set(ready.map((f) => f.id));
    setFiles((prev) =>
      prev.map((f) =>
        f.status === 'QUEUED' && !f._file
          ? { ...f, status: 'FAILED', error: 'File contents are not available; add the file again.' }
          : ids.has(f.id)
            ? { ...f, status: 'UPLOADING', progressPercent: 3, stage: 'Uploading', error: undefined }
            : f
      )
    );
    if (!ready.length) return;
    const days = new Set(ready.map((f) => f.name.match(/\d{4}-?\d{2}-?\d{2}/)?.[0]).filter(Boolean));
    if (days.size < MIN_DAYS) {
      setFiles((prev) =>
        prev.map((f) =>
          ids.has(f.id)
            ? { ...f, status: 'QUEUED', progressPercent: 0, stage: undefined }
            : f
        )
      );
      setNotice(
        `Add at least ${MIN_DAYS} daily files of the same area (found ${days.size}): the model learns cloud filling and ` +
          'downscaling from the other days of the series. Use "Upload Folder" for a folder of daily GeoTIFFs.'
      );
      return;
    }
    setNotice(null);
    setIsProcessing(true);

    const apply = (job: JobStatus) =>
      setFiles((prev) =>
        prev.map((f) => {
          if (!ids.has(f.id)) return f;
          if (job.state === 'failed') {
            return { ...f, status: 'FAILED', jobId: job.job_id, stage: undefined, error: job.error || 'Processing failed' };
          }
          if (job.state === 'done' && job.stats) {
            const s = job.stats;
            return {
              ...f,
              status: 'COMPLETED',
              progressPercent: 100,
              jobId: job.job_id,
              stage: undefined,
              stats: {
                cloudCoverInitial: s.cloud_cover_input_pct,
                cloudCoverCleaned: s.cloud_cover_output_pct,
                originalResolution: `${(s.coarse_resolution_m / 1000).toFixed(1)} km`,
                downscaledResolution: `${s.fine_resolution_m} m`,
                meanNO2: s.mean_no2_ugm3,
                peakNO2: s.peak_no2_ugm3,
                processingDurationSec: s.processing_seconds,
                gapfillR2: s.gapfill_r2,
                downscaleR2: s.downscale_r2,
                days: s.days,
                lastDate: s.last_date,
                cloudCoverLastDay: s.cloud_cover_last_day_pct,
              },
            };
          }
          const status = job.progress < 30 ? 'UPLOADING' : job.progress < 65 ? 'CLEANING_MODEL' : 'DOWNSCALING';
          return { ...f, status, progressPercent: Math.max(3, job.progress), jobId: job.job_id, stage: job.stage };
        })
      );

    try {
      let job = await uploadFiles(ready.map((f) => f._file!));
      apply(job);
      while (job.state === 'queued' || job.state === 'running') {
        await new Promise((r) => setTimeout(r, 3000));
        job = await getJob(job.job_id);
        apply(job);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed';
      setFiles((prev) =>
        prev.map((f) => (ids.has(f.id) ? { ...f, status: 'FAILED', stage: undefined, error: message } : f))
      );
    } finally {
      setIsProcessing(false);
    }
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
              Upload a folder of daily Sentinel-5P NO₂ GeoTIFFs (one per day, date in the file name). The pipeline fills cloud gaps, downscales the ~3.7 km satellite pixels to a 250 m grid and converts the column to ground-level NO₂ (µg/m³), which the Geospatial Map then shows.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded bg-[#141721] border border-[#242938] text-xs text-zinc-300 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>A few minutes per new area (cached after)</span>
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
              Fills cloud gaps in space and time with a Random Forest trained on the clear days of the same series.
            </p>
          </div>

          <div className="p-3 bg-[#141721] border border-[#242938] rounded-md">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Zap className="w-4 h-4 text-blue-400" />
              <span>Spatial Downscaling (250 m)</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Downscales ~3.7 km satellite data with weather (ERA5), elevation, vegetation, built-up area and roads.
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

        {notice && (
          <div className="p-3 rounded border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200">{notice}</div>
        )}

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
