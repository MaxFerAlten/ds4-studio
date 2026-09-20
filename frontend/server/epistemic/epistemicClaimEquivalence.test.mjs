import test from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_RELATION,
  carryForwardClaimState,
  compareClaims,
  inheritFromPriorClaims
} from "./epistemicClaimEquivalence.mjs";

test("exact and protected-wording rewrites are grouped deterministically", async () => {
  assert.equal(
    (await compareClaims({ oldClaim: { text: "Claim A." }, newClaim: { text: " claim a " } })).relation,
    CLAIM_RELATION.EXACT
  );
  assert.equal(
    (
      await compareClaims({
        oldClaim: { text: "Lean proved the number-operator relation." },
        newClaim: { text: "The number operator relation was machine certified." }
      })
    ).relation,
    CLAIM_RELATION.PARAPHRASE
  );
});

test("semantic client is used only for ambiguous relations", async () => {
  const calls = [];
  const client = {
    async completeRole(input) {
      calls.push(input);
      return { json: { relation: "NARROWER" } };
    }
  };
  const out = await compareClaims({
    oldClaim: { text: "The toy model proves the complete QHO number operator." },
    newClaim: { text: "Lean typechecked an index transition of toy FockState." },
    client
  });
  assert.equal(out.relation, CLAIM_RELATION.NARROWER);
  assert.equal(out.source, "model");
  assert.equal(calls[0].roleName, "epistemic_claim_equivalence");
});

test("paraphrase carries challenge debt and negative provenance", () => {
  const carried = carryForwardClaimState({
    oldClaim: {
      id: "c-old",
      challengeDebtIds: ["ch-1"],
      historyEventIds: ["event-1"],
      failureCodes: ["F39"],
      negativeProvenance: ["model-gap"],
      correctiveEpoch: 2,
      lastQualifiedEvidenceEpoch: 1
    },
    newClaim: { id: "c-new", failureCodes: [] },
    relation: CLAIM_RELATION.PARAPHRASE
  });
  assert.deepEqual(carried.challengeDebtIds, ["ch-1"]);
  assert.deepEqual(carried.historyEventIds, ["event-1"]);
  assert.deepEqual(carried.failureCodes, ["F39"]);
  assert.equal(carried.correctiveEpoch, 2);
  assert.equal(carried.inheritedFromClaimId, "c-old");
});

test("EPI-052: narrower claim records lineage without copying open debt", () => {
  const narrowed = carryForwardClaimState({
    oldClaim: { id: "c-old", challengeDebtIds: ["ch-scope"], failureCodes: ["F32"] },
    newClaim: { id: "c-new", challengeDebtIds: [], failureCodes: [] },
    relation: CLAIM_RELATION.NARROWER
  });
  assert.equal(narrowed.inheritedFromClaimId, "c-old");
  assert.deepEqual(narrowed.challengeDebtIds, []);
  assert.deepEqual(narrowed.failureCodes, []);
});

test("REM-006: paraphrase/broader inherit the root identity; narrow creates a new root", () => {
  const paraphrase = carryForwardClaimState({
    oldClaim: { id: "c1-root", semanticRootClaimId: "c1-root" },
    newClaim: { id: "c2" },
    relation: CLAIM_RELATION.PARAPHRASE
  });
  assert.equal(paraphrase.semanticRootClaimId, "c1-root");

  // An old claim without a recorded root anchors the chain on itself.
  const broader = carryForwardClaimState({
    oldClaim: { id: "c1-root" },
    newClaim: { id: "c3" },
    relation: CLAIM_RELATION.BROADER
  });
  assert.equal(broader.semanticRootClaimId, "c1-root");

  // A NARROWER claim is a fresh root: a later paraphrase of IT must root on the
  // narrowed claim (c2), NOT fall back to the original root it descended from.
  const narrowed = carryForwardClaimState({
    oldClaim: { id: "c1-root", semanticRootClaimId: "c1-root" },
    newClaim: { id: "c2" },
    relation: CLAIM_RELATION.NARROWER
  });
  assert.equal(narrowed.semanticRootClaimId, "c2");
  const paraphraseOfNarrowed = carryForwardClaimState({
    oldClaim: narrowed,
    newClaim: { id: "c4" },
    relation: CLAIM_RELATION.PARAPHRASE
  });
  assert.equal(paraphraseOfNarrowed.semanticRootClaimId, "c2");
});

test("best prior paraphrase prevents wording escape", async () => {
  const newClaim = { id: "c-new", text: "The number operator relation was machine certified." };
  const inherited = await inheritFromPriorClaims({
    claim: newClaim,
    priorClaims: [
      { id: "unrelated", text: "The paper exists." },
      {
        id: "challenged",
        text: "Lean proved the number-operator relation.",
        challengeDebtIds: ["ch-1"],
        failureCodes: ["F39"]
      }
    ]
  });
  assert.equal(inherited.inheritedFromClaimId, "challenged");
  assert.deepEqual(inherited.challengeDebtIds, ["ch-1"]);
});
