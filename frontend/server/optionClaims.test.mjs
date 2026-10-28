import assert from "node:assert/strict";
import { test } from "node:test";
import { ANSWER_CLAIMS_PROMPT, TOOL_READING_PROMPT, answerClaimsRequest, applyValueCheck, mergeClaimReadings, optionClaimsReportLines, parseOptionClaims, toolReadingRequest, valueCheckScript, valueMismatchGuidance, valueReportLines } from "./optionClaims.mjs";

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

test("the two readings never see each other's text: the answer reading has no outputs, the tool reading no answer values", () => {
  const first = answerClaimsRequest({ answer: "Risposta: B. B_list = [0, x*y, 2*x*y]", options: ["A", "B"] });
  assert.deepEqual(Object.keys(first).sort(), ["final_answer", "options"]);
  const reading = { selected: "B", options: [{ label: "A", verdict: "excluded", instance: "k=2" }, { label: "B", verdict: "selected", instance: "k=2" }],
    values: [{ quantity: "B at every index", answer_value: "[0, x*y, 2*x*y]" }] };
  const second = toolReadingRequest({ answerReading: reading, outputs });
  assert.deepEqual(second.options, [{ label: "A", instance: "k=2" }]);
  assert.deepEqual(second.quantities, ["B at every index"]);
  assert.doesNotMatch(JSON.stringify(second), /2\*x\*y\]|Risposta/);
  assert.deepEqual(second.tool_outputs.map((output) => output.number), [1, 2, 3]);
  assert.match(ANSWER_CLAIMS_PROMPT, /without correcting it/);
  assert.match(TOOL_READING_PROMPT, /copy values out of them\. Do not compute or judge anything/);
});

test("the readings merge into one claim set, values matched to their quantity", () => {
  const merged = JSON.parse(mergeClaimReadings(
    JSON.stringify({ selected: "B", options: [{ label: "A", verdict: "excluded", instance: "k=2" }],
      values: [{ quantity: "q1", answer_value: "1" }, { quantity: "q2", answer_value: "2" }] }),
    JSON.stringify({ options: [{ label: "A", tool_output: 2, tool_value: "A = u + 2*d", reference_value: "ref = u + d" }],
      values: [{ quantity: "q2", tool_output: 2, printed_value: "u + d" }, { quantity: "q1", tool_output: null, printed_value: "" }] })));
  assert.deepEqual(merged.options[0], { label: "A", verdict: "excluded", instance: "k=2", tool_output: 2, tool_value: "A = u + 2*d", reference_value: "ref = u + d" });
  assert.deepEqual(merged.values.map((item) => [item.quantity, item.answer_value, item.printed_value]), [["q1", "1", ""], ["q2", "2", "u + d"]]);
  assert.equal(mergeClaimReadings("not json", "{}"), null);
  assert.equal(JSON.parse(mergeClaimReadings('{"selected":null,"options":[],"values":[]}', "garbage")).values.length, 0);
});
test("plan I2: a stated value is compared only when the output really printed the quantity", () => {
  const printed = [{ sequence: 4, tool: "sage", status: "success", text: "B_list = [0, x*y, 2*y^2]\nn=3: True" }];
  const result = parseOptionClaims(JSON.stringify({ selected: null, options: [], values: [
    { quantity: "B list", answer_value: "[0, x*y, 2*x*y]", tool_output: 4, printed_value: "[0, x*y, 2*y^2]" },
    { quantity: "C list", answer_value: "[0, x*y, 0]", tool_output: 4, printed_value: "[0, x*y, 0]" },
    { quantity: "sum", answer_value: "(x+y)^3", tool_output: null, printed_value: "" }
  ] }), { options: [], outputs: printed });
  assert.deepEqual(result.values.map((item) => item.status), ["PENDING", "NOT_PRINTED", "NOT_PRINTED"]);
  assert.equal(result.values[0].sequence, 4);
});

test("the Sage verdicts decide match and mismatch; the guidance quotes the printed value", () => {
  const values = [
    { quantity: "B list", answerValue: "[0, x*y, 2*x*y]", printedValue: "[0, x*y, 2*y^2]", sequence: 4, status: "PENDING" },
    { quantity: "A list", answerValue: "[y^2, 2*x*y, x^2]", printedValue: "[y^2, 2*x*y, x^2]", sequence: 4, status: "PENDING" },
    { quantity: "C list", answerValue: "[0, x*y, 0]", printedValue: "", sequence: null, status: "NOT_PRINTED" }
  ];
  const script = valueCheckScript(values);
  assert.match(script, /\[\[0,"\[0, x\*y, 2\*x\*y\]","\[0, x\*y, 2\*y\^2\]"\],\[1,/);
  const checked = applyValueCheck(values, 'noise\nDS4_VALUE_CHECK {"0": "mismatch", "1": "match"}\n');
  assert.deepEqual(checked.map((item) => item.status), ["MISMATCH", "MATCH", "NOT_PRINTED"]);
  assert.equal(valueMismatchGuidance(checked).split("\n")[1], "- B list: the answer says [0, x*y, 2*x*y], output #4 printed [0, x*y, 2*y^2]");
  assert.deepEqual(valueReportLines(checked), ["- Valori calcolati riportati: 1/2 uguali all'output, 1 diversi dall'output, 1 non stampati da un tool"]);
  assert.deepEqual(applyValueCheck(values, "no verdict line").map((item) => item.status), ["UNCHECKED", "UNCHECKED", "NOT_PRINTED"]);
});

test("only plain expressions reach Sage", () => {
  const unsafe = [
    { answerValue: "__import__('os')", printedValue: "1", status: "PENDING" },
    { answerValue: "1; import os", printedValue: "1", status: "PENDING" },
    { answerValue: "lambda: 1", printedValue: "1", status: "PENDING" }
  ];
  assert.equal(valueCheckScript(unsafe), null);
  assert.equal(valueReportLines([]).length, 0);
});

test("a list printed one entry per line counts as printed only when every entry is there", () => {
  const lines = [{ sequence: 2, tool: "sage", status: "success", text: "A:\n  r=0: y^3\n  r=1: 3*x*y^2\n  r=2: 3*x^2*y\n  r=3: x^3" }];
  const status = (printedValue) => parseOptionClaims(JSON.stringify({ selected: null, options: [], values: [
    { quantity: "A at n=3", answer_value: "[y^3, 3*x*y^2, 3*x^2*y, x^3]", tool_output: 2, printed_value: printedValue }
  ] }), { options: [], outputs: lines }).values[0].status;
  assert.equal(status("[y^3, 3*x*y^2, 3*x^2*y, x^3]"), "PENDING");
  assert.equal(status("[y^3, 3*x*y^2, 9*x^2*y, x^3]"), "NOT_PRINTED");
  assert.equal(status("[y^3, x*y^2]"), "NOT_PRINTED");
});

test("an instance label in the quoted value is not mistaken for another option's", () => {
  const rows = [{ sequence: 1, tool: "sage", status: "success", text: "A:\n  r=0: y^3\nB:\n  r=0: 0\nref:\n  r=0: x^3" }];
  const support = (label, value) => parseOptionClaims(JSON.stringify({ selected: "D", options: [
    { label, verdict: "excluded", instance: "n=3", tool_output: 1, tool_value: value, reference_value: "r=0: x^3" }
  ] }), { options: ["A", "B", "C", "D"], outputs: rows }).claims[0].support;
  assert.equal(support("A", "r=0: y^3"), "TOOL_ATTESTED");
  assert.equal(support("C", "B=0"), "NOT_ATTESTED");
});

// The critique's own case (2026-10-27): the answer restated the report's lists;
// Sage printed different ones for B and C.
test("the critique's lists: B and C as stated differ from what Sage printed", () => {
  const sagePrinted = [{ sequence: 2, tool: "sage", status: "success",
    text: "A_list = [y^2, 2*x*y, x^2]\nB_list = [0, x*y, 2*y^2]\nC_list = [2*x^2, x*y, 0]\nD_list = [x^2, 2*x*y, y^2]" }];
  const merged = mergeClaimReadings(
    JSON.stringify({ selected: "A", options: [], values: [
      { quantity: "B_list (n=2)", answer_value: "[0, x*y, 2*x*y]" },
      { quantity: "C_list (n=2)", answer_value: "[0, x*y, 0]" },
      { quantity: "A_list (n=2)", answer_value: "[y^2, 2*x*y, x^2]" }
    ] }),
    JSON.stringify({ options: [], values: [
      { quantity: "B_list (n=2)", tool_output: 2, printed_value: "[0, x*y, 2*y^2]" },
      { quantity: "C_list (n=2)", tool_output: 2, printed_value: "[2*x^2, x*y, 0]" },
      { quantity: "A_list (n=2)", tool_output: 2, printed_value: "[y^2, 2*x*y, x^2]" }
    ] }));
  const values = parseOptionClaims(merged, { options: [], outputs: sagePrinted }).values;
  assert.deepEqual(values.map((item) => item.status), ["PENDING", "PENDING", "PENDING"]);
  const checked = applyValueCheck(values, 'DS4_VALUE_CHECK {"0": "mismatch", "1": "mismatch", "2": "match"}');
  assert.match(valueMismatchGuidance(checked), /B_list \(n=2\): the answer says \[0, x\*y, 2\*x\*y\], output #2 printed \[0, x\*y, 2\*y\^2\]\n- C_list \(n=2\): the answer says \[0, x\*y, 0\], output #2 printed \[2\*x\^2, x\*y, 0\]$/);
});

test("a list is never compared with a single value: the pairing is wrong, not the answer", () => {
  const values = [
    { quantity: "D at n=2", answerValue: "[x^2, 2*x*y, y^2]", printedValue: "x^2 + 2*x*y + y^2", sequence: 1, status: "PENDING" },
    { quantity: "sum at n=2", answerValue: "x^2 + 2*x*y + y^2", printedValue: "x^2 + 2*x*y + y^2", sequence: 1, status: "PENDING" }
  ];
  assert.match(valueCheckScript(values), /\[\[1,"x\^2 \+ 2\*x\*y \+ y\^2"/);
  assert.doesNotMatch(valueCheckScript(values), /\[0,/);
  const checked = applyValueCheck(values, 'DS4_VALUE_CHECK {"1": "match"}');
  assert.deepEqual(checked.map((item) => item.status), ["UNCHECKED", "MATCH"]);
  assert.equal(valueMismatchGuidance(checked), "");
});

test("the tool reading gets each output's code, so it can tell which inputs a value is for", () => {
  const request = toolReadingRequest({ answerReading: { options: [], values: [{ quantity: "det(A+B) for A=B=I_2" }] },
    outputs: [{ sequence: 1, tool: "sage", status: "success", code: "A = matrix([[1,2],[3,4]])", text: "det(A+B) = -8" },
      { sequence: 2, tool: "bash", status: "success", text: "ok" }] });
  assert.equal(request.tool_outputs[0].code, "A = matrix([[1,2],[3,4]])");
  assert.equal("code" in request.tool_outputs[1], false);
  assert.match(TOOL_READING_PROMPT, /use the code to tell which inputs a printed value is for/);
  assert.match(TOOL_READING_PROMPT, /A value printed for other inputs \(other matrices, another n\) is a different quantity/);
});
