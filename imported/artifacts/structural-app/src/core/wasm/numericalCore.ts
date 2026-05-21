/**
 * WASM Numerical Core
 * ════════════════════════════════════════════════════════
 * High-performance numerical operations layer.
 *
 * Architecture:
 *   Tier 1 — Native WASM (Rust/C++ compiled)  → fastest
 *   Tier 2 — Optimized TypedArray JS           → fallback
 *   Tier 3 — Standard JS                       → last resort
 *
 * All operations use Float64Array / Int32Array to minimise GC.
 * No heap allocations inside hot loops — callers must pass
 * pre-allocated output buffers.
 */

import { getMemoryPool } from '../performance/memoryPool';

// ── Tier selection ────────────────────────────────────────────────────────────

let _wasmReady = false;
let _wasmModule: WasmNumericalModule | null = null;

export interface WasmNumericalModule {
  /** Sparse matrix-vector product: y = A_csr · x */
  csrMatvec(
    n: number,
    values: Float64Array, colIndices: Int32Array, rowPointers: Int32Array,
    x: Float64Array, y: Float64Array,
  ): void;

  /** Jacobi-Preconditioned CG solver */
  pcgSolve(
    n: number, nnz: number,
    values: Float64Array, colIndices: Int32Array, rowPointers: Int32Array,
    F: Float64Array, U: Float64Array,
    tol: number, maxIter: number,
  ): { iterations: number; residual: number; converged: boolean };

  /** In-place Cholesky factorisation; returns false if not SPD */
  choleskyFactor(K: Float64Array, n: number): boolean;

  /** Solve L·L^T·U = F after choleskyFactor() */
  choleskySolve(L: Float64Array, F: Float64Array, U: Float64Array, n: number): void;

  /** Dense matrix-vector multiply */
  denseMatvec(A: Float64Array, x: Float64Array, y: Float64Array, n: number): void;
}

/**
 * Register the compiled WASM module.
 * Call once at startup from the Worker bootstrap.
 */
export function registerWasmModule(mod: WasmNumericalModule): void {
  _wasmModule = mod;
  _wasmReady = true;
}

export function isWasmReady(): boolean { return _wasmReady; }
export function getWasmModule(): WasmNumericalModule | null { return _wasmModule; }

// ── SIMD-friendly dot product ─────────────────────────────────────────────────

/**
 * dot(a, b) using manual loop unrolling (4-way) for JIT vectorisation.
 * ~2-3× faster than naïve loop on V8/SpiderMonkey.
 */
export function dot4(a: Float64Array, b: Float64Array, n: number): number {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  const n4 = n & ~3;
  for (let i = 0; i < n4; i += 4) {
    s0 += a[i]     * b[i];
    s1 += a[i + 1] * b[i + 1];
    s2 += a[i + 2] * b[i + 2];
    s3 += a[i + 3] * b[i + 3];
  }
  let s = s0 + s1 + s2 + s3;
  for (let i = n4; i < n; i++) s += a[i] * b[i];
  return s;
}

// ── Sparse CSR matrix-vector product ─────────────────────────────────────────

/**
 * y = A · x   (CSR format, in-place into preallocated y)
 *
 * Uses WASM if available, otherwise the optimised JS loop.
 * O(nnz) — correct for large sparse structural matrices.
 */
export function csrMatvec(
  n: number,
  values: Float64Array,
  colIndices: Int32Array,
  rowPointers: Int32Array,
  x: Float64Array,
  y: Float64Array,
): void {
  if (_wasmReady && _wasmModule) {
    _wasmModule.csrMatvec(n, values, colIndices, rowPointers, x, y);
    return;
  }
  // Optimised JS fallback
  for (let i = 0; i < n; i++) {
    let s = 0;
    const end = rowPointers[i + 1];
    for (let p = rowPointers[i]; p < end; p++) {
      s += values[p] * x[colIndices[p]];
    }
    y[i] = s;
  }
}

// ── Preconditioned Conjugate Gradient (Jacobi) ───────────────────────────────

export interface PCGResult {
  converged: boolean;
  iterations: number;
  residualNorm: number;
}

/**
 * Solve K_sparse · U = F using Preconditioned CG.
 *
 * Features:
 *   - Jacobi (diagonal) preconditioner
 *   - WASM acceleration when available
 *   - Reuses buffers from MemoryPool to avoid GC
 *   - Yields to scheduler via `yieldFn` every `yieldEvery` iterations
 *
 * @param yieldFn   Async function that yields to scheduler (thermal protection).
 * @param yieldEvery Yield every N iterations (default 50).
 */
export async function pcgSolve(
  n: number,
  values: Float64Array,
  colIndices: Int32Array,
  rowPointers: Int32Array,
  F: Float64Array,
  U: Float64Array,
  tol = 1e-10,
  maxIter?: number,
  yieldFn?: () => Promise<void>,
  yieldEvery = 50,
): Promise<PCGResult> {
  const iMax = maxIter ?? Math.min(n * 4, 2000);

  if (_wasmReady && _wasmModule) {
    U.fill(0);
    const r = _wasmModule.pcgSolve(n, values.length, values, colIndices, rowPointers, F, U, tol, iMax);
    return { converged: r.converged, iterations: r.iterations, residualNorm: r.residual };
  }

  // ── JS fallback with thermal yields ──────────────────────────────────────
  const pool = getMemoryPool();
  const r   = pool.acquireFloat64(n);
  const z   = pool.acquireFloat64(n);
  const p   = pool.acquireFloat64(n);
  const Ap  = pool.acquireFloat64(n);
  const Minv = pool.acquireFloat64(n);

  try {
    // Jacobi preconditioner from diagonal
    for (let i = 0; i < n; i++) {
      const start = rowPointers[i];
      const end   = rowPointers[i + 1];
      let diag = 1;
      for (let ptr = start; ptr < end; ptr++) {
        if (colIndices[ptr] === i) { diag = values[ptr]; break; }
      }
      Minv[i] = Math.abs(diag) > 1e-30 ? 1 / diag : 1;
    }

    U.fill(0);
    r.set(F);  // r = F - K·0 = F

    for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
    p.set(z);

    let rz = dot4(r, z, n);
    const normF = Math.sqrt(dot4(F, F, n));
    const threshold = tol * (normF > 0 ? normF : 1);

    let iter = 0;
    while (iter < iMax) {
      // Thermal yield
      if (yieldFn && iter % yieldEvery === 0 && iter > 0) {
        await yieldFn();
      }

      csrMatvec(n, values, colIndices, rowPointers, p, Ap);
      const pAp = dot4(p, Ap, n);
      if (Math.abs(pAp) < 1e-30) break;
      const alpha = rz / pAp;

      for (let i = 0; i < n; i++) {
        U[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
      }

      const residualNorm = Math.sqrt(dot4(r, r, n));
      iter++;

      if (residualNorm <= threshold) {
        return { converged: true, iterations: iter, residualNorm };
      }

      for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
      const rzNew = dot4(r, z, n);
      const beta = rzNew / rz;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
      rz = rzNew;
    }

    const finalRes = Math.sqrt(dot4(r, r, n));
    return { converged: false, iterations: iter, residualNorm: finalRes };

  } finally {
    pool.releaseFloat64(r);
    pool.releaseFloat64(z);
    pool.releaseFloat64(p);
    pool.releaseFloat64(Ap);
    pool.releaseFloat64(Minv);
  }
}

// ── Dense Cholesky (small systems ≤ 600 DOF) ─────────────────────────────────

/**
 * Solve dense K · U = F via Cholesky factorisation.
 * Returns null if K is not positive-definite (falls back to LDLT).
 */
export function choleskySolve(
  K: Float64Array,
  F: Float64Array,
  n: number,
): Float64Array | null {
  if (_wasmReady && _wasmModule) {
    const L = new Float64Array(K);
    if (!_wasmModule.choleskyFactor(L, n)) return null;
    const U = new Float64Array(n);
    _wasmModule.choleskySolve(L, F, U, n);
    return U;
  }

  // JS Cholesky
  const L = new Float64Array(K);
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let k = 0; k < j; k++) sum += L[j * n + k] ** 2;
    const diag = L[j * n + j] - sum;
    if (diag <= 1e-30) return null;
    L[j * n + j] = Math.sqrt(diag);
    for (let i = j + 1; i < n; i++) {
      let s = 0;
      for (let k = 0; k < j; k++) s += L[i * n + k] * L[j * n + k];
      L[i * n + j] = (L[i * n + j] - s) / L[j * n + j];
    }
  }

  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < i; k++) s += L[i * n + k] * y[k];
    y[i] = (F[i] - s) / L[i * n + i];
  }

  const U = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = 0;
    for (let k = i + 1; k < n; k++) s += L[k * n + i] * U[k];
    U[i] = (y[i] - s) / L[i * n + i];
  }

  return U;
}

// ── LDLT (fallback for semi-definite) ────────────────────────────────────────

export function ldltSolve(K: Float64Array, F: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  const D = new Float64Array(n);
  for (let i = 0; i < n; i++) L[i * n + i] = 1;

  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let k = 0; k < j; k++) sum += L[j * n + k] ** 2 * D[k];
    D[j] = K[j * n + j] - sum;
    if (Math.abs(D[j]) < 1e-30) D[j] = 1e-20;
    for (let i = j + 1; i < n; i++) {
      let s = 0;
      for (let k = 0; k < j; k++) s += L[i * n + k] * L[j * n + k] * D[k];
      L[i * n + j] = (K[i * n + j] - s) / D[j];
    }
  }

  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < i; k++) s += L[i * n + k] * y[k];
    y[i] = F[i] - s;
  }

  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = Math.abs(D[i]) > 1e-30 ? y[i] / D[i] : 0;

  const U = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = 0;
    for (let k = i + 1; k < n; k++) s += L[k * n + i] * U[k];
    U[i] = z[i] - s;
  }

  return U;
}
