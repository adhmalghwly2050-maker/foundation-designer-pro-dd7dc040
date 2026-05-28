/**
 * Voronoi-based Slab-to-Beam Load Transfer
 * ═══════════════════════════════════════════════════════════════
 * Distributes slab area loads to supporting beams using a
 * Voronoi (nearest-segment) approach.
 *
 * For every point inside the slab polygon, the load is assigned
 * to the nearest supporting beam segment.  This generalises the
 * standard 45° yield-line method to arbitrary polygon slabs and
 * produces the exact same result as yield-line theory for
 * rectangular slabs with axis-aligned perimeter beams.
 *
 * Algorithm:
 *   1. Sample slab interior with a dense N×N grid.
 *   2. For each sample that lies inside the polygon →
 *      find nearest supporting beam (Voronoi assignment).
 *   3. Accumulate load force at the parameter t along that beam.
 *   4. Convert accumulated forces → distributed line-load profile
 *      (kN/m or N/mm, consistent with input units).
 */

import type {
  PlanarBeamGeometry,
  PlanarSlabGeometry,
  LineLoadPoint,
  BeamLineLoadProfile,
} from './slabLoadTransfer';

type Pt = { x: number; y: number };

const EPS = 1e-9;

// ─── Geometry helpers ────────────────────────────────────────────────────────

/** Closest point on segment (x1,y1)→(x2,y2) to point (px,py).
 *  Returns clamped parameter t∈[0,1] and perpendicular distance. */
function ptToSeg(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): { t: number; dist: number } {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq < EPS ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nx = x1 + t * dx - px;
  const ny = y1 + t * dy - py;
  return { t, dist: Math.sqrt(nx * nx + ny * ny) };
}

/** Ray-casting point-in-polygon test (works for concave polygons). */
function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) &&
        x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Minimum distance from point (px,py) to ANY edge of the polygon boundary. */
function distToPolyBoundary(x: number, y: number, poly: Pt[]): number {
  let minD = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const { dist } = ptToSeg(x, y, poly[i].x, poly[i].y, poly[j].x, poly[j].y);
    if (dist < minD) minD = dist;
  }
  return minD;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Return the polygon vertices of a slab.
 * Uses slab.vertices if present (irregular polygon), otherwise builds the
 * four corners from slab.x1/y1/x2/y2 (rectangular slab).
 */
export function getSlabPolygon(slab: PlanarSlabGeometry): Pt[] {
  if (slab.vertices && slab.vertices.length >= 3) return slab.vertices;
  const x1 = Math.min(slab.x1, slab.x2), x2 = Math.max(slab.x1, slab.x2);
  const y1 = Math.min(slab.y1, slab.y2), y2 = Math.max(slab.y1, slab.y2);
  return [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
}

/**
 * Find beams that lie along one of the polygon's edges (within tol).
 *
 * A beam is considered "supporting" only when BOTH its endpoints project
 * onto the **same** polygon edge within tolerance.  This prevents diagonal
 * beams whose endpoints happen to touch two *different* edges from being
 * wrongly included as supporting beams (which would cause them to attract
 * large loads from the slab interior and starve the true perimeter beams).
 */
export function findSupportingBeams(
  polygon: Pt[],
  beams: PlanarBeamGeometry[],
  tol?: number,
): PlanarBeamGeometry[] {
  // Auto-scale tolerance: 1.5 % of the polygon's characteristic length
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
  const diagLen = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const useTol = tol ?? Math.max(0.05, diagLen * 0.015);

  const n = polygon.length;
  return beams.filter(b => {
    // Check every polygon edge: if both beam endpoints are within `useTol`
    // of the *same* edge, this beam lies along that perimeter edge.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex1 = polygon[i].x, ey1 = polygon[i].y;
      const ex2 = polygon[j].x, ey2 = polygon[j].y;
      const edgeLen = Math.hypot(ex2 - ex1, ey2 - ey1);
      if (edgeLen < EPS) continue;

      const { dist: d1 } = ptToSeg(b.x1, b.y1, ex1, ey1, ex2, ey2);
      const { dist: d2 } = ptToSeg(b.x2, b.y2, ex1, ey1, ex2, ey2);

      if (d1 < useTol && d2 < useTol) return true;
    }
    return false;
  });
}

// ─── Voronoi Cell (for visualisation) ────────────────────────────────────────

export interface VoronoiCell {
  x: number;
  y: number;
  beamId: string;
  beamIdx: number;
}

// ─── Load result ─────────────────────────────────────────────────────────────

export interface VoronoiBeamLoad {
  beamId: string;
  profileDL: LineLoadPoint[];
  profileLL: LineLoadPoint[];
  equivalentDL: number;  // average line load (same units as wDL × length_unit)
  equivalentLL: number;
}

// ─── Smoothing ────────────────────────────────────────────────────────────────

function smoothProfile(pts: LineLoadPoint[], passes = 2): LineLoadPoint[] {
  let arr = pts.slice();
  for (let p = 0; p < passes; p++) {
    const next: LineLoadPoint[] = [];
    for (let i = 0; i < arr.length; i++) {
      const prev = arr[Math.max(0, i - 1)].wy;
      const curr = arr[i].wy;
      const nxt  = arr[Math.min(arr.length - 1, i + 1)].wy;
      next.push({ t: arr[i].t, wy: (prev + 2 * curr + nxt) / 4 });
    }
    arr = next;
  }
  return arr;
}

// ─── Core Voronoi computation ─────────────────────────────────────────────────

/**
 * Compute Voronoi-based distributed loads from ONE slab to its supporting beams.
 *
 * @param slab            Slab geometry (may have vertices for irregular polygon).
 * @param supportingBeams Beams found on the slab perimeter.
 * @param wDL             Dead-load intensity (kN/m² or N/mm² — consistent with coords).
 * @param wLL             Live-load intensity (same units).
 * @param nSamples        Grid resolution per axis (default 60 — good accuracy/speed).
 * @param returnCells     If true, also returns raster cells for visualisation.
 */
export function computeVoronoiSlabLoad(
  slab: PlanarSlabGeometry,
  supportingBeams: PlanarBeamGeometry[],
  wDL: number,
  wLL: number,
  nSamples = 60,
  returnCells = false,
): { loads: VoronoiBeamLoad[]; cells?: VoronoiCell[] } {
  if (supportingBeams.length === 0) return { loads: [] };

  const polygon = getSlabPolygon(slab);
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX, rangeY = maxY - minY;
  if (rangeX < EPS || rangeY < EPS) return { loads: [] };

  // Aspect-ratio-aware grid
  const aspect = rangeX / rangeY;
  const nx = Math.max(8, Math.round(nSamples * Math.sqrt(aspect)));
  const ny = Math.max(8, Math.round(nSamples / Math.sqrt(aspect)));
  const cellW = rangeX / nx;
  const cellH = rangeY / ny;
  const cellArea = cellW * cellH;

  const N_BINS = 24; // profile resolution per beam
  const nBeams = supportingBeams.length;

  // Accumulate forces per beam per bin
  const dlBins = Array.from({ length: nBeams }, () => new Float64Array(N_BINS));
  const llBins = Array.from({ length: nBeams }, () => new Float64Array(N_BINS));

  const cells: VoronoiCell[] = [];

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const px = minX + (i + 0.5) * cellW;
      const py = minY + (j + 0.5) * cellH;
      if (!pointInPolygon(px, py, polygon)) continue;

      // Find nearest beam
      let minDist = Infinity, nearIdx = 0, nearT = 0;
      for (let k = 0; k < nBeams; k++) {
        const b = supportingBeams[k];
        const { t, dist } = ptToSeg(px, py, b.x1, b.y1, b.x2, b.y2);
        if (dist < minDist) { minDist = dist; nearIdx = k; nearT = t; }
      }

      const bin = Math.min(Math.floor(nearT * N_BINS), N_BINS - 1);
      dlBins[nearIdx][bin] += wDL * cellArea;
      llBins[nearIdx][bin] += wLL * cellArea;

      if (returnCells) {
        cells.push({ x: px, y: py, beamId: supportingBeams[nearIdx].id, beamIdx: nearIdx });
      }
    }
  }

  const loads: VoronoiBeamLoad[] = [];
  for (let k = 0; k < nBeams; k++) {
    const beam = supportingBeams[k];
    const beamLen = Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1);
    if (beamLen < EPS) continue;

    let totalDL = 0, totalLL = 0;
    for (let b = 0; b < N_BINS; b++) { totalDL += dlBins[k][b]; totalLL += llBins[k][b]; }
    if (totalDL < EPS && totalLL < EPS) continue;

    const segLen = beamLen / N_BINS;
    const rawDL: LineLoadPoint[] = [{ t: 0, wy: 0 }];
    const rawLL: LineLoadPoint[] = [{ t: 0, wy: 0 }];

    for (let b = 0; b < N_BINS; b++) {
      const t = (b + 0.5) / N_BINS;
      rawDL.push({ t, wy: segLen > EPS ? dlBins[k][b] / segLen : 0 });
      rawLL.push({ t, wy: segLen > EPS ? llBins[k][b] / segLen : 0 });
    }
    rawDL.push({ t: 1, wy: rawDL[rawDL.length - 1].wy });
    rawLL.push({ t: 1, wy: rawLL[rawLL.length - 1].wy });

    loads.push({
      beamId: beam.id,
      profileDL: smoothProfile(rawDL),
      profileLL: smoothProfile(rawLL),
      equivalentDL: totalDL / beamLen,
      equivalentLL: totalLL / beamLen,
    });
  }

  return { loads, cells: returnCells ? cells : undefined };
}

// ─── Multi-slab accumulation ──────────────────────────────────────────────────

/** Linearly interpolate a profile at parameter t. */
function evalProfile(profile: LineLoadPoint[], t: number): number {
  if (!profile.length) return 0;
  if (t <= profile[0].t) return profile[0].wy;
  if (t >= profile[profile.length - 1].t) return profile[profile.length - 1].wy;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], b = profile[i + 1];
    if (t <= b.t + EPS) {
      const dt = b.t - a.t;
      return dt < EPS ? a.wy : a.wy + (b.wy - a.wy) * (t - a.t) / dt;
    }
  }
  return profile[profile.length - 1].wy;
}

function mergeProfiles(a: LineLoadPoint[], b: LineLoadPoint[]): LineLoadPoint[] {
  if (!a.length) return b;
  if (!b.length) return a;
  const ts = [...new Set([...a.map(p => p.t), ...b.map(p => p.t)])].sort((x, y) => x - y);
  return ts.map(t => ({ t, wy: evalProfile(a, t) + evalProfile(b, t) }));
}

/**
 * Compute Voronoi beam-load profiles for a collection of slabs and return a
 * Map<beamId, BeamLineLoadProfile> compatible with the existing API.
 *
 * @param slabs      Slab geometries (with optional vertices for irregular slabs).
 * @param allBeams   All beam geometries in the same story.
 * @param defaultDL  Fallback dead-load if slab.deadLoad is undefined.
 * @param defaultLL  Fallback live-load if slab.liveLoad is undefined.
 * @param nSamples   Grid resolution (default 60).
 */
export function buildVoronoiBeamLoads(
  slabs: PlanarSlabGeometry[],
  allBeams: PlanarBeamGeometry[],
  defaultDL = 0,
  defaultLL = 0,
  nSamples = 60,
): Map<string, BeamLineLoadProfile> {
  const result = new Map<string, BeamLineLoadProfile>();

  // Initialise with zero profiles
  for (const b of allBeams) {
    result.set(b.id, {
      beamId: b.id,
      profileDL: [{ t: 0, wy: 0 }, { t: 1, wy: 0 }],
      profileLL: [{ t: 0, wy: 0 }, { t: 1, wy: 0 }],
      equivalentDL: 0,
      equivalentLL: 0,
      connectedSlabIds: [],
    });
  }

  for (const slab of slabs) {
    const polygon = getSlabPolygon(slab);
    const supporting = findSupportingBeams(polygon, allBeams);
    if (!supporting.length) continue;

    const wDL = slab.deadLoad ?? defaultDL;
    const wLL = slab.liveLoad ?? defaultLL;
    const { loads } = computeVoronoiSlabLoad(slab, supporting, wDL, wLL, nSamples, false);

    for (const load of loads) {
      const prev = result.get(load.beamId);
      if (!prev) continue;
      result.set(load.beamId, {
        beamId: load.beamId,
        profileDL: mergeProfiles(prev.profileDL, load.profileDL),
        profileLL: mergeProfiles(prev.profileLL, load.profileLL),
        equivalentDL: prev.equivalentDL + load.equivalentDL,
        equivalentLL: prev.equivalentLL + load.equivalentLL,
        connectedSlabIds: [...prev.connectedSlabIds, slab.id],
      });
    }
  }

  return result;
}
