/**
 * Performance Module — Public API
 * ════════════════════════════════
 */

export { ThermalGuard, runInChunks, adaptiveChunkSize } from './thermalGuard';

export {
  MemoryPool, getMemoryPool, flushMemoryPool,
} from './memoryPool';

export {
  buildLODConfig, selectSolverTier, estimateFreeDOF,
  checkMemoryBudget, shouldSendProgress,
  FAST_PREVIEW_CONFIG, FULL_ANALYSIS_CONFIG,
} from './lodController';
export type { AnalysisMode, SolverTier, LODConfig, ModelEstimate, MemoryBudget } from './lodController';

export {
  getDeviceProfile, invalidateDeviceProfile,
  capacitorBeginBackgroundTask, acquireWakeLock, releaseWakeLock,
  getBatteryState, wouldCauseOOM, estimateSolveMemoryMB,
} from './mobileOptimizer';
export type { DeviceTier, DeviceProfile, BatteryState } from './mobileOptimizer';
