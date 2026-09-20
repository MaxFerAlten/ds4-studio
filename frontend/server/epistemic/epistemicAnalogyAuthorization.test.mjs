/**
 * Q2-010 (remediation.Quantiom.002 §13, §51) — EPI-073.
 *
 * An analogy may be rendered as an analogy. Promoting it to a mechanism claim
 * about a real LLM needs a verified modeling bridge, and there isn't one.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ANALOGY_AUTHORITY,
  assessAnalogyAuthorization,
  analogyAuthorityForClaim
} from "./epistemicAnalogyAuthorization.mjs";
import {
  MODELING_BRIDGE_STATUS,
  createModelingBridge,
  requiredBridgeForClaim
} from "./epistemicModelingBridge.mjs";

test("EPI-073 (§51): attention collapsing a quantum semantic superposition is blocked without a bridge", () => {
  const content =
    "L'attenzione agisce come una misura che collassa la sovrapposizione di significati del token.";
  const decision = assessAnalogyAuthorization({
    assistantContent: content,
    claims: [{ id: "C4", text: content, epistemicType: "ANALOGY" }],
    bridges: []
  });
  assert.ok(decision, "an unbridged analogy rendered as a mechanism must block");
  assert.equal(decision.code, "EPISTEMIC_ANALOGY_PROMOTED_TO_FACT");
  assert.ok(decision.failureCodes.includes("F08"));
  assert.ok(decision.failureCodes.includes("F23"));
  assert.deepEqual(decision.blockedClaimIds, ["C4"]);
});

test("EPI-073 (§51): the same content framed explicitly as an analogy is allowed", () => {
  const content =
    "In un'analogia quantum-inspired, l'attenzione si può modellare come uno step di selezione " +
    "dipendente dal contesto; non è un'affermazione di misura quantistica fisica.";
  const decision = assessAnalogyAuthorization({
    assistantContent: content,
    claims: [{ id: "C4", text: content, epistemicType: "ANALOGY" }],
    bridges: []
  });
  assert.equal(decision, null);
});

test("Q2-010 (§13): ANALOGY caps at QUALIFIED_ANALOGY and HYPOTHESIS at HYPOTHESIS", () => {
  assert.equal(
    analogyAuthorityForClaim({ claim: { epistemicType: "ANALOGY" }, bridges: [] }),
    ANALOGY_AUTHORITY.QUALIFIED_ANALOGY
  );
  assert.equal(
    analogyAuthorityForClaim({ claim: { epistemicType: "HYPOTHESIS" }, bridges: [] }),
    ANALOGY_AUTHORITY.HYPOTHESIS
  );
  assert.equal(
    analogyAuthorityForClaim({ claim: { epistemicType: "COMPUTED" }, bridges: [] }),
    ANALOGY_AUTHORITY.FACT
  );
});

test("Q2-010 (§13): a verified bridge lifts the cap to FACT", () => {
  const claimText = "L'attenzione è una misura quantistica che collassa la sovrapposizione.";
  const profile = requiredBridgeForClaim(claimText);
  const bridge = createModelingBridge({
    claimId: "C4",
    sourceDomain: profile.sourceDomain,
    targetDomain: profile.targetDomain,
    formalObject: profile.formalObject,
    intendedObject: profile.intendedObject,
    correspondence: profile.requiredCorrespondence,
    status: MODELING_BRIDGE_STATUS.VERIFIED,
    verifierResultIds: ["vr1"],
    evidenceIds: ["ev1"]
  });
  assert.equal(
    analogyAuthorityForClaim({
      claim: { id: "C4", text: claimText, epistemicType: "ANALOGY" },
      bridges: [bridge]
    }),
    ANALOGY_AUTHORITY.FACT
  );
  assert.equal(
    assessAnalogyAuthorization({
      assistantContent: claimText,
      claims: [{ id: "C4", text: claimText, epistemicType: "ANALOGY" }],
      bridges: [bridge]
    }),
    null
  );
});

test("Q2-010: 'the Transformer follows unitary Hamiltonian dynamics' is blocked without a bridge", () => {
  const content =
    "La struttura è identica: il Transformer evolve secondo un operatore unitario U(t) come in Schrodinger.";
  const decision = assessAnalogyAuthorization({
    assistantContent: content,
    claims: [{ id: "C3", text: content, epistemicType: "HYPOTHESIS" }],
    bridges: []
  });
  assert.ok(decision);
  assert.ok(decision.failureCodes.includes("F09"));
});

test("Q2-010: a claim that is not an analogy and needs no bridge is untouched", () => {
  assert.equal(
    assessAnalogyAuthorization({
      assistantContent: "The build completed successfully.",
      claims: [{ id: "C1", text: "The build completed successfully.", epistemicType: "EXECUTED" }],
      bridges: []
    }),
    null
  );
});
