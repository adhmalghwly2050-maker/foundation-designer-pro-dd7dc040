/**
 * استخراج أحمال الأعمدة من التحليل ثلاثي الأبعاد (3D Frame Analysis)
 * لاستخدامها في التصميم بدلاً من الطريقة التقريبية (2D)
 *
 * المحاور: للأعمدة الرأسية:
 *   - Local Y = Global X → momentY = Mx (عزم حول المحور العالمي X)
 *   - Local Z = Global Y → momentZ = My (عزم حول المحور العالمي Y)
 *   - nodeI = أسفل العمود (Bot), nodeJ = أعلى العمود (Top)
 */

import type { Beam, Column, Frame, FrameResult, MatProps, BeamOnBeamConnection, Slab, SlabProps, ManualJointOverride } from '@/lib/structuralEngine';
import { analyze3DFrame, analyze3DFrameMultiLoad, type Node3D, type Element3D, type Model3D, type LoadCase3D } from '@/lib/solver3D';
import { computeFEMSlabProfiles } from '@/lib/femLoadBridge';
import { buildSlabEdgeLoads, computeBeamLoadProfile } from '@/lib/slabLoadTransfer';
import { buildVoronoiBeamLoads } from '@/lib/voronoiSlabLoad';
import { GlobalNodeRegistry } from '@/lib/globalFrameSolver';

export interface ColumnLoads3D {
  Pu: number;
  PuMin: number;   // min axial (may be tension for edge columns under eccentric live load)
  Mx: number;   // max |momentY| (global X moment)
  My: number;   // max |momentZ| (global Y moment)
  MxTop: number; // momentY at top
  MxBot: number; // momentY at bottom
  MyTop: number; // momentZ at top
  MyBot: number; // momentZ at bottom
  Vu: number;    // max shear
  P_service: number; // خدمي: 1.0D + 1.0L — يستخدم لتصميم الأساسات (WSM)
}

interface BeamEnvelope3D {
  shearYMax: number;
  shearYI: number;
  shearYJ: number;
  momentZI: number;
  momentZJ: number;
  momentZmid: number;
  momentStations?: number[];
}

interface ColumnEnvelope3D {
  axialMax: number; // max compression (positive)
  axialMin: number; // min (may be tension — negative)
  shearMax: number;
  momentYI: number;
  momentYJ: number;
  momentYmax: number;
  momentZI: number;
  momentZJ: number;
  momentZmax: number;
}

type EndReleaseMap = Record<string, {
  nodeI: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
  nodeJ: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
}>;

/**
 * Build the 3D global stiffness model with pattern loading cases.
 *
 * Beam-on-Beam handling (ETABS-equivalent):
 * For each beam-on-beam connection the PRIMARY (carrier) beam is split at the
 * bearing point into two sub-elements sharing an intermediate node.  The
 * SECONDARY (carried) beams have their removed-column end reconnected to that
 * same intermediate node, and a moment release (hinge) is applied there so
 * only shear is transferred — exactly as ETABS models a Gerber beam.
 * This is a true FEM solution: both distributed loads AND the carried beam
 * reaction are resolved simultaneously in the global stiffness matrix.
 * No iteration or approximation is needed.
 */
function build3DModelWithPatternLoading(
  frames: Frame[],
  beams: Beam[],
  columns: Column[],
  mat: MatProps,
  frameEndReleases?: EndReleaseMap,
  beamOnBeamConnections?: BeamOnBeamConnection[],
  slabs?: Slab[],
  slabProps?: SlabProps,
  useFEMLoadDistribution?: boolean,
  beamStiffnessFactor: number = 0.35,
  colStiffnessFactor: number = 0.65,
  colRigidEndOffsets?: Record<string, boolean>,
  manualJointOverrides?: ManualJointOverride[],
): { model: Model3D; patternCases: LoadCase3D[]; primaryBeamSplitIds: Map<string, string>; serviceCaseIndex: number } {
  const beamsMap = new Map(beams.map(b => [b.id, b]));
  const E = 4700 * Math.sqrt(mat.fc) * 1000; // MPa → kPa (kN/m²) — consistent with kN/m loads
  const G = E / (2 * (1 + 0.2));

  // ── UNIFIED NODE REGISTRY (same as UF / Global Frame Solver) ──────────
  // Uses spatial bucket hash with 1mm tolerance — identical to the registry
  // used by `solveGlobalFrame`, guaranteeing both engines build the same
  // node topology for the same physical model.
  const registry = new GlobalNodeRegistry(1.0);
  // Track restraints applied to each registry node id (registry only stores
  // the FIRST restraint vector; we OR-merge subsequent restraint requests
  // so a column-bottom support is preserved even if a beam later probes the
  // same coordinate with no restraint).
  const nodeRestraints = new Map<string, [boolean, boolean, boolean, boolean, boolean, boolean]>();
  const elements3d: Element3D[] = [];

  // Helper: get or create node by position via the unified registry.
  // Returns the registry node id and merges restraints (logical OR per DOF).
  const getOrCreateNode = (
    x: number,
    y: number,
    z: number,
    restraints: [boolean, boolean, boolean, boolean, boolean, boolean],
  ): string => {
    const node = registry.getOrCreateNode(x, y, z, restraints);
    const prev = nodeRestraints.get(node.id);
    if (!prev) {
      nodeRestraints.set(node.id, [...restraints]);
    } else {
      // OR-merge so any DOF restrained by ANY caller stays restrained
      const merged: [boolean, boolean, boolean, boolean, boolean, boolean] = [
        prev[0] || restraints[0],
        prev[1] || restraints[1],
        prev[2] || restraints[2],
        prev[3] || restraints[3],
        prev[4] || restraints[4],
        prev[5] || restraints[5],
      ];
      nodeRestraints.set(node.id, merged);
    }
    return node.id;
  };

  // Determine ground level
  let minZ = Infinity;
  for (const col of columns) {
    if (col.isRemoved) continue;
    const zBot = col.zBottom ?? 0;
    if (zBot < minZ) minZ = zBot;
  }

  const colTopNodeMap = new Map<string, string>();

  for (const col of columns) {
    if (col.isRemoved) continue;
    const zBot = col.zBottom ?? 0;
    const zTop = col.zTop ?? (zBot + col.L);
    const xMm = col.x * 1000;
    const yMm = col.y * 1000;

    const isGroundLevel = Math.abs(zBot - minZ) < 1;
    let botRestraints: [boolean, boolean, boolean, boolean, boolean, boolean];
    if (isGroundLevel) {
      const isPinned = col.bottomEndCondition === 'P';
      botRestraints = isPinned
        ? [true, true, true, false, false, false]
        : [true, true, true, true, true, true];
    } else {
      botRestraints = [false, false, false, false, false, false];
    }

    const botId = getOrCreateNode(xMm, yMm, zBot, botRestraints);
    const topId = getOrCreateNode(xMm, yMm, zTop, [false, false, false, false, false, false]);

    colTopNodeMap.set(col.id, topId);

    // Orientation angle (beta angle): rotates the column's local Y axis
    // in the plan by the given angle CCW from Global X.
    //   0°  → local Y = Global X (b along X, h along Y)  — default
    //  90°  → local Y = Global Y (b along Y, h along X)
    // This controls which axis sees the strong vs weak moment of inertia.
    const colAngleDeg = col.orientAngle ?? 0;
    const colAngleRad = colAngleDeg * Math.PI / 180;
    const localYOverride: [number, number, number] | undefined =
      Math.abs(colAngleDeg) > 1e-4
        ? [Math.cos(colAngleRad), Math.sin(colAngleRad), 0]
        : undefined;

    elements3d.push({
      id: `col_${col.id}`,
      type: 'column',
      nodeI: botId,
      nodeJ: topId,
      b: col.b,
      h: col.h,
      E,
      G,
      wLocal: { wx: -1.2 * mat.gamma * (col.b * col.h) / 1e6, wy: 0, wz: 0 },
      stiffnessModifier: colStiffnessFactor,
      localYOverride,
    });
  }

  // ── Column rigid-zone bounding boxes for beam-endpoint snapping ────────
  // ETABS models columns as rigid bodies with their actual cross-section.
  // When a beam endpoint falls within a column's plan footprint (but is offset
  // from its centreline by ≤ b/2 or h/2), ETABS automatically connects the
  // beam to the column node via an internal rigid zone.
  // We replicate this here: before creating beam endpoint nodes we snap any
  // point that falls inside a column's axis-aligned bounding box to the
  // column's centreline, so both beams share one DOF set.
  const colRigidZones = columns
    .filter(c => !c.isRemoved)
    .map(c => {
      // Bounding-box half-extents in global X and Y, accounting for orientAngle.
      // orientAngle=0°: b along X, h along Y.  orientAngle=90°: b along Y, h along X.
      const θ = ((c.orientAngle ?? 0) * Math.PI) / 180;
      const bH = c.b / 2; // half b-dim in mm
      const hH = c.h / 2; // half h-dim in mm
      return {
        cx:    c.x * 1000,
        cy:    c.y * 1000,
        bHalfX: Math.abs(bH * Math.cos(θ)) + Math.abs(hH * Math.sin(θ)), // extent in X (mm)
        bHalfY: Math.abs(bH * Math.sin(θ)) + Math.abs(hH * Math.cos(θ)), // extent in Y (mm)
        zTop:  c.zTop ?? ((c.zBottom ?? 0) + c.L),
      };
    });

  /** Snap (xMm, yMm) to the nearest column centreline when the point is
   *  inside the column's plan footprint at elevation zMm. Returns the
   *  (possibly unchanged) coordinates. */
  const snapToColumnCenter = (xMm: number, yMm: number, zMm: number): [number, number] => {
    for (const rz of colRigidZones) {
      if (Math.abs(zMm - rz.zTop) > 100) continue;            // must be at same floor (100 mm tol)
      if (Math.abs(xMm - rz.cx) <= rz.bHalfX && Math.abs(yMm - rz.cy) <= rz.bHalfY) {
        return [rz.cx, rz.cy];                                 // snap to column centreline
      }
    }
    return [xMm, yMm];
  };

  /**
   * Get rigid end offset (mm) for a beam endpoint that has been snapped to
   * a column centreline.  Returns half the column dimension along the beam
   * axis when the user has enabled rigid end offsets for that column;
   * returns 0 otherwise.
   */
  const getBeamEndOffset = (xMm: number, yMm: number, zMm: number, isHoriz: boolean): number => {
    if (!colRigidEndOffsets) return 0;
    for (const c of columns) {
      if (c.isRemoved || !colRigidEndOffsets[c.id]) continue;
      const cx = c.x * 1000;
      const cy = c.y * 1000;
      const zTop = c.zTop ?? ((c.zBottom ?? 0) + c.L);
      if (Math.abs(zMm - zTop) > 100) continue;
      if (Math.abs(xMm - cx) < 2 && Math.abs(yMm - cy) < 2) {
        // Account for orientAngle: bounding-box half-extent in beam direction (mm)
        const θ = ((c.orientAngle ?? 0) * Math.PI) / 180;
        const bH = c.b / 2;
        const hH = c.h / 2;
        return isHoriz
          ? Math.abs(bH * Math.cos(θ)) + Math.abs(hH * Math.sin(θ))
          : Math.abs(bH * Math.sin(θ)) + Math.abs(hH * Math.cos(θ));
      }
    }
    return 0;
  };

  // ── Build beam elements ──────────────────────────────────────────────────
  // We keep track of per-element dead/live (factored UDL) for load cases.
  // Key = element id (possibly `beam_X_A` / `beam_X_B` for split elements).
  const beamDeadLoads = new Map<string, number>(); // 1.2*wD UDL (kN/m)
  const beamLiveLoads = new Map<string, number>(); // 1.6*wL UDL (kN/m)
  // Ordered per-frame list of element IDs for per-frame pattern loading.
  // Map: frameId → ordered list of elemIds in that frame
  const frameBeamElemIds = new Map<string, string[]>();
  const allBeamElemIds: string[] = [];
  const processedBeams = new Set<string>();

  for (const frame of frames) {
    const frameElemIds: string[] = [];
    for (const beamId of frame.beamIds) {
      if (processedBeams.has(beamId)) {
        // already added — just reference the element id for this frame's list
        const eid = `beam_${beamId}`;
        if (!frameElemIds.includes(eid)) frameElemIds.push(eid);
        continue;
      }
      processedBeams.add(beamId);

      const beam = beamsMap.get(beamId);
      if (!beam) continue;

      // ── UF-EQUIVALENT: pure point-based beam definition ──────────────────
      // Identical to globalFrameBridge.ts: the beam is defined by its own
      // endpoint coordinates (beam.x1/y1/x2/y2/z), NOT by its column refs.
      // Columns may or may not exist at these coords — the GlobalNodeRegistry
      // returns the SAME node id for any caller within 1mm tolerance, so the
      // beam automatically shares DOFs with the column-top node when present.
      // No `fromCol/toCol` lookup, no `if (!fromCol||!toCol) continue` skip.

      const isBoBSecondary = beamOnBeamConnections?.some(
        c => c.secondaryBeamIds.includes(beamId)
      );

      const x1Mm = beam.x1 * 1000;
      const y1Mm = beam.y1 * 1000;
      const x2Mm = beam.x2 * 1000;
      const y2Mm = beam.y2 * 1000;
      // Beam Z (already in mm). Falls back to 0 only if undefined.
      const zMm = beam.z ?? 0;

      // Apply column rigid-zone snap: if a beam endpoint falls within a
      // column's cross-sectional footprint, snap it to the column centreline
      // so the beam shares the column's DOF node (ETABS rigid-zone behaviour).
      let [sx1, sy1] = snapToColumnCenter(x1Mm, y1Mm, zMm);
      let [sx2, sy2] = snapToColumnCenter(x2Mm, y2Mm, zMm);

      // Manual joint overrides: user-specified beam→column connections.
      // Force-snaps the nearest beam endpoint to the column centreline
      // regardless of whether it falls inside the column bounding box.
      if (manualJointOverrides) {
        for (const override of manualJointOverrides) {
          if (override.beamId !== beamId) continue;
          const oc = columns.find(c => !c.isRemoved && c.id === override.columnId);
          if (!oc) continue;
          const ocx  = oc.x * 1000;
          const ocy  = oc.y * 1000;
          const ozTop = oc.zTop ?? ((oc.zBottom ?? 0) + oc.L);
          if (Math.abs(zMm - ozTop) > 200) continue;
          const d1sq = (x1Mm - ocx) ** 2 + (y1Mm - ocy) ** 2;
          const d2sq = (x2Mm - ocx) ** 2 + (y2Mm - ocy) ** 2;
          if (d1sq <= d2sq) { sx1 = ocx; sy1 = ocy; }
          else               { sx2 = ocx; sy2 = ocy; }
        }
      }
      const isHorizBeam = Math.abs(x2Mm - x1Mm) >= Math.abs(y2Mm - y1Mm);

      // Probe with NO restraints — registry OR-merges so any column-bottom
      // support at the same coord is preserved. This matches UF exactly.
      const nodeIId = getOrCreateNode(sx1, sy1, zMm, [false, false, false, false, false, false]);
      const nodeJId = getOrCreateNode(sx2, sy2, zMm, [false, false, false, false, false, false]);

      const elemId = `beam_${beamId}`;

      // End releases: keyed by beam coordinates (UF style), not column coords.
      let releases: Element3D['releases'] | undefined;
      if (frameEndReleases) {
        const posKey = `${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}_${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}`;
        const posKeyRev = `${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}_${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}`;
        const rel = frameEndReleases[posKey] || frameEndReleases[posKeyRev];
        if (rel) {
          const isReversed = !!frameEndReleases[posKeyRev] && !frameEndReleases[posKey];
          const ni = isReversed ? rel.nodeJ : rel.nodeI;
          const nj = isReversed ? rel.nodeI : rel.nodeJ;
          releases = {
            nodeI: { ux: ni.ux, uy: ni.uy, uz: ni.uz, mx: ni.rx, my: ni.ry, mz: ni.rz },
            nodeJ: { ux: nj.ux, uy: nj.uy, uz: nj.uz, mx: nj.rx, my: nj.ry, mz: nj.rz },
          };
        }
      }

      // UF-equivalent: nodeIId / nodeJId are always valid registry ids.
      // No "both ends present" guard needed — the registry guarantees a node
      // exists (or was created) for any (x,y,z) probe. The element is added
      // unconditionally, exactly as in globalFrameBridge.ts.
      const rigI = getBeamEndOffset(sx1, sy1, zMm, isHorizBeam);
      const rigJ = getBeamEndOffset(sx2, sy2, zMm, isHorizBeam);
      elements3d.push({
        id: elemId,
        type: 'beam',
        nodeI: nodeIId,
        nodeJ: nodeJId,
        b: beam.b,
        h: beam.h,
        E,
        G,
        wLocal: { wx: 0, wy: 0, wz: 0 },
        stiffnessModifier: beamStiffnessFactor,
        releases,
        ...(rigI > 0 && { rigidOffsetI: rigI }),
        ...(rigJ > 0 && { rigidOffsetJ: rigJ }),
      });
      const beamSW_init = (beam.b / 1000) * (beam.h / 1000) * mat.gamma;
      const wallLoad_init = beam.wallLoad ?? 0;
      beamDeadLoads.set(elemId, 1.2 * (beamSW_init + wallLoad_init));
      beamLiveLoads.set(elemId, 0);
      frameElemIds.push(elemId);
      allBeamElemIds.push(elemId);
    }
    frameBeamElemIds.set(frame.id, frameElemIds);
  }

  // ── Beam-on-Beam: split primary beams and reconnect secondary beams ──────
  // Map: originalBeamId → 'split' (so getFrameResults3D can merge _A/_B results)
  const primaryBeamSplitIds = new Map<string, string>(); // beamId → `${beamId}_A,${beamId}_B`

  if (beamOnBeamConnections && beamOnBeamConnections.length > 0) {
    // ── Topological multi-pass processing ──────────────────────────────────
    // ETABS handles multi-level beam-on-beam (secondary on secondary on primary)
    // correctly because all beams are in one global stiffness matrix.
    // Here we replicate that by processing connections in dependency order:
    //
    //   Pass 1: connections whose primary beam already exists in elements3d
    //           (i.e. it connects two real columns that have top-nodes)
    //   Pass 2: connections whose primary is a secondary beam added in Pass 1
    //   Pass N: repeat until all connections are processed or no progress
    //
    // This mirrors ETABS behaviour for chains like: S2 → S1 → P.
    // ──────────────────────────────────────────────────────────────────────
    const pending = [...beamOnBeamConnections];
    const MAX_PASSES = pending.length + 1;

    for (let pass = 0; pass < MAX_PASSES && pending.length > 0; pass++) {
      const toProcess: typeof pending = [];
      const toDefer:  typeof pending = [];

      for (const conn of pending) {
        const primaryBeamElemId = `beam_${conn.primaryBeamId}`;
        const exists = elements3d.some(e => e.id === primaryBeamElemId);
        (exists ? toProcess : toDefer).push(conn);
      }

      if (toProcess.length === 0) break; // no progress possible

      pending.length = 0;
      pending.push(...toDefer);

      for (const conn of toProcess) {
      const primaryBeamElemId = `beam_${conn.primaryBeamId}`;
      const primaryElemIndex = elements3d.findIndex(e => e.id === primaryBeamElemId);
      if (primaryElemIndex < 0) continue;

      const primaryElem = elements3d[primaryElemIndex];
      const nodeI = registry.getNodeById(primaryElem.nodeI);
      const nodeJ = registry.getNodeById(primaryElem.nodeJ);
      if (!nodeI || !nodeJ) continue;

      // Compute bearing point in 3D space by linear interpolation
      const totalLenMm = Math.sqrt(
        Math.pow(nodeJ.x - nodeI.x, 2) +
        Math.pow(nodeJ.y - nodeI.y, 2) +
        Math.pow(nodeJ.z - nodeI.z, 2),
      );
      // distanceOnPrimary is in meters; totalLenMm in mm
      const ratio = totalLenMm > 0 ? Math.min(Math.max((conn.distanceOnPrimary * 1000) / totalLenMm, 0.01), 0.99) : 0.5;
      const bx = nodeI.x + ratio * (nodeJ.x - nodeI.x);
      const by = nodeI.y + ratio * (nodeJ.y - nodeI.y);
      const bz = nodeI.z + ratio * (nodeJ.z - nodeI.z);

      const midNodeId = getOrCreateNode(bx, by, bz, [false, false, false, false, false, false]);

      // Sub-element A: nodeI → midNode
      const subElemA: Element3D = {
        ...primaryElem,
        id: `${primaryBeamElemId}_A`,
        nodeI: primaryElem.nodeI,
        nodeJ: midNodeId,
        releases: primaryElem.releases
          ? { ...primaryElem.releases, nodeJ: { ux: false, uy: false, uz: false, mx: false, my: false, mz: false } }
          : undefined,
      };
      // Sub-element B: midNode → nodeJ
      const subElemB: Element3D = {
        ...primaryElem,
        id: `${primaryBeamElemId}_B`,
        nodeI: midNodeId,
        nodeJ: primaryElem.nodeJ,
        releases: primaryElem.releases
          ? { ...primaryElem.releases, nodeI: { ux: false, uy: false, uz: false, mx: false, my: false, mz: false } }
          : undefined,
      };

      // Replace original element with two sub-elements
      elements3d.splice(primaryElemIndex, 1, subElemA, subElemB);

      // Distribute loads (UDL stays same — it's per unit length)
      const origDead = beamDeadLoads.get(primaryBeamElemId) ?? 0;
      const origLive = beamLiveLoads.get(primaryBeamElemId) ?? 0;
      beamDeadLoads.set(`${primaryBeamElemId}_A`, origDead);
      beamDeadLoads.set(`${primaryBeamElemId}_B`, origDead);
      beamLiveLoads.set(`${primaryBeamElemId}_A`, origLive);
      beamLiveLoads.set(`${primaryBeamElemId}_B`, origLive);
      beamDeadLoads.delete(primaryBeamElemId);
      beamLiveLoads.delete(primaryBeamElemId);

      // Update per-frame element id lists
      for (const [fid, fEids] of frameBeamElemIds) {
        const idx = fEids.indexOf(primaryBeamElemId);
        if (idx >= 0) fEids.splice(idx, 1, `${primaryBeamElemId}_A`, `${primaryBeamElemId}_B`);
        frameBeamElemIds.set(fid, fEids);
      }
      const gIdx = allBeamElemIds.indexOf(primaryBeamElemId);
      if (gIdx >= 0) allBeamElemIds.splice(gIdx, 1, `${primaryBeamElemId}_A`, `${primaryBeamElemId}_B`);

      primaryBeamSplitIds.set(conn.primaryBeamId, `${conn.primaryBeamId}_A,${conn.primaryBeamId}_B`);

      // Reconnect secondary (carried) beams to the intermediate bearing node
      for (const secBeamId of conn.secondaryBeamIds) {
        const secBeam = beamsMap.get(secBeamId);
        if (!secBeam) continue;

        const secFromCol = columns.find(c => c.id === secBeam.fromCol);
        const secToCol = columns.find(c => c.id === secBeam.toCol);

        // Determine which end connects to the removed column
        const isAtStart = secBeam.fromCol === conn.removedColumnId;
        const otherCol = isAtStart ? secToCol : secFromCol;
        if (!otherCol) continue;

        const otherNodeId = colTopNodeMap.get(otherCol.id);
        if (!otherNodeId) continue;

        const secElemId = `beam_${secBeamId}`;

        // No automatic hinge — only user-defined end releases from input tab are applied.
        // Beam-on-beam classification itself must not create releases.
        let secReleases: Element3D['releases'] | undefined;
        if (frameEndReleases) {
          const posKey = `${secBeam.x1.toFixed(3)}_${secBeam.y1.toFixed(3)}_${secBeam.x2.toFixed(3)}_${secBeam.y2.toFixed(3)}`;
          const posKeyRev = `${secBeam.x2.toFixed(3)}_${secBeam.y2.toFixed(3)}_${secBeam.x1.toFixed(3)}_${secBeam.y1.toFixed(3)}`;
          const rel = frameEndReleases[posKey] || frameEndReleases[posKeyRev];
          if (rel) {
            const isReversed = !!frameEndReleases[posKeyRev] && !frameEndReleases[posKey];
            const ni = isReversed ? rel.nodeJ : rel.nodeI;
            const nj = isReversed ? rel.nodeI : rel.nodeJ;
            secReleases = {
              nodeI: { ux: ni.ux, uy: ni.uy, uz: ni.uz, mx: ni.rx, my: ni.ry, mz: ni.rz },
              nodeJ: { ux: nj.ux, uy: nj.uy, uz: nj.uz, mx: nj.rx, my: nj.ry, mz: nj.rz },
            };
          }
        }

        const secElem: Element3D = {
          id: secElemId,
          type: 'beam',
          nodeI: isAtStart ? midNodeId : otherNodeId,
          nodeJ: isAtStart ? otherNodeId : midNodeId,
          b: secBeam.b,
          h: secBeam.h,
          E,
          G,
          wLocal: { wx: 0, wy: 0, wz: 0 },
          stiffnessModifier: beamStiffnessFactor,
          releases: secReleases,
        };

        // Add or replace secondary beam element
        const existingIdx = elements3d.findIndex(e => e.id === secElemId);
        if (existingIdx >= 0) {
          elements3d[existingIdx] = secElem;
        } else {
          elements3d.push(secElem);
        }

        // Add secondary beam loads if not already tracked
        if (!beamDeadLoads.has(secElemId)) {
          // FIX: Use beam SW + wall only (slab loads handled via profiles)
          const secSW = (secBeam.b / 1000) * (secBeam.h / 1000) * mat.gamma;
          const secWall = secBeam.wallLoad ?? 0;
          beamDeadLoads.set(secElemId, 1.2 * (secSW + secWall));
          beamLiveLoads.set(secElemId, 0);
          // Register in frames that contain this secondary beam
          for (const frame of frames) {
            if (frame.beamIds.includes(secBeamId)) {
              const fEids = frameBeamElemIds.get(frame.id) ?? [];
              if (!fEids.includes(secElemId)) {
                fEids.push(secElemId);
                frameBeamElemIds.set(frame.id, fEids);
              }
              if (!allBeamElemIds.includes(secElemId)) {
                allBeamElemIds.push(secElemId);
              }
            }
          }
        }
      }
    } // end for (const conn of toProcess) — inner loop
    } // end for (let pass) — outer topological pass loop
  } // end if (beamOnBeamConnections)

  // NOTE: Edge beam moment releases REMOVED.
  // ETABS models all beam-column connections as rigid (full moment transfer).
  // The stiffness matrix naturally distributes moments based on relative
  // stiffness — terminal beam ends get small moments because columns are
  // relatively flexible, NOT because of explicit moment releases.
  // Adding releases here made beams simply-supported → 3-6x moment overestimation.

  // Build final Node3D[] from the unified registry, applying merged restraints.
  const nodes3d: Node3D[] = registry.getAllNodes().map(n => ({
    id: n.id,
    x: n.x,
    y: n.y,
    z: n.z,
    restraints: nodeRestraints.get(n.id) ?? [false, false, false, false, false, false],
  }));
  const model: Model3D = { nodes: nodes3d, elements: elements3d };

  // ── ETABS-equivalent slab load profiles (non-uniform FEF correction) ──────
  //
  // ETABS "Membrane" (No Slab Stiffness) load distribution:
  //   Two-way slabs (β ≤ 2): 45° yield lines from corners give
  //     Long-side beams  → Trapezoidal  (0 → peak → peak → 0)   peak = w × lx/2
  //     Short-side beams → Triangular   (0 → peak → 0)           peak = w × lx/2
  //   One-way slabs (β > 2): uniform load on spanning beams = w × lx/2
  //
  // KEY IMPROVEMENT OVER OLD CODE:
  //   Interior beams (adjacent to 2+ slabs) now accumulate contributions from
  //   ALL adjacent slabs, matching ETABS superposition behaviour.
  //   Previously only beams with exactly 1 slab got a non-uniform profile.
  //
  // Applied to:
  //   • Non-split (no _A/_B suffix) beam elements
  //   • Beams with ≥ 1 adjacent slab and contact ratio > 0.1
  //   • Skip beam if ALL adjacent slabs are one-way (UDL is exact for that case)
  // ──────────────────────────────────────────────────────────────────────────

  interface ElemSlabProfile {
    /** Factored UNIFORM dead load (1.2 × [beamSW + wallLoad]) — carried via elementLoads */
    uniformDL_factored: number;
    /**
     * Service-level DL slab profile — absolute intensities (kN/m) at normalised t ∈ [0,1].
     * Sum of contributions from ALL adjacent slabs (superposition as in ETABS).
     * Factored at load-case assembly: 1.2 × wy  (dead) or  1.4 × wy / 1.2  (1.4D case).
     */
    profileDL: Array<{ t: number; wy: number }>;
    /**
     * Service-level LL slab profile — absolute intensities (kN/m) at normalised t ∈ [0,1].
     * Factored at load-case assembly: 1.6 × wy.
     */
    profileLL: Array<{ t: number; wy: number }>;
  }

  // Standard t-sample points (21 points: 0, 0.05, …, 1.0).
  // Fine enough to represent trapezoidal and triangular shapes with <0.5 % area error.
  const PROFILE_T = Array.from({ length: 21 }, (_, i) => i / 20);

  /** Linear interpolation of a piecewise-linear shape at position t. */
  const interpShape = (t: number, shape: Array<{ t: number; m: number }>): number => {
    if (shape.length === 0) return 0;
    if (t <= shape[0].t) return shape[0].m;
    if (t >= shape[shape.length - 1].t) return shape[shape.length - 1].m;
    for (let i = 0; i < shape.length - 1; i++) {
      if (t >= shape[i].t && t <= shape[i + 1].t) {
        const dt = shape[i + 1].t - shape[i].t;
        return dt < 1e-10
          ? shape[i].m
          : shape[i].m + (shape[i + 1].m - shape[i].m) * (t - shape[i].t) / dt;
      }
    }
    return 0;
  };

  const elemSlabProfiles = new Map<string, ElemSlabProfile>();

  if (slabs && slabs.length > 0 && slabProps) {
    // ── FEM-based slab load distribution (ETABS-equivalent) ────────────────
    if (useFEMLoadDistribution) {
      // BUG FIX: run computeFEMSlabProfiles PER STORY, not globally.
      // The FEM slab engine works in 2D (plan only). Passing slabs from all
      // N stories at once causes it to see N× the slab area at the same plan
      // coordinates, distributing N× too much load to every beam (the same
      // ×N bug that was fixed in the geometric-fallback path below at ~line 581).
      console.log('[3D Engine] Using FEM-based slab load distribution — per story (avoids ×N accumulation)');

      const beamsByStory = new Map<string, Beam[]>();
      const beamsNoStory: Beam[] = [];
      for (const b of beams) {
        if (b.storyId) {
          if (!beamsByStory.has(b.storyId)) beamsByStory.set(b.storyId, []);
          beamsByStory.get(b.storyId)!.push(b);
        } else {
          beamsNoStory.push(b);
        }
      }

      const applyFEMProfiles = (storyBeams: Beam[], storySlabs: Slab[]) => {
        if (storyBeams.length === 0 || storySlabs.length === 0) return;
        const storyProfiles = computeFEMSlabProfiles(storyBeams, storySlabs, slabProps!, mat, columns);
        for (const [elemId, profile] of storyProfiles) {
          if (elemId.endsWith('_A') || elemId.endsWith('_B')) continue;
          elemSlabProfiles.set(elemId, profile);
          beamDeadLoads.set(elemId, profile.uniformDL_factored);
          beamLiveLoads.set(elemId, 0);
        }
      };

      // Single-story models or beams without storyId: use only untagged slabs
      if (beamsNoStory.length > 0) {
        const noStorySlabs = slabs.filter(s => !s.storyId);
        applyFEMProfiles(beamsNoStory, noStorySlabs.length > 0 ? noStorySlabs : slabs);
      }
      // Multi-story: each story's beams get only their own story's slabs
      for (const [storyId, storyBeams] of beamsByStory) {
        const storySlabs = slabs.filter(s => !s.storyId || s.storyId === storyId);
        applyFEMProfiles(storyBeams, storySlabs);
      }

      console.log(`[3D Engine] FEM profiles applied to ${elemSlabProfiles.size} beams`);
    } else {
      // ── Voronoi slab-to-beam load transfer ────────────────────────────────
      const wDL_service = (slabProps.thickness / 1000) * mat.gamma + slabProps.finishLoad;
      const wLL_service = slabProps.liveLoad;

      // Collect beam elements (skip split halves)
      const beamElems = elements3d.filter(
        e => e.type === 'beam' && !e.id.endsWith('_A') && !e.id.endsWith('_B'),
      );

      // Group beams by story for story-accurate Voronoi computation
      const beamsByStoryV = new Map<string, typeof beamElems>();
      const beamsNoStoryV: typeof beamElems = [];
      for (const elem of beamElems) {
        const baseId = elem.id.replace(/^beam_/, '');
        const beam  = beamsMap.get(baseId);
        if (!beam) continue;
        if (beam.storyId) {
          const arr = beamsByStoryV.get(beam.storyId) ?? [];
          arr.push(elem);
          beamsByStoryV.set(beam.storyId, arr);
        } else {
          beamsNoStoryV.push(elem);
        }
      }

      const applyVoronoiProfiles = (
        storyElems: typeof beamElems,
        storySlabs: typeof slabs,
      ) => {
        // Build beam geometries for this story (for correct Voronoi regions)
        const storyBeamGeoms = storyElems.flatMap(elem => {
          const baseId = elem.id.replace(/^beam_/, '');
          const b = beamsMap.get(baseId);
          if (!b) return [];
          return [{ id: b.id, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2,
                    length: b.length, direction: b.direction }];
        });

        // Build slab geometries with polygon vertices for irregular slabs
        const storySlabGeoms = storySlabs.map(s => ({
          id: s.id, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
          vertices: s.vertices,
          deadLoad: wDL_service, liveLoad: wLL_service,
        }));

        const voronoiMap = buildVoronoiBeamLoads(
          storySlabGeoms, storyBeamGeoms, wDL_service, wLL_service, 60,
        );

        for (const elem of storyElems) {
          const baseId = elem.id.replace(/^beam_/, '');
          const beam   = beamsMap.get(baseId);
          if (!beam) continue;

          const slabTransfer = voronoiMap.get(beam.id);
          const maxLoad = Math.max(
            ...(slabTransfer?.profileDL.map(pt => pt.wy) ?? [0]),
            ...(slabTransfer?.profileLL.map(pt => pt.wy) ?? [0]),
          );
          if (maxLoad < 1e-6) continue;

          const beamSW = (beam.b / 1000) * (beam.h / 1000) * mat.gamma;
          const wallLoad = beam.wallLoad ?? 0;
          const uniformDL_factored = 1.2 * (beamSW + wallLoad);

          elemSlabProfiles.set(elem.id, {
            uniformDL_factored,
            profileDL: slabTransfer?.profileDL ?? [{ t: 0, wy: 0 }, { t: 1, wy: 0 }],
            profileLL: slabTransfer?.profileLL ?? [{ t: 0, wy: 0 }, { t: 1, wy: 0 }],
          });

          beamDeadLoads.set(elem.id, uniformDL_factored);
          beamLiveLoads.set(elem.id, 0);
        }
      };

      if (beamsNoStoryV.length > 0) {
        const noStorySlabs = slabs.filter(s => !s.storyId);
        applyVoronoiProfiles(beamsNoStoryV, noStorySlabs.length > 0 ? noStorySlabs : slabs);
      }
      for (const [storyId, storyElems] of beamsByStoryV) {
        const storySlabs = slabs.filter(s => !s.storyId || s.storyId === storyId);
        applyVoronoiProfiles(storyElems, storySlabs);
      }
    }
  }

  /**
   * Build factored profile points for one element-load-case combination.
   * DL and LL have INDEPENDENT absolute profiles (key difference from old code:
   * interior beams may have different DL/LL profile shapes when adjacent slabs
   * have asymmetric tributary widths).
   */
  const buildProfile = (
    prof: ElemSlabProfile,
    factorDL: number,
    factorLL: number,
  ): Array<{ t: number; wy: number }> => {
    return prof.profileDL.map((ptDL, i) => ({
      t: ptDL.t,
      wy: -(factorDL * ptDL.wy + factorLL * prof.profileLL[i].wy),
    }));
  };

  // ── Pattern loading cases — PER FRAME (ACI 318-19 §6.4.3) ───────────────
  // Per-frame approach: alternating live load pattern is applied independently
  // within each frame, not globally across the whole building.
  const patternCases: LoadCase3D[] = [];

  // Base: 1.4D only
  {
    const loads    = new Map<string, { wx: number; wy: number; wz: number }>();
    const profiles = new Map<string, Array<{ t: number; wy: number }>>();
    for (const eid of allBeamElemIds) {
      const wD = beamDeadLoads.get(eid) ?? 0;
      loads.set(eid, { wx: 0, wy: 0, wz: -(1.4 / 1.2) * wD });
      const prof = elemSlabProfiles.get(eid);
      if (prof) profiles.set(eid, buildProfile(prof, 1.4, 0));
    }
    patternCases.push({
      id: 'case_1.4D', name: '1.4D', type: 'dead', elementLoads: loads,
      elementLoadProfiles: profiles.size > 0 ? profiles : undefined,
    });
  }

  // Full load: 1.2D + 1.6L (all spans)
  {
    const loads    = new Map<string, { wx: number; wy: number; wz: number }>();
    const profiles = new Map<string, Array<{ t: number; wy: number }>>();
    for (const eid of allBeamElemIds) {
      const wD = beamDeadLoads.get(eid) ?? 0;
      const wL = beamLiveLoads.get(eid) ?? 0;
      loads.set(eid, { wx: 0, wy: 0, wz: -(wD + wL) });
      const prof = elemSlabProfiles.get(eid);
      if (prof) profiles.set(eid, buildProfile(prof, 1.2, 1.6));
    }
    patternCases.push({
      id: 'case_full', name: '1.2D+1.6L', type: 'dead', elementLoads: loads,
      elementLoadProfiles: profiles.size > 0 ? profiles : undefined,
    });
  }

  // ACI 318-19 §6.4.3 standard alternating patterns — exactly 2 cases (even/odd).
  // Replaces the former O(2^N) combinatorial explosion (up to 256 cases per frame).
  // Engineering justification: ACI requires checking adjacent/alternate span loading;
  // even+odd alternating covers all critical envelopes without exponential blowup.
  if (allBeamElemIds.length > 1) {
    const loadsEven    = new Map<string, { wx: number; wy: number; wz: number }>();
    const loadsOdd     = new Map<string, { wx: number; wy: number; wz: number }>();
    const profilesEven = new Map<string, Array<{ t: number; wy: number }>>();
    const profilesOdd  = new Map<string, Array<{ t: number; wy: number }>>();
    allBeamElemIds.forEach((eid, i) => {
      const wD   = beamDeadLoads.get(eid) ?? 0;
      const wL   = beamLiveLoads.get(eid) ?? 0;
      const even = i % 2 === 0;
      loadsEven.set(eid, { wx: 0, wy: 0, wz: -(wD + (even ? wL : 0)) });
      loadsOdd .set(eid, { wx: 0, wy: 0, wz: -(wD + (even ? 0 : wL)) });
      const prof = elemSlabProfiles.get(eid);
      if (prof) {
        profilesEven.set(eid, buildProfile(prof, 1.2, even ? 1.6 : 0));
        profilesOdd .set(eid, buildProfile(prof, 1.2, even ? 0 : 1.6));
      }
    });
    patternCases.push({
      id: 'case_even', name: 'ACI Even LL', type: 'dead', elementLoads: loadsEven,
      elementLoadProfiles: profilesEven.size > 0 ? profilesEven : undefined,
    });
    patternCases.push({
      id: 'case_odd', name: 'ACI Odd LL', type: 'dead', elementLoads: loadsOdd,
      elementLoadProfiles: profilesOdd.size > 0 ? profilesOdd : undefined,
    });
  }

  // ── حالة الأحمال الخدمية: 1.0D + 1.0L ─────────────────────────────────────
  // تُستخدم حصراً لتصميم الأساسات بطريقة WSM — لا تدخل في تصميم الأعمدة والجسور
  const serviceCaseIndex = patternCases.length;
  {
    const sloads    = new Map<string, { wx: number; wy: number; wz: number }>();
    const sprofiles = new Map<string, Array<{ t: number; wy: number }>>();
    for (const eid of allBeamElemIds) {
      const wD = beamDeadLoads.get(eid) ?? 0;
      const wL = beamLiveLoads.get(eid) ?? 0;
      sloads.set(eid, { wx: 0, wy: 0, wz: -(wD + wL) });
      const prof = elemSlabProfiles.get(eid);
      if (prof) sprofiles.set(eid, buildProfile(prof, 1.0, 1.0));
    }
    patternCases.push({
      id: 'case_service', name: '1.0D+1.0L', type: 'dead', elementLoads: sloads,
      elementLoadProfiles: sprofiles.size > 0 ? sprofiles : undefined,
    });
  }

  return { model, patternCases, primaryBeamSplitIds, serviceCaseIndex };
}

function runPatternEnvelope3D(
  frames: Frame[],
  beams: Beam[],
  columns: Column[],
  mat: MatProps,
  frameEndReleases?: EndReleaseMap,
  beamOnBeamConnections?: BeamOnBeamConnection[],
  slabs?: Slab[],
  slabProps?: SlabProps,
  useFEMLoadDistribution?: boolean,
  beamStiffnessFactor: number = 0.35,
  colStiffnessFactor: number = 0.65,
  colRigidEndOffsets?: Record<string, boolean>,
  manualJointOverrides?: ManualJointOverride[],
): {
  beamEnvelope: Map<string, BeamEnvelope3D>;
  colEnvelope: Map<string, ColumnEnvelope3D>;
  primaryBeamSplitIds: Map<string, string>;
  serviceColAxial: Map<string, number>;
} {
  const { model, patternCases, primaryBeamSplitIds, serviceCaseIndex } = build3DModelWithPatternLoading(
    frames, beams, columns, mat, frameEndReleases, beamOnBeamConnections,
    slabs, slabProps, useFEMLoadDistribution, beamStiffnessFactor, colStiffnessFactor,
    colRigidEndOffsets, manualJointOverrides,
  );
  const beamEnvelope = new Map<string, BeamEnvelope3D>();
  const colEnvelope  = new Map<string, ColumnEnvelope3D>();
  const serviceColAxial = new Map<string, number>();

  if (model.elements.length === 0 || patternCases.length === 0) {
    return { beamEnvelope, colEnvelope, primaryBeamSplitIds, serviceColAxial };
  }

  // Keep value with larger absolute magnitude while preserving sign
  const pickSignedMaxAbs = (current: number, incoming: number) =>
    Math.abs(incoming) > Math.abs(current) ? incoming : current;

  const mergeStationEnvelope = (current?: number[], incoming?: number[]) => {
    if (!incoming || incoming.length === 0) return current;
    if (!current || current.length !== incoming.length) return [...incoming];
    return current.map((value, index) =>
      Math.abs(incoming[index]) > Math.abs(value) ? incoming[index] : value
    );
  };

  // Use the high-performance multi-load solver:
  // K assembled ONCE, LU factorised ONCE, then O(n²) substitution per case.
  const multiResults = analyze3DFrameMultiLoad(model, patternCases, { ignoreTorsion: true });

  for (let caseIdx = 0; caseIdx < multiResults.length; caseIdx++) {
    const result = multiResults[caseIdx];
    const isServiceCase = caseIdx === serviceCaseIndex;

    for (const er of result.elements) {

      // ── حالة الخدمي: تتبع القوى المحورية فقط للأساسات — لا تدخل في غلاف التصميم ──
      if (isServiceCase) {
        if (er.elementId.startsWith('col_')) {
          const prev = serviceColAxial.get(er.elementId) ?? 0;
          serviceColAxial.set(er.elementId, Math.max(prev, er.axial));
        }
        continue; // تخطى الغلاف الإنشائي للحالة الخدمية
      }

      // ── Column envelope ──────────────────────────────────────────────────
      if (er.elementId.startsWith('col_')) {
        const prev = colEnvelope.get(er.elementId);
        if (!prev) {
          colEnvelope.set(er.elementId, {
            axialMax: er.axial,
            axialMin: er.axial,
            shearMax: Math.max(Math.abs(er.shearY), Math.abs(er.shearZ)),
            momentYI: er.momentYI,
            momentYJ: er.momentYJ,
            momentYmax: er.momentYmax,
            momentZI: er.momentZI,
            momentZJ: er.momentZJ,
            momentZmax: er.momentZmax,
          });
        } else {
          prev.axialMax = Math.max(prev.axialMax, er.axial);
          prev.axialMin = Math.min(prev.axialMin, er.axial);
          prev.shearMax = Math.max(prev.shearMax, Math.abs(er.shearY), Math.abs(er.shearZ));
          prev.momentYI   = pickSignedMaxAbs(prev.momentYI, er.momentYI);
          prev.momentYJ   = pickSignedMaxAbs(prev.momentYJ, er.momentYJ);
          prev.momentYmax = Math.max(prev.momentYmax, er.momentYmax);
          prev.momentZI   = pickSignedMaxAbs(prev.momentZI, er.momentZI);
          prev.momentZJ   = pickSignedMaxAbs(prev.momentZJ, er.momentZJ);
          prev.momentZmax = Math.max(prev.momentZmax, er.momentZmax);
        }
        continue;
      }

      // ── Beam envelope ────────────────────────────────────────────────────
      if (!er.elementId.startsWith('beam_')) continue;

      const prev = beamEnvelope.get(er.elementId);
      const signedLeft  = er.momentZI;
      const signedRight = er.momentZJ;
      if (!prev) {
        beamEnvelope.set(er.elementId, {
          shearYMax: Math.abs(er.shearY),
          shearYI: er.forceI[1],
          shearYJ: er.forceJ[1],
          momentZI: signedLeft,
          momentZJ: signedRight,
          momentZmid: Math.max(0, er.momentZmid),
          momentStations: er.momentStations ? [...er.momentStations] : undefined,
        });
      } else {
        prev.shearYMax = Math.max(prev.shearYMax, Math.abs(er.shearY));
        prev.shearYI   = pickSignedMaxAbs(prev.shearYI, er.forceI[1]);
        prev.shearYJ   = pickSignedMaxAbs(prev.shearYJ, er.forceJ[1]);
        prev.momentZI  = pickSignedMaxAbs(prev.momentZI,  signedLeft);
        prev.momentZJ  = pickSignedMaxAbs(prev.momentZJ,  signedRight);
        prev.momentZmid = Math.max(prev.momentZmid, Math.max(0, er.momentZmid));
        prev.momentStations = mergeStationEnvelope(prev.momentStations, er.momentStations);
      }
    }
  }

  return { beamEnvelope, colEnvelope, primaryBeamSplitIds, serviceColAxial };
}

/**
 * Run 3D analysis with pattern loading and return column loads for design.
 * Bug fix: stores both axialMax (compression) and axialMin (tension) envelopes.
 */
export function getColumnLoads3D(
  frames: Frame[],
  beams: Beam[],
  columns: Column[],
  mat: MatProps,
  frameEndReleases?: EndReleaseMap,
  beamOnBeamConnections?: BeamOnBeamConnection[],
  slabs?: Slab[],
  slabProps?: SlabProps,
  useFEMLoadDistribution?: boolean,
  beamStiffnessFactor: number = 0.35,
  colStiffnessFactor: number = 0.65,
  colRigidEndOffsets?: Record<string, boolean>,
  manualJointOverrides?: ManualJointOverride[],
): Map<string, ColumnLoads3D> {
  const { colEnvelope, serviceColAxial } = runPatternEnvelope3D(
    frames, beams, columns, mat, frameEndReleases, beamOnBeamConnections,
    slabs, slabProps, useFEMLoadDistribution, beamStiffnessFactor, colStiffnessFactor,
    colRigidEndOffsets, manualJointOverrides,
  );

  const result = new Map<string, ColumnLoads3D>();
  for (const col of columns) {
    if (col.isRemoved) continue;
    const env = colEnvelope.get(`col_${col.id}`);
    const P_service = serviceColAxial.get(`col_${col.id}`) ?? 0;
    if (env) {
      result.set(col.id, {
        Pu:    Math.max(env.axialMax, 0),   // design compression (≥ 0)
        PuMin: env.axialMin,                // may be negative (tension) — for PM diagram
        Mx: env.momentYmax,
        My: env.momentZmax,
        MxTop: env.momentYJ,
        MxBot: env.momentYI,
        MyTop: env.momentZJ,
        MyBot: env.momentZI,
        Vu: env.shearMax,
        P_service,
      });
    } else {
      result.set(col.id, { Pu: 0, PuMin: 0, Mx: 0, My: 0, MxTop: 0, MxBot: 0, MyTop: 0, MyBot: 0, Vu: 0, P_service: 0 });
    }
  }

  return result;
}

/**
 * Run 3D analysis and return beam internal forces grouped by frame.
 * Handles split primary beams (_A/_B) by merging their envelope into one result row.
 */
export function getFrameResults3D(
  frames: Frame[],
  beams: Beam[],
  columns: Column[],
  mat: MatProps,
  frameEndReleases?: EndReleaseMap,
  beamOnBeamConnections?: BeamOnBeamConnection[],
  slabs?: Slab[],
  slabProps?: SlabProps,
  useFEMLoadDistribution?: boolean,
  beamStiffnessFactor: number = 0.35,
  colStiffnessFactor: number = 0.65,
  /**
   * **معطَّل افتراضياً** (`false`) بناءً على طلب المستخدم: يجب أن تعرض جميع
   * المخرجات (جدول الفريمات، مقارنة ETABS، الرسوم البيانية، تبويب العرض)
   * **القيمة الفعلية الناتجة من محرك التحليل** كما هي — بدون أي "تصفير" قسري
   * عند النهايات المحررة. عند تحرير نهاية (مثلاً R3) يقوم المحرك بالفعل بتطبيق
   * static condensation داخلياً، والقيمة المتبقية (التي قد تكون سالبة صغيرة
   * أو أقرب للصفر) تمثّل التوزيع الحقيقي للعزم بعد التحرير وليست خطأ عددياً
   * يجب إخفاؤه. تُركت المعلمة موجودة فقط للتوافق الخلفي مع نداءات قديمة.
   */
  enforceReleasedZeros: boolean = false,
  colRigidEndOffsets?: Record<string, boolean>,
  manualJointOverrides?: ManualJointOverride[],
): FrameResult[] {
  const beamsMap = new Map(beams.map(b => [b.id, b]));
  const { beamEnvelope, primaryBeamSplitIds } = runPatternEnvelope3D(
    frames, beams, columns, mat, frameEndReleases, beamOnBeamConnections,
    slabs, slabProps, useFEMLoadDistribution, beamStiffnessFactor, colStiffnessFactor,
    colRigidEndOffsets, manualJointOverrides,
  );

  // ── Build release lookup from explicit input-tab releases only ─────────
  const beamReleaseLookup = new Map<string, { relI_mz: boolean; relJ_mz: boolean }>();
  if (frameEndReleases) {
    for (const beam of beams) {
      const posKey = `${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}_${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}`;
      const posKeyRev = `${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}_${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}`;
      const rel = frameEndReleases[posKey] || frameEndReleases[posKeyRev];
      if (!rel) continue;
      const isReversed = !!frameEndReleases[posKeyRev] && !frameEndReleases[posKey];
      const ni = isReversed ? rel.nodeJ : rel.nodeI;
      const nj = isReversed ? rel.nodeI : rel.nodeJ;
      beamReleaseLookup.set(beam.id, {
        relI_mz: ni.rz,
        relJ_mz: nj.rz,
      });
    }
  }

  return frames.map((frame): FrameResult => {
    const frameBeams: FrameResult['beams'] = [];

    for (const beamId of frame.beamIds) {
      const beam = beamsMap.get(beamId);
      if (!beam) continue;

      // Check whether this beam was split into _A/_B sub-elements
      const envA = beamEnvelope.get(`beam_${beamId}_A`);
      const envB = beamEnvelope.get(`beam_${beamId}_B`);
      const env  = beamEnvelope.get(`beam_${beamId}`);

      let finalEnv: BeamEnvelope3D | undefined;
      if (envA && envB) {
        finalEnv = {
          shearYMax: Math.max(envA.shearYMax, envB.shearYMax),
          shearYI:   envA.shearYI,
          shearYJ:   envB.shearYJ,
          momentZI:  envA.momentZI,
          momentZJ:  envB.momentZJ,
          momentZmid: Math.max(
            envA.momentZmid,
            envB.momentZmid,
            Math.max(0, Math.abs(envA.momentZJ)),
            Math.max(0, Math.abs(envB.momentZI)),
          ),
          momentStations: envA.momentStations && envB.momentStations
            ? [...envA.momentStations.slice(0, -1), ...envB.momentStations]
            : envA.momentStations ?? envB.momentStations,
        };
      } else {
        finalEnv = env;
      }

      // ── Enforce zero moments at released ends ──────────────────────────
      // The 3D solver already zeroes released DOF forces via static
      // condensation, but tiny numerical residuals can leak through the
      // envelope's pickSignedMaxAbs accumulation.  Explicitly clamp here
      // so that every consumer (comparison tables, charts, exports) sees
      // exact zero without needing its own hinge check.
      const rel = beamReleaseLookup.get(beamId);
      let Mleft  = finalEnv?.momentZI  ?? 0;
      let Mright = finalEnv?.momentZJ  ?? 0;
      if (rel && enforceReleasedZeros) {
        if (rel.relI_mz) Mleft  = 0;
        if (rel.relJ_mz) Mright = 0;
      }

      // Also zero station moments at released ends — only when enforcing
      let stations = finalEnv?.momentStations;
      if (stations && rel && enforceReleasedZeros) {
        if (rel.relI_mz && stations.length > 0) {
          stations = [...stations];
          stations[0] = 0;
        }
        if (rel.relJ_mz && stations.length > 0) {
          stations = stations === finalEnv?.momentStations ? [...stations] : stations;
          stations[stations.length - 1] = 0;
        }
      }

      // ── Use raw end moments directly from the 3D analysis engine ──────────
      // No face-of-column sampling or positive-moment zeroing — moments are
      // used exactly as the solver produces them.
      const Mmid_cc = finalEnv?.momentZmid ?? 0;

      frameBeams.push({
        beamId,
        span: beam.length,
        Mleft,
        Mmid:  Mmid_cc,
        Mright,
        Vu:    finalEnv?.shearYMax  ?? 0,
        Rleft: finalEnv ? Math.abs(finalEnv.shearYI) : 0,
        Rright: finalEnv ? Math.abs(finalEnv.shearYJ) : 0,
        momentStations: stations,
      });
    }

    return { frameId: frame.id, beams: frameBeams };
  });
}
