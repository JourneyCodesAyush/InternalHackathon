'use client';

import React, { useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, FolderUp, FileSpreadsheet, Image as ImageIcon } from 'lucide-react';

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  folderName?: string | null;
}

export default function FileUploader({ onFilesSelected, disabled = false, folderName }: FileUploaderProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFilesSelected(acceptedFiles);
      }
    },
    [onFilesSelected]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    disabled,
    accept: {
      'image/tiff': ['.tif', '.tiff'],
      'application/x-netcdf': ['.nc'],
      'application/x-hdf': ['.hdf5', '.h5', '.he5'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
    },
    maxSize: 500 * 1024 * 1024, // 500MB
  });

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      onFilesSelected(filesArray);
    }
  };

  return (
    <div className="space-y-3">
      {/* Hidden input for folder upload */}
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFolderUpload}
        // @ts-expect-error webkitdirectory is standard in modern browsers
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
      />

      {/* Main Drag & Drop Zone */}
      <div
        {...getRootProps()}
        className={`relative p-8 rounded-lg border-2 border-dashed text-center cursor-pointer transition-all select-none ${
          isDragActive
            ? 'border-blue-500 bg-blue-500/10'
            : isDragReject
            ? 'border-red-500 bg-red-500/10'
            : folderName
            ? 'border-blue-500/60 bg-blue-950/20'
            : 'border-[#2e3547] hover:border-zinc-500 bg-[#141721]'
        }`}
      >
        <input {...getInputProps()} />

        <div className="flex flex-col items-center justify-center gap-3">
          <div className={`w-12 h-12 rounded-full border flex items-center justify-center ${
            folderName ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'bg-[#1b202e] border-[#2e3547] text-blue-400'
          }`}>
            <UploadCloud className="w-6 h-6" />
          </div>

          <div>
            <div className="text-sm font-semibold text-zinc-100 flex items-center justify-center gap-2">
              {folderName ? (
                <>
                  <span className="text-blue-400 font-mono">📁 {folderName}</span>
                  <span className="text-xs font-normal text-zinc-300">loaded</span>
                </>
              ) : isDragActive ? (
                'Drop satellite data files here...'
              ) : (
                'Drag and drop satellite imagery or raster files'
              )}
            </div>
            {folderName ? (
              <div className="text-xs text-emerald-400 mt-1 font-mono">
                Folder active in pipeline — drag and drop or browse to add/replace files
              </div>
            ) : (
              <div className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
                Supported scientific & raster formats: <span className="font-mono text-zinc-300">GeoTIFF (.tif)</span>,{' '}
                <span className="font-mono text-zinc-300">NetCDF (.nc)</span>,{' '}
                <span className="font-mono text-zinc-300">HDF5 (.h5)</span>,{' '}
                <span className="font-mono text-zinc-300">PNG</span>, or{' '}
                <span className="font-mono text-zinc-300">JPEG</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              className="px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors shadow-sm"
            >
              Browse Files
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
              className="px-3.5 py-1.5 rounded bg-[#1f2433] hover:bg-[#283044] border border-[#2e3547] text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <FolderUp className="w-3.5 h-3.5 text-zinc-400" />
              Upload Folder
            </button>
          </div>
        </div>
      </div>

      {/* Technical Ingestion Capabilities Note */}
      <div className="flex flex-wrap items-center justify-between text-[11px] text-zinc-400 px-1">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400" /> Max file size: 500MB
          </span>
          <span className="flex items-center gap-1">
            <ImageIcon className="w-3.5 h-3.5 text-teal-400" /> Cloud Masking & Autoencoding
          </span>
        </div>
        <span className="font-mono text-[10px] text-zinc-400">PIPELINE: SATELLITE_GAP_FILL_V2</span>
      </div>
    </div>
  );
}
