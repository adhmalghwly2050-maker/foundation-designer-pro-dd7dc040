/**
 * Worker Message Protocol Types
 * ════════════════════════════════════════════════════════
 * Defines the message contract between the UI thread and
 * the analysis Web Worker.
 */

import type {
  Frame, Beam, Column, MatProps, Slab, SlabProps,
  FrameResult, BeamOnBeamConnection,
} from '@/lib/structuralEngine';

// ── Input sent to the worker ─────────────────────────────────────────────────

export interface AnalysisInput {
  frames: Frame[];
  beamsWithLoads: Beam[];
  columns: Column[];
  mat: MatProps;
  slabs: Slab[];
  slabProps: SlabProps;
  selectedEngine: string;
  ignoreSlab: boolean;
  /** Serialisable form of effectiveFrameEndReleases (Record<string, EndReleaseState>) */
  effectiveFrameEndReleases: Record<string, {
    nodeI: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
    nodeJ: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
  }>;
  beamStiffnessFactor: number;
  colStiffnessFactor: number;
  detectedConnections: BeamOnBeamConnection[];
  removedColumnIds: string[];
  /** Pre-computed 2D hinge map as serialisable array of entries */
  beamHinges2D: Array<[string, 'I' | 'J' | 'BOTH']>;
}

// ── Messages sent FROM the worker ────────────────────────────────────────────

export interface WorkerDiagnostics {
  solveTimeMs: number;
  totalDOF: number;
  elementCount: number;
  engineUsed: string;
  memoryMB: number;
  iterations?: number;
  residualNorm?: number;
  warnings: string[];
}

export interface WorkerAnalysisResult {
  type: 'FINAL_RESULT';
  frameResults: FrameResult[];
  bobConnections: BeamOnBeamConnection[];
  diagnostics: WorkerDiagnostics;
}

export type WorkerOutput =
  | { type: 'PROGRESS_UPDATE'; progress: number; step: string }
  | WorkerAnalysisResult
  | { type: 'ERROR'; message: string }
  | { type: 'CANCELLED' };

// ── Messages sent TO the worker ──────────────────────────────────────────────

export type WorkerInput =
  | { type: 'START_ANALYSIS'; payload: AnalysisInput }
  | { type: 'CANCEL_ANALYSIS' };
