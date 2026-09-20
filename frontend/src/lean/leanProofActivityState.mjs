// Client-side reading of the agent_lean_status SSE stream.
//
// Pure reducer + presenter: no React, no fetch, so the rules below are testable
// without a DOM. What it must never do is show anything the model *thought* —
// only what the orchestrator measured. Chain-of-thought stays server-side.

/** State ids the server can send, mapped to what an operator should read. */
const STATE_COPY = Object.freeze({
  idle: { label: "In attesa", tone: "" },
  checking: { label: "Verifica in corso", tone: "" },
  repair_required: { label: "Correzione autonoma in corso", tone: "warn" },
  strategy_change_required: { label: "Cambio di strategia in corso", tone: "warn" },
  verified: { label: "VERIFIED", tone: "ok" },
  infrastructure_block: { label: "NOT VERIFIED — runtime non disponibile", tone: "bad" },
  budget_exhausted: { label: "NOT VERIFIED — budget esaurito", tone: "bad" },
  cancelled: { label: "NOT VERIFIED — annullato", tone: "bad" }
});

/** Human-readable reason per failure class. Short: this is a badge, not a log. */
const FAILURE_COPY = Object.freeze({
  syntax: "errore di sintassi",
  unknown_identifier: "identificatore o import sconosciuto",
  rewrite_miss: "riscrittura non applicabile",
  unsolved_goals: "goal residui",
  type_mismatch: "tipo non compatibile",
  timeout_repairable: "timeout: candidato troppo pesante",
  proof_failure: "dimostrazione non accettata",
  infrastructure: "runtime Lean non utilizzabile",
  contract: "richiesta fuori contratto",
  user_cancelled: "annullato dall'utente",
  transport: "backend non raggiungibile"
});

const TERMINAL_STATES = Object.freeze([
  "verified",
  "infrastructure_block",
  "budget_exhausted",
  "cancelled"
]);

/**
 * Fold one agent_lean_status event into the activity for its proof task.
 *
 * @param {object|null} previous - Activity built so far, or null
 * @param {object} event - agent_lean_status payload
 * @returns {object} New activity (never mutates `previous`)
 */
export function applyLeanStatus(previous, event = {}) {
  const base = previous || {
    proofId: event.proofId || null,
    state: "idle",
    attempt: 0,
    maxAttempts: event.maxAttempts || 0,
    profile: event.profile || "core",
    failureClass: null,
    strategyChangeRequired: false,
    verified: false,
    terminalReason: null,
    summary: "",
    history: []
  };

  const next = {
    ...base,
    proofId: event.proofId || base.proofId,
    state: event.state || base.state,
    attempt: Number.isInteger(event.attempt) ? event.attempt : base.attempt,
    maxAttempts: Number.isInteger(event.maxAttempts) ? event.maxAttempts : base.maxAttempts,
    profile: event.profile || base.profile,
    failureClass: event.failureClass ?? base.failureClass,
    strategyChangeRequired:
      event.strategyChangeRequired === undefined
        ? base.strategyChangeRequired
        : Boolean(event.strategyChangeRequired),
    verified: event.verified === undefined ? base.verified : Boolean(event.verified),
    terminalReason: event.terminalReason ?? base.terminalReason,
    summary: event.summary || base.summary
  };

  // One history entry per attempt outcome, so the card can show the repair
  // chain without the model narrating it.
  if (event.state && event.state !== base.state) {
    next.history = [
      ...base.history,
      { state: event.state, attempt: next.attempt, failureClass: next.failureClass }
    ];
  }
  return next;
}

/**
 * Presentation props for the card. Returns null when there is nothing to show.
 *
 * @param {object|null} activity
 * @returns {object|null}
 */
export function leanProofActivityProps(activity) {
  if (!activity || !activity.proofId) return null;

  const copy = STATE_COPY[activity.state] || STATE_COPY.idle;
  const terminal = TERMINAL_STATES.includes(activity.state);
  const detailParts = [];
  if (activity.attempt > 0 && activity.maxAttempts > 0) {
    detailParts.push(`tentativo ${activity.attempt}/${activity.maxAttempts}`);
  }
  if (activity.profile) detailParts.push(`profilo ${activity.profile}`);
  if (!activity.verified && activity.failureClass) {
    detailParts.push(FAILURE_COPY[activity.failureClass] || activity.failureClass);
  }
  if (activity.strategyChangeRequired && !terminal) {
    detailParts.push("cambio di strategia richiesto");
  }

  return {
    proofId: activity.proofId,
    label: copy.label,
    tone: copy.tone,
    // The badge is the contract in one word: only a checked run says VERIFIED.
    badge: activity.verified ? "VERIFIED" : terminal ? "NOT VERIFIED" : null,
    detail: detailParts.join(" · "),
    // The server's own one-line summary. It never carries reasoning, only the
    // decision, so it is safe to render verbatim.
    summary: activity.summary || "",
    terminalReason: terminal && !activity.verified ? activity.terminalReason : null,
    inProgress: !terminal,
    attempts: activity.history.map((h, index) => ({
      id: `${activity.proofId}-${index}`,
      attempt: h.attempt,
      state: h.state,
      label: (STATE_COPY[h.state] || STATE_COPY.idle).label,
      detail: h.failureClass ? FAILURE_COPY[h.failureClass] || h.failureClass : ""
    }))
  };
}
