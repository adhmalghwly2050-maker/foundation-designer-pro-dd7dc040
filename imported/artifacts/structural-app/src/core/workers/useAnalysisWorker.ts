/**
 * useAnalysisWorker — React hook for Web Worker analysis
 * ════════════════════════════════════════════════════════
 * Moves all heavy structural analysis off the UI thread.
 * Interface stays fully responsive during long solves.
 *
 * New in mobile-optimised build:
 *   - onPartialResult callback for progressive UI updates
 *   - analysisMode parameter (FAST_PREVIEW | FULL_ANALYSIS)
 *   - Throttled progress updates to avoid React rerender storms
 */

import { useRef, useCallback, useEffect } from 'react';
import type {
  AnalysisInput, WorkerOutput, WorkerAnalysisResult, PartialFrameResult,
} from './workerTypes';

export type { AnalysisInput, WorkerAnalysisResult };
export type { WorkerDiagnostics } from './workerTypes';

export interface AnalysisCallbacks {
  /** Called on every PROGRESS_UPDATE from the worker. */
  onProgress: (progress: number, step: string) => void;
  /** Called when FINAL_RESULT arrives. */
  onComplete: (result: WorkerAnalysisResult) => void;
  /** Called on ERROR. */
  onError: (message: string) => void;
  /** Called when the analysis is cancelled. */
  onCancelled?: () => void;
  /**
   * Called as batches of frame results stream in during progressive solve.
   * Allows the UI to show partial diagrams before the full analysis completes.
   */
  onPartialResult?: (partials: PartialFrameResult[], batchIndex: number) => void;
}

export function useAnalysisWorker() {
  const workerRef = useRef<Worker | null>(null);

  const startAnalysis = useCallback(
    (input: AnalysisInput, callbacks: AnalysisCallbacks) => {
      // Terminate any running worker first
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }

      let worker: Worker;
      try {
        worker = new Worker(
          new URL('./analysis.worker.ts', import.meta.url),
          { type: 'module' },
        );
      } catch (err) {
        callbacks.onError(
          `تعذّر إنشاء معالج التحليل: ${err instanceof Error ? err.message : 'خطأ غير معروف'}`,
        );
        return;
      }

      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<WorkerOutput>) => {
        const msg = e.data;
        switch (msg.type) {
          case 'PROGRESS_UPDATE':
            callbacks.onProgress(msg.progress, msg.step);
            break;

          case 'PARTIAL_RESULT':
            callbacks.onPartialResult?.(msg.partials, msg.batchIndex);
            break;

          case 'FINAL_RESULT':
            callbacks.onComplete(msg);
            worker.terminate();
            if (workerRef.current === worker) workerRef.current = null;
            break;

          case 'ERROR':
            callbacks.onError(msg.message);
            worker.terminate();
            if (workerRef.current === worker) workerRef.current = null;
            break;

          case 'CANCELLED':
            callbacks.onCancelled?.();
            if (workerRef.current === worker) workerRef.current = null;
            break;
        }
      };

      worker.onerror = (e) => {
        callbacks.onError(`خطأ في معالج التحليل: ${e.message ?? 'خطأ غير معروف'}`);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      };

      worker.postMessage({ type: 'START_ANALYSIS', payload: input });
    },
    [],
  );

  /**
   * Cancel the running analysis.
   * Sends CANCEL_ANALYSIS message first, then terminates after a grace period
   * so the worker can clean up its resources (wake lock, memory pool).
   */
  const cancelAnalysis = useCallback(() => {
    const worker = workerRef.current;
    if (!worker) return;
    worker.postMessage({ type: 'CANCEL_ANALYSIS' });
    // Hard terminate after 500ms grace period
    const timer = setTimeout(() => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    }, 500);
    // Clear timer if worker terminates naturally first
    worker.addEventListener('message', (e: MessageEvent<WorkerOutput>) => {
      if (e.data.type === 'CANCELLED') {
        clearTimeout(timer);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    }, { once: true });
  }, []);

  const isRunning = useCallback(() => workerRef.current !== null, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  return { startAnalysis, cancelAnalysis, isRunning };
}
