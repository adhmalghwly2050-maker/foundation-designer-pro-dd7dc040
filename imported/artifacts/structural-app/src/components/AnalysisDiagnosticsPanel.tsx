/**
 * Analysis Diagnostics Panel
 * ════════════════════════════════════════════════════════
 * Shows solver performance metrics after analysis completes:
 * engine type, DOF count, solve time, memory, iterations.
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Clock, Cpu, Database, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { WorkerDiagnostics } from '@/core/workers/workerTypes';

interface Props {
  diagnostics: WorkerDiagnostics;
  className?: string;
}

const ENGINE_DISPLAY: Record<string, { label: string; color: string }> = {
  fem_coupled:  { label: 'FEM Shell+Frame', color: 'bg-purple-500/15 text-purple-700 dark:text-purple-300' },
  legacy_3d:    { label: 'Direct Stiffness 3D', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  legacy_2d:    { label: 'Matrix Stiffness 2D', color: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' },
  global_frame: { label: 'Global Frame 3D', color: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
  unified_core: { label: 'Unified Core 3D', color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  fallback_2d:  { label: 'Fallback 2D', color: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
};

export default function AnalysisDiagnosticsPanel({ diagnostics, className = '' }: Props) {
  const eng = ENGINE_DISPLAY[diagnostics.engineUsed] ?? {
    label: diagnostics.engineUsed,
    color: 'bg-muted text-muted-foreground',
  };

  const solveMs = diagnostics.solveTimeMs;
  const solveSec = (solveMs / 1000).toFixed(2);

  const hasWarnings = diagnostics.warnings.length > 0;

  return (
    <div
      dir="rtl"
      className={`rounded-xl border border-border bg-card p-4 space-y-3 text-sm ${className}`}
    >
      {/* Title */}
      <div className="flex items-center gap-2">
        <Cpu size={14} className="text-primary shrink-0" />
        <span className="font-semibold text-foreground text-xs">تشخيصات المحلل</span>
        <span className={`mr-auto text-[10px] font-medium px-2 py-0.5 rounded-full ${eng.color}`}>
          {eng.label}
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        <Metric
          icon={<Clock size={12} />}
          label="وقت الحل"
          value={solveMs < 1000 ? `${solveMs} ms` : `${solveSec} ث`}
          highlight={solveMs > 5000}
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
            label="الذاكرة المستخدمة"
            value={`${diagnostics.memoryMB} MB`}
            highlight={diagnostics.memoryMB > 200}
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
            label="خطأ المتبقي"
            value={diagnostics.residualNorm.toExponential(2)}
          />
        )}
      </div>

      {/* Warnings */}
      {hasWarnings && (
        <div className="space-y-1">
          {diagnostics.warnings.map((w, i) => (
            <div key={i} className="flex gap-1.5 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-2 py-1.5">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Status */}
      {!hasWarnings && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 size={11} />
          <span>اكتمل التحليل بدون تحذيرات</span>
        </div>
      )}
    </div>
  );
}

function Metric({
  icon, label, value, highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-muted/50 rounded-lg px-2.5 py-2 space-y-0.5">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[9px] uppercase tracking-wide">{label}</span>
      </div>
      <p className={`font-mono font-bold text-xs ${highlight ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  );
}
