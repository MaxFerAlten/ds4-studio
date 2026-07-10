import assert from "node:assert/strict";
import { test } from "node:test";
import { preflightContextCapsule, pruneCapsuleToBudget } from "./contextPreflight.mjs";
import { AgentSessionManager, AGENT_TOOLS } from "./agentSession.mjs";

function cfg(overrides = {}) {
  return { hardTokens: 3000, maxGrowthPct: 25, deltaRequired: true, maxEvidence: 10, ...overrides };
}

const VALID_CAPSULE = "[DS4_CONTEXT_CAPSULE]\nGoal: continue task\n[/DS4_CONTEXT_CAPSULE]";

// Build a session already committed to revision 1 with a stable prefix.
function committedSession() {
  const session = new AgentSessionManager();
  session.start();
  const first = [
    { role: "system", content: "stable system" },
    { role: "user", content: "hi" }
  ];
  const p1 = session.choosePayload({ messages: first, tools: AGENT_TOOLS }, { allowDelta: true, userTurnPolicy: "delta" });
  session.commit(p1.pending, { role: "assistant", content: "ok" });
  return session;
}

// Test A — empty capsule not injected
test("A: empty capsule not injected", () => {
  const result = preflightContextCapsule({ baseMessages: [], tools: AGENT_TOOLS, capsuleText: "", config: cfg() });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("empty_capsule"));
  assert.equal(result.inject, false);
});

// Test B — capsule over hard limit is pruned
test("B: capsule over hard limit is pruned", () => {
  const huge = "x\n".repeat(20000);
  const result = preflightContextCapsule({ baseMessages: [], tools: AGENT_TOOLS, capsuleText: huge, config: cfg() });
  assert.ok(result.capsuleTokens <= cfg().hardTokens, `tokens ${result.capsuleTokens}`);
  assert.ok(pruneCapsuleToBudget(huge, 3000).length <= 12000 + 100);
});

// Test C — excessive growth blocked
test("C: excessive growth blocked", () => {
  const result = preflightContextCapsule({
    baseMessages: [],
    tools: AGENT_TOOLS,
    capsuleText: "a".repeat(1000), // ~250 tokens
    previousCapsuleMeta: { hash: "old", tokens: 100 },
    config: cfg()
  });
  assert.ok(result.growthPct > 25);
  assert.ok(result.reasons.includes("growth_limit"));
  assert.equal(result.ok, false);
});

// Test D — reset risk blocked (real session, mutated prefix)
test("D: reset risk blocked when prefix mutated", () => {
  const session = committedSession();
  const committed = session.messages();
  const mutated = [
    { role: "system", content: "stable system CHANGED" },
    ...committed.slice(1),
    { role: "user", content: "next" }
  ];
  const result = preflightContextCapsule({
    session,
    baseMessages: mutated,
    tools: AGENT_TOOLS,
    capsuleText: VALID_CAPSULE,
    config: cfg()
  });
  assert.notEqual(result.payloadMode, "delta");
  assert.equal(result.resetRisk, true);
  assert.ok(result.reasons.includes("reset_risk"));
  assert.equal(result.ok, false);
});

// Test E — capsule as append-only message stays delta
test("E: append-only capsule stays delta", () => {
  const session = committedSession();
  const baseMessages = [...session.messages(), { role: "user", content: "next" }];
  const result = preflightContextCapsule({
    session,
    baseMessages,
    tools: AGENT_TOOLS,
    capsuleText: VALID_CAPSULE,
    config: cfg()
  });
  assert.equal(result.payloadMode, "delta");
  assert.equal(result.resetRisk, false);
  assert.equal(result.inject, true);
  assert.equal(result.ok, true);
});

// Test F — does not mutate session revision
test("F: preflight does not mutate session revision", () => {
  const session = committedSession();
  const baseMessages = [...session.messages(), { role: "user", content: "next" }];
  const before = session.status().revision;
  const args = { session, baseMessages, tools: AGENT_TOOLS, capsuleText: VALID_CAPSULE, config: cfg() };
  preflightContextCapsule(args);
  preflightContextCapsule(args);
  assert.equal(session.status().revision, before);
});
