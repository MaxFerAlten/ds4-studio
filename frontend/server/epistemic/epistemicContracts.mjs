/**
 * DS4 Quantum Fix — epistemic contracts and claim state machine.
 *
 * Vocabulary and transitions from docs/quantum/execution.quantiom.fix.01.md
 * sections 24 (states/transitions), 28 (preliminary types), 34 (forbidden
 * promotions), 46 (mandatory high-severity classes) and 51 (failure taxonomy).
 *
 * Structure follows frontend/server/evolution/evolutionStateMachine.mjs, which
 * is deliberately not imported: the domains are unrelated and sharing the
 * module would couple a claim's lifecycle to an evolution run's.
 *
 * This module is pure vocabulary and assertions. It performs no verification,
 * reads no config and holds no state.
 */

/**
 * The preliminary type a claim carries before any verification. SOURCE_FACT
 * through UNKNOWN are what the claim extractor may assign (§28); CODE_DRAFT and
 * EXECUTED are the execution-domain pair the forbidden-promotion rules in §34
 * are written against.
 */
export const EPISTEMIC_TYPES = Object.freeze([
  "SOURCE_FACT",
  "OBSERVED",
  "COMPUTED",
  "DERIVED",
  "INFERRED",
  "HYPOTHESIS",
  "ANALOGY",
  "SPECULATION",
  "ESTIMATE",
  "UNKNOWN",
  "CODE_DRAFT",
  "EXECUTED"
]);

export const CLAIM_DOMAIN = Object.freeze({
  GENERAL: "GENERAL",
  MATHEMATICS: "MATHEMATICS",
  PHYSICS: "PHYSICS",
  SOFTWARE: "SOFTWARE",
  BIBLIOGRAPHY: "BIBLIOGRAPHY",
  EMPIRICAL: "EMPIRICAL",
  TRANSFORMER_THEORY: "TRANSFORMER_THEORY"
});

/**
 * A claim's lifecycle state. INVALIDATED exists so a claim that depended on a
 * premise which later failed can be represented explicitly, rather than
 * silently keeping the authority it was granted before its premise fell.
 */
export const CLAIM_STATES = Object.freeze([
  "PROPOSED",
  "CLASSIFIED",
  "EVIDENCE_REQUIRED",
  "VERIFICATION_PENDING",
  "CHALLENGED",
  "VERIFIED",
  "PARTIAL",
  "REJECTED",
  "CONTRADICTED",
  "UNKNOWN",
  "INVALIDATED"
]);

/**
 * No edge leaves these. A claim that was rejected or contradicted is not
 * re-verified in place: a repair produces a new claim, which carries the same
 * evidence burden as any new fact (§56).
 */
export const TERMINAL_CLAIM_STATES = Object.freeze(new Set(["REJECTED", "CONTRADICTED"]));

/**
 * Transitions that exist but must never be taken implicitly. Each names the
 * event that authorises it, and assertClaimTransition demands that event be
 * passed as options.kind.
 */
export const EXCEPTIONAL_TRANSITION_KINDS = Object.freeze({
  INVALIDATED: "dependency_failure",
  CHALLENGED: "challenge"
});

export const ALLOWED_CLAIM_TRANSITIONS = Object.freeze({
  PROPOSED: Object.freeze(["CLASSIFIED"]),
  CLASSIFIED: Object.freeze(["EVIDENCE_REQUIRED", "VERIFICATION_PENDING"]),
  EVIDENCE_REQUIRED: Object.freeze(["VERIFICATION_PENDING"]),
  VERIFICATION_PENDING: Object.freeze([
    "VERIFIED",
    "PARTIAL",
    "REJECTED",
    "CONTRADICTED",
    "UNKNOWN"
  ]),
  // CHALLENGED and INVALIDATED are reachable from the settled states only
  // through their exceptional kinds; they are absent from these lists on
  // purpose so an accidental call cannot take them.
  VERIFIED: Object.freeze([]),
  PARTIAL: Object.freeze([]),
  UNKNOWN: Object.freeze([]),
  CHALLENGED: Object.freeze(["VERIFICATION_PENDING"]),
  INVALIDATED: Object.freeze(["VERIFICATION_PENDING"]),
  REJECTED: Object.freeze([]),
  CONTRADICTED: Object.freeze([])
});

/** States a challenge may be raised against. */
const CHALLENGEABLE_STATES = Object.freeze(new Set(["VERIFIED", "PARTIAL", "UNKNOWN"]));

/** States a dependency failure may invalidate. */
const INVALIDATABLE_STATES = Object.freeze(new Set(["VERIFIED", "PARTIAL", "UNKNOWN"]));

/**
 * Type promotions that require an explicit promotion event carrying evidence
 * (§34). The key is the source type, the value the targets it may not reach on
 * its own. A promotion never happens as a side effect of re-classification.
 */
export const FORBIDDEN_TYPE_PROMOTIONS = Object.freeze({
  ANALOGY: Object.freeze(["DERIVED", "OBSERVED", "SOURCE_FACT", "COMPUTED", "EXECUTED"]),
  HYPOTHESIS: Object.freeze(["OBSERVED", "SOURCE_FACT", "EXECUTED"]),
  SPECULATION: Object.freeze(["OBSERVED", "SOURCE_FACT", "COMPUTED", "DERIVED", "EXECUTED"]),
  ESTIMATE: Object.freeze(["SOURCE_FACT", "OBSERVED"]),
  CODE_DRAFT: Object.freeze(["EXECUTED", "OBSERVED"]),
  UNKNOWN: Object.freeze(["SOURCE_FACT", "OBSERVED", "EXECUTED"])
});

/** The evidence event that authorises each promotion target. */
export const PROMOTION_EVIDENCE_KINDS = Object.freeze({
  DERIVED: "derivation_evidence",
  OBSERVED: "observation_evidence",
  SOURCE_FACT: "source_evidence",
  COMPUTED: "computation_evidence",
  EXECUTED: "execution_evidence"
});

export const FAILURE_CODES = Object.freeze({
  F01: "FABRICATED_SOURCE",
  F02: "SOURCE_DOES_NOT_SUPPORT_CLAIM",
  F03: "FABRICATED_EXPERIMENT",
  F04: "UNEXECUTED_CODE_PRESENTED_AS_EXECUTED",
  F05: "ARITHMETIC_ERROR",
  F06: "SYMBOLIC_DERIVATION_ERROR",
  F07: "DIMENSION_TYPE_ERROR",
  F08: "ANALOGY_PROMOTED_TO_FACT",
  F09: "HYPOTHESIS_PROMOTED_TO_OBSERVATION",
  F10: "INTERNAL_CONTRADICTION",
  F11: "UNKNOWN_PRESENTED_AS_KNOWN",
  F12: "ESTIMATE_PRESENTED_AS_OFFICIAL",
  F13: "SECONDARY_SOURCE_AS_PRIMARY",
  F14: "UNSUPPORTED_CAUSALITY",
  F15: "OVERGENERALIZATION",
  F16: "RECURSIVE_REPAIR_HALLUCINATION",
  F17: "CITATION_IDENTITY_MISMATCH",
  F18: "FALSE_VERIFICATION_CLAIM",
  F19: "EXPECTED_OUTPUT_PRESENTED_AS_OBSERVED",
  F20: "SOURCE_METADATA_RECOMBINATION",
  F21: "DOMAIN_INVARIANT_VIOLATION",
  F22: "TOOL_RESULT_MISREPRESENTATION",
  F23: "EPISTEMIC_PROMOTION_VIOLATION",
  F24: "DEPENDENT_CLAIM_NOT_INVALIDATED",
  F25: "CRITIQUE_ECHO_WITHOUT_VERIFICATION",
  F26: "REPAIR_SUMMARY_REINTRODUCES_UNVERIFIED_CLAIMS",
  F27: "VERIFIER_SCOPE_MISMATCH",
  F28: "PRINTED_ASSERTION_PRESENTED_AS_VERIFICATION",
  F29: "FAILED_SUBCHECK_HIDDEN_BY_SUCCESSFUL_SUBCHECK",
  F30: "CIRCULAR_VERIFICATION",
  F31: "ASSUMPTION_NOT_VERIFIED",
  F32: "DOMAIN_MODEL_MISMATCH",
  F33: "VERIFICATION_AGGREGATION_OVERCLAIM",
  F34: "SELF_CHALLENGE_NOT_PERSISTED",
  F35: "ASSUMPTION_PRESENTED_AS_PROOF",
  F36: "CORRECTIVE_STATE_REGRESSION",
  F37: "SOURCE_ASSUMPTION_PROMOTED_TO_FACT",
  F38: "MODEL_CAPABILITY_MISMATCH",
  F39: "UNRESOLVED_CHALLENGE_DEBT",
  F40: "PROOF_DEPENDENCY_NOT_AUDITED"
});

/**
 * The 0..5 scale agent.epistemic.blockSeverity is compared against. The default
 * threshold is 4, so HIGH and CRITICAL block and everything below is recorded.
 */
export const SEVERITY = Object.freeze({
  NONE: 0,
  INFO: 1,
  LOW: 2,
  MEDIUM: 3,
  HIGH: 4,
  CRITICAL: 5
});

/**
 * The classes §46 requires the deterministic native scan to treat as
 * high-severity. This set is what the plan states; it is the only part of the
 * severity assignment that is plan-grounded rather than chosen here.
 */
export const MANDATORY_HIGH_SEVERITY = Object.freeze(
  new Set(["F03", "F04", "F12", "F17", "F18", "F20", "F25"])
);

/**
 * Severity per failure code. The MANDATORY_HIGH_SEVERITY members are at or
 * above HIGH because §46 says so. The remaining assignments are this module's
 * reading of the taxonomy, not the plan's: fabrication and misrepresentation of
 * a result sit at HIGH, unearned promotion of a claim's type sits at MEDIUM,
 * and rhetorical overreach sits at LOW. Revisit them when QF-12 defines the
 * promotion gate, which is where a wrong level would first change a verdict.
 */
export const FAILURE_SEVERITY = Object.freeze({
  F01: SEVERITY.CRITICAL,
  F02: SEVERITY.HIGH,
  F03: SEVERITY.CRITICAL,
  F04: SEVERITY.HIGH,
  F05: SEVERITY.HIGH,
  F06: SEVERITY.HIGH,
  F07: SEVERITY.HIGH,
  F08: SEVERITY.MEDIUM,
  F09: SEVERITY.MEDIUM,
  F10: SEVERITY.HIGH,
  F11: SEVERITY.MEDIUM,
  F12: SEVERITY.HIGH,
  F13: SEVERITY.MEDIUM,
  F14: SEVERITY.LOW,
  F15: SEVERITY.LOW,
  F16: SEVERITY.HIGH,
  F17: SEVERITY.HIGH,
  F18: SEVERITY.CRITICAL,
  F19: SEVERITY.HIGH,
  F20: SEVERITY.HIGH,
  F21: SEVERITY.MEDIUM,
  F22: SEVERITY.HIGH,
  F23: SEVERITY.MEDIUM,
  F24: SEVERITY.HIGH,
  F25: SEVERITY.HIGH,
  F26: SEVERITY.HIGH,
  F27: SEVERITY.CRITICAL,
  F28: SEVERITY.HIGH,
  F29: SEVERITY.HIGH,
  F30: SEVERITY.HIGH,
  F31: SEVERITY.HIGH,
  F32: SEVERITY.HIGH,
  F33: SEVERITY.HIGH,
  F34: SEVERITY.HIGH,
  F35: SEVERITY.CRITICAL,
  F36: SEVERITY.CRITICAL,
  F37: SEVERITY.HIGH,
  F38: SEVERITY.HIGH,
  F39: SEVERITY.CRITICAL,
  F40: SEVERITY.HIGH
});

export class EpistemicStateError extends Error {
  constructor(code, from, to) {
    super(`${code}: ${from} -> ${to}`);
    this.name = "EpistemicStateError";
    this.code = code;
    this.from = from;
    this.to = to;
  }
}

/**
 * Assert that a claim may move from `from` to `to`.
 *
 * @param {string} from - current claim state.
 * @param {string} to - requested claim state.
 * @param {object} [options]
 * @param {string} [options.kind] - the authorising event for an exceptional
 *   transition: "challenge" or "dependency_failure".
 * @param {string} [options.reasonCode] - required for a dependency failure, so
 *   an invalidation always records which premise fell.
 * @returns {true}
 * @throws {EpistemicStateError}
 */
export function assertClaimTransition(from, to, options = {}) {
  if (!CLAIM_STATES.includes(from)) throw new EpistemicStateError("UNKNOWN_SOURCE_STATE", from, to);
  if (!CLAIM_STATES.includes(to)) throw new EpistemicStateError("UNKNOWN_TARGET_STATE", from, to);
  if (TERMINAL_CLAIM_STATES.has(from)) {
    throw new EpistemicStateError("TERMINAL_STATE_IMMUTABLE", from, to);
  }
  if (ALLOWED_CLAIM_TRANSITIONS[from].includes(to)) return true;

  const requiredKind = EXCEPTIONAL_TRANSITION_KINDS[to];
  if (!requiredKind || options.kind !== requiredKind) {
    throw new EpistemicStateError("INVALID_CLAIM_TRANSITION", from, to);
  }
  if (to === "CHALLENGED" && !CHALLENGEABLE_STATES.has(from)) {
    throw new EpistemicStateError("INVALID_CLAIM_TRANSITION", from, to);
  }
  if (to === "INVALIDATED") {
    if (!INVALIDATABLE_STATES.has(from)) {
      throw new EpistemicStateError("INVALID_CLAIM_TRANSITION", from, to);
    }
    if (!/^[A-Z][A-Z0-9_:-]{2,127}$/.test(String(options.reasonCode ?? ""))) {
      throw new EpistemicStateError("MISSING_DEPENDENCY_FAILURE_REASON", from, to);
    }
  }
  return true;
}

/**
 * Assert that a claim's type may change from `from` to `to`.
 *
 * A type is not a label the model may rewrite between turns: promoting an
 * analogy into a derivation, or a draft into an executed result, is the
 * mechanism behind F08, F09 and F23. Every forbidden promotion needs an
 * explicit evidence event naming what was actually produced.
 *
 * @param {string} from - current epistemic type.
 * @param {string} to - requested epistemic type.
 * @param {object} [options]
 * @param {string} [options.evidenceKind] - the produced evidence, e.g.
 *   "execution_evidence" for CODE_DRAFT -> EXECUTED.
 * @returns {true}
 * @throws {EpistemicStateError}
 */
export function assertTypePromotion(from, to, options = {}) {
  if (!EPISTEMIC_TYPES.includes(from)) throw new EpistemicStateError("UNKNOWN_SOURCE_TYPE", from, to);
  if (!EPISTEMIC_TYPES.includes(to)) throw new EpistemicStateError("UNKNOWN_TARGET_TYPE", from, to);
  if (from === to) return true;

  const forbidden = FORBIDDEN_TYPE_PROMOTIONS[from];
  if (!forbidden || !forbidden.includes(to)) return true;

  const requiredEvidence = PROMOTION_EVIDENCE_KINDS[to];
  if (!requiredEvidence || options.evidenceKind !== requiredEvidence) {
    throw new EpistemicStateError("UNAUTHORIZED_TYPE_PROMOTION", from, to);
  }
  return true;
}

/**
 * Whether a set of failure codes should block publication at the configured
 * threshold. An unknown code is treated as CRITICAL: a verifier that reports a
 * class this module does not know about is a reason to stop, not to continue.
 *
 * @param {string[]} failureCodes
 * @param {number} blockSeverity - agent.epistemic.blockSeverity.
 * @returns {boolean}
 */
export function blocksPublication(failureCodes, blockSeverity) {
  if (!Array.isArray(failureCodes) || failureCodes.length === 0) return false;
  const threshold = Number.isInteger(blockSeverity) ? blockSeverity : SEVERITY.HIGH;
  return failureCodes.some((code) => (FAILURE_SEVERITY[code] ?? SEVERITY.CRITICAL) >= threshold);
}
