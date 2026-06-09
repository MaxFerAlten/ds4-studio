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

    /* Scan cache_dir for sessions compatible with this model. */
    DIR *d = opendir(rt->worker.cache_dir);
    if (!d) {
        *json_out = xstrdup("[]");
        return 0;
    }

    const uint8_t model_id = (uint8_t)ds4_engine_model_id(rt->worker.engine);
    agent_buf buf = {0};
    agent_buf_puts(&buf, "[");
    int count = 0;

    struct dirent *de;
    while ((de = readdir(d)) != NULL) {
        char sha[41];
        if (!ds4_kvstore_sha_hex_name(de->d_name, sha)) continue;
        char *path = ds4_kvstore_path_join(rt->worker.cache_dir, de->d_name);
        ds4_kvstore_entry e = {0};
        if (ds4_kvstore_read_entry_file(path, sha, &e)) {
            if (e.model_id == model_id) {
                char *title = agent_session_title_from_file(path, 160);
                if (count > 0) agent_buf_puts(&buf, ",");

                /* JSON-escape the title */
                size_t title_len = title ? strlen(title) : 0;
                size_t esc_cap = title_len * 6 + 16;
                char *esc_title = malloc(esc_cap);
                if (esc_title) {
                    json_escape_into(esc_title, esc_cap, title ? title : "", title_len);
                } else {
                    esc_title = xstrdup("");
                }

                char entry_json[512];
                snprintf(entry_json, sizeof(entry_json),
                    "{\"sha\":\"%.40s\","
                    "\"title\":\"%s\","
                    "\"tokens\":%u,"
                    "\"file_size\":%llu,"
                    "\"last_used\":%llu,"
                    "\"created_at\":%llu,"
                    "\"stripped\":%s}",
                    sha,
                    esc_title,
                    e.tokens,
                    (unsigned long long)e.file_size,
                    (unsigned long long)e.last_used,
                    (unsigned long long)e.created_at,
                    e.payload_bytes == 0 ? "true" : "false");
                agent_buf_puts(&buf, entry_json);
                free(esc_title);
                free(title);
                count++;
            }
            ds4_kvstore_entry_free(&e);
        }
        free(path);
    }
    closedir(d);

    agent_buf_puts(&buf, "]");
    *json_out = agent_buf_take(&buf);
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
