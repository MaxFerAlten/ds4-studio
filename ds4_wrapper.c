#include "ds4_wrapper.h"
#include "ds4_wrapper_config.h"
#include "ds4_wrapper_state.h"
#include "ds4_wrapper_http.h"
#include "ds4_server_runtime.h"
#include "ds4_agent_runtime.h"

#include <time.h>
#include <signal.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>

const char *ds4_wrap_mode_name(ds4_wrap_mode mode) {
    switch (mode) {
    case DS4_WRAP_MODE_SERVER: return "server";
    case DS4_WRAP_MODE_AGENT:  return "agent";
    default: return "unknown";
    }
}

const char *ds4_wrap_state_name(ds4_wrap_state state) {
    switch (state) {
    case DS4_WRAP_STATE_STARTING:  return "starting";
    case DS4_WRAP_STATE_READY:     return "ready";
    case DS4_WRAP_STATE_BUSY:      return "busy";
    case DS4_WRAP_STATE_SWITCHING: return "switching";
    case DS4_WRAP_STATE_ERROR:     return "error";
    case DS4_WRAP_STATE_STOPPING:  return "stopping";
    default: return "unknown";
    }
}

const char *ds4_wrap_frozen_kind_name(ds4_wrap_frozen_kind kind) {
    switch (kind) {
    case DS4_WRAP_FROZEN_NONE: return "none";
    case DS4_WRAP_FROZEN_RAM:  return "ram";
    case DS4_WRAP_FROZEN_DISK: return "disk";
    default: return "unknown";
    }
}

double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec * 1e-6;
}

static volatile sig_atomic_t g_stop_requested = 0;

static void stop_signal_handler(int sig) {
    (void)sig;
    g_stop_requested = 1;
}

int main(int argc, char **argv) {
    /* Setup signal handlers */
    signal(SIGPIPE, SIG_IGN);
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = stop_signal_handler;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    /* Parse configuration */
    ds4_wrapper_config cfg = ds4_wrapper_parse_options(argc, argv);

    /* Open engine (once) */
    ds4_engine *engine = NULL;
    if (ds4_engine_open(&engine, &cfg.engine) != 0) {
        fprintf(stderr, "ds4-wrapper: failed to open engine\n");
        return 1;
    }

    /* Initialize wrapper context */
    ds4_wrapper w;
    if (ds4_wrapper_init(&w, engine, &cfg) != 0) {
        fprintf(stderr, "ds4-wrapper: failed to initialize wrapper state\n");
        ds4_engine_close(engine);
        return 1;
    }

    /* Initialize server runtime */
    ds4_server_runtime_options srv_opt;
    memset(&srv_opt, 0, sizeof(srv_opt));
    srv_opt.default_tokens = cfg.default_tokens;
    srv_opt.enable_cors = true;
    srv_opt.disable_exact_dsml_tool_replay = false;
    srv_opt.tool_memory_max_ids = cfg.tool_memory_max_ids;
    srv_opt.kv_disk_dir = cfg.kv_disk_dir;
    srv_opt.kv_disk_space_mb = cfg.kv_disk_space_mb;
    srv_opt.kv_reject_different_quant = cfg.kv_reject_different_quant;
    srv_opt.kv_options = cfg.kv_options;

    if (ds4_server_runtime_init(&w.server_rt, &w, &srv_opt) != 0) {
        fprintf(stderr, "ds4-wrapper: failed to initialize server runtime\n");
        ds4_wrapper_close(&w);
        ds4_engine_close(engine);
        return 1;
    }

    /* Startup initial session based on startup mode */
    char err[256];
    if (ds4_wrapper_startup_session(&w, cfg.startup_mode, err, sizeof(err)) != 0) {
        fprintf(stderr, "ds4-wrapper: session startup failed: %s\n", err);
        ds4_server_runtime_free(w.server_rt);
        ds4_wrapper_close(&w);
        ds4_engine_close(engine);
        return 1;
    }

    /* Agent runtime is lazily initialized on first agent request to avoid
     * slow system-prompt processing at startup on large models. */

    /* Start HTTP server */
    if (ds4_wrapper_http_start(&w, &cfg) != 0) {
        fprintf(stderr, "ds4-wrapper: failed to start HTTP server\n");
        ds4_server_runtime_free(w.server_rt);
        ds4_wrapper_close(&w);
        ds4_engine_close(engine);
        return 1;
    }

    /* Main wait loop */
    while (!g_stop_requested) {
        sleep(1);
    }

    fprintf(stderr, "ds4-wrapper: shutting down...\n");

    /* Cleanup and exit */
    ds4_wrapper_http_stop(&w);
    ds4_agent_runtime_free(w.agent_rt);
    ds4_server_runtime_free(w.server_rt);
    ds4_wrapper_close(&w);
    ds4_engine_close(engine);

    return 0;
}

int ds4_wrapper_ensure_agent_rt(ds4_wrapper *w, char *err, size_t err_len) {
    if (w->agent_rt) return 0;

    ds4_agent_runtime_options opt;
    memset(&opt, 0, sizeof(opt));
    opt.system_prompt = w->agent_system_prompt;
    opt.n_predict = w->agent_n_predict;

    if (ds4_agent_runtime_init(&w->agent_rt, w, &opt) != 0) {
        snprintf(err, err_len, "failed to initialize agent runtime");
        return -1;
    }
    return 0;
}
