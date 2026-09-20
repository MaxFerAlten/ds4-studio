import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import {
  SAGE_ORCHESTRATION_DEFAULTS,
  SAGE_FUNCTION_STUDY_ARTIFACT_KINDS,
  resolveSageOrchestrationConfig,
  sageTaskRequiresPlots,
  validateSageOrchestrationConfig
} from "./sageOrchestrationConfig.mjs";

const POLICY_PATH = new URL("../../config/sage-orchestration-policy.json", import.meta.url);

test("the defaults come from the policy file, not from literals", () => {
  const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
  assert.equal(SAGE_ORCHESTRATION_DEFAULTS.maxRepairAttempts, policy.maxRepairAttempts);
  assert.equal(SAGE_ORCHESTRATION_DEFAULTS.maxValidationAttempts, policy.maxValidationAttempts);
  assert.equal(SAGE_ORCHESTRATION_DEFAULTS.maxTotalToolCalls, policy.maxTotalToolCalls);
});

test("the budget admits at least one validation per candidate", () => {
  // Un compute piu' N repair producono N+1 candidate: senza N+1 validate il
  // ciclo compute → validate → repair → validate non e' rappresentabile.
  const config = resolveSageOrchestrationConfig({}, {});
  assert.ok(
    config.maxValidationAttempts >= config.maxRepairAttempts + 1,
    `maxValidationAttempts=${config.maxValidationAttempts} non copre ` +
      `${config.maxRepairAttempts} repair`
  );
});

test("env overrides the file and the file overrides the default", () => {
  const config = resolveSageOrchestrationConfig(
    { DS4_SAGE_MAX_REPAIR_ATTEMPTS: "6" },
    { maxRepairAttempts: 2, maxPlotAttempts: 4 }
  );
  assert.equal(config.maxRepairAttempts, 6);
  assert.equal(config.sources.maxRepairAttempts, "env");
  assert.equal(config.maxPlotAttempts, 4);
  assert.equal(config.sources.maxPlotAttempts, "file");
  assert.equal(config.sources.maxSameFailure, "default");
});

test("out-of-range values are clamped with a warning, never obeyed", () => {
  const config = resolveSageOrchestrationConfig({}, { maxRepairAttempts: 99 });
  assert.equal(config.maxRepairAttempts, 8);
  assert.ok(config.warnings.some((warning) => warning.includes("maxRepairAttempts=99")));
});

test("a non-integer env value falls back instead of poisoning the budget", () => {
  const config = resolveSageOrchestrationConfig({ DS4_SAGE_MAX_PLOT_ATTEMPTS: "molti" }, {});
  assert.equal(config.maxPlotAttempts, SAGE_ORCHESTRATION_DEFAULTS.maxPlotAttempts);
  assert.ok(config.warnings.some((warning) => warning.includes("DS4_SAGE_MAX_PLOT_ATTEMPTS")));
});

test("the call ceiling is raised, not the phase budgets lowered", () => {
  const config = resolveSageOrchestrationConfig({}, { maxTotalToolCalls: 2 });
  assert.equal(config.maxTotalToolCalls, 12);
  assert.ok(config.warnings.some((warning) => warning.includes("below the sum of the phase budgets")));
});

test("the hard ceiling stays above the domain budget", () => {
  const config = resolveSageOrchestrationConfig({}, {});
  assert.ok(config.hardMaxTotalCalls > config.maxTotalToolCalls);
  assert.ok(config.hardMaxWallClockMs > config.maxWallClockMs);
});

test("the rollback switch disables the gate without touching the budget", () => {
  const off = resolveSageOrchestrationConfig({ DS4_SAGE_AUTONOMOUS_ORCHESTRATION: "0" }, {});
  assert.equal(off.enabled, false);
  assert.equal(off.maxRepairAttempts, SAGE_ORCHESTRATION_DEFAULTS.maxRepairAttempts);
  assert.equal(resolveSageOrchestrationConfig({}, {}).enabled, true);
});

test("legacy rollout alias is accepted with a deprecation warning", () => {
  const config = resolveSageOrchestrationConfig({ DS4_SAGE_V2: "1" }, {});
  assert.equal(config.enabled, true);
  assert.ok(config.warnings.some((warning) => warning.includes("deprecated")));
});

test("validateSageOrchestrationConfig reports shape and coherence problems", () => {
  assert.deepEqual(validateSageOrchestrationConfig(resolveSageOrchestrationConfig({}, {})), []);
  assert.deepEqual(validateSageOrchestrationConfig(null), [
    "sage.orchestration must be an object"
  ]);
  const errors = validateSageOrchestrationConfig({
    ...SAGE_ORCHESTRATION_DEFAULTS,
    maxRepairAttempts: 4,
    maxTotalToolCalls: 3
  });
  assert.ok(errors.some((error) => error.includes("below the sum of the phase budgets")));
});

test("only graphical tasks require the plot package", () => {
  assert.equal(sageTaskRequiresPlots("function_study"), true);
  assert.equal(sageTaskRequiresPlots("plot"), true);
  assert.equal(sageTaskRequiresPlots("evaluate"), false);
  assert.equal(sageTaskRequiresPlots("auto"), false);
  assert.deepEqual([...SAGE_FUNCTION_STUDY_ARTIFACT_KINDS], [
    "function_plot",
    "first_derivative_plot",
    "second_derivative_plot"
  ]);
});

test("the generated C header carries the same numbers as the JSON", () => {
  const root = new URL("../../", import.meta.url).pathname;
  execFileSync("node", ["scripts/generate-sage-orchestration-policy.mjs"], { cwd: root });
  const header = readFileSync(`${root}generated/sage_orchestration_policy.h`, "utf8");
  const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
  const macro = (name) => Number(header.match(new RegExp(`#define ${name} (\\d+)`))?.[1]);
  assert.equal(macro("DS4_SAGE_MAX_TOTAL_CALLS_HARD"), policy.hardMaxTotalCalls);
  assert.equal(macro("DS4_SAGE_MAX_WALL_CLOCK_HARD_MS"), policy.hardMaxWallClockMs);
  assert.equal(macro("DS4_SAGE_MAX_PREMATURE_FINALIZATIONS"), policy.maxPrematureFinalizations);
  // The domain budget must NOT reach C: the server owns it.
  assert.doesNotMatch(header, /DS4_SAGE_MAX_REPAIR_ATTEMPTS|DS4_SAGE_MAX_VALIDATION/);
});

// --- typed enabled/prompt layers (refactoring 000 F3) ---

test("enabled and prompt default to the native C values", () => {
  const cfg = resolveSageOrchestrationConfig({}, {});
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.prompt, false);
  assert.equal(cfg.sources.enabled, "default");
  assert.equal(cfg.sources.prompt, "default");
});

test("the file layer beats the default for enabled and prompt", () => {
  const cfg = resolveSageOrchestrationConfig({}, { enabled: false, prompt: true });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.prompt, true);
  assert.equal(cfg.sources.enabled, "file");
  assert.equal(cfg.sources.prompt, "file");
});

test("the environment beats the file for enabled and prompt", () => {
  const cfg = resolveSageOrchestrationConfig(
    { DS4_SAGE_AUTONOMOUS_ORCHESTRATION: "0", DS4_SAGE_AUTONOMOUS_PROMPT: "1" },
    { enabled: true, prompt: false }
  );
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.prompt, true);
  assert.equal(cfg.sources.enabled, "env");
  assert.equal(cfg.sources.prompt, "env");
});

test("the deprecated aliases still resolve enabled", () => {
  const viaV2 = resolveSageOrchestrationConfig({ DS4_SAGE_V2: "0" }, { enabled: true });
  assert.equal(viaV2.enabled, false);
  assert.equal(viaV2.sources.enabled, "env");
  const viaOrchestrationV2 = resolveSageOrchestrationConfig(
    { DS4_SAGE_ORCHESTRATION_V2: "0" },
    {}
  );
  assert.equal(viaOrchestrationV2.enabled, false);
});

test("the canonical env key wins over its alias", () => {
  const cfg = resolveSageOrchestrationConfig(
    { DS4_SAGE_AUTONOMOUS_ORCHESTRATION: "1", DS4_SAGE_V2: "0" },
    {}
  );
  assert.equal(cfg.enabled, true);
});

test("an invalid env boolean warns and keeps the file value", () => {
  const cfg = resolveSageOrchestrationConfig(
    { DS4_SAGE_AUTONOMOUS_PROMPT: "sometimes" },
    { prompt: true }
  );
  assert.equal(cfg.prompt, true);
  assert.equal(cfg.sources.prompt, "file");
  assert.match(cfg.warnings.join("\n"), /DS4_SAGE_AUTONOMOUS_PROMPT='sometimes'/);
});
