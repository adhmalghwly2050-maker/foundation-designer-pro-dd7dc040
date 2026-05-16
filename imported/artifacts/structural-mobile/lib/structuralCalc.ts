// Structural calculation utilities for mobile app
// Based on ACI 318 simplified design methods

export interface BeamDesignResult {
  Mu: number; // kN.m
  Vu: number; // kN
  As_req: number; // cm²
  Av_req: number; // cm²/m
  maxDef: number; // mm
  status: "safe" | "warning" | "danger";
  utilization: number; // 0-1
  momentCapacity: number; // kN.m
  shearCapacity: number; // kN
  minAs: number; // cm²
  maxAs: number; // cm²
  messages: string[];
}

export interface ColumnDesignResult {
  Pu: number; // kN
  Mux: number; // kN.m
  Muy: number; // kN.m
  As_req: number; // cm²
  status: "safe" | "warning" | "danger";
  utilization: number;
  axialCapacity: number; // kN
  messages: string[];
  eccentricityX: number; // m
  eccentricityY: number; // m
  rho: number; // reinforcement ratio %
}

export function designBeam(
  b: number, // cm
  d_total: number, // cm
  L: number, // m
  wd: number, // kN/m dead
  wl: number, // kN/m live
  fc: number, // MPa
  fy: number  // MPa
): BeamDesignResult {
  const messages: string[] = [];
  const d = d_total - 6; // effective depth (cm)
  const wu = 1.2 * wd + 1.6 * wl;
  const Mu = (wu * L * L) / 8; // kN.m
  const Vu = (wu * L) / 2; // kN

  // Moment capacity
  const phi_f = 0.9;
  const phi_v = 0.75;
  const beta1 = fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * ((fc - 28) / 7));

  // Required As (quadratic from Mu = phi*As*fy*(d - As*fy/(1.7*fc*b)))
  // Simplified: As = Mu*1e6/(phi*fy*(d*10 - ...)) iterative
  const Mu_Nmm = Mu * 1e6;
  const b_mm = b * 10;
  const d_mm = d * 10;

  // Rho from Mu/(phi*fc*b*d^2) = Rn
  const Rn = Mu_Nmm / (phi_f * b_mm * d_mm * d_mm);
  const rho = (0.85 * fc / fy) * (1 - Math.sqrt(1 - 2 * Rn / (0.85 * fc)));
  const As_req = Math.max(rho * b_mm * d_mm / 100, 0); // cm²

  const rho_min = Math.max(0.25 * Math.sqrt(fc) / fy, 1.4 / fy);
  const rho_max = 0.75 * 0.85 * beta1 * fc / fy * (600 / (600 + fy));
  const minAs = rho_min * b_mm * d_mm / 100;
  const maxAs = rho_max * b_mm * d_mm / 100;

  if (As_req < minAs) messages.push("As < As_min → use As_min");
  if (As_req > maxAs) messages.push("⚠️ Section too small, increase depth");

  // Shear
  const Vc = (0.17 * Math.sqrt(fc) * b_mm * d_mm) / 1000; // kN
  const phi_Vc = phi_v * Vc;
  let Av_req = 0;
  if (Vu > phi_Vc) {
    const Vs_req = Vu / phi_v - Vc;
    // Av/s = Vs/(fy*d) assuming s=200mm
    Av_req = (Vs_req * 1000 * 1000) / (fy * d_mm) / 10; // cm²/m
  }

  const phiMn = phi_f * Math.max(As_req, minAs) * 100 * fy * (d_mm - (Math.max(As_req, minAs) * 100 * fy) / (1.7 * fc * b_mm)) / 1e6;
  const phiVn = phi_v * (Vc + (Av_req > 0 ? Vu / phi_v - Vc : 0));
  const momentCapacity = phiMn;
  const shearCapacity = phiVn;

  // Deflection (simplified)
  const Ie = b_mm * Math.pow(d_total * 10, 3) / 12;
  const Ec = 4700 * Math.sqrt(fc);
  const maxDef = (5 * wu * Math.pow(L * 1000, 4)) / (384 * Ec * Ie) * 1e-6; // mm

  const utilMoment = Mu / momentCapacity;
  const utilShear = Vu / shearCapacity;
  const utilization = Math.max(utilMoment, utilShear);

  let status: "safe" | "warning" | "danger" = "safe";
  if (utilization > 1.0) {
    status = "danger";
    messages.push("❌ Section overstressed");
  } else if (utilization > 0.85) {
    status = "warning";
    messages.push("⚠️ High utilization ratio");
  } else {
    messages.push("✓ Section adequate");
  }

  if (maxDef > L * 1000 / 240) messages.push(`⚠️ Deflection ${maxDef.toFixed(1)}mm exceeds L/240`);

  return {
    Mu, Vu, As_req: Math.max(As_req, minAs), Av_req,
    maxDef, status, utilization,
    momentCapacity, shearCapacity, minAs, maxAs, messages,
  };
}

export function designColumn(
  b: number, // cm
  h: number, // cm
  H: number, // m height
  Pu: number, // kN
  Mux: number, // kN.m
  Muy: number, // kN.m
  fc: number, // MPa
  fy: number, // MPa
): ColumnDesignResult {
  const messages: string[] = [];
  const Ag = b * h; // cm²
  const phi = 0.65;

  // Pure axial capacity
  const rho_min = 0.01;
  const rho_max = 0.08;

  // Eccentricity
  const ex = Mux / Math.max(Pu, 0.001); // m
  const ey = Muy / Math.max(Pu, 0.001); // m

  // Required As for axial only (ACI simplified)
  // Pu = phi*(0.85*fc*(Ag - As) + fy*As)
  const As_axial = Math.max(
    (Pu * 1000 / phi - 0.85 * fc * Ag * 100) / ((fy - 0.85 * fc) * 100),
    rho_min * Ag
  );

  // Moment amplification for slenderness (simplified)
  const kL_r = (1.0 * H * 100) / (0.3 * Math.min(b, h));
  if (kL_r > 22) messages.push(`⚠️ Slender column (kL/r=${kL_r.toFixed(0)}), check buckling`);

  // Combined P-M interaction (simplified Bresler)
  const Pn0 = (0.85 * fc * (Ag * 100 - As_axial * 100) + fy * As_axial * 100) / 1000; // kN
  const phiPn = phi * Pn0;

  const Mnx = Pn0 * (h / 100) / 6; // rough estimate
  const Mny = Pn0 * (b / 100) / 6;

  const ratio = Pu / phiPn + Mux / (phi * Mnx) + Muy / (phi * Mny);
  const utilization = ratio;

  let status: "safe" | "warning" | "danger" = "safe";
  if (utilization > 1.0) {
    status = "danger";
    messages.push("❌ Column overstressed");
  } else if (utilization > 0.85) {
    status = "warning";
    messages.push("⚠️ High utilization");
  } else {
    messages.push("✓ Column adequate");
  }

  const rho = (As_axial / Ag) * 100;
  if (rho < 1) messages.push("As < 1% → use minimum reinforcement");
  if (rho > 8) messages.push("⚠️ As > 8%, increase section size");

  return {
    Pu, Mux, Muy,
    As_req: Math.max(As_axial, rho_min * Ag),
    status, utilization,
    axialCapacity: phiPn,
    messages,
    eccentricityX: ex,
    eccentricityY: ey,
    rho: Math.min(Math.max(rho, 1), 8),
  };
}
