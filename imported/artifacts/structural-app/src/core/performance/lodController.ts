/**
 * Level-of-Detail (LOD) Analysis Controller
 * ════════════════════════════════════════════════════════
 * Provides two analysis modes to balance speed vs accuracy:
 *
 *   FAST_PREVIEW  — Quick feedback during modelling.
 *                   Reduced mesh density, lower CG tolerance,
 *                   fewer load combinations.
 *
 *   FULL_ANALYSIS — Engineering-grade accuracy.
 *                   Full mesh, tight tolerance, all combinations.
 *
 * The controller also selects the optimal solver tier based on
 * system size, available RAM, and thermal state.
 */

export type AnalysisMode = 'FAST_PREVIEW' | 'FULL_ANALYSIS';

export type SolverTier =
  | 'dense_cholesky'  // n < 300 — exact direct solve
  | 'dense_ldlt'      // n < 600 — semi-definite fallback
  | 'sparse_pcg'      // 600 ≤ n < 10000 — sparse iterative
  | 'sparse_pcg_wasm' // n ≥ 600, WASM available
  | 'chunked_pcg';    // n ≥ 10000 — chunked with thermal yields

export interface LODConfig {
  mode: AnalysisMode;

  // Mesh
  meshDensity: number;         // elements per metre (2 = coarse, 6 = fine)

  // Solver
  solverTier: SolverTier;
  cgTolerance: number;         // relative residual threshold
  cgMaxIter: number;

  // Thermal
  thermalYieldIntervalMs: number; // ms between scheduler yields
  yieldEveryIterations: number;   // CG iterations between yields

  // Precision
  integrationOrder: number;    // Gauss integration points (2 or 3)
  includeSecondOrder: boolean; // P-Delta effect

  // Rendering
  progressThrottleMs: number;  // min ms between UI progress updates
}

// ── Preset configurations ────────────────────────────────────────────────────

export const FAST_PREVIEW_CONFIG: Omit<LODConfig, 'solverTier' | 'cgMaxIter'> = {
  mode: 'FAST_PREVIEW',
  meshDensity: 2,
  cgTolerance: 1e-6,
  thermalYieldIntervalMs: 20,
  yieldEveryIterations: 25,
  integrationOrder: 2,
  includeSecondOrder: false,
  progressThrottleMs: 100,
};

export const FULL_ANALYSIS_CONFIG: Omit<LODConfig, 'solverTier' | 'cgMaxIter'> = {
  mode: 'FULL_ANALYSIS',
  meshDensity: 5,
  cgTolerance: 1e-10,
  thermalYieldIntervalMs: 40,
  yieldEveryIterations: 50,
  integrationOrder: 3,
  includeSecondOrder: false, // enable when P-Delta is implemented
  progressThrottleMs: 200,
};

// ── Solver tier selection ────────────────────────────────────────────────────

/**
 * Select the optimal solver tier based on system size,
 * available RAM, and whether WASM is ready.
 */
export function selectSolverTier(
  nFree: number,
  wasmReady: boolean,
  mode: AnalysisMode,
): SolverTier {
  if (mode === 'FAST_PREVIEW') {
    // Preview: always use the fastest path
    if (nFree < 600)  return 'dense_cholesky';
    if (wasmReady)    return 'sparse_pcg_wasm';
    return 'sparse_pcg';
  }

  // Full analysis
  if (nFree < 300)  return 'dense_cholesky';
  if (nFree < 600)  return 'dense_ldlt';
  if (nFree < 10000) return wasmReady ? 'sparse_pcg_wasm' : 'sparse_pcg';
  return 'chunked_pcg';
}

/**
 * Build a complete LODConfig for the given mode + system size.
 */
export function buildLODConfig(
  mode: AnalysisMode,
  nFree: number,
  wasmReady: boolean,
): LODConfig {
  const base = mode === 'FAST_PREVIEW' ? FAST_PREVIEW_CONFIG : FULL_ANALYSIS_CONFIG;
  const solverTier = selectSolverTier(nFree, wasmReady, mode);

  // CG max iterations: tighter for preview (quick divergence → stop)
  const cgMaxIter = mode === 'FAST_PREVIEW'
    ? Math.min(nFree * 2, 500)
    : Math.min(nFree * 10, 5000);

  return { ...base, solverTier, cgMaxIter };
}

// ── Estimated DOF from model metadata ────────────────────────────────────────

/**
 * Estimate total free DOF count without running assembly.
 * Used to select solver tier before analysis starts.
 */
export interface ModelEstimate {
  nodeCount: number;
  elementCount: number;
  supportCount: number; // fixed nodes
}

export function estimateFreeDOF(est: ModelEstimate): number {
  const totalDOF = est.nodeCount * 6;
  // Each fully-fixed support removes 6 DOF
  const fixedDOF = est.supportCount * 6;
  return Math.max(0, totalDOF - fixedDOF);
}

// ── Memory budget check ───────────────────────────────────────────────────────

export interface MemoryBudget {
  /** Estimated peak memory for dense solve (MB). */
  denseMB: number;
  /** Estimated peak memory for sparse solve (MB). */
  sparseMB: number;
  /** Whether dense solve fits within the mobile RAM budget. */
  denseOk: boolean;
  /** Whether sparse solve fits within the mobile RAM budget. */
  sparseOk: boolean;
  /** Recommended mode based on RAM. */
  recommendation: 'dense' | 'sparse';
}

/** RAM budget for mid-range Android (1.5 GB total, leave 1 GB for OS + app). */
const MOBILE_RAM_BUDGET_MB = 512;

export function checkMemoryBudget(nFree: number, nnzEstimate?: number): MemoryBudget {
  const denseMB  = (nFree * nFree * 8) / 1_048_576;
  const nnz      = nnzEstimate ?? nFree * 20; // rough estimate: ~20 non-zeros per row
  const sparseMB = (nnz * 12) / 1_048_576;   // 8 bytes value + 4 bytes col index

  return {
    denseMB:  Math.round(denseMB),
    sparseMB: Math.round(sparseMB),
    denseOk:  denseMB  <= MOBILE_RAM_BUDGET_MB,
    sparseOk: sparseMB <= MOBILE_RAM_BUDGET_MB,
    recommendation: denseMB > 64 ? 'sparse' : 'dense',
  };
}

// ── Progress throttle ────────────────────────────────────────────────────────

/**
 * Returns true if enough time has passed since the last progress update.
 * Prevents flooding the UI thread with tiny progress increments.
 */
export function shouldSendProgress(
  lastSentMs: number,
  throttleMs: number,
): boolean {
  return performance.now() - lastSentMs >= throttleMs;
}
