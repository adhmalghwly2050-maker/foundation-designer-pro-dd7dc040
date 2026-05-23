/**
 * Global Frame / Unified Core Bridge — UNIFIED ENGINE FACADE
 * ─────────────────────────────────────────────────────────────────
 * بناءً على طلب المستخدم، تم دمج المحركات الثلاثة (Legacy 3D + Global Frame
 * + Unified Core) في محرك ثلاثي الأبعاد موحّد واحد بناءً على `legacy_3d`،
 * لأن مبدأ التحليل (Direct Stiffness 3D، 6 DOF/node) واحد في الجميع.
 *
 * المحرك الموحّد يجمع أفضل ما في الثلاثة:
 *   • Static condensation حقيقي للنهايات المحررة (R3) — Schur complement
 *     في مصفوفة صلابة العنصر، مع تكثيف Fixed-End Forces المقابلة.
 *   • P-Delta geometric stiffness تكراري (ACI 318-19 §6.6.4).
 *   • استمرارية الجسور تلقائياً عبر Direct Stiffness Assembly في
 *     مصفوفة الصلابة العامة (الجسور المتجاورة تتشارك العقد).
 *   • معالجة beam-on-beam (تقسيم الجسر الحامل + مفصل عند نقطة الحمل).
 *   • معالجة وجه العمود لاستخراج العزوم من `beamMomentPostprocess`.
 *
 * هذا الملف يبقي الدوال القديمة كـ aliases للتوافق الخلفي مع أي مكوّن
 * أو نداء مازال يستوردها (مثلاً `advancedFrameAnalysis`).
 */

import type {
  Beam,
  Column,
  Frame,
  FrameResult,
  MatProps,
  BeamOnBeamConnection,
  Slab,
  SlabProps,
} from '@/lib/structuralEngine';
import { getFrameResults3D } from '@/lib/analyze3DColumns';

type EndReleaseMap = Record<string, {
  nodeI: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
  nodeJ: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
}>;

/**
 * Alias موحّد — يمرّ مباشرة إلى محرك Legacy 3D المدمج.
 * الاحتفاظ بالاسم القديم للتوافق الخلفي.
 */
export function getFrameResultsGlobalFrame(
  frames: Frame[],
  beams: Beam[],
  columns: Column[],
  mat: MatProps,
  frameEndReleases?: EndReleaseMap,
  beamOnBeamConnections?: BeamOnBeamConnection[],
  slabs?: Slab[],
  slabProps?: SlabProps,
  beamStiffnessFactor = 0.35,
  colStiffnessFactor = 0.70,
  colRigidEndOffsets?: Record<string, boolean>,
): FrameResult[] {
  return getFrameResults3D(
    frames,
    beams,
    columns,
    mat,
    frameEndReleases,
    beamOnBeamConnections,
    slabs,
    slabProps,
    false, // useFEMLoadDistribution
    beamStiffnessFactor,
    colStiffnessFactor,
    false, // enforceReleasedZeros
    colRigidEndOffsets,
  );
}

/**
 * Alias موحّد — يمرّر مباشرة إلى محرك Legacy 3D المدمج.
 */
export function getFrameResultsUnifiedCore(
  frames: Frame[],
  beams: Beam[],
  columns: Column[],
  mat: MatProps,
  frameEndReleases?: EndReleaseMap,
  beamOnBeamConnections?: BeamOnBeamConnection[],
  slabs?: Slab[],
  slabProps?: SlabProps,
  beamStiffnessFactor = 0.35,
  colStiffnessFactor = 0.70,
  colRigidEndOffsets?: Record<string, boolean>,
): FrameResult[] {
  return getFrameResults3D(
    frames,
    beams,
    columns,
    mat,
    frameEndReleases,
    beamOnBeamConnections,
    slabs,
    slabProps,
    false,
    beamStiffnessFactor,
    colStiffnessFactor,
    false,
    colRigidEndOffsets,
  );
}
