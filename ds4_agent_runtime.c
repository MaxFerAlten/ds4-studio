/* ds4_agent_runtime.c – embeddable agent runtime for the wrapper.
 *
 * Strategy: include ds4_agent.c to access all static helpers (worker_submit,
 * worker_consume, agent_worker_init/free, etc.) exactly as ds4_server_runtime.c
 * does with ds4_server.c.  The runtime owns an agent_worker whose session
 * pointer is kept in sync with wrapper->active_session. */

#define DS4_AGENT_TEST
#define DS4_AGENT_TEST_NO_MAIN
/* The upstream monolith is included textually so the runtime can reach its
 * static helpers.  Makefile.studio redirects this to the overlay-generated
 * copy under build/studio/ so upstream itself stays pristine; building
 * without Makefile.studio still compiles against the raw upstream file. */
#ifndef DS4_AGENT_UPSTREAM_SRC
#define DS4_AGENT_UPSTREAM_SRC "ds4_agent.c"
#endif
#include DS4_AGENT_UPSTREAM_SRC

#include "ds4_agent_runtime.h"
#include "ds4_crawl_client.h"
#include "ds4_crawl_grounding.h"
#include <poll.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
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
    uint64_t skill_start_success_total;
    uint64_t skill_start_idempotent_total;
    uint64_t skill_stop_success_total;
    uint64_t skill_stop_idempotent_total;
    uint64_t skill_load_failure_total;
    uint64_t skill_prompt_rebuild_failure_total;
    uint64_t skill_rollback_failure_total;
    uint64_t skill_manifest_failure_total;
    bool sysprompt_dirty;

    /* UTF8-001 §33 — the byte-stream → JSON-text boundary lives here, so the
     * partial code point at the end of a chunk waits here for its tail. */
    ds4_utf8_stream_state publish_utf8;
    int publish_utf8_event_type;
    uint64_t utf8_invalid_stream_total;
    uint64_t utf8_truncated_at_end_total;
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
static char *strip_ansi(const char *s, size_t n, size_t *out_len) {
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
    /* §83 — the caller already has an explicit length; do not make it
     * rediscover one with strlen() after a byte-level transformation. */
    if (out_len) *out_len = w;
    return out;
}

/* Structured integrity failure.  §35: silent U+FFFD substitution is worse than
 * a visible hard failure, because it rewrites a source presented as verified. */
static void runtime_publish_utf8_error(ds4_agent_runtime *rt,
                                       const char *code,
                                       size_t byte_offset) {
    if (!rt->cb) return;
    char json[256];
    snprintf(json, sizeof(json),
             "{\"code\":\"%s\",\"stage\":\"runtime_publish_cb\","
             "\"byteOffset\":%zu}", code, byte_offset);
    ds4_agent_event ev = { .type = DS4_AGENT_EVENT_ERROR, .json_payload = json };
    rt->cb(rt->cb_ud, &ev);
}

typedef struct {
    ds4_agent_runtime *rt;
    ds4_agent_event_type type;
} runtime_publish_ctx;

/* Receives only complete code points, so every JSON string it builds decodes
 * back to exactly the bytes the renderer produced. */
static void runtime_publish_complete_utf8(void *ud, const char *s, size_t n) {
    runtime_publish_ctx *ctx = ud;
    ds4_agent_runtime *rt = ctx->rt;
    if (!rt->cb || !n) return;

    /* §353 — bound the escape expansion before trusting the multiplication. */
    if (n > (SIZE_MAX - 64) / 6) return;
    size_t json_cap = n * 6 + 64;
    char *json = malloc(json_cap);
    if (!json) return;

    size_t pos = 0;
    pos += (size_t)snprintf(json + pos, json_cap - pos, "{\"content\":\"");
    pos += json_escape_into(json + pos, json_cap - pos, s, n);
    pos += (size_t)snprintf(json + pos, json_cap - pos, "\"}");

    ds4_agent_event ev = { .type = ctx->type, .json_payload = json };
    rt->cb(rt->cb_ud, &ev);
    free(json);
}

static void runtime_publish_cb(void *ud, const char *s, size_t n) {
    ds4_agent_runtime *rt = ud;
    if (!rt->cb || !n) return;

    /* Strip ANSI colour codes – the HTTP/SSE layer does not want them.  The
     * copy is byte-for-byte outside the escape sequences, so it neither
     * interprets nor reframes UTF-8. */
    size_t clean_len = 0;
    char *clean = strip_ansi(s, n, &clean_len);
    if (!clean) return;
    if (clean_len == 0) { free(clean); return; }

    /* Map current_event_type from the worker to our enum. */
    ds4_agent_event_type type;
    int etype = rt->worker.current_event_type;
    if (etype == 1)      type = DS4_AGENT_EVENT_REASONING;
    else if (etype == 2) type = DS4_AGENT_EVENT_TOOL_CALL;
    else if (etype == 3) type = DS4_AGENT_EVENT_TOOL_RESULT;
    else if (etype == 4) type = DS4_AGENT_EVENT_STATUS;
    else if (etype == 5) type = DS4_AGENT_EVENT_SAGE_STATUS;
    else if (etype == 6) type = DS4_AGENT_EVENT_SAGE_ARTIFACT;
    else                 type = DS4_AGENT_EVENT_TEXT;

    /* For sage status/artifact events the published text is already valid
     * JSON — pass it through directly without wrapping. */
    if (etype == 5 || etype == 6) {
        char *copy = xmalloc(clean_len + 1);
        memcpy(copy, clean, clean_len + 1);
        ds4_agent_event ev = { .type = type, .json_payload = copy };
        rt->cb(rt->cb_ud, &ev);
        free(copy);
        free(clean);
        return;
    }

    /* §296 — a code point may not straddle two event types.  If the stream
     * switches while a sequence is still open, the tail can never arrive. */
    if (etype != rt->publish_utf8_event_type) {
        if (!ds4_utf8_stream_finished(&rt->publish_utf8)) {
            rt->utf8_truncated_at_end_total++;
            runtime_publish_utf8_error(rt, "DS4_UTF8_TRUNCATED_AT_END", 0);
            ds4_utf8_stream_reset(&rt->publish_utf8);
        }
        rt->publish_utf8_event_type = etype;
    }

    /* §32.2/§34 — defence in depth.  The renderer is streaming-safe now, but
     * the (const char *, size_t) contract still promises nothing about code
     * point boundaries, and other producers publish through here too. */
    runtime_publish_ctx ctx = { .rt = rt, .type = type };
    if (!ds4_utf8_stream_feed(&rt->publish_utf8, clean, clean_len,
                              runtime_publish_complete_utf8, &ctx)) {
        rt->utf8_invalid_stream_total++;
        ds4_utf8_stream_reset(&rt->publish_utf8);
        runtime_publish_utf8_error(rt, "DS4_UTF8_INVALID_STREAM", clean_len);
    }

    free(clean);
}

/* =========================================================================
 * Init / Free
 * ========================================================================= */

/* Init frees the wrapper's placeholder agent session to make room for the
 * worker's. A failed init must put it back: without it the wrapper sits in
 * agent mode with no session, and every later request is refused as "no active
 * session" instead of retrying init and reporting why it failed. */
static void restore_placeholder_session(ds4_wrapper *wrapper) {
    if (wrapper->active_session) return;
    if (ds4_session_create(&wrapper->active_session, wrapper->engine,
                           wrapper->configured_ctx_size) != 0) {
        wrapper->active_session = NULL;
        fprintf(stderr, "ds4-wrapper: could not restore the agent session "
                "after a failed agent init\n");
    }
}

int ds4_agent_runtime_init(ds4_agent_runtime **out,
                           ds4_wrapper *wrapper,
                           const ds4_agent_runtime_options *opt,
                           char *err,
                           size_t err_len) {
    ds4_agent_runtime *rt = calloc(1, sizeof(*rt));
    if (!rt) {
        snprintf(err, err_len, "out of memory allocating the agent runtime");
        return -1;
    }
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
    /* non_interactive short-circuits agent_web_confirm() before it ever raises
     * the approval request this runtime answers below, so with it set the
     * google_search/visit_page tools always failed with "visible Chrome browser
     * startup requires interactive approval" -- even when the operator had
     * passed --agent-allow-browser. Clearing it for that case lets the handshake
     * run and reach worker_answer_web_approval().
     *
     * The other two things non_interactive guards are checked and harmless here:
     * agent_publish_system_status() is additionally gated on isatty(), false in
     * the wrapper, and the KV-save failure path merely reports into the agent
     * buffer instead of stderr, which surfaces the error in the UI rather than
     * hiding it. */
    rt->cfg.non_interactive = !(opt && opt->allow_browser);

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
        snprintf(err, err_len, "agent worker could not be started");
        restore_placeholder_session(wrapper);
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

    /* `initialized` means the worker's startup FINISHED, not that it succeeded.
     * Upstream's worker_main sets it after recording a failure too, and the CLI
     * then reads status.error to show it. This runtime took `initialized` for
     * "ready", so a failed system prompt -- 25951 tokens against --ctx 8192 --
     * left the worker in AGENT_WORKER_ERROR while prepare answered ready:true,
     * every chat was refused as "agent worker busy or not idle", and the real
     * reason was neither logged nor returned. */
    pthread_mutex_lock(&rt->worker.mu);
    bool start_failed = rt->worker.status.state == AGENT_WORKER_ERROR;
    if (start_failed) {
        snprintf(err, err_len, "%s", rt->worker.status.error[0]
                 ? rt->worker.status.error : "agent worker failed to start");
    }
    pthread_mutex_unlock(&rt->worker.mu);
    if (start_failed) {
        /* The worker still owns its session (nothing was transferred), so
         * agent_worker_free releases it along with the thread -- before the
         * placeholder comes back, for the same GPU headroom reason as above. */
        agent_worker_free(&rt->worker);
        restore_placeholder_session(wrapper);
        free(rt);
        return -1;
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

static int runtime_sysprompt_rebuild_if_dirty(
    ds4_agent_runtime *rt, char *err, size_t err_len);

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
    /* §118 — continuation bytes never carry across turns. */
    ds4_utf8_stream_reset(&rt->publish_utf8);
    rt->publish_utf8_event_type = 0;

    /* If a skill was toggled since the last chat, rebuild the system prompt
     * now — the prefill cost is borne here once, not on every skill command. */
    {
        char rebuild_err[256] = {0};
        if (runtime_sysprompt_rebuild_if_dirty(
                rt, rebuild_err, sizeof(rebuild_err)) != 0) {
            rt->worker.publish_cb = NULL;
            rt->worker.publish_ud = NULL;
            rt->cb = NULL;
            rt->cb_ud = NULL;
            snprintf(err, err_len,
                     "sysprompt rebuild after skill change failed: %s",
                     rebuild_err[0] ? rebuild_err : "unknown error");
            return -1;
        }
    }

    /* Submit the user message. */
    if (!worker_submit(&rt->worker, user_text)) {
        rt->worker.publish_cb = NULL;
        rt->worker.publish_ud = NULL;
        rt->cb = NULL;
        rt->cb_ud = NULL;
        /* Upstream treats AGENT_WORKER_ERROR as terminal (the CLI exits on it)
         * and only a reset to the system prompt clears it, so after a failed
         * turn every later submit is refused. Say so, with the original cause;
         * resetting here would silently drop the conversation. */
        agent_status st = {0};
        worker_is_initialized(&rt->worker, &st);
        if (st.state == AGENT_WORKER_ERROR) {
            snprintf(err, err_len, "agent stopped after an error: %s; "
                     "start a new session to continue",
                     st.error[0] ? st.error : "unknown error");
        } else {
            snprintf(err, err_len, "agent worker busy or not idle");
        }
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

    /* §119 — a partial sequence left at end of stream is an integrity failure,
     * not something to flush raw. */
    if (!ds4_utf8_stream_finished(&rt->publish_utf8)) {
        rt->utf8_truncated_at_end_total++;
        runtime_publish_utf8_error(rt, "DS4_UTF8_TRUNCATED_AT_END", 0);
        ds4_utf8_stream_reset(&rt->publish_utf8);
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

    return agent_worker_new_default_session(&rt->worker,
                                            err, err_len) ? 0 : -1;
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

#ifdef DS4_AGENT_RUNTIME_TEST
static int (*runtime_skill_rebuild_test_hook)(
    ds4_agent_runtime *, char *, size_t);
/* Same seam for the session save: a real save needs an engine and a live KV
 * session, so the ordering invariant "save before mutate" (piano-rimedio 2
 * §11) can only be tested with an injectable outcome. */
static bool (*runtime_command_save_test_hook)(
    ds4_agent_runtime *, char *, size_t);
#endif

static int runtime_rebuild_current_system_prompt(
    ds4_agent_runtime *rt, char *err, size_t err_len) {
#ifdef DS4_AGENT_RUNTIME_TEST
    if (runtime_skill_rebuild_test_hook)
        return runtime_skill_rebuild_test_hook(rt, err, err_len);
#endif
    if (!rt || !rt->worker_valid) {
        snprintf(err, err_len, "runtime not initialized");
        return -1;
    }

    rt->worker.session = rt->wrapper->active_session;
    if (!rt->worker.session) {
        snprintf(err, err_len, "no active agent session");
        return -1;
    }

    if (agent_worker_reset_to_sysprompt(&rt->worker, err, err_len)) return 0;
    /* reset_to_sysprompt returns with whatever state its sync left, PREFILL
     * for a prompt that no longer fits, and nothing moves it on: commands then
     * answer "model is busy", so the skill that broke the prompt could not be
     * stopped. ERROR is the true state, carries the cause, and still counts as
     * idle for commands. */
    agent_set_error(&rt->worker, err[0] ? err : "system prompt rebuild failed");
    return -1;
}

static int runtime_sysprompt_rebuild_if_dirty(
    ds4_agent_runtime *rt, char *err, size_t err_len) {
    if (!rt->sysprompt_dirty) return 0;
    /* Stays dirty on failure: a failed rebuild leaves the worker unusable, and
     * clearing the flag first meant the next chat skipped straight to submit and
     * reported "agent worker busy or not idle" instead of retrying and saying
     * why (e.g. the skills no longer fit the context). */
    if (runtime_rebuild_current_system_prompt(rt, err, err_len) != 0) return -1;
    rt->sysprompt_dirty = false;
    return 0;
}

typedef struct {
    agent_buf output;
} runtime_command_capture;

static void runtime_command_capture_cb(void *ud, const char *s, size_t n) {
    runtime_command_capture *capture = ud;
    char *clean = strip_ansi(s, n, NULL);
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
    case AGENT_SLASH_SKILL:   return "skill";
    case AGENT_SLASH_METACOGNITION: return "metacognition";
    case AGENT_SLASH_SOUL:    return "soul";
    case AGENT_SLASH_ETHIC:   return "ethic";
    case AGENT_SLASH_STRUCTURE: return "structure";
    case AGENT_SLASH_SAGE_POL: return "sage-pol";
    case AGENT_SLASH_SAGE:    return "sage";
    case AGENT_SLASH_LEAN:    return "lean";
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

static int runtime_command_fail_code(ds4_agent_command_result *result,
                                     int status,
                                     const char *code,
                                     const char *fmt,
                                     ...) {
    result->ok = false;
    result->http_status = status;
    snprintf(result->error_code, sizeof(result->error_code), "%s",
             code ? code : "NATIVE_AGENT_ERROR");
    free(result->message);
    result->message = NULL;
    va_list ap;
    va_start(ap, fmt);
    result->message = runtime_command_vformat_or_null(fmt, ap);
    va_end(ap);
    if (!result->message)
        result->message =
            runtime_command_strdup_or_null("native agent command failed");
    return -1;
}

static bool runtime_command_require_session(ds4_agent_runtime *rt,
                                            ds4_agent_command_result *result) {
    if (!rt || !rt->worker_valid) {
        runtime_command_fail_code(result, 503, "AGENT_RUNTIME_UNAVAILABLE",
                                  "agent runtime is not initialized");
        return false;
    }
    rt->worker.session = rt->wrapper->active_session;
    if (!rt->worker.session) {
        runtime_command_fail_code(result, 409, "AGENT_MODE_REQUIRED",
                                  "no active agent session");
        return false;
    }
    if (!worker_is_idle(&rt->worker)) {
        runtime_command_fail_code(result, 409, "AGENT_BUSY",
                                  "model is busy");
        return false;
    }
    return true;
}

static bool runtime_command_save_if_dirty(ds4_agent_runtime *rt,
                                          ds4_agent_command_result *result) {
#ifdef DS4_AGENT_RUNTIME_TEST
    if (runtime_command_save_test_hook) {
        char hook_err[256] = {0};
        if (runtime_command_save_test_hook(rt, hook_err, sizeof(hook_err)))
            return true;
        runtime_command_fail(result, 500, "save failed: %s",
                             hook_err[0] ? hook_err : "unknown error");
        return false;
    }
#endif
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

typedef struct {
    char name[DS4_AGENT_SKILL_NAME_MAX + 1];
    const char *kind;
    bool loaded;
    size_t bytes;
    char revision[41];
} runtime_skill_view;

static bool runtime_env_boolean(const char *name, bool default_value) {
    const char *value = getenv(name);
    if (!value) return default_value;
    while (*value && isspace((unsigned char)*value)) value++;
    const char *end = value + strlen(value);
    while (end > value && isspace((unsigned char)end[-1])) end--;
    const size_t len = (size_t)(end - value);
    if ((len == 1 && value[0] == '1') ||
        (len == 4 && !strncasecmp(value, "true", len)) ||
        (len == 3 && !strncasecmp(value, "yes", len)) ||
        (len == 2 && !strncasecmp(value, "on", len)))
        return true;
    if (len == 0 || (len == 1 && value[0] == '0') ||
        (len == 5 && !strncasecmp(value, "false", len)) ||
        (len == 2 && !strncasecmp(value, "no", len)) ||
        (len == 3 && !strncasecmp(value, "off", len)))
        return false;
    return default_value;
}

static bool runtime_autonomous_prompt_enabled(ds4_agent_skill_kind kind) {
    if (kind == DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY)
        return runtime_env_boolean("DS4_LEAN_AUTONOMOUS_PROMPT", false);
    if (kind == DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY)
        return runtime_env_boolean("DS4_SAGE_AUTONOMOUS_PROMPT", false);
    return false;
}

static bool runtime_autonomous_orchestration_enabled(
    ds4_agent_skill_kind kind) {
    if (kind == DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY)
        return runtime_env_boolean(
            "DS4_LEAN_AUTONOMOUS_ORCHESTRATION", true);
    if (kind == DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY)
        return runtime_env_boolean(
            "DS4_SAGE_AUTONOMOUS_ORCHESTRATION", true);
    return false;
}

static const char *runtime_autonomous_fragment_marker(
    ds4_agent_skill_kind kind) {
    if (kind == DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY)
        return "[BEGIN DS4 LEAN AUTONOMOUS ORCHESTRATION]";
    if (kind == DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY)
        return "[BEGIN DS4 SAGE AUTONOMOUS ORCHESTRATION]";
    return "";
}

static bool runtime_autonomous_fragment_loaded(
    const agent_worker *worker,
    ds4_agent_skill_kind kind) {
    const char *prompt = NULL;
    if (kind == DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY)
        prompt = worker->lean_prompt;
    else if (kind == DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY)
        prompt = worker->sage_prompt;
    const char *marker = runtime_autonomous_fragment_marker(kind);
    return prompt && marker[0] && strstr(prompt, marker) != NULL;
}

static ds4_agent_skill_stage_options runtime_skill_stage_options(
    ds4_agent_skill_kind kind) {
    ds4_agent_skill_stage_options options = {0};
    if (kind == DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY) {
        options.fragment_name =
            "LEAN_AUTONOMOUS_PROOF_ORCHESTRATION_PROMPT.md";
        options.fragment_begin_marker =
            "[BEGIN DS4 LEAN AUTONOMOUS ORCHESTRATION]";
        options.fragment_end_marker =
            "[END DS4 LEAN AUTONOMOUS ORCHESTRATION]";
    } else if (kind == DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY) {
        options.fragment_name =
            "SAGE_AUTONOMOUS_MATHEMATICAL_ORCHESTRATION_PROMPT.md";
        options.fragment_begin_marker =
            "[BEGIN DS4 SAGE AUTONOMOUS ORCHESTRATION]";
        options.fragment_end_marker =
            "[END DS4 SAGE AUTONOMOUS ORCHESTRATION]";
    }
    options.fragment_enabled = runtime_autonomous_prompt_enabled(kind);
    options.fragment_required = options.fragment_enabled;
    return options;
}

static bool runtime_skill_stage_from_disk(
    const char *skills_root,
    const char *name,
    ds4_agent_skill_kind kind,
    ds4_agent_skill_entry *out,
    char *err,
    size_t err_len) {
    ds4_agent_skill_stage_options options = runtime_skill_stage_options(kind);
    if (options.fragment_enabled &&
        !runtime_autonomous_orchestration_enabled(kind)) {
        snprintf(err, err_len,
                 "SKILL_ORCHESTRATOR_REQUIRED: autonomous prompt requires its orchestrator");
        memset(out, 0, sizeof(*out));
        return false;
    }
    return ds4_agent_skill_stage_from_disk_ex(
        skills_root, name, kind,
        options.fragment_enabled ? &options : NULL,
        out, err, err_len);
}

static bool runtime_authoritative_math_mode_conflicts(
    const agent_worker *worker,
    ds4_agent_skill_kind requested_kind) {
    if (!runtime_autonomous_prompt_enabled(requested_kind)) return false;
    if (requested_kind == DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY)
        return runtime_autonomous_fragment_loaded(
            worker, DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY);
    if (requested_kind == DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY)
        return runtime_autonomous_fragment_loaded(
            worker, DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY);
    return false;
}

static bool runtime_dynamic_skills_enabled(void) {
    const char *value = getenv("DS4_AGENT_DYNAMIC_SKILLS");
    return !value || strcmp(value, "0") != 0;
}

static bool runtime_is_agent_mode(ds4_agent_runtime *rt) {
    if (!rt || !rt->wrapper) return false;
    pthread_mutex_lock(&rt->wrapper->mu);
    bool active = rt->wrapper->active_mode == DS4_WRAP_MODE_AGENT;
    pthread_mutex_unlock(&rt->wrapper->mu);
    return active;
}

static char **runtime_skill_builtin_slot(agent_worker *worker,
                                         ds4_agent_skill_kind kind,
                                         bool **active) {
    if (active) *active = NULL;
    const agent_builtin_skill_descriptor *d = agent_builtin_skill_by_kind(kind);
    if (!d) return NULL;
    if (active) *active = agent_builtin_skill_active(worker, d);
    return agent_builtin_skill_prompt(worker, d);
}

static bool runtime_skill_state(agent_worker *worker,
                                const char *name,
                                ds4_agent_skill_kind kind,
                                bool *loaded,
                                size_t *bytes,
                                char revision[41]) {
    *loaded = false;
    *bytes = 0;
    revision[0] = '\0';
    if (kind == DS4_AGENT_SKILL_DYNAMIC) {
        const ds4_agent_skill_entry *entry =
            ds4_agent_skill_registry_find(&worker->dynamic_skills, name);
        if (!entry) return true;
        *loaded = true;
        *bytes = entry->content_len;
        memcpy(revision, entry->revision, 41);
        return true;
    }

    bool *active = NULL;
    char **slot = runtime_skill_builtin_slot(worker, kind, &active);
    if (!slot) return false;
    *loaded = active ? *active : *slot != NULL;
    if (!*loaded || !*slot) return true;
    *bytes = strlen(*slot);
    ds4_kvstore_sha1_bytes_hex(*slot, *bytes, revision);
    return true;
}

static void runtime_default_skills_revise(agent_worker *worker) {
    char *block = agent_build_default_skills_block(
        worker->soul_active ? worker->soul_prompt : NULL,
        worker->ethic_active ? worker->ethic_prompt : NULL,
        worker->structure_active ? worker->structure_prompt : NULL);
    if (!block) {
        worker->default_skills_revision[0] = '\0';
        return;
    }
    ds4_kvstore_sha1_bytes_hex(block, strlen(block),
                               worker->default_skills_revision);
    free(block);
}



static int runtime_skill_error_status(const char *err) {
    if (!err) return 500;
    if (!strncmp(err, "SKILL_NAME_INVALID", 18) ||
        !strncmp(err, "SKILL_USAGE_INVALID", 19))
        return 400;
    if (!strncmp(err, "SKILL_SYMLINK_REJECTED", 22) ||
        !strncmp(err, "SKILL_PATH_OUTSIDE_ROOT", 23))
        return 403;
    if (!strncmp(err, "SKILL_NOT_FOUND", 15) ||
        !strncmp(err, "SKILL_FRAGMENT_NOT_FOUND", 24))
        return 404;
    if (!strncmp(err, "SKILL_FILE_TOO_LARGE", 20) ||
        !strncmp(err, "SKILL_TOTAL_TOO_LARGE", 21))
        return 413;
    if (!strncmp(err, "SKILL_EMPTY", 11) ||
        !strncmp(err, "SKILL_NUL_BYTE", 14) ||
        !strncmp(err, "SKILL_UTF8_INVALID", 18) ||
        !strncmp(err, "SKILL_RESERVED_MARKER", 21) ||
        !strncmp(err, "SKILL_FILE_INVALID", 18) ||
        !strncmp(err, "SKILL_FRAGMENT_INVALID", 22) ||
        !strncmp(err, "SKILL_FRAGMENT_CONFIG_INVALID", 29))
        return 422;
    if (!strncmp(err, "SKILL_ACTIVE_LIMIT", 18) ||
        !strncmp(err, "SKILL_CHANGED_DURING_READ", 25) ||
        !strncmp(err, "SKILL_SESSION_REVISION_MISMATCH", 31) ||
        !strncmp(err, "SKILL_ORCHESTRATOR_REQUIRED", 27))
        return 409;
    return 500;
}

static const char *runtime_skill_error_code(const char *err) {
    static const char *codes[] = {
        "SKILL_NAME_INVALID", "SKILL_USAGE_INVALID",
        "SKILL_SYMLINK_REJECTED", "SKILL_PATH_OUTSIDE_ROOT",
        "SKILL_NOT_FOUND", "SKILL_FILE_TOO_LARGE",
        "SKILL_TOTAL_TOO_LARGE", "SKILL_EMPTY", "SKILL_NUL_BYTE",
        "SKILL_UTF8_INVALID", "SKILL_RESERVED_MARKER",
        "SKILL_FILE_INVALID", "SKILL_ACTIVE_LIMIT",
        "SKILL_CHANGED_DURING_READ", "SKILL_IO_FAILED",
        "SKILL_PROMPT_RENDER_FAILED", "SKILL_MANIFEST_IO_FAILED",
        "SKILL_SESSION_REVISION_MISMATCH",
        "SKILL_FRAGMENT_INVALID", "SKILL_FRAGMENT_NOT_FOUND",
        "SKILL_FRAGMENT_CONFIG_INVALID", "SKILL_ORCHESTRATOR_REQUIRED"
    };
    for (size_t i = 0; i < sizeof(codes) / sizeof(codes[0]); i++) {
        size_t len = strlen(codes[i]);
        if (err && !strncmp(err, codes[i], len)) return codes[i];
    }
    return "SKILL_IO_FAILED";
}

static int runtime_skill_fail(ds4_agent_command_result *result,
                              const char *err) {
    return runtime_command_fail_code(
        result, runtime_skill_error_status(err),
        runtime_skill_error_code(err), "%s",
        err && err[0] ? err : "skill operation failed");
}

static size_t runtime_skill_active_count(agent_worker *worker) {
    size_t count = worker->dynamic_skills.len;
    for (size_t i = 0; i < AGENT_BUILTIN_SKILL_COUNT; i++)
        if (agent_builtin_skill_loaded(worker, &AGENT_BUILTIN_SKILLS[i]))
            count++;
    return count;
}

static size_t runtime_skill_active_bytes(agent_worker *worker) {
    size_t total = worker->dynamic_skills.total_bytes;
    for (size_t i = 0; i < AGENT_BUILTIN_SKILL_COUNT; i++) {
        const agent_builtin_skill_descriptor *d = &AGENT_BUILTIN_SKILLS[i];
        if (!agent_builtin_skill_loaded(worker, d)) continue;
        const char *prompt = *agent_builtin_skill_prompt(worker, d);
        if (prompt) total += strlen(prompt);
    }
    return total;
}

/* Fallible on purpose: an empty aggregate revision means the session cannot be
 * serialized, which is a health problem, not a formatting detail. Reporting it
 * as an empty string next to "Skill lean is active." is how the operator was
 * left without an explanation (piano-rimedio 2 §12). */
static bool runtime_skill_aggregate_revision(agent_worker *worker,
                                             char revision[41],
                                             char *err,
                                             size_t err_len) {
    ds4_agent_skill_manifest manifest;
    char local_err[128] = {0};
    if (agent_worker_build_skill_manifest(
            worker, &manifest, local_err, sizeof(local_err))) {
        memcpy(revision, manifest.aggregate_revision, 41);
        if (err && err_len) err[0] = '\0';
        return true;
    }
    revision[0] = '\0';
    if (err && err_len)
        snprintf(err, err_len, "%s", local_err[0] ? local_err
                 : "SKILL_MANIFEST_IO_FAILED: manifest could not be built");
    return false;
}

static const char *runtime_skill_action_name(
    agent_skill_command_action action) {
    switch (action) {
    case AGENT_SKILL_CMD_START: return "start";
    case AGENT_SKILL_CMD_STOP: return "stop";
    case AGENT_SKILL_CMD_STATUS: return "status";
    case AGENT_SKILL_CMD_LIST: return "list";
    default: return "invalid";
    }
}

/* Is this skill's session state usable, not merely present?
 *
 * For a policy skill "loaded" is not enough: the operational revision must
 * match the content, or the tool is advertised and then refused. Other kinds
 * have no second half, so loaded is the whole answer. */
static bool runtime_skill_coherent(const agent_worker *worker,
                                   ds4_agent_skill_kind kind,
                                   bool loaded) {
    if (kind == DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY)
        return agent_worker_lean_policy_coherent(worker);
    return loaded;
}

static void runtime_skill_set_result(ds4_agent_runtime *rt,
                                     const agent_skill_command *command,
                                     ds4_agent_skill_kind kind,
                                     bool available,
                                     bool loaded,
                                     bool changed,
                                     bool repaired,
                                     size_t bytes,
                                     const char *revision,
                                     ds4_agent_command_result *result) {
    char aggregate_revision[41];
    char manifest_err[160] = {0};
    bool manifest_healthy = runtime_skill_aggregate_revision(
        &rt->worker, aggregate_revision, manifest_err, sizeof(manifest_err));
    bool coherent = runtime_skill_coherent(&rt->worker, kind, loaded);
    /* Operational means the tool can be used *and* the session can be saved:
     * a broken manifest blocks the next stop or save. */
    bool operational = loaded && coherent && manifest_healthy;
    bool fragment_loaded = loaded && runtime_autonomous_fragment_loaded(
        &rt->worker, kind);
    bool orchestration_enabled = runtime_autonomous_orchestration_enabled(kind);
    const char *prompt_mode = !loaded ? "none" :
        (fragment_loaded ? "autonomous" : "base");
    result->changed = changed;
    runtime_command_set_data_json(
        result,
        "{\"action\":\"%s\",\"name\":\"%s\",\"kind\":\"%s\","
        "\"available\":%s,\"loaded\":%s,\"changed\":%s,"
        "\"coherent\":%s,\"operational\":%s,\"repaired\":%s,"
        "\"manifestHealthy\":%s,\"degraded\":%s,\"errorCode\":\"%s\","
        "\"retryable\":%s,"
        "\"bytes\":%zu,\"revision\":\"%s\",\"active_count\":%zu,"
        "\"aggregate_revision\":\"%s\","
        "\"promptMode\":\"%s\",\"fragmentLoaded\":%s,"
        "\"assembledRevision\":\"%s\",\"orchestrationEnabled\":%s,"
        "\"finalizationGateEnabled\":%s,"
        "\"publicationGateEnabled\":%s,\"revalidationEnabled\":%s}",
        runtime_skill_action_name(command->action), command->name,
        ds4_agent_skill_kind_name(kind),
        available ? "true" : "false",
        loaded ? "true" : "false",
        changed ? "true" : "false",
        coherent ? "true" : "false",
        operational ? "true" : "false",
        repaired ? "true" : "false",
        manifest_healthy ? "true" : "false",
        (loaded && !operational) ? "true" : "false",
        manifest_healthy ? "" : runtime_skill_error_code(manifest_err),
        "false",
        bytes, revision ? revision : "",
        runtime_skill_active_count(&rt->worker),
        aggregate_revision,
        prompt_mode, fragment_loaded ? "true" : "false",
        revision ? revision : "",
        orchestration_enabled ? "true" : "false",
        (kind == DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY &&
         orchestration_enabled) ? "true" : "false",
        (kind == DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY &&
         orchestration_enabled) ? "true" : "false",
        (kind == DS4_AGENT_SKILL_BUILTIN_SAGE_POLICY &&
         orchestration_enabled) ? "true" : "false");
    /* Never say "active" for a state the tool cannot use, and never report an
     * unsaveable session as healthy. */
    runtime_command_set_message(
        result, "Skill %s is %s%s%s%s",
        command->name,
        !loaded ? "inactive" : (operational ? "active" : "loaded but not operational"),
        changed ? " (state changed)" : "",
        repaired ? " (repaired)" : "",
        manifest_healthy ? "." : ": the session manifest cannot be built, so "
                                 "the session cannot be saved.");
}

static int runtime_skill_view_cmp(const void *a, const void *b) {
    const runtime_skill_view *left = a;
    const runtime_skill_view *right = b;
    return strcmp(left->name, right->name);
}

static int runtime_skill_list(ds4_agent_runtime *rt,
                              ds4_agent_command_result *result) {
    runtime_skill_view views[DS4_AGENT_SKILL_ACTIVE_MAX + 5];
    size_t count = 0;
    for (size_t i = 0; i < AGENT_BUILTIN_SKILL_COUNT; i++) {
        ds4_agent_skill_kind kind = AGENT_BUILTIN_SKILLS[i].kind;
        runtime_skill_view candidate = {0};
        snprintf(candidate.name, sizeof(candidate.name), "%s",
                 AGENT_BUILTIN_SKILLS[i].name);
        candidate.kind = "builtin";
        runtime_skill_state(&rt->worker, candidate.name, kind,
                            &candidate.loaded, &candidate.bytes,
                            candidate.revision);
        if (candidate.loaded)
            views[count++] = candidate;
    }
    for (size_t i = 0; i < rt->worker.dynamic_skills.len; i++) {
        const ds4_agent_skill_entry *entry =
            &rt->worker.dynamic_skills.items[i];
        runtime_skill_view *view = &views[count++];
        memset(view, 0, sizeof(*view));
        snprintf(view->name, sizeof(view->name), "%s", entry->name);
        view->kind = "dynamic";
        view->loaded = true;
        view->bytes = entry->content_len;
        memcpy(view->revision, entry->revision, sizeof(view->revision));
    }
    qsort(views, count, sizeof(views[0]), runtime_skill_view_cmp);

    agent_buf json = {0};
    agent_buf_puts(&json, "{\"action\":\"list\",\"active_count\":");
    char number[64];
    snprintf(number, sizeof(number), "%zu",
             runtime_skill_active_count(&rt->worker));
    agent_buf_puts(&json, number);
    agent_buf_puts(&json, ",\"aggregate_revision\":\"");
    char aggregate_revision[41];
    char list_manifest_err[160] = {0};
    bool list_manifest_healthy = runtime_skill_aggregate_revision(
        &rt->worker, aggregate_revision,
        list_manifest_err, sizeof(list_manifest_err));
    agent_buf_puts(&json, aggregate_revision);
    agent_buf_puts(&json, "\",\"manifestHealthy\":");
    agent_buf_puts(&json, list_manifest_healthy ? "true" : "false");
    if (!list_manifest_healthy) {
        agent_buf_puts(&json, ",\"errorCode\":\"");
        agent_buf_puts(&json, runtime_skill_error_code(list_manifest_err));
        agent_buf_puts(&json, "\"");
    }
    agent_buf_puts(&json, ",\"skills\":[");
    for (size_t i = 0; i < count; i++) {
        char item[384];
        int len = snprintf(
            item, sizeof(item),
            "%s{\"name\":\"%s\",\"kind\":\"%s\",\"loaded\":%s,"
            "\"revision\":\"%s\",\"bytes\":%zu}",
            i ? "," : "", views[i].name, views[i].kind,
            views[i].loaded ? "true" : "false",
            views[i].revision, views[i].bytes);
        if (len < 0 || (size_t)len >= sizeof(item)) {
            free(json.ptr);
            return runtime_command_fail_code(
                result, 500, "SKILL_IO_FAILED",
                "failed to serialize skill list");
        }
        agent_buf_append(&json, item, (size_t)len);
    }
    agent_buf_puts(&json, "]}");
    free(result->data_json);
    result->data_json = agent_buf_take(&json);
    runtime_command_set_message(result, "Active skill state.");
    return 0;
}

static bool runtime_skill_apply_staged(ds4_agent_runtime *rt,
                                       ds4_agent_skill_entry *staged,
                                       char *err,
                                       size_t err_len) {
    if (staged->kind == DS4_AGENT_SKILL_DYNAMIC) {
        bool changed = false;
        return ds4_agent_skill_registry_upsert(
            &rt->worker.dynamic_skills, staged, &changed, err, err_len);
    }
    bool *active = NULL;
    char **slot =
        runtime_skill_builtin_slot(&rt->worker, staged->kind, &active);
    if (!slot) {
        snprintf(err, err_len, "SKILL_IO_FAILED: invalid built-in skill");
        return false;
    }
    free(*slot);
    *slot = staged->content;
    staged->content = NULL;
    if (active) *active = true;
    /* Policy skills carry an operational revision the tool dispatcher reads.
     * Derived from the descriptor: the Lean case was originally missing here,
     * so lean_prompt was set while lean_policy_revision stayed empty and
     * lean_check answered right after a "successful" /lean start. */
    const agent_builtin_skill_descriptor *d =
        agent_builtin_skill_by_kind(staged->kind);
    if (d) {
        char *revision = agent_builtin_skill_revision(&rt->worker, d);
        if (revision)
            memcpy(revision, staged->revision,
                   DS4_AGENT_SKILL_REVISION_HEX + 1);
        if (d->contributes_default_revision)
            runtime_default_skills_revise(&rt->worker);
    }
    /* /lean start is the supported repair for a prompt drift, so it is also what
     * forgets one: this session now holds whatever is on disk, and the previous
     * comparison with the server describes text it no longer has (§23.2). */
    if (staged->kind == DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY)
        agent_worker_init_lean_contract(&rt->worker);
    return true;
}

static bool runtime_skill_remove(ds4_agent_runtime *rt,
                                 const char *name,
                                 ds4_agent_skill_kind kind) {
    if (kind == DS4_AGENT_SKILL_DYNAMIC) {
        bool changed = false;
        return ds4_agent_skill_registry_remove(
            &rt->worker.dynamic_skills, name, &changed);
    }
    bool *active = NULL;
    char **slot = runtime_skill_builtin_slot(&rt->worker, kind, &active);
    if (!slot) return false;
    free(*slot);
    *slot = NULL;
    if (active) *active = false;
    /* Stop clears both halves or neither: a leftover revision would keep the
     * tool looking invocable after the policy is gone. */
    const agent_builtin_skill_descriptor *d = agent_builtin_skill_by_kind(kind);
    if (d) {
        char *revision = agent_builtin_skill_revision(&rt->worker, d);
        if (revision) revision[0] = '\0';
        if (d->contributes_default_revision)
            runtime_default_skills_revise(&rt->worker);
    }
    return true;
}

static int runtime_apply_skill_command(
    ds4_agent_runtime *rt,
    const agent_skill_command *command,
    bool generic_syntax,
    ds4_agent_command_result *result) {
    if (generic_syntax && !runtime_dynamic_skills_enabled())
        return runtime_command_fail_code(
            result, 409, "DYNAMIC_SKILLS_DISABLED",
            "Dynamic skills are disabled.");
    if (!runtime_is_agent_mode(rt))
        return runtime_command_fail_code(
            result, 409, "AGENT_MODE_REQUIRED",
            "The /skill command requires Agent Mode.");
    if (command->action == AGENT_SKILL_CMD_LIST)
        return runtime_skill_list(rt, result);

    ds4_agent_skill_kind kind = DS4_AGENT_SKILL_DYNAMIC;
    agent_skill_builtin_kind_for_name(command->name, &kind);
    if (command->action == AGENT_SKILL_CMD_START &&
        runtime_authoritative_math_mode_conflicts(&rt->worker, kind))
        return runtime_command_fail_code(
            result, 409, "AUTHORITATIVE_MATH_MODE_CONFLICT",
            "Lean and Sage autonomous policies cannot be active together.");
    bool loaded = false;
    bool same_content = false;
    bool coherent_now = false;
    bool repairing = false;
    size_t bytes = 0;
    char revision[41] = {0};
    runtime_skill_state(&rt->worker, command->name, kind,
                        &loaded, &bytes, revision);

    if (command->action == AGENT_SKILL_CMD_STATUS) {
        ds4_agent_skill_entry available_entry = {0};
        char available_err[256] = {0};
        bool available = runtime_skill_stage_from_disk(
            agent_skills_dir(), command->name, kind,
            &available_entry, available_err, sizeof(available_err));
        ds4_agent_skill_entry_free(&available_entry);
        runtime_skill_set_result(rt, command, kind, available, loaded,
                                 false, false, bytes, revision, result);
        return 0;
    }

    ds4_agent_skill_entry staged = {0};
    if (command->action == AGENT_SKILL_CMD_START) {
        char stage_err[256] = {0};
        if (!runtime_skill_stage_from_disk(
                agent_skills_dir(), command->name, kind,
                &staged, stage_err, sizeof(stage_err))) {
            rt->skill_load_failure_total++;
            return runtime_skill_fail(result, stage_err);
        }
        /* Same content is not the same state: a session whose policy
         * revision is missing or stale must be repaired, not reported as an
         * idempotent success (piano-rimedio 2 §6). */
        same_content = !strcmp(revision, staged.revision);
        coherent_now = runtime_skill_coherent(&rt->worker, kind, loaded);
        if (loaded && same_content && coherent_now) {
            rt->skill_start_idempotent_total++;
            /* Idempotent for the policy, not for a recorded drift: the drift is
             * the memory of one comparison with the server, and the next
             * lean_check redoes it. Leaving it set would keep /lean preflight
             * reporting a difference the operator has already acted on (§23.2). */
            if (kind == DS4_AGENT_SKILL_BUILTIN_LEAN_POLICY)
                agent_worker_init_lean_contract(&rt->worker);
            runtime_skill_set_result(
                rt, command, kind, true, true, false, false,
                bytes, revision, result);
            ds4_agent_skill_entry_free(&staged);
            return 0;
        }
        repairing = loaded && same_content && !coherent_now;
        if (!loaded &&
            runtime_skill_active_count(&rt->worker) >=
                DS4_AGENT_SKILL_ACTIVE_MAX) {
            ds4_agent_skill_entry_free(&staged);
            return runtime_command_fail_code(
                result, 409, "SKILL_ACTIVE_LIMIT",
                "at most 32 skills may be active");
        }
        size_t active_bytes = runtime_skill_active_bytes(&rt->worker);
        size_t replaced = loaded ? bytes : 0;
        /* Saturating: if accounting ever misses an active skill again, this
         * must under-report, never wrap into a bogus 16 EiB. */
        size_t retained_bytes = active_bytes > replaced ? active_bytes - replaced : 0;
        if (staged.content_len > DS4_AGENT_SKILL_TOTAL_MAX ||
            retained_bytes >
                DS4_AGENT_SKILL_TOTAL_MAX - staged.content_len) {
            ds4_agent_skill_entry_free(&staged);
            return runtime_command_fail_code(
                result, 413, "SKILL_TOTAL_TOO_LARGE",
                "active skills exceed 1 MiB");
        }
    } else if (!loaded) {
        rt->skill_stop_idempotent_total++;
        runtime_skill_set_result(
            rt, command, kind, false, false, false, false, 0, "", result);
        return 0;
    }

    if (!runtime_command_save_if_dirty(rt, result)) {
        if (result->message &&
            strstr(result->message, "SKILL_MANIFEST_IO_FAILED"))
            rt->skill_manifest_failure_total++;
        ds4_agent_skill_entry_free(&staged);
        return -1;
    }

    char apply_err[256] = {0};
    bool applied = command->action == AGENT_SKILL_CMD_START
        ? runtime_skill_apply_staged(rt, &staged,
                                     apply_err, sizeof(apply_err))
        : runtime_skill_remove(rt, command->name, kind);
    ds4_agent_skill_entry_free(&staged);
    if (!applied) {
        return runtime_skill_fail(result, apply_err);
    }

    runtime_skill_state(&rt->worker, command->name, kind,
                        &loaded, &bytes, revision);
    runtime_skill_set_result(
        rt, command, kind,
        command->action == AGENT_SKILL_CMD_START,
        loaded, true, repairing, bytes, revision, result);
    if (command->action == AGENT_SKILL_CMD_START)
        rt->skill_start_success_total++;
    else
        rt->skill_stop_success_total++;

    rt->sysprompt_dirty = true;
    return 0;
}

/* Report a boolean the way a preflight reader wants to read it. */
static const char *runtime_lean_yes_no(const char *json, const char *key) {
    return agent_json_extract_bool(json, key) ? "yes" : "no";
}

/* `/lean preflight` — ask the Node side whether the Lean runtime is usable.
 *
 * Read-only by construction: it installs nothing and provisions nothing, and it
 * reports what the server says rather than guessing from the C side, which has
 * no view of the sandbox or the Lake profiles. */
static int runtime_command_lean_preflight(ds4_agent_runtime *rt,
                                          ds4_agent_command_result *result) {
    int port = rt->cfg.frontend_port;
    if (port <= 0)
        return runtime_command_fail_code(
            result, 503, "LEAN_FRONTEND_UNAVAILABLE",
            "no frontend port is configured; the Lean runtime cannot be queried "
            "from the native agent");

    char *body = agent_http_get_local(port, "/api/lean/status", 65536);
    if (!body)
        return runtime_command_fail_code(
            result, 503, "LEAN_HTTP_TRANSPORT_FAILED",
            "the Lean status endpoint did not answer on port %d", port);

    char *contract = agent_json_extract_string(body, "contractVersion");
    if (!contract || strcmp(contract, "lean_result_v1")) {
        free(contract);
        free(body);
        return runtime_command_fail_code(
            result, 502, "LEAN_CONTRACT_UNSUPPORTED",
            "the Lean status endpoint returned an unexpected payload");
    }
    free(contract);

    /* Three separate lines for three separate facts. One "policy matches: no"
     * was what the operator saw when the server merely had a newer SKILL.md, and
     * it read as "Lean is broken" (fix-revision-lean §22.2). */
    char *server_prompt = agent_json_extract_string(body, "policyRevision");
    char *server_contract = agent_json_extract_string(body, "contractRevision");
    const char *session_prompt = rt->worker.lean_policy_revision[0]
        ? rt->worker.lean_policy_revision
        : "(none)";
    bool prompt_drift =
        server_prompt && server_prompt[0] && rt->worker.lean_policy_revision[0] &&
        strcmp(server_prompt, rt->worker.lean_policy_revision) != 0;
    bool contract_compatible =
        server_contract && server_contract[0] &&
        !strcmp(server_contract, DS4_LEAN_CONTRACT_REVISION);

    /* The status payload nests preflight/profiles; the flat extractor cannot
     * reach them, so report the top-level verdicts and hand back the raw body
     * for anything finer. */
    runtime_command_set_message(
        result,
        "Lean preflight:\n"
        "  feature enabled         : %s\n"
        "  local prompt loaded     : %s\n"
        "  local prompt coherent   : %s\n"
        "  session prompt revision : %.8s\n"
        "  server prompt revision  : %.8s\n"
        "  prompt drift            : %s\n"
        "  prompt drift blocking   : no\n"
        "  contract revision       : %.8s\n"
        "  contract compatible     : %s\n"
        "See data for sandbox and per-profile detail.",
        runtime_lean_yes_no(body, "enabled"),
        rt->worker.lean_prompt ? "yes" : "no",
        agent_worker_lean_policy_coherent(&rt->worker) ? "yes" : "no",
        session_prompt,
        (server_prompt && server_prompt[0]) ? server_prompt : "(none)",
        prompt_drift ? "yes" : "no",
        rt->worker.lean_contract_revision[0]
            ? rt->worker.lean_contract_revision
            : DS4_LEAN_CONTRACT_REVISION,
        contract_compatible ? "yes"
                            : (server_contract && server_contract[0] ? "NO" : "unknown"));

    free(result->data_json);
    result->data_json = body;
    free(server_prompt);
    free(server_contract);

    result->ok = true;
    result->http_status = 200;
    return 0;
}

static int runtime_apply_legacy_skill_command(
    ds4_agent_runtime *rt,
    const char *name,
    const char *arg,
    ds4_agent_command_result *result) {
    char combined[160];
    int len = snprintf(combined, sizeof(combined), "%s %s",
                       name, arg ? arg : "");
    if (len < 0 || (size_t)len >= sizeof(combined))
        return runtime_command_fail_code(
            result, 400, "SKILL_USAGE_INVALID",
            "invalid legacy skill command");
    agent_skill_command command = {0};
    char err[256] = {0};
    if (!agent_parse_skill_command_arg(
            combined, &command, err, sizeof(err)))
        return runtime_skill_fail(result, err);
    return runtime_apply_skill_command(rt, &command, false, result);
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
            "  /skill NAME start|stop|status  Manage an Agent Chat skill.\n"
            "  /skill list  List skill state.\n"
            "  /metacognition start|stop|status  Manage the metacognition skill.\n"
            "  /soul start|stop|status  Manage the soul skill.\n"
            "  /ethic start|stop|status  Manage the ethic skill.\n"
            "  /structure start|stop|status  Manage the structure skill.\n"
            "  /sage-pol start|stop|status  Manage the Sage policy skill.\n"
            "  /sage start|stop|status  Manage SageMath and its policy skill.\n"
            "  /lean start|stop|status|preflight\n"
            "                          Manage the Lean 4 policy skill; preflight\n"
            "                          reports whether the runtime is usable.\n"
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

    case AGENT_SLASH_SKILL: {
        agent_skill_command skill_command = {0};
        char skill_err[256] = {0};
        if (!agent_parse_skill_command_arg(
                parsed.arg, &skill_command,
                skill_err, sizeof(skill_err)))
            return runtime_skill_fail(result, skill_err);
        if (runtime_apply_skill_command(
                rt, &skill_command, true, result) != 0)
            return -1;
        break;
    }

    case AGENT_SLASH_METACOGNITION:
        if (runtime_apply_legacy_skill_command(
                rt, "metacognition", parsed.arg, result) != 0)
            return -1;
        break;

    case AGENT_SLASH_SOUL:
        if (runtime_apply_legacy_skill_command(
                rt, "soul", parsed.arg, result) != 0)
            return -1;
        break;

    case AGENT_SLASH_ETHIC:
        if (runtime_apply_legacy_skill_command(
                rt, "ethic", parsed.arg, result) != 0)
            return -1;
        break;

    case AGENT_SLASH_STRUCTURE:
        if (runtime_apply_legacy_skill_command(
                rt, "structure", parsed.arg, result) != 0)
            return -1;
        break;

    case AGENT_SLASH_SAGE_POL:
    case AGENT_SLASH_SAGE:
        if (runtime_apply_legacy_skill_command(
                rt, "sage", parsed.arg, result) != 0)
            return -1;
        break;

    case AGENT_SLASH_LEAN:
        /* preflight is a Lean-only verb: it asks the Node side about the
         * runtime rather than touching the policy, so it cannot go through the
         * generic start|stop|status skill parser. */
        if (parsed.arg[0] && !strcmp(parsed.arg, "preflight")) {
            if (runtime_command_lean_preflight(rt, result) != 0) return -1;
            break;
        }
        if (runtime_apply_legacy_skill_command(
                rt, "lean", parsed.arg, result) != 0)
            return -1;
        break;

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

void ds4_agent_runtime_get_default_skills_status(
    ds4_agent_runtime *rt,
    ds4_default_skills_status *out) {
    if (!out) return;
    memset(out, 0, sizeof(*out));
    if (!rt || !rt->worker_valid) return;

    out->enabled = rt->worker.default_skills_enabled;
    out->soul_loaded = rt->worker.soul_prompt != NULL;
    out->ethic_loaded = rt->worker.ethic_prompt != NULL;
    out->structure_loaded = rt->worker.structure_prompt != NULL;
    out->soul_bytes = rt->worker.soul_prompt
        ? strlen(rt->worker.soul_prompt) : 0;
    out->ethic_bytes = rt->worker.ethic_prompt
        ? strlen(rt->worker.ethic_prompt) : 0;
    out->structure_bytes = rt->worker.structure_prompt
        ? strlen(rt->worker.structure_prompt) : 0;
    memcpy(out->revision,
           rt->worker.default_skills_revision,
           sizeof(out->revision));
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
