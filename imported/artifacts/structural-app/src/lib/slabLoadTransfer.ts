export interface PlanarSlabGeometry {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  storyId?: string;
  deadLoad?: number;
  liveLoad?: number;
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
    const [minX, maxX] = sortRange(slab.x1, slab.x2);
    const [minY, maxY] = sortRange(slab.y1, slab.y2);
    const width = maxX - minX;
    const height = maxY - minY;
    if (width < EPS || height < EPS) continue;

    const lx = Math.min(width, height);
    const ly = Math.max(width, height);
    const beta = ly / lx;
    const wDL = slab.deadLoad ?? defaultDeadLoad;
    const wLL = slab.liveLoad ?? defaultLiveLoad;
    const peakDL = wDL * (lx / 2);
    const peakLL = wLL * (lx / 2);

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

/**
 * Detects slab edge loads that have no matching beam (orphan / free edges) and
 * redistributes their total force to the parallel supported edges of the same slab.
 *
 * This is the correct treatment for L-shaped (or otherwise irregular) slabs that
 * have been decomposed into rectangular sub-slabs sharing an internal edge with no
 * beam:  instead of silently dropping the load (equilibrium error), the orphan
 * edge's force is added as a uniform intensity increase to the opposite/parallel
 * beam-supported edge(s) — matching the physical behaviour where the load travels
 * the long way around to the nearest real support.
 *
 * @param edgeLoads  Output of buildSlabEdgeLoads()
 * @param beams      All beams in the model (used to detect which edges are supported)
 * @returns New array of SlabEdgeLoad with orphan loads merged into supported edges
 */
export function redistributeOrphanEdgeLoads(
  edgeLoads: SlabEdgeLoad[],
  beams: PlanarBeamGeometry[],
): SlabEdgeLoad[] {
  /** true when at least one beam segment is collinear with and overlaps this edge */
  const hasMatchingBeam = (edge: SlabEdgeLoad): boolean => {
    for (const b of beams) {
      const dir = inferDirection(b);
      if (!dir || dir !== edge.direction) continue;
      if (edge.direction === 'horizontal') {
        if (Math.abs(b.y1 - edge.y1) > EPS) continue;
        const [bs, be_] = sortRange(b.x1, b.x2);
        const [es, ee] = sortRange(edge.x1, edge.x2);
        if (bs <= ee + EPS && be_ >= es - EPS) return true;
      } else {
        if (Math.abs(b.x1 - edge.x1) > EPS) continue;
        const [bs, be_] = sortRange(b.y1, b.y2);
        const [es, ee] = sortRange(edge.y1, edge.y2);
        if (bs <= ee + EPS && be_ >= es - EPS) return true;
      }
    }
    return false;
  };

  const edgeLen = (e: SlabEdgeLoad): number =>
    e.direction === 'horizontal'
      ? Math.abs(e.x2 - e.x1)
      : Math.abs(e.y2 - e.y1);

  /** group edge loads by slab */
  const bySlabId = new Map<string, SlabEdgeLoad[]>();
  for (const e of edgeLoads) {
    const arr = bySlabId.get(e.slabId) ?? [];
    arr.push(e);
    bySlabId.set(e.slabId, arr);
  }

  const result: SlabEdgeLoad[] = [];

  for (const [, edges] of bySlabId) {
    /** deep-copy so we never mutate callers' data */
    const local: SlabEdgeLoad[] = edges.map(e => ({
      ...e,
      profileDL: e.profileDL.map(p => ({ ...p })),
      profileLL: e.profileLL.map(p => ({ ...p })),
    }));

    const supported: SlabEdgeLoad[] = [];
    const orphans: SlabEdgeLoad[] = [];
    for (const e of local) {
      (hasMatchingBeam(e) ? supported : orphans).push(e);
    }

    /** nothing to fix for this slab */
    if (orphans.length === 0) {
      result.push(...local);
      continue;
    }

    for (const orphan of orphans) {
      const dlStats = computeLineProfileStats(orphan.profileDL);
      const llStats = computeLineProfileStats(orphan.profileLL);
      const olen = edgeLen(orphan);
      /** total force [N] that would have gone to this unsupported edge */
      const totalDL = dlStats.area * olen;
      const totalLL = llStats.area * olen;

      /** parallel supported edges of the same slab — same direction, different position */
      const parallels = supported.filter(e => e.direction === orphan.direction);
      if (parallels.length === 0) {
        /** no parallel beam at all → redistribute to perpendicular edges equally */
        const perp = supported.filter(e => e.direction !== orphan.direction);
        if (perp.length === 0) continue;
        const factor = 1 / perp.length;
        for (const target of perp) {
          const tlen = edgeLen(target);
          if (tlen < EPS) continue;
          const addDL = (totalDL * factor) / tlen;
          const addLL = (totalLL * factor) / tlen;
          target.profileDL = target.profileDL.map(p => ({ t: p.t, wy: p.wy + addDL }));
          target.profileLL = target.profileLL.map(p => ({ t: p.t, wy: p.wy + addLL }));
        }
        continue;
      }

      /** distribute equally among parallel supported edges as uniform addition */
      const factor = 1 / parallels.length;
      for (const target of parallels) {
        const tlen = edgeLen(target);
        if (tlen < EPS) continue;
        const addDL = (totalDL * factor) / tlen;
        const addLL = (totalLL * factor) / tlen;
        target.profileDL = target.profileDL.map(p => ({ t: p.t, wy: p.wy + addDL }));
        target.profileLL = target.profileLL.map(p => ({ t: p.t, wy: p.wy + addLL }));
      }
    }

    result.push(...supported);
  }

  return result;
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
