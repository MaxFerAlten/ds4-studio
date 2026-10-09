import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "./defaultConfig.mjs";
import { mergeConfig, validateConfig } from "./config.mjs";
import { engineStartupWarning, resolveAgentEngine } from "./agentEngine.mjs";

// WP1 of convergenza.loop.md added the switch; WP17 moved the default to "js".
// "native" keeps the C agent inside ds4-wrapper, "js" runs the Node loop.
// With no wrapper there is no C agent at all, so only "js" is possible.

test("resolveAgentEngine keeps the native C agent when the wrapper is on", () => {
  assert.equal(resolveAgentEngine({ wrapperEnabled: true, engine: "native" }), "native");
});

test("resolveAgentEngine selects the JS loop when the engine is js", () => {
  assert.equal(resolveAgentEngine({ wrapperEnabled: true, engine: "js" }), "js");
});

test("resolveAgentEngine has no native option without the wrapper", () => {
  assert.equal(resolveAgentEngine({ wrapperEnabled: false, engine: "native" }), "js");
  assert.equal(resolveAgentEngine({ wrapperEnabled: false, engine: "js" }), "js");
});

test("resolveAgentEngine treats a missing engine as js", () => {
  assert.equal(resolveAgentEngine({ wrapperEnabled: true, engine: undefined }), "js");
});

test("DEFAULT_CONFIG ships the js engine (WP17)", () => {
  assert.equal(DEFAULT_CONFIG.agent.engine, "js");
  assert.equal(mergeConfig({}).agent.engine, "js");
  assert.equal(validateConfig(mergeConfig({})).ok, true);
});

test("the native engine is announced at startup", () => {
  // The GUI profile picks the engine (local DS4 -> native, endpoint -> js), so
  // native is a supported choice for local DS4, logged with a pointer to the doc.
  assert.equal(
    engineStartupWarning("native"),
    "native agent engine selected for local DS4; see docs/AGENT_ENGINE.md"
  );
  assert.equal(engineStartupWarning("js"), null);
});

test("validateConfig accepts only native or js for agent.engine", () => {
  const bad = validateConfig(mergeConfig({ agent: { engine: "python" } }));
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.agent.engine, "must be 'native' or 'js'");
  assert.equal(validateConfig(mergeConfig({ agent: { engine: "js" } })).ok, true);
  assert.equal(validateConfig(mergeConfig({ agent: { engine: "native" } })).ok, true);
});
