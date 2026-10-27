import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentSystemText } from "./agentSystemText.mjs";
import { verificationPhaseInstruction } from "./verificationConversationContext.mjs";
import { createLeanTaskSpec } from "./lean/leanTaskSpec.mjs";

import {
  AuthoritativeVerificationPlan,
  createAuthoritativeVerificationPlan
} from "./authoritativeVerificationPlan.mjs";

const sealGoal = (plan) => {
  const result = createLeanTaskSpec({ targetDeclaration: "t", targetStatement: "theorem t : True", requiredProfile: "core" });
  assert.equal(plan.recordLeanPreparation(result.value), true);
};

test("the system text keeps the math policies while the plan moves through every phase", () => {
  const skills = { sage: "SAGE_ONLY_OPERATIONAL_RULE", lean: "LEAN_ONLY_OPERATIONAL_RULE" };
  const plan = new AuthoritativeVerificationPlan();
  const system = () => buildAgentSystemText({ jsSections: ["CORE_RULE"], skills });
  const prefix = system();
  assert.match(prefix, /SAGE_ONLY_OPERATIONAL_RULE[\s\S]*LEAN_ONLY_OPERATIONAL_RULE/);
  const instructions = [verificationPhaseInstruction(plan)];
  plan.finishVerifier("sage", "verified");
  assert.deepEqual(plan.allowedTools, ["lean_prepare", "lean_inspect"]);
  instructions.push(verificationPhaseInstruction(plan));
  sealGoal(plan);
  assert.deepEqual(plan.allowedTools, ["lean_check", "lean_inspect"]);
  instructions.push(verificationPhaseInstruction(plan));
  plan.finishVerifier("lean", "not_verified");
  assert.deepEqual(plan.allowedTools, []);
  instructions.push(verificationPhaseInstruction(plan));
  assert.equal(system(), prefix);
  // Phase instructions are short tail messages in the plan's own nudge form.
  for (const instruction of instructions) {
    assert.match(instruction, /^\[DS4 Studio\] VERIFICATION_PLAN/);
    assert.doesNotMatch(instruction, /OPERATIONAL_RULE/);
    assert.ok(instruction.length < 2000, instruction);
  }
  assert.equal(new Set(instructions).size, 4);
});

test("Lean calls are serialized and Sage cannot run again during Lean repair", () => {
  const plan = new AuthoritativeVerificationPlan();
  plan.finishVerifier("sage", "verified");
  sealGoal(plan);
  assert.equal(plan.allowsToolBatch([{ name: "lean_check" }]).allowed, true);
  assert.equal(plan.allowsToolBatch([{ name: "sage" }]).code, "VERIFICATION_TOOL_OUT_OF_ORDER");
  assert.equal(plan.allowsToolBatch([{ name: "lean_check" }, { name: "sage" }]).allowed, false);
  assert.equal(plan.allowsToolBatch([{ name: "lean_check" }, { name: "lean_check" }]).code,
    "VERIFICATION_PARALLEL_TOOL_CALLS_FORBIDDEN");
  assert.equal(plan.recordDispatch({ callId: "wrong", toolName: "sage" }), false);
  assert.deepEqual(plan.snapshot().receipts, []);
});

test("server plan consumes the model's selected verifiers without text matching", () => {
  assert.equal(createAuthoritativeVerificationPlan({
    verificationRequested: true, requiredTools: ["sage", "lean_check"]
  }) instanceof AuthoritativeVerificationPlan, true);
  assert.equal(createAuthoritativeVerificationPlan({
    verificationRequested: false, requiredTools: ["sage"]
  }), null);
});

test("dual plan exposes Sage then Lean and requires both terminal outcomes", () => {
  const plan = new AuthoritativeVerificationPlan();
  assert.deepEqual(plan.allowedTools, ["sage"]);
  plan.finishVerifier("sage", "verified");
  assert.deepEqual(plan.allowedTools, ["lean_prepare", "lean_inspect"]);
  assert.match(plan.promptForActiveVerifier(), /Now verify .* with Lean 4/);
  assert.equal(plan.complete, false);
  plan.finishVerifier("lean", "verified");
  assert.equal(plan.complete, true);
  assert.deepEqual(plan.allowedTools, []);
});

test("an unavailable verifier is not verified and the available verifier still runs", () => {
  const plan = new AuthoritativeVerificationPlan({ sageAvailable: false, leanAvailable: true });
  assert.equal(plan.snapshot().verifiers.sage.status, "not_verified");
  assert.equal(plan.snapshot().verifiers.sage.code, "SAGE_TOOL_UNAVAILABLE");
  assert.deepEqual(plan.allowedTools, ["lean_prepare", "lean_inspect"]);
  plan.finishVerifier("lean", "verified");
  assert.equal(plan.complete, true);
});

test("the plan rejects mixed and out-of-order authoritative tool batches", () => {
  const plan = new AuthoritativeVerificationPlan();
  assert.equal(plan.allowsToolBatch([{ name: "sage" }, { name: "lean_check" }]).code, "VERIFICATION_TOOL_OUT_OF_ORDER");
  assert.equal(plan.allowsToolBatch([{ name: "sage" }, { name: "read" }]).code, "VERIFICATION_TOOL_OUT_OF_ORDER");
  assert.equal(plan.allowsToolBatch([{ name: "sage" }]).allowed, true);
  plan.finishVerifier("sage", "verified");
  assert.equal(plan.allowsToolBatch([{ name: "sage" }]).allowed, false);
  assert.equal(plan.allowsToolBatch([{ name: "lean_check" }]).code, "LEAN_GOAL_NOT_PREPARED");
  sealGoal(plan);
  assert.equal(plan.allowsToolBatch([{ name: "lean_check" }]).allowed, true);
});

test("only dispatched calls with matching result IDs create execution receipts", () => {
  const plan = new AuthoritativeVerificationPlan();
  assert.equal(plan.recordDispatch({ callId: "s1", toolName: "sage" }), true);
  assert.equal(plan.recordResult({ callId: "wrong", isError: false }), false);
  assert.equal(plan.recordResult({ callId: "s1", isError: false }), true);
  assert.deepEqual(plan.snapshot().receipts, [
    { callId: "s1", verifier: "sage", toolName: "sage", state: "result_received" }
  ]);
});

test("dual Sage yields after repeated failures persist despite the requested strategy change", () => {
  const plan = new AuthoritativeVerificationPlan();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const callId = `sage-${attempt}`;
    assert.equal(plan.recordDispatch({ callId, toolName: "sage" }), true);
    assert.equal(plan.recordResult({ callId, isError: true }), true);
    assert.equal(plan.sageRepeatedFailureLimitReached(2), attempt >= 3);
  }
  plan.finishVerifier("sage", "not_verified", "SAGE_REPEATED_FAILURE_LIMIT");
  assert.deepEqual(plan.allowedTools, ["lean_prepare", "lean_inspect"]);
});

test("missing tool calls are nudged, then marked not verified before finalization", () => {
  const plan = new AuthoritativeVerificationPlan({ sageAvailable: false });
  assert.deepEqual(plan.finalizationDecision(), {
    action: "continue", verifier: "lean", code: "VERIFICATION_CALL_REQUIRED"
  });
  assert.deepEqual(plan.finalizationDecision(), {
    action: "continue", verifier: "lean", code: "VERIFICATION_CALL_REQUIRED"
  });
  const exhausted = plan.finalizationDecision();
  assert.equal(exhausted.action, "continue");
  assert.equal(exhausted.code, "LEAN_CALL_NOT_COMPLETED");
  assert.equal(plan.snapshot().verifiers.lean.status, "not_verified");
  assert.equal(plan.complete, true);
});

test("repeated out-of-order tool calls are bounded and advance as NOT_VERIFIED", () => {
  const plan = new AuthoritativeVerificationPlan({ requiredTools: ["sage", "lean_check"] });
  assert.deepEqual(plan.blockedCallDecision(), {
    action: "continue", verifier: "sage", code: "VERIFICATION_CALL_REQUIRED"
  });
  assert.deepEqual(plan.blockedCallDecision(), {
    action: "continue", verifier: "sage", code: "VERIFICATION_CALL_REQUIRED"
  });
  const exhausted = plan.blockedCallDecision();
  assert.equal(exhausted.advanced, true);
  assert.equal(exhausted.code, "SAGE_CALL_NOT_COMPLETED");
  assert.equal(plan.snapshot().verifiers.sage.status, "not_verified");
  assert.deepEqual(plan.allowedTools, ["lean_prepare", "lean_inspect"]);
});

test("inspection is allowed only in Lean and neither prepares a goal nor verifies a proof", () => {
  const plan = new AuthoritativeVerificationPlan();
  assert.equal(plan.allowsToolBatch([{ name: "lean_inspect" }]).allowed, false);
  plan.finishVerifier("sage", "verified");
  assert.equal(plan.recordDispatch({ callId: "premature", toolName: "lean_check" }), false);
  assert.equal(plan.allowsToolBatch([{ name: "lean_inspect" }]).allowed, true);
  assert.equal(plan.recordDispatch({ callId: "inspect", toolName: "lean_inspect" }), true);
  plan.recordResult({ callId: "inspect" });
  assert.equal(plan.leanGoal.prepared, false);
  assert.equal(plan.verifiers.lean.status, "running");
  sealGoal(plan);
  assert.equal(plan.allowsToolBatch([{ name: "lean_check" }]).allowed, true);
  assert.equal(plan.allowsToolBatch([{ name: "lean_prepare" }]).code, "LEAN_GOAL_ALREADY_PREPARED");
  assert.equal(plan.verifiers.lean.status, "running");
});

test("the final prompt names the statement Lean verified and asks whether it singles out the answer", () => {
  const plan = createAuthoritativeVerificationPlan({ verificationRequested: true, requiredTools: ["lean_check"],
    sageAvailable: false, leanAvailable: true });
  assert.match(plan.promptForActiveVerifier(), /each competing alternative on the smallest instance where they take different values/);
  // The convention analysis is asked of the answer, not of the tool phases.
  assert.doesNotMatch(plan.promptForActiveVerifier(), /for each one you reject/);
  assert.match(plan.promptForActiveVerifier(), /Compute the reference under the standard convention of the field/);
  assert.match(plan.promptForActiveVerifier(), /the reference reversed, or the reference shifted by one index/);
  sealGoal(plan);
  plan.finishVerifier("lean", "verified");
  const final = plan.finalPrompt();
  assert.match(final, /Lean verified exactly this statement: theorem /);
  assert.match(final, /singles out the answer against the alternatives/);
  assert.match(final, /Never attribute a result to a tool that is not listed above/);
  assert.match(final, /whether a symbol or word of the question itself excludes that reading/);
  assert.match(final, /smallest instance where the alternatives take different values/);
  assert.match(final, /answer under the standard convention of the field and state it/);
  assert.match(final, /correct under exactly that rearrangement of the convention/);
  assert.match(final, /exactly a reading the question does not exclude that would select a different alternative/);
  assert.match(final, /in the language of the user's question, starting with the answer/);
  assert.doesNotMatch(final, /SageMath:/);
});

test("the final prompt names each verifier whose result arrived as executed in this turn", () => {
  const plan = createAuthoritativeVerificationPlan({ verificationRequested: true, requiredTools: ["sage", "lean_check"] });
  plan.recordDispatch({ callId: "s1", toolName: "sage" });
  plan.recordResult({ callId: "s1" });
  plan.finishVerifier("sage", "verified");
  plan.finishVerifier("lean", "not_verified", "LEAN_CALL_NOT_COMPLETED");
  const final = plan.finalPrompt();
  assert.match(final, /SageMath: VERIFIED — executed in this turn/);
  assert.match(final, /Lean 4: NOT_VERIFIED \(LEAN_CALL_NOT_COMPLETED\)\n/);
});

test("the server writes the verifier status block; the model is told not to", () => {
  const plan = createAuthoritativeVerificationPlan({ verificationRequested: true, requiredTools: ["sage", "lean_check"] });
  plan.recordDispatch({ callId: "s1", toolName: "sage" });
  plan.recordResult({ callId: "s1" });
  plan.finishVerifier("sage", "verified");
  plan.finishVerifier("lean", "not_verified", "LEAN_GOAL_REJECTED_REPEATEDLY");
  assert.equal(plan.verificationReport(), [
    "\n\n---\n\n**Verifica (DS4 Studio)**\n",
    "- SageMath: VERIFICATO — eseguito in questo turno",
    "- Lean 4: NON VERIFICATO (LEAN_GOAL_REJECTED_REPEATEDLY)"
  ].join("\n"));
  assert.match(plan.finalPrompt(), /The server appends the status of each verifier under your answer: do not write status lines/);
});

test("the status block names the statement Lean proved", () => {
  const plan = createAuthoritativeVerificationPlan({ verificationRequested: true, requiredTools: ["lean_check"] });
  assert.equal(plan.recordLeanPreparation({ sealed: true, targetStatementSha256: "abc", targetDeclaration: "t",
    targetStatementText: "theorem t : 1 + 1 = 2", requiredProfile: "core" }), true);
  plan.finishVerifier("lean", "verified");
  assert.match(plan.verificationReport(), /- Enunciato dimostrato da Lean: `theorem t : 1 \+ 1 = 2`$/);
  assert.doesNotMatch(plan.verificationReport(), /SageMath/);
});
