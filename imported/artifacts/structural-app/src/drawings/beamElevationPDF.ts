/**
 * Beam Longitudinal Section PDF Generator
 * Ported from the reference implementation in constructionSheets.ts
 * Generates detailed jsPDF beam elevation drawings with:
 *   PART 1: Beam elevation (longitudinal section) + cross-sections (A-A, B-B, C-C)
 *   PART 2: Bar detailing (تفريد الحديد) — top bar, bent bar, bottom bar
 */

import jsPDF from 'jspdf';
import type { Beam } from '@/lib/structuralEngine';
import { drawSheetBorder, drawTitleBlockISO, drawDashedLine, defaultTitleBlockConfig, LINE_WEIGHTS, type TitleBlockConfig, type DevelopmentLengths } from './drawingStandards';

interface BeamDesignData {
  beamId: string;
  flexLeft: { bars: number; dia: number; As: number };
  flexMid:  { bars: number; dia: number; As: number };
  flexRight:{ bars: number; dia: number; As: number };
  shear: { stirrups: string; sUsed: number };
  span?: number;
  hasBentBars?: boolean;
  additionalTopLeft?: number;
  additionalTopRight?: number;
}

function isEndSupport(beam: Beam, side: 'left' | 'right', allBeams: Beam[]): boolean {
  const colId = side === 'left' ? beam.fromCol : beam.toCol;
  const otherBeams = allBeams.filter(b => b.id !== beam.id && (b.fromCol === colId || b.toCol === colId));
  return !otherBeams.some(b => b.direction === beam.direction);
}

function drawDimLine(
  doc: jsPDF, x1: number, x2: number, y: number,
  text: string, color: [number, number, number] = [60, 60, 60],
) {
  if (Math.abs(x2 - x1) < 1) return;
  doc.setDrawColor(...color);
  doc.setLineWidth(0.12);
  doc.line(x1, y, x2, y);
  doc.line(x1, y - 1.5, x1, y + 1.5);
  doc.line(x2, y - 1.5, x2, y + 1.5);
  const mid = (x1 + x2) / 2;
  doc.setFontSize(5);
  doc.setTextColor(...color);
  const tw = text.length * 1.2;
  doc.text(text, mid - tw / 2, y - 2);
  doc.setTextColor(0);
}

function drawVertDimLine(
  doc: jsPDF, x: number, y1: number, y2: number,
  text: string, color: [number, number, number] = [60, 60, 60],
) {
  if (Math.abs(y2 - y1) < 1) return;
  doc.setDrawColor(...color);
  doc.setLineWidth(0.12);
  doc.line(x, y1, x, y2);
  doc.line(x - 1.5, y1, x + 1.5, y1);
  doc.line(x - 1.5, y2, x + 1.5, y2);
  const mid = (y1 + y2) / 2;
  doc.setFontSize(5);
  doc.setTextColor(...color);
  doc.text(text, x + 2, mid + 1);
  doc.setTextColor(0);
}

function drawBeamCrossSection(
  doc: jsPDF,
  x: number, y: number, w: number, h: number,
  bMm: number, hMm: number,
  coverMm: number, stirrupDiaMm: number,
  nTopBars: number, topDia: number,
  nBotBars: number, botDia: number,
  title: string,
) {
  const scl = Math.min((w - 4) / bMm, (h - 14) / hMm);
  const sW = bMm * scl;
  const sH = hMm * scl;
  const sx = x + (w - sW) / 2;
  const sy = y + 12;

  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.rect(sx, sy, sW, sH);

  const stCover = coverMm * scl;
  const stDia = stirrupDiaMm * scl;
  doc.setDrawColor(0);
  doc.setLineWidth(0.25);
  doc.rect(sx + stCover, sy + stCover, sW - 2 * stCover, sH - 2 * stCover);

  const topR = (topDia * scl) / 2;
  if (nTopBars > 0) {
    const topBarY = sy + stCover + stDia + topR;
    const topAvail = sW - 2 * stCover - 2 * stDia - 2 * topR;
    const topSp = nTopBars > 1 ? topAvail / (nTopBars - 1) : 0;
    for (let i = 0; i < nTopBars; i++) {
      const bx = sx + stCover + stDia + topR + i * topSp;
      doc.setFillColor(0, 0, 0);
      doc.rect(bx - Math.max(topR, 0.6), topBarY - Math.max(topR, 0.6), Math.max(topR, 0.6) * 2, Math.max(topR, 0.6) * 2, 'F');
    }
  }

  const botR = (botDia * scl) / 2;
  if (nBotBars > 0) {
    const botBarY = sy + sH - stCover - stDia - botR;
    const botAvail = sW - 2 * stCover - 2 * stDia - 2 * botR;
    const botSp = nBotBars > 1 ? botAvail / (nBotBars - 1) : 0;
    for (let i = 0; i < nBotBars; i++) {
      const bx = sx + stCover + stDia + botR + i * botSp;
      doc.setFillColor(0, 0, 0);
      doc.rect(bx - Math.max(botR, 0.6), botBarY - Math.max(botR, 0.6), Math.max(botR, 0.6) * 2, Math.max(botR, 0.6) * 2, 'F');
    }
  }

  doc.setFontSize(3.8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  doc.text(title, x + w / 2 - title.length * 0.8, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(3.2);
  doc.text(`${bMm}`, sx + sW / 2 - 3, sy + sH + 4);
  doc.text(`${hMm}`, sx - 7, sy + sH / 2 + 1);
  doc.text(`c=${coverMm}`, sx + 1, sy + 3);
}

function drawBeamElevation(
  doc: jsPDF,
  beam: Beam,
  design: BeamDesignData,
  x: number, y: number,
  drawW: number, drawH: number,
  allBeams: Beam[],
): void {
  const b = beam.b;
  const h = beam.h;
  const spanM = (design.span ?? beam.length / 1000);
  const spanMm = spanM * 1000;
  const coverMm = 40;
  const stirrupDiaMm = 10;
  const d_eff = h - coverMm - stirrupDiaMm - (design.flexMid.dia / 2);

  const topDia = Math.max(design.flexLeft.dia, design.flexRight.dia);
  const botDia = design.flexMid.dia;
  const hasBentBars = design.hasBentBars ?? false;
  const unifiedTopBars = Math.max(
    design.additionalTopLeft ?? design.flexLeft.bars,
    design.additionalTopRight ?? design.flexRight.bars,
  );
  const botBars = design.flexMid.bars;
  const continuousBotBars = hasBentBars ? Math.max(2, botBars - 2) : botBars;
  const bentBarsCount = hasBentBars ? Math.min(2, botBars - continuousBotBars) : 0;

  const leftIsEnd = isEndSupport(beam, 'left', allBeams);
  const rightIsEnd = isEndSupport(beam, 'right', allBeams);

  const colWidthMm = b;
  const leftExtMm  = leftIsEnd  ? 0 : Math.round(spanMm / 5);
  const rightExtMm = rightIsEnd ? 0 : Math.round(spanMm / 5);
  const hookTopMm  = Math.max(12 * topDia, 150);
  const hookBotMm  = Math.max(12 * botDia, 150);

  // Layout
  const secPanelW = drawW * 0.22;
  const mainAreaW = drawW - secPanelW - 6;
  const elevAreaH = drawH * 0.50;
  const detailAreaH = drawH - elevAreaH - 10;
  const detailY = y + elevAreaH + 10;

  // Scale
  const leftReserve  = leftIsEnd  ? 0 : (colWidthMm + leftExtMm);
  const rightReserve = rightIsEnd ? 0 : (colWidthMm + rightExtMm);
  const availW = mainAreaW - 20;
  const scl = Math.min(
    availW / (leftReserve + spanMm + rightReserve + colWidthMm * 2),
    (elevAreaH - 40) / h,
  );
  const beamW = spanMm * scl;
  const beamH = h * scl;
  const colW = colWidthMm * scl;

  const ox = x + 10 + (leftIsEnd ? 0 : (colWidthMm + leftExtMm) * scl);
  const oy = y + 18 + (elevAreaH - beamH) / 2;

  const cover  = coverMm * scl;
  const stirD  = stirrupDiaMm * scl;
  const topBarY = oy + cover + stirD + (topDia * scl) / 2;
  const botBarY = oy + beamH - cover - stirD - (botDia * scl) / 2;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.setTextColor(0);
  doc.text(`BEAM ${beam.id}  ·  b=${b} × h=${h} mm  ·  L=${spanM.toFixed(2)} m`, x, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4);
  doc.text(`f'c=28 MPa   fy=420 MPa   cover=${coverMm}mm   d=${Math.round(d_eff)}mm`, x, y + 10);

  // Column dashed outlines
  doc.setDrawColor(160);
  doc.setLineWidth(LINE_WEIGHTS.HIDDEN);
  drawDashedLine(doc, ox - colW, oy, ox, oy);
  drawDashedLine(doc, ox - colW, oy + beamH, ox, oy + beamH);
  drawDashedLine(doc, ox - colW, oy, ox - colW, oy + beamH);
  drawDashedLine(doc, ox + beamW, oy, ox + beamW + colW, oy);
  drawDashedLine(doc, ox + beamW, oy + beamH, ox + beamW + colW, oy + beamH);
  drawDashedLine(doc, ox + beamW + colW, oy, ox + beamW + colW, oy + beamH);

  // Column centrelines
  doc.setDrawColor(130);
  drawDashedLine(doc, ox - colW / 2, oy - 6, ox - colW / 2, oy + beamH + 4);
  drawDashedLine(doc, ox + beamW + colW / 2, oy - 6, ox + beamW + colW / 2, oy + beamH + 4);

  // Adjacent beam stubs
  if (!leftIsEnd) {
    const adjPx = leftExtMm * scl;
    doc.setDrawColor(180);
    drawDashedLine(doc, ox - colW - adjPx, oy, ox - colW, oy);
    drawDashedLine(doc, ox - colW - adjPx, oy + beamH, ox - colW, oy + beamH);
    drawDashedLine(doc, ox - colW - adjPx, oy, ox - colW - adjPx, oy + beamH);
  }
  if (!rightIsEnd) {
    const adjPx = rightExtMm * scl;
    doc.setDrawColor(180);
    drawDashedLine(doc, ox + beamW + colW, oy, ox + beamW + colW + adjPx, oy);
    drawDashedLine(doc, ox + beamW + colW, oy + beamH, ox + beamW + colW + adjPx, oy + beamH);
    drawDashedLine(doc, ox + beamW + colW + adjPx, oy, ox + beamW + colW + adjPx, oy + beamH);
  }

  // Beam outline
  doc.setDrawColor(0);
  doc.setLineWidth(LINE_WEIGHTS.STRUCTURAL_ELEMENT);
  doc.rect(ox, oy, beamW, beamH);

  // Unified top bar
  const topStartX = leftIsEnd  ? ox - Math.min((hookTopMm * 0.5) * scl, colW * 0.7)
                                : ox - colW - leftExtMm * scl;
  const topEndX   = rightIsEnd ? ox + beamW + Math.min((hookTopMm * 0.5) * scl, colW * 0.7)
                                : ox + beamW + colW + rightExtMm * scl;

  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  if (leftIsEnd) {
    doc.line(topStartX, topBarY - hookTopMm * scl * 0.3, topStartX + hookTopMm * scl * 0.15, topBarY);
  }
  doc.line(leftIsEnd ? topStartX + hookTopMm * scl * 0.15 : topStartX, topBarY,
           rightIsEnd ? topEndX - hookTopMm * scl * 0.15 : topEndX, topBarY);
  if (rightIsEnd) {
    doc.line(topEndX - hookTopMm * scl * 0.15, topBarY, topEndX, topBarY - hookTopMm * scl * 0.3);
  }

  // Bottom continuous bar
  const botLeftStartX  = leftIsEnd  ? ox - hookBotMm * scl * 0.5  : ox - colW * 0.65;
  const botRightEndX   = rightIsEnd ? ox + beamW + hookBotMm * scl * 0.5 : ox + beamW + colW * 0.65;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  if (leftIsEnd) {
    doc.line(botLeftStartX, botBarY + hookBotMm * scl * 0.5, botLeftStartX + hookBotMm * scl * 0.2, botBarY);
  }
  doc.line(leftIsEnd ? botLeftStartX + hookBotMm * scl * 0.2 : botLeftStartX, botBarY,
           rightIsEnd ? botRightEndX - hookBotMm * scl * 0.2 : botRightEndX, botBarY);
  if (rightIsEnd) {
    doc.line(botRightEndX - hookBotMm * scl * 0.2, botBarY, botRightEndX, botBarY + hookBotMm * scl * 0.5);
  }

  // Bent bars
  let bentSeg1Mm = 0, bentDiagMm = 0, bentSeg3Mm = 0, bentTotalMm = 0, bentSeg5Mm = 0;
  if (hasBentBars && bentBarsCount > 0) {
    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
    const bentTopY = topBarY + stirD * 0.3;
    const bentBotY = botBarY - stirD * 0.3;
    const risePixels = bentBotY - bentTopY;
    const riseMm = risePixels / scl;
    const horizMm = riseMm;
    const diagLenMm = Math.sqrt(2) * riseMm;
    const bendDnStartPx = ox + spanMm * 0.22 * scl;
    const bendDnEndPx = bendDnStartPx + horizMm * scl;
    const bendUpEndPx = ox + spanMm * 0.78 * scl;
    const bendUpStartPx = bendUpEndPx - horizMm * scl;
    const bentLeftStartX = leftIsEnd  ? ox + 2 : ox - colW - leftExtMm * scl;
    const bentRightEndX  = rightIsEnd ? ox + beamW - 2 : ox + beamW + colW + rightExtMm * scl;
    for (let bi = 0; bi < bentBarsCount; bi++) {
      const yo = bi * 1.5;
      doc.line(bentLeftStartX, bentTopY + yo, bendDnStartPx, bentTopY + yo);
      doc.line(bendDnStartPx, bentTopY + yo, bendDnEndPx, bentBotY + yo);
      doc.line(bendDnEndPx, bentBotY + yo, bendUpStartPx, bentBotY + yo);
      doc.line(bendUpStartPx, bentBotY + yo, bendUpEndPx, bentTopY + yo);
      doc.line(bendUpEndPx, bentTopY + yo, bentRightEndX, bentTopY + yo);
    }
    const leftExtBent  = leftIsEnd  ? 0 : (colWidthMm * 0.5 + leftExtMm);
    const rightExtBent = rightIsEnd ? 0 : (colWidthMm * 0.5 + rightExtMm);
    bentSeg1Mm  = spanMm * 0.22 + leftExtBent;
    bentDiagMm  = diagLenMm;
    bentSeg3Mm  = spanMm * (0.78 - 0.22) - 2 * horizMm;
    bentSeg5Mm  = spanMm * (1 - 0.78) + rightExtBent;
    bentTotalMm = bentSeg1Mm + bentDiagMm + bentSeg3Mm + bentDiagMm + bentSeg5Mm;
  }

  // Stirrups
  const stirrupMatch   = design.shear.stirrups.match(/(\d+)Φ(\d+)@(\d+)/);
  const stirSpacingMm  = stirrupMatch ? parseInt(stirrupMatch[3]) : 150;
  const stirDiaMmVal   = stirrupMatch ? parseInt(stirrupMatch[2]) : 10;
  const zone1SpacMm    = Math.max(Math.floor(stirSpacingMm * 0.6 / 25) * 25, 75);
  const zone1LenMm     = d_eff;
  const zone1SpacPx    = zone1SpacMm * scl;
  const zone2SpacPx    = stirSpacingMm * scl;
  const zone1LenPx     = zone1LenMm * scl;
  const firstStirPx    = 50 * scl;

  doc.setDrawColor(0, 0, 180);
  doc.setLineWidth(0.15);
  for (let sx = ox + firstStirPx; sx <= ox + zone1LenPx; sx += zone1SpacPx) {
    doc.line(sx, oy + 1, sx, oy + beamH - 1);
  }
  for (let sx = ox + beamW - firstStirPx; sx >= ox + beamW - zone1LenPx; sx -= zone1SpacPx) {
    doc.line(sx, oy + 1, sx, oy + beamH - 1);
  }
  for (let sx = ox + zone1LenPx + zone2SpacPx; sx < ox + beamW - zone1LenPx; sx += zone2SpacPx) {
    doc.line(sx, oy + 1, sx, oy + beamH - 1);
  }

  // Dimensions
  const hDimX = ox - 12;
  drawVertDimLine(doc, hDimX, oy, oy + beamH, `h=${h}`, [0, 0, 0]);
  const dimSpanY = oy + beamH + 8;
  drawDimLine(doc, ox, ox + beamW, dimSpanY, `Ln = ${spanM.toFixed(2)} m`, [0, 0, 0]);
  doc.setFontSize(3.5);
  doc.setTextColor(80);
  doc.text(`b=${b}`, ox + beamW / 2 - 4, oy + beamH - 1.5);
  doc.setTextColor(0);

  // Bar info labels
  const infoX = ox + beamW + colW + 5;
  const infoY = oy + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.5);
  doc.setTextColor(0);
  doc.text(`حديد علوي: ${unifiedTopBars}Φ${topDia}`, infoX, infoY);
  doc.text(`حديد سفلي: ${continuousBotBars}Φ${botDia}`, infoX, infoY + 6);
  if (bentBarsCount > 0) {
    doc.setTextColor(180, 90, 0);
    doc.text(`مكسح: ${bentBarsCount}Φ${botDia}`, infoX, infoY + 12);
    doc.setTextColor(0);
  }
  doc.setTextColor(0, 0, 160);
  doc.text(`كانات: Φ${stirDiaMmVal}@${zone1SpacMm}/${stirSpacingMm}`, infoX, infoY + 18);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'normal');

  // Section cut marks
  const secPositions: [number, string][] = [
    [ox + colW * 0.1, 'A'],
    [ox + beamW / 2, 'B'],
    [ox + beamW - colW * 0.1, 'C'],
  ];
  doc.setDrawColor(0);
  doc.setLineWidth(0.25);
  for (const [sx, lbl] of secPositions) {
    doc.line(sx - 1.5, oy - 5, sx + 1.5, oy - 5);
    doc.line(sx, oy - 5, sx, oy);
    doc.line(sx, oy + beamH, sx, oy + beamH + 3);
    doc.setFontSize(4);
    doc.setFont('helvetica', 'bold');
    doc.text(lbl, sx - 1, oy - 6);
    doc.setFont('helvetica', 'normal');
  }

  // Cross-sections (right panel)
  const secPanelX = x + mainAreaW + 4;
  const secH = (elevAreaH - 12) / 3;

  drawBeamCrossSection(doc, secPanelX, y + 2, secPanelW - 4, secH - 2,
    b, h, coverMm, stirrupDiaMm,
    unifiedTopBars, topDia, design.flexMid.bars, botDia, 'SEC A-A (LEFT)');

  drawBeamCrossSection(doc, secPanelX, y + secH + 2, secPanelW - 4, secH - 2,
    b, h, coverMm, stirrupDiaMm,
    0, topDia, Math.max(continuousBotBars, 2), botDia, 'SEC B-B (MID)');

  drawBeamCrossSection(doc, secPanelX, y + 2 * secH + 2, secPanelW - 4, secH - 2,
    b, h, coverMm, stirrupDiaMm,
    unifiedTopBars, topDia, design.flexMid.bars, botDia, 'SEC C-C (RIGHT)');

  // PART 2: Bar detailing (تفريد الحديد)
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.line(x, detailY - 4, x + drawW, detailY - 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.text('تفريد الحديد — BAR DETAILING', x, detailY);
  doc.setFont('helvetica', 'normal');

  const detailStartY = detailY + 6;
  const barRowH = (detailAreaH - 12) / 3;
  const detailMargin = 15;
  const detailW = mainAreaW - detailMargin * 2;

  const topTotalMm = (leftIsEnd ? hookTopMm : leftExtMm + colWidthMm / 2) + spanMm + (rightIsEnd ? hookTopMm : rightExtMm + colWidthMm / 2);
  const botTotalMm = (leftIsEnd ? hookBotMm : colWidthMm * 0.65) + spanMm + (rightIsEnd ? hookBotMm : colWidthMm * 0.65);
  const maxBarLen = Math.max(topTotalMm, botTotalMm, bentTotalMm || 0);
  const detailScl = (detailW - 20) / maxBarLen;
  const detailOx = x + detailMargin + 10;

  // ROW 1 (bottom): Straight bottom bar
  const row1Y = detailStartY + barRowH * 2 + barRowH / 2;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  const botHookPx = hookBotMm * detailScl;
  const botSpanPx = spanMm * detailScl;
  const botExtLeftPx = leftIsEnd ? 0 : colWidthMm * 0.65 * detailScl;
  const botExtRightPx = rightIsEnd ? 0 : colWidthMm * 0.65 * detailScl;
  let bx1 = detailOx;
  if (leftIsEnd) {
    doc.line(bx1, row1Y + botHookPx * 0.5, bx1 + botHookPx * 0.15, row1Y);
    bx1 += botHookPx * 0.15;
  }
  const bx2 = bx1 + (leftIsEnd ? 0 : botExtLeftPx) + botSpanPx + (rightIsEnd ? 0 : botExtRightPx);
  doc.line(bx1, row1Y, bx2, row1Y);
  if (rightIsEnd) {
    doc.line(bx2, row1Y, bx2 + botHookPx * 0.15, row1Y + botHookPx * 0.5);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text(`حديد سفلي مستقيم: ${continuousBotBars}Φ${botDia}`, detailOx, row1Y - barRowH / 2 + 3);
  doc.setFont('helvetica', 'normal');
  const dimRow1Y = row1Y + 6;
  const mainStartX = leftIsEnd ? detailOx + botHookPx * 0.15 : detailOx;
  const mainEndX = bx2;
  drawDimLine(doc, mainStartX, mainEndX, dimRow1Y, `${Math.round(botTotalMm - (leftIsEnd ? hookBotMm : 0) - (rightIsEnd ? hookBotMm : 0))}`, [0, 0, 0]);
  drawDimLine(doc, detailOx, rightIsEnd ? bx2 + botHookPx * 0.15 : bx2, dimRow1Y + 6, `إجمالي = ${Math.round(botTotalMm)} mm`, [180, 0, 0]);

  // ROW 2 (middle): Bent bar
  if (hasBentBars && bentBarsCount > 0) {
    const row2Y = detailStartY + barRowH + barRowH / 2;
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    const seg1Px = bentSeg1Mm * detailScl;
    const diagPx = bentDiagMm * detailScl * 0.5;
    const seg3Px = bentSeg3Mm * detailScl;
    const seg5Px = bentSeg5Mm * detailScl;
    const riseH = barRowH * 0.5;
    const mx1 = detailOx;
    const mx2 = mx1 + seg1Px;
    const mx3 = mx2 + diagPx;
    const mx4 = mx3 + seg3Px;
    const mx5 = mx4 + diagPx;
    const mx6 = mx5 + seg5Px;
    doc.line(mx1, row2Y - riseH / 2, mx2, row2Y - riseH / 2);
    doc.line(mx2, row2Y - riseH / 2, mx3, row2Y + riseH / 2);
    doc.line(mx3, row2Y + riseH / 2, mx4, row2Y + riseH / 2);
    doc.line(mx4, row2Y + riseH / 2, mx5, row2Y - riseH / 2);
    doc.line(mx5, row2Y - riseH / 2, mx6, row2Y - riseH / 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(0);
    doc.text(`حديد مكسح: ${bentBarsCount}Φ${botDia}`, detailOx, row2Y - barRowH / 2 + 3);
    doc.setFont('helvetica', 'normal');
    const dimBentAbove = row2Y - riseH / 2 - 5;
    const dimBentBelow = row2Y + riseH / 2 + 5;
    drawDimLine(doc, mx1, mx2, dimBentAbove, `L1=${Math.round(bentSeg1Mm)}`, [0, 0, 0]);
    drawDimLine(doc, mx2, mx3, dimBentBelow, `D=${Math.round(bentDiagMm)}`, [0, 0, 0]);
    drawDimLine(doc, mx3, mx4, dimBentBelow, `L2=${Math.round(bentSeg3Mm)}`, [0, 0, 0]);
    drawDimLine(doc, mx4, mx5, dimBentBelow, `D=${Math.round(bentDiagMm)}`, [0, 0, 0]);
    drawDimLine(doc, mx5, mx6, dimBentAbove, `L3=${Math.round(bentSeg5Mm)}`, [0, 0, 0]);
    doc.setFontSize(5);
    doc.setTextColor(0);
    doc.text('45°', (mx2 + mx3) / 2 - 2, row2Y);
    doc.text('45°', (mx4 + mx5) / 2 - 2, row2Y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.text(`إجمالي المكسح ≈ ${Math.round(bentTotalMm)} mm`, (mx1 + mx6) / 2 - 15, row2Y + riseH / 2 + 14);
    doc.setFont('helvetica', 'normal');
  }

  // ROW 3 (top): Top straight bar
  const row3Y = detailStartY + barRowH / 2;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  const topExtLeftPx  = leftIsEnd  ? hookTopMm * detailScl * 0.3 : (leftExtMm + colWidthMm / 2) * detailScl;
  const topExtRightPx = rightIsEnd ? hookTopMm * detailScl * 0.3 : (rightExtMm + colWidthMm / 2) * detailScl;
  const topSpanPx = spanMm * detailScl;
  const tx1 = detailOx;
  const tx2 = tx1 + topExtLeftPx + topSpanPx + topExtRightPx;
  if (leftIsEnd) {
    doc.line(tx1, row3Y - hookTopMm * detailScl * 0.15, tx1 + hookTopMm * detailScl * 0.1, row3Y);
    doc.line(tx1 + hookTopMm * detailScl * 0.1, row3Y, tx2, row3Y);
  } else {
    doc.line(tx1, row3Y, tx2, row3Y);
  }
  if (rightIsEnd) {
    doc.line(tx2 - hookTopMm * detailScl * 0.1, row3Y, tx2, row3Y - hookTopMm * detailScl * 0.15);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text(`حديد علوي: ${unifiedTopBars}Φ${topDia}`, detailOx, row3Y - barRowH / 2 + 3);
  doc.setFont('helvetica', 'normal');
  const dimTopY = row3Y + 6;
  if (!leftIsEnd) {
    drawDimLine(doc, tx1, tx1 + (leftExtMm + colWidthMm / 2) * detailScl, dimTopY, `L/5=${Math.round(leftExtMm)}`, [0, 0, 0]);
  } else {
    drawDimLine(doc, tx1, tx1 + hookTopMm * detailScl * 0.3, dimTopY, `hook=${hookTopMm}`, [0, 0, 0]);
  }
  const topMidStart = leftIsEnd ? tx1 + hookTopMm * detailScl * 0.3 : tx1 + (leftExtMm + colWidthMm / 2) * detailScl;
  const topMidEnd = rightIsEnd ? tx2 - hookTopMm * detailScl * 0.3 : tx2 - (rightExtMm + colWidthMm / 2) * detailScl;
  drawDimLine(doc, topMidStart, topMidEnd, dimTopY, `span=${Math.round(spanMm)}`, [0, 0, 0]);
  if (!rightIsEnd) {
    drawDimLine(doc, topMidEnd, tx2, dimTopY, `L/5=${Math.round(rightExtMm)}`, [0, 0, 0]);
  } else {
    drawDimLine(doc, tx2 - hookTopMm * detailScl * 0.3, tx2, dimTopY, `hook=${hookTopMm}`, [0, 0, 0]);
  }
  drawDimLine(doc, tx1, tx2, dimTopY + 6, `إجمالي = ${Math.round(topTotalMm)} mm`, [180, 0, 0]);
}

/**
 * Main export function: generates a jsPDF document with detailed beam longitudinal sections.
 * Layout: up to 3 beams per A3 landscape page.
 */
export function generateBeamElevationPDF(
  beams: Beam[],
  beamDesigns: BeamDesignData[],
  projectName: string,
  storyLabel: string,
  titleBlock?: Partial<TitleBlockConfig>,
): void {
  if (beamDesigns.length === 0) return;

  const W = 420;
  const H = 297;
  const BEAMS_PER_PAGE = 3;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [W, H] });

  const margin = 12;
  const tbHeight = 35;
  const usableH = H - margin * 2 - tbHeight;
  const beamSlotH = usableH / BEAMS_PER_PAGE;
  const beamW = W - margin * 2 - 5;

  const tbBase = {
    ...defaultTitleBlockConfig,
    ...titleBlock,
    projectName,
    drawingTitle: 'BEAM LONGITUDINAL SECTIONS — مقاطع الجسور الطولية',
    drawingSubTitle: storyLabel || 'All Floors',
    date: new Date().toLocaleDateString(),
  } as TitleBlockConfig;

  let pageBeamCount = 0;
  let pageNum = 1;

  for (let di = 0; di < beamDesigns.length; di++) {
    const d = beamDesigns[di];
    const beam = beams.find(b => b.id === d.beamId);
    if (!beam) continue;

    if (pageBeamCount === 0) {
      if (di > 0) doc.addPage();
      drawSheetBorder(doc, W, H);
      drawTitleBlockISO(doc, W, H, {
        ...tbBase,
        drawingNumber: `BE-${String(pageNum).padStart(2, '0')}`,
        sheetNo: String(pageNum),
      } as TitleBlockConfig);
      pageNum++;
    }

    const slotY = margin + pageBeamCount * beamSlotH;
    drawBeamElevation(doc, beam, d, margin, slotY, beamW, beamSlotH - 4, beams);

    pageBeamCount++;
    if (pageBeamCount >= BEAMS_PER_PAGE) pageBeamCount = 0;
  }

  doc.save(`${projectName}_BeamElevations.pdf`);
}
