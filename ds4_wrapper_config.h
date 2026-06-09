#ifndef DS4_WRAPPER_CONFIG_H
#define DS4_WRAPPER_CONFIG_H

#include "ds4.h"
#include "ds4_kvstore.h"
#include "ds4_wrapper.h"

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    ds4_engine_options engine;

    int ctx_size;
    int default_tokens;

    const char *host;
    int port;

    const char *trace_path;

    const char *kv_disk_dir;
    uint64_t kv_disk_space_mb;
    ds4_kvstore_options kv_options;
    bool kv_reject_different_quant;

    int max_queued_jobs;
    int tool_memory_max_ids;

    ds4_wrap_mode startup_mode;

    bool freeze_on_switch;
    bool free_inactive_session;
    bool allow_browser;

    uint64_t ram_freeze_max_mb;

    const char *agent_system_prompt;
    const char *server_session_key;
    const char *agent_session_key;
} ds4_wrapper_config;

ds4_wrapper_config ds4_wrapper_default_config(void);
ds4_wrapper_config ds4_wrapper_parse_options(int argc, char **argv);

#endif
