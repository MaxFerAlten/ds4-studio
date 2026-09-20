/**
 * DS4 Quantum Fix — code and execution truth.
 *
 * QF-11 §33. "Working", "tested", "passed" are claims about something having
 * run. The only thing that can settle them is the tool record, and §33 is
 * explicit that the input is the tool result from the turn, never the
 * assistant's own account of it — prose describing a passing test suite is
 * indistinguishable from a passing test suite right up until someone checks.
 *
 * EPI-010 is the shape this blocks: no execution trace anywhere in the turn,
 * and a response that calls the code complete and working.
 */

import { FAILURE_SEVERITY, SEVERITY } from "./epistemicContracts.mjs";

export const EXECUTION_VERDICT = Object.freeze({
  /** The wording makes no claim about anything having run. */
  NOT_APPLICABLE: "NOT_APPLICABLE",
  /** Every execution claim has a matching tool record. */
  SUPPORTED: "SUPPORTED",
  /** An execution claim with no tool record behind it. */
  UNSUPPORTED: "UNSUPPORTED",
  /** A tool record exists and does not say what the claim says it says. */
  MISREPRESENTED: "MISREPRESENTED"
});

/**
 * The protected wording of §33, and what each kind of assertion owes.
 *
 * `assertsSuccess` separates "I ran it" from "it works": the first needs a run,
 * the second needs a run that succeeded. Both languages, as everywhere else in
 * this subsystem.
 */
export const EXECUTION_CLAIMS = Object.freeze([
  {
    category: "WORKING",
    pattern:
      /\b(working code|works correctly|fully working|complete and working|production[- ]ready|codice funzionante|funziona correttamente|completo e funzionante|pronto per la produzione)\b/i,
    requires: "execution_evidence",
    assertsSuccess: true
  },
  {
    category: "EXECUTED",
    pattern:
      /\b(i ran|we ran|ran the|i executed|we executed|executed the|ran successfully|ho eseguito|abbiamo eseguito|eseguito con successo)\b/i,
    requires: "execution_evidence",
    assertsSuccess: false
  },
  {
    category: "TESTED",
    pattern: /\b(tested|test suite|under test|testato|testata|sotto test)\b/i,
    requires: "test_evidence",
    assertsSuccess: false
  },
  {
    category: "PASSED",
    pattern:
      /\b(tests? (?:pass|passed|passes)|all tests pass|the suite is green|i test passano|test superati|suite verde)\b/i,
    requires: "test_evidence",
    assertsSuccess: true
  },
  {
    category: "BENCHMARK",
    pattern:
      /\b(benchmark(?:ed|s)?|benchmark shows|throughput of|latency of|tokens\/s|benchmark mostra)\b/i,
    requires: "benchmark_evidence",
    assertsSuccess: true
  }
]);

/** Commands that constitute running a test suite. */
const TEST_COMMAND =
  /\b(npm (?:run )?test|node --test|pytest|py\.test|cargo test|go test|ctest|make (?:check|test)|certify\w*|jest|mocha|vitest)\b|\.test\.mjs/i;

/** Commands that constitute a measurement rather than a run. */
const BENCHMARK_COMMAND = /\b(bench|benchmark\w*|hyperfine|perf stat|rocprof|nvprof|nsys)\b/i;

/**
 * The kinds of evidence one tool record can support.
 *
 * Derived from what was executed — the tool name and the command it was given —
 * and never from the output text. A run whose output happens to contain the
 * word "benchmark" did not become a benchmark.
 */
export function executionKinds(item) {
  if (!item || item.evidenceType !== "tool_execution") return [];
  const kinds = ["execution_evidence"];
  const command = String(item.command || "");
  if (TEST_COMMAND.test(command) || item.toolName === "lean_check") kinds.push("test_evidence");
  if (BENCHMARK_COMMAND.test(command)) kinds.push("benchmark_evidence");
  return kinds;
}

/** Which protected execution claims a passage makes. */
export function requiredExecutionEvidence(text) {
  const content = String(text ?? "");
  return EXECUTION_CLAIMS.flatMap((claimClass) => {
    const match = content.match(claimClass.pattern);
    if (!match) return [];
    const prefix = content.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
    if (/(?:\bnot|\bnever|\bdid\s+not|\bhave\s+not|\bnon)\s*$/i.test(prefix)) return [];
    return [{
      category: claimClass.category,
      match: match[0],
      requires: claimClass.requires,
      assertsSuccess: claimClass.assertsSuccess
    }];
  });
}

/**
 * Check a passage's execution claims against the turn's tool records.
 *
 * @param {object} options
 * @param {string|object} options.claim - the claim, or its text.
 * @param {object[]} [options.evidence] - tool_execution evidence items from this turn.
 * @returns {{verdict: string, block: boolean, failureCodes: string[], severity: number, reason: string, required: object[], findings: object[]}}
 */
export function verifyExecutionClaim({ claim, evidence = [] } = {}) {
  const text = String(typeof claim === "string" ? claim : (claim?.text ?? ""));
  const required = requiredExecutionEvidence(text);
  const items = Array.isArray(evidence) ? evidence.filter((i) => i?.evidenceType === "tool_execution") : [];

  if (required.length === 0) {
    return {
      verdict: EXECUTION_VERDICT.NOT_APPLICABLE,
      block: false,
      failureCodes: [],
      severity: SEVERITY.NONE,
      reason: "the passage claims nothing about anything having run",
      required,
      findings: []
    };
  }

  const findings = [];
  for (const requirement of required) {
    const candidates = items.filter((i) => executionKinds(i).includes(requirement.requires));
    if (candidates.length === 0) {
      // EPI-010. No record of a run anywhere in the turn, and a claim that
      // depends on one having happened.
      findings.push({ ...requirement, outcome: "NO_TRACE", failureCode: "F04", evidenceIds: [] });
      continue;
    }
    // `status === "EXECUTED"` and not `!isError`: a record whose outcome was
    // never reported is not a record of success (QF-03).
    const succeeded = candidates.filter((i) => i.status === "EXECUTED");
    if (requirement.assertsSuccess && succeeded.length === 0) {
      findings.push({
        ...requirement,
        outcome: candidates.some((i) => i.status === "EXECUTION_FAILED") ? "RAN_AND_FAILED" : "OUTCOME_UNKNOWN",
        // The tool ran and its result does not say what the claim says it
        // says. That is misrepresentation of a result, not absence of one.
        failureCode: "F22",
        evidenceIds: candidates.map((i) => i.id)
      });
      continue;
    }
    findings.push({
      ...requirement,
      outcome: "SATISFIED",
      failureCode: null,
      evidenceIds: (requirement.assertsSuccess ? succeeded : candidates).map((i) => i.id)
    });
  }

  const failures = findings.filter((f) => f.failureCode);
  if (failures.length === 0) {
    return {
      verdict: EXECUTION_VERDICT.SUPPORTED,
      block: false,
      failureCodes: [],
      severity: SEVERITY.NONE,
      reason: "every execution claim has a matching tool record",
      required,
      findings
    };
  }

  const failureCodes = [...new Set(failures.map((f) => f.failureCode))].sort();
  return {
    verdict: failures.some((f) => f.outcome === "NO_TRACE")
      ? EXECUTION_VERDICT.UNSUPPORTED
      : EXECUTION_VERDICT.MISREPRESENTED,
    // §68 lists EPI-010 as a release blocker, so this blocks rather than warns.
    block: true,
    failureCodes,
    severity: Math.max(...failureCodes.map((c) => FAILURE_SEVERITY[c] ?? SEVERITY.CRITICAL)),
    reason: failures
      .map((f) =>
        f.outcome === "NO_TRACE"
          ? `"${f.match}" claims ${f.requires} and no tool in this turn produced any`
          : `"${f.match}" asserts success, and the matching tool record does not report one`
      )
      .join("; "),
    required,
    findings
  };
}
