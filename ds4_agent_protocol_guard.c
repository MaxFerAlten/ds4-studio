#include "ds4_agent_protocol_guard.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "buf.h"
#include "ds4_context_blob.h"
#include "generated/agent_loop_policy.h"

void ds4_agent_protocol_guard_reset(ds4_agent_protocol_guard *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
}

const char *ds4_agent_protocol_failure_name(ds4_agent_protocol_failure_class c) {
    switch (c) {
    case DS4_AGENT_PROTOCOL_FAILURE_DSML_IN_THINK:   return "DSML_TOOL_INSIDE_THINK";
    case DS4_AGENT_PROTOCOL_FAILURE_DSML_INCOMPLETE: return "DSML_INCOMPLETE_CALL";
    case DS4_AGENT_PROTOCOL_FAILURE_DSML_PARSE:      return "DSML_PARSE_ERROR";
    case DS4_AGENT_PROTOCOL_FAILURE_TOOL_PREFLIGHT:  return "TOOL_PREFLIGHT_ERROR";
    case DS4_AGENT_PROTOCOL_FAILURE_DEGENERATE_GENERATION:
                                                     return "DEGENERATE_GENERATION";
    case DS4_AGENT_PROTOCOL_FAILURE_NONE:
    default:                                         return "NONE";
    }
}

/* Digit runs collapse to '#' and whitespace collapses to one space, so an
 * offset or a token count in the message cannot make the same error look new
 * every round — which would defeat the guard entirely.  Timestamps and round
 * numbers are never part of the material for the same reason. */
void ds4_agent_protocol_failure_fingerprint(ds4_agent_protocol_failure_class cls,
                                            const char *detail, char out[65])
{
    char norm[257];
    size_t n = 0;
    bool prev_space = false, prev_digit = false;
    for (const char *p = detail ? detail : ""; *p && n + 1 < sizeof(norm); p++) {
        unsigned char c = (unsigned char)*p;
        if (isspace(c)) {
            prev_digit = false;
            if (!prev_space && n > 0) { norm[n++] = ' '; prev_space = true; }
            continue;
        }
        prev_space = false;
        if (isdigit(c)) {
            if (prev_digit) continue;
            prev_digit = true;
            norm[n++] = '#';
            continue;
        }
        prev_digit = false;
        norm[n++] = (char)tolower(c);
    }
    while (n > 0 && norm[n - 1] == ' ') n--;
    norm[n] = '\0';

    char material[320];
    int m = snprintf(material, sizeof(material), "%s|%s",
                     ds4_agent_protocol_failure_name(cls), norm);
    if (m < 0) m = 0;
    if ((size_t)m >= sizeof(material)) m = (int)sizeof(material) - 1;
    ds4_sha256_hex(material, (size_t)m, out);
}

void ds4_agent_protocol_guard_note_success(ds4_agent_protocol_guard *s) {
    if (!s || s->terminal) return;
    s->same_failure_count = 0;
    s->last_class = DS4_AGENT_PROTOCOL_FAILURE_NONE;
    s->last_fingerprint[0] = '\0';
    s->strategy_change_required = false;
}

ds4_agent_protocol_decision ds4_agent_protocol_guard_record(
    ds4_agent_protocol_guard *s, ds4_agent_protocol_failure_class cls,
    const char *detail)
{
    if (!s || cls == DS4_AGENT_PROTOCOL_FAILURE_NONE)
        return DS4_AGENT_PROTOCOL_CONTINUE;
    /* Terminal is latched for the whole user turn: the model may explain an
     * error but may not decide whether the error is terminal. */
    if (s->terminal) return DS4_AGENT_PROTOCOL_TERMINAL;

    char fp[65];
    ds4_agent_protocol_failure_fingerprint(cls, detail, fp);
    if (s->last_fingerprint[0] && !strcmp(s->last_fingerprint, fp))
        s->same_failure_count++;
    else
        s->same_failure_count = 1;
    memcpy(s->last_fingerprint, fp, sizeof(fp));
    s->last_class = cls;
    s->total_failure_count++;
    s->sequence = s->total_failure_count;  /* WP15 — forensic sequence */

    if (s->same_failure_count >= DS4_AGENT_PROTOCOL_SAME_FAILURE_TERMINAL) {
        s->terminal = true;
        snprintf(s->terminal_reason, sizeof(s->terminal_reason),
                 "identical protocol failure repeated %d times",
                 s->same_failure_count);
        return DS4_AGENT_PROTOCOL_TERMINAL;
    }
    if (s->total_failure_count >= DS4_AGENT_PROTOCOL_TOTAL_FAILURE_TERMINAL) {
        s->terminal = true;
        snprintf(s->terminal_reason, sizeof(s->terminal_reason),
                 "%d protocol failures in a single turn", s->total_failure_count);
        return DS4_AGENT_PROTOCOL_TERMINAL;
    }
    if (s->same_failure_count >= DS4_AGENT_PROTOCOL_SAME_FAILURE_STRATEGY_CHANGE) {
        s->strategy_change_required = true;
        return DS4_AGENT_PROTOCOL_STRATEGY_CHANGE;
    }
    s->strategy_change_required = false;
    return DS4_AGENT_PROTOCOL_CONTINUE;
}

/* Repeating one generic syntax reminder is what produced the observed loop, so
 * each class gets its own instruction and the instruction escalates. */
static const char *protocol_repair_hint(ds4_agent_protocol_failure_class c) {
    switch (c) {
    case DS4_AGENT_PROTOCOL_FAILURE_DSML_IN_THINK:
        return "Close </think> before any DSML.\n"
               "Emit exactly one valid tool call outside reasoning.\n"
               "Do not explain the formatting error.\n";
    case DS4_AGENT_PROTOCOL_FAILURE_DSML_INCOMPLETE:
        return "The DSML stanza ended mid-call.\n"
               "Emit one short, complete tool call, or answer with what you have.\n";
    case DS4_AGENT_PROTOCOL_FAILURE_DSML_PARSE:
        return "The DSML stanza did not parse.\n"
               "Emit exactly one syntactically valid tool call.\n";
    case DS4_AGENT_PROTOCOL_FAILURE_TOOL_PREFLIGHT:
        return "The call was rejected before execution.\n"
               "Fix the arguments named in the error, or choose a different tool.\n";
    case DS4_AGENT_PROTOCOL_FAILURE_DEGENERATE_GENERATION:
        return "The text degenerated into repeating the same lines.\n"
               "Do not restate previous sentences; answer directly with what was\n"
               "learned so far, or make ONE different tool call.\n";
    case DS4_AGENT_PROTOCOL_FAILURE_NONE:
    default:
        return "";
    }
}

static void protocol_guard_header(DynBuf *b, const char *banner,
                                  const ds4_agent_protocol_guard *s,
                                  ds4_agent_protocol_failure_class cls,
                                  const char *terminal)
{
    dynbuf_printf(b, "%s\ncode=%s\nsameFailureCount=%d\ntotalFailureCount=%d\n"
                     "terminal=%s\n\n",
                  banner, ds4_agent_protocol_failure_name(cls),
                  s->same_failure_count, s->total_failure_count, terminal);
}

static void protocol_guard_detail(DynBuf *b, const char *detail) {
    if (detail && detail[0]) dynbuf_printf(b, "detail: %s\n\n", detail);
}

char *ds4_agent_protocol_repair_guidance(const ds4_agent_protocol_guard *s,
                                         ds4_agent_protocol_failure_class cls,
                                         const char *detail)
{
    DynBuf b = {0};
    protocol_guard_header(&b, "TOOL_PROTOCOL_REPAIR_REQUIRED", s, cls, "false");
    protocol_guard_detail(&b, detail);
    dynbuf_puts(&b, protocol_repair_hint(cls));
    return b.ptr ? b.ptr : strdup("");
}

/* Second identical occurrence: repeating the repair has already failed once, so
 * the instruction changes rather than being restated louder. */
char *ds4_agent_protocol_strategy_guidance(const ds4_agent_protocol_guard *s,
                                           ds4_agent_protocol_failure_class cls,
                                           const char *detail)
{
    DynBuf b = {0};
    protocol_guard_header(&b, "TOOL_PROTOCOL_STRATEGY_CHANGE_REQUIRED", s, cls,
                          "false");
    protocol_guard_detail(&b, detail);
    dynbuf_puts(&b,
        "The same protocol failure has now happened twice.\n"
        "Do not attempt another tool call in this round.\n"
        "Produce a concise final answer from existing evidence,\n"
        "unless an authoritative domain task is still nonterminal.\n");
    return b.ptr ? b.ptr : strdup("");
}

char *ds4_agent_protocol_terminal_notice(const ds4_agent_protocol_guard *s,
                                         ds4_agent_protocol_failure_class cls,
                                         const char *detail)
{
    DynBuf b = {0};
    dynbuf_printf(&b,
        "TOOL_PROTOCOL_TERMINAL\ncode=TOOL_CONTRACT_FAILURE\n"
        "failureClass=%s\nsequence=%d\nsameFailureCount=%d\ntotalFailureCount=%d\n"
        "terminal=true\n",
        ds4_agent_protocol_failure_name(cls), s->sequence,
        s->same_failure_count, s->total_failure_count);
    if (s->terminal_reason[0])
        dynbuf_printf(&b, "reason=%s\n", s->terminal_reason);
    if (detail && detail[0]) dynbuf_printf(&b, "detail: %s\n", detail);
    dynbuf_puts(&b, "\nNo further tool call may be made in this turn.\n");
    return b.ptr ? b.ptr : strdup("");
}
