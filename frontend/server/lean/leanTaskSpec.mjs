// LeanTaskSpec — the sealed statement of what this turn is trying to prove
// (plan §11, §58-§60, §334-§346).
//
// The hole this closes: the tracker used to lock the target statement from the
// first result it saw. A first candidate of
//
//     theorem cauchy_mvt : True := by trivial
//
// therefore locked *itself* as the target, matched itself, and reached
// verified. Lean was never wrong — it really did check that term — but the
// task was answered by redefining it. §11.2 is explicit: the target may not be
// derived from the first lean_check.
//
// So the spec is created before any candidate exists, from the model's reading
// of the request, and sealed. From that point the target name, statement,
// profile and expected declarations are read-only; a candidate can change its
// proof body, imports and helper lemmas, never the thing being proved.

import { extractLeanTargetIdentity, LEAN_TARGET_IDENTITY_ALGORITHM } from "./leanTargetIdentity.mjs";

export const LEAN_TASKSPEC_MUTATION_ATTEMPT = "LEAN_TASKSPEC_MUTATION_ATTEMPT";
export const LEAN_TASK_MODES = Object.freeze(["proof", "utility"]);

const DECL_NAME_RE = /^[A-Za-z_À-ɏͰ-Ͽ℀-⅏][A-Za-z0-9_'.À-ɏͰ-Ͽ℀-⅏]*$/;

/**
 * Hash a bare declaration header the same way a header found inside a real
 * candidate is hashed, by reusing the one extractor rather than growing a
 * second normalizer that could drift from it.
 *
 * The synthetic `:= by sorry` tail only marks where the statement ends; it is
 * never sent to Lean.
 */
export function hashLeanTargetStatement(targetStatement, targetDeclaration) {
  const text = String(targetStatement ?? "").trim();
  if (!text) {
    return {
      ok: false,
      error: {
        code: "LEAN_TASKSPEC_STATEMENT_REQUIRED",
        message:
          "A proof task must state the theorem it intends to prove, as a Lean declaration header " +
          "(for example: theorem cauchy_mvt (f g : ℝ → ℝ) (hab : a < b) : ∃ c ∈ Ioo a b, ...)."
      }
    };
  }
  const source = /:=\s*by\b/.test(text) ? `${text}\n` : `${text} := by\n  sorry\n`;
  const identity = extractLeanTargetIdentity(source, targetDeclaration);
  if (!identity.ok) {
    return {
      ok: false,
      error: {
        code: "LEAN_TASKSPEC_STATEMENT_INVALID",
        message:
          `The declared target statement for '${targetDeclaration}' could not be read: ` +
          `${identity.error.message}`
      }
    };
  }
  return { ok: true, value: identity.value };
}

function deepFreeze(spec) {
  Object.freeze(spec.expectedDeclarations);
  Object.freeze(spec.unresolvedSymbols);
  return Object.freeze(spec);
}

/**
 * Build and seal a task spec.
 *
 * @returns {{ ok: true, value: object } | { ok: false, error: { code, message } }}
 */
export function createLeanTaskSpec({
  taskId = null,
  targetDeclaration,
  targetStatement,
  requiredProfile = "core",
  expectedDeclarations = [],
  taskMode = "proof",
  repositoryMutationAllowed = false,
  proofConstructionRequired = false,
  unresolvedSymbols = []
} = {}) {
  if (!LEAN_TASK_MODES.includes(taskMode)) {
    return {
      ok: false,
      error: { code: "LEAN_TASKSPEC_MODE_INVALID", message: `Unknown task mode '${taskMode}'.` }
    };
  }
  if (!targetDeclaration || !DECL_NAME_RE.test(String(targetDeclaration))) {
    return {
      ok: false,
      error: {
        code: "LEAN_TARGET_DECLARATION_REQUIRED",
        message: "A proof task must name the theorem/lemma it is trying to prove."
      }
    };
  }

  const hashed = hashLeanTargetStatement(targetStatement, targetDeclaration);
  if (!hashed.ok) return hashed;

  // §336 — the primary target decides task match; extra declarations are
  // required company, not interchangeable alternatives.
  const declarations = Array.from(
    new Set([String(targetDeclaration), ...(Array.isArray(expectedDeclarations) ? expectedDeclarations.map(String) : [])])
  );

  const spec = {
    taskId: taskId || `lean-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    taskMode,
    targetDeclaration: String(targetDeclaration),
    targetStatementText: hashed.value.statementText,
    targetStatementSha256: hashed.value.statementSha256,
    targetIdentityAlgorithm: LEAN_TARGET_IDENTITY_ALGORITHM,
    requiredProfile: String(requiredProfile || "core"),
    expectedDeclarations: declarations,
    unresolvedSymbols: Array.isArray(unresolvedSymbols) ? unresolvedSymbols.map(String) : [],
    repositoryMutationAllowed: repositoryMutationAllowed === true,
    proofConstructionRequired: proofConstructionRequired === true,
    sealed: true
  };

  return { ok: true, value: deepFreeze(spec) };
}

/**
 * Report an attempted change to a sealed spec. Object.freeze already refuses
 * the write in strict mode; this names the refusal so the orchestrator can log
 * and surface it instead of silently continuing (§60).
 */
export function assertLeanTaskSpecUnchanged(spec, { targetDeclaration, targetStatementSha256, requiredProfile } = {}) {
  if (!spec?.sealed) {
    return { ok: false, error: { code: "LEAN_TASKSPEC_NOT_SEALED", message: "No sealed Lean task spec for this turn." } };
  }
  const drift = [];
  if (targetDeclaration !== undefined && targetDeclaration !== null && targetDeclaration !== spec.targetDeclaration) {
    drift.push(`target declaration '${targetDeclaration}' != '${spec.targetDeclaration}'`);
  }
  if (
    targetStatementSha256 !== undefined &&
    targetStatementSha256 !== null &&
    targetStatementSha256 !== spec.targetStatementSha256
  ) {
    drift.push("target statement digest changed");
  }
  if (requiredProfile !== undefined && requiredProfile !== null && requiredProfile !== spec.requiredProfile) {
    drift.push(`profile '${requiredProfile}' != '${spec.requiredProfile}'`);
  }
  if (!drift.length) return { ok: true };
  return {
    ok: false,
    error: {
      code: LEAN_TASKSPEC_MUTATION_ATTEMPT,
      message: `The sealed Lean task spec may not change: ${drift.join("; ")}.`
    }
  };
}
