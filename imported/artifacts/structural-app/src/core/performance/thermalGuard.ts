/**
 * Thermal Guard — Adaptive Execution for Mobile
 * ════════════════════════════════════════════════════════
 * Prevents CPU overheating on mobile devices by periodically
 * yielding execution to the browser/OS scheduler during heavy
 * computation loops.
 *
 * Why this matters for Android/iOS:
 *   Without yields, the JS engine runs uninterrupted at 100% CPU,
 *   causing thermal throttling within seconds. Regular yields give
 *   the OS time to manage heat dissipation and reduce clock speed
 *   only when truly necessary.
 *
 * Usage (in a Web Worker or async function):
 *   const guard = new ThermalGuard(40);
 *   for (let i = 0; i < N; i++) {
 *     doHeavyWork(i);
 *     await guard.checkpoint();
 *   }
 */

export class ThermalGuard {
  private readonly intervalMs: number;
  private lastYield: number;
  private _yieldCount = 0;
  private _totalWorkMs = 0;

  /**
   * @param intervalMs Yield to the scheduler whenever this many ms have
   *                   passed since the last yield. Default = 40ms
   *                   (matches a ~25fps render budget).
   */
  constructor(intervalMs = 40) {
    this.intervalMs = intervalMs;
    this.lastYield = performance.now();
  }

  /**
   * Call inside hot loops. Yields only when the interval has elapsed,
   * so overhead on fast iterations is effectively zero.
   */
  async checkpoint(): Promise<void> {
    const now = performance.now();
    if (now - this.lastYield >= this.intervalMs) {
      this._totalWorkMs += now - this.lastYield;
      await this.forceYield();
    }
  }

  /** Unconditional yield — use at stage boundaries. */
  async forceYield(): Promise<void> {
    this._yieldCount++;
    this.lastYield = performance.now();
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  get yieldCount(): number { return this._yieldCount; }
  get totalWorkMs(): number { return this._totalWorkMs; }

  reset(): void {
    this._yieldCount = 0;
    this._totalWorkMs = 0;
    this.lastYield = performance.now();
  }
}

/**
 * Execute an array of items in chunks, yielding to the scheduler
 * between chunks. Returns results in original order.
 *
 * @param items      Items to process.
 * @param fn         Transform function (sync).
 * @param chunkSize  Items processed before each yield (default 8).
 * @param onProgress Optional callback with (done, total).
 */
export async function runInChunks<T, R>(
  items: T[],
  fn: (item: T, index: number) => R,
  chunkSize = 8,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const total = items.length;

  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total);
    for (let i = start; i < end; i++) {
      results[i] = fn(items[i], i);
    }
    onProgress?.(end, total);
    // Yield between chunks
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  return results;
}

/**
 * Adaptive chunk size based on device performance.
 * Benchmarks a small task and picks a chunk size that
 * completes each chunk in roughly targetMs milliseconds.
 *
 * @param sampleFn   A representative work unit.
 * @param targetMs   Target chunk duration in ms (default 20ms).
 * @param minChunk   Minimum chunk size (default 4).
 * @param maxChunk   Maximum chunk size (default 256).
 */
export function adaptiveChunkSize(
  sampleFn: () => void,
  targetMs = 20,
  minChunk = 4,
  maxChunk = 256,
): number {
  const SAMPLE_REPS = 100;
  const t0 = performance.now();
  for (let i = 0; i < SAMPLE_REPS; i++) sampleFn();
  const elapsed = performance.now() - t0;
  const msPerOp = elapsed / SAMPLE_REPS;
  if (msPerOp <= 0) return maxChunk;
  const chunk = Math.round(targetMs / msPerOp);
  return Math.max(minChunk, Math.min(maxChunk, chunk));
}
