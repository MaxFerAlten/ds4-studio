// Regression: lean_inspect was advertised to the model but index.mjs never
// passed its executor, so every call answered "the Lean runtime is not
// enabled on this server" while lean_check (wired) worked.
//
// Source contract, like agentChatEndpoint.test.mjs: index.mjs calls
// app.listen on import.  Every `options.<name>Executor` a tool reads in
// agentTools.mjs without a `??` fallback must be handed over by the agent
// loop (an executor with a default is only a test injection point).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (file) => readFile(new URL(file, import.meta.url), "utf8");

test("every tool executor read by agentTools.mjs is wired in index.mjs", async () => {
  const tools = await read("./agentTools.mjs");
  const index = await read("./index.mjs");
  const executors = [...new Set([...tools.matchAll(/options\.(\w+Executor)\b(?!\s*\?\?)/g)].map((m) => m[1]))];
  assert.ok(executors.includes("leanExecutor") && executors.includes("leanInspectExecutor"), executors.join(","));
  for (const name of executors) {
    assert.match(index, new RegExp(`\\b${name}:`), `${name} is never passed to the agent tools`);
  }
  assert.match(index, /leanInspectExecutor: tc\.name === "lean_inspect" \? runLeanInspectForAgent : undefined/);
});
