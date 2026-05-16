/**
 * Foundation Design - Working Stress Method (WSM / ASD)
 * Reference: ACI 318-14 Appendix B (ASD), UBC 1997 Chapter 18
 * Isolated Spread Footings — Rectangular proportional to column section
 */

export interface ColumnReactionInput {
  colId: string;
  x: number;   // column center X in meters
  y: number;   // column center Y in meters
  P_DL: number; // Dead load axial reaction kN (service, positive = compression)
  P_LL: number; // Live load axial reaction kN (service, positive = compression)
  Mx_DL?: number;
  Mx_LL?: number;
  My_DL?: number;
  My_LL?: number;
  colB: number; // column width mm  (x-direction)
  colH: number; // column depth mm  (y-direction)
}

export interface FootingMaterials {
  fc: number;         // concrete f'c MPa
  fy: number;         // steel fy MPa
  qa: number;         // allowable soil bearing capacity kN/m²
  cover: number;      // concrete cover mm (typically 75mm for foundations)
  gamma_conc: number; // concrete unit weight kN/m³ (24)
  gamma_soil: number; // soil unit weight kN/m³ (18)
  Df: number;         // foundation depth from natural ground m
}

export interface FootingDesignResult {
  colId: string;
  x: number;
  y: number;
  P_service: number;     // total service load kN (DL+LL)
  B: number;             // footing width  mm  (x-direction, proportional to colB)
  L: number;             // footing length mm  (y-direction, proportional to colH)
  t: number;             // total footing thickness mm
  d: number;             // effective depth mm
  q_net_allow: number;   // net allowable bearing pressure kN/m²
  q_actual: number;      // actual net bearing pressure kN/m²
  bearing_ok: boolean;

  // Flexure — x-direction cantilever (a_x), bars run parallel to x
  M_x: number;           // design moment kN.m/m
  As_x_req: number;      // required As mm²/m
  As_x_use: number;      // used As mm²/m
  bars_x: number;
  dia_x: number;
  spacing_x: number;

  // Flexure — y-direction cantilever (a_y), bars run parallel to y
  M_y: number;
  As_y_req: number;
  As_y_use: number;
  bars_y: number;
  dia_y: number;
  spacing_y: number;

  // Shear checks
  Vu_wide: number;
  Vc_wide: number;
  wide_shear_ok: boolean;
  Vu_punch: number;
  Vc_punch: number;
  punch_shear_ok: boolean;

  // WSM constants
  fc_allow: number;
  fs_allow: number;
  n: number;
  k: number;
  j: number;
  As_min_pm: number;

  a_x: number;
  a_y: number;

  colB: number;
  colH: number;

  t_min_aci: number;

  adequate: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function selectRebar(
  As_req_total: number,
  width: number,
  cover: number,
): { bars: number; dia: number; spacing: number; As_provided: number } {
  // Minimum 5 bars (per user requirement) and minimum Ø16 mm
  const MIN_BARS = 5;
  const DIAMS = [16, 18, 20, 22, 25, 28, 32];
  for (const dia of DIAMS) {
    const ab = Math.PI * dia * dia / 4;
    const bars = Math.max(MIN_BARS, Math.ceil(As_req_total / ab));
    const spacing = bars > 1 ? (width - 2 * cover - dia) / (bars - 1) : 0;
    if (spacing >= 75 && spacing <= 400) {
      return { bars, dia, spacing: Math.round(spacing), As_provided: bars * ab };
    }
  }
  const dia = 25;
  const ab = Math.PI * dia * dia / 4;
  const bars = Math.max(MIN_BARS, Math.ceil(As_req_total / ab));
  const spacing = bars > 1 ? (width - 2 * cover - dia) / (bars - 1) : 100;
  return { bars, dia, spacing: Math.round(Math.max(75, spacing)), As_provided: bars * ab };
}

// ─── Main design function ─────────────────────────────────────────────────────

/**
 * Design isolated spread footing per WSM / ACI 318
 *
 * Rectangular footing: B (x-dir) is proportional to colB,
 *                      L (y-dir) is proportional to colH.
 * So the footing is elongated in the same direction as the column.
 */
export function designFooting(
  reaction: ColumnReactionInput,
  mat: FootingMaterials,
): FootingDesignResult {
  const { fc, fy, qa, cover, gamma_conc, gamma_soil, Df } = mat;
  const { colId, x, y, P_DL, P_LL, colB, colH } = reaction;

  const P_service = P_DL + P_LL;

  // ── WSM constants ────────────────────────────────────────────────────────────
  const fc_allow = 0.45 * fc;
  const Es = 200_000;
  const Ec = 4700 * Math.sqrt(fc);
  const n = Math.max(6, Math.round(Es / Ec));
  const fs_allow = Math.min(0.50 * fy, 207);
  const k = (n * fc_allow) / (n * fc_allow + fs_allow);
  const j = 1 - k / 3;
  const rho_min = fy >= 420 ? 0.0018 : 0.0020;

  // Aspect ratio for rectangular footing: L/B = colH/colB
  // Footing is rectangular proportional to column section — no clamping.
  // If colB > colH → B > L; if colB < colH → L > B; if equal → square.
  const aspect = colH / colB;  // L/B ratio (can be < 1)

  // ── Minimum thickness per ACI 318 §13.3.1.2 ──────────────────────────────
  // d_min = 150 mm (for footings on soil)
  // t_min = d_min + cover + 2×db_min = 150 + cover + 2×16 (conservative)
  const t_min_aci = Math.max(300, cover + 150 + 32);

  let t = t_min_aci;
  let B = 1500;
  let L = 1500;

  for (let iter = 0; iter < 15; iter++) {
    const t_m = t / 1000;
    const w_ov = gamma_soil * Math.max(0, Df - t_m) + gamma_conc * t_m;
    const q_net = Math.max(50, qa - w_ov);

    // Rectangular footing area: A = B × L, L/B = aspect
    // → B = sqrt(A_req / aspect), L = sqrt(A_req × aspect)
    const A_req = P_service / q_net;
    const B_calc = Math.sqrt(A_req / aspect);
    const L_calc = Math.sqrt(A_req * aspect);

    B = Math.max(roundUpTo(B_calc * 1000, 50), colB + 400);
    L = Math.max(roundUpTo(L_calc * 1000, 50), colH + 400);

    const q_act = P_service / ((B / 1000) * (L / 1000));

    const d = t - cover - 12;
    if (d <= 0) { t += 100; continue; }

    const a_x = (B - colB) / 2;
    const a_y = (L - colH) / 2;

    const shear_arm_x = Math.max(0, a_x - d);
    const shear_arm_y = Math.max(0, a_y - d);

    const Vu_x = q_act * (shear_arm_x / 1000) * (L / 1000);
    const Vu_y = q_act * (shear_arm_y / 1000) * (B / 1000);
    const Vu_wide = Math.max(Vu_x, Vu_y);

    const vc_allow = 0.083 * Math.sqrt(fc);
    const Vc_wide_x = vc_allow * L * d / 1000;
    const Vc_wide_y = vc_allow * B * d / 1000;
    const Vc_wide = Math.min(Vc_wide_x, Vc_wide_y);

    if (Vu_wide > Vc_wide) {
      const d_req_x = shear_arm_x > 0 ? (Vu_x * 1000) / (vc_allow * L) : 0;
      const d_req_y = shear_arm_y > 0 ? (Vu_y * 1000) / (vc_allow * B) : 0;
      const d_req = Math.max(d_req_x, d_req_y);
      const t_new = Math.max(t_min_aci, roundUpTo(d_req + cover + 12, 50));
      if (t_new > t) { t = t_new; continue; }
    }

    const b0 = 2 * ((colB + d) + (colH + d));
    const A_punch_inside = (colB + d) * (colH + d) / 1e6;
    const Vu_punch = q_act * ((B * L / 1e6) - A_punch_inside);
    const betaC = Math.max(colB, colH) / Math.min(colB, colH);
    const vc_punch_limit = Math.min(
      0.083 * (2 + 4 / betaC) * Math.sqrt(fc),
      0.166 * Math.sqrt(fc),
    );
    const Vc_punch = vc_punch_limit * b0 * d / 1000;

    if (Vu_punch > Vc_punch) {
      t = Math.max(t_min_aci, roundUpTo(t + 50, 50));
      continue;
    }

    break;
  }

  // ── Final geometry ──────────────────────────────────────────────────────────
  const t_m = t / 1000;
  const w_ov = gamma_soil * Math.max(0, Df - t_m) + gamma_conc * t_m;
  const q_net_allow = Math.max(50, qa - w_ov);
  const A_req = P_service / q_net_allow;
  B = Math.max(roundUpTo(Math.sqrt(A_req / aspect) * 1000, 50), colB + 400);
  L = Math.max(roundUpTo(Math.sqrt(A_req * aspect) * 1000, 50), colH + 400);

  const q_actual = P_service / ((B / 1000) * (L / 1000));
  const bearing_ok = q_actual <= qa;
  const d = Math.max(100, t - cover - 12);

  const a_x = (B - colB) / 2;
  const a_y = (L - colH) / 2;

  const M_x = q_actual * (a_x / 1000) ** 2 / 2;
  const M_y = q_actual * (a_y / 1000) ** 2 / 2;

  const As_x_req = (M_x * 1e6) / (fs_allow * j * d);
  const As_y_req = (M_y * 1e6) / (fs_allow * j * d);
  const As_min_pm = rho_min * 1000 * d;
  const As_x_use = Math.max(As_x_req, As_min_pm);
  const As_y_use = Math.max(As_y_req, As_min_pm);

  const rb_x = selectRebar(As_x_use * (L / 1000), L, cover);
  const rb_y = selectRebar(As_y_use * (B / 1000), B, cover);

  const vc_allow = 0.083 * Math.sqrt(fc);
  const shear_arm_x = Math.max(0, a_x - d);
  const shear_arm_y = Math.max(0, a_y - d);
  const Vu_wide_x = q_actual * (shear_arm_x / 1000) * (L / 1000);
  const Vu_wide_y = q_actual * (shear_arm_y / 1000) * (B / 1000);
  const Vu_wide = Math.max(Vu_wide_x, Vu_wide_y);
  const Vc_wide = Math.min(vc_allow * L * d / 1000, vc_allow * B * d / 1000);
  const wide_shear_ok = Vu_wide <= Vc_wide;

  const b0 = 2 * ((colB + d) + (colH + d));
  const A_punch_inside = (colB + d) * (colH + d) / 1e6;
  const Vu_punch = q_actual * ((B * L / 1e6) - A_punch_inside);
  const betaC = Math.max(colB, colH) / Math.min(colB, colH);
  const vc_punch = Math.min(
    0.083 * (2 + 4 / betaC) * Math.sqrt(fc),
    0.166 * Math.sqrt(fc),
  );
  const Vc_punch = vc_punch * b0 * d / 1000;
  const punch_shear_ok = Vu_punch <= Vc_punch;

  return {
    colId, x, y,
    P_service,
    B, L, t, d,
    q_net_allow,
    q_actual,
    bearing_ok,
    M_x, M_y,
    As_x_req, As_x_use,
    bars_x: rb_x.bars, dia_x: rb_x.dia, spacing_x: rb_x.spacing,
    As_y_req, As_y_use,
    bars_y: rb_y.bars, dia_y: rb_y.dia, spacing_y: rb_y.spacing,
    Vu_wide, Vc_wide, wide_shear_ok,
    Vu_punch, Vc_punch, punch_shear_ok,
    fc_allow, fs_allow, n, k, j,
    As_min_pm,
    a_x, a_y,
    colB, colH,
    t_min_aci,
    adequate: bearing_ok && wide_shear_ok && punch_shear_ok,
  };
}

// ─── ACI 318 Foundation Drawing ──────────────────────────────────────────────

/**
 * buildTypeDetailSVG
 * Creates a single wide SVG (780 × 320 px) showing all three views
 * of one footing type side-by-side, with no external CSS or HTML tables.
 *
 * Layout (left → right):
 *   [PLAN VIEW 260px] | [SECTION A-A 260px] | [SECTION B-B 260px]
 *
 * Each panel has its own coordinate origin via SVG <g transform="translate(...)">
 * and its own <defs> IDs to avoid conflicts when multiple types are embedded.
 */
function buildTypeDetailSVG(
  r: FootingDesignResult,
  mat: FootingMaterials,
  typeKey: string,
  colIds: string[],
  t_min_aci: number,
): string {
  const TOTAL_W = 780;
  const TOTAL_H = 320;
  const PANEL_W = 260;       // each of the 3 panels
  const CONTENT_H = 300;     // drawing area height (20px title bar at top)
  const TITLE_H = 20;
  const SEP = 0;             // panels share edges, separator drawn as a line
  const id = 'T' + typeKey.replace(/[^a-z0-9]/gi, '_');

  // ── Shared defs ───────────────────────────────────────────────────────────
  const defs = `<defs>
    <marker id="ar${id}" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
      <path d="M0,0 L5,2 L0,4 Z" fill="#c00"/>
    </marker>
    <marker id="arl${id}" markerWidth="5" markerHeight="4" refX="1" refY="2" orient="auto-start-reverse">
      <path d="M5,0 L0,2 L5,4 Z" fill="#c00"/>
    </marker>
    <pattern id="conc${id}" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#9ab" stroke-width="1"/>
    </pattern>
    <pattern id="soil${id}" patternUnits="userSpaceOnUse" width="6" height="4">
      <line x1="0" y1="0" x2="6" y2="4" stroke="#b8a070" stroke-width="0.7"/>
    </pattern>
    <pattern id="htch${id}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#b0b8c8" stroke-width="0.8"/>
    </pattern>
    <clipPath id="clipP${id}"><rect x="0" y="0" width="${PANEL_W}" height="${CONTENT_H}"/></clipPath>
    <clipPath id="clipA${id}"><rect x="0" y="0" width="${PANEL_W}" height="${CONTENT_H}"/></clipPath>
    <clipPath id="clipB${id}"><rect x="0" y="0" width="${PANEL_W}" height="${CONTENT_H}"/></clipPath>
  </defs>`;

  // Dimension helpers (all coordinates are LOCAL within the panel)
  function hdim(x1: number, x2: number, y: number, lbl: string, above = true): string {
    const ty = above ? y - 3 : y + 9;
    return `<line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#c00" stroke-width="0.6" marker-start="url(#arl${id})" marker-end="url(#ar${id})"/>
<text x="${((x1 + x2) / 2).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#c00">${lbl}</text>`;
  }
  function vdim(x: number, y1: number, y2: number, lbl: string, toRight = false): string {
    const mid = (y1 + y2) / 2;
    const tx = toRight ? x + 4 : x - 4;
    return `<line x1="${x.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#c00" stroke-width="0.6" marker-start="url(#arl${id})" marker-end="url(#ar${id})"/>
<text x="${tx.toFixed(1)}" y="${(mid + 3).toFixed(1)}" text-anchor="${toRight ? 'start' : 'end'}" font-size="6.5" fill="#c00" transform="rotate(-90,${tx.toFixed(1)},${mid.toFixed(1)})">${lbl}</text>`;
  }

  // ══ PANEL 1: PLAN VIEW ═══════════════════════════════════════════════════
  const P_PAD = 44;
  const P_CX = PANEL_W / 2, P_CY = CONTENT_H / 2;
  const P_dW = PANEL_W - 2 * P_PAD;
  const P_dH = CONTENT_H - 2 * P_PAD;
  const P_sc = Math.min(P_dW / r.B, P_dH / r.L);
  const P_fw = r.B * P_sc, P_fh = r.L * P_sc;
  const P_cw = r.colB * P_sc, P_ch = r.colH * P_sc;
  const P_fx1 = P_CX - P_fw / 2, P_fx2 = P_CX + P_fw / 2;
  const P_fy1 = P_CY - P_fh / 2, P_fy2 = P_CY + P_fh / 2;
  const P_ccx1 = P_CX - P_cw / 2, P_ccx2 = P_CX + P_cw / 2;
  const P_ccy1 = P_CY - P_ch / 2, P_ccy2 = P_CY + P_ch / 2;

  let planRebar = '';
  const nxb = Math.min(r.bars_x, 12);
  const nyb = Math.min(r.bars_y, 12);
  for (let i = 1; i <= nxb; i++) {
    const by = P_fy1 + i * P_fh / (nxb + 1);
    planRebar += `<line x1="${P_fx1.toFixed(1)}" y1="${by.toFixed(1)}" x2="${P_fx2.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#c00" stroke-width="0.7" opacity="0.55"/>`;
  }
  for (let i = 1; i <= nyb; i++) {
    const bx = P_fx1 + i * P_fw / (nyb + 1);
    planRebar += `<line x1="${bx.toFixed(1)}" y1="${P_fy1.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${P_fy2.toFixed(1)}" stroke="#800" stroke-width="0.7" opacity="0.55"/>`;
  }

  let planDims = '';
  planDims += hdim(P_fx1, P_fx2, P_fy1 - 22, `B = ${r.B} mm`);
  planDims += vdim(P_fx2 + 22, P_fy1, P_fy2, `L = ${r.L} mm`, true);
  planDims += hdim(P_fx1, P_ccx1, P_fy2 + 14, `${r.a_x.toFixed(0)}`, false);
  planDims += hdim(P_ccx2, P_fx2, P_fy2 + 14, `${r.a_x.toFixed(0)}`, false);
  planDims += vdim(P_fx1 - 14, P_fy1, P_ccy1, `${r.a_y.toFixed(0)}`);
  planDims += vdim(P_fx1 - 14, P_ccy2, P_fy2, `${r.a_y.toFixed(0)}`);
  if (P_cw > 16) planDims += hdim(P_ccx1, P_ccx2, P_ccy1 - 7, `b=${r.colB}`);
  if (P_ch > 16) planDims += vdim(P_ccx2 + 8, P_ccy1, P_ccy2, `h=${r.colH}`, true);

  const planCuts = `
<line x1="${(P_fx1 - 8).toFixed(1)}" y1="${P_CY.toFixed(1)}" x2="${(P_fx2 + 8).toFixed(1)}" y2="${P_CY.toFixed(1)}" stroke="#1a3a5c" stroke-width="0.9" stroke-dasharray="4,2"/>
<text x="${(P_fx1 - 10).toFixed(1)}" y="${(P_CY + 3).toFixed(1)}" text-anchor="end" font-size="8" font-weight="bold" fill="#1a3a5c">A</text>
<text x="${(P_fx2 + 10).toFixed(1)}" y="${(P_CY + 3).toFixed(1)}" text-anchor="start" font-size="8" font-weight="bold" fill="#1a3a5c">A</text>
<line x1="${P_CX.toFixed(1)}" y1="${(P_fy1 - 8).toFixed(1)}" x2="${P_CX.toFixed(1)}" y2="${(P_fy2 + 8).toFixed(1)}" stroke="#880000" stroke-width="0.9" stroke-dasharray="4,2"/>
<text x="${P_CX.toFixed(1)}" y="${(P_fy1 - 10).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="bold" fill="#880000">B</text>
<text x="${P_CX.toFixed(1)}" y="${(P_fy2 + 16).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="bold" fill="#880000">B</text>`;

  const panelPlan = `
<g transform="translate(0,${TITLE_H})" clip-path="url(#clipP${id})">
  <rect width="${PANEL_W}" height="${CONTENT_H}" fill="#f8fafd"/>
  ${planRebar}
  <rect x="${P_fx1.toFixed(1)}" y="${P_fy1.toFixed(1)}" width="${P_fw.toFixed(1)}" height="${P_fh.toFixed(1)}" fill="none" stroke="#1a3a5c" stroke-width="1.8"/>
  <rect x="${P_ccx1.toFixed(1)}" y="${P_ccy1.toFixed(1)}" width="${P_cw.toFixed(1)}" height="${P_ch.toFixed(1)}" fill="#1a3a5c" fill-opacity="0.82" stroke="#1a3a5c" stroke-width="0.8"/>
  <text x="${P_CX.toFixed(1)}" y="${P_CY.toFixed(1)}" text-anchor="middle" fill="#fff" font-size="6.5" font-weight="bold">عمود</text>
  ${planCuts}
  ${planDims}
  <text x="${(PANEL_W / 2).toFixed(1)}" y="${(CONTENT_H - 4).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="bold" fill="#1a3a5c">مسقط أفقي — Plan View</text>
</g>`;

  // ══ PANEL 2: SECTION A-A (shows B-width, colB) ════════════════════════════
  // Section A-A cuts through the L-axis (horizontal cut), looking along L-direction
  // → footing width in drawing = B, column width = colB
  // → bars running in B-direction (bars_x) appear as a continuous line
  // → bars running in L-direction (bars_y) appear as DOTS
  const A_cover = mat.cover;
  const A_sc = Math.min((PANEL_W * 0.60) / r.B, (CONTENT_H * 0.46) / r.t);
  const A_sv = PANEL_W / 2;
  const A_footW = r.B * A_sc;
  const A_footH = r.t * A_sc;
  const A_colW  = r.colB * A_sc;
  const A_dfH   = Math.min(32, 0.3 * r.d * A_sc);
  const A_GY = 28, A_FY = A_GY + A_dfH, A_BY = A_FY + A_footH;
  const A_fX1 = A_sv - A_footW / 2, A_fX2 = A_sv + A_footW / 2;
  const A_cX1 = A_sv - A_colW / 2;
  const A_cTop = Math.max(2, A_GY - 35);
  const A_dY_bot = A_BY - A_cover * A_sc - r.dia_y * A_sc / 2;
  const A_dY_top = A_dY_bot - r.dia_y * A_sc - r.dia_x * A_sc;
  const A_nDots = Math.min(r.bars_y, 9);
  let A_rebarDots = '';
  for (let i = 0; i < A_nDots; i++) {
    const bx = A_fX1 + A_footW * (i + 1) / (A_nDots + 1);
    A_rebarDots += `<circle cx="${bx.toFixed(1)}" cy="${A_dY_bot.toFixed(1)}" r="2.2" fill="#c00" stroke="#800" stroke-width="0.4"/>`;
  }
  A_rebarDots += `<line x1="${(A_fX1 + 3).toFixed(1)}" y1="${A_dY_top.toFixed(1)}" x2="${(A_fX2 - 3).toFixed(1)}" y2="${A_dY_top.toFixed(1)}" stroke="#880000" stroke-width="2.2"/>`;

  const panelSecA = `
<g transform="translate(${PANEL_W},${TITLE_H})" clip-path="url(#clipA${id})">
  <rect width="${PANEL_W}" height="${CONTENT_H}" fill="#fdfaf8"/>
  <rect x="0" y="${A_GY.toFixed(1)}" width="${PANEL_W}" height="${A_dfH.toFixed(1)}" fill="url(#soil${id})" opacity="0.65"/>
  <line x1="0" y1="${A_GY.toFixed(1)}" x2="${PANEL_W}" y2="${A_GY.toFixed(1)}" stroke="#6a5430" stroke-width="1.2" stroke-dasharray="4,2"/>
  <text x="3" y="${(A_GY - 2).toFixed(1)}" font-size="6.5" fill="#6a5430">G.L.</text>
  <rect x="${A_cX1.toFixed(1)}" y="${A_cTop.toFixed(1)}" width="${A_colW.toFixed(1)}" height="${(A_GY - A_cTop + A_dfH).toFixed(1)}" fill="url(#conc${id})" opacity="0.5" stroke="#1a3a5c" stroke-width="1.2"/>
  <text x="${A_sv.toFixed(1)}" y="${(A_cTop + 9).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#1a3a5c">عمود</text>
  <rect x="${A_fX1.toFixed(1)}" y="${A_FY.toFixed(1)}" width="${A_footW.toFixed(1)}" height="${A_footH.toFixed(1)}" fill="url(#conc${id})" opacity="0.5" stroke="#1a3a5c" stroke-width="1.8"/>
  <rect x="${A_fX1.toFixed(1)}" y="${A_BY.toFixed(1)}" width="${A_footW.toFixed(1)}" height="9" fill="#d0d8e0" stroke="#888" stroke-width="0.6"/>
  <text x="${A_sv.toFixed(1)}" y="${(A_BY + 7.5).toFixed(1)}" text-anchor="middle" font-size="6" fill="#555">طبقة نظافة 50mm</text>
  <line x1="${(A_fX1 + 2).toFixed(1)}" y1="${A_dY_bot.toFixed(1)}" x2="${(A_fX2 - 2).toFixed(1)}" y2="${A_dY_bot.toFixed(1)}" stroke="#1a3a5c" stroke-width="0.3" stroke-dasharray="3,2"/>
  ${A_rebarDots}
  <text x="${(A_fX2 + 2).toFixed(1)}" y="${(A_dY_bot + 3).toFixed(1)}" font-size="5.5" fill="#c00">${r.bars_y}Ø${r.dia_y}@${r.spacing_y} ‖ L</text>
  <text x="${(A_fX2 + 2).toFixed(1)}" y="${(A_dY_top + 3).toFixed(1)}" font-size="5.5" fill="#800">${r.bars_x}Ø${r.dia_x}@${r.spacing_x} ‖ B</text>
  ${hdim(A_fX1, A_fX2, A_BY + 17, `B = ${r.B} mm`, false)}
  ${hdim(A_cX1, A_cX1 + A_colW, A_FY - 7, `b=${r.colB}`)}
  ${vdim(A_fX1 - 9, A_FY, A_BY, `t=${r.t}`)}
  ${vdim(A_fX1 - 20, A_dY_bot, A_BY, `d=${r.d}`)}
  <line x1="${(A_fX2 + 16).toFixed(1)}" y1="${A_BY.toFixed(1)}" x2="${(A_fX2 + 16).toFixed(1)}" y2="${A_dY_bot.toFixed(1)}" stroke="#888" stroke-width="0.6" marker-start="url(#arl${id})" marker-end="url(#ar${id})"/>
  <text x="${(A_fX2 + 18).toFixed(1)}" y="${((A_BY + A_dY_bot) / 2 + 3).toFixed(1)}" font-size="5.5" fill="#888">غ.${mat.cover}</text>
  <text x="${(PANEL_W / 2).toFixed(1)}" y="${(CONTENT_H - 4).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="bold" fill="#1a3a5c">قطاع أ—أ (Section A-A)</text>
</g>`;

  // ══ PANEL 3: SECTION B-B (shows L-length, colH) ═══════════════════════════
  // Section B-B cuts through the B-axis (vertical cut), looking along B-direction
  // → footing width in drawing = L, column width = colH
  // → bars running in L-direction (bars_y) appear as a continuous line
  // → bars running in B-direction (bars_x) appear as DOTS
  const B_cover = mat.cover;
  const B_sc = Math.min((PANEL_W * 0.60) / r.L, (CONTENT_H * 0.46) / r.t);
  const B_sv = PANEL_W / 2;
  const B_footW = r.L * B_sc;
  const B_footH = r.t * B_sc;
  const B_colW  = r.colH * B_sc;
  const B_dfH   = Math.min(32, 0.3 * r.d * B_sc);
  const B_GY = 28, B_FY = B_GY + B_dfH, B_BY = B_FY + B_footH;
  const B_fX1 = B_sv - B_footW / 2, B_fX2 = B_sv + B_footW / 2;
  const B_cX1 = B_sv - B_colW / 2;
  const B_cTop = Math.max(2, B_GY - 35);
  const B_dY_bot = B_BY - B_cover * B_sc - r.dia_x * B_sc / 2;
  const B_dY_top = B_dY_bot - r.dia_x * B_sc - r.dia_y * B_sc;
  const B_nDots = Math.min(r.bars_x, 9);
  let B_rebarDots = '';
  for (let i = 0; i < B_nDots; i++) {
    const bx = B_fX1 + B_footW * (i + 1) / (B_nDots + 1);
    B_rebarDots += `<circle cx="${bx.toFixed(1)}" cy="${B_dY_bot.toFixed(1)}" r="2.2" fill="#c00" stroke="#800" stroke-width="0.4"/>`;
  }
  B_rebarDots += `<line x1="${(B_fX1 + 3).toFixed(1)}" y1="${B_dY_top.toFixed(1)}" x2="${(B_fX2 - 3).toFixed(1)}" y2="${B_dY_top.toFixed(1)}" stroke="#880000" stroke-width="2.2"/>`;

  const panelSecB = `
<g transform="translate(${PANEL_W * 2},${TITLE_H})" clip-path="url(#clipB${id})">
  <rect width="${PANEL_W}" height="${CONTENT_H}" fill="#f8fdf8"/>
  <rect x="0" y="${B_GY.toFixed(1)}" width="${PANEL_W}" height="${B_dfH.toFixed(1)}" fill="url(#soil${id})" opacity="0.65"/>
  <line x1="0" y1="${B_GY.toFixed(1)}" x2="${PANEL_W}" y2="${B_GY.toFixed(1)}" stroke="#6a5430" stroke-width="1.2" stroke-dasharray="4,2"/>
  <text x="3" y="${(B_GY - 2).toFixed(1)}" font-size="6.5" fill="#6a5430">G.L.</text>
  <rect x="${B_cX1.toFixed(1)}" y="${B_cTop.toFixed(1)}" width="${B_colW.toFixed(1)}" height="${(B_GY - B_cTop + B_dfH).toFixed(1)}" fill="url(#conc${id})" opacity="0.5" stroke="#1a3a5c" stroke-width="1.2"/>
  <text x="${B_sv.toFixed(1)}" y="${(B_cTop + 9).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#1a3a5c">عمود</text>
  <rect x="${B_fX1.toFixed(1)}" y="${B_FY.toFixed(1)}" width="${B_footW.toFixed(1)}" height="${B_footH.toFixed(1)}" fill="url(#conc${id})" opacity="0.5" stroke="#1a3a5c" stroke-width="1.8"/>
  <rect x="${B_fX1.toFixed(1)}" y="${B_BY.toFixed(1)}" width="${B_footW.toFixed(1)}" height="9" fill="#d0d8e0" stroke="#888" stroke-width="0.6"/>
  <text x="${B_sv.toFixed(1)}" y="${(B_BY + 7.5).toFixed(1)}" text-anchor="middle" font-size="6" fill="#555">طبقة نظافة 50mm</text>
  <line x1="${(B_fX1 + 2).toFixed(1)}" y1="${B_dY_bot.toFixed(1)}" x2="${(B_fX2 - 2).toFixed(1)}" y2="${B_dY_bot.toFixed(1)}" stroke="#1a3a5c" stroke-width="0.3" stroke-dasharray="3,2"/>
  ${B_rebarDots}
  <text x="${(B_fX2 + 2).toFixed(1)}" y="${(B_dY_bot + 3).toFixed(1)}" font-size="5.5" fill="#c00">${r.bars_x}Ø${r.dia_x}@${r.spacing_x} ‖ B</text>
  <text x="${(B_fX2 + 2).toFixed(1)}" y="${(B_dY_top + 3).toFixed(1)}" font-size="5.5" fill="#800">${r.bars_y}Ø${r.dia_y}@${r.spacing_y} ‖ L</text>
  ${hdim(B_fX1, B_fX2, B_BY + 17, `L = ${r.L} mm`, false)}
  ${hdim(B_cX1, B_cX1 + B_colW, B_FY - 7, `h=${r.colH}`)}
  ${vdim(B_fX1 - 9, B_FY, B_BY, `t=${r.t}`)}
  ${vdim(B_fX1 - 20, B_dY_bot, B_BY, `d=${r.d}`)}
  <line x1="${(B_fX2 + 16).toFixed(1)}" y1="${B_BY.toFixed(1)}" x2="${(B_fX2 + 16).toFixed(1)}" y2="${B_dY_bot.toFixed(1)}" stroke="#888" stroke-width="0.6" marker-start="url(#arl${id})" marker-end="url(#ar${id})"/>
  <text x="${(B_fX2 + 18).toFixed(1)}" y="${((B_BY + B_dY_bot) / 2 + 3).toFixed(1)}" font-size="5.5" fill="#888">غ.${mat.cover}</text>
  <text x="${(PANEL_W / 2).toFixed(1)}" y="${(CONTENT_H - 4).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="bold" fill="#880000">قطاع ب—ب (Section B-B)</text>
</g>`;

  // ── Title bar across full width ────────────────────────────────────────────
  const titleBar = `
<rect x="0" y="0" width="${TOTAL_W}" height="${TITLE_H}" fill="#1a3a5c"/>
<text x="10" y="14" font-size="9" font-weight="bold" fill="#fff" font-family="Arial,sans-serif">
  نوع ${typeKey} — ${r.B}×${r.L}×${r.t} mm  |  t_min,ACI = ${t_min_aci} mm  |  أعمدة: ${colIds.join(', ')}
</text>`;

  // ── Vertical separator lines between panels ────────────────────────────────
  const seps = `
<line x1="${PANEL_W}" y1="0" x2="${PANEL_W}" y2="${TOTAL_H}" stroke="#1a3a5c" stroke-width="1.5"/>
<line x1="${PANEL_W * 2}" y1="0" x2="${PANEL_W * 2}" y2="${TOTAL_H}" stroke="#1a3a5c" stroke-width="1.5"/>`;

  // ── Outer border ───────────────────────────────────────────────────────────
  const border = `<rect x="0.5" y="0.5" width="${TOTAL_W - 1}" height="${TOTAL_H - 1}" fill="none" stroke="#1a3a5c" stroke-width="1.5"/>`;

  return `<svg width="${TOTAL_W}" height="${TOTAL_H}" viewBox="0 0 ${TOTAL_W} ${TOTAL_H}"
  xmlns="http://www.w3.org/2000/svg"
  style="display:block;width:100%;max-width:${TOTAL_W}px;height:auto;margin-bottom:0">
  ${defs}
  ${border}
  ${titleBar}
  ${panelPlan}
  ${panelSecA}
  ${panelSecB}
  ${seps}
</svg>`
  + SEP; // SEP is 0, just for readability
}

/**
 * Generate a printable ACI 318-compliant HTML foundation drawing.
 *
 * The drawing contains:
 *   1. Global foundation plan (all footings at building positions)
 *   2. Per-type footing detail sheets (Plan + Section A-A + Section B-B)
 *   3. Footing schedule table
 */
export function generateFoundationDrawingHTML(
  results: FootingDesignResult[],
  titleBlock: {
    projectName?: string;
    firmName?: string;
    designedBy?: string;
    checkedBy?: string;
    date?: string;
    drawingNumber?: string;
  },
  mat: FootingMaterials,
  paperSize: 'A1' | 'A3' | 'A4' = 'A3',
): string {
  if (results.length === 0) return '<html><body>لا توجد نتائج</body></html>';

  const today = titleBlock.date || new Date().toLocaleDateString('ar-EG');
  const proj = titleBlock.projectName || 'المشروع';

  // ── Unique footing types ──────────────────────────────────────────────────
  type FType = {
    key: string; B: number; L: number; t: number; t_min_aci: number;
    dia_x: number; bars_x: number; spacing_x: number;
    dia_y: number; bars_y: number; spacing_y: number;
    ids: string[]; rep: FootingDesignResult;
  };
  const typeMap = new Map<string, FType>();
  const colToType = new Map<string, string>();
  let typeIdx = 1;
  for (const r of results) {
    const key = `${r.B}x${r.L}x${r.t}`;
    if (!typeMap.has(key)) {
      const label = `F${typeIdx++}`;
      typeMap.set(key, {
        key: label, B: r.B, L: r.L, t: r.t, t_min_aci: r.t_min_aci,
        dia_x: r.dia_x, bars_x: r.bars_x, spacing_x: r.spacing_x,
        dia_y: r.dia_y, bars_y: r.bars_y, spacing_y: r.spacing_y,
        ids: [], rep: r,
      });
    }
    const ft = typeMap.get(key)!;
    ft.ids.push(r.colId);
    colToType.set(r.colId, ft.key);
  }

  // ── Per-type sheet builder (one drawing plate per foundation type) ───────
  const buildPlateForType = (ft: FType, plateIndex: number, totalPlates: number): string => {
    const typeResults = results.filter(r => colToType.get(r.colId) === ft.key);
    if (typeResults.length === 0) return '';

    // Plan geometry — based ONLY on this type's footings
    const xs = typeResults.map(r => r.x);
    const ys = typeResults.map(r => r.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 0.001);
    const spanY = Math.max(maxY - minY, 0.001);
    const PAD = Math.max(2, Math.max(spanX, spanY) * 0.2);
    const worldW = spanX + 2 * PAD;
    const worldH = spanY + 2 * PAD;
    const PLAN_W = 560;
    const PLAN_H = Math.max(280, Math.round(PLAN_W * (worldH / Math.max(worldW, 0.1))));
    const scale = PLAN_W / worldW;
    const px = (mx: number) => ((mx - minX + PAD) * scale);
    const py = (my: number) => (PLAN_H - (my - minY + PAD) * scale);
    const mm2px = (mm: number) => (mm / 1000) * scale;

    const markers = `
    <defs>
      <marker id="arrP_${ft.key}" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
        <path d="M0,0 L6,2 L0,4 Z" fill="#c00"/>
      </marker>
      <marker id="arrlP_${ft.key}" markerWidth="6" markerHeight="4" refX="1" refY="2" orient="auto-start-reverse">
        <path d="M6,0 L0,2 L6,4 Z" fill="#c00"/>
      </marker>
      <pattern id="hatch_${ft.key}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#b0b8c8" stroke-width="0.8"/>
      </pattern>
    </defs>`;

    let planElems = '';
    let dimLines = '';
    let colLabels = '';
    const uXs = [...new Set(typeResults.map(r => r.x))].sort((a, b) => a - b);
    const uYs = [...new Set(typeResults.map(r => r.y))].sort((a, b) => a - b);
    for (const mx of uXs) {
      planElems += `<line x1="${px(mx).toFixed(1)}" y1="0" x2="${px(mx).toFixed(1)}" y2="${PLAN_H}" stroke="#aac" stroke-width="0.6" stroke-dasharray="6,3,2,3"/>`;
    }
    for (const my of uYs) {
      planElems += `<line x1="0" y1="${py(my).toFixed(1)}" x2="${PLAN_W}" y2="${py(my).toFixed(1)}" stroke="#aac" stroke-width="0.6" stroke-dasharray="6,3,2,3"/>`;
    }

    for (const r of typeResults) {
      const cx = px(r.x);
      const cy = py(r.y);
      const bpx = mm2px(r.B);
      const lpx = mm2px(r.L);
      const colBp = mm2px(Math.min(r.B * 0.3, 400));
      const colHp = mm2px(Math.min(r.L * 0.3, 400));
      planElems += `<rect x="${(cx - bpx / 2).toFixed(1)}" y="${(cy - lpx / 2).toFixed(1)}" width="${bpx.toFixed(1)}" height="${lpx.toFixed(1)}"
        fill="url(#hatch_${ft.key})" fill-opacity="0.4" stroke="#1a3a5c" stroke-width="1.2" stroke-dasharray="5,2.5" rx="1"/>`;
      planElems += `<rect x="${(cx - colBp / 2).toFixed(1)}" y="${(cy - colHp / 2).toFixed(1)}" width="${colBp.toFixed(1)}" height="${colHp.toFixed(1)}"
        fill="#1a3a5c" fill-opacity="0.85" stroke="#1a3a5c" stroke-width="1"/>`;
      colLabels += `<text x="${cx.toFixed(1)}" y="${(cy - lpx / 2 - 5).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="bold" fill="#1a3a5c">${ft.key}</text>`;
      colLabels += `<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#fff" font-weight="bold">${r.colId}</text>`;
      colLabels += `<text x="${cx.toFixed(1)}" y="${(cy + lpx / 2 + 10).toFixed(1)}" text-anchor="middle" font-size="7" fill="#880000">${r.B}×${r.L}</text>`;
    }

    if (uXs.length > 1) {
      const dimY = PLAN_H - 5;
      for (let i = 0; i < uXs.length - 1; i++) {
        const x1 = px(uXs[i]);
        const x2 = px(uXs[i + 1]);
        const dist = ((uXs[i + 1] - uXs[i]) * 1000).toFixed(0) + ' mm';
        const mid = (x1 + x2) / 2;
        dimLines += `<line x1="${x1.toFixed(1)}" y1="${dimY}" x2="${x2.toFixed(1)}" y2="${dimY}" stroke="#c00" stroke-width="0.7" marker-start="url(#arrlP_${ft.key})" marker-end="url(#arrP_${ft.key})"/>`;
        dimLines += `<text x="${mid.toFixed(1)}" y="${(dimY - 3).toFixed(1)}" text-anchor="middle" font-size="7" fill="#c00">${dist}</text>`;
      }
    }
    if (uYs.length > 1) {
      const dimX = PLAN_W - 5;
      for (let i = 0; i < uYs.length - 1; i++) {
        const y1 = py(uYs[i]);
        const y2 = py(uYs[i + 1]);
        const dist = ((uYs[i + 1] - uYs[i]) * 1000).toFixed(0) + ' mm';
        const mid = (y1 + y2) / 2;
        dimLines += `<line x1="${dimX}" y1="${y2.toFixed(1)}" x2="${dimX}" y2="${y1.toFixed(1)}" stroke="#c00" stroke-width="0.7" marker-start="url(#arrlP_${ft.key})" marker-end="url(#arrP_${ft.key})"/>`;
        dimLines += `<text x="${(dimX - 3).toFixed(1)}" y="${mid.toFixed(1)}" text-anchor="end" font-size="7" fill="#c00">${dist}</text>`;
      }
    }

    // Per-type schedule + design rows for THIS type only
    const typeSchedRow = `
      <tr>
        <td class="ftype"><b>${ft.key}</b></td>
        <td>${ft.B}</td>
        <td>${ft.L}</td>
        <td>${ft.t}</td>
        <td>${ft.t_min_aci}</td>
        <td class="rebar">${ft.bars_x}Ø${ft.dia_x}@${ft.spacing_x}</td>
        <td class="rebar">${ft.bars_y}Ø${ft.dia_y}@${ft.spacing_y}</td>
        <td>${ft.ids.length} عمود</td>
      </tr>`;
    const typeDetailRows = typeResults.map(r => `
      <tr class="${r.adequate ? '' : 'fail'}">
        <td class="ftype">${r.colId}</td>
        <td>${r.P_service.toFixed(0)}</td>
        <td>${r.B}×${r.L}</td>
        <td>${r.t}</td>
        <td>${r.d}</td>
        <td>${r.q_actual.toFixed(0)}</td>
        <td class="${r.bearing_ok ? 'ok' : 'fail'}">${r.bearing_ok ? '✓' : '✗'}</td>
        <td class="rebar">${r.bars_x}Ø${r.dia_x}@${r.spacing_x}</td>
        <td class="rebar">${r.bars_y}Ø${r.dia_y}@${r.spacing_y}</td>
        <td class="${r.wide_shear_ok ? 'ok' : 'fail'}">${r.wide_shear_ok ? '✓' : '✗'}</td>
        <td class="${r.punch_shear_ok ? 'ok' : 'fail'}">${r.punch_shear_ok ? '✓' : '✗'}</td>
      </tr>`).join('');

    const drawingNo = `${titleBlock.drawingNumber || 'F'}-${String(plateIndex).padStart(2, '0')}`;
    const pageBreak = plateIndex < totalPlates ? 'page-break-after: always;' : '';

    return `
<section class="plate" style="${pageBreak}">

  <!-- Title block (per-plate) -->
  <div class="title-block">
    <div class="tb-main">
      <h1>لوحة تنفيذية — أساسات نوع ${ft.key} (${ft.B}×${ft.L}×${ft.t} mm)</h1>
      <div class="sub">طريقة الإجهادات العاملة (WSM / ASD) · ACI 318 · UBC 1997</div>
      <div class="sub" style="margin-top:2px">المشروع: <b>${proj}</b> &nbsp;|&nbsp; مكتب الاستشارات: <b>${titleBlock.firmName || '—'}</b></div>
      <div class="sub" style="margin-top:2px">عدد الأعمدة المرتبطة بهذا النوع: <b>${ft.ids.length}</b> &nbsp;|&nbsp; الورقة <b>${plateIndex} / ${totalPlates}</b></div>
    </div>
    <div class="tb-side">
      <div class="tb-cell"><b>صمّمه:</b><span>${titleBlock.designedBy || '—'}</span></div>
      <div class="tb-cell"><b>راجعه:</b><span>${titleBlock.checkedBy || '—'}</span></div>
      <div class="tb-cell"><b>التاريخ:</b><span>${today}</span></div>
      <div class="tb-cell"><b>رقم اللوحة:</b><span>${drawingNo}</span></div>
    </div>
  </div>

  <!-- Material bar -->
  <div class="mat-bar">
    <span><b>f'c</b> = ${mat.fc} MPa</span>
    <span><b>fy</b> = ${mat.fy} MPa</span>
    <span><b>qa</b> = ${mat.qa} kN/m²</span>
    <span><b>fc,allow</b> = ${(0.45 * mat.fc).toFixed(1)} MPa</span>
    <span><b>fs,allow</b> = ${Math.min(0.5 * mat.fy, 207).toFixed(0)} MPa</span>
    <span><b>Df</b> = ${mat.Df} m</span>
    <span><b>Cover</b> = ${mat.cover} mm</span>
  </div>

  <!-- Plan: only this type's footings -->
  <div class="sec-hdr">مسقط الأساسات — النوع ${ft.key} فقط</div>
  <div class="draw-box" style="margin-bottom:8px">
    <svg class="plan-svg" viewBox="0 0 ${PLAN_W} ${PLAN_H}" xmlns="http://www.w3.org/2000/svg">
      ${markers}
      <rect width="${PLAN_W}" height="${PLAN_H}" fill="#f8f9fb"/>
      ${planElems}
      ${dimLines}
      ${colLabels}
    </svg>
    <div style="font-size:7pt;color:#555;margin-top:3px;text-align:center">
      ▬ ▬ حدود الأساس &nbsp;|&nbsp; ■ العمود &nbsp;|&nbsp; ${ft.key} نوع القاعدة &nbsp;|&nbsp; جميع الأبعاد بالمليمتر
    </div>
  </div>

  <!-- Detail drawing for this type -->
  <div class="sec-hdr">تفاصيل النوع ${ft.key} — Plan + Section A-A + Section B-B</div>
  <div style="margin-bottom:10px;page-break-inside:avoid">
    ${buildTypeDetailSVG(ft.rep, mat, ft.key, ft.ids, ft.t_min_aci)}
  </div>

  <!-- Schedule (this type only) -->
  <div class="sec-hdr">جدول النوع ${ft.key} — Footing Type Schedule</div>
  <table>
    <thead>
      <tr>
        <th>النوع</th>
        <th>B (mm)</th>
        <th>L (mm)</th>
        <th>t مختار (mm)</th>
        <th>t<sub>min,ACI</sub> (mm)</th>
        <th>تسليح اتجاه B</th>
        <th>تسليح اتجاه L</th>
        <th>عدد القواعد</th>
      </tr>
    </thead>
    <tbody>${typeSchedRow}</tbody>
  </table>

  <!-- Per-column results in this type -->
  <div class="sec-hdr">نتائج التصميم لكل عمود — النوع ${ft.key}</div>
  <table>
    <thead>
      <tr>
        <th>العمود</th>
        <th>P (kN)</th>
        <th>B×L (mm)</th>
        <th>t (mm)</th>
        <th>d (mm)</th>
        <th>q فعلي<br/>kN/m²</th>
        <th>ضغط التربة</th>
        <th>تسليح B</th>
        <th>تسليح L</th>
        <th>قص عريض</th>
        <th>قص ثقبي</th>
      </tr>
    </thead>
    <tbody>${typeDetailRows}</tbody>
  </table>

  <!-- Notes -->
  <div class="sec-hdr">ملاحظات تنفيذية — Construction Notes</div>
  <ol class="notes">
    <li>تُصَب طبقة نظافة سُمكها <b>50 mm</b> من الخرسانة العادية قبل وضع حديد التسليح.</li>
    <li>الغطاء الخرساني لأساسات الأرض ≥ <b>${mat.cover} mm</b> (ACI 318 §20.6.1.3).</li>
    <li>جميع الحديد ${mat.fy === 420 ? 'Grade 60 (fy = 420 MPa)' : mat.fy === 280 ? 'Grade 40 (fy = 280 MPa)' : `fy = ${mat.fy} MPa`}.</li>
    <li>طول التماسك الأساسي: ld ≥ 0.02 × fy/√f'c × db (ACI 318 §25.5).</li>
    <li>منسوب التأسيس Df = ${mat.Df} m من منسوب الطبيعي.</li>
  </ol>

</section>`;
  };

  const types = [...typeMap.values()];
  const platesHTML = types.map((ft, i) => buildPlateForType(ft, i + 1, types.length)).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title>لوحة الأساسات — ${proj}</title>
<style>
  @page { size: ${paperSize} landscape; margin: 8mm; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Arial',sans-serif;font-size:9pt;color:#111;background:#fff;padding:8mm}
  section.plate{padding-bottom:6mm}
  .title-block{display:grid;grid-template-columns:repeat(6,1fr);border:2px solid #1a3a5c;margin-bottom:8px}
  .tb-main{grid-column:1/5;padding:4px 10px;border-left:1px solid #ccc}
  .tb-main h1{font-size:13pt;color:#1a3a5c;border-bottom:1px solid #ccc;padding-bottom:3px;margin-bottom:3px}
  .tb-main .sub{font-size:8pt;color:#555}
  .tb-side{grid-column:5/7;display:grid;grid-template-rows:repeat(4,1fr);border-right:1px solid #aaa}
  .tb-cell{padding:3px 8px;border-bottom:1px solid #ddd;font-size:8pt;display:flex;justify-content:space-between}
  .tb-cell b{color:#1a3a5c}
  .sec-hdr{background:#1a3a5c;color:#fff;font-size:9pt;font-weight:bold;padding:3px 8px;margin:8px 0 4px}
  .draw-box{border:1px solid #ccc;padding:4px;background:#fafbfc}
  svg.plan-svg{display:block;width:100%}
  table{width:100%;border-collapse:collapse;font-size:8pt;margin-bottom:8px}
  th{background:#1a3a5c;color:#fff;padding:4px 6px;text-align:center;border:1px solid #1a3a5c}
  td{border:1px solid #ccc;padding:3px 5px;text-align:center}
  tr:nth-child(even) td{background:#f4f7fb}
  .ftype{font-weight:bold;color:#1a3a5c}
  .rebar{font-family:monospace;color:#880000;font-weight:bold}
  .ok{color:green}
  .fail{color:red;background:#fff0f0 !important}
  .notes{font-size:8pt;border:1px solid #ccc;padding:6px 10px;background:#fafbfc}
  .notes li{margin:2px 0;margin-right:16px}
  .mat-bar{display:flex;flex-wrap:wrap;gap:12px;background:#eef3fa;padding:5px 10px;font-size:8pt;border:1px solid #c0cfe0;margin-bottom:6px}
  .mat-bar span{white-space:nowrap}
  .mat-bar b{color:#1a3a5c}
  @media print{body{padding:4mm} .no-print{display:none} section.plate{padding-bottom:0}}
</style>
</head>
<body>
${platesHTML}
</body>
</html>`;
}


