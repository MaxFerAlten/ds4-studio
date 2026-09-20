import test from "node:test";
import assert from "node:assert/strict";
import { SEVERITY } from "./epistemicContracts.mjs";
import {
  MATH_CHECK_MARKER,
  MATH_VERDICT,
  buildValidationRequest,
  isSafeExpression,
  parseEquality,
  readSageOutcome,
  verifyMathClaim
} from "./epistemicMathVerifier.mjs";

/**
 * A Sage stand-in shaped like the authoritative result contract: a structured
 * execution block, a status, and the marker the generated snippet prints.
 */
function fakeSage(outcome, { status = "ok", ok = true, timedOut = false, exitCode = 0, isError = false } = {}) {
  return {
    calls: [],
    async run(args) {
      this.calls.push(args);
      return {
        content: outcome ? `${MATH_CHECK_MARKER}: ${outcome}\nDS4_MATH_DIFF: 2000*sqrt(31) - 11` : "no marker here",
        isError,
        runId: "run_1",
        sageResult: {
          contractVersion: "sage_result_v2",
          tool: "sage",
          status,
          state: "validated",
          runId: "run_1",
          execution: { ok, timedOut, exitCode },
          model: { content: outcome ? `${MATH_CHECK_MARKER}: ${outcome}` : "" },
          validation: { passed: outcome === "PASS", authoritative: true, checks: [], errors: [] }
        }
      };
    }
  };
}

test("EPI-002: a wrong ODE solution is refuted by Sage validation", async () => {
  // The claim asserts an ODE solution. Sage evaluates the difference and reports
  // FAIL (non-zero): the proposal is refuted, not downgraded and quietly kept.
  const out = await verifyMathClaim({
    claim: "y = x^2 + 1",
    kind: "symbolic",
    executeSage: (args) => fakeSage("FAIL").run(args)
  });
  assert.equal(out.verdict, MATH_VERDICT.REFUTED);
  assert.deepEqual(out.failureCodes, ["F06"]);
  assert.equal(out.maxEpistemicType, "HYPOTHESIS");
});

test("EPI-004: wrong scaling arithmetic is refuted, not accepted", async () => {
  const out = await verifyMathClaim({
    claim: "E = 2 * 1000 / 500",
    executeSage: (args) => fakeSage("FAIL").run(args)
  });
  assert.equal(out.verdict, MATH_VERDICT.REFUTED);
  assert.deepEqual(out.failureCodes, ["F05"]);
  assert.equal(out.maxEpistemicType, "HYPOTHESIS");
});

test("EPI-006: an invalid block shape presented as an equality is refuted", async () => {
  // A structural claim that the two block matrices are equal; Sage reports the
  // difference is non-zero, so it is refuted rather than accepted on shape alone.
  const out = await verifyMathClaim({
    claim: "A11 = A21",
    executeSage: (args) => fakeSage("FAIL").run(args)
  });
  assert.equal(out.verdict, MATH_VERDICT.REFUTED);
  assert.deepEqual(out.failureCodes, ["F05"]);
  assert.equal(out.maxEpistemicType, "HYPOTHESIS");
});

test("EPI-007: a symmetric/antisymmetric mismatch is a wrong equality and is refuted", async () => {
  // A claim that a matrix equals its transpose when it does not is an equality
  // Sage can evaluate; a non-zero difference is a refutation of the mismatch.
  const out = await verifyMathClaim({
    claim: "A = A^T",
    executeSage: (args) => fakeSage("FAIL").run(args)
  });
  assert.equal(out.verdict, MATH_VERDICT.REFUTED);
  assert.equal(out.maxEpistemicType, "HYPOTHESIS");
});

test("EPI-008: a negative derivative that contradicts conservation is refuted", async () => {
  // Conservation is dE/dt = 0; asserting a non-zero derivative as an equality
  // against zero is a wrong equality and is refuted by Sage validation.
  const out = await verifyMathClaim({
    claim: "dE/dt = -1",
    executeSage: (args) => fakeSage("FAIL").run(args)
  });
  assert.equal(out.verdict, MATH_VERDICT.REFUTED);
  assert.equal(out.maxEpistemicType, "HYPOTHESIS");
});

test("EPI-003: sqrt(124000000) = 11 is refuted, not accepted", async () => {  const sage = fakeSage("FAIL");
  const out = await verifyMathClaim({
    claim: "sqrt(124000000) = 11",
    executeSage: (args, opts) => sage.run(args, opts)
  });
  assert.equal(out.verdict, MATH_VERDICT.REFUTED);
  assert.deepEqual(out.failureCodes, ["F05"]);
  assert.equal(out.severity, SEVERITY.HIGH);
  // A refuted number cannot be published as a computed one.
  assert.equal(out.maxEpistemicType, "HYPOTHESIS");
  assert.equal(sage.calls[0].task_type, "validation");
  assert.equal(sage.calls[0].phase, "validate");
});

test("a passing check buys COMPUTED, and a symbolic one buys DERIVED", async () => {
  const numeric = await verifyMathClaim({
    claim: "sqrt(4) = 2",
    executeSage: (args) => fakeSage("PASS").run(args)
  });
  assert.equal(numeric.verdict, MATH_VERDICT.VERIFIED);
  assert.equal(numeric.maxEpistemicType, "COMPUTED");
  assert.deepEqual(numeric.failureCodes, []);

  const symbolic = await verifyMathClaim({
    lhs: "diff(sin(x)^2, x)",
    rhs: "sin(2*x)",
    kind: "symbolic",
    executeSage: (args) => fakeSage("PASS").run(args)
  });
  assert.equal(symbolic.maxEpistemicType, "DERIVED");

  const wrongSymbolic = await verifyMathClaim({
    lhs: "diff(sin(x)^2, x)",
    rhs: "cos(2*x)",
    kind: "symbolic",
    executeSage: (args) => fakeSage("FAIL").run(args)
  });
  assert.deepEqual(wrongSymbolic.failureCodes, ["F06"]);
});

test("without Sage the claim stays a hypothesis, never a model-produced result", async () => {
  const out = await verifyMathClaim({ claim: "sqrt(124000000) = 11", executeSage: null });
  // §32's fallback: UNKNOWN / HYPOTHESIS. Nothing checked it, and saying so is
  // the whole difference from EPI-003.
  assert.equal(out.verdict, MATH_VERDICT.UNKNOWN);
  assert.equal(out.maxEpistemicType, "HYPOTHESIS");
  assert.deepEqual(out.failureCodes, []);
  assert.match(out.reason, /Sage is not available/);
  // The request was still built, so a caller can run it once Sage is back.
  assert.match(out.request.code, /_ds4_diff = simplify/);
});

test("a run that did not happen is not a verdict", async () => {
  const cases = [
    [{ ok: false }, /no structured execution status/],
    [{ timedOut: true }, /timed out/],
    [{ status: "error" }, /no structured execution status/],
    [{ isError: true }, /no structured execution status/]
  ];
  for (const [flags, reason] of cases) {
    const out = await verifyMathClaim({
      claim: "sqrt(4) = 2",
      executeSage: (args) => fakeSage("PASS", flags).run(args)
    });
    assert.equal(out.verdict, MATH_VERDICT.UNKNOWN, JSON.stringify(flags));
    assert.match(out.reason, reason);
    assert.equal(out.maxEpistemicType, "HYPOTHESIS");
  }

  // Ran, but printed nothing readable: still not a verdict.
  const silent = await verifyMathClaim({
    claim: "sqrt(4) = 2",
    executeSage: (args) => fakeSage(null).run(args)
  });
  assert.equal(silent.verdict, MATH_VERDICT.UNKNOWN);
  assert.match(silent.reason, /reported no check result/);

  const threw = await verifyMathClaim({
    claim: "sqrt(4) = 2",
    executeSage: async () => {
      throw new Error("sage binary missing");
    }
  });
  assert.equal(threw.verdict, MATH_VERDICT.UNKNOWN);
  assert.match(threw.reason, /Sage execution failed: sage binary missing/);
});

test("the expression is a trust boundary, not a formatting concern", () => {
  assert.equal(isSafeExpression("sqrt(124000000)"), true);
  assert.equal(isSafeExpression("diff(sin(x)^2, x)"), true);
  // The expression is placed into code that a Sage process runs. It reaches
  // here from model output, so anything that could close a string, start a
  // statement or name a builtin is refused rather than escaped.
  assert.equal(isSafeExpression('1); import os; os.system("rm -rf /"); (1'), false);
  assert.equal(isSafeExpression("__import__('os')"), false);
  assert.equal(isSafeExpression("eval(x)"), false);
  assert.equal(isSafeExpression("1\nprint(2)"), false);
  assert.equal(isSafeExpression("x.__class__"), false);
  assert.equal(isSafeExpression(""), false);
  assert.equal(isSafeExpression("2".repeat(500)), false);

  assert.equal(buildValidationRequest({ lhs: "os.system(x)", rhs: "1" }), null);
  assert.equal(buildValidationRequest({ lhs: "1", rhs: "" }), null);
});

test("an unsafe expression is never sent to Sage", async () => {
  let called = false;
  const out = await verifyMathClaim({
    claim: 'sqrt(4) = 2; import os',
    executeSage: async () => {
      called = true;
      return {};
    }
  });
  assert.equal(called, false);
  assert.equal(out.verdict, MATH_VERDICT.UNKNOWN);
  assert.match(out.reason, /not a plain mathematical equality/);
});

test("only an asserted equality is checkable", () => {
  assert.deepEqual(parseEquality("sqrt(124000000) = 11"), { lhs: "sqrt(124000000)", rhs: "11" });
  assert.deepEqual(parseEquality("The value is 2 = 2."), { lhs: "The value is 2", rhs: "2" });
  // A comparison is not an assertion of equality and must not be read as one.
  assert.equal(parseEquality("x <= 11"), null);
  assert.equal(parseEquality("a == b"), null);
  assert.equal(parseEquality("x != 3"), null);
  assert.equal(parseEquality("no equality here"), null);
  assert.equal(parseEquality("= 11"), null);
});

test("the generated snippet asks Sage for a difference, not for an opinion", () => {
  const request = buildValidationRequest({ lhs: "sqrt(124000000)", rhs: "11", timeoutSec: 30 });
  assert.match(request.code, /_ds4_lhs = \(sqrt\(124000000\)\)/);
  assert.match(request.code, /_ds4_ok = bool\(_ds4_diff == 0\)/);
  assert.match(request.code, new RegExp(`print\\("${MATH_CHECK_MARKER}:"`));
  assert.equal(request.output_mode, "structured");
  assert.equal(request.timeout_sec, 30);
});

test("the outcome is read off the structured result", () => {
  const ok = readSageOutcome({
    isError: false,
    sageResult: {
      status: "ok",
      state: "validated",
      runId: "run_9",
      execution: { ok: true, timedOut: false, exitCode: 0 },
      model: { content: `${MATH_CHECK_MARKER}: PASS` }
    }
  });
  assert.equal(ok.ran, true);
  assert.equal(ok.outcome, "PASS");
  assert.equal(ok.runId, "run_9");
  assert.equal(ok.exitCode, 0);

  // A response with no structured execution block cannot be read as a run.
  const bare = readSageOutcome({ isError: false, content: `${MATH_CHECK_MARKER}: PASS` });
  assert.equal(bare.ran, false);
  assert.equal(bare.outcome, "PASS");
});

test("a run leaves tool evidence behind", async () => {
  const out = await verifyMathClaim({
    claim: "sqrt(4) = 2",
    executeSage: (args) => fakeSage("PASS").run(args)
  });
  assert.equal(out.evidence.toolName, "sage");
  assert.equal(out.evidence.status, "EXECUTED");
  assert.equal(out.evidence.sourceType, "TOOL_EXECUTION");
  assert.ok(out.evidence.sourceHash);
});
