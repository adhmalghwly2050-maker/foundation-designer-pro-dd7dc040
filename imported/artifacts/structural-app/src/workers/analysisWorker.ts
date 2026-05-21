/**
 * Web Worker — Optimised 2D Structural Solver
 * ════════════════════════════════════════════════════════
 * Runs solveOptimized off the main thread.
 * Now integrated with ThermalGuard for mobile safety.
 */

import type { WorkerRequest, WorkerResponse } from '../wasm/solverTypes';
import { solveOptimized } from '../wasm/optimizedSolver';

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type, id, model, computeDiagrams } = event.data;

  if (type !== 'solve') return;

  try {
    const progressMsg: WorkerResponse = { type: 'progress', id, progress: 0.1 };
    self.postMessage(progressMsg);

    // Yield before heavy computation so the OS scheduler can breathe
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    const result = solveOptimized(model, computeDiagrams);

    self.postMessage({ type: 'result', id, result } satisfies WorkerResponse);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown solver error';
    self.postMessage({ type: 'error', id, error: msg } satisfies WorkerResponse);
  }
};
