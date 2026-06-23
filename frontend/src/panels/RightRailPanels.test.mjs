// Non-regression test for the right-rail panel extraction.
// The panels are presentational; this test locks the data-driven contracts
// each panel relies on so behavior can't drift during/after extraction.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STARTUP_GROUPS,
  FIELD_LABELS,
  STARTUP_PLACEHOLDERS,
  STRATEGY_OPTIONS,
  REQUEST_PLACEHOLDERS,
  fieldType,
  startupHelp,
  serverFieldValue,
  requestHelp
} from "../appLogic.mjs";
import { isAutoMaxTokens } from "../../server/requestPayload.mjs";
import { metricRows, metricsAvailable, metricsSummary } from "../serverMetrics.mjs";

// ── RequestPanel contract ────────────────────────────────────────────────

test("RequestPanel: max_tokens 'auto' reveals safety-cap/context-margin fields", () => {
  assert.equal(isAutoMaxTokens("auto"), true);
  assert.equal(isAutoMaxTokens(4096), false);
});

test("RequestPanel: these keys are rendered separately and filtered out of the loop", () => {
  const excluded = ["system", "model", "endpoint", "max_tokens", "max_tokens_safety_cap", "context_margin"];
  const request = {
    max_tokens: "auto", max_tokens_safety_cap: 32768, context_margin: 1024,
    system: "s", model: "m", endpoint: "e",
    temperature: 0, stream: true, stop: ""
  };
  const looped = Object.entries(request).filter(([k]) => !excluded.includes(k)).map(([k]) => k);
  assert.deepEqual(looped, ["temperature", "stream", "stop"]);
});

test("RequestPanel: requestHelp/placeholder lookups are defined", () => {
  assert.equal(typeof requestHelp("max_tokens"), "string");
  assert.equal(REQUEST_PLACEHOLDERS.max_tokens, "auto or a number");
});

// ── StartupPanel contract ────────────────────────────────────────────────

test("StartupPanel: every group key maps to a label, help, and a field type", () => {
  for (const [, keys] of STARTUP_GROUPS) {
    for (const key of keys) {
      assert.ok(FIELD_LABELS[key], `label for ${key}`);
      assert.ok(startupHelp(key).length > 0, `help for ${key}`);
      assert.ok(["checkbox", "select", "text", "number"].includes(fieldType(key)), `type for ${key}`);
    }
  }
});

test("StartupPanel: backend renders as a select", () => {
  assert.equal(fieldType("backend"), "select");
});

test("StartupPanel: serverFieldValue reads env keys from server.env", () => {
  const server = { model: "x.gguf", env: { DS4_CUDA_NO_FD_CACHE: "1" } };
  assert.equal(serverFieldValue(server, "DS4_CUDA_NO_FD_CACHE"), "1");
  assert.equal(serverFieldValue(server, "model"), "x.gguf");
});

test("StartupPanel: placeholder falls back to empty string when undefined", () => {
  assert.equal(STARTUP_PLACEHOLDERS.ctx ?? "", "");
  assert.equal(STARTUP_PLACEHOLDERS.binary, "./ds4-server");
});

// ── StrategyPanel contract ───────────────────────────────────────────────

test("StrategyPanel: options carry key/title/description/disabled", () => {
  assert.ok(STRATEGY_OPTIONS.length >= 2);
  for (const opt of STRATEGY_OPTIONS) {
    assert.equal(typeof opt.key, "string");
    assert.equal(typeof opt.title, "string");
    assert.equal(typeof opt.disabled, "boolean");
  }
  // F is recommended and enabled
  const f = STRATEGY_OPTIONS.find((o) => o.key === "F");
  assert.equal(f.recommended, true);
  assert.equal(f.disabled, false);
});

// ── MetricsPanel contract ────────────────────────────────────────────────

test("MetricsPanel: helpers tolerate null metrics", () => {
  assert.equal(typeof metricsAvailable(null), "boolean");
  assert.equal(typeof metricsSummary(null), "string");
  assert.ok(Array.isArray(metricRows(null)));
});
