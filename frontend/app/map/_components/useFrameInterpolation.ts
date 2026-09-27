'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface FrameState {
  currentTimestamp: string | null;
  nextTimestamp: string | null;
  interpolationFactor: number; // 0.0 → 1.0
  currentIndex: number;
}

interface UseFrameInterpolationOptions {
  timestamps: string[];
  isPlaying: boolean;
  speedMultiplier: 1 | 2 | 4;
  /** Real-time seconds per 30-min interval at 1× speed. Default: 3 */
  secondsPerFrame?: number;
  onStateChange: (state: FrameState) => void;
}

/**
 * useFrameInterpolation
 *
 * Drives a requestAnimationFrame loop that advances through the timestamps array.
 * For each consecutive timestamp pair (A, B), interpolationFactor runs from 0 → 1
 * over `secondsPerFrame / speedMultiplier` seconds, then advances to the next pair.
 * When the last pair is exhausted the animation loops back to index 0.
 *
 * We use refs for everything that touches the rAF loop to avoid re-render thrash:
 * the loop reads from refs, and calls `onStateChange` to push state up to the parent.
 */
export function useFrameInterpolation({
  timestamps,
  isPlaying,
  speedMultiplier,
  secondsPerFrame = 3,
  onStateChange,
}: UseFrameInterpolationOptions): void {
  // --- refs so the rAF callback always sees current values without being re-created ---
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const currentIndexRef = useRef<number>(0);
  const interpolationFactorRef = useRef<number>(0);

  // Keep live copies of props that the loop reads
  const timestampsRef = useRef<string[]>(timestamps);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const speedRef = useRef<number>(speedMultiplier);
  const secondsPerFrameRef = useRef<number>(secondsPerFrame);
  const onStateChangeRef = useRef<(state: FrameState) => void>(onStateChange);

  useEffect(() => { timestampsRef.current = timestamps; }, [timestamps]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speedMultiplier; }, [speedMultiplier]);
  useEffect(() => { secondsPerFrameRef.current = secondsPerFrame; }, [secondsPerFrame]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);

  const emitState = useCallback(() => {
    const ts = timestampsRef.current;
    if (ts.length === 0) {
      onStateChangeRef.current({
        currentTimestamp: null,
        nextTimestamp: null,
        interpolationFactor: 0,
        currentIndex: 0,
      });
      return;
    }
    const idx = currentIndexRef.current;
    const nextIdx = (idx + 1) % ts.length;
    onStateChangeRef.current({
      currentTimestamp: ts[idx],
      nextTimestamp: ts[nextIdx],
      interpolationFactor: interpolationFactorRef.current,
      currentIndex: idx,
    });
  }, []);

  useEffect(() => {
    function tick(nowMs: number) {
      rafIdRef.current = requestAnimationFrame(tick);

      if (!isPlayingRef.current) {
        // Frozen — just keep emitting the current state so consumers stay in sync
        lastTimeRef.current = null;
        return;
      }

      const ts = timestampsRef.current;
      if (ts.length < 2) return;

      if (lastTimeRef.current === null) {
        lastTimeRef.current = nowMs;
        return;
      }

      const deltaMs = nowMs - lastTimeRef.current;
      lastTimeRef.current = nowMs;

      // How many seconds does 1 full frame (0→1) take?
      const frameDurationSec = secondsPerFrameRef.current / speedRef.current;
      const increment = deltaMs / 1000 / frameDurationSec;

      interpolationFactorRef.current += increment;

      if (interpolationFactorRef.current >= 1.0) {
        interpolationFactorRef.current = 0.0;
        currentIndexRef.current = (currentIndexRef.current + 1) % ts.length;
      }

      emitState();
    }

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      lastTimeRef.current = null;
    };
  }, [emitState]);

  // Seed initial state when timestamps first arrive
  useEffect(() => {
    if (timestamps.length > 0) {
      currentIndexRef.current = 0;
      interpolationFactorRef.current = 0;
      emitState();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timestamps.length > 0]);
}
