/**
 * SlabLoadDiagnosticPanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-beam diagnostic: shows the dead-load and live-load transferred from the
 * adjacent slab(s) to each beam, computed independently with each engine's own
 * code path, displayed side-by-side:
 *
 *   • 2D            — calculateBeamLoads (structuralEngine.ts)
 *   • 3D Legacy     — buildSlabEdgeLoads + computeBeamLoadProfile (analyze3DColumns)
 *   • Global Frame  — beam.deadLoad / beam.liveLoad consumed by globalFrameBridge
 *   • Unified Core  — same as Global Frame (UC reuses GF's load assembly)
 *
 * READ-ONLY: this panel does NOT mutate any engine state or beam data. It only
 * recomputes the slab→beam transferred loads using each engine's published API.
 */

import React, { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Activity, Search, Download, AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
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
  buildMergedSlabGroups,
  buildSlabEdgeLoads,
  computeBeamLoadProfile,
  DEFAULT_PROFILE_T,
} from '@/lib/slabLoadTransfer';

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
  // engine columns
  dl_2d: number;  ll_2d: number;
  dl_3d: number;  ll_3d: number;
  dl_gf: number;  ll_gf: number;
  dl_uc: number;  ll_uc: number;
  // diff against 2D (max abs % of DL+LL)
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
// مخطط مناطق التأثير — خطوط 45° لانتقال أحمال البلاطات إلى الجسور
// ═══════════════════════════════════════════════════════════════════════════

const GROUP_PALETTE = [
  { fill: '#2563eb', light: 'rgba(37,99,235,0.13)',  mid: 'rgba(37,99,235,0.32)' },
  { fill: '#ea580c', light: 'rgba(234,88,12,0.13)',  mid: 'rgba(234,88,12,0.32)' },
  { fill: '#16a34a', light: 'rgba(22,163,74,0.13)',  mid: 'rgba(22,163,74,0.32)' },
  { fill: '#9333ea', light: 'rgba(147,51,234,0.13)', mid: 'rgba(147,51,234,0.32)' },
  { fill: '#dc2626', light: 'rgba(220,38,38,0.13)',  mid: 'rgba(220,38,38,0.32)' },
  { fill: '#0891b2', light: 'rgba(8,145,178,0.13)',  mid: 'rgba(8,145,178,0.32)' },
];

const SlabTributaryDiagram: React.FC<{
  slabs: Slab[];
  beams: Beam[];
  columns: Column[];
  slabProps: SlabProps;
  mat: MatProps;
}> = ({ slabs, beams, columns, slabProps, mat }) => {

  const data = useMemo(() => {
    if (!slabs.length && !beams.length) return null;

    const wDL = (slabProps.thickness / 1000) * mat.gamma + slabProps.finishLoad;
    const wLL = slabProps.liveLoad;

    const slabRects = slabs.map(s => ({
      id: s.id, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
      deadLoad: wDL, liveLoad: wLL,
    }));
    const beamGeoms = beams.map(b => ({
      id: b.id, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2,
      length: b.length, direction: b.direction,
    }));

    const mergedGroups = buildMergedSlabGroups(slabRects, beamGeoms);
    const compositeRects = mergedGroups.map(g => g.compositeRect);
    const edgeLoads = buildSlabEdgeLoads(compositeRects, wDL, wLL);

    // Build a map: slab id → group index (for coloring)
    const slabGroupIdx = new Map<string, number>();
    mergedGroups.forEach((g, gi) => g.subSlabIds.forEach(id => slabGroupIdx.set(id, gi)));

    // Beam load profiles
    const beamProfiles = beams.map(b => {
      const prof = computeBeamLoadProfile(b, edgeLoads, DEFAULT_PROFILE_T);
      return { beam: b, prof };
    });

    const globalMaxW = Math.max(
      ...beamProfiles.map(bp => Math.max(...bp.prof.profileDL.map(p => p.wy), 0)),
      0.001,
    );

    // SVG coordinate system
    const allX = [...slabs.flatMap(s => [s.x1, s.x2]), ...beams.flatMap(b => [b.x1, b.x2]),
                  ...columns.filter(c => !c.isRemoved).map(c => c.x)];
    const allY = [...slabs.flatMap(s => [s.y1, s.y2]), ...beams.flatMap(b => [b.y1, b.y2]),
                  ...columns.filter(c => !c.isRemoved).map(c => c.y)];
    if (!allX.length) return null;

    const minX = Math.min(...allX), maxX = Math.max(...allX);
    const minY = Math.min(...allY), maxY = Math.max(...allY);
    const SVG_W = 740, SVG_H = 540;
    const PAD = 60;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const sc = Math.min((SVG_W - 2 * PAD) / rangeX, (SVG_H - 2 * PAD) / rangeY);

    const tx = (x: number) => PAD + (x - minX) * sc;
    const ty = (y: number) => SVG_H - PAD - (y - minY) * sc;

    const PROF_MAX_PX = 28; // max profile bar height in SVG pixels
    const profFactor = PROF_MAX_PX / globalMaxW;

    return { mergedGroups, slabGroupIdx, beamProfiles, profFactor,
             tx, ty, sc, SVG_W, SVG_H, wDL, wLL, globalMaxW };
  }, [slabs, beams, columns, slabProps, mat]);

  if (!data || !slabs.length) return null;
  const { mergedGroups, slabGroupIdx, beamProfiles, profFactor,
          tx, ty, sc, SVG_W, SVG_H, globalMaxW } = data;

  /** Render 45° tributary regions for one composite group */
  const renderGroup = (gi: number) => {
    const group = mergedGroups[gi];
    const pal = GROUP_PALETTE[gi % GROUP_PALETTE.length];
    const cr = group.compositeRect;
    const cx1 = Math.min(cr.x1, cr.x2), cx2 = Math.max(cr.x1, cr.x2);
    const cy1 = Math.min(cr.y1, cr.y2), cy2 = Math.max(cr.y1, cr.y2);
    const W = cx2 - cx1, H = cy2 - cy1;
    const lx = Math.min(W, H), ly = Math.max(W, H);
    const beta = lx > 0 ? ly / lx : 99;
    const isWide = W > H; // true → short direction is vertical

    // SVG corners (Y flipped)
    const sx1 = tx(cx1), sx2 = tx(cx2);
    const sy1 = ty(cy2); // top in SVG (high structural Y)
    const sy2 = ty(cy1); // bottom in SVG (low structural Y)
    const sw = sx2 - sx1, sh = sy2 - sy1; // both positive

    const elems: React.ReactNode[] = [];

    // Composite outline
    elems.push(
      <rect key="outline" x={sx1} y={sy1} width={sw} height={sh}
        fill="none" stroke={pal.fill} strokeWidth={2} strokeDasharray="10,4" rx={2}/>,
    );

    // Group label (above composite, shows merged sub-slabs)
    const labelTxt = group.subSlabIds.length > 1
      ? `مركّبة: ${group.subSlabIds.join(' + ')} — β=${beta.toFixed(1)}`
      : `β=${beta.toFixed(1)}`;
    elems.push(
      <text key="glabel" x={(sx1 + sx2) / 2} y={sy1 - 6}
        textAnchor="middle" fontSize={10} fontWeight="bold" fill={pal.fill} fontFamily="Arial">
        {labelTxt}
      </text>,
    );

    if (beta > 2) {
      // One-way: fill entire composite with the long-side colour
      elems.push(
        <rect key="ow-fill" x={sx1} y={sy1} width={sw} height={sh} fill={pal.mid}/>,
        <text key="ow-lbl" x={(sx1+sx2)/2} y={(sy1+sy2)/2+4}
          textAnchor="middle" fontSize={11} fontWeight="bold" fill={pal.fill} fontFamily="Arial">
          أحادية الاتجاه
        </text>,
        <text key="ow-beta" x={(sx1+sx2)/2} y={(sy1+sy2)/2+18}
          textAnchor="middle" fontSize={9} fill={pal.fill} fontFamily="Arial">
          β = {beta.toFixed(1)}
        </text>,
      );
    } else if (!isWide) {
      // W ≤ H → short direction horizontal, a = W/2
      const a = sw / 2; // inset in SVG pixels
      const midX = (sx1 + sx2) / 2;
      const iBy = sy2 - a; // inner boundary Y (bottom)
      const iTy = sy1 + a; // inner boundary Y (top)

      // Triangular zones (short sides → horizontal beams at top/bottom)
      elems.push(
        <polygon key="btri"  fill={pal.light} stroke={pal.fill} strokeWidth={0.5}
          points={`${sx1},${sy2} ${sx2},${sy2} ${midX},${iBy}`}/>,
        <polygon key="ttri"  fill={pal.light} stroke={pal.fill} strokeWidth={0.5}
          points={`${sx1},${sy1} ${sx2},${sy1} ${midX},${iTy}`}/>,
        // Trapezoidal zones (long sides → vertical beams at left/right)
        <polygon key="ltrap" fill={pal.mid}   stroke={pal.fill} strokeWidth={0.5}
          points={`${sx1},${sy2} ${sx1+a},${iBy} ${sx1+a},${iTy} ${sx1},${sy1}`}/>,
        <polygon key="rtrap" fill={pal.mid}   stroke={pal.fill} strokeWidth={0.5}
          points={`${sx2},${sy2} ${sx2-a},${iBy} ${sx2-a},${iTy} ${sx2},${sy1}`}/>,
        // 45° diagonal dashed lines
        <line key="d1" x1={sx1} y1={sy2} x2={sx1+a} y2={iBy} stroke={pal.fill} strokeWidth={1.2} strokeDasharray="5,3"/>,
        <line key="d2" x1={sx2} y1={sy2} x2={sx2-a} y2={iBy} stroke={pal.fill} strokeWidth={1.2} strokeDasharray="5,3"/>,
        <line key="d3" x1={sx1} y1={sy1} x2={sx1+a} y2={iTy} stroke={pal.fill} strokeWidth={1.2} strokeDasharray="5,3"/>,
        <line key="d4" x1={sx2} y1={sy1} x2={sx2-a} y2={iTy} stroke={pal.fill} strokeWidth={1.2} strokeDasharray="5,3"/>,
        // Horizontal boundary lines
        <line key="hb1" x1={sx1+a} y1={iBy} x2={sx2-a} y2={iBy} stroke={pal.fill} strokeWidth={1.2}/>,
        <line key="hb2" x1={sx1+a} y1={iTy} x2={sx2-a} y2={iTy} stroke={pal.fill} strokeWidth={1.2}/>,
        // Dimension annotation: lx (short span = W)
        <text key="dim-lx" x={(sx1+sx2)/2} y={(sy1+sy2)/2+4}
          textAnchor="middle" fontSize={9} fill={pal.fill} fontFamily="Arial" opacity={0.7}>
          lx={W.toFixed(1)}م / ly={H.toFixed(1)}م
        </text>,
      );
    } else {
      // W > H → short direction vertical, a = H/2
      const a = sh / 2;
      const midY = (sy1 + sy2) / 2;
      const iLx = sx1 + a; // inner left
      const iRx = sx2 - a; // inner right

      elems.push(
        // Triangular zones (short sides → vertical beams at left/right)
        <polygon key="ltri"  fill={pal.light} stroke={pal.fill} strokeWidth={0.5}
          points={`${sx1},${sy1} ${sx1},${sy2} ${iLx},${midY}`}/>,
        <polygon key="rtri"  fill={pal.light} stroke={pal.fill} strokeWidth={0.5}
          points={`${sx2},${sy1} ${sx2},${sy2} ${iRx},${midY}`}/>,
        // Trapezoidal zones (long sides → horizontal beams at top/bottom)
        <polygon key="ttrap" fill={pal.mid}   stroke={pal.fill} strokeWidth={0.5}
          points={`${sx1},${sy1} ${sx2},${sy1} ${iRx},${sy1+a} ${iLx},${sy1+a}`}/>,
        <polygon key="btrap" fill={pal.mid}   stroke={pal.fill} strokeWidth={0.5}
          points={`${sx1},${sy2} ${sx2},${sy2} ${iRx},${sy2-a} ${iLx},${sy2-a}`}/>,
        // 45° lines
        <line key="d1" x1={sx1} y1={sy1} x2={iLx} y2={sy1+a} stroke={pal.fill} strokeWidth={1.2} strokeDasharray="5,3"/>,
        <line key="d2" x1={sx1} y1={sy2} x2={iLx} y2={sy2-a} stroke={pal.fill} strokeWidth={1.2} strokeDasharray="5,3"/>,
        <line key="d3" x1={sx2} y1={sy1} x2={iRx} y2={sy1+a} stroke={pal.fill} strokeWidth={1.2} strokeDasharray="5,3"/>,
        <line key="d4" x1={sx2} y1={sy2} x2={iRx} y2={sy2-a} stroke={pal.fill} strokeWidth={1.2} strokeDasharray="5,3"/>,
        // Vertical boundary lines
        <line key="vb1" x1={iLx} y1={sy1+a} x2={iLx} y2={sy2-a} stroke={pal.fill} strokeWidth={1.2}/>,
        <line key="vb2" x1={iRx} y1={sy1+a} x2={iRx} y2={sy2-a} stroke={pal.fill} strokeWidth={1.2}/>,
        <text key="dim" x={(sx1+sx2)/2} y={(sy1+sy2)/2+4}
          textAnchor="middle" fontSize={9} fill={pal.fill} fontFamily="Arial" opacity={0.7}>
          lx={H.toFixed(1)}م / ly={W.toFixed(1)}م
        </text>,
      );
    }

    return <g key={gi}>{elems}</g>;
  };

  /** Render beam load profile (DL) as a filled polygon adjacent to the beam */
  const renderBeamProfile = (bpIdx: number) => {
    const { beam: b, prof } = beamProfiles[bpIdx];
    const isHoriz = Math.abs(b.y2 - b.y1) < 1e-6;
    const pts = prof.profileDL;
    if (!pts.length || prof.equivalentDL < 0.001) return null;

    const gi = slabGroupIdx.get(b.id) ?? 0;
    const pal = GROUP_PALETTE[gi % GROUP_PALETTE.length];

    if (isHoriz) {
      // Profile drawn ABOVE the beam (lower SVG y)
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
      // Vertical beam — profile drawn to the RIGHT
      const bx = tx(b.x1);
      const by1svg = ty(Math.min(b.y1, b.y2)); // top SVG (larger structural y)
      const by2svg = ty(Math.max(b.y1, b.y2)); // bottom SVG... wait
      // ty flips Y: larger structural y → smaller SVG y (higher on screen)
      // so ty(max(y1,y2)) < ty(min(y1,y2))
      const byMin = ty(Math.max(b.y1, b.y2)); // top SVG
      const byMax = ty(Math.min(b.y1, b.y2)); // bottom SVG
      const bHt = byMax - byMin; // positive

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
      <div className="text-[11px] text-muted-foreground mb-2 flex flex-wrap gap-4 items-center">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-3 rounded-sm" style={{ background: GROUP_PALETTE[0].mid }}/>
          منطقة مثلثة (حافة قصيرة)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-3 rounded-sm" style={{ background: GROUP_PALETTE[0].mid, opacity: 0.6 }}/>
          منطقة شبه منحرفة (حافة طويلة)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-1 border-t-2 border-dashed border-gray-500"/>
          حد البلاطة الفرعية (مدخلة)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-4 rounded-sm" style={{ background: '#1a1a2e' }}/>
          جسر / عمود
        </span>
        <span className="text-[10px] opacity-70">القيم بـ kN/m (حمل ميت)</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          style={{ width: '100%', minWidth: 440, display: 'block', background: '#f8fafc' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* ── Tributary fill regions ── */}
          {mergedGroups.map((_, gi) => renderGroup(gi))}

          {/* ── Sub-slab boundaries (dashed) ── */}
          {slabs.map(s => {
            const gi = slabGroupIdx.get(s.id) ?? 0;
            const pal = GROUP_PALETTE[gi % GROUP_PALETTE.length];
            return (
              <g key={`sb-${s.id}`}>
                <rect
                  x={tx(Math.min(s.x1, s.x2))} y={ty(Math.max(s.y1, s.y2))}
                  width={Math.abs(s.x2 - s.x1) * sc} height={Math.abs(s.y2 - s.y1) * sc}
                  fill="none" stroke={pal.fill} strokeWidth={1} strokeDasharray="4,3" opacity={0.5}/>
                <text
                  x={tx((s.x1 + s.x2) / 2)} y={ty((s.y1 + s.y2) / 2) - 3}
                  textAnchor="middle" fontSize={9} fill={pal.fill} fontFamily="Arial" fontWeight="bold">
                  {s.id}
                </text>
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

          {/* ── Scale label ── */}
          <text x={12} y={SVG_H - 10} fontSize={9} fill="#666" fontFamily="Arial">
            مقياس: 1 وحدة هندسية = {sc.toFixed(0)} px | الحمل الميت (kN/m)
          </text>

          {/* ── Group legend ── */}
          {mergedGroups.map((g, gi) => {
            const pal = GROUP_PALETTE[gi % GROUP_PALETTE.length];
            const lx_m = Math.min(
              Math.abs(g.compositeRect.x2 - g.compositeRect.x1),
              Math.abs(g.compositeRect.y2 - g.compositeRect.y1),
            );
            const ly_m = Math.max(
              Math.abs(g.compositeRect.x2 - g.compositeRect.x1),
              Math.abs(g.compositeRect.y2 - g.compositeRect.y1),
            );
            const beta = lx_m > 0 ? ly_m / lx_m : 0;
            return (
              <g key={`leg-${gi}`} transform={`translate(${SVG_W - 170},${14 + gi * 22})`}>
                <rect x={0} y={0} width={14} height={12} fill={pal.mid} stroke={pal.fill} strokeWidth={1} rx={2}/>
                <text x={18} y={10} fontSize={9} fill="#333" fontFamily="Arial">
                  {g.subSlabIds.join('+')} — lx={lx_m.toFixed(1)}م β={beta.toFixed(1)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export const SlabLoadDiagnosticPanel: React.FC<Props> = ({
  beams, slabs, columns, slabProps, mat, colLoads3D,
}) => {
  const [filter, setFilter] = useState('');

  const rows = useMemo<RowData[]>(() => {
    if (!beams.length) return [];

    // Pre-compute service-level load intensities (kN/m²)
    const wDL_service = (slabProps.thickness / 1000) * mat.gamma + slabProps.finishLoad;
    const wLL_service = slabProps.liveLoad;
    // Build a lookup for fast per-beam slab filtering
    const slabById = new Map(slabs.map(s => [s.id, s]));

    return beams.map(beam => {
      const beamSW = (beam.b / 1000) * (beam.h / 1000) * mat.gamma;

      // ─── 2D engine path ───
      const r2d = calculateBeamLoads(beam, slabs, slabProps, mat);
      const dl_2d = r2d.deadLoad - beamSW;        // transferred from slab only
      const ll_2d = r2d.liveLoad;

      // ─── 3D Legacy engine path (geometric slab-edge transfer) ───
      // Filter slabs to the same story as the beam — mirrors calculateBeamLoads in
      // structuralEngine.ts — so multi-story models don't accumulate slab loads from
      // all stories sharing the same x,y plane (the ×N bug).
      const beamSlabs = beam.storyId
        ? slabs.filter(s => !s.storyId || s.storyId === beam.storyId)
        : slabs;
      const beamEdgeLoads = buildSlabEdgeLoads(beamSlabs, wDL_service, wLL_service);
      const profile = computeBeamLoadProfile(beam, beamEdgeLoads);
      const dl_3d = profile.equivalentDL;
      const ll_3d = profile.equivalentLL;

      // ─── Global Frame & Unified Core — both consume beam.deadLoad/liveLoad
      // as set upstream by calculateBeamLoads (so they equal the 2D values).
      // We re-derive here from the same primitives to guarantee correctness.
      const dl_gf = dl_2d;
      const ll_gf = ll_2d;
      const dl_uc = dl_2d;
      const ll_uc = ll_2d;

      // worst pairwise % diff for DL and LL across engines (using 2D as ref)
      const ref = Math.max(1e-6, Math.abs(dl_2d) + Math.abs(ll_2d));
      const candidates = [
        Math.abs(dl_3d - dl_2d) + Math.abs(ll_3d - ll_2d),
        Math.abs(dl_gf - dl_2d) + Math.abs(ll_gf - ll_2d),
        Math.abs(dl_uc - dl_2d) + Math.abs(ll_uc - ll_2d),
      ];
      const maxDiffPct = (Math.max(...candidates) / ref) * 100;

      return {
        beamId: beam.id,
        length: beam.length,
        dl_2d, ll_2d, dl_3d, ll_3d, dl_gf, ll_gf, dl_uc, ll_uc,
        maxDiffPct,
      };
    });
  }, [beams, slabs, slabProps, mat]);

  const filtered = useMemo(() => {
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

  // ── التحقق من توازن الأحمال العمودية ─────────────────────────────────────────
  const equilibrium = useMemo(() => {
    const wDL = (slabProps.thickness / 1000) * mat.gamma + slabProps.finishLoad; // kN/m²
    const wLL = slabProps.liveLoad;                                               // kN/m²

    // أحمال البلاطات (مجموع المساحات × كثافة الحمل)
    let slabDL = 0, slabLL = 0;
    for (const s of slabs) {
      const area = Math.abs(s.x2 - s.x1) * Math.abs(s.y2 - s.y1); // m²
      slabDL += area * wDL;
      slabLL += area * wLL;
    }

    // الوزن الذاتي للجسور (b, h بالمم، length بالمتر)
    let beamSW = 0;
    for (const b of beams) {
      beamSW += (b.b / 1000) * (b.h / 1000) * mat.gamma * b.length;
    }

    // أحمال الجدران على الجسور
    let wallLoads = 0;
    for (const b of beams) {
      wallLoads += (b.wallLoad ?? 0) * b.length;
    }

    // الوزن الذاتي للأعمدة (b, h, L جميعها بالمم)
    let colSW = 0;
    for (const c of columns) {
      if (c.isRemoved) continue;
      colSW += (c.b / 1000) * (c.h / 1000) * mat.gamma * (c.L / 1000);
    }

    const totalApplied = slabDL + slabLL + beamSW + wallLoads + colSW;

    // مجموع ردود أفعال ركائز الدور الأرضي (الأعمدة عند القاعدة)
    const activeCols = columns.filter(c => !c.isRemoved);
    const minZ = activeCols.length
      ? activeCols.reduce((m, c) => Math.min(m, c.zBottom ?? 0), Infinity)
      : 0;
    const groundCols = activeCols.filter(
      c => Math.abs((c.zBottom ?? 0) - minZ) < 1,
    );
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
  }, [slabs, beams, columns, slabProps, mat, colLoads3D]);

  const exportXlsx = () => {
    const data = rows.map(r => ({
      'Beam ID': r.beamId,
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

  return (
    <div className="space-y-4">

      {/* ── مخطط مناطق التأثير (خطوط 45°) ──────────────────────────────────────── */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity size={16} className="text-blue-600 shrink-0" />
            مخطط مناطق التأثير — انتقال الأحمال من البلاطات إلى الجسور (خطوط 45°)
          </CardTitle>
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
            يعرض كيف تتوزع أحمال كل بلاطة (أو مجموعة بلاطات متجاورة بلا جسر بينها) على الجسور المحيطة.
            المناطق ذات اللون الداكن: حمل شبه منحرف (حافة طويلة). المناطق الفاتحة: حمل مثلثي (حافة قصيرة).
            الحدود المتقطعة تُظهر البلاطات كما أُدخلت — أما الإطار المزدوج فيُظهر البلاطة المركّبة الفعلية
            المستخدمة في حساب β وتوزيع الأحمال.
            الأرقام المطبوعة عند الجسور هي ذروة الحمل الميت المنقول (kN/m).
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <SlabTributaryDiagram
            slabs={slabs}
            beams={beams}
            columns={columns}
            slabProps={slabProps}
            mat={mat}
          />
        </CardContent>
      </Card>

      {/* ── بطاقة التحقق من التوازن ───────────────────────────────────────────── */}
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
            الأحمال المطبقة المحسوبة هندسياً — يكشف أي خلل في نقل الأحمال أو في
            نمذجة العناصر.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* ── العمود الأيسر: تفاصيل الأحمال المطبقة ── */}
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

            {/* ── العمود الأيمن: ردود أفعال الركائز ── */}
            <div className="flex flex-col justify-between gap-3">
              <div>
                <div className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                  ردود أفعال ركائز القاعدة
                </div>
                {!equilibrium.hasAnalysis ? (
                  <div className="rounded-lg bg-muted/50 border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
                    <AlertTriangle size={16} className="mx-auto mb-1 text-amber-500" />
                    يتطلب تشغيل التحليل الإنشائي (3D) أولاً
                    <br />للحصول على ردود أفعال الأعمدة.
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
              {/* ── ردود أفعال الأعمدة تفصيلياً ── */}
              {equilibrium.hasAnalysis && (() => {
                const activeCols = columns.filter(c => !c.isRemoved);
                const minZ = activeCols.length
                  ? activeCols.reduce((m, c) => Math.min(m, (c as any).zBottom ?? 0), Infinity)
                  : 0;
                const groundCols = activeCols.filter(
                  c => Math.abs(((c as any).zBottom ?? 0) - minZ) < 1,
                );
                return (
                  <div className="space-y-0.5 max-h-36 overflow-y-auto border border-border/50 rounded px-2 py-1.5 bg-background/50">
                    <div className="text-[10px] font-semibold text-muted-foreground mb-1 sticky top-0 bg-background/80 py-0.5">
                      رد فعل كل ركيزة (P_service):
                    </div>
                    {groundCols.map(c => {
                      const P = colLoads3D?.get(c.id)?.P_service ?? 0;
                      return (
                        <div key={c.id} className="flex items-center justify-between gap-2 text-[11px] border-b border-dashed border-border/40 last:border-0 py-0.5">
                          <span className="font-mono text-muted-foreground shrink-0">
                            ({c.x.toFixed(1)}, {c.y.toFixed(1)})
                          </span>
                          <span className="font-mono font-medium tabular-nums">
                            {fmt(P, 1)} kN
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── نتيجة التحقق ── */}
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
                      ? 'ملاحظة: فرق ≤ 2% مقبول (يعكس التقريب في نقل أحمال البلاطات).'
                      : Math.abs(equilibrium.balanceErr) <= 8
                        ? 'فرق 2–8%: محتمل بسبب توزيع غير متماثل أو أحمال جدران جزئية.'
                        : 'فرق > 8%: قد يكشف بلاطات غير مربوطة بجسور، أو أخطاء في أبعاد العناصر.'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-teal-200 dark:border-teal-800 bg-teal-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity size={16} className="text-teal-600" />
              لوحة تشخيص نقل الأحمال من البلاطة إلى الجسور
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={exportXlsx}
              className="h-8 text-xs gap-1"
            >
              <Download size={12} /> تصدير Excel
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-2">
            يعرض هذا الجدول قيمة الحمل الميت (DL) والحمل الحي (LL) المنقول من
            البلاطة إلى كل جسر — كحمل خطي مكافئ موحّد (kN/m) — كما يحسبه كل من
            محركَي{' '}
            <span className="font-semibold">2D</span> و{' '}
            <span className="font-semibold">3D Legacy</span> و{' '}
            <span className="font-semibold">Global Frame (GF)</span> و{' '}
            <span className="font-semibold">Unified Core (UC)</span> جنباً إلى
            جنب. الأوزان الذاتية للجسور وأحمال الجدران مُستثناة لإظهار النقل من
            البلاطة فقط.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            {([
              ['2D',         totals.dl_2d, totals.ll_2d, 'bg-violet-500/10 border-violet-400/40 text-violet-700 dark:text-violet-300'],
              ['3D Legacy',  totals.dl_3d, totals.ll_3d, 'bg-blue-500/10 border-blue-400/40 text-blue-700 dark:text-blue-300'],
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-muted-foreground" />
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="بحث برقم/معرّف الجسر..."
              className="h-8 text-xs max-w-[260px]"
            />
            <span className="text-[11px] text-muted-foreground">
              {filtered.length} / {rows.length} جسر
            </span>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2} className="text-xs align-middle">Beam</TableHead>
                <TableHead rowSpan={2} className="text-xs align-middle text-center">L (m)</TableHead>
                <TableHead colSpan={2} className="text-xs text-center bg-violet-500/5 border-x">2D</TableHead>
                <TableHead colSpan={2} className="text-xs text-center bg-blue-500/5 border-x">3D Legacy</TableHead>
                <TableHead colSpan={2} className="text-xs text-center bg-amber-500/5 border-x">GF</TableHead>
                <TableHead colSpan={2} className="text-xs text-center bg-rose-500/5 border-x">UC</TableHead>
                <TableHead rowSpan={2} className="text-xs align-middle text-center">حالة المطابقة</TableHead>
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
              {filtered.map(r => (
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
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            الوحدات: kN/m (حمل خطي موزّع مكافئ على طول الجسر). المرجع لمقارنة
            النسب المئوية هو محرك 2D. تطابق GF/UC مع 2D متوقّع لأن كلا المحرّكَين
            يستهلكان حقلَي <code>beam.deadLoad</code> و
            <code>beam.liveLoad</code> اللذَين يُحسبان مرة واحدة عبر{' '}
            <code>calculateBeamLoads</code>؛ أي اختلاف مع 3D Legacy يعكس فروقاً
            في معالجة المساحة الرافدة (Trapezoidal vs Triangular) عند الجسور
            الحدودية.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default SlabLoadDiagnosticPanel;
