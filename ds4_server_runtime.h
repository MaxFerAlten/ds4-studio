#ifndef DS4_SERVER_RUNTIME_H
#define DS4_SERVER_RUNTIME_H

#include "ds4.h"
#include "ds4_default_skills.h"
#include "ds4_kvstore.h"
#include "ds4_wrapper.h"

struct http_request {
    const char *method;
    const char *path;
    const char *body;
    size_t body_len;
};

struct http_response {
    int fd;
    bool enable_cors;
};

typedef struct ds4_server_runtime ds4_server_runtime;

typedef struct {
    int default_tokens;
    bool enable_cors;
    bool disable_exact_dsml_tool_replay;
    int tool_memory_max_ids;

    const char *kv_disk_dir;
    uint64_t kv_disk_space_mb;
    bool kv_reject_different_quant;
    ds4_kvstore_options kv_options;
} ds4_server_runtime_options;

int ds4_server_runtime_init(ds4_server_runtime **out,
                            ds4_wrapper *wrapper,
                            const ds4_server_runtime_options *opt);

void ds4_server_runtime_free(ds4_server_runtime *rt);

int ds4_server_runtime_handle_models(ds4_server_runtime *rt,
                                     struct http_request *req,
                                     struct http_response *res);

int ds4_server_runtime_handle_chat_completions(ds4_server_runtime *rt,
                                               struct http_request *req,
                                               struct http_response *res);

int ds4_server_runtime_handle_token_count(ds4_server_runtime *rt,
                                          struct http_request *req,
                                          struct http_response *res);

int ds4_server_runtime_handle_responses(ds4_server_runtime *rt,
                                         struct http_request *req,
                                         struct http_response *res);

int ds4_server_runtime_handle_messages(ds4_server_runtime *rt,
                                        struct http_request *req,
                                        struct http_response *res);

int ds4_server_runtime_handle_completions(ds4_server_runtime *rt,
                                           struct http_request *req,
                                           struct http_response *res);

int ds4_server_runtime_handle_server_metrics(ds4_server_runtime *rt,
                                             struct http_request *req,
                                             struct http_response *res);

void ds4_server_runtime_get_default_skills_status(
    ds4_server_runtime *rt,
    ds4_default_skills_status *out);

#endif
