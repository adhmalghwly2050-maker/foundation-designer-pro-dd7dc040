/**
 * Worker Message Protocol Types
 * ════════════════════════════════════════════════════════
 * Full message contract between the UI thread and the
 * analysis Web Worker.
 *
 * Protocol:
 *   UI  → Worker:  START_ANALYSIS | CANCEL_ANALYSIS
 *   Worker → UI:   PROGRESS_UPDATE | PARTIAL_RESULT | FINAL_RESULT | ERROR | CANCELLED
 */

import type {
  Frame, Beam, Column, MatProps, Slab, SlabProps,
  FrameResult, BeamOnBeamConnection,
} from '@/lib/structuralEngine';
import type { AnalysisMode } from '../performance/lodController';

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
  /** Serialisable form of effectiveFrameEndReleases */
  effectiveFrameEndReleases: Record<string, {
    nodeI: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
    nodeJ: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
  }>;
  beamStiffnessFactor: number;
  colStiffnessFactor: number;
  detectedConnections: BeamOnBeamConnection[];
  removedColumnIds: string[];
  /** Pre-computed 2D hinge map as serialisable array */
  beamHinges2D: Array<[string, 'I' | 'J' | 'BOTH']>;

  // ── NEW: Performance / LOD options ───────────────────────────────────────
  /** Analysis fidelity: FAST_PREVIEW or FULL_ANALYSIS (default: FULL_ANALYSIS) */
  analysisMode?: AnalysisMode;
  /** Hint: whether WASM is available in this build */
  wasmAvailable?: boolean;
  /** Per-column rigid end offsets (ETABS-style End Length Offsets) */
  colRigidEndOffsets?: Record<string, boolean>;
}

// ── Solver performance diagnostics ──────────────────────────────────────────

export interface WorkerDiagnostics {
  solveTimeMs: number;
  totalDOF: number;
  elementCount: number;
  engineUsed: string;
  memoryMB: number;
  warnings: string[];

  // ── Solver internals ─────────────────────────────────────────────────────
  iterations?: number;
  residualNorm?: number;
  solverTier?: string;        // 'dense_cholesky' | 'sparse_pcg' | etc.
  matrixSizeNNZ?: number;     // non-zero count in CSR matrix
  sparsityPercent?: number;   // percentage of structural zeros
  compressionRatio?: number;  // denseMB / sparseMB

  // ── Performance ──────────────────────────────────────────────────────────
  analysisMode?: AnalysisMode;
  wasmTier?: string;          // 'wasm_simd' | 'wasm' | 'js_optimised'
  yieldCount?: number;        // number of scheduler yields during solve
  memoryPoolReuseRatio?: number; // pool reuse efficiency (0–1)

  // ── Device ───────────────────────────────────────────────────────────────
  deviceTier?: string;        // 'low' | 'mid' | 'high'
}

// ── Partial result (streamed during analysis) ────────────────────────────────

export interface PartialFrameResult {
  /** Frame index this partial result belongs to. */
  frameIndex: number;
  result: FrameResult;
}

// ── Messages sent FROM the worker ────────────────────────────────────────────

export interface WorkerAnalysisResult {
  type: 'FINAL_RESULT';
  frameResults: FrameResult[];
  bobConnections: BeamOnBeamConnection[];
  diagnostics: WorkerDiagnostics;
}

export type WorkerOutput =
  | { type: 'PROGRESS_UPDATE'; progress: number; step: string }
  | { type: 'PARTIAL_RESULT'; partials: PartialFrameResult[]; batchIndex: number }
  | WorkerAnalysisResult
  | { type: 'ERROR'; message: string }
  | { type: 'CANCELLED' };

// ── Messages sent TO the worker ──────────────────────────────────────────────

export type WorkerInput =
  | { type: 'START_ANALYSIS'; payload: AnalysisInput }
  | { type: 'CANCEL_ANALYSIS' };
