export function estimateTokenCount(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  return Math.ceil(value.length / 4);
}

/** Usage with a ds4-shaped `timing`, mapping the llama.cpp shape when needed.
 *
 * ds4 reports per-request timing as `usage.timing` in seconds. llama.cpp-derived
 * servers (Halogen among them) report a sibling `timings` object in
 * milliseconds. The panel read only the first, so against an endpoint
 * "gen server" showed n/a while the server's own log printed the rate:
 *
 *   serve_api: mtp 225 tok in 6.25s = 35.98 t/s | prompt 82, prefill 0.84s
 *
 * Prefill still had a browser-side fallback (time to first token), which is why
 * only the generation figure went missing -- and why "effettivo" and "con cache"
 * showed the same number, there being no cached-token detail either.
 *
 * The agent stream needs the same mapping before the browser sees it, so the
 * implementation is shared with the Node server.
 */
export { normalizeUsageTiming } from "../shared/usageTiming.mjs";

export function streamStatsFromTiming({
  requestStartMs,
  firstTokenMs,
  promptTokens,
  promptTokensDetails,
  completionTokens,
  prefillSeconds,
  generationSeconds,
  generationTokens,
  generationSource,
  stream = true
}) {
  const browserPrefillS = firstTokenMs != null ? (firstTokenMs - requestStartMs) / 1000 : 0;
  const reportedPrefillS = Number(prefillSeconds);
  const reportedGenS = Number(generationSeconds);
  const prefillS = Number.isFinite(reportedPrefillS) && reportedPrefillS > 0
    ? reportedPrefillS
    : browserPrefillS;
  const genS = Number.isFinite(reportedGenS) && reportedGenS > 0 ? reportedGenS : 0;
  const totalPromptTokens = Math.max(0, Number(promptTokens) || 0);
  const totalCompletionTokens = Math.max(0, Number(completionTokens) || 0);
  const reportedGenerationTokens = Number(generationTokens);
  const nativeGenerationTokens = Number.isFinite(reportedGenerationTokens) && reportedGenerationTokens > 0
    ? reportedGenerationTokens
    : totalCompletionTokens;
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
    completionTokens: totalCompletionTokens,
    prefillTps: prefillS > 0 && totalPromptTokens > 0 ? prefillTokens / prefillS : null,
    prefillWithCacheTps: prefillS > 0 && totalPromptTokens > 0 ? totalPromptTokens / prefillS : null,
    genTps: genS > 0 && nativeGenerationTokens > 0 ? nativeGenerationTokens / genS : null,
    genSource: typeof generationSource === "string" && generationSource ? generationSource : null,
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
    renderedChars,
    promptTokens: promptTokens ?? tracker.promptTokens
  };
  const completionTokens = next.completionTokensBase + Math.ceil(renderedChars / 4);
  return {
    tracker: next,
    stats: streamStatsFromTiming({
      requestStartMs: next.requestStartMs,
      firstTokenMs: next.firstTokenMs,
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
    generationTokens,
    generationSource,
    stream = true
  } = {}
) {
  const fallbackCompletionTokens = tracker.completionTokensBase + Math.ceil(tracker.renderedChars / 4);
  return streamStatsFromTiming({
    requestStartMs: tracker.requestStartMs,
    firstTokenMs: tracker.firstTokenMs,
    promptTokens: promptTokens ?? tracker.promptTokens,
    promptTokensDetails,
    completionTokens: completionTokens ?? fallbackCompletionTokens,
    prefillSeconds,
    generationSeconds,
    generationTokens,
    generationSource,
    stream
  });
}
