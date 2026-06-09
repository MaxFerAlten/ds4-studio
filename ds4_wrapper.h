#ifndef DS4_WRAPPER_H
#define DS4_WRAPPER_H

#include "ds4.h"
#include "ds4_kvstore.h"

#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>

#define DS4_WRAP_PATH_MAX 512
#define DS4_WRAP_TITLE_MAX 128
#define DS4_WRAP_ERROR_MAX 256

typedef enum {
    DS4_WRAP_MODE_SERVER = 0,
    DS4_WRAP_MODE_AGENT  = 1
} ds4_wrap_mode;

typedef enum {
    DS4_WRAP_STATE_STARTING = 0,
    DS4_WRAP_STATE_READY,
    DS4_WRAP_STATE_BUSY,
    DS4_WRAP_STATE_SWITCHING,
    DS4_WRAP_STATE_ERROR,
    DS4_WRAP_STATE_STOPPING
} ds4_wrap_state;

typedef enum {
    DS4_WRAP_FROZEN_NONE = 0,
    DS4_WRAP_FROZEN_RAM,
    DS4_WRAP_FROZEN_DISK
} ds4_wrap_frozen_kind;

typedef struct {
    char id[32];
    char title[DS4_WRAP_TITLE_MAX];
    char disk_path[DS4_WRAP_PATH_MAX];

    ds4_session_snapshot ram;
    ds4_wrap_frozen_kind frozen_kind;

    bool exists;
    bool active;
    int tokens;

    double last_freeze_ms;
    double last_thaw_ms;
} ds4_wrap_session_meta;

typedef struct {
    ds4_engine *engine;
    ds4_session *active_session;

    int configured_ctx_size;
    int configured_tokens;

    ds4_wrap_mode active_mode;
    ds4_wrap_state state;

    pthread_mutex_t mu;
    pthread_cond_t cv;

    bool busy;
    bool stop_requested;

    ds4_kvstore kv;

    bool prefer_ram_freeze;
    uint64_t ram_freeze_max_bytes;

    ds4_wrap_session_meta server_meta;
    ds4_wrap_session_meta agent_meta;

    uint64_t total_requests;
    uint64_t rejected_busy;
    uint64_t rejected_wrong_mode;
    uint64_t switch_count;
    uint64_t freeze_count;
    uint64_t thaw_count;

    double last_freeze_ms;
    double last_thaw_ms;
    double last_switch_ms;

    struct ds4_server_runtime *server_rt;
    struct ds4_agent_runtime *agent_rt;

    /* Agent config stored for lazy runtime init */
    const char *agent_system_prompt;
    int agent_n_predict;
    bool agent_allow_browser;

    char last_error[DS4_WRAP_ERROR_MAX];
} ds4_wrapper;

const char *ds4_wrap_mode_name(ds4_wrap_mode mode);
const char *ds4_wrap_state_name(ds4_wrap_state state);
const char *ds4_wrap_frozen_kind_name(ds4_wrap_frozen_kind kind);

int ds4_wrapper_ensure_agent_rt(ds4_wrapper *w, char *err, size_t err_len);

#endif
