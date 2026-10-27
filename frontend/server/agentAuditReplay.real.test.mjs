// Gate of P-1 (docs/feature/piano.fix.agent.Proof-to-Claim-Validator.md
// §0-bis.4): the audit's failure, replayed on a synthetic problem of the same
// family with a scripted model, the real server and real Lean. The model
// formalizes an aggregate identity that every alternative satisfies, insists
// on it, then answers crediting SageMath (never run) and Lean (never
// verified). The server must refuse the goal, end Lean NOT_VERIFIED, withhold
// the false credits and publish the turn's real status itself.

import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

const root = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const question = [
  "Il termine di posto k+1 nello sviluppo di (a+b)^m è:",
  "A) C(m,k) a^k b^(m-k)",
  "B) C(m,k) a^(m-k) b^k",
  "Rispondi e verifica con Lean."
].join("\n");
// True of both alternatives (and not by rfl alone): it names no term.
const aggregate = "theorem term_sum (m : Nat) : 0 + m = m";
const intent = { content: JSON.stringify({ verification_requested: true, tool_evaluation_requested: false,
  required_tools: ["lean_check"], tool_selection: ["lean_check"], skill_actions: [] }), finish: "stop" };
// The model rewords its claim on every retry, as it did in the audit: only the
// statement decides whether the goal was already refused.
const prepare = (id, claim) => ({ toolCalls: [{ id, name: "lean_prepare", arguments: {
  claim, imports: [], profile: "core",
  target_declaration: "term_sum", target_statement: aggregate
} }], finish: "tool_calls" });
const notDiscriminating = { content: JSON.stringify({ matches_request: true, selection_question: true,
  discriminates: false, competing_statement: aggregate,
  feedback: "Alternative A satisfies the same statement: it does not select an answer." }), finish: "stop" };
const falseCredit = (i) => ({ content: `Risposta: B (${i}). SageMath ha confermato i coefficienti e Lean 4 ha verificato il teorema.`,
  finish: "stop" });

test("P-1 gate: the audit's false verification claims are refused and the server reports the real status", {
  skip: process.env.DS4_TEST_REAL_LEAN !== "1", timeout: 150000
}, async () => {
  const turns = [intent,
    prepare("g1", "The binomial terms sum to (a+b)^m, so the general term is B."), notDiscriminating,
    prepare("g2", "Summing the general term over k gives (a+b)^m."),
    prepare("g3", "The expansion of (a+b)^m is the sum of the B terms."),
    falseCredit(1), falseCredit(2), falseCredit(3), falseCredit(4), falseCredit(5)];
  const backend = await startFakeBackend({ turns });
  const runsRoot = resolve(tmpdir(), `ds4-audit-replay-${process.pid}`);
  const server = await startServerChild(backend, { env: {
    DS4_LEAN_ENABLED: "1", DS4_LEAN_DEFAULT_PROFILE: "core", DS4_LEAN_POLICY_AUTO: "0",
    DS4_SAGE_POLICY_AUTO: "0", DS4_SAGE_SKILL_AUTO: "0", DS4_AGENT_LEAN_MAX_GOAL_REJECTIONS: "3",
    DS4_LEAN_RUNTIME_ROOT: resolve(root, "lean-runtime"), DS4_LEAN_RUNS_ROOT: runsRoot
  } });
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "audit-replay" };
    await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    const response = await fetch(`${server.base}/api/agent/chat`, { method: "POST", headers,
      body: JSON.stringify({ message: question }), signal: AbortSignal.timeout(140000) });
    const sse = await response.text();
    assert.equal(response.status, 200, sse);
    // The aggregate goal is refused, the refusal is remembered, Lean ends.
    assert.match(sse, /LEAN_GOAL_NOT_DISCRIMINATING/);
    assert.match(sse, /LEAN_GOAL_ALREADY_REJECTED/);
    assert.match(sse, /LEAN_GOAL_REJECTED_REPEATEDLY/);
    assert.doesNotMatch(sse, /prepared=true|event: agent_error/);
    // No false credit reaches the client before the rewrites are spent.
    const text = [...sse.matchAll(/event: agent_text\ndata: (.*)/g)].map((m) => JSON.parse(m[1]).content).join("");
    assert.doesNotMatch(text, /Risposta: B \((?:1|2)\)/);
    assert.match(text, /Risposta: B \(3\)/);
    // The published answer carries the server's own account of the turn.
    assert.match(text, /\*\*Verifica \(DS4 Studio\)\*\*\n\n- Lean 4: NON VERIFICATO \(LEAN_GOAL_REJECTED_REPEATEDLY\)/);
    assert.doesNotMatch(text, /- Lean 4: VERIFICATO|- SageMath:/);
    assert.match(text, /\[DS4 Studio\]/);
    assert.doesNotMatch(sse, /"leanVerified":true/);
  } finally {
    server.stop(); await backend.close(); await rm(runsRoot, { recursive: true, force: true });
  }
});
