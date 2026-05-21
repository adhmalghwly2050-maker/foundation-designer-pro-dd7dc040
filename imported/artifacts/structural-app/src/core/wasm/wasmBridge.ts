/**
 * WASM Bridge — Runtime Loader & Capability Detection
 * ════════════════════════════════════════════════════════
 * Handles:
 *   1. Detecting WebAssembly support at runtime.
 *   2. Dynamically loading the compiled WASM module.
 *   3. Falling back gracefully to optimised JS on failure.
 *   4. Reporting load status to diagnostics.
 *
 * The actual .wasm binary is compiled from Rust/C++ externally.
 * Until the binary is available, all solvers use the JS tier.
 */

import type { WasmNumericalModule } from './numericalCore';
import { registerWasmModule } from './numericalCore';

export type WasmStatus =
  | 'not_attempted'
  | 'loading'
  | 'ready'
  | 'unsupported'
  | 'load_failed'
  | 'js_fallback';

let _status: WasmStatus = 'not_attempted';
let _loadError: string | null = null;
let _loadTimeMs = 0;

export function getWasmStatus(): WasmStatus { return _status; }
export function getWasmLoadError(): string | null { return _loadError; }
export function getWasmLoadTimeMs(): number { return _loadTimeMs; }

/**
 * Detect WebAssembly availability in the current runtime.
 * Android WebView ≥ 67 supports WASM. Older WebViews do not.
 */
export function isWebAssemblySupported(): boolean {
  try {
    return (
      typeof WebAssembly === 'object' &&
      typeof WebAssembly.instantiate === 'function' &&
      typeof WebAssembly.compile === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * Detect SIMD support (optional acceleration).
 * Android WebView ≥ 91 supports WASM SIMD.
 */
export async function isWasmSimdSupported(): Promise<boolean> {
  if (!isWebAssemblySupported()) return false;
  try {
    // Minimal SIMD probe — v128.const instruction
    const simdProbe = new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
      3, 2, 1, 0, 10, 10, 1, 8, 0, 253, 12, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11,
    ]);
    await WebAssembly.compile(simdProbe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to load and initialise the WASM numerical core.
 *
 * Expected location: /wasm/structural_solver.wasm
 * (bundled by Vite with `?url` import or placed in public/ for Capacitor)
 *
 * @returns true if WASM loaded successfully, false if JS fallback is used.
 */
export async function initWasmBridge(): Promise<boolean> {
  if (_status === 'ready') return true;
  if (_status === 'loading') return false;

  if (!isWebAssemblySupported()) {
    _status = 'unsupported';
    _loadError = 'WebAssembly not supported in this runtime';
    return false;
  }

  _status = 'loading';
  const t0 = performance.now();

  try {
    // Future: Replace with actual WASM module import
    // const wasmUrl = new URL('/wasm/structural_solver.wasm', import.meta.url);
    // const mod = await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports);
    // const exports = mod.instance.exports as unknown as WasmNumericalModule;
    // registerWasmModule(exports);
    // _status = 'ready';

    // Until the binary is compiled, we advertise JS-tier performance
    _loadTimeMs = performance.now() - t0;
    _status = 'js_fallback';
    _loadError = 'WASM binary not yet compiled — using optimised JS solver';
    return false;

  } catch (err) {
    _loadTimeMs = performance.now() - t0;
    _status = 'load_failed';
    _loadError = err instanceof Error ? err.message : String(err);
    return false;
  }
}

/**
 * Full capability report for diagnostics panel.
 */
export interface WasmCapabilityReport {
  wasmSupported: boolean;
  simdSupported: boolean;
  status: WasmStatus;
  loadTimeMs: number;
  error: string | null;
  tier: 'wasm' | 'wasm_simd' | 'js_optimised';
  tierLabel: string;
}

export async function getCapabilityReport(): Promise<WasmCapabilityReport> {
  const wasmSupported = isWebAssemblySupported();
  const simdSupported = wasmSupported ? await isWasmSimdSupported() : false;

  let tier: WasmCapabilityReport['tier'] = 'js_optimised';
  let tierLabel = 'JS محسّن (TypedArray)';

  if (_status === 'ready') {
    tier = simdSupported ? 'wasm_simd' : 'wasm';
    tierLabel = simdSupported ? 'WASM + SIMD' : 'WebAssembly';
  }

  return {
    wasmSupported,
    simdSupported,
    status: _status,
    loadTimeMs: _loadTimeMs,
    error: _loadError,
    tier,
    tierLabel,
  };
}
