/**
 * Sparse Matrix Module — Public API
 * ════════════════════════════════════
 */

export { CSRMatrix, CSRBuilder } from './csrMatrix';
export { assembleGlobalSystemSparse } from './sparseAssembler';
export type { SparseAssemblyResult } from './sparseAssembler';

export {
  recommendedFormat,
  csrScale, csrAdd, csrFrobeniusNorm,
  extractDiagonal, applyBoundaryConditionsSparse,
  sparseMemoryStats,
  buildDOFMap, nodeDOFs,
} from './sparseMatrix';
export type { SparseMemoryStats } from './sparseMatrix';
