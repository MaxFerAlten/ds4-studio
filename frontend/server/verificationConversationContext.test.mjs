import test from "node:test";
import assert from "node:assert/strict";
import { compactVerificationConversation } from "./verificationConversationContext.mjs";

const anchor = { role: "user", content: "Verifica con SageMath e Lean4" };
const instruction = "VERIFICATION_PLAN: use only lean_check";
const call = (id, name, code) => ({ role: "assistant", tool_calls: [
  { id, type: "function", function: { name, arguments: JSON.stringify({ code }) } }
] });
const result = (id, content) => ({ role: "tool", tool_call_id: id, content });
const compact = (messages, options = {}) => compactVerificationConversation(messages, {
  turnAnchor: anchor, activeInstruction: instruction, activeTool: "lean_check", ...options
});

test("a blocked Sage call preserves the newest actual Lean code and diagnostics", () => {
  const lean = call("lean-1", "lean_check", "theorem t : True := by exact missingLemma");
  const error = result("lean-1", "unknown identifier missingLemma");
  const source = [anchor, call("sage-1", "sage", "print(2+2)"), result("sage-1", "Report SageMath validato."),
    lean, error, call("wrong", "sage", "obsolete code"), result("wrong", "VERIFICATION_TOOL_OUT_OF_ORDER")];
  const output = compact(source, { blockedCallIds: ["wrong"] });
  assert.ok(output.messages.includes(lean));
  assert.ok(output.messages.includes(error));
  assert.equal(output.retainedCalls, 1);
  assert.equal(output.compactedCalls, 2);
  assert.doesNotMatch(JSON.stringify(output.messages), /obsolete code|print\(2\+2\)/);
  assert.match(JSON.stringify(output.messages), /VERIFICATION_TOOL_OUT_OF_ORDER/);
  const again = compact(output.messages, { blockedCallIds: ["wrong"] });
  assert.equal(again.changed, false);
  assert.equal(again.compactedCalls, 2);
});

test("a mixed rejected batch leaves no orphan tool results in the model context", () => {
  const mixed = call("wrong-lean", "lean_check", "bad");
  mixed.tool_calls.push(call("wrong-read", "read", "bad").tool_calls[0]);
  const output = compact([anchor, mixed, result("wrong-lean", "VERIFICATION_TOOL_OUT_OF_ORDER"),
    result("wrong-read", "VERIFICATION_TOOL_OUT_OF_ORDER")], { blockedCallIds: ["wrong-lean", "wrong-read"] });
  assert.equal(output.messages.some((message) => message.role === "tool" || message.tool_calls), false);
  assert.equal(output.retainedCalls, 0);
});

test("phase transition removes Sage source while retaining its receipt summary", () => {
  const output = compact([anchor, call("sage", "sage", "long Sage code"), result("sage", "Report SageMath validato.")]);
  assert.doesNotMatch(JSON.stringify(output.messages), /long Sage code/);
  assert.match(JSON.stringify(output.messages), /Report SageMath validato/);
  assert.equal(output.messages.at(-1).content, instruction);
});

test("a new Lean attempt keeps bounded history and replaces only the previous source", () => {
  const first = compact([anchor, call("old", "lean_check", "old code"), result("old", "first error")]);
  const second = compact([...first.messages, call("new", "lean_check", "new code"), result("new", "second error")]);
  assert.doesNotMatch(JSON.stringify(second.messages), /old code/);
  assert.match(JSON.stringify(second.messages), /new code/);
  assert.match(JSON.stringify(second.messages), /first error/);
  assert.equal(second.retainedCalls, 1);
  assert.equal(second.compactedCalls, 1);
  assert.equal(compact(second.messages).changed, false);
});

test("short repair rounds preserve an exact append-only prefix within the configured window", () => {
  const options = { maxRetainedCalls: 3, maxRetainedChars: 24000 };
  const first = compact([anchor, call("one", "lean_check", "first code"), result("one", "first error")], options);
  const appended = [...first.messages, call("two", "lean_check", "second code"), result("two", "second error")];
  const second = compact(appended, options);
  assert.equal(second.messages, appended);
  assert.equal(second.changed, false);
  assert.equal(second.retainedCalls, 2);
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages);
  const overflow = compact([...second.messages,
    call("three", "lean_check", "third code"), result("three", "third error"),
    call("four", "lean_check", "fourth code"), result("four", "fourth error")], options);
  assert.equal(overflow.changed, true);
  assert.equal(overflow.retainedCalls, 1);
  assert.equal(overflow.compactedCalls, 3);
  assert.doesNotMatch(JSON.stringify(overflow.messages), /first code|second code|third code/);
  assert.match(JSON.stringify(overflow.messages), /fourth code/);
});

test("a phase change and a blocked call inside the window only append the new instruction", () => {
  const options = { maxRetainedCalls: 8, maxRetainedChars: 64000, blockedCallIds: ["foreign"] };
  const sageInstruction = "[DS4 Studio] VERIFICATION_PLAN: run SageMath";
  const sageTurn = [anchor, { role: "user", content: sageInstruction },
    call("sage-1", "sage", "print(2+2)"), result("sage-1", "Report SageMath validato."),
    call("foreign", "lean_check", "early proof"), result("foreign", "VERIFICATION_TOOL_OUT_OF_ORDER")];
  const leanPhase = compact(sageTurn, options);
  assert.equal(leanPhase.changed, true);
  assert.deepEqual(leanPhase.messages.slice(0, sageTurn.length), sageTurn);
  assert.deepEqual(leanPhase.messages.at(-1), { role: "user", content: instruction });
  const repeat = compact(leanPhase.messages, options);
  assert.equal(repeat.changed, false);
  assert.equal(repeat.messages, leanPhase.messages);
});

test("the repair window compacts oversized code and foreign calls even before the count limit", () => {
  const options = { maxRetainedCalls: 3, maxRetainedChars: 1600, blockedCallIds: ["foreign"] };
  const messages = [anchor, call("old", "lean_check", "old".repeat(1000)), result("old", "old error"),
    call("new", "lean_check", "new code"), result("new", "new error"),
    call("foreign", "sage", "wrong code"), result("foreign", "VERIFICATION_TOOL_OUT_OF_ORDER")];
  const output = compact(messages, options);
  assert.equal(output.retainedCalls, 1);
  assert.doesNotMatch(JSON.stringify(output.messages), /oldoldold|wrong code/);
  assert.match(JSON.stringify(output.messages), /new code/);
});

test("Lean symbol inspection retains its signatures together with the candidate needing repair", () => {
  const proof = call("proof", "lean_check", "theorem t : True := by exact missing");
  const diagnostic = result("proof", "unknown identifier missing");
  const inspect = call("inspect", "lean_inspect", "signature query");
  const signature = result("inspect", "Nat.add_comm (n m : Nat) : n + m = m + n");
  const output = compact([anchor, call("prepare", "lean_prepare", "old goal"), result("prepare", "prepared=true"),
    proof, diagnostic, inspect, signature], { activeTools: ["lean_prepare", "lean_inspect", "lean_check"] });
  assert.ok(output.messages.includes(proof));
  assert.ok(output.messages.includes(diagnostic));
  assert.ok(output.messages.includes(inspect));
  assert.ok(output.messages.includes(signature));
  assert.equal(output.retainedCalls, 2);
});
