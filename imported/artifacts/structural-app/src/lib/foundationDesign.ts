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
 * Layout per plate (A3 landscape @ 3 px/mm = 1260 × 891 px):
 *   - Drawing zone (left ~78%):
 *       Top 55%: Main plan view (all footing positions)
 *       Bottom 45%: Section A-A (left) + Section B-B (right)
 *   - Table zone (right ~22%): Material props + Schedule + Column results + Notes
 *   - Title block: Bottom-right corner only (ISO 7200, matching other sheets)
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

  const today = titleBlock.date ?? new Date().toLocaleDateString('ar-EG');
  const proj  = titleBlock.projectName ?? 'المشروع';

  // ── Sheet: A3 landscape @ 3 px/mm = 1260 × 891 px ───────────────────────
  const SW = 1260, SH = 891;
  const MARGIN = 8;
  const FRAME  = 20;

  // Title block — ISO 7200 style, bottom-right corner only (matching other sheets)
  const TB_W = 595, TB_H = 106;
  const TB_X = SW - MARGIN - TB_W;   // 657
  const TB_Y = SH - MARGIN - TB_H;   // 777

  // Working area
  const WK_X = FRAME;
  const WK_Y = MARGIN + 4;
  const WK_W = SW - FRAME - MARGIN;  // 1232
  const WK_H = TB_Y - WK_Y - 2;     // 763

  // Drawing zone / Table zone split
  const TZ_W = 215;
  const DZ_W = WK_W - TZ_W - 4;    // 1013
  const TZ_X = WK_X + DZ_W + 4;    // 1037

  // Drawing zone internal layout
  const HDR_H = 15;
  const PLAN_H = Math.round((WK_H - 2 * HDR_H - 4) * 0.55);
  const SEC_H  = WK_H - 2 * HDR_H - 4 - PLAN_H;
  const SEC_W  = Math.floor(DZ_W / 2);

  // Absolute y-positions
  const planY     = WK_Y + HDR_H;
  const sec_hdrY  = planY + PLAN_H;
  const secY      = sec_hdrY + HDR_H;

  // ── Unique footing types ─────────────────────────────────────────────────
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
    typeMap.get(key)!.ids.push(r.colId);
    colToType.set(r.colId, typeMap.get(key)!.key);
  }

  // ── Plan SVG (all footings of this type, site plan) ─────────────────────
  const buildPlanSVG = (ft: FType, typeResults: FootingDesignResult[], w: number, h: number): string => {
    const xs = typeResults.map(r => r.x);
    const ys = typeResults.map(r => r.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 0.001);
    const spanY = Math.max(maxY - minY, 0.001);
    // Adaptive padding: use footing dimensions to ensure footings fill at least 50% of the view
    const maxFB = Math.max(...typeResults.map(r => r.B / 1000));
    const maxFL = Math.max(...typeResults.map(r => r.L / 1000));
    const PAD = Math.max(maxFB * 0.7, maxFL * 0.7, Math.max(spanX, spanY) * 0.18, 0.4);
    const worldW = spanX + 2 * PAD;
    const worldH = spanY + 2 * PAD;
    const sc = Math.min((w - 4) / worldW, (h - 22) / worldH);
    const offX = (w - worldW * sc) / 2;
    const offY = ((h - 22) - worldH * sc) / 2;
    const px2 = (mx: number) => offX + (mx - minX + PAD) * sc;
    const py2 = (my: number) => offY + (worldH - (my - minY + PAD)) * sc;
    const mm2p = (mm: number) => (mm / 1000) * sc;

    const uid = 'pln_' + ft.key;
    let elems = `<defs>
  <marker id="arr${uid}" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto"><path d="M0,0 L5,2 L0,4 Z" fill="#c00"/></marker>
  <marker id="arrl${uid}" markerWidth="5" markerHeight="4" refX="1" refY="2" orient="auto-start-reverse"><path d="M5,0 L0,2 L5,4 Z" fill="#c00"/></marker>
  <pattern id="htch${uid}" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#b0b8c8" stroke-width="0.9"/></pattern>
</defs>
<rect width="${w}" height="${h}" fill="#f8f9fb"/>`;

    const uXs = [...new Set(xs)].sort((a, b) => a - b);
    const uYs = [...new Set(ys)].sort((a, b) => a - b);

    for (const mx of uXs) elems += `<line x1="${px2(mx).toFixed(1)}" y1="2" x2="${px2(mx).toFixed(1)}" y2="${h - 22}" stroke="#aac" stroke-width="0.6" stroke-dasharray="6,3,2,3"/>`;
    for (const my of uYs) elems += `<line x1="2" y1="${py2(my).toFixed(1)}" x2="${w - 2}" y2="${py2(my).toFixed(1)}" stroke="#aac" stroke-width="0.6" stroke-dasharray="6,3,2,3"/>`;

    let firstFooting = true;
    for (const r of typeResults) {
      const cx = px2(r.x), cy = py2(r.y);
      const bw = mm2p(r.B), lh2 = mm2p(r.L);
      const cw = mm2p(Math.min(r.colB, r.B * 0.35)), ch = mm2p(Math.min(r.colH, r.L * 0.35));
      // Footing outline (hatched)
      elems += `<rect x="${(cx-bw/2).toFixed(1)}" y="${(cy-lh2/2).toFixed(1)}" width="${bw.toFixed(1)}" height="${lh2.toFixed(1)}" fill="url(#htch${uid})" fill-opacity="0.5" stroke="#1a3a5c" stroke-width="1.5" rx="1"/>`;
      // Column section (solid)
      elems += `<rect x="${(cx-cw/2).toFixed(1)}" y="${(cy-ch/2).toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="#1a3a5c" fill-opacity="0.9" stroke="#1a3a5c" stroke-width="1"/>`;
      // Column ID inside column
      elems += `<text x="${cx.toFixed(1)}" y="${(cy+3).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#fff" font-weight="bold" font-family="Arial,sans-serif">${r.colId}</text>`;
      // Footing type above
      elems += `<text x="${cx.toFixed(1)}" y="${(cy-lh2/2-5).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="bold" fill="#1a3a5c" font-family="Arial,sans-serif">${ft.key}</text>`;
      // B dimension (horizontal arrow below footing) — only for first footing to avoid clutter
      if (firstFooting) {
        const dimBY = cy + lh2 / 2 + 13;
        elems += `<line x1="${(cx-bw/2).toFixed(1)}" y1="${dimBY.toFixed(1)}" x2="${(cx+bw/2).toFixed(1)}" y2="${dimBY.toFixed(1)}" stroke="#c00" stroke-width="0.8" marker-start="url(#arrl${uid})" marker-end="url(#arr${uid})"/>`;
        elems += `<text x="${cx.toFixed(1)}" y="${(dimBY-2).toFixed(1)}" text-anchor="middle" font-size="7" font-weight="bold" fill="#c00" font-family="Arial,sans-serif">B=${r.B} mm</text>`;
        // L dimension (vertical arrow right of footing)
        const dimLX = cx + bw / 2 + 14;
        elems += `<line x1="${dimLX.toFixed(1)}" y1="${(cy-lh2/2).toFixed(1)}" x2="${dimLX.toFixed(1)}" y2="${(cy+lh2/2).toFixed(1)}" stroke="#880000" stroke-width="0.8" marker-start="url(#arrl${uid})" marker-end="url(#arr${uid})"/>`;
        elems += `<text x="${(dimLX+3).toFixed(1)}" y="${cy.toFixed(1)}" font-size="7" font-weight="bold" fill="#880000" font-family="Arial,sans-serif">L=${r.L}</text>`;
        // colB × colH label
        elems += `<text x="${cx.toFixed(1)}" y="${(cy+ch/2+10).toFixed(1)}" text-anchor="middle" font-size="6" fill="#555" font-family="Arial,sans-serif">${r.colB}×${r.colH}</text>`;
        firstFooting = false;
      }
    }
    // Grid spacing dimension lines
    if (uXs.length > 1) {
      const dimY = h - 12;
      for (let i = 0; i < uXs.length - 1; i++) {
        const x1 = px2(uXs[i]), x2 = px2(uXs[i+1]);
        const dist = ((uXs[i+1] - uXs[i]) * 1000).toFixed(0);
        elems += `<line x1="${x1.toFixed(1)}" y1="${dimY}" x2="${x2.toFixed(1)}" y2="${dimY}" stroke="#c00" stroke-width="0.7" marker-start="url(#arrl${uid})" marker-end="url(#arr${uid})"/>`;
        elems += `<text x="${((x1+x2)/2).toFixed(1)}" y="${(dimY-2)}" text-anchor="middle" font-size="6.5" fill="#c00" font-family="Arial,sans-serif">${dist}</text>`;
      }
    }
    if (uYs.length > 1) {
      const dimX = w - 8;
      for (let i = 0; i < uYs.length - 1; i++) {
        const y1 = py2(uYs[i]), y2 = py2(uYs[i+1]);
        const dist = ((uYs[i+1] - uYs[i]) * 1000).toFixed(0);
        elems += `<line x1="${dimX}" y1="${y2.toFixed(1)}" x2="${dimX}" y2="${y1.toFixed(1)}" stroke="#c00" stroke-width="0.7" marker-start="url(#arrl${uid})" marker-end="url(#arr${uid})"/>`;
        elems += `<text x="${(dimX-3).toFixed(1)}" y="${((y1+y2)/2).toFixed(1)}" text-anchor="end" font-size="6.5" fill="#c00" font-family="Arial,sans-serif">${dist}</text>`;
      }
    }
    // Legend
    elems += `<line x1="6" y1="${h-8}" x2="18" y2="${h-8}" stroke="#1a3a5c" stroke-width="1.5" stroke-dasharray="5,2.5"/>
<text x="21" y="${h-5}" font-size="6.5" fill="#555" font-family="Arial,sans-serif">حدود القاعدة</text>
<rect x="88" y="${h-13}" width="10" height="8" fill="#1a3a5c" fill-opacity="0.9"/>
<text x="101" y="${h-5}" font-size="6.5" fill="#555" font-family="Arial,sans-serif">مقطع العمود</text>
<text x="180" y="${h-5}" font-size="6" fill="#888" font-family="Arial,sans-serif">الأبعاد بالمليمتر</text>`;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="display:block">${elems}</svg>`;
  };

  // ── Section panel SVG inner content (parametric, fills given w × h) ──────
  // dir='A': A-A cut — shows B-width, colB, bars_y as dots, bars_x as line
  // dir='B': B-B cut — shows L-length, colH, bars_x as dots, bars_y as line
  const buildSectionPanel = (
    r: FootingDesignResult, dir: 'A' | 'B',
    panelW: number, panelH: number, uid: string,
  ): string => {
    const footWidthMm = dir === 'A' ? r.B    : r.L;
    const colWidthMm  = dir === 'A' ? r.colB : r.colH;
    const nDots       = Math.min(dir === 'A' ? r.bars_y : r.bars_x, 10);
    const diaDot      = dir === 'A' ? r.dia_y  : r.dia_x;
    const diaLine     = dir === 'A' ? r.dia_x  : r.dia_y;
    const barsLine    = dir === 'A' ? r.bars_x : r.bars_y;
    const spLine      = dir === 'A' ? r.spacing_x : r.spacing_y;
    const spDot       = dir === 'A' ? r.spacing_y : r.spacing_x;
    const dimLabel    = dir === 'A' ? `B = ${r.B}` : `L = ${r.L}`;
    const secLabel    = dir === 'A' ? 'قطاع أ—أ  (Section A-A)' : 'قطاع ب—ب  (Section B-B)';
    const secColor    = dir === 'A' ? '#1a3a5c' : '#770000';
    const bgColor     = dir === 'A' ? '#fdfaf8' : '#f8fdf8';
    const id = uid + dir;

    // Layout parameters
    const PAD_L = 38, PAD_R = 12, PAD_T = 6, LBL_H = 16;
    const drawW  = panelW - PAD_L - PAD_R;
    const GH     = Math.min(26, panelH * 0.09);
    const drawH  = panelH - PAD_T - GH - LBL_H - 18;

    // Scale: fit footing cross-section (footWidthMm × r.t) in drawW × drawH
    const sc  = Math.min(drawW / footWidthMm, drawH / r.t);
    const GL_Y = PAD_T + GH;
    const FW   = footWidthMm * sc;
    const FH   = r.t * sc;
    const FX1  = PAD_L + (drawW - FW) / 2;
    const FX2  = FX1 + FW;
    const FCX  = PAD_L + drawW / 2;
    const FY1  = GL_Y + Math.min(18, panelH * 0.065);
    const FY2  = FY1 + FH;
    const CW   = colWidthMm * sc;
    const CX1  = FCX - CW / 2;
    const COL_TOP = Math.max(PAD_T + 2, FY1 - Math.min(32, panelH * 0.08));

    // Rebar positions
    const cov_px   = mat.cover * sc;
    const dLine_px = diaLine * sc;
    const dDot_px  = diaDot  * sc;
    const REBAR_Y_DOT  = FY2 - cov_px - dDot_px / 2;
    const REBAR_Y_LINE = REBAR_Y_DOT - dDot_px / 2 - dLine_px / 2 - 1;

    // Blinding layer
    const BH = Math.min(7, panelH * 0.025);

    // Arrow marker IDs
    const arID = `ar${id}`, arlID = `arl${id}`;

    let dots = '';
    for (let i = 0; i < nDots; i++) {
      const dx = FX1 + FW * (i + 1) / (nDots + 1);
      dots += `<circle cx="${dx.toFixed(1)}" cy="${REBAR_Y_DOT.toFixed(1)}" r="2.5" fill="#c00" stroke="#900" stroke-width="0.4"/>`;
    }

    // Dimension: footing width (below footing)
    const DIM_Y = FY2 + BH + 11;
    const dim_width = `<line x1="${FX1.toFixed(1)}" y1="${DIM_Y.toFixed(1)}" x2="${FX2.toFixed(1)}" y2="${DIM_Y.toFixed(1)}" stroke="#c00" stroke-width="0.7" marker-start="url(#${arlID})" marker-end="url(#${arID})"/>
<text x="${FCX.toFixed(1)}" y="${(DIM_Y-2).toFixed(1)}" text-anchor="middle" font-size="7" fill="#c00" font-family="Arial">${dimLabel} mm</text>`;

    // Dimension: thickness t (left of footing)
    const dim_t = `<line x1="${(FX1-10).toFixed(1)}" y1="${FY1.toFixed(1)}" x2="${(FX1-10).toFixed(1)}" y2="${FY2.toFixed(1)}" stroke="#c00" stroke-width="0.7" marker-start="url(#${arlID})" marker-end="url(#${arID})"/>
<text x="${(FX1-12).toFixed(1)}" y="${((FY1+FY2)/2+3).toFixed(1)}" text-anchor="end" font-size="6.5" fill="#c00" font-family="Arial">t=${r.t}</text>`;

    // Dimension: cover (right of footing, between bottom and rebar)
    const dim_cov = `<line x1="${(FX2+8).toFixed(1)}" y1="${REBAR_Y_DOT.toFixed(1)}" x2="${(FX2+8).toFixed(1)}" y2="${FY2.toFixed(1)}" stroke="#888" stroke-width="0.5" marker-start="url(#${arlID})" marker-end="url(#${arID})"/>
<text x="${(FX2+11).toFixed(1)}" y="${((REBAR_Y_DOT+FY2)/2+3).toFixed(1)}" font-size="6" fill="#888" font-family="Arial">غ=${mat.cover}</text>`;

    // Rebar labels (to the right if space permits, else below)
    const hasRightSpace = FX2 + 40 < panelW - 4;
    const rebarLabels = hasRightSpace
      ? `<text x="${(FX2+4).toFixed(1)}" y="${(REBAR_Y_DOT+3).toFixed(1)}" font-size="6" fill="#c00" font-family="Arial">${nDots}Ø${diaDot}@${spDot}</text>
<text x="${(FX2+4).toFixed(1)}" y="${(REBAR_Y_LINE+3).toFixed(1)}" font-size="6" fill="#880000" font-family="Arial">${barsLine}Ø${diaLine}@${spLine}</text>`
      : `<text x="${FCX.toFixed(1)}" y="${(FY2+BH+26).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#c00" font-family="Arial">${nDots}Ø${diaDot}@${spDot} | ${barsLine}Ø${diaLine}@${spLine}</text>`;

    // ── Column stub rebar (starter bars) ──────────────────────────────────
    // Estimate column reinforcement: 40mm cover, 10mm stirrup, 20mm bar
    const COL_COV_PX  = Math.max(2.5, 40 * sc);   // 40mm column cover
    const COL_STIR_PX = Math.max(1,   10 * sc);   // 10mm stirrup
    const COL_BAR_R   = Math.max(1.5,  9 * sc);   // 9mm ≈ Ø18 bar radius
    // Stirrup rect inside column stub
    const STIR_X1 = CX1 + COL_COV_PX;
    const STIR_X2 = CX1 + CW - COL_COV_PX;
    const STIR_Y1 = COL_TOP + COL_COV_PX;
    const STIR_Y2 = FY1 + FH * 0.45;     // extends into footing as starter
    const STIR_W  = STIR_X2 - STIR_X1;
    const STIR_H  = STIR_Y2 - STIR_Y1;
    // Main bar x-positions (left side, right side, and face bars)
    const BAR_LX  = STIR_X1 + COL_STIR_PX + COL_BAR_R;
    const BAR_RX  = STIR_X2 - COL_STIR_PX - COL_BAR_R;
    // Additional face bars if column is wide enough
    const nFaceBars = Math.max(0, Math.floor((STIR_W - 2 * (COL_STIR_PX + 2 * COL_BAR_R)) / Math.max(1, 100 * sc)) - 1);
    let colFaceBars = '';
    if (nFaceBars > 0 && BAR_RX - BAR_LX > 4 * COL_BAR_R) {
      const faceSpacing = (BAR_RX - BAR_LX) / (nFaceBars + 1);
      for (let fi = 1; fi <= nFaceBars; fi++) {
        const fbx = BAR_LX + fi * faceSpacing;
        colFaceBars += `<line x1="${fbx.toFixed(1)}" y1="${STIR_Y1.toFixed(1)}" x2="${fbx.toFixed(1)}" y2="${STIR_Y2.toFixed(1)}" stroke="#c55" stroke-width="${(COL_BAR_R*1.6).toFixed(1)}" stroke-linecap="round"/>`;
      }
    }
    // Dimension: column width label
    const colWidthLabel = dir === 'A' ? `b=${r.colB}` : `h=${r.colH}`;

    return `<defs>
  <marker id="${arID}" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto"><path d="M0,0 L5,2 L0,4 Z" fill="#c00"/></marker>
  <marker id="${arlID}" markerWidth="5" markerHeight="4" refX="1" refY="2" orient="auto-start-reverse"><path d="M5,0 L0,2 L5,4 Z" fill="#c00"/></marker>
  <pattern id="conc${id}" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#9ab" stroke-width="1"/></pattern>
  <pattern id="soil${id}" patternUnits="userSpaceOnUse" width="6" height="4"><line x1="0" y1="0" x2="6" y2="4" stroke="#b8a070" stroke-width="0.8"/></pattern>
</defs>
<rect width="${panelW}" height="${panelH}" fill="${bgColor}"/>
<rect x="0" y="${PAD_T.toFixed(1)}" width="${panelW}" height="${GH.toFixed(1)}" fill="url(#soil${id})" opacity="0.55"/>
<line x1="0" y1="${GL_Y.toFixed(1)}" x2="${panelW}" y2="${GL_Y.toFixed(1)}" stroke="#6a5430" stroke-width="1.2" stroke-dasharray="4,2"/>
<text x="4" y="${(GL_Y-2).toFixed(1)}" font-size="6.5" fill="#6a5430" font-family="Arial">G.L.</text>
<!-- Column stub concrete -->
<rect x="${CX1.toFixed(1)}" y="${COL_TOP.toFixed(1)}" width="${CW.toFixed(1)}" height="${(FY1-COL_TOP+2).toFixed(1)}" fill="url(#conc${id})" fill-opacity="0.45" stroke="#1a3a5c" stroke-width="1.4"/>
<text x="${FCX.toFixed(1)}" y="${(COL_TOP+9).toFixed(1)}" text-anchor="middle" font-size="6" fill="#1a3a5c" font-family="Arial">عمود / Col</text>
<!-- Column width dim -->
<line x1="${CX1.toFixed(1)}" y1="${(COL_TOP-5).toFixed(1)}" x2="${(CX1+CW).toFixed(1)}" y2="${(COL_TOP-5).toFixed(1)}" stroke="#555" stroke-width="0.6" marker-start="url(#${arlID})" marker-end="url(#${arID})"/>
<text x="${FCX.toFixed(1)}" y="${(COL_TOP-7).toFixed(1)}" text-anchor="middle" font-size="6" fill="#555" font-family="Arial">${colWidthLabel} mm</text>
<!-- Starter bars (vertical lines through column and into footing) -->
<line x1="${BAR_LX.toFixed(1)}" y1="${STIR_Y1.toFixed(1)}" x2="${BAR_LX.toFixed(1)}" y2="${STIR_Y2.toFixed(1)}" stroke="#c55" stroke-width="${(COL_BAR_R*1.6).toFixed(1)}" stroke-linecap="round"/>
<line x1="${BAR_RX.toFixed(1)}" y1="${STIR_Y1.toFixed(1)}" x2="${BAR_RX.toFixed(1)}" y2="${STIR_Y2.toFixed(1)}" stroke="#c55" stroke-width="${(COL_BAR_R*1.6).toFixed(1)}" stroke-linecap="round"/>
${colFaceBars}
<!-- Stirrup in column stub -->
<rect x="${STIR_X1.toFixed(1)}" y="${STIR_Y1.toFixed(1)}" width="${STIR_W.toFixed(1)}" height="${(FY1-STIR_Y1+2).toFixed(1)}" fill="none" stroke="#e07000" stroke-width="1.2" rx="1"/>
<!-- Starter bar label -->
<text x="${(CX1+CW+3).toFixed(1)}" y="${((STIR_Y1+FY1)/2+3).toFixed(1)}" font-size="6" fill="#c55" font-family="Arial">بادئ</text>
<!-- Footing body -->
<rect x="${FX1.toFixed(1)}" y="${FY1.toFixed(1)}" width="${FW.toFixed(1)}" height="${FH.toFixed(1)}" fill="url(#conc${id})" fill-opacity="0.45" stroke="#1a3a5c" stroke-width="1.8"/>
<rect x="${FX1.toFixed(1)}" y="${FY2.toFixed(1)}" width="${FW.toFixed(1)}" height="${BH.toFixed(1)}" fill="#cdd5de" stroke="#aaa" stroke-width="0.5"/>
<text x="${FCX.toFixed(1)}" y="${(FY2+BH-1).toFixed(1)}" text-anchor="middle" font-size="5.5" fill="#555" font-family="Arial">نظافة 50mm</text>
<!-- Bottom rebar in footing -->
<line x1="${(FX1+3).toFixed(1)}" y1="${REBAR_Y_LINE.toFixed(1)}" x2="${(FX2-3).toFixed(1)}" y2="${REBAR_Y_LINE.toFixed(1)}" stroke="#880000" stroke-width="2.3"/>
${dots}
${rebarLabels}
${dim_width}
${dim_t}
${dim_cov}
<text x="${(panelW/2).toFixed(1)}" y="${(panelH-3).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="bold" fill="${secColor}" font-family="Arial">${secLabel}</text>`;
  };

  // ── Table zone SVG (right panel, narrow) ────────────────────────────────
  const buildTableZone = (ft: FType, typeResults: FootingDesignResult[]): string => {
    let out = '';
    let cy = WK_Y + 4;
    const x = TZ_X, w = TZ_W, pad = 4, lh = 14;

    const hdr = (title: string, bg = '#1a3a5c'): string => {
      const h2 = `<rect x="${x}" y="${cy}" width="${w}" height="14" fill="${bg}" rx="2"/>
<text x="${x+w/2}" y="${cy+10}" text-anchor="middle" font-size="7.5" font-weight="bold" fill="#fff" font-family="Arial">${title}</text>`;
      cy += 16;
      return h2;
    };
    const row = (label: string, value: string, even: boolean, lFill = '#1a3a5c', vFill = '#111'): string => {
      const r = `<rect x="${x}" y="${cy}" width="${w}" height="${lh-1}" fill="${even ? '#eef3fa' : '#fff'}"/>
<text x="${x+pad}" y="${cy+9}" font-size="7" fill="${lFill}" font-family="Arial">${label}</text>
<text x="${x+w-pad}" y="${cy+9}" text-anchor="end" font-size="7" fill="${vFill}" font-weight="bold" font-family="Arial">${value}</text>`;
      cy += lh - 1;
      return r;
    };
    const frame = (startY: number): string => {
      const f = `<rect x="${x}" y="${startY}" width="${w}" height="${cy-startY}" fill="none" stroke="#1a3a5c" stroke-width="0.7" rx="2"/>`;
      cy += 5;
      return f;
    };

    // Material properties
    out += hdr('خصائص المواد');
    const matStart = cy;
    out += row("f'c (MPa)", String(mat.fc), true);
    out += row("fy  (MPa)", String(mat.fy), false);
    out += row("qa (kN/m²)", String(mat.qa), true);
    out += row("Df (m)", String(mat.Df), false);
    out += row("غطاء (mm)", String(mat.cover), true);
    out += row("fc,all (MPa)", (0.45*mat.fc).toFixed(1), false);
    out += row("fs,all (MPa)", Math.min(0.5*mat.fy,207).toFixed(0), true);
    out += frame(matStart);

    // Footing schedule
    out += hdr('جدول القواعد');
    const schStart = cy;
    out += row('النوع', ft.key, true, '#555', '#1a3a5c');
    out += row('B (mm)', String(ft.B), false, '#555', '#880000');
    out += row('L (mm)', String(ft.L), true, '#555', '#880000');
    out += row('t (mm)', String(ft.t), false, '#555', '#880000');
    out += row('t_min,ACI', String(ft.t_min_aci)+' mm', true, '#555', '#1a3a5c');
    out += row('حديد B', `${ft.bars_x}Ø${ft.dia_x}@${ft.spacing_x}`, false, '#555', '#880000');
    out += row('حديد L', `${ft.bars_y}Ø${ft.dia_y}@${ft.spacing_y}`, true, '#555', '#880000');
    out += frame(schStart);

    // Column results
    out += hdr('نتائج الأعمدة', '#2c5e8a');
    const cw1 = Math.round(w*0.25), cw2 = Math.round(w*0.22);
    const cw3 = Math.round(w*0.25), cw4 = w - cw1 - cw2 - cw3;
    const resStart = cy;
    let hx = x;
    for (const [lbl, cw] of [['عمود',cw1],['P kN',cw2],['B×L',cw3],['✓',cw4]] as [string,number][]) {
      out += `<rect x="${hx}" y="${cy}" width="${cw}" height="12" fill="#2c5e8a"/>
<text x="${hx+cw/2}" y="${cy+9}" text-anchor="middle" font-size="6" fill="#fff" font-family="Arial">${lbl}</text>`;
      hx += cw;
    }
    cy += 12;
    for (let ri = 0; ri < typeResults.length; ri++) {
      const r = typeResults[ri];
      const ok = r.adequate;
      out += `<rect x="${x}" y="${cy}" width="${w}" height="12" fill="${ri%2===0 ? (ok?'#f4f7fb':'#fff5f5') : '#fff'}"/>`;
      hx = x;
      for (const [val, cw] of [
        [r.colId,cw1],[r.P_service.toFixed(0),cw2],
        [`${r.B}×${r.L}`,cw3],[ok?'✓':'✗',cw4],
      ] as [string,number][]) {
        out += `<text x="${hx+cw/2}" y="${cy+9}" text-anchor="middle" font-size="6.5" fill="${ok?'#111':'#c00'}" font-family="Arial">${val}</text>`;
        hx += cw;
      }
      cy += 12;
    }
    out += frame(resStart);

    // Notes
    if (cy + 40 < WK_Y + WK_H) {
      out += hdr('ملاحظات');
      const notes = [
        `طبقة نظافة 50mm`,
        `غطاء ≥ ${mat.cover}mm (ACI)`,
        `Df = ${mat.Df} m`,
        `الأبعاد بالمليمتر`,
      ];
      for (const n of notes) {
        if (cy + 12 > WK_Y + WK_H) break;
        out += `<text x="${x+pad+4}" y="${cy+9}" font-size="6.5" fill="#333" font-family="Arial">• ${n}</text>`;
        cy += 12;
      }
    }
    return out;
  };

  // ── Title block (bottom-right corner, ISO 7200 style matching other sheets)
  const buildTitleBlock = (ft: FType, plateIndex: number, totalPlates: number, drawingNo: string): string => {
    const x = TB_X, y = TB_Y, w = TB_W, h = TB_H;
    const COL1 = 225, COL2 = 165, COL3 = 100, COL4 = w - COL1 - COL2 - COL3;
    const cx1 = x+COL1/2, cx2 = x+COL1+COL2/2;
    const cx3 = x+COL1+COL2+COL3/2, cx4 = x+COL1+COL2+COL3+COL4/2;
    const d1 = x+COL1, d2 = x+COL1+COL2, d3 = x+COL1+COL2+COL3;
    const hrS1 = y+Math.round(h*0.35), hrS2 = y+Math.round(h*0.67);
    const hrD  = y+Math.round(h*0.52), hrT  = y+Math.round(h*0.52);
    const fs = 7.5, fsS = 6.5;
    const fld = (fx: number, fy: number, lbl: string, val: string, anc = 'start') =>
      `<text x="${fx}" y="${fy}" font-size="${fsS}" fill="#555" text-anchor="${anc}" font-family="Arial">${lbl}</text>
<text x="${fx}" y="${fy+11}" font-size="${fs}" fill="#111" font-weight="bold" text-anchor="${anc}" font-family="Arial">${val}</text>`;

    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#1a3a5c" stroke-width="1.5"/>
<rect x="${x}" y="${y}" width="${COL1}" height="15" fill="#1a3a5c"/>
<rect x="${d1}" y="${y}" width="${COL2}" height="15" fill="#1a3a5c"/>
<rect x="${d2}" y="${y}" width="${COL3}" height="15" fill="#2c5e8a"/>
<rect x="${d3}" y="${y}" width="${COL4}" height="15" fill="#2c5e8a"/>
<line x1="${d1}" y1="${y}" x2="${d1}" y2="${y+h}" stroke="#1a3a5c" stroke-width="1"/>
<line x1="${d2}" y1="${y}" x2="${d2}" y2="${y+h}" stroke="#1a3a5c" stroke-width="1"/>
<line x1="${d3}" y1="${y}" x2="${d3}" y2="${y+h}" stroke="#1a3a5c" stroke-width="1"/>
<line x1="${d2}" y1="${hrS1}" x2="${d3}" y2="${hrS1}" stroke="#1a3a5c" stroke-width="0.7"/>
<line x1="${d2}" y1="${hrS2}" x2="${d3}" y2="${hrS2}" stroke="#1a3a5c" stroke-width="0.7"/>
<line x1="${d3}" y1="${hrD}" x2="${x+w}" y2="${hrD}" stroke="#1a3a5c" stroke-width="0.7"/>
<line x1="${d1}" y1="${hrT}" x2="${d2}" y2="${hrT}" stroke="#1a3a5c" stroke-width="0.7"/>
<text x="${cx1}" y="${y+11}" font-size="8" font-weight="bold" fill="#fff" text-anchor="middle" font-family="Arial">${titleBlock.firmName ?? 'مكتب استشارات هندسية'}</text>
${fld(x+4, y+22, 'المشروع:', proj)}
${fld(x+4, y+48, 'الموقع:', '—')}
${fld(x+4, y+74, 'العميل:', '—')}
<text x="${cx2}" y="${y+11}" font-size="8" font-weight="bold" fill="#fff" text-anchor="middle" font-family="Arial">لوحة أساسات — Foundation</text>
<text x="${cx2}" y="${y+30}" font-size="7.5" font-weight="bold" fill="#1a3a5c" text-anchor="middle" font-family="Arial">نوع ${ft.key}: ${ft.B}×${ft.L}×${ft.t} mm</text>
<text x="${cx2}" y="${y+44}" font-size="6.5" fill="#555" text-anchor="middle" font-family="Arial">WSM/ASD — ACI 318 | f'c=${mat.fc} fy=${mat.fy} MPa</text>
${fld(d1+4, hrT+7, 'الأعمدة:', ft.ids.join(' · '))}
<text x="${cx3}" y="${y+11}" font-size="7.5" font-weight="bold" fill="#fff" text-anchor="middle" font-family="Arial">التوقيعات</text>
<text x="${d2+4}" y="${y+25}" font-size="${fsS}" fill="#777" font-family="Arial">صمّمه:</text>
<text x="${cx3}" y="${y+36}" font-size="${fs}" fill="#111" text-anchor="middle" font-family="Arial">${titleBlock.designedBy ?? '—'}</text>
<text x="${d2+4}" y="${hrS1+10}" font-size="${fsS}" fill="#777" font-family="Arial">راجعه:</text>
<text x="${cx3}" y="${hrS1+22}" font-size="${fs}" fill="#111" text-anchor="middle" font-family="Arial">${titleBlock.checkedBy ?? '—'}</text>
<text x="${d2+4}" y="${hrS2+10}" font-size="${fsS}" fill="#777" font-family="Arial">التاريخ:</text>
<text x="${cx3}" y="${hrS2+22}" font-size="${fs}" fill="#111" text-anchor="middle" font-family="Arial">${today}</text>
<text x="${cx4}" y="${y+11}" font-size="7.5" font-weight="bold" fill="#fff" text-anchor="middle" font-family="Arial">رقم اللوحة</text>
<text x="${cx4}" y="${y+40}" font-size="14" font-weight="bold" fill="#1a3a5c" text-anchor="middle" font-family="Arial">${drawingNo}</text>
<text x="${cx4}" y="${hrD+14}" font-size="${fsS}" fill="#777" text-anchor="middle" font-family="Arial">المقياس / Scale</text>
<text x="${cx4}" y="${hrD+26}" font-size="9" font-weight="bold" fill="#111" text-anchor="middle" font-family="Arial">N.T.S.</text>
<text x="${cx4}" y="${hrD+40}" font-size="${fsS}" fill="#777" text-anchor="middle" font-family="Arial">صفحة ${plateIndex}/${totalPlates}</text>`;
  };

  // ── Build one complete plate SVG ─────────────────────────────────────────
  const buildPlate = (ft: FType, plateIndex: number, totalPlates: number): string => {
    const typeResults = results.filter(r => colToType.get(r.colId) === ft.key);
    if (typeResults.length === 0) return '';

    const drawingNo = `${titleBlock.drawingNumber ?? 'F'}-${String(plateIndex).padStart(2,'0')}`;
    const uid = 'p' + ft.key.replace(/\W/g,'_') + plateIndex;

    const planSVG       = buildPlanSVG(ft, typeResults, DZ_W, PLAN_H);
    const secAContent   = buildSectionPanel(ft.rep, 'A', SEC_W, SEC_H, uid);
    const secBContent   = buildSectionPanel(ft.rep, 'B', SEC_W, SEC_H, uid);
    const tableSVG      = buildTableZone(ft, typeResults);
    const titleBlockSVG = buildTitleBlock(ft, plateIndex, totalPlates, drawingNo);

    const outerBorder = `<rect x="${MARGIN}" y="${MARGIN}" width="${SW-2*MARGIN}" height="${SH-2*MARGIN}" fill="none" stroke="#1a3a5c" stroke-width="2"/>`;
    const innerBorder = `<rect x="${FRAME}" y="${MARGIN}" width="${SW-FRAME-MARGIN}" height="${SH-2*MARGIN}" fill="none" stroke="#1a3a5c" stroke-width="0.8"/>`;
    const vertSep     = `<line x1="${TZ_X-2}" y1="${WK_Y}" x2="${TZ_X-2}" y2="${WK_Y+WK_H}" stroke="#1a3a5c" stroke-width="1"/>`;
    const secSepLine  = `<line x1="${WK_X+SEC_W}" y1="${sec_hdrY}" x2="${WK_X+SEC_W}" y2="${WK_Y+WK_H}" stroke="#1a3a5c" stroke-width="0.8" stroke-dasharray="4,2"/>`;
    const tbSepLine   = `<line x1="${TB_X}" y1="${TB_Y}" x2="${SW-MARGIN}" y2="${TB_Y}" stroke="#1a3a5c" stroke-width="1.5"/>`;

    const planHdr = `<rect x="${WK_X}" y="${WK_Y}" width="${DZ_W}" height="${HDR_H}" fill="#1a3a5c"/>
<text x="${WK_X+DZ_W/2}" y="${WK_Y+10}" text-anchor="middle" font-size="8" font-weight="bold" fill="#fff" font-family="Arial">مسقط الأساسات — ${ft.key}  (${typeResults.length} قاعدة)  ·  ${ft.B}×${ft.L}×${ft.t} mm</text>`;

    const secHdr = `<rect x="${WK_X}" y="${sec_hdrY}" width="${DZ_W}" height="${HDR_H}" fill="#2c5e8a"/>
<text x="${(WK_X+SEC_W/2).toFixed(1)}" y="${sec_hdrY+10}" text-anchor="middle" font-size="7.5" font-weight="bold" fill="#fff" font-family="Arial">قطاع أ—أ  (Section A-A)</text>
<text x="${(WK_X+SEC_W+SEC_W/2).toFixed(1)}" y="${sec_hdrY+10}" text-anchor="middle" font-size="7.5" font-weight="bold" fill="#fff" font-family="Arial">قطاع ب—ب  (Section B-B)</text>`;

    const pageBreak = plateIndex < totalPlates ? 'page-break-after: always;' : '';

    return `<div class="plate" style="${pageBreak}">
<svg width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}"
  xmlns="http://www.w3.org/2000/svg"
  style="display:block;width:100%;height:auto;background:#fff">
  ${outerBorder}
  ${innerBorder}
  ${planHdr}
  <g transform="translate(${WK_X},${planY})">${planSVG}</g>
  ${secHdr}
  <svg x="${WK_X}" y="${secY}" width="${SEC_W}" height="${SEC_H}">
    ${secAContent}
  </svg>
  <svg x="${WK_X+SEC_W}" y="${secY}" width="${SEC_W}" height="${SEC_H}">
    ${secBContent}
  </svg>
  ${vertSep}
  ${secSepLine}
  ${tableSVG}
  ${tbSepLine}
  ${titleBlockSVG}
</svg>
</div>`;
  };

  const types = [...typeMap.values()];
  const platesHTML = types.map((ft, i) => buildPlate(ft, i+1, types.length)).join('\n');

  return `<!DOCTYPE html>
<html lang="ar">
<head>
<meta charset="UTF-8"/>
<title>لوحات الأساسات — ${proj}</title>
<style>
  @page { size: ${paperSize} landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial,sans-serif; background: #e8eaf0; padding: 8px; }
  .plate { background:#fff; box-shadow:0 2px 12px rgba(0,0,0,0.18); margin-bottom:24px; display:inline-block; width:100%; }
  .plate svg { display:block; width:100%; height:auto; }
  @media print {
    body { background:#fff; padding:0; }
    .plate { box-shadow:none; margin:0; page-break-inside:avoid; }
  }
</style>
</head>
<body>
${platesHTML}
</body>
</html>`;
}

