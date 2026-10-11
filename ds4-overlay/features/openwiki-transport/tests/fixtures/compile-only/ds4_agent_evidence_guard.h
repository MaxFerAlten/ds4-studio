/* Evidence-First runtime ledger (piano esecutivo "Evidence-First Analysis /
 * Verify-Before-Verdict", WP3-WP10, WP13, WP24).
 *
 * The evidence-first-analysis skill tells the model how to analyse; this module
 * is what makes the rules hold when the model forgets them.  It keeps, per
 * session, the findings the model registered through the evidence_guard tool,
 * the falsification checks it recorded for each, and whether a pre-verdict
 * finalize is still valid.  The worker consults it before publishing a final
 * answer.  The model's prose is never parsed for a verdict: a finding is
 * CONFIRMED, HIGH or finalized only because a structured call made it so and
 * the invariants below accepted it.
 *
 * Kept out of the monolith, like ds4_agent_epistemic.c and
 * ds4_agent_protocol_guard.c, so it compiles and tests on its own.  It holds
 * fixed-size metadata only -- ids, enums, bit masks, counters, a bounded claim
 * -- never file contents or tool output, and owns no heap memory.
 *
 * Threading: the state is owned by the agent worker and mutated only from the
 * worker thread (tool dispatch, final publication).  Readers on other threads
 * (runtime status) must take a snapshot under the worker's own lock.
 */
#ifndef DS4_AGENT_EVIDENCE_GUARD_H
#define DS4_AGENT_EVIDENCE_GUARD_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define DS4_EVIDENCE_SKILL_NAME "evidence-first-analysis"

#define DS4_EVIDENCE_MAX_FINDINGS 64
#define DS4_EVIDENCE_ID_MAX 32
#define DS4_EVIDENCE_CLAIM_MAX 512
#define DS4_EVIDENCE_NOTE_MAX 512
#define DS4_EVIDENCE_MAX_REPAIR_ROUNDS 2

typedef enum {
    DS4_EVIDENCE_MODE_OFF = 0,
    DS4_EVIDENCE_MODE_SHADOW,
    DS4_EVIDENCE_MODE_BLOCK
} ds4_evidence_mode;

typedef enum {
    DS4_EVIDENCE_FINDING_CANDIDATE = 0,
    DS4_EVIDENCE_FINDING_SUPPORTED,
    DS4_EVIDENCE_FINDING_CONFIRMED,
    DS4_EVIDENCE_FINDING_CONDITIONAL,
    DS4_EVIDENCE_FINDING_DISPROVED,
    DS4_EVIDENCE_FINDING_UNKNOWN
} ds4_evidence_finding_state;

typedef enum {
    DS4_EVIDENCE_SEVERITY_NONE = 0,
    DS4_EVIDENCE_SEVERITY_HARDENING,
    DS4_EVIDENCE_SEVERITY_LOW,
    DS4_EVIDENCE_SEVERITY_MEDIUM,
    DS4_EVIDENCE_SEVERITY_HIGH,
    DS4_EVIDENCE_SEVERITY_CRITICAL
} ds4_evidence_severity;

typedef enum {
    DS4_EVIDENCE_REACH_UNKNOWN = 0,
    DS4_EVIDENCE_REACH_CONDITIONAL,
    DS4_EVIDENCE_REACH_PROVEN,
    DS4_EVIDENCE_REACH_NOT_REACHABLE
} ds4_evidence_reachability;

typedef enum {
    DS4_EVIDENCE_FOR = 0,
    DS4_EVIDENCE_AGAINST
} ds4_evidence_side;

/* What a finding is about.  It decides which specific checks CONFIRMED needs
 * on top of the general ones.  GENERAL is the conservative default: every
 * specific check must then be resolved (done, or not applicable with a
 * reason), because the runtime cannot tell which ones matter. */
typedef enum {
    DS4_EVIDENCE_CATEGORY_GENERAL = 0,
    DS4_EVIDENCE_CATEGORY_CONCURRENCY,
    DS4_EVIDENCE_CATEGORY_LIFETIME,
    DS4_EVIDENCE_CATEGORY_CLEANUP,
    DS4_EVIDENCE_CATEGORY_VALIDATION
} ds4_evidence_category;

enum {
    DS4_EVIDENCE_CHECK_FULL_CONTROL_FLOW     = 1u << 0,
    DS4_EVIDENCE_CHECK_CALLER                = 1u << 1,
    DS4_EVIDENCE_CHECK_WRAPPER_OR_OUTER_GUARD = 1u << 2,
    DS4_EVIDENCE_CHECK_UPSTREAM_VALIDATION   = 1u << 3,
    DS4_EVIDENCE_CHECK_LIFETIME              = 1u << 4,
    DS4_EVIDENCE_CHECK_CLEANUP_ERROR_PATH    = 1u << 5,
    DS4_EVIDENCE_CHECK_COUNTEREVIDENCE       = 1u << 6,
    DS4_EVIDENCE_CHECK_REACHABILITY          = 1u << 7,
    DS4_EVIDENCE_CHECK_DYNAMIC_REPRODUCTION  = 1u << 8
};
#define DS4_EVIDENCE_CHECK_ALL 0x1ffu

typedef enum {
    DS4_EVIDENCE_CHECK_RESULT_DONE = 0,
    DS4_EVIDENCE_CHECK_RESULT_NOT_APPLICABLE,
    DS4_EVIDENCE_CHECK_RESULT_UNKNOWN /* for dynamic reproduction: not done */
} ds4_evidence_check_result;

typedef struct {
    char id[DS4_EVIDENCE_ID_MAX];
    char claim[DS4_EVIDENCE_CLAIM_MAX];

    ds4_evidence_finding_state state;
    ds4_evidence_severity severity;
    ds4_evidence_reachability reachability;
    ds4_evidence_category category;

    bool include_in_report;
    bool evidence_for_present;
    bool evidence_against_searched;
    bool counterevidence_completed;

    /* One bit per check; a check is in at most one of the three masks. */
    uint32_t checks_done;
    uint32_t checks_not_applicable;
    uint32_t checks_unknown;

    bool dynamically_reproduced;
    bool static_evidence_present;

    unsigned evidence_for_count;
    unsigned evidence_against_count;
    unsigned revision;
} ds4_evidence_finding;

typedef struct {
    uint64_t findings_opened_total;
    uint64_t findings_disproved_total;
    uint64_t finalize_blocked_total;
    uint64_t finalize_allowed_total;
    uint64_t finalize_invalidated_total;
    uint64_t reinjections_total;
    uint64_t shadow_violations_total;
} ds4_evidence_metrics;

/* Session-scoped: survives turns and compaction, never reset per turn. */
typedef struct {
    bool enabled;
    bool finalized;
    bool finalization_valid;
    /* A finalize existed and a later change voided it: tells a stale verdict
     * (EVIDENCE_FINALIZE_STALE) from one never given (EVIDENCE_NOT_FINALIZED). */
    bool finalize_invalidated;
    uint64_t mutation_sequence;
    uint64_t finalized_sequence;

    ds4_evidence_finding findings[DS4_EVIDENCE_MAX_FINDINGS];
    size_t finding_count;

    ds4_evidence_metrics metrics;
} ds4_agent_evidence_state;

/* Turn-scoped transient state; the ledger above is not. */
typedef struct {
    bool core_contract_injected_this_turn;
    bool tool_used_after_finalize;
    int repair_rounds;
} ds4_agent_evidence_turn;

/* Outcome of an operation or of the pre-verdict check.  reason_code is a
 * stable identifier tests assert on; detail is for humans and the model. */
typedef struct {
    bool allowed;
    char finding_id[DS4_EVIDENCE_ID_MAX];
    uint32_t missing_checks;
    const char *reason_code;
    char detail[DS4_EVIDENCE_NOTE_MAX];
} ds4_evidence_validation_result;

/* ---- reason codes ------------------------------------------------------- */
#define EVIDENCE_OK                          "EVIDENCE_OK"
#define EVIDENCE_NO_COUNTEREVIDENCE_SEARCH   "EVIDENCE_NO_COUNTEREVIDENCE_SEARCH"
#define EVIDENCE_NO_EVIDENCE_FOR             "EVIDENCE_NO_EVIDENCE_FOR"
#define EVIDENCE_CONTROL_FLOW_UNCHECKED      "EVIDENCE_CONTROL_FLOW_UNCHECKED"
#define EVIDENCE_CALLER_UNCHECKED            "EVIDENCE_CALLER_UNCHECKED"
#define EVIDENCE_SPECIFIC_CHECK_UNRESOLVED   "EVIDENCE_SPECIFIC_CHECK_UNRESOLVED"
#define EVIDENCE_DYNAMIC_STATUS_UNSET        "EVIDENCE_DYNAMIC_STATUS_UNSET"
#define EVIDENCE_REACHABILITY_UNCHECKED      "EVIDENCE_REACHABILITY_UNCHECKED"
#define EVIDENCE_REACHABILITY_UNKNOWN        "EVIDENCE_REACHABILITY_UNKNOWN"
#define EVIDENCE_HIGH_REQUIRES_CONFIRMED     "EVIDENCE_HIGH_REQUIRES_CONFIRMED"
#define EVIDENCE_HIGH_REQUIRES_REACHABLE     "EVIDENCE_HIGH_REQUIRES_REACHABLE"
#define EVIDENCE_CONDITIONAL_SEVERITY_CAP    "EVIDENCE_CONDITIONAL_SEVERITY_CAP"
#define EVIDENCE_DISPROVED_IN_REPORT         "EVIDENCE_DISPROVED_IN_REPORT"
#define EVIDENCE_DISPROVED_SEVERITY          "EVIDENCE_DISPROVED_SEVERITY"
#define EVIDENCE_FINALIZE_STALE              "EVIDENCE_FINALIZE_STALE"
#define EVIDENCE_NOT_FINALIZED               "EVIDENCE_NOT_FINALIZED"
#define EVIDENCE_UNKNOWN_FINDING             "EVIDENCE_UNKNOWN_FINDING"
#define EVIDENCE_DUPLICATE_FINDING           "EVIDENCE_DUPLICATE_FINDING"
#define EVIDENCE_LEDGER_FULL                 "EVIDENCE_LEDGER_FULL"
#define EVIDENCE_BAD_ID                      "EVIDENCE_BAD_ID"
#define EVIDENCE_BAD_ARGUMENT                "EVIDENCE_BAD_ARGUMENT"
#define EVIDENCE_NA_REQUIRES_REASON          "EVIDENCE_NA_REQUIRES_REASON"
#define EVIDENCE_CHECK_NOT_WAIVABLE          "EVIDENCE_CHECK_NOT_WAIVABLE"
#define EVIDENCE_REPORT_UNKNOWN_ID           "EVIDENCE_REPORT_UNKNOWN_ID"
#define EVIDENCE_REPORT_MISSING_FINDING      "EVIDENCE_REPORT_MISSING_FINDING"
#define EVIDENCE_REPORT_DISPROVED_AS_FINDING "EVIDENCE_REPORT_DISPROVED_AS_FINDING"
#define EVIDENCE_REPORT_STATE_MISMATCH       "EVIDENCE_REPORT_STATE_MISMATCH"
#define EVIDENCE_REPORT_SEVERITY_MISMATCH    "EVIDENCE_REPORT_SEVERITY_MISMATCH"
#define EVIDENCE_REPORT_REACHABILITY_MISMATCH "EVIDENCE_REPORT_REACHABILITY_MISMATCH"

/* L2: short, abstract, reinjected on reminders and after compaction. */
extern const char ds4_agent_evidence_core_contract[];

/* ---- lifecycle ---------------------------------------------------------- */
void ds4_agent_evidence_init(ds4_agent_evidence_state *state);
/* Drops every finding and the finalization; keeps metrics. */
void ds4_agent_evidence_clear(ds4_agent_evidence_state *state);
void ds4_agent_evidence_turn_reset(ds4_agent_evidence_turn *turn);

/* ---- enums <-> strings (tool arguments, status, persistence) ------------ */
bool ds4_evidence_mode_parse(const char *text, ds4_evidence_mode *out);
const char *ds4_evidence_mode_name(ds4_evidence_mode mode);
/* DS4_EVIDENCE_MODE when set (off|shadow|block; anything else is an error,
 * never a silent fallback), else block while the skill is active and off
 * otherwise. */
bool ds4_evidence_mode_resolve(const char *env_value, bool skill_active,
                               ds4_evidence_mode *out,
                               char *err, size_t err_len);
bool ds4_evidence_state_parse(const char *text, ds4_evidence_finding_state *out);
const char *ds4_evidence_state_name(ds4_evidence_finding_state state);
bool ds4_evidence_severity_parse(const char *text, ds4_evidence_severity *out);
const char *ds4_evidence_severity_name(ds4_evidence_severity severity);
bool ds4_evidence_reachability_parse(const char *text, ds4_evidence_reachability *out);
const char *ds4_evidence_reachability_name(ds4_evidence_reachability reach);
bool ds4_evidence_category_parse(const char *text, ds4_evidence_category *out);
const char *ds4_evidence_category_name(ds4_evidence_category category);
bool ds4_evidence_check_parse(const char *text, uint32_t *check_bit);
const char *ds4_evidence_check_name(uint32_t check_bit);
bool ds4_evidence_check_result_parse(const char *text, ds4_evidence_check_result *out);
bool ds4_evidence_id_valid(const char *id);

/* ---- ledger operations ---------------------------------------------------
 * Each returns true when the state accepted the change.  On rejection the
 * state is untouched and out names exactly what is missing.  Every accepted
 * change invalidates a previous finalize. */
bool ds4_agent_evidence_open(ds4_agent_evidence_state *state,
                             const char *id, const char *claim,
                             ds4_evidence_category category,
                             ds4_evidence_validation_result *out);
bool ds4_agent_evidence_add(ds4_agent_evidence_state *state,
                            const char *id, ds4_evidence_side side,
                            bool dynamic_source,
                            ds4_evidence_validation_result *out);
bool ds4_agent_evidence_mark_check(ds4_agent_evidence_state *state,
                                   const char *id, uint32_t check_bit,
                                   ds4_evidence_check_result result,
                                   const char *note,
                                   ds4_evidence_validation_result *out);
bool ds4_agent_evidence_set_reachability(ds4_agent_evidence_state *state,
                                         const char *id,
                                         ds4_evidence_reachability reach,
                                         ds4_evidence_validation_result *out);
bool ds4_agent_evidence_set_verdict(ds4_agent_evidence_state *state,
                                    const char *id,
                                    ds4_evidence_finding_state verdict,
                                    ds4_evidence_severity severity,
                                    bool include_in_report,
                                    ds4_evidence_validation_result *out);

/* Pre-verdict check over every finding with include_in_report.  Pure: no
 * state change.  A ledger with no reported finding passes -- "nothing found"
 * is a valid verdict once the model has said so through finalize. */
bool ds4_agent_evidence_validate_finalization(
    const ds4_agent_evidence_state *state,
    ds4_evidence_validation_result *out);
/* validate_finalization, then record the finalization token on success. */
bool ds4_agent_evidence_finalize(ds4_agent_evidence_state *state,
                                 ds4_evidence_validation_result *out);
/* Any tool call other than "evidence_guard status" after a finalize. */
void ds4_agent_evidence_note_tool_call(ds4_agent_evidence_state *state,
                                       ds4_agent_evidence_turn *turn,
                                       bool read_only_status);
bool ds4_agent_evidence_finalization_valid(const ds4_agent_evidence_state *state);
/* Publication decision for the evidence gate alone. */
bool ds4_agent_evidence_can_publish(const ds4_agent_evidence_state *state,
                                    ds4_evidence_validation_result *out);

const ds4_evidence_finding *
ds4_agent_evidence_find(const ds4_agent_evidence_state *state, const char *id);

/* Deterministic checks of the final report against the ledger (WP11/WP24):
 * EFA ids must exist, reported findings must be mentioned, a DISPROVED one
 * may not appear outside a section about disproved findings, and contract
 * lines (State:/Severity:/Reachability:) under an EFA heading must match. */
bool ds4_agent_evidence_scan_final_text(const ds4_agent_evidence_state *state,
                                        const char *text,
                                        ds4_evidence_validation_result *out);

/* ---- rendering ---------------------------------------------------------- */
/* Short runtime digest for reinjection after compaction / restore. */
size_t ds4_agent_evidence_digest(const ds4_agent_evidence_state *state,
                                 char *buf, size_t buf_len);
/* Status block for the tool and for /skill status. */
size_t ds4_agent_evidence_status(const ds4_agent_evidence_state *state,
                                 ds4_evidence_mode mode,
                                 const char *policy_revision,
                                 char *buf, size_t buf_len);
/* The falsification checklist returned by "open". */
extern const char ds4_agent_evidence_open_guidance[];

/* ---- persistence (WP13) --------------------------------------------------
 * Versioned text form of the ledger.  Restore never yields a finalized state:
 * the finalization token is not persisted, so a restored session must
 * finalize again.  Malformed input is rejected as a whole. */
bool ds4_agent_evidence_serialize(const ds4_agent_evidence_state *state,
                                  char **text_out, size_t *len_out);
bool ds4_agent_evidence_deserialize(const char *text, size_t len,
                                    ds4_agent_evidence_state *state,
                                    char *err, size_t err_len);

#endif
