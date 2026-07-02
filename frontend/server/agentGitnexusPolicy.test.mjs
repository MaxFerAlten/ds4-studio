import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGitnexusPolicy } from "./agentGitnexusPolicy.mjs";
import * as policyModule from "./agentGitnexusPolicy.mjs";

test("buildGitnexusPolicy returns empty string when disabled", () => {
  const result = buildGitnexusPolicy(false);
  assert.equal(result, "");
});

test("buildGitnexusPolicy returns policy text when enabled", () => {
  const result = buildGitnexusPolicy(true);
  assert.ok(result.startsWith("## GitNexus mandatory impact analysis"));
  assert.ok(result.includes("gitnexus_impact"));
  assert.ok(result.includes("gitnexus_detect_changes"));
  assert.ok(result.includes("Never skip GitNexus analysis"));
});

test("buildGitnexusPolicy handles undefined gracefully", () => {
  const result = buildGitnexusPolicy(undefined);
  assert.equal(result, "");
});

test("buildGitnexusPolicy handles null gracefully", () => {
  const result = buildGitnexusPolicy(null);
  assert.equal(result, "");
});
test("blocks cat of GitNexus temp output after analyze", () => {
  assert.equal(typeof policyModule.checkPostGitnexusAnalyzeAction, "function");
  const state = { gitnexusAnalyzeSeen: true };
  const block = policyModule.checkPostGitnexusAnalyzeAction({
    tool: "bash",
    args: { command: "cat /tmp/ds4_agent_output_abc" }
  }, state);

  assert.equal(block?.type, "STOP_POST_GITNEXUS_DUMP");
});

test("blocks repository-root list after analyze", () => {
  const state = { gitnexusAnalyzeSeen: true };
  const block = policyModule.checkPostGitnexusAnalyzeAction({
    tool: "list",
    target: "/mnt/samsung_ai/COPARATOR/ds4-studio"
  }, state);

  assert.equal(block?.type, "STOP_POST_GITNEXUS_DUMP");
});

test("allows targeted GitNexus query after analyze", () => {
  const state = { gitnexusAnalyzeSeen: true };
  const block = policyModule.checkPostGitnexusAnalyzeAction({
    tool: "bash",
    args: { command: "gitnexus query -r ds4-studio agent-loop-guard" }
  }, state);

  assert.equal(block, undefined);
});

test("records a successful GitNexus analyze result", () => {
  assert.equal(typeof policyModule.recordGitnexusAnalyzeResult, "function");
  const state = { gitnexusAnalyzeSeen: false };
  policyModule.recordGitnexusAnalyzeResult(
    { tool: "bash", args: { command: "gitnexus analyze" } },
    { isError: false, content: "Repository indexed successfully: 10 nodes, 12 edges, 2 flows" },
    state
  );

  assert.equal(state.gitnexusAnalyzeSeen, true);
});
