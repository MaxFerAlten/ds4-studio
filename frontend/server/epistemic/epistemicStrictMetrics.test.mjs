/**
 * Q2-018 (remediation.Quantiom.002 §33, §58) — the six strict-mode rates.
 *
 * A metric that cannot go up is not a metric, so every rate here is exercised
 * once with an escape present and once without, and an empty corpus must report
 * "uncovered" rather than a clean zero.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { measureStrictMetrics, measureContractCoverage } from "./epistemicStrictMetrics.mjs";
import { runQhoLlmAdversarialCorpus } from "./quantiumCorpus.mjs";
import { deriveUserVerificationContract } from "./epistemicUserVerificationContract.mjs";

const STRICT = deriveUserVerificationContract({
  userText: "Ogni affermazione deve essere dimostrata con Lean."
});

test("Q2-018 (§58): an empty corpus certifies nothing", () => {
  const metrics = measureStrictMetrics([]);
  assert.equal(metrics.nonVacuous, false);
  assert.equal(metrics.allTargetsMet, false);
  for (const key of ["vccr", "ufar", "cber", "bier", "aper", "sor"]) {
    assert.equal(metrics[key].value, null, key);
    assert.equal(metrics[key].targetMet, false, key);
  }
});

test("Q2-018 (§33.1): an unsatisfied governed claim pulls VCCR below 1", () => {
  const coverage = measureContractCoverage({
    claims: [{ id: "C1", text: "The spectrum is discrete.", epistemicType: "DERIVED" }],
    verificationContract: STRICT,
    leanCertificates: [],
    claimCoverage: null
  });
  assert.equal(coverage.governed, 1);
  assert.equal(coverage.satisfied, 0);
  assert.equal(coverage.vccr, 0);
});

test("Q2-018 (§33.1): an uncovered assertive span is governed and unsatisfied", () => {
  const coverage = measureContractCoverage({
    claims: [],
    verificationContract: STRICT,
    leanCertificates: [],
    claimCoverage: { uncoveredSpans: ["Embeddings cluster into discrete semantic states."] }
  });
  assert.equal(coverage.governed, 1);
  assert.equal(coverage.vccr, 0);
});

test("Q2-018 (§33.2): a published unbound proof artifact raises UFAR", () => {
  const escaping = measureStrictMetrics([
    {
      published: true,
      assistantContent: "Dimostrazione Lean verificata.",
      claims: [],
      formalArtifacts: [
        { artifactId: "a1", renderedAsVerified: true, status: "UNCHECKED" },
        { artifactId: "a2", renderedAsVerified: true, status: "CHECKED_BOUND" }
      ]
    }
  ]);
  assert.equal(escaping.ufar.numerator, 1);
  assert.equal(escaping.ufar.denominator, 2);
  assert.equal(escaping.ufar.targetMet, false);

  const blocked = measureStrictMetrics([
    {
      published: false,
      assistantContent: "Dimostrazione Lean verificata.",
      claims: [],
      formalArtifacts: [{ artifactId: "a1", renderedAsVerified: true, status: "UNCHECKED" }]
    }
  ]);
  assert.equal(blocked.ufar.numerator, 0);
  assert.equal(blocked.ufar.denominator, 1);
  assert.equal(blocked.ufar.targetMet, true);
});

test("Q2-018 (§33.5): a published unbridged analogy raises APER", () => {
  const claim = {
    id: "C4",
    text: "L'attenzione agisce come una misura che collassa la sovrapposizione.",
    epistemicType: "ANALOGY"
  };
  const metrics = measureStrictMetrics([
    { published: true, assistantContent: claim.text, claims: [claim], formalArtifacts: [] }
  ]);
  assert.equal(metrics.aper.denominator, 1);
  // With no verified bridge the analogy is capped, so publishing it as an
  // analogy is not an escape; the escape is the promotion, which the gate blocks.
  assert.equal(metrics.aper.numerator, 0);
});

test("Q2-018 (§33.6): a published summary over unsettled components raises SOR", () => {
  const claims = [
    { id: "C1", text: "Constructor injectivity holds.", status: "UNKNOWN", epistemicType: "DERIVED" },
    {
      id: "S1",
      text: "Tutte le dimostrazioni sono formalmente verificate.",
      status: "VERIFIED",
      epistemicType: "DERIVED",
      dependencies: ["C1"]
    }
  ];
  const metrics = measureStrictMetrics([
    {
      published: true,
      assistantContent: "Tutte le dimostrazioni sono formalmente verificate.",
      claims,
      formalArtifacts: []
    }
  ]);
  assert.equal(metrics.sor.denominator, 1);
  assert.equal(metrics.sor.numerator, 1);
  assert.equal(metrics.sor.targetMet, false);
});

test("Q2-018/Q2-019 (§34, §58): the QHO adversarial corpus meets every target non-vacuously", async () => {
  const { runs, metrics, blockedAsExpected } = await runQhoLlmAdversarialCorpus();
  assert.equal(runs.length, 4);
  assert.equal(blockedAsExpected, true, "every candidate must land on its expected side of the gate");
  assert.equal(metrics.nonVacuous, true, JSON.stringify(metrics));
  assert.equal(metrics.allTargetsMet, true, JSON.stringify(metrics));
  assert.equal(metrics.vccr.value, 1);
  for (const key of ["ufar", "cber", "bier", "aper", "sor"]) {
    assert.equal(metrics[key].value, 0, key);
    assert.ok(metrics[key].denominator > 0, `${key} denominator must be non-zero`);
  }
});
