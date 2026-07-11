import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const NON_SAGE_CASES = [
  ["bash", { command: "pwd" }],
  ["read", { path: "README.md" }],
  ["write", { path: "note.txt", content: "ok" }],
  ["edit", { path: "note.txt", old_text: "ok", new_text: "done" }],
  ["search", { query: "SageMath", path: "." }],
  ["list", { path: "." }],
  ["crawl", { url: "https://example.test" }],
  ["retrieve_context_blob", { blob_id: "a".repeat(64) }]
];

async function runCharacterizedGenericPath(toolCall, executeTool, emit) {
  emit("agent_tool_call", {
    id: toolCall.id,
    name: toolCall.name,
    arguments: toolCall.arguments
  });

  const result = await executeTool(toolCall.name, toolCall.arguments, {});

  emit("agent_tool_result", {
    id: toolCall.id,
    name: toolCall.name,
    content: result.content,
    isError: result.isError,
    guarded: false
  });
}

test("non-Sage tools retain the legacy call/result event contract", async () => {
  for (const [name, args] of NON_SAGE_CASES) {
    const calls = [];
    const events = [];
    const executeToolMock = async (toolName, toolArgs, options) => {
      calls.push({ toolName, toolArgs, options });
      return { content: `${toolName}-result`, isError: false };
    };

    await runCharacterizedGenericPath(
      { id: `call-${name}`, name, arguments: args },
      executeToolMock,
      (event, data) => events.push({ event, data })
    );

    assert.deepEqual(calls, [{ toolName: name, toolArgs: args, options: {} }]);
    assert.deepEqual(events, [
      {
        event: "agent_tool_call",
        data: { id: `call-${name}`, name, arguments: args }
      },
      {
        event: "agent_tool_result",
        data: {
          id: `call-${name}`,
          name,
          content: `${name}-result`,
          isError: false,
          guarded: false
        }
      }
    ]);
  }
});

test("the production non-Sage branch preserves legacy SSE and model payloads", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");

  assert.match(
    source,
    /writeAgentSse\("agent_tool_call", \{\s*id: tc\.id,\s*name: tc\.name,\s*arguments: tc\.arguments\s*\}\)/
  );
  assert.match(
    source,
    /writeAgentSse\("agent_tool_result", \{\s*id: r\.id,\s*name: r\.name,\s*content: r\.content,\s*isError: r\.isError,\s*guarded: Boolean\(r\.guarded\)\s*\}\)/
  );
  assert.match(
    source,
    /fullMessages\.push\(\{\s*role: "tool",\s*tool_call_id: r\.id,\s*content: r\.content\s*\}\)/
  );
  assert.match(source, /const SAFE_PARALLEL = new Set\(\["read", "list", "search"\]\)/);
});
