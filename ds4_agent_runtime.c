/* ds4_agent_runtime.c – embeddable agent runtime for the wrapper.
 *
 * Strategy: include ds4_agent.c to access all static helpers (worker_submit,
 * worker_consume, agent_worker_init/free, etc.) exactly as ds4_server_runtime.c
 * does with ds4_server.c.  The runtime owns an agent_worker whose session
 * pointer is kept in sync with wrapper->active_session. */

#define DS4_AGENT_TEST
#define DS4_AGENT_TEST_NO_MAIN
#include "ds4_agent.c"

#include "ds4_agent_runtime.h"
#include "ds4_crawl_client.h"
#include "ds4_crawl_grounding.h"
#include <poll.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

/* =========================================================================
 * Runtime struct
 * ========================================================================= */

struct ds4_agent_runtime {
    ds4_wrapper *wrapper;
    ds4_agent_runtime_options opt;
    agent_config cfg;
    agent_worker worker;
    bool worker_valid;

    /* Active callback – set for the duration of a _chat call. */
    ds4_agent_event_cb cb;
    void *cb_ud;
};

/* =========================================================================
 * SSE event name mapping – used for publish_cb type classification
 * ========================================================================= */

/* =========================================================================
 * Publish callback – invoked by agent_publish() on the worker thread
 * ========================================================================= */

/* JSON-escape a raw string into dst (caller must provide enough space).
 * Returns number of bytes written (excluding NUL). */
static size_t json_escape_into(char *dst, size_t dst_cap,
                                const char *src, size_t src_len) {
    size_t w = 0;
    for (size_t i = 0; i < src_len && w + 6 < dst_cap; i++) {
        unsigned char c = (unsigned char)src[i];
        if (c == '"')       { dst[w++] = '\\'; dst[w++] = '"'; }
        else if (c == '\\') { dst[w++] = '\\'; dst[w++] = '\\'; }
        else if (c == '\n') { dst[w++] = '\\'; dst[w++] = 'n'; }
        else if (c == '\r') { dst[w++] = '\\'; dst[w++] = 'r'; }
        else if (c == '\t') { dst[w++] = '\\'; dst[w++] = 't'; }
        else if (c < 0x20)  { w += (size_t)snprintf(dst + w, dst_cap - w,
                                                      "\\u%04x", c); }
        else                { dst[w++] = (char)c; }
    }
    dst[w] = '\0';
    return w;
}

/* Filter out ANSI escape sequences from published text.  Returns malloc'd
 * cleaned string.  If the input contains no escapes, just duplicates it. */
static char *strip_ansi(const char *s, size_t n) {
    char *out = malloc(n + 1);
    if (!out) return NULL;
    size_t w = 0;
    for (size_t i = 0; i < n; ) {
        if (s[i] == '\x1b' && i + 1 < n && s[i + 1] == '[') {
            i += 2;
            while (i < n && !((s[i] >= 'A' && s[i] <= 'Z') ||
                              (s[i] >= 'a' && s[i] <= 'z')))
                i++;
            if (i < n) i++; /* skip final letter */
        } else {
            out[w++] = s[i++];
        }
    }
    out[w] = '\0';
    return out;
}

static void runtime_publish_cb(void *ud, const char *s, size_t n) {
    ds4_agent_runtime *rt = ud;
    if (!rt->cb || !n) return;

    /* Strip ANSI colour codes – the HTTP/SSE layer does not want them. */
    char *clean = strip_ansi(s, n);
    if (!clean) return;
    size_t clean_len = strlen(clean);
    if (clean_len == 0) { free(clean); return; }

    /* Map current_event_type from the worker to our enum. */
    ds4_agent_event_type type;
    int etype = rt->worker.current_event_type;
    if (etype == 1)      type = DS4_AGENT_EVENT_REASONING;
    else if (etype == 2) type = DS4_AGENT_EVENT_TOOL_CALL;
    else if (etype == 3) type = DS4_AGENT_EVENT_TOOL_RESULT;
    else if (etype == 4) type = DS4_AGENT_EVENT_STATUS;
    else                 type = DS4_AGENT_EVENT_TEXT;

    /* Build a minimal JSON payload: {"content":"..."} */
    size_t json_cap = clean_len * 6 + 64;
    char *json = malloc(json_cap);
    if (!json) { free(clean); return; }

    size_t pos = 0;
    pos += (size_t)snprintf(json + pos, json_cap - pos, "{\"content\":\"");
    pos += json_escape_into(json + pos, json_cap - pos, clean, clean_len);
    pos += (size_t)snprintf(json + pos, json_cap - pos, "\"}");

    ds4_agent_event ev = { .type = type, .json_payload = json };
    rt->cb(rt->cb_ud, &ev);

    free(json);
    free(clean);
}

/* =========================================================================
 * Init / Free
 * ========================================================================= */

int ds4_agent_runtime_init(ds4_agent_runtime **out,
                           ds4_wrapper *wrapper,
                           const ds4_agent_runtime_options *opt) {
    ds4_agent_runtime *rt = calloc(1, sizeof(*rt));
    if (!rt) return -1;
    rt->wrapper = wrapper;
    if (opt) rt->opt = *opt;

    /* Build agent_config from wrapper settings. */
    memset(&rt->cfg, 0, sizeof(rt->cfg));
    /* Engine options – the engine is already open; we just need the pointer
     * fields for agent_worker_init tracing.  The actual engine handle is
     * passed separately. */
    rt->cfg.gen.ctx_size = wrapper->configured_ctx_size;
    rt->cfg.gen.n_predict = opt ? opt->n_predict : wrapper->configured_tokens;
    if (rt->cfg.gen.n_predict <= 0) rt->cfg.gen.n_predict = wrapper->configured_tokens;
    rt->cfg.gen.temperature = opt ? opt->temperature : 0.0f;
    rt->cfg.gen.top_p = opt ? opt->top_p : 0.9f;
    rt->cfg.gen.min_p = opt ? opt->min_p : 0.05f;
    rt->cfg.gen.seed = opt ? opt->seed : 0;
    rt->cfg.gen.think_mode = (opt && opt->nothink) ? DS4_THINK_NONE : DS4_THINK_HIGH;
    rt->cfg.gen.prompt = NULL; /* not one-shot */
    rt->cfg.gen.system = opt ? opt->system_prompt : NULL;
    rt->cfg.non_interactive = true;

    /* Read the frontend server port from environment so the worker can call
     * back into the Node server for delegated sage execution. */
    {
        const char *fp = getenv("FRONTEND_PORT");
        rt->cfg.frontend_port = fp ? atoi(fp) : 0;
        if (rt->cfg.frontend_port <= 0 || rt->cfg.frontend_port > 65535)
            rt->cfg.frontend_port = 0;
    }

    /* Release the wrapper's placeholder agent session before spawning the
     * worker.  agent_worker_init() calls ds4_session_create() internally; at
     * large context sizes (e.g. 64 K tokens) the GPU has no headroom for a
     * second KV-cache context alongside an already-live session.  Freeing
     * here lets the worker allocate cleanly.  The post-init transfer below
     * re-attaches the system-prompt-processed worker session to
     * wrapper->active_session. */
    if (wrapper->active_session) {
        ds4_session_free(wrapper->active_session);
        wrapper->active_session = NULL;
    }

    if (agent_worker_init(&rt->worker, wrapper->engine, &rt->cfg) != 0) {
        free(rt);
        return -1;
    }
    rt->worker_valid = true;

    /* Wait for the worker to complete its startup and become initialized. */
    while (true) {
        pthread_mutex_lock(&rt->worker.mu);
        bool initialized = rt->worker.initialized;
        pthread_mutex_unlock(&rt->worker.mu);
        if (initialized) break;
        struct pollfd pfd = {.fd = rt->worker.wake_fd[0], .events = POLLIN};
        poll(&pfd, 1, 10);
        if (pfd.revents & POLLIN) drain_wake_fd(rt->worker.wake_fd[0]);
    }

    /* Transfer the system-prompt-processed session from the worker to the
     * wrapper's active_session.  The worker's session already has the system
     * prompt tokenised; freeing it and pointing the worker at the wrapper's
     * fresh session would lose that context. */
    if (rt->worker.session) {
        if (rt->wrapper->active_session) {
            ds4_session_free(rt->wrapper->active_session);
        }
        rt->wrapper->active_session = rt->worker.session;
        rt->worker.session = NULL;

        ds4_wrap_session_meta *m = &rt->wrapper->agent_meta;
        const ds4_tokens *t = ds4_session_tokens(rt->wrapper->active_session);
        m->exists = true;
        m->active = true;
        m->tokens = t ? (int)t->len : 0;
    }

    *out = rt;
    return 0;
}

void ds4_agent_runtime_free(ds4_agent_runtime *rt) {
    if (!rt) return;
    if (rt->worker_valid) {
        /* Null the session pointer to avoid double-free – the wrapper owns
         * active_session and will free it in ds4_wrapper_close(). */
        rt->worker.session = NULL;
        agent_worker_free(&rt->worker);
    }
    free(rt);
}

/* =========================================================================
 * Chat
 * ========================================================================= */

int ds4_agent_runtime_chat(ds4_agent_runtime *rt,
                           const char *user_text,
                           ds4_agent_event_cb cb,
                           void *ud,
                           char *err,
                           size_t err_len) {
    if (!rt || !rt->worker_valid) {
        snprintf(err, err_len, "agent runtime not initialized");
        return -1;
    }

    /* Sync session pointer from wrapper. */
    rt->worker.session = rt->wrapper->active_session;
    if (!rt->worker.session) {
        snprintf(err, err_len, "no active agent session");
        return -1;
    }

    /* Wait for the worker to be initialized. */
    for (int i = 0; i < 300; i++) {
        if (worker_is_initialized(&rt->worker, NULL)) break;
        struct pollfd pfd = {.fd = rt->worker.wake_fd[0], .events = POLLIN};
        poll(&pfd, 1, 100);
        if (pfd.revents & POLLIN) drain_wake_fd(rt->worker.wake_fd[0]);
    }
    if (!worker_is_initialized(&rt->worker, NULL)) {
        snprintf(err, err_len, "agent worker failed to initialize");
        return -1;
    }

    /* Install the publish callback. */
    rt->cb = cb;
    rt->cb_ud = ud;
    rt->worker.publish_cb = runtime_publish_cb;
    rt->worker.publish_ud = rt;
    rt->worker.current_event_type = 0; /* TEXT */

    /* Submit the user message. */
    if (!worker_submit(&rt->worker, user_text)) {
        rt->worker.publish_cb = NULL;
        rt->worker.publish_ud = NULL;
        rt->cb = NULL;
        rt->cb_ud = NULL;
        snprintf(err, err_len, "agent worker busy or not idle");
        return -1;
    }

    /* Emit a status event. */
    if (cb) {
        ds4_agent_event ev = {
            .type = DS4_AGENT_EVENT_STATUS,
            .json_payload = "{\"iteration\":1,\"state\":\"generating\"}"
        };
        cb(ud, &ev);
    }

    /* Poll-drain loop: wait for the worker to return to idle or error. */
    for (;;) {
        struct pollfd pfd = {.fd = rt->worker.wake_fd[0], .events = POLLIN};
        int rc = poll(&pfd, 1, 200);
        if (rc < 0 && errno == EINTR) continue;
        if (pfd.revents & POLLIN) drain_wake_fd(rt->worker.wake_fd[0]);

        /* Consume batched output – this also drains w->out so memory stays
         * bounded.  The publish_cb already forwarded events in real time,
         * so we just free the buffer here. */
        char *out = NULL;
        size_t out_len = 0;
        agent_status st = {0};
        worker_consume(&rt->worker, &out, &out_len, &st);
        free(out);

        /* After a tool call the worker blocks (pthread_cond_wait) until the
         * consumer answers two handshakes that, in the CLI, the REPL loop
         * services.  The wrapper has no interactive REPL, so we must answer
         * them here or the worker deadlocks (GPU idle, busy forever) on every
         * tool call:
         *   - queued-user-drain: no out-of-band user input in one-shot chat;
         *   - web-approval: headless wrapper cannot prompt for visible Chrome. */
        if (worker_take_queued_user_drain_request(&rt->worker)) {
            worker_answer_queued_user_drain(&rt->worker, NULL);
        }
        char approval_msg[512];
        if (worker_take_web_approval_request(&rt->worker, approval_msg, sizeof(approval_msg))) {
            /* Visible Chrome needs approval. Granted only when the operator
             * opted in via --agent-allow-browser; otherwise denied (the wrapper
             * has no interactive prompt). */
            worker_answer_web_approval(&rt->worker, rt->opt.allow_browser,
                rt->opt.allow_browser ? NULL :
                "browser disabled: start the wrapper with --agent-allow-browser to allow Chrome, or ask the agent to use curl");
        }

        if (st.state == AGENT_WORKER_IDLE ||
            st.state == AGENT_WORKER_ERROR ||
            st.state == AGENT_WORKER_STOPPED)
        {
            if (st.state == AGENT_WORKER_ERROR) {
                /* Emit error event. */
                if (cb) {
                    char json[512];
                    char escaped[384];
                    json_escape_into(escaped, sizeof(escaped),
                                     st.error, strlen(st.error));
                    snprintf(json, sizeof(json),
                             "{\"error\":\"%s\"}", escaped);
                    ds4_agent_event ev = {
                        .type = DS4_AGENT_EVENT_ERROR,
                        .json_payload = json
                    };
                    cb(ud, &ev);
                }
                snprintf(err, err_len, "%s",
                         st.error[0] ? st.error : "agent worker error");
            }

            /* Browser wall time also includes tool execution and SSE/UI delays,
             * so publish the model's phase timings for accurate throughput. */
            if (cb) {
                char usage_json[512];
                int prompt_tokens = st.turn_prompt_tokens;
                int completion_tokens = st.turn_completion_tokens;
                snprintf(usage_json, sizeof(usage_json),
                         "{\"prompt_tokens\":%d,\"completion_tokens\":%d,"
                         "\"total_tokens\":%d,"
                         "\"prompt_tokens_details\":{\"cached_tokens\":%d,"
                         "\"cache_write_tokens\":%d},"
                         "\"timing\":{\"prefill_sec\":%.6f,\"decode_sec\":%.6f}}",
                         prompt_tokens, completion_tokens,
                         prompt_tokens + completion_tokens,
                         st.turn_cached_tokens, st.turn_prefill_tokens,
                         st.turn_prefill_sec, st.turn_decode_sec);
                ds4_agent_event usage_ev = {
                    .type = DS4_AGENT_EVENT_USAGE,
                    .json_payload = usage_json
                };
                cb(ud, &usage_ev);

                char json[256];
                snprintf(json, sizeof(json),
                         "{\"finish_reason\":\"%s\","
                         "\"ctx_used\":%d,\"ctx_size\":%d}",
                         st.state == AGENT_WORKER_ERROR ? "error" : "stop",
                         st.ctx_used, st.ctx_size);
                ds4_agent_event ev = {
                    .type = DS4_AGENT_EVENT_DONE,
                    .json_payload = json
                };
                cb(ud, &ev);
            }
            break;
        }
    }

    /* Detach the publish callback. */
    rt->worker.publish_cb = NULL;
    rt->worker.publish_ud = NULL;
    rt->cb = NULL;
    rt->cb_ud = NULL;

    return 0;
}

void ds4_agent_runtime_interrupt(ds4_agent_runtime *rt) {
    if (!rt || !rt->worker_valid) return;
    /* publish_cb (worker thread) calls this WITHOUT holding worker.mu
     * (agent_publish invokes the callback before locking), so taking the
     * mutex here is safe. Soft interrupt: ends the current turn, keeps the
     * worker alive/idle for the next request. */
    pthread_mutex_lock(&rt->worker.mu);
    rt->worker.interrupt = true;
    agent_wake_locked(&rt->worker);
    pthread_cond_signal(&rt->worker.cond);
    pthread_mutex_unlock(&rt->worker.mu);
}

/* =========================================================================
 * Session management commands
 * ========================================================================= */

int ds4_agent_runtime_save(ds4_agent_runtime *rt, char *sha_out, size_t sha_len) {
    if (!rt || !rt->worker_valid) return -1;
    (void)sha_len; /* buffer size is always 41; caller allocates accordingly */
    rt->worker.session = rt->wrapper->active_session;
    if (!rt->worker.session) return -1;

    char err[256] = {0};
    int tokens = 0;
    if (!agent_worker_save_session_now(&rt->worker, sha_out, &tokens,
                                       err, sizeof(err))) {
        return -1;
    }
    return 0;
}

int ds4_agent_runtime_list(ds4_agent_runtime *rt, char **json_out) {
    if (!rt || !rt->worker_valid || !json_out) return -1;

    DIR *d = opendir(rt->worker.cache_dir);
    if (!d) {
        *json_out = xstrdup("[]");
        return 0;
    }

    agent_session_list_item *sessions = NULL;
    int sessions_len = 0;
    int sessions_cap = 0;
    const uint8_t model_id = (uint8_t)ds4_engine_model_id(rt->worker.engine);
    struct dirent *de;
    while ((de = readdir(d)) != NULL) {
        char sha[41];
        if (!ds4_kvstore_sha_hex_name(de->d_name, sha)) continue;
        char *path = ds4_kvstore_path_join(rt->worker.cache_dir, de->d_name);
        ds4_kvstore_entry e = {0};
        if (ds4_kvstore_read_entry_file(path, sha, &e)) {
            if (e.model_id == model_id) {
                char *title = agent_session_title_from_file(path, 160);
                agent_session_list_push(&sessions, &sessions_len, &sessions_cap,
                                        e, title);
            } else {
                ds4_kvstore_entry_free(&e);
            }
        }
        free(path);
    }
    closedir(d);

    if (sessions_len > 1) {
        qsort(sessions, (size_t)sessions_len, sizeof(sessions[0]),
              agent_session_list_cmp_recent);
    }

    agent_buf buf = {0};
    agent_buf_puts(&buf, "[");
    for (int i = 0; i < sessions_len; i++) {
        ds4_kvstore_entry *e = &sessions[i].entry;
        size_t title_len = sessions[i].title ? strlen(sessions[i].title) : 0;
        size_t esc_cap = title_len * 6 + 16;
        char *esc_title = malloc(esc_cap);
        if (esc_title) {
            json_escape_into(esc_title, esc_cap,
                             sessions[i].title ? sessions[i].title : "",
                             title_len);
        } else {
            esc_title = xstrdup("");
        }
        if (i) agent_buf_puts(&buf, ",");
        const char *entry_fmt =
            "{\"sha\":\"%.40s\","
            "\"title\":\"%s\","
            "\"tokens\":%u,"
            "\"file_size\":%llu,"
            "\"last_used\":%llu,"
            "\"created_at\":%llu,"
            "\"stripped\":%s}";
        int entry_len = snprintf(NULL, 0, entry_fmt,
                                 e->sha,
                                 esc_title,
                                 e->tokens,
                                 (unsigned long long)e->file_size,
                                 (unsigned long long)e->last_used,
                                 (unsigned long long)e->created_at,
                                 e->payload_bytes == 0 ? "true" : "false");
        char *entry_json = xmalloc((size_t)entry_len + 1);
        snprintf(entry_json, (size_t)entry_len + 1, entry_fmt,
                 e->sha,
                 esc_title,
                 e->tokens,
                 (unsigned long long)e->file_size,
                 (unsigned long long)e->last_used,
                 (unsigned long long)e->created_at,
                 e->payload_bytes == 0 ? "true" : "false");
        agent_buf_puts(&buf, entry_json);
        free(entry_json);
        free(esc_title);
    }
    agent_buf_puts(&buf, "]");
    *json_out = agent_buf_take(&buf);
    agent_session_list_free(sessions, sessions_len);
    return 0;
}

int ds4_agent_runtime_switch(ds4_agent_runtime *rt, const char *sha,
                              char *err, size_t err_len) {
    if (!rt || !rt->worker_valid) {
        snprintf(err, err_len, "runtime not initialized");
        return -1;
    }
    rt->worker.session = rt->wrapper->active_session;
    if (!rt->worker.session) {
        snprintf(err, err_len, "no active agent session");
        return -1;
    }
    if (!agent_worker_switch_session(&rt->worker, sha, 0, err, err_len))
        return -1;
    return 0;
}

int ds4_agent_runtime_strip(ds4_agent_runtime *rt, const char *sha,
                             char *err, size_t err_len) {
    if (!rt || !rt->worker_valid) {
        snprintf(err, err_len, "runtime not initialized");
        return -1;
    }
    char sha_out[41] = {0};
    uint32_t tokens_out = 0;
    if (!agent_worker_strip_session(&rt->worker, sha, sha_out, &tokens_out, err, err_len))
        return -1;
    return 0;
}

int ds4_agent_runtime_new(ds4_agent_runtime *rt, char *err, size_t err_len) {
    if (!rt || !rt->worker_valid) {
        snprintf(err, err_len, "runtime not initialized");
        return -1;
    }
    rt->worker.session = rt->wrapper->active_session;
    if (!rt->worker.session) {
        snprintf(err, err_len, "no active agent session");
        return -1;
    }
    if (!agent_worker_reset_to_sysprompt(&rt->worker, err, err_len))
        return -1;

    /* Clear session identity. */
    free(rt->worker.session_title);
    rt->worker.session_title = NULL;
    memset(rt->worker.session_sha, 0, sizeof(rt->worker.session_sha));
    rt->worker.session_created_at = 0;
    rt->worker.session_dirty = false;
    return 0;
}

int ds4_agent_runtime_compact(ds4_agent_runtime *rt, char *err, size_t err_len) {
    if (!rt || !rt->worker_valid) {
        snprintf(err, err_len, "runtime not initialized");
        return -1;
    }
    rt->worker.session = rt->wrapper->active_session;
    if (!rt->worker.session) {
        snprintf(err, err_len, "no active agent session");
        return -1;
    }
    if (!agent_worker_compact(&rt->worker, "API requested compaction",
                               err, err_len))
        return -1;
    return 0;
}

/* =========================================================================
 * Native slash-command dispatcher
 * ========================================================================= */

typedef struct {
    agent_buf output;
} runtime_command_capture;

static void runtime_command_capture_cb(void *ud, const char *s, size_t n) {
    runtime_command_capture *capture = ud;
    char *clean = strip_ansi(s, n);
    if (!clean) return;
    agent_buf_puts(&capture->output, clean);
    free(clean);
}

static const char *runtime_command_name(agent_slash_command_kind kind) {
    switch (kind) {
    case AGENT_SLASH_HELP:    return "help";
    case AGENT_SLASH_SAVE:    return "save";
    case AGENT_SLASH_COMPACT: return "compact";
    case AGENT_SLASH_LIST:    return "list";
    case AGENT_SLASH_QUIT:    return "quit";
    case AGENT_SLASH_EXIT:    return "exit";
    case AGENT_SLASH_NEW:     return "new";
    case AGENT_SLASH_POWER:   return "power";
    case AGENT_SLASH_SWITCH:  return "switch";
    case AGENT_SLASH_DELETE:  return "del";
    case AGENT_SLASH_STRIP:   return "strip";
    case AGENT_SLASH_HISTORY: return "history";
    case AGENT_SLASH_CRAWL:   return "crawl";
    case AGENT_SLASH_METACOGNITION: return "metacognition";
    case AGENT_SLASH_SOUL:    return "soul";
    case AGENT_SLASH_ETHIC:   return "ethic";
    default:                  return "unknown";
    }
}

static char *runtime_command_strdup_or_null(const char *s) {
    if (!s) s = "";
    size_t n = strlen(s);
    char *p = malloc(n + 1);
    if (!p) return NULL;
    memcpy(p, s, n + 1);
    return p;
}

static char *runtime_command_vformat_or_null(const char *fmt, va_list ap) {
    char *message = NULL;
    va_list ap_copy;
    va_copy(ap_copy, ap);
    if (vasprintf(&message, fmt, ap_copy) < 0) message = NULL;
    va_end(ap_copy);
    return message;
}

static void runtime_command_set_data_json(ds4_agent_command_result *result,
                                          const char *fmt, ...) {
    free(result->data_json);
    result->data_json = NULL;
    va_list ap;
    va_start(ap, fmt);
    result->data_json = runtime_command_vformat_or_null(fmt, ap);
    va_end(ap);
}

static void runtime_command_set_message(ds4_agent_command_result *result,
                                        const char *fmt, ...) {
    free(result->message);
    result->message = NULL;
    va_list ap;
    va_start(ap, fmt);
    result->message = runtime_command_vformat_or_null(fmt, ap);
    va_end(ap);
    if (!result->message) result->message = runtime_command_strdup_or_null("");
}

static int runtime_command_fail(ds4_agent_command_result *result,
                                int status, const char *fmt, ...) {
    result->ok = false;
    result->http_status = status;
    free(result->message);
    result->message = NULL;
    va_list ap;
    va_start(ap, fmt);
    result->message = runtime_command_vformat_or_null(fmt, ap);
    va_end(ap);
    if (!result->message)
        result->message = runtime_command_strdup_or_null("native agent command failed");
    return -1;
}

static bool runtime_command_require_session(ds4_agent_runtime *rt,
                                            ds4_agent_command_result *result) {
    if (!rt || !rt->worker_valid) {
        runtime_command_fail(result, 503, "agent runtime is not initialized");
        return false;
    }
    rt->worker.session = rt->wrapper->active_session;
    if (!rt->worker.session) {
        runtime_command_fail(result, 409, "no active agent session");
        return false;
    }
    if (!worker_is_idle(&rt->worker)) {
        runtime_command_fail(result, 409, "model is busy");
        return false;
    }
    return true;
}

static bool runtime_command_save_if_dirty(ds4_agent_runtime *rt,
                                          ds4_agent_command_result *result) {
    if (!agent_worker_needs_save(&rt->worker)) return true;
    char sha[41] = {0};
    int tokens = 0;
    char err[256] = {0};
    if (agent_worker_save_session_now(&rt->worker, sha, &tokens,
                                      err, sizeof(err)))
        return true;
    runtime_command_fail(result, 500, "save failed: %s",
                         err[0] ? err : "unknown error");
    return false;
}

static char *runtime_command_capture_history(ds4_agent_runtime *rt,
                                             int turns,
                                             char *err, size_t err_len) {
    runtime_command_capture capture = {0};
    void (*old_cb)(void *, const char *, size_t) = rt->worker.publish_cb;
    void *old_ud = rt->worker.publish_ud;
    rt->worker.publish_cb = runtime_command_capture_cb;
    rt->worker.publish_ud = &capture;
    bool ok = agent_worker_show_history(&rt->worker, turns, err, err_len);
    rt->worker.publish_cb = old_cb;
    rt->worker.publish_ud = old_ud;
    if (!ok) {
        free(capture.output.ptr);
        return NULL;
    }
    return agent_buf_take(&capture.output);
}

static int runtime_command_crawl_request(const char *method, const char *path,
                                         const char *body, char *out,
                                         size_t out_len) {
    char err[256];
    return ds4_crawl_client_request(method, path, body, 30,
                                    out, out_len, err, sizeof(err)) == 0 ? 0 : -1;
}

static char *runtime_command_json_extract_object(const char *json,
                                                 const char *key) {
    if (!json || !key) return NULL;

    char pattern[256];
    int n = snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    if (n < 0 || (size_t)n >= sizeof(pattern)) return NULL;

    const char *p = strstr(json, pattern);
    if (!p) return NULL;
    p += strlen(pattern);
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
    if (*p++ != ':') return NULL;
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
    if (*p != '{') return NULL;

    const char *start = p;
    int depth = 0;
    while (*p) {
        if (*p == '"') {
            p++;
            while (*p && *p != '"') {
                if (*p == '\\' && p[1]) p++;
                p++;
            }
            if (*p) p++;
            continue;
        }
        if (*p == '{') {
            depth++;
        } else if (*p == '}') {
            depth--;
            if (depth == 0) {
                p++;
                size_t len = (size_t)(p - start);
                char *value = malloc(len + 1);
                if (!value) return NULL;
                memcpy(value, start, len);
                value[len] = '\0';
                return value;
            }
        }
        p++;
    }
    return NULL;
}

static char *runtime_command_crawl_start(ds4_agent_runtime *rt,
                                         const char *url,
                                         char *err, size_t err_len) {
    (void)rt;
    if (!url || !url[0]) {
        snprintf(err, err_len, "crawl requires url");
        return NULL;
    }

    char body[8192];
    if (ds4_crawl_client_build_url_body(url, body, sizeof(body),
                                        err, err_len) != 0) {
        return NULL;
    }

    char json[65536];
    if (runtime_command_crawl_request("POST", "/jobs", body, json, sizeof(json)) != 0) {
        snprintf(err, err_len, "crawl request failed");
        return NULL;
    }

    char *job_id = agent_json_extract_string(json, "job_id");
    if (!job_id) {
        snprintf(err, err_len, "crawl did not return a job_id");
        return NULL;
    }

    agent_buf result = {0};
    for (int i = 0; i < 120; i++) {
        char path[256];
        snprintf(path, sizeof(path), "/jobs/%s", job_id);
        char state_json[65536];
        if (runtime_command_crawl_request("GET", path, NULL, state_json, sizeof(state_json)) != 0) {
            free(job_id);
            free(result.ptr);
            snprintf(err, err_len, "crawl status failed");
            return NULL;
        }
        char *state = agent_json_extract_string(state_json, "state");
        if (!state) {
            free(job_id);
            free(result.ptr);
            snprintf(err, err_len, "crawl status parse failed");
            return NULL;
        }
        if (!strcmp(state, "succeeded") || !strcmp(state, "partially_succeeded")) {
            char *manifest = runtime_command_json_extract_object(
                state_json, "result_manifest");
            if (!manifest) {
                free(state);
                free(job_id);
                free(result.ptr);
                snprintf(err, err_len, "crawl result manifest parse failed");
                return NULL;
            }

            char *source = NULL;
            bool truncated = false;
            ds4_crawl_source_status st = ds4_crawl_extract_source(
                manifest, (size_t)-1, &source, &truncated,
                err, err_len);
            if (st == DS4_CRAWL_SOURCE_OK && source) {
                agent_buf_puts(&result, "Crawl result:\n");
                agent_buf_puts(&result, source);
                if (truncated)
                    agent_buf_puts(&result, "\n...[crawl content truncated]");
                free(source);
            } else {
                agent_buf_puts(&result, "Crawl result:\n");
                agent_buf_puts(&result, manifest);
            }

            free(manifest);
            free(state);
            free(job_id);
            return agent_buf_take(&result);
        }
        if (!strcmp(state, "failed")) {
            agent_buf_puts(&result, "Tool error: crawl failed\n");
            free(state);
            free(job_id);
            return agent_buf_take(&result);
        }
        if (!strcmp(state, "cancelled")) {
            agent_buf_puts(&result, "Tool error: crawl cancelled\n");
            free(state);
            free(job_id);
            return agent_buf_take(&result);
        }
        free(state);
        sleep(1);
    }
    free(job_id);
    free(result.ptr);
    snprintf(err, err_len, "crawl timed out");
    return NULL;
}

void ds4_agent_command_result_free(ds4_agent_command_result *result) {
    if (!result) return;
    free(result->message);
    free(result->data_json);
    memset(result, 0, sizeof(*result));
}

int ds4_agent_runtime_command(ds4_agent_runtime *rt, const char *command,
                              ds4_agent_command_result *result) {
    if (!result) return -1;
    memset(result, 0, sizeof(*result));
    result->http_status = 200;

    agent_slash_command parsed = {0};
    if (!agent_parse_slash_command(command, &parsed)) {
        return runtime_command_fail(result, 400,
                                    "unknown or invalid native agent command: %s",
                                    command ? command : "");
    }
    snprintf(result->command, sizeof(result->command), "%s",
             runtime_command_name(parsed.kind));

    if (!runtime_command_require_session(rt, result)) return -1;

    char err[256] = {0};
    switch (parsed.kind) {
    case AGENT_SLASH_HELP:
        runtime_command_set_message(
            result,
            "Commands:\n"
            "  /help        Show this help.\n"
            "  /save        Save the current session.\n"
            "  /compact     Compact the current session context now.\n"
            "  /list        List saved sessions.\n"
            "  /switch SHA  Load a saved session and show recent history.\n"
            "  /del SHA     Delete a saved session.\n"
            "  /strip SHA   Strip KV payload; /switch rebuilds it by prefill.\n"
            "  /history [N] Show N recent user turns from the current session.\n"
            "  /power N     Set GPU duty cycle percentage, 1..100.\n"
            "  /new         Start a fresh session from the system prompt.\n"
            "  /metacognition start|stop  Inject or remove the metacognition skill.\n"
            "  /quit, /exit Save if needed and return to server mode.");
        break;

    case AGENT_SLASH_SAVE: {
        char sha[41] = {0};
        int tokens = 0;
        if (!agent_worker_save_session_now(&rt->worker, sha, &tokens,
                                           err, sizeof(err)))
            return runtime_command_fail(result, 500, "save failed: %s",
                                        err[0] ? err : "unknown error");
        runtime_command_set_message(result, "Saved session %.8s (%d tokens).",
                                    sha, tokens);
        runtime_command_set_data_json(
            result, "{\"sha\":\"%.40s\",\"tokens\":%d}", sha, tokens);
        break;
    }

    case AGENT_SLASH_COMPACT: {
        int before = rt->worker.transcript.len;
        if (!agent_worker_compact(&rt->worker, "API requested compaction",
                                  err, sizeof(err))) {
            if (agent_err_is_interrupted(err)) {
                worker_clear_interrupt(&rt->worker);
                agent_set_status(&rt->worker, AGENT_WORKER_IDLE);
            } else {
                agent_set_error(&rt->worker,
                                err[0] ? err : "context compaction failed");
            }
            return runtime_command_fail(result, 500, "compact failed: %s",
                                        err[0] ? err : "unknown error");
        }
        if (rt->worker.transcript.len != before) {
            pthread_mutex_lock(&rt->worker.mu);
            rt->worker.session_dirty = true;
            agent_wake_locked(&rt->worker);
            pthread_mutex_unlock(&rt->worker.mu);
        }
        agent_set_status(&rt->worker, AGENT_WORKER_IDLE);
        runtime_command_set_message(result, "Compacted context: %d -> %d tokens.",
                                    before, rt->worker.transcript.len);
        break;
    }

    case AGENT_SLASH_LIST:
        if (ds4_agent_runtime_list(rt, &result->data_json) != 0)
            return runtime_command_fail(result, 500,
                                        "failed to list saved sessions");
        runtime_command_set_message(result, "Saved sessions.");
        break;

    case AGENT_SLASH_SWITCH: {
        if (!runtime_command_save_if_dirty(rt, result)) return -1;
        if (!agent_worker_switch_session(&rt->worker, parsed.arg, 0,
                                         err, sizeof(err)))
            return runtime_command_fail(result, 500, "switch failed: %s",
                                        err[0] ? err : "unknown error");
        char *history = runtime_command_capture_history(
            rt, AGENT_HISTORY_DEFAULT_TURNS, err, sizeof(err));
        if (!history)
            return runtime_command_fail(result, 500, "history failed: %s",
                                        err[0] ? err : "unknown error");
        runtime_command_set_message(result, "Switched to session %.8s.\n\n%s",
                                    rt->worker.session_sha, history);
        free(history);
        break;
    }

    case AGENT_SLASH_DELETE: {
        char sha[41] = {0};
        if (!agent_worker_delete_session(&rt->worker, parsed.arg, sha,
                                         err, sizeof(err)))
            return runtime_command_fail(result, 500, "delete failed: %s",
                                        err[0] ? err : "unknown error");
        runtime_command_set_message(result, "Deleted session %.8s.", sha);
        runtime_command_set_data_json(result, "{\"sha\":\"%.40s\"}", sha);
        break;
    }

    case AGENT_SLASH_STRIP: {
        char sha[41] = {0};
        uint32_t tokens = 0;
        if (!agent_worker_strip_session(&rt->worker, parsed.arg, sha, &tokens,
                                        err, sizeof(err)))
            return runtime_command_fail(result, 500, "strip failed: %s",
                                        err[0] ? err : "unknown error");
        runtime_command_set_message(result, "Stripped session %.8s (%u tokens).",
                                    sha, tokens);
        runtime_command_set_data_json(
            result, "{\"sha\":\"%.40s\",\"tokens\":%u}", sha, tokens);
        break;
    }

    case AGENT_SLASH_HISTORY: {
        char *history = runtime_command_capture_history(
            rt, parsed.number, err, sizeof(err));
        if (!history)
            return runtime_command_fail(result, 500, "history failed: %s",
                                        err[0] ? err : "unknown error");
        result->message = history;
        break;
    }

    case AGENT_SLASH_CRAWL: {
        char *arg = parsed.arg;
        while (*arg == ' ' || *arg == '\t') arg++;
        if (!strncmp(arg, "start", 5) &&
            (arg[5] == '\0' || arg[5] == ' ' || arg[5] == '\t')) {
            char *url = arg + 5;
            while (*url == ' ' || *url == '\t') url++;
            char *crawl = runtime_command_crawl_start(rt, url, err, sizeof(err));
            if (!crawl)
                return runtime_command_fail(result, 500, "crawl failed: %s",
                                            err[0] ? err : "unknown error");
            result->message = crawl;
        } else {
            return runtime_command_fail(result, 400, "usage: /crawl start <url>");
        }
        break;
    }

    case AGENT_SLASH_POWER:
        if (ds4_session_set_power(rt->worker.session, parsed.number) != 0)
            return runtime_command_fail(result, 500,
                                        "power change failed");
        pthread_mutex_lock(&rt->worker.mu);
        rt->worker.cfg->engine.power_percent = parsed.number;
        rt->worker.status.power_percent = parsed.number;
        agent_wake_locked(&rt->worker);
        pthread_mutex_unlock(&rt->worker.mu);
        runtime_command_set_message(result, "GPU duty cycle set to %d%%.",
                                    parsed.number);
        break;

    case AGENT_SLASH_METACOGNITION: {
        char *arg = parsed.arg;
        while (*arg == ' ' || *arg == '\t') arg++;
        if (!strncmp(arg, "start", 5) &&
            (arg[5] == '\0' || arg[5] == ' ' || arg[5] == '\t')) {
            char rerr[256] = {0};
            char *content = agent_read_metacognition_skill(rerr, sizeof(rerr));
            if (!content)
                return runtime_command_fail(result, 404, "%s", rerr);
            free(rt->worker.metacognition_prompt);
            rt->worker.metacognition_prompt = content;
            if (!runtime_command_save_if_dirty(rt, result)) return -1;
            if (ds4_agent_runtime_new(rt, rerr, sizeof(rerr)) != 0)
                return runtime_command_fail(result, 500, "session reset failed: %s",
                                            rerr[0] ? rerr : "unknown error");
            runtime_command_set_message(result, "Metacognition skill activated.");
        } else if (!strncmp(arg, "stop", 4) &&
                   (arg[4] == '\0' || arg[4] == ' ' || arg[4] == '\t')) {
            if (!rt->worker.metacognition_prompt)
                return runtime_command_fail(result, 400,
                                            "Metacognition skill is not active.");
            free(rt->worker.metacognition_prompt);
            rt->worker.metacognition_prompt = NULL;
            if (!runtime_command_save_if_dirty(rt, result)) return -1;
            if (ds4_agent_runtime_new(rt, err, sizeof(err)) != 0)
                return runtime_command_fail(result, 500, "session reset failed: %s",
                                            err[0] ? err : "unknown error");
            runtime_command_set_message(result, "Metacognition skill deactivated.");
        } else {
            return runtime_command_fail(result, 400,
                                        "usage: /metacognition start|stop");
        }
        break;
    }

    case AGENT_SLASH_SOUL: {
        char *arg = parsed.arg;
        while (*arg == ' ' || *arg == '\t') arg++;
        if (!strncmp(arg, "start", 5) &&
            (arg[5] == '\0' || arg[5] == ' ' || arg[5] == '\t')) {
            char rerr[256] = {0};
            char *content = agent_read_soul_skill(rerr, sizeof(rerr));
            if (!content)
                return runtime_command_fail(result, 404, "%s", rerr);
            free(rt->worker.soul_prompt);
            rt->worker.soul_prompt = content;
            if (!runtime_command_save_if_dirty(rt, result)) return -1;
            if (ds4_agent_runtime_new(rt, rerr, sizeof(rerr)) != 0)
                return runtime_command_fail(result, 500, "session reset failed: %s",
                                            rerr[0] ? rerr : "unknown error");
            runtime_command_set_message(result, "Soul skill activated.");
        } else if (!strncmp(arg, "stop", 4) &&
                   (arg[4] == '\0' || arg[4] == ' ' || arg[4] == '\t')) {
            if (!rt->worker.soul_prompt)
                return runtime_command_fail(result, 400,
                                            "Soul skill is not active.");
            free(rt->worker.soul_prompt);
            rt->worker.soul_prompt = NULL;
            if (!runtime_command_save_if_dirty(rt, result)) return -1;
            if (ds4_agent_runtime_new(rt, err, sizeof(err)) != 0)
                return runtime_command_fail(result, 500, "session reset failed: %s",
                                            err[0] ? err : "unknown error");
            runtime_command_set_message(result, "Soul skill deactivated.");
        } else {
            return runtime_command_fail(result, 400,
                                        "usage: /soul start|stop");
        }
        break;
    }

    case AGENT_SLASH_ETHIC: {
        char *arg = parsed.arg;
        while (*arg == ' ' || *arg == '\t') arg++;
        if (!strncmp(arg, "start", 5) &&
            (arg[5] == '\0' || arg[5] == ' ' || arg[5] == '\t')) {
            char rerr[256] = {0};
            char *content = agent_read_ethic_skill(rerr, sizeof(rerr));
            if (!content)
                return runtime_command_fail(result, 404, "%s", rerr);
            free(rt->worker.ethic_prompt);
            rt->worker.ethic_prompt = content;
            if (!runtime_command_save_if_dirty(rt, result)) return -1;
            if (ds4_agent_runtime_new(rt, rerr, sizeof(rerr)) != 0)
                return runtime_command_fail(result, 500, "session reset failed: %s",
                                            rerr[0] ? rerr : "unknown error");
            runtime_command_set_message(result, "Ethic skill activated.");
        } else if (!strncmp(arg, "stop", 4) &&
                   (arg[4] == '\0' || arg[4] == ' ' || arg[4] == '\t')) {
            if (!rt->worker.ethic_prompt)
                return runtime_command_fail(result, 400,
                                            "Ethic skill is not active.");
            free(rt->worker.ethic_prompt);
            rt->worker.ethic_prompt = NULL;
            if (!runtime_command_save_if_dirty(rt, result)) return -1;
            if (ds4_agent_runtime_new(rt, err, sizeof(err)) != 0)
                return runtime_command_fail(result, 500, "session reset failed: %s",
                                            err[0] ? err : "unknown error");
            runtime_command_set_message(result, "Ethic skill deactivated.");
        } else {
            return runtime_command_fail(result, 400,
                                        "usage: /ethic start|stop");
        }
        break;
    }

    case AGENT_SLASH_NEW:
        if (!runtime_command_save_if_dirty(rt, result)) return -1;
        if (ds4_agent_runtime_new(rt, err, sizeof(err)) != 0)
            return runtime_command_fail(result, 500, "new session failed: %s",
                                        err[0] ? err : "unknown error");
        runtime_command_set_message(result, "Started a fresh agent session.");
        break;

    case AGENT_SLASH_QUIT:
    case AGENT_SLASH_EXIT:
        if (!runtime_command_save_if_dirty(rt, result)) return -1;
        result->switch_to_server = true;
        runtime_command_set_message(result,
                                    "Agent session closed; returning to server mode.");
        break;

    default:
        return runtime_command_fail(result, 400,
                                    "unsupported native agent command");
    }

    result->ok = true;
    return 0;
}

void ds4_agent_runtime_get_compression_metrics(ds4_agent_runtime *rt,
                                               ds4_agent_compression_metrics *out) {
    if (!rt || !out) return;
    memset(out, 0, sizeof(*out));
    pthread_mutex_lock(&rt->worker.mu);
    out->events = rt->worker.status.compression_events;
    out->original_bytes = rt->worker.status.compression_original_bytes;
    out->compressed_bytes = rt->worker.status.compression_compressed_bytes;
    out->blob_count = rt->worker.status.compression_blob_count;
    out->retrieve_count = rt->worker.status.compression_retrieve_count;
    strncpy(out->last_strategy, rt->worker.status.last_compression_strategy,
            sizeof(out->last_strategy) - 1);
    out->last_strategy[sizeof(out->last_strategy) - 1] = '\0';
    strncpy(out->last_blob_id, rt->worker.status.last_compression_blob_id,
            sizeof(out->last_blob_id) - 1);
    out->last_blob_id[sizeof(out->last_blob_id) - 1] = '\0';
    pthread_mutex_unlock(&rt->worker.mu);
}
