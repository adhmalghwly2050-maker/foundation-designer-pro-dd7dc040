/**
 * Sparse Global Matrix Assembler
 * ════════════════════════════════════════════════════════
 * Assembles the global stiffness matrix in CSR sparse format
 * instead of a dense n×n Float64Array.
 *
 * For large models this reduces:
 *   - Memory: O(nnz) instead of O(n²)
 *   - Solve time: O(nnz · iter) instead of O(n²) per CG iteration
 *
 * Drop-in companion to globalAssembler.ts — uses the same
 * element routines but outputs a CSRMatrix.
 */

import type { StructuralModel } from '../model/types';
import { buildLocalFrameStiffness, computeFrameProps } from '../elements/frameElement';
import { buildShellStiffness } from '../elements/shellElement';
import { buildFrameTransformation, transformStiffness, buildShellTransformation } from '../elements/transformation';
import { CSRBuilder, CSRMatrix } from './csrMatrix';

const NDOF = 6; // DOF per node

export interface SparseAssemblyResult {
  /** Sparse global stiffness matrix (CSR). */
  K: CSRMatrix;
  /** Global force vector. */
  F: Float64Array;
  /** Total DOF count (= nodes × 6). */
  totalDOF: number;
  /** Node-ID → first DOF index map. */
  dofMap: Map<number, number>;
  /** Node IDs in DOF order. */
  nodeOrder: number[];
  /** Ratio nnz / (n*n) — lower is sparser. */
  sparsityFraction: number;
  /** Dense-equivalent size in MB (for diagnostics). */
  denseEquivalentMB: number;
}

/**
 * Assemble global stiffness matrix in CSR sparse format.
 * Identical physics to assembleGlobalSystem() but uses
 * O(nnz) memory instead of O(n²).
 */
export function assembleGlobalSystemSparse(model: StructuralModel): SparseAssemblyResult {
  // Build DOF map
  const dofMap = new Map<number, number>();
  const nodeOrder: number[] = [];
  let idx = 0;
  for (const node of model.nodes) {
    dofMap.set(node.id, idx);
    nodeOrder.push(node.id);
    idx += NDOF;
  }
  const totalDOF = model.nodes.length * NDOF;

  const builder = new CSRBuilder(totalDOF);
  const F = new Float64Array(totalDOF);

  const nodeMap = new Map(model.nodes.map(n => [n.id, n]));
  const matMap = new Map(model.materials.map(m => [m.id, m]));
  const secMap = new Map(model.sections.map(s => [s.id, s]));

  for (const elem of model.elements) {
    const mat = matMap.get(elem.materialId);
    const sec = secMap.get(elem.sectionId);
    if (!mat) continue;

    // LOAD_ONLY slabs: skip stiffness assembly
    if (elem.type === 'slab' && elem.slabProperties?.stiffnessMode === 'LOAD_ONLY') continue;

    let K_global: number[];
    let elemNodeIds: number[];

    if (elem.type === 'beam' || elem.type === 'column') {
      if (!sec || elem.nodeIds.length !== 2) continue;
      const nI = nodeMap.get(elem.nodeIds[0])!;
      const nJ = nodeMap.get(elem.nodeIds[1])!;
      const L = Math.sqrt(
        (nJ.x - nI.x) ** 2 + (nJ.y - nI.y) ** 2 + (nJ.z - nI.z) ** 2,
      );
      if (L < 1e-10) continue;
      const props = computeFrameProps(mat, sec, L);
      const K_local = buildLocalFrameStiffness(props);
      const T = buildFrameTransformation(nI, nJ);
      K_global = transformStiffness(K_local, T, 12);
      elemNodeIds = elem.nodeIds;

    } else if (elem.type === 'slab' || elem.type === 'wall') {
      if (elem.nodeIds.length !== 4 || !elem.slabProperties) continue;
      const nodes = elem.nodeIds.map(id => nodeMap.get(id)!);
      const coords = nodes.map(n => ({ x: n.x, y: n.y, z: n.z }));
      const K_local = buildShellStiffness(coords, mat, elem.slabProperties);
      const T = buildShellTransformation(nodes);
      K_global = transformStiffness(K_local, T, 24);
      elemNodeIds = elem.nodeIds;

    } else {
      continue;
    }

    // Scatter into builder
    const elemDOFs: number[] = [];
    for (const nid of elemNodeIds) {
      const base = dofMap.get(nid)!;
      for (let d = 0; d < NDOF; d++) elemDOFs.push(base + d);
    }
    const elemSize = elemDOFs.length;
    for (let i = 0; i < elemSize; i++) {
      for (let j = 0; j < elemSize; j++) {
        const v = K_global[i * elemSize + j];
        if (Math.abs(v) > 1e-30) {
          builder.add(elemDOFs[i], elemDOFs[j], v);
        }
      }
    }
  }

  // Force vector from nodal loads
  for (const node of model.nodes) {
    const base = dofMap.get(node.id)!;
    for (const load of node.nodalLoads) {
      F[base + 0] += load.fx;
      F[base + 1] += load.fy;
      F[base + 2] += load.fz;
      F[base + 3] += load.mx;
      F[base + 4] += load.my;
      F[base + 5] += load.mz;
    }
  }

  const K = builder.build();
  const sparsityFraction = K.nnz / (totalDOF * totalDOF);
  const denseEquivalentMB = (totalDOF * totalDOF * 8) / 1_048_576;

  return { K, F, totalDOF, dofMap, nodeOrder, sparsityFraction, denseEquivalentMB };
}
