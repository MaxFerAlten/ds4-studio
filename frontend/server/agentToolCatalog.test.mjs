import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_TOOLS,
  AGENT_TOOL_NAMES,
  getAgentToolDefinition,
  listAgentTools
} from "./agentToolCatalog.mjs";

const EXPECTED = [
  "bash",
  "read",
  "write",
  "edit",
  "search",
  "list",
  "retrieve_context_blob",
  "sage",
  "web_search",
  "web_read",
  "crawl",
  "research_discover",
  "chat_history_search",
  "page_snapshot",
  "page_action",
  "page_task"
];

test("canonical catalog contains exactly the expected tools", () => {
  assert.deepEqual(AGENT_TOOL_NAMES, EXPECTED);
});

test("tool names are unique", () => {
  assert.equal(
    new Set(AGENT_TOOL_NAMES).size,
    AGENT_TOOL_NAMES.length
  );
});

test("each entry is an OpenAI function schema", () => {
  for (const item of AGENT_TOOLS) {
    assert.equal(item.type, "function");
    assert.equal(typeof item.function.name, "string");
    assert.equal(typeof item.function.description, "string");
    assert.equal(item.function.parameters.type, "object");
  }
});

test("listAgentTools returns defensive copies", () => {
  const a = listAgentTools();
  const b = listAgentTools();
  assert.notEqual(a, b);
  assert.notEqual(a[0], b[0]);
});

test("canonical catalog is frozen", () => {
  assert(Object.isFrozen(AGENT_TOOLS));
});
