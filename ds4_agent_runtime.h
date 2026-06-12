#ifndef DS4_AGENT_RUNTIME_H
#define DS4_AGENT_RUNTIME_H

#include "ds4_wrapper.h"

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    DS4_AGENT_EVENT_TEXT,
    DS4_AGENT_EVENT_REASONING,
    DS4_AGENT_EVENT_TOOL_CALL,
    DS4_AGENT_EVENT_TOOL_RESULT,
    DS4_AGENT_EVENT_STATUS,
    DS4_AGENT_EVENT_USAGE,
    DS4_AGENT_EVENT_DONE,
    DS4_AGENT_EVENT_ERROR
} ds4_agent_event_type;

typedef struct {
    ds4_agent_event_type type;
    const char *json_payload;
} ds4_agent_event;

typedef void (*ds4_agent_event_cb)(void *ud, const ds4_agent_event *ev);

typedef struct ds4_agent_runtime ds4_agent_runtime;

typedef struct {
    const char *system_prompt;
    int max_iterations;
    int n_predict;
    float temperature;
    float top_p;
    float min_p;
    uint64_t seed;
    bool nothink;
    bool allow_browser;  /* allow the agent to open a visible Chrome browser */
} ds4_agent_runtime_options;

typedef struct {
    bool ok;
    int http_status;
    bool switch_to_server;
    char command[16];
    char *message;
    char *data_json;
} ds4_agent_command_result;

int ds4_agent_runtime_init(ds4_agent_runtime **out,
                           ds4_wrapper *wrapper,
                           const ds4_agent_runtime_options *opt);

void ds4_agent_runtime_free(ds4_agent_runtime *rt);

int ds4_agent_runtime_chat(ds4_agent_runtime *rt,
                           const char *user_text,
                           ds4_agent_event_cb cb,
                           void *ud,
                           char *err,
                           size_t err_len);

/* Interrupt the in-flight chat turn (e.g. on client disconnect / Stop).  Soft
 * interrupt: the worker ends the current turn and returns to idle so the next
 * request can run.  Safe to call from the publish callback (worker thread). */
void ds4_agent_runtime_interrupt(ds4_agent_runtime *rt);

int ds4_agent_runtime_save(ds4_agent_runtime *rt, char *sha_out, size_t sha_len);
int ds4_agent_runtime_list(ds4_agent_runtime *rt, char **json_out);
int ds4_agent_runtime_switch(ds4_agent_runtime *rt, const char *sha, char *err, size_t err_len);
int ds4_agent_runtime_strip(ds4_agent_runtime *rt, const char *sha, char *err, size_t err_len);
int ds4_agent_runtime_new(ds4_agent_runtime *rt, char *err, size_t err_len);
int ds4_agent_runtime_compact(ds4_agent_runtime *rt, char *err, size_t err_len);

int ds4_agent_runtime_command(ds4_agent_runtime *rt, const char *command,
                              ds4_agent_command_result *result);
void ds4_agent_command_result_free(ds4_agent_command_result *result);

#endif
