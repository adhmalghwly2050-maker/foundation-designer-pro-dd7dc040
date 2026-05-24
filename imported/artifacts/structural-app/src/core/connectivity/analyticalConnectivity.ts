/**
 * Analytical Connectivity System
 * ═══════════════════════════════════════════════════════════════════════════════
 * Implements professional analytical beam-column connectivity similar to ETABS.
 *
 * KEY PRINCIPLE:
 *   Drawn geometry  ≠  Analytical connectivity
 *
 * Pipeline:
 *   Raw Geometry
 *     → TopologyProcessor
 *       → AnalyticalJointResolution (column zone detection + beam snap)
 *         → ConnectivityGraph
 *           → Standard Node Merge (1mm tolerance)
 *             → FEM Assembly
 *
 * What this solves:
 * ─────────────────
 * 1. Beam centerlines offset from column centerlines → automatic snap
 * 2. Multiple beams framing into small columns → all merged to one column joint
 * 3. Small geometric gaps / imperfect geometry → tolerance-based connection
 * 4. No fake tiny members created — rigid behavior through shared analytical joint
 *
 * Snap tolerance (section-aware):
 *   tol = max(50mm,  colMaxDim/2  +  beamMaxDim/2  +  25mm clearance)
 *
 * All units: mm, N, MPa
 */

import type {
  StructuralModel,
  StructuralNode,
  StructuralElement,
  Section,
} from '../model/types';

// ─── Public Types ─────────────────────────────────────────────────────────────

/** A structural joint resolved analytically (independent of raw geometry). */
export interface AnalyticalJoint {
  id: number;
  x: number;
  y: number;
  z: number;
  sectionB?: number;
  sectionH?: number;
  connectedElementIds: Set<number>;
  isColumnJoint: boolean;
}

/** Record of a beam endpoint snapped to a column analytical joint. */
export interface SnapRecord {
  /** Original node ID (beam endpoint before snap). */
  beamNodeId: number;
  /** Column joint node ID it was snapped to. */
  columnJointNodeId: number;
  /** Eccentricity vector  [beam − column]  in mm (XY offset). */
  eccentricity: [number, number, number];
  /** XY distance resolved (mm). */
  snapDistance: number;
  /** Element ID of the beam. */
  beamElementId: number;
}

export interface ConnectivityResolution {
  /** Maps original beam node ID → column joint node ID it was snapped to. */
  snapMap: Map<number, number>;
  snapRecords: SnapRecord[];
  analyticalJoints: Map<number, AnalyticalJoint>;
  resolvedCount: number;
}

export interface TopologyProcessResult {
  nodes: StructuralNode[];
  elements: StructuralElement[];
  resolution: ConnectivityResolution;
}

// ─── Spatial Hash Index ───────────────────────────────────────────────────────
// O(1) average insert / O(k) query where k = candidates in radius.
// Avoids O(n²) brute-force for large models.

class SpatialHashIndex {
  private grid = new Map<string, number[]>();
  private positions = new Map<number, [number, number, number]>();
  private cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  insert(id: number, x: number, y: number, z: number): void {
    this.positions.set(id, [x, y, z]);
    const k = this.key(x, y, z);
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k)!.push(id);
  }

  /**
   * Return all node IDs within `radius` of (x, y, z).
   * Sorted ascending by distance.
   */
  queryRadius(x: number, y: number, z: number, radius: number): [number, number][] {
    const results: [number, number][] = [];
    const span = Math.ceil(radius / this.cellSize) + 1;
    const ix = Math.floor(x / this.cellSize);
    const iy = Math.floor(y / this.cellSize);
    const iz = Math.floor(z / this.cellSize);

    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        for (let dz = -span; dz <= span; dz++) {
          const cell = this.grid.get(`${ix + dx},${iy + dy},${iz + dz}`);
          if (!cell) continue;
          for (const nid of cell) {
            const p = this.positions.get(nid)!;
            const dist = Math.sqrt(
              (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2,
            );
            if (dist <= radius) results.push([nid, dist]);
          }
        }
      }
    }
    return results.sort((a, b) => a[1] - b[1]);
  }

  /** XY-only distance query (ignores Z). Used for plan-view snap. */
  queryXY(x: number, y: number, z: number, xyRadius: number, zTol: number): [number, number][] {
    const results: [number, number][] = [];
    const span = Math.ceil(xyRadius / this.cellSize) + 1;
    const ix = Math.floor(x / this.cellSize);
    const iy = Math.floor(y / this.cellSize);
    const iz = Math.floor(z / this.cellSize);

    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          const cell = this.grid.get(`${ix + dx},${iy + dy},${iz + dz}`);
          if (!cell) continue;
          for (const nid of cell) {
            const p = this.positions.get(nid)!;
            if (Math.abs(p[2] - z) > zTol) continue;
            const xyDist = Math.sqrt((p[0] - x) ** 2 + (p[1] - y) ** 2);
            if (xyDist <= xyRadius) results.push([nid, xyDist]);
          }
        }
      }
    }
    return results.sort((a, b) => a[1] - b[1]);
  }
}

// ─── Connectivity Resolver ────────────────────────────────────────────────────

export class ConnectivityResolver {
  private model: StructuralModel;
  private sectionMap: Map<string, Section>;

  constructor(model: StructuralModel) {
    this.model = model;
    this.sectionMap = new Map(model.sections.map(s => [s.id, s]));
  }

  private getSection(sectionId: string): Section | undefined {
    return this.sectionMap.get(sectionId);
  }

  /**
   * Compute the snap tolerance for a beam endpoint near a column joint.
   *
   * Logic:  half column width  +  half beam width  +  25mm clearance
   * Clamped to [50mm, 600mm].
   */
  private snapTolerance(colSection?: Section, beamSection?: Section): number {
    const colMax = colSection ? Math.max(colSection.b, colSection.h) : 400;
    const beamMax = beamSection ? Math.max(beamSection.b, beamSection.h) : 400;
    return Math.min(600, Math.max(50, colMax * 0.5 + beamMax * 0.5 + 25));
  }

  /**
   * Resolve analytical connectivity:
   * snap beam endpoints that are near (but not exactly at) column joints.
   */
  resolve(): ConnectivityResolution {
    const { nodes, elements } = this.model;
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // ── 1. Identify column node registry ──────────────────────────────────────
    const colElements = elements.filter(e => e.type === 'column');
    const beamElements = elements.filter(e => e.type === 'beam');

    // columnNodeInfo: colNodeId → { section, elementId }
    const colNodeInfo = new Map<number, { section?: Section; elementId: number }>();
    for (const col of colElements) {
      const section = this.getSection(col.sectionId);
      for (const nid of col.nodeIds) {
        if (!colNodeInfo.has(nid)) {
          colNodeInfo.set(nid, { section, elementId: col.id });
        }
      }
    }

    // ── 2. Build spatial index over column joints ──────────────────────────────
    // Cell size = 1000mm — covers typical column spacings well.
    const colIndex = new SpatialHashIndex(1000);
    for (const [nid] of colNodeInfo) {
      const n = nodeMap.get(nid);
      if (n) colIndex.insert(nid, n.x, n.y, n.z);
    }

    // ── 3. Build analytical joint records ─────────────────────────────────────
    const analyticalJoints = new Map<number, AnalyticalJoint>();
    for (const [nid, info] of colNodeInfo) {
      const n = nodeMap.get(nid);
      if (!n) continue;
      analyticalJoints.set(nid, {
        id: nid,
        x: n.x, y: n.y, z: n.z,
        sectionB: info.section?.b,
        sectionH: info.section?.h,
        connectedElementIds: new Set([info.elementId]),
        isColumnJoint: true,
      });
    }

    // ── 4. Snap beam endpoints to nearby column joints ─────────────────────────
    const snapMap = new Map<number, number>();      // beamNodeId → colNodeId
    const snapRecords: SnapRecord[] = [];
    let resolvedCount = 0;

    for (const beam of beamElements) {
      const beamSection = this.getSection(beam.sectionId);

      for (const beamNodeId of beam.nodeIds) {
        // Already a column joint → no snap needed
        if (colNodeInfo.has(beamNodeId)) continue;
        // Already snapped in a previous beam iteration → reuse
        if (snapMap.has(beamNodeId)) continue;

        const beamNode = nodeMap.get(beamNodeId);
        if (!beamNode) continue;

        // Maximum XY search radius (bounded by the largest practical tolerance)
        const maxXYSearch = 600;
        // Z tolerance: beam must be at the same floor level as the column joint
        // Allow ±100mm in Z (typical beam offset from story level)
        const zTol = 100;

        const candidates = colIndex.queryXY(
          beamNode.x, beamNode.y, beamNode.z,
          maxXYSearch, zTol,
        );

        for (const [colNodeId, xyDist] of candidates) {
          const colInfo = colNodeInfo.get(colNodeId)!;
          const tol = this.snapTolerance(colInfo.section, beamSection);

          if (xyDist <= tol) {
            const colNode = nodeMap.get(colNodeId)!;
            snapMap.set(beamNodeId, colNodeId);

            const ecc: [number, number, number] = [
              beamNode.x - colNode.x,
              beamNode.y - colNode.y,
              beamNode.z - colNode.z,
            ];

            snapRecords.push({
              beamNodeId,
              columnJointNodeId: colNodeId,
              eccentricity: ecc,
              snapDistance: xyDist,
              beamElementId: beam.id,
            });

            analyticalJoints.get(colNodeId)?.connectedElementIds.add(beam.id);
            resolvedCount++;
            break; // snap to nearest valid column joint
          }
        }
      }
    }

    return { snapMap, snapRecords, analyticalJoints, resolvedCount };
  }
}

// ─── Topology Processor (main entry point) ───────────────────────────────────

/**
 * Process analytical connectivity before FEM assembly.
 *
 * Steps:
 *   1. Resolve beam-to-column snaps (section-aware tolerance)
 *   2. Remap beam element node IDs to column joint node IDs
 *   3. Remove orphaned beam-endpoint nodes (not referenced by any element)
 *
 * The result is passed to the standard node-merge pipeline (1mm tolerance).
 */
export function processTopology(model: StructuralModel): TopologyProcessResult {
  const resolver = new ConnectivityResolver(model);
  const resolution = resolver.resolve();

  // Remap beam element node IDs
  const remappedElements: StructuralElement[] = model.elements.map(el => {
    if (el.type !== 'beam') return el;
    const remapped = el.nodeIds.map(nid => resolution.snapMap.get(nid) ?? nid);
    // Guard: ensure no duplicate node IDs in a single element (degenerate element)
    const unique = [...new Set(remapped)];
    if (unique.length < 2) return el; // revert if degenerate
    return { ...el, nodeIds: remapped };
  });

  // Collect all node IDs still referenced after remapping
  const usedIds = new Set<number>();
  for (const el of remappedElements) {
    for (const nid of el.nodeIds) usedIds.add(nid);
  }

  // Remove orphaned nodes (beam endpoints that were snapped away and no
  // longer appear in any element's nodeIds). This prevents spurious DOFs
  // that could cause near-singular stiffness matrices.
  const cleanedNodes = model.nodes.filter(n => usedIds.has(n.id));

  return {
    nodes: cleanedNodes,
    elements: remappedElements,
    resolution,
  };
}

// ─── Connectivity Graph ───────────────────────────────────────────────────────

export interface AnalyticalConnectivityGraph {
  /** nodeId → set of element IDs using that node. */
  nodeToElements: Map<number, Set<number>>;
  /** elementId → set of adjacent element IDs (sharing a node). */
  adjacency: Map<number, Set<number>>;
  /** nodeId → AnalyticalJoint (only for column joints). */
  joints: Map<number, AnalyticalJoint>;
}

export function buildAnalyticalGraph(
  elements: StructuralElement[],
  joints: Map<number, AnalyticalJoint>,
): AnalyticalConnectivityGraph {
  const nodeToElements = new Map<number, Set<number>>();
  for (const el of elements) {
    for (const nid of el.nodeIds) {
      if (!nodeToElements.has(nid)) nodeToElements.set(nid, new Set());
      nodeToElements.get(nid)!.add(el.id);
    }
  }

  const adjacency = new Map<number, Set<number>>();
  for (const el of elements) {
    if (!adjacency.has(el.id)) adjacency.set(el.id, new Set());
    for (const nid of el.nodeIds) {
      for (const adjId of nodeToElements.get(nid)!) {
        if (adjId !== el.id) adjacency.get(el.id)!.add(adjId);
      }
    }
  }

  return { nodeToElements, adjacency, joints };
}

// ─── Stability Validation ─────────────────────────────────────────────────────

export interface ConnectivityWarning {
  type: 'duplicate_snap' | 'degenerate_element' | 'disconnected_node' | 'excessive_eccentricity';
  message: string;
  nodeId?: number;
  elementId?: number;
}

/** Validate the topology result and return any warnings. */
export function validateTopology(
  result: TopologyProcessResult,
): ConnectivityWarning[] {
  const warnings: ConnectivityWarning[] = [];
  const { elements, resolution } = result;

  // Check for degenerate elements (same node at both ends)
  for (const el of elements) {
    if (el.nodeIds.length >= 2) {
      if (el.nodeIds[0] === el.nodeIds[el.nodeIds.length - 1]) {
        warnings.push({
          type: 'degenerate_element',
          message: `Element ${el.id} has same start and end node after connectivity resolution`,
          elementId: el.id,
        });
      }
    }
  }

  // Check for excessive eccentricities (> 500mm might indicate modeling error)
  for (const sr of resolution.snapRecords) {
    const exy = Math.sqrt(sr.eccentricity[0] ** 2 + sr.eccentricity[1] ** 2);
    if (exy > 500) {
      warnings.push({
        type: 'excessive_eccentricity',
        message: `Beam node ${sr.beamNodeId} snapped ${exy.toFixed(0)}mm to column joint ${sr.columnJointNodeId} — verify model geometry`,
        nodeId: sr.beamNodeId,
        elementId: sr.beamElementId,
      });
    }
  }

  return warnings;
}
