import assert from "node:assert/strict";
import { test } from "node:test";
import { TASK_CONTRACT_PROMPT, parseTaskContract, taskContractInstruction } from "./taskContract.mjs";

const question = "Per una successione con primo termine u e passo d, il termine u_k è:\nA) u + k d\nB) u + (k-1) d";

test("P2 gate: a hypothesis counts as the user's only when its quote is the user's own words", () => {
  const contract = parseTaskContract(JSON.stringify({
    task_kind: "select_option", options: ["A", "B"],
    hypotheses: [
      { statement: "the sequence has first term u and step d", quote: "con primo   termine u e passo d" },
      { statement: "u_k = u + (k-1) d", quote: "u_k = u + (k-1) d" },
      { statement: "the step is positive", quote: "" }
    ],
    open_conventions: ["where the index k starts"]
  }), [question]);
  assert.deepEqual(contract.hypotheses, [{ statement: "the sequence has first term u and step d", quote: "con primo   termine u e passo d" }]);
  assert.equal(contract.droppedHypotheses, 2);
  assert.equal(contract.taskKind, "select_option");
  assert.deepEqual(contract.options, ["A", "B"]);
  assert.deepEqual(contract.openConventions, ["where the index k starts"]);
});

test("a malformed contract is ignored, never fatal", () => {
  assert.equal(parseTaskContract("not json", [question]), null);
  assert.equal(parseTaskContract("[]", [question]), null);
  const odd = parseTaskContract('{"task_kind":"guess","options":"A","open_conventions":[1,"",null]}', [question]);
  assert.equal(odd.taskKind, "other");
  assert.deepEqual(odd.options, []);
  assert.deepEqual(odd.openConventions, ["1"]);
});

test("the final prompt lists the open readings and asks which option each selects", () => {
  const note = taskContractInstruction({ openConventions: ["the order in which the terms are listed", "where the index starts"] });
  assert.match(note, /^TASK_CONTRACT \(read from the user's question alone, before any answer\)/);
  assert.match(note, /- the order in which the terms are listed\n- where the index starts\n/);
  assert.match(note, /say which option it would make correct/);
  assert.equal(taskContractInstruction({ openConventions: [] }), "");
  assert.equal(taskContractInstruction(null), "");
});

test("the extractor is told not to solve and never sees an answer", () => {
  assert.match(TASK_CONTRACT_PROMPT, /without solving it\. Do not choose, compute or hint at an answer/);
  assert.match(TASK_CONTRACT_PROMPT, /Never include an option or a candidate answer as a hypothesis/);
  assert.match(TASK_CONTRACT_PROMPT, /do not say which one is standard or which option it selects/);
});
