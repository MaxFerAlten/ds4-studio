import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { prepareContextInjection } from "./agentContextIntegration.mjs";
import { appendContextEvent } from "./contextLedger.mjs";
import { appendContextEvidence, summarizeToolResultForEvidence } from "./contextEvidence.mjs";
import { readContextTelemetry } from "./contextTelemetry.mjs";
import { readCapsuleMeta } from "./contextCapsuleMeta.mjs";
import { sessionContextDir } from "./contextPaths.mjs";
import { AgentSessionManager, AGENT_TOOLS } from "./agentSession.mjs";

function freshKey() {
  return `test-integration-${crypto.randomUUID()}`;
}
async function cleanup(key) {
  await fs.rm(sessionContextDir(key), { recursive: true, force: true });
}

function baseCfg(overrides = {}) {
  return {
    enabled: false, previewOnly: true, softTokens: 1500, hardTokens: 3000,
    maxGrowthPct: 25, maxEvidence: 10, deltaRequired: true, telemetry: true,
    maxLedgerEvents: 5000, ...overrides
  };
}

// Session committed to revision 1 with a stable prefix.
function committedSession() {
  const session = new AgentSessionManager();
  session.start();
  const first = [{ role: "system", content: "stable" }, { role: "user", content: "hi" }];
  const p1 = session.choosePayload({ messages: first, tools: AGENT_TOOLS }, { allowDelta: true, userTurnPolicy: "delta" });
  session.commit(p1.pending, { role: "assistant", content: "ok" });
  return session;
}

// Seed enough context so buildContextCapsule returns a non-empty capsule.
async function seedContext(key) {
  await appendContextEvent(key, { type: "decision", summary: "prefer blob store over raw echo" });
  await appendContextEvidence(key, summarizeToolResultForEvidence({ tool: "read", args: { path: "a.c" }, resultText: "contents" }));
}

test("preview-only does not add capsule message but logs telemetry", async () => {
  const key = freshKey();
  try {
    await seedContext(key);
    const session = committedSession();
    const fullMessages = [...session.messages(), { role: "user", content: "next" }];
    const before = fullMessages.length;
    const res = await prepareContextInjection({
      sessionKey: key, session, fullMessages, tools: AGENT_TOOLS,
      userMessage: "next", config: baseCfg({ enabled: false, previewOnly: true })
    });
    assert.equal(res.capsuleMessage, null);
    assert.equal(res.injected, false);
    assert.equal(fullMessages.length, before, "must not mutate transcript");
    const tele = await readContextTelemetry(key);
    assert.ok(tele.length >= 1);
    assert.equal(tele[tele.length - 1].previewOnly, true);
  } finally {
    await cleanup(key);
  }
});

test("disabled (enabled=0, preview=0) is fully inert", async () => {
  const key = freshKey();
  try {
    await seedContext(key);
    const session = committedSession();
    const fullMessages = [...session.messages(), { role: "user", content: "next" }];
    const res = await prepareContextInjection({
      sessionKey: key, session, fullMessages, tools: AGENT_TOOLS,
      userMessage: "next", config: baseCfg({ enabled: false, previewOnly: false })
    });
    assert.equal(res.injected, false);
    assert.equal(res.preflight, null);
    assert.deepEqual(await readContextTelemetry(key), []);
  } finally {
    await cleanup(key);
  }
});

test("enabled injects a delta-safe capsule and writes meta", async () => {
  const key = freshKey();
  try {
    await seedContext(key);
    const session = committedSession();
    const fullMessages = [...session.messages(), { role: "user", content: "next" }];
    const res = await prepareContextInjection({
      sessionKey: key, session, fullMessages, tools: AGENT_TOOLS,
      userMessage: "next", config: baseCfg({ enabled: true, previewOnly: false })
    });
    assert.equal(res.injected, true);
    assert.equal(res.capsuleMessage.name, "ds4_context_capsule");
    assert.equal(res.preflight.payloadMode, "delta");
    assert.equal(res.preflight.resetRisk, false);
    const meta = await readCapsuleMeta(key);
    assert.equal(meta.hash, res.preflight.capsuleHash);
  } finally {
    await cleanup(key);
  }
});

test("reset risk blocks injection (baseline preserved)", async () => {
  const key = freshKey();
  try {
    await seedContext(key);
    const session = committedSession();
    // Mutated prefix → choosePayload returns reset → resetRisk.
    const committed = session.messages();
    const fullMessages = [
      { role: "system", content: "stable CHANGED" },
      ...committed.slice(1),
      { role: "user", content: "next" }
    ];
    const res = await prepareContextInjection({
      sessionKey: key, session, fullMessages, tools: AGENT_TOOLS,
      userMessage: "next", config: baseCfg({ enabled: true, previewOnly: false })
    });
    assert.equal(res.injected, false);
    assert.equal(res.preflight.resetRisk, true);
  } finally {
    await cleanup(key);
  }
});

test("build failure keeps chat alive (no throw, no capsule)", async () => {
  const key = freshKey();
  try {
    // Broken session: status throws → revision read guarded; still no throw.
    const brokenSession = { choosePayload: () => { throw new Error("boom"); } };
    const fullMessages = [{ role: "user", content: "x" }];
    await seedContext(key);
    const res = await prepareContextInjection({
      sessionKey: key, session: brokenSession, fullMessages, tools: AGENT_TOOLS,
      userMessage: "x", config: baseCfg({ enabled: true, previewOnly: false })
    });
    assert.equal(res.injected, false);
    assert.equal(res.capsuleMessage, null);
  } finally {
    await cleanup(key);
  }
});
