/**
 * Analysis Diagnostics Panel — Mobile-Optimised
 * ════════════════════════════════════════════════════════
 * Shows full performance metrics after analysis:
 *   Engine, DOF, Solver Tier, Sparse Matrix stats,
 *   Iterations, Residual, Memory, Worker status,
 *   WASM tier, Thermal yields, Device tier, LOD mode.
 */

import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Clock, Cpu, Database, Zap, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Activity, Thermometer, Layers,
} from 'lucide-react';
import type { WorkerDiagnostics } from '@/core/workers/workerTypes';

interface Props {
  diagnostics: WorkerDiagnostics;
  className?: string;
  /** Show expanded technical details by default */
  defaultExpanded?: boolean;
}

const ENGINE_DISPLAY: Record<string, { label: string; color: string }> = {
  fem_coupled:  { label: 'FEM Shell+Frame',      color: 'bg-purple-500/15 text-purple-700 dark:text-purple-300' },
  legacy_3d:    { label: 'Direct Stiffness 3D',  color: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  legacy_2d:    { label: 'Matrix Stiffness 2D',  color: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' },
  global_frame: { label: 'Global Frame 3D',      color: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
  unified_core: { label: 'Unified Core 3D',      color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  fallback_2d:  { label: 'Fallback 2D',           color: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
};

const SOLVER_TIER_DISPLAY: Record<string, { label: string; icon: string }> = {
  dense_cholesky:  { label: 'Cholesky (كثيف)',   icon: '🔒' },
  dense_ldlt:      { label: 'LDLT (كثيف)',        icon: '🔐' },
  sparse_pcg:      { label: 'PCG متفرق (JS)',     icon: '⚡' },
  sparse_pcg_wasm: { label: 'PCG متفرق (WASM)',   icon: '🚀' },
  chunked_pcg:     { label: 'PCG مجزّأ',          icon: '🧩' },
};

const WASM_TIER_DISPLAY: Record<string, { label: string; color: string }> = {
  wasm_simd:    { label: 'WASM + SIMD', color: 'text-emerald-600 dark:text-emerald-400' },
  wasm:         { label: 'WebAssembly', color: 'text-green-600 dark:text-green-400' },
  js_optimised: { label: 'JS محسّن',   color: 'text-blue-600 dark:text-blue-400' },
};

const DEVICE_TIER_COLOR: Record<string, string> = {
  low:  'text-red-600 dark:text-red-400',
  mid:  'text-amber-600 dark:text-amber-400',
  high: 'text-emerald-600 dark:text-emerald-400',
};

const LOD_COLOR: Record<string, string> = {
  FAST_PREVIEW:  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  FULL_ANALYSIS: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
};

export default function AnalysisDiagnosticsPanel({ diagnostics, className = '', defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const eng         = ENGINE_DISPLAY[diagnostics.engineUsed] ?? { label: diagnostics.engineUsed, color: 'bg-muted text-muted-foreground' };
  const solveMs     = diagnostics.solveTimeMs;
  const solveSec    = (solveMs / 1000).toFixed(2);
  const hasWarnings = diagnostics.warnings.length > 0;
  const tierInfo    = diagnostics.solverTier ? SOLVER_TIER_DISPLAY[diagnostics.solverTier] : null;
  const wasmInfo    = diagnostics.wasmTier ? WASM_TIER_DISPLAY[diagnostics.wasmTier] : WASM_TIER_DISPLAY['js_optimised'];
  const lodColor    = diagnostics.analysisMode ? LOD_COLOR[diagnostics.analysisMode] : '';
  const deviceColor = diagnostics.deviceTier ? DEVICE_TIER_COLOR[diagnostics.deviceTier] : '';

  return (
    <div
      dir="rtl"
      className={`rounded-xl border border-border bg-card p-4 space-y-3 text-sm ${className}`}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2">
        <Cpu size={14} className="text-primary shrink-0" />
        <span className="font-semibold text-foreground text-xs">تشخيصات المحلل</span>

        {/* Engine badge */}
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${eng.color}`}>
          {eng.label}
        </span>

        {/* LOD mode badge */}
        {diagnostics.analysisMode && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${lodColor}`}>
            {diagnostics.analysisMode === 'FAST_PREVIEW' ? 'معاينة سريعة' : 'تحليل كامل'}
          </span>
        )}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="mr-auto text-muted-foreground hover:text-foreground transition-colors"
          aria-label="تفاصيل"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* ── Primary metrics grid ── */}
      <div className="grid grid-cols-2 gap-2">
        <Metric
          icon={<Clock size={12} />}
          label="وقت الحل"
          value={solveMs < 1000 ? `${solveMs} ms` : `${solveSec} ث`}
          highlight={solveMs > 5000}
          highlightColor="amber"
        />
        <Metric
          icon={<Database size={12} />}
          label="درجات الحرية"
          value={diagnostics.totalDOF.toLocaleString()}
        />
        <Metric
          icon={<Zap size={12} />}
          label="العناصر"
          value={diagnostics.elementCount.toLocaleString()}
        />
        {diagnostics.memoryMB > 0 && (
          <Metric
            icon={<Database size={12} />}
            label="الذاكرة"
            value={`${diagnostics.memoryMB} MB`}
            highlight={diagnostics.memoryMB > 200}
            highlightColor="amber"
          />
        )}
      </div>

      {/* ── Expanded technical details ── */}
      {expanded && (
        <div className="space-y-2 border-t border-border pt-2">

          {/* Solver internals */}
          <SectionTitle icon={<Activity size={11} />} label="المحلل الرياضي" />
          <div className="grid grid-cols-2 gap-2">
            {tierInfo && (
              <Metric
                icon={<span className="text-[11px]">{tierInfo.icon}</span>}
                label="نوع المحلل"
                value={tierInfo.label}
              />
            )}
            {diagnostics.iterations !== undefined && (
              <Metric
                icon={<Zap size={12} />}
                label="تكرارات CG"
                value={diagnostics.iterations.toLocaleString()}
              />
            )}
            {diagnostics.residualNorm !== undefined && (
              <Metric
                icon={<Zap size={12} />}
                label="الخطأ المتبقي"
                value={diagnostics.residualNorm.toExponential(2)}
                highlight={diagnostics.residualNorm > 1e-6}
                highlightColor="red"
              />
            )}
            {diagnostics.matrixSizeNNZ !== undefined && (
              <Metric
                icon={<Database size={12} />}
                label="NNZ (المصفوفة)"
                value={diagnostics.matrixSizeNNZ.toLocaleString()}
              />
            )}
            {diagnostics.sparsityPercent !== undefined && (
              <Metric
                icon={<Layers size={12} />}
                label="التفرق"
                value={`${diagnostics.sparsityPercent.toFixed(1)}%`}
              />
            )}
            {diagnostics.compressionRatio !== undefined && (
              <Metric
                icon={<Database size={12} />}
                label="ضغط RAM"
                value={`${diagnostics.compressionRatio.toFixed(0)}×`}
              />
            )}
          </div>

          {/* Performance subsystems */}
          <SectionTitle icon={<Thermometer size={11} />} label="أداء النظام" />
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/50 rounded-lg px-2.5 py-2 space-y-0.5">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Cpu size={12} />
                <span className="text-[9px] uppercase tracking-wide">WASM</span>
              </div>
              <p className={`font-mono font-bold text-xs ${wasmInfo?.color ?? ''}`}>
                {wasmInfo?.label ?? 'JS محسّن'}
              </p>
            </div>

            {diagnostics.deviceTier && (
              <div className="bg-muted/50 rounded-lg px-2.5 py-2 space-y-0.5">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Activity size={12} />
                  <span className="text-[9px] uppercase tracking-wide">الجهاز</span>
                </div>
                <p className={`font-mono font-bold text-xs ${deviceColor}`}>
                  {diagnostics.deviceTier === 'low' ? 'منخفض' : diagnostics.deviceTier === 'mid' ? 'متوسط' : 'عالي'}
                </p>
              </div>
            )}

            {diagnostics.yieldCount !== undefined && (
              <Metric
                icon={<Thermometer size={12} />}
                label="إيقافات حرارية"
                value={`${diagnostics.yieldCount}×`}
              />
            )}

            {diagnostics.memoryPoolReuseRatio !== undefined && (
              <Metric
                icon={<Database size={12} />}
                label="إعادة استخدام Buffer"
                value={`${Math.round(diagnostics.memoryPoolReuseRatio * 100)}%`}
                highlight={diagnostics.memoryPoolReuseRatio < 0.3}
                highlightColor="amber"
              />
            )}
          </div>
        </div>
      )}

      {/* ── Warnings ── */}
      {hasWarnings && (
        <div className="space-y-1">
          {diagnostics.warnings.map((w, i) => (
            <div
              key={i}
              className="flex gap-1.5 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-2 py-1.5"
            >
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Status ── */}
      {!hasWarnings && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 size={11} />
          <span>اكتمل التحليل بدون تحذيرات</span>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {icon}
      <span className="text-[9px] font-semibold uppercase tracking-wider">{label}</span>
    </div>
  );
}

function Metric({
  icon, label, value, highlight = false, highlightColor = 'amber',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  highlightColor?: 'amber' | 'red';
}) {
  const highlightClass = highlight
    ? highlightColor === 'red'
      ? 'text-red-600 dark:text-red-400'
      : 'text-amber-600 dark:text-amber-400'
    : 'text-foreground';

  return (
    <div className="bg-muted/50 rounded-lg px-2.5 py-2 space-y-0.5">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[9px] uppercase tracking-wide">{label}</span>
      </div>
      <p className={`font-mono font-bold text-xs ${highlightClass}`}>
        {value}
      </p>
    </div>
  );
}
