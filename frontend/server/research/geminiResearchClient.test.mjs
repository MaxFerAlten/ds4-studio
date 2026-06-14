import test from "node:test";
import assert from "node:assert/strict";
import { GeminiResearchClient, parseInteractionEvent } from "./geminiResearchClient.mjs";

function sse(chunks) {
  const stream = new ReadableStream({
    start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); }
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

test("parseInteractionEvent normalizes created/delta/completed/error", () => {
  assert.deepEqual(parseInteractionEvent({ type: "interaction.created", interaction: { id: "ix_1" } }),
    { type: "created", interactionId: "ix_1" });
  assert.deepEqual(parseInteractionEvent({ type: "step.delta", delta: { type: "text", text: "Hi" } }),
    { type: "delta", deltaType: "text", text: "Hi" });
  assert.deepEqual(parseInteractionEvent({ type: "step.delta", delta: { type: "thought", text: "thinking" } }),
    { type: "delta", deltaType: "thought", text: "thinking" });
  assert.equal(parseInteractionEvent({ type: "interaction.completed", interaction: { output_text: "R", citations: [] } }).type, "completed");
  assert.equal(parseInteractionEvent({ type: "interaction.error", error: { message: "boom" } }).type, "error");
  assert.equal(parseInteractionEvent({ type: "unknown.thing" }), null);
});

test("createInteraction posts the documented request shape", async () => {
  let captured = null;
  const client = new GeminiResearchClient({
    apiKey: "KEY",
    fetchImpl: async (url, opt) => { captured = { url, opt }; return sse(['data: {"type":"interaction.created","interaction":{"id":"ix_9"}}\n\n']); }
  });
  const events = [];
  for await (const ev of client.createInteraction({ input: "q", agent: "deep-research-preview-04-2026", tools: ["google_search"], agentConfig: { collaborative_planning: true } })) {
    events.push(ev);
  }
  assert.match(captured.url, /\/v1beta\/interactions/);
  assert.equal(captured.opt.headers["x-goog-api-key"], "KEY");
  const body = JSON.parse(captured.opt.body);
  assert.equal(body.agent, "deep-research-preview-04-2026");
  assert.equal(body.input, "q");
  assert.equal(body.background, true);
  assert.equal(body.stream, true);
  assert.equal(body.store, true);
  assert.deepEqual(body.tools, [{ type: "google_search" }]);
  assert.equal(body.agent_config.collaborative_planning, true);
  assert.deepEqual(events[0], { type: "created", interactionId: "ix_9" });
});

test("getInteraction polls status and returns normalized output", async () => {
  const client = new GeminiResearchClient({
    apiKey: "KEY",
    fetchImpl: async () => new Response(JSON.stringify({ id: "ix_1", status: "completed", output_text: "Report", citations: [{ title: "T", url: "https://x" }] }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  const out = await client.getInteraction("ix_1");
  assert.equal(out.status, "completed");
  assert.equal(out.outputText, "Report");
  assert.equal(out.citations[0].url, "https://x");
});

test("isConfigured reflects api key presence", () => {
  assert.equal(new GeminiResearchClient({ apiKey: null }).isConfigured(), false);
  assert.equal(new GeminiResearchClient({ apiKey: "k" }).isConfigured(), true);
});
