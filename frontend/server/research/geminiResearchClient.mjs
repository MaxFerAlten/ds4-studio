// Google Gemini Deep Research over the Interactions API (verified live 2026-06-15).
// The deep-research agents are POLL-based, not delta-streamed: create a background
// interaction, then GET it until status is terminal. The report is the concatenated
// text of the model_output steps; citations are url_citation annotations. All HTTP
// specifics of the beta API are isolated here.
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// Build the final report + deduped citations from a completed interaction payload.
export function parseCompletedInteraction(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  let outputText = "";
  const seen = new Set();
  const citations = [];
  for (const step of steps) {
    if (step?.type !== "model_output") continue;
    for (const part of Array.isArray(step.content) ? step.content : []) {
      if (typeof part?.text === "string") outputText += part.text;
      for (const a of Array.isArray(part?.annotations) ? part.annotations : []) {
        if (a?.type === "url_citation" && a.url && !seen.has(a.url)) {
          seen.add(a.url);
          citations.push({ url: a.url, title: a.title || a.url });
        }
      }
    }
  }
  return { status: data?.status || "unknown", outputText, citations, usage: data?.usage || null };
}

export class GeminiResearchClient {
  constructor({ apiKey = null, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, timeoutMs = 60000 } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  // Start a background deep-research interaction. Returns the interaction id.
  async createInteraction({ input, agent, tools = [], signal } = {}) {
    const body = {
      agent,
      input: [{ type: "text", text: String(input ?? "") }],
      background: true,
      store: true,
      tools: tools.map((t) => ({ type: t }))
    };
    const res = await this.fetchImpl(`${this.baseUrl}/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(this.timeoutMs)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`gemini interactions HTTP ${res.status}: ${txt.slice(0, 300)}`);
    }
    const data = await res.json();
    const id = data?.id || data?.interaction?.id || null;
    if (!id) throw new Error("gemini interactions: no interaction id in response");
    return id;
  }

  // Poll one interaction; returns { status, outputText, citations, usage }.
  async getInteraction(interactionId, { signal } = {}) {
    const res = await this.fetchImpl(`${this.baseUrl}/interactions/${interactionId}`, {
      headers: { "x-goog-api-key": this.apiKey, Accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(this.timeoutMs)
    });
    if (!res.ok) throw new Error(`gemini get interaction HTTP ${res.status}`);
    return parseCompletedInteraction(await res.json());
  }
}
