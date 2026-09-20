import test from "node:test";
import assert from "node:assert/strict";

import {
  advertisedAgentTools,
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
  "lean_inspect",
  "lean_check",
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

test("advertisedAgentTools hides lean_check and lean_inspect until the backend is enabled", () => {
  const off = advertisedAgentTools({ leanEnabled: false });
  const on = advertisedAgentTools({ leanEnabled: true });

  assert.equal(off.some((t) => t.function.name === "lean_check"), false);
  assert.equal(on.filter((t) => t.function.name === "lean_check").length, 1);
  assert.equal(off.some((t) => t.function.name === "lean_inspect"), false);
  assert.equal(on.filter((t) => t.function.name === "lean_inspect").length, 1);

  // Default is closed: a caller that forgets the flag must not leak the tools.
  assert.equal(advertisedAgentTools().some((t) => t.function.name === "lean_check"), false);
  assert.equal(advertisedAgentTools().some((t) => t.function.name === "lean_inspect"), false);
});

test("advertisedAgentTools gates sage independently of lean", () => {
  const noSage = advertisedAgentTools({ sageEnabled: false, leanEnabled: true });
  assert.equal(noSage.some((t) => t.function.name === "sage"), false);
  assert.equal(noSage.some((t) => t.function.name === "lean_check"), true);

  const noLean = advertisedAgentTools({ sageEnabled: true, leanEnabled: false });
  assert.equal(noLean.some((t) => t.function.name === "sage"), true);
});

test("advertisedAgentTools leaves the rest of the catalog untouched", () => {
  const off = advertisedAgentTools({ leanEnabled: false });
  const all = listAgentTools();
  assert.equal(off.length, all.length - 2);
  for (const name of ["bash", "read", "write", "edit", "search", "list"]) {
    assert.ok(off.some((t) => t.function.name === name), `${name} must survive gating`);
  }
});

test("advertisedAgentTools returns defensive copies", () => {
  const first = advertisedAgentTools({ leanEnabled: true });
  first[0].function.name = "mutated";
  const second = advertisedAgentTools({ leanEnabled: true });
  assert.notEqual(second[0].function.name, "mutated");
});

test("advertisedAgentTools narrows lean_check to core-only when mathlib is not ready", () => {
  const tools = advertisedAgentTools({ leanEnabled: true, leanCoreOnly: true });
  const leanCheck = tools.find((t) => t.function.name === "lean_check");

  assert.ok(leanCheck, "lean_check must stay advertised in core-only mode");
  assert.deepEqual(leanCheck.function.parameters.properties.profile.enum, ["core"]);
  assert.match(leanCheck.function.description, /core-only/);
  assert.match(leanCheck.function.parameters.properties.profile.description, /mathlib is not available/);
});

test("advertisedAgentTools advertises the full schema by default", () => {
  const tools = advertisedAgentTools({ leanEnabled: true });
  const leanCheck = tools.find((t) => t.function.name === "lean_check");

  assert.deepEqual(leanCheck.function.parameters.properties.profile.enum, ["core", "mathlib"]);
  assert.doesNotMatch(leanCheck.function.description, /core-only/);
});

test("advertisedAgentTools core-only mode keeps the rest of the catalog intact", () => {
  const coreOnly = advertisedAgentTools({ leanEnabled: true, leanCoreOnly: true });
  const full = advertisedAgentTools({ leanEnabled: true });

  assert.equal(coreOnly.length, full.length);
  for (const name of ["bash", "read", "write", "sage", "page_task"]) {
    const inCoreOnly = coreOnly.find((t) => t.function.name === name);
    const inFull = full.find((t) => t.function.name === name);
    assert.deepEqual(inCoreOnly, inFull, `${name} must be identical in core-only mode`);
  }
});

// ---------------------------------------------------------------------------
// WP08 — model-facing schema for task mode and target declaration.
// ---------------------------------------------------------------------------

function leanCheckSchema() {
  return advertisedAgentTools({ leanEnabled: true }).find(
    (t) => t.function.name === "lean_check"
  )?.function;
}

test("task_mode enum is proof/utility and required", () => {
  const fn = leanCheckSchema();
  assert.ok(fn, "lean_check must be advertised");
  const taskMode = fn.parameters.properties.task_mode;
  assert.deepEqual(taskMode.enum, ["proof", "utility"]);
  assert.deepEqual(fn.parameters.required, ["code", "task_mode"]);
});

test("target_declaration property is present in the schema", () => {
  const fn = leanCheckSchema();
  assert.ok(fn.parameters.properties.target_declaration);
  assert.match(fn.parameters.properties.target_declaration.description, /Required when task_mode=proof/);
});

test("expectedTargetStatementSha256 is never exposed to the model", () => {
  const fn = leanCheckSchema();
  assert.equal(fn.parameters.properties.expectedTargetStatementSha256, undefined);
  assert.equal(JSON.stringify(fn).includes("expectedTargetStatementSha256"), false);
});

test("lean_inspect description presents it as optional discovery, never authorization", () => {
  const fn = advertisedAgentTools({ leanEnabled: true }).find((t) => t.function.name === "lean_inspect")?.function;
  assert.ok(fn, "lean_inspect must be advertised");
  assert.match(fn.description, /optional discovery/i);
  assert.match(fn.description, /never authorizes lean_check/i);
});

test("lean_check description separates utility checked from verified proof", () => {
  const fn = leanCheckSchema();
  assert.match(fn.description, /is not a verified user proof/i);
  assert.match(fn.description, /locks the target statement/i);
});
