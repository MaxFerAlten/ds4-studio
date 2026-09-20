/**
 * DS4 Quantum Fix — self-critique mode.
 *
 * QF-17 §39. The behaviour this removes is the three-step one: a critique
 * arrives, the assistant says "hai ragione", and then paraphrases the critique
 * as if agreeing with it had established anything. Nothing was checked at any
 * point, and the answer changed.
 *
 * So this produces verification requests, never state changes. Asked to
 * self-criticise, it says which claims need which verifier and stops there;
 * the states move when the verifiers come back, which is what EPI-017 requires.
 * Agreement carries weight zero (§39) — not "less weight", zero, because a
 * critic being right is something the verifiers establish and the phrasing
 * never does.
 */

import { CONCESSION_PATTERN } from "./epistemicChallengeExtractor.mjs";
import { deterministicClaims, requirementsForFlags } from "./epistemicClaimExtractor.mjs";

/**
 * §39. Agreement is not evidence, and this is the number that says so.
 *
 * It exists as a named constant rather than as an omission so the rule is
 * visible: no code path may weigh a concession above zero.
 */
export const AGREEMENT_WEIGHT = 0;

/** A request to review one's own output, in either language. */
export const SELF_CRITIQUE_REQUEST =
  /\b(fai (?:un')?autocritica|autocritica|critica (?:il tuo|la tua)|rivedi (?:il tuo|la tua)|controlla il tuo (?:output|lavoro)|self[- ]critique|criticise your own|criticize your own|review your own (?:answer|output|work)|check your own work|what did you get wrong)\b/iu;

/** Which verifier answers each verification requirement. */
export const VERIFIER_FOR = Object.freeze({
  math_verification: "epistemicMathVerifier",
  symbolic_verification: "epistemicMathVerifier",
  source_identity: "epistemicCitationIdentity",
  primary_source: "epistemicCitationIdentity",
  source_entailment: "epistemicEntailment",
  execution_evidence: "epistemicExecutionVerifier",
  test_evidence: "epistemicExecutionVerifier",
  benchmark_evidence: "epistemicExecutionVerifier",
  observation_evidence: "epistemicExecutionVerifier",
  verifier_result: "epistemicExecutionVerifier"
});

/** Whether the user asked for a self-critique. */
export function isSelfCritiqueRequest(text) {
  return SELF_CRITIQUE_REQUEST.test(String(text ?? ""));
}

/**
 * Weigh a concession in the assistant's own text.
 *
 * The concession is detected — it is worth knowing it happened — and then
 * weighed at zero. Detecting without weighing is the whole point.
 */
export function weighAgreement(text) {
  const match = String(text ?? "").match(CONCESSION_PATTERN);
  return { conceded: Boolean(match), phrase: match?.[0] ?? null, weight: AGREEMENT_WEIGHT };
}

/** The requirements a claim still owes: the ones no verifier result answers. */
function outstandingRequirements(claim) {
  const answered = new Set(
    (claim.verifierResults ?? [])
      .filter((r) => r?.status === "PASSED" || r?.status === "FAILED")
      .map((r) => r?.requirement)
      .filter(Boolean)
  );
  const declared = Array.isArray(claim.verificationRequirements) ? claim.verificationRequirements : [];
  const derived = declared.length > 0 ? declared : requirementsForFlags(claim.flags ?? {});
  return [...new Set(derived)].filter((r) => !answered.has(r));
}

/**
 * Plan a self-critique pass.
 *
 * Returns what must be checked and, deliberately, nothing else: `stateChanges`
 * is always empty. A self-critique that moved states would be the failure it
 * exists to prevent, with the verdict coming from the request rather than from
 * a verifier.
 *
 * @param {object} input
 * @param {string} [input.assistantContent] - the answer being criticised.
 * @param {object[]} [input.claims] - claims already extracted from it.
 * @param {object[]} [input.challenges] - challenges raised this turn (QF-07).
 * @param {string} [input.userText] - the user's message, checked for the request.
 * @returns {{triggered: boolean, requests: object[], stateChanges: never[], agreementWeight: number, agreement: object, source: string}}
 */
/**
 * Q2-020 (remediation.Quantiom.002 §39) — the questions a self-critique must ask.
 *
 * The QHO transcript's own reasoning contained a correct self-critique ("the
 * naive shift operators do NOT satisfy the CCR") and the final answer published
 * the original claim anyway. Each entry names the module that can answer the
 * question, because a self-critique that answers its own questions is the
 * failure this file exists to prevent: these are requests, never verdicts.
 */
export const SELF_CRITIQUE_CHECKS = Object.freeze([
  Object.freeze({
    id: "SC-FORMAL-FAILURE-REAPPEARED",
    question: "Did a formalization that failed earlier reappear as verified?",
    answeredBy: "epistemicChallengeDebt"
  }),
  Object.freeze({
    id: "SC-THEOREM-NAME-LAUNDERING",
    question: "Does a theorem name or docstring claim more than its statement?",
    answeredBy: "epistemicLeanAxiomAudit"
  }),
  Object.freeze({
    id: "SC-ARTIFACT-PROVENANCE",
    question: "Is every displayed proof the exact source that was checked?",
    answeredBy: "epistemicFormalArtifactBinding"
  }),
  Object.freeze({
    id: "SC-SOURCE-ROLE",
    question: "Did an assumption or model in a source become a fact about the world?",
    answeredBy: "epistemicSourceRole"
  }),
  Object.freeze({
    id: "SC-SYNTHESIS-AUTHORITY",
    question: "Does the closing summary exceed the authority of its components?",
    answeredBy: "epistemicSynthesisAuthorization"
  }),
  Object.freeze({
    id: "SC-USER-CONTRACT",
    question: "Was the user's verification contract weakened anywhere in this turn?",
    answeredBy: "epistemicUserVerificationContract"
  })
]);

export function planSelfCritique({
  assistantContent = "",
  claims = [],
  challenges = [],
  userText = ""
} = {}) {
  const content = String(assistantContent ?? "");
  // A challenge is a request to re-examine even when nobody used the word.
  const triggered = isSelfCritiqueRequest(userText) || challenges.length > 0;

  const known = Array.isArray(claims) ? claims.filter(Boolean) : [];
  // Without extracted claims the high-risk wording is still there to be found,
  // and a self-critique that inspected nothing would be the empty gesture.
  const subjects = known.length > 0 ? known : deterministicClaims(content);
  const source = known.length > 0 ? "claims" : "lexical";

  const challengedIds = new Set(challenges.map((c) => c?.targetClaimId).filter(Boolean));
  const requests = [];
  for (const claim of subjects) {
    for (const requirement of outstandingRequirements(claim)) {
      requests.push({
        claimId: claim.id,
        requirement,
        verifier: VERIFIER_FOR[requirement] ?? null,
        // Why this claim is being re-examined, so a reader can tell a routine
        // check from one a critique provoked.
        reason: challengedIds.has(claim.id) ? "challenged" : "self_critique",
        claimText: claim.text
      });
    }
  }

  return {
    triggered,
    requests,
    // EPI-017: requests first, states afterwards, and never from here.
    stateChanges: [],
    agreementWeight: AGREEMENT_WEIGHT,
    agreement: weighAgreement(content),
    // §39: the checks are questions for the named verifiers, so they travel
    // with the plan and carry no verdict of their own.
    checks: SELF_CRITIQUE_CHECKS,
    source
  };
}
