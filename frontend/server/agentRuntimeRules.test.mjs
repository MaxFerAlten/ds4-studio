import { test } from "node:test";
import assert from "node:assert/strict";
import { agentCoreRulesSection } from "./agentRuntimeRules.mjs";

test("core rules state the evidence/synthesis/no-invention/cite principles concisely", () => {
  const s = agentCoreRulesSection();
  assert.match(s, /Tool outputs are evidence, not final answers/);
  assert.match(s, /navigate deeper/);
  assert.match(s, /Never invent sources/);
  assert.match(s, /Cite the evidence/);
  // short: a handful of lines, not an essay
  assert.ok(s.split("\n").length <= 6, "must stay short (§17)");
});
