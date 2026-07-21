/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md sections 2 and 4.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: none; transitions are DS4 Evolution protocol state.
 */

export const EVOLUTION_STATES = Object.freeze([
  "CREATED", "BASELINE_CAPTURING", "BASELINE_EVALUATING", "BASELINE_READY",
  "PROPOSING", "CANDIDATE_BUILDING", "CANDIDATE_READY", "EXECUTING", "EVALUATING",
  "DIAGNOSING", "GATING", "PROMOTED", "REJECTED", "MANUAL_REVIEW", "COMPLETED",
  "STOPPED", "FAILED"
]);

export const TERMINAL_STATES = Object.freeze(new Set(["COMPLETED", "STOPPED", "FAILED"]));

export const EXCEPTIONAL_TRANSITION_KINDS = Object.freeze({
  FAILED: "hard_failure",
  STOPPED: "stop"
});

export const ALLOWED_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(["BASELINE_CAPTURING"]),
  BASELINE_CAPTURING: Object.freeze(["BASELINE_EVALUATING"]),
  BASELINE_EVALUATING: Object.freeze(["BASELINE_READY", "FAILED"]),
  BASELINE_READY: Object.freeze(["PROPOSING"]),
  PROPOSING: Object.freeze(["CANDIDATE_BUILDING", "STOPPED"]),
  CANDIDATE_BUILDING: Object.freeze(["CANDIDATE_READY", "REJECTED"]),
  CANDIDATE_READY: Object.freeze(["EXECUTING"]),
  EXECUTING: Object.freeze(["EVALUATING", "FAILED"]),
  EVALUATING: Object.freeze(["DIAGNOSING"]),
  DIAGNOSING: Object.freeze(["GATING"]),
  GATING: Object.freeze(["PROMOTED", "REJECTED", "MANUAL_REVIEW"]),
  PROMOTED: Object.freeze(["PROPOSING", "COMPLETED"]),
  REJECTED: Object.freeze(["PROPOSING", "STOPPED"]),
  MANUAL_REVIEW: Object.freeze(["PROMOTED", "REJECTED"]),
  COMPLETED: Object.freeze([]),
  STOPPED: Object.freeze([]),
  FAILED: Object.freeze([])
});

export class EvolutionStateError extends Error {
  constructor(code, from, to) {
    super(`${code}: ${from} -> ${to}`);
    this.name = "EvolutionStateError";
    this.code = code;
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from, to, options = {}) {
  if (!EVOLUTION_STATES.includes(from)) throw new EvolutionStateError("UNKNOWN_SOURCE_STATE", from, to);
  if (!EVOLUTION_STATES.includes(to)) throw new EvolutionStateError("UNKNOWN_TARGET_STATE", from, to);
  if (TERMINAL_STATES.has(from)) throw new EvolutionStateError("TERMINAL_STATE_IMMUTABLE", from, to);
  if (ALLOWED_TRANSITIONS[from].includes(to)) return true;
  const requiredKind = EXCEPTIONAL_TRANSITION_KINDS[to];
  if (!requiredKind || options.kind !== requiredKind) {
    throw new EvolutionStateError("INVALID_STATE_TRANSITION", from, to);
  }
  if (requiredKind === "hard_failure" && !/^[A-Z][A-Z0-9_:-]{2,127}$/.test(String(options.reasonCode ?? ""))) {
    throw new EvolutionStateError("MISSING_HARD_FAILURE_REASON", from, to);
  }
  return true;
}

export function nextRunState(run, to, options = {}) {
  if (!run || typeof run !== "object") throw new TypeError("run is required");
  assertTransition(run.state, to, options);
  return Object.freeze({
    ...run,
    state: to,
    updatedAt: (options.now ?? new Date()).toISOString()
  });
}
