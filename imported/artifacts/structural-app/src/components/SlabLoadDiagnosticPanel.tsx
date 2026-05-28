/**
 * SlabLoadDiagnosticPanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-beam diagnostic: shows the dead-load and live-load transferred from the
 * adjacent slab(s) to each beam.
 *
 * NEW features:
 *   • فلتر بالدور — اعرض بلاطات وجسور دور واحد فقط
 *   • مؤشر الانتقال — البلاطة خضراء إذا تنتقل أحمالها، حمراء إذا لم تجد جسراً
 *   • نقر على البلاطة → لوحة تفصيل مسار الحمل
 */

import React, { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Activity, Search, Download, AlertTriangle, CheckCircle2, Scale,
  Layers, ArrowRight, X as CloseIcon,
} from 'lucide-react';
import * as XLSX from 'xlsx';

import {
  calculateBeamLoads,
  type Beam,
  type Slab,
  type Column,
  type SlabProps,
  type MatProps,
} from '@/lib/structuralEngine';
import {
  computeVoronoiSlabLoad,
  findSupportingBeams,
  getSlabPolygon,
  buildVoronoiBeamLoads,
  type VoronoiCell,
} from '@/lib/voronoiSlabLoad';

interface Props {
  beams: Beam[];
  slabs: Slab[];
  columns: Column[];
  slabProps: SlabProps;
  mat: MatProps;
  colLoads3D?: Map<string, { P_service?: number; Pu?: number }>;
}

interface RowData {
  beamId: string;
  length: number;
  storyId?: string;
  dl_2d: number;  ll_2d: number;
  dl_3d: number;  ll_3d: number;
  dl_gf: number;  ll_gf: number;
  dl_uc: number;  ll_uc: number;
  maxDiffPct: number;
}

function fmt(n: number, d = 2) {
  if (!isFinite(n)) return '—';
  return n.toFixed(d);
}

function diffBadge(pct: number) {
  const abs = Math.abs(pct);
  if (abs <= 1) {
    return (
      <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-400/40 text-[10px] gap-1">
        <CheckCircle2 size={10} />متطابق
      </Badge>
    );
  }
  if (abs <= 10) {
    return (
      <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-400/40 text-[10px]">
        Δ {pct.toFixed(1)}%
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-400/40 text-[10px] gap-1">
      <AlertTriangle size={10} />Δ {pct.toFixed(1)}%
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// لوحة مناطق الرافدة + حالة انتقال الأحمال
// ═══════════════════════════════════════════════════════════════════════════

const GROUP_PALETTE = [
  { fill: '#2563eb', light: 'rgba(37,99,235,0.13)',  mid: 'rgba(37,99,235,0.32)' },
  { fill: '#ea580c', light: 'rgba(234,88,12,0.13)',  mid: 'rgba(234,88,12,0.32)' },
  { fill: '#16a34a', light: 'rgba(22,163,74,0.13)',  mid: 'rgba(22,163,74,0.32)' },
  { fill: '#9333ea', light: 'rgba(147,51,234,0.13)', mid: 'rgba(147,51,234,0.32)' },
  { fill: '#dc2626', light: 'rgba(220,38,38,0.13)',  mid: 'rgba(220,38,38,0.32)' },
  { fill: '#0891b2', light: 'rgba(8,145,178,0.13)',  mid: 'rgba(8,145,178,0.32)' },
];

/** هل يوجد جسر مجاور لهذه المجموعة المركّبة؟ */
function groupAdjacentBeams(
  compositeRect: { x1: number; y1: number; x2: number; y2: number },
  beams: Beam[],
  tol = 0.12,
): Beam[] {
  const cx1 = Math.min(compositeRect.x1, compositeRect.x2);
  const cx2 = Math.max(compositeRect.x1, compositeRect.x2);
  const cy1 = Math.min(compositeRect.y1, compositeRect.y2);
  const cy2 = Math.max(compositeRect.y1, compositeRect.y2);

  return beams.filter(b => {
    const isH = Math.abs(b.y2 - b.y1) < 1e-6;
    if (isH) {
      const onEdge = Math.abs(b.y1 - cy1) < tol || Math.abs(b.y1 - cy2) < tol;
      const xMin = Math.min(b.x1, b.x2), xMax = Math.max(b.x1, b.x2);
      return onEdge && xMax > cx1 + tol && xMin < cx2 - tol;
    } else {
      const onEdge = Math.abs(b.x1 - cx1) < tol || Math.abs(b.x1 - cx2) < tol;
      const yMin = Math.min(b.y1, b.y2), yMax = Math.max(b.y1, b.y2);
      return onEdge && yMax > cy1 + tol && yMin < cy2 - tol;
    }
  });
}

function beamPositionLabel(
  b: Beam,
  cx1: number, cx2: number, cy1: number, cy2: number,
  tol = 0.12,
): string {
  const isH = Math.abs(b.y2 - b.y1) < 1e-6;
  if (isH) {
    return Math.abs(b.y1 - cy2) < tol ? 'أعلى' : 'أسفل';
  } else {
    return Math.abs(b.x1 - cx2) < tol ? 'يمين' : 'يسار';
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Constants for the Voronoi diagram visualisation
const VIS_SAMPLES = 28; // grid resolution for SVG Voronoi raster

const SlabTributaryDiagram: React.FC<{
  slabs: Slab[];
  beams: Beam[];
  columns: Column[];
  slabProps: SlabProps;
  mat: MatProps;
  selectedSlabId?: string;
  onSlabClick?: (id: string) => void;
}> = ({ slabs, beams, columns, slabProps, mat, selectedSlabId, onSlabClick }) => {

  const data = useMemo(() => {
    if (!slabs.length && !beams.length) return null;

    const wDL = (slabProps.thickness / 1000) * mat.gamma + slabProps.finishLoad;
    const wLL = slabProps.liveLoad;

    const slabGeoms = slabs.map(s => ({
      id: s.id, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
      vertices: s.vertices, deadLoad: wDL, liveLoad: wLL,
    }));
    const beamGeoms = beams.map(b => ({
      id: b.id, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2,
      length: b.length, direction: b.direction,
    }));

    // Global beam → colour index
    const beamColorIdx = new Map(beams.map((b, i) => [b.id, i]));

    // Per-slab Voronoi computation (with raster cells for visualisation)
    const slabVoronoi = slabs.map(s => {
      const sg = slabGeoms.find(g => g.id === s.id)!;
      const polygon = getSlabPolygon(sg);
      const supporting = findSupportingBeams(polygon, beamGeoms);
      const { cells } = computeVoronoiSlabLoad(sg, supporting, wDL, wLL, VIS_SAMPLES, true);

      // Compute cell size (mirrors the formula inside computeVoronoiSlabLoad)
      const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
      const rangeX = (Math.max(...xs) - Math.min(...xs)) || 1;
      const rangeY = (Math.max(...ys) - Math.min(...ys)) || 1;
      const aspect = rangeX / rangeY;
      const nx = Math.max(8, Math.round(VIS_SAMPLES * Math.sqrt(aspect)));
      const ny = Math.max(8, Math.round(VIS_SAMPLES / Math.sqrt(aspect)));

      return {
        slab: s,
        polygon,
        cells: (cells ?? []) as VoronoiCell[],
        cellW: rangeX / nx,
        cellH: rangeY / ny,
        supportingBeams: supporting,
        hasBeam: supporting.length > 0,
      };
    });

    // Voronoi beam load profiles (higher-res, for the load diagram)
    const voronoiMap = buildVoronoiBeamLoads(slabGeoms, beamGeoms, wDL, wLL, 60);

    const beamProfiles = beams.map(b => {
      const prof = voronoiMap.get(b.id) ?? {
        beamId: b.id,
        profileDL: [{ t: 0, wy: 0 }, { t: 1, wy: 0 }],
        profileLL: [{ t: 0, wy: 0 }, { t: 1, wy: 0 }],
        equivalentDL: 0, equivalentLL: 0, connectedSlabIds: [],
      };
      return { beam: b, prof };
    });

    const globalMaxW = Math.max(
      ...beamProfiles.map(bp => Math.max(...bp.prof.profileDL.map(p => p.wy), 0)),
      0.001,
    );

    // Viewport — use actual polygon vertices when available
    const allX = [
      ...slabs.flatMap(s => s.vertices?.map(v => v.x) ?? [s.x1, s.x2]),
      ...beams.flatMap(b => [b.x1, b.x2]),
      ...columns.filter(c => !c.isRemoved).map(c => c.x),
    ];
    const allY = [
      ...slabs.flatMap(s => s.vertices?.map(v => v.y) ?? [s.y1, s.y2]),
      ...beams.flatMap(b => [b.y1, b.y2]),
      ...columns.filter(c => !c.isRemoved).map(c => c.y),
    ];
    if (!allX.length) return null;

    const minX = Math.min(...allX), maxX = Math.max(...allX);
    const minY = Math.min(...allY), maxY = Math.max(...allY);
    const SVG_W = 740, SVG_H = 560;
    const PAD = 64;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const sc = Math.min((SVG_W - 2 * PAD) / rangeX, (SVG_H - 2 * PAD) / rangeY);

    const tx = (x: number) => PAD + (x - minX) * sc;
    const ty = (y: number) => SVG_H - PAD - (y - minY) * sc;

    const PROF_MAX_PX = 28;
    const profFactor = PROF_MAX_PX / globalMaxW;

    return {
      slabVoronoi, beamProfiles, profFactor, beamColorIdx,
      tx, ty, sc, SVG_W, SVG_H, wDL, wLL, globalMaxW,
    };
  }, [slabs, beams, columns, slabProps, mat]);

  if (!data || !slabs.length) return null;
  const {
    slabVoronoi, beamProfiles, profFactor, beamColorIdx,
    tx, ty, sc, SVG_W, SVG_H,
  } = data;

  const renderBeamProfile = (bpIdx: number) => {
    const { beam: b, prof } = beamProfiles[bpIdx];
    const isHoriz = Math.abs(b.y2 - b.y1) < 1e-6;
    const pts = prof.profileDL;
    if (!pts.length || prof.equivalentDL < 0.001) return null;

    const colorIdx = beamColorIdx.get(b.id) ?? bpIdx;
    const pal = GROUP_PALETTE[colorIdx % GROUP_PALETTE.length];

    if (isHoriz) {
      const by = ty(b.y1);
      const bx1svg = tx(Math.min(b.x1, b.x2));
      const bx2svg = tx(Math.max(b.x1, b.x2));
      const bLen = bx2svg - bx1svg;

      const polyPts = [
        `${bx1svg},${by}`,
        ...pts.map(p => {
          const px = bx1svg + p.t * bLen;
          const py = by - p.wy * profFactor;
          return `${px.toFixed(1)},${py.toFixed(1)}`;
        }),
        `${bx2svg},${by}`,
      ].join(' ');

      const peak = Math.max(...pts.map(p => p.wy));
      const peakT = pts.find(p => p.wy >= peak - 0.001)?.t ?? 0.5;
      const peakX = bx1svg + peakT * bLen;
      const peakY = by - peak * profFactor;

      return (
        <g key={`prof-${b.id}`}>
          <polygon points={polyPts} fill={pal.mid} opacity={0.65} stroke={pal.fill} strokeWidth={0.7}/>
          {peak > 0.1 && (
            <text x={peakX} y={peakY - 3} textAnchor="middle" fontSize={8} fill={pal.fill} fontFamily="Arial" fontWeight="bold">
              {peak.toFixed(1)}
            </text>
          )}
        </g>
      );
    } else {
      const bx = tx(b.x1);
      const byMin = ty(Math.max(b.y1, b.y2));
      const byMax = ty(Math.min(b.y1, b.y2));
      const bHt = byMax - byMin;

      const polyPts = [
        `${bx},${byMin}`,
        ...pts.map(p => {
          const py = byMin + p.t * bHt;
          const px = bx + p.wy * profFactor;
          return `${px.toFixed(1)},${py.toFixed(1)}`;
        }),
        `${bx},${byMax}`,
      ].join(' ');

      const peak = Math.max(...pts.map(p => p.wy));
      const peakT = pts.find(p => p.wy >= peak - 0.001)?.t ?? 0.5;
      const peakY = byMin + peakT * bHt;
      const peakX = bx + peak * profFactor;

      return (
        <g key={`prof-${b.id}`}>
          <polygon points={polyPts} fill={pal.mid} opacity={0.65} stroke={pal.fill} strokeWidth={0.7}/>
          {peak > 0.1 && (
            <text x={peakX + 2} y={peakY + 3} fontSize={8} fill={pal.fill} fontFamily="Arial" fontWeight="bold">
              {peak.toFixed(1)}
            </text>
          )}
        </g>
      );
    }
  };

  return (
    <div>
      {/* Legend */}
      <div className="text-[11px] text-muted-foreground mb-2 flex flex-wrap gap-4 items-center">
        {GROUP_PALETTE.slice(0, 3).map((pal, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="inline-block w-5 h-3 rounded-sm" style={{ background: pal.mid }}/>
            جسر {i + 1}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-3 border-2 border-dashed border-red-500 rounded-sm"/>
          <span className="text-red-600 font-medium">⚠ بلاطة بلا جسر</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-4 rounded-sm" style={{ background: '#1a1a2e' }}/>
          جسر / عمود
        </span>
        <span className="text-[10px] opacity-70">القيم بـ kN/m (حمل ميت) • Voronoi</span>
        <span className="text-[10px] opacity-70">● اضغط على البلاطة لرؤية مسار الحمل</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          style={{ width: '100%', minWidth: 440, display: 'block', background: '#f8fafc' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* ── Clip paths: one per slab polygon ── */}
          <defs>
            {slabVoronoi.map(({ slab, polygon }) => (
              <clipPath key={`clip-${slab.id}`} id={`clip-${slab.id}`}>
                <polygon points={polygon.map(p => `${tx(p.x)},${ty(p.y)}`).join(' ')} />
              </clipPath>
            ))}
          </defs>

          {/* ── Voronoi raster cells (coloured by nearest beam) ── */}
          {slabVoronoi.map(({ slab, cells, cellW, cellH, hasBeam }) => {
            if (!hasBeam) return null;
            const svgW = cellW * sc + 0.5; // +0.5 px overlap to avoid gaps
            const svgH = cellH * sc + 0.5;
            return (
              <g key={`vor-${slab.id}`} clipPath={`url(#clip-${slab.id})`}>
                {cells.map((cell, idx) => {
                  const cIdx = (beamColorIdx.get(cell.beamId) ?? cell.beamIdx) % GROUP_PALETTE.length;
                  return (
                    <rect
                      key={idx}
                      x={tx(cell.x) - svgW / 2}
                      y={ty(cell.y) - svgH / 2}
                      width={svgW}
                      height={svgH}
                      fill={GROUP_PALETTE[cIdx].light}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* ── Slab polygon outlines ── */}
          {slabVoronoi.map(({ slab, polygon, hasBeam }) => {
            const pal = GROUP_PALETTE[(beamColorIdx.get(slab.id) ?? 0) % GROUP_PALETTE.length];
            const pts = polygon.map(p => `${tx(p.x)},${ty(p.y)}`).join(' ');
            const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
            const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
            return (
              <g key={`so-${slab.id}`}>
                <polygon
                  points={pts}
                  fill={hasBeam ? 'none' : 'rgba(220,38,38,0.07)'}
                  stroke={hasBeam ? pal.fill : '#dc2626'}
                  strokeWidth={hasBeam ? 1.5 : 2.5}
                  strokeDasharray={hasBeam ? '8,4' : '5,3'}
                />
                {!hasBeam && (
                  <>
                    <text x={tx(cx)} y={ty(cy) - 6} textAnchor="middle" fontSize={12}
                      fontWeight="bold" fill="#dc2626" fontFamily="Arial">⚠</text>
                    <text x={tx(cx)} y={ty(cy) + 10} textAnchor="middle" fontSize={9}
                      fontWeight="bold" fill="#dc2626" fontFamily="Arial">لا جسر</text>
                  </>
                )}
                <text x={tx(cx)} y={ty(cy) + (hasBeam ? -4 : 24)} textAnchor="middle"
                  fontSize={9} fill={hasBeam ? pal.fill : '#dc2626'}
                  fontWeight="bold" fontFamily="Arial">{slab.id}</text>
              </g>
            );
          })}

          {/* ── Beam load profiles (DL) ── */}
          {beamProfiles.map((_, bi) => renderBeamProfile(bi))}

          {/* ── Beams ── */}
          {beams.map(b => (
            <line key={`bm-${b.id}`}
              x1={tx(b.x1)} y1={ty(b.y1)} x2={tx(b.x2)} y2={ty(b.y2)}
              stroke="#1e1b4b" strokeWidth={4} strokeLinecap="round"/>
          ))}

          {/* ── Beam ID labels ── */}
          {beams.map(b => {
            const mx = tx((b.x1 + b.x2) / 2);
            const my = ty((b.y1 + b.y2) / 2);
            const isH = Math.abs(b.y2 - b.y1) < 1e-6;
            return (
              <text key={`blbl-${b.id}`}
                x={mx + (isH ? 0 : 8)} y={my + (isH ? 12 : 3)}
                textAnchor="middle" fontSize={8} fill="#1e1b4b" fontFamily="Arial">
                {b.id}
              </text>
            );
          })}

          {/* ── Columns ── */}
          {columns.filter(c => !c.isRemoved).map(c => (
            <rect key={`col-${c.id}`}
              x={tx(c.x) - 6} y={ty(c.y) - 6} width={12} height={12}
              fill="#1e1b4b" stroke="white" strokeWidth={1.5} rx={1}/>
          ))}

          {/* ── Clickable slab overlays ── */}
          {slabVoronoi.map(({ slab, polygon, hasBeam }) => {
            const isSelected = selectedSlabId === slab.id;
            const pts = polygon.map(p => `${tx(p.x)},${ty(p.y)}`).join(' ');
            const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
            const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
            return (
              <g key={`click-${slab.id}`} style={{ cursor: 'pointer' }}
                onClick={() => onSlabClick?.(slab.id)}>
                <polygon
                  points={pts}
                  fill={isSelected ? 'rgba(234,179,8,0.20)' : 'transparent'}
                  stroke={isSelected ? '#f59e0b' : 'transparent'}
                  strokeWidth={isSelected ? 3 : 0}
                />
                <circle
                  cx={tx(polygon[0].x) + 9} cy={ty(polygon[0].y) + 9}
                  r={7} fill={hasBeam ? '#16a34a' : '#dc2626'}
                  stroke="white" strokeWidth={1}
                />
                <text
                  x={tx(polygon[0].x) + 9} y={ty(polygon[0].y) + 13}
                  textAnchor="middle" fontSize={9} fill="white" fontFamily="Arial" fontWeight="bold">
                  {hasBeam ? '✓' : '!'}
                </text>
              </g>
            );
          })}

          {/* ── Beam legend (top-right) ── */}
          {beams.slice(0, 6).map((b, bi) => {
            const pal = GROUP_PALETTE[bi % GROUP_PALETTE.length];
            return (
              <g key={`leg-${bi}`} transform={`translate(${SVG_W - 180},${14 + bi * 18})`}>
                <rect x={0} y={0} width={14} height={10}
                  fill={pal.mid} stroke={pal.fill} strokeWidth={1} rx={2}/>
                <text x={18} y={9} fontSize={9} fill="#333" fontFamily="Arial">
                  {b.id} ({beamProfiles[bi]?.prof.equivalentDL.toFixed(1) ?? '0.0'} kN/m)
                </text>
              </g>
            );
          })}

          {/* ── Scale label (bottom) ── */}
          <text x={12} y={SVG_H - 8} fontSize={9} fill="#666" fontFamily="Arial">
            Voronoi | مقياس: 1م/px={sc > 0 ? (1/sc).toFixed(3) : '?'} | الحمل الميت (kN/m)
          </text>
        </svg>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// لوحة التفصيل عند الضغط على بلاطة
// ──────────────────────────────────────────────────────────────────────────
interface SlabDetailResult {
  slab: Slab;
  beta: number;
  lx: number;
  ly: number;
  W: number;
  H: number;
  adjacentBeams: Array<{ beam: Beam; dl: number; ll: number; position: string }>;
  hasTransfer: boolean;
  groupMembers: string[];
}

function useSlabDetail(
  selectedSlabId: string | null,
  slabs: Slab[],
  beams: Beam[],
  slabProps: SlabProps,
  mat: MatProps,
): SlabDetailResult | null {
  return useMemo(() => {
    if (!selectedSlabId) return null;
    const slab = slabs.find(s => s.id === selectedSlabId);
    if (!slab) return null;

    const wDL = (slabProps.thickness / 1000) * mat.gamma + slabProps.finishLoad;
    const wLL = slabProps.liveLoad;

    const slabGeom = {
      id: slab.id, x1: slab.x1, y1: slab.y1, x2: slab.x2, y2: slab.y2,
      vertices: slab.vertices, deadLoad: wDL, liveLoad: wLL,
    };
    const beamGeoms = beams.map(b => ({
      id: b.id, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, length: b.length, direction: b.direction,
    }));

    const polygon = getSlabPolygon(slabGeom);
    const adjBeamGeoms = findSupportingBeams(polygon, beamGeoms);

    const cx1 = Math.min(slab.x1, slab.x2), cx2 = Math.max(slab.x1, slab.x2);
    const cy1 = Math.min(slab.y1, slab.y2), cy2 = Math.max(slab.y1, slab.y2);
    const W = cx2 - cx1, H = cy2 - cy1;
    const lx = Math.min(W, H), ly = Math.max(W, H);
    const beta = lx > 0 ? ly / lx : 99;

    const { loads } = computeVoronoiSlabLoad(slabGeom, adjBeamGeoms, wDL, wLL, 60, false);

    const adjacentBeams = loads.map(load => {
      const beam = beams.find(b => b.id === load.beamId)!;
      return {
        beam,
        dl: load.equivalentDL,
        ll: load.equivalentLL,
        position: beam ? beamPositionLabel(beam, cx1, cx2, cy1, cy2) : '—',
      };
    }).filter(r => r.beam);

    const hasTransfer = adjacentBeams.length > 0 && adjacentBeams.some(b => b.dl > 0.01);

    return {
      slab, beta, lx, ly, W, H,
      adjacentBeams, hasTransfer,
      groupMembers: [slab.id],
    };
  }, [selectedSlabId, slabs, beams, slabProps, mat]);
}

// ══════════════════════════════════════════════════════════════════════════
// المكوّن الرئيسي
// ══════════════════════════════════════════════════════════════════════════

export const SlabLoadDiagnosticPanel: React.FC<Props> = ({
  beams, slabs, columns, slabProps, mat, colLoads3D,
}) => {
  const [storyFilter, setStoryFilter] = useState<string>('all');
  const [selectedSlabId, setSelectedSlabId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // ── الأدوار المتاحة ─────────────────────────────────────────────────────
  const uniqueStoryIds = useMemo(() => {
    const ids = new Set<string>();
    slabs.forEach(s => { if (s.storyId) ids.add(s.storyId); });
    beams.forEach(b => { if (b.storyId) ids.add(b.storyId); });
    return [...ids].sort();
  }, [slabs, beams]);

  const filteredSlabs = useMemo(() =>
    storyFilter === 'all' ? slabs : slabs.filter(s => !s.storyId || s.storyId === storyFilter),
    [slabs, storyFilter],
  );

  const filteredBeams = useMemo(() =>
    storyFilter === 'all' ? beams : beams.filter(b => !b.storyId || b.storyId === storyFilter),
    [beams, storyFilter],
  );

  // ── حساب صفوف الجدول ────────────────────────────────────────────────────
  const rows = useMemo<RowData[]>(() => {
    if (!filteredBeams.length) return [];

    const wDL_service = (slabProps.thickness / 1000) * mat.gamma + slabProps.finishLoad;
    const wLL_service = slabProps.liveLoad;

    // Pre-compute Voronoi map once for all beams (story-aware)
    const slabGeoms = filteredSlabs.map(s => ({
      id: s.id, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
      vertices: s.vertices, deadLoad: wDL_service, liveLoad: wLL_service,
    }));
    const beamGeoms = filteredBeams.map(b => ({
      id: b.id, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2,
      length: b.length, direction: b.direction,
    }));
    const voronoiMap = buildVoronoiBeamLoads(slabGeoms, beamGeoms, wDL_service, wLL_service, 60);

    return filteredBeams.map(beam => {
      const beamSW = (beam.b / 1000) * (beam.h / 1000) * mat.gamma;

      // 2D reference (simple tributary method)
      const r2d = calculateBeamLoads(beam, filteredSlabs, slabProps, mat, filteredBeams);
      const dl_2d = r2d.deadLoad - beamSW;
      const ll_2d = r2d.liveLoad;

      // Voronoi method (nearest-segment)
      const vorProfile = voronoiMap.get(beam.id);
      const dl_3d = vorProfile?.equivalentDL ?? 0;
      const ll_3d = vorProfile?.equivalentLL ?? 0;

      const dl_gf = dl_3d;
      const ll_gf = ll_3d;
      const dl_uc = dl_3d;
      const ll_uc = ll_3d;

      const ref = Math.max(1e-6, Math.abs(dl_2d) + Math.abs(ll_2d));
      const maxDiffPct = ((Math.abs(dl_3d - dl_2d) + Math.abs(ll_3d - ll_2d)) / ref) * 100;

      return {
        beamId: beam.id,
        length: beam.length,
        storyId: beam.storyId,
        dl_2d, ll_2d, dl_3d, ll_3d, dl_gf, ll_gf, dl_uc, ll_uc,
        maxDiffPct,
      };
    });
  }, [filteredBeams, filteredSlabs, slabProps, mat]);

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.beamId.toLowerCase().includes(q));
  }, [rows, filter]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        dl_2d: acc.dl_2d + r.dl_2d * r.length,
        ll_2d: acc.ll_2d + r.ll_2d * r.length,
        dl_3d: acc.dl_3d + r.dl_3d * r.length,
        ll_3d: acc.ll_3d + r.ll_3d * r.length,
        dl_gf: acc.dl_gf + r.dl_gf * r.length,
        ll_gf: acc.ll_gf + r.ll_gf * r.length,
        dl_uc: acc.dl_uc + r.dl_uc * r.length,
        ll_uc: acc.ll_uc + r.ll_uc * r.length,
      }),
      { dl_2d: 0, ll_2d: 0, dl_3d: 0, ll_3d: 0, dl_gf: 0, ll_gf: 0, dl_uc: 0, ll_uc: 0 },
    );
  }, [rows]);

  // ── التوازن ─────────────────────────────────────────────────────────────
  const equilibrium = useMemo(() => {
    const wDL = (slabProps.thickness / 1000) * mat.gamma + slabProps.finishLoad;
    const wLL = slabProps.liveLoad;

    let slabDL = 0, slabLL = 0;
    for (const s of filteredSlabs) {
      const area = Math.abs(s.x2 - s.x1) * Math.abs(s.y2 - s.y1);
      slabDL += area * wDL;
      slabLL += area * wLL;
    }

    let beamSW = 0;
    for (const b of filteredBeams) {
      beamSW += (b.b / 1000) * (b.h / 1000) * mat.gamma * b.length;
    }

    let wallLoads = 0;
    for (const b of filteredBeams) {
      wallLoads += (b.wallLoad ?? 0) * b.length;
    }

    let colSW = 0;
    for (const c of columns) {
      if (c.isRemoved) continue;
      colSW += (c.b / 1000) * (c.h / 1000) * mat.gamma * (c.L / 1000);
    }

    const totalApplied = slabDL + slabLL + beamSW + wallLoads + colSW;

    const activeCols = columns.filter(c => !c.isRemoved);
    const minZ = activeCols.length
      ? activeCols.reduce((m, c) => Math.min(m, c.zBottom ?? 0), Infinity)
      : 0;
    const groundCols = activeCols.filter(c => Math.abs((c.zBottom ?? 0) - minZ) < 1);
    let sumReactions = 0;
    for (const c of groundCols) {
      sumReactions += (colLoads3D?.get(c.id)?.P_service ?? 0);
    }

    const hasAnalysis = colLoads3D != null && colLoads3D.size > 0 && sumReactions > 0;
    const balanceErr = hasAnalysis && totalApplied > 0
      ? ((sumReactions - totalApplied) / totalApplied) * 100
      : null;

    return {
      slabDL, slabLL, beamSW, wallLoads, colSW,
      totalApplied, sumReactions, hasAnalysis,
      balanceErr, groundColCount: groundCols.length,
    };
  }, [filteredSlabs, filteredBeams, columns, slabProps, mat, colLoads3D]);

  // ── لوحة التفصيل عند الضغط على بلاطة ───────────────────────────────────
  const slabDetail = useSlabDetail(selectedSlabId, filteredSlabs, filteredBeams, slabProps, mat);

  // ── تصدير Excel ─────────────────────────────────────────────────────────
  const exportXlsx = () => {
    const data = rows.map(r => ({
      'Beam ID': r.beamId,
      'Story': r.storyId ?? '',
      'Length (m)': r.length,
      '2D DL (kN/m)': r.dl_2d,
      '2D LL (kN/m)': r.ll_2d,
      '3D Legacy DL (kN/m)': r.dl_3d,
      '3D Legacy LL (kN/m)': r.ll_3d,
      'GF DL (kN/m)': r.dl_gf,
      'GF LL (kN/m)': r.ll_gf,
      'UC DL (kN/m)': r.dl_uc,
      'UC LL (kN/m)': r.ll_uc,
      'Max Δ % vs 2D': r.maxDiffPct,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SlabLoadDiagnostic');
    XLSX.writeFile(wb, 'slab_load_diagnostic.xlsx');
  };

  if (!beams.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          لا توجد جسور حالياً. أضف جسوراً وبلاطات ثم عُد إلى هذا التبويب.
        </CardContent>
      </Card>
    );
  }

  // ── عدد البلاطات غير المنقولة (لا جسر مجاور لها) ──────────────────────────
  const unloadedSlabsCount = useMemo(() => {
    if (!filteredSlabs.length) return 0;
    const beamGeoms = filteredBeams.map(b => ({
      id: b.id, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, length: b.length, direction: b.direction,
    }));
    return filteredSlabs.filter(s => {
      const polygon = getSlabPolygon({
        id: s.id, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, vertices: s.vertices,
      });
      return findSupportingBeams(polygon, beamGeoms).length === 0;
    }).length;
  }, [filteredSlabs, filteredBeams]);

  return (
    <div className="space-y-4">

      {/* ── فلتر الدور ──────────────────────────────────────────────────────── */}
      {uniqueStoryIds.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Layers size={15} className="text-indigo-500" />
            <span>عرض الدور:</span>
          </div>
          <Select value={storyFilter} onValueChange={v => {
            setStoryFilter(v);
            setSelectedSlabId(null);
          }}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="اختر الدور" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع الأدوار ({slabs.length} بلاطة)</SelectItem>
              {uniqueStoryIds.map(id => {
                const slabCount = slabs.filter(s => !s.storyId || s.storyId === id).length;
                return (
                  <SelectItem key={id} value={id}>
                    {id} ({slabCount} بلاطة)
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {unloadedSlabsCount > 0 && (
            <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-400/40 text-xs gap-1">
              <AlertTriangle size={11} />
              {unloadedSlabsCount} بلاطة بلا جسر
            </Badge>
          )}
        </div>
      )}

      {/* ── مخطط مناطق التأثير ──────────────────────────────────────────────── */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity size={16} className="text-blue-600 shrink-0" />
            مخطط مناطق التأثير — انتقال الأحمال من البلاطات إلى الجسور (خطوط 45°)
          </CardTitle>
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
            <span className="text-green-700 dark:text-green-400 font-semibold">● أخضر</span> = البلاطة تنقل أحمالها إلى الجسور المحيطة.{' '}
            <span className="text-red-700 dark:text-red-400 font-semibold">● أحمر</span> = لا يوجد جسر على حافة البلاطة — الأحمال مهدورة.{' '}
            اضغط على أي بلاطة لعرض مسار الحمل التفصيلي.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <SlabTributaryDiagram
            slabs={filteredSlabs}
            beams={filteredBeams}
            columns={columns}
            slabProps={slabProps}
            mat={mat}
            selectedSlabId={selectedSlabId ?? undefined}
            onSlabClick={(id) => setSelectedSlabId(prev => prev === id ? null : id)}
          />
        </CardContent>
      </Card>

      {/* ── لوحة مسار الحمل عند الضغط على بلاطة ────────────────────────────── */}
      {slabDetail && (
        <Card className={`border-2 ${slabDetail.hasTransfer
          ? 'border-green-300 dark:border-green-700 bg-green-500/5'
          : 'border-red-300 dark:border-red-700 bg-red-500/5'
        }`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowRight size={15} className={slabDetail.hasTransfer ? 'text-green-600' : 'text-red-600'} />
                مسار الحمل — البلاطة <code className="font-mono bg-muted px-1 rounded">{slabDetail.slab.id}</code>
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6"
                onClick={() => setSelectedSlabId(null)}>
                <CloseIcon size={12} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {/* معلومات البلاطة */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              {[
                ['الأبعاد', `${slabDetail.W.toFixed(2)}م × ${slabDetail.H.toFixed(2)}م`],
                ['β (ly/lx)', slabDetail.beta > 50 ? '> 2 (أحادية)' : slabDetail.beta.toFixed(2)],
                ['lx', `${slabDetail.lx.toFixed(2)} م`],
                ['نوع', slabDetail.beta > 2 ? 'أحادية الاتجاه' : 'ثنائية الاتجاهين'],
              ].map(([k, v]) => (
                <div key={k as string} className="bg-background/60 border border-border/50 rounded px-2 py-1.5">
                  <div className="text-muted-foreground text-[10px]">{k}</div>
                  <div className="font-mono font-semibold">{v}</div>
                </div>
              ))}
            </div>

            {/* حالة الانتقال */}
            {!slabDetail.hasTransfer ? (
              <div className="rounded-lg bg-red-500/10 border border-red-400/40 p-3">
                <div className="flex items-center gap-2 font-bold text-red-600 dark:text-red-400 text-sm mb-1">
                  <AlertTriangle size={15} />
                  الأحمال لم تنتقل — لا يوجد جسر على حافة البلاطة
                </div>
                <p className="text-[11px] text-red-700/80 dark:text-red-300/80 leading-relaxed">
                  {slabDetail.groupMembers.length > 1
                    ? `البلاطات (${slabDetail.groupMembers.join(' + ')}) مدمجة كبلاطة مركّبة ولا توجد جسور على حوافها. أحمالها مهدورة ولا تنتقل إلى الإطار الإنشائي.`
                    : 'لا توجد جسور على حواف هذه البلاطة. أحمالها مهدورة ولا تنتقل إلى الإطار الإنشائي.'
                  }
                  {' '}تحقق من نمذجة الجسور المحيطة.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
                  <CheckCircle2 size={13} />
                  الأحمال تنتقل إلى {slabDetail.adjacentBeams.length} جسر(اً):
                </div>
                <div className="grid gap-1.5">
                  {slabDetail.adjacentBeams.map(({ beam, dl, ll, position }) => (
                    <div key={beam.id}
                      className="flex items-center justify-between gap-3 text-[11px] bg-background/70 border border-border/50 rounded px-3 py-2">
                      <div className="flex items-center gap-2">
                        <code className="font-mono font-bold bg-muted px-1 rounded">{beam.id}</code>
                        <Badge variant="outline" className="text-[10px] px-1">{position}</Badge>
                        <span className="text-muted-foreground">L={beam.length.toFixed(2)} م</span>
                      </div>
                      <div className="flex gap-3 font-mono">
                        <span className="text-blue-700 dark:text-blue-400">
                          DL = {dl < 0.001 ? '—' : `${dl.toFixed(2)} kN/m`}
                        </span>
                        <span className="text-amber-700 dark:text-amber-400">
                          LL = {ll < 0.001 ? '—' : `${ll.toFixed(2)} kN/m`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {slabDetail.groupMembers.length > 1 && (
                  <p className="text-[10px] text-muted-foreground">
                    ملاحظة: البلاطات ({slabDetail.groupMembers.join(' + ')}) مدمجة (لا جسر بينها) وتعمل كبلاطة مركّبة واحدة.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── التحقق من التوازن ───────────────────────────────────────────────── */}
      <Card className={`border-2 ${
        equilibrium.balanceErr === null
          ? 'border-slate-200 dark:border-slate-700 bg-slate-500/5'
          : Math.abs(equilibrium.balanceErr) <= 2
            ? 'border-green-300 dark:border-green-700 bg-green-500/5'
            : Math.abs(equilibrium.balanceErr) <= 8
              ? 'border-yellow-300 dark:border-yellow-700 bg-yellow-500/5'
              : 'border-red-300 dark:border-red-700 bg-red-500/5'
      }`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Scale size={16} className="text-indigo-600 shrink-0" />
            التحقق من توازن الأحمال العمودية
          </CardTitle>
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
            مجموع ردود أفعال القاعدة (1.0D + 1.0L من التحليل 3D) مقارنةً بمجموع
            الأحمال المطبقة — يكشف أي خلل في نقل الأحمال.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1 text-[12px]">
              <div className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                الأحمال المطبقة (خدمي)
              </div>
              {[
                ['وزن ذاتي بلاطات + طبقات (DL)', equilibrium.slabDL],
                ['حمل حي بلاطات (LL)',             equilibrium.slabLL],
                ['وزن ذاتي جسور',                  equilibrium.beamSW],
                ['أحمال جدران على الجسور',          equilibrium.wallLoads],
                ['وزن ذاتي أعمدة',                 equilibrium.colSW],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between gap-2 py-0.5 border-b border-dashed border-border/50 last:border-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-medium">{fmt(val as number, 1)} kN</span>
                </div>
              ))}
              <div className="flex justify-between gap-2 pt-1.5 font-bold">
                <span>المجموع الكلي</span>
                <span className="font-mono">{fmt(equilibrium.totalApplied, 1)} kN</span>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-3">
              <div>
                <div className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                  ردود أفعال ركائز القاعدة
                </div>
                {!equilibrium.hasAnalysis ? (
                  <div className="rounded-lg bg-muted/50 border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
                    <AlertTriangle size={16} className="mx-auto mb-1 text-amber-500" />
                    يتطلب تشغيل التحليل الإنشائي (3D) أولاً
                  </div>
                ) : (
                  <div className="space-y-1 text-[12px]">
                    <div className="flex justify-between gap-2 py-0.5 border-b border-dashed border-border/50">
                      <span className="text-muted-foreground">عدد ركائز الدور الأرضي</span>
                      <span className="font-mono">{equilibrium.groundColCount}</span>
                    </div>
                    <div className="flex justify-between gap-2 pt-0.5 font-bold">
                      <span>Σ ردود الأفعال (P_service)</span>
                      <span className="font-mono">{fmt(equilibrium.sumReactions, 1)} kN</span>
                    </div>
                  </div>
                )}
              </div>

              {equilibrium.balanceErr !== null && (
                <div className={`rounded-xl p-3 text-center border ${
                  Math.abs(equilibrium.balanceErr) <= 2
                    ? 'bg-green-500/10 border-green-400/40'
                    : Math.abs(equilibrium.balanceErr) <= 8
                      ? 'bg-yellow-500/10 border-yellow-400/40'
                      : 'bg-red-500/10 border-red-400/40'
                }`}>
                  <div className="flex items-center justify-center gap-1.5 mb-0.5">
                    {Math.abs(equilibrium.balanceErr) <= 2 ? (
                      <CheckCircle2 size={15} className="text-green-600" />
                    ) : (
                      <AlertTriangle size={15} className={Math.abs(equilibrium.balanceErr) <= 8 ? 'text-yellow-600' : 'text-red-600'} />
                    )}
                    <span className="font-bold text-sm">
                      {Math.abs(equilibrium.balanceErr) <= 2
                        ? 'التوازن محقق ✓'
                        : Math.abs(equilibrium.balanceErr) <= 8
                          ? 'فرق بسيط — مراجعة'
                          : 'عدم توازن — فحص النموذج'}
                    </span>
                  </div>
                  <div className="font-mono font-bold text-lg">
                    {equilibrium.balanceErr > 0 ? '+' : ''}{equilibrium.balanceErr.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    (ردود أفعال − أحمال مطبقة) / أحمال مطبقة
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                    {Math.abs(equilibrium.balanceErr) <= 2
                      ? 'فرق ≤ 2% مقبول.'
                      : Math.abs(equilibrium.balanceErr) <= 8
                        ? 'فرق 2–8%: قد يعكس بلاطات مدمجة أو أحمال جدران جزئية.'
                        : 'فرق > 8%: يكشف عن بلاطات غير مربوطة بجسور أو أخطاء في النمذجة.'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── جدول الجسور ──────────────────────────────────────────────────────── */}
      <Card className="border-teal-200 dark:border-teal-800 bg-teal-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity size={16} className="text-teal-600" />
              لوحة تشخيص نقل الأحمال من البلاطة إلى الجسور
            </CardTitle>
            <Button size="sm" variant="outline" onClick={exportXlsx} className="h-8 text-xs gap-1">
              <Download size={12} /> تصدير Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] mb-3">
            {([
              ['2D',        totals.dl_2d, totals.ll_2d, 'bg-violet-500/10 border-violet-400/40 text-violet-700 dark:text-violet-300'],
              ['Voronoi',   totals.dl_3d, totals.ll_3d, 'bg-blue-500/10 border-blue-400/40 text-blue-700 dark:text-blue-300'],
              ['GF',         totals.dl_gf, totals.ll_gf, 'bg-amber-500/10 border-amber-400/40 text-amber-700 dark:text-amber-300'],
              ['UC',         totals.dl_uc, totals.ll_uc, 'bg-rose-500/10 border-rose-400/40 text-rose-700 dark:text-rose-300'],
            ] as const).map(([name, dl, ll, cls]) => (
              <div key={name} className={`rounded border px-2 py-2 ${cls}`}>
                <div className="font-semibold">{name}</div>
                <div className="font-mono">ΣDL·L = {fmt(dl, 1)} kN</div>
                <div className="font-mono">ΣLL·L = {fmt(ll, 1)} kN</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <Search size={14} className="text-muted-foreground" />
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="بحث برقم/معرّف الجسر..."
              className="h-8 text-xs max-w-[260px]"
            />
            <span className="text-[11px] text-muted-foreground">
              {filteredRows.length} / {rows.length} جسر
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="text-xs align-middle">Beam</TableHead>
                  <TableHead rowSpan={2} className="text-xs align-middle text-center">L (m)</TableHead>
                  <TableHead colSpan={2} className="text-xs text-center bg-violet-500/5 border-x">2D</TableHead>
                  <TableHead colSpan={2} className="text-xs text-center bg-blue-500/5 border-x">Voronoi</TableHead>
                  <TableHead colSpan={2} className="text-xs text-center bg-amber-500/5 border-x">GF</TableHead>
                  <TableHead colSpan={2} className="text-xs text-center bg-rose-500/5 border-x">UC</TableHead>
                  <TableHead rowSpan={2} className="text-xs align-middle text-center">حالة</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="text-[10px] text-center bg-violet-500/5 border-x">DL</TableHead>
                  <TableHead className="text-[10px] text-center bg-violet-500/5 border-x">LL</TableHead>
                  <TableHead className="text-[10px] text-center bg-blue-500/5 border-x">DL</TableHead>
                  <TableHead className="text-[10px] text-center bg-blue-500/5 border-x">LL</TableHead>
                  <TableHead className="text-[10px] text-center bg-amber-500/5 border-x">DL</TableHead>
                  <TableHead className="text-[10px] text-center bg-amber-500/5 border-x">LL</TableHead>
                  <TableHead className="text-[10px] text-center bg-rose-500/5 border-x">DL</TableHead>
                  <TableHead className="text-[10px] text-center bg-rose-500/5 border-x">LL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map(r => (
                  <TableRow key={r.beamId} className="text-xs">
                    <TableCell className="font-mono text-xs">{r.beamId}</TableCell>
                    <TableCell className="text-center font-mono">{fmt(r.length, 2)}</TableCell>
                    <TableCell className="text-center font-mono bg-violet-500/5">{fmt(r.dl_2d)}</TableCell>
                    <TableCell className="text-center font-mono bg-violet-500/5">{fmt(r.ll_2d)}</TableCell>
                    <TableCell className="text-center font-mono bg-blue-500/5">{fmt(r.dl_3d)}</TableCell>
                    <TableCell className="text-center font-mono bg-blue-500/5">{fmt(r.ll_3d)}</TableCell>
                    <TableCell className="text-center font-mono bg-amber-500/5">{fmt(r.dl_gf)}</TableCell>
                    <TableCell className="text-center font-mono bg-amber-500/5">{fmt(r.ll_gf)}</TableCell>
                    <TableCell className="text-center font-mono bg-rose-500/5">{fmt(r.dl_uc)}</TableCell>
                    <TableCell className="text-center font-mono bg-rose-500/5">{fmt(r.ll_uc)}</TableCell>
                    <TableCell className="text-center">{diffBadge(r.maxDiffPct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            الوحدات: kN/m (حمل خطي موزّع مكافئ). المرجع للمقارنة هو محرك 2D.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default SlabLoadDiagnosticPanel;
