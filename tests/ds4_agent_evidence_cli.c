/* Evidence guard conformance driver (piano WP10): reads an .ops file and
 * prints one deterministic line per operation so the Node port
 * (frontend/server/evidenceGuard.mjs) can be diffed against the C module
 * byte for byte.
 *
 *   make -f Makefile.studio tests/ds4_agent_evidence_cli
 *   tests/ds4_agent_evidence_cli tests/fixtures/conformance/evidence/t05_confirmed_high.ops
 *
 * Output protocol (the JS mini-interpreter mirrors it exactly):
 *   OK                                    accepted operation
 *   REJ <reason_code> <finding_id|-> <missing_hex>   rejected operation
 *   MODE <off|shadow|block> | ERR <msg>   mode resolution
 *   ERR <msg>                             malformed command line
 *   raw text                              status / digest / serialize
 */
#include "ds4_agent_evidence_guard.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_TOK 16

static ds4_agent_evidence_state st;
static ds4_agent_evidence_turn turn;
static ds4_evidence_mode g_mode = DS4_EVIDENCE_MODE_BLOCK;
static const char *g_rev = "-";

/* Split a line into tokens: bare words or "quoted" text with \n \t \" \\
 * escapes.  Returns the token count; tokens point into the line buffer. */
static int tokenize(char *line, char **tok, int max) {
    int n = 0;
    char *p = line;
    while (*p && n < max) {
        while (*p == ' ' || *p == '\t') p++;
        if (!*p) break;
        if (*p == '"') {
            p++;
            char *out = p;
            tok[n++] = out;
            while (*p && *p != '"') {
                if (*p == '\\' && p[1]) {
                    p++;
                    *out++ = (*p == 'n') ? '\n' : (*p == 't') ? '\t' : *p;
                    p++;
                } else {
                    *out++ = *p++;
                }
            }
            *out = '\0';
            if (*p == '"') p++;
        } else {
            tok[n++] = p;
            while (*p && *p != ' ' && *p != '\t') p++;
            if (*p) {
                *p = '\0';
                p++;
            }
        }
    }
    return n;
}

/* Join tokens [from, n) with single spaces into buf. */
static void join(char *buf, size_t cap, char **tok, int from, int n) {
    size_t used = 0;
    buf[0] = '\0';
    for (int i = from; i < n; i++) {
        int w = snprintf(buf + used, cap - used, i > from ? " %s" : "%s", tok[i]);
        if (w < 0 || (size_t)w >= cap - used) break;
        used += (size_t)w;
    }
}

static void print_result(ds4_evidence_validation_result *r) {
    if (r->allowed) {
        puts("OK");
        return;
    }
    printf("REJ %s %s %x\n", r->reason_code ? r->reason_code : "?",
           r->finding_id[0] ? r->finding_id : "-", r->missing_checks);
}

static bool need(int n, int have) {
    if (have >= n) return true;
    printf("ERR too few arguments\n");
    return false;
}

static void fill_ledger(void) {
    ds4_evidence_validation_result r;
    char id[16];
    for (int i = 0; i < DS4_EVIDENCE_MAX_FINDINGS; i++) {
        snprintf(id, sizeof(id), "EFA-%03d", i + 1);
        ds4_agent_evidence_open(&st, id, "c", DS4_EVIDENCE_CATEGORY_GENERAL, &r);
    }
}

static void run_line(char *line) {
    char *tok[MAX_TOK];
    int n = tokenize(line, tok, MAX_TOK);
    if (n == 0 || tok[0][0] == '#') return;
    ds4_evidence_validation_result r;
    char scratch[4096];

    if (!strcmp(tok[0], "reset")) {
        ds4_agent_evidence_init(&st);
        ds4_agent_evidence_turn_reset(&turn);
        st.enabled = true;
        g_mode = DS4_EVIDENCE_MODE_BLOCK;
        g_rev = "-";
        return;
    }
    if (!strcmp(tok[0], "fill")) {
        fill_ledger();
        puts("OK");
        return;
    }
    if (!strcmp(tok[0], "open")) {
        if (!need(3, n)) return;
        ds4_evidence_category cat = DS4_EVIDENCE_CATEGORY_GENERAL;
        if (!ds4_evidence_category_parse(tok[2], &cat)) {
            printf("ERR bad category\n");
            return;
        }
        join(scratch, sizeof(scratch), tok, 3, n);
        ds4_agent_evidence_open(&st, tok[1], scratch, cat, &r);
        print_result(&r);
        return;
    }
    if (!strcmp(tok[0], "add")) {
        if (!need(4, n)) return;
        ds4_evidence_side side;
        if (!strcmp(tok[2], "for")) side = DS4_EVIDENCE_FOR;
        else if (!strcmp(tok[2], "against")) side = DS4_EVIDENCE_AGAINST;
        else {
            printf("ERR bad side\n");
            return;
        }
        bool dynamic = !strcmp(tok[3], "dynamic");
        ds4_agent_evidence_add(&st, tok[1], side, dynamic, &r);
        print_result(&r);
        return;
    }
    if (!strcmp(tok[0], "mark") || !strcmp(tok[0], "markbit")) {
        if (!need(4, n)) return;
        uint32_t bit = 0;
        if (!strcmp(tok[0], "mark")) {
            if (!ds4_evidence_check_parse(tok[2], &bit)) {
                printf("ERR bad check\n");
                return;
            }
        } else {
            bit = (uint32_t)strtoul(tok[2], NULL, 10);
        }
        ds4_evidence_check_result res;
        if (!ds4_evidence_check_result_parse(tok[3], &res)) {
            printf("ERR bad result\n");
            return;
        }
        const char *note = NULL;
        if (n >= 5) note = strcmp(tok[4], "-") ? tok[4] : NULL;
        ds4_agent_evidence_mark_check(&st, tok[1], bit, res, note, &r);
        print_result(&r);
        return;
    }
    if (!strcmp(tok[0], "reach")) {
        if (!need(3, n)) return;
        ds4_evidence_reachability reach;
        if (!ds4_evidence_reachability_parse(tok[2], &reach)) {
            printf("ERR bad reachability\n");
            return;
        }
        ds4_agent_evidence_set_reachability(&st, tok[1], reach, &r);
        print_result(&r);
        return;
    }
    if (!strcmp(tok[0], "verdict")) {
        if (!need(5, n)) return;
        ds4_evidence_finding_state verdict;
        ds4_evidence_severity severity;
        if (!ds4_evidence_state_parse(tok[2], &verdict)) {
            printf("ERR bad state\n");
            return;
        }
        if (!ds4_evidence_severity_parse(tok[3], &severity)) {
            printf("ERR bad severity\n");
            return;
        }
        bool include = !strcmp(tok[4], "true");
        ds4_agent_evidence_set_verdict(&st, tok[1], verdict, severity, include, &r);
        print_result(&r);
        return;
    }
    if (!strcmp(tok[0], "finalize")) {
        ds4_agent_evidence_finalize(&st, &r);
        print_result(&r);
        return;
    }
    if (!strcmp(tok[0], "publish")) {
        ds4_agent_evidence_can_publish(&st, &r);
        print_result(&r);
        return;
    }
    if (!strcmp(tok[0], "tool")) {
        if (!need(2, n)) return;
        ds4_agent_evidence_note_tool_call(&st, &turn, !strcmp(tok[1], "status"));
        printf("TOOL %d\n", turn.tool_used_after_finalize ? 1 : 0);
        return;
    }
    if (!strcmp(tok[0], "scan")) {
        join(scratch, sizeof(scratch), tok, 1, n);
        ds4_agent_evidence_scan_final_text(&st, scratch, &r);
        print_result(&r);
        return;
    }
    if (!strcmp(tok[0], "status")) {
        char buf[16384];
        ds4_agent_evidence_status(&st, g_mode, g_rev, buf, sizeof(buf));
        fputs(buf, stdout);
        return;
    }
    if (!strcmp(tok[0], "digest")) {
        char buf[4096];
        ds4_agent_evidence_digest(&st, buf, sizeof(buf));
        fputs(buf, stdout);
        return;
    }
    if (!strcmp(tok[0], "serialize")) {
        char *text = NULL;
        size_t len = 0;
        if (!ds4_agent_evidence_serialize(&st, &text, &len)) {
            printf("ERR serialize failed\n");
            return;
        }
        fwrite(text, 1, len, stdout);
        free(text);
        return;
    }
    if (!strcmp(tok[0], "mode")) {
        if (!need(3, n)) return;
        const char *env = strcmp(tok[1], "-") ? tok[1] : NULL;
        bool skill = !strcmp(tok[2], "yes");
        char err[160] = {0};
        ds4_evidence_mode mode;
        if (ds4_evidence_mode_resolve(env, skill, &mode, err, sizeof(err))) {
            g_mode = mode;
            printf("MODE %s\n", ds4_evidence_mode_name(mode));
        } else {
            printf("ERR %s\n", err);
        }
        return;
    }
    printf("ERR unknown op %s\n", tok[0]);
}

int main(int argc, char **argv) {
    FILE *in = stdin;
    if (argc > 1) {
        in = fopen(argv[1], "r");
        if (!in) {
            fprintf(stderr, "cannot open %s\n", argv[1]);
            return 2;
        }
    }
    char line[8192];
    while (fgets(line, sizeof(line), in)) {
        size_t len = strlen(line);
        while (len && (line[len - 1] == '\n' || line[len - 1] == '\r')) line[--len] = '\0';
        run_line(line);
    }
    if (in != stdin) fclose(in);
    return 0;
}
