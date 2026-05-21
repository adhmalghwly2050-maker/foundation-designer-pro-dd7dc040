/**
 * useAnalysisWorker — React hook for Web Worker analysis
 * ════════════════════════════════════════════════════════
 * Moves all heavy structural analysis off the UI thread so
 * the interface stays fully responsive during long solves.
 */

import { useRef, useCallback, useEffect } from 'react';
import type { AnalysisInput, WorkerOutput, WorkerAnalysisResult } from './workerTypes';

export type { AnalysisInput, WorkerAnalysisResult };
export type { WorkerDiagnostics } from './workerTypes';

export interface AnalysisCallbacks {
  onProgress: (progress: number, step: string) => void;
  onComplete: (result: WorkerAnalysisResult) => void;
  onError: (message: string) => void;
  onCancelled?: () => void;
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

  const cancelAnalysis = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
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
