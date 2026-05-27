/**
 * HTML-based Construction Drawing Generator — ISO 7200 / ACI 315-99 Compliant
 * Generates construction sheets as HTML with full Arabic text support,
 * matching the jsPDF-based constructionSheets.ts layout exactly.
 * 
 * Uses html2canvas to convert to images for PDF export or opens print dialog.
 */

import type { Slab, Column, Beam, FlexureResult, ShearResult, ColumnResult, SlabDesignResult, MatProps, SlabProps } from '@/lib/structuralEngine';
import { getFloorCode, makeDrawingNumber, type TitleBlockConfig, type ExportOptions, type DevelopmentLengths } from './drawingStandards';
import { analyzeAllContinuousSlabs, type ContinuousSlabResult, type SpanResult } from '@/lib/continuousSlabAnalysis';

interface BeamDesignData {
  beamId: string;
  flexLeft: FlexureResult;
  flexMid: FlexureResult;
  flexRight: FlexureResult;
  shear: ShearResult;
  /** IDs of the individual beam segments that were merged into this design (carrier/multi-segment beams) */
  mergedCarrierIds?: string[];
  /** Total design span in metres (for merged carrier beams this equals sum of all segments) */
  span?: number;
}

// ─── Reinforcement group label helpers ───

/** Build a map of beamId → Arabic group label (ج-1, ج-2, …) by identical reinforcement pattern */
function buildBeamGroupLabels(beamDesigns: BeamDesignData[]): Map<string, string> {
  const keyToLabel = new Map<string, string>();
  const result = new Map<string, string>();
  let counter = 1;
  for (const d of beamDesigns) {
    const key = `${d.flexLeft.bars}φ${d.flexLeft.dia}|${d.flexMid.bars}φ${d.flexMid.dia}|${d.flexRight.bars}φ${d.flexRight.dia}|${d.shear.stirrups}`;
    if (!keyToLabel.has(key)) {
      keyToLabel.set(key, `ج-${counter++}`);
    }
    result.set(d.beamId, keyToLabel.get(key)!);
  }
  return result;
}

/** Build a map of colId → Arabic group label (ع-1, ع-2, …) by identical reinforcement pattern */
function buildColGroupLabels(colDesigns: ColDesignData[]): Map<string, string> {
  const keyToLabel = new Map<string, string>();
  const result = new Map<string, string>();
  let counter = 1;
  for (const c of colDesigns) {
    const key = `${c.b}x${c.h}|${c.design.bars}φ${c.design.dia}|${c.design.stirrups}`;
    if (!keyToLabel.has(key)) {
      keyToLabel.set(key, `ع-${counter++}`);
    }
    result.set(c.id, keyToLabel.get(key)!);
  }
  return result;
}

/** Build a map of slabId → Arabic group label (ب-1, ب-2, …) by identical reinforcement pattern */
function buildSlabGroupLabels(slabDesigns: SlabDesignData[]): Map<string, string> {
  const keyToLabel = new Map<string, string>();
  const result = new Map<string, string>();
  let counter = 1;
  for (const s of slabDesigns) {
    const key = `h${s.design.hUsed}|${s.design.shortDir.bars}φ${s.design.shortDir.dia}@${s.design.shortDir.spacing}|${s.design.longDir.bars}φ${s.design.longDir.dia}@${s.design.longDir.spacing}`;
    if (!keyToLabel.has(key)) {
      keyToLabel.set(key, `ب-${counter++}`);
    }
    result.set(s.id, keyToLabel.get(key)!);
  }
  return result;
}

interface ColDesignData {
  id: string;
  b: number; h: number;
  design: ColumnResult;
}

interface SlabDesignData {
  id: string;
  design: SlabDesignResult;
}

// ─── Paper size handling (auto + landscape, drawing fills the page) ───
type PaperSize = 'A4' | 'A3' | 'A1' | 'auto';
const PAPER_DIMS_MM: Record<Exclude<PaperSize, 'auto'>, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A1: [841, 594],
};
const PX_PER_MM = 3;
function pickAutoPaper(modelW: number, modelH: number): Exclude<PaperSize, 'auto'> {
  const maxDim = Math.max(modelW, modelH);
  if (maxDim > 20) return 'A1';
  if (maxDim > 8) return 'A3';
  return 'A4';
}
function getPaperPx(paperSize: PaperSize, modelW: number, modelH: number) {
  const ps = paperSize === 'auto' ? pickAutoPaper(modelW, modelH) : paperSize;
  const [mmW, mmH] = PAPER_DIMS_MM[ps];
  return { sheetW: Math.round(mmW * PX_PER_MM), sheetH: Math.round(mmH * PX_PER_MM), cssSize: ps };
}
let _SHEET_W = 1260;
let _SHEET_H = 891;
let _CSS_PAPER: Exclude<PaperSize, 'auto'> = 'A3';

// ─── SVG helpers for drawing zone ───

function svgGridSystem(
  gridX: number[], gridY: number[],
  tx: (x: number) => number, ty: (y: number) => number,
  minX: number, maxX: number, minY: number, maxY: number,
): string {
  const xLabels = gridX.map((_, i) => String.fromCharCode(65 + i));
  const yLabels = gridY.map((_, i) => (i + 1).toString());
  let svg = '';
  
  // Grid lines
  for (let i = 0; i < gridX.length; i++) {
    const x = tx(gridX[i]);
    svg += `<line x1="${x}" y1="${ty(minY - 0.3)}" x2="${x}" y2="${ty(maxY + 0.3)}" stroke="#FFA03C" stroke-width="0.3" />`;
    // Grid bubble
    const by = ty(maxY + 0.3) - 30;
    svg += `<circle cx="${x}" cy="${by}" r="14" fill="white" stroke="black" stroke-width="1" />`;
    svg += `<text x="${x}" y="${by + 4}" text-anchor="middle" font-size="10" font-weight="bold" font-family="Arial">${xLabels[i]}</text>`;
  }
  for (let i = 0; i < gridY.length; i++) {
    const y = ty(gridY[i]);
    svg += `<line x1="${tx(minX - 0.3)}" y1="${y}" x2="${tx(maxX + 0.3)}" y2="${y}" stroke="#FFA03C" stroke-width="0.3" />`;
    const bx = tx(minX - 0.3) - 30;
    svg += `<circle cx="${bx}" cy="${y}" r="14" fill="white" stroke="black" stroke-width="1" />`;
    svg += `<text x="${bx}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="bold" font-family="Arial">${yLabels[i]}</text>`;
  }
  return svg;
}

function svgColumns(
  columns: Column[], tx: (x: number) => number, ty: (y: number) => number, mmPerM: number,
  filled: boolean = true, showLabels: boolean = false,
): string {
  let svg = '';
  for (const c of columns) {
    if ((c as any).isRemoved) continue;
    const hw = (c.b / 1000) * mmPerM / 2;
    const hh = (c.h / 1000) * mmPerM / 2;
    const cx = tx(c.x) - hw;
    const cy = ty(c.y) - hh;
    const fill = filled ? '#3C3C3C' : '#000';
    svg += `<rect x="${cx}" y="${cy}" width="${hw * 2}" height="${hh * 2}" fill="${fill}" stroke="black" stroke-width="1" />`;
    if (showLabels) {
      svg += `<text x="${tx(c.x) + hw + 6}" y="${ty(c.y) + 3}" font-size="8" font-weight="bold" font-family="Arial">${c.id}</text>`;
      svg += `<text x="${tx(c.x) + hw + 6}" y="${ty(c.y) + 14}" font-size="6" font-family="Arial">${c.b}×${c.h}</text>`;
    }
  }
  return svg;
}

function svgBeamsOnPlan(
  beams: Beam[], columns: Column[],
  tx: (x: number) => number, ty: (y: number) => number, mmPerM: number,
  groupLabels?: Map<string, string>,
): string {
  let svg = '';

  // ── اكتشاف مجموعات الأجزاء (مثل 67-1, 67-2, 67-3 ← جسر واحد "67") ──
  const segGroupMap = new Map<string, Beam[]>();
  for (const b of beams) {
    const m = b.id.match(/^(.+)-(\d+)$/);
    if (m) {
      const baseId = m[1];
      if (!segGroupMap.has(baseId)) segGroupMap.set(baseId, []);
      segGroupMap.get(baseId)!.push(b);
    }
  }
  // احتفظ فقط بالمجموعات ذات جزأين أو أكثر
  for (const [k, parts] of segGroupMap) {
    if (parts.length < 2) segGroupMap.delete(k);
  }
  const segmentPartIds = new Set<string>();
  for (const [, parts] of segGroupMap) {
    for (const p of parts) segmentPartIds.add(p.id);
  }

  // ── الجولة الأولى: رسم مستطيلات الجسور ──
  for (const b of beams) {
    const isHoriz = Math.abs(b.y1 - b.y2) < 0.01;
    const beamThickPx = Math.max((b.b / 1000) * mmPerM, 6);

    let bx1 = tx(b.x1), by1 = ty(b.y1), bx2 = tx(b.x2), by2 = ty(b.y2);

    const fromCol = columns.find(c => c.id === (b as any).fromCol || (Math.abs(c.x - b.x1) < 0.01 && Math.abs(c.y - b.y1) < 0.01));
    const toCol = columns.find(c => c.id === (b as any).toCol || (Math.abs(c.x - b.x2) < 0.01 && Math.abs(c.y - b.y2) < 0.01));

    if (fromCol) {
      if (isHoriz) bx1 += (fromCol.b / 1000) * mmPerM / 2;
      else by1 -= (fromCol.h / 1000) * mmPerM / 2;
    }
    if (toCol) {
      if (isHoriz) bx2 -= (toCol.b / 1000) * mmPerM / 2;
      else by2 += (toCol.h / 1000) * mmPerM / 2;
    }

    if (isHoriz) {
      svg += `<rect x="${Math.min(bx1, bx2)}" y="${by1 - beamThickPx / 2}" width="${Math.abs(bx2 - bx1)}" height="${beamThickPx}" fill="#B4D2B4" stroke="#006400" stroke-width="1" />`;
    } else {
      svg += `<rect x="${bx1 - beamThickPx / 2}" y="${Math.min(by1, by2)}" width="${beamThickPx}" height="${Math.abs(by2 - by1)}" fill="#B4D2B4" stroke="#006400" stroke-width="1" />`;
    }

    // ── التسمية: فقط للجسور المستقلة (غير الأجزاء المقسّمة) ──
    if (!segmentPartIds.has(b.id)) {
      const mx = (bx1 + bx2) / 2;
      const my = (by1 + by2) / 2;
      const labelOffset = isHoriz ? -beamThickPx / 2 - 10 : beamThickPx / 2 + 5;
      const groupLabel = groupLabels?.get(b.id);
      const displayLabel = groupLabel ?? b.id;
      if (isHoriz) {
        svg += `<text x="${mx}" y="${my + labelOffset}" font-size="6.5" font-weight="bold" fill="#005000" font-family="Arial" text-anchor="middle">${displayLabel}</text>`;
      } else {
        svg += `<text x="${mx + labelOffset}" y="${my}" font-size="6.5" font-weight="bold" fill="#005000" font-family="Arial">${displayLabel}</text>`;
      }
    }
  }

  // ── الجولة الثانية: تسمية مجموعات الأجزاء بتسمية واحدة عند منتصف الجسر الكامل ──
  for (const [baseId, parts] of segGroupMap) {
    const first = parts[0];
    const isHoriz = Math.abs(first.y1 - first.y2) < 0.01;
    const beamThickPx = Math.max((first.b / 1000) * mmPerM, 6);
    const groupLabel = groupLabels?.get(baseId);
    const displayLabel = groupLabel ? `${groupLabel}(${baseId})` : baseId;

    if (isHoriz) {
      const allX = parts.flatMap(p => {
        let bx1 = tx(p.x1), bx2 = tx(p.x2);
        const fc = columns.find(c => Math.abs(c.x - p.x1) < 0.01 && Math.abs(c.y - p.y1) < 0.01);
        const tc = columns.find(c => Math.abs(c.x - p.x2) < 0.01 && Math.abs(c.y - p.y2) < 0.01);
        if (fc) bx1 += (fc.b / 1000) * mmPerM / 2;
        if (tc) bx2 -= (tc.b / 1000) * mmPerM / 2;
        return [bx1, bx2];
      });
      const midX = (Math.min(...allX) + Math.max(...allX)) / 2;
      const midY = ty(first.y1);
      svg += `<text x="${midX}" y="${midY - beamThickPx / 2 - 10}" font-size="6.5" font-weight="bold" fill="#005000" font-family="Arial" text-anchor="middle">${displayLabel}</text>`;
    } else {
      const allY = parts.flatMap(p => {
        let by1 = ty(p.y1), by2 = ty(p.y2);
        const fc = columns.find(c => Math.abs(c.x - p.x1) < 0.01 && Math.abs(c.y - p.y1) < 0.01);
        const tc = columns.find(c => Math.abs(c.x - p.x2) < 0.01 && Math.abs(c.y - p.y2) < 0.01);
        if (fc) by1 -= (fc.h / 1000) * mmPerM / 2;
        if (tc) by2 += (tc.h / 1000) * mmPerM / 2;
        return [by1, by2];
      });
      const midY = (Math.min(...allY) + Math.max(...allY)) / 2;
      const midX = tx(first.x1);
      svg += `<text x="${midX + beamThickPx / 2 + 5}" y="${midY}" font-size="6.5" font-weight="bold" fill="#005000" font-family="Arial">${displayLabel}</text>`;
    }
  }

  return svg;
}

function svgSlabsOnPlan(
  slabs: Slab[], slabDesigns: SlabDesignData[],
  tx: (x: number) => number, ty: (y: number) => number, mmPerM: number,
  groupLabels?: Map<string, string>,
  stripResults?: ContinuousSlabResult[],
  phiSlab?: number,
): string {
  let svg = '';
  for (const s of slabs) {
    const x = tx(s.x1);
    const y = ty(s.y2);
    const w = (s.x2 - s.x1) * mmPerM;
    const h = (s.y2 - s.y1) * mmPerM;
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000096" stroke-width="0.7" />`;
    const cx = tx((s.x1 + s.x2) / 2);
    const cy = ty((s.y1 + s.y2) / 2);

    if (stripResults && stripResults.length > 0) {
      // ── عرض نتائج الشرائح المستمرة ──
      const dia = phiSlab || 12;
      const xSpans = stripResults.filter(r => r.direction === 'X').flatMap(r => r.spans.filter(sp => sp.slabId === s.id));
      const ySpans = stripResults.filter(r => r.direction === 'Y').flatMap(r => r.spans.filter(sp => sp.slabId === s.id));
      const maxAsX = xSpans.length > 0 ? Math.max(...xSpans.map(sp => sp.As_pos)) : null;
      const maxAsY = ySpans.length > 0 ? Math.max(...ySpans.map(sp => sp.As_pos)) : null;

      svg += `<text x="${cx}" y="${cy - 18}" text-anchor="middle" font-size="7" font-weight="bold" fill="#004000" font-family="Arial">${s.id}</text>`;
      if (maxAsX !== null) {
        const fmt = fmtAs(maxAsX, dia);
        svg += `<text x="${cx}" y="${cy - 7}" text-anchor="middle" font-size="5.5" fill="#1a3a5c" font-family="Arial">X+: ${maxAsX.toFixed(0)} (${fmt})</text>`;
      }
      if (maxAsY !== null) {
        const fmt = fmtAs(maxAsY, dia);
        svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="5.5" fill="#5c1a00" font-family="Arial">Y+: ${maxAsY.toFixed(0)} (${fmt})</text>`;
      }
      if (maxAsX === null && maxAsY === null) {
        // بلاطة منفردة — لا تنتمي لأي شريحة مستمرة
        const sd = slabDesigns.find(d => d.id === s.id);
        svg += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="5.5" fill="#888" font-family="Arial">منفردة</text>`;
        if (sd) svg += `<text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="5" fill="#888" font-family="Arial">h=${sd.design.hUsed}</text>`;
      }
    } else {
      // ── عرض التصميم المعزول (fallback) ──
      const sd = slabDesigns.find(d => d.id === s.id);
      if (!sd) continue;
      const groupLabel = groupLabels?.get(s.id);
      if (groupLabel) {
        svg += `<text x="${cx}" y="${cy - 20}" text-anchor="middle" font-size="8" font-weight="bold" fill="#004000" font-family="Arial">${groupLabel}</text>`;
        svg += `<text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="6" fill="#000078" font-family="Arial">(${s.id})</text>`;
      } else {
        svg += `<text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="7" font-weight="bold" fill="#000078" font-family="Arial">${s.id}</text>`;
      }
      svg += `<text x="${cx}" y="${cy - 1}" text-anchor="middle" font-size="6" fill="#000078" font-family="Arial">h=${sd.design.hUsed}</text>`;
      svg += `<text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="5.5" fill="#000078" font-family="Arial">${sd.design.shortDir.bars}Φ${sd.design.shortDir.dia}@${sd.design.shortDir.spacing}</text>`;
      svg += `<text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="5.5" fill="#000078" font-family="Arial">${sd.design.longDir.bars}Φ${sd.design.longDir.dia}@${sd.design.longDir.spacing}</text>`;
    }
  }
  return svg;
}

function svgScaleBar(x: number, y: number, scale: number): string {
  const barUnitPx = 1000 / scale * 3; // scaled for SVG
  let svg = '';
  for (let i = 0; i < 4; i++) {
    const rx = x + i * barUnitPx;
    const fill = i % 2 === 0 ? '#000' : '#fff';
    svg += `<rect x="${rx}" y="${y}" width="${barUnitPx}" height="${8}" fill="${fill}" stroke="black" stroke-width="0.5" />`;
  }
  svg += `<text x="${x}" y="${y + 18}" font-size="5" font-family="Arial">0</text>`;
  for (let i = 1; i <= 4; i++) {
    svg += `<text x="${x + i * barUnitPx - 5}" y="${y + 18}" font-size="5" font-family="Arial">${i}m</text>`;
  }
  svg += `<text x="${x}" y="${y - 4}" font-size="6" font-family="Arial">Scale 1:${scale}</text>`;
  return svg;
}

function svgLegendBox(x: number, y: number): string {
  const w = 160;
  const h = 110;
  let svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" stroke="black" stroke-width="1" />`;
  svg += `<text x="${x + 25}" y="${y + 14}" font-size="7" font-weight="bold" font-family="Arial">LEGEND / SYMBOLS</text>`;
  svg += `<line x1="${x}" y1="${y + 18}" x2="${x + w}" y2="${y + 18}" stroke="black" stroke-width="0.5" />`;
  
  const items = [
    ['■', 'Column (RC)'],
    ['══', 'Beam (RC) — width × depth'],
    ['□', 'Slab panel'],
    ['←→', 'Dimension line'],
    ['●', 'Rebar (filled circle)'],
    ['Φ', 'Bar diameter'],
    ['@', 'Spacing (center-to-center)'],
  ];
  items.forEach(([sym, desc], i) => {
    svg += `<text x="${x + 8}" y="${y + 32 + i * 12}" font-size="6" font-family="Arial">${sym}</text>`;
    svg += `<text x="${x + 30}" y="${y + 32 + i * 12}" font-size="6" font-family="Arial">${desc}</text>`;
  });
  return svg;
}

// ─── Title Block (ISO 7200) as HTML ───

function htmlTitleBlock(config: Partial<TitleBlockConfig>): string {
  return `
  <div style="position:absolute; bottom:36px; right:36px; width:600px; height:135px; border:1.5px solid #000; font-family:Arial,sans-serif; font-size:9px; display:grid; grid-template-rows:1fr 1fr 1fr; grid-template-columns:360px 240px;">
    <!-- Row 1 Left -->
    <div style="border-bottom:1px solid #000; border-right:1px solid #000; padding:3px 6px;">
      <div style="font-weight:bold; font-size:10px;">${config.firmName || 'Structural Design Studio'}</div>
      <div>PROJECT: ${config.projectName || ''}</div>
      <div>LOCATION: ${config.projectLocation || ''}</div>
      <div>CLIENT: ${config.clientName || ''}</div>
    </div>
    <!-- Row 1 Right -->
    <div style="border-bottom:1px solid #000; padding:3px 6px; text-align:center;">
      <div style="font-weight:bold; margin-top:8px;">[STAMP / SEAL]</div>
      ${config.registrationNo ? `<div>REG. NO.: ${config.registrationNo}</div>` : ''}
    </div>
    <!-- Row 2 Left -->
    <div style="border-bottom:1px solid #000; border-right:1px solid #000; padding:3px 6px;">
      <div style="font-weight:bold; font-size:11px;">${config.drawingTitle || ''}</div>
      <div>${config.drawingSubTitle || ''}</div>
      <div>SCALE: ${config.scale || 'N.T.S.'}   SHEET: ${config.sheetNo || '1'}</div>
    </div>
    <!-- Row 2 Right -->
    <div style="border-bottom:1px solid #000; padding:3px 6px;">
      <div style="font-weight:bold;">DWG NO: ${config.drawingNumber || ''}</div>
      <div>REVISION: ${config.revision || 'R0'}</div>
      <div>DATE: ${config.date || new Date().toLocaleDateString()}</div>
    </div>
    <!-- Row 3 Left -->
    <div style="border-right:1px solid #000; padding:3px 6px; font-size:8px;">
      <div>DESIGNED: ${config.designedBy || 'ENG.'}    CHECKED: ${config.checkedBy || '-'}</div>
      <div>DRAWN: ${config.drawnBy || 'ENG.'}    APPROVED: ${config.approvedBy || '-'}</div>
    </div>
    <!-- Row 3 Right -->
    <div style="padding:3px 6px;">
      <div style="font-weight:bold;">CODE: ${config.designCode || 'ACI 318-19'}</div>
      <div>f'c=${config.fc || 28}MPa  fy=${config.fy || 420}MPa</div>
    </div>
  </div>`;
}

// ─── Sheet border ───

function htmlSheetBorder(): string {
  return `
    <div style="position:absolute; top:15px; left:15px; right:15px; bottom:15px; border:3px solid #000;"></div>
    <div style="position:absolute; top:30px; left:30px; right:30px; bottom:30px; border:1px solid #000;"></div>`;
}

// ─── Schedule tables (Arabic headers) ───

function fmtRebar(bars: number, dia: number): string { return `${bars}Φ${dia}`; }

function htmlBeamScheduleTable(beams: Beam[], beamDesigns: BeamDesignData[]): string {
  const groupLabels = buildBeamGroupLabels(beamDesigns);

  // ── تجميع حسب رمز المجموعة (جسور بنفس التسليح = مجموعة واحدة) ──
  const groups = new Map<string, { designs: BeamDesignData[]; memberIds: string[] }>();
  for (const d of beamDesigns) {
    const label = groupLabels.get(d.beamId) ?? d.beamId;
    if (!groups.has(label)) groups.set(label, { designs: [], memberIds: [] });
    groups.get(label)!.designs.push(d);
    const mergedIds = (d as any).mergedCarrierIds as string[] | undefined;
    if (mergedIds && mergedIds.length > 0) {
      groups.get(label)!.memberIds.push(...mergedIds);
    } else {
      groups.get(label)!.memberIds.push(d.beamId);
    }
  }

  let rows = '';
  for (const [groupLabel, { designs, memberIds }] of groups) {
    const d = designs[0]; // التسليح متطابق لجميع أعضاء المجموعة
    let b_dim: number | undefined;
    let h_dim: number | undefined;
    const spans: number[] = [];

    for (const design of designs) {
      let beam = beams.find(b => b.id === design.beamId);
      if (!beam && (design as any).mergedCarrierIds) {
        const parts = ((design as any).mergedCarrierIds as string[])
          .map(id => beams.find(b => b.id === id)).filter(Boolean) as Beam[];
        if (parts.length > 0) {
          const largest = parts.reduce((best, b) => b.b * b.h >= best.b * best.h ? b : best, parts[0]);
          if (b_dim === undefined) { b_dim = largest.b; h_dim = largest.h; }
        }
      } else if (beam) {
        if (b_dim === undefined) { b_dim = beam.b; h_dim = beam.h; }
      }
      if (design.span !== undefined && design.span > 0) spans.push(design.span);
    }

    const minSpan = spans.length > 0 ? Math.min(...spans) : 0;
    const maxSpan = spans.length > 0 ? Math.max(...spans) : 0;
    const spanText = spans.length === 0 ? '—'
      : minSpan === maxSpan ? minSpan.toFixed(2)
      : `${minSpan.toFixed(2)}~${maxSpan.toFixed(2)}`;

    const totalBot = d.flexMid.bars;
    const isShort = maxSpan <= 2.0;
    const hasBent = !isShort && totalBot >= 4;
    const bentCount = hasBent ? Math.min(2, Math.floor(totalBot / 2)) : 0;
    const straightBot = totalBot - bentCount;

    const uniqueIds = [...new Set(memberIds)].sort((a, b) => {
      const na = parseFloat(a.replace(/[^0-9.]/g, ''));
      const nb = parseFloat(b.replace(/[^0-9.]/g, ''));
      return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
    });

    rows += `<tr>
      <td style="background:#f0f8ff; font-weight:bold; color:#1a3a5c; text-align:center; padding:3px;">${groupLabel}</td>
      <td style="font-size:6.5px; color:#444; word-break:break-all;">${uniqueIds.join(', ')}</td>
      <td>${b_dim ?? ''}</td>
      <td>${h_dim ?? ''}</td>
      <td>${spanText}</td>
      <td>${fmtRebar(straightBot, d.flexMid.dia)}</td>
      <td>${bentCount > 0 ? fmtRebar(bentCount, d.flexMid.dia) : '—'}</td>
      <td>${d.flexLeft.bars > 0 ? fmtRebar(d.flexLeft.bars, d.flexLeft.dia) : '—'}</td>
      <td>${d.flexRight.bars > 0 ? fmtRebar(d.flexRight.bars, d.flexRight.dia) : '—'}</td>
      <td>${d.shear.stirrups}</td>
    </tr>`;
  }

  return `
  <div style="font-weight:bold; font-size:11px; margin-bottom:4px; font-family:Arial;">BEAM SCHEDULE / جدول الجسور</div>
  <table style="width:100%; border-collapse:collapse; font-size:8px; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    <thead>
      <tr>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">رمز</th>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">الأعضاء</th>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">B</th>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">H</th>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">L (m)</th>
        <th colspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">سفلي</th>
        <th colspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">علوي</th>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">الكانات</th>
      </tr>
      <tr>
        <th style="border:1px solid #000; background:#2a4a6c; color:#fff; padding:2px; font-size:7px;">مستقيم</th>
        <th style="border:1px solid #000; background:#2a4a6c; color:#fff; padding:2px; font-size:7px;">مكسح*</th>
        <th style="border:1px solid #000; background:#2a4a6c; color:#fff; padding:2px; font-size:7px;">يسار</th>
        <th style="border:1px solid #000; background:#2a4a6c; color:#fff; padding:2px; font-size:7px;">يمين</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="font-size:7px; color:#555; margin-top:3px;">* التكسيح للجسور L > 2.0 م فقط</div>
  <div style="font-size:7px; color:#1a3a5c; margin-top:2px;">رمز: مجموعة جسور ذات تسليح متطابق — الأعضاء: أرقام الجسور في المجموعة</div>`;
}

function htmlColumnScheduleTable(colDesigns: ColDesignData[]): string {
  const groupLabels = buildColGroupLabels(colDesigns);

  // ── تجميع حسب رمز المجموعة ──
  const groups = new Map<string, ColDesignData[]>();
  for (const c of colDesigns) {
    const label = groupLabels.get(c.id) ?? c.id;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(c);
  }

  let rows = '';
  for (const [groupLabel, cols] of groups) {
    const c = cols[0]; // ممثل المجموعة
    const memberIds = cols.map(col => col.id).sort((a, b) => {
      const na = parseFloat(a.replace(/[^0-9.]/g, ''));
      const nb = parseFloat(b.replace(/[^0-9.]/g, ''));
      return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
    });

    rows += `<tr>
      <td style="background:#fff8f0; font-weight:bold; color:#5c1a00; text-align:center; padding:3px;">${groupLabel}</td>
      <td style="font-size:6.5px; color:#444; word-break:break-all;">${memberIds.join(', ')}</td>
      <td>${c.b}</td>
      <td>${c.h}</td>
      <td>${fmtRebar(c.design.bars, c.design.dia)}</td>
      <td>${c.design.stirrups}</td>
    </tr>`;
  }

  return `
  <div style="font-weight:bold; font-size:11px; margin-bottom:4px; font-family:Arial;">COLUMN SCHEDULE / جدول الأعمدة</div>
  <table style="width:100%; border-collapse:collapse; font-size:9px; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    <thead>
      <tr>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">رمز</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">الأعمدة</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">B mm</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">H mm</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">التسليح</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">الكانات</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="font-size:7px; color:#5c1a00; margin-top:2px;">رمز: مجموعة أعمدة ذات تسليح متطابق — الأعمدة: أرقام الأعمدة في المجموعة</div>`;
}

/** تحويل مساحة As (mm²/m) إلى تنسيق Φdia@spacing */
function fmtAs(As: number, dia: number): string {
  const abar = Math.PI / 4 * dia * dia;
  const spacingRaw = abar / Math.max(As, 1) * 1000;
  const spacing = Math.max(100, Math.min(300, Math.round(spacingRaw / 25) * 25));
  return `Φ${dia}@${spacing}`;
}

/** حساب التسليح السالب الصافي — يُخصم تسليح العزم الموجب من البحرتين المجاورتين */
function computeNetNegAs(
  spans: SpanResult[],
  AsMin: number,
): Array<{ supportIdx: number; As_neg_req: number; deduction: number; As_neg_net: number }> {
  const supports: Array<{ supportIdx: number; As_neg_req: number; deduction: number; As_neg_net: number }> = [];
  for (let i = 0; i < spans.length - 1; i++) {
    const left = spans[i];
    const right = spans[i + 1];
    const As_neg_req = Math.max(left.As_neg_right, right.As_neg_left);
    // الحديد الموجب من البحرة اليسرى يمتد L/5 نحو الركيزة (= As_pos_left)
    // والحديد الموجب من البحرة اليمنى يمتد L/5 نحو الركيزة (= As_pos_right)
    const deduction = left.As_pos + right.As_pos;
    const As_neg_net = Math.max(As_neg_req - deduction, AsMin);
    supports.push({ supportIdx: i + 1, As_neg_req, deduction, As_neg_net });
  }
  return supports;
}

/** جدول تسليح البلاطات بطريقة الشرائح ACI 318-19 §6.5 */
function htmlSlabStripTable(results: ContinuousSlabResult[], slabProps: SlabProps, mat: MatProps): string {
  if (results.length === 0) {
    return '<p style="font-size:9px; color:#666; font-family:Arial;">لا توجد شرائح مستمرة (يلزم بلاطتان متجاورتان أو أكثر)</p>';
  }

  const shrinkageRatio = mat.fy >= 420 ? 0.0018 : 0.0020;
  const AsMin = shrinkageRatio * 1000 * slabProps.thickness;
  const dia = slabProps.phiSlab || 12;
  const xResults = results.filter(r => r.direction === 'X');
  const yResults = results.filter(r => r.direction === 'Y');

  let html = `
  <div style="font-weight:bold; font-size:11px; margin-bottom:4px; font-family:Arial; border-bottom:2px solid #004000; padding-bottom:3px;">
    SLAB STRIP SCHEDULE / جدول تسليح شرائح البلاطات (ACI 318-19 §6.5)
  </div>
  <div style="font-size:7px; color:#555; margin-bottom:6px; font-family:Arial; direction:rtl;">
    Wu = 1.2DL + 1.6LL — h=${slabProps.thickness}mm — تغطية=${slabProps.cover}mm — Φ${dia}mm — AsMin=${AsMin.toFixed(0)} mm²/m
  </div>`;

  for (const [dir, strips] of [['X', xResults], ['Y', yResults]] as [string, ContinuousSlabResult[]][]) {
    if (strips.length === 0) continue;
    const dirLabel = dir === 'X' ? 'X (شرائح أفقية — حديد يسير في اتجاه X)' : 'Y (شرائح رأسية — حديد يسير في اتجاه Y)';
    html += `<div style="font-weight:bold; font-size:9px; color:#004000; background:#f0fff0; padding:2px 4px; margin-top:6px; margin-bottom:3px; font-family:Arial;">
      اتجاه ${dirLabel}
    </div>`;

    for (const strip of strips) {
      const netNegs = computeNetNegAs(strip.spans, AsMin);

      // بناء صفوف الجدول: كل بحرة + ركيزة بعدها
      let headerCells = '';
      let valueCells = '';
      let negCells = '';
      for (let i = 0; i < strip.spans.length; i++) {
        const sp = strip.spans[i];
        headerCells += `<th style="border:1px solid #aaa; background:#e8f5e9; padding:2px; font-size:7px; min-width:55px;">بحرة: ${sp.slabId}<br>L=${sp.spanLength.toFixed(2)}م</th>`;
        valueCells += `<td style="border:1px solid #ccc; padding:2px; font-size:7px; text-align:center;">
          <div style="color:#004000; font-weight:bold;">As+=${sp.As_pos.toFixed(0)}</div>
          <div style="color:#006000;">${fmtAs(sp.As_pos, dia)}</div>
          <div style="color:#888; font-size:6px;">L/5=${(sp.spanLength/5).toFixed(2)}م↔</div>
        </td>`;
        // ركيزة بعد هذه البحرة
        if (i < netNegs.length) {
          const sup = netNegs[i];
          headerCells += `<th style="border:1px solid #aaa; background:#ffeee8; padding:2px; font-size:7px; min-width:45px;">ركيزة ${sup.supportIdx}</th>`;
          valueCells += `<td style="border:1px solid #ccc; padding:2px; font-size:7px; text-align:center; background:#fff5f0;">
            <div style="color:#800000;">As−=${sup.As_neg_req.toFixed(0)}</div>
            <div style="color:#999; font-size:6px;">−${sup.deduction.toFixed(0)}</div>
            <div style="color:#c00000; font-weight:bold;">صافي=${sup.As_neg_net.toFixed(0)}</div>
            <div style="color:#a00000;">${fmtAs(sup.As_neg_net, dia)}</div>
          </td>`;
        }
      }

      html += `<table style="width:100%; border-collapse:collapse; margin-bottom:4px; font-family:'Segoe UI',Arial,sans-serif;">
        <thead>
          <tr>
            <th style="border:1px solid #666; background:#004000; color:#fff; padding:2px 4px; font-size:7.5px; text-align:right;" colspan="1">
              ${strip.stripId} — Wu=${strip.Wu.toFixed(1)} kN/m²
            </th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #ccc; padding:2px; font-size:7px; background:#f9f9f9; font-weight:bold; color:#444;">As (mm²/m)<br>Φmm@mm</td>
            ${valueCells}
          </tr>
        </tbody>
      </table>`;
    }
  }

  html += `<div style="font-size:6.5px; color:#555; margin-top:6px; font-family:Arial; direction:rtl; border-top:1px solid #ccc; padding-top:3px;">
    • As+: حديد العزم الموجب (منتصف البحرة) — يمتد مسافة L/5 من البحرة داخل البحرة المجاورة عند كل طرف<br>
    • As− صافي: الحديد المطلوب للعزم السالب بعد خصم ما يمتد من As+ من البحرتين اليمنى واليسرى<br>
    • الحد الأدنى AsMin = ${AsMin.toFixed(0)} mm²/m (ρ=${shrinkageRatio}) وفق ACI 318-19 §7.6.1<br>
    • الوزن الذاتي مُدرج: γ×h = ${mat.gamma}×${(slabProps.thickness/1000).toFixed(3)} = ${(mat.gamma*slabProps.thickness/1000).toFixed(2)} kN/m²
  </div>`;

  return html;
}

function htmlSlabScheduleTable(slabDesigns: SlabDesignData[]): string {
  const groupLabels = buildSlabGroupLabels(slabDesigns);
  let rows = '';
  for (const s of slabDesigns) {
    const groupLabel = groupLabels.get(s.id) ?? '';
    rows += `<tr>
      <td style="background:#f5fff5; font-weight:bold; color:#004000;">${groupLabel}</td>
      <td>${s.id}</td>
      <td>${s.design.lx.toFixed(1)}</td>
      <td>${s.design.ly.toFixed(1)}</td>
      <td>${s.design.hUsed}</td>
      <td>${s.design.isOneWay ? 'باتجاه واحد' : 'باتجاهين'}</td>
      <td>${s.design.shortDir.bars}Φ${s.design.shortDir.dia}@${s.design.shortDir.spacing}</td>
      <td>${s.design.longDir.bars}Φ${s.design.longDir.dia}@${s.design.longDir.spacing}</td>
    </tr>`;
  }

  return `
  <div style="font-weight:bold; font-size:11px; margin-bottom:4px; font-family:Arial;">SLAB SCHEDULE / جدول البلاطات</div>
  <table style="width:100%; border-collapse:collapse; font-size:9px; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    <thead>
      <tr>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">رمز</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">البلاطة</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">Lx</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">Ly</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">h</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">النوع</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">الاتجاه القصير</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">الاتجاه الطويل</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="font-size:7.5px; color:#004000; margin-top:2px;">رمز: البلاطات ذات نفس التسليح تحمل رمزاً واحداً (ب-1، ب-2، …)</div>`;
}

// ─── Column cross-section SVG ───

function svgColumnCrossSection(cd: ColDesignData, x: number, y: number, w: number, h: number): string {
  const scl = Math.min((w - 20) / cd.b, (h - 40) / cd.h);
  const rectW = cd.b * scl;
  const rectH = cd.h * scl;
  const rx = x + (w - rectW) / 2;
  const ry = y + 30;
  
  let svg = '';
  // Outer rectangle
  svg += `<rect x="${rx}" y="${ry}" width="${rectW}" height="${rectH}" fill="none" stroke="black" stroke-width="1.2" />`;
  
  // Stirrup outline
  const cover = 40 * scl;
  svg += `<rect x="${rx + cover}" y="${ry + cover}" width="${rectW - 2 * cover}" height="${rectH - 2 * cover}" fill="none" stroke="black" stroke-width="0.7" />`;
  
  // Rebar dots
  const nBars = cd.design.bars;
  const barR = Math.max(cd.design.dia * scl / 2, 2);
  const positions: [number, number][] = [];
  
  if (nBars <= 4) {
    positions.push([rx + cover + barR, ry + cover + barR]);
    positions.push([rx + rectW - cover - barR, ry + cover + barR]);
    positions.push([rx + cover + barR, ry + rectH - cover - barR]);
    positions.push([rx + rectW - cover - barR, ry + rectH - cover - barR]);
  } else {
    const perSide = Math.ceil(nBars / 4);
    for (let i = 0; i < nBars && i < perSide * 4; i++) {
      const side = Math.floor(i / perSide);
      const idx = i % perSide;
      const t = perSide > 1 ? idx / (perSide - 1) : 0.5;
      const innerX1 = rx + cover + barR;
      const innerX2 = rx + rectW - cover - barR;
      const innerY1 = ry + cover + barR;
      const innerY2 = ry + rectH - cover - barR;
      if (side === 0) positions.push([innerX1 + t * (innerX2 - innerX1), innerY1]);
      else if (side === 1) positions.push([innerX2, innerY1 + t * (innerY2 - innerY1)]);
      else if (side === 2) positions.push([innerX2 - t * (innerX2 - innerX1), innerY2]);
      else positions.push([innerX1, innerY2 - t * (innerY2 - innerY1)]);
    }
  }
  
  for (const [px, py] of positions.slice(0, nBars)) {
    svg += `<circle cx="${px}" cy="${py}" r="${barR}" fill="black" />`;
  }
  
  // Label
  svg += `<text x="${x + 5}" y="${y + 12}" font-size="7" font-weight="bold" font-family="Arial">${cd.id}</text>`;
  svg += `<text x="${x + 5}" y="${y + 22}" font-size="6" font-family="Arial">${cd.b}×${cd.h}mm  ${fmtRebar(cd.design.bars, cd.design.dia)}</text>`;
  svg += `<text x="${x + 5}" y="${ry + rectH + 16}" font-size="6" font-family="Arial">${cd.design.stirrups}</text>`;
  
  return svg;
}

// ─── Main sheet generator ───

function generateSheetHTML(
  sheetContent: string,
  svgDrawingZone: string,
  svgDrawW: number,
  svgDrawH: number,
  tableContent: string,
  titleBlockConfig: Partial<TitleBlockConfig>,
  extraSvgBottom?: string,
): string {
  // Arabic structural drawing convention:
  // Plan (مسقط) occupies left 62% of sheet; rebar schedule table sits on the RIGHT 36% — same sheet, landscape.
  // If there is no table, the plan expands to full width.
  const sheetW = _SHEET_W;
  const sheetH = _SHEET_H;
  const titleBlockH = 135 + 36 + 10;
  const contentH = sheetH - 45 - titleBlockH;
  const innerW = sheetW - 90;   // full content zone width (between borders)

  const hasTable = tableContent && tableContent.trim().length > 0;

  // Widths: plan 72%, divider 2%, table 26%  (of innerW)
  const planW  = hasTable ? Math.round(innerW * 0.72) : innerW;
  const tableW = hasTable ? Math.round(innerW * 0.26) : 0;
  const tableLeft = 45 + planW + Math.round(innerW * 0.02);  // left position of table zone

  // Vertical separator between plan and table
  const separatorX = 45 + planW + Math.round(innerW * 0.01);
  const separator = hasTable
    ? `<div style="position:absolute; top:45px; left:${separatorX}px; width:1px; height:${contentH}px; background:#ccc;"></div>`
    : '';

  // Right-side table label (rotated — appears as vertical heading on separator)
  const tableLabel = hasTable
    ? `<div style="position:absolute; top:${45 + contentH / 2 - 60}px; left:${separatorX + 3}px; width:12px; height:120px; display:flex; align-items:center; justify-content:center;">
         <span style="writing-mode:vertical-lr; font-size:7px; color:#888; font-family:Arial; letter-spacing:1px; transform:rotate(180deg);">جدول التسليح</span>
       </div>`
    : '';

  const combinedPage = `
  <div class="sheet-page" style="position:relative; width:${sheetW}px; height:${sheetH}px; background:white; overflow:hidden; page-break-after:always; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    ${htmlSheetBorder()}
    <!-- Plan zone (right-to-left: plan is the main content on the left) -->
    <div style="position:absolute; top:45px; left:45px; width:${planW}px; height:${contentH}px; overflow:hidden; border:0.5px solid #ccc;">
      <svg viewBox="0 0 ${svgDrawW} ${svgDrawH}" width="${planW}" height="${contentH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        ${svgDrawingZone}
      </svg>
    </div>
    ${separator}
    ${tableLabel}
    ${hasTable ? `
    <!-- Schedule table zone (right side — Arabic drawing standard) -->
    <div style="position:absolute; top:45px; left:${tableLeft}px; width:${tableW}px; height:${contentH}px; overflow:hidden; direction:rtl; padding:5px 4px;">
      ${tableContent}
    </div>` : ''}
    ${extraSvgBottom || ''}
    ${htmlTitleBlock(titleBlockConfig)}
  </div>`;

  return combinedPage;
}

// ─── Beam Elevation Sheet (HTML/SVG) ───

// ── Helpers ──

function _isEndSupport(beam: Beam, side: 'left' | 'right', allBeams: Beam[]): boolean {
  const colId = side === 'left' ? (beam as any).fromCol : (beam as any).toCol;
  const others = allBeams.filter(b => b.id !== beam.id && ((b as any).fromCol === colId || (b as any).toCol === colId));
  return !others.some(b => (b as any).direction === (beam as any).direction);
}

function _svgDimH(x1: number, x2: number, y: number, text: string, color = '#3c3c3c', fsz = 5.5): string {
  if (Math.abs(x2 - x1) < 1) return '';
  const mid = (x1 + x2) / 2;
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="0.4"/>
    <line x1="${x1}" y1="${y - 2.5}" x2="${x1}" y2="${y + 2.5}" stroke="${color}" stroke-width="0.4"/>
    <line x1="${x2}" y1="${y - 2.5}" x2="${x2}" y2="${y + 2.5}" stroke="${color}" stroke-width="0.4"/>
    <text x="${mid}" y="${y - 2}" text-anchor="middle" font-size="${fsz}" fill="${color}" font-family="Arial">${text}</text>`;
}

function _svgDimV(x: number, y1: number, y2: number, text: string, color = '#3c3c3c', fsz = 5.5): string {
  if (Math.abs(y2 - y1) < 1) return '';
  const mid = (y1 + y2) / 2;
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="0.4"/>
    <line x1="${x - 2.5}" y1="${y1}" x2="${x + 2.5}" y2="${y1}" stroke="${color}" stroke-width="0.4"/>
    <line x1="${x - 2.5}" y1="${y2}" x2="${x + 2.5}" y2="${y2}" stroke="${color}" stroke-width="0.4"/>
    <text x="${x + 3}" y="${mid + 2}" font-size="${fsz}" fill="${color}" font-family="Arial">${text}</text>`;
}

function _svgDash(x1: number, y1: number, x2: number, y2: number, color = '#999', sw = 0.5): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" stroke-dasharray="3,2"/>`;
}

function _svgCrossSection(
  x: number, y: number, w: number, h: number,
  bMm: number, hMm: number, coverMm: number, stirDiaMm: number,
  nTop: number, topDia: number, nBot: number, botDia: number, title: string,
): string {
  const scl = Math.min((w - 4) / bMm, (h - 16) / hMm);
  const sW = bMm * scl; const sH = hMm * scl;
  const sx = x + (w - sW) / 2; const sy = y + 14;
  let s = `<rect x="${sx}" y="${sy}" width="${sW}" height="${sH}" fill="#f5f5f5" stroke="#333" stroke-width="0.8"/>`;
  const stC = coverMm * scl; const stD = stirDiaMm * scl;
  s += `<rect x="${sx + stC}" y="${sy + stC}" width="${sW - 2*stC}" height="${sH - 2*stC}" fill="none" stroke="#555" stroke-width="0.5"/>`;
  const topR = Math.max((topDia * scl) / 2, 1.2);
  if (nTop > 0) {
    const tY = sy + stC + stD + topR;
    const tAv = sW - 2*stC - 2*stD - 2*topR;
    const tSp = nTop > 1 ? tAv / (nTop - 1) : 0;
    for (let i = 0; i < nTop; i++) s += `<circle cx="${sx + stC + stD + topR + i * tSp}" cy="${tY}" r="${topR}" fill="#000"/>`;
  }
  const botR = Math.max((botDia * scl) / 2, 1.2);
  if (nBot > 0) {
    const bY = sy + sH - stC - stD - botR;
    const bAv = sW - 2*stC - 2*stD - 2*botR;
    const bSp = nBot > 1 ? bAv / (nBot - 1) : 0;
    for (let i = 0; i < nBot; i++) s += `<circle cx="${sx + stC + stD + botR + i * bSp}" cy="${bY}" r="${botR}" fill="#000"/>`;
  }
  s += `<text x="${x + w/2}" y="${y + 9}" text-anchor="middle" font-size="5.5" font-weight="bold" fill="#000" font-family="Arial">${title}</text>`;
  s += `<text x="${sx + sW/2}" y="${sy + sH + 8}" text-anchor="middle" font-size="4.5" fill="#666" font-family="Arial">${bMm}×${hMm} mm</text>`;
  s += `<text x="${sx - 2}" y="${sy + sH/2 + 2}" text-anchor="end" font-size="4" fill="#999" font-family="Arial">c=${coverMm}</text>`;
  return s;
}

function _svgColFaceMarkers(lfx: number, rfx: number, topY: number, botY: number): string {
  return `<line x1="${lfx}" y1="${topY - 3}" x2="${lfx}" y2="${botY + 3}" stroke="#777" stroke-width="0.4" stroke-dasharray="2,2"/>
    <line x1="${rfx}" y1="${topY - 3}" x2="${rfx}" y2="${botY + 3}" stroke="#777" stroke-width="0.4" stroke-dasharray="2,2"/>
    <text x="${lfx}" y="${topY - 4}" text-anchor="middle" font-size="4" fill="#777" font-family="Arial">CF</text>
    <text x="${rfx}" y="${topY - 4}" text-anchor="middle" font-size="4" fill="#777" font-family="Arial">CF</text>`;
}

function svgBeamElevationDetailed(
  beam: Beam, design: BeamDesignData,
  x: number, y: number, drawW: number, drawH: number,
  devLengths: DevelopmentLengths[], allBeams: Beam[],
): string {
  const spanMm  = beam.length * 1000;
  const bH      = beam.h;
  const bB      = beam.b;
  const coverMm = 40;
  const stirDMm = 10;
  const topDia  = Math.max(design.flexLeft.dia, design.flexRight.dia);
  const botDia  = design.flexMid.dia;
  const uTop    = Math.max(design.flexLeft.bars, design.flexRight.bars);
  const d_eff   = bH - coverMm - stirDMm - botDia / 2;

  const dlTop = devLengths.find(d => d.dia === topDia) ?? { ld_straight: Math.round(0.6 * topDia * 420 / Math.sqrt(28)), ldh_standard_hook: Math.max(Math.round(0.24 * topDia * 420 / Math.sqrt(28)), 8 * topDia, 150), dia: topDia } as DevelopmentLengths;
  const dlBot = devLengths.find(d => d.dia === botDia) ?? { ld_straight: Math.round(0.6 * botDia * 420 / Math.sqrt(28)), ldh_standard_hook: Math.max(Math.round(0.24 * botDia * 420 / Math.sqrt(28)), 8 * botDia, 150), dia: botDia } as DevelopmentLengths;

  const leftIsEnd  = _isEndSupport(beam, 'left', allBeams);
  const rightIsEnd = _isEndSupport(beam, 'right', allBeams);
  const adjExtMm   = Math.max(dlTop.ld_straight, spanMm / 5);
  const leftExtMm  = leftIsEnd  ? 0 : adjExtMm;
  const rightExtMm = rightIsEnd ? 0 : adjExtMm;
  const hookBot    = Math.max(12 * botDia, 150);
  const hookTop    = Math.max(12 * topDia, 150);
  const colWMm     = 400;

  const totBot   = design.flexMid.bars;
  const hasBent  = totBot >= 4;
  const nBent    = hasBent ? Math.min(2, Math.floor(totBot / 2)) : 0;
  const nStraight = totBot - nBent;

  // ── Layout ──
  const secPanelW = 88;
  const mainW  = drawW - secPanelW - 6;
  const elevH  = drawH * 0.50;
  const detH   = drawH * 0.45;
  const detY   = y + elevH + 8;

  // ── Scale ──
  const leftRes  = Math.max(leftExtMm + colWMm, colWMm * 1.1);
  const rightRes = Math.max(rightExtMm + colWMm, colWMm * 1.1);
  const totMm    = leftRes + spanMm + rightRes;
  const mX = 4;
  const avW = mainW - mX * 2;
  const avH = elevH - 30;
  const scl   = Math.min(avW / totMm, avH / (bH * 2.2), 0.16);
  const beamW = spanMm * scl;
  const beamH = bH * scl;
  const colW  = colWMm * scl;
  const ox = x + mX + (avW - totMm * scl) / 2 + leftRes * scl;
  const oy = y + 18 + (avH - beamH) / 2;
  const cov    = coverMm * scl;
  const stirD  = stirDMm  * scl;
  const topBarY = oy + cov + stirD + (topDia * scl) / 2;
  const botBarY = oy + beamH - cov - stirD - (botDia * scl) / 2;

  let s = '';

  // ── Header ──
  s += `<text x="${x}" y="${y + 7}" font-size="7" font-weight="bold" fill="#000" font-family="Arial">BEAM ${beam.id}  ·  b=${bB} × h=${bH} mm  ·  L=${beam.length.toFixed(2)} m</text>`;
  s += `<text x="${x}" y="${y + 14}" font-size="5" fill="#666" font-family="Arial">f'c=28 MPa   fy=420 MPa   cover=${coverMm} mm   d_eff=${Math.round(d_eff)} mm</text>`;

  // ── Column dashed outlines ──
  s += _svgDash(ox - colW, oy, ox, oy); s += _svgDash(ox - colW, oy + beamH, ox, oy + beamH); s += _svgDash(ox - colW, oy, ox - colW, oy + beamH);
  s += _svgDash(ox + beamW, oy, ox + beamW + colW, oy); s += _svgDash(ox + beamW, oy + beamH, ox + beamW + colW, oy + beamH); s += _svgDash(ox + beamW + colW, oy, ox + beamW + colW, oy + beamH);

  // ── Column centrelines ──
  s += _svgDash(ox - colW / 2, oy - 8, ox - colW / 2, oy + beamH + 6, '#bbb', 0.4);
  s += _svgDash(ox + beamW + colW / 2, oy - 8, ox + beamW + colW / 2, oy + beamH + 6, '#bbb', 0.4);

  // ── Adjacent beam stubs ──
  if (!leftIsEnd) {
    const ap = leftExtMm * scl;
    s += _svgDash(ox - colW - ap, oy, ox - colW, oy, '#ccc'); s += _svgDash(ox - colW - ap, oy + beamH, ox - colW, oy + beamH, '#ccc'); s += _svgDash(ox - colW - ap, oy, ox - colW - ap, oy + beamH, '#ccc');
  }
  if (!rightIsEnd) {
    const ap = rightExtMm * scl;
    s += _svgDash(ox + beamW + colW, oy, ox + beamW + colW + ap, oy, '#ccc'); s += _svgDash(ox + beamW + colW, oy + beamH, ox + beamW + colW + ap, oy + beamH, '#ccc'); s += _svgDash(ox + beamW + colW + ap, oy, ox + beamW + colW + ap, oy + beamH, '#ccc');
  }

  // ── Beam outline ──
  s += `<rect x="${ox}" y="${oy}" width="${beamW}" height="${beamH}" fill="#f0f8f0" stroke="#000" stroke-width="1.2"/>`;

  // ── Unified top bar ──
  const tStartX = leftIsEnd  ? ox - Math.min(hookTop * 0.5 * scl, colW * 0.7) : ox - colW - leftExtMm * scl;
  const tEndX   = rightIsEnd ? ox + beamW + Math.min(hookTop * 0.5 * scl, colW * 0.7) : ox + beamW + colW + rightExtMm * scl;
  if (leftIsEnd)  s += `<line x1="${tStartX}" y1="${topBarY - hookTop * scl * 0.3}" x2="${tStartX + hookTop * scl * 0.15}" y2="${topBarY}" stroke="#8b0000" stroke-width="1.2"/>`;
  s += `<line x1="${leftIsEnd ? tStartX + hookTop * scl * 0.15 : tStartX}" y1="${topBarY}" x2="${rightIsEnd ? tEndX - hookTop * scl * 0.15 : tEndX}" y2="${topBarY}" stroke="#8b0000" stroke-width="1.2"/>`;
  if (rightIsEnd) s += `<line x1="${tEndX - hookTop * scl * 0.15}" y1="${topBarY}" x2="${tEndX}" y2="${topBarY - hookTop * scl * 0.3}" stroke="#8b0000" stroke-width="1.2"/>`;

  // ── Bottom bar ──
  const bStartX = leftIsEnd  ? ox - hookBot * scl * 0.5 : ox - colW * 0.65;
  const bEndX   = rightIsEnd ? ox + beamW + hookBot * scl * 0.5 : ox + beamW + colW * 0.65;
  if (leftIsEnd)  s += `<line x1="${bStartX}" y1="${botBarY + hookBot * scl * 0.5}" x2="${bStartX + hookBot * scl * 0.2}" y2="${botBarY}" stroke="#1a56db" stroke-width="1.2"/>`;
  s += `<line x1="${leftIsEnd ? bStartX + hookBot * scl * 0.2 : bStartX}" y1="${botBarY}" x2="${rightIsEnd ? bEndX - hookBot * scl * 0.2 : bEndX}" y2="${botBarY}" stroke="#1a56db" stroke-width="1.2"/>`;
  if (rightIsEnd) s += `<line x1="${bEndX - hookBot * scl * 0.2}" y1="${botBarY}" x2="${bEndX}" y2="${botBarY + hookBot * scl * 0.5}" stroke="#1a56db" stroke-width="1.2"/>`;

  // ── Bent bars ──
  let bSeg1 = 0, bDiag = 0, bSeg3 = 0, bSeg5 = 0, bTotal = 0;
  if (hasBent && nBent > 0) {
    const bTY = topBarY + stirD * 0.3; const bBY = botBarY - stirD * 0.3;
    const rise = bBY - bTY; const riseMm = rise / scl; const horiz = riseMm; const diagMm = Math.sqrt(2) * riseMm;
    const dnSt = ox + spanMm * 0.22 * scl; const dnEnd = dnSt + horiz * scl;
    const upEnd = ox + spanMm * 0.78 * scl; const upSt = upEnd - horiz * scl;
    const bLSt = leftIsEnd  ? ox + 2 : ox - colW - leftExtMm * scl;
    const bREn = rightIsEnd ? ox + beamW - 2 : ox + beamW + colW + rightExtMm * scl;
    for (let bi = 0; bi < nBent; bi++) {
      const yo = bi * 2;
      s += `<polyline points="${bLSt},${bTY+yo} ${dnSt},${bTY+yo} ${dnEnd},${bBY+yo} ${upSt},${bBY+yo} ${upEnd},${bTY+yo} ${bREn},${bTY+yo}" fill="none" stroke="#dc6400" stroke-width="1"/>`;
    }
    const lExtB = leftIsEnd  ? 0 : colWMm * 0.5 + leftExtMm;
    const rExtB = rightIsEnd ? 0 : colWMm * 0.5 + rightExtMm;
    bSeg1 = spanMm * 0.22 + lExtB; bDiag = diagMm; bSeg3 = spanMm * (0.78 - 0.22) - 2 * horiz; bSeg5 = spanMm * (1 - 0.78) + rExtB;
    bTotal = bSeg1 + bDiag + bSeg3 + bDiag + bSeg5;
  }

  // ── Stirrups ──
  const stM = design.shear.stirrups.match(/(\d+)Φ(\d+)@(\d+)/);
  const stSp = stM ? parseInt(stM[3]) : 150; const stDv = stM ? parseInt(stM[2]) : 10;
  const z1Sp = Math.max(Math.floor(stSp * 0.6 / 25) * 25, 75);
  const z1L = d_eff * scl; const z1Px = z1Sp * scl; const z2Px = stSp * scl; const fstPx = 50 * scl;
  for (let sx = ox + fstPx; sx <= ox + z1L; sx += z1Px) s += `<line x1="${sx}" y1="${oy+1}" x2="${sx}" y2="${oy+beamH-1}" stroke="#0000b4" stroke-width="0.3"/>`;
  for (let sx = ox + beamW - fstPx; sx >= ox + beamW - z1L; sx -= z1Px) s += `<line x1="${sx}" y1="${oy+1}" x2="${sx}" y2="${oy+beamH-1}" stroke="#0000b4" stroke-width="0.3"/>`;
  for (let sx = ox + z1L + z2Px; sx < ox + beamW - z1L; sx += z2Px) s += `<line x1="${sx}" y1="${oy+1}" x2="${sx}" y2="${oy+beamH-1}" stroke="#0000b4" stroke-width="0.3"/>`;

  // ── Beam dimensions ──
  s += _svgDimV(ox - 14, oy, oy + beamH, `h=${bH}`, '#000');
  s += _svgDimH(ox, ox + beamW, oy + beamH + 10, `Ln = ${beam.length.toFixed(2)} m`, '#000');
  s += `<text x="${ox + beamW/2}" y="${oy + beamH - 2}" text-anchor="middle" font-size="5" fill="#777" font-family="Arial">b=${bB}</text>`;

  // ── Bar info (right of beam) ──
  const inX = ox + beamW + colW + 6; const inY = oy + 8;
  s += `<text x="${inX}" y="${inY}"    font-size="6.5" font-weight="bold" fill="#8b0000" font-family="Arial">حديد علوي: ${uTop}Φ${topDia}</text>`;
  s += `<text x="${inX}" y="${inY+9}"  font-size="6.5" font-weight="bold" fill="#1a56db" font-family="Arial">حديد سفلي: ${nStraight}Φ${botDia}</text>`;
  if (nBent > 0) s += `<text x="${inX}" y="${inY+18}" font-size="6.5" font-weight="bold" fill="#dc6400" font-family="Arial">مكسح: ${nBent}Φ${botDia}</text>`;
  s += `<text x="${inX}" y="${inY+27}" font-size="6.5" font-weight="bold" fill="#0000a0" font-family="Arial">كانات: Φ${stDv}@${z1Sp}/${stSp}</text>`;

  // ── Section cut marks A-A, B-B, C-C ──
  const secPos: [number, string][] = [[ox + colW * 0.1, 'A'], [ox + beamW / 2, 'B'], [ox + beamW - colW * 0.1, 'C']];
  for (const [sx, lb] of secPos) {
    s += `<line x1="${sx-3}" y1="${oy-8}" x2="${sx+3}" y2="${oy-8}" stroke="#000" stroke-width="0.8"/>`;
    s += `<line x1="${sx}" y1="${oy-8}" x2="${sx}" y2="${oy}" stroke="#000" stroke-width="0.8"/>`;
    s += `<line x1="${sx}" y1="${oy+beamH}" x2="${sx}" y2="${oy+beamH+5}" stroke="#000" stroke-width="0.8"/>`;
    s += `<text x="${sx}" y="${oy-10}" text-anchor="middle" font-size="6" font-weight="bold" fill="#000" font-family="Arial">${lb}-${lb}</text>`;
  }

  // ── Cross-sections right panel ──
  const spX = x + mainW + 4; const spH = (elevH - 12) / 3;
  s += _svgCrossSection(spX, y+2,        secPanelW-4, spH-2, bB, bH, coverMm, stirDMm, uTop,            topDia, design.flexMid.bars,          botDia, 'SEC A-A (LEFT)');
  s += _svgCrossSection(spX, y+spH+2,    secPanelW-4, spH-2, bB, bH, coverMm, stirDMm, 0,               topDia, Math.max(nStraight, 2),        botDia, 'SEC B-B (MID)');
  s += _svgCrossSection(spX, y+2*spH+2,  secPanelW-4, spH-2, bB, bH, coverMm, stirDMm, uTop,            topDia, design.flexMid.bars,          botDia, 'SEC C-C (RIGHT)');

  // ═══════════════════════════════════════════════════════
  // PART 2: BAR DETAILING — تفريد الحديد
  // ═══════════════════════════════════════════════════════
  s += `<line x1="${x}" y1="${detY - 6}" x2="${x + drawW}" y2="${detY - 6}" stroke="#000" stroke-width="0.5"/>`;
  s += `<text x="${x}" y="${detY + 1}" font-size="7" font-weight="bold" fill="#000" font-family="Arial">تفريد الحديد — BAR DETAILING</text>`;

  // Bar schedule table
  const topTot = (leftIsEnd ? hookTop : leftExtMm + colWMm/2) + spanMm + (rightIsEnd ? hookTop : rightExtMm + colWMm/2);
  const botTot = (leftIsEnd ? hookBot : colWMm * 0.65) + spanMm + (rightIsEnd ? hookBot : colWMm * 0.65);
  const schX = x + mainW - 72; const schY = detY + 4; const schW = 72; const schRowH = 6;
  const schRows = hasBent && nBent > 0 ? 3 : 2;
  s += `<rect x="${schX}" y="${schY}" width="${schW}" height="${schRowH*(schRows+1)}" fill="white" stroke="#000" stroke-width="0.4"/>`;
  s += `<rect x="${schX}" y="${schY}" width="${schW}" height="${schRowH}" fill="#d0d8f0" stroke="#000" stroke-width="0.4"/>`;
  const cs = [schX+2, schX+12, schX+22, schX+32, schX+52];
  ['رقم','القطر','العدد','الطول mm','البيان'].forEach((h, i) => { s += `<text x="${cs[i]}" y="${schY+schRowH-1}" font-size="4.5" font-weight="bold" fill="#000" font-family="Arial">${h}</text>`; });
  [cs[0]+8, cs[1]+8, cs[2]+8, cs[3]+18].forEach(cx => { s += `<line x1="${cx}" y1="${schY}" x2="${cx}" y2="${schY+schRowH*(schRows+1)}" stroke="#000" stroke-width="0.3"/>`; });
  for (let ri = 1; ri <= schRows; ri++) s += `<line x1="${schX}" y1="${schY+ri*schRowH}" x2="${schX+schW}" y2="${schY+ri*schRowH}" stroke="#000" stroke-width="0.3"/>`;
  const schData = [['1',`Φ${topDia}`,`${uTop}`,`${Math.round(topTot)}`,'علوي'],['2',`Φ${botDia}`,`${nStraight}`,`${Math.round(botTot)}`,'سفلي'],...(hasBent&&nBent>0?[['3',`Φ${botDia}`,`${nBent}`,`${Math.round(bTotal)}`,'مكسح']]:[])] as string[][];
  schData.forEach(([n,d,c,l,b],i) => {
    const ry = schY+(i+1)*schRowH+schRowH-1;
    [n,d,c,l,b].forEach((v,j) => { s += `<text x="${cs[j]}" y="${ry}" font-size="4.5" fill="#000" font-family="Arial">${v}</text>`; });
  });

  // Detail rows layout
  const dSt = detY + 8; const rowCount = hasBent && nBent > 0 ? 3 : 2;
  const bRowH = (detH - 16) / rowCount;
  const dMarg = 8; const dW = mainW - dMarg * 2 - 80;
  const maxL = Math.max(topTot, botTot, bTotal || 0);
  const dScl = (dW - 10) / maxL;
  const dOx = x + dMarg + 8;

  // ROW TOP: Top straight bar
  const r3Y = dSt + bRowH / 2;
  const tELP = leftIsEnd  ? hookTop * dScl * 0.3 : (leftExtMm + colWMm/2) * dScl;
  const tERP = rightIsEnd ? hookTop * dScl * 0.3 : (rightExtMm + colWMm/2) * dScl;
  const tSpP = spanMm * dScl;
  const tx1 = dOx; const tx2 = tx1 + tELP + tSpP + tERP;
  const tCFL = tx1 + tELP; const tCFR = tx1 + tELP + tSpP;
  if (leftIsEnd) {
    s += `<line x1="${tx1}" y1="${r3Y - hookTop*dScl*0.15}" x2="${tx1+hookTop*dScl*0.1}" y2="${r3Y}" stroke="#0000c8" stroke-width="1"/>`;
    s += `<line x1="${tx1+hookTop*dScl*0.1}" y1="${r3Y}" x2="${tx2}" y2="${r3Y}" stroke="#0000c8" stroke-width="1"/>`;
  } else {
    s += `<line x1="${tx1}" y1="${r3Y}" x2="${tCFL}" y2="${r3Y}" stroke="#0000c8" stroke-width="0.5" stroke-dasharray="3,2"/>`;
    s += `<line x1="${tCFL}" y1="${r3Y}" x2="${tx2}" y2="${r3Y}" stroke="#0000c8" stroke-width="1"/>`;
  }
  if (rightIsEnd) s += `<line x1="${tx2-hookTop*dScl*0.1}" y1="${r3Y}" x2="${tx2}" y2="${r3Y-hookTop*dScl*0.15}" stroke="#0000c8" stroke-width="1"/>`;
  else { s += `<line x1="${tCFR}" y1="${r3Y}" x2="${tx2}" y2="${r3Y}" stroke="#0000c8" stroke-width="0.5" stroke-dasharray="3,2"/>`; }
  s += _svgColFaceMarkers(tCFL, tCFR, r3Y-3, r3Y+3);
  if (!leftIsEnd)  s += `<text x="${(tx1+tCFL)/2}" y="${r3Y-7}" text-anchor="middle" font-size="4.5" fill="#0000b4" font-family="Arial">امتداد ${Math.round(leftExtMm)}mm</text>`;
  if (!rightIsEnd) s += `<text x="${(tCFR+tx2)/2}" y="${r3Y-7}" text-anchor="middle" font-size="4.5" fill="#0000b4" font-family="Arial">امتداد ${Math.round(rightExtMm)}mm</text>`;
  s += `<text x="${dOx}" y="${r3Y-bRowH/2+5}" font-size="6" font-weight="bold" fill="#0000a0" font-family="Arial">① حديد علوي: ${uTop}Φ${topDia}</text>`;
  const dTY = r3Y + 8;
  if (!leftIsEnd) s += _svgDimH(tx1, tCFL, dTY, `Ld=${Math.round(leftExtMm+colWMm/2)}`, '#0000b4');
  else            s += _svgDimH(tx1, tx1+hookTop*dScl*0.1, dTY, `hook=${hookTop}`, '#0000b4');
  s += _svgDimH(tCFL, tCFR, dTY, `Ln=${Math.round(spanMm)}`, '#0000b4');
  if (!rightIsEnd) s += _svgDimH(tCFR, tx2, dTY, `Ld=${Math.round(rightExtMm+colWMm/2)}`, '#0000b4');
  else             s += _svgDimH(tx2-hookTop*dScl*0.1, tx2, dTY, `hook=${hookTop}`, '#0000b4');
  s += _svgDimH(tx1, tx2, dTY+8, `إجمالي = ${Math.round(topTot)} mm`, '#b40000');

  // ROW MID: Bent bar
  if (hasBent && nBent > 0) {
    const r2Y = dSt + bRowH + bRowH/2;
    const s1P = bSeg1*dScl; const dP = bDiag*dScl*0.5; const s3P = bSeg3*dScl; const s5P = bSeg5*dScl;
    const rH  = bRowH * 0.4;
    const mx1=dOx; const mx2=mx1+s1P; const mx3=mx2+dP; const mx4=mx3+s3P; const mx5=mx4+dP; const mx6=mx5+s5P;
    if (!leftIsEnd)  s += `<line x1="${mx1}" y1="${r2Y-rH/2}" x2="${tCFL}" y2="${r2Y-rH/2}" stroke="#dc6400" stroke-width="0.5" stroke-dasharray="3,2"/>`;
    if (!rightIsEnd) s += `<line x1="${tCFR}" y1="${r2Y-rH/2}" x2="${mx6}" y2="${r2Y-rH/2}" stroke="#dc6400" stroke-width="0.5" stroke-dasharray="3,2"/>`;
    s += `<polyline points="${leftIsEnd?mx1:tCFL},${r2Y-rH/2} ${mx2},${r2Y-rH/2} ${mx3},${r2Y+rH/2} ${mx4},${r2Y+rH/2} ${mx5},${r2Y-rH/2} ${rightIsEnd?mx6:tCFR},${r2Y-rH/2}" fill="none" stroke="#dc6400" stroke-width="1.2"/>`;
    s += _svgColFaceMarkers(tCFL, tCFR, r2Y-rH/2-3, r2Y+rH/2+3);
    s += `<text x="${dOx}" y="${r2Y-bRowH/2+5}" font-size="6" font-weight="bold" fill="#b45a00" font-family="Arial">② حديد مكسح: ${nBent}Φ${botDia}</text>`;
    const dBA = r2Y-rH/2-7; const dBB = r2Y+rH/2+7;
    s += _svgDimH(mx1, mx2, dBA, `L1=${Math.round(bSeg1)}`, '#b45a00');
    s += _svgDimH(mx2, mx3, dBB, `D=${Math.round(bDiag)}`, '#b45a00');
    s += _svgDimH(mx3, mx4, dBB, `L2=${Math.round(bSeg3)}`, '#b45a00');
    s += _svgDimH(mx4, mx5, dBB, `D=${Math.round(bDiag)}`, '#b45a00');
    s += _svgDimH(mx5, mx6, dBA, `L3=${Math.round(bSeg5)}`, '#b45a00');
    s += _svgDimH(mx1, mx6, dBB+8, `إجمالي ≈ ${Math.round(bTotal)} mm`, '#b40000');
  }

  // ROW BOTTOM: Straight bottom bar
  const r1Y = dSt + bRowH*(rowCount-1) + bRowH/2;
  const bHP = hookBot*dScl; const bSP = spanMm*dScl;
  const bELP = leftIsEnd  ? bHP*0.15 : colWMm*0.65*dScl;
  const bERP = rightIsEnd ? bHP*0.15 : colWMm*0.65*dScl;
  const bbx1=dOx; const bCFL=bbx1+(leftIsEnd?bHP*0.15:bELP); const bCFR=bCFL+bSP; const bbx2=bCFR+(rightIsEnd?bHP*0.15:bERP);
  if (leftIsEnd) s += `<line x1="${bbx1}" y1="${r1Y+bHP*0.4}" x2="${bbx1+bHP*0.15}" y2="${r1Y}" stroke="#006400" stroke-width="1.2"/>`;
  s += `<line x1="${leftIsEnd?bbx1+bHP*0.15:bbx1}" y1="${r1Y}" x2="${rightIsEnd?bbx2-bHP*0.15:bbx2}" y2="${r1Y}" stroke="#006400" stroke-width="1.2"/>`;
  if (rightIsEnd) s += `<line x1="${bbx2-bHP*0.15}" y1="${r1Y}" x2="${bbx2}" y2="${r1Y+bHP*0.4}" stroke="#006400" stroke-width="1.2"/>`;
  s += _svgColFaceMarkers(bCFL, bCFR, r1Y-3, r1Y+3);
  s += `<text x="${dOx}" y="${r1Y-bRowH/2+5}" font-size="6" font-weight="bold" fill="#006400" font-family="Arial">③ حديد سفلي: ${nStraight}Φ${botDia}</text>`;
  const dR1 = r1Y+8;
  if (leftIsEnd)  s += _svgDimH(bbx1, bCFL, dR1, `hook=${hookBot}`, '#006400');
  s += _svgDimH(bCFL, bCFR, dR1, `Ln=${Math.round(spanMm)}`, '#006400');
  if (rightIsEnd) s += _svgDimH(bCFR, bbx2, dR1, `hook=${hookBot}`, '#006400');
  s += _svgDimH(bbx1, bbx2, dR1+8, `إجمالي = ${Math.round(botTot)} mm`, '#b40000');

  return s;
}

function htmlBeamElevationSheet(
  beams: Beam[], beamDesigns: BeamDesignData[],
  tbBase: Partial<TitleBlockConfig>, floorCode: string, startSheetNo: number,
  devLengths: DevelopmentLengths[],
): string {
  const sheetW = _SHEET_W, sheetH = _SHEET_H;
  const titleH = 135 + 36 + 10;
  const contentH = sheetH - 45 - titleH;

  let sheets = '';
  let sheetNo = startSheetNo;

  const elevGroupLabels = buildBeamGroupLabels(beamDesigns);
  for (let i = 0; i < beamDesigns.length; i++) {
    const d = beamDesigns[i];
    let beam = beams.find(b => b.id === d.beamId);

    // Handle merged carrier beams (e.g. "67" whose segments are "67-1","67-2","67-3")
    if (!beam && d.mergedCarrierIds && d.mergedCarrierIds.length > 0) {
      const parts = d.mergedCarrierIds.map(id => beams.find(b => b.id === id)).filter((b): b is Beam => !!b);
      if (parts.length > 0) {
        const largest = parts.reduce((best, b) => b.b * b.h >= best.b * best.h ? b : best, parts[0]);
        const totalLength = d.span ?? parts.reduce((s, b) => s + b.length, 0);
        // Synthesise a single beam record spanning the full girder
        beam = { ...largest, id: d.beamId, length: totalLength };
      }
    }
    if (!beam) continue;

    const groupLabel = elevGroupLabels.get(d.beamId);
    const titlePrefix = groupLabel ? `${groupLabel} — BEAM ${beam.id}` : `BEAM ${beam.id}`;
    const svgContent = svgBeamElevationDetailed(beam, d, 0, 0, sheetW - 90, contentH, devLengths, beams);
    const svgZone = `<svg viewBox="0 0 ${sheetW - 90} ${contentH}" width="${sheetW - 90}" height="${contentH}" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`;

    sheets += `
  <div class="sheet-page" style="position:relative; width:${sheetW}px; height:${sheetH}px; background:white; overflow:hidden; page-break-after:always; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    ${htmlSheetBorder()}
    <div style="position:absolute; top:42px; left:45px; right:45px; height:${contentH}px; overflow:hidden; border:0.5px solid #ccc;">
      ${svgZone}
    </div>
    <div style="position:absolute; bottom:${titleH - 10}px; left:50px; font-size:7px; color:#333; font-family:Arial;">
      <span style="color:#8b0000;">━━</span> حديد علوي &nbsp;
      <span style="color:#1a56db;">━━</span> حديد سفلي &nbsp;
      <span style="color:#dc6400;">━━</span> حديد مكسح &nbsp;
      <span style="color:#0000b4;">━━</span> كانات
    </div>
    ${htmlTitleBlock({ ...tbBase, drawingTitle: `${titlePrefix} — LONGITUDINAL SECTION`, drawingSubTitle: `${beam.b}×${beam.h}mm, Span ${beam.length.toFixed(2)}m`, drawingNumber: makeDrawingNumber(floorCode, 'SE', i + 1), sheetNo: sheetNo.toString(), scale: 'N.T.S.' })}
  </div>`;
    sheetNo++;
  }
  return sheets;
}

export function openBeamElevationForPrint(
  beams: Beam[],
  beamDesigns: BeamDesignData[],
  projectName: string = 'Structural Design Studio',
  options?: ExportOptions,
  paperSize: PaperSize = 'A3',
): void {
  if (beamDesigns.length === 0) return;

  const floorCode  = options?.floorCode || 'GF';
  const storyLabel = options?.storyLabel || '';
  const fc = options?.titleBlockConfig?.fc || 28;
  const fy = options?.titleBlockConfig?.fy || 420;
  const devLengths = (options as any)?.devLengths as DevelopmentLengths[] || [];

  const _paper = getPaperPx(paperSize, 20, 10);
  _SHEET_W = _paper.sheetW; _SHEET_H = _paper.sheetH; _CSS_PAPER = _paper.cssSize;

  const tbBase: Partial<TitleBlockConfig> = {
    firmName: 'Structural Design Studio',
    projectName, projectLocation: '', clientName: '',
    drawingSubTitle: storyLabel, revision: 'R0',
    designedBy: 'ENG.', drawnBy: 'ENG.', checkedBy: '-', approvedBy: '-',
    designCode: 'ACI 318-19',
    ...options?.titleBlockConfig,
    date: new Date().toLocaleDateString(), fc, fy,
  };

  const sheetsHTML = htmlBeamElevationSheet(beams, beamDesigns, tbBase, floorCode, 1, devLengths);

  const htmlContent = `<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="utf-8">
  <title>${projectName} - ${floorCode} - مقاطع الجسور الطولية</title>
  <style>
    @page { size: ${_CSS_PAPER} landscape; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #e0e0e0; font-family: 'Segoe UI', Arial, Tahoma, sans-serif; }
    .sheet-page { margin: 10px auto; box-shadow: 0 2px 10px rgba(0,0,0,0.3); }
    @media print {
      body { background: white; }
      .sheet-page { margin: 0; box-shadow: none; page-break-after: always; }
    }
  </style>
</head>
<body>
  ${sheetsHTML}
</body>
</html>`;

  import('@/lib/capacitorDownload').then(({ openHTMLForPrint }) =>
    openHTMLForPrint(htmlContent)
  );
}

// ─── BBS HTML Sheet ───

function htmlBBSSheet(
  beams: Beam[], beamDesigns: BeamDesignData[], colDesigns: ColDesignData[], slabDesigns: SlabDesignData[],
  tbBase: Partial<TitleBlockConfig>, floorCode: string, startSheetNo: number,
): string {
  // Build entries inline (simplified weights)
  const barW = (dia: number, lenM: number) => (dia * dia / 162.2) * lenM;
  const hook = (dia: number) => Math.max(12 * dia / 1000, 0.15);

  interface SimpleEntry { mark: string; member: string; type: string; dia: number; len: number; qty: number; wt: number; }
  const entries: SimpleEntry[] = [];
  let mk = 1;

  for (const d of beamDesigns) {
    const beam = beams.find(b => b.id === d.beamId);
    if (!beam) continue;
    const L = beam.length;
    const isShort = L <= 2.0;
    const totalBot = d.flexMid.bars;
    const bentCount = (!isShort && totalBot >= 4) ? Math.min(2, Math.floor(totalBot / 2)) : 0;
    const straightBot = totalBot - bentCount;
    const topLenL = L * 0.30 + hook(d.flexLeft.dia);
    const topLenR = L * 0.30 + hook(d.flexRight.dia);
    const botLen = L + 2 * hook(d.flexMid.dia);
    entries.push({ mark: `T${mk}L`, member: d.beamId, type: 'جسر-علوي', dia: d.flexLeft.dia, len: parseFloat(topLenL.toFixed(2)), qty: d.flexLeft.bars, wt: parseFloat((barW(d.flexLeft.dia, d.flexLeft.bars * topLenL) * 1.05).toFixed(1)) });
    entries.push({ mark: `T${mk}R`, member: d.beamId, type: 'جسر-علوي', dia: d.flexRight.dia, len: parseFloat(topLenR.toFixed(2)), qty: d.flexRight.bars, wt: parseFloat((barW(d.flexRight.dia, d.flexRight.bars * topLenR) * 1.05).toFixed(1)) });
    entries.push({ mark: `B${mk}`, member: d.beamId, type: 'جسر-سفلي', dia: d.flexMid.dia, len: parseFloat(botLen.toFixed(2)), qty: straightBot, wt: parseFloat((barW(d.flexMid.dia, straightBot * botLen) * 1.05).toFixed(1)) });
    if (bentCount > 0) {
      const bL = L * 0.6 + 2 * hook(d.flexMid.dia);
      entries.push({ mark: `BK${mk}`, member: d.beamId, type: 'جسر-مكسح', dia: d.flexMid.dia, len: parseFloat(bL.toFixed(2)), qty: bentCount, wt: parseFloat((barW(d.flexMid.dia, bentCount * bL) * 1.05).toFixed(1)) });
    }
    const sm = d.shear.stirrups.match(/(\d+)Φ(\d+)@(\d+)/);
    if (sm) {
      const sDia = parseInt(sm[2]); const sSp = parseInt(sm[3]);
      const nS = Math.ceil((L * 1000) / sSp);
      const sLen = parseFloat((2 * ((beam.b - 80) / 1000 + (beam.h - 80) / 1000) + 2 * hook(sDia)).toFixed(2));
      entries.push({ mark: `S${mk}`, member: d.beamId, type: 'كانات-جسر', dia: sDia, len: sLen, qty: nS, wt: parseFloat((barW(sDia, nS * sLen) * 1.05).toFixed(1)) });
    }
    mk++;
  }
  for (const c of colDesigns) {
    const lap = 40 * c.design.dia / 1000;
    const len = parseFloat((3.0 + lap).toFixed(2));
    entries.push({ mark: `C${mk}`, member: c.id, type: 'عمود', dia: c.design.dia, len, qty: c.design.bars, wt: parseFloat((barW(c.design.dia, c.design.bars * len) * 1.03).toFixed(1)) });
    mk++;
  }
  for (const s of slabDesigns) {
    entries.push({ mark: `SL${mk}S`, member: s.id, type: 'بلاطة', dia: s.design.shortDir.dia, len: parseFloat((s.design.lx + 0.3).toFixed(2)), qty: Math.ceil(s.design.ly * 1000 / s.design.shortDir.spacing), wt: 0 });
    entries.push({ mark: `SL${mk}L`, member: s.id, type: 'بلاطة', dia: s.design.longDir.dia, len: parseFloat((s.design.ly + 0.3).toFixed(2)), qty: Math.ceil(s.design.lx * 1000 / s.design.longDir.spacing), wt: 0 });
    mk++;
  }

  const totalWt = entries.reduce((s, e) => s + e.wt, 0);
  const diaSummary = new Map<number, number>();
  for (const e of entries) diaSummary.set(e.dia, (diaSummary.get(e.dia) || 0) + e.wt);

  let tableRows = entries.map(e =>
    `<tr><td>${e.mark}</td><td>${e.member}</td><td>${e.type}</td><td>Φ${e.dia}</td><td>${e.len.toFixed(2)}</td><td>${e.qty}</td><td>${(e.qty * e.len).toFixed(2)}</td><td>${e.wt.toFixed(1)}</td></tr>`
  ).join('');

  let sumRows = [...diaSummary.entries()].sort((a, b) => a[0] - b[0]).map(([d, w]) =>
    `<tr><td>Φ${d}</td><td>${w.toFixed(1)} kg</td></tr>`
  ).join('');

  const sheetW = _SHEET_W, sheetH = _SHEET_H;
  const titleH = 135 + 36 + 10;
  const contentH = sheetH - 45 - titleH;

  return `
  <div class="sheet-page" style="position:relative; width:${sheetW}px; height:${sheetH}px; background:white; overflow:hidden; page-break-after:always; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    ${htmlSheetBorder()}
    <div style="position:absolute; top:45px; left:45px; right:45px; height:${contentH}px; overflow:hidden; direction:rtl; padding:6px;">
      <div style="font-size:13px; font-weight:bold; border-bottom:2px solid #1a3a5c; padding-bottom:4px; margin-bottom:6px; color:#1a3a5c;">جدول حصر الحديد — BAR BENDING SCHEDULE</div>
      <div style="display:flex; gap:16px; height:calc(100% - 30px); overflow:hidden;">
        <div style="flex:1; overflow:hidden;">
          <table style="width:100%; border-collapse:collapse; font-size:8px; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
            <thead>
              <tr>
                <th style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">الرقم</th>
                <th style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">العنصر</th>
                <th style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">النوع</th>
                <th style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">القطر</th>
                <th style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">الطول (م)</th>
                <th style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">العدد</th>
                <th style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">إجمالي طول (م)</th>
                <th style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">الوزن (كغ)</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
            <tfoot>
              <tr><td colspan="7" style="border:1px solid #000; background:#eee; font-weight:bold; padding:3px; text-align:right;">إجمالي الوزن</td>
              <td style="border:1px solid #000; background:#eee; font-weight:bold; padding:3px;">${totalWt.toFixed(1)}</td></tr>
            </tfoot>
          </table>
        </div>
        <div style="width:160px; flex-shrink:0;">
          <div style="font-weight:bold; font-size:9px; margin-bottom:4px; color:#1a3a5c;">ملخص بحسب القطر</div>
          <table style="width:100%; border-collapse:collapse; font-size:8px;">
            <thead><tr>
              <th style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">القطر</th>
              <th style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">الوزن (كغ)</th>
            </tr></thead>
            <tbody>${sumRows}</tbody>
          </table>
          <div style="margin-top:10px; font-size:7.5px; color:#555; line-height:1.6;">
            <div>• الأوزان تشمل هدر 5% للجسور</div>
            <div>• 3% للأعمدة، 8% للبلاطات</div>
            <div>• الطول بالمتر، الوزن بالكيلوغرام</div>
            <div>• حديد التسليح: fy=${tbBase.fy || 420} MPa</div>
          </div>
        </div>
      </div>
    </div>
    ${htmlTitleBlock({ ...tbBase, drawingTitle: 'BAR BENDING SCHEDULE / جدول حصر الحديد', drawingSubTitle: tbBase.drawingSubTitle || 'All Floors', drawingNumber: makeDrawingNumber(floorCode, 'BBS', 1), sheetNo: startSheetNo.toString(), scale: 'N.T.S.' })}
  </div>`;
}

// ─── Main export function ───

export function generateHTMLConstructionSheets(
  slabs: Slab[],
  beams: Beam[],
  columns: Column[],
  beamDesigns: BeamDesignData[],
  colDesigns: ColDesignData[],
  slabDesigns: SlabDesignData[],
  projectName: string = 'Structural Design Studio',
  options?: ExportOptions,
  paperSize: PaperSize = 'auto',
  slabProps?: SlabProps,
  mat?: MatProps,
): string {
  const floorCode = options?.floorCode || 'GF';
  const storyLabel = options?.storyLabel || '';
  const fc = options?.titleBlockConfig?.fc || 28;
  const fy = options?.titleBlockConfig?.fy || 420;
  const date = new Date().toLocaleDateString();

  const tbBase: Partial<TitleBlockConfig> = {
    firmName: 'Structural Design Studio',
    projectName,
    projectLocation: '',
    clientName: '',
    drawingSubTitle: '',
    revision: 'R0',
    designedBy: 'ENG.',
    drawnBy: 'ENG.',
    checkedBy: '-',
    approvedBy: '-',
    designCode: 'ACI 318-19',
    ...options?.titleBlockConfig,
    date,
    fc, fy,
  };

  // Compute plan extents
  const allX = slabs.flatMap(s => [s.x1, s.x2]);
  const allY = slabs.flatMap(s => [s.y1, s.y2]);
  if (allX.length === 0) return '<p>لا توجد بيانات للتصدير</p>';

  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const modelW = maxX - minX;
  const modelH = maxY - minY;

  // Determine paper size (auto picks A4/A3/A1 based on plan extent) — always landscape
  const _paper = getPaperPx(paperSize, modelW, modelH);
  _SHEET_W = _paper.sheetW;
  _SHEET_H = _paper.sheetH;
  _CSS_PAPER = _paper.cssSize;

  // SVG viewbox for plan zone — the plan occupies 62% of the sheet width (rest is schedule table)
  // We compute mmPerM based on the plan zone to ensure the drawing fills the available area.
  const titleBlockH = 135 + 36 + 10;
  const svgW = _SHEET_W - 90;   // full inner sheet width
  const svgH = _SHEET_H - 45 - titleBlockH;
  // Plan display zone = 72% of inner width (matches generateSheetHTML planW calculation)
  const planZoneW = Math.round(svgW * 0.72);
  const mmPerM = Math.min((planZoneW - 20) / modelW, (svgH - 20) / modelH);
  const planOffsetX = 10 + ((planZoneW - 20) - modelW * mmPerM) / 2;
  const planOffsetY = 10 + ((svgH - 20) - modelH * mmPerM) / 2;
  const tx = (x: number) => (x - minX) * mmPerM + planOffsetX;
  const ty = (y: number) => (maxY - y) * mmPerM + planOffsetY;

  const gridX = Array.from(new Set(allX)).sort((a, b) => a - b);
  const gridY = Array.from(new Set(allY)).sort((a, b) => a - b);
  const scaleVal = Math.round(1000 / mmPerM);
  const scaleText = `1:${scaleVal}`;

  // Build group label maps for plan SVG labels
  const beamGroupLabels = buildBeamGroupLabels(beamDesigns);
  const colGroupLabels = buildColGroupLabels(colDesigns);
  const slabGroupLabels = buildSlabGroupLabels(slabDesigns);

  const gridSvg = svgGridSystem(gridX, gridY, tx, ty, minX, maxX, minY, maxY);

  let sheetsHTML = '';

  // ═══════════════════════════════════════════════════
  // SHEET 1: BEAM LAYOUT PLAN
  // ═══════════════════════════════════════════════════
  const bsDwg = makeDrawingNumber(floorCode, 'BS', 1);
  const beamPlanSvg = gridSvg
    + svgColumns(columns, tx, ty, mmPerM, true, false)
    + svgBeamsOnPlan(beams, columns, tx, ty, mmPerM, beamGroupLabels)
    + svgScaleBar(planZoneW / 2 - 60, svgH - 35, scaleVal);

  sheetsHTML += generateSheetHTML(
    'beam-layout',
    beamPlanSvg,
    planZoneW, svgH,
    htmlBeamScheduleTable(beams, beamDesigns),
    {
      ...tbBase,
      drawingTitle: 'BEAM LAYOUT PLAN / مخطط الجسور',
      drawingSubTitle: storyLabel || 'All Floors',
      drawingNumber: bsDwg,
      sheetNo: '1',
      scale: scaleText,
    },
  );

  // ═══════════════════════════════════════════════════
  // SHEET 2: COLUMN LAYOUT PLAN
  // ═══════════════════════════════════════════════════
  const csDwg = makeDrawingNumber(floorCode, 'CS', 1);
  const colPlanSvg = gridSvg
    + svgColumns(columns, tx, ty, mmPerM, true, true)
    + svgScaleBar(planZoneW / 2 - 60, svgH - 35, scaleVal);

  // Column cross-sections SVG
  const colPatternMap = new Map<string, ColDesignData[]>();
  for (const cd of colDesigns) {
    const key = `${cd.b}_${cd.h}_${cd.design.bars}_${cd.design.dia}_${cd.design.stirrups}`;
    if (!colPatternMap.has(key)) colPatternMap.set(key, []);
    colPatternMap.get(key)!.push(cd);
  }

  let colSectionsSvg = '';
  const patternEntries = Array.from(colPatternMap.entries());
  const secW = 140;
  const secH = 150;
  const colsPerRow = 3;
  let secIdx = 0;
  for (const [, group] of patternEntries) {
    const rep = group[0];
    const row = Math.floor(secIdx / colsPerRow);
    const col = secIdx % colsPerRow;
    const sx = col * secW;
    const sy = row * (secH + 15);
    colSectionsSvg += svgColumnCrossSection(rep, sx, sy, secW, secH);
    secIdx++;
  }

  const colSecSvgH = Math.ceil(patternEntries.length / colsPerRow) * (secH + 15);
  const colTableAndSections = htmlColumnScheduleTable(colDesigns)
    + `<div style="margin-top:12px;">
        <div style="font-weight:bold; font-size:10px; margin-bottom:4px; font-family:Arial;">COLUMN SECTIONS / مقاطع الأعمدة</div>
        <svg viewBox="0 0 ${colsPerRow * secW} ${colSecSvgH}" width="100%" height="${Math.min(colSecSvgH, 350)}px" xmlns="http://www.w3.org/2000/svg">
          ${colSectionsSvg}
        </svg>
      </div>`;

  sheetsHTML += generateSheetHTML(
    'column-layout',
    colPlanSvg,
    planZoneW, svgH,
    colTableAndSections,
    {
      ...tbBase,
      drawingTitle: 'COLUMN LAYOUT PLAN / مخطط الأعمدة',
      drawingSubTitle: storyLabel || 'All Floors',
      drawingNumber: csDwg,
      sheetNo: '2',
      scale: scaleText,
    },
  );

  // ═══════════════════════════════════════════════════
  // SHEET 3: SLAB REINFORCEMENT PLAN (Strip Method)
  // ═══════════════════════════════════════════════════
  const slDwg = makeDrawingNumber(floorCode, 'SL', 1);

  // تحليل الشرائح المستمرة إذا توفرت slabProps وmat
  let stripResults: ContinuousSlabResult[] = [];
  if (slabProps && mat && slabs.length >= 2) {
    try {
      stripResults = analyzeAllContinuousSlabs(slabs, slabProps, mat);
    } catch (_) {
      stripResults = [];
    }
  }

  const slabPlanSvg = gridSvg
    + svgColumns(columns, tx, ty, mmPerM, true, false)
    + svgSlabsOnPlan(
        slabs, slabDesigns, tx, ty, mmPerM,
        slabGroupLabels,
        stripResults.length > 0 ? stripResults : undefined,
        slabProps?.phiSlab,
      )
    + svgScaleBar(planZoneW / 2 - 60, svgH - 35, scaleVal);

  const slabTableHTML = (slabProps && mat && stripResults.length > 0)
    ? htmlSlabStripTable(stripResults, slabProps, mat)
    : htmlSlabScheduleTable(slabDesigns);

  sheetsHTML += generateSheetHTML(
    'slab-plan',
    slabPlanSvg,
    planZoneW, svgH,
    slabTableHTML,
    {
      ...tbBase,
      drawingTitle: 'SLAB REINFORCEMENT PLAN / مخطط تسليح البلاطات (طريقة الشرائح)',
      drawingSubTitle: storyLabel || 'All Floors',
      drawingNumber: slDwg,
      sheetNo: '3',
      scale: scaleText,
    },
  );

  // ═══════════════════════════════════════════════════
  // SHEET 4: GENERAL NOTES
  // ═══════════════════════════════════════════════════
  const ntDwg = makeDrawingNumber(floorCode, 'NT', 1);
  const devLengths = options?.devLengths || [];
  
  let devLengthRows = '';
  for (const dl of devLengths) {
    devLengthRows += `<tr>
      <td>${dl.dia}</td>
      <td>${dl.ld_straight}</td>
      <td>${dl.ldh_standard_hook}</td>
      <td>${dl.ld_compression}</td>
      <td>${dl.lap_classA}</td>
      <td>${dl.lap_classB}</td>
      <td>${dl.lap_column}</td>
    </tr>`;
  }

  const _gnContentH = _SHEET_H - 45 - (135 + 36 + 10);
  const generalNotesHTML = `
  <div class="sheet-page" style="position:relative; width:${_SHEET_W}px; height:${_SHEET_H}px; background:white; overflow:hidden; page-break-after:always; font-family:'Segoe UI',Arial,Tahoma,sans-serif; direction:rtl;">
    ${htmlSheetBorder()}
    
    <div style="position:absolute; top:45px; left:45px; right:45px; height:${_gnContentH}px; overflow:hidden; padding:10px;">
      <h2 style="text-align:center; font-size:16px; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:12px;">ملاحظات عامة — GENERAL NOTES</h2>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; font-size:10px;">
        <div>
          <h3 style="font-size:12px; color:#1a56db; border-right:3px solid #1a56db; padding-right:6px;">مواد البناء</h3>
          <ul style="list-style:disc; padding-right:20px; line-height:1.8;">
            <li>مقاومة الخرسانة المميزة f'c = ${fc} ميغاباسكال</li>
            <li>إجهاد خضوع حديد التسليح fy = ${fy} ميغاباسكال</li>
            <li>إجهاد خضوع حديد الكانات fyt = ${fy} ميغاباسكال</li>
            <li>الغطاء الخرساني: 40 مم للجسور والأعمدة، ${options?.titleBlockConfig?.fc ? '20' : '20'} مم للبلاطات</li>
            <li>جميع الأبعاد بالمليمتر ما لم يذكر خلاف ذلك</li>
          </ul>
          
          <h3 style="font-size:12px; color:#1a56db; border-right:3px solid #1a56db; padding-right:6px; margin-top:12px;">معايير التصميم</h3>
          <ul style="list-style:disc; padding-right:20px; line-height:1.8;">
            <li>التصميم وفق الكود الأمريكي ACI 318-19</li>
            <li>الرسومات وفق معيار ACI 315-99</li>
            <li>لوحة العنوان وفق معيار ISO 7200</li>
            <li>حالات التحميل: 1.2D + 1.6L (حرجة) | 1.4D | 0.9D + 1.0E</li>
          </ul>
        </div>
        
        <div>
          <h3 style="font-size:12px; color:#1a56db; border-right:3px solid #1a56db; padding-right:6px;">ملاحظات التنفيذ</h3>
          <ul style="list-style:disc; padding-right:20px; line-height:1.8;">
            <li>يجب التحقق من أطوال التماسك والوصلات حسب الكود</li>
            <li>يجب توفير أكبر إقصاء ممكن لعناصر الأعمدة في المناطق الحرجة</li>
            <li>لا يجوز قطع أكثر من نصف حديد التسليح عند نفس المقطع</li>
            <li>يجب أن تكون مسافة الوصل لا تقل عن ld حسب الجدول أدناه</li>
            <li>يجب فحص الخرسانة بعد 7 أيام و 28 يوماً</li>
            <li>البلاطات: تسليح أدنى في الاتجاه الرئيسي والثانوي</li>
            <li>أقصى مسافة بين الكانات في المنطقة الحرجة: d/4 أو 8db أو 300 مم (الأقل)</li>
          </ul>
        </div>
      </div>
      
      ${devLengths.length > 0 ? `
      <div style="margin-top:16px;">
        <h3 style="font-size:12px; color:#1a56db; border-right:3px solid #1a56db; padding-right:6px;">جدول أطوال التماسك (مم) — Development Lengths</h3>
        <table style="width:100%; border-collapse:collapse; font-size:9px; margin-top:6px;">
          <thead>
            <tr>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">القطر Φ</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">ld مستقيم</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">ldh خطاف</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">ld ضغط</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">وصل A</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">وصل B</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">وصل عمود</th>
            </tr>
          </thead>
          <tbody>${devLengthRows}</tbody>
        </table>
      </div>` : ''}
    </div>
    
    ${htmlTitleBlock({
      ...tbBase,
      drawingTitle: 'GENERAL NOTES / ملاحظات عامة',
      drawingSubTitle: storyLabel || 'All Floors',
      drawingNumber: ntDwg,
      sheetNo: '4',
      scale: 'N.T.S.',
    })}
  </div>`;

  sheetsHTML += generalNotesHTML;

  // ═══════════════════════════════════════════════════
  // SHEET 5+: BBS (Bar Bending Schedule)
  // ═══════════════════════════════════════════════════
  if (beamDesigns.length > 0 || colDesigns.length > 0) {
    const bbsSheetNo = 5;
    sheetsHTML += htmlBBSSheet(beams, beamDesigns, colDesigns, slabDesigns, { ...tbBase, drawingSubTitle: storyLabel || 'All Floors' }, floorCode, bbsSheetNo);
  }

  // Wrap everything in a printable HTML document
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <title>${projectName} - ${floorCode} - لوحات إنشائية</title>
  <style>
    @page { size: ${_CSS_PAPER} landscape; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #e0e0e0; font-family: 'Segoe UI', 'Arial', 'Tahoma', sans-serif; direction: ltr; }
    .sheet-page { margin: 10px auto; box-shadow: 0 2px 10px rgba(0,0,0,0.3); }
    table td, table th { border: 1px solid #333; padding: 3px 5px; text-align: center; }
    @media print {
      body { background: white; }
      .sheet-page { margin: 0; box-shadow: none; page-break-after: always; }
    }
  </style>
</head>
<body>
  ${sheetsHTML}
</body>
</html>`;
}

// ─── Open in new window for printing ───

export function openHTMLSheetsForPrint(
  slabs: Slab[],
  beams: Beam[],
  columns: Column[],
  beamDesigns: BeamDesignData[],
  colDesigns: ColDesignData[],
  slabDesigns: SlabDesignData[],
  projectName: string,
  options?: ExportOptions,
  paperSize: 'A1' | 'A3' | 'A4' | 'auto' = 'auto',
  slabProps?: SlabProps,
  mat?: MatProps,
): void {
  const htmlContent = generateHTMLConstructionSheets(
    slabs, beams, columns, beamDesigns, colDesigns, slabDesigns,
    projectName, options, paperSize, slabProps, mat,
  );
  
  import('@/lib/capacitorDownload').then(({ openHTMLForPrint }) =>
    openHTMLForPrint(htmlContent)
  );
}
