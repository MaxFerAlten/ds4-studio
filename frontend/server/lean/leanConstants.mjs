// Lean 4 integration constants for ds4-studio
// This module exports only pure constants — no environment reads.

export const LEAN_REQUEST_CONTRACT = "lean_check_request_v1";
export const LEAN_RESULT_CONTRACT = "lean_result_v1";
export const LEAN_INSPECT_RESULT_CONTRACT = "lean_inspect_result_v1";

export const LEAN_MAX_SOURCE_BYTES = 512 * 1024;
export const LEAN_MAX_STDOUT_BYTES = 64 * 1024;
export const LEAN_MAX_STDERR_BYTES = 128 * 1024;
export const LEAN_MAX_DIAGNOSTICS = 200;

export const LEAN_DEFAULT_TIMEOUT_SEC = 30;
export const LEAN_MAX_TIMEOUT_SEC = 120;
// Inspect-specific timeout constants (WP03.1 — lean.fix.000).
export const LEAN_INSPECT_DEFAULT_TIMEOUT_SEC = 30;
export const LEAN_INSPECT_MAX_TIMEOUT_SEC = 120;
// The per-proof attempt budget is NOT a constant here: it is policy, resolved by
// leanOrchestrationConfig from config/lean-orchestration-policy.json (which is
// also what the C header is generated from). A second literal here is exactly
// the C/JS divergence the orchestration contract forbids.

export const LEAN_PROFILES = Object.freeze(["core", "mathlib"]);
export const LEAN_MODES = Object.freeze(["check"]);

export const LEAN_RUN_ID_PATTERN = /^lean-[a-f0-9]{12}-[0-9]+-[0-9]+$/;
