/* Generic tool-protocol guard.
 *
 * A malformed tool protocol must have a bounded recovery path.  The model gets
 * one repair round, then a forced strategy change, then the turn is terminal.
 *
 * Extracted from ds4_agent.c so the escalation ladder can be read and tested
 * without the worker around it.  What stays in ds4_agent.c is everything that
 * needs the worker or the DSML parser: classifying a round into a failure
 * class, and publishing the terminal answer.  This file only knows how a
 * failure is identified, counted and worded.
 */
#ifndef DS4_AGENT_PROTOCOL_GUARD_H
#define DS4_AGENT_PROTOCOL_GUARD_H

#include <stdbool.h>

typedef enum {
    DS4_AGENT_PROTOCOL_FAILURE_NONE = 0,
    DS4_AGENT_PROTOCOL_FAILURE_DSML_IN_THINK,
    DS4_AGENT_PROTOCOL_FAILURE_DSML_INCOMPLETE,
    DS4_AGENT_PROTOCOL_FAILURE_DSML_PARSE,
    DS4_AGENT_PROTOCOL_FAILURE_TOOL_PREFLIGHT,
    DS4_AGENT_PROTOCOL_FAILURE_DEGENERATE_GENERATION
} ds4_agent_protocol_failure_class;

typedef enum {
    DS4_AGENT_PROTOCOL_CONTINUE = 0,
    DS4_AGENT_PROTOCOL_STRATEGY_CHANGE,
    DS4_AGENT_PROTOCOL_TERMINAL
} ds4_agent_protocol_decision;

typedef struct {
    ds4_agent_protocol_failure_class last_class;
    char last_fingerprint[65];
    int same_failure_count;
    int total_failure_count;
    int sequence;  /* WP15 — monotonically increasing round counter */
    bool strategy_change_required;
    bool terminal;
    char terminal_reason[96];
} ds4_agent_protocol_guard;

/* Per user turn. */
void ds4_agent_protocol_guard_reset(ds4_agent_protocol_guard *s);

const char *ds4_agent_protocol_failure_name(ds4_agent_protocol_failure_class c);

/* Canonical identity of a failure: class plus normalized detail.  Public so a
 * test can prove that a changing narrative does not change the identity. */
void ds4_agent_protocol_failure_fingerprint(ds4_agent_protocol_failure_class cls,
                                            const char *detail, char out[65]);

ds4_agent_protocol_decision ds4_agent_protocol_guard_record(
    ds4_agent_protocol_guard *s, ds4_agent_protocol_failure_class cls,
    const char *detail);

/* A round that produced a real tool call: clears the identical-failure streak,
 * never the per-turn audit total. */
void ds4_agent_protocol_guard_note_success(ds4_agent_protocol_guard *s);

/* Caller owns the returned strings. */
char *ds4_agent_protocol_repair_guidance(const ds4_agent_protocol_guard *s,
                                         ds4_agent_protocol_failure_class cls,
                                         const char *detail);
char *ds4_agent_protocol_strategy_guidance(const ds4_agent_protocol_guard *s,
                                           ds4_agent_protocol_failure_class cls,
                                           const char *detail);
char *ds4_agent_protocol_terminal_notice(const ds4_agent_protocol_guard *s,
                                         ds4_agent_protocol_failure_class cls,
                                         const char *detail);

#endif /* DS4_AGENT_PROTOCOL_GUARD_H */
