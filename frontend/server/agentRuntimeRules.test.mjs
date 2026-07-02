import { test } from "node:test";
import assert from "node:assert/strict";
import { agentCoreRulesSection } from "./agentRuntimeRules.mjs";

test("core rules state the evidence/synthesis/no-invention/cite principles concisely", () => {
  const s = agentCoreRulesSection();
  assert.match(s, /Tool outputs are evidence, not final answers/);
  assert.match(s, /navigate deeper/);
  assert.match(s, /Never invent sources/);
  assert.match(s, /Cite the evidence/);
  assert.match(s, /Do not echo repository listings/);
  assert.match(s, /After gitnexus analyze/);
  assert.match(s, /targeted gitnexus query\/context/);
  assert.match(s, /OBSERVE -> COMPRESS -> SELECT_TARGET -> VERDICT/);
  assert.match(s, /Read at most 2 doc\/markdown files/);
  // short: a handful of lines, not an essay
  assert.ok(s.split("\n").length <= 10, "must stay short (§17)");
});
