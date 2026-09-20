import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LEAN_ORCHESTRATION_DEFAULTS,
  resolveLeanOrchestrationConfig,
} from "./leanOrchestrationConfig.mjs";

test("budgets default to the canonical policy file", () => {
  const cfg = resolveLeanOrchestrationConfig({}, {});
  assert.equal(cfg.maxAttempts, LEAN_ORCHESTRATION_DEFAULTS.maxAttempts);
  assert.equal(cfg.maxWallClockMs, LEAN_ORCHESTRATION_DEFAULTS.maxWallClockMs);
  assert.equal(cfg.sources.maxAttempts, "default");
});

test("enabled and prompt default to the native C values", () => {
  const cfg = resolveLeanOrchestrationConfig({}, {});
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.prompt, false);
  assert.equal(cfg.sources.enabled, "default");
  assert.equal(cfg.sources.prompt, "default");
});

test("the file layer beats the default for enabled and prompt", () => {
  const cfg = resolveLeanOrchestrationConfig({}, { enabled: false, prompt: true });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.prompt, true);
  assert.equal(cfg.sources.enabled, "file");
  assert.equal(cfg.sources.prompt, "file");
});

test("the environment beats the file for enabled and prompt", () => {
  const cfg = resolveLeanOrchestrationConfig(
    { DS4_LEAN_AUTONOMOUS_ORCHESTRATION: "0", DS4_LEAN_AUTONOMOUS_PROMPT: "1" },
    { enabled: true, prompt: false }
  );
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.prompt, true);
  assert.equal(cfg.sources.enabled, "env");
  assert.equal(cfg.sources.prompt, "env");
});

test("an invalid env boolean warns and keeps the file value", () => {
  const cfg = resolveLeanOrchestrationConfig(
    { DS4_LEAN_AUTONOMOUS_ORCHESTRATION: "maybe" },
    { enabled: false }
  );
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.sources.enabled, "file");
  assert.match(cfg.warnings.join("\n"), /DS4_LEAN_AUTONOMOUS_ORCHESTRATION='maybe'/);
});

test("an empty env value is not an override", () => {
  const cfg = resolveLeanOrchestrationConfig({ DS4_LEAN_AUTONOMOUS_PROMPT: "" }, { prompt: true });
  assert.equal(cfg.prompt, true);
  assert.equal(cfg.sources.prompt, "file");
});
