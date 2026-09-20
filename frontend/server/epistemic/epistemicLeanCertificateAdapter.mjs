/**
 * Q2-005 (remediation.Quantiom.002 §8) — Lean certificate adapter.
 *
 * The runtime in `frontend/server/lean/` already locks a target declaration,
 * hashes its statement, and reports whether what came back checked was that
 * statement (LEAN_TARGET_IDENTITY_*). §8 is explicit that none of that gets
 * rebuilt here. This adapter only carries those guarantees across into the
 * epistemic certificate the promotion gate and the artifact binder read.
 *
 * §8.3 is the whole point: `checked=true ∧ sourceIntegrityVerified` does NOT
 * imply the claim was verified. Without `targetIdentityVerified` the verdict is
 * UNKNOWN, and §61 forbids inventing the missing metadata — the gap is reported
 * as itself.
 */

import { createHash } from "node:crypto";

import { auditLeanSource, certificateScopeMismatch } from "./epistemicLeanAxiomAudit.mjs";
import { createVerifierCertificate } from "./epistemicVerifierCertificate.mjs";

export const LEAN_INTEGRATION_GAP = Object.freeze({
  TARGET_IDENTITY_MISSING: "LEAN_TARGET_IDENTITY_MISSING",
  TARGET_IDENTITY_MISMATCH: "LEAN_TARGET_IDENTITY_MISMATCH",
  CHECKED_SOURCE_INTEGRITY_FAILURE: "LEAN_CHECKED_SOURCE_INTEGRITY_FAILURE"
});

const HEX64 = /^[0-9a-f]{64}$/;

function normalizeSource(source) {
  return String(source ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Build the epistemic Lean certificate for one `lean_check` run.
 *
 * @param {{claim: object, source: string, result: object}} input
 *   `result` is the lean tool result (leanContract shape) as returned; `source`
 *   is exactly what was submitted as `code`.
 * @returns {object} a verifier certificate carrying the target-identity fields.
 */
export function leanCertificateFromToolResult({ claim, source = "", result = {} } = {}) {
  const normalized = normalizeSource(source);
  const checkedSourceSha256 = sha256(normalized);
  const audit = auditLeanSource(normalized);

  const targetStatementSha256 =
    typeof result?.targetStatementSha256 === "string" && HEX64.test(result.targetStatementSha256)
      ? result.targetStatementSha256
      : null;
  const checkedTargetStatementSha256 =
    typeof result?.checkedTargetStatementSha256 === "string" &&
    HEX64.test(result.checkedTargetStatementSha256)
      ? result.checkedTargetStatementSha256
      : null;

  const checked = String(result?.status ?? "").toLowerCase() === "checked";
  // The runtime's own verdict is authoritative when present; the hash equality
  // is the fallback for results that carry the digests but not the flag.
  const identityMatched =
    result?.targetIdentityMatched === true ||
    (result?.targetIdentityMatched === undefined &&
      targetStatementSha256 !== null &&
      targetStatementSha256 === checkedTargetStatementSha256);

  let integrationGap = null;
  if (targetStatementSha256 === null || checkedTargetStatementSha256 === null) {
    integrationGap = LEAN_INTEGRATION_GAP.TARGET_IDENTITY_MISSING;
  } else if (!identityMatched) {
    integrationGap = LEAN_INTEGRATION_GAP.TARGET_IDENTITY_MISMATCH;
  }

  const targetIdentityVerified = integrationGap === null && identityMatched;
  // Nothing postulated, nothing left open. `sorry` elaborates and proves
  // nothing, so it can never reach a PASSED certificate (§7.4).
  const dependenciesClean = audit.status === "CLEAN";
  // §18, §22 — the run's locked target and the claim's target are two different
  // things. A checked theorem about an invented datatype has a verified target
  // identity and still says nothing about the Hamiltonian the sentence names,
  // and treating that as this claim's certificate is the scope laundering the
  // whole remediation exists to stop.
  const scope = certificateScopeMismatch({
    claimText: claim?.text ?? "",
    source: normalized
  });
  const scopeCoversClaim = !scope.mismatch;
  const passed = checked && targetIdentityVerified && dependenciesClean && scopeCoversClaim;

  const failureCodes = new Set();
  if (!passed) {
    failureCodes.add("F18");
    if (!dependenciesClean) failureCodes.add("F35");
    if (integrationGap) failureCodes.add("F27");
    if (!scopeCoversClaim) for (const code of scope.failureCodes) failureCodes.add(code);
  }

  const certificate = createVerifierCertificate({
    claimId: claim?.id ?? "unbound",
    verifier: "lean",
    requirement: "lean_proof",
    verdict: passed ? "PASSED" : "UNKNOWN",
    checkedStatement: passed
      ? `Lean checked the locked declaration ${result?.targetDeclaration ?? "(unnamed)"}.`
      : "Lean did not establish the locked declaration in this run.",
    formalizationKind: "LEAN_THEOREM",
    domain: claim?.domain ?? "MATHEMATICS",
    assumptionsUsed: audit.theoremPremises.map((premise) => premise.type),
    propertiesEstablished: passed && result?.targetDeclaration ? [result.targetDeclaration] : [],
    propertiesNotEstablished: passed
      ? []
      : scopeCoversClaim
        ? ["LOCKED_TARGET_STATEMENT"]
        : ["CLAIM_SUBJECT_NOT_IN_CHECKED_SOURCE"],
    evidenceIds: Array.isArray(result?.evidenceIds) ? result.evidenceIds : [],
    metadata: {
      normalizedStatement: claim?.verificationTarget?.normalizedStatement ?? "",
      checkedSourceSha256,
      checkedTargetStatementSha256
    }
  });

  return Object.freeze({
    ...certificate,
    // The pipeline reads `status`; the certificate vocabulary uses `verdict`.
    status: passed ? "PASSED" : "UNKNOWN",
    checkedSource: normalized,
    checkedSourceSha256,
    // §8.1 — the fields §8 asks the adapter to propagate, unchanged.
    targetDeclaration: result?.targetDeclaration ?? null,
    targetStatementSha256,
    checkedTargetStatementSha256,
    profile: result?.profile ?? null,
    sourceIntegrityVerified: normalized.length > 0,
    scopeCoversClaim,
    scopeReason: scope.reason,
    targetIdentityVerified,
    // §61 — the gap is reported, never filled in.
    integrationGap,
    failureCodes: Object.freeze([...failureCodes])
  });
}
