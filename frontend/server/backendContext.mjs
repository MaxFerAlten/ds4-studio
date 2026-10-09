// WP6 of convergenza.loop.md: token counts and context window that do not
// depend on which backend answers.
//
// The cascade is the one the plan prescribes (§9), and every field name was
// verified against the live servers, not guessed:
//   - DS4 wrapper  POST {base}/v1/token-count -> { prompt_tokens, ... }
//     (the same response requestPayload.mjs consumes for auto max_tokens)
//   - llama-server POST {base}/tokenize { content } -> { tokens: [ids] }
//     (verified 2026-10-03 against Vitronia: {"tokens":[66,21817,67348]})
//   - llama-server GET  {base}/props -> default_generation_settings.n_ctx
//     (verified 2026-10-03 against Vitronia: 262144, top level of
//      default_generation_settings, *not* nested under .params)
//   - anything else: Math.ceil(characters / 3.5), flagged estimated: true.
//
// Which method works is remembered per base URL, so a 404 is never retried
// on every call (plan §9).  Network errors never poison the cache: they
// estimate once and the next call probes again.

/** @type {Map<string, "token-count" | "tokenize" | "estimate">} */
const methods = new Map();
// Bases whose llama-server has no /apply-template (404, remembered).
const noApplyTemplate = new Set();

// Flatten an OpenAI-style payload into the plain text the /tokenize endpoint
// and the character estimate both count.  content may be a string or an
// array of parts; non-string payloads are counted as their JSON.
export function renderMessagesForCount(payload) {
  const messages = payload && Array.isArray(payload.messages) ? payload.messages : null;
  if (!messages) return JSON.stringify(payload ?? "");
  const lines = [];
  for (const message of messages) {
    const content = typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join("")
        : message?.content == null ? "" : JSON.stringify(message.content);
    // Tool-call arguments are prompt tokens too (file writes, long queries);
    // leaving them out let the count stay far under the real prompt.
    const calls = Array.isArray(message?.tool_calls) && message.tool_calls.length
      ? `\n${JSON.stringify(message.tool_calls.map((call) => call?.function ?? call))}`
      : "";
    // The Qwen template renders <think> for every assistant turn, so the
    // reasoning sent back is prompt like the content.
    const reasoning = message?.reasoning_content || message?.reasoning || "";
    lines.push(`${message?.role ?? "user"}\n${reasoning ? `${reasoning}\n` : ""}${content}${calls}`);
  }
  // Declared tool schemas are rendered into the prompt by the chat template.
  if (Array.isArray(payload.tools) && payload.tools.length) lines.push(JSON.stringify(payload.tools));
  return lines.join("\n");
}

function estimateTokens(payload) {
  const text = renderMessagesForCount(payload);
  return { tokens: Math.ceil(text.length / 3.5), estimated: true, method: "estimate" };
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// POST {base}/v1/token-count with the chat payload (the DS4 wrapper).
// Returns { tokens, estimated, method } or null when unusable.
async function tryTokenCount(payload, fetchImpl, base, signal) {
  const response = await fetchImpl(`${base}/v1/token-count`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  if (response.status === 404) {
    try { await response.body?.cancel(); } catch {}
    return { unavailable: true };
  }
  if (!response.ok) {
    try { await response.body?.cancel(); } catch {}
    throw new Error(`token-count HTTP ${response.status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("token-count returned a non-JSON body");
  }
  const tokens = positiveInt(body?.prompt_tokens);
  if (tokens === null) throw new Error("token-count answer has no prompt_tokens");
  return { tokens, estimated: false, method: "token-count" };
}

// POST {base}/apply-template { messages, tools } (llama-server) -> { prompt }:
// the exact text the chat template builds (thinking blocks, tool schemas,
// role markers).  Verified 2026-10-04 against Vitronia.  null when the
// endpoint is missing or refuses this payload; the caller then falls back to
// the plain rendering.
async function tryApplyTemplate(payload, fetchImpl, base, signal) {
  if (noApplyTemplate.has(base) || !Array.isArray(payload?.messages)) return null;
  const body = { messages: payload.messages };
  if (Array.isArray(payload.tools) && payload.tools.length) body.tools = payload.tools;
  const response = await fetchImpl(`${base}/apply-template`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    if (response.status === 404) noApplyTemplate.add(base);
    try { await response.body?.cancel(); } catch {}
    return null;
  }
  const answer = await response.json().catch(() => null);
  return typeof answer?.prompt === "string" ? answer.prompt : null;
}

// POST {base}/tokenize { content } (llama-server).
async function tryTokenize(payload, fetchImpl, base, signal) {
  const templated = await tryApplyTemplate(payload, fetchImpl, base, signal);
  const response = await fetchImpl(`${base}/tokenize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: templated ?? renderMessagesForCount(payload) }),
    signal
  });
  if (response.status === 404) {
    try { await response.body?.cancel(); } catch {}
    return { unavailable: true };
  }
  if (!response.ok) {
    try { await response.body?.cancel(); } catch {}
    throw new Error(`tokenize HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!Array.isArray(body?.tokens)) throw new Error("tokenize answer has no tokens array");
  return { tokens: body.tokens.length, estimated: false, method: "tokenize" };
}

// countPromptTokens(payload, { fetchImpl, base, signal }) ->
//   { tokens, estimated, method }
//
// 1. POST /v1/token-count with the chat payload (DS4 wrapper).
// 2. On 404, POST /tokenize with the messages rendered as text (llama-server).
// 3. Otherwise the character estimate, flagged estimated: true.
// The working method is remembered per base URL; a 404 is never retried.
export async function countPromptTokens(payload, { fetchImpl = fetch, base, signal } = {}) {
  if (!base) throw new Error("countPromptTokens requires a base URL");
  let method = methods.get(base) || "token-count";

  try {
    if (method === "token-count") {
      const result = await tryTokenCount(payload, fetchImpl, base, signal);
      if (result.tokens !== undefined) {
        methods.set(base, "token-count");
        return result;
      }
      methods.set(base, "tokenize"); // the 404 is remembered, never retried
      method = "tokenize";
    }
    if (method === "tokenize") {
      const result = await tryTokenize(payload, fetchImpl, base, signal);
      if (result.tokens !== undefined) {
        methods.set(base, "tokenize");
        return result;
      }
      methods.set(base, "estimate");
      return estimateTokens(payload);
    }
  } catch {
    // Network/parse/other-HTTP failure: estimate for this call only, cache
    // untouched, so a backend that comes back is used again.
  }
  return estimateTokens(payload); // method === "estimate" (or a failure above)
}

// contextWindow({ fetchImpl, base, config, localWrapper }) ->
//   { tokens, estimated, source }
//
// 1. localWrapper + config.server.ctx (the local DS4 server's own size).
// 2. GET {base}/props -> default_generation_settings.n_ctx (llama-server).
// 3. config.requestDefaults.context_window (not in the config yet; kept as
//    the plan names it) or 32768, flagged estimated: true.
//
// Deviation from the plan's signature: `localWrapper` is explicit because
// nothing in { base, config } distinguishes the local wrapper from an
// endpoint — config.server.ctx survives endpoint mode with its defaults, and
// trusting it for a remote llama-server would be wrong.  index.mjs passes
// wrapperEnabled() when WP7/WP8 wire this in.
export async function contextWindow({ fetchImpl = fetch, base, config = {}, localWrapper = false, signal } = {}) {
  if (localWrapper) {
    const ctx = positiveInt(config?.server?.ctx);
    if (ctx !== null) return { tokens: ctx, estimated: false, source: "config.server.ctx" };
  }
  if (base) {
    try {
      const response = await fetchImpl(`${base}/props`, { method: "GET", signal });
      if (response.ok) {
        const body = await response.json();
        const nCtx = positiveInt(body?.default_generation_settings?.n_ctx);
        if (nCtx !== null) return { tokens: nCtx, estimated: false, source: "props" };
      } else {
        try { await response.body?.cancel(); } catch {}
      }
    } catch {
      // No props endpoint: fall through to the estimate.
    }
  }
  const configured = positiveInt(config?.requestDefaults?.context_window);
  if (configured !== null) {
    return { tokens: configured, estimated: true, source: "config.requestDefaults.context_window" };
  }
  return { tokens: 32768, estimated: true, source: "fallback" };
}

// backendSingleSlot({ fetchImpl, base, localWrapper }) -> boolean
//
// Whether the backend serves one request at a time.  ds4-wrapper always does;
// llama-server says so in /props (total_slots, its -np).  With one slot a side
// call (the epistemic shadow segmenter) evicts the agent's cached prompt and
// holds the backend; unknown is reported as false so other servers keep it.
export async function backendSingleSlot({ fetchImpl = fetch, base, localWrapper = false, signal } = {}) {
  if (localWrapper) return true;
  if (!base) return false;
  try {
    const response = await fetchImpl(`${base}/props`, { method: "GET", signal });
    if (!response.ok) {
      try { await response.body?.cancel(); } catch {}
      return false;
    }
    const body = await response.json();
    return positiveInt(body?.total_slots) === 1;
  } catch {
    return false;
  }
}
