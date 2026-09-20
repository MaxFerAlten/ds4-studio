import test from "node:test";
import assert from "node:assert/strict";

import { EpistemicSessionLedger } from "./epistemicSessionLedger.mjs";
import { QUANTIUM_HARDENED_CONFIG, QUANTIUM_TURNS } from "./fixtures/quantiumConversation.mjs";
import {
  measureJsNoByteLeak,
  runFixture,
  runQuantiumHallucinationCorpus
} from "./quantiumCorpus.mjs";

test("REM-010.5: zero JS candidate bytes reach the user before the gate", async () => {
  const js = await measureJsNoByteLeak();
  assert.equal(js.candidateTextBytesBeforeGate, 0);
  assert.equal(js.candidateReasoningBytesBeforeGate, 0);
  assert.equal(js.candidateBytesBeforeGate, 0);
  assert.equal(js.noByteLeak, true);
});

test("FI-007 (REM-010.5): JS total bytes are the sum of text and reasoning", async () => {
  const js = await measureJsNoByteLeak();
  assert.equal(
    js.candidateBytesBeforeGate,
    js.candidateTextBytesBeforeGate + js.candidateReasoningBytesBeforeGate,
    "total = text + reasoning invariant"
  );
});

test("FI-008: a blocked fixture with non-empty reasoning leaks zero text and zero reasoning bytes", async () => {
  const session = new EpistemicSessionLedger();
  const fixture = QUANTIUM_TURNS.find((f) => f.id === "Q2");
  assert.ok(fixture && fixture.reasoning && fixture.reasoning.length > 0, "Q2 carries non-empty reasoning");
  const outcome = await runFixture(fixture, QUANTIUM_HARDENED_CONFIG, session);
  assert.equal(outcome.decision.allowed, false, "Q2 must block");
  assert.deepEqual(outcome.published, [], "no text reaches the user on a block");
  assert.deepEqual(outcome.publishedReasoning, [], "no reasoning reaches the user on a block");
  assert.deepEqual(outcome.publishedBeforeGate, [], "zero text bytes published before the gate");
  assert.deepEqual(outcome.publishedBeforeGateReasoning, [], "zero reasoning bytes published before the gate");
});

test("PATCH-31/37: Quantium hardened corpus executes the full gate and has zero S4/S5 escape", async () => {
  const session = new EpistemicSessionLedger();
  const outcomes = [];

  for (const fixture of QUANTIUM_TURNS) {
    const outcome = await runFixture(fixture, QUANTIUM_HARDENED_CONFIG, session);
    outcomes.push({ fixture, ...outcome });

    assert.equal(outcome.decision.extraction.status, "EXTRACTION_COMPLETE", fixture.id);
    assert.equal(outcome.claims.length, 1, fixture.id);
    assert.deepEqual(outcome.claims[0].verificationRequirements, fixture.expectedRequirements, fixture.id);
    assert.equal(
      outcome.claims[0].verifierResults.length,
      fixture.expectedRequirements.length,
      `${fixture.id}: every requirement receives a normalized result`
    );
    assert.ok(Array.isArray(outcome.decision.promotions), fixture.id);
    assert.equal(
      outcome.decision.promotions.length,
      fixture.expectedRequirements.length === 0 ? 0 : 1,
      fixture.id
    );
    if (outcome.decision.promotions[0]) {
      assert.ok(["VERIFY", "PARTIAL", "REJECT", "UNKNOWN"].includes(
        outcome.decision.promotions[0].promotion.decision
      ));
    }
    assert.ok(Array.isArray(outcome.sessionDelta.accepted), fixture.id);

    if (fixture.shouldBlock) {
      assert.equal(outcome.decision.allowed, false, fixture.id);
      assert.deepEqual(outcome.publishedBeforeGate, [], `${fixture.id}: no pre-gate bytes`);
      assert.deepEqual(outcome.published, [], `${fixture.id}: blocked bytes discarded`);
      assert.notEqual(outcome.claims[0].status, "VERIFIED", fixture.id);
    } else {
      assert.equal(outcome.decision.allowed, true, fixture.id);
      assert.deepEqual(outcome.published, [fixture.assistant], fixture.id);
      assert.notEqual(outcome.claims[0].status, "VERIFIED", "analogy is not promoted to fact");
    }
  }

  const escape = (
    await runQuantiumHallucinationCorpus(
      outcomes.map((outcome) => ({
        fixture: outcome.fixture,
        published: outcome.published
      }))
    )
  ).escape;
  assert.ok(escape.invalidHighSeverityClaimsGenerated > 0, "non-vacuous denominator");
  assert.equal(escape.invalidHighSeverityClaimsPublished, 0);
  assert.equal(escape.escapeRate, 0);
  assert.equal(escape.targetMet, true);
});

test("PATCH-38: shadow detects the same Quantium failures but does not enforce", async () => {
  const config = { ...QUANTIUM_HARDENED_CONFIG, mode: "shadow" };
  const session = new EpistemicSessionLedger();

  for (const fixture of QUANTIUM_TURNS.filter((entry) => entry.shouldBlock)) {
    const outcome = await runFixture(fixture, config, session);
    assert.equal(outcome.decision.allowed, true, fixture.id);
    assert.equal(outcome.decision.wouldBlock, true, fixture.id);
    assert.deepEqual(outcome.published, [fixture.assistant], fixture.id);
    assert.equal(outcome.decision.shadowTrace?.wouldBlock, true, fixture.id);
  }
});

test("PATCH-32: EPI-020..024 remain UNKNOWN/FAILED until a real domain verifier exists", async () => {
  const cases = [
    {
      id: "EPI-020",
      assistant: "The attention operator is exactly Hermitian.",
      claims: [{ id: "C1", text: "The attention operator is exactly Hermitian.", epistemicType: "DERIVED", flags: { containsSymbolicDerivation: true, usesProtectedLanguage: true } }],
      expectedRequirements: ["symbolic_verification"]
    },
    {
      id: "EPI-021",
      assistant: "The synthetic target benchmark validates 99% accuracy.",
      claims: [{ id: "C1", text: "The synthetic target benchmark validates 99% accuracy.", epistemicType: "OBSERVED", flags: { assertsBenchmark: true, usesProtectedLanguage: true } }],
      expectedRequirements: ["math_verification", "benchmark_evidence"]
    },
    {
      id: "EPI-022",
      assistant: "A finite partition function proves a second-order phase transition.",
      claims: [{ id: "C1", text: "A finite partition function proves a second-order phase transition.", epistemicType: "DERIVED", flags: { containsSymbolicDerivation: true, usesProtectedLanguage: true } }],
      expectedRequirements: ["symbolic_verification"]
    },
    {
      id: "EPI-023",
      assistant: "The Hamiltonian spectrum is exactly the density spectrum.",
      claims: [{ id: "C1", text: "The Hamiltonian spectrum is exactly the density spectrum.", epistemicType: "SOURCE_FACT", flags: { containsExternalFact: true, usesProtectedLanguage: true } }],
      expectedRequirements: ["symbolic_verification", "source_entailment"]
    },
    {
      id: "EPI-024",
      assistant: "This chat snippet is an existing installable working artifact.",
      claims: [{ id: "C1", text: "This chat snippet is an existing installable working artifact.", epistemicType: "OBSERVED", flags: { assertsExecution: true, usesProtectedLanguage: true } }],
      expectedRequirements: ["execution_evidence"]
    }
  ];

  for (const entry of cases) {
    const outcome = await runFixture(
      { ...entry, shouldBlock: true },
      QUANTIUM_HARDENED_CONFIG,
      new EpistemicSessionLedger()
    );
    assert.deepEqual(outcome.claims[0].verificationRequirements, entry.expectedRequirements, entry.id);
    assert.notEqual(outcome.claims[0].status, "VERIFIED", entry.id);
    assert.notEqual(outcome.decision.promotions[0].promotion.decision, "VERIFY", entry.id);
    assert.equal(outcome.decision.allowed, false, entry.id);
    assert.deepEqual(outcome.published, [], entry.id);
  }
});

test("PATCH-39: normal prompts avoid gratuitous verifier work and authoritative promotion", async () => {
  const session = new EpistemicSessionLedger();
  const cases = [
    { id: "NORM-001", assistant: "Onde leggere, respiro del mare.", claims: [], requirements: [], allowed: true },
    {
      id: "NORM-002",
      assistant: "Ipotizziamo, come analogia, che i modi di attenzione si comportino come oscillatori.",
      claims: [{ id: "C1", text: "I modi di attenzione si comportano come oscillatori solo come analogia.", epistemicType: "HYPOTHESIS", flags: {} }],
      requirements: [],
      allowed: true
    },
    {
      id: "NORM-003",
      assistant: "Non posso fornire il DOI esatto senza verificarlo.",
      claims: [{ id: "C1", text: "Il DOI esatto del paper X deve essere verificato.", epistemicType: "SOURCE_FACT", flags: { containsCitation: true } }],
      requirements: ["source_identity"],
      allowed: false
    },
    { id: "NORM-004", assistant: "È una bozza: non ho eseguito il codice né i test.", claims: [], requirements: [], allowed: true }
  ];

  for (const entry of cases) {
    const outcome = await runFixture(
      { ...entry, user: entry.id, expectedRequirements: entry.requirements },
      QUANTIUM_HARDENED_CONFIG,
      session
    );
    assert.equal(outcome.decision.allowed, entry.allowed, `${entry.id}:${outcome.decision.code}`);
    assert.equal(outcome.decision.verifierSummary.budgetUsed, entry.id === "NORM-003" ? 1 : 0, entry.id);
    if (outcome.claims[0]) assert.notEqual(outcome.claims[0].status, "VERIFIED", entry.id);
  }
});
