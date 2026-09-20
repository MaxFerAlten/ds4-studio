import test from "node:test";
import assert from "node:assert/strict";
import { FAILURE_SEVERITY, SEVERITY } from "./epistemicContracts.mjs";
import { createClaim } from "./epistemicLedger.mjs";
import { evaluateEpistemicFinalCandidate } from "./epistemicFinalizationGate.mjs";
import { epistemicTelemetryEvent } from "./epistemicTelemetry.mjs";
import {
  QFIX_PARITY_CASES,
  QUANTUM_HALLUCINATION_CASES
} from "./fixtures/quantumHallucinationCases.mjs";
import {
  EPISTEMIC_ESCAPE_MIN_SEVERITY,
  calculateEpistemicEscapeRate
} from "./epistemicEscapeRate.mjs";

const BLOCKING = Object.freeze({ enabled: true, mode: "block", blockSeverity: SEVERITY.HIGH });

function corpusAuditEvent(fixture, config = BLOCKING) {
  const failureCode = fixture.expectedFailure;
  const claim = {
    ...createClaim({ id: fixture.id, text: fixture.candidate }),
    severity: FAILURE_SEVERITY[failureCode],
    failureCodes: [failureCode],
    evidenceIds: Array.isArray(fixture.evidence) ? fixture.evidence.map((item) => item.id).filter(Boolean) : []
  };
  const decision = evaluateEpistemicFinalCandidate({
    assistantContent: fixture.candidate,
    claims: [claim],
    evidence: fixture.evidence ?? [],
    challenges: fixture.challengeTurn ? [{ id: `${fixture.id}_challenge`, targetClaimId: fixture.id }] : [],
    config
  });
  return epistemicTelemetryEvent({
    at: "2026-08-26T00:00:00.000Z",
    decision,
    claims: [claim]
  });
}

test("escape rate follows the claim ratio and deduplicates repeated audit observations", () => {
  const report = calculateEpistemicEscapeRate([
    { id: "escaped", invalid: true, severity: SEVERITY.HIGH, published: true },
    { id: "escaped", invalid: true, severity: SEVERITY.HIGH, published: true },
    { id: "rejected", invalid: true, severity: SEVERITY.CRITICAL, published: false },
    { id: "medium", invalid: true, severity: SEVERITY.MEDIUM, published: true }
  ]);

  assert.equal(EPISTEMIC_ESCAPE_MIN_SEVERITY, SEVERITY.HIGH);
  assert.equal(report.invalidHighSeverityClaimsGenerated, 2);
  assert.equal(report.invalidHighSeverityClaimsPublished, 1);
  assert.equal(report.escapeRate, 0.5);
  assert.equal(report.targetMet, false);
  assert.deepEqual(report.generatedClaimIds, ["escaped", "rejected"]);
  assert.deepEqual(report.publishedClaimIds, ["escaped"]);
});

test("an empty high-severity corpus cannot vacuously satisfy the release target", () => {
  const report = calculateEpistemicEscapeRate([
    { id: "medium", invalid: true, severity: SEVERITY.MEDIUM, published: false }
  ]);
  assert.equal(report.escapeRate, null);
  assert.equal(report.hasCoverage, false);
  assert.equal(report.targetMet, false);
});

test("S4/S5 escape rate is zero on the repository regression corpus", () => {
  const corpus = [...QUANTUM_HALLUCINATION_CASES, ...QFIX_PARITY_CASES];
  const events = corpus.map((fixture) => corpusAuditEvent(fixture));
  const report = calculateEpistemicEscapeRate(events);

  // One QHO vector is S3/F08; the other two plus all five parity vectors are
  // mandatory S4/S5 cases and therefore form the release denominator.
  assert.equal(report.invalidHighSeverityClaimsGenerated, 7);
  assert.equal(report.invalidHighSeverityClaimsPublished, 0);
  assert.equal(report.escapeRate, 0);
  assert.equal(report.hasCoverage, true);
  assert.equal(report.targetMet, true);
});

test("the same S4/S5 corpus exposes escapes when run in shadow mode", () => {
  const shadow = Object.freeze({ ...BLOCKING, mode: "shadow" });
  const events = [...QUANTUM_HALLUCINATION_CASES, ...QFIX_PARITY_CASES]
    .map((fixture) => corpusAuditEvent(fixture, shadow));
  const report = calculateEpistemicEscapeRate(events);

  assert.equal(report.invalidHighSeverityClaimsGenerated, 7);
  assert.equal(report.invalidHighSeverityClaimsPublished, 7);
  assert.equal(report.escapeRate, 1);
  assert.equal(report.targetMet, false);
});
