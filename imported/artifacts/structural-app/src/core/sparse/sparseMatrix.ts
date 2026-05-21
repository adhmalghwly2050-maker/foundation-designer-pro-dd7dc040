/**
 * Unified Sparse Matrix API
 * ════════════════════════════════════════════════════════
 * Single entry point for all sparse-matrix operations.
 * Wraps CSRMatrix + CSRBuilder with additional utilities:
 *
 *   - Dynamic DOF indexing helpers
 *   - Memory statistics
 *   - Auto-detect dense vs sparse threshold
 *   - Chunked in-place operations to reduce peak allocation
 */

import { CSRMatrix, CSRBuilder } from './csrMatrix';

export { CSRMatrix, CSRBuilder } from './csrMatrix';
export { assembleGlobalSystemSparse } from './sparseAssembler';
export type { SparseAssemblyResult } from './sparseAssembler';

// ── Threshold heuristic ───────────────────────────────────────────────────────

/**
 * Return 'sparse' when n exceeds the threshold, otherwise 'dense'.
 * Below ~200 DOF the overhead of CSR is not worth it.
 */
export function recommendedFormat(n: number): 'dense' | 'sparse' {
  return n >= 200 ? 'sparse' : 'dense';
}

// ── CSR utilities ─────────────────────────────────────────────────────────────

/**
 * Scale a CSR matrix in-place by a scalar factor.
 * Used for load combination assembly (1.2D + 1.6L etc.).
 */
export function csrScale(K: CSRMatrix, factor: number): void {
  for (let p = 0; p < K.nnz; p++) {
    (K.values as Float64Array)[p] *= factor;
  }
}

/**
 * Add two CSR matrices: C = A + B.
 * Requires identical sparsity patterns (same nodeIds/DOF map).
 * Used for combining stiffness matrices from multiple load cases.
 */
export function csrAdd(A: CSRMatrix, B: CSRMatrix): CSRMatrix {
  if (A.n !== B.n || A.nnz !== B.nnz) {
    throw new Error(`csrAdd: incompatible matrices ${A.n}×${A.nnz} vs ${B.n}×${B.nnz}`);
  }
  const values = new Float64Array(A.nnz);
  for (let p = 0; p < A.nnz; p++) values[p] = A.values[p] + B.values[p];
  return new CSRMatrix(A.n, values, A.colIndices, A.rowPointers);
}

/**
 * Compute the Frobenius norm of a CSR matrix.
 * Used for condition estimation and convergence checks.
 */
export function csrFrobeniusNorm(K: CSRMatrix): number {
  let s = 0;
  for (let p = 0; p < K.nnz; p++) s += K.values[p] ** 2;
  return Math.sqrt(s);
}

/**
 * Extract the diagonal of a CSR matrix into a pre-allocated array.
 * Faster than the class method when the output buffer is pooled.
 */
export function extractDiagonal(K: CSRMatrix, out: Float64Array): void {
  const { n, values, colIndices, rowPointers } = K;
  for (let i = 0; i < n; i++) {
    out[i] = 0;
    const end = rowPointers[i + 1];
    for (let p = rowPointers[i]; p < end; p++) {
      if (colIndices[p] === i) { out[i] = values[p]; break; }
    }
  }
}

/**
 * Apply boundary conditions to a CSR matrix in-place.
 * Sets fixed-DOF rows/columns to identity (1 on diagonal, 0 elsewhere),
 * and adjusts the force vector accordingly.
 *
 * More memory-efficient than extracting a reduced system for sparse
 * matrices because it avoids building a second CSR structure.
 */
export function applyBoundaryConditionsSparse(
  K: CSRMatrix,
  F: Float64Array,
  fixedDOFs: number[],
): void {
  const fixedSet = new Set(fixedDOFs);
  const { n, values, colIndices, rowPointers } = K;
  const vals = values as Float64Array;

  for (let i = 0; i < n; i++) {
    const fixed_i = fixedSet.has(i);
    const start = rowPointers[i];
    const end   = rowPointers[i + 1];

    if (fixed_i) {
      // Row: zero all entries, set diagonal = 1
      for (let p = start; p < end; p++) {
        vals[p] = colIndices[p] === i ? 1 : 0;
      }
      F[i] = 0; // prescribed displacement = 0
    } else {
      // Column: zero entries in column i for free rows
      for (let p = start; p < end; p++) {
        const j = colIndices[p];
        if (fixedSet.has(j) && j !== i) {
          vals[p] = 0;
        }
      }
    }
  }
}

// ── Memory statistics ─────────────────────────────────────────────────────────

export interface SparseMemoryStats {
  n: number;
  nnz: number;
  /** Memory used by CSR arrays (bytes) */
  sparseBytes: number;
  sparseMB: number;
  /** Memory a dense n×n matrix would use (bytes) */
  denseBytes: number;
  denseMB: number;
  /** Compression ratio dense / sparse */
  compressionRatio: number;
  sparsityPercent: number;
}

export function sparseMemoryStats(K: CSRMatrix): SparseMemoryStats {
  const sparseBytes = K.memoryBytes();
  const denseBytes  = K.n * K.n * 8;
  const sparsityPercent = (1 - K.nnz / (K.n * K.n)) * 100;
  return {
    n: K.n,
    nnz: K.nnz,
    sparseBytes,
    sparseMB: sparseBytes / 1_048_576,
    denseBytes,
    denseMB:  denseBytes  / 1_048_576,
    compressionRatio: denseBytes / Math.max(sparseBytes, 1),
    sparsityPercent,
  };
}

// ── DOF map helpers ───────────────────────────────────────────────────────────

/** Build a global DOF map from an ordered list of node IDs. */
export function buildDOFMap(nodeIds: number[], dofPerNode = 6): Map<number, number> {
  const map = new Map<number, number>();
  let idx = 0;
  for (const id of nodeIds) {
    map.set(id, idx);
    idx += dofPerNode;
  }
  return map;
}

/** Get all global DOF indices for a given node ID. */
export function nodeDOFs(nodeId: number, dofMap: Map<number, number>, dofPerNode = 6): number[] {
  const base = dofMap.get(nodeId);
  if (base === undefined) return [];
  return Array.from({ length: dofPerNode }, (_, i) => base + i);
}
