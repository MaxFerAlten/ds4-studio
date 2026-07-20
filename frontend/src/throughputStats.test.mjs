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

  assert.equal("renderedText" in tracker, false);
  assert.equal(tracker.renderedChars, 5);
  assert.equal(first.stats.promptTokens, 80);
  assert.equal(first.stats.completionTokens, 2);
  assert.equal(first.stats.prefillTps, 40);
  assert.equal(first.stats.genTps, null);

  const second = updateLiveStats(tracker, { content: " world, this is streaming", nowMs: 5000 });

  assert.equal(second.stats.promptTokens, 80);
  assert.equal(second.tracker.renderedChars, "hello world, this is streaming".length);
  assert.ok(second.stats.completionTokens > first.stats.completionTokens);
  assert.equal(second.stats.genTps, null);
});

test("tracks streamed content by character count without retaining text", () => {
  let tracker = createLiveStatsTracker({ requestStartMs: 0, promptTokens: 1 });
  tracker = updateLiveStats(tracker, { content: "ab", reasoning: "cd", nowMs: 10 }).tracker;
  tracker = updateLiveStats(tracker, { content: "efgh", nowMs: 20 }).tracker;

  assert.equal(tracker.renderedChars, 8);
  assert.equal("renderedText" in tracker, false);
});

test("uses exact usage values for final stream stats", () => {
  const stats = streamStatsFromTiming({
    requestStartMs: 1000,
    firstTokenMs: 3000,
    promptTokens: 120,
    completionTokens: 48,
    generationSeconds: 4,
    generationSource: "server",
    stream: true
  });

  assert.equal(stats.promptTokens, 120);
  assert.equal(stats.completionTokens, 48);
  assert.equal(stats.prefillTps, 60);
  assert.equal(stats.prefillWithCacheTps, 60);
  assert.equal(stats.genTps, 12);
  assert.equal("effectiveGenTps" in stats, false);
  assert.equal(stats.genSource, "server");
});

test("separates effective prefill throughput from throughput with cache", () => {
  const stats = streamStatsFromTiming({
    requestStartMs: 1000,
    firstTokenMs: 3000,
    promptTokens: 120,
    promptTokensDetails: {
      cached_tokens: 100,
      cache_write_tokens: 20
    },
    completionTokens: 48,
    stream: true
  });

  assert.equal(stats.promptTokens, 120);
  assert.equal(stats.cachedTokens, 100);
  assert.equal(stats.prefillTokens, 20);
  assert.equal(stats.prefillTps, 10);
  assert.equal(stats.prefillWithCacheTps, 60);
});

test("does not invent native throughput when backend timing is unavailable", () => {
  let tracker = createLiveStatsTracker({ requestStartMs: 1000, promptTokens: 80 });
  tracker = updateLiveStats(tracker, { content: "hello", nowMs: 3000 }).tracker;
  tracker = updateLiveStats(tracker, { content: " world", nowMs: 5000 }).tracker;

  const stats = finalizeLiveStats(tracker, {
    promptTokens: 120,
    promptTokensDetails: {
      cached_tokens: 96,
      cache_write_tokens: 24
    },
    completionTokens: 48
  });

  assert.equal(stats.promptTokens, 120);
  assert.equal(stats.completionTokens, 48);
  assert.equal(stats.prefillTps, 12);
  assert.equal(stats.prefillWithCacheTps, 60);
  assert.equal(stats.genTps, null);
});

test("uses backend phase timings for agent throughput", () => {
  let tracker = createLiveStatsTracker({ requestStartMs: 1000, promptTokens: 80 });
  tracker = updateLiveStats(tracker, { content: "hello", nowMs: 5000 }).tracker;
  tracker = updateLiveStats(tracker, { content: " world", nowMs: 15000 }).tracker;

  const stats = finalizeLiveStats(tracker, {
    promptTokens: 120,
    promptTokensDetails: {
      cached_tokens: 100,
      cache_write_tokens: 20
    },
    completionTokens: 48,
    prefillSeconds: 0.5,
    generationSeconds: 3,
    generationSource: "agent"
  });

  assert.equal(stats.prefillTps, 40);
  assert.equal(stats.prefillWithCacheTps, 240);
  assert.equal(stats.genTps, 16);
  assert.equal(stats.genSource, "agent");
});

test("uses backend decode tokens for native throughput", () => {
  const stats = streamStatsFromTiming({
    requestStartMs: 1000,
    firstTokenMs: 1200,
    promptTokens: 10,
    completionTokens: 10,
    generationTokens: 20,
    generationSeconds: 1,
    generationSource: "server"
  });

  assert.equal(stats.genTps, 20);
});
