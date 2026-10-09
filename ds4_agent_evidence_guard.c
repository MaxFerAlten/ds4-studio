/* Evidence-First runtime ledger.  See ds4_agent_evidence_guard.h. */
#include "ds4_agent_evidence_guard.h"

#include <ctype.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

const char ds4_agent_evidence_core_contract[] =
    "[EVIDENCE-FIRST CORE CONTRACT]\n"
    "1. Observation is not proof.\n"
    "2. Trace the relevant end-to-end path.\n"
    "3. Inspect callers, wrappers, guards, validation, lifecycle and cleanup.\n"
    "4. Actively search for evidence that disproves the hypothesis.\n"
    "5. Never infer global absence from local absence.\n"
    "6. Never infer reachability from a locally unsafe function.\n"
    "7. Distinguish CANDIDATE, SUPPORTED, CONFIRMED, CONDITIONAL, DISPROVED, UNKNOWN.\n"
    "8. HIGH/CRITICAL requires CONFIRMED plus proven reachability.\n"
    "9. Static evidence is not dynamic reproduction.\n"
    "10. Disproved findings cannot survive as final findings.\n"
    "11. State unexamined coverage.\n"
    "12. Before verdict: evidence -> falsification -> reachability -> verdict.\n"
    "[/EVIDENCE-FIRST CORE CONTRACT]\n";

const char ds4_agent_evidence_open_guidance[] =
    "Before verdict:\n"
    "- inspect the complete relevant control flow;\n"
    "- inspect callers/wrappers;\n"
    "- search for a mechanism that would make this claim false;\n"
    "- do not promote the finding until reachability is known.\n";

/* ---- small helpers -------------------------------------------------------- */

static void result_set(ds4_evidence_validation_result *out, bool allowed,
                       const char *code, const char *id, uint32_t missing,
                       const char *fmt, ...) {
    if (!out) return;
    memset(out, 0, sizeof(*out));
    out->allowed = allowed;
    out->reason_code = code;
    out->missing_checks = missing;
    if (id) snprintf(out->finding_id, sizeof(out->finding_id), "%s", id);
    if (fmt) {
        va_list ap;
        va_start(ap, fmt);
        vsnprintf(out->detail, sizeof(out->detail), fmt, ap);
        va_end(ap);
    }
}

static bool ok(ds4_evidence_validation_result *out, const char *id) {
    result_set(out, true, EVIDENCE_OK, id, 0, NULL);
    return true;
}

static bool text_ieq(const char *a, const char *b) {
    if (!a || !b) return false;
    for (; *a && *b; a++, b++) {
        char ca = (char)tolower((unsigned char)*a);
        char cb = (char)tolower((unsigned char)*b);
        if (ca == '-' || ca == ' ') ca = '_';
        if (cb == '-' || cb == ' ') cb = '_';
        if (ca != cb) return false;
    }
    return *a == *b;
}

static ds4_evidence_finding *find_mut(ds4_agent_evidence_state *state,
                                      const char *id) {
    if (!state || !id) return NULL;
    for (size_t i = 0; i < state->finding_count; i++)
        if (!strcmp(state->findings[i].id, id)) return &state->findings[i];
    return NULL;
}

const ds4_evidence_finding *
ds4_agent_evidence_find(const ds4_agent_evidence_state *state, const char *id) {
    return find_mut((ds4_agent_evidence_state *)(uintptr_t)state, id);
}

/* Every accepted change goes through here: it is what makes a finalize stale. */
static void mutate(ds4_agent_evidence_state *state, ds4_evidence_finding *f) {
    if (state->finalized || state->finalization_valid) {
        state->finalize_invalidated = true;
        state->metrics.finalize_invalidated_total++;
    }
    state->mutation_sequence++;
    state->finalized = false;
    state->finalization_valid = false;
    if (f) f->revision++;
}

/* ---- enums <-> strings ---------------------------------------------------- */

static const char *const MODE_NAMES[] = {"off", "shadow", "block"};
static const char *const STATE_NAMES[] = {
    "CANDIDATE", "SUPPORTED", "CONFIRMED", "CONDITIONAL", "DISPROVED", "UNKNOWN"};
static const char *const SEVERITY_NAMES[] = {
    "NONE", "HARDENING", "LOW", "MEDIUM", "HIGH", "CRITICAL"};
static const char *const REACH_NAMES[] = {
    "UNKNOWN", "CONDITIONAL", "PROVEN", "NOT_REACHABLE"};
static const char *const CATEGORY_NAMES[] = {
    "general", "concurrency", "lifetime", "cleanup", "validation"};

static const struct {
    const char *name;
    uint32_t bit;
} CHECKS[] = {
    {"control_flow", DS4_EVIDENCE_CHECK_FULL_CONTROL_FLOW},
    {"caller", DS4_EVIDENCE_CHECK_CALLER},
    {"wrapper", DS4_EVIDENCE_CHECK_WRAPPER_OR_OUTER_GUARD},
    {"validation", DS4_EVIDENCE_CHECK_UPSTREAM_VALIDATION},
    {"lifetime", DS4_EVIDENCE_CHECK_LIFETIME},
    {"cleanup", DS4_EVIDENCE_CHECK_CLEANUP_ERROR_PATH},
    {"counterevidence", DS4_EVIDENCE_CHECK_COUNTEREVIDENCE},
    {"reachability", DS4_EVIDENCE_CHECK_REACHABILITY},
    {"dynamic", DS4_EVIDENCE_CHECK_DYNAMIC_REPRODUCTION},
};
#define CHECK_COUNT (sizeof(CHECKS) / sizeof(CHECKS[0]))

#define PARSE_TABLE(table, text, out, type) do { \
    if (!(text)) return false; \
    for (size_t i_ = 0; i_ < sizeof(table) / sizeof(table[0]); i_++) \
        if (text_ieq((text), table[i_])) { *(out) = (type)i_; return true; } \
    return false; \
} while (0)

#define NAME_TABLE(table, value) \
    ((unsigned)(value) < sizeof(table) / sizeof(table[0]) ? table[value] : "?")

bool ds4_evidence_mode_parse(const char *text, ds4_evidence_mode *out) {
    PARSE_TABLE(MODE_NAMES, text, out, ds4_evidence_mode);
}
const char *ds4_evidence_mode_name(ds4_evidence_mode mode) {
    return NAME_TABLE(MODE_NAMES, mode);
}
bool ds4_evidence_state_parse(const char *text, ds4_evidence_finding_state *out) {
    PARSE_TABLE(STATE_NAMES, text, out, ds4_evidence_finding_state);
}
const char *ds4_evidence_state_name(ds4_evidence_finding_state state) {
    return NAME_TABLE(STATE_NAMES, state);
}
bool ds4_evidence_severity_parse(const char *text, ds4_evidence_severity *out) {
    PARSE_TABLE(SEVERITY_NAMES, text, out, ds4_evidence_severity);
}
const char *ds4_evidence_severity_name(ds4_evidence_severity severity) {
    return NAME_TABLE(SEVERITY_NAMES, severity);
}
bool ds4_evidence_reachability_parse(const char *text,
                                     ds4_evidence_reachability *out) {
    PARSE_TABLE(REACH_NAMES, text, out, ds4_evidence_reachability);
}
const char *ds4_evidence_reachability_name(ds4_evidence_reachability reach) {
    return NAME_TABLE(REACH_NAMES, reach);
}
bool ds4_evidence_category_parse(const char *text, ds4_evidence_category *out) {
    PARSE_TABLE(CATEGORY_NAMES, text, out, ds4_evidence_category);
}
const char *ds4_evidence_category_name(ds4_evidence_category category) {
    return NAME_TABLE(CATEGORY_NAMES, category);
}

bool ds4_evidence_check_parse(const char *text, uint32_t *check_bit) {
    if (!text) return false;
    for (size_t i = 0; i < CHECK_COUNT; i++)
        if (text_ieq(text, CHECKS[i].name)) { *check_bit = CHECKS[i].bit; return true; }
    return false;
}

const char *ds4_evidence_check_name(uint32_t check_bit) {
    for (size_t i = 0; i < CHECK_COUNT; i++)
        if (CHECKS[i].bit == check_bit) return CHECKS[i].name;
    return "?";
}

bool ds4_evidence_check_result_parse(const char *text,
                                     ds4_evidence_check_result *out) {
    if (!text) return false;
    if (text_ieq(text, "done")) *out = DS4_EVIDENCE_CHECK_RESULT_DONE;
    else if (text_ieq(text, "not_applicable") || text_ieq(text, "n/a"))
        *out = DS4_EVIDENCE_CHECK_RESULT_NOT_APPLICABLE;
    else if (text_ieq(text, "unknown") || text_ieq(text, "not_done"))
        *out = DS4_EVIDENCE_CHECK_RESULT_UNKNOWN;
    else return false;
    return true;
}

bool ds4_evidence_mode_resolve(const char *env_value, bool skill_active,
                               ds4_evidence_mode *out,
                               char *err, size_t err_len) {
    if (env_value && env_value[0]) {
        if (ds4_evidence_mode_parse(env_value, out)) return true;
        if (err && err_len)
            snprintf(err, err_len,
                     "DS4_EVIDENCE_MODE=%s is invalid (expected off, shadow or block)",
                     env_value);
        return false;
    }
    *out = skill_active ? DS4_EVIDENCE_MODE_BLOCK : DS4_EVIDENCE_MODE_OFF;
    return true;
}

/* EFA-001 style: the report contract (WP11) mentions findings by these ids,
 * and the deterministic scanner can only match what has a fixed shape. */
bool ds4_evidence_id_valid(const char *id) {
    if (!id || strncmp(id, "EFA-", 4)) return false;
    size_t digits = 0;
    for (const char *p = id + 4; *p; p++) {
        if (!isdigit((unsigned char)*p)) return false;
        digits++;
    }
    return digits >= 3 && strlen(id) < DS4_EVIDENCE_ID_MAX;
}

/* ---- lifecycle ------------------------------------------------------------ */

void ds4_agent_evidence_init(ds4_agent_evidence_state *state) {
    if (!state) return;
    memset(state, 0, sizeof(*state));
}

void ds4_agent_evidence_clear(ds4_agent_evidence_state *state) {
    if (!state) return;
    ds4_evidence_metrics metrics = state->metrics;
    bool enabled = state->enabled;
    memset(state, 0, sizeof(*state));
    state->metrics = metrics;
    state->enabled = enabled;
}

void ds4_agent_evidence_turn_reset(ds4_agent_evidence_turn *turn) {
    if (turn) memset(turn, 0, sizeof(*turn));
}

/* ---- invariants ----------------------------------------------------------- */

static bool check_resolved(const ds4_evidence_finding *f, uint32_t bit) {
    return (f->checks_done | f->checks_not_applicable) & bit;
}

static bool check_recorded(const ds4_evidence_finding *f, uint32_t bit) {
    return (f->checks_done | f->checks_not_applicable | f->checks_unknown) & bit;
}

/* The specific checks a category adds on top of the general ones. */
static uint32_t category_checks(ds4_evidence_category category) {
    switch (category) {
    case DS4_EVIDENCE_CATEGORY_CONCURRENCY:
        return DS4_EVIDENCE_CHECK_WRAPPER_OR_OUTER_GUARD;
    case DS4_EVIDENCE_CATEGORY_LIFETIME:
        return DS4_EVIDENCE_CHECK_LIFETIME;
    case DS4_EVIDENCE_CATEGORY_CLEANUP:
        return DS4_EVIDENCE_CHECK_CLEANUP_ERROR_PATH;
    case DS4_EVIDENCE_CATEGORY_VALIDATION:
        return DS4_EVIDENCE_CHECK_UPSTREAM_VALIDATION;
    case DS4_EVIDENCE_CATEGORY_GENERAL:
    default:
        /* Unknown category: conservative, all of them must be resolved. */
        return DS4_EVIDENCE_CHECK_WRAPPER_OR_OUTER_GUARD |
               DS4_EVIDENCE_CHECK_UPSTREAM_VALIDATION |
               DS4_EVIDENCE_CHECK_LIFETIME |
               DS4_EVIDENCE_CHECK_CLEANUP_ERROR_PATH;
    }
}

/* What CONFIRMED still needs (section 7.1).  Returns the first missing item
 * as the reason code and every missing check in the mask. */
static bool confirm_ready(const ds4_evidence_finding *f,
                          ds4_evidence_validation_result *out) {
    const char *code = NULL;
    uint32_t missing = 0;

#define MISSING(cond, c, bits) do { \
    if (cond) { if (!code) code = (c); missing |= (bits); } \
} while (0)

    MISSING(!f->evidence_for_present, EVIDENCE_NO_EVIDENCE_FOR, 0);
    MISSING(!f->counterevidence_completed ||
                !(f->checks_done & DS4_EVIDENCE_CHECK_COUNTEREVIDENCE),
            EVIDENCE_NO_COUNTEREVIDENCE_SEARCH, DS4_EVIDENCE_CHECK_COUNTEREVIDENCE);
    MISSING(!check_resolved(f, DS4_EVIDENCE_CHECK_FULL_CONTROL_FLOW),
            EVIDENCE_CONTROL_FLOW_UNCHECKED, DS4_EVIDENCE_CHECK_FULL_CONTROL_FLOW);
    MISSING(!check_resolved(f, DS4_EVIDENCE_CHECK_CALLER),
            EVIDENCE_CALLER_UNCHECKED, DS4_EVIDENCE_CHECK_CALLER);
    uint32_t specific = category_checks(f->category);
    for (size_t i = 0; i < CHECK_COUNT; i++)
        MISSING((specific & CHECKS[i].bit) && !check_resolved(f, CHECKS[i].bit),
                EVIDENCE_SPECIFIC_CHECK_UNRESOLVED, CHECKS[i].bit);
    MISSING(!(f->checks_done & DS4_EVIDENCE_CHECK_REACHABILITY),
            EVIDENCE_REACHABILITY_UNCHECKED, DS4_EVIDENCE_CHECK_REACHABILITY);
    MISSING(f->reachability == DS4_EVIDENCE_REACH_UNKNOWN,
            EVIDENCE_REACHABILITY_UNKNOWN, DS4_EVIDENCE_CHECK_REACHABILITY);
    MISSING(!check_recorded(f, DS4_EVIDENCE_CHECK_DYNAMIC_REPRODUCTION),
            EVIDENCE_DYNAMIC_STATUS_UNSET, DS4_EVIDENCE_CHECK_DYNAMIC_REPRODUCTION);
#undef MISSING

    if (!code) return true;
    char names[256] = {0};
    size_t used = 0;
    for (size_t i = 0; i < CHECK_COUNT; i++) {
        if (!(missing & CHECKS[i].bit)) continue;
        int n = snprintf(names + used, sizeof(names) - used, "%s%s",
                         used ? "," : "", CHECKS[i].name);
        if (n < 0 || (size_t)n >= sizeof(names) - used) break;
        used += (size_t)n;
    }
    result_set(out, false, code, f->id, missing,
               "finding=%s cannot be CONFIRMED: %s%s%s", f->id, code,
               used ? " missing=" : "", names);
    return false;
}

/* State / severity / report compatibility (sections 7.2-7.5). */
static bool verdict_compatible(const ds4_evidence_finding *f,
                               ds4_evidence_finding_state verdict,
                               ds4_evidence_severity severity,
                               bool include,
                               ds4_evidence_validation_result *out) {
    if (verdict == DS4_EVIDENCE_FINDING_DISPROVED) {
        if (include) {
            result_set(out, false, EVIDENCE_DISPROVED_IN_REPORT, f->id, 0,
                       "finding=%s is DISPROVED and cannot be reported as a finding",
                       f->id);
            return false;
        }
        if (severity > DS4_EVIDENCE_SEVERITY_HARDENING) {
            result_set(out, false, EVIDENCE_DISPROVED_SEVERITY, f->id, 0,
                       "finding=%s is DISPROVED: severity must be NONE or HARDENING",
                       f->id);
            return false;
        }
        return true;
    }
    if (verdict == DS4_EVIDENCE_FINDING_CONDITIONAL &&
        severity > DS4_EVIDENCE_SEVERITY_MEDIUM) {
        result_set(out, false, EVIDENCE_CONDITIONAL_SEVERITY_CAP, f->id, 0,
                   "finding=%s is CONDITIONAL: severity is capped at MEDIUM", f->id);
        return false;
    }
    if (severity >= DS4_EVIDENCE_SEVERITY_HIGH) {
        if (verdict != DS4_EVIDENCE_FINDING_CONFIRMED) {
            result_set(out, false, EVIDENCE_HIGH_REQUIRES_CONFIRMED, f->id, 0,
                       "finding=%s: %s requires CONFIRMED (state is %s)", f->id,
                       ds4_evidence_severity_name(severity),
                       ds4_evidence_state_name(verdict));
            return false;
        }
        if (f->reachability != DS4_EVIDENCE_REACH_PROVEN) {
            result_set(out, false, EVIDENCE_HIGH_REQUIRES_REACHABLE, f->id,
                       DS4_EVIDENCE_CHECK_REACHABILITY,
                       "finding=%s: %s requires reachability PROVEN (is %s)", f->id,
                       ds4_evidence_severity_name(severity),
                       ds4_evidence_reachability_name(f->reachability));
            return false;
        }
        if (!f->counterevidence_completed) {
            result_set(out, false, EVIDENCE_NO_COUNTEREVIDENCE_SEARCH, f->id,
                       DS4_EVIDENCE_CHECK_COUNTEREVIDENCE,
                       "finding=%s: %s requires a completed counterevidence search",
                       f->id, ds4_evidence_severity_name(severity));
            return false;
        }
    }
    return true;
}

/* ---- ledger operations ---------------------------------------------------- */

static ds4_evidence_finding *require_finding(ds4_agent_evidence_state *state,
                                             const char *id,
                                             ds4_evidence_validation_result *out) {
    ds4_evidence_finding *f = find_mut(state, id);
    if (!f)
        result_set(out, false, EVIDENCE_UNKNOWN_FINDING, id, 0,
                   "finding=%s is not in the ledger; open it first", id ? id : "");
    return f;
}

bool ds4_agent_evidence_open(ds4_agent_evidence_state *state,
                             const char *id, const char *claim,
                             ds4_evidence_category category,
                             ds4_evidence_validation_result *out) {
    if (!state) return false;
    if (!ds4_evidence_id_valid(id)) {
        result_set(out, false, EVIDENCE_BAD_ID, NULL, 0,
                   "finding id must look like EFA-001 (got %s)", id ? id : "nothing");
        return false;
    }
    if (!claim || !claim[0]) {
        result_set(out, false, EVIDENCE_BAD_ARGUMENT, id, 0,
                   "finding=%s needs a non-empty claim", id);
        return false;
    }
    if (find_mut(state, id)) {
        result_set(out, false, EVIDENCE_DUPLICATE_FINDING, id, 0,
                   "finding=%s is already open", id);
        return false;
    }
    if (state->finding_count >= DS4_EVIDENCE_MAX_FINDINGS) {
        result_set(out, false, EVIDENCE_LEDGER_FULL, id, 0,
                   "the ledger holds at most %d findings", DS4_EVIDENCE_MAX_FINDINGS);
        return false;
    }
    ds4_evidence_finding *f = &state->findings[state->finding_count++];
    memset(f, 0, sizeof(*f));
    snprintf(f->id, sizeof(f->id), "%s", id);
    snprintf(f->claim, sizeof(f->claim), "%s", claim);
    f->state = DS4_EVIDENCE_FINDING_CANDIDATE;
    f->category = category;
    state->metrics.findings_opened_total++;
    mutate(state, f);
    return ok(out, id);
}

bool ds4_agent_evidence_add(ds4_agent_evidence_state *state,
                            const char *id, ds4_evidence_side side,
                            bool dynamic_source,
                            ds4_evidence_validation_result *out) {
    ds4_evidence_finding *f = require_finding(state, id, out);
    if (!f) return false;
    if (side == DS4_EVIDENCE_FOR) {
        f->evidence_for_present = true;
        f->evidence_for_count++;
        if (!dynamic_source) f->static_evidence_present = true;
    } else {
        /* Evidence against is recorded, but it does not complete the
         * counterevidence check: that has to be marked done explicitly. */
        f->evidence_against_searched = true;
        f->evidence_against_count++;
    }
    mutate(state, f);
    return ok(out, id);
}

bool ds4_agent_evidence_mark_check(ds4_agent_evidence_state *state,
                                   const char *id, uint32_t check_bit,
                                   ds4_evidence_check_result result,
                                   const char *note,
                                   ds4_evidence_validation_result *out) {
    ds4_evidence_finding *f = require_finding(state, id, out);
    if (!f) return false;
    if (!check_bit || (check_bit & (check_bit - 1)) ||
        (check_bit & ~DS4_EVIDENCE_CHECK_ALL)) {
        result_set(out, false, EVIDENCE_BAD_ARGUMENT, id, 0, "unknown check");
        return false;
    }
    if (result == DS4_EVIDENCE_CHECK_RESULT_NOT_APPLICABLE) {
        if (check_bit == DS4_EVIDENCE_CHECK_COUNTEREVIDENCE ||
            check_bit == DS4_EVIDENCE_CHECK_REACHABILITY) {
            result_set(out, false, EVIDENCE_CHECK_NOT_WAIVABLE, id, check_bit,
                       "finding=%s: the %s check cannot be not_applicable",
                       id, ds4_evidence_check_name(check_bit));
            return false;
        }
        if (!note || !note[0]) {
            result_set(out, false, EVIDENCE_NA_REQUIRES_REASON, id, check_bit,
                       "finding=%s: not_applicable for %s needs a note saying why",
                       id, ds4_evidence_check_name(check_bit));
            return false;
        }
    }
    f->checks_done &= ~check_bit;
    f->checks_not_applicable &= ~check_bit;
    f->checks_unknown &= ~check_bit;
    switch (result) {
    case DS4_EVIDENCE_CHECK_RESULT_DONE:
        f->checks_done |= check_bit;
        break;
    case DS4_EVIDENCE_CHECK_RESULT_NOT_APPLICABLE:
        f->checks_not_applicable |= check_bit;
        break;
    case DS4_EVIDENCE_CHECK_RESULT_UNKNOWN:
    default:
        f->checks_unknown |= check_bit;
        break;
    }
    if (check_bit == DS4_EVIDENCE_CHECK_COUNTEREVIDENCE)
        f->counterevidence_completed = result == DS4_EVIDENCE_CHECK_RESULT_DONE;
    if (check_bit == DS4_EVIDENCE_CHECK_DYNAMIC_REPRODUCTION)
        f->dynamically_reproduced = result == DS4_EVIDENCE_CHECK_RESULT_DONE;
    mutate(state, f);
    return ok(out, id);
}

bool ds4_agent_evidence_set_reachability(ds4_agent_evidence_state *state,
                                         const char *id,
                                         ds4_evidence_reachability reach,
                                         ds4_evidence_validation_result *out) {
    ds4_evidence_finding *f = require_finding(state, id, out);
    if (!f) return false;
    if ((unsigned)reach > DS4_EVIDENCE_REACH_NOT_REACHABLE) {
        result_set(out, false, EVIDENCE_BAD_ARGUMENT, id, 0, "unknown reachability");
        return false;
    }
    f->reachability = reach;
    mutate(state, f);
    return ok(out, id);
}

bool ds4_agent_evidence_set_verdict(ds4_agent_evidence_state *state,
                                    const char *id,
                                    ds4_evidence_finding_state verdict,
                                    ds4_evidence_severity severity,
                                    bool include_in_report,
                                    ds4_evidence_validation_result *out) {
    ds4_evidence_finding *f = require_finding(state, id, out);
    if (!f) return false;
    if ((unsigned)verdict > DS4_EVIDENCE_FINDING_UNKNOWN ||
        (unsigned)severity > DS4_EVIDENCE_SEVERITY_CRITICAL) {
        result_set(out, false, EVIDENCE_BAD_ARGUMENT, id, 0, "unknown state or severity");
        return false;
    }
    if (verdict == DS4_EVIDENCE_FINDING_CONFIRMED && !confirm_ready(f, out))
        return false;
    if (!verdict_compatible(f, verdict, severity, include_in_report, out))
        return false;
    if (verdict == DS4_EVIDENCE_FINDING_DISPROVED &&
        f->state != DS4_EVIDENCE_FINDING_DISPROVED)
        state->metrics.findings_disproved_total++;
    f->state = verdict;
    f->severity = severity;
    f->include_in_report = include_in_report;
    mutate(state, f);
    return ok(out, id);
}

bool ds4_agent_evidence_validate_finalization(
    const ds4_agent_evidence_state *state,
    ds4_evidence_validation_result *out) {
    if (!state) return false;
    for (size_t i = 0; i < state->finding_count; i++) {
        const ds4_evidence_finding *f = &state->findings[i];
        if (!f->include_in_report) continue;
        if (f->state == DS4_EVIDENCE_FINDING_DISPROVED) {
            result_set(out, false, EVIDENCE_DISPROVED_IN_REPORT, f->id, 0,
                       "finding=%s is DISPROVED and cannot be reported", f->id);
            return false;
        }
        /* Re-evaluated, not trusted from set_verdict: a later change (say,
         * reachability back to unknown) must not leave a stale CONFIRMED. */
        if (f->state == DS4_EVIDENCE_FINDING_CONFIRMED && !confirm_ready(f, out))
            return false;
        if (!verdict_compatible(f, f->state, f->severity, true, out))
            return false;
    }
    return ok(out, NULL);
}

bool ds4_agent_evidence_finalize(ds4_agent_evidence_state *state,
                                 ds4_evidence_validation_result *out) {
    if (!state) return false;
    if (!ds4_agent_evidence_validate_finalization(state, out)) {
        state->finalized = false;
        state->finalization_valid = false;
        state->metrics.finalize_blocked_total++;
        return false;
    }
    state->finalized = true;
    state->finalization_valid = true;
    state->finalize_invalidated = false;
    state->finalized_sequence = state->mutation_sequence;
    state->metrics.finalize_allowed_total++;
    return true;
}

void ds4_agent_evidence_note_tool_call(ds4_agent_evidence_state *state,
                                       ds4_agent_evidence_turn *turn,
                                       bool read_only_status) {
    if (!state || read_only_status) return;
    if (!state->finalized && !state->finalization_valid) return;
    state->finalized = false;
    state->finalization_valid = false;
    state->finalize_invalidated = true;
    state->metrics.finalize_invalidated_total++;
    if (turn) turn->tool_used_after_finalize = true;
}

bool ds4_agent_evidence_finalization_valid(const ds4_agent_evidence_state *state) {
    return state && state->finalized && state->finalization_valid &&
           state->finalized_sequence == state->mutation_sequence;
}

bool ds4_agent_evidence_can_publish(const ds4_agent_evidence_state *state,
                                    ds4_evidence_validation_result *out) {
    if (ds4_agent_evidence_finalization_valid(state)) return ok(out, NULL);
    if (state && state->finalize_invalidated)
        result_set(out, false, EVIDENCE_FINALIZE_STALE, NULL, 0,
                   "the ledger or the evidence changed after finalize; "
                   "call evidence_guard finalize again");
    else
        result_set(out, false, EVIDENCE_NOT_FINALIZED, NULL, 0,
                   "no valid evidence_guard finalize for this report");
    return false;
}

/* ---- final-text scanner --------------------------------------------------- */

static bool contains_ci(const char *hay, size_t hay_len, const char *needle) {
    size_t n = strlen(needle);
    if (n > hay_len) return false;
    for (size_t i = 0; i + n <= hay_len; i++) {
        size_t j = 0;
        while (j < n && tolower((unsigned char)hay[i + j]) == needle[j]) j++;
        if (j == n) return true;
    }
    return false;
}

/* Headings that name a section about findings the report stands behind. */
static bool heading_is_findings(const char *h, size_t len) {
    static const char *const words[] = {
        "confirm", "conferm", "finding", "problem", "issue", "bug",
        "vulnerab", "difett", "risultat", "rilev"};
    for (size_t i = 0; i < sizeof(words) / sizeof(words[0]); i++)
        if (contains_ci(h, len, words[i])) return true;
    return false;
}

/* Headings that name the place where disproved hypotheses belong. */
static bool heading_is_disproved(const char *h, size_t len) {
    static const char *const words[] = {
        "disprov", "falsif", "esclus", "scartat", "smentit", "rejected",
        "false positive", "falsi positivi", "non conferm", "not confirmed"};
    for (size_t i = 0; i < sizeof(words) / sizeof(words[0]); i++)
        if (contains_ci(h, len, words[i])) return true;
    return false;
}

/* "  - **State:** CONFIRMED" -> key "state", value "CONFIRMED". */
static bool contract_line(const char *line, size_t len, char *key, size_t key_len,
                          char *value, size_t value_len) {
    size_t i = 0;
    while (i < len && (line[i] == ' ' || line[i] == '\t' || line[i] == '-' ||
                       line[i] == '*' || line[i] == '>')) i++;
    size_t k = 0;
    while (i < len && isalpha((unsigned char)line[i]) && k + 1 < key_len)
        key[k++] = (char)tolower((unsigned char)line[i++]);
    key[k] = '\0';
    while (i < len && line[i] == '*') i++;
    if (i >= len || line[i] != ':') return false;
    i++;
    while (i < len && (line[i] == '*' || line[i] == ' ' || line[i] == '\t' ||
                       line[i] == '`')) i++;
    size_t v = 0;
    while (i < len && (isalnum((unsigned char)line[i]) || line[i] == '_' ||
                       line[i] == '-') && v + 1 < value_len)
        value[v++] = line[i++];
    value[v] = '\0';
    return k > 0 && v > 0;
}

bool ds4_agent_evidence_scan_final_text(const ds4_agent_evidence_state *state,
                                        const char *text,
                                        ds4_evidence_validation_result *out) {
    if (!state) return false;
    if (!text) text = "";
    bool mentioned[DS4_EVIDENCE_MAX_FINDINGS] = {0};
    const char *section = NULL;      /* last heading of level 1-2 */
    size_t section_len = 0;
    const ds4_evidence_finding *block = NULL; /* finding whose heading we're under */

    const char *line = text;
    while (*line) {
        const char *eol = strchr(line, '\n');
        size_t len = eol ? (size_t)(eol - line) : strlen(line);

        size_t hashes = 0;
        while (hashes < len && line[hashes] == '#') hashes++;
        bool heading = hashes > 0 && hashes < len && line[hashes] == ' ';
        if (heading) {
            block = NULL;
            if (hashes <= 2) { section = line; section_len = len; }
        }

        /* Every EFA-nnn token on the line. */
        for (size_t i = 0; i + 7 <= len; i++) {
            if (strncmp(line + i, "EFA-", 4)) continue;
            if (i > 0 && (isalnum((unsigned char)line[i - 1]) || line[i - 1] == '_'))
                continue;
            size_t j = i + 4;
            while (j < len && isdigit((unsigned char)line[j])) j++;
            if (j - (i + 4) < 3 || (j < len && isalnum((unsigned char)line[j])))
                continue;
            char id[DS4_EVIDENCE_ID_MAX];
            size_t id_len = j - i;
            if (id_len >= sizeof(id)) continue;
            memcpy(id, line + i, id_len);
            id[id_len] = '\0';
            const ds4_evidence_finding *f = ds4_agent_evidence_find(state, id);
            if (!f) {
                result_set(out, false, EVIDENCE_REPORT_UNKNOWN_ID, id, 0,
                           "the report mentions %s, which is not in the ledger", id);
                return false;
            }
            mentioned[f - state->findings] = true;
            if (heading) block = f;
            if (f->state == DS4_EVIDENCE_FINDING_DISPROVED && section &&
                heading_is_findings(section, section_len) &&
                !heading_is_disproved(section, section_len)) {
                result_set(out, false, EVIDENCE_REPORT_DISPROVED_AS_FINDING, id, 0,
                           "%s is DISPROVED but appears under a findings section", id);
                return false;
            }
            i = j - 1;
        }

        char key[16], value[32];
        if (!heading && block &&
            contract_line(line, len, key, sizeof(key), value, sizeof(value))) {
            const char *expected = NULL;
            const char *code = NULL;
            if (!strcmp(key, "state")) {
                expected = ds4_evidence_state_name(block->state);
                code = EVIDENCE_REPORT_STATE_MISMATCH;
            } else if (!strcmp(key, "severity")) {
                expected = ds4_evidence_severity_name(block->severity);
                code = EVIDENCE_REPORT_SEVERITY_MISMATCH;
            } else if (!strcmp(key, "reachability")) {
                expected = ds4_evidence_reachability_name(block->reachability);
                code = EVIDENCE_REPORT_REACHABILITY_MISMATCH;
            }
            if (expected && !text_ieq(value, expected)) {
                result_set(out, false, code, block->id, 0,
                           "%s: the report says %s %s, the ledger says %s",
                           block->id, key, value, expected);
                return false;
            }
        }
        if (!eol) break;
        line = eol + 1;
    }

    for (size_t i = 0; i < state->finding_count; i++) {
        const ds4_evidence_finding *f = &state->findings[i];
        if (f->include_in_report && !mentioned[i]) {
            result_set(out, false, EVIDENCE_REPORT_MISSING_FINDING, f->id, 0,
                       "%s is marked include_in_report but the report never mentions it",
                       f->id);
            return false;
        }
    }
    return ok(out, NULL);
}

/* ---- rendering ------------------------------------------------------------ */

typedef struct {
    char *buf;
    size_t cap;
    size_t len;
} evidence_text;

static void tput(evidence_text *t, const char *fmt, ...) {
    if (!t->buf || !t->cap) return;
    if (t->len >= t->cap) return;
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(t->buf + t->len, t->cap - t->len, fmt, ap);
    va_end(ap);
    if (n < 0) return;
    t->len += (size_t)n < t->cap - t->len ? (size_t)n : t->cap - t->len - 1;
}

size_t ds4_agent_evidence_digest(const ds4_agent_evidence_state *state,
                                 char *buf, size_t buf_len) {
    evidence_text t = {buf, buf_len, 0};
    if (buf && buf_len) buf[0] = '\0';
    if (!state) return 0;
    tput(&t, "[EVIDENCE RUNTIME STATE]\n");
    if (!state->finding_count) {
        tput(&t, "Findings: none registered\n");
    } else {
        tput(&t, "Findings:");
        for (size_t i = 0; i < state->finding_count; i++) {
            const ds4_evidence_finding *f = &state->findings[i];
            tput(&t, "%s %s=%s", i ? "," : "", f->id, ds4_evidence_state_name(f->state));
            if (f->severity != DS4_EVIDENCE_SEVERITY_NONE)
                tput(&t, "/%s", ds4_evidence_severity_name(f->severity));
            if (!f->counterevidence_completed) tput(&t, "(counterevidence pending)");
        }
        tput(&t, "\n");
    }
    tput(&t, "Finalization: %s\n",
         ds4_agent_evidence_finalization_valid(state) ? "READY" : "NOT_READY");
    tput(&t, "Runtime ledger is authoritative.\n[/EVIDENCE RUNTIME STATE]\n");
    return t.len;
}

static void put_check_list(evidence_text *t, uint32_t mask) {
    bool first = true;
    for (size_t i = 0; i < CHECK_COUNT; i++) {
        if (!(mask & CHECKS[i].bit)) continue;
        tput(t, "%s%s", first ? "" : ",", CHECKS[i].name);
        first = false;
    }
    if (first) tput(t, "-");
}

size_t ds4_agent_evidence_status(const ds4_agent_evidence_state *state,
                                 ds4_evidence_mode mode,
                                 const char *policy_revision,
                                 char *buf, size_t buf_len) {
    evidence_text t = {buf, buf_len, 0};
    if (buf && buf_len) buf[0] = '\0';
    if (!state) return 0;
    size_t open = 0;
    for (size_t i = 0; i < state->finding_count; i++)
        if (state->findings[i].state != DS4_EVIDENCE_FINDING_DISPROVED) open++;
    tput(&t, "EVIDENCE_STATUS\n");
    tput(&t, "skill active: %s\n", state->enabled ? "yes" : "no");
    tput(&t, "mode: %s\n", ds4_evidence_mode_name(mode));
    tput(&t, "EvidenceFirst policy revision: %s\n",
         policy_revision && policy_revision[0] ? policy_revision : "-");
    tput(&t, "finding count: %zu (open %zu)\n", state->finding_count, open);
    tput(&t, "finalization: %s\n",
         ds4_agent_evidence_finalization_valid(state) ? "READY"
         : state->finalize_invalidated ? "STALE" : "NOT_READY");
    tput(&t, "mutation sequence: %llu\n",
         (unsigned long long)state->mutation_sequence);
    for (size_t i = 0; i < state->finding_count; i++) {
        const ds4_evidence_finding *f = &state->findings[i];
        tput(&t, "- %s %s severity=%s reach=%s category=%s report=%s done=",
             f->id, ds4_evidence_state_name(f->state),
             ds4_evidence_severity_name(f->severity),
             ds4_evidence_reachability_name(f->reachability),
             ds4_evidence_category_name(f->category),
             f->include_in_report ? "yes" : "no");
        put_check_list(&t, f->checks_done);
        tput(&t, " n/a=");
        put_check_list(&t, f->checks_not_applicable);
        tput(&t, " evidence=%u/%u\n", f->evidence_for_count, f->evidence_against_count);
    }
    return t.len;
}

/* ---- persistence ---------------------------------------------------------- */

#define EVIDENCE_STATE_MAGIC "DS4_EVIDENCE_STATE_V1"

bool ds4_agent_evidence_serialize(const ds4_agent_evidence_state *state,
                                  char **text_out, size_t *len_out) {
    if (!state || !text_out) return false;
    /* Header + per finding: fixed fields (<200) + hex claim. */
    size_t cap = 128 + state->finding_count * (256 + 2 * DS4_EVIDENCE_CLAIM_MAX);
    char *buf = malloc(cap);
    if (!buf) return false;
    evidence_text t = {buf, cap, 0};
    tput(&t, "%s\nsequence %llu\ncount %zu\n", EVIDENCE_STATE_MAGIC,
         (unsigned long long)state->mutation_sequence, state->finding_count);
    for (size_t i = 0; i < state->finding_count; i++) {
        const ds4_evidence_finding *f = &state->findings[i];
        tput(&t, "finding %s %d %d %d %d %d %d %d %d %x %x %x %d %d %u %u %u ",
             f->id, (int)f->state, (int)f->severity, (int)f->reachability,
             (int)f->category, f->include_in_report, f->evidence_for_present,
             f->evidence_against_searched, f->counterevidence_completed,
             f->checks_done, f->checks_not_applicable, f->checks_unknown,
             f->dynamically_reproduced, f->static_evidence_present,
             f->evidence_for_count, f->evidence_against_count, f->revision);
        if (!f->claim[0]) tput(&t, "-");
        for (const unsigned char *p = (const unsigned char *)f->claim; *p; p++)
            tput(&t, "%02x", *p);
        tput(&t, "\n");
    }
    tput(&t, "end\n");
    *text_out = buf;
    if (len_out) *len_out = t.len;
    return true;
}

static int hexval(int c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}

static bool flag01(int v) { return v == 0 || v == 1; }

bool ds4_agent_evidence_deserialize(const char *text, size_t len,
                                    ds4_agent_evidence_state *state,
                                    char *err, size_t err_len) {
#define FAIL(...) do { if (err && err_len) snprintf(err, err_len, __VA_ARGS__); \
    free(copy); return false; } while (0)
    char *copy = NULL;
    if (!text || !state) FAIL("no evidence state");
    copy = malloc(len + 1);
    if (!copy) FAIL("out of memory");
    memcpy(copy, text, len);
    copy[len] = '\0';
    if (strlen(copy) != len) FAIL("evidence state contains NUL bytes");

    ds4_agent_evidence_state next;
    ds4_agent_evidence_init(&next);
    next.metrics = state->metrics;
    next.enabled = state->enabled;

    char *save = NULL;
    char *line = strtok_r(copy, "\n", &save);
    if (!line || strcmp(line, EVIDENCE_STATE_MAGIC)) FAIL("not a %s record", EVIDENCE_STATE_MAGIC);
    unsigned long long seq = 0;
    size_t count = 0;
    line = strtok_r(NULL, "\n", &save);
    if (!line || sscanf(line, "sequence %llu", &seq) != 1) FAIL("missing sequence");
    line = strtok_r(NULL, "\n", &save);
    if (!line || sscanf(line, "count %zu", &count) != 1 ||
        count > DS4_EVIDENCE_MAX_FINDINGS) FAIL("bad finding count");

    for (size_t i = 0; i < count; i++) {
        line = strtok_r(NULL, "\n", &save);
        if (!line) FAIL("truncated: %zu of %zu findings", i, count);
        ds4_evidence_finding *f = &next.findings[i];
        memset(f, 0, sizeof(*f));
        char id[64], claim_hex[2 * DS4_EVIDENCE_CLAIM_MAX + 8];
        int st, sev, reach, cat, inc, efor, eag, ce, dyn, stat;
        unsigned done, na, unk, cfor, cag, rev;
        int consumed = 0;
        if (sscanf(line,
                   "finding %63s %d %d %d %d %d %d %d %d %x %x %x %d %d %u %u %u %n",
                   id, &st, &sev, &reach, &cat, &inc, &efor, &eag, &ce,
                   &done, &na, &unk, &dyn, &stat, &cfor, &cag, &rev, &consumed) != 17)
            FAIL("malformed finding line %zu", i);
        const char *hex = line + consumed;
        if (strlen(hex) >= sizeof(claim_hex)) FAIL("claim too long in finding %zu", i);
        snprintf(claim_hex, sizeof(claim_hex), "%s", hex);
        if (!ds4_evidence_id_valid(id)) FAIL("bad finding id");
        for (size_t k = 0; k < i; k++)
            if (!strcmp(next.findings[k].id, id)) FAIL("duplicate finding %s", id);
        if (st < 0 || st > DS4_EVIDENCE_FINDING_UNKNOWN ||
            sev < 0 || sev > DS4_EVIDENCE_SEVERITY_CRITICAL ||
            reach < 0 || reach > DS4_EVIDENCE_REACH_NOT_REACHABLE ||
            cat < 0 || cat > DS4_EVIDENCE_CATEGORY_VALIDATION)
            FAIL("enum out of range in %s", id);
        if (!flag01(inc) || !flag01(efor) || !flag01(eag) || !flag01(ce) ||
            !flag01(dyn) || !flag01(stat))
            FAIL("bad flag in %s", id);
        if ((done | na | unk) & ~DS4_EVIDENCE_CHECK_ALL ||
            (done & na) || (done & unk) || (na & unk))
            FAIL("inconsistent check masks in %s", id);
        size_t claim_len = 0;
        if (strcmp(claim_hex, "-")) {
            size_t hl = strlen(claim_hex);
            if (hl % 2 || hl / 2 >= sizeof(f->claim)) FAIL("bad claim in %s", id);
            for (size_t k = 0; k < hl; k += 2) {
                int hi = hexval(claim_hex[k]), lo = hexval(claim_hex[k + 1]);
                if (hi < 0 || lo < 0) FAIL("bad claim encoding in %s", id);
                f->claim[claim_len++] = (char)(hi * 16 + lo);
            }
        }
        f->claim[claim_len] = '\0';
        memcpy(f->id, id, strlen(id) + 1); /* id_valid: shorter than ID_MAX */
        f->state = (ds4_evidence_finding_state)st;
        f->severity = (ds4_evidence_severity)sev;
        f->reachability = (ds4_evidence_reachability)reach;
        f->category = (ds4_evidence_category)cat;
        f->include_in_report = inc;
        f->evidence_for_present = efor;
        f->evidence_against_searched = eag;
        f->counterevidence_completed = ce;
        f->checks_done = done;
        f->checks_not_applicable = na;
        f->checks_unknown = unk;
        f->dynamically_reproduced = dyn;
        f->static_evidence_present = stat;
        f->evidence_for_count = cfor;
        f->evidence_against_count = cag;
        f->revision = rev;
    }
    line = strtok_r(NULL, "\n", &save);
    if (!line || strcmp(line, "end")) FAIL("missing end marker");
    next.finding_count = count;
    next.mutation_sequence = seq;
    /* Fail closed: the finalization token is never restored. */
    next.finalized = false;
    next.finalization_valid = false;
    next.finalize_invalidated = false;
    *state = next;
    free(copy);
    return true;
#undef FAIL
}
