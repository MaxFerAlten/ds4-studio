// Regression: images attached in Agent Mode used to be dropped by the
// composer, so the model ran a long text-only prefill and never saw them.
//   - unit: normalizeTurnImages / withTurnImages;
//   - server (engine "js" + wrapper, the live DS4 Studio setup): the turn's
//     user message reaches /v1/chat/completions with image_url parts, the next
//     turn's request carries that message as plain text again (the session
//     never stores the data URI), and bad images are refused before the model.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";
import { AGENT_TURN_MAX_IMAGES, normalizeTurnImages, withTurnImages } from "./agent/agentTurnImages.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SESSION = "js-engine-images";
const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": SESSION };

test("normalizeTurnImages accepts PNG/JPEG data URIs only", () => {
  assert.deepEqual(normalizeTurnImages(undefined), { images: [] });
  assert.deepEqual(normalizeTurnImages([PNG]), { images: [PNG] });
  assert.ok(normalizeTurnImages(["data:image/jpeg;base64,/9j/4AAQ"]).images);
  assert.ok(normalizeTurnImages(["data:image/webp;base64,UklGRg=="]).error);
  assert.ok(normalizeTurnImages(["https://example.com/a.png"]).error);
  assert.ok(normalizeTurnImages(PNG).error);
  assert.ok(normalizeTurnImages(Array(AGENT_TURN_MAX_IMAGES + 1).fill(PNG)).error);
});

test("withTurnImages decorates a copy of the turn's user message", () => {
  const payload = {
    model: "m",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "[DS4 Studio] date" },
      { role: "user", content: "describe" }
    ]
  };
  const out = withTurnImages(payload, "describe", [PNG]);
  assert.deepEqual(out.messages[2].content, [
    { type: "text", text: "describe" },
    { type: "image_url", image_url: { url: PNG } }
  ]);
  assert.equal(out.messages[1].content, "[DS4 Studio] date");
  assert.equal(payload.messages[2].content, "describe", "input payload must stay untouched");
  assert.equal(withTurnImages(payload, "describe", []), payload);
  assert.equal(withTurnImages(payload, "not in payload", [PNG]), payload);
});

async function agentChat(base, body) {
  const res = await fetch(`${base}/api/agent/chat`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

const userMessages = (entry) => entry.body.messages.filter((m) => m.role === "user");

test("js engine + wrapper: agent turn images reach the model and stay out of the session", async () => {
  const backend = await startFakeBackend({
    enforceMode: true,
    turns: [{ content: "a red square", finish: "stop" }, { content: "yes", finish: "stop" }]
  });
  const server = await startServerChild(backend, { wrapper: true });
  try {
    const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    assert.equal(start.status, 200, await start.text());

    const first = await agentChat(server.base, { message: "describe the image", images: [PNG] });
    assert.equal(first.status, 200, first.text);
    assert.doesNotMatch(first.text, /agent_error/, first.text);

    const second = await agentChat(server.base, { message: "is it red?" });
    assert.equal(second.status, 200, second.text);

    const calls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
    assert.ok(calls.length >= 2, `expected two model calls, got ${calls.length}`);

    const turnOne = userMessages(calls[0]).at(-1);
    assert.deepEqual(turnOne.content, [
      { type: "text", text: "describe the image" },
      { type: "image_url", image_url: { url: PNG } }
    ]);

    const turnTwo = userMessages(calls.at(-1));
    const replayed = turnTwo.find((m) => m.content === "describe the image");
    assert.ok(replayed, "turn one must be replayed as plain text");
    assert.doesNotMatch(JSON.stringify(calls.at(-1).body), /image_url/, "the session must not keep the image");

    const bad = await agentChat(server.base, { message: "describe", images: ["data:image/webp;base64,UklGRg=="] });
    assert.equal(bad.status, 400, bad.text);
    assert.match(bad.text, /PNG or JPEG/);
    assert.equal(backend.log.filter((entry) => entry.path === "POST /v1/chat/completions").length, calls.length,
      "a refused image must not reach the model");
  } finally {
    server.stop();
    await backend.close();
  }
});
