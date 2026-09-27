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

const UploadContext = createContext<UploadContextValue | undefined>(undefined);

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [files, setFiles] = useState<ExtendedUploadedFile[]>([]);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Rehydrate state from localStorage on client mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // drop the old placeholder entries, and pending files whose contents a reload has lost
          // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring saved state on mount
          setFiles(
            parsed
              .filter((f: ExtendedUploadedFile) => !f.id.startsWith('demo-file-'))
              .map((f: ExtendedUploadedFile) =>
                f.status === 'COMPLETED' || f.status === 'FAILED'
                  ? f
                  : { ...f, status: 'FAILED' as const, progressPercent: 0, error: 'Page was reloaded; add the file again.' }
              )
          );
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
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((id: string) => {
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
