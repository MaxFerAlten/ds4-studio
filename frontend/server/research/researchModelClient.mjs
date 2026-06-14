const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export function extractJson(text) {
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

export class ResearchModelClient {
  constructor({
    baseUrl,
    model = "deepseek-v4-flash",
    modelConfig = {},
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS
  }) {
    if (!baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.modelConfig = { temperature: 0, top_p: 1, max_tokens: 8192, ...modelConfig };
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  buildPayload({ systemPrompt, userPrompt, maxTokens, temperature, stream }) {
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });
    return {
      model: this.model,
      messages,
      max_tokens: maxTokens ?? this.modelConfig.max_tokens,
      temperature: temperature ?? this.modelConfig.temperature,
      top_p: this.modelConfig.top_p,
      stream: Boolean(stream)
    };
  }

  async completeRole({
    roleName,
    systemPrompt = "",
    userPrompt,
    json = false,
    maxTokens,
    temperature,
    signal,
    onDelta
  }) {
    const stream = typeof onDelta === "function";
    const payload = this.buildPayload({ systemPrompt, userPrompt, maxTokens, temperature, stream });
    const first = await this.#complete(payload, { signal, onDelta });
    if (!json) return first;
    let parsed = extractJson(first.content);
    if (parsed !== null) return { ...first, json: parsed };
    const retryPayload = this.buildPayload({
      systemPrompt,
      userPrompt:
        `${userPrompt}\n\nYour previous reply was not valid JSON. ` +
        "Reply with ONLY a valid JSON object: no prose, no code fences.",
      maxTokens,
      temperature,
      stream: false
    });
    const second = await this.#complete(retryPayload, { signal });
    parsed = extractJson(second.content);
    if (parsed === null) {
      throw new Error(`role ${roleName}: model did not return valid JSON`);
    }
    return { ...second, json: parsed };
  }

  async tokenCount(messages, { signal } = {}) {
    const res = await this.#post("/v1/token-count", { model: this.model, messages }, signal);
    return res.json();
  }

  async health({ signal } = {}) {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/models`, {
        signal: signal ?? AbortSignal.timeout(2000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async #complete(payload, { signal, onDelta } = {}) {
    const res = await this.#post("/v1/chat/completions", payload, signal);
    if (!payload.stream) {
      const data = await res.json();
      const msg = data.choices?.[0]?.message || {};
      return {
        content: msg.content || "",
        reasoning: msg.reasoning_content || msg.reasoning || "",
        usage: data.usage || null
      };
    }
    let content = "";
    let reasoning = "";
    let usage = null;
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
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
          if (onDelta) onDelta({ content: delta.content });
        }
        const r = delta.reasoning_content || delta.reasoning || "";
        if (r) reasoning += r;
      }
    }
    return { content, reasoning, usage };
  }

  async #post(pathName, body, signal) {
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      const cause = err?.cause ? `: ${err.cause.code || err.cause.message || err.cause}` : "";
      throw new Error(`research model fetch ${pathName} failed${cause}`);
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`research model HTTP ${res.status} on ${pathName}: ${txt.slice(0, 400)}`);
    }
    return res;
  }
}
