import { REQUEST_DEFAULTS } from "./defaultConfig.mjs";

export const AUTO_MAX_TOKENS = "auto";

function isBlank(value) {
  return value === undefined || value === null || value === "";
}

export function isAutoMaxTokens(value) {
  return typeof value === "string" && value.trim().toLowerCase() === AUTO_MAX_TOKENS;
}

export function parsePositiveInt(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function parseNonNegativeInt(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function autoMaxTokenSettings(request = {}) {
  return {
    safetyCap: parsePositiveInt(
      isBlank(request.max_tokens_safety_cap) ? REQUEST_DEFAULTS.max_tokens_safety_cap : request.max_tokens_safety_cap,
      REQUEST_DEFAULTS.max_tokens_safety_cap
    ),
    contextMargin: parseNonNegativeInt(
      isBlank(request.context_margin) ? REQUEST_DEFAULTS.context_margin : request.context_margin,
      REQUEST_DEFAULTS.context_margin
    )
  };
}

function applyMaxTokens(payload, request = {}) {
  const raw = isBlank(request.max_tokens) ? REQUEST_DEFAULTS.max_tokens : request.max_tokens;
  if (isAutoMaxTokens(raw)) {
    const { safetyCap, contextMargin } = autoMaxTokenSettings(request);
    payload.max_tokens = AUTO_MAX_TOKENS;
    payload.max_tokens_safety_cap = safetyCap;
    payload.context_margin = contextMargin;
    return;
  }

  const parsed = parsePositiveInt(raw, null);
  if (parsed !== null) {
    payload.max_tokens = parsed;
    return;
  }

  if (isAutoMaxTokens(REQUEST_DEFAULTS.max_tokens)) {
    const { safetyCap, contextMargin } = autoMaxTokenSettings(request);
    payload.max_tokens = AUTO_MAX_TOKENS;
    payload.max_tokens_safety_cap = safetyCap;
    payload.context_margin = contextMargin;
    return;
  }

  payload.max_tokens = parsePositiveInt(REQUEST_DEFAULTS.max_tokens, 4096);
}

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
    temperature: Number(request.temperature ?? REQUEST_DEFAULTS.temperature),
    top_p: Number(request.top_p ?? REQUEST_DEFAULTS.top_p),
    top_k: Number(request.top_k ?? REQUEST_DEFAULTS.top_k),
    min_p: Number(request.min_p ?? REQUEST_DEFAULTS.min_p),
    stream,
    think: thinking
  };
  applyMaxTokens(payload, request);

  if (thinking && request.reasoning_effort) payload.reasoning_effort = request.reasoning_effort;
  if (stream) payload.stream_options = { include_usage: true };
  if (request.seed !== undefined && request.seed !== "" && request.seed !== null) payload.seed = Number(request.seed);
  if (typeof request.stop === "string" && request.stop.trim()) {
    payload.stop = request.stop.split("\n").filter(Boolean);
  }

  return payload;
}
