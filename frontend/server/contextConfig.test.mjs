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

// --- file layer (refactoring 000 F3) ---

test("the file layer beats the default for all nine fields", () => {
  const file = {
    enabled: true,
    previewOnly: false,
    softTokens: 900,
    hardTokens: 2000,
    maxGrowthPct: 40,
    maxEvidence: 3,
    deltaRequired: false,
    telemetry: false,
    maxLedgerEvents: 77
  };
  assert.deepEqual(readContextConfig({}, file), file);
});

test("the environment beats the file", () => {
  const cfg = readContextConfig(
    { DS4_CONTEXT_WIKI_ENABLED: "0", DS4_CONTEXT_MAX_LEDGER_EVENTS: "11" },
    { enabled: true, maxLedgerEvents: 77 }
  );
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.maxLedgerEvents, 11);
});

test("an unusable file value falls back to the default", () => {
  const cfg = readContextConfig({}, { maxEvidence: 0, telemetry: "yes", softTokens: null });
  assert.equal(cfg.maxEvidence, DEFAULT_CONTEXT_LIMITS.maxEvidence);
  assert.equal(cfg.telemetry, DEFAULT_CONTEXT_LIMITS.telemetry);
  assert.equal(cfg.softTokens, DEFAULT_CONTEXT_LIMITS.softTokens);
});

test("an invalid env value falls back to the valid file value", () => {
  const cfg = readContextConfig(
    { DS4_CONTEXT_MAX_LEDGER_EVENTS: "abc", DS4_CONTEXT_DELTA_REQUIRED: "maybe" },
    { maxLedgerEvents: 77, deltaRequired: false }
  );
  assert.equal(cfg.maxLedgerEvents, 77);
  assert.equal(cfg.deltaRequired, false);
});

test("soft tokens never exceed hard tokens, whatever the layer", () => {
  assert.equal(readContextConfig({}, { softTokens: 9000, hardTokens: 2000 }).softTokens, 2000);
  assert.equal(
    readContextConfig({ DS4_CONTEXT_CAPSULE_SOFT_TOKENS: "9000" }, { hardTokens: 2000 }).softTokens,
    2000
  );
});

test("the one-argument call keeps the old defaults", () => {
  assert.deepEqual(readContextConfig({}), { ...DEFAULT_CONTEXT_LIMITS });
});
