/** Test origin: DS4 acceptance requirements BEH-CONTRACT-001..005 and SEC-SCHEMA-001..002. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  EVOLUTION_TASK_VERSION,
  EVOLUTION_TASK_VERSION_V2,
  EVOLUTION_DIAGNOSIS_VERSION,
  EVOLUTION_GENERATED_PATCH_VERSION,
  EvolutionContractError,
  checkEvolutionTask,
  validateDiagnosis,
  validateEvolutionTask,
  validateGeneratedPatch,
  validateProvenanceRecord
} from "./evolutionContracts.mjs";

function validTask(overrides = {}) {
  return {
    contractVersion: EVOLUTION_TASK_VERSION,
    taskId: "contract-fixture",
    title: "Contract fixture",
    objective: "Exercise deterministic validation",
    workspaceRoot: ".",
    mutablePaths: ["frontend/server/example.mjs"],
    immutablePaths: ["frontend/server/evaluator"],
    baselineRef: "HEAD",
    evaluators: [{ id: "unit-tests", required: true, configuration: {} }],
    metrics: [{
      name: "correct",
      direction: "boolean",
      required: true,
      baselineTolerance: 0,
      target: true,
      weight: 1
    }],
    budgets: {
      maxRevisions: 2,
      maxFilesChanged: 2,
      maxAddedLines: 100,
      maxDeletedLines: 100,
      maxWallTimeMsPerRevision: 5_000,
      maxPromptTokensPerRevision: 1_000,
      maxCompletionTokensPerRevision: 1_000
    },
    approvalPolicy: { mode: "manual", allowedRiskLevels: ["LOW"] },
    ...overrides
  };
}

function validTaskV2(overrides = {}) {
  const task = validTask({
    contractVersion: EVOLUTION_TASK_VERSION_V2,
    automation: {
      level: "D",
      criticEnabled: true,
      proposerEnabled: true,
      autoContinue: true,
      modelProfile: "default"
    }
  });
  Object.assign(task.budgets, {
    maxTotalWallTimeMs: 30_000,
    maxTotalPromptTokens: 10_000,
    maxTotalCompletionTokens: 10_000,
    maxModelCallsPerRevision: 4,
    maxInfrastructureRetries: 1,
    maxEvaluatorRetries: 1,
    maxCriticRepairs: 1,
    maxProposerRepairs: 1,
    maxRepeatedFailureSignatures: 2,
    maxNoImprovementRevisions: 2
  });
  return { ...task, ...overrides };
}

test("BEH-CONTRACT-001 accepts and normalizes a valid task", () => {
  const value = validateEvolutionTask(validTask(), { repositoryRoot: process.cwd() });
  assert.equal(value.contractVersion, EVOLUTION_TASK_VERSION);
  assert.equal(value.workspaceRoot, process.cwd());
  assert.deepEqual(value.mutablePaths, ["frontend/server/example.mjs"]);
  assert.equal(checkEvolutionTask(validTask()).ok, true);
});

test("BEH-CONTRACT-002 rejects an unknown version", () => {
  assert.throws(
    () => validateEvolutionTask(validTask({ contractVersion: "future" })),
    (error) => error instanceof EvolutionContractError && error.code === "UNSUPPORTED_CONTRACT_VERSION"
  );
});

test("BEH-LOOP-001 accepts task v2 without changing task v1 output", () => {
  const v1 = validateEvolutionTask(validTask(), { repositoryRoot: process.cwd() });
  assert.equal(Object.hasOwn(v1, "automation"), false);
  const v2 = validateEvolutionTask(validTaskV2(), { repositoryRoot: process.cwd() });
  assert.equal(v2.contractVersion, EVOLUTION_TASK_VERSION_V2);
  assert.equal(v2.automation.level, "D");
  assert.equal(v2.budgets.maxModelCallsPerRevision, 4);
});

test("SEC-LOOP-001 task v2 fails closed for non-manual promotion and Level E", () => {
  assert.throws(
    () => validateEvolutionTask(validTaskV2({ approvalPolicy: { mode: "always_auto", allowedRiskLevels: ["LOW"] } })),
    (error) => error.issues.some((entry) => entry.code === "INVALID_APPROVAL_POLICY")
  );
  const levelE = validTaskV2();
  levelE.automation = { ...levelE.automation, level: "E" };
  assert.throws(() => validateEvolutionTask(levelE), (error) => error.code === "LEVEL_E_DISABLED");
});

test("SEC-MODEL-002 task v2 permits exactly one Critic and Proposer schema repair", () => {
  const input = validTaskV2();
  input.budgets.maxCriticRepairs = 2;
  assert.throws(
    () => validateEvolutionTask(input, { repositoryRoot: process.cwd() }),
    (error) => error.issues.some((entry) => entry.code === "INVALID_REPAIR_BUDGET")
  );
});

test("BEH-CONTRACT-003 rejects mutable and immutable overlap", () => {
  assert.throws(
    () => validateEvolutionTask(validTask({
      mutablePaths: ["frontend/server"],
      immutablePaths: ["frontend/server/evaluator"]
    })),
    (error) => error.code === "PATH_SCOPE_CONFLICT"
  );
});

test("BEH-CONTRACT-004 rejects a missing evaluator", () => {
  assert.throws(() => validateEvolutionTask(validTask({ evaluators: [] })), /at least one evaluator/);
});

test("BEH-CONTRACT-005 rejects missing metric semantics", () => {
  const task = validTask();
  task.metrics[0] = { ...task.metrics[0] };
  delete task.metrics[0].direction;
  assert.throws(() => validateEvolutionTask(task), (error) => error.code === "MISSING_METRIC_SEMANTICS");
});

test("SEC-SCHEMA-001 rejects oversized structured input", () => {
  assert.throws(
    () => validateEvolutionTask(validTask({ objective: "x".repeat(1000) }), { maxBytes: 100 }),
    (error) => error.code === "STRUCTURED_OUTPUT_TOO_LARGE"
  );
});

test("SEC-SCHEMA-002 rejects unknown critical fields", () => {
  assert.throws(
    () => validateEvolutionTask(validTask({ bypassGate: true })),
    (error) => error.issues.some((entry) => entry.code === "UNKNOWN_FIELD" && entry.path === "bypassGate")
  );
});

test("BEH-CRITIC-001 diagnosis is evidence-linked to the same run and revision", () => {
  const diagnosis = {
    diagnosisVersion: EVOLUTION_DIAGNOSIS_VERSION,
    revision: 1,
    status: "completed",
    summary: "Candidate regressed",
    rootCauses: [{
      code: "REGRESSION",
      description: "Metric decreased",
      evidenceRefs: [{ runId: "evo_0123456789abcdefabcd", revision: 1, artifactId: "sha256:abc", path: "evaluation.json", summary: "failed metric" }]
    }],
    recommendations: ["Change the bounded implementation"],
    confidence: 0.75
  };
  const ownership = { runId: "evo_0123456789abcdefabcd", revision: 1 };
  assert.equal(validateDiagnosis(diagnosis, ownership).confidence, 0.75);
  diagnosis.rootCauses[0].evidenceRefs[0].runId = "evo_ffffffffffffffffffff";
  assert.throws(() => validateDiagnosis(diagnosis, ownership), (error) => error.code === "CROSS_RUN_ACCESS_ATTEMPT");
});

test("SEC-PROPOSER-002 generated patch binds proposal revision, hash and target files", () => {
  const proposal = { revision: 1, targetFiles: ["frontend/server/example.mjs"] };
  const generated = validateGeneratedPatch({
    patchVersion: EVOLUTION_GENERATED_PATCH_VERSION,
    revision: 1,
    patchText: "diff --git a/frontend/server/example.mjs b/frontend/server/example.mjs\n--- a/frontend/server/example.mjs\n+++ b/frontend/server/example.mjs\n@@ -1 +1 @@\n-a\n+b\n",
    targetFiles: proposal.targetFiles,
    proposalHash: "a".repeat(64)
  }, proposal);
  assert.equal(generated.patchVersion, EVOLUTION_GENERATED_PATCH_VERSION);
  assert.equal(generated.patchText.endsWith("\n"), true);
  assert.throws(
    () => validateGeneratedPatch({ ...generated, targetFiles: ["outside.mjs"] }, proposal),
    (error) => error.code === "PROPOSAL_PATCH_MISMATCH"
  );
});

test("contract path validation rejects repository and workspace escapes", () => {
  assert.throws(() => validateEvolutionTask(validTask({ workspaceRoot: "../outside" })), /escapes repositoryRoot/);
  assert.throws(() => validateEvolutionTask(validTask({ mutablePaths: ["../../outside"] })), /escapes/);
  assert.throws(() => validateEvolutionTask(validTask({ mutablePaths: ["/tmp/outside"] })), /relative/);
});

test("SEC-HID-001 hidden evaluator paths must be normalized immutable paths", () => {
  const valid = validTask();
  valid.evaluators[0].configuration = { hiddenPaths: ["frontend/server/evaluator", "frontend/server/evaluator"] };
  assert.deepEqual(validateEvolutionTask(valid).evaluators[0].configuration.hiddenPaths, ["frontend/server/evaluator"]);

  const mutable = validTask();
  mutable.evaluators[0].configuration = { hiddenPaths: ["frontend/server/example.mjs"] };
  assert.throws(
    () => validateEvolutionTask(mutable),
    (error) => error.issues.some((entry) => entry.code === "HIDDEN_PATH_NOT_IMMUTABLE")
  );

  const traversal = validTask();
  traversal.evaluators[0].configuration = { hiddenPaths: ["../private"] };
  assert.throws(() => validateEvolutionTask(traversal), (error) => error.code === "INVALID_PATH");
});

test("SEC-GAME-004 stochastic metric extensions are rejected by deterministic Level B", () => {
  const value = validTask();
  value.metrics[0].stochastic = true;
  value.metrics[0].runs = 1;
  assert.throws(
    () => validateEvolutionTask(value),
    (error) => error.issues.some((entry) => entry.code === "UNKNOWN_FIELD" && entry.path.includes("metrics[0]"))
  );
});

test("CR-004 provenance records require complete clean-room attestations", () => {
  const record = {
    schema: "ds4_clean_room_provenance_v1",
    change_id: "CR-0001",
    requirements: ["BEH-CONTRACT-001"],
    ds4_components_reused: ["ToolBlobStore"],
    external_code_copied: false,
    external_prompts_copied: false,
    external_tests_copied: false,
    new_files: ["frontend/server/evolution/evolutionContracts.mjs"],
    modified_files: [],
    author_attestation: "independently implemented from DS4 specifications",
    review_status: "pending"
  };
  assert.equal(validateProvenanceRecord(record).change_id, "CR-0001");
  assert.throws(() => validateProvenanceRecord({ ...record, external_code_copied: true }), /must be false/);
});
