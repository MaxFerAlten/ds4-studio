import test from "node:test";
import assert from "node:assert/strict";
import {
  SOURCE_ROLE,
  classifySourceClaimRole,
  lexicalSourceRole,
  sourceRolePromotion
} from "./epistemicSourceRole.mjs";

test("the framing the source used is read off the passage", () => {
  assert.equal(lexicalSourceRole("We assume vocabulary completeness.").role, SOURCE_ROLE.ASSUMPTION);
  assert.equal(lexicalSourceRole("We model semantic states as discrete levels.").role, SOURCE_ROLE.MODEL);
  assert.equal(lexicalSourceRole("We find a 12% reduction in latency.").role, SOURCE_ROLE.RESULT);
  assert.equal(lexicalSourceRole("").role, SOURCE_ROLE.UNKNOWN);
});

test("EPI-049: an assumption stated as fact is F37", () => {
  const promoted = sourceRolePromotion({
    claimText: "The vocabulary is complete.",
    role: SOURCE_ROLE.ASSUMPTION
  });
  assert.equal(promoted.promoted, true);
  assert.deepEqual(promoted.failureCodes, ["F37"]);
});

test("EPI-049: keeping the proposition with the source is the repair", () => {
  for (const text of [
    "The paper assumes vocabulary completeness.",
    "The authors model semantic states as discrete levels.",
    "Secondo il paper, gli stati semantici sono discreti."
  ]) {
    assert.deepEqual(sourceRolePromotion({ claimText: text, role: SOURCE_ROLE.ASSUMPTION }).failureCodes, []);
  }
});

test("a result reported as a result is not promoted", () => {
  assert.equal(
    sourceRolePromotion({ claimText: "Latency drops by 12%.", role: SOURCE_ROLE.RESULT }).promoted,
    false
  );
});

test("the classifier never upgrades a role when the model is unavailable or wrong", async () => {
  const passage = "We assume vocabulary completeness.";
  const noClient = await classifySourceClaimRole({ claim: { text: "x" }, passage });
  assert.equal(noClient.role, SOURCE_ROLE.ASSUMPTION);
  assert.equal(noClient.source, "lexical");

  const badClient = { async completeRole() { return { json: { role: "FACT" } }; } };
  const rejected = await classifySourceClaimRole({ claim: { text: "x" }, passage, client: badClient });
  assert.equal(rejected.role, SOURCE_ROLE.ASSUMPTION);
  assert.equal(rejected.source, "lexical");

  const throwing = { async completeRole() { throw new Error("down"); } };
  const survived = await classifySourceClaimRole({ claim: { text: "x" }, passage, client: throwing });
  assert.equal(survived.role, SOURCE_ROLE.ASSUMPTION);
});
