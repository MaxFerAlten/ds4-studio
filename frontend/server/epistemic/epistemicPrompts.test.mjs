import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ENTAILMENT_POLICY_PROMPT,
  ENTAILMENT_PROMPT,
  REPAIR_PROMPT,
  SELF_CRITIQUE_PROMPT
} from "./epistemicPrompts.mjs";

function promptFile(name) {
  return readFileSync(new URL(`./prompts/${name}`, import.meta.url), "utf8").trim();
}

test("role prompt exports preserve the reviewed Markdown verbatim", () => {
  assert.equal(SELF_CRITIQUE_PROMPT, promptFile("selfCritique.md"));
  assert.equal(ENTAILMENT_POLICY_PROMPT, promptFile("entailment.md"));
  assert.equal(REPAIR_PROMPT, promptFile("repair.md"));
});

test("entailment prompt keeps policy and the machine-readable span contract", () => {
  assert.ok(ENTAILMENT_PROMPT.startsWith(ENTAILMENT_POLICY_PROMPT));
  assert.match(ENTAILMENT_PROMPT, /supportingSpans/);
  assert.match(ENTAILMENT_PROMPT, /unsupportedSubclaims/);
  assert.match(ENTAILMENT_PROMPT, /architecture metadata does not entail Hessian\/NTK behavior/);
});

test("self-critique and repair policies reject agreement and memory replacements", () => {
  assert.match(SELF_CRITIQUE_PROMPT, /zero evidential weight/);
  assert.match(SELF_CRITIQUE_PROMPT, /Replacement claims are PROPOSED/);
  assert.match(REPAIR_PROMPT, /Do not agree with the challenger/);
  assert.match(REPAIR_PROMPT, /Do not generate exact replacements from memory/);
});
