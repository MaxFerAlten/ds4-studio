#define DS4_SERVER_TEST
#define DS4_SERVER_TEST_NO_MAIN
#include "ds4_server.c"

#include "ds4_server_runtime.h"
#include <stdlib.h>
#include <string.h>

struct ds4_server_runtime {
    ds4_wrapper *wrapper;
    ds4_server_runtime_options opt;
    server s;
    pthread_t worker;
    bool worker_started;
};

/* Minimal metrics shim.  The studio server carried ~30 instrumented fields on
 * the `server` struct; this fork does not.  The wrapper only needs a live
 * snapshot, so we read what this fork actually exposes (queue depth + kv state)
 * at send time and keep the refresh hooks as no-ops. */
static void server_metrics_refresh_kv_snapshot(server *s) { (void)s; }
static void server_metrics_refresh_mtp_snapshot(server *s) { (void)s; }

static bool send_server_metrics(server *s, int fd) {
    int queued = 0;
    pthread_mutex_lock(&s->mu);
    for (job *j = s->head; j; j = j->next) queued++;
    pthread_mutex_unlock(&s->mu);

    int kv_enabled = s->kv.enabled ? 1 : 0;
    int kv_entries = s->kv.len;
    unsigned long long kv_budget = (unsigned long long)s->kv.budget_bytes;

    char tmp[256];
    snprintf(tmp, sizeof(tmp),
             "{\"queued_jobs\":%d,\"kv_cache_enabled\":%d,"
             "\"kv_cache_entries\":%d,\"kv_cache_budget_bytes\":%llu,"
             "\"mtp_enabled\":0}\n",
             queued, kv_enabled, kv_entries, kv_budget);

    buf b = {0};
    buf_puts(&b, tmp);
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

    server *s = &rt->s;
    s->engine = wrapper->engine;
    s->session = wrapper->active_session;
    s->default_tokens = rt->opt.default_tokens;
    s->enable_cors = rt->opt.enable_cors;
    s->disable_exact_dsml_tool_replay = rt->opt.disable_exact_dsml_tool_replay;
    s->tool_mem.max_entries = rt->opt.tool_memory_max_ids;

    pthread_mutex_init(&s->mu, NULL);
    pthread_cond_init(&s->cv, NULL);
    pthread_cond_init(&s->clients_cv, NULL);
    pthread_mutex_init(&s->tool_mu, NULL);
    pthread_mutex_init(&s->trace_mu, NULL);

    if (rt->opt.kv_disk_dir) {
        kv_cache_open(&s->kv, rt->opt.kv_disk_dir, rt->opt.kv_disk_space_mb,
                      rt->opt.kv_reject_different_quant, rt->opt.kv_options);
    }

    server_metrics_refresh_kv_snapshot(s);
    server_metrics_refresh_mtp_snapshot(s);

    if (pthread_create(&rt->worker, NULL, worker_main, s) != 0) {
        if (rt->opt.kv_disk_dir) kv_cache_close(&s->kv);
        pthread_mutex_destroy(&s->mu);
        pthread_cond_destroy(&s->cv);
        pthread_cond_destroy(&s->clients_cv);
        pthread_mutex_destroy(&s->tool_mu);
        pthread_mutex_destroy(&s->trace_mu);
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
    live_tool_state_free(&s->responses_live);
    live_tool_state_free(&s->anthropic_live);
    visible_live_free(&s->thinking_live);
    pthread_mutex_destroy(&s->tool_mu);
    pthread_mutex_destroy(&s->trace_mu);
    pthread_cond_destroy(&s->clients_cv);
    pthread_cond_destroy(&s->cv);
    pthread_mutex_destroy(&s->mu);

    free(rt);
}

static int ds4_server_runtime_run_job(ds4_server_runtime *rt, request *r, int fd, bool enable_cors) {
    server *s = &rt->s;

    // Refresh metrics snapshots
    server_metrics_refresh_kv_snapshot(s);
    server_metrics_refresh_mtp_snapshot(s);

    job j;
    memset(&j, 0, sizeof(j));
    j.fd = fd;
    j.req = *r;
    pthread_mutex_init(&j.mu, NULL);
    pthread_cond_init(&j.cv, NULL);

    pthread_mutex_lock(&j.mu);
    /* This fork's enqueue() is an unbounded FIFO returning bool (false only when
     * the server is shutting down); there is no ENQUEUE_FULL backpressure. */
    if (!enqueue(s, &j)) {
        pthread_mutex_unlock(&j.mu);
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
     * ds4_session_ctx(s->session) and would NULL-deref on the stale init value. */
    s->session = rt->wrapper->active_session;
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
    s->session = rt->wrapper->active_session;

    request r;
    char err_buf[160];
    const int ctx_size = ds4_session_ctx(s->session);

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

int ds4_server_runtime_handle_responses(ds4_server_runtime *rt,
                                         struct http_request *req,
                                         struct http_response *res) {
    server *s = &rt->s;
    s->session = rt->wrapper->active_session;

    request r;
    char err_buf[160];
    const int ctx_size = ds4_session_ctx(s->session);

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
    s->session = rt->wrapper->active_session;

    request r;
    char err_buf[160];
    const int ctx_size = ds4_session_ctx(s->session);

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
    s->session = rt->wrapper->active_session;

    request r;
    char err_buf[160];
    const int ctx_size = ds4_session_ctx(s->session);

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
    s->session = rt->wrapper->active_session;
    // Refresh snapshot before sending
    server_metrics_refresh_kv_snapshot(s);
    server_metrics_refresh_mtp_snapshot(s);
    send_server_metrics(s, res->fd);
    return 0;
}
