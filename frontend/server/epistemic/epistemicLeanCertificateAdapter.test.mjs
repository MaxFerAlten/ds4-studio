/**
 * Q2-005 (remediation.Quantiom.002 §8, §46) — consume the runtime's existing
 * Lean target-identity metadata; never rebuild it, never invent it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createHash } from "node:crypto";

import {
  leanCertificateFromToolResult,
  LEAN_INTEGRATION_GAP
} from "./epistemicLeanCertificateAdapter.mjs";

const SOURCE = "theorem spectrum_discrete : True := by\n  trivial";
const HASH64 = "a".repeat(64);

function toolResult(overrides = {}) {
  return {
    status: "checked",
    targetDeclaration: "spectrum_discrete",
    targetStatementSha256: HASH64,
    checkedTargetStatementSha256: HASH64,
    targetIdentityMatched: true,
    profile: "core",
    ...overrides
  };
}

test("Q2-005: a checked run with matching target identity yields a PASSED lean certificate", () => {
  const cert = leanCertificateFromToolResult({
    claim: { id: "C1", domain: "PHYSICS" },
    source: SOURCE,
    result: toolResult()
  });
  assert.equal(cert.verifier, "lean");
  assert.equal(cert.verdict, "PASSED");
  assert.equal(cert.targetIdentityVerified, true);
  assert.equal(cert.sourceIntegrityVerified, true);
  assert.equal(cert.targetDeclaration, "spectrum_discrete");
  assert.match(cert.checkedSourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(cert.integrationGap, null);
});

test("§8.2 fail-safe: a missing target identity is UNKNOWN, never a pass", () => {
  const cert = leanCertificateFromToolResult({
    claim: { id: "C1" },
    source: SOURCE,
    result: toolResult({ targetIdentityMatched: undefined, targetStatementSha256: undefined })
  });
  assert.equal(cert.verdict, "UNKNOWN");
  assert.equal(cert.targetIdentityVerified, false);
  assert.equal(cert.integrationGap, LEAN_INTEGRATION_GAP.TARGET_IDENTITY_MISSING);
  assert.ok(cert.failureCodes.includes("F18"));
});

test("§8.3: checked + source integrity is still not a verified claim when identity mismatches", () => {
  const cert = leanCertificateFromToolResult({
    claim: { id: "C1" },
    source: SOURCE,
    result: toolResult({ checkedTargetStatementSha256: "b".repeat(64), targetIdentityMatched: false })
  });
  assert.equal(cert.verdict, "UNKNOWN");
  assert.equal(cert.targetIdentityVerified, false);
  assert.equal(cert.integrationGap, LEAN_INTEGRATION_GAP.TARGET_IDENTITY_MISMATCH);
});

test("Q2-005: a timed-out or failed run never produces a PASSED certificate", () => {
  for (const status of ["timeout", "error", "failed"]) {
    const cert = leanCertificateFromToolResult({
      claim: { id: "C1" },
      source: SOURCE,
      result: toolResult({ status })
    });
    assert.notEqual(cert.verdict, "PASSED", status);
    assert.equal(cert.status, "UNKNOWN", status);
  }
});

test("Q2-005: sorry in the submitted source cannot yield a PASSED certificate", () => {
  const cert = leanCertificateFromToolResult({
    claim: { id: "C1" },
    source: "theorem t : True := by\n  sorry",
    result: toolResult()
  });
  assert.equal(cert.verdict, "UNKNOWN");
  assert.ok(cert.failureCodes.includes("F35"));
});

test("Q2-005: the certificate carries the exact bytes the checker saw, for artifact binding", async () => {
  const { bindFormalArtifacts, FORMAL_ARTIFACT_STATUS } = await import(
    "./epistemicFormalArtifactBinding.mjs"
  );
  const cert = leanCertificateFromToolResult({
    claim: { id: "C1" },
    source: SOURCE,
    result: toolResult()
  });
  const [artifact] = bindFormalArtifacts({
    assistantContent: "```lean\n" + SOURCE + "\n```",
    certificates: [cert]
  });
  assert.equal(artifact.status, FORMAL_ARTIFACT_STATUS.CHECKED_BOUND);
  assert.equal(artifact.boundCertificateId, cert.id);
});

test("Q2-005/§18 (EPI-075): a checked proof of another target does not certify this claim", () => {
  const source = [
    "inductive EnergyLevel : Type where",
    "  | mk (n : Nat) : EnergyLevel",
    "",
    "theorem spectrum_discrete (n m : Nat) :",
    "    EnergyLevel.mk n = EnergyLevel.mk m -> n = m := by",
    "  intro h",
    "  injection h"
  ].join("\n");
  const statement = "theorem spectrum_discrete : EnergyLevel.mk n = EnergyLevel.mk m -> n = m";
  const hash = createHash("sha256").update(statement, "utf8").digest("hex");

  const certificate = leanCertificateFromToolResult({
    claim: {
      id: "C1",
      text:
        "Gli autovalori dell'Hamiltoniano dell'oscillatore armonico quantistico formano uno " +
        "spettro discreto e non degenere."
    },
    source,
    result: {
      status: "checked",
      targetDeclaration: "spectrum_discrete",
      targetStatementSha256: hash,
      checkedTargetStatementSha256: hash,
      targetIdentityMatched: true
    }
  });

  // The run really did check its locked target. That target is not this claim.
  assert.equal(certificate.targetIdentityVerified, true);
  assert.equal(certificate.scopeCoversClaim, false);
  assert.equal(certificate.status, "UNKNOWN");
  assert.ok(certificate.failureCodes.includes("F27"));
  assert.ok(certificate.failureCodes.includes("F18"));
});

test("Q2-005/§18: a checked proof about the claim's own subject still passes", () => {
  const source = "theorem spectrum_discrete (spectrum : Nat) : spectrum = spectrum := rfl";
  const statement = "theorem spectrum_discrete : spectrum = spectrum";
  const hash = createHash("sha256").update(statement, "utf8").digest("hex");
  const certificate = leanCertificateFromToolResult({
    claim: { id: "C1", text: "The spectrum is a spectrum." },
    source,
    result: {
      status: "checked",
      targetDeclaration: "spectrum_discrete",
      targetStatementSha256: hash,
      checkedTargetStatementSha256: hash,
      targetIdentityMatched: true
    }
  });
  assert.equal(certificate.scopeCoversClaim, true);
  assert.equal(certificate.status, "PASSED");
});
