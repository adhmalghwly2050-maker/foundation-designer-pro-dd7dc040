/**
 * Mobile Optimizer — APK / Capacitor / Android WebView
 * ════════════════════════════════════════════════════════
 * Detects mobile hardware constraints and applies adaptive
 * runtime optimisations:
 *
 *   1. Device tier classification (low / mid / high)
 *   2. Capacitor/native bridge detection
 *   3. Adaptive chunk size for analysis loops
 *   4. Battery-aware execution (reduce work when charging off)
 *   5. Offline-mode check for APK environments
 */

// ── Device tier ───────────────────────────────────────────────────────────────

export type DeviceTier = 'low' | 'mid' | 'high';

export interface DeviceProfile {
  tier: DeviceTier;
  isAndroid: boolean;
  isCapacitor: boolean;
  isOffline: boolean;
  hardwareConcurrency: number;
  /** Estimated available JS heap in MB (from performance.memory, if available) */
  estimatedFreeMemoryMB: number;
  /** Recommended max DOF before forced sparse switch */
  maxDenseDOF: number;
  /** Recommended CG chunk size (iterations between yields) */
  cgChunkSize: number;
  /** Recommended thermal yield interval (ms) */
  thermalIntervalMs: number;
}

/**
 * Detect device capabilities and return a DeviceProfile.
 * Safe to call multiple times — result is cached.
 */
let _cachedProfile: DeviceProfile | null = null;

export function getDeviceProfile(): DeviceProfile {
  if (_cachedProfile) return _cachedProfile;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isAndroid    = /Android/i.test(ua);
  const isCapacitor  = typeof (globalThis as { Capacitor?: unknown }).Capacitor !== 'undefined';
  const cores        = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2;
  const isOffline    = typeof navigator !== 'undefined' && !navigator.onLine;

  // Estimate free heap
  const mem = (performance as { memory?: { jsHeapSizeLimit?: number; usedJSHeapSize?: number } }).memory;
  const heapLimitMB = mem?.jsHeapSizeLimit ? Math.round(mem.jsHeapSizeLimit / 1_048_576) : 512;
  const heapUsedMB  = mem?.usedJSHeapSize  ? Math.round(mem.usedJSHeapSize  / 1_048_576) : 0;
  const estimatedFreeMemoryMB = Math.max(0, heapLimitMB - heapUsedMB);

  // Classify device tier
  let tier: DeviceTier;
  if (isAndroid) {
    if (cores <= 4 || heapLimitMB < 512) {
      tier = 'low';
    } else if (cores <= 6 || heapLimitMB < 1024) {
      tier = 'mid';
    } else {
      tier = 'high';
    }
  } else {
    // Desktop / iOS
    tier = cores >= 8 ? 'high' : 'mid';
  }

  const profile: DeviceProfile = {
    tier,
    isAndroid,
    isCapacitor,
    isOffline,
    hardwareConcurrency: cores,
    estimatedFreeMemoryMB,
    // Tier-specific parameters
    maxDenseDOF:       tier === 'low' ? 200  : tier === 'mid' ? 400  : 600,
    cgChunkSize:       tier === 'low' ? 20   : tier === 'mid' ? 50   : 100,
    thermalIntervalMs: tier === 'low' ? 16   : tier === 'mid' ? 32   : 60,
  };

  _cachedProfile = profile;
  return profile;
}

/** Force re-detection (e.g. after app resume from background). */
export function invalidateDeviceProfile(): void {
  _cachedProfile = null;
}

// ── Capacitor / native bridge helpers ────────────────────────────────────────

/**
 * Notify Capacitor that a long-running task is starting.
 * Prevents Android from killing the WebView during analysis.
 * No-op when Capacitor is not available.
 */
export async function capacitorBeginBackgroundTask(taskName = 'analysis'): Promise<string | null> {
  try {
    const cap = (globalThis as { Capacitor?: { Plugins?: { BackgroundTask?: {
      beforeExit: (cb: () => void) => void;
    } } } }).Capacitor;
    if (!cap?.Plugins?.BackgroundTask) return null;
    // Signal that we need extra time
    cap.Plugins.BackgroundTask.beforeExit(() => {
      console.warn(`[Mobile] Background task '${taskName}' was evicted by OS`);
    });
    return taskName;
  } catch {
    return null;
  }
}

/**
 * Keep the device screen awake during long analyses.
 * Uses the Screen Wake Lock API (supported in Chrome 84+ / Android WebView 84+).
 */
let _wakeLock: WakeLockSentinel | null = null;

export async function acquireWakeLock(): Promise<void> {
  try {
    if ('wakeLock' in navigator) {
      _wakeLock = await (navigator as { wakeLock: { request(type: 'screen'): Promise<WakeLockSentinel> } })
        .wakeLock.request('screen');
    }
  } catch {
    // Silently ignore — wake lock is best-effort
  }
}

export function releaseWakeLock(): void {
  _wakeLock?.release().catch(() => {});
  _wakeLock = null;
}

// WakeLockSentinel type shim
interface WakeLockSentinel {
  release(): Promise<void>;
}

// ── Battery-aware execution ───────────────────────────────────────────────────

export interface BatteryState {
  charging: boolean;
  level: number; // 0–1
  /** Recommended CG chunk size given battery state */
  recommendedChunkSize: number;
}

export async function getBatteryState(): Promise<BatteryState | null> {
  try {
    const nav = navigator as { getBattery?: () => Promise<{
      charging: boolean; level: number;
    }> };
    if (!nav.getBattery) return null;
    const battery = await nav.getBattery();
    const profile = getDeviceProfile();

    // Reduce chunk size on low battery to save heat
    let chunk = profile.cgChunkSize;
    if (!battery.charging && battery.level < 0.2) chunk = Math.max(10, Math.floor(chunk / 2));
    if (!battery.charging && battery.level < 0.1) chunk = Math.max(5,  Math.floor(chunk / 3));

    return {
      charging: battery.charging,
      level: battery.level,
      recommendedChunkSize: chunk,
    };
  } catch {
    return null;
  }
}

// ── APK memory pressure check ─────────────────────────────────────────────────

/**
 * Returns true if allocating `requiredMB` is likely to cause OOM.
 * Used before attempting dense matrix allocation.
 */
export function wouldCauseOOM(requiredMB: number): boolean {
  const profile = getDeviceProfile();
  // Keep 256 MB buffer for OS + rendering
  return requiredMB > profile.estimatedFreeMemoryMB - 256;
}

/**
 * Estimate peak memory for a solve of size `nFree`.
 */
export function estimateSolveMemoryMB(nFree: number, sparse: boolean, nnz?: number): number {
  if (sparse) {
    const nnzEst = nnz ?? nFree * 20;
    return Math.ceil((nnzEst * 12 + nFree * 40) / 1_048_576); // CSR + vectors
  }
  return Math.ceil((nFree * nFree * 8 * 2) / 1_048_576); // K + working copy
}
