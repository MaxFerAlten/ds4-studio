import test from "node:test";
import assert from "node:assert/strict";

import {
  MODELING_BRIDGE_STATUS,
  assessModelingBridge,
  createModelingBridge,
  requiredBridgeForClaim
} from "./epistemicModelingBridge.mjs";

const QHO_CORRESPONDENCE = [
  "LINEARITY",
  "ADJOINT_RELATION",
  "ORTHONORMAL_BASIS",
  "LADDER_COEFFICIENTS",
  "NUMBER_OPERATOR_SEMANTICS"
];

function input(overrides = {}) {
  return {
    id: "bridge-qho",
    claimId: "claim-qho",
    sourceDomain: "MATHEMATICS",
    targetDomain: "PHYSICS",
    formalObject: "a, adag : Nat -> Nat",
    intendedObject: "standard QHO ladder operators on Fock space",
    correspondence: [],
    assumptions: [],
    status: MODELING_BRIDGE_STATUS.UNVERIFIED,
    ...overrides
  };
}

test("Nat functions without a bridge cannot represent QHO operators", () => {
  const bridge = createModelingBridge(input());
  const out = assessModelingBridge({ bridge, requiredCorrespondence: QHO_CORRESPONDENCE });
  assert.equal(out.status, MODELING_BRIDGE_STATUS.REJECTED);
  assert.deepEqual(out.missing, QHO_CORRESPONDENCE);
  assert.deepEqual(out.failureCodes, ["F32"]);
});

test("complete evidence-backed correspondence verifies a bridge", () => {
  const bridge = createModelingBridge(
    input({
      correspondence: QHO_CORRESPONDENCE,
      status: MODELING_BRIDGE_STATUS.VERIFIED,
      verifierResultIds: ["vr-bridge"],
      evidenceIds: ["ev-bridge"]
    })
  );
  const out = assessModelingBridge({ bridge, requiredCorrespondence: QHO_CORRESPONDENCE });
  assert.equal(out.status, MODELING_BRIDGE_STATUS.VERIFIED);
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.failureCodes, []);
});

test("model prose alone cannot mark a bridge VERIFIED", () => {
  assert.throws(
    () =>
      createModelingBridge(
        input({
          correspondence: QHO_CORRESPONDENCE,
          status: MODELING_BRIDGE_STATUS.VERIFIED,
          assumptions: ["the model says the objects correspond"]
        })
      ),
    /requires verifier results and evidence/
  );
});

test("unverified complete prose correspondence remains UNVERIFIED", () => {
  const bridge = createModelingBridge(input({ correspondence: QHO_CORRESPONDENCE }));
  const out = assessModelingBridge({ bridge, requiredCorrespondence: QHO_CORRESPONDENCE });
  assert.equal(out.status, MODELING_BRIDGE_STATUS.UNVERIFIED);
  assert.deepEqual(out.failureCodes, ["F32"]);
});

test("bridge data is immutable and copied", () => {
  const correspondence = ["LINEARITY"];
  const bridge = createModelingBridge(input({ correspondence }));
  correspondence.push("ADJOINT_RELATION");
  assert.deepEqual(bridge.correspondence, ["LINEARITY"]);
  assert.equal(Object.isFrozen(bridge), true);
  assert.throws(() => bridge.correspondence.push("X"), TypeError);
});

test("EPI-060: circular CAS validation cannot verify a modeling bridge", () => {
  // The CAS success checks only the algebra written on the same side; it does
  // not independently establish that the formal object corresponds to the
  // intended physical object. Correspondence evidence is what a bridge needs.
  const bridge = createModelingBridge(
    input({
      correspondence: QHO_CORRESPONDENCE,
      verifierResultIds: ["vr-cas"],
      evidenceIds: ["ev-cas"]
    })
  );
  // A verifier result alone is not mirrored in an independent evidence check of
  // the correspondence — the bridge cannot reach VERIFIED from CAS alone.
  const out = assessModelingBridge({ bridge, requiredCorrespondence: QHO_CORRESPONDENCE });
  assert.equal(out.status, MODELING_BRIDGE_STATUS.UNVERIFIED);
  assert.ok(out.failureCodes.includes("F32"));
});

test("EPI-061: Lean success without a verified modeling bridge certifies nothing", () => {
  // Lean assembling a proof of the formal object is not the same as verifying
  // the bridge from the formal object to the intended QHO object.
  const bridge = createModelingBridge(
    input({
      correspondence: QHO_CORRESPONDENCE,
      status: MODELING_BRIDGE_STATUS.UNVERIFIED,
      assumptions: ["Lean checked ^x + a.dag*a + 1"]
    })
  );
  const out = assessModelingBridge({ bridge, requiredCorrespondence: QHO_CORRESPONDENCE });
  assert.equal(out.status, MODELING_BRIDGE_STATUS.UNVERIFIED);
  assert.deepEqual(out.failureCodes, ["F32"]);
});

test("EPI-072 (Q2-009 §12, §50): an abstract C^V basis claim about real embeddings needs a bridge", () => {
  const required = requiredBridgeForClaim(
    "Il vocabolario finito di un LLM forma una base ortogonale completa per la rappresentazione semantica."
  );
  assert.ok(required, "the claim must be recognised as cross-domain");
  assert.equal(required.formalObject, "ABSTRACT_TOKEN_INDEX_SPACE");
  assert.equal(required.intendedObject, "LEARNED_EMBEDDING_SPACE");
  for (const correspondence of [
    "TOKEN_ID_TO_LEARNED_VECTOR_MAP",
    "DIMENSION_MATCH",
    "LINEAR_INDEPENDENCE",
    "ORTHOGONALITY",
    "SPANNING",
    "REPRESENTATION_IDENTITY"
  ]) {
    assert.ok(required.requiredCorrespondence.includes(correspondence), correspondence);
  }

  // With no bridge the assessment rejects and names F32/F38.
  const verdict = assessModelingBridge({
    bridge: null,
    requiredCorrespondence: required.requiredCorrespondence
  });
  assert.equal(verdict.status, MODELING_BRIDGE_STATUS.UNVERIFIED);
  assert.ok(verdict.failureCodes.includes("F32"));
});

test("Q2-009 (§50): the narrow auxiliary-model claim needs no bridge and is allowed", () => {
  assert.equal(
    requiredBridgeForClaim(
      "Definiamo uno spazio astratto C^V indicizzato dai token, con base canonica e_i."
    ),
    null
  );
  assert.equal(
    requiredBridgeForClaim(
      "We introduce an auxiliary token-indexed vector space with a canonical basis."
    ),
    null
  );
});

test("Q2-009 (§38): attention-as-measurement requires the full measurement correspondence", () => {
  const required = requiredBridgeForClaim(
    "L'attenzione agisce come una misura quantistica che collassa la sovrapposizione."
  );
  assert.ok(required);
  assert.equal(required.intendedObject, "ATTENTION_MECHANISM");
  for (const correspondence of [
    "STATE_SPACE_CORRESPONDENCE",
    "PROBABILITY_RULE",
    "OBSERVABLE_OR_MEASUREMENT_MAP",
    "NORMALIZATION",
    "POST_MEASUREMENT_STATE_RULE",
    "EMPIRICAL_OR_FORMAL_JUSTIFICATION"
  ]) {
    assert.ok(required.requiredCorrespondence.includes(correspondence), correspondence);
  }
});

test("Q2-009 (§38): Transformer-as-unitary requires the operator correspondence", () => {
  const required = requiredBridgeForClaim(
    "Il Transformer evolve secondo un operatore unitario U(t), come l'equazione di Schrodinger."
  );
  assert.ok(required);
  assert.equal(required.intendedObject, "TRANSFORMER_LAYER_MAP");
  assert.ok(required.requiredCorrespondence.includes("ADJOINT_IDENTITY"));
  assert.ok(required.requiredCorrespondence.includes("INVERTIBILITY"));
});

test("Q2-009: a bridge missing one correspondence is REJECTED, not merely unverified", () => {
  const required = requiredBridgeForClaim(
    "Il vocabolario di un LLM forma una base ortogonale dello spazio semantico appreso."
  );
  const bridge = createModelingBridge({
    claimId: "C1",
    sourceDomain: "MATHEMATICS",
    targetDomain: "TRANSFORMER",
    formalObject: "ABSTRACT_TOKEN_INDEX_SPACE",
    intendedObject: "LEARNED_EMBEDDING_SPACE",
    correspondence: required.requiredCorrespondence.filter((c) => c !== "ORTHOGONALITY"),
    status: MODELING_BRIDGE_STATUS.VERIFIED,
    verifierResultIds: ["vr1"],
    evidenceIds: ["ev1"]
  });
  const verdict = assessModelingBridge({
    bridge,
    requiredCorrespondence: required.requiredCorrespondence
  });
  assert.equal(verdict.status, MODELING_BRIDGE_STATUS.REJECTED);
  assert.deepEqual(verdict.missing, ["ORTHOGONALITY"]);
});
