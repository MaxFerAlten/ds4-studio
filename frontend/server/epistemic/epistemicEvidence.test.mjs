import test from "node:test";
import assert from "node:assert/strict";
import {
  TurnEvidence,
  evidenceFromToolResult,
  readExecutionStatus
} from "./epistemicEvidence.mjs";

test("execution status is read from structured fields only", () => {
  assert.equal(readExecutionStatus({ isError: true }).isError, true);
  assert.equal(readExecutionStatus({ ok: false }).isError, true);
  assert.equal(readExecutionStatus({ success: true }).isError, false);
  assert.equal(readExecutionStatus({ exitCode: 0 }).isError, false);
  assert.equal(readExecutionStatus({ exitCode: 1 }).isError, true);
  assert.equal(readExecutionStatus({ status: "checked" }).isError, false);
  assert.equal(readExecutionStatus({ status: "timeout" }).isError, true);
  assert.equal(readExecutionStatus({ error: "boom" }).isError, true);

  // Prose is not a status. A result that only says it worked has no structured
  // outcome, and the answer is "unknown", not "fine".
  assert.equal(readExecutionStatus({ content: "All tests passed successfully!" }), null);
  assert.equal(readExecutionStatus("everything worked"), null);
  assert.equal(readExecutionStatus(null), null);
  assert.equal(readExecutionStatus({}), null);
});

test("a failed tool produces failure evidence, not absence of evidence", () => {
  const ev = evidenceFromToolResult({
    callId: "call_1",
    toolName: "bash",
    arguments: { command: "pytest" },
    rawResult: { exitCode: 1, stdout: "3 failed" }
  });
  assert.equal(ev.isError, true);
  assert.equal(ev.status, "EXECUTION_FAILED");
  assert.equal(ev.evidenceType, "tool_execution");
  assert.equal(ev.exactResult, true);
  assert.equal(ev.toolName, "bash");
  assert.equal(ev.toolCallId, "call_1");
  assert.ok(ev.contentSummary.includes("3 failed"));
});

test("an unknown outcome is never reported as a success", () => {
  // This is the F04 shape: prose that reads like a passing run, with nothing
  // structured behind it.
  const ev = evidenceFromToolResult({
    callId: "call_2",
    toolName: "run_code",
    rawResult: { content: "Output:\n42\nWorks as expected." }
  });
  assert.equal(ev.status, "EXECUTED_STATUS_UNKNOWN");
  assert.equal(ev.isError, false);
  assert.deepEqual(ev.limitations, [
    "tool result carries no structured status; execution outcome is unknown"
  ]);
  // And it does not count as a successful execution.
  const turn = new TurnEvidence();
  turn.add(ev);
  assert.equal(turn.hasSuccessfulExecution("run_code"), false);
  assert.equal(turn.executed().length, 0);
  // Not a failure either: it is its own bucket.
  assert.equal(turn.failed().length, 0);
  assert.equal(turn.unknownOutcome().length, 1);
});

test("evidence identity is stable and derives from the result, not the prose", () => {
  const call = {
    callId: "call_3",
    toolName: "lean_check",
    arguments: { code: "theorem t : 1 = 1 := rfl", profile: "core" },
    rawResult: { status: "checked", content: "ok" }
  };
  const a = evidenceFromToolResult(call);
  // Argument key order must not change the execution identity.
  const b = evidenceFromToolResult({
    ...call,
    arguments: { profile: "core", code: "theorem t : 1 = 1 := rfl" }
  });
  assert.equal(a.executionId, b.executionId);
  assert.equal(a.sourceHash, b.sourceHash);
  // Different arguments, different execution.
  const c = evidenceFromToolResult({ ...call, arguments: { code: "other", profile: "core" } });
  assert.notEqual(a.executionId, c.executionId);
  // The hash covers the whole result, so ids differ when the result differs.
  const d = evidenceFromToolResult({ ...call, rawResult: { status: "checked", content: "other" } });
  assert.notEqual(a.sourceHash, d.sourceHash);
  assert.equal(a.sourceHash.length, 64);
});

test("the full result is hashed even when the summary is truncated", () => {
  const long = "x".repeat(9000);
  const a = evidenceFromToolResult({ callId: "c", toolName: "t", rawResult: { content: long + "A" } });
  const b = evidenceFromToolResult({ callId: "c", toolName: "t", rawResult: { content: long + "B" } });
  assert.equal(a.contentSummary.length, 4000);
  assert.equal(a.contentSummary, b.contentSummary);
  // Identical transcripts, different results: the digest still separates them.
  assert.notEqual(a.sourceHash, b.sourceHash);
});

test("TurnEvidence separates ran-and-worked from ran-and-failed", () => {
  const turn = new TurnEvidence();
  turn.addToolResult({ callId: "1", toolName: "bash", rawResult: { exitCode: 0, stdout: "ok" } });
  turn.addToolResult({ callId: "2", toolName: "bash", rawResult: { exitCode: 2, stdout: "boom" } });
  turn.addToolResult({ callId: "3", toolName: "web_fetch", rawResult: { ok: true, content: "page" } });

  assert.equal(turn.size, 3);
  assert.equal(turn.executed().length, 2);
  assert.equal(turn.failed().length, 1);
  assert.equal(turn.byTool("bash").length, 2);
  assert.equal(turn.hasSuccessfulExecution("bash"), true);
  assert.equal(turn.hasSuccessfulExecution("pytest"), false);

  const digest = turn.digest();
  assert.equal(digest.length, 3);
  assert.deepEqual(Object.keys(digest[0]).sort(), [
    "evidenceType",
    "executionId",
    "id",
    "isError",
    "sourceHash",
    "status",
    "toolCallId",
    "toolName"
  ]);
  // The digest is a record of what ran, not a copy of the evidence.
  assert.equal(digest[0].contentSummary, undefined);
  assert.equal(turn.add(null), null);
  assert.equal(turn.size, 3);
});

test("collection never breaks the tool call it observes", () => {
  // evidenceFromToolResult runs inside runToolCall, which gitnexus puts on ten
  // execution flows. A circular result used to reach a recursive serialiser.
  const circular = { name: "node" };
  circular.self = circular;
  const turn = new TurnEvidence();
  const ev = turn.addToolResult({ callId: "c", toolName: "graph", rawResult: circular });
  assert.ok(ev, "a circular result must still yield evidence");
  assert.ok(ev.contentSummary.includes("[circular]"));
  assert.equal(ev.sourceHash.length, 64);
  assert.equal(turn.dropped.length, 0);

  // Same for circular arguments.
  const args = { a: 1 };
  args.loop = args;
  assert.ok(turn.addToolResult({ callId: "c2", toolName: "graph", rawResult: { ok: true }, arguments: args }));

  // Values JSON cannot encode do not throw either.
  assert.ok(turn.addToolResult({ callId: "c3", toolName: "t", rawResult: { fn: () => 1, sym: Symbol("s") } }));
  assert.equal(turn.dropped.length, 0);
  assert.equal(turn.size, 3);
});

test("a collector failure is recorded, not swallowed", () => {
  const turn = new TurnEvidence();
  // A getter that throws is the one thing the collector cannot serialise.
  const hostile = { get content() { throw new Error("boom"); } };
  assert.equal(turn.addToolResult({ callId: "c", toolName: "t", rawResult: hostile }), null);
  assert.equal(turn.size, 0);
  assert.equal(turn.dropped.length, 1);
  assert.equal(turn.dropped[0].toolName, "t");
  assert.match(turn.dropped[0].reason, /boom/);
});
