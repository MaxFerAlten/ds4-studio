/**
 * DS4 Quantum Fix — epistemic finalization gate.
 *
 * QF-13 §35. The last thing that runs before a completed answer becomes state
 * the user sees. Pure, in the style of authoritativeFinalizationGate.mjs — the
 * route needs the same decision for the commit and for the SSE, so the decision
 * cannot depend on which one asks. None of the Lean logic is reused; §35 asks
 * for that file's shape, not its rules.
 *
 * Seven conditions must block in mode=block. Each is a way an answer can look
 * settled while resting on nothing: a high-severity failure still live in the
 * text, an empirical assertion with no evidence, a citation whose identifier
 * names another paper, an execution claim with no run behind it, a critique
 * accepted because it was voiced, a repair summary carrying back the claims the
 * repair was for, and a claim whose premise fell being rendered as true.
 */

import { TERMINAL_CLAIM_STATES } from "./epistemicContracts.mjs";
import { detectSycophancy } from "./epistemicChallengeExtractor.mjs";
import { verifyExecutionClaim } from "./epistemicExecutionVerifier.mjs";
import { assessAnalogyAuthorization } from "./epistemicAnalogyAuthorization.mjs";
import { assessBibliographicAuthorization } from "./epistemicSourceIdentityAuthority.mjs";
import { assessSynthesisAuthorization } from "./epistemicSynthesisAuthorization.mjs";
import { evaluateClaimCoverage } from "./epistemicClaimCoverage.mjs";
import { unboundVerifiedArtifacts } from "./epistemicFormalArtifactBinding.mjs";
import {
  claimSatisfiesMechanism,
  isStrictContract,
  requiredMechanismsForClaim
} from "./epistemicUserVerificationContract.mjs";
import { assessVerificationAuthorization } from "./epistemicVerificationClaimAuthorization.mjs";

const GUIDANCE = Object.freeze({
  SEVERITY:
    "EPISTEMIC_SEVERITY_UNRESOLVED: this answer carries a high-severity epistemic failure that was " +
    "never resolved. Correct or retract the affected claim, or state plainly that it is unverified.",
  EMPIRICAL:
    "EPISTEMIC_UNSUPPORTED_EMPIRICAL_CLAIM: an assertion about what was measured, executed or verified " +
    "has no evidence attached. Produce the evidence, or restate it as something you have not checked.",
  CITATION:
    "EPISTEMIC_CITATION_IDENTITY_MISMATCH: a citation's identifier does not resolve to the work named. " +
    "Resolve the identifier or drop it; do not publish the citation as verified.",
  EXECUTION:
    "EPISTEMIC_EXECUTION_CLAIM_WITHOUT_TRACE: the answer says code ran, was tested or passed, and this " +
    "turn has no tool record of it. Run it, or say it has not been run.",
  CHALLENGE:
    "EPISTEMIC_CHALLENGE_ACCEPTED_WITHOUT_VERIFICATION: the critique was accepted without anything being " +
    "checked. Verify the correction before agreeing with it; being told is not evidence.",
  REPAIR:
    "EPISTEMIC_REPAIR_SUMMARY_CONTAMINATED: the repair summary carries claims that are still unverified. " +
    "A summary of a repair may only restate what the repair verified.",
  DEPENDENCY:
    "EPISTEMIC_DEPENDENCY_INVALID_CLAIM_RENDERED: a claim whose premise was invalidated is being presented " +
    "as true. Re-verify the premise or withdraw everything that rested on it.",
  VERIFICATION_INCOMPLETE:
    "EPISTEMIC_VERIFICATION_INCOMPLETE: the answer contains a claim that requires verification, " +
    "but one or more required checks did not reach a conclusive state. Run the missing verifier, " +
    "or rewrite the claim explicitly as unverified or unknown.",
  UNKNOWN_AUTHORITY:
    "A claim whose verification state is UNKNOWN uses authoritative wording. Label it unverified " +
    "or unknown, or obtain claim-specific evidence.",
  PARTIAL_AUTHORITY:
    "A claim whose verification state is PARTIAL uses authoritative wording. Qualify the supported " +
    "portion and leave the unresolved portion explicit.",
  REFUTED:
    "EPISTEMIC_REFUTED_CLAIM_RENDERED: a verifier rejected or contradicted a claim that is still " +
    "present in this candidate. Remove or correct the claim before publication."
});

const CLEAN = Object.freeze({
  allowed: true,
  terminal: false,
  mustContinue: false,
  code: "EPISTEMIC_CLEAN",
  guidance: "",
  finishReason: null,
  blockedClaimIds: Object.freeze([]),
  wouldBlock: false
});

const INACTIVE = Object.freeze({
  ...CLEAN,
  code: "EPISTEMIC_NOT_ACTIVE"
});

/** Claims still standing as knowledge: not rejected, not contradicted. */
function live(claims) {
  return claims.filter((c) => c && !TERMINAL_CLAIM_STATES.has(c.status));
}

/**
 * Whether a claim asserts something empirical — measured, executed, observed,
 * verified — as opposed to reasoning the reader can follow unaided.
 */
function isEmpirical(claim) {
  if (claim?.flags?.usesProtectedLanguage === true) return true;
  const requirements = Array.isArray(claim?.verificationRequirements) ? claim.verificationRequirements : [];
  return requirements.some((r) =>
    [
      "execution_evidence",
      "test_evidence",
      "benchmark_evidence",
      "observation_evidence",
      "analysis_execution_or_source_artifact",
      "source_identity",
      "source_entailment",
      "primary_source",
      "verifier_result"
    ].includes(r)
  );
}

function claimsWithUnsettledAuthority(claims, status) {
  return claims.filter(
    (claim) => claim.status === status && claim.flags?.usesProtectedLanguage === true
  );
}

function challengeHasBoundEvidence(challenge, claims, evidence) {
  const target = claims.find((claim) => claim.id === challenge?.targetClaimId);
  if (!target) return false;
  const items = new Map(evidence.map((item) => [item?.id, item]));
  return (target.verifierResults ?? [])
    .filter((result) => result?.status === "PASSED" || result?.status === "FAILED")
    .some((result) =>
      (result.evidenceIds ?? []).some((id) => {
        const item = items.get(id);
        return item && (item.supportsClaimIds ?? []).includes(target.id);
      })
    );
}

/**
 * Decide whether a completed assistant message may be published.
 *
 * @param {object} input
 * @param {string} [input.assistantContent] - the completed response.
 * @param {object[]} [input.claims] - this turn's claims, from the ledger.
 * @param {object[]} [input.evidence] - this turn's evidence items.
 * @param {object[]} [input.sourceCertificates] - retrieved bibliographic identity records.
 * @param {object[]} [input.challenges] - challenges raised against prior claims this turn.
 * @param {{summarizing?: boolean, round?: number}} [input.repairState]
 * @param {object} [input.config] - the agent.epistemic config block.
 * @returns {{allowed: boolean, terminal: boolean, mustContinue: boolean, code: string, guidance: string, finishReason: string|null, blockedClaimIds: string[]}}
 */
export function evaluateEpistemicFinalCandidate({
  assistantContent = "",
  claims = [],
  evidence = [],
  challenges = [],
  bridges = [],
  sourceCertificates = [],
  verificationContract = null,
  extractionStatus = "EXTRACTION_PARTIAL",
  leanCertificates = [],
  formalArtifacts = [],
  repairState = null,
  config = {}
} = {}) {
  if (config?.enabled !== true || config?.mode === "off") return INACTIVE;

  const content = String(assistantContent ?? "");
  const allClaims = Array.isArray(claims) ? claims.filter(Boolean) : [];
  const liveClaims = live(allClaims);
  const items = Array.isArray(evidence) ? evidence : [];
  const blockSeverity = Number.isInteger(config.blockSeverity) ? config.blockSeverity : 4;

  const block = (code, guidance, blockedClaimIds = []) => ({
    // shadow and warn observe without changing the turn: the finding is
    // reported either way, and only mode=block withholds the answer.
    allowed: config.mode !== "block",
    terminal: false,
    mustContinue: config.mode === "block",
    code,
    guidance,
    finishReason: null,
    blockedClaimIds: [...new Set(blockedClaimIds.filter(Boolean))],
    // §37: shadow keeps streaming and reports what block mode would have done.
    // The finding is the same either way; this says whether it was acted on.
    wouldBlock: true
  });

  // 1. A high-severity failure still attached to a claim the answer stands on.
  const refutedInCandidate = allClaims.filter(
    (claim) =>
      TERMINAL_CLAIM_STATES.has(claim.status) &&
      Array.isArray(claim.failureCodes) &&
      claim.failureCodes.length > 0
  );
  if (refutedInCandidate.length > 0) {
    return block(
      "EPISTEMIC_REFUTED_CLAIM_RENDERED",
      GUIDANCE.REFUTED,
      refutedInCandidate.map((claim) => claim.id)
    );
  }

  const severe = liveClaims.filter((c) => Number.isInteger(c.severity) && c.severity >= blockSeverity);
  if (severe.length > 0) {
    return block("EPISTEMIC_SEVERITY_UNRESOLVED", GUIDANCE.SEVERITY, severe.map((c) => c.id));
  }

  const unknownAuthority = claimsWithUnsettledAuthority(liveClaims, "UNKNOWN");
  if (unknownAuthority.length > 0) {
    return block(
      "EPISTEMIC_UNKNOWN_RENDERED_AS_KNOWN",
      GUIDANCE.UNKNOWN_AUTHORITY,
      unknownAuthority.map((claim) => claim.id)
    );
  }
  const partialAuthority = claimsWithUnsettledAuthority(liveClaims, "PARTIAL");
  if (partialAuthority.length > 0) {
    return block(
      "EPISTEMIC_PARTIAL_RENDERED_AS_KNOWN",
      GUIDANCE.PARTIAL_AUTHORITY,
      partialAuthority.map((claim) => claim.id)
    );
  }

  // 2. An empirical assertion with nothing behind it.
  const unsupported = liveClaims.filter(
    (c) => isEmpirical(c) && c.status !== "VERIFIED" && (c.evidenceIds?.length ?? 0) === 0
  );
  if (unsupported.length > 0) {
    return block("EPISTEMIC_UNSUPPORTED_EMPIRICAL_CLAIM", GUIDANCE.EMPIRICAL, unsupported.map((c) => c.id));
  }

  // 3. A citation whose identifier names a different work, or none.
  if (config.verifyCitations !== false) {
    const mismatched = liveClaims.filter((c) =>
      (c.failureCodes ?? []).some((code) => code === "F17" || code === "F01")
    );
    if (mismatched.length > 0) {
      return block("EPISTEMIC_CITATION_IDENTITY_MISMATCH", GUIDANCE.CITATION, mismatched.map((c) => c.id));
    }
  }

  // 4. EPI-010: the answer says something ran and this turn has no record of it.
  if (config.verifyExecutionClaims !== false) {
    const execution = verifyExecutionClaim({ claim: content, evidence: items });
    if (execution.block) {
      return block(
        "EPISTEMIC_EXECUTION_CLAIM_WITHOUT_TRACE",
        `${GUIDANCE.EXECUTION} (${execution.reason})`,
        []
      );
    }
  }

  // 5. EPI-016: the critique was accepted because it was voiced.
  if (config.verifyChallenges !== false && challenges.length > 0) {
    const sycophancy = detectSycophancy(content, {
      isReplyToChallenge: true,
      // Evidence produced this turn is what turns conceding into checking.
      hasNewEvidence: challenges.every((challenge) =>
        challengeHasBoundEvidence(challenge, allClaims, items)
      )
    });
    if (sycophancy.sycophantic) {
      return block(
        "EPISTEMIC_CHALLENGE_ACCEPTED_WITHOUT_VERIFICATION",
        `${GUIDANCE.CHALLENGE} (${sycophancy.reason})`,
        challenges.map((c) => c?.targetClaimId)
      );
    }
  }

  // 6. F26: a repair summary may only restate what the repair verified.
  if (config.strictRepair !== false && repairState?.summarizing === true) {
    const contaminated = liveClaims.filter((c) => c.status !== "VERIFIED");
    if (contaminated.length > 0) {
      return block("EPISTEMIC_REPAIR_SUMMARY_CONTAMINATED", GUIDANCE.REPAIR, contaminated.map((c) => c.id));
    }
  }

  // 7. F24: the premise fell and what rested on it is still being asserted.
  const orphaned = liveClaims.filter(
    (c) => c.status === "INVALIDATED" || (c.failureCodes ?? []).includes("F24")
  );
  if (orphaned.length > 0) {
    return block("EPISTEMIC_DEPENDENCY_INVALID_CLAIM_RENDERED", GUIDANCE.DEPENDENCY, orphaned.map((c) => c.id));
  }

  const unsettled = liveClaims.filter((claim) => {
    const requirements = Array.isArray(claim.verificationRequirements)
      ? claim.verificationRequirements
      : [];
    if (requirements.length === 0) return false;
    return ![
      "VERIFIED",
      "PARTIAL",
      "REJECTED",
      "CONTRADICTED",
      "UNKNOWN",
      "INVALIDATED"
    ].includes(claim.status);
  });
  if (unsettled.length > 0) {
    return block(
      "EPISTEMIC_VERIFICATION_INCOMPLETE",
      GUIDANCE.VERIFICATION_INCOMPLETE,
      unsettled.map((claim) => claim.id)
    );
  }

  // Q2-003/Q2-014: a strict all-claims contract cannot publish when the
  // extractor was partial or an assertive span never became a claim.
  const claimCoverage = evaluateClaimCoverage({
    assistantContent: content,
    claims: allClaims,
    verificationContract,
    extractionStatus
  });
  if (!claimCoverage.complete) {
    return block(
      "EPISTEMIC_STRICT_CLAIM_COVERAGE_INCOMPLETE",
      "The user required every assertive claim to be verified; remove uncovered claims or disclose that full coverage was not achieved.",
      []
    );
  }

  // Q2-004/Q2-015: protected proof headings authorize only the exact source
  // bytes bound to a successful matching Lean certificate.
  const unboundArtifacts = unboundVerifiedArtifacts(formalArtifacts);
  if (unboundArtifacts.length > 0) {
    return block(
      "EPISTEMIC_FORMAL_ARTIFACT_UNBOUND",
      "A displayed Lean proof is not the exact successfully checked source. Remove it, label it unverified, or bind the checked bytes.",
      []
    );
  }

  // Q2-014/Q2-017: under a strict contract, a passing verifier of the wrong
  // kind is not a substitute for the mechanism the claim actually requires.
  if (isStrictContract(verificationContract)) {
    const mechanismDebt = liveClaims.filter((claim) =>
      requiredMechanismsForClaim({ claim, verificationContract }).some(
        (requirement) => !claimSatisfiesMechanism(claim, requirement, leanCertificates)
      )
    );
    if (mechanismDebt.length > 0) {
      return block(
        "EPISTEMIC_USER_VERIFICATION_CONTRACT_VIOLATION",
        "One or more claims do not have the verification mechanism required by the user's governing contract.",
        mechanismDebt.map((claim) => claim.id)
      );
    }
  }

  // Q2-011: a paper is identified by a primary record, and reviewed by a venue.
  // Neither follows from having seen the title in a search overview.
  const bibliographic = assessBibliographicAuthorization({
    assistantContent: content,
    claims: liveClaims,
    sourceCertificates
  });
  if (bibliographic) {
    return block(bibliographic.code, bibliographic.guidance, bibliographic.blockedClaimIds);
  }

  // Q2-010: ANALOGY/HYPOTHESIS claims cannot be rendered as literal real-world
  // mechanisms unless an evidence-backed, claim-bound modeling bridge lifts
  // their authority. Explicit analogy wording remains publishable.
  const analogyAuthorization = assessAnalogyAuthorization({
    assistantContent: content,
    claims: liveClaims,
    bridges
  });
  if (analogyAuthorization) {
    return block(
      analogyAuthorization.code,
      analogyAuthorization.guidance,
      analogyAuthorization.blockedClaimIds
    );
  }

  // Q2-013 (§17, §68): the closing summary is a claim about the other claims,
  // and it cannot outrank the weakest one it aggregates.
  const synthesis = assessSynthesisAuthorization({
    assistantContent: content,
    claims: liveClaims
  });
  if (synthesis) {
    return block(synthesis.code, synthesis.guidance, synthesis.blockedClaimIds);
  }

  // 8. R04: protected verification wording may not exceed what the claim-bound
  // certificate/scope authorizes. Ran after every other block so a turn that is
  // already REFUTED/SEVERITY/UNKNOWN/PARTIAL keeps its earlier, more specific
  // decision; this only fires on a candidate that would otherwise be CLEAN yet
  // still over-claims ("Sage verified the full QHO ladder algebra" when the
  // certificate only covers one simplification, or a protected phrase bound to
  // no claim at all).
  if (config.verifyVerificationLanguage !== false) {
    const authorization = assessVerificationAuthorization({
      assistantContent: content,
      claims: liveClaims
    });
    if (authorization) {
      return block(
        authorization.code,
        authorization.guidance,
        authorization.blockedClaimIds
      );
    }
  }

  return CLEAN;
}
