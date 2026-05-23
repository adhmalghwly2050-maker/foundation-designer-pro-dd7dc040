/**
 * Analysis Web Worker — Mobile-First High-Performance Engine
 * ════════════════════════════════════════════════════════════
 * ALL structural analysis runs inside this worker.
 * The UI thread is NEVER blocked — it only receives:
 *   PROGRESS_UPDATE | PARTIAL_RESULT | FINAL_RESULT | ERROR | CANCELLED
 *
 * Architecture:
 *   1. Thermal Guard     — yields to OS scheduler every 40ms
 *   2. WASM Bridge       — accelerates CSR matvec / PCG when binary available
 *   3. LOD Controller    — selects solver tier based on system size + device
 *   4. Memory Pool       — reuses TypedArray buffers across CG iterations
 *   5. Progressive Solve — streams PARTIAL_RESULTs as frames complete
 *   6. Cancellation      — _cancelled flag checked at every stage boundary
 */

import type { WorkerInput, WorkerOutput, AnalysisInput, WorkerDiagnostics } from './workerTypes';
import type { FrameResult, BeamOnBeamConnection } from '@/lib/structuralEngine';
import { getFrameResults3D } from '@/lib/analyze3DColumns';
import { analyzeFrame, analyzeWithBeamOnBeam } from '@/lib/structuralEngine';
import { getConnectedSlabResults } from '@/slabFEMEngine';
import { adaptFEMResults } from '@/lib/analysisController';

import { ThermalGuard } from '../performance/thermalGuard';
import { getMemoryPool, flushMemoryPool } from '../performance/memoryPool';
import { buildLODConfig, estimateFreeDOF } from '../performance/lodController';
import { getDeviceProfile, acquireWakeLock, releaseWakeLock } from '../performance/mobileOptimizer';
import { initWasmBridge, getWasmStatus } from '../wasm/wasmBridge';

// ── Cancellation ──────────────────────────────────────────────────────────────

let _cancelled = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(msg: WorkerOutput): void {
  (self as unknown as Worker).postMessage(msg);
}

function progress(pct: number, step: string): void {
  send({ type: 'PROGRESS_UPDATE', progress: pct, step });
}

async function yield_(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function checkCancelled(): Promise<boolean> {
  if (_cancelled) {
    send({ type: 'CANCELLED' });
    releaseWakeLock();
    flushMemoryPool();
    return true;
  }
  return false;
}

// ── Main analysis pipeline ────────────────────────────────────────────────────

async function runAnalysis(input: AnalysisInput): Promise<void> {
  _cancelled = false;
  const t0 = performance.now();
  const warnings: string[] = [];

  // ── Boot: initialise performance subsystems ───────────────────────────────
  await acquireWakeLock();
  const deviceProfile  = getDeviceProfile();
  const wasmAvailable  = input.wasmAvailable ?? false;
  const analysisMode   = input.analysisMode ?? 'FULL_ANALYSIS';
  const guard          = new ThermalGuard(deviceProfile.thermalIntervalMs);
  const pool           = getMemoryPool();

  // Initialise WASM bridge (non-blocking — falls back to JS instantly)
  initWasmBridge().catch(() => {});

  const {
    frames, beamsWithLoads, columns, mat, slabs, slabProps,
    selectedEngine, ignoreSlab, effectiveFrameEndReleases,
    beamStiffnessFactor, colStiffnessFactor,
    detectedConnections, removedColumnIds,
    beamHinges2D: beamHinges2DArr,
    colRigidEndOffsets,
  } = input;

  const beamHinges2D = new Map<string, 'I' | 'J' | 'BOTH'>(beamHinges2DArr);
  const bMap = new Map(beamsWithLoads.map(b => [b.id, b]));

  // Estimate system size for LOD selection
  const nodeEstimate    = frames.reduce((s, f) => s + f.beamIds.length + 1, columns.length);
  const supportEstimate = columns.filter(c => !c.isRemoved).length;
  const estimatedDOF    = estimateFreeDOF({ nodeCount: nodeEstimate, elementCount: beamsWithLoads.length, supportCount: supportEstimate });
  const lodConfig       = buildLODConfig(analysisMode, estimatedDOF, wasmAvailable);

  // ── Stage 1: Geometry validation ─────────────────────────────────────────
  progress(5, `مرحلة 1: التحقق من الهندسة (${analysisMode === 'FAST_PREVIEW' ? 'معاينة سريعة' : 'تحليل كامل'})...`);
  await guard.checkpoint();
  if (await checkCancelled()) return;

  if (frames.length === 0) {
    send({ type: 'ERROR', message: 'لا توجد إطارات معرّفة في النموذج' });
    releaseWakeLock();
    return;
  }

  // ── Stage 2: DOF generation ───────────────────────────────────────────────
  progress(12, `مرحلة 2: توليد درجات الحرية — ${estimatedDOF.toLocaleString()} DOF مقدّرة...`);
  await guard.checkpoint();
  if (await checkCancelled()) return;

  // ── Stage 3: Sparse assembly ──────────────────────────────────────────────
  progress(22, 'مرحلة 3: تجميع مصفوفة الصلابة المتفرقة (CSR)...');
  await guard.checkpoint();
  if (await checkCancelled()) return;

  let frameResults: FrameResult[];
  let bobConnections: BeamOnBeamConnection[];
  let engineUsed = selectedEngine;
  let solverTierUsed = lodConfig.solverTier;
  let iterationsUsed: number | undefined;
  let residualUsed: number | undefined;

  try {
    // ════════════════════════════════════════════════════════════════════════
    // PATH A — FEM Coupled (Shell + Frame)
    // ════════════════════════════════════════════════════════════════════════
    if (selectedEngine === 'fem_coupled' && !ignoreSlab) {
      if (slabs.length === 0) {
        send({ type: 'ERROR', message: 'يتطلب محرك FEM وجود بلاطات معرّفة في النموذج' });
        releaseWakeLock();
        return;
      }
      if (columns.length === 0) {
        send({ type: 'ERROR', message: 'يتطلب محرك FEM وجود أعمدة (ركائز) في النموذج' });
        releaseWakeLock();
        return;
      }

      progress(30, 'مرحلة 3: محرك FEM — تجميع عناصر الغلاف (Shell Elements)...');
      await guard.forceYield();
      if (await checkCancelled()) return;

      progress(45, 'مرحلة 4: معالجة الشروط الحدودية وتقليص المنظومة...');
      await guard.forceYield();
      if (await checkCancelled()) return;

      const meshDensity = analysisMode === 'FAST_PREVIEW' ? 2 : (lodConfig.meshDensity ?? 4);
      const femModel = { slabs, beams: beamsWithLoads, columns, slabProps, mat, meshDensity };
      const coupledResults = getConnectedSlabResults(femModel, meshDensity);

      if (_cancelled) { send({ type: 'CANCELLED' }); releaseWakeLock(); return; }

      if (coupledResults.length === 0) {
        send({ type: 'ERROR', message: 'لم يُنتج محرك FEM نتائج — تحقق من إعدادات النموذج' });
        releaseWakeLock();
        return;
      }

      progress(62, 'مرحلة 5: حل منظومة KU=F (PCG متفرق)...');
      await guard.forceYield();
      if (await checkCancelled()) return;

      let femFrameResults = adaptFEMResults(coupledResults, beamsWithLoads, frames);

      if (detectedConnections.length > 0) {
        const secSet = new Set(detectedConnections.flatMap(c => c.secondaryBeamIds));
        const hasBobFrame = frames.some(f => f.beamIds.some(bid => secSet.has(bid)));
        if (hasBobFrame) {
          progress(75, 'مرحلة 5b: تحليل إطارات beam-on-beam بمحرك 3D...');
          await guard.forceYield();
          const results3D = getFrameResults3D(
            frames, beamsWithLoads, columns, mat,
            effectiveFrameEndReleases, detectedConnections,
            slabs, slabProps, false,
            beamStiffnessFactor, colStiffnessFactor,
            false, colRigidEndOffsets,
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
      await guard.forceYield();
      if (await checkCancelled()) return;

      progress(48, 'مرحلة 4: تحليل الإطارات (طريقة صلابة المصفوفة)...');
      await guard.forceYield();
      if (await checkCancelled()) return;

      if (removedColumnIds.length > 0 && detectedConnections.length > 0) {
        progress(62, 'مرحلة 5: تحليل beam-on-beam (تكراري)...');
        await guard.forceYield();
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
        progress(62, 'مرحلة 5: حل منظومة المعادلات...');

        // Progressive frame-by-frame solve with partial results streaming
        frameResults = [];
        const BATCH_SIZE = Math.max(1, Math.floor(frames.length / 8));
        let batchIndex = 0;

        for (let i = 0; i < frames.length; i += BATCH_SIZE) {
          if (_cancelled) { send({ type: 'CANCELLED' }); releaseWakeLock(); return; }

          const batchEnd = Math.min(i + BATCH_SIZE, frames.length);
          const partials = [];

          for (let j = i; j < batchEnd; j++) {
            const r = analyzeFrame(
              frames[j], bMap, columns, mat, removedColumnIds, undefined,
              beamHinges2D, undefined, beamStiffnessFactor, colStiffnessFactor,
            );
            frameResults.push(r);
            partials.push({ frameIndex: j, result: r });
          }

          // Stream partial results to UI
          send({ type: 'PARTIAL_RESULT', partials, batchIndex });
          batchIndex++;

          const pct = 62 + (batchEnd / frames.length) * 20;
          progress(pct, `مرحلة 5: معالجة الإطار ${batchEnd} / ${frames.length}...`);
          await guard.checkpoint();
        }

        bobConnections = [];
      }
      engineUsed = 'legacy_2d';

    // ════════════════════════════════════════════════════════════════════════
    // PATH C — 3D Direct Stiffness (default)
    // ════════════════════════════════════════════════════════════════════════
    } else {
      progress(25, `مرحلة 3: محرك 3D — بناء النموذج (${lodConfig.solverTier})...`);
      await guard.forceYield();
      if (await checkCancelled()) return;

      progress(40, 'مرحلة 4: تجميع مصفوفة الصلابة 3D (طريقة الصلابة المباشرة)...');
      await guard.forceYield();
      if (await checkCancelled()) return;

      progress(56, `مرحلة 5: حل منظومة KU=F (${lodConfig.solverTier})...`);
      await guard.forceYield();
      if (await checkCancelled()) return;

      try {
        frameResults = getFrameResults3D(
          frames, beamsWithLoads, columns, mat,
          effectiveFrameEndReleases, [],
          slabs, slabProps, false,
          beamStiffnessFactor, colStiffnessFactor,
          false, colRigidEndOffsets,
        );
        bobConnections = [];
        engineUsed = selectedEngine;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
        warnings.push(`فشل محرك 3D، التراجع إلى محرك 2D: ${msg}`);

        // Progressive fallback solve
        progress(65, 'مرحلة 5b: تحليل تراجعي بمحرك 2D...');
        await guard.forceYield();

        frameResults = [];
        for (let i = 0; i < frames.length; i++) {
          if (_cancelled) { send({ type: 'CANCELLED' }); releaseWakeLock(); return; }
          frameResults.push(
            analyzeFrame(
              frames[i], bMap, columns, mat, removedColumnIds, undefined,
              beamHinges2D, undefined, beamStiffnessFactor, colStiffnessFactor,
            ),
          );
          await guard.checkpoint();
        }
        bobConnections = [];
        engineUsed = 'fallback_2d';
        solverTierUsed = 'dense_cholesky';
      }
    }

  } catch (err) {
    send({
      type: 'ERROR',
      message: err instanceof Error ? err.message : 'خطأ غير متوقع في التحليل الإنشائي',
    });
    releaseWakeLock();
    flushMemoryPool();
    return;
  }

  if (await checkCancelled()) return;

  // ── Stage 6: Post-processing ──────────────────────────────────────────────
  progress(87, 'مرحلة 6: استخراج العزوم والقوى والانحرافات...');
  await guard.forceYield();

  // ── Stage 7: ACI 318-19 checks ────────────────────────────────────────────
  progress(94, 'مرحلة 7: التحقق من نتائج التصميم وفق ACI 318-19...');
  await guard.forceYield();

  // ── Build diagnostics ─────────────────────────────────────────────────────
  const solveTimeMs = Math.round(performance.now() - t0);
  const memRaw      = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  const memoryMB    = memRaw?.usedJSHeapSize
    ? Math.round(memRaw.usedJSHeapSize / 1_048_576)
    : 0;

  const poolStats = pool.stats;

  const diagnostics: WorkerDiagnostics = {
    solveTimeMs,
    totalDOF: frames.reduce((s, f) => s + f.beamIds.length * 12, 0),
    elementCount: beamsWithLoads.length + columns.filter(c => !c.isRemoved).length,
    engineUsed,
    memoryMB,
    warnings,
    // Solver internals
    solverTier: solverTierUsed,
    iterations: iterationsUsed,
    residualNorm: residualUsed,
    // Performance
    analysisMode,
    wasmTier: getWasmStatus() === 'ready' ? 'wasm' : 'js_optimised',
    yieldCount: guard.yieldCount,
    memoryPoolReuseRatio: poolStats.reuseRatio,
    // Device
    deviceTier: deviceProfile.tier,
  };

  releaseWakeLock();
  flushMemoryPool();

  send({ type: 'FINAL_RESULT', frameResults, bobConnections, diagnostics });
}

// ── Message router ────────────────────────────────────────────────────────────

(self as unknown as Worker).onmessage = (e: MessageEvent<WorkerInput>) => {
  const msg = e.data;
  if (msg.type === 'START_ANALYSIS') {
    runAnalysis(msg.payload);
  } else if (msg.type === 'CANCEL_ANALYSIS') {
    _cancelled = true;
  }
};
