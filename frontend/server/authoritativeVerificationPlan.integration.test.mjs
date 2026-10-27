import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

test("repeated out-of-order tool calls advance the verification plan instead of exhausting the turn", async () => {
  const backend = await startFakeBackend({ turns: [
    { content: JSON.stringify({ verification_requested: true, required_tools: ["sage", "lean_check"], tool_selection: ["sage", "lean_check"], skill_actions: [] }), finish: "stop" },
    { toolCalls: [{ id: "utility-1", name: "lean_check", arguments: {
      code: "theorem t : True := by trivial", task_mode: "utility"
    } }], finish: "tool_calls" },
    { content: "SageMath e Lean hanno verificato il teorema.", finish: "stop" },
    { toolCalls: [{ id: "proof-1", name: "lean_check", arguments: {
      code: "theorem t : True := by trivial", task_mode: "proof",
      target_declaration: "t", target_statement: "theorem t : True"
    } }], finish: "tool_calls" },
    { content: "Lean non è disponibile: la verifica non è stata eseguita.", finish: "stop" }
  ] });
  const server = await startServerChild(backend, { env: {
    DS4_SAGE_POLICY_AUTO: "0", DS4_SAGE_SKILL_AUTO: "0", DS4_LEAN_ENABLED: "0"
  } });
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "dual-verification" };
    const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    assert.equal(start.status, 200, await start.text());
    const response = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers,
      body: JSON.stringify({ message: "mi verifichi con sagemath e con lean4" })
    });
    const sse = await response.text();
    assert.equal(response.status, 200, sse);
    assert.doesNotMatch(sse, /Agent reached maximum iterations/);

    const chatCalls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
    assert.ok(chatCalls.length >= 5, sse);
    // One catalog for the whole turn (the plan gates execution, not the schema
    // list): the rendered prefix, tool schemas first, never changes.
    for (const name of ["lean_check", "lean_inspect", "lean_prepare", "sage"]) assert.ok(chatCalls[1].body.tools.includes(name), name);
    for (const entry of chatCalls.slice(2)) assert.deepEqual(entry.body.tools, chatCalls[1].body.tools);
    const systemPrefix = chatCalls[1].body.messages.find((message) => message.role === "system").content;
    for (const entry of chatCalls.slice(2)) {
      assert.deepEqual(entry.body.messages.find((message) => message.role === "system").content, systemPrefix);
    }
    assert.deepEqual(chatCalls[1].body.tool_choice, { type: "function", function: { name: "sage" } });
    assert.ok(chatCalls.some((entry) => entry.body.tool_choice === "required"),
      "the forced function advances to Lean only after Sage becomes terminal");
    const secondRound = chatCalls[2].body.messages.map((message) => message.content || "").join("\n");
    const thirdRound = chatCalls[3].body.messages.map((message) => message.content || "").join("\n");
    assert.match(secondRound, /VERIFICATION_TOOL_OUT_OF_ORDER/);
    assert.match(thirdRound, /VERIFICATION_CALL_REQUIRED/);
    assert.match(sse, /VERIFICATION_TOOL_OUT_OF_ORDER/);
    assert.match(sse, /Lean non è disponibile/);
    assert.doesNotMatch(sse, /SageMath e Lean hanno verificato il teorema/);
    assert.match(sse, /event: agent_verification_status/);
    assert.match(sse, /"complete":true/);
    assert.match(sse, /"state":"blocked"/);
    assert.match(sse, /SAGE_CALL_NOT_COMPLETED/);
    assert.match(sse, /LEAN_CALL_NOT_COMPLETED/);
  } finally {
    server.stop();
    await backend.close();
  }
});

test("a terminal Lean plan blocks execution while keeping the catalog for the final report", async () => {
  const preparation = { id: "goal-1", name: "lean_prepare", arguments: {
    claim: "Prove the natural-number identity.", target_declaration: "t",
    target_statement: "theorem t (n : ℕ) : n + 0 = n", profile: "core"
  } };
  const leanCall = {
    id: "same-lean-call",
    name: "lean_check",
    arguments: {
      task_mode: "proof",
      target_declaration: "binomial_general_term",
      target_statement: "theorem binomial_general_term (n r : ℕ) : (x + y)^n = ...",
      code: "import Mathlib\n\ntheorem binomial_general_term (n r : ℕ) : (x + y)^n = ∑ k ∈ Finset.range (n+1), Nat.choose n k * x^(n-k) * y^k := by\n  sorry\n",
      profile: "mathlib"
    }
  };
  const backend = await startFakeBackend({ turns: [
    { content: JSON.stringify({ verification_requested: true, required_tools: ["lean_check"], tool_selection: ["lean_check"], skill_actions: [] }), finish: "stop" },
    { toolCalls: [preparation], finish: "tool_calls" },
    { toolCalls: [leanCall], finish: "tool_calls" },
    { toolCalls: [{ ...leanCall, id: "after-final-prompt" }], finish: "tool_calls" }
  ] });
  const server = await startServerChild(backend, { env: {
    DS4_SAGE_POLICY_AUTO: "0", DS4_SAGE_SKILL_AUTO: "0", DS4_LEAN_ENABLED: "0"
  } });
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "repeated-lean-repair" };
    const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    assert.equal(start.status, 200, await start.text());
    const response = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers,
      body: JSON.stringify({ message: "usa Lean4 per dimostrare questa affermazione" })
    });
    const sse = await response.text();
    assert.equal(response.status, 200, sse);
    assert.doesNotMatch(sse, /Agent reached maximum iterations/);
    assert.match(sse, /"complete":true/);
    assert.match(sse, /Il backend ha richiesto un tool dopo che il piano era terminato/);
    assert.match(sse, /LEAN_RUNTIME_UNAVAILABLE|LEAN_PROFILE_NOT_PREPARED|LEAN_TOOL_UNAVAILABLE|LEAN_DISABLED/);
    assert.match(sse, /finish_reason":"verification_plan_complete/);
    const chatCalls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
    assert.equal(chatCalls.length, 4, sse);
    assert.equal(chatCalls[1].body.tool_choice, "required");
    assert.equal(chatCalls[2].body.tool_choice, "auto");
    // A tool call after the plan completed buys one more round, with tools off.
    assert.equal(chatCalls[3].body.tool_choice, "none");
    assert.deepEqual(chatCalls[2].body.tools, chatCalls[1].body.tools);
    assert.deepEqual(chatCalls[2].body.messages.find((message) => message.role === "system").content,
      chatCalls[1].body.messages.find((message) => message.role === "system").content);
  } finally {
    server.stop();
    await backend.close();
  }
});

test("parallel and mixed Lean batches are never dispatched and cannot loop indefinitely", async () => {
  const lean = (id) => ({ id, name: "lean_prepare", arguments: {
    claim: "Prove True.",
    target_declaration: "t", target_statement: "theorem t : True"
  } });
  const backend = await startFakeBackend({ turns: [
    { content: JSON.stringify({ verification_requested: true, required_tools: ["lean_check"], tool_selection: ["lean_check"], skill_actions: [] }), finish: "stop" },
    { toolCalls: [lean("parallel-1"), lean("parallel-2")], finish: "tool_calls" },
    { toolCalls: [lean("mixed-lean"), { id: "mixed-sage", name: "sage", arguments: { code: "print(1)" } }], finish: "tool_calls" },
    { toolCalls: [lean("parallel-3"), lean("parallel-4")], finish: "tool_calls" },
    { content: "Lean 4: NON VERIFICATO, nessuna esecuzione ammessa.", finish: "stop" }
  ] });
  const server = await startServerChild(backend, { env: {
    DS4_SAGE_POLICY_AUTO: "0", DS4_SAGE_SKILL_AUTO: "0", DS4_LEAN_ENABLED: "0"
  } });
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "serialized-lean" };
    await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    const response = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers, body: JSON.stringify({ message: "verifica con Lean4" })
    });
    const sse = await response.text();
    assert.equal(response.status, 200, sse);
    assert.match(sse, /VERIFICATION_PARALLEL_TOOL_CALLS_FORBIDDEN/);
    assert.match(sse, /VERIFICATION_TOOL_OUT_OF_ORDER/);
    assert.match(sse, /LEAN_CALL_NOT_COMPLETED/);
    assert.match(sse, /"complete":true/);
    assert.doesNotMatch(sse, /"state":"dispatched"|Agent reached maximum iterations/);
    const calls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions").slice(1);
    for (const name of ["lean_check", "lean_inspect", "lean_prepare"]) assert.ok(calls[0].body.tools.includes(name), name);
    for (const entry of calls.slice(0, 3)) {
      assert.deepEqual(entry.body.tools, calls[0].body.tools);
      assert.equal(entry.body.tool_choice, "required");
    }
    assert.deepEqual(calls.at(-1).body.tools, calls[0].body.tools);
    assert.equal(calls.at(-1).body.tool_choice, "auto");
  } finally {
    server.stop();
    await backend.close();
  }
});

test("a later ordinary turn reuses the verification turn's catalog and system text until /lean stop", async () => {
  const backend = await startFakeBackend({ turns: [
    { content: JSON.stringify({ verification_requested: true, required_tools: ["lean_check"], tool_selection: ["lean_check"], skill_actions: [] }), finish: "stop" },
    { content: "Lean 4: NOT_VERIFIED (LEAN_TOOL_UNAVAILABLE).", finish: "stop" },
    { content: "Ciao.", finish: "stop" },
    { content: "Ciao di nuovo.", finish: "stop" }
  ] });
  const server = await startServerChild(backend, { env: {
    DS4_SAGE_POLICY_AUTO: "0", DS4_SAGE_SKILL_AUTO: "0", DS4_LEAN_ENABLED: "0"
  } });
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "stable-catalog" };
    await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    const send = async (message) => {
      const response = await fetch(`${server.base}/api/agent/chat`, { method: "POST", headers, body: JSON.stringify({ message }) });
      const sse = await response.text();
      assert.equal(response.status, 200, sse);
      return sse;
    };
    await send("dimostra con Lean 4 che 1 + 1 = 2");
    await send("ciao");
    const rounds = () => backend.log.filter((entry) => entry.path === "POST /v1/chat/completions" && entry.body.stream);
    const [verification, ordinary] = rounds();
    assert.ok(verification.body.tools.includes("lean_check"));
    assert.deepEqual(ordinary.body.tools, verification.body.tools);
    const system = (entry) => entry.body.messages.find((message) => message.role === "system").content;
    assert.deepEqual(system(ordinary), system(verification));
    await send("/lean stop");
    await send("ciao ancora");
    assert.equal(rounds().at(-1).body.tools.includes("lean_check"), false);
  } finally {
    server.stop();
    await backend.close();
  }
});
