import test from "node:test";
import assert from "node:assert/strict";
import { checkDomainInvariants, domainInvariantFailureCodes } from "./epistemicDomainInvariants.mjs";

test("EPI-045: row softmax does not make attention doubly stochastic", () => {
  const violations = checkDomainInvariants("Softmax makes the attention matrix doubly stochastic.");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].id, "T1");
  assert.deepEqual(violations[0].failureCodes, ["F21"]);
});

test("EPI-046: doubly stochastic does not imply unitary or norm preserving", () => {
  assert.deepEqual(domainInvariantFailureCodes("Any doubly stochastic attention map preserves the L2 norm."), ["F21"]);
  assert.deepEqual(domainInvariantFailureCodes("Because the matrix is doubly stochastic it is unitary."), ["F21"]);
});

test("EPI-047: the vocabulary does not set the embedding dimension", () => {
  const codes = domainInvariantFailureCodes(
    "The semantic embedding space has dimension V because the vocabulary has V tokens."
  );
  assert.deepEqual(codes, ["F32", "F15"]);
});

test("standard attention is not unitary", () => {
  const violations = checkDomainInvariants("Self-attention is unitary and therefore reversible.");
  assert.equal(violations.some((v) => v.id === "T3"), true);
});

test("token embeddings are not an orthonormal basis by default", () => {
  assert.equal(checkDomainInvariants("Every token embedding is an orthonormal basis vector.").length, 1);
});

test("a QHO claim on a toy index model is a domain model mismatch", () => {
  const violations = checkDomainInvariants("The toy model proves the number operator relation N|n> = n|n>.");
  assert.equal(violations.some((v) => v.id === "Q2"), true);
  assert.equal(violations.some((v) => v.failureCodes.includes("F32")), true);
});

test("the CCR has no exact finite-dimensional realisation", () => {
  const violations = checkDomainInvariants("With finite-dimensional matrices we still have [a, a†] = I exactly.");
  assert.equal(violations.some((v) => v.id === "Q1"), true);
});

test("stating the invariant correctly is not a violation", () => {
  assert.deepEqual(
    domainInvariantFailureCodes("Softmax does not make the attention matrix doubly stochastic."),
    []
  );
  assert.deepEqual(
    domainInvariantFailureCodes("Self-attention is not unitary in general."),
    []
  );
  assert.deepEqual(domainInvariantFailureCodes("The tests pass and the build is green."), []);
});
