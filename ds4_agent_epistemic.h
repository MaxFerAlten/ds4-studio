/* Native epistemic turn state (Quantum Fix QF-20, plan section 42).
 *
 * The native agent is the most delicate path in the codebase, so this is
 * deliberately the minimum: what a turn observed, not the full JS ledger.  It
 * answers one question — did anything actually run this turn, and of what kind
 * — which is what the prompt rules of QF-22 and the repair bound of QF-16 need
 * in order to mean anything on the C side.
 *
 * The rule the plan is emphatic about (section 43): success is read from a
 * tool's structured status, never parsed out of its prose.  A result with no
 * status is recorded as having run with an unknown outcome, which is not the
 * same as having succeeded.
 *
 * Kept out of ds4_agent.c so it can be compiled and tested without the worker
 * around it, the same way ds4_agent_protocol_guard.c was.
 */
#ifndef DS4_AGENT_EPISTEMIC_H
#define DS4_AGENT_EPISTEMIC_H

#include <stdbool.h>
#include <stddef.h>

typedef enum {
    DS4_EPI_MODE_OFF = 0,
    DS4_EPI_MODE_SHADOW,
    DS4_EPI_MODE_BLOCK
} ds4_epistemic_mode;

typedef enum {
    DS4_EPI_SEV_0 = 0,
    DS4_EPI_SEV_1,
    DS4_EPI_SEV_2,
    DS4_EPI_SEV_3,
    DS4_EPI_SEV_4,
    DS4_EPI_SEV_5
} ds4_epistemic_severity;

#define DS4_EPI_FAILURE_CODE_LEN 64
#define DS4_EPI_DEFAULT_MAX_REPAIR_ROUNDS 2
#define DS4_EPI_MAX_REPAIR_ROUNDS 8

/* What one turn observed.  Every field is set from a tool call that happened,
 * never from the assistant's account of one. */
typedef struct {
    bool used_real_tool;
    bool used_sage_validation;
    bool used_bash;
    bool observed_successful_bash;
    bool observed_test_command;
    bool observed_successful_test_command;
    bool observed_benchmark_command;
    bool observed_successful_benchmark_command;
    bool observed_web_source;
    bool observed_crawl_source;
    bool observed_research_source;

    int repair_rounds;
    int max_repair_rounds;

    char last_failure_code[DS4_EPI_FAILURE_CODE_LEN];
} ds4_agent_epistemic_turn;

/* A tool result as the worker knows it, before anyone reads its text.
 *
 * `has_status` is the whole point: false means no executor reported an outcome,
 * and the module will not invent one.  `exit_code` is only consulted when
 * `has_exit_code` is set, so a zero-initialised struct cannot pass for success.
 */
typedef struct {
    bool has_status;
    bool ok;
    bool has_exit_code;
    int exit_code;
} ds4_agent_epistemic_tool_result;

/* Clear the turn.  Called before generation starts (QF-21). */
void ds4_agent_epistemic_turn_reset(ds4_agent_epistemic_turn *turn);

/* Record one tool call that ran.  `tool_name` may be NULL or unknown; the call
 * still counts as a real tool having run, it simply sets no kind flag. */
void ds4_agent_epistemic_note_tool(ds4_agent_epistemic_turn *turn,
                                   const char *tool_name,
                                   const ds4_agent_epistemic_tool_result *result);

/* Classify structured bash command metadata, never tool output prose. */
void ds4_agent_epistemic_note_command(ds4_agent_epistemic_turn *turn,
                                      const char *command,
                                      const ds4_agent_epistemic_tool_result *result);

/* Record the failure class that blocked this turn, e.g. "F04". */
void ds4_agent_epistemic_note_failure(ds4_agent_epistemic_turn *turn, const char *code);

/* Whether a claim of the given kind has evidence behind it this turn. */
bool ds4_agent_epistemic_has_execution_evidence(const ds4_agent_epistemic_turn *turn);
bool ds4_agent_epistemic_has_source_evidence(const ds4_agent_epistemic_turn *turn);
bool ds4_agent_epistemic_has_computation_evidence(const ds4_agent_epistemic_turn *turn);

/* Repair bound.  A repair that has not converged is reported, not retried
 * forever (QF-16). */
bool ds4_agent_epistemic_can_repair(const ds4_agent_epistemic_turn *turn);
void ds4_agent_epistemic_begin_repair(ds4_agent_epistemic_turn *turn);

/* Whether this turn's candidate prose must be withheld until a verdict exists.
 *
 * QF-23 section 45.  Only block mode owes a verdict before publication; off and
 * shadow stream exactly as they do today.  The turn is taken so a later
 * refinement can withhold selectively without changing every caller. */
bool ds4_agent_epistemic_should_defer(const ds4_agent_epistemic_turn *turn,
                                      ds4_epistemic_mode mode);

/* The mode this process was started in, from DS4_EPISTEMIC_MODE. */
ds4_epistemic_mode ds4_agent_epistemic_mode_from_env(void);

/* Parse a mode from a configuration string.  Anything unrecognised, including
 * NULL, is OFF: an unreadable setting must not silently enable a gate. */
ds4_epistemic_mode ds4_agent_epistemic_mode_from_string(const char *value);
const char *ds4_agent_epistemic_mode_name(ds4_epistemic_mode mode);

/* QF-24 section 46 - deterministic high-severity scan of the final candidate.
 *
 * Lexical and structural only.  It cannot establish that a claim is false; it
 * can establish that this turn observed nothing supporting it, which is a
 * weaker and much cheaper statement.  The verdict says exactly that, and
 * section 46 is emphatic that it must not say more.
 */
#define DS4_EPI_MAX_FINDINGS 8
#define DS4_EPI_VERDICT_ALLOW "ALLOW"
#define DS4_EPI_VERDICT_BLOCK_UNSUPPORTED "BLOCK_UNSUPPORTED"

typedef enum {
    DS4_EPI_FAILURE_F01 = 0,
    DS4_EPI_FAILURE_F02,
    DS4_EPI_FAILURE_F03,
    DS4_EPI_FAILURE_F04,
    DS4_EPI_FAILURE_F05,
    DS4_EPI_FAILURE_F06,
    DS4_EPI_FAILURE_F07,
    DS4_EPI_FAILURE_F08,
    DS4_EPI_FAILURE_F09,
    DS4_EPI_FAILURE_F10,
    DS4_EPI_FAILURE_F11,
    DS4_EPI_FAILURE_F12,
    DS4_EPI_FAILURE_F13,
    DS4_EPI_FAILURE_F14,
    DS4_EPI_FAILURE_F15,
    DS4_EPI_FAILURE_F16,
    DS4_EPI_FAILURE_F17,
    DS4_EPI_FAILURE_F18,
    DS4_EPI_FAILURE_F19,
    DS4_EPI_FAILURE_F20,
    DS4_EPI_FAILURE_F21,
    DS4_EPI_FAILURE_F22,
    DS4_EPI_FAILURE_F23,
    DS4_EPI_FAILURE_F24,
    DS4_EPI_FAILURE_F25,
    DS4_EPI_FAILURE_F26,
    DS4_EPI_FAILURE_COUNT
} ds4_epistemic_failure_id;

typedef struct {
    const char *code;
    const char *name;
} ds4_epistemic_failure_definition;

const ds4_epistemic_failure_definition *ds4_agent_epistemic_failure_by_id(
    ds4_epistemic_failure_id id);
const ds4_epistemic_failure_definition *ds4_agent_epistemic_failure_by_code(
    const char *code);

/* Every field points at a string literal with static storage duration, so a
 * result stays valid after the scan returns without owning anything. */
typedef struct {
    const char *code;        /* taxonomy code, section 51: "F03", "F04", ... */
    const char *name;        /* "FABRICATED_EXPERIMENT", ... */
    const char *requirement; /* the evidence the wording promises */
    const char *match;       /* the wording that promised it */
} ds4_epistemic_finding;

typedef struct {
    bool blocked;
    const char *verdict;   /* DS4_EPI_VERDICT_ALLOW or _BLOCK_UNSUPPORTED */
    int finding_count;     /* findings recorded, at most DS4_EPI_MAX_FINDINGS */
    int detected_count;    /* classes that fired, including any past the cap */
    ds4_epistemic_finding findings[DS4_EPI_MAX_FINDINGS];
} ds4_epistemic_scan_result;

/* Scan a completed candidate answer against what the turn actually observed.
 * A class fires only when its wording is present AND the evidence it promises
 * is absent, so a turn that ran the tool is not punished for saying so. */
ds4_epistemic_scan_result ds4_agent_epistemic_scan_final_text(
    const ds4_agent_epistemic_turn *turn, const char *text, size_t len);

/* Block mode publishes only what the scan cleared; a missing scan is not a
 * pass.  Shadow observes without changing what the user sees, and off does
 * nothing at all. */
bool ds4_agent_epistemic_can_publish(const ds4_epistemic_scan_result *scan,
                                     ds4_epistemic_mode mode);

/* Repair instructions for the model.  malloc'd, caller frees; NULL when the
 * scan found nothing to repair. */
char *ds4_agent_epistemic_repair_guidance(const ds4_epistemic_scan_result *scan);

#endif /* DS4_AGENT_EPISTEMIC_H */
