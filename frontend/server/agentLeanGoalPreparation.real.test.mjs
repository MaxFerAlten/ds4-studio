import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

const root = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const target = "theorem addition_commutes (x n : Nat) : x + n = n + x";
const source = `${target} := by exact Nat.add_comm x n`;
const intent = { content: JSON.stringify({ verification_requested: true, required_tools: ["lean_check"],
  tool_selection: ["lean_check"], skill_actions: [] }), finish: "stop" };
const call = (id, name, args) => ({ toolCalls: [{ id, name, arguments: args }], finish: "tool_calls" });
const prepare = (statement = target) => ({ claim: "Addition of naturals is commutative.", imports: [],
  profile: "core", target_declaration: "addition_commutes", target_statement: statement });
const review = (accept) => ({ content: JSON.stringify({ matches_request: accept, selection_question: false, discriminates: true,
  feedback: accept ? "The target states the requested commutativity." : "True does not state commutativity." }), finish: "stop" });
const proof = call("proof", "lean_check", { task_mode: "proof", target_declaration: "addition_commutes", target_statement: target, code: source });
const final = { content: `STATO: VERIFIED\n\n\`\`\`lean\n${source}\n\`\`\``, finish: "stop" };

for (const repairFirst of [false, true]) {
  test(`real JS agent prepares the goal${repairFirst ? " after rejecting a weaker goal" : " after symbol inspection"} before checking its proof`, {
    skip: process.env.DS4_TEST_REAL_LEAN !== "1", timeout: 120000
  }, async () => {
    const turns = repairFirst
      ? [intent, call("weak", "lean_prepare", prepare("theorem addition_commutes : True")), review(false),
        call("prepare", "lean_prepare", prepare()), review(true), proof, final]
      : [intent, call("inspect", "lean_inspect", { symbols: ["Nat.add_comm"], profile: "core" }),
        call("prepare", "lean_prepare", prepare()), review(true), proof, final];
    const backend = await startFakeBackend({ turns });
    const runsRoot = resolve(tmpdir(), `ds4-agent-goals-${process.pid}-${repairFirst}`);
    const server = await startServerChild(backend, { env: {
      DS4_LEAN_ENABLED: "1", DS4_LEAN_DEFAULT_PROFILE: "core", DS4_LEAN_POLICY_AUTO: "0",
      DS4_SAGE_POLICY_AUTO: "0", DS4_SAGE_SKILL_AUTO: "0",
      DS4_LEAN_RUNTIME_ROOT: resolve(root, "lean-runtime"), DS4_LEAN_RUNS_ROOT: runsRoot
    } });
    try {
      const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": `goal-proof-${repairFirst}` };
      await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
      const response = await fetch(`${server.base}/api/agent/chat`, { method: "POST", headers,
        body: JSON.stringify({ message: "Dimostra che l'addizione dei naturali è commutativa usando Lean." }), signal: AbortSignal.timeout(110000) });
      const sse = await response.text();
      assert.equal(response.status, 200, sse);
      assert.match(sse, /prepared=true/);
      assert.match(sse, /verified=false/);
      assert.match(sse, /"verified":true/);
      assert.match(sse, /STATO: VERIFIED/);
      assert.doesNotMatch(sse, /event: agent_error|LEAN_TARGET_STATEMENT_MISMATCH|LEAN_REPEATED_TOOL_ACTION/);
      if (repairFirst) assert.match(sse, /LEAN_GOAL_SCOPE_MISMATCH/);
      else assert.match(sse, /LEAN_INSPECT/);
      const requests = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
      const semanticReviews = requests.filter((entry) => entry.body.messages[0]?.content?.includes?.("faithfully formalizes"));
      assert.equal(semanticReviews.length, repairFirst ? 2 : 1);
    } finally {
      server.stop(); await backend.close(); await rm(runsRoot, { recursive: true, force: true });
    }
  });
}

// Audit F25: an aggregate identity that a competing answer satisfies as well
// must not be locked as the target of a selection question, and the reviewer
// must never see the model's own conclusion.
test("real JS agent refuses a non-discriminating target and locks the one that singles out the answer", {
  skip: process.env.DS4_TEST_REAL_LEAN !== "1", timeout: 120000
}, async () => {
  const aggregate = "theorem pick_term (f : Nat → Nat) : f 0 + f 1 = f 1 + f 0";
  const pointwise = "theorem pick_term (f : Nat → Nat) (h : f 0 = 1) : f 0 = 1";
  const select = (statement) => ({ claim: "MODEL_CONCLUSION_OPTION_A", imports: [], profile: "core",
    target_declaration: "pick_term", target_statement: statement });
  const verdict = (discriminates) => ({ content: JSON.stringify({ matches_request: true, selection_question: true, discriminates,
    competing_statement: discriminates ? "" : "theorem pick_term' (f : Nat → Nat) : f 1 + f 0 = f 0 + f 1",
    feedback: discriminates ? "The statement fixes the first term." : "The sum is invariant under reordering." }), finish: "stop" });
  const proofSource = `${pointwise} := by exact h`;
  const backend = await startFakeBackend({ turns: [intent,
    call("aggregate", "lean_prepare", select(aggregate)), verdict(false),
    call("pointwise", "lean_prepare", select(pointwise)), verdict(true),
    call("proof", "lean_check", { task_mode: "proof", target_declaration: "pick_term", target_statement: pointwise, code: proofSource }),
    { content: `STATO: VERIFIED\n\n\`\`\`lean\n${proofSource}\n\`\`\``, finish: "stop" }] });
  const runsRoot = resolve(tmpdir(), `ds4-agent-goals-${process.pid}-discriminate`);
  const server = await startServerChild(backend, { env: {
    DS4_LEAN_ENABLED: "1", DS4_LEAN_DEFAULT_PROFILE: "core", DS4_LEAN_POLICY_AUTO: "0",
    DS4_SAGE_POLICY_AUTO: "0", DS4_SAGE_SKILL_AUTO: "0",
    DS4_LEAN_RUNTIME_ROOT: resolve(root, "lean-runtime"), DS4_LEAN_RUNS_ROOT: runsRoot
  } });
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "goal-discriminate" };
    await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    const response = await fetch(`${server.base}/api/agent/chat`, { method: "POST", headers,
      body: JSON.stringify({ message: "Quale opzione dà il primo termine? A) f 0  B) f 1. Verifica con Lean." }),
      signal: AbortSignal.timeout(110000) });
    const sse = await response.text();
    assert.equal(response.status, 200, sse);
    assert.match(sse, /LEAN_GOAL_NOT_DISCRIMINATING/);
    assert.match(sse, /competing_statement=theorem pick_term'/);
    assert.match(sse, /prepared=true/);
    assert.match(sse, /"verified":true/);
    const reviews = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions" &&
      entry.body.messages[0]?.content?.includes?.("faithfully formalizes"));
    assert.equal(reviews.length, 2);
    for (const entry of reviews) assert.doesNotMatch(JSON.stringify(entry.body.messages), /MODEL_CONCLUSION_OPTION_A/);
  } finally {
    server.stop(); await backend.close(); await rm(runsRoot, { recursive: true, force: true });
  }
});
