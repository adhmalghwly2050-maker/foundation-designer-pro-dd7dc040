/**
 * Async Analysis Controller — Mobile-First Pipeline
 * ════════════════════════════════════════════════════════
 * Async version of coreAnalysisController.ts with:
 *
 *   1. Progressive stage updates via onProgress callback
 *   2. Thermal Guard integration (no uninterrupted loops)
 *   3. Sparse PCG solver for large systems (avoids dense solve)
 *   4. LOD mode selection (FAST_PREVIEW / FULL_ANALYSIS)
 *   5. Memory pool buffer reuse
 *   6. Cancellation support via AbortSignal
 *
 * Drop-in replacement for runAnalysis() when called from a Worker.
 *
 * NOTE: The global stiffness matrix is assembled densely (required
 * for reaction computation in processResults). For very large systems
 * the sparse PCG solver is used for the solve step to avoid O(n³)
 * factorisation, while still using the dense K for reactions.
 */

import type { StructuralModel } from './model/types';
import type { AnalysisResult } from './postprocess/resultProcessor';
import { processGeometry } from './geometry/geometryProcessor';
import { assembleGlobalSystem } from './assembly/globalAssembler';
import { distributeSlabLoads, applySlabLoadsToForceVector } from './assembly/slabLoadDistributor';
import { processBoundaryConditions, extractReducedSystem, expandSolution } from './solver/boundaryProcessor';
import { solve, solveSparse } from './solver/globalSolver';
import { processResults } from './postprocess/resultProcessor';
import { CSRMatrix } from './sparse/csrMatrix';
import { ThermalGuard } from './performance/thermalGuard';
import { buildLODConfig, checkMemoryBudget } from './performance/lodController';
import type { AnalysisMode } from './performance/lodController';
import { getDeviceProfile } from './performance/mobileOptimizer';
import { flushMemoryPool } from './performance/memoryPool';

export interface AsyncAnalysisConfig {
  mode?: AnalysisMode;
  mergeTolerance?: number;
  solverMethod?: 'auto' | 'cholesky' | 'cg';
  signal?: AbortSignal;
  onProgress?: (pct: number, stage: string) => void;
  wasmAvailable?: boolean;
}

const DEFAULT_CONFIG: Required<Omit<AsyncAnalysisConfig, 'signal' | 'onProgress' | 'wasmAvailable'>> = {
  mode: 'FULL_ANALYSIS',
  mergeTolerance: 1.0,
  solverMethod: 'auto',
};

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Analysis was cancelled by the user', 'AbortError');
  }
}

/**
 * Run a complete structural analysis asynchronously with progress reporting.
 *
 * Stages:
 *   1. Geometry validation & node merging
 *   2. Global stiffness matrix assembly (dense — required for reactions)
 *   3. Load distribution from LOAD_ONLY slabs
 *   4. Boundary condition processing
 *   5. Linear system solve (Cholesky for small / Sparse PCG for large)
 *   6. Solution expansion & post-processing
 */
export async function runAnalysisAsync(
  model: StructuralModel,
  config: AsyncAnalysisConfig = {},
): Promise<AnalysisResult> {
  const cfg       = { ...DEFAULT_CONFIG, ...config };
  const signal    = config.signal;
  const progress  = config.onProgress ?? (() => {});
  const device    = getDeviceProfile();
  const guard     = new ThermalGuard(device.thermalIntervalMs);

  // ── Stage 1: Geometry ─────────────────────────────────────────────────────
  progress(5, 'مرحلة 1: معالجة الهندسة ودمج العقد...');
  await guard.forceYield();
  checkAbort(signal);

  const processed = processGeometry(model, cfg.mergeTolerance);
  const nNodes    = processed.model.nodes.length;

  // ── Stage 2: Assembly ────────────────────────────────────────────────────
  progress(20, `مرحلة 2: تجميع مصفوفة الصلابة الكلية (${nNodes} عقدة)...`);
  await guard.forceYield();
  checkAbort(signal);

  const estDOF    = nNodes * 6;
  const memBudget = checkMemoryBudget(estDOF);
  const lodConfig = buildLODConfig(cfg.mode, estDOF, cfg.wasmAvailable ?? false);

  // Dense assembly — required to compute reactions in processResults
  const assembly = assembleGlobalSystem(processed.model);

  // ── Stage 3: Load distribution ────────────────────────────────────────────
  progress(38, 'مرحلة 3: توزيع الأحمال من البلاطات...');
  await guard.forceYield();
  checkAbort(signal);

  const slabLoadDist = distributeSlabLoads(processed.model);
  applySlabLoadsToForceVector(assembly.F, slabLoadDist, assembly.dofMap);

  // ── Stage 4: Boundary conditions ──────────────────────────────────────────
  progress(50, 'مرحلة 4: معالجة الشروط الحدودية...');
  await guard.forceYield();
  checkAbort(signal);

  const boundary = processBoundaryConditions(
    processed.model.nodes,
    assembly.dofMap,
  );

  // ── Stage 5: Solve ────────────────────────────────────────────────────────
  progress(60, `مرحلة 5: حل KU=F بمحرك (${lodConfig.solverTier})...`);
  await guard.forceYield();
  checkAbort(signal);

  const nFree = boundary.freeDOFs.length;
  let U: Float64Array;

  if (nFree === 0) {
    U = new Float64Array(assembly.totalDOF);
  } else {
    // Use sparse PCG for large systems to avoid O(n³) dense factorisation
    const useSparse = memBudget.recommendation === 'sparse' && nFree > 600;

    if (useSparse) {
      // Build CSR from the reduced dense system (avoids O(n²) memory during solve)
      const { Kff, Ff } = extractReducedSystem(
        assembly.K, assembly.F, assembly.totalDOF, boundary,
      );
      const K_csr = CSRMatrix.fromDense(Kff, nFree);

      await guard.forceYield();
      checkAbort(signal);

      const solverResult = solveSparse(K_csr, Ff, {
        method: 'cg',
        cgTolerance: lodConfig.cgTolerance,
        cgMaxIter:   lodConfig.cgMaxIter,
      });

      U = expandSolution(solverResult.U, assembly.totalDOF, boundary);
    } else {
      const { Kff, Ff } = extractReducedSystem(
        assembly.K, assembly.F, assembly.totalDOF, boundary,
      );
      const solverResult = solve(Kff, Ff, nFree, {
        method: cfg.solverMethod,
        cgTolerance: lodConfig.cgTolerance,
      });
      U = expandSolution(solverResult.U, assembly.totalDOF, boundary);
    }
  }

  // ── Stage 6: Post-processing ──────────────────────────────────────────────
  progress(88, 'مرحلة 6: استخراج النتائج وما بعد المعالجة...');
  await guard.forceYield();
  checkAbort(signal);

  const result = processResults(U, processed.model, assembly, boundary);

  progress(100, 'اكتمل التحليل.');
  flushMemoryPool();

  return result;
}
