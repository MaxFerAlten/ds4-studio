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
  promptTokensDetails,
  completionTokens,
  prefillSeconds,
  generationSeconds,
  stream = true
}) {
  const browserPrefillS = firstTokenMs != null ? (firstTokenMs - requestStartMs) / 1000 : 0;
  const browserGenS = firstTokenMs != null && lastTokenMs != null && lastTokenMs > firstTokenMs
    ? (lastTokenMs - firstTokenMs) / 1000
    : 0;
  const reportedPrefillS = Number(prefillSeconds);
  const reportedGenS = Number(generationSeconds);
  const prefillS = Number.isFinite(reportedPrefillS) && reportedPrefillS > 0
    ? reportedPrefillS
    : browserPrefillS;
  const genS = Number.isFinite(reportedGenS) && reportedGenS > 0
    ? reportedGenS
    : browserGenS;
  const totalPromptTokens = Math.max(0, Number(promptTokens) || 0);
  const hasPromptDetails = promptTokensDetails && typeof promptTokensDetails === "object";
  const cachedTokens = hasPromptDetails
    ? Math.min(totalPromptTokens, Math.max(0, Number(promptTokensDetails.cached_tokens) || 0))
    : 0;
  const uncachedLimit = Math.max(0, totalPromptTokens - cachedTokens);
  const reportedPrefillTokens = Number(promptTokensDetails?.cache_write_tokens);
  const prefillTokens = hasPromptDetails && Number.isFinite(reportedPrefillTokens)
    ? Math.min(uncachedLimit, Math.max(0, reportedPrefillTokens))
    : uncachedLimit;
  return {
    promptTokens: totalPromptTokens,
    cachedTokens,
    prefillTokens,
    completionTokens,
    prefillTps: prefillS > 0 && totalPromptTokens > 0 ? prefillTokens / prefillS : null,
    prefillWithCacheTps: prefillS > 0 && totalPromptTokens > 0 ? totalPromptTokens / prefillS : null,
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

export function finalizeLiveStats(
  tracker,
  {
    promptTokens,
    promptTokensDetails,
    completionTokens,
    prefillSeconds,
    generationSeconds,
    stream = true
  } = {}
) {
  const fallbackCompletionTokens = tracker.completionTokensBase + Math.ceil(tracker.renderedChars / 4);
  return streamStatsFromTiming({
    requestStartMs: tracker.requestStartMs,
    firstTokenMs: tracker.firstTokenMs,
    lastTokenMs: tracker.lastTokenMs,
    promptTokens: promptTokens ?? tracker.promptTokens,
    promptTokensDetails,
    completionTokens: completionTokens ?? fallbackCompletionTokens,
    prefillSeconds,
    generationSeconds,
    stream
  });
}
