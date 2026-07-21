/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md section 21.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: structured ledger events.
 */

export function summarizeEvolutionRun(run) {
  if (!run || !Array.isArray(run.events)) throw new TypeError("reconstructed run with events is required");
  const transitions = {};
  const eventCounts = {};
  const rejectionReasons = {};
  const revisions = new Set();
  let firstTimestamp = null;
  let lastTimestamp = null;
  for (const event of run.events) {
    eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
    if (event.revision > 0) revisions.add(event.revision);
    firstTimestamp ??= event.timestamp;
    lastTimestamp = event.timestamp;
    if (event.type === "STATE_TRANSITION") {
      const key = `${event.payload.from}->${event.payload.to}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
      if (event.payload.to === "REJECTED" || event.payload.to === "FAILED") {
        const reason = String(event.payload.reasonCode ?? "UNSPECIFIED");
        rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
      }
    }
  }
  const durationMs = firstTimestamp && lastTimestamp
    ? Math.max(0, Date.parse(lastTimestamp) - Date.parse(firstTimestamp))
    : 0;
  return Object.freeze({
    schema: "ds4_evolution_telemetry_v1",
    runId: run.runId,
    state: run.state,
    sequence: run.sequence,
    revisions: revisions.size,
    durationMs,
    eventCounts: Object.freeze(eventCounts),
    transitions: Object.freeze(transitions),
    rejectionReasons: Object.freeze(rejectionReasons),
    promotions: eventCounts.CANDIDATE_APPLIED ?? 0,
    rollbacks: eventCounts.ROLLBACK_COMPLETED ?? 0,
    infrastructureFailures: rejectionReasons.INFRASTRUCTURE_FAILURE ?? 0
  });
}
