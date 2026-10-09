/* WP10: Evidence-First ledger in JS, conformant with ds4_agent_evidence_guard.c.
 * Mirrors tests/ds4_agent_evidence_guard_test.c (T01-T13, section 27
 * regressions, section 45 negatives, persistence, scanner, digest/status)
 * plus the loop-facing helpers (tool handler, repair guidance, gate).
 * Assertions are on reason codes, not on human text.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CHECK,
  CHECK_ALL,
  CHECK_RESULT,
  CODES,
  CATEGORY,
  EVIDENCE_MAX_FINDINGS,
  EVIDENCE_MAX_REPAIR_ROUNDS,
  FINDING_STATE,
  MODE,
  REACHABILITY,
  SEVERITY,
  SIDE,
  clearEvidenceState,
  createEvidenceState,
  createEvidenceTurn,
  evidenceAdd,
  evidenceCanPublish,
  evidenceCheckFinal,
  evidenceCoreContract,
  evidenceDeserialize,
  evidenceDigest,
  evidenceFinalizationValid,
  evidenceFinalize,
  evidenceGuardTool,
  evidenceMarkCheck,
  evidenceNoteToolCall,
  evidenceOpen,
  evidenceOpenGuidance,
  evidenceRejection,
  evidenceRepairGuidance,
  evidenceScanFinalText,
  evidenceSerialize,
  evidenceSetReachability,
  evidenceSetVerdict,
  evidenceStatus,
  evidenceValidateFinalization,
  idValid,
  modeResolve,
  parseCategory,
  parseCheck,
  parseCheckResult,
  parseMode,
  parseReachability,
  parseSeverity,
  parseSide,
  parseState,
} from "./evidenceGuard.mjs";

/* ---- helpers copied from the C test file ---- */

function fresh() {
  const s = createEvidenceState();
  s.enabled = true;
  return s;
}

function openFinding(s, id, cat = CATEGORY.GENERAL) {
  const r = evidenceOpen(s, id, "claim under test", cat);
  assert.ok(r.allowed, `open ${id}: ${r.reasonCode}`);
  return r;
}

function mark(s, id, check, res) {
  const r = evidenceMarkCheck(
    s,
    id,
    check,
    res,
    res === CHECK_RESULT.NOT_APPLICABLE ? "not relevant: single caller" : null
  );
  assert.ok(r.allowed, `mark ${id} ${check}: ${r.reasonCode}`);
  return r;
}

/* Everything CONFIRMED needs for a general-category finding. */
function completeChecks(s, id) {
  assert.ok(evidenceAdd(s, id, SIDE.FOR, false).allowed);
  assert.ok(evidenceAdd(s, id, SIDE.AGAINST, false).allowed);
  mark(s, id, CHECK.FULL_CONTROL_FLOW, CHECK_RESULT.DONE);
  mark(s, id, CHECK.CALLER, CHECK_RESULT.DONE);
  mark(s, id, CHECK.WRAPPER_OR_OUTER_GUARD, CHECK_RESULT.NOT_APPLICABLE);
  mark(s, id, CHECK.UPSTREAM_VALIDATION, CHECK_RESULT.DONE);
  mark(s, id, CHECK.LIFETIME, CHECK_RESULT.NOT_APPLICABLE);
  mark(s, id, CHECK.CLEANUP_ERROR_PATH, CHECK_RESULT.DONE);
  mark(s, id, CHECK.COUNTEREVIDENCE, CHECK_RESULT.DONE);
  mark(s, id, CHECK.REACHABILITY, CHECK_RESULT.DONE);
  mark(s, id, CHECK.DYNAMIC_REPRODUCTION, CHECK_RESULT.UNKNOWN);
  assert.ok(evidenceSetReachability(s, id, REACHABILITY.PROVEN).allowed);
}

/* ---- T01..T13 ---- */

test("T01 CANDIDATE with HIGH is rejected, severity untouched", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  const r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CANDIDATE, SEVERITY.HIGH, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.HIGH_REQUIRES_CONFIRMED);
  assert.equal(s.findings[0].severity, SEVERITY.NONE);
});

test("T02 SUPPORTED with HIGH rejected, SUPPORTED LOW accepted", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  assert.ok(evidenceAdd(s, "EFA-001", SIDE.FOR, false).allowed);
  let r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.SUPPORTED, SEVERITY.HIGH, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.HIGH_REQUIRES_CONFIRMED);
  assert.ok(evidenceSetVerdict(s, "EFA-001", FINDING_STATE.SUPPORTED, SEVERITY.LOW, true).allowed);
});

test("T03 CONFIRMED without a completed falsification search is rejected", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  completeChecks(s, "EFA-001");
  mark(s, "EFA-001", CHECK.COUNTEREVIDENCE, CHECK_RESULT.UNKNOWN);
  assert.equal(s.findings[0].evidenceAgainstSearched, true);
  assert.equal(s.findings[0].counterevidenceCompleted, false);
  const r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONFIRMED, SEVERITY.MEDIUM, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.NO_COUNTEREVIDENCE_SEARCH);
  assert.ok(r.missingChecks & CHECK.COUNTEREVIDENCE);
});

test("T04 CONFIRMED with unknown reachability is rejected", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  completeChecks(s, "EFA-001");
  assert.ok(evidenceSetReachability(s, "EFA-001", REACHABILITY.UNKNOWN).allowed);
  const r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONFIRMED, SEVERITY.LOW, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.REACHABILITY_UNKNOWN);
});

test("T05 CONFIRMED HIGH with everything in place is accepted and publishable", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  completeChecks(s, "EFA-001");
  const r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONFIRMED, SEVERITY.HIGH, true);
  assert.equal(r.reasonCode, CODES.OK);
  assert.ok(evidenceFinalize(s).allowed);
  assert.ok(evidenceCanPublish(s).allowed);
});

test("T06 DISPROVED cannot be reported nor carry severity above HARDENING", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  let r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.DISPROVED, SEVERITY.NONE, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.DISPROVED_IN_REPORT);
  r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.DISPROVED, SEVERITY.HIGH, false);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.DISPROVED_SEVERITY);
  assert.ok(evidenceSetVerdict(s, "EFA-001", FINDING_STATE.DISPROVED, SEVERITY.HARDENING, false).allowed);
  assert.equal(s.metrics.findingsDisprovedTotal, 1);
});

test("T07/T08 CONDITIONAL severity is capped at MEDIUM", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  assert.ok(evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONDITIONAL, SEVERITY.MEDIUM, true).allowed);
  let r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONDITIONAL, SEVERITY.HIGH, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.CONDITIONAL_SEVERITY_CAP);
  r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONDITIONAL, SEVERITY.CRITICAL, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.CONDITIONAL_SEVERITY_CAP);
  assert.equal(s.findings[0].severity, SEVERITY.MEDIUM);
});

test("T09 a mutation after finalize makes it stale", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  assert.ok(evidenceFinalize(s).allowed);
  assert.ok(evidenceCanPublish(s).allowed);
  assert.ok(evidenceAdd(s, "EFA-001", SIDE.FOR, false).allowed);
  const r = evidenceCanPublish(s);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.FINALIZE_STALE);
});

test("T10 a tool call after finalize invalidates it; status does not", () => {
  const s = fresh();
  const turn = createEvidenceTurn();
  assert.ok(evidenceFinalize(s).allowed);
  evidenceNoteToolCall(s, turn, true); // evidence_guard status: read-only
  assert.ok(evidenceCanPublish(s).allowed);
  evidenceNoteToolCall(s, turn, false);
  assert.equal(turn.toolUsedAfterFinalize, true);
  const r = evidenceCanPublish(s);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.FINALIZE_STALE);
});

test("T11 refinalize restores publishability", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  assert.ok(evidenceFinalize(s).allowed);
  assert.ok(evidenceAdd(s, "EFA-001", SIDE.FOR, false).allowed);
  assert.equal(evidenceCanPublish(s).allowed, false);
  assert.ok(evidenceFinalize(s).allowed);
  assert.ok(evidenceCanPublish(s).allowed);
  assert.equal(s.finalizedSequence, s.mutationSequence);
});

test("T12 UNKNOWN with HIGH/CRITICAL is rejected", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  let r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.UNKNOWN, SEVERITY.HIGH, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.HIGH_REQUIRES_CONFIRMED);
  r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.UNKNOWN, SEVERITY.CRITICAL, true);
  assert.equal(r.allowed, false);
});

test("T13 an empty ledger publishes only once finalized", () => {
  const s = fresh();
  let r = evidenceCanPublish(s);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.NOT_FINALIZED);
  assert.ok(evidenceFinalize(s).allowed);
  assert.ok(evidenceCanPublish(s).allowed);
});

/* ---- regressions (section 27) ---- */

test("finalize re-validates: reachability back to unknown blocks it", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  completeChecks(s, "EFA-001");
  assert.ok(evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONFIRMED, SEVERITY.HIGH, true).allowed);
  assert.ok(evidenceSetReachability(s, "EFA-001", REACHABILITY.UNKNOWN).allowed);
  const r = evidenceFinalize(s);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.REACHABILITY_UNKNOWN);
  assert.equal(r.findingId, "EFA-001");
  assert.equal(s.metrics.finalizeBlockedTotal, 1);
  assert.equal(evidenceCanPublish(s).allowed, false);
});

test("regression: concurrency needs the wrapper check; not reachable forbids HIGH", () => {
  const s = fresh();
  openFinding(s, "EFA-001", CATEGORY.CONCURRENCY);
  assert.ok(evidenceAdd(s, "EFA-001", SIDE.FOR, false).allowed);
  mark(s, "EFA-001", CHECK.FULL_CONTROL_FLOW, CHECK_RESULT.DONE);
  mark(s, "EFA-001", CHECK.CALLER, CHECK_RESULT.DONE);
  mark(s, "EFA-001", CHECK.COUNTEREVIDENCE, CHECK_RESULT.DONE);
  mark(s, "EFA-001", CHECK.REACHABILITY, CHECK_RESULT.DONE);
  mark(s, "EFA-001", CHECK.DYNAMIC_REPRODUCTION, CHECK_RESULT.UNKNOWN);
  assert.ok(evidenceSetReachability(s, "EFA-001", REACHABILITY.PROVEN).allowed);
  let r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONFIRMED, SEVERITY.HIGH, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.SPECIFIC_CHECK_UNRESOLVED);
  assert.equal(r.missingChecks, CHECK.WRAPPER_OR_OUTER_GUARD);
  mark(s, "EFA-001", CHECK.WRAPPER_OR_OUTER_GUARD, CHECK_RESULT.DONE);
  assert.ok(evidenceAdd(s, "EFA-001", SIDE.AGAINST, false).allowed);
  assert.ok(evidenceSetReachability(s, "EFA-001", REACHABILITY.NOT_REACHABLE).allowed);
  r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONFIRMED, SEVERITY.HIGH, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.HIGH_REQUIRES_REACHABLE);
  assert.ok(evidenceSetVerdict(s, "EFA-001", FINDING_STATE.DISPROVED, SEVERITY.NONE, false).allowed);
  r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.DISPROVED, SEVERITY.HIGH, false);
  assert.equal(r.allowed, false);
  assert.ok(evidenceFinalize(s).allowed);
});

test("regression: cleanup category requires the cleanup error path", () => {
  const s = fresh();
  openFinding(s, "EFA-002", CATEGORY.CLEANUP);
  assert.ok(evidenceAdd(s, "EFA-002", SIDE.FOR, false).allowed);
  mark(s, "EFA-002", CHECK.FULL_CONTROL_FLOW, CHECK_RESULT.DONE);
  mark(s, "EFA-002", CHECK.CALLER, CHECK_RESULT.DONE);
  mark(s, "EFA-002", CHECK.COUNTEREVIDENCE, CHECK_RESULT.DONE);
  mark(s, "EFA-002", CHECK.REACHABILITY, CHECK_RESULT.DONE);
  mark(s, "EFA-002", CHECK.DYNAMIC_REPRODUCTION, CHECK_RESULT.UNKNOWN);
  assert.ok(evidenceSetReachability(s, "EFA-002", REACHABILITY.PROVEN).allowed);
  let r = evidenceSetVerdict(s, "EFA-002", FINDING_STATE.CONFIRMED, SEVERITY.MEDIUM, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.SPECIFIC_CHECK_UNRESOLVED);
  assert.equal(r.missingChecks, CHECK.CLEANUP_ERROR_PATH);
  mark(s, "EFA-002", CHECK.CLEANUP_ERROR_PATH, CHECK_RESULT.DONE);
  r = evidenceSetVerdict(s, "EFA-002", FINDING_STATE.CONFIRMED, SEVERITY.MEDIUM, true);
  assert.ok(r.allowed);
});

/* ---- negatives (section 45) ---- */

test("negative inputs: unknown finding, bad ids, NA rules, ledger full", () => {
  const s = fresh();
  let r = evidenceSetVerdict(s, "EFA-009", FINDING_STATE.CONFIRMED, SEVERITY.LOW, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.UNKNOWN_FINDING);
  r = evidenceAdd(s, "EFA-009", SIDE.FOR, false);
  assert.equal(r.reasonCode, CODES.UNKNOWN_FINDING);
  r = evidenceOpen(s, "BUG-1", "x", CATEGORY.GENERAL);
  assert.equal(r.reasonCode, CODES.BAD_ID);
  r = evidenceOpen(s, "EFA-01", "x", CATEGORY.GENERAL);
  assert.equal(r.reasonCode, CODES.BAD_ID);
  r = evidenceOpen(s, "EFA-001", "", CATEGORY.GENERAL);
  assert.equal(r.reasonCode, CODES.BAD_ARGUMENT);
  openFinding(s, "EFA-001");
  r = evidenceOpen(s, "EFA-001", "x", CATEGORY.GENERAL);
  assert.equal(r.reasonCode, CODES.DUPLICATE_FINDING);
  r = evidenceMarkCheck(s, "EFA-001", CHECK.CALLER, CHECK_RESULT.NOT_APPLICABLE, "");
  assert.equal(r.reasonCode, CODES.NA_REQUIRES_REASON);
  r = evidenceMarkCheck(s, "EFA-001", CHECK.COUNTEREVIDENCE, CHECK_RESULT.NOT_APPLICABLE, "nothing to search");
  assert.equal(r.reasonCode, CODES.CHECK_NOT_WAIVABLE);
  r = evidenceMarkCheck(s, "EFA-001", 3, CHECK_RESULT.DONE, null);
  assert.equal(r.reasonCode, CODES.BAD_ARGUMENT);
  r = evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONDITIONAL, SEVERITY.CRITICAL, true);
  assert.equal(r.allowed, false);

  const full = fresh();
  for (let i = 0; i < EVIDENCE_MAX_FINDINGS; i++) {
    const id = `EFA-${String(i + 1).padStart(3, "0")}`;
    assert.ok(evidenceOpen(full, id, "c", CATEGORY.GENERAL).allowed, id);
  }
  r = evidenceOpen(full, "EFA-999", "c", CATEGORY.GENERAL);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.LEDGER_FULL);
});

test("enum parsers follow the C table (case/dash/space insensitive)", () => {
  assert.equal(parseSeverity("high"), SEVERITY.HIGH);
  assert.equal(parseSeverity("severe"), null);
  assert.equal(parseState("Confirmed"), FINDING_STATE.CONFIRMED);
  assert.equal(parseState("probable"), null);
  assert.equal(parseReachability("not-reachable"), REACHABILITY.NOT_REACHABLE);
  assert.equal(parseReachability("maybe"), null);
  assert.equal(parseCheck("wrapper"), CHECK.WRAPPER_OR_OUTER_GUARD);
  assert.equal(parseCheck("vibes"), null);
  assert.equal(parseCheckResult("not_applicable"), CHECK_RESULT.NOT_APPLICABLE);
  assert.equal(parseCheckResult("n/a"), CHECK_RESULT.NOT_APPLICABLE);
  assert.equal(parseCheckResult("skipped"), null);
  assert.equal(parseMode("BLOCK"), MODE.BLOCK);
  assert.equal(parseSide("for"), SIDE.FOR);
  assert.equal(parseCategory("concurrency"), CATEGORY.CONCURRENCY);
  assert.ok(idValid("EFA-001"));
  assert.equal(idValid("EFA-01"), false);
  assert.equal(idValid("EFA-00a"), false);
  assert.equal(idValid("EFA-0000000000000000000000000000000000"), false);
});

test("mode resolution: env wins, invalid is an error, never a silent fallback", () => {
  let m = modeResolve(null, true);
  assert.ok(m.ok && m.mode === MODE.BLOCK);
  m = modeResolve(null, false);
  assert.ok(m.ok && m.mode === MODE.OFF);
  m = modeResolve("shadow", true);
  assert.ok(m.ok && m.mode === MODE.SHADOW);
  m = modeResolve("off", true);
  assert.ok(m.ok && m.mode === MODE.OFF);
  m = modeResolve("strict", true);
  assert.equal(m.ok, false);
  assert.match(m.error, /DS4_EVIDENCE_MODE/);
});

/* ---- final-text scanner (WP24) ---- */

test("scanner: ids, sections and contract lines must match the ledger", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  completeChecks(s, "EFA-001");
  assert.ok(evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONFIRMED, SEVERITY.HIGH, true).allowed);
  openFinding(s, "EFA-002");
  assert.ok(evidenceSetVerdict(s, "EFA-002", FINDING_STATE.DISPROVED, SEVERITY.NONE, false).allowed);

  const good =
    "## Confirmed findings\n" +
    "### EFA-001 — callback race\n" +
    "State: CONFIRMED\n" +
    "**Severity:** HIGH\n" +
    "- Reachability: PROVEN\n" +
    "\n" +
    "## Disproved hypotheses\n" +
    "- EFA-002: the wrapper serializes every request.\n";
  assert.ok(evidenceScanFinalText(s, good).allowed);

  let r = evidenceScanFinalText(s, "### EFA-001\nSee also EFA-007.\n");
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.REPORT_UNKNOWN_ID);

  r = evidenceScanFinalText(s, "No findings.\n");
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.REPORT_MISSING_FINDING);

  r = evidenceScanFinalText(s, "## Confirmed findings\n### EFA-001\nState: CONFIRMED\n- EFA-002 race\n");
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.REPORT_DISPROVED_AS_FINDING);

  r = evidenceScanFinalText(s, "### EFA-001 — race\nSeverity: CRITICAL\n");
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.REPORT_SEVERITY_MISMATCH);

  r = evidenceScanFinalText(s, "### EFA-001 — race\nState: CONDITIONAL\n");
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.REPORT_STATE_MISMATCH);

  r = evidenceScanFinalText(s, "### EFA-001 — race\nReachability: CONDITIONAL\n");
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.REPORT_REACHABILITY_MISMATCH);

  /* Prose is not interpreted; EFA-0012x and EFA-12 are not id tokens. */
  assert.ok(evidenceScanFinalText(s, "EFA-001 mi sembra abbastanza grave.\n").allowed);
  assert.ok(evidenceScanFinalText(s, "EFA-001 vs EFA-12 and EFA-0012x\n").allowed);
});

/* ---- persistence (WP13) ---- */

test("serialize/deserialize round trip; finalize is never restored", () => {
  const s = fresh();
  openFinding(s, "EFA-001", CATEGORY.LIFETIME);
  assert.ok(evidenceAdd(s, "EFA-001", SIDE.FOR, false).allowed);
  assert.ok(evidenceSetVerdict(s, "EFA-001", FINDING_STATE.SUPPORTED, SEVERITY.LOW, true).allowed);
  s.findings[0].claim = 'use after free\nin "x" path % 100';
  assert.ok(evidenceFinalize(s).allowed);
  assert.ok(evidenceCanPublish(s).allowed);

  const text = evidenceSerialize(s);
  const back = fresh();
  const d = evidenceDeserialize(text, back);
  assert.ok(d.ok, d.error);
  assert.equal(back.findings.length, 1);
  assert.equal(back.findings[0].claim, s.findings[0].claim);
  assert.equal(back.findings[0].state, FINDING_STATE.SUPPORTED);
  assert.equal(back.findings[0].category, CATEGORY.LIFETIME);
  assert.equal(back.mutationSequence, s.mutationSequence);
  /* Fail closed: never restored as finalized. */
  const r = evidenceCanPublish(back);
  assert.equal(r.allowed, false);
  assert.equal(r.reasonCode, CODES.NOT_FINALIZED);
});

test("deserialize rejects malformed records whole, leaving state alone", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  const good = evidenceSerialize(s);
  const back = fresh();
  assert.ok(evidenceDeserialize(good, back).ok);

  const bad = [
    "garbage\n",
    "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 1\nend\n",
    "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 99\nend\n",
    "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 1\n" +
      "finding EFA-001 9 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -\nend\n",
    "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 1\n" +
      "finding EFA-001 0 0 0 0 0 0 0 0 1 1 0 0 0 0 0 0 -\nend\n",
    "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 1\n" +
      "finding EFA-001 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 zz\nend\n",
    "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 2\n" +
      "finding EFA-001 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -\n" +
      "finding EFA-001 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -\nend\n",
  ];
  for (const text of bad) {
    const keep = fresh();
    assert.ok(evidenceDeserialize(good, keep).ok);
    const before = evidenceSerialize(keep);
    const d = evidenceDeserialize(text, keep);
    assert.equal(d.ok, false, `must reject: ${text.slice(0, 40)}`);
    assert.equal(evidenceSerialize(keep), before, "state must be untouched");
  }
});

/* ---- rendering ---- */

test("digest and status carry the C markers", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  const d = evidenceDigest(s);
  assert.match(d, /\[EVIDENCE RUNTIME STATE\]/);
  assert.match(d, /EFA-001=CANDIDATE/);
  assert.match(d, /counterevidence pending/);
  assert.match(d, /Finalization: NOT_READY/);
  const st = evidenceStatus(s, MODE.BLOCK, "0123456789abcdef0123456789abcdef01234567");
  assert.match(st, /mode: block/);
  assert.match(st, /EvidenceFirst policy revision: 0123/);
  assert.match(st, /finding count: 1/);
  assert.match(st, /mutation sequence: 1/);
});

test("clear keeps metrics and enabled; the core contract stays bounded", () => {
  const s = fresh();
  openFinding(s, "EFA-001");
  evidenceFinalize(s);
  const metrics = { ...s.metrics };
  clearEvidenceState(s);
  assert.equal(s.findings.length, 0);
  assert.equal(s.enabled, true);
  assert.deepEqual(s.metrics, metrics);
  const contract = evidenceCoreContract();
  assert.ok(contract.length < 1024);
  assert.match(contract, /\[EVIDENCE-FIRST CORE CONTRACT\]/);
  assert.ok(evidenceOpenGuidance().length > 0);
});

/* ---- loop-facing helpers ---- */

test("evidence_guard tool: inactive without the skill, status is read-only", () => {
  const s = fresh();
  let out = evidenceGuardTool(s, createEvidenceTurn(), { action: "status" }, { skillLoaded: false, mode: MODE.BLOCK });
  assert.match(out, /EVIDENCE_SKILL_INACTIVE/);

  out = evidenceGuardTool(s, createEvidenceTurn(), {}, { skillLoaded: true, mode: MODE.BLOCK });
  assert.match(out, /requires action/);

  out = evidenceGuardTool(s, createEvidenceTurn(), { action: "status" }, { skillLoaded: true, mode: MODE.BLOCK, policyRevision: "abc" });
  assert.match(out, /EVIDENCE_STATUS/);
  assert.equal(s.enabled, true);
});

test("evidence_guard tool: open, ledger update, finalize, rejection shapes", () => {
  const s = fresh();
  const turn = createEvidenceTurn();
  const opts = { skillLoaded: true, mode: MODE.BLOCK, policyRevision: "abc" };
  let out = evidenceGuardTool(s, turn, { action: "open", id: "EFA-001", claim: "race" }, opts);
  assert.match(out, /EVIDENCE_FINDING_OPENED id=EFA-001 state=CANDIDATE/);
  assert.match(out, /Next required action: collect evidence and attempt falsification\./);
  out = evidenceGuardTool(s, turn, { action: "set_verdict", id: "EFA-001", state: "confirmed", severity: "low", include_in_report: "true" }, opts);
  assert.match(out, /^EVIDENCE_REJECTED\nreason=EVIDENCE_NO_EVIDENCE_FOR\nfinding=EFA-001\n/);
  assert.match(out, /EVIDENCE_REJECTED/);
  assert.match(out, /reason=EVIDENCE_NO_EVIDENCE_FOR/);
  assert.match(out, /finding=EFA-001/);
  assert.doesNotMatch(out, /Your final answer was withheld/);

  /* Nothing is include_in_report yet (the verdict was rejected), so an empty
   * report finalizes fine (T13). */
  out = evidenceGuardTool(s, turn, { action: "finalize" }, opts);
  assert.match(out, /EVIDENCE_FINALIZATION_READY/);

  completeChecks(s, "EFA-001");
  assert.ok(evidenceSetVerdict(s, "EFA-001", FINDING_STATE.CONFIRMED, SEVERITY.HIGH, true).allowed);
  out = evidenceGuardTool(s, turn, { action: "finalize" }, opts);
  assert.match(out, /EVIDENCE_FINALIZATION_READY\nsequence=/);
  assert.match(out, /Write the final report now; any other tool call voids this finalize\./);

  /* A reported CONFIRMED whose reachability later drops to unknown blocks a
   * re-finalize (finalize re-validates, not trusted from set_verdict). */
  assert.ok(evidenceSetReachability(s, "EFA-001", REACHABILITY.UNKNOWN).allowed);
  out = evidenceGuardTool(s, turn, { action: "finalize" }, opts);
  assert.match(out, /EVIDENCE_FINALIZATION_BLOCKED/);
  assert.match(out, /reason=EVIDENCE_REACHABILITY_UNKNOWN/);

  out = evidenceGuardTool(s, turn, { action: "nope" }, opts);
  assert.match(out, /EVIDENCE_BAD_ARGUMENT: unknown action/);
  out = evidenceGuardTool(s, turn, { action: "add_evidence", id: "EFA-001", side: "maybe" }, opts);
  assert.match(out, /side must be for or against/);
  out = evidenceGuardTool(s, turn, { action: "mark_check", id: "EFA-001", check: "vibes", result: "done" }, opts);
  assert.match(out, /unknown check/);
  out = evidenceGuardTool(s, turn, { action: "mark_check", id: "EFA-001", check: "caller", result: "skipped" }, opts);
  assert.match(out, /result must be done, not_applicable or unknown/);
  out = evidenceGuardTool(s, turn, { action: "set_reachability", id: "EFA-001", reachability: "maybe" }, opts);
  assert.match(out, /unknown reachability/);
  out = evidenceGuardTool(s, turn, { action: "set_verdict", id: "EFA-001", state: "probable" }, opts);
  assert.match(out, /unknown state/);
  out = evidenceGuardTool(s, turn, { action: "set_verdict", id: "EFA-001", state: "confirmed", severity: "severe" }, opts);
  assert.match(out, /unknown severity/);
});

test("gate: off ignores, shadow records and passes, block withholds; repair budget", () => {
  const s = fresh();
  // off: never looks
  let g = evidenceCheckFinal(s, MODE.OFF, true, "final answer");
  assert.ok(g.allowed);
  // no finalize yet: block withholds, shadow passes with one violation
  g = evidenceCheckFinal(s, MODE.BLOCK, true, "final answer");
  assert.equal(g.allowed, false);
  assert.equal(g.result.reasonCode, CODES.NOT_FINALIZED);
  g = evidenceCheckFinal(s, MODE.SHADOW, true, "final answer");
  assert.ok(g.allowed);
  assert.equal(s.metrics.shadowViolationsTotal, 1);
  // prose in front of a tool call is narration, not a final answer
  g = evidenceCheckFinal(s, MODE.BLOCK, false, "let me read the file");
  assert.ok(g.allowed);
  // finalize -> publish allowed
  assert.ok(evidenceFinalize(s).allowed);
  g = evidenceCheckFinal(s, MODE.BLOCK, true, "no findings");
  assert.ok(g.allowed);

  const guidance = evidenceRepairGuidance({ allowed: false, findingId: "EFA-001", missingChecks: CHECK.COUNTEREVIDENCE, reasonCode: CODES.NO_COUNTEREVIDENCE_SEARCH, detail: "detail line" });
  assert.match(guidance, /^EVIDENCE_FINALIZATION_BLOCKED\nreason=EVIDENCE_NO_COUNTEREVIDENCE_SEARCH\nfinding=EFA-001\nmissing=counterevidence\ndetail line\n/);
  assert.match(guidance, /Your final answer was withheld; the user has not seen it\./);
  assert.match(evidenceRejection("EVIDENCE_REJECTED", { allowed: false, findingId: "", missingChecks: 0, reasonCode: CODES.BAD_ID, detail: "" }), /^EVIDENCE_REJECTED\nreason=EVIDENCE_BAD_ID\n$/);
  assert.equal(EVIDENCE_MAX_REPAIR_ROUNDS, 2);
});

test("constants match the C header", () => {
  assert.equal(CHECK_ALL, 0x1ff);
  assert.equal(EVIDENCE_MAX_FINDINGS, 64);
  assert.equal(CHECK.FULL_CONTROL_FLOW, 1);
  assert.equal(CHECK.DYNAMIC_REPRODUCTION, 256);
  assert.equal(FINDING_STATE.UNKNOWN, 5);
  assert.equal(SEVERITY.CRITICAL, 5);
  assert.equal(REACHABILITY.NOT_REACHABLE, 3);
  assert.equal(CATEGORY.VALIDATION, 4);
});
