/**
 * HTML-based Construction Drawing Generator — ISO 7200 / ACI 315-99 Compliant
 * Generates construction sheets as HTML with full Arabic text support,
 * matching the jsPDF-based constructionSheets.ts layout exactly.
 * 
 * Uses html2canvas to convert to images for PDF export or opens print dialog.
 */

import type { Slab, Column, Beam, FlexureResult, ShearResult, ColumnResult, SlabDesignResult } from '@/lib/structuralEngine';
import { getFloorCode, makeDrawingNumber, type TitleBlockConfig, type ExportOptions, type DevelopmentLengths } from './drawingStandards';

interface BeamDesignData {
  beamId: string;
  flexLeft: FlexureResult;
  flexMid: FlexureResult;
  flexRight: FlexureResult;
  shear: ShearResult;
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
): string {
  let svg = '';
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

    const mx = (bx1 + bx2) / 2;
    const my = (by1 + by2) / 2;
    const labelOffset = isHoriz ? -beamThickPx / 2 - 10 : beamThickPx / 2 + 5;
    if (isHoriz) {
      svg += `<text x="${mx}" y="${my + labelOffset}" font-size="7" font-weight="bold" fill="#005000" font-family="Arial">${b.id}</text>`;
    } else {
      svg += `<text x="${mx + labelOffset}" y="${my}" font-size="7" font-weight="bold" fill="#005000" font-family="Arial">${b.id}</text>`;
    }
  }
  return svg;
}

function svgSlabsOnPlan(
  slabs: Slab[], slabDesigns: SlabDesignData[],
  tx: (x: number) => number, ty: (y: number) => number, mmPerM: number,
): string {
  let svg = '';
  for (const s of slabs) {
    const sd = slabDesigns.find(d => d.id === s.id);
    if (!sd) continue;
    const x = tx(s.x1);
    const y = ty(s.y2);
    const w = (s.x2 - s.x1) * mmPerM;
    const h = (s.y2 - s.y1) * mmPerM;
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000096" stroke-width="0.7" />`;
    
    const cx = tx((s.x1 + s.x2) / 2);
    const cy = ty((s.y1 + s.y2) / 2);
    svg += `<text x="${cx}" y="${cy - 16}" text-anchor="middle" font-size="7" font-weight="bold" fill="#000078" font-family="Arial">${s.id}</text>`;
    svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="6" fill="#000078" font-family="Arial">h=${sd.design.hUsed}</text>`;
    svg += `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="5.5" fill="#000078" font-family="Arial">${sd.design.shortDir.bars}Φ${sd.design.shortDir.dia}@${sd.design.shortDir.spacing}</text>`;
    svg += `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="5.5" fill="#000078" font-family="Arial">${sd.design.longDir.bars}Φ${sd.design.longDir.dia}@${sd.design.longDir.spacing}</text>`;
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
  let rows = '';
  for (const d of beamDesigns) {
    const beam = beams.find(b => b.id === d.beamId);
    const spanM = beam?.length ?? 999;
    const totalBot = d.flexMid.bars;
    // No curtailment for beams ≤ 2 m — all bottom bars run full span
    const isShort = spanM <= 2.0;
    const hasBent = !isShort && totalBot >= 4;
    const bentCount = hasBent ? Math.min(2, Math.floor(totalBot / 2)) : 0;
    const straightBot = totalBot - bentCount;

    rows += `<tr>
      <td>${d.beamId}</td>
      <td>${beam?.b ?? ''}</td>
      <td>${beam?.h ?? ''}</td>
      <td>${(spanM < 900 ? spanM.toFixed(2) : '—')}</td>
      <td>${fmtRebar(straightBot, d.flexMid.dia)}</td>
      <td>${bentCount > 0 ? fmtRebar(bentCount, d.flexMid.dia) : '—'}</td>
      <td>${d.flexLeft.bars > 0 ? fmtRebar(d.flexLeft.bars, d.flexLeft.dia) : '—'}</td>
      <td>${d.flexRight.bars > 0 ? fmtRebar(d.flexRight.bars, d.flexRight.dia) : '—'}</td>
      <td>${d.shear.stirrups}</td>
    </tr>`;
  }

  return `
  <div style="font-weight:bold; font-size:11px; margin-bottom:4px; font-family:Arial;">BEAM SCHEDULE / جدول الجسور</div>
  <table style="width:100%; border-collapse:collapse; font-size:8.5px; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    <thead>
      <tr>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">الجسر</th>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">B</th>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">H</th>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">L (m)</th>
        <th colspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">سفلي</th>
        <th colspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">علوي</th>
        <th rowspan="2" style="border:1px solid #000; background:#1a3a5c; color:#fff; padding:3px;">الكانات</th>
      </tr>
      <tr>
        <th style="border:1px solid #000; background:#2a4a6c; color:#fff; padding:2px; font-size:7.5px;">مستقيم</th>
        <th style="border:1px solid #000; background:#2a4a6c; color:#fff; padding:2px; font-size:7.5px;">مكسح*</th>
        <th style="border:1px solid #000; background:#2a4a6c; color:#fff; padding:2px; font-size:7.5px;">يسار</th>
        <th style="border:1px solid #000; background:#2a4a6c; color:#fff; padding:2px; font-size:7.5px;">يمين</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="font-size:7.5px; color:#555; margin-top:3px;">* التكسيح للجسور L > 2.0 م فقط — الجسور القصيرة: حديد سفلي مستمر كامل الطول</div>`;
}

function htmlColumnScheduleTable(colDesigns: ColDesignData[]): string {
  let rows = '';
  for (const c of colDesigns) {
    rows += `<tr>
      <td>${c.id}</td>
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
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">العمود</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">B mm</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">H mm</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">التسليح</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">الكانات</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function htmlSlabScheduleTable(slabDesigns: SlabDesignData[]): string {
  let rows = '';
  for (const s of slabDesigns) {
    rows += `<tr>
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
  </table>`;
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
  // Auto-fit drawing to full page width; tables go on a follow-up sheet.
  const sheetW = _SHEET_W;
  const sheetH = _SHEET_H;
  const titleBlockH = 135 + 36 + 10;
  const drawZoneW = sheetW - 90;       // full content width inside borders
  const contentH = sheetH - 45 - titleBlockH;

  const drawingPage = `
  <div class="sheet-page" style="position:relative; width:${sheetW}px; height:${sheetH}px; background:white; overflow:hidden; page-break-after:always; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    ${htmlSheetBorder()}
    <div style="position:absolute; top:45px; left:45px; width:${drawZoneW}px; height:${contentH}px; overflow:hidden; border:0.5px solid #ccc;">
      <svg viewBox="0 0 ${svgDrawW} ${svgDrawH}" width="${drawZoneW}" height="${contentH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        ${svgDrawingZone}
      </svg>
    </div>
    ${extraSvgBottom || ''}
    ${htmlTitleBlock(titleBlockConfig)}
  </div>`;

  const hasTable = tableContent && tableContent.trim().length > 0;
  if (!hasTable) return drawingPage;

  const tablePage = `
  <div class="sheet-page" style="position:relative; width:${sheetW}px; height:${sheetH}px; background:white; overflow:hidden; page-break-after:always; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    ${htmlSheetBorder()}
    <div style="position:absolute; top:45px; left:45px; right:45px; height:${contentH}px; overflow:hidden; direction:rtl; padding:6px;">
      ${tableContent}
    </div>
    ${htmlTitleBlock({ ...titleBlockConfig, drawingSubTitle: (titleBlockConfig.drawingSubTitle || '') + ' — Schedule' })}
  </div>`;

  return drawingPage + tablePage;
}

// ─── Beam Elevation Sheet (HTML) ─── 

function svgSingleBeamElevation(
  beam: Beam, design: BeamDesignData,
  ox: number, oy: number, zoneW: number, zoneH: number,
): string {
  const spanM = beam.length;
  const isShort = spanM <= 2.0;
  const scl = (zoneW - 36) / spanM;
  const bh = Math.min(zoneH - 48, Math.max(24, (beam.h / 1000) * scl * 2.5));
  const bx = ox + 18;
  const by = oy + 22;
  const bw = spanM * scl;
  const cover = 4;

  const totalBot = design.flexMid.bars;
  const bentCount = (!isShort && totalBot >= 4) ? Math.min(2, Math.floor(totalBot / 2)) : 0;
  const straightBot = totalBot - bentCount;

  const stirMatch = design.shear.stirrups.match(/(\d+)Φ(\d+)@(\d+)/);
  const stirSpacing = stirMatch ? parseInt(stirMatch[3]) : 200;
  const nStirs = Math.min(30, Math.ceil((spanM * 1000) / stirSpacing));

  let s = '';
  // Beam body
  s += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#f0f8f0" stroke="#333" stroke-width="1.2"/>`;
  // Column stubs at supports
  const colW = Math.min(20, bw * 0.12);
  s += `<rect x="${bx - colW}" y="${by - 8}" width="${colW}" height="${bh + 16}" fill="#ccc" stroke="#555" stroke-width="1"/>`;
  s += `<rect x="${bx + bw}" y="${by - 8}" width="${colW}" height="${bh + 16}" fill="#ccc" stroke="#555" stroke-width="1"/>`;
  // Stirrups
  for (let i = 1; i < nStirs; i++) {
    const sx = bx + (i / nStirs) * bw;
    s += `<line x1="${sx}" y1="${by + 2}" x2="${sx}" y2="${by + bh - 2}" stroke="#aaa" stroke-width="0.5"/>`;
  }
  // Bottom straight bars
  const botY = by + bh - cover - 2;
  s += `<line x1="${bx + 2}" y1="${botY}" x2="${bx + bw - 2}" y2="${botY}" stroke="#1a56db" stroke-width="${Math.max(1.5, straightBot * 0.7)}" stroke-linecap="round"/>`;
  s += `<text x="${bx + bw / 2}" y="${botY + 9}" text-anchor="middle" font-size="7" fill="#1a56db" font-family="Arial">${straightBot > 0 ? fmtRebar(straightBot, design.flexMid.dia) : ''}</text>`;
  // Bent-up bars (only for L > 2m)
  if (bentCount > 0) {
    const b1 = bw * 0.22; const b2 = bw * 0.42;
    s += `<polyline points="${bx + b1},${botY} ${bx + b2},${by + cover + 2}" fill="none" stroke="#c44" stroke-width="1.2"/>`;
    s += `<line x1="${bx}" y1="${by + cover + 2}" x2="${bx + b2}" y2="${by + cover + 2}" stroke="#c44" stroke-width="1.2"/>`;
    const b3 = bw * 0.58; const b4 = bw * 0.78;
    s += `<polyline points="${bx + b4},${botY} ${bx + b3},${by + cover + 2}" fill="none" stroke="#c44" stroke-width="1.2"/>`;
    s += `<line x1="${bx + b3}" y1="${by + cover + 2}" x2="${bx + bw}" y2="${by + cover + 2}" stroke="#c44" stroke-width="1.2"/>`;
    s += `<text x="${bx + bw / 2}" y="${by + cover - 2}" text-anchor="middle" font-size="6.5" fill="#c44" font-family="Arial">${fmtRebar(bentCount, design.flexMid.dia)} مكسح</text>`;
  }
  // Top bars left
  const topY = by + cover + 2;
  const leftExt = Math.min(bw * 0.38, bw - 10);
  if (design.flexLeft.bars > 0) {
    s += `<line x1="${bx}" y1="${topY}" x2="${bx + leftExt}" y2="${topY}" stroke="#8b0000" stroke-width="${Math.max(1.5, design.flexLeft.bars * 0.6)}" stroke-linecap="round"/>`;
    s += `<text x="${bx + leftExt / 2}" y="${topY - 3}" text-anchor="middle" font-size="7" fill="#8b0000" font-family="Arial">${fmtRebar(design.flexLeft.bars, design.flexLeft.dia)}</text>`;
  }
  // Top bars right
  const rightExt = Math.min(bw * 0.38, bw - 10);
  if (design.flexRight.bars > 0) {
    s += `<line x1="${bx + bw - rightExt}" y1="${topY}" x2="${bx + bw}" y2="${topY}" stroke="#8b0000" stroke-width="${Math.max(1.5, design.flexRight.bars * 0.6)}" stroke-linecap="round"/>`;
    s += `<text x="${bx + bw - rightExt / 2}" y="${topY - 3}" text-anchor="middle" font-size="7" fill="#8b0000" font-family="Arial">${fmtRebar(design.flexRight.bars, design.flexRight.dia)}</text>`;
  }
  // Labels
  s += `<text x="${bx}" y="${oy + 12}" font-size="8" font-weight="bold" fill="#000" font-family="Arial">${beam.id}  ${beam.b}×${beam.h}mm</text>`;
  // Span dimension
  s += `<line x1="${bx}" y1="${by + bh + 6}" x2="${bx + bw}" y2="${by + bh + 6}" stroke="#666" stroke-width="0.8"/>`;
  s += `<line x1="${bx}" y1="${by + bh + 2}" x2="${bx}" y2="${by + bh + 10}" stroke="#666" stroke-width="0.8"/>`;
  s += `<line x1="${bx + bw}" y1="${by + bh + 2}" x2="${bx + bw}" y2="${by + bh + 10}" stroke="#666" stroke-width="0.8"/>`;
  s += `<text x="${bx + bw / 2}" y="${by + bh + 18}" text-anchor="middle" font-size="7" fill="#555" font-family="Arial">L = ${spanM.toFixed(2)} m${isShort ? '  ← حديد سفلي مستمر كامل' : ''}</text>`;
  return s;
}

function htmlBeamElevationSheet(
  beams: Beam[], beamDesigns: BeamDesignData[],
  tbBase: Partial<TitleBlockConfig>, floorCode: string, startSheetNo: number,
): string {
  const sheetW = _SHEET_W, sheetH = _SHEET_H;
  const titleH = 135 + 36 + 10;
  const contentH = sheetH - 45 - titleH;
  const cols = 2, rows = 3;
  const cellW = Math.floor((sheetW - 90) / cols);
  const cellH = Math.floor(contentH / rows);

  let sheets = '';
  let sheetNo = startSheetNo;
  const perPage = cols * rows;

  for (let p = 0; p < beamDesigns.length; p += perPage) {
    const chunk = beamDesigns.slice(p, p + perPage);
    let svgContent = '';
    chunk.forEach((d, i) => {
      const beam = beams.find(b => b.id === d.beamId);
      if (!beam) return;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ox = 45 + col * cellW;
      const oy = row * cellH;
      svgContent += `<rect x="${ox}" y="${oy}" width="${cellW - 4}" height="${cellH - 4}" fill="none" stroke="#ddd" stroke-width="0.5"/>`;
      svgContent += svgSingleBeamElevation(beam, d, ox, oy, cellW - 4, cellH - 4);
    });

    const svgZone = `<svg viewBox="0 0 ${sheetW - 90} ${contentH}" width="${sheetW - 90}" height="${contentH}" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`;
    sheets += `
  <div class="sheet-page" style="position:relative; width:${sheetW}px; height:${sheetH}px; background:white; overflow:hidden; page-break-after:always; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    ${htmlSheetBorder()}
    <div style="position:absolute; top:42px; left:45px; right:45px; height:${contentH}px; overflow:hidden; border:0.5px solid #ccc;">
      ${svgZone}
    </div>
    <!-- Legend colour key -->
    <div style="position:absolute; bottom:${titleH - 10}px; left:50px; font-size:7.5px; color:#333; font-family:Arial;">
      <span style="color:#8b0000;">━━</span> حديد علوي (لحظة سالبة) &nbsp;
      <span style="color:#1a56db;">━━</span> حديد سفلي مستقيم &nbsp;
      <span style="color:#c44;">━━</span> حديد مكسح (L>2م فقط)
    </div>
    ${htmlTitleBlock({ ...tbBase, drawingTitle: 'BEAM ELEVATION / المقطع الطولي للجسور', drawingSubTitle: tbBase.drawingSubTitle || 'All Floors', drawingNumber: makeDrawingNumber(floorCode, 'BE', p / perPage + 1), sheetNo: sheetNo.toString(), scale: 'N.T.S.' })}
  </div>`;
    sheetNo++;
  }
  return sheets;
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

  // SVG coordinate system - use 690×645 viewbox matching drawing zone
  const svgW = 690;
  const svgH = 645;
  const mmPerM = Math.min((svgW - 80) / modelW, (svgH - 80) / modelH) * 0.85;
  const planOffsetX = 50 + ((svgW - 80) - modelW * mmPerM) / 2;
  const planOffsetY = 40 + ((svgH - 80) - modelH * mmPerM) / 2;
  const tx = (x: number) => (x - minX) * mmPerM + planOffsetX;
  const ty = (y: number) => (maxY - y) * mmPerM + planOffsetY;

  const gridX = Array.from(new Set(allX)).sort((a, b) => a - b);
  const gridY = Array.from(new Set(allY)).sort((a, b) => a - b);
  const scaleVal = Math.round(1000 / mmPerM);
  const scaleText = `1:${scaleVal}`;

  const gridSvg = svgGridSystem(gridX, gridY, tx, ty, minX, maxX, minY, maxY);

  let sheetsHTML = '';

  // ═══════════════════════════════════════════════════
  // SHEET 1: BEAM LAYOUT PLAN
  // ═══════════════════════════════════════════════════
  const bsDwg = makeDrawingNumber(floorCode, 'BS', 1);
  const beamPlanSvg = gridSvg
    + svgColumns(columns, tx, ty, mmPerM, true, false)
    + svgBeamsOnPlan(beams, columns, tx, ty, mmPerM)
    + svgScaleBar(svgW / 2 - 60, svgH - 35, scaleVal);

  sheetsHTML += generateSheetHTML(
    'beam-layout',
    beamPlanSvg,
    svgW, svgH,
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
    + svgScaleBar(svgW / 2 - 60, svgH - 35, scaleVal);

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
    svgW, svgH,
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
  // SHEET 3: SLAB REINFORCEMENT PLAN
  // ═══════════════════════════════════════════════════
  const slDwg = makeDrawingNumber(floorCode, 'SL', 1);
  const slabPlanSvg = gridSvg
    + svgColumns(columns, tx, ty, mmPerM, true, false)
    + svgSlabsOnPlan(slabs, slabDesigns, tx, ty, mmPerM)
    + svgScaleBar(svgW / 2 - 60, svgH - 35, scaleVal);

  sheetsHTML += generateSheetHTML(
    'slab-plan',
    slabPlanSvg,
    svgW, svgH,
    htmlSlabScheduleTable(slabDesigns),
    {
      ...tbBase,
      drawingTitle: 'SLAB REINFORCEMENT PLAN / مخطط تسليح البلاطات',
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
  // SHEET 5: BEAM ELEVATION (longitudinal section)
  // ═══════════════════════════════════════════════════
  if (beamDesigns.length > 0) {
    sheetsHTML += htmlBeamElevationSheet(beams, beamDesigns, { ...tbBase, drawingSubTitle: storyLabel || 'All Floors' }, floorCode, 5);
  }

  // ═══════════════════════════════════════════════════
  // SHEET 6+: BBS (Bar Bending Schedule)
  // ═══════════════════════════════════════════════════
  if (beamDesigns.length > 0 || colDesigns.length > 0) {
    const bbsSheetNo = 5 + (beamDesigns.length > 0 ? Math.ceil(beamDesigns.length / 6) : 0) + 1;
    sheetsHTML += htmlBBSSheet(beams, beamDesigns, colDesigns, slabDesigns, { ...tbBase, drawingSubTitle: storyLabel || 'All Floors' }, floorCode, bbsSheetNo);
  }

  // Wrap everything in a printable HTML document
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <title>${projectName} - ${floorCode} - لوحات إنشائية</title>
  <style>
    @page { size: A3 landscape; margin: 0; }
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
): void {
  const htmlContent = generateHTMLConstructionSheets(
    slabs, beams, columns, beamDesigns, colDesigns, slabDesigns, projectName, options,
  );
  
  import('@/lib/capacitorDownload').then(({ openHTMLForPrint }) =>
    openHTMLForPrint(htmlContent)
  );
}
