import assert from "node:assert/strict";
import test from "node:test";
import {
  createLiveStatsTracker,
  estimateTokenCount,
  finalizeLiveStats,
  streamStatsFromTiming,
  updateLiveStats
} from "./throughputStats.mjs";

test("estimates tokens from streamed text", () => {
  assert.equal(estimateTokenCount(""), 0);
  assert.equal(estimateTokenCount("abcd"), 1);
  assert.equal(estimateTokenCount("abcde"), 2);
});

test("updates prefill and generation throughput while deltas stream", () => {
  let tracker = createLiveStatsTracker({ requestStartMs: 1000, promptTokens: 80 });

  const first = updateLiveStats(tracker, { content: "hello", nowMs: 3000 });
  tracker = first.tracker;

  assert.equal(first.stats.promptTokens, 80);
  assert.equal(first.stats.completionTokens, 2);
  assert.equal(first.stats.prefillTps, 40);
  assert.equal(first.stats.genTps, null);

  const second = updateLiveStats(tracker, { content: " world, this is streaming", nowMs: 5000 });

  assert.equal(second.stats.promptTokens, 80);
  assert.ok(second.stats.completionTokens > first.stats.completionTokens);
  assert.ok(second.stats.genTps > 0);
});

test("uses exact usage values for final stream stats", () => {
  const stats = streamStatsFromTiming({
    requestStartMs: 1000,
    firstTokenMs: 3000,
    lastTokenMs: 7000,
    promptTokens: 120,
    completionTokens: 48,
    stream: true
  });

  assert.equal(stats.promptTokens, 120);
  assert.equal(stats.completionTokens, 48);
  assert.equal(stats.prefillTps, 60);
  assert.equal(stats.genTps, 12);
});

test("finalizes live stream stats with exact usage without dropping throughput", () => {
  let tracker = createLiveStatsTracker({ requestStartMs: 1000, promptTokens: 80 });
  tracker = updateLiveStats(tracker, { content: "hello", nowMs: 3000 }).tracker;
  tracker = updateLiveStats(tracker, { content: " world", nowMs: 5000 }).tracker;

  const stats = finalizeLiveStats(tracker, {
    promptTokens: 120,
    completionTokens: 48
  });

  assert.equal(stats.promptTokens, 120);
  assert.equal(stats.completionTokens, 48);
  assert.equal(stats.prefillTps, 60);
  assert.equal(stats.genTps, 24);
});
