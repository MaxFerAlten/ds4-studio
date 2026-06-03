export function estimateTokenCount(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  return Math.ceil(value.length / 4);
}

export function streamStatsFromTiming({
  requestStartMs,
  firstTokenMs,
  lastTokenMs,
  promptTokens,
  completionTokens,
  stream = true
}) {
  const prefillS = firstTokenMs != null ? (firstTokenMs - requestStartMs) / 1000 : 0;
  const genS = firstTokenMs != null && lastTokenMs != null && lastTokenMs > firstTokenMs
    ? (lastTokenMs - firstTokenMs) / 1000
    : 0;
  return {
    promptTokens,
    completionTokens,
    prefillTps: prefillS > 0 && promptTokens > 0 ? promptTokens / prefillS : null,
    genTps: genS > 0 && completionTokens > 0 ? completionTokens / genS : null,
    stream
  };
}

export function createLiveStatsTracker({
  requestStartMs,
  promptTokens = 0,
  completionTokensBase = 0
}) {
  return {
    requestStartMs,
    firstTokenMs: null,
    lastTokenMs: null,
    renderedChars: 0,
    promptTokens,
    completionTokensBase
  };
}

export function updateLiveStats(tracker, { content = "", reasoning = "", nowMs, promptTokens }) {
  const deltaChars = String(content || "").length + String(reasoning || "").length;
  const renderedChars = tracker.renderedChars + deltaChars;
  const firstTokenMs = tracker.firstTokenMs ?? nowMs;
  const next = {
    ...tracker,
    firstTokenMs,
    lastTokenMs: nowMs,
    renderedChars,
    promptTokens: promptTokens ?? tracker.promptTokens
  };
  const completionTokens = next.completionTokensBase + Math.ceil(renderedChars / 4);
  return {
    tracker: next,
    stats: streamStatsFromTiming({
      requestStartMs: next.requestStartMs,
      firstTokenMs: next.firstTokenMs,
      lastTokenMs: next.lastTokenMs,
      promptTokens: next.promptTokens,
      completionTokens,
      stream: true
    })
  };
}

export function finalizeLiveStats(tracker, { promptTokens, completionTokens, stream = true } = {}) {
  const fallbackCompletionTokens = tracker.completionTokensBase + Math.ceil(tracker.renderedChars / 4);
  return streamStatsFromTiming({
    requestStartMs: tracker.requestStartMs,
    firstTokenMs: tracker.firstTokenMs,
    lastTokenMs: tracker.lastTokenMs,
    promptTokens: promptTokens ?? tracker.promptTokens,
    completionTokens: completionTokens ?? fallbackCompletionTokens,
    stream
  });
}
