// Shared by the browser bundle (src/throughputStats.mjs) and the Node server
// (server/index.mjs). Both sides read the same backend responses, so the
// llama.cpp -> ds4 timing mapping has to live in one place: the agent stream is
// normalized server-side, the chat stream client-side.

// ds4-server reports per-request `usage.timing`; llama.cpp-shaped backends
// (Halogen Flash) report a sibling `timings` block instead and leave usage
// without timing. Without this mapping the caller falls back to browser-side
// wall clock, which cannot see generation time at all -- gen t/s reads n/a.
export function normalizeUsageTiming(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") return null;
  if (usage.timing) return usage;

  const t = payload.timings;
  if (!t || typeof t !== "object") return usage;

  const seconds = (ms) => {
    const value = Number(ms);
    return Number.isFinite(value) && value > 0 ? value / 1000 : undefined;
  };
  const timing = {};
  const prefill = seconds(t.prompt_ms);
  const decode = seconds(t.predicted_ms);
  if (prefill !== undefined) timing.prefill_sec = prefill;
  if (decode !== undefined) timing.decode_sec = decode;
  if (Number(t.predicted_n) > 0) timing.decode_tokens = Number(t.predicted_n);
  if (!Object.keys(timing).length) return usage;

  const out = { ...usage, timing };
  // cache_n is the prompt prefix served from cache, which is what splits
  // "prefill effettivo" from "prefill con cache".
  if (Number(t.cache_n) > 0 && !out.prompt_tokens_details) {
    out.prompt_tokens_details = { cached_tokens: Number(t.cache_n) };
  }
  return out;
}
