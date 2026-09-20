import test from "node:test";
import assert from "node:assert/strict";

import {
  SUBCHECK_AGGREGATE_STATUS,
  aggregateSubchecks
} from "./epistemicSubcheckAggregator.mjs";
import { MATH_CHECK_MARKER, verifyMathClaim } from "./epistemicMathVerifier.mjs";

const check = (id, status, mandatory = true) => ({ id, status, mandatory });

// A real Sage fixture: the production math verifier emits REAL subchecks (one
// atomic equality check per run, per REM-014.4), and the aggregate reflects the
// run. This is the specific, non-tautological test REM-014.5 demands — the
// subcheck comes from a production verifier, not from a hand-built assumption.
test("REM-014: a known Sage fixture emits a real subcheck aggregated to coverage 1.0", async () => {
  const out = await verifyMathClaim({
    claim: { text: "sqrt(4) = 2", domain: "GENERAL" },
    kind: "numeric",
    executeSage: async () => ({
      content: `${MATH_CHECK_MARKER}: PASS`,
      isError: false,
      runId: "run_pass",
      sageResult: {
        status: "ok",
        state: "validated",
        runId: "run_pass",
        execution: { ok: true, timedOut: false, exitCode: 0 }
      }
    })
  });
  assert.equal(out.verdict, "VERIFIED");
  assert.equal(out.subchecks.length, 1, "one atomic equality -> one real subcheck");
  assert.equal(out.subchecks[0].mandatory, true);
  assert.equal(out.subchecks[0].status, "PASSED");
  const aggregate = aggregateSubchecks(out.subchecks);
  assert.equal(aggregate.status, SUBCHECK_AGGREGATE_STATUS.PASSED);
  assert.equal(aggregate.coverage, 1);
  assert.equal(aggregate.passedChecks, 1);
});

test("REM-014: a refuted Sage fixture exposes the failed subcheck, never a clean pass", async () => {
  const out = await verifyMathClaim({
    claim: { text: "2 + 2 = 5", domain: "GENERAL" },
    kind: "numeric",
    executeSage: async () => ({
      content: `${MATH_CHECK_MARKER}: FAIL`,
      isError: false,
      runId: "run_fail",
      sageResult: {
        status: "ok",
        state: "validated",
        runId: "run_fail",
        execution: { ok: true, timedOut: false, exitCode: 0 }
      }
    })
  });
  assert.equal(out.verdict, "REFUTED");
  assert.equal(out.subchecks[0].status, "FAILED");
  const aggregate = aggregateSubchecks(out.subchecks);
  assert.equal(aggregate.status, SUBCHECK_AGGREGATE_STATUS.FAILED);
  assert.equal(aggregate.failedChecks, 1);
  assert.deepEqual(aggregate.failureCodes, ["F29"]);
});

test("REM-014: an inconclusive Sage run emits no subchecks (nothing to claim verified)", async () => {
  const out = await verifyMathClaim({
    claim: { text: "sqrt(4) = 2", domain: "GENERAL" },
    kind: "numeric",
    executeSage: null
  });
  assert.equal(out.verdict, "UNKNOWN");
  assert.equal(out.subchecks, null, "no invented subchecks when the tool offers no granularity");
});

test("mandatory aggregation table never hides an inconclusive or failed check", () => {
  const cases = [
    [[check("a", "PASSED")], SUBCHECK_AGGREGATE_STATUS.PASSED],
    [[check("a", "PASSED"), check("b", "PASSED")], SUBCHECK_AGGREGATE_STATUS.PASSED],
    [[check("a", "PASSED"), check("b", "UNKNOWN")], SUBCHECK_AGGREGATE_STATUS.UNKNOWN],
    [[check("a", "PASSED"), check("b", "MISSING")], SUBCHECK_AGGREGATE_STATUS.UNKNOWN],
    [[check("a", "PASSED"), check("b", "ERROR")], SUBCHECK_AGGREGATE_STATUS.FAILED],
    [[check("a", "PASSED"), check("b", "FAILED")], SUBCHECK_AGGREGATE_STATUS.FAILED],
    [[check("a", "UNKNOWN")], SUBCHECK_AGGREGATE_STATUS.UNKNOWN],
    [[], SUBCHECK_AGGREGATE_STATUS.UNKNOWN]
  ];
  for (const [checks, expected] of cases) {
    assert.equal(aggregateSubchecks(checks).status, expected, JSON.stringify(checks));
  }
});

test("mandatory failure and error remain visible in the summary", () => {
  const out = aggregateSubchecks([
    check("passed", "PASSED"),
    check("failed", "FAILED"),
    check("errored", "ERROR")
  ]);
  assert.equal(out.failedChecks, 1);
  assert.equal(out.errorChecks, 1);
  assert.equal(out.mandatoryFailedOrMissing, 2);
  assert.deepEqual(out.failureCodes, ["F29"]);
});

test("optional omission does not defeat complete mandatory coverage", () => {
  const out = aggregateSubchecks([
    check("mandatory", "PASSED"),
    check("optional", "MISSING", false)
  ]);
  assert.equal(out.status, SUBCHECK_AGGREGATE_STATUS.PASSED);
  assert.equal(out.coverage, 1);
});

test("optional error reports PARTIAL without hiding mandatory success", () => {
  const out = aggregateSubchecks([
    check("mandatory", "PASSED"),
    check("optional", "ERROR", false)
  ]);
  assert.equal(out.status, SUBCHECK_AGGREGATE_STATUS.PARTIAL);
  assert.equal(out.mandatoryFailedOrMissing, 0);
  assert.equal(out.errorChecks, 1);
});

test("missing status is MISSING and duplicate IDs are rejected", () => {
  const out = aggregateSubchecks([{ id: "not-run", mandatory: true }]);
  assert.equal(out.status, SUBCHECK_AGGREGATE_STATUS.UNKNOWN);
  assert.equal(out.missingChecks, 1);
  assert.throws(
    () => aggregateSubchecks([check("same", "PASSED"), check("same", "PASSED")]),
    /IDs must be unique/
  );
});

test("EPI-062: an UNKNOWN subcheck qualifies the output, never a clean pass", () => {
  // One mandatory subcheck came back UNKNOWN (not run / no verdict). The aggregate
  // is UNKNOWN with coverage < 1, so downstream the object cannot be read as fully
  // verified — any output worded as a clean pass is not supported.
  const out = aggregateSubchecks([check("verified-part", "PASSED"), check("other-part", "UNKNOWN")]);
  assert.equal(out.status, SUBCHECK_AGGREGATE_STATUS.UNKNOWN);
  assert.equal(out.mandatoryFailedOrMissing, 1);
  assert.equal(out.coverage, 0.5);
  assert.deepEqual(out.failureCodes, ["F29"]);
});

test("aggregated data is immutable", () => {
  const out = aggregateSubchecks([check("a", "PASSED")]);
  assert.equal(Object.isFrozen(out), true);
  assert.equal(Object.isFrozen(out.checks[0]), true);
  assert.throws(() => out.checks.push(check("b", "PASSED")), TypeError);
});
