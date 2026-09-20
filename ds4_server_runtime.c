#define DS4_SERVER_TEST
#define DS4_SERVER_TEST_NO_MAIN
/* The upstream monolith is included textually so the runtime can reach its
 * static helpers.  Makefile.studio redirects this to the overlay-generated
 * copy under build/studio/ so upstream itself stays pristine; building
 * without Makefile.studio still compiles against the raw upstream file. */
#ifndef DS4_SERVER_UPSTREAM_SRC
#define DS4_SERVER_UPSTREAM_SRC "ds4_server.c"
#endif
#include DS4_SERVER_UPSTREAM_SRC

#include "ds4_server_runtime.h"
#include <stdlib.h>
#include <string.h>

struct ds4_server_runtime {
    ds4_wrapper *wrapper;
    ds4_server_runtime_options opt;
    server s;
    pthread_t worker;
    bool worker_started;
    pthread_mutex_t cancel_mu;
    bool request_active;
    bool cancel_requested;
    /* Current upstream ds4_server.c owns cancellation through job.cancelled.
     * Keep the stack-owned job address only while ds4_server_runtime_run_job()
     * is waiting; cancel_mu protects this pointer and its lifetime. */
    job *active_job;
};

/* Compatibility adapter for the modern upstream server/KV layout.
 *
 * The historical Studio fork exposed detailed cumulative counters through
 * ds4_kvstore_stats and server.cache_stats.  Upstream removed those storage
 * fields, so reading them here is not merely stale: it does not compile.
 * Preserve the wrapper JSON contract and report the counters that can be
 * derived from live state; legacy cumulative fields are emitted as zero until
 * their instrumentation is ported into the modern kvstore. */
static void server_metrics_refresh_kv_snapshot(server *s) { (void)s; }
static void server_metrics_refresh_mtp_snapshot(server *s) { (void)s; }

static bool runtime_kv_model_namespace(const char *base_dir,
                                       const char *model_path,
                                       char **active_dir_out,
                                       char *err, size_t err_len) {
    if (active_dir_out) *active_dir_out = NULL;
    if (!base_dir || !base_dir[0] || !model_path || !model_path[0]) {
        snprintf(err, err_len, "model path and KV base directory are required");
        return false;
    }
    struct stat st;
    if (stat(model_path, &st) != 0 || !S_ISREG(st.st_mode)) {
        snprintf(err, err_len, "model path is not a regular file: %s", model_path);
        return false;
    }
    char *resolved = realpath(model_path, NULL);
    if (!resolved) {
        snprintf(err, err_len, "realpath model %s: %s", model_path, strerror(errno));
        return false;
    }
    char identity[2048];
    int n = snprintf(identity, sizeof(identity),
                     "ds4-kv-model-id-v1\
path=%s\
dev=%llu\
ino=%llu\
size=%llu\
"
                     "mtime_sec=%lld\
mtime_nsec=%lld\
ctime_sec=%lld\
ctime_nsec=%lld\
",
                     resolved,
                     (unsigned long long)st.st_dev,
                     (unsigned long long)st.st_ino,
                     (unsigned long long)st.st_size,
                     (long long)st.st_mtime,
                     (long long)st.st_mtim.tv_nsec,
                     (long long)st.st_ctime,
                     (long long)st.st_ctim.tv_nsec);
    free(resolved);
    if (n < 0 || (size_t)n >= sizeof(identity)) {
        snprintf(err, err_len, "model identity is too long");
        return false;
    }
    char digest[41];
    ds4_kvstore_sha1_bytes_hex(identity, (size_t)n, digest);
    char name[64];
    snprintf(name, sizeof(name), "model-v1-%s", digest);
    *active_dir_out = ds4_kvstore_path_join(base_dir, name);
    if (!*active_dir_out) {
        snprintf(err, err_len, "failed to allocate KV model namespace");
        return false;
    }
    return true;
}

static bool runtime_send_server_metrics(server *s, int fd) {
    int queued = 0;
    int busy_slots = 0;
    pthread_mutex_lock(&s->mu);
    for (job *j = s->head; j; j = j->next) queued++;
    for (int i = 0; i < s->slot_count; i++) {
        if (s->slots[i].busy || s->slots[i].assigned) busy_slots++;
    }
    pthread_mutex_unlock(&s->mu);
    pthread_mutex_lock(&s->model_mu);
    for (int i = 0; i < s->slot_count; i++) {
        if (s->slots[i].running && !s->slots[i].busy && !s->slots[i].assigned)
            busy_slots++;
    }
    pthread_mutex_unlock(&s->model_mu);

    int kv_enabled;
    int kv_entries;
    unsigned long long kv_budget;
    unsigned long long kv_bytes = 0;
    pthread_mutex_lock(&s->kv_mu);
    kv_enabled = s->kv.enabled ? 1 : 0;
    kv_entries = s->kv.len;
    kv_budget = (unsigned long long)s->kv.budget_bytes;
    for (int i = 0; i < s->kv.len; i++)
        kv_bytes += (unsigned long long)s->kv.entry[i].file_size;
    pthread_mutex_unlock(&s->kv_mu);

    char tmp[1400];
    snprintf(tmp, sizeof(tmp),
             "{\"queued_jobs\":%d,\"busy_slots\":%d,\"slot_count\":%d,"
             "\"kv_cache_enabled\":%d,\"kv_cache_entries\":%d,"
             "\"kv_cache_budget_bytes\":%llu,\"kv_cache_bytes\":%llu,"
             "\"kv_cache_full_scans\":0,\"kv_cache_disk_hits\":0,"
             "\"kv_cache_disk_misses\":0,\"kv_cache_disk_loaded_tokens\":0,"
             "\"kv_cache_store_successes\":0,\"kv_cache_store_failures\":0,"
             "\"kv_cache_last_load_tokens\":0,\"kv_cache_last_load_ms\":0.0,"
             "\"kv_cache_last_store_tokens\":%d,\"kv_cache_store_ok\":0,"
             "\"kv_cache_store_errors\":0,\"kv_cache_load_ok\":0,"
             "\"kv_cache_load_errors\":0,\"kv_cache_rejects\":0,"
             "\"kv_cache_misses\":0,\"kv_cache_bytes_written\":0,"
             "\"kv_cache_bytes_loaded\":0,\"cache_memory_hits\":0,"
             "\"cache_disk_hits\":0,\"cache_cold_requests\":0,"
             "\"mtp_enabled\":%d,\"compat_counters_available\":false}\n",
             queued, busy_slots, s->slot_count,
             kv_enabled, kv_entries, kv_budget, kv_bytes,
             s->slot_count > 0 ? s->slots[0].continued_last_store_tokens : 0,
             ds4_engine_has_mtp(s->engine) ? 1 : 0);

    return http_response(fd, s->enable_cors, 200, "application/json", tmp);
}

static bool runtime_send_token_count(server *s, int fd,
                                     const request *r, int ctx_size) {
    int prompt_tokens = r ? r->prompt.len : 0;
    int max_tokens = r ? r->max_tokens : 0;
    if (prompt_tokens < 0) prompt_tokens = 0;
    if (max_tokens < 0) max_tokens = 0;
    long long required_ll = (long long)prompt_tokens + (long long)max_tokens;
    int required_tokens = required_ll > INT_MAX ? INT_MAX : (int)required_ll;
    int available_tokens = ctx_size > prompt_tokens ? ctx_size - prompt_tokens : 0;
    int excess_tokens = required_tokens > ctx_size ? required_tokens - ctx_size : 0;
    bool fits = required_ll <= (long long)ctx_size;

    buf b = {0};
    buf_puts(&b, "{\"model\":");
    json_escape(&b, r && r->model ? r->model : server_model_id_from_engine(s->engine));
    buf_printf(&b,
        ",\"prompt_tokens\":%d,\"max_tokens\":%d,\"context_length\":%d,"
        "\"required_tokens\":%d,\"available_tokens\":%d,\"excess_tokens\":%d,"
        "\"fits\":%s}\n",
        prompt_tokens, max_tokens, ctx_size, required_tokens,
        available_tokens, excess_tokens, fits ? "true" : "false");
    bool ok = http_response(fd, s->enable_cors, 200, "application/json", b.ptr);
    buf_free(&b);
    return ok;
}

int ds4_server_runtime_init(ds4_server_runtime **out,
                            ds4_wrapper *wrapper,
                            const ds4_server_runtime_options *opt) {
    ds4_server_runtime *rt = calloc(1, sizeof(*rt));
    if (!rt) return -1;
    rt->wrapper = wrapper;
    if (opt) rt->opt = *opt;
    pthread_mutex_init(&rt->cancel_mu, NULL);

    server *s = &rt->s;
    s->engine = wrapper->engine;
    s->slot_count = 1;
    s->batched_mode = false;
    s->mixed_prefill_quantum = 128;
    s->last_prefill_slot = 0;
    s->slots = xmalloc(sizeof(*s->slots));
    memset(s->slots, 0, sizeof(*s->slots));
    s->slots[0].srv = s;
    s->slots[0].id = 0;
    /* active_session is owned by the wrapper and refreshed on every request. */
    s->ctx_size = wrapper->active_session ? ds4_session_ctx(wrapper->active_session) : 0;
    s->slots[0].session = wrapper->active_session;
    s->default_tokens = rt->opt.default_tokens;
    s->enable_cors = rt->opt.enable_cors;
    s->disable_exact_dsml_tool_replay = rt->opt.disable_exact_dsml_tool_replay;
    s->tool_mem.max_entries = rt->opt.tool_memory_max_ids;

    pthread_mutex_init(&s->mu, NULL);
    pthread_cond_init(&s->cv, NULL);
    pthread_cond_init(&s->clients_cv, NULL);
    pthread_mutex_init(&s->tool_mu, NULL);
    pthread_mutex_init(&s->kv_mu, NULL);
    pthread_mutexattr_t inference_attr;
    pthread_mutexattr_init(&inference_attr);
    pthread_mutexattr_settype(&inference_attr, PTHREAD_MUTEX_RECURSIVE);
    pthread_mutex_init(&s->inference_mu, &inference_attr);
    pthread_mutexattr_destroy(&inference_attr);
    pthread_mutex_init(&s->model_mu, NULL);
    pthread_cond_init(&s->model_cv, NULL);
    pthread_mutex_init(&s->trace_mu, NULL);

    char *active_kv_dir = NULL;
    if (rt->opt.kv_disk_dir) {
        char kv_err[256] = {0};
        if (!runtime_kv_model_namespace(rt->opt.kv_disk_dir, rt->opt.model_path,
                                      &active_kv_dir, kv_err, sizeof(kv_err)) ||
            !kv_cache_open(&s->kv, active_kv_dir, rt->opt.kv_disk_space_mb,
                           rt->opt.kv_reject_different_quant, rt->opt.kv_options)) {
            snprintf(wrapper->last_error, sizeof(wrapper->last_error),
                     "KV cache initialization failed: %s",
                     kv_err[0] ? kv_err : "unable to open cache directory");
            free(active_kv_dir);
            free(s->slots);
            pthread_mutex_destroy(&s->mu);
            pthread_cond_destroy(&s->cv);
            pthread_cond_destroy(&s->clients_cv);
            pthread_mutex_destroy(&s->tool_mu);
            pthread_mutex_destroy(&s->kv_mu);
            pthread_mutex_destroy(&s->inference_mu);
            pthread_mutex_destroy(&s->model_mu);
            pthread_cond_destroy(&s->model_cv);
            pthread_mutex_destroy(&s->trace_mu);
            pthread_mutex_destroy(&rt->cancel_mu);
            free(rt);
            return -1;
        }
        free(active_kv_dir);
    }

    server_metrics_refresh_kv_snapshot(s);
    server_metrics_refresh_mtp_snapshot(s);

    /* Modern upstream ds4_server.c no longer stores default-skill state in
     * struct server.  Do not fabricate fields here.  Agent-mode autoload stays
     * independent; server-mode skill injection requires the corresponding
     * ds4_server.c delta to be ported explicitly. */

    if (pthread_create(&rt->worker, NULL, worker_main, s) != 0) {
        if (rt->opt.kv_disk_dir) kv_cache_close(&s->kv);
        free(s->slots);
        pthread_mutex_destroy(&s->mu);
        pthread_cond_destroy(&s->cv);
        pthread_cond_destroy(&s->clients_cv);
        pthread_mutex_destroy(&s->tool_mu);
        pthread_mutex_destroy(&s->kv_mu);
        pthread_mutex_destroy(&s->inference_mu);
        pthread_mutex_destroy(&s->model_mu);
        pthread_cond_destroy(&s->model_cv);
        pthread_mutex_destroy(&s->trace_mu);
        pthread_mutex_destroy(&rt->cancel_mu);
        free(rt);
        return -1;
    }
    rt->worker_started = true;

    *out = rt;
    return 0;
}

void ds4_server_runtime_free(ds4_server_runtime *rt) {
    if (!rt) return;
    server *s = &rt->s;

    pthread_mutex_lock(&s->mu);
    s->stopping = true;
    pthread_cond_broadcast(&s->cv);
    pthread_mutex_unlock(&s->mu);

    if (rt->worker_started) {
        pthread_join(rt->worker, NULL);
    }

    if (rt->opt.kv_disk_dir) {
        kv_cache_close(&s->kv);
    }
    tool_memory_free(&s->tool_mem);
    server_image_cache_clear(&s->image_cache);
    server_slot *slot = &s->slots[0];
    live_tool_state_free(&slot->responses_live);
    live_tool_state_free(&slot->anthropic_live);
    visible_live_free(&slot->thinking_live);
    free(s->slots);
    pthread_mutex_destroy(&s->tool_mu);
    pthread_mutex_destroy(&s->kv_mu);
    pthread_mutex_destroy(&s->inference_mu);
    pthread_mutex_destroy(&s->model_mu);
    pthread_cond_destroy(&s->model_cv);
    pthread_mutex_destroy(&s->trace_mu);
    pthread_cond_destroy(&s->clients_cv);
    pthread_cond_destroy(&s->cv);
    pthread_mutex_destroy(&s->mu);
    pthread_mutex_destroy(&rt->cancel_mu);

    free(rt);
}

void ds4_server_runtime_begin_request(ds4_server_runtime *rt) {
    if (!rt) return;
    pthread_mutex_lock(&rt->cancel_mu);
    rt->request_active = true;
    rt->cancel_requested = false;
    pthread_mutex_unlock(&rt->cancel_mu);
}

bool ds4_server_runtime_interrupt(ds4_server_runtime *rt) {
    if (!rt) return false;
    pthread_mutex_lock(&rt->cancel_mu);
    bool active = rt->request_active;
    if (active) {
        rt->cancel_requested = true;
        /* generate_job() installs job_cancelled as the session callback in the
         * modern server, so setting only rt->cancel_requested would be ignored. */
        if (rt->active_job) job_mark_cancelled(rt->active_job);
    }
    pthread_mutex_unlock(&rt->cancel_mu);
    return active;
}

void ds4_server_runtime_end_request(ds4_server_runtime *rt) {
    if (!rt) return;
    pthread_mutex_lock(&rt->cancel_mu);
    rt->request_active = false;
    rt->cancel_requested = false;
    /* run_job clears this before returning; keep the assignment defensive. */
    rt->active_job = NULL;
    pthread_mutex_unlock(&rt->cancel_mu);
}

void ds4_server_runtime_get_default_skills_status(
    ds4_server_runtime *rt,
    ds4_default_skills_status *out) {
    (void)rt;
    if (!out) return;
    /* Honest compatibility result: modern upstream server has no embedded
     * default-skill storage/injection.  Returning zeros is preferable to
     * reporting skills as loaded when they are not part of this core. */
    memset(out, 0, sizeof(*out));
}

static int ds4_server_runtime_run_job(ds4_server_runtime *rt, request *r, int fd, bool enable_cors) {
    server *s = &rt->s;

    if (!rt->wrapper->active_session) {
        http_error(fd, enable_cors, 503, "wrapper has no active server session");
        request_free(r);
        return 503;
    }
    s->slots[0].session = rt->wrapper->active_session;
    s->ctx_size = ds4_session_ctx(rt->wrapper->active_session);

    job j;
    memset(&j, 0, sizeof(j));
    j.fd = fd;
    j.req = *r;
    pthread_mutex_init(&j.mu, NULL);
    pthread_cond_init(&j.cv, NULL);

    pthread_mutex_lock(&rt->cancel_mu);
    rt->active_job = &j;
    bool cancel_now = rt->request_active && rt->cancel_requested;
    pthread_mutex_unlock(&rt->cancel_mu);
    if (cancel_now) job_mark_cancelled(&j);

    pthread_mutex_lock(&j.mu);
    /* This fork's enqueue() is an unbounded FIFO returning bool (false only when
     * the server is shutting down); there is no ENQUEUE_FULL backpressure. */
    if (!enqueue(s, &j)) {
        pthread_mutex_unlock(&j.mu);
        pthread_mutex_lock(&rt->cancel_mu);
        if (rt->active_job == &j) rt->active_job = NULL;
        pthread_mutex_unlock(&rt->cancel_mu);
        http_error(fd, enable_cors, 503, "server shutting down");
        pthread_cond_destroy(&j.cv);
        pthread_mutex_destroy(&j.mu);
        request_free(&j.req);
        return 503;
    }

    while (!j.done) {
        pthread_cond_wait(&j.cv, &j.mu);
    }
    pthread_mutex_unlock(&j.mu);

    pthread_mutex_lock(&rt->cancel_mu);
    if (rt->active_job == &j) rt->active_job = NULL;
    pthread_mutex_unlock(&rt->cancel_mu);

    pthread_cond_destroy(&j.cv);
    pthread_mutex_destroy(&j.mu);
    request_free(&j.req);

    return 0;
}

int ds4_server_runtime_handle_models(ds4_server_runtime *rt,
                                     struct http_request *req,
                                     struct http_response *res) {
    server *s = &rt->s;
    /* active_session is created after server_runtime_init (and changes on
     * freeze/thaw), so refresh it every request — append_model_json() reads
     * ds4_session_ctx(s->slots[0].session) and would NULL-deref on the stale init value. */
    s->slots[0].session = rt->wrapper->active_session;
    if (rt->wrapper->active_session) s->ctx_size = ds4_session_ctx(rt->wrapper->active_session);
    const char *model_path_prefix = "/v1/models/";
    const size_t model_path_prefix_len = strlen(model_path_prefix);
    if (!strcmp(req->path, "/v1/models")) {
        send_models(s, res->fd);
        return 0;
    } else if (!strncmp(req->path, model_path_prefix, model_path_prefix_len)) {
        const char *alias = req->path + model_path_prefix_len;
        if (server_model_alias_known(alias)) {
            send_model(s, res->fd, alias);
            return 0;
        }
    }
    http_error(res->fd, res->enable_cors, 404, "model not found");
    return 404;
}

int ds4_server_runtime_handle_chat_completions(ds4_server_runtime *rt,
                                               struct http_request *req,
                                               struct http_response *res) {
    server *s = &rt->s;
    s->slots[0].session = rt->wrapper->active_session;
    if (rt->wrapper->active_session) s->ctx_size = ds4_session_ctx(rt->wrapper->active_session);

    if (!s->slots[0].session) {
        http_error(res->fd, res->enable_cors, 503, "wrapper has no active server session");
        return 503;
    }

    request r;
    char err_buf[160];
    const int ctx_size = ds4_session_ctx(s->slots[0].session);

    bool ok = parse_chat_request(s->engine, s, req->body, s->default_tokens,
                                 ctx_size, &r, err_buf, sizeof(err_buf));
    if (!ok) {
        http_error(res->fd, res->enable_cors, 400, err_buf);
        return 400;
    }

    r.raw_body = xstrndup(req->body, req->body_len);

    if (!r.model_from_request) {
        free(r.model);
        r.model = xstrdup(server_model_id_from_engine(s->engine));
    }

    if (request_exceeds_context(&r, ctx_size)) {
        http_error_context_length_exceeded(res->fd, res->enable_cors, &r, r.prompt.len, ctx_size);
        request_free(&r);
        return 400;
    }

    return ds4_server_runtime_run_job(rt, &r, res->fd, res->enable_cors);
}

int ds4_server_runtime_handle_token_count(ds4_server_runtime *rt,
                                          struct http_request *req,
                                          struct http_response *res) {
    server *s = &rt->s;
    s->slots[0].session = rt->wrapper->active_session;
    if (rt->wrapper->active_session) s->ctx_size = ds4_session_ctx(rt->wrapper->active_session);

    if (!s->slots[0].session) {
        http_error(res->fd, res->enable_cors, 503, "wrapper has no active server session");
        return 503;
    }

    request r;
    char err_buf[160];
    const int ctx_size = ds4_session_ctx(s->slots[0].session);

    bool ok = parse_chat_request(s->engine, s, req->body, s->default_tokens,
                                 ctx_size, &r, err_buf, sizeof(err_buf));
    if (!ok) {
        http_error(res->fd, res->enable_cors, 400, err_buf);
        return 400;
    }

    if (!r.model_from_request) {
        free(r.model);
        r.model = xstrdup(server_model_id_from_engine(s->engine));
    }

    bool saved_cors = s->enable_cors;
    s->enable_cors = res->enable_cors;
    runtime_send_token_count(s, res->fd, &r, ctx_size);
    s->enable_cors = saved_cors;
    request_free(&r);
    return 0;
}

int ds4_server_runtime_handle_responses(ds4_server_runtime *rt,
                                         struct http_request *req,
                                         struct http_response *res) {
    server *s = &rt->s;
    s->slots[0].session = rt->wrapper->active_session;
    if (rt->wrapper->active_session) s->ctx_size = ds4_session_ctx(rt->wrapper->active_session);

    if (!s->slots[0].session) {
        http_error(res->fd, res->enable_cors, 503, "wrapper has no active server session");
        return 503;
    }

    request r;
    char err_buf[160];
    const int ctx_size = ds4_session_ctx(s->slots[0].session);

    bool ok = parse_responses_request(s->engine, s, req->body, s->default_tokens,
                                      ctx_size, &r, err_buf, sizeof(err_buf));
    if (!ok) {
        http_error(res->fd, res->enable_cors, 400, err_buf);
        return 400;
    }

    r.raw_body = xstrndup(req->body, req->body_len);

    if (!r.model_from_request) {
        free(r.model);
        r.model = xstrdup(server_model_id_from_engine(s->engine));
    }

    if (request_exceeds_context(&r, ctx_size)) {
        http_error_context_length_exceeded(res->fd, res->enable_cors, &r, r.prompt.len, ctx_size);
        request_free(&r);
        return 400;
    }

    return ds4_server_runtime_run_job(rt, &r, res->fd, res->enable_cors);
}

int ds4_server_runtime_handle_messages(ds4_server_runtime *rt,
                                        struct http_request *req,
                                        struct http_response *res) {
    server *s = &rt->s;
    s->slots[0].session = rt->wrapper->active_session;
    if (rt->wrapper->active_session) s->ctx_size = ds4_session_ctx(rt->wrapper->active_session);

    if (!s->slots[0].session) {
        http_error(res->fd, res->enable_cors, 503, "wrapper has no active server session");
        return 503;
    }

    request r;
    char err_buf[160];
    const int ctx_size = ds4_session_ctx(s->slots[0].session);

    bool ok = parse_anthropic_request(s->engine, s, req->body, s->default_tokens,
                                      ctx_size, &r, err_buf, sizeof(err_buf));
    if (!ok) {
        http_error(res->fd, res->enable_cors, 400, err_buf);
        return 400;
    }

    r.raw_body = xstrndup(req->body, req->body_len);

    if (!r.model_from_request) {
        free(r.model);
        r.model = xstrdup(server_model_id_from_engine(s->engine));
    }

    if (request_exceeds_context(&r, ctx_size)) {
        http_error_context_length_exceeded(res->fd, res->enable_cors, &r, r.prompt.len, ctx_size);
        request_free(&r);
        return 400;
    }

    return ds4_server_runtime_run_job(rt, &r, res->fd, res->enable_cors);
}

int ds4_server_runtime_handle_completions(ds4_server_runtime *rt,
                                           struct http_request *req,
                                           struct http_response *res) {
    server *s = &rt->s;
    s->slots[0].session = rt->wrapper->active_session;
    if (rt->wrapper->active_session) s->ctx_size = ds4_session_ctx(rt->wrapper->active_session);

    if (!s->slots[0].session) {
        http_error(res->fd, res->enable_cors, 503, "wrapper has no active server session");
        return 503;
    }

    request r;
    char err_buf[160];
    const int ctx_size = ds4_session_ctx(s->slots[0].session);

    bool ok = parse_completion_request(s->engine, req->body, s->default_tokens,
                                       ctx_size, &r, err_buf, sizeof(err_buf));
    if (!ok) {
        http_error(res->fd, res->enable_cors, 400, err_buf);
        return 400;
    }

    r.raw_body = xstrndup(req->body, req->body_len);

    if (!r.model_from_request) {
        free(r.model);
        r.model = xstrdup(server_model_id_from_engine(s->engine));
    }

    if (request_exceeds_context(&r, ctx_size)) {
        http_error_context_length_exceeded(res->fd, res->enable_cors, &r, r.prompt.len, ctx_size);
        request_free(&r);
        return 400;
    }

    return ds4_server_runtime_run_job(rt, &r, res->fd, res->enable_cors);
}

int ds4_server_runtime_handle_server_metrics(ds4_server_runtime *rt,
                                             struct http_request *req,
                                             struct http_response *res) {
    (void)req;
    server *s = &rt->s;
    s->slots[0].session = rt->wrapper->active_session;
    if (rt->wrapper->active_session) s->ctx_size = ds4_session_ctx(rt->wrapper->active_session);
    // Refresh snapshot before sending
    server_metrics_refresh_kv_snapshot(s);
    server_metrics_refresh_mtp_snapshot(s);
    runtime_send_server_metrics(s, res->fd);
    return 0;
}
