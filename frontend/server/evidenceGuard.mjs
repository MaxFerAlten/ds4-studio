/* Evidence-First runtime ledger in JS: a 1:1 port of
 * ds4_agent_evidence_guard.c/.h (shadow tree).  Reason codes, state machine,
 * scanner, rendering and the DS4_EVIDENCE_STATE_V1 text format follow the C
 * line for line; conformance is checked against the C module through
 * tests/fixtures/conformance/evidence/*.ops.
 */
import { loadAgentText } from "./agentText.mjs";

export const EVIDENCE_MAX_FINDINGS = 64;
export const EVIDENCE_MAX_REPAIR_ROUNDS = 2;
export const EVIDENCE_SKILL_NAME = "evidence-first-analysis";

export const CHECK = {
  FULL_CONTROL_FLOW: 1 << 0,
  CALLER: 1 << 1,
  WRAPPER_OR_OUTER_GUARD: 1 << 2,
  UPSTREAM_VALIDATION: 1 << 3,
  LIFETIME: 1 << 4,
  CLEANUP_ERROR_PATH: 1 << 5,
  COUNTEREVIDENCE: 1 << 6,
  REACHABILITY: 1 << 7,
  DYNAMIC_REPRODUCTION: 1 << 8,
};
export const CHECK_ALL = 0x1ff;

export const MODE = { OFF: 0, SHADOW: 1, BLOCK: 2 };
export const FINDING_STATE = {
  CANDIDATE: 0, SUPPORTED: 1, CONFIRMED: 2, CONDITIONAL: 3, DISPROVED: 4, UNKNOWN: 5,
};
export const SEVERITY = { NONE: 0, HARDENING: 1, LOW: 2, MEDIUM: 3, HIGH: 4, CRITICAL: 5 };
export const REACHABILITY = { UNKNOWN: 0, CONDITIONAL: 1, PROVEN: 2, NOT_REACHABLE: 3 };
export const CATEGORY = { GENERAL: 0, CONCURRENCY: 1, LIFETIME: 2, CLEANUP: 3, VALIDATION: 4 };
export const SIDE = { FOR: 0, AGAINST: 1 };
export const CHECK_RESULT = { DONE: 0, NOT_APPLICABLE: 1, UNKNOWN: 2 };

/* Reason codes (ds4_agent_evidence_guard.h:176-204). */
export const CODES = {
  OK: "EVIDENCE_OK",
  NO_COUNTEREVIDENCE_SEARCH: "EVIDENCE_NO_COUNTEREVIDENCE_SEARCH",
  NO_EVIDENCE_FOR: "EVIDENCE_NO_EVIDENCE_FOR",
  CONTROL_FLOW_UNCHECKED: "EVIDENCE_CONTROL_FLOW_UNCHECKED",
  CALLER_UNCHECKED: "EVIDENCE_CALLER_UNCHECKED",
  SPECIFIC_CHECK_UNRESOLVED: "EVIDENCE_SPECIFIC_CHECK_UNRESOLVED",
  DYNAMIC_STATUS_UNSET: "EVIDENCE_DYNAMIC_STATUS_UNSET",
  REACHABILITY_UNCHECKED: "EVIDENCE_REACHABILITY_UNCHECKED",
  REACHABILITY_UNKNOWN: "EVIDENCE_REACHABILITY_UNKNOWN",
  HIGH_REQUIRES_CONFIRMED: "EVIDENCE_HIGH_REQUIRES_CONFIRMED",
  HIGH_REQUIRES_REACHABLE: "EVIDENCE_HIGH_REQUIRES_REACHABLE",
  CONDITIONAL_SEVERITY_CAP: "EVIDENCE_CONDITIONAL_SEVERITY_CAP",
  DISPROVED_IN_REPORT: "EVIDENCE_DISPROVED_IN_REPORT",
  DISPROVED_SEVERITY: "EVIDENCE_DISPROVED_SEVERITY",
  FINALIZE_STALE: "EVIDENCE_FINALIZE_STALE",
  NOT_FINALIZED: "EVIDENCE_NOT_FINALIZED",
  UNKNOWN_FINDING: "EVIDENCE_UNKNOWN_FINDING",
  DUPLICATE_FINDING: "EVIDENCE_DUPLICATE_FINDING",
  LEDGER_FULL: "EVIDENCE_LEDGER_FULL",
  BAD_ID: "EVIDENCE_BAD_ID",
  BAD_ARGUMENT: "EVIDENCE_BAD_ARGUMENT",
  NA_REQUIRES_REASON: "EVIDENCE_NA_REQUIRES_REASON",
  CHECK_NOT_WAIVABLE: "EVIDENCE_CHECK_NOT_WAIVABLE",
  REPORT_UNKNOWN_ID: "EVIDENCE_REPORT_UNKNOWN_ID",
  REPORT_MISSING_FINDING: "EVIDENCE_REPORT_MISSING_FINDING",
  REPORT_DISPROVED_AS_FINDING: "EVIDENCE_REPORT_DISPROVED_AS_FINDING",
  REPORT_STATE_MISMATCH: "EVIDENCE_REPORT_STATE_MISMATCH",
  REPORT_SEVERITY_MISMATCH: "EVIDENCE_REPORT_SEVERITY_MISMATCH",
  REPORT_REACHABILITY_MISMATCH: "EVIDENCE_REPORT_REACHABILITY_MISMATCH",
};

const MODE_NAMES = ["off", "shadow", "block"];
const STATE_NAMES = ["CANDIDATE", "SUPPORTED", "CONFIRMED", "CONDITIONAL", "DISPROVED", "UNKNOWN"];
const SEVERITY_NAMES = ["NONE", "HARDENING", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const REACH_NAMES = ["UNKNOWN", "CONDITIONAL", "PROVEN", "NOT_REACHABLE"];
const CATEGORY_NAMES = ["general", "concurrency", "lifetime", "cleanup", "validation"];
const CHECKS = [
  ["control_flow", CHECK.FULL_CONTROL_FLOW],
  ["caller", CHECK.CALLER],
  ["wrapper", CHECK.WRAPPER_OR_OUTER_GUARD],
  ["validation", CHECK.UPSTREAM_VALIDATION],
  ["lifetime", CHECK.LIFETIME],
  ["cleanup", CHECK.CLEANUP_ERROR_PATH],
  ["counterevidence", CHECK.COUNTEREVIDENCE],
  ["reachability", CHECK.REACHABILITY],
  ["dynamic", CHECK.DYNAMIC_REPRODUCTION],
];

export function modeName(v) { return MODE_NAMES[v] ?? "?"; }
export function stateName(v) { return STATE_NAMES[v] ?? "?"; }
export function severityName(v) { return SEVERITY_NAMES[v] ?? "?"; }
export function reachabilityName(v) { return REACH_NAMES[v] ?? "?"; }
export function categoryName(v) { return CATEGORY_NAMES[v] ?? "?"; }
export function checkName(bit) {
  const hit = CHECKS.find(([, b]) => b === bit);
  return hit ? hit[0] : "?";
}

/* C text_ieq: case-insensitive, '-' and ' ' fold to '_'. */
function textIeq(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const norm = (s) => s.toLowerCase().replace(/[- ]/g, "_");
  return norm(a) === norm(b);
}

function parseTable(table, text) {
  if (typeof text !== "string") return null;
  for (let i = 0; i < table.length; i++) if (textIeq(text, table[i])) return i;
  return null;
}

export function parseMode(text) { return parseTable(MODE_NAMES, text); }
export function parseState(text) { return parseTable(STATE_NAMES, text); }
export function parseSeverity(text) { return parseTable(SEVERITY_NAMES, text); }
export function parseReachability(text) { return parseTable(REACH_NAMES, text); }
export function parseCategory(text) { return parseTable(CATEGORY_NAMES, text); }
export function parseSide(text) {
  if (text === "for") return SIDE.FOR;
  if (text === "against") return SIDE.AGAINST;
  return null;
}
export function parseCheck(text) {
  if (typeof text !== "string") return null;
  const hit = CHECKS.find(([name]) => textIeq(text, name));
  return hit ? hit[1] : null;
}
export function parseCheckResult(text) {
  if (typeof text !== "string") return null;
  if (textIeq(text, "done")) return CHECK_RESULT.DONE;
  if (textIeq(text, "not_applicable") || textIeq(text, "n/a")) return CHECK_RESULT.NOT_APPLICABLE;
  if (textIeq(text, "unknown") || textIeq(text, "not_done")) return CHECK_RESULT.UNKNOWN;
  return null;
}

/* C ds4_evidence_mode_resolve: an invalid value is an error, never a fallback. */
export function modeResolve(envValue, skillActive) {
  if (typeof envValue === "string" && envValue.length > 0) {
    const mode = parseMode(envValue);
    if (mode !== null) return { ok: true, mode };
    return {
      ok: false,
      error: `DS4_EVIDENCE_MODE=${envValue} is invalid (expected off, shadow or block)`,
    };
  }
  return { ok: true, mode: skillActive ? MODE.BLOCK : MODE.OFF };
}

/* EFA-001 style (C ds4_evidence_id_valid). */
export function idValid(id) {
  if (typeof id !== "string" || !id.startsWith("EFA-")) return false;
  const digits = id.slice(4);
  if (!/^[0-9]{3,}$/.test(digits)) return false;
  return id.length < 32;
}

/* ---- state --------------------------------------------------------------- */

function emptyMetrics() {
  return {
    findingsOpenedTotal: 0,
    findingsDisprovedTotal: 0,
    finalizeBlockedTotal: 0,
    finalizeAllowedTotal: 0,
    finalizeInvalidatedTotal: 0,
    reinjectionsTotal: 0,
    shadowViolationsTotal: 0,
  };
}

export function createEvidenceState() {
  return {
    enabled: false,
    finalized: false,
    finalizationValid: false,
    finalizeInvalidated: false,
    mutationSequence: 0,
    finalizedSequence: 0,
    findings: [],
    metrics: emptyMetrics(),
  };
}

export function createEvidenceTurn() {
  return { coreContractInjectedThisTurn: false, toolUsedAfterFinalize: false, repairRounds: 0 };
}

/* C ds4_agent_evidence_clear: metrics and enabled survive a clear. */
export function clearEvidenceState(state) {
  const { metrics, enabled } = state;
  const fresh = createEvidenceState();
  Object.assign(state, fresh);
  state.metrics = metrics;
  state.enabled = enabled;
}

export function evidenceFind(state, id) {
  if (!state || typeof id !== "string") return null;
  return state.findings.find((f) => f.id === id) ?? null;
}

/* Every accepted change goes through here: it is what makes a finalize stale. */
function mutate(state, f) {
  if (state.finalized || state.finalizationValid) {
    state.finalizeInvalidated = true;
    state.metrics.finalizeInvalidatedTotal++;
  }
  state.mutationSequence++;
  state.finalized = false;
  state.finalizationValid = false;
  if (f) f.revision++;
}

function resultOf(allowed, code, id, missing, detail) {
  return {
    allowed,
    findingId: id ?? "",
    missingChecks: missing ?? 0,
    reasonCode: code,
    detail: detail ?? "",
  };
}

function okResult(id) {
  return resultOf(true, CODES.OK, id ?? "", 0, "");
}

/* ---- invariants ----------------------------------------------------------- */

function checkResolved(f, bit) {
  return (f.checksDone | f.checksNotApplicable) & bit;
}
function checkRecorded(f, bit) {
  return (f.checksDone | f.checksNotApplicable | f.checksUnknown) & bit;
}

function categoryChecks(category) {
  switch (category) {
    case CATEGORY.CONCURRENCY: return CHECK.WRAPPER_OR_OUTER_GUARD;
    case CATEGORY.LIFETIME: return CHECK.LIFETIME;
    case CATEGORY.CLEANUP: return CHECK.CLEANUP_ERROR_PATH;
    case CATEGORY.VALIDATION: return CHECK.UPSTREAM_VALIDATION;
    default:
      /* Unknown category: conservative, all of them must be resolved. */
      return CHECK.WRAPPER_OR_OUTER_GUARD | CHECK.UPSTREAM_VALIDATION |
             CHECK.LIFETIME | CHECK.CLEANUP_ERROR_PATH;
  }
}

/* What CONFIRMED still needs (C confirm_ready): first missing item as the
 * reason code, every missing check in the mask. */
function confirmReady(f) {
  let code = null;
  let missing = 0;
  const miss = (cond, c, bits) => {
    if (cond) {
      if (!code) code = c;
      missing |= bits;
    }
  };

  miss(!f.evidenceForPresent, CODES.NO_EVIDENCE_FOR, 0);
  miss(!f.counterevidenceCompleted || !(f.checksDone & CHECK.COUNTEREVIDENCE),
    CODES.NO_COUNTEREVIDENCE_SEARCH, CHECK.COUNTEREVIDENCE);
  miss(!checkResolved(f, CHECK.FULL_CONTROL_FLOW), CODES.CONTROL_FLOW_UNCHECKED, CHECK.FULL_CONTROL_FLOW);
  miss(!checkResolved(f, CHECK.CALLER), CODES.CALLER_UNCHECKED, CHECK.CALLER);
  const specific = categoryChecks(f.category);
  for (const [, bit] of CHECKS) {
    miss((specific & bit) !== 0 && !checkResolved(f, bit), CODES.SPECIFIC_CHECK_UNRESOLVED, bit);
  }
  miss(!(f.checksDone & CHECK.REACHABILITY), CODES.REACHABILITY_UNCHECKED, CHECK.REACHABILITY);
  miss(f.reachability === REACHABILITY.UNKNOWN, CODES.REACHABILITY_UNKNOWN, CHECK.REACHABILITY);
  miss(!checkRecorded(f, CHECK.DYNAMIC_REPRODUCTION), CODES.DYNAMIC_STATUS_UNSET, CHECK.DYNAMIC_REPRODUCTION);

  if (!code) return null;
  const names = CHECKS.filter(([, bit]) => missing & bit).map(([name]) => name).join(",");
  return resultOf(false, code, f.id, missing,
    `finding=${f.id} cannot be CONFIRMED: ${code}${names ? ` missing=${names}` : ""}`);
}

/* State / severity / report compatibility (C verdict_compatible). */
function verdictCompatible(f, verdict, severity, include) {
  if (verdict === FINDING_STATE.DISPROVED) {
    if (include) {
      return resultOf(false, CODES.DISPROVED_IN_REPORT, f.id, 0,
        `finding=${f.id} is DISPROVED and cannot be reported as a finding`);
    }
    if (severity > SEVERITY.HARDENING) {
      return resultOf(false, CODES.DISPROVED_SEVERITY, f.id, 0,
        `finding=${f.id} is DISPROVED: severity must be NONE or HARDENING`);
    }
    return null;
  }
  if (verdict === FINDING_STATE.CONDITIONAL && severity > SEVERITY.MEDIUM) {
    return resultOf(false, CODES.CONDITIONAL_SEVERITY_CAP, f.id, 0,
      `finding=${f.id} is CONDITIONAL: severity is capped at MEDIUM`);
  }
  if (severity >= SEVERITY.HIGH) {
    if (verdict !== FINDING_STATE.CONFIRMED) {
      return resultOf(false, CODES.HIGH_REQUIRES_CONFIRMED, f.id, 0,
        `finding=${f.id}: ${severityName(severity)} requires CONFIRMED (state is ${stateName(verdict)})`);
    }
    if (f.reachability !== REACHABILITY.PROVEN) {
      return resultOf(false, CODES.HIGH_REQUIRES_REACHABLE, f.id, CHECK.REACHABILITY,
        `finding=${f.id}: ${severityName(severity)} requires reachability PROVEN (is ${reachabilityName(f.reachability)})`);
    }
    if (!f.counterevidenceCompleted) {
      return resultOf(false, CODES.NO_COUNTEREVIDENCE_SEARCH, f.id, CHECK.COUNTEREVIDENCE,
        `finding=${f.id}: ${severityName(severity)} requires a completed counterevidence search`);
    }
  }
  return null;
}

/* ---- ledger operations ----------------------------------------------------- */

function requireFinding(state, id) {
  const f = evidenceFind(state, id);
  if (!f) {
    return {
      f: null,
      err: resultOf(false, CODES.UNKNOWN_FINDING, id ?? "", 0,
        `finding=${id ?? ""} is not in the ledger; open it first`),
    };
  }
  return { f, err: null };
}

export function evidenceOpen(state, id, claim, category) {
  if (!state) return resultOf(false, CODES.BAD_ARGUMENT, "", 0, "no state");
  if (!idValid(id)) {
    return resultOf(false, CODES.BAD_ID, null, 0,
      `finding id must look like EFA-001 (got ${id ?? "nothing"})`);
  }
  if (!claim || !claim.length) {
    return resultOf(false, CODES.BAD_ARGUMENT, id, 0, `finding=${id} needs a non-empty claim`);
  }
  if (evidenceFind(state, id)) {
    return resultOf(false, CODES.DUPLICATE_FINDING, id, 0, `finding=${id} is already open`);
  }
  if (state.findings.length >= EVIDENCE_MAX_FINDINGS) {
    return resultOf(false, CODES.LEDGER_FULL, id, 0,
      `the ledger holds at most ${EVIDENCE_MAX_FINDINGS} findings`);
  }
  const f = {
    id,
    claim,
    state: FINDING_STATE.CANDIDATE,
    severity: SEVERITY.NONE,
    reachability: REACHABILITY.UNKNOWN,
    category,
    includeInReport: false,
    evidenceForPresent: false,
    evidenceAgainstSearched: false,
    counterevidenceCompleted: false,
    checksDone: 0,
    checksNotApplicable: 0,
    checksUnknown: 0,
    dynamicallyReproduced: false,
    staticEvidencePresent: false,
    evidenceForCount: 0,
    evidenceAgainstCount: 0,
    revision: 0,
  };
  state.findings.push(f);
  state.metrics.findingsOpenedTotal++;
  mutate(state, f);
  return okResult(id);
}

export function evidenceAdd(state, id, side, dynamicSource) {
  const { f, err } = requireFinding(state, id);
  if (!f) return err;
  if (side === SIDE.FOR) {
    f.evidenceForPresent = true;
    f.evidenceForCount++;
    if (!dynamicSource) f.staticEvidencePresent = true;
  } else {
    /* Evidence against is recorded, but it does not complete the
     * counterevidence check: that has to be marked done explicitly. */
    f.evidenceAgainstSearched = true;
    f.evidenceAgainstCount++;
  }
  mutate(state, f);
  return okResult(id);
}

export function evidenceMarkCheck(state, id, checkBit, result, note) {
  const { f, err } = requireFinding(state, id);
  if (!f) return err;
  if (!checkBit || (checkBit & (checkBit - 1)) || (checkBit & ~CHECK_ALL)) {
    return resultOf(false, CODES.BAD_ARGUMENT, id, 0, "unknown check");
  }
  if (result === CHECK_RESULT.NOT_APPLICABLE) {
    if (checkBit === CHECK.COUNTEREVIDENCE || checkBit === CHECK.REACHABILITY) {
      return resultOf(false, CODES.CHECK_NOT_WAIVABLE, id, checkBit,
        `finding=${id}: the ${checkName(checkBit)} check cannot be not_applicable`);
    }
    if (!note || !note.length) {
      return resultOf(false, CODES.NA_REQUIRES_REASON, id, checkBit,
        `finding=${id}: not_applicable for ${checkName(checkBit)} needs a note saying why`);
    }
  }
  f.checksDone &= ~checkBit;
  f.checksNotApplicable &= ~checkBit;
  f.checksUnknown &= ~checkBit;
  if (result === CHECK_RESULT.DONE) f.checksDone |= checkBit;
  else if (result === CHECK_RESULT.NOT_APPLICABLE) f.checksNotApplicable |= checkBit;
  else f.checksUnknown |= checkBit;
  if (checkBit === CHECK.COUNTEREVIDENCE) f.counterevidenceCompleted = result === CHECK_RESULT.DONE;
  if (checkBit === CHECK.DYNAMIC_REPRODUCTION) f.dynamicallyReproduced = result === CHECK_RESULT.DONE;
  mutate(state, f);
  return okResult(id);
}

export function evidenceSetReachability(state, id, reach) {
  const { f, err } = requireFinding(state, id);
  if (!f) return err;
  if (!(reach >= 0 && reach <= REACHABILITY.NOT_REACHABLE)) {
    return resultOf(false, CODES.BAD_ARGUMENT, id, 0, "unknown reachability");
  }
  f.reachability = reach;
  mutate(state, f);
  return okResult(id);
}

export function evidenceSetVerdict(state, id, verdict, severity, includeInReport) {
  const { f, err } = requireFinding(state, id);
  if (!f) return err;
  if (!(verdict >= 0 && verdict <= FINDING_STATE.UNKNOWN) ||
      !(severity >= 0 && severity <= SEVERITY.CRITICAL)) {
    return resultOf(false, CODES.BAD_ARGUMENT, id, 0, "unknown state or severity");
  }
  if (verdict === FINDING_STATE.CONFIRMED) {
    const r = confirmReady(f);
    if (r) return r;
  }
  const compat = verdictCompatible(f, verdict, severity, includeInReport);
  if (compat) return compat;
  if (verdict === FINDING_STATE.DISPROVED && f.state !== FINDING_STATE.DISPROVED) {
    state.metrics.findingsDisprovedTotal++;
  }
  f.state = verdict;
  f.severity = severity;
  f.includeInReport = Boolean(includeInReport);
  mutate(state, f);
  return okResult(id);
}

/* Re-evaluated at finalize time, never trusted from set_verdict. */
export function evidenceValidateFinalization(state) {
  if (!state) return resultOf(false, CODES.BAD_ARGUMENT, "", 0, "no state");
  for (const f of state.findings) {
    if (!f.includeInReport) continue;
    if (f.state === FINDING_STATE.DISPROVED) {
      return resultOf(false, CODES.DISPROVED_IN_REPORT, f.id, 0,
        `finding=${f.id} is DISPROVED and cannot be reported`);
    }
    if (f.state === FINDING_STATE.CONFIRMED) {
      const r = confirmReady(f);
      if (r) return r;
    }
    const compat = verdictCompatible(f, f.state, f.severity, true);
    if (compat) return compat;
  }
  return okResult(null);
}

export function evidenceFinalize(state) {
  if (!state) return resultOf(false, CODES.BAD_ARGUMENT, "", 0, "no state");
  const r = evidenceValidateFinalization(state);
  if (!r.allowed) {
    state.finalized = false;
    state.finalizationValid = false;
    state.metrics.finalizeBlockedTotal++;
    return r;
  }
  state.finalized = true;
  state.finalizationValid = true;
  state.finalizeInvalidated = false;
  state.finalizedSequence = state.mutationSequence;
  state.metrics.finalizeAllowedTotal++;
  return r;
}

export function evidenceNoteToolCall(state, turn, readOnlyStatus) {
  if (!state || readOnlyStatus) return;
  if (!state.finalized && !state.finalizationValid) return;
  state.finalized = false;
  state.finalizationValid = false;
  state.finalizeInvalidated = true;
  state.metrics.finalizeInvalidatedTotal++;
  if (turn) turn.toolUsedAfterFinalize = true;
}

export function evidenceFinalizationValid(state) {
  return Boolean(state && state.finalized && state.finalizationValid &&
    state.finalizedSequence === state.mutationSequence);
}

export function evidenceCanPublish(state) {
  if (evidenceFinalizationValid(state)) return okResult(null);
  if (state && state.finalizeInvalidated) {
    return resultOf(false, CODES.FINALIZE_STALE, null, 0,
      "the ledger or the evidence changed after finalize; call evidence_guard finalize again");
  }
  return resultOf(false, CODES.NOT_FINALIZED, null, 0,
    "no valid evidence_guard finalize for this report");
}

/* ---- final-text scanner ----------------------------------------------------- */

function containsCi(hay, needle) {
  return hay.toLowerCase().includes(needle);
}

const FINDINGS_WORDS = ["confirm", "conferm", "finding", "problem", "issue", "bug",
  "vulnerab", "difett", "risultat", "rilev"];
const DISPROVED_WORDS = ["disprov", "falsif", "esclus", "scartat", "smentit", "rejected",
  "false positive", "falsi positivi", "non conferm", "not confirmed"];

function headingIsFindings(h) { return FINDINGS_WORDS.some((w) => containsCi(h, w)); }
function headingIsDisproved(h) { return DISPROVED_WORDS.some((w) => containsCi(h, w)); }

/* "  - **State:** CONFIRMED" -> {key: "state", value: "CONFIRMED"} (C contract_line). */
function contractLine(line) {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t" || line[i] === "-" ||
    line[i] === "*" || line[i] === ">")) i++;
  let key = "";
  while (i < line.length && /[A-Za-z]/.test(line[i]) && key.length < 15) {
    key += line[i].toLowerCase();
    i++;
  }
  while (i < line.length && line[i] === "*") i++;
  if (i >= line.length || line[i] !== ":") return null;
  i++;
  while (i < line.length && (line[i] === "*" || line[i] === " " || line[i] === "\t" || line[i] === "`")) i++;
  let value = "";
  while (i < line.length && /[A-Za-z0-9_-]/.test(line[i]) && value.length < 31) {
    value += line[i];
    i++;
  }
  if (key.length === 0 || value.length === 0) return null;
  return { key, value };
}

export function evidenceScanFinalText(state, text) {
  if (!state) return resultOf(false, CODES.BAD_ARGUMENT, "", 0, "no state");
  const body = text ?? "";
  const mentioned = new Array(state.findings.length).fill(false);
  let section = null;
  let block = null;

  for (const line of body.split("\n")) {
    const len = line.length;
    let hashes = 0;
    while (hashes < len && line[hashes] === "#") hashes++;
    const heading = hashes > 0 && hashes < len && line[hashes] === " ";
    if (heading) {
      block = null;
      if (hashes <= 2) section = line;
    }

    /* Every EFA-nnn token on the line. */
    for (let i = 0; i + 7 <= len; i++) {
      if (line.slice(i, i + 4) !== "EFA-") continue;
      if (i > 0 && (/[A-Za-z0-9]/.test(line[i - 1]) || line[i - 1] === "_")) continue;
      let j = i + 4;
      while (j < len && /[0-9]/.test(line[j])) j++;
      if (j - (i + 4) < 3 || (j < len && /[A-Za-z0-9]/.test(line[j]))) continue;
      const id = line.slice(i, j);
      if (id.length >= 32) continue;
      const idx = state.findings.findIndex((f) => f.id === id);
      if (idx < 0) {
        return resultOf(false, CODES.REPORT_UNKNOWN_ID, id, 0,
          `the report mentions ${id}, which is not in the ledger`);
      }
      mentioned[idx] = true;
      const f = state.findings[idx];
      if (heading) block = f;
      if (f.state === FINDING_STATE.DISPROVED && section !== null &&
          headingIsFindings(section) && !headingIsDisproved(section)) {
        return resultOf(false, CODES.REPORT_DISPROVED_AS_FINDING, id, 0,
          `${id} is DISPROVED but appears under a findings section`);
      }
      i = j - 1;
    }

    if (!heading && block) {
      const parsed = contractLine(line);
      if (parsed) {
        let expected = null;
        let code = null;
        if (parsed.key === "state") {
          expected = stateName(block.state);
          code = CODES.REPORT_STATE_MISMATCH;
        } else if (parsed.key === "severity") {
          expected = severityName(block.severity);
          code = CODES.REPORT_SEVERITY_MISMATCH;
        } else if (parsed.key === "reachability") {
          expected = reachabilityName(block.reachability);
          code = CODES.REPORT_REACHABILITY_MISMATCH;
        }
        if (expected && !textIeq(parsed.value, expected)) {
          return resultOf(false, code, block.id, 0,
            `${block.id}: the report says ${parsed.key} ${parsed.value}, the ledger says ${expected}`);
        }
      }
    }
  }

  for (let i = 0; i < state.findings.length; i++) {
    const f = state.findings[i];
    if (f.includeInReport && !mentioned[i]) {
      return resultOf(false, CODES.REPORT_MISSING_FINDING, f.id, 0,
        `${f.id} is marked include_in_report but the report never mentions it`);
    }
  }
  return okResult(null);
}

/* ---- rendering --------------------------------------------------------------- */

export function evidenceDigest(state) {
  if (!state) return "";
  let out = "[EVIDENCE RUNTIME STATE]\n";
  if (!state.findings.length) {
    out += "Findings: none registered\n";
  } else {
    out += "Findings:";
    state.findings.forEach((f, i) => {
      /* C: tput("%s %s=%s", i ? "," : "", id, state) — space before every id. */
      out += `${i ? "," : ""} ${f.id}=${stateName(f.state)}`;
      if (f.severity !== SEVERITY.NONE) out += `/${severityName(f.severity)}`;
      if (!f.counterevidenceCompleted) out += "(counterevidence pending)";
    });
    out += "\n";
  }
  out += `Finalization: ${evidenceFinalizationValid(state) ? "READY" : "NOT_READY"}\n`;
  out += "Runtime ledger is authoritative.\n[/EVIDENCE RUNTIME STATE]\n";
  return out;
}

function putCheckList(mask) {
  const names = CHECKS.filter(([, bit]) => mask & bit).map(([name]) => name);
  return names.length ? names.join(",") : "-";
}

export function evidenceStatus(state, mode, policyRevision) {
  if (!state) return "";
  const open = state.findings.filter((f) => f.state !== FINDING_STATE.DISPROVED).length;
  let out = "EVIDENCE_STATUS\n";
  out += `skill active: ${state.enabled ? "yes" : "no"}\n`;
  out += `mode: ${modeName(mode)}\n`;
  out += `EvidenceFirst policy revision: ${policyRevision && policyRevision.length ? policyRevision : "-"}\n`;
  out += `finding count: ${state.findings.length} (open ${open})\n`;
  out += `finalization: ${evidenceFinalizationValid(state) ? "READY" : state.finalizeInvalidated ? "STALE" : "NOT_READY"}\n`;
  out += `mutation sequence: ${state.mutationSequence}\n`;
  for (const f of state.findings) {
    out += `- ${f.id} ${stateName(f.state)} severity=${severityName(f.severity)} ` +
      `reach=${reachabilityName(f.reachability)} category=${categoryName(f.category)} ` +
      `report=${f.includeInReport ? "yes" : "no"} done=${putCheckList(f.checksDone)} ` +
      `n/a=${putCheckList(f.checksNotApplicable)} evidence=${f.evidenceForCount}/${f.evidenceAgainstCount}\n`;
  }
  return out;
}

/* ---- persistence (DS4_EVIDENCE_STATE_V1, same text format as the C) ---------- */

export const EVIDENCE_STATE_MAGIC = "DS4_EVIDENCE_STATE_V1";

export function evidenceSerialize(state) {
  let out = `${EVIDENCE_STATE_MAGIC}\nsequence ${state.mutationSequence}\ncount ${state.findings.length}\n`;
  for (const f of state.findings) {
    out += `finding ${f.id} ${f.state} ${f.severity} ${f.reachability} ${f.category} ` +
      `${f.includeInReport ? 1 : 0} ${f.evidenceForPresent ? 1 : 0} ${f.evidenceAgainstSearched ? 1 : 0} ` +
      `${f.counterevidenceCompleted ? 1 : 0} ${f.checksDone.toString(16)} ${f.checksNotApplicable.toString(16)} ` +
      `${f.checksUnknown.toString(16)} ${f.dynamicallyReproduced ? 1 : 0} ${f.staticEvidencePresent ? 1 : 0} ` +
      `${f.evidenceForCount} ${f.evidenceAgainstCount} ${f.revision} `;
    if (!f.claim.length) out += "-";
    else out += Buffer.from(f.claim, "utf8").toString("hex");
    out += "\n";
  }
  out += "end\n";
  return out;
}

const FINDING_LINE_RE = /^finding (\S+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) ([0-9a-f]+) ([0-9a-f]+) ([0-9a-f]+) (-?\d+) (-?\d+) (\d+) (\d+) (\d+) (\S+)$/;

/* C ds4_agent_evidence_deserialize: builds the next state fully; a malformed
 * record is rejected whole and leaves the state alone.  Fail closed: the
 * finalization token is never restored. */
export function evidenceDeserialize(text, state) {
  const fail = (msg) => ({ ok: false, error: msg });
  if (typeof text !== "string" || !state) return fail("no evidence state");
  if (text.includes("\0")) return fail("evidence state contains NUL bytes");

  /* strtok_r("\n") semantics: empty lines are skipped. */
  const lines = text.split("\n").filter((l) => l.length > 0);
  const next = createEvidenceState();
  next.metrics = state.metrics;
  next.enabled = state.enabled;

  if (!lines.length || lines[0] !== EVIDENCE_STATE_MAGIC) {
    return fail(`not a ${EVIDENCE_STATE_MAGIC} record`);
  }
  let m = /^sequence (\d+)$/.exec(lines[1] ?? "");
  if (!m) return fail("missing sequence");
  const seq = Number(m[1]);
  m = /^count (\d+)$/.exec(lines[2] ?? "");
  if (!m || Number(m[1]) > EVIDENCE_MAX_FINDINGS) return fail("bad finding count");
  const count = Number(m[1]);

  const findings = [];
  for (let i = 0; i < count; i++) {
    const line = lines[3 + i];
    if (line === undefined) return fail(`truncated: ${i} of ${count} findings`);
    const g = FINDING_LINE_RE.exec(line);
    if (!g) return fail(`malformed finding line ${i}`);
    const [, id, stS, sevS, reachS, catS, incS, eforS, eagS, ceS,
      doneS, naS, unkS, dynS, statS, cforS, cagS, revS, claimHex] = g;
    const st = Number(stS);
    const sev = Number(sevS);
    const reach = Number(reachS);
    const cat = Number(catS);
    const done = parseInt(doneS, 16);
    const na = parseInt(naS, 16);
    const unk = parseInt(unkS, 16);
    if (!idValid(id)) return fail("bad finding id");
    if (findings.some((f) => f.id === id)) return fail(`duplicate finding ${id}`);
    if (st < 0 || st > FINDING_STATE.UNKNOWN || sev < 0 || sev > SEVERITY.CRITICAL ||
        reach < 0 || reach > REACHABILITY.NOT_REACHABLE || cat < 0 || cat > CATEGORY.VALIDATION) {
      return fail(`enum out of range in ${id}`);
    }
    for (const flag of [incS, eforS, eagS, ceS, dynS, statS]) {
      if (flag !== "0" && flag !== "1") return fail(`bad flag in ${id}`);
    }
    if ((done | na | unk) & ~CHECK_ALL || (done & na) || (done & unk) || (na & unk)) {
      return fail(`inconsistent check masks in ${id}`);
    }
    let claim = "";
    if (claimHex !== "-") {
      if (claimHex.length % 2 !== 0 || claimHex.length / 2 >= 512) {
        return fail(`bad claim in ${id}`);
      }
      /* C hexval accepts lowercase nibbles only. */
      if (!/^[0-9a-f]+$/.test(claimHex)) return fail(`bad claim encoding in ${id}`);
      claim = Buffer.from(claimHex, "hex").toString("utf8");
    }
    findings.push({
      id,
      claim,
      state: st,
      severity: sev,
      reachability: reach,
      category: cat,
      includeInReport: incS === "1",
      evidenceForPresent: eforS === "1",
      evidenceAgainstSearched: eagS === "1",
      counterevidenceCompleted: ceS === "1",
      checksDone: done,
      checksNotApplicable: na,
      checksUnknown: unk,
      dynamicallyReproduced: dynS === "1",
      staticEvidencePresent: statS === "1",
      evidenceForCount: Number(cforS),
      evidenceAgainstCount: Number(cagS),
      revision: Number(revS),
    });
  }
  if ((lines[3 + count] ?? "") !== "end") return fail("missing end marker");

  next.findings = findings;
  next.mutationSequence = seq;
  /* Fail closed: the finalization token is never restored. */
  next.finalized = false;
  next.finalizationValid = false;
  next.finalizeInvalidated = false;
  Object.assign(state, next);
  return { ok: true };
}

/* ---- loop-facing helpers ------------------------------------------------------ */

export const EVIDENCE_FINALIZATION_TERMINAL_STATUS =
  "EVIDENCE_FINALIZATION_TERMINAL: no Evidence-First verdict without a valid " +
  "evidence_guard finalize was published.";

export function evidenceCoreContract() {
  return loadAgentText("evidence-core-contract");
}

export function evidenceOpenGuidance() {
  return loadAgentText("evidence-open-guidance");
}

function missingNames(mask) {
  return CHECKS.filter(([, bit]) => mask & bit).map(([name]) => name).join(",");
}

/* What the model gets back when its final answer was withheld
 * (C agent_worker_evidence_repair_guidance). */
export function evidenceRepairGuidance(r) {
  let out = "EVIDENCE_FINALIZATION_BLOCKED\n";
  out += `reason=${r.reasonCode ?? "?"}\n`;
  if (r.findingId) out += `finding=${r.findingId}\n`;
  if (r.missingChecks) out += `missing=${missingNames(r.missingChecks)}\n`;
  if (r.detail) out += `${r.detail}\n`;
  out += "Your final answer was withheld; the user has not seen it. Bring the " +
    "ledger in line with evidence_guard (add_evidence, mark_check, " +
    "set_reachability, set_verdict), call evidence_guard finalize, then " +
    "answer again without calling any other tool after finalize. The " +
    "report must use the ledger ids and match its State/Severity/" +
    "Reachability.\n";
  return out;
}

/* Runtime outcome of a rejected ledger operation: what was refused and why,
 * never just "false" (C agent_evidence_rejection: head + reason/finding/
 * missing/detail lines, without the withheld-answer advice). */
export function evidenceRejection(head, r) {
  let out = `${head}\n`;
  out += `reason=${r.reasonCode ?? "?"}\n`;
  if (r.findingId) out += `finding=${r.findingId}\n`;
  if (r.missingChecks) out += `missing=${missingNames(r.missingChecks)}\n`;
  if (r.detail) out += `${r.detail}\n`;
  return out;
}

function toolFlag(value) {
  return value === "true" || value === "1" || value === "yes";
}

const cut64 = (s) => s.slice(0, 64);

/* evidence_guard tool (C agent_tool_evidence_guard): the only way the ledger
 * changes from the model.  opts: { skillLoaded, mode, policyRevision }. */
export function evidenceGuardTool(state, turn, args, opts) {
  if (!opts.skillLoaded) {
    return "Tool error: EVIDENCE_SKILL_INACTIVE: evidence_guard needs " +
      "the evidence-first-analysis skill (/skill evidence-first-analysis start).\n";
  }
  state.enabled = true;
  const action = args.action;
  if (!action) {
    return "Tool error: evidence_guard requires action " +
      "(open, add_evidence, mark_check, set_reachability, set_verdict, finalize, status)\n";
  }

  if (action === "status") {
    return evidenceStatus(state, opts.mode, opts.policyRevision ?? "");
  }
  if (action === "finalize") {
    const r = evidenceFinalize(state);
    if (r.allowed) {
      return `EVIDENCE_FINALIZATION_READY\nsequence=${state.finalizedSequence}\n` +
        "Write the final report now; any other tool call voids this finalize.\n";
    }
    return evidenceRejection("EVIDENCE_FINALIZATION_BLOCKED", r);
  }

  const id = args.id;
  let r = null;
  if (action === "open") {
    let category = CATEGORY.GENERAL;
    const cat = args.category;
    if (cat && cat.length) {
      const parsed = parseCategory(cat);
      if (parsed === null) {
        return `Tool error: EVIDENCE_BAD_ARGUMENT: unknown category ${cut64(cat)}\n`;
      }
      category = parsed;
    }
    r = evidenceOpen(state, id, args.claim, category);
    if (r.allowed) {
      return `EVIDENCE_FINDING_OPENED id=${id} state=CANDIDATE\n` +
        "Next required action: collect evidence and attempt falsification.\n" +
        evidenceOpenGuidance();
    }
  } else if (action === "add_evidence") {
    const side = parseSide(args.side);
    if (side === null) {
      return "Tool error: EVIDENCE_BAD_ARGUMENT: side must be for or against\n";
    }
    r = evidenceAdd(state, id, side, toolFlag(args.dynamic));
  } else if (action === "mark_check") {
    const checkBit = parseCheck(args.check);
    if (checkBit === null) {
      return `Tool error: EVIDENCE_BAD_ARGUMENT: unknown check ${cut64(args.check ?? "(none)")}\n`;
    }
    const checkResult = parseCheckResult(args.result);
    if (checkResult === null) {
      return `Tool error: EVIDENCE_BAD_ARGUMENT: result must be done, ` +
        `not_applicable or unknown (got ${cut64(args.result ?? "nothing")})\n`;
    }
    r = evidenceMarkCheck(state, id, checkBit, checkResult, args.note);
  } else if (action === "set_reachability") {
    const reach = parseReachability(args.reachability);
    if (reach === null) {
      return `Tool error: EVIDENCE_BAD_ARGUMENT: unknown reachability ${cut64(args.reachability ?? "(none)")}\n`;
    }
    r = evidenceSetReachability(state, id, reach);
  } else if (action === "set_verdict") {
    const verdict = parseState(args.state);
    if (verdict === null) {
      return `Tool error: EVIDENCE_BAD_ARGUMENT: unknown state ${cut64(args.state ?? "(none)")}\n`;
    }
    let severity = SEVERITY.NONE;
    const severityText = args.severity;
    if (severityText && severityText.length) {
      const parsed = parseSeverity(severityText);
      if (parsed === null) {
        return `Tool error: EVIDENCE_BAD_ARGUMENT: unknown severity ${cut64(severityText)}\n`;
      }
      severity = parsed;
    }
    r = evidenceSetVerdict(state, id, verdict, severity, toolFlag(args.include_in_report));
  } else {
    return `Tool error: EVIDENCE_BAD_ARGUMENT: unknown action ${cut64(action)}\n`;
  }

  if (!r.allowed) return evidenceRejection("EVIDENCE_REJECTED", r);
  const f = evidenceFind(state, id);
  return `EVIDENCE_LEDGER_UPDATED id=${id} ` +
    `state=${f ? stateName(f.state) : "?"} severity=${f ? severityName(f.severity) : "?"} ` +
    `reach=${f ? reachabilityName(f.reachability) : "?"} sequence=${state.mutationSequence}\n`;
}

/* Gate decision for one generated round (C agent_worker_evidence_check_final).
 * Only a final answer owes a verdict: prose in front of a tool call is
 * narration.  Shadow records the violation and lets the bytes through. */
export function evidenceCheckFinal(state, mode, finalCandidate, text) {
  let result = okResult(null);
  if (mode === MODE.OFF || !finalCandidate) return { allowed: true, result };
  result = evidenceCanPublish(state);
  if (result.allowed) {
    const scan = evidenceScanFinalText(state, text ?? "");
    result = scan;
  }
  if (result.allowed) return { allowed: true, result };
  if (mode === MODE.SHADOW) {
    state.metrics.shadowViolationsTotal++;
    return { allowed: true, result };
  }
  return { allowed: false, result };
}
