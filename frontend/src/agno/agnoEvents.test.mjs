import assert from "node:assert/strict";
import test from "node:test";
import { openAgnoRunEvents, parseAgnoEventData } from "./agnoEvents.mjs";

// Minimal EventSource stand-in that mirrors the spec's "event: <type>\ndata: <json>\n\n"
// framing, including buffering raw text delivered across multiple, arbitrarily split chunks.
class MockEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this._buffer = "";
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  close() {
    this.closed = true;
  }

  // Test helper: feed a raw chunk of SSE text, however the network happened to split it.
  feed(chunk) {
    this._buffer += chunk;
    let boundary;
    while ((boundary = this._buffer.indexOf("\n\n")) !== -1) {
      const block = this._buffer.slice(0, boundary);
      this._buffer = this._buffer.slice(boundary + 2);
      const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      if (!eventLine || !dataLine) continue;
      const type = eventLine.slice("event: ".length);
      const data = dataLine.slice("data: ".length);
      for (const handler of this.listeners.get(type) || []) handler({ data });
    }
  }
}

test("openAgnoRunEvents includes lastSeq in the stream URL", () => {
  const stream = openAgnoRunEvents("run-1", () => {}, { lastSeq: 7, EventSourceImpl: MockEventSource });
  assert.ok(stream.url.includes("/api/agno/runs/run-1/events"));
  assert.ok(stream.url.includes("lastSeq=7"));
});

test("openAgnoRunEvents dispatches events reassembled from split network chunks", () => {
  const received = [];
  const stream = openAgnoRunEvents("run-1", (event) => received.push(event), { EventSourceImpl: MockEventSource });

  const full = `event: run_started\ndata: ${JSON.stringify({ type: "run_started", run_id: "run-1", seq: 1 })}\n\n` +
    `event: content_delta\ndata: ${JSON.stringify({ type: "content_delta", run_id: "run-1", seq: 2, content: "Hi" })}\n\n`;

  // Split mid-event to simulate a TCP chunk boundary landing inside a data line.
  const cut = full.indexOf('"content_delta"') + 5;
  stream.feed(full.slice(0, cut));
  assert.equal(received.length, 1, "second event must not fire until its terminating blank line arrives");
  stream.feed(full.slice(cut));

  assert.equal(received.length, 2);
  assert.equal(received[0].type, "run_started");
  assert.equal(received[1].content, "Hi");
});

test("openAgnoRunEvents ignores event types outside the known Ds4AgnoEvent enum", () => {
  const received = [];
  const stream = openAgnoRunEvents("run-1", (event) => received.push(event), { EventSourceImpl: MockEventSource });
  stream.feed(`event: some_unknown_type\ndata: ${JSON.stringify({ type: "some_unknown_type", seq: 1 })}\n\n`);
  assert.equal(received.length, 0);
});

test("parseAgnoEventData returns null on malformed JSON instead of throwing", () => {
  assert.equal(parseAgnoEventData("not json"), null);
  assert.deepEqual(parseAgnoEventData('{"seq":1}'), { seq: 1 });
});
