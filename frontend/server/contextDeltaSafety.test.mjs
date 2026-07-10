// PATCH 11 — Blocking guardrail: the context capsule must never regress the
// delta/session-reuse path. If any of these fail, do NOT enable injection.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSessionManager, AGENT_TOOLS } from "./agentSession.mjs";
import { makeContextCapsuleMessage } from "./contextCapsule.mjs";
import { preflightContextCapsule } from "./contextPreflight.mjs";

const CAPSULE = makeContextCapsuleMessage("[DS4_CONTEXT_CAPSULE]\nGoal: continue previous task\n[/DS4_CONTEXT_CAPSULE]");
const cfg = { hardTokens: 3000, maxGrowthPct: 25, deltaRequired: true, maxEvidence: 10 };

// Commit to revision 1 with a stable prefix, return { session, committed }.
function committed() {
  const session = new AgentSessionManager();
  session.start();
  const first = [{ role: "system", content: "stable system" }, { role: "user", content: "hello" }];
  const p1 = session.choosePayload({ messages: first, tools: AGENT_TOOLS }, { allowDelta: true, userTurnPolicy: "delta" });
  session.commit(p1.pending, { role: "assistant", content: "done" });
  return { session, committed: session.messages() };
}

test("Test 1: baseline delta stays delta after revision > 0", () => {
  const { session } = committed();
  const second = [...session.messages(), { role: "user", content: "next" }];
  const p2 = session.choosePayload({ messages: second, tools: AGENT_TOOLS }, { allowDelta: true, userTurnPolicy: "delta" });
  assert.equal(p2.mode, "delta");
});

test("Test 2: append-only capsule keeps delta", () => {
  const { session } = committed();
  const second = [...session.messages(), CAPSULE, { role: "user", content: "next" }];
  const probe = session.choosePayload({ messages: second, tools: AGENT_TOOLS }, { allowDelta: true, userTurnPolicy: "delta" });
  assert.equal(probe.mode, "delta");
});

test("Test 3: mutating the system prompt breaks delta (must NOT be delta)", () => {
  const { session, committed: msgs } = committed();
  const mutated = [
    { role: "system", content: "stable system\nnew capsule appended into system" },
    ...msgs.slice(1),
    { role: "user", content: "next" }
  ];
  const probe = session.choosePayload({ messages: mutated, tools: AGENT_TOOLS }, { allowDelta: true, userTurnPolicy: "delta" });
  assert.notEqual(probe.mode, "delta");
});

test("Test 4: preflight blocks reset risk", () => {
  const { session, committed: msgs } = committed();
  const mutated = [
    { role: "system", content: "stable system CHANGED" },
    ...msgs.slice(1),
    { role: "user", content: "next" }
  ];
  const result = preflightContextCapsule({
    session, baseMessages: mutated, tools: AGENT_TOOLS,
    capsuleText: "[DS4_CONTEXT_CAPSULE]\nGoal: x\n[/DS4_CONTEXT_CAPSULE]", config: cfg
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("reset_risk"));
});
