// Google Gemini Deep Research over the Interactions API. Async/background +
// SSE streaming. All HTTP specifics of the beta API are isolated here.
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function parseSseBlock(block) {
  return block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
}

// Normalize one raw Interactions event into { type, ... }. Returns null for
// events we do not handle.
export function parseInteractionEvent(ev) {
  if (!ev || typeof ev.type !== "string") return null;
  switch (ev.type) {
    case "interaction.created":
      return { type: "created", interactionId: ev.interaction?.id || null };
    case "step.delta": {
      const d = ev.delta || {};
      if (d.type === "text") return { type: "delta", deltaType: "text", text: d.text || "" };
      if (d.type === "thought") return { type: "delta", deltaType: "thought", text: d.text || "" };
      if (d.type === "image") return { type: "delta", deltaType: "image", text: "" };
      return null;
    }
    case "interaction.plan":
      return { type: "plan", plan: ev.plan || ev.interaction?.plan || null };
    case "interaction.completed":
      return { type: "completed", outputText: ev.interaction?.output_text || "", citations: ev.interaction?.citations || [] };
    case "interaction.error":
      return { type: "error", error: ev.error?.message || "gemini interaction error" };
    default:
      return null;
  }
}

export class GeminiResearchClient {
  constructor({ apiKey = null, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, timeoutMs = 3600000 } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  #headers() {
    return { "Content-Type": "application/json", "x-goog-api-key": this.apiKey, Accept: "text/event-stream" };
  }

  // Async generator of normalized events for a new background interaction.
  async *createInteraction({ input, agent, tools = [], agentConfig = {}, previousInteractionId } = {}) {
    const body = {
      agent,
      input,
      background: true,
      stream: true,
      store: true,
      tools: tools.map((t) => ({ type: t })),
      agent_config: agentConfig
    };
    if (previousInteractionId) body.previous_interaction_id = previousInteractionId;
    const res = await this.fetchImpl(`${this.baseUrl}/interactions`, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`gemini interactions HTTP ${res.status}: ${txt.slice(0, 300)}`);
    }
    yield* this.#consume(res);
  }

  async *#consume(res) {
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";
      for (const part of parts) {
        const raw = parseSseBlock(part);
        if (!raw || raw === "[DONE]") continue;
        let ev;
        try { ev = JSON.parse(raw); } catch { continue; }
        const norm = parseInteractionEvent(ev);
        if (norm) yield norm;
      }
    }
  }

  // Poll a stored interaction (reconnect / non-stream fallback).
  async getInteraction(interactionId, { signal } = {}) {
    const res = await this.fetchImpl(`${this.baseUrl}/interactions/${interactionId}`, {
      headers: { "x-goog-api-key": this.apiKey, Accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`gemini get interaction HTTP ${res.status}`);
    const d = await res.json();
    return { status: d.status || "unknown", outputText: d.output_text || "", citations: d.citations || [], raw: d };
  }
}
