/**
 * Slab Load Distributor
 * ═══════════════════════════════════════════════════════════════
 * For slabs in LOAD_ONLY mode: converts slab area loads into
 * equivalent beam distributed loads and nodal forces.
 *
 * Uses Voronoi (nearest-segment) distribution:
 * - Each slab polygon (rectangular OR irregular) is sampled with
 *   a dense grid; each sample goes to the nearest perimeter beam.
 * - Supports slabs with any number of nodes (≥ 3), so irregular
 *   polygons are handled correctly without bounding-box fallback.
 */

import {
  computeLineProfileStats,
  type PlanarBeamGeometry,
  type PlanarSlabGeometry,
} from '../../lib/slabLoadTransfer';
import {
  buildVoronoiBeamLoads,
} from '../../lib/voronoiSlabLoad';
import type { StructuralModel } from '../model/types';

export interface DistributedBeamLoad {
  beamElementId: number;
  /** Load intensity at start and end of beam (kN/m for display, N/mm internally). */
  wStart: number; // N/mm
  wEnd: number;   // N/mm
}

export interface SlabLoadDistributionResult {
  beamLoads: DistributedBeamLoad[];
  /** Equivalent nodal forces to add to the global force vector. */
  nodalForces: Map<number, { fz: number }>; // nodeId → vertical force (N)
}

/**
 * Distribute slab loads to supporting beams for LOAD_ONLY slabs.
 * Uses Voronoi (nearest-segment) approach for accurate load transfer
 * on both rectangular and irregular polygon slabs.
 */
export function distributeSlabLoads(
  model: StructuralModel,
): SlabLoadDistributionResult {
  const nodeMap = new Map(model.nodes.map(n => [n.id, n]));
  const matMap  = new Map(model.materials.map(m => [m.id, m]));
  const beamLoads: DistributedBeamLoad[] = [];
  const nodalForces = new Map<number, { fz: number }>();

  const addForce = (nodeId: number, fz: number) => {
    const existing = nodalForces.get(nodeId);
    if (existing) existing.fz += fz;
    else nodalForces.set(nodeId, { fz });
  };

  const loadOnlySlabs = model.elements.filter(
    e => e.type === 'slab' && e.slabProperties?.stiffnessMode === 'LOAD_ONLY',
  );
  const beams = model.elements.filter(e => e.type === 'beam' && e.nodeIds.length === 2);

  // ── Build slab geometries (supports ≥ 3 nodes — irregular polygons OK) ──
  const slabGeoms: PlanarSlabGeometry[] = [];
  for (const slab of loadOnlySlabs) {
    const mat = matMap.get(slab.materialId);
    if (!mat || !slab.slabProperties) continue;

    const nodes = slab.nodeIds.map(id => nodeMap.get(id)).filter(Boolean);
    if (nodes.length < 3) continue;

    const xs = nodes.map(n => n!.x);
    const ys = nodes.map(n => n!.y);
    const selfWeight = mat.gamma * slab.slabProperties.thickness; // N/mm²

    const geom: PlanarSlabGeometry = {
      id: `slab_${slab.id}`,
      x1: Math.min(...xs),
      y1: Math.min(...ys),
      x2: Math.max(...xs),
      y2: Math.max(...ys),
      deadLoad: selfWeight,
      liveLoad: 0,
    };

    // For irregular slabs (more than 4 nodes), pass actual polygon vertices
    if (nodes.length > 4) {
      geom.vertices = nodes.map(n => ({ x: n!.x, y: n!.y }));
    }

    slabGeoms.push(geom);
  }

  // ── Build beam geometry list ─────────────────────────────────────────────
  const beamGeoms: PlanarBeamGeometry[] = [];
  const beamNodeMap = new Map<string, { nodeI: typeof nodeMap extends Map<any, infer V> ? V : never; nodeJ: typeof nodeMap extends Map<any, infer V> ? V : never }>();

  for (const beam of beams) {
    const nodeI = nodeMap.get(beam.nodeIds[0]);
    const nodeJ = nodeMap.get(beam.nodeIds[1]);
    if (!nodeI || !nodeJ) continue;
    const len = Math.hypot(nodeJ.x - nodeI.x, nodeJ.y - nodeI.y);
    if (len < 1e-9) continue;
    const id = String(beam.id);
    beamGeoms.push({ id, x1: nodeI.x, y1: nodeI.y, x2: nodeJ.x, y2: nodeJ.y, length: len });
    beamNodeMap.set(id, { nodeI, nodeJ });
  }

  // ── Voronoi distribution ─────────────────────────────────────────────────
  const voronoiMap = buildVoronoiBeamLoads(slabGeoms, beamGeoms, 0, 0, 60);

  for (const beam of beams) {
    const id = String(beam.id);
    const info = beamNodeMap.get(id);
    if (!info) continue;
    const { nodeI, nodeJ } = info;
    const beamLength = Math.hypot(nodeJ.x - nodeI.x, nodeJ.y - nodeI.y);

    const profile = voronoiMap.get(id);
    if (!profile) continue;

    const stats = computeLineProfileStats(profile.profileDL);
    if (stats.area < 1e-9) continue;

    const totalForce = stats.area * beamLength;
    const forceI = -totalForce * (1 - stats.centroidT);
    const forceJ = -totalForce * stats.centroidT;

    addForce(nodeI.id, forceI);
    addForce(nodeJ.id, forceJ);

    beamLoads.push({
      beamElementId: beam.id,
      wStart: profile.profileDL[0]?.wy ?? 0,
      wEnd:   profile.profileDL[profile.profileDL.length - 1]?.wy ?? 0,
    });
  }

  return { beamLoads, nodalForces };
}

/**
 * Apply distributed slab loads to the force vector.
 */
export function applySlabLoadsToForceVector(
  F: Float64Array,
  distribution: SlabLoadDistributionResult,
  dofMap: Map<number, number>,
): void {
  for (const [nodeId, forces] of distribution.nodalForces) {
    const base = dofMap.get(nodeId);
    if (base === undefined) continue;
    F[base + 2] += forces.fz; // uz DOF (vertical)
  }
}
