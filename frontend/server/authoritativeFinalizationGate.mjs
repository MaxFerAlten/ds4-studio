import { leanPublishedSourceAudit } from "./lean/leanTurnTracker.mjs";
import { containsReplacementCharacter } from "./utf8Integrity.mjs";

const SOURCE_MISMATCH_GUIDANCE =
  "LEAN_ANSWER_SOURCE_MISMATCH: the final answer must include the exact Lean source " +
  "that returned status=checked. Publish the checked source in a lean or lean4 fence.";

const CLAIM_GUIDANCE =
  "LEAN_VERIFIED_CLAIM_BLOCKED: no positive verification claim is allowed without " +
  "a checked run and the exact checked source. Continue the proof or answer " +
  "STATO: NOT_VERIFIED with the terminal reason.";

const TARGET_MISMATCH_GUIDANCE =
  "LEAN_TARGET_IDENTITY_MISMATCH: the checked source does not match the locked theorem statement. " +
  "Restore the locked target statement and verify that exact target.";

const PROFILE_MISMATCH_GUIDANCE =
  "LEAN_PROFILE_IDENTITY_MISMATCH: the proof was not elaborated under the profile this proof task was " +
  "locked on. Do not publish VERIFIED; profile integrity failed.";

const TASKSPEC_NOT_SEALED_GUIDANCE =
  "LEAN_TASKSPEC_NOT_SEALED: this proof task has no sealed target statement, so a checked source " +
  "cannot be promoted to VERIFIED. Restart the proof with lean_check task_mode=proof supplying " +
  "target_declaration and target_statement.";

const PRESENTATION_INTEGRITY_GUIDANCE =
  "LEAN_PRESENTATION_INTEGRITY_FAILED: the Lean source carries U+FFFD, so the bytes about to be " +
  "shown are not the bytes that were checked. Do not regenerate the proof — republish the retained " +
  "checked source verbatim in a lean fence.";

/**
 * Decide whether a completed assistant message may become authoritative state.
 * This function is deliberately pure so the route can gate both commit and SSE.
 */
export function evaluateLeanFinalCandidate({
  assistantContent,
  leanSnapshot,
  verifiedSource,
  claimDecision,
} = {}) {
  const snapshot = leanSnapshot || {};
  const used = Boolean(snapshot.proofId);

  if (!used) {
    return {
      allowed: true,
      terminal: false,
      mustContinue: false,
      code: "LEAN_NOT_ACTIVE",
      guidance: "",
      finishReason: null,
    };
  }

  if (snapshot.verified) {
    // §14.1/§176 — publication starts from a sealed task, not from a checked
    // source. Without a spec the target was whatever the first candidate said
    // it was, and "verified" would only mean Lean agreed with that candidate
    // about itself. Defence in depth: the tool boundary already refuses a
    // proof call that cannot be sealed.
    if (snapshot.taskSpecSealed !== true) {
      return {
        allowed: false,
        terminal: false,
        mustContinue: true,
        code: "LEAN_TASKSPEC_NOT_SEALED",
        guidance: TASKSPEC_NOT_SEALED_GUIDANCE,
        finishReason: null,
      };
    }

    // Defense in depth (WP07): exact source alone is not enough. The checked
    // bytes must be the locked target declaration and statement, and the
    // elaboration profile must round-trip.
    const targetIdentityMatches =
      snapshot.targetIdentityMatched === true &&
      Boolean(snapshot.targetStatementSha256) &&
      snapshot.checkedTargetStatementSha256 === snapshot.targetStatementSha256;

    if (!targetIdentityMatches) {
      return {
        allowed: false,
        terminal: false,
        mustContinue: true,
        code: "LEAN_TARGET_IDENTITY_MISMATCH",
        guidance: TARGET_MISMATCH_GUIDANCE,
        finishReason: null,
      };
    }

    if (
      Boolean(snapshot.profile) &&
      Boolean(snapshot.checkedProfile) &&
      snapshot.profile !== snapshot.checkedProfile
    ) {
      return {
        allowed: false,
        terminal: false,
        mustContinue: true,
        code: "LEAN_PROFILE_IDENTITY_MISMATCH",
        guidance: PROFILE_MISMATCH_GUIDANCE,
        finishReason: "lean_not_verified",
      };
    }

    // §78/§80 — formal source integrity and presentation integrity are
    // different properties, and the Cauchy regression had the first pass while
    // the second failed: Lean checked the right bytes, the transcript showed
    // U+FFFD. Publishing here would show the user a source that was never
    // verified, so the check runs before, not after, publication (§330).
    if (
      containsReplacementCharacter(verifiedSource) ||
      containsReplacementCharacter(assistantContent)
    ) {
      return {
        allowed: false,
        terminal: false,
        mustContinue: true,
        code: "LEAN_PRESENTATION_INTEGRITY_FAILED",
        guidance: PRESENTATION_INTEGRITY_GUIDANCE,
        finishReason: null,
      };
    }

    // §17/§47/§51 — the audit trail carries the digests, not just the verdict:
    // "published != retained" should be readable as two hashes.
    const sourceAudit = leanPublishedSourceAudit({
      answerText: assistantContent,
      verifiedSource,
      requireSource: true,
    });
    if (!sourceAudit.matches) {
      return {
        allowed: false,
        terminal: false,
        mustContinue: true,
        // piano..002 §51 calls this LEAN_PUBLISHED_SOURCE_MISMATCH; the repo
        // already ships the same condition under the name the earlier
        // reconciliation plan fixed, and the model reads it in the guidance.
        code: "LEAN_ANSWER_SOURCE_MISMATCH",
        guidance: SOURCE_MISMATCH_GUIDANCE,
        finishReason: null,
        retainedSourceSha256: sourceAudit.retainedSourceSha256,
        publishedSourceSha256: sourceAudit.publishedSourceSha256,
      };
    }

    return {
      allowed: true,
      terminal: true,
      mustContinue: false,
      code: "LEAN_VERIFIED",
      guidance: "",
      finishReason: "lean_verified",
      taskId: snapshot.taskId ?? null,
      retainedSourceSha256: sourceAudit.retainedSourceSha256,
      publishedSourceSha256: sourceAudit.publishedSourceSha256,
    };
  }

  if (claimDecision?.block) {
    return {
      allowed: false,
      terminal: false,
      mustContinue: true,
      code: claimDecision.type || "LEAN_VERIFIED_CLAIM_BLOCKED",
      guidance: `${CLAIM_GUIDANCE}\n${claimDecision.guidance || ""}`.trim(),
      finishReason: null,
    };
  }

  if (!snapshot.terminal) {
    return {
      allowed: false,
      terminal: false,
      mustContinue: true,
      code: "LEAN_FINALIZATION_BLOCKED",
      guidance:
        "LEAN_FINALIZATION_BLOCKED: the current Lean task is repairable. " +
        "Follow orchestration.nextAction and call lean_check again in this proof task.",
      finishReason: null,
    };
  }

  return {
    allowed: true,
    terminal: true,
    mustContinue: false,
    code: "LEAN_NOT_VERIFIED",
    guidance: "",
    finishReason: "lean_not_verified",
  };
}
