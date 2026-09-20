/* ds4_server_ext.h - DS4 Studio policy decorator over ds4_server_runtime.
 *
 * Boundary rule: the wrapper talks to *_ext only.  ds4_server_runtime is the
 * adapter that owns the upstream ds4_server.c translation unit; this layer is
 * where Studio policy (timing, cache accounting, request accounting) lives, so
 * upstream and adapter can both move without the wrapper noticing.
 *
 *     wrapper -> ds4_server_ext -> ds4_server_runtime -> upstream ds4_server.c
 */
#ifndef DS4_SERVER_EXT_H
#define DS4_SERVER_EXT_H

#include "ds4_server_runtime.h"

#include <stdbool.h>
#include <stdint.h>

typedef struct ds4_server_ext ds4_server_ext;

typedef struct {
    bool enable_usage_timing;   /* record per-request prefill/decode wall time */
    bool enable_cache_metrics;  /* record kv cache hit/miss counters */
} ds4_server_ext_options;

typedef struct {
    uint64_t requests;
    uint64_t requests_failed;
    uint64_t interrupts;
    double last_request_sec;
    double total_request_sec;
} ds4_server_ext_metrics;

int ds4_server_ext_init(ds4_server_ext **out,
                        ds4_wrapper *wrapper,
                        const ds4_server_runtime_options *base_opt,
                        const ds4_server_ext_options *ext_opt);

void ds4_server_ext_free(ds4_server_ext *ext);

/* Escape hatch for call sites not yet migrated to the ext surface. Prefer the
 * ds4_server_ext_* entry points; this exists so the migration can be partial
 * without duplicating every runtime accessor up front. */
ds4_server_runtime *ds4_server_ext_base(ds4_server_ext *ext);

int ds4_server_ext_handle_models(ds4_server_ext *ext,
                                 struct http_request *req,
                                 struct http_response *res);
int ds4_server_ext_handle_chat_completions(ds4_server_ext *ext,
                                           struct http_request *req,
                                           struct http_response *res);
int ds4_server_ext_handle_token_count(ds4_server_ext *ext,
                                      struct http_request *req,
                                      struct http_response *res);
int ds4_server_ext_handle_responses(ds4_server_ext *ext,
                                    struct http_request *req,
                                    struct http_response *res);
int ds4_server_ext_handle_messages(ds4_server_ext *ext,
                                   struct http_request *req,
                                   struct http_response *res);
int ds4_server_ext_handle_completions(ds4_server_ext *ext,
                                      struct http_request *req,
                                      struct http_response *res);
int ds4_server_ext_handle_server_metrics(ds4_server_ext *ext,
                                         struct http_request *req,
                                         struct http_response *res);

void ds4_server_ext_get_default_skills_status(ds4_server_ext *ext,
                                              ds4_default_skills_status *out);

void ds4_server_ext_begin_request(ds4_server_ext *ext);
bool ds4_server_ext_interrupt(ds4_server_ext *ext);
void ds4_server_ext_end_request(ds4_server_ext *ext);

void ds4_server_ext_get_metrics(ds4_server_ext *ext,
                                ds4_server_ext_metrics *out);

#endif
