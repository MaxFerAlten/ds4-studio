import assert from "node:assert/strict";
import { test } from "node:test";
import { readContextConfig, readBoolEnv, DEFAULT_CONTEXT_LIMITS } from "./contextConfig.mjs";

test("context config defaults to disabled preview-only", () => {
  const cfg = readContextConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.previewOnly, true);
  assert.equal(cfg.softTokens, 1500);
  assert.equal(cfg.hardTokens, 3000);
});

test("parses boolean forms 1/0/true/false", () => {
  assert.equal(readBoolEnv({ K: "1" }, "K", false), true);
  assert.equal(readBoolEnv({ K: "0" }, "K", true), false);
  assert.equal(readBoolEnv({ K: "true" }, "K", false), true);
  assert.equal(readBoolEnv({ K: "FALSE" }, "K", true), false);
  assert.equal(readBoolEnv({ K: "on" }, "K", false), true);
  assert.equal(readBoolEnv({ K: "off" }, "K", true), false);
});

test("invalid boolean uses fallback", () => {
  assert.equal(readBoolEnv({ K: "maybe" }, "K", true), true);
  assert.equal(readBoolEnv({ K: "" }, "K", false), false);
  assert.equal(readBoolEnv({}, "K", true), true);
});

test("soft limit cannot exceed hard limit", () => {
  const cfg = readContextConfig({
    DS4_CONTEXT_CAPSULE_SOFT_TOKENS: "9999",
    DS4_CONTEXT_CAPSULE_HARD_TOKENS: "2000"
  });
  assert.equal(cfg.hardTokens, 2000);
  assert.equal(cfg.softTokens, 2000);
});

test("invalid numbers use fallback", () => {
  const cfg = readContextConfig({
    DS4_CONTEXT_CAPSULE_HARD_TOKENS: "not-a-number",
    DS4_CONTEXT_CAPSULE_MAX_GROWTH_PCT: "-5"
  });
  assert.equal(cfg.hardTokens, DEFAULT_CONTEXT_LIMITS.hardTokens);
  assert.equal(cfg.maxGrowthPct, DEFAULT_CONTEXT_LIMITS.maxGrowthPct);
});

test("maxEvidence stays positive from fallback", () => {
  const cfg = readContextConfig({ DS4_CONTEXT_CAPSULE_MAX_EVIDENCE: "0" });
  assert.ok(cfg.maxEvidence > 0);
  assert.equal(cfg.maxEvidence, DEFAULT_CONTEXT_LIMITS.maxEvidence);
});

test("enabled/previewOnly honor env overrides", () => {
  const cfg = readContextConfig({
    DS4_CONTEXT_WIKI_ENABLED: "1",
    DS4_CONTEXT_PREVIEW_ONLY: "0"
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.previewOnly, false);
});
