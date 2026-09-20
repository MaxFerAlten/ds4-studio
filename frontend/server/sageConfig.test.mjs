import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveSageConfig } from "./sageConfig.mjs";
import { SAGE_ORCHESTRATION_DEFAULTS } from "./sageOrchestrationConfig.mjs";
import { resetEnvBooleanWarningsForTests } from "./envBoolean.mjs";

test("policyAuto defaults to the native C value", () => {
  const { config, sources } = resolveSageConfig({}, {});
  assert.equal(config.policyAuto, true);
  assert.equal(sources.policyAuto, "default");
});

test("the file layer beats the default", () => {
  const { config, sources } = resolveSageConfig({}, { policyAuto: false });
  assert.equal(config.policyAuto, false);
  assert.equal(sources.policyAuto, "file");
});

test("the environment beats the file", () => {
  const { config, sources } = resolveSageConfig(
    { DS4_SAGE_POLICY_AUTO: "0" },
    { policyAuto: true }
  );
  assert.equal(config.policyAuto, false);
  assert.equal(sources.policyAuto, "env");
});

test("DS4_SAGE_SKILL_AUTO still works and reports a deprecation", () => {
  resetEnvBooleanWarningsForTests();
  const { config, sources, warnings } = resolveSageConfig({ DS4_SAGE_SKILL_AUTO: "0" }, {});
  assert.equal(config.policyAuto, false);
  assert.equal(sources.policyAuto, "env");
  assert.match(warnings.join("\n"), /DS4_SAGE_SKILL_AUTO is deprecated/);
});

test("the canonical key wins over the deprecated alias", () => {
  const { config } = resolveSageConfig(
    { DS4_SAGE_POLICY_AUTO: "1", DS4_SAGE_SKILL_AUTO: "0" },
    {}
  );
  assert.equal(config.policyAuto, true);
});

test("the orchestration budget comes from the existing resolver", () => {
  const { config } = resolveSageConfig({}, { orchestration: { maxRepairAttempts: 6 } });
  assert.equal(config.orchestration.maxRepairAttempts, 6);
  assert.equal(config.orchestration.sources.maxRepairAttempts, "file");
  assert.equal(
    config.orchestration.maxValidationAttempts,
    SAGE_ORCHESTRATION_DEFAULTS.maxValidationAttempts
  );
  assert.equal(config.orchestration.enabled, true);
  assert.equal(config.orchestration.prompt, false);
});

test("unrelated file keys survive the resolution", () => {
  const { config } = resolveSageConfig({}, { somethingElse: 42 });
  assert.equal(config.somethingElse, 42);
});

test("orchestration warnings bubble up to the caller", () => {
  const { warnings } = resolveSageConfig({ DS4_SAGE_MAX_REPAIR_ATTEMPTS: "nope" }, {});
  assert.match(warnings.join("\n"), /DS4_SAGE_MAX_REPAIR_ATTEMPTS='nope'/);
});
