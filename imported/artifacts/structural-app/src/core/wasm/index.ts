/**
 * WASM Module — Public API
 * ════════════════════════
 * Re-exports the WASM bridge and numerical core in one import.
 */

export { initWasmBridge, getWasmStatus, getWasmLoadError, getCapabilityReport, isWebAssemblySupported } from './wasmBridge';
export type { WasmStatus, WasmCapabilityReport } from './wasmBridge';

export { registerWasmModule, isWasmReady, pcgSolve, csrMatvec, choleskySolve, ldltSolve, dot4 } from './numericalCore';
export type { WasmNumericalModule, PCGResult } from './numericalCore';
