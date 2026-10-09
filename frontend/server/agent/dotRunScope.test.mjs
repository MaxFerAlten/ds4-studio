import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedToolsForDot, dotContextText, toolsForDot } from "./dotRunScope.mjs";

const schemas = ["read", "bash", "context_search"].map((name) => ({ type: "function", function: { name } }));

test("Dot tool schemas and execution scope are isolated across A/B/A turns", () => {
  const dotA = { allowedTools: ["read"] };
  const dotB = { allowedTools: ["bash", "context_search"] };
  assert.deepEqual(toolsForDot(schemas, dotA).map((tool) => tool.function.name), ["read"]);
  assert.deepEqual(toolsForDot(schemas, dotB).map((tool) => tool.function.name), ["bash", "context_search"]);
  assert.deepEqual(toolsForDot(schemas, dotA).map((tool) => tool.function.name), ["read"]);
  assert.deepEqual(allowedToolsForDot(null, dotA), ["read"]);
  assert.deepEqual(allowedToolsForDot(["read", "bash"], dotB), ["bash"]);
});

test("Dot page context includes only the server-resolved authorized pages", () => {
  assert.equal(dotContextText(null), "");
  assert.match(dotContextText({ name: "A", instructions: "usa il contesto", pages: [{ title: "A page", content: "solo A" }] }), /solo A/);
  assert.doesNotMatch(dotContextText({ name: "A", pages: [{ title: "A page", content: "solo A" }] }), /B page/);
});
