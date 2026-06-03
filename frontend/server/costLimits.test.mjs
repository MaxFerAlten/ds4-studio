import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentBudgetStatus,
  analyzeChunkLimitExceeded,
  analyzeChunkPlan,
  estimateAgentMessagesTokens,
  maxAgentTotalTokens,
  maxAnalyzeChunks,
  readPositiveIntEnv
} from "./costLimits.mjs";

test("reads positive integer env limits", () => {
  assert.equal(maxAnalyzeChunks({ DS4_MAX_ANALYZE_CHUNKS: "12" }), 12);
  assert.equal(maxAgentTotalTokens({ DS4_AGENT_MAX_TOTAL_TOKENS: "4096" }), 4096);
  assert.equal(readPositiveIntEnv({ X: "0" }, "X", 7), 7);
  assert.equal(readPositiveIntEnv({ X: "8.5" }, "X", 7), 7);
  assert.equal(readPositiveIntEnv({ X: "nope" }, "X", 7), 7);
  assert.equal(readPositiveIntEnv({}, "X", 7), 7);
});

test("builds chunked analyze cost plan", () => {
  const chunks = [{ approxTokens: 10 }, { approxTokens: 20 }];
  assert.deepEqual(analyzeChunkPlan(chunks, 3), {
    phase: "plan",
    chunks: 2,
    estimatedMapCalls: 2,
    estimatedReduceCalls: 1,
    maxChunks: 3
  });
  assert.equal(analyzeChunkLimitExceeded(chunks, 2), false);
  assert.equal(analyzeChunkLimitExceeded(chunks, 1), true);
});

test("estimates agent messages including reasoning and tool calls", () => {
  assert.equal(estimateAgentMessagesTokens([{ role: "user", content: "abcd" }]), 1);

  const plain = estimateAgentMessagesTokens([{ role: "assistant", content: "abcd" }]);
  const withExtras = estimateAgentMessagesTokens([{
    role: "assistant",
    content: "abcd",
    reasoning_content: "abcdefgh",
    tool_calls: [{ id: "call_1", function: { name: "read", arguments: "{\"path\":\"a\"}" } }]
  }]);
  assert.ok(withExtras > plain);
});

test("flags agent token budget by estimate or backend totals", () => {
  const ok = agentBudgetStatus(
    [{ role: "user", content: "abcd" }],
    { total_tokens: 2 },
    10
  );
  assert.equal(ok.exceeded, false);
  assert.equal(ok.estimatedTokens, 1);
  assert.equal(ok.totalTokens, 2);

  const overEstimate = agentBudgetStatus(
    [{ role: "user", content: "x".repeat(41) }],
    { total_tokens: 0 },
    10
  );
  assert.equal(overEstimate.exceeded, true);
  assert.equal(overEstimate.reason, "estimated_messages");

  const overUsage = agentBudgetStatus(
    [{ role: "user", content: "abcd" }],
    { total_tokens: 10 },
    10
  );
  assert.equal(overUsage.exceeded, true);
  assert.equal(overUsage.reason, "backend_usage");
});
