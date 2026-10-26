// Opt-in: scripted model, production JS agent, real pinned Mathlib + sandbox.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

test("an omitted Mathlib profile survives placeholder repair and publishes the general binomial proof", {
  skip: process.env.DS4_TEST_REAL_LEAN !== "1",
  timeout: 120000
}, async () => {
  const code = readFileSync(new URL("./lean/fixtures/binomial-expansion.lean", import.meta.url), "utf8");
  const target = "theorem binomial_expansion (x y : ℚ) (n : ℕ) : " +
    "(x + y)^n = ∑ k ∈ Finset.range (n + 1), (n.choose k : ℚ) * x^(n-k) * y^k";
  const call = (id, source, first = false) => ({
    id, name: "lean_check", arguments: {
      code: source, task_mode: "proof", target_declaration: "binomial_expansion",
      ...(first ? { target_statement: target } : {})
      // Deliberately no profile on either call: this reproduces the export.
    }
  });
  // The goal is prepared first (Mathlib inferred from its imports), then proved.
  const backend = await startFakeBackend({ turns: [
    { content: JSON.stringify({ verification_requested: true, required_tools: ["lean_check"],
      tool_selection: ["lean_check"], skill_actions: [] }), finish: "stop" },
    { toolCalls: [{ id: "prepare", name: "lean_prepare", arguments: {
      claim: "The general binomial expansion identity.", imports: ["Mathlib.Data.Nat.Choose.Sum"],
      target_declaration: "binomial_expansion", target_statement: target
    } }], finish: "tool_calls" },
    { content: JSON.stringify({ matches_request: true, selection_question: false, discriminates: true, feedback: "The target states the binomial expansion." }), finish: "stop" },
    { toolCalls: [call("placeholder", `import Mathlib\n${target} := by\n  sorry\n`, true)], finish: "tool_calls" },
    { toolCalls: [call("repair", code)], finish: "tool_calls" },
    { content: `STATO: VERIFIED\n\n\`\`\`lean\n${code}\`\`\``, finish: "stop" }
  ] });
  const server = await startServerChild(backend, { env: {
    DS4_LEAN_ENABLED: "1",
    DS4_LEAN_DEFAULT_PROFILE: "core",
    DS4_LEAN_RUNTIME_ROOT: fileURLToPath(new URL("../../lean-runtime", import.meta.url)),
    DS4_LEAN_POLICY_AUTO: "0"
  } });
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "binomial-profile-real" };
    const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    assert.equal(start.status, 200, await start.text());
    const reply = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers, body: JSON.stringify({ message: "Verify the general binomial expansion with Lean." }),
      signal: AbortSignal.timeout(110000)
    });
    const sse = await reply.text();
    assert.equal(reply.status, 200, sse);
    const calls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
    // Earlier tool messages leave the model context once compacted: read the
    // results the chat received instead.
    const results = [...sse.matchAll(/event: agent_tool_result\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]));
    assert.equal(results.length, 3);
    assert.match(results[0].content, /prepared=true/);
    assert.match(results[0].content, /profile=mathlib/);
    assert.match(results[1].content, /LEAN_CANDIDATE_PREFLIGHT_BLOCKED/);
    assert.match(results[1].content, /profile: mathlib/);
    assert.match(results[2].content, /status: checked/);
    assert.match(results[2].content, /profile: mathlib/);
    // intent router, prepare, goal review, placeholder, repair, final answer
    assert.equal(calls.length, 6, sse.slice(-2000));
    assert.match(sse, /"verified":true/);
    assert.match(sse, /STATO: VERIFIED/);
    assert.doesNotMatch(sse, /LEAN_PROFILE_CHANGED_WITHIN_PROOF|LEAN_PROFILE_IDENTITY_MISMATCH|event: agent_error/);
  } finally {
    server.stop();
    await backend.close();
  }
});
