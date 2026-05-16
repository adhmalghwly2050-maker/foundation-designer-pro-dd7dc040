/**
 * DXF Exporter - AutoCAD Compatible
 * Multi-story layer system (DXF-1) & annotative blocks (DXF-2)
 */

import type { Slab, Column, Beam, Story } from '@/lib/structuralEngine';
import type { FlexureResult, ShearResult } from '@/lib/structuralEngine';

// =================== DXF-1: MULTI-STORY LAYER SYSTEM ===================

function getLayersByStory(storyLabel: string) {
  return {
    BEAMS: { name: `${storyLabel}_BEAMS`, color: 3 },
    COLUMNS: { name: `${storyLabel}_COLUMNS`, color: 1 },
    SLABS: { name: `${storyLabel}_SLABS`, color: 5 },
    GRID: { name: `${storyLabel}_GRID`, color: 8 },
    TEXT: { name: `${storyLabel}_TEXT`, color: 7 },
    DIM: { name: `${storyLabel}_DIM`, color: 2 },
    REBAR_T: { name: `${storyLabel}_REBAR_T`, color: 6 },
    REBAR_B: { name: `${storyLabel}_REBAR_B`, color: 4 },
    STIRRUPS: { name: `${storyLabel}_STIR`, color: 2 },
  };
}

const GLOBAL_LAYERS = {
  BEAMS: { name: 'BEAMS', color: 3 },
  COLUMNS: { name: 'COLUMNS', color: 1 },
  SLABS: { name: 'SLABS', color: 5 },
  GRID: { name: 'GRID', color: 8 },
  TEXT: { name: 'TEXT', color: 7 },
  DIMENSIONS: { name: 'DIMENSIONS', color: 2 },
  BEAM_LAYOUT: { name: 'BEAM_LAYOUT', color: 3 },
  COLUMN_LAYOUT: { name: 'COLUMN_LAYOUT', color: 1 },
  REBAR_TOP: { name: 'REBAR_TOP', color: 6 },
  REBAR_BOTTOM: { name: 'REBAR_BOTTOM', color: 4 },
  STIRRUPS: { name: 'STIRRUPS', color: 2 },
  REBAR_LAYOUT: { name: 'REBAR_LAYOUT', color: 6 },
};

function dxfHeader(): string {
  return `0\nSECTION\n2\nHEADER\n0\nENDSEC\n`;
}

function dxfTablesMultiStory(stories?: Story[]): string {
  const allLayers: { name: string; color: number }[] = [...Object.values(GLOBAL_LAYERS)];

  if (stories && stories.length > 0) {
    for (const story of stories) {
      const storyLayers = getLayersByStory(story.label.replace(/\s/g, '_'));
      allLayers.push(...Object.values(storyLayers));
    }
  }

  // Deduplicate
  const unique = new Map<string, number>();
  for (const l of allLayers) unique.set(l.name, l.color);

  const layerEntries = [...unique.entries()].map(([name, color]) =>
    `0\nLAYER\n2\n${name}\n70\n0\n62\n${color}\n6\nCONTINUOUS`
  ).join('\n');

  return `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n${unique.size}\n${layerEntries}\n0\nENDTAB\n0\nENDSEC\n`;
}

// =================== DXF-2: ANNOTATIVE BLOCKS ===================

function dxfBlocksSection(columns: Column[]): string {
  const sizes = new Set<string>();
  for (const c of columns) {
    if (!c.isRemoved) sizes.add(`${c.b}x${c.h}`);
  }

  let blocks = '0\nSECTION\n2\nBLOCKS\n';
  for (const size of sizes) {
    const [bStr, hStr] = size.split('x');
    const b = parseInt(bStr) / 1000;
    const h = parseInt(hStr) / 1000;
    const hw = b / 2, hh = h / 2;
    blocks += `0\nBLOCK\n8\n0\n2\nCOLUMN_${size}\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n`;
    blocks += dxfLine(-hw, -hh, hw, -hh, 'COLUMNS');
    blocks += dxfLine(hw, -hh, hw, hh, 'COLUMNS');
    blocks += dxfLine(hw, hh, -hw, hh, 'COLUMNS');
    blocks += dxfLine(-hw, hh, -hw, -hh, 'COLUMNS');
    // Cross hatching
    blocks += dxfLine(-hw, -hh, hw, hh, 'COLUMNS');
    blocks += dxfLine(hw, -hh, -hw, hh, 'COLUMNS');
    blocks += `0\nENDBLK\n8\n0\n`;
  }
  blocks += '0\nENDSEC\n';
  return blocks;
}

function dxfInsert(blockName: string, x: number, y: number, layer: string): string {
  return `0\nINSERT\n8\n${layer}\n2\n${blockName}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0.0\n`;
}

function dxfLine(x1: number, y1: number, x2: number, y2: number, layer: string): string {
  return `0\nLINE\n8\n${layer}\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n30\n0.0\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n31\n0.0\n`;
}

function dxfPolyline(points: { x: number; y: number }[], layer: string, closed: boolean = true): string {
  const vertices = points.map(p => `0\nVERTEX\n8\n${layer}\n10\n${p.x.toFixed(4)}\n20\n${p.y.toFixed(4)}\n30\n0.0`).join('\n');
  return `0\nPOLYLINE\n8\n${layer}\n66\n1\n70\n${closed ? 1 : 0}\n${vertices}\n0\nSEQEND\n8\n${layer}\n`;
}

function dxfText(x: number, y: number, text: string, layer: string, height: number = 0.2): string {
  return `0\nTEXT\n8\n${layer}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0.0\n40\n${height}\n1\n${text}\n`;
}

function dxfCircle(x: number, y: number, r: number, layer: string): string {
  return `0\nCIRCLE\n8\n${layer}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0.0\n40\n${r.toFixed(4)}\n`;
}

function dxfDimension(x1: number, y1: number, x2: number, y2: number, layer: string, offset: number = 0.5): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const isHorizontal = Math.abs(y2 - y1) < 0.01;
  const dimX = isHorizontal ? mx : x1 - offset;
  const dimY = isHorizontal ? y1 - offset : my;
  return `0\nDIMENSION\n8\n${layer}\n10\n${dimX.toFixed(4)}\n20\n${dimY.toFixed(4)}\n30\n0.0\n11\n${mx.toFixed(4)}\n21\n${my.toFixed(4)}\n31\n0.0\n13\n${x1.toFixed(4)}\n23\n${y1.toFixed(4)}\n33\n0.0\n14\n${x2.toFixed(4)}\n24\n${y2.toFixed(4)}\n34\n0.0\n70\n0\n1\n${dist.toFixed(2)}m\n`;
}

// =================== STRUCTURAL EXPORT (Multi-story) ===================

export function generateStructuralDXF(
  slabs: Slab[],
  beams: Beam[],
  columns: Column[],
  stories?: Story[],
): string {
  let entities = '';

  // Group by story for multi-story offset
  const storyGroups = new Map<string, { slabs: Slab[]; beams: Beam[]; columns: Column[]; yOffset: number; label: string }>();

  if (stories && stories.length > 1) {
    // Calculate Y-offset for vertical stacking
    const allY = slabs.flatMap(s => [s.y1, s.y2]);
    const rangeY = allY.length > 0 ? Math.max(...allY) - Math.min(...allY) : 10;
    const gap = rangeY + 5;

    stories.forEach((story, i) => {
      const layerPrefix = story.label.replace(/\s/g, '_');
      storyGroups.set(story.id, {
        slabs: slabs.filter(s => s.storyId === story.id),
        beams: beams.filter(b => b.storyId === story.id),
        columns: columns.filter(c => c.storyId === story.id),
        yOffset: i * gap,
        label: layerPrefix,
      });
    });
  } else {
    storyGroups.set('all', {
      slabs, beams, columns, yOffset: 0, label: '',
    });
  }

  for (const [storyId, group] of storyGroups) {
    const yOff = group.yOffset;
    const layerPrefix = group.label;
    const layers = layerPrefix ? getLayersByStory(layerPrefix) : GLOBAL_LAYERS;
    const gridLayer = (layers as any).GRID?.name || 'GRID';
    const textLayer = (layers as any).TEXT?.name || 'TEXT';
    const beamLayer = (layers as any).BEAMS?.name || 'BEAMS';
    const colLayer = (layers as any).COLUMNS?.name || 'COLUMNS';
    const slabLayer = (layers as any).SLABS?.name || 'SLABS';
    const dimLayer = (layers as any).DIM?.name || (layers as any).DIMENSIONS?.name || 'DIMENSIONS';

    // Floor label
    if (layerPrefix) {
      entities += dxfText(-3, yOff + 2, group.label, textLayer, 0.5);
    }

    // Grid lines
    const allX = [...new Set(group.slabs.flatMap(s => [s.x1, s.x2]))].sort((a, b) => a - b);
    const allY = [...new Set(group.slabs.flatMap(s => [s.y1, s.y2]))].sort((a, b) => a - b);
    if (allX.length === 0) continue;

    const minX = Math.min(...allX) - 1;
    const maxX = Math.max(...allX) + 1;
    const minY = Math.min(...allY) - 1 + yOff;
    const maxY = Math.max(...allY) + 1 + yOff;

    // Grid labels (A, B, C / 1, 2, 3)
    for (let i = 0; i < allX.length; i++) {
      const x = allX[i];
      entities += dxfLine(x, minY, x, maxY, gridLayer);
      entities += dxfCircle(x, maxY + 0.5, 0.3, gridLayer);
      entities += dxfText(x - 0.1, maxY + 0.4, String.fromCharCode(65 + i), textLayer, 0.2);
    }
    for (let i = 0; i < allY.length; i++) {
      const y = allY[i] + yOff;
      entities += dxfLine(minX, y, maxX, y, gridLayer);
      entities += dxfCircle(minX - 0.5, y, 0.3, gridLayer);
      entities += dxfText(minX - 0.6, y - 0.1, (i + 1).toString(), textLayer, 0.2);
    }

    // Slabs
    for (const s of group.slabs) {
      entities += dxfPolyline([
        { x: s.x1, y: s.y1 + yOff }, { x: s.x2, y: s.y1 + yOff },
        { x: s.x2, y: s.y2 + yOff }, { x: s.x1, y: s.y2 + yOff },
      ], slabLayer);
      entities += dxfText((s.x1 + s.x2) / 2 - 0.3, (s.y1 + s.y2) / 2 + yOff, s.id, textLayer, 0.25);
    }

    // Beams
    for (const b of group.beams) {
      entities += dxfLine(b.x1, b.y1 + yOff, b.x2, b.y2 + yOff, beamLayer);
      const mx = (b.x1 + b.x2) / 2;
      const my = (b.y1 + b.y2) / 2 + yOff;
      entities += dxfText(mx, my + 0.15, `${b.id} ${b.b}x${b.h}`, textLayer, 0.12);
      entities += dxfDimension(b.x1, b.y1 + yOff, b.x2, b.y2 + yOff, dimLayer);
    }

    // Columns — use INSERT blocks
    for (const c of group.columns) {
      if (c.isRemoved) continue;
      const blockName = `COLUMN_${c.b}x${c.h}`;
      entities += dxfInsert(blockName, c.x, c.y + yOff, colLayer);
      entities += dxfText(c.x - 0.2, c.y + yOff - (c.h / 2000) - 0.2, c.id, textLayer, 0.1);
    }
  }

  return `999\nDXF Generated by Structural Design Studio\n${dxfHeader()}${dxfTablesMultiStory(stories)}${dxfBlocksSection(columns)}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}

// =================== BEAM/COLUMN LAYOUT DXF ===================

export function generateBeamLayoutDXF(beams: Beam[], columns: Column[], slabs: Slab[]): string {
  let entities = '';
  const allX = [...new Set(slabs.flatMap(s => [s.x1, s.x2]))].sort((a, b) => a - b);
  const allY = [...new Set(slabs.flatMap(s => [s.y1, s.y2]))].sort((a, b) => a - b);

  for (let i = 0; i < allX.length; i++) {
    entities += dxfLine(allX[i], Math.min(...allY) - 1, allX[i], Math.max(...allY) + 1, 'GRID');
    entities += dxfCircle(allX[i], Math.max(...allY) + 1.5, 0.3, 'GRID');
    entities += dxfText(allX[i] - 0.1, Math.max(...allY) + 1.4, String.fromCharCode(65 + i), 'TEXT', 0.2);
  }
  for (let i = 0; i < allY.length; i++) {
    entities += dxfLine(Math.min(...allX) - 1, allY[i], Math.max(...allX) + 1, allY[i], 'GRID');
    entities += dxfCircle(Math.min(...allX) - 1.5, allY[i], 0.3, 'GRID');
    entities += dxfText(Math.min(...allX) - 1.6, allY[i] - 0.1, (i + 1).toString(), 'TEXT', 0.2);
  }

  for (const b of beams) {
    entities += dxfLine(b.x1, b.y1, b.x2, b.y2, 'BEAM_LAYOUT');
    entities += dxfText((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2 + 0.15, `${b.id} ${b.b}x${b.h}`, 'TEXT', 0.12);
    entities += dxfDimension(b.x1, b.y1, b.x2, b.y2, 'DIMENSIONS');
  }

  for (const c of columns) {
    if (c.isRemoved) continue;
    entities += dxfInsert(`COLUMN_${c.b}x${c.h}`, c.x, c.y, 'COLUMN_LAYOUT');
    entities += dxfText(c.x - 0.15, c.y - 0.05, c.id, 'TEXT', 0.1);
  }

  return `999\nBeam Layout - Structural Design Studio\n${dxfHeader()}${dxfTablesMultiStory()}${dxfBlocksSection(columns)}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}

export function generateColumnLayoutDXF(columns: Column[], slabs: Slab[]): string {
  let entities = '';
  const allX = [...new Set(slabs.flatMap(s => [s.x1, s.x2]))].sort((a, b) => a - b);
  const allY = [...new Set(slabs.flatMap(s => [s.y1, s.y2]))].sort((a, b) => a - b);

  for (let i = 0; i < allX.length; i++) {
    entities += dxfLine(allX[i], Math.min(...allY) - 1, allX[i], Math.max(...allY) + 1, 'GRID');
    entities += dxfCircle(allX[i], Math.max(...allY) + 1.5, 0.3, 'GRID');
    entities += dxfText(allX[i] - 0.1, Math.max(...allY) + 1.4, String.fromCharCode(65 + i), 'TEXT', 0.2);
  }
  for (let i = 0; i < allY.length; i++) {
    entities += dxfLine(Math.min(...allX) - 1, allY[i], Math.max(...allX) + 1, allY[i], 'GRID');
    entities += dxfCircle(Math.min(...allX) - 1.5, allY[i], 0.3, 'GRID');
    entities += dxfText(Math.min(...allX) - 1.6, allY[i] - 0.1, (i + 1).toString(), 'TEXT', 0.2);
  }

  for (const c of columns) {
    if (c.isRemoved) continue;
    entities += dxfInsert(`COLUMN_${c.b}x${c.h}`, c.x, c.y, 'COLUMN_LAYOUT');
    entities += dxfText(c.x - 0.2, c.y + (c.h / 2000) + 0.1, `${c.id} ${c.b}x${c.h}`, 'TEXT', 0.1);
  }

  const colsByX = [...new Set(columns.filter(c => !c.isRemoved).map(c => c.x))].sort((a, b) => a - b);
  const colsByY = [...new Set(columns.filter(c => !c.isRemoved).map(c => c.y))].sort((a, b) => a - b);
  for (let i = 0; i < colsByX.length - 1; i++) {
    entities += dxfDimension(colsByX[i], Math.min(...colsByY) - 1, colsByX[i + 1], Math.min(...colsByY) - 1, 'DIMENSIONS');
  }
  for (let i = 0; i < colsByY.length - 1; i++) {
    entities += dxfDimension(Math.min(...colsByX) - 1, colsByY[i], Math.min(...colsByX) - 1, colsByY[i + 1], 'DIMENSIONS');
  }

  return `999\nColumn Layout - Structural Design Studio\n${dxfHeader()}${dxfTablesMultiStory()}${dxfBlocksSection(columns)}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}

export interface RebarExportData {
  beamId: string;
  b: number; h: number;
  x1: number; y1: number; x2: number; y2: number;
  topBars: number; topDia: number;
  botBars: number; botDia: number;
  stirrups: string;
}

export function generateReinforcementDXF(slabs: Slab[], beams: Beam[], columns: Column[], rebarData: RebarExportData[]): string {
  let entities = '';
  for (const b of beams) entities += dxfLine(b.x1, b.y1, b.x2, b.y2, 'BEAMS');
  for (const c of columns) {
    if (c.isRemoved) continue;
    entities += dxfInsert(`COLUMN_${c.b}x${c.h}`, c.x, c.y, 'COLUMNS');
  }
  for (const r of rebarData) {
    const mx = (r.x1 + r.x2) / 2;
    const my = (r.y1 + r.y2) / 2;
    const isH = Math.abs(r.y2 - r.y1) < 0.01;
    entities += dxfText(mx + (isH ? 0 : 0.35), my + (isH ? 0.35 : 0), `${r.topBars}\\U+00D8${r.topDia}`, 'REBAR_TOP', 0.1);
    entities += dxfText(mx + (isH ? 0 : -0.35), my + (isH ? -0.25 : 0), `${r.botBars}\\U+00D8${r.botDia}`, 'REBAR_BOTTOM', 0.1);
    entities += dxfText(mx, my + (isH ? -0.45 : -0.25), r.stirrups, 'STIRRUPS', 0.08);
  }
  return `999\nReinforcement DXF\n${dxfHeader()}${dxfTablesMultiStory()}${dxfBlocksSection(columns)}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}

export function downloadDXF(content: string, filename: string): void {
  import('@/lib/capacitorDownload').then(({ downloadDXF: dl }) => dl(content, filename));
}

// =================== FOUNDATION DXF (WSM/ASD) ===================
// Layers dedicated for foundation drawings, matching the export tables
// (Type, B×L, t, d, q_actual, bars_x, bars_y, shear checks, status).

const FOUNDATION_LAYERS = {
  FOOTING:      { name: 'FOUNDATION_FOOTING',  color: 5 },
  FOOTING_HID:  { name: 'FOUNDATION_HIDDEN',   color: 8 },
  COLUMN:       { name: 'FOUNDATION_COLUMN',   color: 1 },
  GRID:         { name: 'FOUNDATION_GRID',     color: 8 },
  TEXT:         { name: 'FOUNDATION_TEXT',     color: 7 },
  DIM:          { name: 'FOUNDATION_DIM',      color: 2 },
  REBAR_X:      { name: 'FOUNDATION_REBAR_X',  color: 4 },
  REBAR_Y:      { name: 'FOUNDATION_REBAR_Y',  color: 6 },
  SCHEDULE:     { name: 'FOUNDATION_SCHEDULE', color: 7 },
  FAIL:         { name: 'FOUNDATION_FAIL',     color: 1 },
};

function dxfTablesFoundation(): string {
  const all = Object.values(FOUNDATION_LAYERS);
  const entries = all.map(l =>
    `0\nLAYER\n2\n${l.name}\n70\n0\n62\n${l.color}\n6\nCONTINUOUS`
  ).join('\n');
  return `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n${all.length}\n${entries}\n0\nENDTAB\n0\nENDSEC\n`;
}

// Minimal shape of a foundation design result the DXF needs.
// Matches FootingDesignResult fields used in the on-screen tables.
export interface FoundationDXFInput {
  colId: string;
  x: number;          // column position (m)
  y: number;          // column position (m)
  colB: number;       // column width  (mm, along X)
  colH: number;       // column height (mm, along Y)
  B: number;          // footing dimension along X (mm)
  L: number;          // footing dimension along Y (mm)
  t: number;          // footing thickness (mm)
  d: number;          // effective depth (mm)
  P_service: number;  // service axial load (kN)
  q_actual: number;   // actual soil pressure (kN/m²)
  bars_x: number;
  dia_x: number;
  spacing_x: number;
  bars_y: number;
  dia_y: number;
  spacing_y: number;
  bearing_ok: boolean;
  wide_shear_ok: boolean;
  punch_shear_ok: boolean;
  adequate: boolean;
}

export interface FoundationDXFMaterials {
  fc: number; fy: number; qa: number; cover: number;
  gamma_conc: number; gamma_soil: number; Df: number;
}

/**
 * Generate a DXF file for the foundation design.
 *
 * Produces:
 *   1) Foundation Plan — every footing rectangle (B×L), the column footprint,
 *      grid lines, dimensions between footings, and per-footing labels
 *      (TYPE, colId, B×L, t, bars_x, bars_y, q_actual).
 *   2) Type Schedule (as DXF text rows) — one row per unique footing type
 *      (key = B×L×t), listing the same columns shown in the on-screen
 *      "جدول تصميم الأساسات المنفردة" + per-type reinforcement.
 *   3) Per-column results table (as DXF text rows) — mirrors the design
 *      table exactly: colId, P_service, B×L, t, d, q_actual, bearing,
 *      bars_x, bars_y, wide-shear, punch-shear, status.
 *
 * The label content is taken verbatim from the FoundationDesignResult fields,
 * which guarantees the DXF labels match the export tables.
 */
export function generateFoundationDXF(
  results: FoundationDXFInput[],
  mat: FoundationDXFMaterials,
  projectName: string = 'Foundation Plan',
): string {
  if (results.length === 0) {
    return `999\nFoundation DXF (empty)\n${dxfHeader()}${dxfTablesFoundation()}0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n`;
  }

  const L = FOUNDATION_LAYERS;

  // ── Group footings by type (B×L×t) — same key used in the on-screen schedule
  type FType = {
    label: string; B: number; L: number; t: number;
    bars_x: number; dia_x: number; spacing_x: number;
    bars_y: number; dia_y: number; spacing_y: number;
    members: FoundationDXFInput[];
  };
  const typeMap = new Map<string, FType>();
  const colToType = new Map<string, string>();
  let typeIdx = 1;
  for (const r of results) {
    const key = `${r.B}x${r.L}x${r.t}`;
    if (!typeMap.has(key)) {
      typeMap.set(key, {
        label: `F${typeIdx++}`, B: r.B, L: r.L, t: r.t,
        bars_x: r.bars_x, dia_x: r.dia_x, spacing_x: r.spacing_x,
        bars_y: r.bars_y, dia_y: r.dia_y, spacing_y: r.spacing_y,
        members: [],
      });
    }
    const ft = typeMap.get(key)!;
    ft.members.push(r);
    colToType.set(r.colId, ft.label);
  }

  let entities = '';

  // ── 1) PLAN ────────────────────────────────────────────────────────────────
  const xs = results.map(r => r.x);
  const ys = results.map(r => r.y);
  const minX = Math.min(...xs) - 2;
  const maxX = Math.max(...xs) + 2;
  const minY = Math.min(...ys) - 2;
  const maxY = Math.max(...ys) + 2;

  // Plan title
  entities += dxfText(minX, maxY + 1.2, `FOUNDATION PLAN — ${projectName}`, L.TEXT.name, 0.4);
  entities += dxfText(minX, maxY + 0.6, `WSM / ASD — UBC 1997 / ACI 318`, L.TEXT.name, 0.2);

  // Grid through unique column positions
  const uXs = [...new Set(xs)].sort((a, b) => a - b);
  const uYs = [...new Set(ys)].sort((a, b) => a - b);
  for (let i = 0; i < uXs.length; i++) {
    entities += dxfLine(uXs[i], minY, uXs[i], maxY, L.GRID.name);
    entities += dxfCircle(uXs[i], maxY + 0.35, 0.25, L.GRID.name);
    entities += dxfText(uXs[i] - 0.08, maxY + 0.27, String.fromCharCode(65 + i), L.TEXT.name, 0.18);
  }
  for (let i = 0; i < uYs.length; i++) {
    entities += dxfLine(minX, uYs[i], maxX, uYs[i], L.GRID.name);
    entities += dxfCircle(minX - 0.35, uYs[i], 0.25, L.GRID.name);
    entities += dxfText(minX - 0.45, uYs[i] - 0.08, (i + 1).toString(), L.TEXT.name, 0.18);
  }

  // Footings + columns + labels
  for (const r of results) {
    const halfB = (r.B / 1000) / 2;
    const halfL = (r.L / 1000) / 2;
    const halfCB = (r.colB / 1000) / 2;
    const halfCH = (r.colH / 1000) / 2;

    // Footing outline (B × L)
    entities += dxfPolyline([
      { x: r.x - halfB, y: r.y - halfL },
      { x: r.x + halfB, y: r.y - halfL },
      { x: r.x + halfB, y: r.y + halfL },
      { x: r.x - halfB, y: r.y + halfL },
    ], L.FOOTING.name);

    // Column footprint inside footing
    entities += dxfPolyline([
      { x: r.x - halfCB, y: r.y - halfCH },
      { x: r.x + halfCB, y: r.y - halfCH },
      { x: r.x + halfCB, y: r.y + halfCH },
      { x: r.x - halfCB, y: r.y + halfCH },
    ], L.COLUMN.name);

    // Labels — exactly mirror what's in the design table
    const typeLabel = colToType.get(r.colId) || '?';
    const statusLayer = r.adequate ? L.TEXT.name : L.FAIL.name;
    entities += dxfText(r.x - halfB, r.y + halfL + 0.05, `${typeLabel}  ${r.colId}`, L.TEXT.name, 0.22);
    entities += dxfText(r.x - halfB, r.y + halfL - 0.20, `${r.B}x${r.L}x${r.t} mm`, L.TEXT.name, 0.14);
    entities += dxfText(r.x - halfB, r.y - halfL - 0.18, `P=${r.P_service.toFixed(0)}kN  q=${r.q_actual.toFixed(0)}`, L.TEXT.name, 0.12);
    entities += dxfText(r.x - halfB, r.y - halfL - 0.34, `Bx:${r.bars_x}D${r.dia_x}@${r.spacing_x}`, L.REBAR_X.name, 0.12);
    entities += dxfText(r.x - halfB, r.y - halfL - 0.48, `Ly:${r.bars_y}D${r.dia_y}@${r.spacing_y}`, L.REBAR_Y.name, 0.12);
    if (!r.adequate) {
      entities += dxfText(r.x + halfB - 0.4, r.y + halfL + 0.05, 'REVIEW', statusLayer, 0.18);
    }
  }

  // Dimensions between grids
  for (let i = 0; i < uXs.length - 1; i++) {
    entities += dxfDimension(uXs[i], minY - 0.5, uXs[i + 1], minY - 0.5, L.DIM.name, 0.6);
  }
  for (let i = 0; i < uYs.length - 1; i++) {
    entities += dxfDimension(minX - 0.5, uYs[i], minX - 0.5, uYs[i + 1], L.DIM.name, 0.6);
  }

  // ── 2) TYPE SCHEDULE (as DXF text grid) ───────────────────────────────────
  const schedX = maxX + 3;
  let schedY = maxY;
  const rowH = 0.35;
  entities += dxfText(schedX, schedY, 'FOOTING TYPE SCHEDULE', L.TEXT.name, 0.3);
  schedY -= rowH * 1.4;
  const schedHeader = 'TYPE | B(mm) | L(mm) | t(mm) | Bars_x | Bars_y | Count';
  entities += dxfText(schedX, schedY, schedHeader, L.SCHEDULE.name, 0.18);
  schedY -= rowH;
  for (const ft of typeMap.values()) {
    const row = `${ft.label} | ${ft.B} | ${ft.L} | ${ft.t} | ${ft.bars_x}D${ft.dia_x}@${ft.spacing_x} | ${ft.bars_y}D${ft.dia_y}@${ft.spacing_y} | ${ft.members.length}`;
    entities += dxfText(schedX, schedY, row, L.SCHEDULE.name, 0.16);
    schedY -= rowH;
  }

  // ── 3) PER-COLUMN RESULTS TABLE — mirrors UI design table ────────────────
  schedY -= rowH;
  entities += dxfText(schedX, schedY, 'FOOTING DESIGN RESULTS (WSM)', L.TEXT.name, 0.3);
  schedY -= rowH * 1.4;
  const resHeader = 'COL | P(kN) | BxL | t | d | q | BearOk | Bars_x | Bars_y | WideShr | Punch | Status';
  entities += dxfText(schedX, schedY, resHeader, L.SCHEDULE.name, 0.16);
  schedY -= rowH;
  for (const r of results) {
    const layer = r.adequate ? L.SCHEDULE.name : L.FAIL.name;
    const row =
      `${r.colId} | ${r.P_service.toFixed(0)} | ${r.B}x${r.L} | ${r.t} | ${r.d} | ${r.q_actual.toFixed(0)} | ` +
      `${r.bearing_ok ? 'OK' : 'X'} | ${r.bars_x}D${r.dia_x}@${r.spacing_x} | ${r.bars_y}D${r.dia_y}@${r.spacing_y} | ` +
      `${r.wide_shear_ok ? 'OK' : 'X'} | ${r.punch_shear_ok ? 'OK' : 'X'} | ${r.adequate ? 'OK' : 'REVIEW'}`;
    entities += dxfText(schedX, schedY, row, layer, 0.14);
    schedY -= rowH;
  }

  // ── 4) Material bar ───────────────────────────────────────────────────────
  schedY -= rowH;
  const matBar =
    `f'c=${mat.fc}MPa  fy=${mat.fy}MPa  qa=${mat.qa}kN/m2  ` +
    `fc,allow=${(0.45 * mat.fc).toFixed(1)}MPa  fs,allow=${Math.min(0.5 * mat.fy, 207).toFixed(0)}MPa  ` +
    `Df=${mat.Df}m  cover=${mat.cover}mm`;
  entities += dxfText(schedX, schedY, matBar, L.TEXT.name, 0.16);

  return `999\nFoundation DXF — Structural Design Studio (WSM/ASD)\n${dxfHeader()}${dxfTablesFoundation()}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}
