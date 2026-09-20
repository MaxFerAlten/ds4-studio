import test from "node:test";
import assert from "node:assert/strict";
import { SEVERITY } from "./epistemicContracts.mjs";
import { TurnEvidence, evidenceFromToolResult } from "./epistemicEvidence.mjs";
import {
  EXECUTION_VERDICT,
  executionKinds,
  requiredExecutionEvidence,
  verifyExecutionClaim
} from "./epistemicExecutionVerifier.mjs";

/** A tool record in the shape index.mjs hands to addToolResult. */
function bashResult(command, exitCode) {
  return evidenceFromToolResult({
    callId: `call_${command.length}`,
    toolName: "bash",
    arguments: { command },
    rawResult: {
      content: exitCode === 0 ? "ok" : `exit code: ${exitCode}`,
      isError: exitCode !== 0,
      raw: { exit_code: exitCode }
    }
  });
}

test("EPI-010: complete and working with no execution trace is blocked", () => {
  const out = verifyExecutionClaim({
    claim: "The implementation is complete and working.",
    evidence: []
  });
  assert.equal(out.verdict, EXECUTION_VERDICT.UNSUPPORTED);
  assert.equal(out.block, true);
  assert.deepEqual(out.failureCodes, ["F04"]);
  assert.equal(out.severity, SEVERITY.HIGH);
  assert.match(out.reason, /no tool in this turn produced any/);
});

test("a passing suite needs a test command that actually passed", () => {
  const passing = verifyExecutionClaim({
    claim: "All tests pass.",
    evidence: [bashResult("npm test", 0)]
  });
  assert.equal(passing.verdict, EXECUTION_VERDICT.SUPPORTED);
  assert.equal(passing.block, false);
  assert.equal(passing.findings[0].evidenceIds.length, 1);

  // The suite ran and failed. That is a tool record saying the opposite of the
  // claim, not the absence of one.
  const failing = verifyExecutionClaim({
    claim: "All tests pass.",
    evidence: [bashResult("npm test", 1)]
  });
  assert.equal(failing.verdict, EXECUTION_VERDICT.MISREPRESENTED);
  assert.deepEqual(failing.failureCodes, ["F22"]);
  assert.equal(failing.findings[0].outcome, "RAN_AND_FAILED");

  // A run of something that is not a test suite does not make the claim true.
  const unrelated = verifyExecutionClaim({
    claim: "All tests pass.",
    evidence: [bashResult("ls -la", 0)]
  });
  assert.equal(unrelated.verdict, EXECUTION_VERDICT.UNSUPPORTED);
  assert.deepEqual(unrelated.failureCodes, ["F04"]);
});

test("a result whose outcome was never reported is not a success", () => {
  const unknown = evidenceFromToolResult({
    callId: "c1",
    toolName: "bash",
    arguments: { command: "npm test" },
    // No isError, no exit code: nothing reported an outcome.
    rawResult: { content: "everything looks fine to me" }
  });
  assert.equal(unknown.status, "EXECUTED_STATUS_UNKNOWN");
  const out = verifyExecutionClaim({ claim: "All tests pass.", evidence: [unknown] });
  assert.equal(out.verdict, EXECUTION_VERDICT.MISREPRESENTED);
  assert.equal(out.findings[0].outcome, "OUTCOME_UNKNOWN");
  assert.deepEqual(out.failureCodes, ["F22"]);
});

test("claiming to have run something needs a run, not a successful one", () => {
  // "I ran it" is satisfied by a run that failed: the claim is about the run.
  const ran = verifyExecutionClaim({
    claim: "I ran the migration script.",
    evidence: [bashResult("./migrate.sh", 3)]
  });
  assert.equal(ran.verdict, EXECUTION_VERDICT.SUPPORTED);
  assert.equal(ran.required[0].assertsSuccess, false);

  // "It works" is not.
  const works = verifyExecutionClaim({
    claim: "The migration script works correctly.",
    evidence: [bashResult("./migrate.sh", 3)]
  });
  assert.equal(works.verdict, EXECUTION_VERDICT.MISREPRESENTED);
  assert.equal(works.block, true);
});

test("evidence kind comes from what was run, not from the output", () => {
  assert.deepEqual(executionKinds(bashResult("ls", 0)), ["execution_evidence"]);
  assert.deepEqual(executionKinds(bashResult("node --test x.mjs", 0)), [
    "execution_evidence",
    "test_evidence"
  ]);
  assert.deepEqual(executionKinds(bashResult("hyperfine ./a", 0)), [
    "execution_evidence",
    "benchmark_evidence"
  ]);

  // A run whose output mentions a benchmark is not a benchmark.
  const talksAboutBench = evidenceFromToolResult({
    callId: "c9",
    toolName: "bash",
    arguments: { command: "cat notes.md" },
    rawResult: { content: "the benchmark shows 4200 tokens/s", isError: false, raw: { exit_code: 0 } }
  });
  assert.deepEqual(executionKinds(talksAboutBench), ["execution_evidence"]);

  // A source document is not an execution record at all.
  assert.deepEqual(executionKinds({ evidenceType: "source_document", command: "npm test" }), []);
  assert.deepEqual(executionKinds(null), []);
});

test("the execution record is read off the call, not off the prose", () => {
  const item = bashResult("npm test -- --coverage", 2);
  // §33's evidence shape: what was asked, and how the process ended.
  assert.equal(item.toolName, "bash");
  assert.equal(item.command, "npm test -- --coverage");
  assert.equal(item.exitCode, 2);
  assert.equal(item.isError, true);
  assert.equal(item.status, "EXECUTION_FAILED");
  assert.ok(item.sourceHash);
  assert.ok(item.retrievedAt);

  // An absent exit code stays absent. Defaulting it to 0 would turn a tool
  // that never started into a successful run.
  const noStart = evidenceFromToolResult({
    callId: "c2",
    toolName: "bash",
    arguments: { command: "x" },
    rawResult: { content: "bash: command is required", isError: true }
  });
  assert.equal(noStart.exitCode, null);

  // Sage reports its exit code inside the structured contract.
  const sage = evidenceFromToolResult({
    callId: "c3",
    toolName: "sage",
    arguments: { code: "print(1)" },
    rawResult: { isError: false, sageResult: { execution: { ok: true, exitCode: 0 } } }
  });
  assert.equal(sage.command, "print(1)");
  assert.equal(sage.exitCode, 0);
});

test("prose that claims nothing about running is left alone", () => {
  const out = verifyExecutionClaim({
    claim: "This module maps a criticism onto the claims it contests.",
    evidence: []
  });
  assert.equal(out.verdict, EXECUTION_VERDICT.NOT_APPLICABLE);
  assert.equal(out.block, false);
  assert.deepEqual(out.required, []);
  assert.deepEqual(verifyExecutionClaim({}).failureCodes, []);
});

test("explicitly negated execution wording is not an execution claim", () => {
  for (const claim of [
    "I have not tested this draft.",
    "This is not working code.",
    "È una bozza: non ho eseguito il codice né i test."
  ]) {
    const result = verifyExecutionClaim({ claim, evidence: [] });
    assert.equal(result.verdict, EXECUTION_VERDICT.NOT_APPLICABLE, claim);
    assert.equal(result.block, false, claim);
  }
});

test("both languages are covered", () => {
  const italian = requiredExecutionEvidence("Il codice è completo e funzionante e i test passano.");
  assert.deepEqual(
    italian.map((r) => r.category).sort(),
    ["PASSED", "WORKING"]
  );
  const english = requiredExecutionEvidence("The code is production-ready and benchmarked.");
  assert.deepEqual(english.map((r) => r.category).sort(), ["BENCHMARK", "WORKING"]);
});

test("several claims in one passage are each answered", () => {
  const evidence = new TurnEvidence();
  evidence.add(bashResult("npm test", 0));
  const out = verifyExecutionClaim({
    claim: "All tests pass and the benchmark shows 4200 tokens/s.",
    evidence: evidence.items
  });
  // The suite is covered; the benchmark is not, and one satisfied claim does
  // not carry the other.
  assert.equal(out.block, true);
  assert.equal(out.findings.find((f) => f.category === "PASSED").outcome, "SATISFIED");
  assert.equal(out.findings.find((f) => f.category === "BENCHMARK").outcome, "NO_TRACE");
  assert.deepEqual(out.failureCodes, ["F04"]);
});
