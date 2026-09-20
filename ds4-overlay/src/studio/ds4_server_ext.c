/* ds4_server_ext.c - see ds4_server_ext.h.
 *
 * Every handler is a thin decorator: count it, time it, delegate.  Studio
 * behaviour that cannot be expressed here because it lives *inside* an upstream
 * function (the per-request prefill/decode timing fields, for instance) is
 * carried by studio/overlay/ds4_server.ops instead, not by editing ds4_server.c.
 */
#include "ds4_server_ext.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>

struct ds4_server_ext {
    ds4_server_runtime *base;
    ds4_wrapper *wrapper;
    ds4_server_ext_options opt;

    ds4_server_ext_metrics m;
    double request_t0;
};

static double ext_now_sec(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

int ds4_server_ext_init(ds4_server_ext **out,
                        ds4_wrapper *wrapper,
                        const ds4_server_runtime_options *base_opt,
                        const ds4_server_ext_options *ext_opt) {
    if (!out || !wrapper) return -1;
    *out = NULL;

    ds4_server_ext *ext = calloc(1, sizeof(*ext));
    if (!ext) return -1;

    ext->wrapper = wrapper;
    if (ext_opt) ext->opt = *ext_opt;

    if (ds4_server_runtime_init(&ext->base, wrapper, base_opt) != 0) {
        free(ext);
        return -1;
    }
    *out = ext;
    return 0;
}

void ds4_server_ext_free(ds4_server_ext *ext) {
    if (!ext) return;
    ds4_server_runtime_free(ext->base);
    free(ext);
}

ds4_server_runtime *ds4_server_ext_base(ds4_server_ext *ext) {
    return ext ? ext->base : NULL;
}

/* One decorator body for every handler: the only per-handler difference is
 * which runtime entry point runs, so spell that difference once. */
#define DS4_SERVER_EXT_HANDLER(name)                                          \
    int ds4_server_ext_handle_##name(ds4_server_ext *ext,                     \
                                     struct http_request *req,                \
                                     struct http_response *res) {             \
        if (!ext || !ext->base) return -1;                                    \
        ext->m.requests++;                                                    \
        const double t0 = ext->opt.enable_usage_timing ? ext_now_sec() : 0.0; \
        int rc = ds4_server_runtime_handle_##name(ext->base, req, res);       \
        if (ext->opt.enable_usage_timing) {                                   \
            ext->m.last_request_sec = ext_now_sec() - t0;                     \
            ext->m.total_request_sec += ext->m.last_request_sec;              \
        }                                                                     \
        if (rc != 0) ext->m.requests_failed++;                                \
        return rc;                                                            \
    }

DS4_SERVER_EXT_HANDLER(models)
DS4_SERVER_EXT_HANDLER(chat_completions)
DS4_SERVER_EXT_HANDLER(token_count)
DS4_SERVER_EXT_HANDLER(responses)
DS4_SERVER_EXT_HANDLER(messages)
DS4_SERVER_EXT_HANDLER(completions)
DS4_SERVER_EXT_HANDLER(server_metrics)

#undef DS4_SERVER_EXT_HANDLER

void ds4_server_ext_get_default_skills_status(ds4_server_ext *ext,
                                              ds4_default_skills_status *out) {
    if (!out) return;
    if (!ext || !ext->base) { memset(out, 0, sizeof(*out)); return; }
    ds4_server_runtime_get_default_skills_status(ext->base, out);
}

void ds4_server_ext_begin_request(ds4_server_ext *ext) {
    if (!ext || !ext->base) return;
    ext->request_t0 = ext_now_sec();
    ds4_server_runtime_begin_request(ext->base);
}

bool ds4_server_ext_interrupt(ds4_server_ext *ext) {
    if (!ext || !ext->base) return false;
    bool hit = ds4_server_runtime_interrupt(ext->base);
    if (hit) ext->m.interrupts++;
    return hit;
}

void ds4_server_ext_end_request(ds4_server_ext *ext) {
    if (!ext || !ext->base) return;
    ds4_server_runtime_end_request(ext->base);
}

void ds4_server_ext_get_metrics(ds4_server_ext *ext,
                                ds4_server_ext_metrics *out) {
    if (!out) return;
    if (!ext) { memset(out, 0, sizeof(*out)); return; }
    *out = ext->m;
}
