// Tests for leanContract.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLeanRequest,
  createLeanResultBase,
  finalizeLeanResult,
  validateLeanResult,
  normalizeLeanRequest,
} from "./leanContract.mjs";

const mockConfig = {
  defaultTimeoutSec: 30,
  maxTimeoutSec: 120,
};

function validRequest(overrides) {
  return Object.assign(
    {
      contractVersion: "lean_check_request_v1",
      code: "theorem t : 1 + 1 = 2 := by decide",
      mode: "check",
      profile: "core",
      timeoutSec: 10,
      sessionId: "session-abc123",
      runId: "lean-a1b2c3d4e5f6-1234567890-42",
      attempt: 1,
      policyRevision: "a".repeat(40),
      expectedDeclarations: ["t"],
      proofPolicy: "typecheck",
    },
    overrides
  );
}

test("validateLeanRequest — valid request", () => {
  const result = validateLeanRequest(validRequest(), mockConfig);
  assert.equal(result.ok, true);
});

test("validateLeanRequest — null body", () => {
  const result = validateLeanRequest(null, mockConfig);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_REQUEST_INVALID");
});

test("validateLeanRequest — missing code", () => {
  const result = validateLeanRequest({ contractVersion: "lean_check_request_v1" }, mockConfig);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_CODE_REQUIRED");
});

test("validateLeanRequest — source too large", () => {
  const bigCode = Buffer.alloc(513 * 1024 + 1, "x").toString("utf8");
  const req = validRequest({ code: bigCode });
  const result = validateLeanRequest(req, mockConfig);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_SOURCE_TOO_LARGE");
});

test("validateLeanRequest — unsupported mode", () => {
  const req = validRequest({ mode: "run" });
  const result = validateLeanRequest(req, mockConfig);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_MODE_UNSUPPORTED");
});

test("validateLeanRequest — unsupported profile", () => {
  const req = validRequest({ profile: "unknown" });
  const result = validateLeanRequest(req, mockConfig);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_PROFILE_UNSUPPORTED");
});

test("validateLeanRequest — invalid timeout", () => {
  const req = validRequest({ timeoutSec: 999 });
  const result = validateLeanRequest(req, mockConfig);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_TIMEOUT_INVALID");
});

test("createLeanResultBase — creates base object", () => {
  const req = validRequest();
  const meta = { runId: "lean-run-123", sessionId: "session-test" };
  const base = createLeanResultBase(req, meta);
  assert.equal(base.contractVersion, "lean_result_v1");
  assert.equal(base.runId, "lean-run-123");
  assert.equal(base.status, "pending");
  assert.equal(base.certified, false);
});

test("finalizeLeanResult — checked status", () => {
  const result = { status: "checked", exitCode: 0 };
  finalizeLeanResult(result);
  assert.equal(result.isError, false);
  assert.equal(result.certified, false);
});

test("finalizeLeanResult — failed status", () => {
  const result = { status: "failed", exitCode: 1 };
  finalizeLeanResult(result);
  assert.equal(result.isError, true);
});

test("validateLeanResult — valid checked proof result", () => {
  const result = finalizeLeanResult({
    contractVersion: "lean_result_v1",
    runId: "lean-run-123",
    status: "checked",
    isError: false,
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    certified: false,
    taskMode: "proof",
    targetDeclaration: "t",
    targetStatementSha256: "a".repeat(64),
    targetIdentityMatched: true,
    taskVerificationEligible: true,
    sourceSha256: "b".repeat(64),
  });
  const v = validateLeanResult(result);
  assert.equal(v.ok, true, v.errors.join("; "));
});

test("validateLeanResult — a result without an orchestration decision is invalid", () => {
  const v = validateLeanResult({
    contractVersion: "lean_result_v1",
    runId: "lean-run-123",
    status: "checked",
    isError: false,
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    certified: false,
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("orchestration")));
});

test("validateLeanResult — verified without status=checked is rejected", () => {
  const result = finalizeLeanResult({
    contractVersion: "lean_result_v1",
    runId: "lean-run-123",
    status: "failed",
    exitCode: 1,
    certified: false,
    diagnostics: [],
  });
  result.orchestration.verified = true;
  const v = validateLeanResult(result);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("verified=true without status=checked")));
});

test("validateLeanResult — retryable and terminal are mutually exclusive", () => {
  const result = finalizeLeanResult({
    contractVersion: "lean_result_v1",
    runId: "lean-run-123",
    status: "failed",
    exitCode: 1,
    certified: false,
    diagnostics: [],
  });
  assert.equal(result.orchestration.retryable, true);
  assert.equal(result.orchestration.terminal, false);
  result.orchestration.terminal = true;
  const v = validateLeanResult(result);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("retryable and terminal")));
});

test("finalizeLeanResult — checked yields a verified terminal decision", () => {
  const result = finalizeLeanResult({
    status: "checked",
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    taskMode: "proof",
    profile: "core",
    sourceSha256: "a".repeat(64),
    targetDeclaration: "t",
    targetIdentityAlgorithm: "lean-target-statement-v1",
    targetStatementSha256: "c".repeat(64),
    targetIdentityMatched: true,
    taskVerificationEligible: true,
  });
  assert.equal(result.orchestration.verified, true);
  assert.equal(result.orchestration.terminal, true);
  assert.equal(result.orchestration.retryable, false);
  assert.equal(result.orchestrationVerified, true);
  assert.equal(result.orchestrationNextAction, "publish_verified_result");
});

test("finalizeLeanResult — checked utility stays terminal but never verified", () => {
  const result = finalizeLeanResult({
    status: "checked",
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    taskMode: "utility",
  });
  assert.equal(result.orchestration.verified, false);
  assert.equal(result.orchestration.terminal, true);
});

test("validateLeanRequest — attempt 1..max accepted, max+1 rejected", () => {
  const config = { ...mockConfig, orchestration: { maxAttempts: 6 } };
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const ok = validateLeanRequest(validRequest({ attempt }), config);
    assert.equal(ok.ok, true, `attempt ${attempt} must be accepted`);
  }
  const rejected = validateLeanRequest(validRequest({ attempt: 7 }), config);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "LEAN_ATTEMPT_INVALID");
  assert.match(rejected.error.message, /1-6/);
});

test("validateLeanRequest — attempt 4 is no longer rejected by a literal 3", () => {
  const result = validateLeanRequest(validRequest({ attempt: 4 }), mockConfig);
  assert.equal(result.ok, true);
});

test("normalizeLeanRequest — mints a proofId and keeps a valid one", () => {
  const minted = normalizeLeanRequest(validRequest(), mockConfig);
  assert.equal(minted.ok, true);
  assert.match(minted.value.proofId, /^proof-[a-f0-9]{12}-\d+-\d+$/);

  const supplied = "proof-a1b2c3d4e5f6-1234567890-7";
  const kept = normalizeLeanRequest(validRequest({ proofId: supplied }), mockConfig);
  assert.equal(kept.ok, true);
  assert.equal(kept.value.proofId, supplied);

  const bad = normalizeLeanRequest(validRequest({ proofId: "nope" }), mockConfig);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "LEAN_PROOF_ID_INVALID");
});

test("validateLeanResult — invalid (certified in MVP)", () => {
  const result = {
    contractVersion: "lean_result_v1",
    runId: "lean-run-123",
    status: "checked",
    exitCode: 0,
    certified: true,
  };
  const v = validateLeanResult(result);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("certified")));
});

// ---- normalizeLeanRequest (R6) ----

test("normalizeLeanRequest — returns a frozen canonical request with defaults filled", () => {
  const req = validRequest();
  const { ok, value } = normalizeLeanRequest(req, mockConfig);
  assert.equal(ok, true);
  assert.ok(Object.isFrozen(value), "the canonical request must be frozen");
  assert.equal(value.contractVersion, "lean_check_request_v1");
  assert.equal(value.code, req.code);
  assert.equal(value.sessionId, "session-abc123");
  assert.equal(value.runId, "lean-a1b2c3d4e5f6-1234567890-42");
  assert.equal(value.mode, "check");
  assert.equal(value.profile, "core");
  assert.equal(value.timeoutSec, 10);
  assert.equal(value.attempt, 1);
  assert.equal(value.policyRevision, "a".repeat(40));
  assert.deepEqual(value.expectedDeclarations, ["t"]);
  assert.equal(value.proofPolicy, "typecheck");
});

test("normalizeLeanRequest — defaults sessionId to 'default' and runId via factory", () => {
  const req = { contractVersion: "lean_check_request_v1", code: "theorem t : True := trivial" };
  const { ok, value } = normalizeLeanRequest(req, mockConfig, {
    runIdFactory: () => "lean-feedface0001-7-9",
  });
  assert.equal(ok, true);
  assert.equal(value.sessionId, "default");
  assert.equal(value.runId, "lean-feedface0001-7-9");
  assert.equal(value.profile, "core", "defaultProfile fallback");
  assert.equal(value.timeoutSec, 30, "defaultTimeoutSec fallback");
});

test("normalizeLeanRequest — sessionIdFactory is used when no session is given", () => {
  const req = { contractVersion: "lean_check_request_v1", code: "theorem t : True := trivial" };
  const { ok, value } = normalizeLeanRequest(req, mockConfig, {
    sessionIdFactory: () => "factory-session",
    runIdFactory: () => "lean-feedface0001-7-9",
  });
  assert.equal(ok, true);
  assert.equal(value.sessionId, "factory-session");
});

test("normalizeLeanRequest — rejects an un-sanitizable sessionId", () => {
  const res = normalizeLeanRequest(
    { contractVersion: "lean_check_request_v1", code: "x", sessionId: "../../etc" },
    mockConfig
  );
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "LEAN_SESSION_ID_INVALID");
});

test("normalizeLeanRequest — rejects a runId that fails the production sanitizer", () => {
  for (const runId of ["lean-dup", "abc", "lean-a1b2c3d4e5f6-1-1:../x"]) {
    const res = normalizeLeanRequest(
      { contractVersion: "lean_check_request_v1", code: "x", runId },
      mockConfig
    );
    assert.equal(res.ok, false, `runId ${runId} must be rejected`);
    assert.equal(res.error.code, "LEAN_RUN_ID_INVALID");
  }
});

test("normalizeLeanRequest — propagates contract validation errors", () => {
  const res = normalizeLeanRequest({ contractVersion: "bogus", code: "x" }, mockConfig);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "LEAN_REQUEST_CONTRACT_UNSUPPORTED");
});

// ---------------------------------------------------------------------------
// promptRevision vs contractRevision (fix-revision-lean §4)
//
// One field used to mean both "the instructions this session holds" and "the
// protocol this client speaks". These tests pin the two apart: the prompt hash
// is never a compatibility statement, and the contract hash is never a prompt.
// ---------------------------------------------------------------------------

test("promptRevision must be 40 hex, contractRevision 64 hex", () => {
  const ok = validateLeanRequest(
    validRequest({
      policyRevision: undefined,
      promptRevision: "a".repeat(40),
      contractRevision: "b".repeat(64),
    }),
    mockConfig
  );
  assert.equal(ok.ok, true);

  const shortPrompt = validateLeanRequest(
    validRequest({ policyRevision: undefined, promptRevision: "a".repeat(39) }),
    mockConfig
  );
  assert.equal(shortPrompt.error.code, "LEAN_PROMPT_REVISION_INVALID");

  // A prompt hash offered as a contract revision is a length error, which is
  // exactly why the two use different hash functions.
  const promptAsContract = validateLeanRequest(
    validRequest({ contractRevision: "a".repeat(40) }),
    mockConfig
  );
  assert.equal(promptAsContract.error.code, "LEAN_CONTRACT_REVISION_INVALID");

  const upper = validateLeanRequest(
    validRequest({ contractRevision: "A".repeat(64) }),
    mockConfig
  );
  assert.equal(upper.error.code, "LEAN_CONTRACT_REVISION_INVALID");
});

test("the legacy policyRevision alias feeds promptRevision during the rollout", () => {
  const res = normalizeLeanRequest(
    validRequest({ policyRevision: "a".repeat(40) }),
    { ...mockConfig, allowLegacyPolicyRevision: true }
  );
  assert.equal(res.ok, true);
  assert.equal(res.value.promptRevision, "a".repeat(40));
  assert.equal(res.value.legacyPolicyRevision, "a".repeat(40));
  assert.equal(res.value.policyRevision, "a".repeat(40));
  assert.equal(res.value.contractRevision, null);
  assert.equal(res.value.policyMode, "base");
});

test("the legacy alias is refused once the rollout closes it", () => {
  const res = normalizeLeanRequest(
    validRequest({ policyRevision: "a".repeat(40) }),
    { ...mockConfig, allowLegacyPolicyRevision: false }
  );
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "LEAN_LEGACY_POLICY_REVISION_REFUSED");
});

test("two names for one prompt revision must not carry two values", () => {
  const res = validateLeanRequest(
    validRequest({ promptRevision: "a".repeat(40), policyRevision: "b".repeat(40) }),
    mockConfig
  );
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "LEAN_PROMPT_REVISION_ALIAS_MISMATCH");

  // Agreeing duplicates are fine: that is what a migrating client sends.
  const agreeing = validateLeanRequest(
    validRequest({ promptRevision: "a".repeat(40), policyRevision: "a".repeat(40) }),
    mockConfig
  );
  assert.equal(agreeing.ok, true);
});

test("an unknown policyMode is refused", () => {
  const res = validateLeanRequest(validRequest({ policyMode: "yolo" }), mockConfig);
  assert.equal(res.error.code, "LEAN_POLICY_MODE_UNSUPPORTED");
  assert.equal(
    validateLeanRequest(validRequest({ policyMode: "autonomous" }), mockConfig).ok,
    true
  );
});

test("a result reports both sides of the prompt revision, and the contract", () => {
  const request = normalizeLeanRequest(
    validRequest({
      policyRevision: undefined,
      promptRevision: "a".repeat(40),
      contractRevision: "b".repeat(64),
    }),
    mockConfig
  ).value;

  const base = createLeanResultBase(
    request,
    { runId: "lean-a1b2c3d4e5f6-1-1", sessionId: "s" },
    mockConfig,
    {
      serverPromptRevision: "f".repeat(40),
      contractRevision: "b".repeat(64),
      legacyClient: false,
    }
  );

  assert.equal(base.promptRevision, "a".repeat(40));
  assert.equal(base.serverPromptRevision, "f".repeat(40));
  assert.equal(base.promptRevisionMatchesServer, false);
  assert.equal(base.contractRevision, "b".repeat(64));
  assert.equal(base.policyRevision, "a".repeat(40), "the alias echoes the session, not the server");
  assert.deepEqual(base.promptDrift, {
    detected: true,
    blocking: false,
    action: "refresh-policy-when-convenient",
  });
  assert.equal(base.promptDriftDetected, true);
  assert.equal(base.promptDriftBlocking, false);
});

test("no drift is reported when the two prompt revisions agree", () => {
  const request = normalizeLeanRequest(
    validRequest({ policyRevision: undefined, promptRevision: "a".repeat(40) }),
    mockConfig
  ).value;
  const base = createLeanResultBase(request, {}, mockConfig, {
    serverPromptRevision: "a".repeat(40),
  });
  assert.equal(base.promptDriftDetected, false);
  assert.equal(base.promptRevisionMatchesServer, true);
  assert.equal(base.promptDrift.action, "none");
});

test("a checked run keeps its verified flag through a prompt drift", () => {
  const request = normalizeLeanRequest(
    validRequest({ policyRevision: undefined, promptRevision: "a".repeat(40) }),
    mockConfig
  ).value;
  const result = createLeanResultBase(request, { runId: "lean-a1b2c3d4e5f6-1-1" }, mockConfig, {
    serverPromptRevision: "f".repeat(40),
  });
  Object.assign(result, {
    status: "checked",
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    taskMode: "proof",
    targetDeclaration: "t",
    targetStatementSha256: "a".repeat(64),
    targetIdentityMatched: true,
    taskVerificationEligible: true,
    sourceSha256: "b".repeat(64),
  });
  finalizeLeanResult(result, { config: mockConfig });

  assert.equal(result.promptDriftDetected, true);
  assert.equal(result.orchestration.verified, true);
  assert.equal(result.orchestration.terminal, true);
  assert.equal(result.orchestration.retryable, false);
  assert.equal(result.orchestration.failureClass, null);
  assert.deepEqual(validateLeanResult(result), { ok: true, errors: [] });
});

test("a blocking prompt drift is a contract violation", () => {
  const request = normalizeLeanRequest(
    validRequest({ policyRevision: undefined, promptRevision: "a".repeat(40) }),
    mockConfig
  ).value;
  const result = createLeanResultBase(request, { runId: "lean-a1b2c3d4e5f6-1-1" }, mockConfig, {
    serverPromptRevision: "f".repeat(40),
  });
  Object.assign(result, { status: "checked", exitCode: 0 });
  finalizeLeanResult(result, { config: mockConfig });

  result.promptDrift.blocking = true;
  result.promptDriftBlocking = true;
  const validation = validateLeanResult(result);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /promptDrift\.blocking must be false/);
  assert.match(validation.errors.join(" "), /promptDriftBlocking must be false/);
});

// ============================================================================
// UTF8-001 §46 — the request gate accepts Lean notation and rejects corruption
// ============================================================================

test("validateLeanRequest — Lean Unicode notation is accepted verbatim", () => {
  const code =
    "import Mathlib.Analysis.Calculus.Deriv.MeanValue\n" +
    "variable (f g : ℝ → ℝ) {a b : ℝ} (hab : a < b)\n" +
    "theorem cauchy : ∃ c ∈ Set.Ioo a b, deriv f c = deriv g c := by\n" +
    "  sorry_free\n" +
    "-- continuità, derivabilità, ², ✓, 🚩\n";
  const result = validateLeanRequest(validRequest({ code, expectedDeclarations: ["cauchy"] }), mockConfig);
  assert.equal(result.ok, true);
  // Byte identity: the gate must not normalise the source it lets through.
  assert.equal(normalizeLeanRequest(validRequest({ code, expectedDeclarations: ["cauchy"] }), mockConfig).value.code, code);
});

test("validateLeanRequest — U+FFFD in the source is rejected, not repaired", () => {
  const corrupted = "variable (f g : ��� ��� ���) {a b : ���}\ntheorem t : True := by trivial";
  const result = validateLeanRequest(validRequest({ code: corrupted }), mockConfig);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_CODE_INVALID_UTF8");
  assert.equal(result.error.statusCode, 422);
});

test("validateLeanRequest — a single U+FFFD anywhere is enough to reject", () => {
  // §305 — inside a comment it is technically valid Unicode, but in a formal
  // source it is a corruption sentinel and is treated as one.
  const result = validateLeanRequest(
    validRequest({ code: "-- �\ntheorem t : True := by trivial" }),
    mockConfig
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_CODE_INVALID_UTF8");
});

// ============================================================================
// §13/§65-§67 — a probe is structurally unable to settle the task
// ============================================================================

test("a checked utility probe reports that it cannot verify the task", () => {
  // The historic failure was `theorem test : 1 + 1 = 2 := by decide` coming
  // back checked and being published as the answer to a Cauchy request.
  const request = normalizeLeanRequest(
    validRequest({
      code: "theorem probe : 1 + 1 = 2 := by decide",
      taskMode: "utility",
      expectedDeclarations: ["probe"],
    }),
    mockConfig
  );
  assert.equal(request.ok, true);

  const result = createLeanResultBase(request.value);
  result.status = "checked";
  const finalized = finalizeLeanResult(result, {});

  assert.equal(finalized.taskMode, "utility");
  assert.equal(finalized.taskVerificationEligible, false);
  assert.equal(finalized.orchestration.verified, false);
  assert.equal(finalized.attemptConsumed, false);
});

test("a proof-mode check is verification-eligible", () => {
  const request = normalizeLeanRequest(
    validRequest({
      code: "theorem t : 1 + 1 = 2 := by decide",
      taskMode: "proof",
      targetDeclaration: "t",
      expectedDeclarations: ["t"],
    }),
    mockConfig
  );
  assert.equal(request.ok, true);
  assert.equal(createLeanResultBase(request.value).taskVerificationEligible, true);
});

test("a utility result may not claim eligibility even if one is set on it", () => {
  const request = normalizeLeanRequest(
    validRequest({ code: "theorem probe : True := by trivial", taskMode: "utility" }),
    mockConfig
  );
  const result = createLeanResultBase(request.value);
  result.status = "checked";
  result.taskVerificationEligible = true;   // a caller trying it on
  const finalized = finalizeLeanResult(result, {});
  assert.equal(finalized.taskVerificationEligible, false);
});

// ============================================================================
// §11.2/§121/§123 — the seal is computed server-side for the native client
// ============================================================================
//
// The C orchestrator deliberately does not parse Lean statements. It sends the
// declared header and reads back the sealed digest, so the enforcement lives
// where the parser already is.

const CAUCHY_TARGET =
  "theorem cauchy_mvt (f g : ℝ → ℝ) (a b : ℝ) (hab : a < b) :\n" +
  "    ∃ c ∈ Set.Ioo a b, deriv f c * (g b - g a) = deriv g c * (f b - f a)";

test("a declared target statement seals the expected digest", () => {
  const result = normalizeLeanRequest(
    validRequest({
      code: `${CAUCHY_TARGET} := by\n  exact proof\n`,
      taskMode: "proof",
      targetDeclaration: "cauchy_mvt",
      targetStatement: CAUCHY_TARGET,
      expectedDeclarations: ["cauchy_mvt"],
      profile: "mathlib",
    }),
    mockConfig
  );

  assert.equal(result.ok, true);
  assert.match(result.value.taskStatementSha256, /^[0-9a-f]{64}$/);
  // Derived, so the executor's existing pre-spawn identity check enforces the
  // seal from attempt one.
  assert.equal(
    result.value.expectedTargetStatementSha256,
    result.value.taskStatementSha256
  );
});

test("§61 the seal is independent of the candidate that carries it", () => {
  const honest = normalizeLeanRequest(
    validRequest({
      code: `${CAUCHY_TARGET} := by\n  exact proof\n`,
      taskMode: "proof",
      targetDeclaration: "cauchy_mvt",
      targetStatement: CAUCHY_TARGET,
      expectedDeclarations: ["cauchy_mvt"],
    }),
    mockConfig
  );
  const substitute = normalizeLeanRequest(
    validRequest({
      code: "theorem cauchy_mvt : True := by trivial\n",
      taskMode: "proof",
      targetDeclaration: "cauchy_mvt",
      targetStatement: CAUCHY_TARGET,
      expectedDeclarations: ["cauchy_mvt"],
    }),
    mockConfig
  );

  // Same task, different candidate: the sealed digest does not move, so the
  // substitute is measured against the real statement.
  assert.equal(
    substitute.value.taskStatementSha256,
    honest.value.taskStatementSha256
  );
});

test("an unparseable declared statement is refused before anything runs", () => {
  const result = normalizeLeanRequest(
    validRequest({
      code: "theorem t : True := by trivial",
      taskMode: "proof",
      targetDeclaration: "t",
      targetStatement: "prove the mean value theorem",
      expectedDeclarations: ["t"],
    }),
    mockConfig
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_TASKSPEC_STATEMENT_INVALID");
});

test("§60 a client-supplied digest may not contradict the declared statement", () => {
  const result = normalizeLeanRequest(
    validRequest({
      code: `${CAUCHY_TARGET} := by\n  exact proof\n`,
      taskMode: "proof",
      targetDeclaration: "cauchy_mvt",
      targetStatement: CAUCHY_TARGET,
      expectedTargetStatementSha256: "b".repeat(64),
      expectedDeclarations: ["cauchy_mvt"],
    }),
    mockConfig
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_TASKSPEC_MUTATION_ATTEMPT");
});

test("utility checks may not seal a target statement", () => {
  const result = normalizeLeanRequest(
    validRequest({ code: "theorem p : True := by trivial", taskMode: "utility", targetStatement: CAUCHY_TARGET }),
    mockConfig
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_TARGET_STATEMENT_FORBIDDEN");
});

test("the sealed digest reaches the result and its flat native key", () => {
  const request = normalizeLeanRequest(
    validRequest({
      code: `${CAUCHY_TARGET} := by\n  exact proof\n`,
      taskMode: "proof",
      targetDeclaration: "cauchy_mvt",
      targetStatement: CAUCHY_TARGET,
      expectedDeclarations: ["cauchy_mvt"],
    }),
    mockConfig
  );
  const result = finalizeLeanResult(createLeanResultBase(request.value), {});
  assert.equal(result.taskStatementSha256, request.value.taskStatementSha256);
  assert.equal(result.orchestrationTaskStatementSha256, request.value.taskStatementSha256);
});
