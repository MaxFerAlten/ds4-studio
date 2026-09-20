import test from "node:test";
import assert from "node:assert/strict";
import {
  EPISTEMIC_TELEMETRY_METRICS,
  createEpistemicTelemetry,
  epistemicTelemetryEvent
} from "./epistemicTelemetry.mjs";

test("§64 exposes the exact epistemic metric vocabulary", () => {
  assert.deepEqual(EPISTEMIC_TELEMETRY_METRICS, [
    "claims_total",
    "claims_verified",
    "claims_partial",
    "claims_rejected",
    "claims_unknown",
    "promotion_block_total",
    "fabricated_experiment_block_total",
    "execution_claim_block_total",
    "citation_identity_mismatch_total",
    "entailment_absent_total",
    "challenge_total",
    "challenge_supported_total",
    "challenge_rejected_total",
    "repair_opened_total",
    "repair_failed_total",
    "critique_echo_block_total",
    "post_compile_block_total",
    "claim_extraction_complete_total",
    "claim_extraction_partial_total",
    "verifier_call_total",
    "verifier_pass_total",
    "verifier_fail_total",
    "verifier_unknown_total",
    "verifier_budget_exhausted_total",
    "unresolved_requirement_total",
    "promotion_verify_total",
    "promotion_partial_total",
    "promotion_reject_total",
    "promotion_unknown_total",
    "session_repromotion_block_total",
    "js_native_mode_mismatch_total",
    "self_challenge_total",
    "open_challenge_debt_total",
    "corrective_state_regression_block_total",
    "local_axiom_proof_claim_block_total",
    "model_capability_mismatch_total",
    "source_role_promotion_block_total",
    "paraphrase_escape_block_total"
  ]);
  assert.deepEqual(
    createEpistemicTelemetry().snapshot(),
    Object.fromEntries(EPISTEMIC_TELEMETRY_METRICS.map((name) => [name, 0]))
  );
});

test("one audit event accounts for claim outcomes, challenges, repair, and block classes", () => {
  const telemetry = createEpistemicTelemetry();
  const claims = [
    { id: "c1", text: "must not be logged", status: "VERIFIED", failureCodes: ["F03"], evidenceIds: ["e1"] },
    { id: "c2", status: "PARTIAL", failureCodes: ["F04", "F17"] },
    { id: "c3", status: "REJECTED", failureCodes: ["F02"] },
    { id: "c4", status: "CONTRADICTED", failureCodes: ["F23"] },
    { id: "c5", status: "PROPOSED", failureCodes: ["F25"] }
  ];
  const event = telemetry.record({
    at: "2026-08-26T00:00:00.000Z",
    mode: "block",
    decision: {
      code: "EPISTEMIC_SEVERITY_UNRESOLVED",
      allowed: false,
      mustContinue: true,
      blockedClaimIds: ["c1", "c2", "c3", "c4", "c5"]
    },
    claims,
    challenges: [
      { id: "ch1", status: "SUPPORTED" },
      { id: "ch2", status: "REJECTED" },
      { id: "ch3", status: "UNVERIFIED" }
    ],
    repair: { opened: true, failed: true, round: 2 }
  });

  assert.equal(event.type, "epistemic_audit");
  assert.equal(event.claims[0].text, undefined);
  assert.equal(JSON.stringify(event).includes("must not be logged"), false);
  assert.deepEqual(telemetry.snapshot(), {
    claims_total: 5,
    claims_verified: 1,
    claims_partial: 1,
    claims_rejected: 2,
    claims_unknown: 1,
    promotion_block_total: 1,
    fabricated_experiment_block_total: 1,
    execution_claim_block_total: 1,
    citation_identity_mismatch_total: 1,
    entailment_absent_total: 1,
    challenge_total: 3,
    challenge_supported_total: 1,
    challenge_rejected_total: 1,
    repair_opened_total: 1,
    repair_failed_total: 1,
    critique_echo_block_total: 1,
    post_compile_block_total: 1,
    claim_extraction_complete_total: 0,
    claim_extraction_partial_total: 0,
    verifier_call_total: 0,
    verifier_pass_total: 0,
    verifier_fail_total: 0,
    verifier_unknown_total: 0,
    verifier_budget_exhausted_total: 0,
    unresolved_requirement_total: 0,
    promotion_verify_total: 0,
    promotion_partial_total: 0,
    promotion_reject_total: 0,
    promotion_unknown_total: 0,
    session_repromotion_block_total: 0,
    js_native_mode_mismatch_total: 0,
    self_challenge_total: 0,
    open_challenge_debt_total: 0,
    corrective_state_regression_block_total: 0,
    local_axiom_proof_claim_block_total: 0,
    model_capability_mismatch_total: 0,
    source_role_promotion_block_total: 0,
    paraphrase_escape_block_total: 0
  });
});

test("verifier-debt telemetry is compact, non-vacuous, and counts production fields", () => {
  const telemetry = createEpistemicTelemetry();
  const event = telemetry.record({
    decision: {
      allowed: false,
      extraction: { status: "EXTRACTION_COMPLETE" },
      verifierSummary: { budgetUsed: 3, sessionBlocks: 1 },
      promotions: [
        { claimId: "c1", promotion: { decision: "VERIFY", unmetRequirements: [] } },
        { claimId: "c2", promotion: { decision: "UNKNOWN", unmetRequirements: ["source_identity"] } }
      ]
    },
    claims: [
      {
        id: "c1",
        text: "private claim text",
        status: "VERIFIED",
        verifierResults: [
          { requirement: "test_evidence", verifier: "execution", status: "PASSED" }
        ]
      },
      {
        id: "c2",
        status: "UNKNOWN",
        verifierResults: [
          {
            requirement: "source_identity",
            verifier: "citation",
            status: "UNKNOWN",
            reasonCode: "VERIFIER_BUDGET_EXHAUSTED"
          },
          { requirement: "source_entailment", verifier: "entailment", status: "FAILED", failureCodes: ["F02"] }
        ]
      }
    ],
    jsNativeModeMismatch: true
  });

  assert.equal(JSON.stringify(event).includes("private claim text"), false);
  assert.deepEqual(event.verifierResults[1], {
    claimId: "c2",
    requirement: "source_identity",
    verifier: "citation",
    status: "UNKNOWN",
    failureCode: "VERIFIER_BUDGET_EXHAUSTED"
  });
  assert.deepEqual(telemetry.snapshot(), {
    ...Object.fromEntries(EPISTEMIC_TELEMETRY_METRICS.map((name) => [name, 0])),
    claims_total: 2,
    claims_verified: 1,
    claims_unknown: 1,
    post_compile_block_total: 1,
    claim_extraction_complete_total: 1,
    verifier_call_total: 3,
    verifier_pass_total: 1,
    verifier_fail_total: 1,
    verifier_unknown_total: 1,
    verifier_budget_exhausted_total: 1,
    unresolved_requirement_total: 1,
    promotion_verify_total: 1,
    promotion_unknown_total: 1,
    session_repromotion_block_total: 1,
    js_native_mode_mismatch_total: 1
  });
});

test("shadow would-blocks count without claiming the answer was withheld", () => {
  const telemetry = createEpistemicTelemetry();
  const event = telemetry.record({
    decision: {
      code: "EPISTEMIC_EXECUTION_CLAIM_WITHOUT_TRACE",
      allowed: true,
      mustContinue: false,
      wouldBlock: true,
      snapshot: {
        revision: 7,
        mode: "shadow",
        challengeCount: 2,
        claims: [{ id: "c1", status: "UNKNOWN", failureCodes: [] }]
      }
    }
  });

  assert.equal(event.decision.allowed, true);
  assert.equal(event.blocks.executionClaim, true);
  assert.equal(event.blocks.postCompile, true);
  assert.equal(telemetry.snapshot().execution_claim_block_total, 1);
  assert.equal(telemetry.snapshot().post_compile_block_total, 1);
  assert.equal(telemetry.snapshot().challenge_total, 2);
});

test("a clean decision does not invent block or repair counters", () => {
  const telemetry = createEpistemicTelemetry();
  telemetry.record(epistemicTelemetryEvent({
    decision: { code: "EPISTEMIC_CLEAN", allowed: true },
    claims: [{ id: "c1", status: "VERIFIED", evidenceIds: ["e1"] }]
  }));

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.claims_total, 1);
  assert.equal(snapshot.claims_verified, 1);
  assert.equal(snapshot.post_compile_block_total, 0);
  assert.equal(snapshot.repair_opened_total, 0);
});

test("§127: the corrective-history counters follow the failure codes that caused the block", () => {
  const telemetry = createEpistemicTelemetry();
  telemetry.record({
    mode: "block",
    decision: { code: "EPISTEMIC_SEVERITY_UNRESOLVED", allowed: false, blockedClaimIds: ["c1", "c2"] },
    claims: [
      {
        id: "c1",
        status: "UNKNOWN",
        failureCodes: ["F34", "F39", "F36"],
        challengeDebtIds: ["d1", "d2"],
        inheritedClaimRelation: "PARAPHRASE"
      },
      { id: "c2", status: "REJECTED", failureCodes: ["F35", "F38", "F37"] }
    ]
  });

  const counters = telemetry.snapshot();
  assert.equal(counters.self_challenge_total, 1);
  assert.equal(counters.open_challenge_debt_total, 2);
  assert.equal(counters.corrective_state_regression_block_total, 1);
  assert.equal(counters.local_axiom_proof_claim_block_total, 1);
  assert.equal(counters.model_capability_mismatch_total, 1);
  assert.equal(counters.source_role_promotion_block_total, 1);
  assert.equal(counters.paraphrase_escape_block_total, 1);
});

test("§127: an answer that ships clean moves none of the corrective counters", () => {
  const telemetry = createEpistemicTelemetry();
  telemetry.record({
    mode: "block",
    decision: { code: "EPISTEMIC_CLEAN", allowed: true },
    claims: [{ id: "c1", status: "VERIFIED", failureCodes: [], evidenceIds: ["e1"] }]
  });
  const counters = telemetry.snapshot();
  for (const name of [
    "corrective_state_regression_block_total",
    "local_axiom_proof_claim_block_total",
    "model_capability_mismatch_total",
    "source_role_promotion_block_total",
    "paraphrase_escape_block_total",
    "self_challenge_total",
    "open_challenge_debt_total"
  ]) {
    assert.equal(counters[name], 0, name);
  }
});
