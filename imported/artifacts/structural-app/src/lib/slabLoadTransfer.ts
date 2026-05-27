export interface PlanarSlabGeometry {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** نقاط مضلع البلاطة غير المستطيلة */
  vertices?: { x: number; y: number }[];
  storyId?: string;
  deadLoad?: number;
  liveLoad?: number;
}

/** مساحة مضلع بالصيغة المتقاطعة (Shoelace formula) */
function polygonArea(vertices: { x: number; y: number }[]): number {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

export interface PlanarBeamGeometry {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  direction?: 'horizontal' | 'vertical';
  storyId?: string;
}

export interface LineLoadPoint {
  t: number;
  wy: number;
}

export interface SlabEdgeLoad {
  slabId: string;
  direction: 'horizontal' | 'vertical';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  profileDL: LineLoadPoint[];
  profileLL: LineLoadPoint[];
}

export interface BeamLineLoadProfile {
  beamId: string;
  profileDL: LineLoadPoint[];
  profileLL: LineLoadPoint[];
  equivalentDL: number;
  equivalentLL: number;
  connectedSlabIds: string[];
}

const EPS = 1e-6;
export const DEFAULT_PROFILE_T = Array.from({ length: 21 }, (_, i) => i / 20);

const sortRange = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

const inferDirection = (beam: PlanarBeamGeometry): 'horizontal' | 'vertical' | null => {
  if (beam.direction) return beam.direction;
  if (Math.abs(beam.y2 - beam.y1) < EPS) return 'horizontal';
  if (Math.abs(beam.x2 - beam.x1) < EPS) return 'vertical';
  return null;
};

const evaluateProfile = (profile: LineLoadPoint[], t: number): number => {
  if (profile.length === 0) return 0;
  if (t <= profile[0].t) return profile[0].wy;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (t <= b.t + EPS) {
      const dt = b.t - a.t;
      if (dt < EPS) return b.wy;
      const r = (t - a.t) / dt;
      return a.wy + (b.wy - a.wy) * r;
    }
  }
  return profile[profile.length - 1].wy;
};

const buildEdgeProfile = (peak: number, isLongSide: boolean, beta: number, lx: number, ly: number): LineLoadPoint[] => {
  if (peak < EPS) return [];

  if (beta > 2) {
    return isLongSide
      ? [{ t: 0, wy: peak }, { t: 1, wy: peak }]
      : [];
  }

  if (isLongSide) {
    const a = Math.min(lx / (2 * ly), 0.499999);
    return [
      { t: 0, wy: 0 },
      { t: a, wy: peak },
      { t: 1 - a, wy: peak },
      { t: 1, wy: 0 },
    ];
  }

  return [
    { t: 0, wy: 0 },
    { t: 0.5, wy: peak },
    { t: 1, wy: 0 },
  ];
};

export function buildSlabEdgeLoads(
  slabs: PlanarSlabGeometry[],
  defaultDeadLoad: number = 0,
  defaultLiveLoad: number = 0,
): SlabEdgeLoad[] {
  const edgeLoads: SlabEdgeLoad[] = [];

  for (const slab of slabs) {
    // للبلاطات المضلعة: احسب الـ bounding box من النقاط، وصحّح الأحمال بنسبة مساحة المضلع
    let minX: number, maxX: number, minY: number, maxY: number;
    let areaFactor = 1.0;

    if (slab.vertices && slab.vertices.length >= 3) {
      minX = Math.min(...slab.vertices.map(v => v.x));
      maxX = Math.max(...slab.vertices.map(v => v.x));
      minY = Math.min(...slab.vertices.map(v => v.y));
      maxY = Math.max(...slab.vertices.map(v => v.y));
      const bboxArea = (maxX - minX) * (maxY - minY);
      const polyArea = polygonArea(slab.vertices);
      areaFactor = bboxArea > EPS ? Math.min(polyArea / bboxArea, 1.0) : 1.0;
    } else {
      [minX, maxX] = sortRange(slab.x1, slab.x2);
      [minY, maxY] = sortRange(slab.y1, slab.y2);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    if (width < EPS || height < EPS) continue;

    const lx = Math.min(width, height);
    const ly = Math.max(width, height);
    const beta = ly / lx;
    const wDL = slab.deadLoad ?? defaultDeadLoad;
    const wLL = slab.liveLoad ?? defaultLiveLoad;
    const peakDL = wDL * (lx / 2) * areaFactor;
    const peakLL = wLL * (lx / 2) * areaFactor;

    const edges = [
      { direction: 'horizontal' as const, x1: minX, y1: minY, x2: maxX, y2: minY, isLongSide: width >= ly - EPS },
      { direction: 'horizontal' as const, x1: minX, y1: maxY, x2: maxX, y2: maxY, isLongSide: width >= ly - EPS },
      { direction: 'vertical' as const, x1: minX, y1: minY, x2: minX, y2: maxY, isLongSide: height >= ly - EPS },
      { direction: 'vertical' as const, x1: maxX, y1: minY, x2: maxX, y2: maxY, isLongSide: height >= ly - EPS },
    ];

    for (const edge of edges) {
      const profileDL = buildEdgeProfile(peakDL, edge.isLongSide, beta, lx, ly);
      const profileLL = buildEdgeProfile(peakLL, edge.isLongSide, beta, lx, ly);
      if (profileDL.length === 0 && profileLL.length === 0) continue;

      edgeLoads.push({
        slabId: slab.id,
        direction: edge.direction,
        x1: edge.x1,
        y1: edge.y1,
        x2: edge.x2,
        y2: edge.y2,
        profileDL,
        profileLL,
      });
    }
  }

  return edgeLoads;
}

export function computeLineProfileStats(profile: LineLoadPoint[]): { area: number; average: number; centroidT: number } {
  if (profile.length === 0) return { area: 0, average: 0, centroidT: 0.5 };
  if (profile.length === 1) return { area: profile[0].wy, average: profile[0].wy, centroidT: 0.5 };

  let area = 0;
  let firstMoment = 0;

  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const dt = b.t - a.t;
    if (dt < EPS) continue;

    const segArea = ((a.wy + b.wy) * dt) / 2;
    if (Math.abs(segArea) < EPS) continue;

    const centroidLocal = Math.abs(a.wy + b.wy) < EPS
      ? dt / 2
      : (dt * (a.wy + 2 * b.wy)) / (3 * (a.wy + b.wy));

    area += segArea;
    firstMoment += segArea * (a.t + centroidLocal);
  }

  if (Math.abs(area) < EPS) return { area: 0, average: 0, centroidT: 0.5 };
  return {
    area,
    average: area,
    centroidT: firstMoment / area,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSITE SLAB MERGING
// Adjacent slabs that share an edge with NO beam between them must be treated
// as a single slab for load-distribution purposes.  Failing to do so causes
// two kinds of error:
//   1. β (aspect ratio) is computed for each sub-slab independently, which
//      can flip a one-way slab into a two-way slab or vice-versa.
//   2. The load destined for the shared (unsupported) edge is silently lost.
// The fix: union-find adjacent slabs → bounding-rectangle composite → compute
// β and edge profiles from the composite dimensions only.
// ═══════════════════════════════════════════════════════════════════════════

/** True when a beam segment is collinear with and overlaps the axis-aligned edge (ex1,ey1)→(ex2,ey2). */
function hasBeamOnEdge(
  ex1: number, ey1: number, ex2: number, ey2: number,
  beams: PlanarBeamGeometry[],
): boolean {
  const isHoriz = Math.abs(ey2 - ey1) < EPS;
  const isVert  = Math.abs(ex2 - ex1) < EPS;
  if (!isHoriz && !isVert) return false;

  for (const b of beams) {
    const dir = inferDirection(b);
    if (isHoriz && dir !== 'horizontal') continue;
    if (isVert  && dir !== 'vertical')   continue;
    if (isHoriz) {
      if (Math.abs(b.y1 - ey1) > EPS) continue;
      const [bs, be_] = sortRange(b.x1, b.x2);
      const [es, ee]  = sortRange(ex1, ex2);
      if (bs <= ee + EPS && be_ >= es - EPS) return true;
    } else {
      if (Math.abs(b.x1 - ex1) > EPS) continue;
      const [bs, be_] = sortRange(b.y1, b.y2);
      const [es, ee]  = sortRange(ey1, ey2);
      if (bs <= ee + EPS && be_ >= es - EPS) return true;
    }
  }
  return false;
}

/**
 * True when slabs a and b share at least one common edge segment that has no beam.
 * Two slabs share a free edge when their boundaries touch AND no beam covers that contact.
 */
function slabsShareFreeEdge(
  a: PlanarSlabGeometry,
  b: PlanarSlabGeometry,
  beams: PlanarBeamGeometry[],
): boolean {
  const [ax1, ax2] = sortRange(a.x1, a.x2);
  const [ay1, ay2] = sortRange(a.y1, a.y2);
  const [bx1, bx2] = sortRange(b.x1, b.x2);
  const [by1, by2] = sortRange(b.y1, b.y2);

  // ── vertical shared boundary ──
  const yLo = Math.max(ay1, by1);
  const yHi = Math.min(ay2, by2);
  if (yHi - yLo > EPS) {
    if (Math.abs(ax2 - bx1) < EPS && !hasBeamOnEdge(ax2, yLo, ax2, yHi, beams)) return true;
    if (Math.abs(ax1 - bx2) < EPS && !hasBeamOnEdge(ax1, yLo, ax1, yHi, beams)) return true;
  }

  // ── horizontal shared boundary ──
  const xLo = Math.max(ax1, bx1);
  const xHi = Math.min(ax2, bx2);
  if (xHi - xLo > EPS) {
    if (Math.abs(ay2 - by1) < EPS && !hasBeamOnEdge(xLo, ay2, xHi, ay2, beams)) return true;
    if (Math.abs(ay1 - by2) < EPS && !hasBeamOnEdge(xLo, ay1, xHi, ay1, beams)) return true;
  }

  return false;
}

export interface SlabMergeGroup {
  /** Effective composite slab rectangle used for β-calculation and edge-load generation */
  compositeRect: PlanarSlabGeometry;
  /** IDs of the original sub-slabs that make up this group */
  subSlabIds: string[];
}

/**
 * Groups adjacent rectangular slabs that share a free edge (no beam between them)
 * into composite slabs.  The composite bounding-rectangle drives β and the
 * tributary-load profiles, so a 2 m × 4 m slab that was input as two 2 m × 2 m
 * panels will still be correctly recognised as a one-way slab (β = 2), not two
 * independent two-way slabs (β = 1).
 *
 * Uses union-find for O(n²) adjacency detection.
 */
export function buildMergedSlabGroups(
  slabs: PlanarSlabGeometry[],
  beams: PlanarBeamGeometry[],
): SlabMergeGroup[] {
  const n = slabs.length;
  if (n === 0) return [];

  // Union-Find
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (i: number, j: number) => { parent[find(i)] = find(j); };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (slabsShareFreeEdge(slabs[i], slabs[j], beams)) union(i, j);
    }
  }

  // Collect connected components
  const groupMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const arr = groupMap.get(root) ?? [];
    arr.push(i);
    groupMap.set(root, arr);
  }

  const groups: SlabMergeGroup[] = [];
  for (const indices of groupMap.values()) {
    const gs = indices.map(i => slabs[i]);

    // Bounding rectangle of composite
    const x1 = Math.min(...gs.map(s => Math.min(s.x1, s.x2)));
    const x2 = Math.max(...gs.map(s => Math.max(s.x1, s.x2)));
    const y1 = Math.min(...gs.map(s => Math.min(s.y1, s.y2)));
    const y2 = Math.max(...gs.map(s => Math.max(s.y1, s.y2)));

    // Area-weighted average loads
    let totalArea = 0, sumDL = 0, sumLL = 0;
    for (const s of gs) {
      const a = Math.abs(s.x2 - s.x1) * Math.abs(s.y2 - s.y1);
      totalArea += a;
      sumDL += (s.deadLoad ?? 0) * a;
      sumLL += (s.liveLoad ?? 0) * a;
    }

    groups.push({
      compositeRect: {
        id: gs.map(s => s.id).join('+'),
        x1, y1, x2, y2,
        deadLoad: totalArea > 0 ? sumDL / totalArea : 0,
        liveLoad: totalArea > 0 ? sumLL / totalArea : 0,
        storyId: gs[0].storyId,
      },
      subSlabIds: gs.map(s => s.id),
    });
  }

  return groups;
}

export function computeBeamLoadProfile(
  beam: PlanarBeamGeometry,
  slabEdgeLoads: SlabEdgeLoad[],
  samplePoints: number[] = DEFAULT_PROFILE_T,
): BeamLineLoadProfile {
  const direction = inferDirection(beam);
  if (!direction || samplePoints.length === 0) {
    return {
      beamId: beam.id,
      profileDL: samplePoints.map(t => ({ t, wy: 0 })),
      profileLL: samplePoints.map(t => ({ t, wy: 0 })),
      equivalentDL: 0,
      equivalentLL: 0,
      connectedSlabIds: [],
    };
  }

  const connectedSlabIds = new Set<string>();
  const profileDL: LineLoadPoint[] = [];
  const profileLL: LineLoadPoint[] = [];

  for (const t of samplePoints) {
    const x = beam.x1 + (beam.x2 - beam.x1) * t;
    const y = beam.y1 + (beam.y2 - beam.y1) * t;
    let wyDL = 0;
    let wyLL = 0;

    for (const edge of slabEdgeLoads) {
      if (beam.storyId && edge.slabId && false) {
      }
      if (edge.direction !== direction) continue;

      if (direction === 'horizontal') {
        if (Math.abs(y - edge.y1) > EPS) continue;
        const [edgeStart, edgeEnd] = sortRange(edge.x1, edge.x2);
        if (x < edgeStart - EPS || x > edgeEnd + EPS) continue;
        const edgeT = edgeEnd - edgeStart < EPS ? 0 : (x - edgeStart) / (edgeEnd - edgeStart);
        wyDL += evaluateProfile(edge.profileDL, edgeT);
        wyLL += evaluateProfile(edge.profileLL, edgeT);
      } else {
        if (Math.abs(x - edge.x1) > EPS) continue;
        const [edgeStart, edgeEnd] = sortRange(edge.y1, edge.y2);
        if (y < edgeStart - EPS || y > edgeEnd + EPS) continue;
        const edgeT = edgeEnd - edgeStart < EPS ? 0 : (y - edgeStart) / (edgeEnd - edgeStart);
        wyDL += evaluateProfile(edge.profileDL, edgeT);
        wyLL += evaluateProfile(edge.profileLL, edgeT);
      }

      connectedSlabIds.add(edge.slabId);
    }

    profileDL.push({ t, wy: wyDL });
    profileLL.push({ t, wy: wyLL });
  }

  const dlStats = computeLineProfileStats(profileDL);
  const llStats = computeLineProfileStats(profileLL);

  return {
    beamId: beam.id,
    profileDL,
    profileLL,
    equivalentDL: dlStats.average,
    equivalentLL: llStats.average,
    connectedSlabIds: Array.from(connectedSlabIds),
  };
}
