import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { DEFAULT_CONFIG, REQUEST_DEFAULTS } from "./defaultConfig.mjs";
import { DEFAULT_CONTEXT_LIMITS } from "./contextConfig.mjs";
import { LEAN_ORCHESTRATION_DEFAULTS } from "./lean/leanOrchestrationConfig.mjs";
import { SAGE_ORCHESTRATION_DEFAULTS } from "./sageOrchestrationConfig.mjs";

const EXPORTER = fileURLToPath(new URL("../scripts/printDefaultConfig.mjs", import.meta.url));

test("lean budgets come from the canonical policy, not from literals", () => {
  const { orchestration } = DEFAULT_CONFIG.lean;
  assert.equal(orchestration.maxAttempts, LEAN_ORCHESTRATION_DEFAULTS.maxAttempts);
  assert.equal(orchestration.maxSameFailure, LEAN_ORCHESTRATION_DEFAULTS.maxSameFailure);
  assert.equal(
    orchestration.maxPrematureFinalizations,
    LEAN_ORCHESTRATION_DEFAULTS.maxPrematureFinalizations
  );
  assert.equal(orchestration.maxWallClockMs, LEAN_ORCHESTRATION_DEFAULTS.maxWallClockMs);
});

test("sage budgets come from the canonical policy, not from literals", () => {
  const { orchestration } = DEFAULT_CONFIG.sage;
  for (const key of [
    "maxComputeAttempts",
    "maxRepairAttempts",
    "maxValidationAttempts",
    "maxPlotAttempts",
    "maxPrematureFinalizations",
    "maxSameFailure",
    "maxWallClockMs",
    "maxTotalToolCalls",
  ]) {
    assert.equal(orchestration[key], SAGE_ORCHESTRATION_DEFAULTS[key], `sage.orchestration.${key}`);
  }
});

test("contextWiki carries the nine canonical limits", () => {
  assert.deepEqual(
    { ...DEFAULT_CONFIG.contextWiki },
    { ...DEFAULT_CONTEXT_LIMITS }
  );
});

test("the six semantic defaults match the native C defaults", () => {
  // ds4_agent.c agent_lean_policy_auto_enabled / agent_sage_policy_auto_enabled
  // default to true; ds4_agent_runtime.c defaults orchestration to true and the
  // autonomous prompt to false.
  assert.equal(DEFAULT_CONFIG.lean.policyAuto, true);
  assert.equal(DEFAULT_CONFIG.sage.policyAuto, true);
  assert.equal(DEFAULT_CONFIG.lean.orchestration.enabled, true);
  assert.equal(DEFAULT_CONFIG.lean.orchestration.prompt, false);
  assert.equal(DEFAULT_CONFIG.sage.orchestration.enabled, true);
  assert.equal(DEFAULT_CONFIG.sage.orchestration.prompt, false);
});

test("the exporter prints parseable JSON with requestDefaults", () => {
  const stdout = execFileSync(process.execPath, [EXPORTER], { encoding: "utf8" });
  const parsed = JSON.parse(stdout);
  assert.equal(typeof parsed, "object");
  assert.deepEqual(parsed.requestDefaults, { ...REQUEST_DEFAULTS });
  assert.equal(parsed.lean.orchestration.maxAttempts, LEAN_ORCHESTRATION_DEFAULTS.maxAttempts);
  assert.equal(parsed.contextWiki.maxLedgerEvents, DEFAULT_CONTEXT_LIMITS.maxLedgerEvents);
});
