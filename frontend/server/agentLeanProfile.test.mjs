import assert from "node:assert/strict";
import { test } from "node:test";
import { executeTool } from "./agentTools.mjs";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

test("lean_check infers Mathlib when the model omits profile", async () => {
  let request;
  await executeTool("lean_check", {
    code: "import Mathlib.Data.Nat.Choose.Sum\ntheorem t : True := by trivial",
    task_mode: "proof",
    target_declaration: "t"
  }, {
    leanExecutor: async (body) => {
      request = body;
      return { status: "checked", profile: body.profile };
    }
  });
  assert.equal(request.profile, "mathlib");
});

test("a standalone core-only adapter call leaves the executor default intact", async () => {
  let request;
  await executeTool("lean_check", { code: "theorem t : True := by trivial", task_mode: "utility" }, {
    leanExecutor: async (body) => {
      request = body;
      return { status: "checked" };
    }
  });
  assert.equal(request.profile, undefined);
});

for (const [label, code, defaultProfile, expected] of [
  ["Mathlib import", "import Mathlib.Data.Nat.Choose.Sum\ntheorem t : True := by trivial", "core", "mathlib"],
  ["configured default", "theorem t : True := by trivial", "mathlib", "mathlib"],
  ["core default", "theorem t : True := by trivial", "core", "core"]
]) {
  test(`JS agent passes the resolved profile to the executor: ${label}`, async () => {
    const backend = await startFakeBackend({ turns: [
      { toolCalls: [{ id: "proof1", name: "lean_check", arguments: {
        code, task_mode: "utility"
      } }], finish: "tool_calls" },
      { content: "STATO: NOT_VERIFIED\nCausa terminale: LEAN_RUNTIME_UNAVAILABLE.", finish: "stop" }
    ] });
    const server = await startServerChild(backend, { env: {
      DS4_LEAN_ENABLED: "0", DS4_LEAN_DEFAULT_PROFILE: defaultProfile
    } });
    try {
      const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "lean-profile-regression" };
      const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
      assert.equal(start.status, 200, await start.text());
      const reply = await fetch(`${server.base}/api/agent/chat`, {
        method: "POST", headers, body: JSON.stringify({ message: "prove t with lean" })
      });
      const sse = await reply.text();
      assert.equal(reply.status, 200, sse);
      const calls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
      assert.equal(calls.length, 2);
      const results = calls.at(-1).body.messages.filter((m) => m.role === "tool");
      assert.equal(results.length, 1);
      assert.match(results[0].content, new RegExp(`profile: ${expected}\\b`));
    } finally {
      server.stop();
      await backend.close();
    }
  });
}
