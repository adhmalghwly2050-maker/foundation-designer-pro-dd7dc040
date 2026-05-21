/**
 * Analysis Web Worker
 * ════════════════════════════════════════════════════════
 * Runs ALL structural analysis computations off the UI thread.
 * The main thread stays fully responsive during long solves.
 *
 * Message protocol:
 *   IN:  START_ANALYSIS | CANCEL_ANALYSIS
 *   OUT: PROGRESS_UPDATE | FINAL_RESULT | ERROR | CANCELLED
 */

import type { WorkerInput, WorkerOutput, AnalysisInput, WorkerDiagnostics } from './workerTypes';
import type { FrameResult, BeamOnBeamConnection } from '@/lib/structuralEngine';
import { getFrameResults3D } from '@/lib/analyze3DColumns';
import { analyzeFrame, analyzeWithBeamOnBeam } from '@/lib/structuralEngine';
import { getConnectedSlabResults } from '@/slabFEMEngine';
import { adaptFEMResults } from '@/lib/analysisController';

// ── Cancellation flag ────────────────────────────────────────────────────────
let _cancelled = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

function send(msg: WorkerOutput): void {
  (self as unknown as Worker).postMessage(msg);
}

function progress(pct: number, step: string): void {
  send({ type: 'PROGRESS_UPDATE', progress: pct, step });
}

/** Yield to allow the browser/OS scheduler to breathe between stages. */
function yield_(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function checkCancelled(): Promise<boolean> {
  if (_cancelled) {
    send({ type: 'CANCELLED' });
    return true;
  }
  return false;
}

// ── Main analysis routine ────────────────────────────────────────────────────

async function runAnalysis(input: AnalysisInput): Promise<void> {
  _cancelled = false;
  const t0 = performance.now();
  const warnings: string[] = [];

  const {
    frames, beamsWithLoads, columns, mat, slabs, slabProps,
    selectedEngine, ignoreSlab, effectiveFrameEndReleases,
    beamStiffnessFactor, colStiffnessFactor,
    detectedConnections, removedColumnIds,
    beamHinges2D: beamHinges2DArr,
  } = input;

  // Reconstruct Map from serialised array
  const beamHinges2D = new Map<string, 'I' | 'J' | 'BOTH'>(beamHinges2DArr);
  const bMap = new Map(beamsWithLoads.map(b => [b.id, b]));

  // ── Stage 1: initialise ────────────────────────────────────────────────────
  progress(5, 'مرحلة 1: تجهيز النموذج الإنشائي...');
  await yield_();
  if (await checkCancelled()) return;

  // ── Stage 2: geometry / DOF ────────────────────────────────────────────────
  progress(15, 'مرحلة 2: تحليل الهندسة وتوليد درجات الحرية (DOF)...');
  await yield_();
  if (await checkCancelled()) return;

  let frameResults: FrameResult[];
  let bobConnections: BeamOnBeamConnection[];
  let engineUsed = selectedEngine;

  try {
    // ════════════════════════════════════════════════════════════════════════
    // PATH A — FEM Coupled (Shell + Frame)
    // ════════════════════════════════════════════════════════════════════════
    if (selectedEngine === 'fem_coupled' && !ignoreSlab) {
      if (slabs.length === 0) {
        send({ type: 'ERROR', message: 'يتطلب محرك FEM وجود بلاطات معرّفة في النموذج' });
        return;
      }
      if (columns.length === 0) {
        send({ type: 'ERROR', message: 'يتطلب محرك FEM وجود أعمدة (ركائز) في النموذج' });
        return;
      }

      progress(30, 'مرحلة 3: محرك FEM — تجميع عناصر الغلاف (Shell Elements)...');
      await yield_();
      if (await checkCancelled()) return;

      progress(45, 'مرحلة 4: تجميع مصفوفة الصلابة الكلية (Shell + Frame)...');
      await yield_();
      if (await checkCancelled()) return;

      const femModel = { slabs, beams: beamsWithLoads, columns, slabProps, mat, meshDensity: 2 };
      const coupledResults = getConnectedSlabResults(femModel, 2);

      if (_cancelled) { send({ type: 'CANCELLED' }); return; }

      if (coupledResults.length === 0) {
        send({ type: 'ERROR', message: 'لم يُنتج محرك FEM نتائج — تحقق من إعدادات النموذج' });
        return;
      }

      progress(65, 'مرحلة 5: حل منظومة KU=F وتحويل نتائج FEM...');
      await yield_();
      if (await checkCancelled()) return;

      let femFrameResults = adaptFEMResults(coupledResults, beamsWithLoads, frames);

      // Hybrid: FEM for clean frames, 3D for beam-on-beam frames
      if (detectedConnections.length > 0) {
        const secSet = new Set(detectedConnections.flatMap(c => c.secondaryBeamIds));
        const hasBobFrame = frames.some(f => f.beamIds.some(bid => secSet.has(bid)));
        if (hasBobFrame) {
          progress(75, 'مرحلة 5b: تحليل إطارات beam-on-beam بمحرك 3D...');
          await yield_();
          const results3D = getFrameResults3D(
            frames, beamsWithLoads, columns, mat,
            effectiveFrameEndReleases, detectedConnections,
            slabs, slabProps, false,
            beamStiffnessFactor, colStiffnessFactor,
          );
          femFrameResults = femFrameResults.map((femRes, idx) => {
            const frame = frames[idx];
            if (!frame) return femRes;
            return frame.beamIds.some(bid => secSet.has(bid))
              ? (results3D[idx] ?? femRes)
              : femRes;
          });
        }
      }

      frameResults = femFrameResults;
      bobConnections = [];
      engineUsed = 'fem_coupled';

    // ════════════════════════════════════════════════════════════════════════
    // PATH B — Legacy 2D (Matrix Stiffness Method)
    // ════════════════════════════════════════════════════════════════════════
    } else if (selectedEngine === 'legacy_2d') {
      progress(28, 'مرحلة 3: محرك 2D — تجميع مصفوفة الصلابة الكلية...');
      await yield_();
      if (await checkCancelled()) return;

      progress(50, 'مرحلة 4: تحليل الإطارات (طريقة صلابة المصفوفة)...');
      await yield_();
      if (await checkCancelled()) return;

      if (removedColumnIds.length > 0 && detectedConnections.length > 0) {
        progress(65, 'مرحلة 5: تحليل beam-on-beam (تكراري)...');
        await yield_();
        const result = analyzeWithBeamOnBeam(
          frames, bMap, columns, mat, removedColumnIds,
          detectedConnections, 10, 0.01, beamHinges2D,
          beamStiffnessFactor, colStiffnessFactor,
        );
        frameResults = result.frameResults;
        bobConnections = result.connections;
        if (!result.converged) {
          warnings.push(`Beam-on-Beam 2D: لم يتقارب بعد ${result.iterations} تكرارات`);
        }
      } else {
        progress(65, 'مرحلة 5: حل منظومة المعادلات...');
        frameResults = frames.map(f =>
          analyzeFrame(f, bMap, columns, mat, removedColumnIds, undefined,
            beamHinges2D, undefined, beamStiffnessFactor, colStiffnessFactor),
        );
        bobConnections = [];
      }
      engineUsed = 'legacy_2d';

    // ════════════════════════════════════════════════════════════════════════
    // PATH C — 3D Direct Stiffness (default for all other modes)
    // ════════════════════════════════════════════════════════════════════════
    } else {
      progress(25, 'مرحلة 3: محرك 3D — بناء نموذج الإطار الكلي ثلاثي الأبعاد...');
      await yield_();
      if (await checkCancelled()) return;

      progress(40, 'مرحلة 4: تجميع مصفوفة الصلابة 3D (طريقة الصلابة المباشرة)...');
      await yield_();
      if (await checkCancelled()) return;

      progress(58, 'مرحلة 5: حل منظومة KU=F (Cholesky / PCG)...');
      await yield_();
      if (await checkCancelled()) return;

      try {
        frameResults = getFrameResults3D(
          frames, beamsWithLoads, columns, mat,
          effectiveFrameEndReleases, [],
          slabs, slabProps, false,
          beamStiffnessFactor, colStiffnessFactor,
        );
        bobConnections = [];
        engineUsed = selectedEngine;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
        warnings.push(`فشل محرك 3D، التراجع إلى محرك 2D: ${msg}`);
        frameResults = frames.map(f =>
          analyzeFrame(f, bMap, columns, mat, removedColumnIds, undefined,
            beamHinges2D, undefined, beamStiffnessFactor, colStiffnessFactor),
        );
        bobConnections = [];
        engineUsed = 'fallback_2d';
      }
    }

  } catch (err) {
    send({
      type: 'ERROR',
      message: err instanceof Error ? err.message : 'خطأ غير متوقع في التحليل الإنشائي',
    });
    return;
  }

  if (await checkCancelled()) return;

  // ── Stage 6 & 7: post-processing ─────────────────────────────────────────
  progress(88, 'مرحلة 6: استخراج العزوم والقوى والانحرافات...');
  await yield_();

  progress(95, 'مرحلة 7: التحقق من نتائج التصميم وفق ACI 318-19...');
  await yield_();

  const solveTimeMs = Math.round(performance.now() - t0);
  const memRaw = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  const memoryMB = memRaw?.usedJSHeapSize
    ? Math.round(memRaw.usedJSHeapSize / 1_048_576)
    : 0;

  const diagnostics: WorkerDiagnostics = {
    solveTimeMs,
    totalDOF: frames.reduce((s, f) => s + f.beamIds.length * 12, 0),
    elementCount: beamsWithLoads.length + columns.filter(c => !c.isRemoved).length,
    engineUsed,
    memoryMB,
    warnings,
  };

  send({ type: 'FINAL_RESULT', frameResults, bobConnections, diagnostics });
}

// ── Message router ───────────────────────────────────────────────────────────

(self as unknown as Worker).onmessage = (e: MessageEvent<WorkerInput>) => {
  const msg = e.data;
  if (msg.type === 'START_ANALYSIS') {
    runAnalysis(msg.payload);
  } else if (msg.type === 'CANCEL_ANALYSIS') {
    _cancelled = true;
  }
};
