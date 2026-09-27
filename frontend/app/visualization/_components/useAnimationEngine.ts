'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Frame } from './useGeoTiffLoader';
import type { AdvectMessage, AdvectResultMessage } from './NavierStokesWorker';

export type UseAnimationEngineProps = {
  timestamps: string[];
  frames: Map<string, Frame>;
  loadFrame: (ts: string) => Promise<Frame>;
  workerRef: React.RefObject<Worker | null>;
  isPlaying: boolean;
  speedMultiplier: 1 | 2 | 4;
  onFrameReady: (
    no2: Float32Array,
    bbox: [number, number, number, number],
    width: number,
    height: number,
    timestamp: string,
    t: number
  ) => void;
};

export type UseAnimationEngineReturn = {
  currentIndex: number;
  t: number;
  currentTimestamp: string;
  seek: (index: number) => void;
};

export function useAnimationEngine({
  timestamps,
  frames,
  loadFrame,
  workerRef,
  isPlaying,
  speedMultiplier,
  onFrameReady,
}: UseAnimationEngineProps): UseAnimationEngineReturn {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [t, setT] = useState(0.0);

  // References to preserve high-frequency state across requestAnimationFrame iterations
  const currentIndexRef = useRef(0);
  const tRef = useRef(0.0);
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const workerBusyRef = useRef<boolean>(false);

  // Jump to specific timestamp index
  const seek = useCallback(
    (index: number) => {
      if (timestamps.length === 0) return;
      const targetIndex = Math.max(0, Math.min(timestamps.length - 1, index));
      currentIndexRef.current = targetIndex;
      tRef.current = 0.0;
      setCurrentIndex(targetIndex);
      setT(0.0);
      lastTimeRef.current = null;

      // Trigger immediate load of target frame
      const ts = timestamps[targetIndex];
      if (ts) {
        loadFrame(ts).then((frame) => {
          if (frame) {
            onFrameReady(frame.no2, frame.bbox, frame.width, frame.height, ts, 0.0);
          }
        });
      }
    },
    [timestamps, loadFrame, onFrameReady]
  );

  // Ensure initial frame loads immediately
  useEffect(() => {
    if (timestamps.length > 0) {
      const firstTs = timestamps[currentIndexRef.current] || timestamps[0];
      if (firstTs) {
        loadFrame(firstTs).then((frame) => {
          if (frame) {
            onFrameReady(frame.no2, frame.bbox, frame.width, frame.height, firstTs, 0.0);
          }
        });
      }
    }
  }, [timestamps, loadFrame, onFrameReady]);

  // Main animation frame request loop
  useEffect(() => {
    if (!isPlaying || timestamps.length === 0) {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      lastTimeRef.current = null;
      return;
    }

    const BASE_INTERVAL_MS = 4000.0; // 4 seconds per 30-min frame interval at 1x

    const loop = (timestampMs: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestampMs;
      }

      const elapsedMs = timestampMs - lastTimeRef.current;
      lastTimeRef.current = timestampMs;

      // Calculate progress increment dt based on elapsed time and user speed multiplier
      const stepDurationMs = BASE_INTERVAL_MS / speedMultiplier;
      let newT = tRef.current + elapsedMs / stepDurationMs;

      let idx = currentIndexRef.current;

      // Advance to next keyframe pair when progress exceeds 1.0
      if (newT >= 1.0) {
        const advancedCount = Math.floor(newT);
        newT = newT - advancedCount;
        idx = (idx + advancedCount) % timestamps.length;
        currentIndexRef.current = idx;
        setCurrentIndex(idx);
      }

      tRef.current = newT;
      setT(newT);

      // Resolve keyframe A (current) and keyframe B (subsequent target)
      const tsA = timestamps[idx];
      const nextIdx = (idx + 1) % timestamps.length;
      const tsB = timestamps[nextIdx];

      const frameA = tsA ? frames.get(tsA) : undefined;
      const frameB = tsB ? frames.get(tsB) : undefined;

      // Trigger background loads if frames are missing
      if (!frameA && tsA) loadFrame(tsA);
      if (!frameB && tsB) loadFrame(tsB);

      const worker = workerRef.current;

      if (frameA && frameB && worker && !workerBusyRef.current) {
        workerBusyRef.current = true;

        const totalCells = frameA.width * frameA.height;
        const uInterpolated = new Float32Array(totalCells);
        const vInterpolated = new Float32Array(totalCells);

        const currentT = newT;
        const oneMinusT = 1.0 - currentT;

        for (let i = 0; i < totalCells; i++) {
          uInterpolated[i] = frameA.u[i] * oneMinusT + frameB.u[i] * currentT;
          vInterpolated[i] = frameA.v[i] * oneMinusT + frameB.v[i] * currentT;
        }

        const message: AdvectMessage = {
          type: 'ADVECT',
          no2A: frameA.no2,
          no2B: frameB.no2,
          uField: uInterpolated,
          vField: vInterpolated,
          width: frameA.width,
          height: frameA.height,
          t: currentT,
          dt: 0.5,
          cellSizeMeters: 1000.0,
        };

        const handleWorkerResponse = (e: MessageEvent<AdvectResultMessage>) => {
          worker.removeEventListener('message', handleWorkerResponse);
          workerBusyRef.current = false;

          if (e.data?.type === 'ADVECT_RESULT') {
            onFrameReady(e.data.no2, frameA.bbox, frameA.width, frameA.height, tsA, currentT);
          }
        };

        worker.addEventListener('message', handleWorkerResponse);
        worker.postMessage(message);
      } else if (frameA && !frameB) {
        // Fallback display frameA directly while frameB is loading
        onFrameReady(frameA.no2, frameA.bbox, frameA.width, frameA.height, tsA, newT);
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      lastTimeRef.current = null;
    };
  }, [
    isPlaying,
    speedMultiplier,
    timestamps,
    frames,
    loadFrame,
    workerRef,
    onFrameReady,
  ]);

  const currentTimestamp = timestamps[currentIndex] || '';

  return {
    currentIndex,
    t,
    currentTimestamp,
    seek,
  };
}
