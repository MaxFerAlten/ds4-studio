import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildContextCapsuleFromData,
  makeContextCapsuleMessage
} from "./contextCapsule.mjs";

function ev(id, summary) {
  return { id, summary, stale: false };
}
function evt(type, summary, target) {
  return { type, summary, target: target || null };
}

test("empty events/evidence returns empty string", () => {
  assert.equal(buildContextCapsuleFromData({}), "");
});

test("produces open/close markers", () => {
  const out = buildContextCapsuleFromData({ events: [evt("decision", "use blob store")] });
  assert.ok(out.startsWith("[DS4_CONTEXT_CAPSULE]"));
  assert.ok(out.trimEnd().endsWith("[/DS4_CONTEXT_CAPSULE]"));
});

test("does not include more than maxEvidence evidence", () => {
  const evidence = Array.from({ length: 20 }, (_, i) => ev(`ev_${i}`, `s${i}`));
  const out = buildContextCapsuleFromData({ evidence, config: { maxEvidence: 3 } });
  const evLines = out.split("\n").filter((l) => /^- ev_\d+:/.test(l));
  assert.equal(evLines.length, 3);
});

test("trims long lines", () => {
  const out = buildContextCapsuleFromData({ events: [evt("decision", "a".repeat(1000))] });
  const line = out.split("\n").find((l) => l.startsWith("- aaa"));
  assert.ok(line.length <= 2 + 240);
});

test("includes active files", () => {
  const out = buildContextCapsuleFromData({ events: [evt("file_read", "read", "src/main.c")] });
  assert.ok(out.includes("Active files:"));
  assert.ok(out.includes("- src/main.c"));
});

test("recent decisions come before old ones", () => {
  const events = [
    evt("decision", "old-decision"),
    evt("decision", "new-decision")
  ];
  const out = buildContextCapsuleFromData({ events });
  assert.ok(out.indexOf("new-decision") < out.indexOf("old-decision"));
});

test("deterministic output for identical input", () => {
  const events = [evt("decision", "d"), evt("open_question", "q")];
  const evidence = [ev("ev_1", "s")];
  const a = buildContextCapsuleFromData({ events, evidence });
  const b = buildContextCapsuleFromData({ events, evidence });
  assert.equal(a, b);
});

test("makeContextCapsuleMessage uses role=user and name, not system", () => {
  const msg = makeContextCapsuleMessage("x");
  assert.equal(msg.role, "user");
  assert.equal(msg.name, "ds4_context_capsule");
  assert.notEqual(msg.role, "system");
});

test("soft budget drops oldest evidence first", () => {
  const evidence = Array.from({ length: 8 }, (_, i) => ev(`ev_${i}`, "detail ".repeat(20)));
  const full = buildContextCapsuleFromData({ evidence, config: { maxEvidence: 8 } });
  const soft = buildContextCapsuleFromData({ evidence, config: { maxEvidence: 8, softTokens: 60 } });
  const count = (t) => t.split("\n").filter((l) => /^- ev_\d+:/.test(l)).length;
  assert.ok(count(soft) < count(full), `${count(soft)} vs ${count(full)}`);
  // newest evidence (ev_7) is kept; oldest (ev_0) dropped first
  if (count(soft) > 0) assert.ok(soft.includes("ev_7"));
});

test("very tight soft budget falls back to minimal capsule form", () => {
  const events = [
    { type: "decision", summary: "d ".repeat(50) },
    { type: "open_question", summary: "q ".repeat(50) }
  ];
  const out = buildContextCapsuleFromData({ events, userMessage: "goal", config: { softTokens: 15 } });
  assert.ok(out.includes("Use context_search"));
  assert.ok(out.startsWith("[DS4_CONTEXT_CAPSULE]"));
  assert.ok(out.trimEnd().endsWith("[/DS4_CONTEXT_CAPSULE]"));
});

test("no soft limit keeps full capsule (backward compatible)", () => {
  const evidence = [ev("ev_1", "s")];
  const events = [evt("decision", "d")];
  const out = buildContextCapsuleFromData({ events, evidence });
  assert.ok(out.includes("Recent evidence:"));
  assert.ok(out.includes("Do not repeat:"));
});
