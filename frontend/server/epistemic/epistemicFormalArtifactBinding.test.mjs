/**
 * Q2-004 (remediation.Quantiom.002 §7, §45) — FA-001..FA-008.
 *
 * The Lean block a reader sees under "Dimostrazione Lean verificata" must be
 * byte-identical to the source a certificate actually checked.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  FORMAL_ARTIFACT_STATUS,
  extractFormalArtifacts,
  bindFormalArtifacts,
  unboundVerifiedArtifacts
} from "./epistemicFormalArtifactBinding.mjs";

const CHECKED_SOURCE = "theorem t : True := by\n  trivial";

function certificateFor(source, extra = {}) {
  return {
    id: "cert_1",
    verifier: "lean",
    status: "PASSED",
    checkedSourceSha256: null, // filled by the helper under test in real use
    checkedSource: source,
    ...extra
  };
}

test("FA-001: a rendered block identical to the checked source is CHECKED_BOUND", () => {
  const content = "Dimostrazione Lean verificata:\n\n```lean\n" + CHECKED_SOURCE + "\n```";
  const [artifact] = bindFormalArtifacts({
    assistantContent: content,
    certificates: [certificateFor(CHECKED_SOURCE)]
  });
  assert.equal(artifact.status, FORMAL_ARTIFACT_STATUS.CHECKED_BOUND);
  assert.equal(artifact.boundCertificateId, "cert_1");
  assert.equal(artifact.failureCodes.length, 0);
});

test("FA-002: one byte of difference unbinds the artifact", () => {
  const content = "```lean\n" + CHECKED_SOURCE.replace("trivial", "trivial ") + "\n```";
  const [artifact] = bindFormalArtifacts({
    assistantContent: content,
    certificates: [certificateFor(CHECKED_SOURCE)]
  });
  assert.equal(artifact.status, FORMAL_ARTIFACT_STATUS.CHECKED_DIFFERENT_SOURCE);
  assert.equal(artifact.boundCertificateId, null);
  assert.ok(artifact.failureCodes.includes("F18"));
});

test("FA-003: sorry is INCOMPLETE whatever the certificate says", () => {
  const source = "theorem unitary_evolution : U = U := by\n  sorry";
  const [artifact] = bindFormalArtifacts({
    assistantContent: "```lean\n" + source + "\n```",
    certificates: [certificateFor(source)]
  });
  assert.equal(artifact.containsSorry, true);
  assert.equal(artifact.status, FORMAL_ARTIFACT_STATUS.INCOMPLETE);
  assert.ok(artifact.failureCodes.includes("F18"));
});

test("FA-004: admit is INCOMPLETE", () => {
  const source = "theorem t : P := by\n  admit";
  const [artifact] = bindFormalArtifacts({
    assistantContent: "```lean\n" + source + "\n```",
    certificates: [certificateFor(source)]
  });
  assert.equal(artifact.containsAdmit, true);
  assert.equal(artifact.status, FORMAL_ARTIFACT_STATUS.INCOMPLETE);
});

test("FA-005: a local axiom makes the artifact CONDITIONAL_AXIOM", () => {
  const source = "axiom ccr : True\ntheorem t : True := ccr";
  const [artifact] = bindFormalArtifacts({
    assistantContent: "```lean\n" + source + "\n```",
    certificates: [certificateFor(source)]
  });
  assert.equal(artifact.containsAxiom, true);
  assert.equal(artifact.status, FORMAL_ARTIFACT_STATUS.CONDITIONAL_AXIOM);
  assert.ok(artifact.failureCodes.includes("F35"));
});

test("FA-006/FA-007: a timed-out or failed run leaves the rendered block UNCHECKED", () => {
  const source = "theorem superposition : True := by\n  simp";
  for (const status of ["TIMEOUT", "FAILED"]) {
    const [artifact] = bindFormalArtifacts({
      assistantContent: "```lean\n" + source + "\n```",
      certificates: [certificateFor(source, { status })]
    });
    assert.equal(artifact.status, FORMAL_ARTIFACT_STATUS.UNCHECKED, status);
    assert.ok(artifact.failureCodes.includes("F18"), status);
  }
});

test("FA-007b: a rendered block with no certificate at all is UNCHECKED", () => {
  const [artifact] = bindFormalArtifacts({
    assistantContent: "```lean\ntheorem t : True := trivial\n```",
    certificates: []
  });
  assert.equal(artifact.status, FORMAL_ARTIFACT_STATUS.UNCHECKED);
  assert.equal(artifact.boundCertificateId, null);
});

test("FA-008: a checked toy theorem binds, and stays a toy theorem", () => {
  const source =
    "inductive EnergyLevel : Type where\n  | mk (n : Nat) : EnergyLevel\n\n" +
    "theorem spectrum_discrete (n m : Nat) :\n" +
    "    EnergyLevel.mk n = EnergyLevel.mk m -> n = m := by\n  simp";
  const [artifact] = bindFormalArtifacts({
    assistantContent: "```lean\n" + source + "\n```",
    certificates: [certificateFor(source)]
  });
  assert.equal(artifact.status, FORMAL_ARTIFACT_STATUS.CHECKED_BOUND);
  // Binding is provenance only: it says the bytes match, never what they mean.
  assert.equal(artifact.establishesClaimScope, undefined);
});

test("§72 metric: unboundVerifiedArtifacts counts only blocks rendered as verified", () => {
  const content =
    "Dimostrazione Lean verificata:\n```lean\ntheorem a : True := by\n  sorry\n```\n" +
    "Tentativo non verificato:\n```lean\ntheorem b : True := by\n  sorry\n```";
  const artifacts = bindFormalArtifacts({ assistantContent: content, certificates: [] });
  assert.equal(artifacts.length, 2);
  const unbound = unboundVerifiedArtifacts(artifacts);
  assert.equal(unbound.length, 1);
  assert.equal(unbound[0].renderedAsVerified, true);
});

test("extractFormalArtifacts hashes the exact bytes of each lean fence", () => {
  const artifacts = extractFormalArtifacts("```lean\nA\n```\n```lean\nB\n```");
  assert.equal(artifacts.length, 2);
  assert.notEqual(artifacts[0].sourceSha256, artifacts[1].sourceSha256);
  assert.match(artifacts[0].sourceSha256, /^[0-9a-f]{64}$/);
});
