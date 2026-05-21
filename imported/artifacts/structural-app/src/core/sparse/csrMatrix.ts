/**
 * CSR Sparse Matrix
 * ════════════════════════════════════════════════════════
 * Compressed Sparse Row format for memory-efficient structural
 * stiffness matrices.
 *
 * Layout:
 *   rowPointers[i]   = first entry of row i in values/colIndices
 *   rowPointers[i+1] = one-past-last entry of row i
 *   colIndices[p]    = column index of the p-th non-zero
 *   values[p]        = value of the p-th non-zero
 *
 * Memory vs dense: for a 600×600 matrix with ~1% fill, CSR uses
 * ~57 KB instead of 2.88 MB — a 50× reduction.
 */

export class CSRMatrix {
  readonly n: number;
  readonly values: Float64Array;
  readonly colIndices: Int32Array;
  readonly rowPointers: Int32Array;
  readonly nnz: number;

  constructor(
    n: number,
    values: Float64Array,
    colIndices: Int32Array,
    rowPointers: Int32Array,
  ) {
    this.n = n;
    this.values = values;
    this.colIndices = colIndices;
    this.rowPointers = rowPointers;
    this.nnz = values.length;
  }

  /**
   * Sparse matrix–vector product: y = A · x
   * O(nnz) instead of O(n²) for dense.
   */
  matvec(x: Float64Array, out?: Float64Array): Float64Array {
    const y = out ?? new Float64Array(this.n);
    const { n, values, colIndices, rowPointers } = this;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const end = rowPointers[i + 1];
      for (let p = rowPointers[i]; p < end; p++) {
        s += values[p] * x[colIndices[p]];
      }
      y[i] = s;
    }
    return y;
  }

  /**
   * Diagonal values (for Jacobi preconditioner in CG solver).
   */
  diagonal(): Float64Array {
    const d = new Float64Array(this.n);
    const { n, values, colIndices, rowPointers } = this;
    for (let i = 0; i < n; i++) {
      const end = rowPointers[i + 1];
      for (let p = rowPointers[i]; p < end; p++) {
        if (colIndices[p] === i) { d[i] = values[p]; break; }
      }
    }
    return d;
  }

  /** Bytes used by this matrix. */
  memoryBytes(): number {
    return this.values.byteLength + this.colIndices.byteLength + this.rowPointers.byteLength;
  }

  /** Sparsity as fraction of non-zeros in the full n×n matrix. */
  sparsityFraction(): number {
    return this.nnz / (this.n * this.n);
  }

  /**
   * Convert from dense row-major Float64Array.
   * Entries with |v| ≤ tol are treated as structural zeros.
   */
  static fromDense(K: Float64Array, n: number, tol = 1e-20): CSRMatrix {
    // Count NNZ first
    let nnz = 0;
    for (let i = 0; i < n; i++) {
      const row = i * n;
      for (let j = 0; j < n; j++) {
        if (Math.abs(K[row + j]) > tol) nnz++;
      }
    }
    const values = new Float64Array(nnz);
    const colIndices = new Int32Array(nnz);
    const rowPointers = new Int32Array(n + 1);
    let ptr = 0;
    for (let i = 0; i < n; i++) {
      rowPointers[i] = ptr;
      const row = i * n;
      for (let j = 0; j < n; j++) {
        const v = K[row + j];
        if (Math.abs(v) > tol) {
          values[ptr] = v;
          colIndices[ptr] = j;
          ptr++;
        }
      }
    }
    rowPointers[n] = ptr;
    return new CSRMatrix(n, values, colIndices, rowPointers);
  }
}

/**
 * Incremental builder — collects (row, col, value) triplets and
 * assembles a CSRMatrix, accumulating duplicate entries.
 *
 * Typical use:
 *   const b = new CSRBuilder(n);
 *   b.add(gi, gj, kij);   // for each element stiffness entry
 *   const K = b.build();
 */
export class CSRBuilder {
  private readonly n: number;
  private rows: number[] = [];
  private cols: number[] = [];
  private vals: number[] = [];

  constructor(n: number) {
    this.n = n;
  }

  add(row: number, col: number, value: number): void {
    this.rows.push(row);
    this.cols.push(col);
    this.vals.push(value);
  }

  /** Assemble CSRMatrix, summing duplicate entries (as FEM requires). */
  build(): CSRMatrix {
    const n = this.n;
    const triplets = this.rows.length;

    // Use per-row Maps for fast accumulation
    const rowMaps: Map<number, number>[] = [];
    for (let i = 0; i < n; i++) rowMaps.push(new Map());

    for (let t = 0; t < triplets; t++) {
      const r = this.rows[t];
      const c = this.cols[t];
      const v = this.vals[t];
      if (r < 0 || r >= n || c < 0 || c >= n) continue;
      rowMaps[r].set(c, (rowMaps[r].get(c) ?? 0) + v);
    }

    // Compute NNZ
    let nnz = 0;
    for (let i = 0; i < n; i++) nnz += rowMaps[i].size;

    const values = new Float64Array(nnz);
    const colIndices = new Int32Array(nnz);
    const rowPointers = new Int32Array(n + 1);

    let ptr = 0;
    for (let i = 0; i < n; i++) {
      rowPointers[i] = ptr;
      const sortedCols = [...rowMaps[i].keys()].sort((a, b) => a - b);
      for (const col of sortedCols) {
        values[ptr] = rowMaps[i].get(col)!;
        colIndices[ptr] = col;
        ptr++;
      }
    }
    rowPointers[n] = ptr;

    return new CSRMatrix(n, values, colIndices, rowPointers);
  }

  /** Reset for reuse without reallocating. */
  reset(): void {
    this.rows = [];
    this.cols = [];
    this.vals = [];
  }

  get entryCount(): number { return this.rows.length; }
}
