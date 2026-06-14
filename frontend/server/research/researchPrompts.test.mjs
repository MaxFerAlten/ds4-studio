import test from "node:test";
import assert from "node:assert/strict";
import { loadPrompt, renderPrompt, renderTemplate } from "./researchPrompts.mjs";

test("renderTemplate replaces vars and blanks missing ones", () => {
  assert.equal(renderTemplate("Hi {{name}}, {{missing}}!", { name: "ds4" }), "Hi ds4, !");
});

test("all MVP prompts load and render without leftovers", async () => {
  const vars = {
    query: "q",
    optimized_queries: "[]",
    coordinator_json: "{}",
    plan_json: "null",
    simple: "false"
  };
  for (const name of ["coordinator", "rewrite", "planner", "reporter"]) {
    const text = await renderPrompt(name, vars);
    assert.ok(text.length > 100, `${name} prompt too short`);
    assert.ok(!text.includes("{{"), `${name} prompt has unreplaced vars`);
  }
});

test("loadPrompt rejects path-escaping names", async () => {
  await assert.rejects(() => loadPrompt("../secrets"), /invalid prompt name/);
});
