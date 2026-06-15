import test from "node:test";
import assert from "node:assert/strict";
import { GeminiResearchClient, parseCompletedInteraction } from "./geminiResearchClient.mjs";

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

// Mirrors the real completed-interaction shape captured live.
const COMPLETED = {
  id: "v1_abc",
  status: "completed",
  usage: { total_tokens: 100 },
  steps: [
    { type: "user_input", content: [{ type: "text", text: "q" }] },
    {
      type: "model_output",
      content: [
        {
          type: "text",
          text: "# Report\nPart one.",
          annotations: [
            { type: "url_citation", url: "https://a", start_index: 0, end_index: 4 },
            { type: "url_citation", url: "https://a", start_index: 5, end_index: 9 } // dup
          ]
        }
      ]
    },
    {
      type: "model_output",
      content: [
        { type: "image/png", mime_type: "image/png", data: "iVBOR" }, // skipped
        { type: "text", text: " Part two.", annotations: [{ type: "url_citation", url: "https://b" }] }
      ]
    }
  ]
};

test("parseCompletedInteraction concatenates model_output text and dedupes url citations", () => {
  const out = parseCompletedInteraction(COMPLETED);
  assert.equal(out.status, "completed");
  assert.equal(out.outputText, "# Report\nPart one. Part two.");
  assert.deepEqual(out.citations.map((c) => c.url), ["https://a", "https://b"]);
  assert.equal(out.usage.total_tokens, 100);
});

test("parseCompletedInteraction tolerates missing steps", () => {
  const out = parseCompletedInteraction({ status: "in_progress" });
  assert.equal(out.status, "in_progress");
  assert.equal(out.outputText, "");
  assert.deepEqual(out.citations, []);
});

test("createInteraction posts the verified request shape and returns the id", async () => {
  let captured = null;
  const client = new GeminiResearchClient({
    apiKey: "KEY",
    fetchImpl: async (url, opt) => {
      captured = { url, opt };
      return jsonRes({ id: "v1_9", status: "in_progress", object: "interaction" });
    }
  });
  const id = await client.createInteraction({ input: "q", agent: "deep-research-preview-04-2026", tools: ["google_search"] });
  assert.equal(id, "v1_9");
  assert.match(captured.url, /\/v1beta\/interactions$/);
  assert.equal(captured.opt.headers["x-goog-api-key"], "KEY");
  const body = JSON.parse(captured.opt.body);
  assert.equal(body.agent, "deep-research-preview-04-2026");
  assert.deepEqual(body.input, [{ type: "text", text: "q" }]);
  assert.equal(body.background, true);
  assert.equal(body.store, true);
  assert.deepEqual(body.tools, [{ type: "google_search" }]);
});

test("getInteraction polls and returns parsed output", async () => {
  const client = new GeminiResearchClient({ apiKey: "KEY", fetchImpl: async () => jsonRes(COMPLETED) });
  const out = await client.getInteraction("v1_abc");
  assert.equal(out.status, "completed");
  assert.match(out.outputText, /# Report/);
  assert.equal(out.citations.length, 2);
});

test("createInteraction throws on a missing id and on HTTP error", async () => {
  const noId = new GeminiResearchClient({ apiKey: "K", fetchImpl: async () => jsonRes({ status: "x" }) });
  await assert.rejects(() => noId.createInteraction({ input: "q", agent: "a" }), /no interaction id/);
  const bad = new GeminiResearchClient({ apiKey: "K", fetchImpl: async () => jsonRes({ error: "x" }, 400) });
  await assert.rejects(() => bad.createInteraction({ input: "q", agent: "a" }), /HTTP 400/);
});

test("isConfigured reflects api key presence", () => {
  assert.equal(new GeminiResearchClient({ apiKey: null }).isConfigured(), false);
  assert.equal(new GeminiResearchClient({ apiKey: "k" }).isConfigured(), true);
});
