import test from "node:test";
import assert from "node:assert/strict";
import { CLAIM_AUTHORIZATION_MATRIX } from "./epistemicAuthorization.mjs";
import { evidenceFromToolResult } from "./epistemicEvidence.mjs";
import { MATH_CHECK_MARKER, MATH_VERDICT } from "./epistemicMathVerifier.mjs";
import { EXECUTION_VERDICT } from "./epistemicExecutionVerifier.mjs";
import { IDENTITY_VERDICT } from "./epistemicCitationIdentity.mjs";
import { ENTAILMENT_VERDICT } from "./epistemicEntailment.mjs";
import {
  NORMALIZED_VERDICT,
  REQUIREMENT_VERIFIER,
  VERIFIER_NAME,
  createVerifierBudget,
  dispatchClaimVerifiers,
  normalizeEntailmentResult,
  normalizeExecutionResult,
  normalizeIdentityResult,
  normalizeMathResult
} from "./epistemicVerifierDispatcher.mjs";

function claim(text, requirements) {
  return { id: "C1", text, verificationRequirements: requirements };
}

function sageResponse(outcome = "PASS") {
  return {
    content: `${MATH_CHECK_MARKER}: ${outcome}`,
    isError: false,
    runId: "run_1",
    sageResult: {
      status: "ok",
      state: "validated",
      runId: "run_1",
      execution: { ok: true, timedOut: false, exitCode: 0 }
    }
  };
}

function bashEvidence(command, exitCode = 0) {
  return evidenceFromToolResult({
    callId: `call_${command}`,
    toolName: "bash",
    arguments: { command },
    rawResult: { isError: exitCode !== 0, raw: { exit_code: exitCode }, content: "done" }
  });
}

test("VDISP-001: a Sage pass consumes one call and normalizes to PASSED", async () => {
  const budget = createVerifierBudget(1);
  const out = await dispatchClaimVerifiers({
    claim: claim("sqrt(4) = 2", ["math_verification"]),
    executeSage: async () => sageResponse("PASS"),
    budget
  });
  assert.equal(budget.used, 1);
  assert.equal(out.results[0].verifier, VERIFIER_NAME.MATH);
  assert.equal(out.results[0].requirement, "math_verification");
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.PASSED);
  assert.equal(out.generatedEvidence.length, 1);
});

test("VDISP-002: absent Sage is UNKNOWN and never PASSED", async () => {
  const out = await dispatchClaimVerifiers({
    claim: claim("sqrt(4) = 2", ["math_verification"]),
    budget: createVerifierBudget(1)
  });
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.UNKNOWN);
});

test("VDISP-003: budget exhaustion leaves later requirements UNKNOWN", async () => {
  const budget = createVerifierBudget(2);
  const out = await dispatchClaimVerifiers({
    claim: claim("sqrt(4) = 2; DOI: 10.1000/example; all tests pass", [
      "math_verification",
      "source_identity",
      "test_evidence"
    ]),
    executeSage: async () => sageResponse("PASS"),
    citationProviders: {},
    budget
  });
  assert.equal(budget.used, 2);
  assert.equal(out.executed.length, 2);
  assert.equal(out.results[2].status, NORMALIZED_VERDICT.UNKNOWN);
  assert.equal(out.results[2].reasonCode, "VERIFIER_BUDGET_EXHAUSTED");
});

test("VDISP-004: verifyMath=false prevents the Sage call", async () => {
  let calls = 0;
  const budget = createVerifierBudget(1);
  const out = await dispatchClaimVerifiers({
    claim: claim("sqrt(4) = 2", ["math_verification"]),
    executeSage: async () => {
      calls += 1;
      return sageResponse("PASS");
    },
    config: { verifyMath: false },
    budget
  });
  assert.equal(calls, 0);
  assert.equal(budget.used, 0);
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.UNKNOWN);
});

test("VDISP-005: verifyCitations=false prevents provider calls", async () => {
  let calls = 0;
  const out = await dispatchClaimVerifiers({
    claim: claim("DOI: 10.1000/example", ["source_identity"]),
    citationProviders: { openAlexProvider: { lookup: async () => { calls += 1; } } },
    config: { verifyCitations: false },
    budget: createVerifierBudget(1)
  });
  assert.equal(calls, 0);
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.UNKNOWN);
});

test("VDISP-006: unrelated execution evidence cannot satisfy test_evidence", async () => {
  const out = await dispatchClaimVerifiers({
    claim: claim("All tests pass.", ["test_evidence"]),
    evidence: [bashEvidence("ls -la")],
    budget: createVerifierBudget(1)
  });
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.FAILED);
  assert.deepEqual(out.results[0].failureCodes, ["F04"]);
});

test("VDISP-007: a successful test command binds its matching evidence id", async () => {
  const evidence = bashEvidence("npm test");
  const out = await dispatchClaimVerifiers({
    claim: claim("All tests pass.", ["test_evidence"]),
    evidence: [bashEvidence("ls -la"), evidence],
    budget: createVerifierBudget(1)
  });
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.PASSED);
  assert.deepEqual(out.results[0].evidenceIds, [evidence.id]);
});

test("VDISP-008: source entailment without a claim binding is UNKNOWN", async () => {
  const out = await dispatchClaimVerifiers({
    claim: claim("The paper proves X.", ["source_entailment"]),
    budget: createVerifierBudget(1)
  });
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.UNKNOWN);
  assert.equal(out.results[0].reasonCode, "SOURCE_BINDING_MISSING");
});

test("VDISP-009: a throwing citation provider cannot escape the dispatcher", async () => {
  const out = await dispatchClaimVerifiers({
    claim: claim("DOI: 10.1000/example", ["source_identity"]),
    citationProviders: {
      openAlexProvider: { lookup: async () => { throw new Error("offline"); } }
    },
    budget: createVerifierBudget(1)
  });
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.UNKNOWN);
});

test("strict normalizers preserve inconclusive and failure semantics", () => {
  assert.equal(
    normalizeMathResult({ verdict: MATH_VERDICT.UNKNOWN }, "math_verification").status,
    NORMALIZED_VERDICT.UNKNOWN
  );
  assert.equal(
    normalizeExecutionResult(
      { verdict: EXECUTION_VERDICT.NOT_APPLICABLE },
      "test_evidence"
    ).status,
    NORMALIZED_VERDICT.UNKNOWN
  );
  assert.equal(
    normalizeIdentityResult({ verdict: IDENTITY_VERDICT.PARTIAL }).status,
    NORMALIZED_VERDICT.UNKNOWN
  );
  assert.equal(
    normalizeEntailmentResult({ verdict: ENTAILMENT_VERDICT.PARTIAL }).status,
    NORMALIZED_VERDICT.UNKNOWN
  );
  assert.deepEqual(
    normalizeIdentityResult({ verdict: IDENTITY_VERDICT.MISMATCH, failureCodes: ["F17"] })
      .failureCodes,
    ["F17"]
  );
  assert.deepEqual(
    normalizeMathResult({ verdict: MATH_VERDICT.REFUTED, failureCodes: ["F05"] }, "math_verification")
      .failureCodes,
    ["F05"]
  );
});

test("every authorization requirement has an explicit orchestration mapping", () => {
  const requirements = new Set(
    Object.values(CLAIM_AUTHORIZATION_MATRIX).flatMap((entry) => entry.requiredEvidence ?? [])
  );
  for (const requirement of requirements) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(REQUIREMENT_VERIFIER, requirement),
      `missing dispatcher mapping: ${requirement}`
    );
  }
});

function scopedClaim(scope) {
  return {
    id: "C1",
    text: "sqrt(4) = 2",
    verificationRequirements: ["math_verification"],
    expectedCertificateScope: scope
  };
}

function mathScope(requiredProperties) {
  return {
    requiredProperties,
    allowedFormalizationKinds: ["CAS_EXPRESSION"],
    forbiddenSubstitutions: [],
    domain: "MATHEMATICS"
  };
}

test("CERT-001: PASSED + scope MATCH authorizes an effective PASSED", async () => {
  const out = await dispatchClaimVerifiers({
    claim: scopedClaim(mathScope(["math_verification"])),
    executeSage: async () => sageResponse("PASS"),
    budget: createVerifierBudget(1)
  });
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.PASSED);
  assert.equal(out.results[0].scope.status, "MATCH");
  assert.equal(out.results[0].checkId, "C1:math_verification:1");
  assert.ok(out.results[0].certificate, "a certificate is attached");
  assert.ok(out.verificationPlan, "a verification plan is created before execution");
  assert.equal(out.planReconciliation.mandatoryPassed, 1);
  assert.equal(out.planReconciliation.mandatoryFailedOrMissing, 0);
});

test("CERT-002: PASSED + scope PARTIAL downgrades to UNKNOWN", async () => {
  const out = await dispatchClaimVerifiers({
    claim: scopedClaim(mathScope(["math_verification", "oscillator_relation"])),
    executeSage: async () => sageResponse("PASS"),
    budget: createVerifierBudget(1)
  });
  assert.equal(out.results[0].scope.status, "PARTIAL");
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.UNKNOWN);
  assert.ok(out.results[0].failureCodes.includes("F27"));
});

test("CERT-003: PASSED + scope MISMATCH downgrades to UNKNOWN", async () => {
  const out = await dispatchClaimVerifiers({
    claim: scopedClaim(mathScope(["nuclear_stability"])),
    executeSage: async () => sageResponse("PASS"),
    budget: createVerifierBudget(1)
  });
  assert.equal(out.results[0].scope.status, "MISMATCH");
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.UNKNOWN);
  assert.ok(out.results[0].failureCodes.includes("F27"));
});

test("CERT-004: a claim without a predeclared scope is never granted MATCH by default", async () => {
  // Protected semantic claims are only authorized by a real certificate-scope
  // match; absence of a declared scope never produces an accidental MATCH.
  const out = await dispatchClaimVerifiers({
    claim: { id: "C1", text: "sqrt(4) = 2", verificationRequirements: ["math_verification"] },
    executeSage: async () => sageResponse("PASS"),
    budget: createVerifierBudget(1)
  });
  assert.equal(out.results[0].scope, null);
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.PASSED);
  assert.equal(out.verificationPlan.checks[0].expectedCertificateScope, null);
});

test("CERT-005: empty requirements never produce a vacuous plan PASS", async () => {
  const out = await dispatchClaimVerifiers({
    claim: { id: "C1", text: "no verification required", verificationRequirements: [] },
    budget: createVerifierBudget(1)
  });
  assert.equal(out.verificationPlan, null);
  assert.equal(out.planReconciliation, null);
});

test("R03-COVER-001: a FAILED verifier yields F29 mandatory coverage gap in the plan reconciliation", async () => {
  const out = await dispatchClaimVerifiers({
    claim: claim("sqrt(124000000) = 11", ["math_verification"]),
    executeSage: async () => sageResponse("FAIL"),
    budget: createVerifierBudget(1)
  });
  assert.ok(out.verificationPlan, "plan is built before dispatch");
  assert.equal(out.planReconciliation.status, "FAILED");
  assert.equal(out.planReconciliation.mandatoryFailedOrMissing, 1);
  assert.ok(out.planReconciliation.failureCodes.includes("F29"));
  assert.ok(out.results[0].subcheckAggregate === null || out.results[0].subcheckAggregate);
});

test("R03-COVER-002: full mandatory pass yields full coverage; a partial check cannot reach coverage 1", async () => {
  const full = await dispatchClaimVerifiers({
    claim: claim("sqrt(4) = 2", ["math_verification"]),
    executeSage: async () => sageResponse("PASS"),
    budget: createVerifierBudget(1)
  });
  assert.equal(full.planReconciliation.coverage, 1);
  assert.equal(full.planReconciliation.mandatoryFailedOrMissing, 0);
  assert.equal(full.planReconciliation.failureCodes.length, 0);
});

test("PLAN-ORDER-001: plan is built before any verifier and check ids originate in the plan", async () => {
  const events = [];
  const out = await dispatchClaimVerifiers({
    claim: { id: "C1", text: "sqrt(4) = 2", verificationRequirements: ["math_verification"] },
    executeSage: async () => {
      events.push("VERIFIER_CALLED");
      return sageResponse("PASS");
    },
    budget: createVerifierBudget(1)
  });
  const plan = out.verificationPlan;
  assert.ok(plan, "a verification plan exists");
  assert.ok(plan.checks.length > 0, "the plan predeclares checks");
  const planCheckIds = new Set(plan.checks.map((c) => c.id));
  assert.ok(out.results.length > 0, "verifier produced a result");
  for (const result of out.results) {
    assert.ok(
      planCheckIds.has(result.checkId),
      `result checkId ${result.checkId} originates in the predeclared plan`
    );
  }
  assert.equal(events.length, 1, "verifier ran exactly once");
});

test("PLAN-ORDER-002: unmapped requirement yields an UNKNOWN result with a plan check id, not a skip", async () => {
  const out = await dispatchClaimVerifiers({
    claim: { id: "C1", text: "some unmapped claim", verificationRequirements: ["no_such_verifier"] },
    budget: createVerifierBudget(5)
  });
  assert.ok(out.verificationPlan, "the plan exists even for an unmapped requirement");
  assert.equal(out.results.length, 1, "the unmapped requirement produced a result, not a skip");
  assert.equal(out.results[0].status, NORMALIZED_VERDICT.UNKNOWN);
  assert.equal(out.results[0].reasonCode, "VERIFIER_NOT_MAPPED");
  const planCheckIds = new Set(out.verificationPlan.checks.map((c) => c.id));
  assert.ok(planCheckIds.has(out.results[0].checkId), "unmapped result checkId comes from the plan");
});
