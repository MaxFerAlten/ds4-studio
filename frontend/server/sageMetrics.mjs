// Sage orchestration observability (fase S14 del piano).
//
// The question these counters answer is not "how many sage calls ran" — that
// number was already there and it hid the defect. It is "does a repairable
// failure converge": how many candidate revisions a run needed, how many
// revalidations followed a repair, how often the loop had to force a strategy
// change, and how many runs ended NOT_PUBLISHABLE and why.
//
// A run is counted once, on the first transition that names its runId, and its
// outcome once, when it turns terminal — so a run can never land in both
// publishable and not_publishable.
//
// Nothing here may carry Sage source, stdout, stderr or host paths (§28.13):
// only state names, reason codes and counts.

import { SAGE_TERMINAL_STATES } from "./sageTurnTracker.mjs";

/** Classes the classifier uses for "this ran, nothing is wrong yet". */
const NON_FAILURE_CLASSES = new Set(["success_publishable", "pending_validation"]);

/** Counters an orchestration consumer may record directly, outside a run. */
export const SAGE_ORCHESTRATION_COUNTERS = Object.freeze([
  "sage_premature_finalizations_blocked_total",
  "sage_phase_rejected_total",
  "sage_candidate_unchanged_rejected_total"
]);

/**
 * Build the audit event for one orchestration transition (§18).
 *
 * @param {object} before - tracker snapshot before the call/result
 * @param {object} after - tracker snapshot after it
 * @param {string} [reasonCode] - why the transition happened
 * @returns {object|null} null when nothing actually moved
 */
export function sageTransitionEvent(before = {}, after = {}, reasonCode = null) {
  const from = before?.state ?? null;
  const to = after?.state ?? null;
  if (!after?.runId) return null;
  if (from === to && (before?.candidateRevision ?? 0) === (after?.candidateRevision ?? 0)) {
    return null;
  }
  return {
    type: "sage_orchestration",
    runId: String(after.runId),
    from,
    to,
    candidateRevision: after.candidateRevision ?? 0,
    validatedRevision: after.validatedRevision ?? null,
    reasonCode: reasonCode || after.terminalReason || after.failureClass || "STATE_CHANGED",
    failureClass: after.failureClass ?? null,
    // The tracker keeps the last class and the strategy flag until something
    // replaces them, so a later transition still carries them. Counting on the
    // raw value would tally the same failure once per transition; these say
    // whether *this* transition is the one that produced it.
    failureClassChanged: (before?.failureClass ?? null) !== (after?.failureClass ?? null),
    strategyChangeStarted: !before?.strategyChangeRequired && Boolean(after?.strategyChangeRequired),
    strategyChangeRequired: Boolean(after.strategyChangeRequired),
    terminal: SAGE_TERMINAL_STATES.includes(to),
    publishable: to === "ready"
  };
}

/**
 * In-memory counters. Reset on restart; a health signal, not billing.
 *
 * @returns {{record: Function, recordOrchestration: Function, snapshot: Function}}
 */
export function createSageMetrics() {
  const counters = {
    sage_runs_total: 0,
    sage_publishable_total: 0,
    sage_not_publishable_total: 0,
    sage_candidate_revisions_total: 0,
    sage_repair_total: 0,
    sage_revalidation_total: 0,
    sage_strategy_changes_total: 0,
    sage_premature_finalizations_blocked_total: 0,
    sage_phase_rejected_total: 0,
    sage_candidate_unchanged_rejected_total: 0,
    sage_budget_exhausted_total: 0
  };
  const failureClasses = Object.create(null);
  const seenRuns = new Set();
  const settledRuns = new Set();
  // Highest revision seen per run: revisions are counted as they appear, so a
  // repeated event for the same revision cannot inflate the total.
  const revisionSeen = new Map();
  // Completed validations per run, so a second pass over the same candidate is
  // recognised as a revalidation even when the revision number did not move.
  const validationsSeen = new Map();

  return {
    record(event) {
      if (!event || event.type !== "sage_orchestration" || !event.runId) return;

      if (!seenRuns.has(event.runId)) {
        seenRuns.add(event.runId);
        counters.sage_runs_total += 1;
      }

      const highest = revisionSeen.get(event.runId) ?? 0;
      if (event.candidateRevision > highest) {
        counters.sage_candidate_revisions_total += event.candidateRevision - highest;
        revisionSeen.set(event.runId, event.candidateRevision);
        // Every revision past the first came from a repair.
        if (highest > 0) counters.sage_repair_total += event.candidateRevision - highest;
      }

      // A validation that finished (from=validating) is a revalidation when it
      // is not the run's first one, or when the candidate has already been
      // repaired. That is the behaviour the whole plan exists to make possible:
      // the loop went back and checked a candidate it had already touched.
      if (event.from === "validating") {
        const done = validationsSeen.get(event.runId) ?? 0;
        validationsSeen.set(event.runId, done + 1);
        if (done > 0 || event.candidateRevision > 1) counters.sage_revalidation_total += 1;
      }

      if (event.strategyChangeStarted) counters.sage_strategy_changes_total += 1;
      if (event.failureClass && event.failureClassChanged &&
          !NON_FAILURE_CLASSES.has(event.failureClass)) {
        failureClasses[event.failureClass] = (failureClasses[event.failureClass] || 0) + 1;
      }
      if (event.to === "budget_exhausted") counters.sage_budget_exhausted_total += 1;

      if (event.terminal && !settledRuns.has(event.runId)) {
        settledRuns.add(event.runId);
        if (event.publishable) counters.sage_publishable_total += 1;
        else counters.sage_not_publishable_total += 1;
      }
    },

    /** Decisions taken outside a run: a blocked finalization, a refused phase. */
    recordOrchestration(counter, delta = 1) {
      if (!Object.prototype.hasOwnProperty.call(counters, counter)) return;
      counters[counter] += delta;
    },

    snapshot() {
      return {
        ...counters,
        sage_failure_class_total: { ...failureClasses }
      };
    }
  };
}
