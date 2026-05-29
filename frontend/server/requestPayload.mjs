import { REQUEST_DEFAULTS } from "./defaultConfig.mjs";

export function requestThinkingEnabled(request = {}) {
  if (request.thinking !== undefined) return Boolean(request.thinking);
  if (request.think !== undefined) return Boolean(request.think);
  return Boolean(REQUEST_DEFAULTS.thinking);
}

export function buildChatPayload(request = {}, messages = []) {
  const stream = Boolean(request.stream);
  const thinking = requestThinkingEnabled(request);
  const payload = {
    model: request.model || REQUEST_DEFAULTS.model,
    messages,
    max_tokens: Number(request.max_tokens) || REQUEST_DEFAULTS.max_tokens,
    temperature: Number(request.temperature ?? REQUEST_DEFAULTS.temperature),
    top_p: Number(request.top_p ?? REQUEST_DEFAULTS.top_p),
    top_k: Number(request.top_k ?? REQUEST_DEFAULTS.top_k),
    min_p: Number(request.min_p ?? REQUEST_DEFAULTS.min_p),
    stream,
    think: thinking
  };

  if (thinking && request.reasoning_effort) payload.reasoning_effort = request.reasoning_effort;
  if (stream) payload.stream_options = { include_usage: true };
  if (request.seed !== undefined && request.seed !== "" && request.seed !== null) payload.seed = Number(request.seed);
  if (typeof request.stop === "string" && request.stop.trim()) {
    payload.stop = request.stop.split("\n").filter(Boolean);
  }

  return payload;
}
