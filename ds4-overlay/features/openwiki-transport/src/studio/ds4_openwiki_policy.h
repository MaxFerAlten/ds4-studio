#ifndef DS4_OPENWIKI_POLICY_H
#define DS4_OPENWIKI_POLICY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define DS4_OW_SOCKET_PATH_CAP 4096
#define DS4_OW_WORKSPACE_CAP 65
#define DS4_OW_REQUEST_CAP (8u * 1024u)
#define DS4_OW_RESPONSE_CAP (16u * 1024u)

typedef enum {
    DS4_OW_OFF = 0,
    DS4_OW_SHADOW = 1,
    DS4_OW_ON = 2
} ds4_ow_mode;

typedef enum {
    DS4_OW_OK = 0,
    DS4_OW_DISABLED,
    DS4_OW_BAD_ARG,
    DS4_OW_ACCESS_DENIED,
    DS4_OW_TIMEOUT,
    DS4_OW_CANCELLED,
    DS4_OW_UPSTREAM_DOWN,
    DS4_OW_PROTOCOL_ERROR,
    DS4_OW_OVERSIZE,
    DS4_OW_NO_MEMORY
} ds4_ow_result;

typedef struct {
    ds4_ow_mode mode;
    char socket_path[DS4_OW_SOCKET_PATH_CAP];
    char workspace_id[DS4_OW_WORKSPACE_CAP];
    uint32_t search_timeout_ms;
    uint32_t read_timeout_ms;
    uint32_t max_request_bytes;
    uint32_t max_response_bytes;
    uint32_t max_search_token_count;
    uint32_t max_read_token_count;
    uint64_t tool_schema_fingerprint;
    uid_t expected_peer_uid;
} ds4_ow_config;

typedef bool (*ds4_ow_cancel_fn)(void *userdata);

/* OFF and SHADOW need no gateway. ON requires a normalized trusted UDS path. */
bool ds4_ow_config_from_env(ds4_ow_config *dst, char *err, size_t err_len);
bool ds4_ow_socket_is_trusted(const char *path, uid_t expected_uid);
const char *ds4_ow_result_name(ds4_ow_result code);

#endif
