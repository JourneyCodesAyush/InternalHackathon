'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UploadedSatelliteFile } from '@/lib/types';

const STORAGE_KEY = 'airq_uploaded_files';
const FOLDER_KEY = 'airq_uploaded_folder';

interface ExtendedUploadedFile extends UploadedSatelliteFile {
  _file?: File;
}

interface UploadContextValue {
  files: ExtendedUploadedFile[];
  setFiles: React.Dispatch<React.SetStateAction<ExtendedUploadedFile[]>>;
  addFiles: (newFiles: ExtendedUploadedFile[]) => void;
  removeFile: (id: string) => void;
  clearCompleted: () => void;
  folderName: string | null;
  setFolderName: (name: string | null) => void;
}

const INITIAL_MOCK_FILES: ExtendedUploadedFile[] = [
  {
    id: 'demo-file-1',
    name: 'S5P_NRTI_L2__NO2____20240926T074523_MMR_Coastal.nc',
    sizeBytes: 42 * 1024 * 1024,
    type: 'NetCDF-4',
    lastModified: 1727360000000,
    status: 'COMPLETED',
    progressPercent: 100,
    stats: {
      cloudCoverInitial: 48.2,
      cloudCoverCleaned: 0.0,
      originalResolution: '7.0km × 3.5km',
      downscaledResolution: '1.0km × 1.0km',
      meanNO2: 68.4,
      peakNO2: 184.2,
      processingDurationSec: 1.84,
      r2Quality: 0.89,
      validationRmse: 4.2,
      rawValues: [72, NaN, NaN, 55, 89, NaN, 110, 68, NaN, 94, 135, 70],
      cleanedValues: [
        48, 52, 60, 71, 74, 68, 55, 49,
        55, 68, 88, 112, 118, 92, 67, 52,
        64, 82, 125, 172, 168, 120, 84, 58,
        61, 79, 118, 154, 149, 108, 76, 54,
        52, 65, 84, 102, 98, 81, 62, 48,
        45, 50, 58, 69, 66, 57, 49, 42
      ],
      isCloudMask: [false, true, true, false, false, true, false, false, true, false, false, false],
    },
  },
  {
    id: 'demo-file-2',
    name: 'Sentinel5P_Delhi_NCR_WinterInversion_Swath.tif',
    sizeBytes: 78 * 1024 * 1024,
    type: 'GeoTIFF',
    lastModified: 1727350000000,
    status: 'QUEUED',
    progressPercent: 0,
  },
  {
    id: 'demo-file-3',
    name: 'Bengaluru_Industrial_Peenya_Sector_Tile04.hdf5',
    sizeBytes: 115 * 1024 * 1024,
    type: 'HDF5',
    lastModified: 1727340000000,
    status: 'QUEUED',
    progressPercent: 0,
  },
];

const UploadContext = createContext<UploadContextValue | undefined>(undefined);

// In-memory cache for live uploaded File objects across re-renders
const fileBlobCache = new Map<string, File>();

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [files, setFiles] = useState<ExtendedUploadedFile[]>(INITIAL_MOCK_FILES);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Rehydrate state from localStorage on client mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Re-attach any in-memory cached _file handles if present
          const reattached = parsed.map((item: ExtendedUploadedFile) => ({
            ...item,
            _file: fileBlobCache.get(item.id) || fileBlobCache.get(item.name) || undefined,
          }));
          setFiles(reattached);
        }
      }
      const storedFolder = localStorage.getItem(FOLDER_KEY);
      if (storedFolder) {
        setFolderName(storedFolder);
      }
    } catch (e) {
      console.warn('Failed to rehydrate upload context:', e);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  // Save files to localStorage (stripping transient _file objects)
  useEffect(() => {
    if (!isHydrated) return;
    try {
      const serializable = files.map(({ _file, ...rest }) => rest);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch (e) {
      console.warn('Failed to save files to localStorage:', e);
    }
  }, [files, isHydrated]);

  // Save folderName to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    try {
      if (folderName) {
        localStorage.setItem(FOLDER_KEY, folderName);
      } else {
        localStorage.removeItem(FOLDER_KEY);
      }
    } catch (e) {
      console.warn('Failed to save folder to localStorage:', e);
    }
  }, [folderName, isHydrated]);

  const addFiles = useCallback((newFiles: ExtendedUploadedFile[]) => {
    newFiles.forEach((f) => {
      if (f._file) {
        fileBlobCache.set(f.id, f._file);
        fileBlobCache.set(f.name, f._file);
      }
    });
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((id: string) => {
    fileBlobCache.delete(id);
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setFiles((prev) => prev.filter((f) => f.status !== 'COMPLETED'));
  }, []);

  return (
    <UploadContext.Provider
      value={{
        files,
        setFiles,
        addFiles,
        removeFile,
        clearCompleted,
        folderName,
        setFolderName,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}

export function useUploadContext() {
  const ctx = useContext(UploadContext);
  if (!ctx) {
    throw new Error('useUploadContext must be used within an UploadProvider');
  }
  return ctx;
}
