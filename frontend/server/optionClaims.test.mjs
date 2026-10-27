import assert from "node:assert/strict";
import { test } from "node:test";
import { OPTION_CLAIMS_PROMPT, optionClaimsReportLines, optionClaimsRequest, parseOptionClaims } from "./optionClaims.mjs";

const outputs = [
  { sequence: 1, tool: "sage", status: "error", text: "NameError: name 'u' is not defined" },
  { sequence: 2, tool: "sage", status: "success", text: "k=2: ref = u + d   A = u + 2*d   B = u + d" },
  { sequence: 3, tool: "bash", status: "success", text: "A = u + 2*d" }
];
const reply = (options) => JSON.stringify({ selected: "B", options });

test("P3 gate: an exclusion is tool-attested only when the quoted value is in a successful output of the turn", () => {
  const result = parseOptionClaims(reply([
    { label: "A", verdict: "excluded", instance: "k=2", tool_output: 2, tool_value: "A = u + 2*d", reference_value: "ref = u + d" },
    { label: "B", verdict: "selected", instance: "k=2", tool_output: 2, tool_value: "B = u + d" }
  ]), { options: ["A", "B"], outputs });
  assert.equal(result.selected, "B");
  assert.deepEqual(result.claims[0], { label: "A", verdict: "excluded", instance: "k=2", support: "TOOL_ATTESTED",
    evidence: { sequence: 2, tool: "sage", value: "A = u + 2*d", reference: "ref = u + d" } });
  assert.equal(result.claims[1].support, "NOT_APPLICABLE");
});

test("a value the output does not contain, a failed call or no citation is not attested", () => {
  const check = (item) => parseOptionClaims(reply([{ label: "A", verdict: "excluded", instance: "k=2", reference_value: "ref = u + d", ...item }]),
    { options: ["A", "B"], outputs }).claims[0].support;
  assert.equal(check({ tool_output: 2, tool_value: "A = u + 3*d" }), "NOT_ATTESTED");
  assert.equal(check({ tool_output: 1, tool_value: "NameError" }), "NOT_ATTESTED");
  assert.equal(check({ tool_output: 9, tool_value: "A = u + 2*d" }), "NOT_ATTESTED");
  assert.equal(check({ tool_output: null, tool_value: "" }), "NOT_ATTESTED");
  assert.equal(check({ tool_output: 2, tool_value: "A" }), "NOT_ATTESTED");
  // Whitespace differences do not matter; the characters do.
  assert.equal(check({ tool_output: 2, tool_value: "A =  u + 2*d" }), "TOOL_ATTESTED");
  // A piece of a longer expression, another option's value, or no reference: not a counterexample.
  assert.equal(check({ tool_output: 2, tool_value: "u + 2" }), "NOT_ATTESTED");
  assert.equal(check({ tool_output: 2, tool_value: "B = u + d" }), "NOT_ATTESTED");
  assert.equal(check({ tool_output: 2, tool_value: "A = u + 2*d", reference_value: "" }), "NOT_ATTESTED");
});

test("an option whose printed value equals the reference is not excluded by it", () => {
  const same = [{ sequence: 1, tool: "sage", status: "success", text: "r=1: ref=2*x*y A=2*x*y B=x*y" }];
  const support = (value) => parseOptionClaims(reply([{ label: "A", verdict: "excluded", instance: "n=2, r=1",
    tool_output: 1, tool_value: value, reference_value: "ref=2*x*y" }]), { options: ["A", "B"], outputs: same }).claims[0].support;
  assert.equal(support("A=2*x*y"), "NOT_ATTESTED");
  assert.equal(support("2*x*y"), "NOT_ATTESTED");
});

test("labels outside the question, duplicates and bad verdicts are ignored, never fatal", () => {
  assert.equal(parseOptionClaims("not json", { options: ["A"], outputs }), null);
  const result = parseOptionClaims(JSON.stringify({ selected: "Z", options: [
    { label: "Z", verdict: "excluded" }, { label: "A", verdict: "maybe" }, { label: "A", verdict: "excluded" }
  ] }), { options: ["A", "B"], outputs });
  assert.equal(result.selected, null);
  assert.deepEqual(result.claims.map((claim) => [claim.label, claim.verdict]), [["A", "not_discussed"]]);
});

test("the report names each exclusion and whether a tool attests it", () => {
  const lines = optionClaimsReportLines({ claims: [
    { label: "A", verdict: "excluded", instance: "k=2", support: "TOOL_ATTESTED", evidence: { sequence: 2, tool: "sage" } },
    { label: "C", verdict: "excluded", instance: "", support: "NOT_ATTESTED", evidence: null },
    { label: "B", verdict: "selected", instance: "k=2", support: "NOT_APPLICABLE", evidence: null }
  ] });
  assert.deepEqual(lines, [
    "- Esclusione di A: controesempio attestato da SageMath (k=2), output #2",
    "- Esclusione di C: non attestata da un tool"
  ]);
  assert.deepEqual(optionClaimsReportLines(null), []);
});

test("the extractor gets the answer and numbered outputs, and is told not to judge", () => {
  const request = optionClaimsRequest({ answer: "Risposta: B.", options: ["A", "B"], outputs });
  assert.deepEqual(request.tool_outputs.map((output) => output.number), [1, 2, 3]);
  assert.equal(request.final_answer, "Risposta: B.");
  assert.match(OPTION_CLAIMS_PROMPT, /Do not compute or judge anything yourself/);
  assert.match(OPTION_CLAIMS_PROMPT, /copied character for character from that output/);
});
