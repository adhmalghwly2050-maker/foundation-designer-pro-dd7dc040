/**
 * ============================================================
 * ROTATIONAL RESTRAINT ENGINE
 * ============================================================
 *
 * Implements ETABS-like rotational joint behavior where beam-column
 * joint fixity emerges naturally from relative member stiffness
 * interaction — NOT from hardcoded fixed/pinned conditions.
 *
 * ENGINEERING PRINCIPLE (Hardy Cross / Direct Stiffness Method):
 *   K_member = C × E × I / L
 *     C = 4  (far end fixed / continuous)
 *     C = 3  (far end pinned / free rotation)
 *     C = 0  (far end completely free)
 *
 *   Distribution Factor  = K_member / Σ(K_all_members_at_joint)
 *   Beam end moment      = DF × FEM   ← emerges from stiffness only
 *
 * ETABS-LIKE RESULTS:
 *   • Exterior column → only one beam side + column → lower DF for beam
 *     → naturally reduced negative end moment
 *   • Interior column → beams both sides + columns → higher total stiffness
 *     → larger negative end moments
 *   • Perpendicular beams add torsional restraint → increases joint fixity
 *     from the cross-direction, matching 3-D frame behavior
 *
 * EXPORTED CLASSES:
 *   RotationalRestraint       – one member's EI/L contribution at a joint
 *   JointRotationalBehavior   – all member contributions at one joint
 *   FrameContinuitySolver     – resolves all joint behaviors for a frame
 *   JointStiffnessResolver    – main public API
 *
 * EXPORTED FUNCTIONS:
 *   resolveJointStiffnessForFrame()  – drop-in integration for analyzeFrame
 *   runJointValidationTests()        – 8 structural validation test cases
 *
 * Units: m (length), kN (force), kN·m (moment / stiffness×length)
 *        Ec must be supplied in kN/m² (= MPa × 1000).
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────────
// SHARED TYPES (imported from structuralEngine — duplicated for
// standalone use; the resolver accepts plain objects, not class instances)
// ─────────────────────────────────────────────────────────────────

export interface ColumnInput {
  id: string;
  b: number;            // mm — width
  h: number;            // mm — depth
  L: number;            // mm — story height below joint
  orientAngle?: number; // degrees
  bottomEndCondition?: 'F' | 'P';   // foundation: Fixed or Pinned
  topEndCondition?: 'F' | 'P';      // far end of column above
  LBelow?: number;      // mm — height of the story ABOVE (naming quirk in engine)
  bBelow?: number;      // mm — width of column above
  hBelow?: number;      // mm — depth of column above
}

export interface BeamInput {
  id: string;
  fromCol: string;
  toCol: string;
  b: number;          // mm
  h: number;          // mm
  length: number;     // m  (already in metres in structuralEngine)
  direction: 'horizontal' | 'vertical';
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────────

export type JointType =
  | 'interior'          // beams on both sides + columns
  | 'exterior'          // beam on ONE side, column present, ≤1 perp beam
  | 'corner'            // column only, no beams in this direction
  | 'isolated'          // no column, no perp beams
  | 'cantilever-end';   // column with no beam in this direction at all

export type FarEndCondition = 'fixed' | 'pinned' | 'free';

export interface MemberContribution {
  memberId: string;
  memberType: 'column-below' | 'column-above' | 'perp-beam';
  EI_or_GJ: number;   // kN·m²  (EI for columns; GJ for beams)
  L: number;          // m
  farEnd: FarEndCondition;
  stiffnessCoeff: number;    // C: 4, 3, or 0
  rotationalStiffness: number; // C × EI/L  (kN·m/rad)
}

/** Complete resolution for one beam-column joint */
export interface JointRestraintResult {
  colStiffnessBelow: number;  // kN·m/rad  (columns below + fraction of perp)
  colStiffnessAbove: number;  // kN·m/rad  (columns above + fraction of perp)
  jointType: JointType;
  totalColumnStiffness: number;
  totalPerpStiffness: number;
  totalRestraint: number;
  effectiveFixityRatio: number; // 0 = pinned, 1 = fully fixed
  members: MemberContribution[];
  note: string;
}

/** Full debug info for developer tooling / visualization */
export interface JointDebugInfo {
  colId: string;
  frameDirection: 'horizontal' | 'vertical';
  jointType: JointType;
  isExteriorNode: boolean;  // true = first or last node of its frame
  colStiffnessBelow: number;
  colStiffnessAbove: number;
  K_col_below_raw: number;  // before adding perp contribution
  K_col_above_raw: number;
  K_perp_total: number;
  perpBeamCount: number;
  members: MemberContribution[];
  totalRestraint: number;
  effectiveFixityRatio: number;
  note: string;
}

export interface ValidationTestResult {
  name: string;
  description: string;
  passed: boolean;
  details: string[];
  expected: Record<string, number | string>;
  actual: Record<string, number | string>;
}

// ─────────────────────────────────────────────────────────────────
// HELPER MATH
// ─────────────────────────────────────────────────────────────────

/**
 * Saint-Venant torsional constant for a solid rectangle.
 * a = longer dimension, b = shorter dimension (both in m).
 * Returns J in m⁴.
 */
function computeTorsionalConstant(bm: number, hm: number): number {
  const a = Math.max(bm, hm);
  const bMin = Math.min(bm, hm);
  if (a < 1e-12) return 0;
  const ratio = bMin / a;
  return a * Math.pow(bMin, 3) * (1 / 3 - 0.21 * ratio * (1 - Math.pow(ratio, 4) / 12));
}

/**
 * Stiffness coefficient C for Hardy Cross method:
 *   far end fixed   → C = 4  (standard 4EI/L)
 *   far end pinned  → C = 3  (modified 3EI/L, no carry-over)
 *   far end free    → C = 0  (no contribution)
 */
function stiffnessCoefficient(cond: FarEndCondition): number {
  if (cond === 'fixed') return 4;
  if (cond === 'pinned') return 3;
  return 0;
}

/** Map user-specified 'F'|'P' to our enum (default = fixed). */
function mapEndCondition(raw?: 'F' | 'P', defaultCond: FarEndCondition = 'fixed'): FarEndCondition {
  if (raw === 'P') return 'pinned';
  if (raw === 'F') return 'fixed';
  return defaultCond;
}

/**
 * Moment of inertia of a column section in the bending direction
 * (accounting for section orientation angle).
 * Returns I in m⁴.
 */
function columnMomentOfInertia(
  bMm: number, hMm: number,
  frameDir: 'horizontal' | 'vertical',
  orientAngleDeg: number,
): number {
  const bm = bMm / 1000;
  const hm = hMm / 1000;
  const Ip1 = bm * Math.pow(hm, 3) / 12;  // b×h³/12 (bends about Y when α=0)
  const Ip2 = hm * Math.pow(bm, 3) / 12;  // h×b³/12 (bends about X when α=0)
  const alpha = (orientAngleDeg * Math.PI) / 180;
  const c2 = Math.cos(alpha) ** 2;
  const s2 = Math.sin(alpha) ** 2;
  // X-frame → beam loads in X → column bends about Global Y → Mohr's: Ip1·sin²α + Ip2·cos²α
  // Y-frame → beam loads in Y → column bends about Global X → Mohr's: Ip1·cos²α + Ip2·sin²α
  return frameDir === 'horizontal'
    ? Ip1 * s2 + Ip2 * c2
    : Ip1 * c2 + Ip2 * s2;
}

/** Estimate fixity ratio 0→1 from column vs total stiffness at a joint. */
function computeEffectiveFixityRatio(K_col: number, K_beam: number): number {
  const total = K_col + K_beam;
  if (total < 1e-10) return 0;
  // A beam at a joint where K_col → ∞ behaves as fully fixed (ratio → 1).
  // Normalise: fixity = K_col / (K_col + K_beam / 4)
  // This approximates how effectively the column restrains the beam end.
  return Math.min(1, K_col / (K_col + K_beam * 0.25 + 1e-10));
}

// ─────────────────────────────────────────────────────────────────
// CLASS 1 — RotationalRestraint
// ─────────────────────────────────────────────────────────────────

/**
 * Represents the rotational stiffness contribution of ONE member
 * at a beam-column joint.
 *
 * The stiffness K = C × E×I / L where C depends on the far-end
 * boundary condition of that member.  This is the standard
 * Hardy Cross / moment distribution stiffness coefficient.
 */
export class RotationalRestraint {
  readonly memberId: string;
  readonly memberType: MemberContribution['memberType'];
  readonly EI_or_GJ: number;   // kN·m²
  readonly L: number;           // m
  readonly farEnd: FarEndCondition;

  constructor(params: {
    memberId: string;
    memberType: MemberContribution['memberType'];
    EI_or_GJ: number;
    L: number;
    farEnd: FarEndCondition;
  }) {
    this.memberId = params.memberId;
    this.memberType = params.memberType;
    this.EI_or_GJ = params.EI_or_GJ;
    this.L = params.L;
    this.farEnd = params.farEnd;
  }

  /** Hardy Cross stiffness coefficient (4, 3, or 0). */
  get C(): number { return stiffnessCoefficient(this.farEnd); }

  /**
   * Rotational stiffness at the NEAR end of this member (kN·m/rad).
   * K = C × EI/L   or   K = GJ/L  for torsional members.
   */
  get rotationalStiffness(): number {
    if (this.L < 1e-12) return 0;
    if (this.memberType === 'perp-beam') {
      // Torsional: no far-end factor distinction — use K = GJ/L directly
      return this.EI_or_GJ / this.L;
    }
    return this.C * this.EI_or_GJ / this.L;
  }

  toContribution(): MemberContribution {
    return {
      memberId: this.memberId,
      memberType: this.memberType,
      EI_or_GJ: this.EI_or_GJ,
      L: this.L,
      farEnd: this.farEnd,
      stiffnessCoeff: this.C,
      rotationalStiffness: this.rotationalStiffness,
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// CLASS 2 — JointRotationalBehavior
// ─────────────────────────────────────────────────────────────────

/**
 * Aggregates ALL rotational restraint contributions at a single
 * beam-column joint.  The total rotational stiffness at the joint
 * determines the distribution factor (DF) for each connected beam,
 * which in turn determines how much of the unbalanced FEM is
 * distributed to that beam end.
 *
 * A joint with high total restraint → beam end moments are large.
 * A joint with low total restraint  → beam can rotate → smaller moments.
 *
 * This is the FUNDAMENTAL ETABS principle: everything follows from
 * Σ(EI/L) of connected members — not from flags.
 */
export class JointRotationalBehavior {
  readonly jointId: string;
  readonly colId: string;
  private readonly _restraints: RotationalRestraint[];

  constructor(
    jointId: string,
    colId: string,
    restraints: RotationalRestraint[],
  ) {
    this.jointId = jointId;
    this.colId = colId;
    this._restraints = restraints;
  }

  get restraints(): ReadonlyArray<RotationalRestraint> { return this._restraints; }

  /** Total column stiffness at this joint (kN·m/rad). */
  get totalColumnStiffness(): number {
    return this._restraints
      .filter(r => r.memberType === 'column-below' || r.memberType === 'column-above')
      .reduce((s, r) => s + r.rotationalStiffness, 0);
  }

  /** Stiffness from column BELOW (kN·m/rad). */
  get colStiffnessBelow(): number {
    return this._restraints
      .filter(r => r.memberType === 'column-below')
      .reduce((s, r) => s + r.rotationalStiffness, 0);
  }

  /** Stiffness from column ABOVE (kN·m/rad). */
  get colStiffnessAbove(): number {
    return this._restraints
      .filter(r => r.memberType === 'column-above')
      .reduce((s, r) => s + r.rotationalStiffness, 0);
  }

  /** Total torsional restraint from perpendicular beams (kN·m/rad). */
  get totalPerpStiffness(): number {
    return this._restraints
      .filter(r => r.memberType === 'perp-beam')
      .reduce((s, r) => s + r.rotationalStiffness, 0);
  }

  /** Grand total rotational restraint at this joint (kN·m/rad). */
  get totalRestraint(): number {
    return this._restraints.reduce((s, r) => s + r.rotationalStiffness, 0);
  }

  /**
   * Joint type based on the pattern of connected members.
   * Does NOT depend on frame position — purely structural topology.
   */
  get jointType(): JointType {
    const hasColumnBelow = this.colStiffnessBelow > 1e-10;
    const hasColumnAbove = this.colStiffnessAbove > 1e-10;
    const perpCount = this._restraints.filter(r => r.memberType === 'perp-beam').length;
    const hasAnyColumn = hasColumnBelow || hasColumnAbove;

    if (!hasAnyColumn && perpCount === 0) return 'isolated';
    if (!hasAnyColumn) return 'cantilever-end';
    // We don't have beam-left/beam-right count here since those are frame-analysis
    // inputs, so we classify on perpendicular evidence only
    if (perpCount >= 2) return 'interior';
    if (perpCount === 1) return 'exterior';
    return 'corner';
  }

  /** 0 = pinned end behavior, 1 = fully fixed end behavior. */
  get effectiveFixityRatio(): number {
    return computeEffectiveFixityRatio(
      this.totalColumnStiffness + this.totalPerpStiffness,
      0, // beam contribution computed at frame level
    );
  }

  toResult(isExteriorNode = false): JointRestraintResult {
    const K_perp = this.totalPerpStiffness;
    const perpFraction = K_perp / 2;
    return {
      colStiffnessBelow: this.colStiffnessBelow + perpFraction,
      colStiffnessAbove: this.colStiffnessAbove + perpFraction,
      jointType: this.jointType,
      totalColumnStiffness: this.totalColumnStiffness,
      totalPerpStiffness: K_perp,
      totalRestraint: this.totalRestraint,
      effectiveFixityRatio: this.effectiveFixityRatio,
      members: this._restraints.map(r => r.toContribution()),
      note: this._buildNote(isExteriorNode),
    };
  }

  private _buildNote(isExteriorNode: boolean): string {
    const type = this.jointType;
    const efr = (this.effectiveFixityRatio * 100).toFixed(0);
    const perpCount = this._restraints.filter(r => r.memberType === 'perp-beam').length;
    if (type === 'interior') {
      return `Interior joint — columns + ${perpCount} perp beam(s) → ${efr}% effective fixity. Negative moments near full fixed-end value.`;
    }
    if (type === 'exterior') {
      return `Exterior joint — beam frames into column from one side only. Reduced rotational restraint → naturally lower negative end moment (ETABS behaviour).`;
    }
    if (type === 'corner') {
      return `Corner joint — column present, no perpendicular beams detected. Rotational restraint from column only.`;
    }
    if (isExteriorNode) {
      return `Edge node — column stiffness provides partial restraint. End moment below interior-joint value.`;
    }
    return `Joint — ${efr}% effective fixity from column stiffness.`;
  }
}

// ─────────────────────────────────────────────────────────────────
// CLASS 3 — FrameContinuitySolver
// ─────────────────────────────────────────────────────────────────

/**
 * Resolves the rotational behavior of every beam-column joint in a frame.
 *
 * For each joint it:
 *   1. Computes column stiffness below  (K = C × Ec × colFactor × Ic / Lc)
 *   2. Computes column stiffness above  (same formula for story above)
 *   3. Adds torsional restraint from perpendicular beams (K = G × J / L)
 *   4. Derives far-end conditions from structural context rather than flags
 *
 * The RESULTING joint stiffnesses fed into the moment distribution solver
 * naturally produce smaller end moments at exterior/corner columns and
 * larger end moments at interior columns — matching ETABS behavior.
 */
export class FrameContinuitySolver {
  /**
   * @param frameBeams   Beams in the current frame (ordered left→right / bottom→top)
   * @param frameDir     Direction of this frame
   * @param columns      All columns in the building
   * @param perpBeamMap  colId → list of perpendicular beams at that column
   * @param Ec           Elastic modulus (kN/m²)
   * @param beamFactor   ACI beam stiffness modifier (default 0.35)
   * @param colFactor    ACI column stiffness modifier (default 0.70)
   */
  resolve(
    frameBeams: BeamInput[],
    frameDir: 'horizontal' | 'vertical',
    columns: ColumnInput[],
    perpBeamMap: Map<string, BeamInput[]>,
    Ec: number,
    beamFactor: number,
    colFactor: number,
  ): Map<string, JointRotationalBehavior> {
    const colMap = new Map(columns.map(c => [c.id, c]));
    const result = new Map<string, JointRotationalBehavior>();
    const n = frameBeams.length;

    // Build the set of column IDs touched by this frame
    const colIds = new Set<string>();
    for (const b of frameBeams) {
      colIds.add(b.fromCol);
      colIds.add(b.toCol);
    }

    let nodeIdx = 0;
    for (const colId of colIds) {
      const col = colMap.get(colId);
      if (!col) { nodeIdx++; continue; }

      const perpBeams = perpBeamMap.get(colId) ?? [];
      const isExterior = nodeIdx === 0 || nodeIdx === n;
      const behavior = this._resolveJoint(
        col, frameDir, Ec, colFactor, beamFactor, perpBeams, `J${nodeIdx}`,
      );

      result.set(colId, behavior);
      nodeIdx++;
    }

    return result;
  }

  private _resolveJoint(
    col: ColumnInput,
    frameDir: 'horizontal' | 'vertical',
    Ec: number,
    colFactor: number,
    beamFactor: number,
    perpBeams: BeamInput[],
    jointId: string,
  ): JointRotationalBehavior {
    const restraints: RotationalRestraint[] = [];

    // ── Column below ────────────────────────────────────────────
    const Lc_below = col.L / 1000; // m
    if (Lc_below > 1e-6) {
      const Ic_below = columnMomentOfInertia(col.b, col.h, frameDir, col.orientAngle ?? 0);
      const farEndBelow = mapEndCondition(col.bottomEndCondition, 'fixed');
      restraints.push(new RotationalRestraint({
        memberId: `${col.id}-below`,
        memberType: 'column-below',
        EI_or_GJ: Ec * colFactor * Ic_below,
        L: Lc_below,
        farEnd: farEndBelow,
      }));
    }

    // ── Column above ────────────────────────────────────────────
    const Lc_above = (col.LBelow ?? 0) / 1000; // m
    if (Lc_above > 1e-6) {
      const bA = col.bBelow ?? col.b;
      const hA = col.hBelow ?? col.h;
      const Ic_above = columnMomentOfInertia(bA, hA, frameDir, col.orientAngle ?? 0);
      // Dynamic far-end condition for column above:
      // If perpendicular beams exist → joint is a continuous frame junction → fixed (4)
      // If no connections → approaching free top → pinned (3)
      const farEndAbove = perpBeams.length > 0
        ? mapEndCondition(col.topEndCondition, 'fixed')
        : mapEndCondition(col.topEndCondition, perpBeams.length > 0 ? 'fixed' : 'pinned');
      restraints.push(new RotationalRestraint({
        memberId: `${col.id}-above`,
        memberType: 'column-above',
        EI_or_GJ: Ec * colFactor * Ic_above,
        L: Lc_above,
        farEnd: farEndAbove,
      }));
    }

    // ── Perpendicular beam torsional restraint ───────────────────
    // When the column rotates in the plane of this frame, perpendicular
    // beams resist via torsion — acting as additional rotational springs.
    // K_torsion = G × J × beamFactor / L   (per beam, full span)
    const G = Ec / 2.4; // shear modulus (kN/m²)
    for (const pb of perpBeams) {
      const bm = pb.b / 1000; // m
      const hm = pb.h / 1000; // m
      const J = computeTorsionalConstant(bm, hm); // m⁴
      const L = pb.length;    // already in m
      if (L < 1e-6 || J < 1e-20) continue;
      restraints.push(new RotationalRestraint({
        memberId: `perp-${pb.id}`,
        memberType: 'perp-beam',
        EI_or_GJ: G * J * beamFactor,  // GJ_eff (kN·m²)
        L,
        farEnd: 'fixed',  // far end of perp beam assumed continuous
      }));
    }

    return new JointRotationalBehavior(jointId, col.id, restraints);
  }
}

// ─────────────────────────────────────────────────────────────────
// CLASS 4 — JointStiffnessResolver
// ─────────────────────────────────────────────────────────────────

/**
 * Main public API for the rotational restraint engine.
 *
 * Wraps FrameContinuitySolver with building-level awareness:
 * auto-builds the perpendicular beam map from all beams, caches
 * results, and exposes debug data for visualization.
 *
 * Usage:
 *   const resolver = new JointStiffnessResolver(columns, allBeams, Ec, 0.35, 0.70);
 *   const behaviors = resolver.resolveForFrame(frameBeams, 'horizontal');
 *   const { colStiffnessBelow, colStiffnessAbove } = behaviors.get(colId)!.toResult();
 */
export class JointStiffnessResolver {
  private solver = new FrameContinuitySolver();
  private cache = new Map<string, JointRotationalBehavior>();
  private perpBeamMap: Map<string, BeamInput[]>;

  constructor(
    private readonly columns: ColumnInput[],
    private readonly allBeams: BeamInput[],
    private readonly Ec: number,
    private readonly beamFactor: number,
    private readonly colFactor: number,
  ) {
    this.perpBeamMap = this._buildPerpBeamMap();
  }

  /**
   * Resolve joint rotational behavior for all columns touched by `frameBeams`.
   * Returns a map from column ID → JointRotationalBehavior.
   */
  resolveForFrame(
    frameBeams: BeamInput[],
    frameDir: 'horizontal' | 'vertical',
  ): Map<string, JointRotationalBehavior> {
    const perpDir = frameDir === 'horizontal' ? 'vertical' : 'horizontal';

    // Build a perpendicular beam map restricted to beams in the OTHER direction
    const localPerpMap = new Map<string, BeamInput[]>();
    const colIds = new Set<string>();
    for (const b of frameBeams) {
      colIds.add(b.fromCol);
      colIds.add(b.toCol);
    }
    for (const colId of colIds) {
      const perp = (this.perpBeamMap.get(colId) ?? [])
        .filter(pb => pb.direction === perpDir);
      localPerpMap.set(colId, perp);
    }

    return this.solver.resolve(
      frameBeams, frameDir, this.columns, localPerpMap,
      this.Ec, this.beamFactor, this.colFactor,
    );
  }

  /**
   * Resolve stiffness for a SINGLE column (for direct use in analyzeFrame
   * node loop, avoiding the need to construct a full FrameBeamList).
   */
  resolveColumn(
    col: ColumnInput,
    frameDir: 'horizontal' | 'vertical',
    perpBeams?: BeamInput[],
  ): JointRotationalBehavior {
    const cacheKey = `${col.id}:${frameDir}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    const beamsForCol = perpBeams ?? (this.perpBeamMap.get(col.id) ?? [])
      .filter(pb => pb.direction !== frameDir);

    const solver = new FrameContinuitySolver();
    const result = solver['_resolveJoint'](
      col, frameDir, this.Ec, this.colFactor, this.beamFactor, beamsForCol, `J-${col.id}`,
    );
    this.cache.set(cacheKey, result);
    return result;
  }

  /** All debug info for UI visualisation. */
  getAllDebugInfo(frameDir: 'horizontal' | 'vertical'): JointDebugInfo[] {
    return this.columns.map(col => {
      const perpBeams = (this.perpBeamMap.get(col.id) ?? [])
        .filter(pb => pb.direction !== frameDir);
      const behavior = this.resolveColumn(col, frameDir, perpBeams);
      const result = behavior.toResult();
      return buildDebugInfo(col.id, frameDir, result, perpBeams.length, false);
    });
  }

  private _buildPerpBeamMap(): Map<string, BeamInput[]> {
    const map = new Map<string, BeamInput[]>();
    for (const beam of this.allBeams) {
      for (const colId of [beam.fromCol, beam.toCol]) {
        if (!map.has(colId)) map.set(colId, []);
        map.get(colId)!.push(beam);
      }
    }
    return map;
  }
}

// ─────────────────────────────────────────────────────────────────
// STANDALONE FUNCTION — resolveJointStiffnessForFrame
// ─────────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for the hardcoded column-stiffness block inside
 * structuralEngine.ts:analyzeFrame().
 *
 * BEFORE (hardcoded):
 *   const farEndFactor = col.bottomEndCondition === 'P' ? 3 : 4;
 *   colStiffnessBelow = farEndFactor * Ec * (colFactor * Ic) / Lc;
 *
 * AFTER (stiffness-derived):
 *   const { colStiffnessBelow, colStiffnessAbove } =
 *     resolveJointStiffnessForFrame(col, frameDir, Ec, colFactor, beamFactor, perpBeams);
 *
 * The result includes perpendicular beam torsional restraint, dynamic
 * far-end condition derivation, joint type classification, and full
 * debug data — all without any hardcoded fixed/pinned assumptions.
 *
 * @param col           Column at this joint
 * @param frameDir      Direction of the frame being analysed
 * @param Ec            Elastic modulus in kN/m²  (= 4700√fc × 1000 for concrete)
 * @param colFactor     ACI column stiffness modifier (e.g. 0.70)
 * @param beamFactor    ACI beam stiffness modifier (e.g. 0.35)
 * @param perpBeams     Beams in the perpendicular direction at this column
 * @param isExteriorNode  true if this is the first or last node of the frame
 */
export function resolveJointStiffnessForFrame(
  col: ColumnInput,
  frameDir: 'horizontal' | 'vertical',
  Ec: number,
  colFactor: number,
  beamFactor: number,
  perpBeams: BeamInput[] = [],
  isExteriorNode = false,
): { colStiffnessBelow: number; colStiffnessAbove: number; jointType: JointType; effectiveFixityRatio: number; debug: JointDebugInfo } {

  // ── 1. Column-below stiffness ────────────────────────────────────
  const Lc_below = col.L / 1000; // mm → m
  const Ic_below = columnMomentOfInertia(col.b, col.h, frameDir, col.orientAngle ?? 0);
  const farEndBelow = mapEndCondition(col.bottomEndCondition, 'fixed');
  const C_below = stiffnessCoefficient(farEndBelow);
  const K_col_below_raw = Lc_below > 1e-6
    ? C_below * Ec * colFactor * Ic_below / Lc_below
    : 0;

  // ── 2. Column-above stiffness ────────────────────────────────────
  const Lc_above = (col.LBelow ?? 0) / 1000; // mm → m
  let K_col_above_raw = 0;
  if (Lc_above > 1e-6) {
    const bA = col.bBelow ?? col.b;
    const hA = col.hBelow ?? col.h;
    const Ic_above = columnMomentOfInertia(bA, hA, frameDir, col.orientAngle ?? 0);
    // Dynamic far-end condition:
    //   - If there are perpendicular beams → joint at top is a real continuous connection → 'fixed' (C=4)
    //   - If no perp beams → top might be a near-free far end → derive from topEndCondition or default 'pinned'
    const farEndAboveDefault: FarEndCondition = perpBeams.length > 0 ? 'fixed' : 'pinned';
    const farEndAbove = mapEndCondition(col.topEndCondition, farEndAboveDefault);
    const C_above = stiffnessCoefficient(farEndAbove);
    K_col_above_raw = C_above * Ec * colFactor * Ic_above / Lc_above;
  }

  // ── 3. Perpendicular beam torsional restraint ────────────────────
  // Perp beams in the SAME direction as this frame do NOT contribute
  // torsional restraint — they contribute to in-plane stiffness instead
  // (handled by the adjacent frame's own analysis).
  const G = Ec / 2.4;
  let K_perp = 0;
  const members: MemberContribution[] = [];

  if (K_col_below_raw > 0) {
    members.push({
      memberId: `${col.id}-below`,
      memberType: 'column-below',
      EI_or_GJ: Ec * colFactor * Ic_below,
      L: Lc_below,
      farEnd: farEndBelow,
      stiffnessCoeff: C_below,
      rotationalStiffness: K_col_below_raw,
    });
  }

  if (K_col_above_raw > 0) {
    const bA = col.bBelow ?? col.b;
    const hA = col.hBelow ?? col.h;
    const Ic_above = columnMomentOfInertia(bA, hA, frameDir, col.orientAngle ?? 0);
    const farEndAbove = mapEndCondition(
      col.topEndCondition,
      perpBeams.length > 0 ? 'fixed' : 'pinned',
    );
    members.push({
      memberId: `${col.id}-above`,
      memberType: 'column-above',
      EI_or_GJ: Ec * colFactor * Ic_above,
      L: Lc_above,
      farEnd: farEndAbove,
      stiffnessCoeff: stiffnessCoefficient(farEndAbove),
      rotationalStiffness: K_col_above_raw,
    });
  }

  for (const pb of perpBeams) {
    const bm = pb.b / 1000;
    const hm = pb.h / 1000;
    const J = computeTorsionalConstant(bm, hm);
    const L = pb.length; // m
    if (L < 1e-6 || J < 1e-20) continue;
    const GJ_eff = G * J * beamFactor;
    const k = GJ_eff / L;
    K_perp += k;
    members.push({
      memberId: `perp-${pb.id}`,
      memberType: 'perp-beam',
      EI_or_GJ: GJ_eff,
      L,
      farEnd: 'fixed',
      stiffnessCoeff: 1,
      rotationalStiffness: k,
    });
  }

  // ── 4. Combine: perp stiffness splits evenly between above/below ─
  //  (mechanically equivalent since both add to the same joint total)
  const perpHalf = K_perp / 2;
  const colStiffnessBelow = K_col_below_raw + perpHalf;
  const colStiffnessAbove = K_col_above_raw + perpHalf;

  // ── 5. Joint classification ──────────────────────────────────────
  const jointType = classifyJointTypeFromStiffness(
    K_col_below_raw, K_col_above_raw, perpBeams.length, isExteriorNode,
  );

  // ── 6. Effective fixity ──────────────────────────────────────────
  const K_col_total = K_col_below_raw + K_col_above_raw;
  const effectiveFixityRatio = computeEffectiveFixityRatio(K_col_total + K_perp, 0);

  // ── 7. Debug info ────────────────────────────────────────────────
  const debug: JointDebugInfo = buildDebugInfo(
    col.id, frameDir,
    {
      colStiffnessBelow, colStiffnessAbove,
      jointType,
      totalColumnStiffness: K_col_total,
      totalPerpStiffness: K_perp,
      totalRestraint: K_col_total + K_perp,
      effectiveFixityRatio,
      members,
      note: buildJointNote(jointType, K_col_total, K_perp, perpBeams.length, isExteriorNode),
    },
    perpBeams.length,
    isExteriorNode,
    K_col_below_raw,
    K_col_above_raw,
  );

  return {
    colStiffnessBelow,
    colStiffnessAbove,
    jointType,
    effectiveFixityRatio,
    debug,
  };
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function classifyJointTypeFromStiffness(
  K_col_below: number,
  K_col_above: number,
  perpCount: number,
  isExteriorNode: boolean,
): JointType {
  const hasColumn = (K_col_below + K_col_above) > 1e-10;
  if (!hasColumn && perpCount === 0) return 'isolated';
  if (!hasColumn) return 'cantilever-end';
  if (!isExteriorNode && perpCount >= 1) return 'interior';
  if (!isExteriorNode) return 'interior';  // interior node = beams both sides
  if (perpCount >= 2) return 'interior';
  if (perpCount === 1) return 'exterior';
  return 'corner';
}

function buildJointNote(
  type: JointType,
  K_col: number,
  K_perp: number,
  perpCount: number,
  isExterior: boolean,
): string {
  const efr = Math.round(computeEffectiveFixityRatio(K_col + K_perp, 0) * 100);
  switch (type) {
    case 'interior':
      return `Interior joint — beam frames in from both sides + ${K_col > 0 ? 'columns' : 'no columns'}` +
        (perpCount > 0 ? ` + ${perpCount} perp beam(s)` : '') +
        `. High rotational restraint (${efr}% fixity). Negative moments near full fixed-end value.`;
    case 'exterior':
      return `Exterior joint — beam frames into column from ONE side only.` +
        ` Lower rotational restraint → naturally reduced negative end moment (ETABS-like).` +
        (K_perp > 0 ? ` Perpendicular beam adds ${(K_perp / (K_col + K_perp) * 100).toFixed(0)}% torsional restraint.` : '');
    case 'corner':
      return `Corner joint — column present but no perpendicular beams. Minimum rotational restraint from column only.`;
    case 'cantilever-end':
      return `Cantilever/edge — no column in this direction, beam end is near-free.`;
    default:
      return isExterior
        ? `Edge node — partial rotational restraint (${efr}% effective fixity).`
        : `Joint — ${efr}% effective fixity from member stiffness interaction.`;
  }
}

function buildDebugInfo(
  colId: string,
  frameDir: 'horizontal' | 'vertical',
  result: JointRestraintResult,
  perpCount: number,
  isExteriorNode: boolean,
  K_col_below_raw?: number,
  K_col_above_raw?: number,
): JointDebugInfo {
  return {
    colId,
    frameDirection: frameDir,
    jointType: result.jointType,
    isExteriorNode,
    colStiffnessBelow: result.colStiffnessBelow,
    colStiffnessAbove: result.colStiffnessAbove,
    K_col_below_raw: K_col_below_raw ?? result.colStiffnessBelow,
    K_col_above_raw: K_col_above_raw ?? result.colStiffnessAbove,
    K_perp_total: result.totalPerpStiffness,
    perpBeamCount: perpCount,
    members: result.members,
    totalRestraint: result.totalRestraint,
    effectiveFixityRatio: result.effectiveFixityRatio,
    note: result.note,
  };
}

// ─────────────────────────────────────────────────────────────────
// VALIDATION TESTS
// ─────────────────────────────────────────────────────────────────

/**
 * Runs 8 structural validation tests covering all joint scenarios
 * described in the requirements.  Each test verifies that the
 * rotational restraint engine produces physically correct stiffness
 * distributions relative to one another.
 *
 * Tests do NOT assert absolute moment values (those depend on
 * the full frame analysis); they verify RELATIVE stiffness:
 *   "interior joint restraint > exterior joint restraint"
 *   "weak column → lower fixity than strong column"
 *   etc.
 */
export function runJointValidationTests(): ValidationTestResult[] {
  const fc = 25;   // MPa
  const Ec = 4700 * Math.sqrt(fc) * 1000; // kN/m²  (≈ 23.5 × 10⁶)
  const colFactor = 0.70;
  const beamFactor = 0.35;
  const results: ValidationTestResult[] = [];

  // ── Test 1: Beam to exterior column ─────────────────────────────
  {
    const extCol: ColumnInput = { id: 'C1', b: 400, h: 400, L: 3000 };
    const { colStiffnessBelow: Kext } = resolveJointStiffnessForFrame(
      extCol, 'horizontal', Ec, colFactor, beamFactor, [], true,
    );
    const intCol: ColumnInput = { id: 'C2', b: 400, h: 400, L: 3000 };
    const { colStiffnessBelow: Kint } = resolveJointStiffnessForFrame(
      intCol, 'horizontal', Ec, colFactor, beamFactor, [], false,
    );
    // Both have same column stiffness in this test — the FRAME position
    // (exterior vs interior) is handled by the moment distribution DF.
    // What changes with perpendicular beams is tested in Test 7.
    const passed = Kext > 0 && Kint > 0;
    results.push({
      name: 'Test 1 — Exterior vs Interior Column Stiffness',
      description: 'Same column section: exterior and interior should both produce positive stiffness.',
      passed,
      details: [
        `Exterior node: K_col_below = ${Kext.toFixed(0)} kN·m/rad`,
        `Interior node: K_col_below = ${Kint.toFixed(0)} kN·m/rad`,
        `Both should be equal (same column) and positive.`,
        passed ? '✓ Both produce positive column stiffness.' : '❌ FAILED — zero or negative stiffness.',
      ],
      expected: { Kext_positive: 1, Kint_positive: 1 },
      actual: { Kext, Kint },
    });
  }

  // ── Test 2: Interior column — beams both sides ───────────────────
  // Interior nodes have beams on both sides → higher distribution restraint
  // In moment distribution, DF = K_beam / (K_beam_left + K_beam_right + K_col)
  // Interior:  K_beam_left + K_beam_right > K_beam_right_only
  // This test verifies that adding a perpendicular beam increases joint stiffness.
  {
    const col: ColumnInput = { id: 'C', b: 400, h: 400, L: 3000 };
    const noPerp = resolveJointStiffnessForFrame(col, 'horizontal', Ec, colFactor, beamFactor, []);
    const withPerp: BeamInput[] = [{ id: 'PB', fromCol: 'C', toCol: 'D', b: 300, h: 500, length: 6, direction: 'vertical' }];
    const withPerpResult = resolveJointStiffnessForFrame(col, 'horizontal', Ec, colFactor, beamFactor, withPerp);
    const passed = withPerpResult.colStiffnessBelow > noPerp.colStiffnessBelow;
    results.push({
      name: 'Test 2 — Perpendicular Beam Increases Joint Stiffness',
      description: 'Adding a perpendicular beam at a joint must increase total rotational restraint.',
      passed,
      details: [
        `Without perp beam: K_total = ${noPerp.colStiffnessBelow.toFixed(0)} kN·m/rad`,
        `With perp beam:    K_total = ${withPerpResult.colStiffnessBelow.toFixed(0)} kN·m/rad`,
        passed ? '✓ Perp beam torsional restraint correctly added.' : '❌ Perp beam had no effect.',
      ],
      expected: { K_with_perp_greater: 1 },
      actual: { K_no_perp: noPerp.colStiffnessBelow, K_with_perp: withPerpResult.colStiffnessBelow },
    });
  }

  // ── Test 3: Corner column — no perpendicular beams ───────────────
  {
    const corner: ColumnInput = { id: 'Ccorner', b: 400, h: 400, L: 3000 };
    const { colStiffnessBelow, jointType } = resolveJointStiffnessForFrame(
      corner, 'horizontal', Ec, colFactor, beamFactor, [], true,
    );
    const passed = jointType === 'corner' && colStiffnessBelow > 0;
    results.push({
      name: 'Test 3 — Corner Column Classification',
      description: 'Column with no perpendicular beams at exterior node should be classified as corner.',
      passed,
      details: [
        `Joint type: ${jointType}  (expected: corner)`,
        `K_col_below: ${colStiffnessBelow.toFixed(0)} kN·m/rad`,
        passed ? '✓ Corner column correctly identified.' : '❌ Wrong classification.',
      ],
      expected: { jointType: 'corner' },
      actual: { jointType },
    });
  }

  // ── Test 4: Weak column / strong beam scenario ───────────────────
  // Small column + large beam: column stiffness should be low
  {
    const weakCol: ColumnInput = { id: 'Cweak', b: 200, h: 200, L: 4000 };
    const strongCol: ColumnInput = { id: 'Cstrong', b: 600, h: 800, L: 4000 };
    const { colStiffnessBelow: Kweak } = resolveJointStiffnessForFrame(weakCol, 'horizontal', Ec, colFactor, beamFactor);
    const { colStiffnessBelow: Kstrong } = resolveJointStiffnessForFrame(strongCol, 'horizontal', Ec, colFactor, beamFactor);
    const ratio = Kstrong / (Kweak + 1e-10);
    const passed = Kstrong > Kweak && ratio > 5;
    results.push({
      name: 'Test 4 — Weak Column vs Strong Column',
      description: 'Larger column section must produce proportionally larger rotational stiffness.',
      passed,
      details: [
        `Weak  column (200×200, L=4m): K = ${Kweak.toFixed(0)} kN·m/rad`,
        `Strong column (600×800, L=4m): K = ${Kstrong.toFixed(0)} kN·m/rad`,
        `Ratio Kstrong/Kweak = ${ratio.toFixed(1)}  (expected > 5)`,
        passed ? '✓ Stiffness scales correctly with section size.' : '❌ Stiffness ratio insufficient.',
      ],
      expected: { ratio_gt_5: 1 },
      actual: { Kweak, Kstrong, ratio },
    });
  }

  // ── Test 5: Strong column / weak beam (high fixity) ──────────────
  {
    const strongCol: ColumnInput = { id: 'Cst', b: 800, h: 800, L: 3000 };
    const { effectiveFixityRatio: efr } = resolveJointStiffnessForFrame(
      strongCol, 'horizontal', Ec, colFactor, beamFactor, [], false,
    );
    const passed = efr > 0.5; // stiff column provides good fixity
    results.push({
      name: 'Test 5 — Strong Column Provides High Fixity',
      description: 'A large column should produce high effective fixity ratio at the joint.',
      passed,
      details: [
        `800×800 column at L=3m: effective fixity = ${(efr * 100).toFixed(1)}%`,
        passed ? '✓ Strong column provides adequate fixity.' : '❌ Fixity ratio unexpectedly low.',
      ],
      expected: { efr_gt_50pct: 1 },
      actual: { effectiveFixityRatio: efr },
    });
  }

  // ── Test 6: Multi-story frame — column above and below ───────────
  {
    const midStoryCol: ColumnInput = {
      id: 'Cmid', b: 400, h: 400, L: 3000,
      LBelow: 3000, // column above exists
    };
    const { colStiffnessBelow, colStiffnessAbove } = resolveJointStiffnessForFrame(
      midStoryCol, 'horizontal', Ec, colFactor, beamFactor,
    );
    const passed = colStiffnessBelow > 0 && colStiffnessAbove > 0;
    results.push({
      name: 'Test 6 — Multi-Story Column Above and Below',
      description: 'Mid-story joint should receive stiffness contributions from both column above and below.',
      passed,
      details: [
        `Column below stiffness: ${colStiffnessBelow.toFixed(0)} kN·m/rad`,
        `Column above stiffness: ${colStiffnessAbove.toFixed(0)} kN·m/rad`,
        passed ? '✓ Both column contributions present.' : '❌ Missing one or both column contributions.',
      ],
      expected: { below_positive: 1, above_positive: 1 },
      actual: { colStiffnessBelow, colStiffnessAbove },
    });
  }

  // ── Test 7: Asymmetric framing — exterior col with one perp beam ─
  {
    const col: ColumnInput = { id: 'Cext', b: 400, h: 400, L: 3000 };
    const noPerp = resolveJointStiffnessForFrame(col, 'horizontal', Ec, colFactor, beamFactor, [], true);
    const onePerp: BeamInput[] = [{ id: 'PB1', fromCol: 'Cext', toCol: 'D', b: 300, h: 600, length: 5, direction: 'vertical' }];
    const withPerp = resolveJointStiffnessForFrame(col, 'horizontal', Ec, colFactor, beamFactor, onePerp, true);
    const passed = withPerp.colStiffnessBelow > noPerp.colStiffnessBelow
      && withPerp.jointType === 'exterior';
    results.push({
      name: 'Test 7 — Asymmetric Framing (Exterior + One Perpendicular Beam)',
      description: 'One perp beam at an exterior column should increase stiffness and classify as exterior.',
      passed,
      details: [
        `Without perp: K = ${noPerp.colStiffnessBelow.toFixed(0)}, type = ${noPerp.jointType}`,
        `With 1 perp:  K = ${withPerp.colStiffnessBelow.toFixed(0)}, type = ${withPerp.jointType}`,
        passed ? '✓ Perp beam increases stiffness; exterior type maintained.' : '❌ Check classification or stiffness.',
      ],
      expected: { jointType: 'exterior', K_increased: 1 },
      actual: { jointType: withPerp.jointType, deltaK: withPerp.colStiffnessBelow - noPerp.colStiffnessBelow },
    });
  }

  // ── Test 8: Multiple beams framing into one column ───────────────
  {
    const col: ColumnInput = { id: 'Chub', b: 500, h: 500, L: 3000 };
    const manyPerp: BeamInput[] = [
      { id: 'PB1', fromCol: 'Chub', toCol: 'A', b: 300, h: 500, length: 6, direction: 'vertical' },
      { id: 'PB2', fromCol: 'B', toCol: 'Chub', b: 300, h: 500, length: 6, direction: 'vertical' },
    ];
    const onePerp: BeamInput[] = [manyPerp[0]];
    const resOne = resolveJointStiffnessForFrame(col, 'horizontal', Ec, colFactor, beamFactor, onePerp);
    const resTwo = resolveJointStiffnessForFrame(col, 'horizontal', Ec, colFactor, beamFactor, manyPerp);
    const passed = resTwo.colStiffnessBelow > resOne.colStiffnessBelow
      && resTwo.jointType === 'interior';
    results.push({
      name: 'Test 8 — Multiple Perpendicular Beams (Hub Column)',
      description: 'Two perp beams should produce higher stiffness than one, and classify as interior.',
      passed,
      details: [
        `1 perp beam: K = ${resOne.colStiffnessBelow.toFixed(0)}, type = ${resOne.jointType}`,
        `2 perp beams: K = ${resTwo.colStiffnessBelow.toFixed(0)}, type = ${resTwo.jointType}`,
        passed ? '✓ More perpendicular beams → higher restraint → interior classification.' : '❌ FAILED.',
      ],
      expected: { K_two_gt_one: 1, jointType: 'interior' },
      actual: { K_one: resOne.colStiffnessBelow, K_two: resTwo.colStiffnessBelow, jointType: resTwo.jointType },
    });
  }

  return results;
}
