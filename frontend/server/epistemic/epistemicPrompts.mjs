/**
 * DS4 Quantum Fix — prompts for the internal epistemic roles.
 *
 * Kept in one module (§28) so the exact text is reviewable in one place and a
 * change to what a role is asked shows up as a diff rather than as drift
 * inside a function.
 *
 * Every prompt here shares three constraints: the role does not judge truth,
 * does not agree or disagree with the user, and never outputs VERIFIED. These
 * components segment and classify; the verdict belongs to the verifiers.
 */

import { readFileSync } from "node:fs";

function loadRolePrompt(name) {
  return readFileSync(new URL(`./prompts/${name}`, import.meta.url), "utf8").trim();
}

export const SELF_CRITIQUE_PROMPT = loadRolePrompt("selfCritique.md");
export const ENTAILMENT_POLICY_PROMPT = loadRolePrompt("entailment.md");
export const REPAIR_PROMPT = loadRolePrompt("repair.md");

/**
 * §28. Segments a response into atomic, materially checkable propositions.
 *
 * Kept short on purpose: this runs per turn, and a long preamble buys nothing
 * that the JSON schema below does not already pin down.
 */
export const CLAIM_EXTRACTOR_PROMPT = `You are DS4's claim segmentation component.

Do not judge truth. Do not agree or disagree with the user. Do not rewrite the response.

Extract materially checkable propositions as atomic claims.
Split compound assertions. "GPT-3 uses X, which confirms Y" becomes:
  C1  GPT-3 uses X.
  C2  X confirms Y.   dependencies: ["C1"]

Assign exactly one preliminary type per claim:
SOURCE_FACT OBSERVED COMPUTED DERIVED INFERRED HYPOTHESIS ANALOGY SPECULATION ESTIMATE UNKNOWN

Set each flag true or false:
containsArithmetic containsSymbolicDerivation containsCitation containsExternalFact
assertsExecution assertsTest assertsBenchmark assertsObservation usesProtectedLanguage

Never output VERIFIED. A claim's status is not yours to assign.

Return JSON only, in this shape:
{"claims":[{"id":"C1","text":"...","epistemicType":"SOURCE_FACT","dependencies":[],"flags":{"containsArithmetic":false}}]}`;

/** The types the extractor may assign. VERIFIED is deliberately absent. */
export const EXTRACTOR_TYPES = Object.freeze([
  "SOURCE_FACT",
  "OBSERVED",
  "COMPUTED",
  "DERIVED",
  "INFERRED",
  "HYPOTHESIS",
  "ANALOGY",
  "SPECULATION",
  "ESTIMATE",
  "UNKNOWN"
]);

/** The flag names the extractor reports, in the order §28 lists them. */
export const CLAIM_FLAGS = Object.freeze([
  "containsArithmetic",
  "containsSymbolicDerivation",
  "containsCitation",
  "containsExternalFact",
  "assertsExecution",
  "assertsTest",
  "assertsBenchmark",
  "assertsObservation",
  "usesProtectedLanguage"
]);

/**
 * §29. Maps a user's criticism onto the claims it contests.
 *
 * The three prohibitions are the work package: the component must not agree
 * with the critic, must not reject the target, and must keep any replacement
 * proposition separate. A critic who is right is still a critic — being right
 * is what the verifiers establish, not what the phrasing asserts.
 */
export const CHALLENGE_EXTRACTOR_PROMPT = `You are DS4's challenge mapping component.

Treat both the prior answer and the user's criticism as unverified inputs.

Map the criticism to exact prior claim IDs.
Do not say the user is correct.
Do not reject the target claim.
Extract any replacement proposition separately as PROPOSED.
Return JSON only.

Shape:
{"challenges":[{"targetClaimId":"claim_...","challengeText":"...","proposedReplacement":"..."}]}
A replacement may be null when the criticism only disputes without proposing.`;

/**
 * §31. Judges whether retrieved passages support one atomic claim.
 *
 * The four distinctions are the work package. Each names a way a passage can
 * look like support without being it: an exponent relation read as a numeric
 * equality, an architectural fact read as a spectral consequence, a speculation
 * read as an observation, someone else's background read as the author's
 * result. A paper being about the right topic is not evidence.
 */
export const ENTAILMENT_PROMPT = `${ENTAILMENT_POLICY_PROMPT}

Do not use outside memory.
A passage is not evidence for a claim merely because the topic is related.
Distinguish an exponent relation from a numeric equality.
Distinguish quoted background from the author's own result.

Every span in supportingSpans must be copied verbatim from a passage supplied to this verifier.

Return JSON only, in this shape:
{"verdict":"SUPPORTED","supportingSpans":["..."],"unsupportedSubclaims":["..."],"reason":"..."}`;
