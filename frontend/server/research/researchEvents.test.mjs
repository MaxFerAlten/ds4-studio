import test from "node:test";
import assert from "node:assert/strict";
import { makeEvent, parseEventLines, serializeEvent } from "./researchEvents.mjs";

test("makeEvent increments seq and stamps session fields", () => {
  const state = { sessionId: "rs_abc", threadId: "rs_abc", seq: 0 };
  const event = makeEvent(state, "research_started", { query: "q" });
  assert.equal(event.seq, 1);
  assert.equal(state.seq, 1);
  assert.equal(event.sessionId, "rs_abc");
  assert.equal(event.threadId, "rs_abc");
  assert.equal(event.type, "research_started");
  assert.equal(event.nodeName, null);
  assert.deepEqual(event.content, { query: "q" });
  assert.ok(event.ts);
});

test("makeEvent rejects unknown type", () => {
  assert.throws(
    () => makeEvent({ sessionId: "x", threadId: "x", seq: 0 }, "nope"),
    /unknown research event type/
  );
});

test("serialize and parse round-trip preserves order", () => {
  const state = { sessionId: "rs_abc", threadId: "rs_abc", seq: 0 };
  const a = makeEvent(state, "node_started", {}, "planner");
  const b = makeEvent(state, "node_completed", { result: { x: 1 } }, "planner");
  const parsed = parseEventLines(serializeEvent(a) + serializeEvent(b));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map((e) => e.seq), [1, 2]);
  assert.equal(parsed[1].nodeName, "planner");
  assert.deepEqual(parsed[1].content, { result: { x: 1 } });
});

test("parseEventLines tolerates trailing newline and empty input", () => {
  assert.deepEqual(parseEventLines(""), []);
  assert.deepEqual(parseEventLines("\n"), []);
});
