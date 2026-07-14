#include "ds4_wrapper_metrics.h"
#include "ds4_agent_runtime.h"
#include "ds4_server_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

static void *met_xrealloc(void *p, size_t n) {
    p = realloc(p, n ? n : 1);
    if (!p) { fprintf(stderr, "ds4-wrapper: out of memory\n"); abort(); }
    return p;
}

typedef struct {
    char *ptr;
    size_t len;
    size_t cap;
} met_buf;

static void met_buf_reserve(met_buf *b, size_t add) {
    size_t need = b->len + add + 1;
    if (need <= b->cap) return;
    size_t cap = b->cap ? b->cap * 2 : 256;
    while (cap < need) cap *= 2;
    b->ptr = met_xrealloc(b->ptr, cap);
    b->cap = cap;
}

static void met_buf_puts(met_buf *b, const char *s) {
    size_t n = strlen(s);
    met_buf_reserve(b, n);
    memcpy(b->ptr + b->len, s, n);
    b->len += n;
    b->ptr[b->len] = '\0';
}

static void met_buf_printf(met_buf *b, const char *fmt, ...)
    __attribute__((format(printf, 2, 3)));

static void met_buf_printf(met_buf *b, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    va_list ap2;
    va_copy(ap2, ap);
    int n = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (n < 0) { fprintf(stderr, "ds4-wrapper: vsnprintf failed\n"); abort(); }
    met_buf_reserve(b, (size_t)n);
    vsnprintf(b->ptr + b->len, b->cap - b->len, fmt, ap2);
    va_end(ap2);
    b->len += (size_t)n;
}

static void session_meta_json(met_buf *b, const char *key, const ds4_wrap_session_meta *m) {
    met_buf_printf(b,
        "\"%s\":{"
        "\"exists\":%s,"
        "\"active\":%s,"
        "\"tokens\":%d,"
        "\"frozen_kind\":\"%s\","
        "\"last_freeze_ms\":%.2f,"
        "\"last_thaw_ms\":%.2f"
        "}",
        key,
        m->exists ? "true" : "false",
        m->active ? "true" : "false",
        m->tokens,
        ds4_wrap_frozen_kind_name(m->frozen_kind),
        m->last_freeze_ms,
        m->last_thaw_ms);
}

char *ds4_wrapper_status_json(const ds4_wrapper *w) {
    met_buf b = {0};
    met_buf_puts(&b, "{");

    /* Fields required by §14.4 of the codex */
    met_buf_puts(&b,
        "\"running\":true,"
        "\"healthy\":true,"
        "\"backend\":\"wrapper\","
        "\"model_loaded\":true,");

    /* Active session summary */
    int active_tokens = w->active_session ?
        (int)ds4_session_pos(w->active_session) : 0;
    met_buf_printf(&b,
        "\"active_session\":{"
        "\"mode\":\"%s\","
        "\"tokens\":%d"
        "},",
        ds4_wrap_mode_name(w->active_mode),
        active_tokens);

    met_buf_printf(&b,
        "\"active_mode\":\"%s\","
        "\"state\":\"%s\","
        "\"busy\":%s,"
        "\"configured_ctx_size\":%d,"
        "\"configured_tokens\":%d,",
        ds4_wrap_mode_name(w->active_mode),
        ds4_wrap_state_name(w->state),
        w->busy ? "true" : "false",
        w->configured_ctx_size,
        w->configured_tokens);

    met_buf_puts(&b, "\"sessions\":{");
    session_meta_json(&b, "server", &w->server_meta);
    met_buf_puts(&b, ",");
    session_meta_json(&b, "agent", &w->agent_meta);
    met_buf_puts(&b, "},");

    met_buf_printf(&b,
        "\"metrics\":{"
        "\"total_requests\":%llu,"
        "\"rejected_busy\":%llu,"
        "\"rejected_wrong_mode\":%llu,"
        "\"switch_count\":%llu,"
        "\"freeze_count\":%llu,"
        "\"thaw_count\":%llu,"
        "\"last_freeze_ms\":%.2f,"
        "\"last_thaw_ms\":%.2f,"
        "\"last_switch_ms\":%.2f"
        "}",
        (unsigned long long)w->total_requests,
        (unsigned long long)w->rejected_busy,
        (unsigned long long)w->rejected_wrong_mode,
        (unsigned long long)w->switch_count,
        (unsigned long long)w->freeze_count,
        (unsigned long long)w->thaw_count,
        w->last_freeze_ms,
        w->last_thaw_ms,
        w->last_switch_ms);

    /* Default skills status */
    {
        ds4_default_skills_status server_skills = {0};
        ds4_default_skills_status agent_skills = {0};

        ds4_server_runtime_get_default_skills_status(
            w->server_rt, &server_skills);
        ds4_agent_runtime_get_default_skills_status(
            w->agent_rt, &agent_skills);

        met_buf_puts(&b, ",\"default_skills\":{");
        met_buf_printf(&b,
            "\"server\":{"
            "\"runtime_initialized\":%s,"
            "\"enabled\":%s,"
            "\"soul_loaded\":%s,"
            "\"ethic_loaded\":%s,"
            "\"soul_bytes\":%zu,"
            "\"ethic_bytes\":%zu,"
            "\"revision\":\"%.40s\""
            "},",
            w->server_rt ? "true" : "false",
            server_skills.enabled ? "true" : "false",
            server_skills.soul_loaded ? "true" : "false",
            server_skills.ethic_loaded ? "true" : "false",
            server_skills.soul_bytes,
            server_skills.ethic_bytes,
            server_skills.revision);
        met_buf_printf(&b,
            "\"agent\":{"
            "\"runtime_initialized\":%s,"
            "\"enabled\":%s,"
            "\"soul_loaded\":%s,"
            "\"ethic_loaded\":%s,"
            "\"soul_bytes\":%zu,"
            "\"ethic_bytes\":%zu,"
            "\"revision\":\"%.40s\""
            "}"
            "}",
            w->agent_rt ? "true" : "false",
            agent_skills.enabled ? "true" : "false",
            agent_skills.soul_loaded ? "true" : "false",
            agent_skills.ethic_loaded ? "true" : "false",
            agent_skills.soul_bytes,
            agent_skills.ethic_bytes,
            agent_skills.revision);
    }

    if (w->last_error[0]) {
        met_buf_puts(&b, ",\"last_error\":\"");
        /* Simple escape for the error string */
        for (const char *p = w->last_error; *p; p++) {
            if (*p == '"') met_buf_puts(&b, "\\\"");
            else if (*p == '\\') met_buf_puts(&b, "\\\\");
            else if (*p == '\n') met_buf_puts(&b, "\\n");
            else { char c[2] = {*p, 0}; met_buf_puts(&b, c); }
        }
        met_buf_puts(&b, "\"");
    }

    met_buf_puts(&b, "}\n");
    return b.ptr;
}
