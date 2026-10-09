/* Evidence guard: pure state machine tests (piano WP20 T01-T13, section 27
 * regressions, section 45 negative tests, WP13 persistence, WP24 scanner).
 * Assertions are on reason codes, not on human text.
 *
 *   make -f Makefile.studio tests/ds4_agent_evidence_guard_test
 */
#include "ds4_agent_evidence_guard.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures;

#define CHECK(expr) do { \
    if (!(expr)) { \
        fprintf(stderr, "%s:%d: assertion failed: %s\n", \
                __FILE__, __LINE__, #expr); \
        failures++; \
    } \
} while (0)

#define CODE(r, c) CHECK((r).reason_code && !strcmp((r).reason_code, (c)))

static ds4_evidence_validation_result r;

static void open_finding(ds4_agent_evidence_state *s, const char *id,
                         ds4_evidence_category cat) {
    CHECK(ds4_agent_evidence_open(s, id, "claim under test", cat, &r));
}

static void mark(ds4_agent_evidence_state *s, const char *id, uint32_t check,
                 ds4_evidence_check_result res) {
    CHECK(ds4_agent_evidence_mark_check(s, id, check, res,
                                        res == DS4_EVIDENCE_CHECK_RESULT_NOT_APPLICABLE
                                            ? "not relevant: single caller" : NULL,
                                        &r));
}

/* Everything CONFIRMED needs for a general-category finding. */
static void complete_checks(ds4_agent_evidence_state *s, const char *id) {
    CHECK(ds4_agent_evidence_add(s, id, DS4_EVIDENCE_FOR, false, &r));
    CHECK(ds4_agent_evidence_add(s, id, DS4_EVIDENCE_AGAINST, false, &r));
    mark(s, id, DS4_EVIDENCE_CHECK_FULL_CONTROL_FLOW, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(s, id, DS4_EVIDENCE_CHECK_CALLER, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(s, id, DS4_EVIDENCE_CHECK_WRAPPER_OR_OUTER_GUARD,
         DS4_EVIDENCE_CHECK_RESULT_NOT_APPLICABLE);
    mark(s, id, DS4_EVIDENCE_CHECK_UPSTREAM_VALIDATION, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(s, id, DS4_EVIDENCE_CHECK_LIFETIME, DS4_EVIDENCE_CHECK_RESULT_NOT_APPLICABLE);
    mark(s, id, DS4_EVIDENCE_CHECK_CLEANUP_ERROR_PATH, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(s, id, DS4_EVIDENCE_CHECK_COUNTEREVIDENCE, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(s, id, DS4_EVIDENCE_CHECK_REACHABILITY, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(s, id, DS4_EVIDENCE_CHECK_DYNAMIC_REPRODUCTION, DS4_EVIDENCE_CHECK_RESULT_UNKNOWN);
    CHECK(ds4_agent_evidence_set_reachability(s, id, DS4_EVIDENCE_REACH_PROVEN, &r));
}

static void fresh(ds4_agent_evidence_state *s) {
    ds4_agent_evidence_init(s);
    s->enabled = true;
}

/* T01 */
static void test_candidate_high_rejected(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CANDIDATE,
                                          DS4_EVIDENCE_SEVERITY_HIGH, true, &r));
    CODE(r, EVIDENCE_HIGH_REQUIRES_CONFIRMED);
    CHECK(s.findings[0].severity == DS4_EVIDENCE_SEVERITY_NONE);
}

/* T02 */
static void test_supported_high_unknown_reach_rejected(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    CHECK(ds4_agent_evidence_add(&s, "EFA-001", DS4_EVIDENCE_FOR, false, &r));
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_SUPPORTED,
                                          DS4_EVIDENCE_SEVERITY_HIGH, true, &r));
    CODE(r, EVIDENCE_HIGH_REQUIRES_CONFIRMED);
    /* SUPPORTED at a modest severity is fine. */
    CHECK(ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_SUPPORTED,
                                         DS4_EVIDENCE_SEVERITY_LOW, true, &r));
}

/* T03: evidence against alone does not complete the falsification. */
static void test_confirmed_without_falsification_rejected(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    complete_checks(&s, "EFA-001");
    mark(&s, "EFA-001", DS4_EVIDENCE_CHECK_COUNTEREVIDENCE, DS4_EVIDENCE_CHECK_RESULT_UNKNOWN);
    CHECK(s.findings[0].evidence_against_searched);
    CHECK(!s.findings[0].counterevidence_completed);
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONFIRMED,
                                          DS4_EVIDENCE_SEVERITY_MEDIUM, true, &r));
    CODE(r, EVIDENCE_NO_COUNTEREVIDENCE_SEARCH);
    CHECK(r.missing_checks & DS4_EVIDENCE_CHECK_COUNTEREVIDENCE);
}

/* T04 */
static void test_confirmed_unknown_reach_rejected(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    complete_checks(&s, "EFA-001");
    CHECK(ds4_agent_evidence_set_reachability(&s, "EFA-001", DS4_EVIDENCE_REACH_UNKNOWN, &r));
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONFIRMED,
                                          DS4_EVIDENCE_SEVERITY_LOW, true, &r));
    CODE(r, EVIDENCE_REACHABILITY_UNKNOWN);
}

/* T05 */
static void test_confirmed_high_accepted(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    complete_checks(&s, "EFA-001");
    CHECK(ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONFIRMED,
                                         DS4_EVIDENCE_SEVERITY_HIGH, true, &r));
    CODE(r, EVIDENCE_OK);
    CHECK(ds4_agent_evidence_finalize(&s, &r));
    CHECK(ds4_agent_evidence_can_publish(&s, &r));
}

/* T06 */
static void test_disproved_in_report_rejected(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_DISPROVED,
                                          DS4_EVIDENCE_SEVERITY_NONE, true, &r));
    CODE(r, EVIDENCE_DISPROVED_IN_REPORT);
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_DISPROVED,
                                          DS4_EVIDENCE_SEVERITY_HIGH, false, &r));
    CODE(r, EVIDENCE_DISPROVED_SEVERITY);
    CHECK(ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_DISPROVED,
                                         DS4_EVIDENCE_SEVERITY_HARDENING, false, &r));
    CHECK(s.metrics.findings_disproved_total == 1);
}

/* T07 / T08 */
static void test_conditional_severity_cap(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    CHECK(ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONDITIONAL,
                                         DS4_EVIDENCE_SEVERITY_MEDIUM, true, &r));
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONDITIONAL,
                                          DS4_EVIDENCE_SEVERITY_HIGH, true, &r));
    CODE(r, EVIDENCE_CONDITIONAL_SEVERITY_CAP);
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONDITIONAL,
                                          DS4_EVIDENCE_SEVERITY_CRITICAL, true, &r));
    CODE(r, EVIDENCE_CONDITIONAL_SEVERITY_CAP);
    CHECK(s.findings[0].severity == DS4_EVIDENCE_SEVERITY_MEDIUM);
}

/* T09 */
static void test_mutation_after_finalize(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    CHECK(ds4_agent_evidence_finalize(&s, &r));
    CHECK(ds4_agent_evidence_can_publish(&s, &r));
    CHECK(ds4_agent_evidence_add(&s, "EFA-001", DS4_EVIDENCE_FOR, false, &r));
    CHECK(!ds4_agent_evidence_can_publish(&s, &r));
    CODE(r, EVIDENCE_FINALIZE_STALE);
}

/* T10 */
static void test_tool_after_finalize(void) {
    ds4_agent_evidence_state s;
    ds4_agent_evidence_turn turn;
    fresh(&s);
    ds4_agent_evidence_turn_reset(&turn);
    CHECK(ds4_agent_evidence_finalize(&s, &r));
    ds4_agent_evidence_note_tool_call(&s, &turn, true); /* status: read-only */
    CHECK(ds4_agent_evidence_can_publish(&s, &r));
    ds4_agent_evidence_note_tool_call(&s, &turn, false);
    CHECK(turn.tool_used_after_finalize);
    CHECK(!ds4_agent_evidence_can_publish(&s, &r));
    CODE(r, EVIDENCE_FINALIZE_STALE);
}

/* T11 */
static void test_refinalize(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    CHECK(ds4_agent_evidence_finalize(&s, &r));
    CHECK(ds4_agent_evidence_add(&s, "EFA-001", DS4_EVIDENCE_FOR, false, &r));
    CHECK(!ds4_agent_evidence_can_publish(&s, &r));
    CHECK(ds4_agent_evidence_finalize(&s, &r));
    CHECK(ds4_agent_evidence_can_publish(&s, &r));
    CHECK(s.finalized_sequence == s.mutation_sequence);
}

/* T12 */
static void test_unknown_high_rejected(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_UNKNOWN,
                                          DS4_EVIDENCE_SEVERITY_HIGH, true, &r));
    CODE(r, EVIDENCE_HIGH_REQUIRES_CONFIRMED);
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_UNKNOWN,
                                          DS4_EVIDENCE_SEVERITY_CRITICAL, true, &r));
}

/* T13: "nothing found" is a verdict only once finalize says so. */
static void test_empty_ledger(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    CHECK(!ds4_agent_evidence_can_publish(&s, &r));
    CODE(r, EVIDENCE_NOT_FINALIZED);
    CHECK(ds4_agent_evidence_finalize(&s, &r));
    CHECK(ds4_agent_evidence_can_publish(&s, &r));
}

/* Finalize re-validates: a reported CONFIRMED/HIGH whose reachability later
 * went back to unknown must not pass. */
static void test_finalize_revalidates(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    complete_checks(&s, "EFA-001");
    CHECK(ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONFIRMED,
                                         DS4_EVIDENCE_SEVERITY_HIGH, true, &r));
    CHECK(ds4_agent_evidence_set_reachability(&s, "EFA-001", DS4_EVIDENCE_REACH_UNKNOWN, &r));
    CHECK(!ds4_agent_evidence_finalize(&s, &r));
    CODE(r, EVIDENCE_REACHABILITY_UNKNOWN);
    CHECK(!strcmp(r.finding_id, "EFA-001"));
    CHECK(s.metrics.finalize_blocked_total == 1);
    CHECK(!ds4_agent_evidence_can_publish(&s, &r));
}

/* Section 27.1: unsynchronized callback, but the outer wrapper serializes. */
static void test_regression_outer_serialization(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_CONCURRENCY);
    CHECK(ds4_agent_evidence_add(&s, "EFA-001", DS4_EVIDENCE_FOR, false, &r));
    mark(&s, "EFA-001", DS4_EVIDENCE_CHECK_FULL_CONTROL_FLOW, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(&s, "EFA-001", DS4_EVIDENCE_CHECK_CALLER, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(&s, "EFA-001", DS4_EVIDENCE_CHECK_COUNTEREVIDENCE, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(&s, "EFA-001", DS4_EVIDENCE_CHECK_REACHABILITY, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(&s, "EFA-001", DS4_EVIDENCE_CHECK_DYNAMIC_REPRODUCTION, DS4_EVIDENCE_CHECK_RESULT_UNKNOWN);
    CHECK(ds4_agent_evidence_set_reachability(&s, "EFA-001", DS4_EVIDENCE_REACH_PROVEN, &r));
    /* Wrapper never inspected: concurrency cannot be CONFIRMED. */
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONFIRMED,
                                          DS4_EVIDENCE_SEVERITY_HIGH, true, &r));
    CODE(r, EVIDENCE_SPECIFIC_CHECK_UNRESOLVED);
    CHECK(r.missing_checks == DS4_EVIDENCE_CHECK_WRAPPER_OR_OUTER_GUARD);
    /* The wrapper is found to serialize: not reachable, disproved. */
    mark(&s, "EFA-001", DS4_EVIDENCE_CHECK_WRAPPER_OR_OUTER_GUARD, DS4_EVIDENCE_CHECK_RESULT_DONE);
    CHECK(ds4_agent_evidence_add(&s, "EFA-001", DS4_EVIDENCE_AGAINST, false, &r));
    CHECK(ds4_agent_evidence_set_reachability(&s, "EFA-001",
                                              DS4_EVIDENCE_REACH_NOT_REACHABLE, &r));
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONFIRMED,
                                          DS4_EVIDENCE_SEVERITY_HIGH, true, &r));
    CODE(r, EVIDENCE_HIGH_REQUIRES_REACHABLE);
    CHECK(ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_DISPROVED,
                                         DS4_EVIDENCE_SEVERITY_NONE, false, &r));
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_DISPROVED,
                                          DS4_EVIDENCE_SEVERITY_HIGH, false, &r));
    CHECK(ds4_agent_evidence_finalize(&s, &r));
}

/* Section 27.2: early return after cleanup -- the error path must be read. */
static void test_regression_cleanup_error_path(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-002", DS4_EVIDENCE_CATEGORY_CLEANUP);
    CHECK(ds4_agent_evidence_add(&s, "EFA-002", DS4_EVIDENCE_FOR, false, &r));
    mark(&s, "EFA-002", DS4_EVIDENCE_CHECK_FULL_CONTROL_FLOW, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(&s, "EFA-002", DS4_EVIDENCE_CHECK_CALLER, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(&s, "EFA-002", DS4_EVIDENCE_CHECK_COUNTEREVIDENCE, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(&s, "EFA-002", DS4_EVIDENCE_CHECK_REACHABILITY, DS4_EVIDENCE_CHECK_RESULT_DONE);
    mark(&s, "EFA-002", DS4_EVIDENCE_CHECK_DYNAMIC_REPRODUCTION, DS4_EVIDENCE_CHECK_RESULT_UNKNOWN);
    CHECK(ds4_agent_evidence_set_reachability(&s, "EFA-002", DS4_EVIDENCE_REACH_PROVEN, &r));
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-002", DS4_EVIDENCE_FINDING_CONFIRMED,
                                          DS4_EVIDENCE_SEVERITY_MEDIUM, true, &r));
    CODE(r, EVIDENCE_SPECIFIC_CHECK_UNRESOLVED);
    CHECK(r.missing_checks == DS4_EVIDENCE_CHECK_CLEANUP_ERROR_PATH);
    mark(&s, "EFA-002", DS4_EVIDENCE_CHECK_CLEANUP_ERROR_PATH, DS4_EVIDENCE_CHECK_RESULT_DONE);
    CHECK(ds4_agent_evidence_set_verdict(&s, "EFA-002", DS4_EVIDENCE_FINDING_CONFIRMED,
                                         DS4_EVIDENCE_SEVERITY_MEDIUM, true, &r));
}

/* Section 45 negative tests. */
static void test_negative_inputs(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    /* CONFIRMED on a finding that was never opened. */
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-009", DS4_EVIDENCE_FINDING_CONFIRMED,
                                          DS4_EVIDENCE_SEVERITY_LOW, true, &r));
    CODE(r, EVIDENCE_UNKNOWN_FINDING);
    CHECK(!ds4_agent_evidence_add(&s, "EFA-009", DS4_EVIDENCE_FOR, false, &r));
    CODE(r, EVIDENCE_UNKNOWN_FINDING);
    /* Ids. */
    CHECK(!ds4_agent_evidence_open(&s, "BUG-1", "x", DS4_EVIDENCE_CATEGORY_GENERAL, &r));
    CODE(r, EVIDENCE_BAD_ID);
    CHECK(!ds4_agent_evidence_open(&s, "EFA-01", "x", DS4_EVIDENCE_CATEGORY_GENERAL, &r));
    CODE(r, EVIDENCE_BAD_ID);
    CHECK(!ds4_agent_evidence_open(&s, "EFA-001", "", DS4_EVIDENCE_CATEGORY_GENERAL, &r));
    CODE(r, EVIDENCE_BAD_ARGUMENT);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    CHECK(!ds4_agent_evidence_open(&s, "EFA-001", "x", DS4_EVIDENCE_CATEGORY_GENERAL, &r));
    CODE(r, EVIDENCE_DUPLICATE_FINDING);
    /* Not-applicable rules. */
    CHECK(!ds4_agent_evidence_mark_check(&s, "EFA-001", DS4_EVIDENCE_CHECK_CALLER,
                                         DS4_EVIDENCE_CHECK_RESULT_NOT_APPLICABLE, "", &r));
    CODE(r, EVIDENCE_NA_REQUIRES_REASON);
    CHECK(!ds4_agent_evidence_mark_check(&s, "EFA-001", DS4_EVIDENCE_CHECK_COUNTEREVIDENCE,
                                         DS4_EVIDENCE_CHECK_RESULT_NOT_APPLICABLE,
                                         "nothing to search", &r));
    CODE(r, EVIDENCE_CHECK_NOT_WAIVABLE);
    CHECK(!ds4_agent_evidence_mark_check(&s, "EFA-001", 3u,
                                         DS4_EVIDENCE_CHECK_RESULT_DONE, NULL, &r));
    CODE(r, EVIDENCE_BAD_ARGUMENT);
    /* CRITICAL conditional. */
    CHECK(!ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONDITIONAL,
                                          DS4_EVIDENCE_SEVERITY_CRITICAL, true, &r));
    /* Overflow of the ledger. */
    ds4_agent_evidence_state full;
    fresh(&full);
    char id[16];
    for (int i = 0; i < DS4_EVIDENCE_MAX_FINDINGS; i++) {
        snprintf(id, sizeof(id), "EFA-%03d", i + 1);
        CHECK(ds4_agent_evidence_open(&full, id, "c", DS4_EVIDENCE_CATEGORY_GENERAL, &r));
    }
    CHECK(!ds4_agent_evidence_open(&full, "EFA-999", "c", DS4_EVIDENCE_CATEGORY_GENERAL, &r));
    CODE(r, EVIDENCE_LEDGER_FULL);
    /* Enum strings. */
    ds4_evidence_severity sev;
    ds4_evidence_finding_state st;
    ds4_evidence_reachability reach;
    uint32_t bit;
    ds4_evidence_check_result res;
    CHECK(ds4_evidence_severity_parse("high", &sev) && sev == DS4_EVIDENCE_SEVERITY_HIGH);
    CHECK(!ds4_evidence_severity_parse("severe", &sev));
    CHECK(ds4_evidence_state_parse("Confirmed", &st) && st == DS4_EVIDENCE_FINDING_CONFIRMED);
    CHECK(!ds4_evidence_state_parse("probable", &st));
    CHECK(ds4_evidence_reachability_parse("not-reachable", &reach) &&
          reach == DS4_EVIDENCE_REACH_NOT_REACHABLE);
    CHECK(!ds4_evidence_reachability_parse("maybe", &reach));
    CHECK(ds4_evidence_check_parse("wrapper", &bit) &&
          bit == DS4_EVIDENCE_CHECK_WRAPPER_OR_OUTER_GUARD);
    CHECK(!ds4_evidence_check_parse("vibes", &bit));
    CHECK(ds4_evidence_check_result_parse("not_applicable", &res));
    CHECK(!ds4_evidence_check_result_parse("skipped", &res));
}

static void test_mode_resolution(void) {
    ds4_evidence_mode m;
    char err[160];
    CHECK(ds4_evidence_mode_resolve(NULL, true, &m, err, sizeof(err)) &&
          m == DS4_EVIDENCE_MODE_BLOCK);
    CHECK(ds4_evidence_mode_resolve(NULL, false, &m, err, sizeof(err)) &&
          m == DS4_EVIDENCE_MODE_OFF);
    CHECK(ds4_evidence_mode_resolve("shadow", true, &m, err, sizeof(err)) &&
          m == DS4_EVIDENCE_MODE_SHADOW);
    CHECK(ds4_evidence_mode_resolve("off", true, &m, err, sizeof(err)) &&
          m == DS4_EVIDENCE_MODE_OFF);
    /* invalid mode: an error, never a silent fallback */
    CHECK(!ds4_evidence_mode_resolve("strict", true, &m, err, sizeof(err)));
    CHECK(strstr(err, "DS4_EVIDENCE_MODE") != NULL);
}

static void test_scanner(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    complete_checks(&s, "EFA-001");
    CHECK(ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_CONFIRMED,
                                         DS4_EVIDENCE_SEVERITY_HIGH, true, &r));
    open_finding(&s, "EFA-002", DS4_EVIDENCE_CATEGORY_GENERAL);
    CHECK(ds4_agent_evidence_set_verdict(&s, "EFA-002", DS4_EVIDENCE_FINDING_DISPROVED,
                                         DS4_EVIDENCE_SEVERITY_NONE, false, &r));

    const char *good =
        "## Confirmed findings\n"
        "### EFA-001 — callback race\n"
        "State: CONFIRMED\n"
        "**Severity:** HIGH\n"
        "- Reachability: PROVEN\n"
        "\n"
        "## Disproved hypotheses\n"
        "- EFA-002: the wrapper serializes every request.\n";
    CHECK(ds4_agent_evidence_scan_final_text(&s, good, &r));

    CHECK(!ds4_agent_evidence_scan_final_text(&s, "### EFA-001\nSee also EFA-007.\n", &r));
    CODE(r, EVIDENCE_REPORT_UNKNOWN_ID);

    CHECK(!ds4_agent_evidence_scan_final_text(&s, "No findings.\n", &r));
    CODE(r, EVIDENCE_REPORT_MISSING_FINDING);

    CHECK(!ds4_agent_evidence_scan_final_text(
        &s, "## Confirmed findings\n### EFA-001\nState: CONFIRMED\n- EFA-002 race\n", &r));
    CODE(r, EVIDENCE_REPORT_DISPROVED_AS_FINDING);

    CHECK(!ds4_agent_evidence_scan_final_text(
        &s, "### EFA-001 — race\nSeverity: CRITICAL\n", &r));
    CODE(r, EVIDENCE_REPORT_SEVERITY_MISMATCH);

    CHECK(!ds4_agent_evidence_scan_final_text(
        &s, "### EFA-001 — race\nState: CONDITIONAL\n", &r));
    CODE(r, EVIDENCE_REPORT_STATE_MISMATCH);

    CHECK(!ds4_agent_evidence_scan_final_text(
        &s, "### EFA-001 — race\nReachability: CONDITIONAL\n", &r));
    CODE(r, EVIDENCE_REPORT_REACHABILITY_MISMATCH);

    /* Prose is not interpreted: "sembra grave" is not a severity. */
    CHECK(ds4_agent_evidence_scan_final_text(
        &s, "EFA-001 mi sembra abbastanza grave.\n", &r));
    /* EFA-0012x is not an id token; EFA-12 is too short to be one. */
    CHECK(ds4_agent_evidence_scan_final_text(&s, "EFA-001 vs EFA-12 and EFA-0012x\n", &r));
}

static void test_persistence(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_LIFETIME);
    CHECK(ds4_agent_evidence_add(&s, "EFA-001", DS4_EVIDENCE_FOR, false, &r));
    CHECK(ds4_agent_evidence_set_verdict(&s, "EFA-001", DS4_EVIDENCE_FINDING_SUPPORTED,
                                         DS4_EVIDENCE_SEVERITY_LOW, true, &r));
    snprintf(s.findings[0].claim, sizeof(s.findings[0].claim),
             "use after free\nin \"x\" path %% 100");
    CHECK(ds4_agent_evidence_finalize(&s, &r));
    CHECK(ds4_agent_evidence_can_publish(&s, &r));

    char *text = NULL;
    size_t len = 0;
    CHECK(ds4_agent_evidence_serialize(&s, &text, &len));
    ds4_agent_evidence_state back;
    fresh(&back);
    char err[160] = {0};
    CHECK(ds4_agent_evidence_deserialize(text, len, &back, err, sizeof(err)));
    CHECK(back.finding_count == 1);
    CHECK(!strcmp(back.findings[0].claim, s.findings[0].claim));
    CHECK(back.findings[0].state == DS4_EVIDENCE_FINDING_SUPPORTED);
    CHECK(back.findings[0].category == DS4_EVIDENCE_CATEGORY_LIFETIME);
    CHECK(back.mutation_sequence == s.mutation_sequence);
    /* Fail closed: never restored as finalized. */
    CHECK(!ds4_agent_evidence_can_publish(&back, &r));
    CODE(r, EVIDENCE_NOT_FINALIZED);

    /* Malformed records are rejected whole and leave the state alone. */
    const char *bad[] = {
        "garbage\n",
        "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 1\nend\n",
        "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 99\nend\n",
        "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 1\n"
        "finding EFA-001 9 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -\nend\n",
        "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 1\n"
        "finding EFA-001 0 0 0 0 0 0 0 0 1 1 0 0 0 0 0 0 -\nend\n",
        "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 1\n"
        "finding EFA-001 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 zz\nend\n",
        "DS4_EVIDENCE_STATE_V1\nsequence 1\ncount 2\n"
        "finding EFA-001 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -\n"
        "finding EFA-001 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -\nend\n",
    };
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
        ds4_agent_evidence_state keep = back;
        CHECK(!ds4_agent_evidence_deserialize(bad[i], strlen(bad[i]), &keep,
                                              err, sizeof(err)));
        CHECK(keep.finding_count == back.finding_count);
    }
    free(text);
}

static void test_digest_and_status(void) {
    ds4_agent_evidence_state s;
    fresh(&s);
    open_finding(&s, "EFA-001", DS4_EVIDENCE_CATEGORY_GENERAL);
    char buf[2048];
    ds4_agent_evidence_digest(&s, buf, sizeof(buf));
    CHECK(strstr(buf, "[EVIDENCE RUNTIME STATE]") != NULL);
    CHECK(strstr(buf, "EFA-001=CANDIDATE") != NULL);
    CHECK(strstr(buf, "counterevidence pending") != NULL);
    CHECK(strstr(buf, "Finalization: NOT_READY") != NULL);
    ds4_agent_evidence_status(&s, DS4_EVIDENCE_MODE_BLOCK,
                              "0123456789abcdef0123456789abcdef01234567",
                              buf, sizeof(buf));
    CHECK(strstr(buf, "mode: block") != NULL);
    CHECK(strstr(buf, "EvidenceFirst policy revision: 0123") != NULL);
    CHECK(strstr(buf, "finding count: 1") != NULL);
    CHECK(strstr(buf, "mutation sequence: 1") != NULL);
    /* A tiny buffer truncates, never overflows. */
    char tiny[8];
    ds4_agent_evidence_digest(&s, tiny, sizeof(tiny));
    CHECK(strlen(tiny) < sizeof(tiny));
    /* The core contract stays abstract and bounded. */
    CHECK(strlen(ds4_agent_evidence_core_contract) < 1024);
    CHECK(strstr(ds4_agent_evidence_core_contract, "[EVIDENCE-FIRST CORE CONTRACT]") != NULL);
}

int main(void) {
    test_candidate_high_rejected();
    test_supported_high_unknown_reach_rejected();
    test_confirmed_without_falsification_rejected();
    test_confirmed_unknown_reach_rejected();
    test_confirmed_high_accepted();
    test_disproved_in_report_rejected();
    test_conditional_severity_cap();
    test_mutation_after_finalize();
    test_tool_after_finalize();
    test_refinalize();
    test_unknown_high_rejected();
    test_empty_ledger();
    test_finalize_revalidates();
    test_regression_outer_serialization();
    test_regression_cleanup_error_path();
    test_negative_inputs();
    test_mode_resolution();
    test_scanner();
    test_persistence();
    test_digest_and_status();
    if (failures) {
        fprintf(stderr, "evidence guard tests: %d failure(s)\n", failures);
        return 1;
    }
    puts("evidence guard tests: ok");
    return 0;
}
