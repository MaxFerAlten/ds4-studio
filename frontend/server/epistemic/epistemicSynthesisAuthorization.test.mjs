/**
 * Q2-013 (remediation.Quantiom.002 §17, §54, §68) — EPI-076.
 *
 * The final paragraph is where a narrow checked theorem, an unfinished proof
 * and an analogy were added together into "three formally verified pillars".
 * A summary is a claim, and it cannot outrank the weakest thing it rests on.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SYNTHESIS_AUTHORITY,
  synthesisAuthorityForClaim,
  evaluateSynthesisAuthorization,
  assessSynthesisAuthorization
} from "./epistemicSynthesisAuthorization.mjs";

const verified = { id: "C1", text: "Constructor injectivity holds.", status: "VERIFIED", epistemicType: "DERIVED" };
const unknown = { id: "C2", text: "The superposition decomposition holds.", status: "UNKNOWN", epistemicType: "DERIVED" };
const hypothesis = { id: "C3", text: "The Transformer evolves unitarily.", status: "PROPOSED", epistemicType: "HYPOTHESIS" };
const analogy = { id: "C4", text: "Attention is a measurement.", status: "PROPOSED", epistemicType: "ANALOGY" };
const partial = { id: "C5", text: "The paper is identified.", status: "PARTIAL", epistemicType: "SOURCE_FACT" };

test("Q2-013 (§17): a component's authority is the weaker of its status and its type", () => {
  assert.equal(synthesisAuthorityForClaim(verified), SYNTHESIS_AUTHORITY.VERIFIED_FACT);
  assert.equal(synthesisAuthorityForClaim(partial), SYNTHESIS_AUTHORITY.PARTIAL);
  assert.equal(synthesisAuthorityForClaim(analogy), SYNTHESIS_AUTHORITY.QUALIFIED_ANALOGY);
  assert.equal(synthesisAuthorityForClaim(hypothesis), SYNTHESIS_AUTHORITY.HYPOTHESIS);
  assert.equal(synthesisAuthorityForClaim(unknown), SYNTHESIS_AUTHORITY.UNKNOWN);
  // A VERIFIED status does not lift an analogy: the type is the ceiling.
  assert.equal(
    synthesisAuthorityForClaim({ ...analogy, status: "VERIFIED" }),
    SYNTHESIS_AUTHORITY.QUALIFIED_ANALOGY
  );
});

test("Q2-013 (§68): the summary cannot outrank the weakest component", () => {
  const result = evaluateSynthesisAuthorization({
    summaryClaim: { id: "S1", text: "Tutte le dimostrazioni Lean verificano i tre pilastri." },
    referencedClaimIds: ["C1", "C2", "C3"],
    claims: [verified, unknown, hypothesis]
  });
  assert.equal(result.allowed, false);
  assert.equal(result.maxAssertionLevel, SYNTHESIS_AUTHORITY.UNKNOWN);
  assert.equal(result.weakestStatus, "UNKNOWN");
  assert.ok(result.failureCodes.includes("F33"));
});

test("Q2-013 (§17): every component verified allows the aggregate", () => {
  const result = evaluateSynthesisAuthorization({
    summaryClaim: { id: "S1", text: "Abbiamo verificato entrambi i risultati." },
    referencedClaimIds: ["C1"],
    claims: [verified]
  });
  assert.equal(result.allowed, true);
  assert.equal(result.maxAssertionLevel, SYNTHESIS_AUTHORITY.VERIFIED_FACT);
  assert.deepEqual(result.failureCodes, []);
});

test("Q2-013 (§17): a referenced claim that does not exist is uncovered, not verified", () => {
  const result = evaluateSynthesisAuthorization({
    summaryClaim: { id: "S1", text: "Tutti i risultati sono formalmente verificati." },
    referencedClaimIds: ["C1", "C9"],
    claims: [verified]
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.uncoveredClaimIds, ["C9"]);
  assert.ok(result.failureCodes.includes("F33"));
});

test("EPI-076 (§17): partial formal results aggregated as full formal verification are blocked", () => {
  const content =
    "In conclusione, le dimostrazioni Lean fornite verificano formalmente i tre pilastri matematici " +
    "del collegamento QHO-LLM.";
  const decision = assessSynthesisAuthorization({
    assistantContent: content,
    claims: [verified, unknown, hypothesis, partial]
  });
  assert.ok(decision, "an aggregate over an UNKNOWN component must block");
  assert.equal(decision.code, "EPISTEMIC_SYNTHESIS_OVERCLAIM");
  assert.ok(decision.failureCodes.includes("F33"));
  assert.ok(decision.failureCodes.includes("F18"));
});

test("EPI-076 (§54): 'all proven' over VERIFIED + UNKNOWN + ANALOGY is blocked", () => {
  const decision = assessSynthesisAuthorization({
    assistantContent: "All of these results are verified.",
    claims: [verified, unknown, analogy]
  });
  assert.ok(decision);
  assert.ok(decision.failureCodes.includes("F33"));
});

test("EPI-076: the honest summary over the same components is allowed", () => {
  const content =
    "Solo l'iniettivita del costruttore e stata verificata da Lean; la decomposizione in " +
    "sovrapposizione resta non verificata e l'unitarieta del Transformer resta un'ipotesi.";
  assert.equal(
    assessSynthesisAuthorization({
      assistantContent: content,
      claims: [verified, unknown, hypothesis]
    }),
    null
  );
});

test("Q2-013: an answer with no aggregate wording is untouched", () => {
  assert.equal(
    assessSynthesisAuthorization({
      assistantContent: "The build completed successfully.",
      claims: [unknown]
    }),
    null
  );
});

test("Q2-013: aggregate wording over uniformly verified components is allowed", () => {
  assert.equal(
    assessSynthesisAuthorization({
      assistantContent: "Tutti i risultati sono formalmente verificati.",
      claims: [verified, { ...partial, status: "VERIFIED" }]
    }),
    null
  );
});

test("Q2-013 (§37): a 'Conclusioni dimostrate' heading over unsettled claims is blocked", () => {
  const decision = assessSynthesisAuthorization({
    assistantContent: "## Conclusioni dimostrate\n\nIl collegamento QHO-LLM regge.",
    claims: [unknown]
  });
  assert.ok(decision, "a proven-conclusions heading must be authorized by its claims");
  assert.ok(decision.failureCodes.includes("F33"));
});
