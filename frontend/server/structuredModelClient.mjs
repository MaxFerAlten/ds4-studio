/**
 * DS4 shared structured-model transport — independently designed implementation.
 * Behavioral inputs: DS4 Research transport behavior and docs/evolution model-boundary requirements.
 * External source code or prompts copied: none.
 */

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ERROR_BODY_CHARS = 400;

export function extractStructuredJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  let candidate = text.trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseSseBlock(block) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart().replace(/\r$/, ""))
    .join("\n");
}

function timeoutSignal(timeoutMs, externalSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([externalSignal, timeout]);
  return externalSignal;
}

function mergeTokenUsage(first, second) {
  if (!first) return second ?? null;
  if (!second) return first;
  const merged = { ...first, ...second };
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
    const left = first[key];
    const right = second[key];
    if (Number.isSafeInteger(left) && Number.isSafeInteger(right)) merged[key] = left + right;
    else if (Number.isSafeInteger(left)) merged[key] = left;
    else if (Number.isSafeInteger(right)) merged[key] = right;
  }
  return merged;
}

export class StructuredModelClient {
  constructor({
    baseUrl,
    model = "deepseek-v4-flash",
    modelConfig = {},
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    errorPrefix = "model"
  } = {}) {
    if (!baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.modelConfig = { temperature: 0, top_p: 1, max_tokens: 8192, ...modelConfig };
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.errorPrefix = errorPrefix;
  }

  buildPayload({ systemPrompt, userPrompt, maxTokens, temperature, stream, think, reasoningEffort }) {
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });
    const payload = {
      model: this.model,
      messages,
      max_tokens: maxTokens ?? this.modelConfig.max_tokens,
      temperature: temperature ?? this.modelConfig.temperature,
      top_p: this.modelConfig.top_p,
      stream: Boolean(stream)
    };
    if (think !== undefined) payload.think = Boolean(think);
    if (payload.think && reasoningEffort) payload.reasoning_effort = reasoningEffort;
    return payload;
  }

  async completeRole({
    roleName,
    systemPrompt = "",
    userPrompt,
    json = false,
    maxTokens,
    temperature,
    think,
    reasoningEffort,
    signal,
    onDelta
  }) {
    const stream = typeof onDelta === "function";
    const payload = this.buildPayload({
      systemPrompt, userPrompt, maxTokens, temperature, stream, think, reasoningEffort
    });
    const first = await this.#complete(payload, { signal, onDelta });
    if (!json) return { ...first, attempts: 1 };
    let parsed = extractStructuredJson(first.content);
    if (parsed !== null) return { ...first, json: parsed, attempts: 1 };
    const retryPayload = this.buildPayload({
      systemPrompt,
      userPrompt: `${userPrompt}\n\nYour previous reply was not valid JSON. ` +
        "Reply with ONLY a valid JSON object: no prose, no code fences.",
      maxTokens,
      temperature,
      think,
      reasoningEffort,
      stream: false
    });
    const second = await this.#complete(retryPayload, { signal });
    parsed = extractStructuredJson(second.content);
    if (parsed === null) throw new Error(`role ${roleName}: model did not return valid JSON`);
    return { ...second, json: parsed, usage: mergeTokenUsage(first.usage, second.usage), attempts: 2 };
  }

  async tokenCount(messages, { signal } = {}) {
    const response = await this.#post("/v1/token-count", { model: this.model, messages }, signal);
    return response.json();
  }

  async health({ signal } = {}) {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/models`, {
        signal: signal ?? AbortSignal.timeout(2000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async #complete(payload, { signal, onDelta } = {}) {
    const response = await this.#post("/v1/chat/completions", payload, signal);
    if (!payload.stream) {
      const data = await response.json();
      const message = data.choices?.[0]?.message || {};
      return {
        content: message.content || "",
        reasoning: message.reasoning_content || message.reasoning || "",
        usage: data.usage || null
      };
    }
    let content = "";
    let reasoning = "";
    let usage = null;
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";
      for (const part of parts) {
        const raw = parseSseBlock(part);
        if (!raw || raw === "[DONE]") continue;
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }
        if (event.usage) usage = event.usage;
        const delta = event.choices?.[0]?.delta || {};
        if (delta.content) {
          content += delta.content;
          onDelta?.({ content: delta.content });
        }
        reasoning += delta.reasoning_content || delta.reasoning || "";
      }
    }
    return { content, reasoning, usage };
  }

  async #post(pathName, body, signal) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: timeoutSignal(this.timeoutMs, signal)
      });
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      const cause = error?.cause ? `: ${error.cause.code || error.cause.message || error.cause}` : "";
      throw new Error(`${this.errorPrefix} fetch ${pathName} failed${cause}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${this.errorPrefix} HTTP ${response.status} on ${pathName}: ${text.slice(0, MAX_ERROR_BODY_CHARS)}`);
    }
    return response;
  }
}
