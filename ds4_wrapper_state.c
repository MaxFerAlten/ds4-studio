#include "ds4_wrapper_state.h"
#include "ds4_agent_session_store.h"
#include "ds4_agent_runtime.h"

#include <stdio.h>
#include <string.h>
#include <time.h>

/* Defined in ds4_wrapper.c */
extern double now_ms(void);

int ds4_wrapper_init(ds4_wrapper *w, ds4_engine *engine, const ds4_wrapper_config *cfg) {
    memset(w, 0, sizeof(*w));
    w->engine = engine;
    w->configured_ctx_size = cfg->ctx_size;
    w->configured_tokens = cfg->default_tokens;
    w->active_mode = cfg->startup_mode;
    w->state = DS4_WRAP_STATE_STARTING;
    w->prefer_ram_freeze = (cfg->ram_freeze_max_mb > 0);
    w->ram_freeze_max_bytes = cfg->ram_freeze_max_mb * 1024ULL * 1024ULL;

    w->agent_system_prompt = cfg->agent_system_prompt;
    w->agent_n_predict = cfg->default_tokens;
    w->agent_allow_browser = cfg->allow_browser;

    pthread_mutex_init(&w->mu, NULL);
    pthread_cond_init(&w->cv, NULL);

    return 0;
}

void ds4_wrapper_close(ds4_wrapper *w) {
    if (w->active_session) {
        ds4_session_free(w->active_session);
        w->active_session = NULL;
    }
    ds4_session_snapshot_free(&w->server_meta.ram);
    ds4_session_snapshot_free(&w->agent_meta.ram);
    pthread_cond_destroy(&w->cv);
    pthread_mutex_destroy(&w->mu);
}

int ds4_wrapper_startup_session(ds4_wrapper *w, ds4_wrap_mode mode, char *err, size_t err_len) {
    ds4_session *session = NULL;
    if (ds4_session_create(&session, w->engine, w->configured_ctx_size) != 0) {
        snprintf(err, err_len, "failed to create ds4_session for %s mode",
                 ds4_wrap_mode_name(mode));
        return -1;
    }
    w->active_session = session;
    w->active_mode = mode;

    ds4_wrap_session_meta *m =
        (mode == DS4_WRAP_MODE_SERVER) ? &w->server_meta : &w->agent_meta;
    m->active = true;
    m->exists = true;
    m->tokens = 0;

    w->state = DS4_WRAP_STATE_READY;

    fprintf(stderr, "ds4-wrapper: %s session created (ctx=%d)\n",
            ds4_wrap_mode_name(mode), w->configured_ctx_size);
    return 0;
}

int ds4_wrapper_enter_request(ds4_wrapper *w, ds4_wrap_mode required, char *err, size_t err_len) {
    pthread_mutex_lock(&w->mu);

    if (w->state == DS4_WRAP_STATE_SWITCHING) {
        snprintf(err, err_len, "wrapper is switching mode");
        pthread_mutex_unlock(&w->mu);
        return 409;
    }

    if (w->active_mode != required) {
        w->rejected_wrong_mode++;
        snprintf(err, err_len, "wrong mode: active=%s required=%s",
                 ds4_wrap_mode_name(w->active_mode),
                 ds4_wrap_mode_name(required));
        pthread_mutex_unlock(&w->mu);
        return 409;
    }

    if (w->busy) {
        w->rejected_busy++;
        snprintf(err, err_len, "wrapper is busy");
        pthread_mutex_unlock(&w->mu);
        return 409;
    }

    if (!w->active_session) {
        snprintf(err, err_len, "no active session (frozen or not loaded)");
        pthread_mutex_unlock(&w->mu);
        return 503;
    }

    w->busy = true;
    w->state = DS4_WRAP_STATE_BUSY;
    w->total_requests++;

    pthread_mutex_unlock(&w->mu);
    return 0;
}

void ds4_wrapper_leave_request(ds4_wrapper *w) {
    pthread_mutex_lock(&w->mu);
    w->busy = false;
    if (w->state != DS4_WRAP_STATE_ERROR && w->state != DS4_WRAP_STATE_STOPPING) {
        w->state = DS4_WRAP_STATE_READY;
    }
    pthread_cond_broadcast(&w->cv);
    pthread_mutex_unlock(&w->mu);
}

int ds4_wrapper_freeze_active_session(ds4_wrapper *w, char *err, size_t err_len) {
    if (!w->active_session) return 0;

    ds4_wrap_session_meta *m =
        (w->active_mode == DS4_WRAP_MODE_SERVER) ? &w->server_meta : &w->agent_meta;

    const ds4_tokens *tokens = ds4_session_tokens(w->active_session);

    if (!tokens || tokens->len == 0) {
        ds4_session_free(w->active_session);
        w->active_session = NULL;
        m->exists = false;
        m->frozen_kind = DS4_WRAP_FROZEN_NONE;
        m->tokens = 0;
        return 0;
    }

    double t0 = now_ms();
    uint64_t payload_bytes = ds4_session_payload_bytes(w->active_session);
    bool use_ram = w->prefer_ram_freeze &&
                   payload_bytes > 0 &&
                   payload_bytes <= w->ram_freeze_max_bytes;

    if (use_ram) {
        if (!ds4_sess_store_ram(w->active_session, &m->ram, err, err_len)) return -1;
        m->frozen_kind = DS4_WRAP_FROZEN_RAM;
    } else {
        if (!ds4_sess_store_disk(w->engine, w->active_session, tokens,
                                 m->disk_path, m->title, 0,
                                 err, err_len)) return -1;
        m->frozen_kind = DS4_WRAP_FROZEN_DISK;
    }

    m->exists = true;
    m->active = false;
    m->tokens = tokens->len;
    m->last_freeze_ms = now_ms() - t0;

    w->last_freeze_ms = m->last_freeze_ms;
    w->freeze_count++;

    ds4_session_free(w->active_session);
    w->active_session = NULL;

    return 0;
}

int ds4_wrapper_thaw_session(ds4_wrapper *w, ds4_wrap_mode target, char *err, size_t err_len) {
    ds4_wrap_session_meta *m =
        (target == DS4_WRAP_MODE_SERVER) ? &w->server_meta : &w->agent_meta;

    double t0 = now_ms();

    ds4_session *session = NULL;
    if (ds4_session_create(&session, w->engine, w->configured_ctx_size) != 0) {
        snprintf(err, err_len, "failed to create ds4_session");
        return -1;
    }

    if (!m->exists || m->frozen_kind == DS4_WRAP_FROZEN_NONE) {
        w->active_session = session;
        m->last_thaw_ms = now_ms() - t0;
        w->last_thaw_ms = m->last_thaw_ms;
        w->thaw_count++;
        return 0;
    }

    bool ok = false;

    if (m->frozen_kind == DS4_WRAP_FROZEN_RAM) {
        ok = ds4_sess_load_ram(session, &m->ram, err, err_len);
    } else if (m->frozen_kind == DS4_WRAP_FROZEN_DISK) {
        ds4_tokens toks;
        memset(&toks, 0, sizeof(toks));
        ds4_kvstore_load_result lr;
        memset(&lr, 0, sizeof(lr));

        ok = ds4_sess_load_disk(w->engine, session, m->disk_path, &toks, &lr, err, err_len);

        ds4_tokens_free(&toks);
        ds4_kvstore_load_result_free(&lr);
    } else {
        snprintf(err, err_len, "invalid frozen kind");
        ok = false;
    }

    if (!ok) {
        ds4_session_free(session);
        return -1;
    }

    w->active_session = session;
    m->active = true;
    m->last_thaw_ms = now_ms() - t0;
    w->last_thaw_ms = m->last_thaw_ms;
    w->thaw_count++;

    return 0;
}

int ds4_wrapper_switch_mode(ds4_wrapper *w, ds4_wrap_mode target, char *err, size_t err_len) {
    pthread_mutex_lock(&w->mu);

    if (w->busy) {
        /* Interrupt the running request and wait for it to finish. */
        if (w->agent_rt) ds4_agent_runtime_interrupt(w->agent_rt);
        while (w->busy)
            pthread_cond_wait(&w->cv, &w->mu);
    }

    if (w->active_mode == target) {
        pthread_mutex_unlock(&w->mu);
        return 0;
    }

    ds4_wrap_mode previous = w->active_mode;
    w->state = DS4_WRAP_STATE_SWITCHING;

    pthread_mutex_unlock(&w->mu);

    double t0 = now_ms();

    if (ds4_wrapper_freeze_active_session(w, err, err_len) != 0) {
        pthread_mutex_lock(&w->mu);
        w->state = DS4_WRAP_STATE_ERROR;
        snprintf(w->last_error, sizeof(w->last_error), "%s", err);
        pthread_mutex_unlock(&w->mu);
        return 500;
    }

    if (ds4_wrapper_thaw_session(w, target, err, err_len) != 0) {
        pthread_mutex_lock(&w->mu);
        w->state = DS4_WRAP_STATE_ERROR;
        snprintf(w->last_error, sizeof(w->last_error), "%s", err);
        pthread_mutex_unlock(&w->mu);
        return 500;
    }

    pthread_mutex_lock(&w->mu);

    w->active_mode = target;
    w->server_meta.active = (target == DS4_WRAP_MODE_SERVER);
    w->agent_meta.active = (target == DS4_WRAP_MODE_AGENT);
    w->state = DS4_WRAP_STATE_READY;
    w->switch_count++;
    w->last_switch_ms = now_ms() - t0;

    pthread_cond_broadcast(&w->cv);
    pthread_mutex_unlock(&w->mu);

    fprintf(stderr, "ds4-wrapper: switched %s -> %s in %.2f ms\n",
            ds4_wrap_mode_name(previous), ds4_wrap_mode_name(target), w->last_switch_ms);

    return 0;
}


