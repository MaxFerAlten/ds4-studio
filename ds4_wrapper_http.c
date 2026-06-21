#include "ds4_wrapper_http.h"
#include "ds4_wrapper_metrics.h"
#include "ds4_wrapper_state.h"
#include "ds4_server_runtime.h"
#include "ds4_agent_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <ctype.h>
#include <stdint.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <poll.h>

#define MAX_HEADER (64 * 1024)
#define MAX_BODY (64 * 1024 * 1024)
#define WRAP_JSON_STRING_MAX MAX_BODY

static int server_fd = -1;
static pthread_t accept_thread;
static volatile bool server_running = false;

typedef struct {
    char method[16];
    char path[256];
    char *body;
    size_t body_len;
} wrap_http_request;

static void wrap_http_request_free(wrap_http_request *r) {
    free(r->body);
    memset(r, 0, sizeof(*r));
}

static bool wrap_send_all(int fd, const void *p, size_t n) {
    const char *s = p;
    while (n) {
        ssize_t w = send(fd, s, n, 0);
        if (w < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        if (w == 0) return false;
        s += w;
        n -= (size_t)w;
    }
    return true;
}

static const char *agent_event_name(ds4_agent_event_type type) {
    switch (type) {
    case DS4_AGENT_EVENT_TEXT:        return "agent_text";
    case DS4_AGENT_EVENT_REASONING:  return "agent_reasoning";
    case DS4_AGENT_EVENT_TOOL_CALL:  return "agent_tool_call";
    case DS4_AGENT_EVENT_TOOL_RESULT:return "agent_tool_result";
    case DS4_AGENT_EVENT_STATUS:     return "agent_status";
    case DS4_AGENT_EVENT_USAGE:      return "agent_usage";
    case DS4_AGENT_EVENT_DONE:       return "agent_done";
    case DS4_AGENT_EVENT_ERROR:      return "agent_error";
    default:                         return "agent_text";
    }
}

typedef struct {
    int fd;
    ds4_wrapper *w;
    bool aborted;
} chat_cb_ctx;

static void chat_event_cb(void *ud, const ds4_agent_event *ev) {
    chat_cb_ctx *ctx = (chat_cb_ctx *)ud;
    const char *name = agent_event_name(ev->type);
    char sse[8192];
    int len = snprintf(sse, sizeof(sse), "event: %s\ndata: %s\n\n", name, ev->json_payload);
    if (len > 0) {
        if (!wrap_send_all(ctx->fd, sse, (size_t)len) && !ctx->aborted) {
            /* Client disconnected (browser Stop). Interrupt the worker so the
             * current turn ends and the wrapper releases busy, instead of
             * generating to completion with no consumer. */
            ctx->aborted = true;
            ds4_agent_runtime_interrupt(ctx->w->agent_rt);
        }
    }
}

static char *parse_json_string(const char *json, const char *key) {
    if (!json) return NULL;
    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *p = strstr(json, pattern);
    if (!p) return NULL;
    p = strchr(p + strlen(pattern), ':');
    if (!p) return NULL;
    p++;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p != '"') return NULL;
    p++;
    size_t cap = 256;
    size_t len = 0;
    char *val = malloc(cap);
    if (!val) return NULL;
    while (*p && *p != '"') {
        if (len + 2 >= cap) {
            if (cap >= WRAP_JSON_STRING_MAX + 1) {
                free(val);
                return NULL;
            }
            size_t new_cap = cap > SIZE_MAX / 2 ? WRAP_JSON_STRING_MAX + 1 : cap * 2;
            if (new_cap > WRAP_JSON_STRING_MAX + 1) new_cap = WRAP_JSON_STRING_MAX + 1;
            if (new_cap <= cap) {
                free(val);
                return NULL;
            }
            char *new_val = realloc(val, new_cap);
            if (!new_val) {
                free(val);
                return NULL;
            }
            val = new_val;
            cap = new_cap;
        }
        if (*p == '\\') {
            p++;
            if (*p == 'n') { val[len++] = '\n'; }
            else if (*p == 'r') { val[len++] = '\r'; }
            else if (*p == 't') { val[len++] = '\t'; }
            else if (*p == '"' || *p == '\\' || *p == '/') { val[len++] = *p; }
            else { val[len++] = '\\'; val[len++] = *p; }
        } else {
            val[len++] = *p;
        }
        p++;
    }
    val[len] = '\0';
    return val;
}

static ssize_t find_header_end(const char *p, size_t n) {
    for (size_t i = 3; i < n; i++) {
        if (p[i - 3] == '\r' && p[i - 2] == '\n' && p[i - 1] == '\r' && p[i] == '\n') {
            return (ssize_t)(i + 1);
        }
    }
    for (size_t i = 1; i < n; i++) {
        if (p[i - 1] == '\n' && p[i] == '\n') {
            return (ssize_t)(i + 1);
        }
    }
    return -1;
}

static long get_content_length(const char *h, size_t n) {
    const char *p = h, *end = h + n;
    while (p < end) {
        const char *line = p;
        while (p < end && *p != '\n') p++;
        size_t len = (size_t)(p - line);
        if (len && line[len - 1] == '\r') len--;
        if (len >= 15 && strncasecmp(line, "Content-Length:", 15) == 0) {
            const char *v = line + 15;
            while (v < line + len && isspace((unsigned char)*v)) v++;
            return strtol(v, NULL, 10);
        }
        if (p < end) p++;
    }
    return 0;
}

static bool read_request(int fd, wrap_http_request *r) {
    char *buf = NULL;
    size_t buf_len = 0;
    size_t buf_cap = 4096;
    buf = malloc(buf_cap);
    if (!buf) return false;

    ssize_t hend = -1;
    while (hend < 0 && buf_len < MAX_HEADER) {
        size_t want = MAX_HEADER - buf_len;
        if (want > 1024) want = 1024;
        if (want == 0 || buf_len > SIZE_MAX - want - 1) {
            free(buf);
            return false;
        }
        const size_t need_cap = buf_len + want + 1;
        if (need_cap > buf_cap) {
            size_t new_cap = buf_cap;
            while (new_cap < need_cap) {
                if (new_cap >= MAX_HEADER + 1 || new_cap > SIZE_MAX / 2) {
                    free(buf);
                    return false;
                }
                new_cap *= 2;
                if (new_cap > MAX_HEADER + 1) new_cap = MAX_HEADER + 1;
            }
            char *new_buf = realloc(buf, new_cap);
            if (!new_buf) {
                free(buf);
                return false;
            }
            buf = new_buf;
            buf_cap = new_cap;
        }
        ssize_t n = recv(fd, buf + buf_len, want, 0);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            free(buf);
            return false;
        }
        buf_len += (size_t)n;
        hend = find_header_end(buf, buf_len);
    }

    if (hend < 0) {
        free(buf);
        return false;
    }

    char line[512];
    size_t i = 0;
    while (i < buf_len && buf[i] != '\n' && i + 1 < sizeof(line)) {
        line[i] = buf[i];
        i++;
    }
    line[i] = '\0';
    if (sscanf(line, "%15s %255s", r->method, r->path) != 2) {
        free(buf);
        return false;
    }

    char *q = strchr(r->path, '?');
    if (q) *q = '\0';

    long clen = get_content_length(buf, (size_t)hend);
    if (clen < 0 || (size_t)clen > MAX_BODY) {
        free(buf);
        return false;
    }

    if ((size_t)hend > SIZE_MAX - (size_t)clen - 1) {
        free(buf);
        return false;
    }
    size_t total_needed = (size_t)hend + (size_t)clen;
    if (buf_cap < total_needed + 1) {
        char *new_buf = realloc(buf, total_needed + 1);
        if (!new_buf) {
            free(buf);
            return false;
        }
        buf = new_buf;
    }

    while (buf_len < total_needed) {
        ssize_t n = recv(fd, buf + buf_len, total_needed - buf_len, 0);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            free(buf);
            return false;
        }
        buf_len += (size_t)n;
    }

    r->body_len = (size_t)clen;
    r->body = malloc(r->body_len + 1);
    if (!r->body) {
        free(buf);
        return false;
    }
    memcpy(r->body, buf + hend, r->body_len);
    r->body[r->body_len] = '\0';
    free(buf);
    return true;
}

static bool send_response(int fd, bool enable_cors, int code, const char *type, const char *body) {
    const char *reason = code == 200 ? "OK" :
                         code == 204 ? "No Content" :
                         code == 400 ? "Bad Request" :
                         code == 404 ? "Not Found" :
                         code == 409 ? "Conflict" :
                         code == 500 ? "Internal Server Error" : "Error";
    const size_t body_len = body ? strlen(body) : 0;
    char header[512];
    int hlen = snprintf(header, sizeof(header),
                        "HTTP/1.1 %d %s\r\n"
                        "Content-Length: %zu\r\n",
                        code, reason, body_len);
    if (hlen < 0 || (size_t)hlen >= sizeof(header)) return false;

    if (!wrap_send_all(fd, header, (size_t)hlen)) return false;

    if (type && type[0]) {
        char type_hdr[128];
        int tlen = snprintf(type_hdr, sizeof(type_hdr), "Content-Type: %s\r\n", type);
        if (tlen > 0 && !wrap_send_all(fd, type_hdr, (size_t)tlen)) return false;
    }

    if (enable_cors) {
        const char *cors_hdr = "Access-Control-Allow-Origin: *\r\n"
                               "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
                               "Access-Control-Allow-Headers: Content-Type, Authorization\r\n";
        if (!wrap_send_all(fd, cors_hdr, strlen(cors_hdr))) return false;
    }

    const char *conn_hdr = "Connection: close\r\n\r\n";
    if (!wrap_send_all(fd, conn_hdr, strlen(conn_hdr))) return false;

    if (body_len && !wrap_send_all(fd, body, body_len)) return false;

    return true;
}

static void send_json_error(int fd, bool enable_cors, int code, const char *err_code, const char *msg) {
    char *body = NULL;
    int len = asprintf(&body, "{\"ok\":false,\"error\":\"%s\",\"message\":\"%s\"}\n", err_code, msg);
    if (len >= 0 && body) {
        send_response(fd, enable_cors, code, "application/json", body);
        free(body);
    }
}

static char *wrap_json_escape_dup(const char *s) {
    if (!s) s = "";
    size_t len = strlen(s);
    size_t cap = len * 6 + 1;
    char *out = malloc(cap);
    if (!out) return NULL;
    size_t w = 0;
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c == '"' || c == '\\') {
            out[w++] = '\\';
            out[w++] = (char)c;
        } else if (c == '\n') {
            out[w++] = '\\';
            out[w++] = 'n';
        } else if (c == '\r') {
            out[w++] = '\\';
            out[w++] = 'r';
        } else if (c == '\t') {
            out[w++] = '\\';
            out[w++] = 't';
        } else if (c < 0x20) {
            w += (size_t)snprintf(out + w, cap - w, "\\u%04x", c);
        } else {
            out[w++] = (char)c;
        }
    }
    out[w] = '\0';
    return out;
}

static char *native_agent_result_json(const ds4_agent_command_result *result,
                                      bool active) {
    char *message = wrap_json_escape_dup(result->message);
    if (!message) return NULL;
    const char *data = result->data_json ? result->data_json : "null";
    char *body = NULL;
    if (asprintf(&body,
                 "{\"ok\":%s,\"command\":\"%s\",\"message\":\"%s\","
                 "\"data\":%s,\"active\":%s}\n",
                 result->ok ? "true" : "false",
                 result->command,
                 message,
                 data,
                 active ? "true" : "false") < 0)
        body = NULL;
    free(message);
    return body;
}

static int execute_native_agent_command(ds4_wrapper *w, const char *command,
                                        ds4_agent_command_result *result) {
    char err[256] = {0};
    int code = ds4_wrapper_enter_request(w, DS4_WRAP_MODE_AGENT,
                                         err, sizeof(err));
    if (code != 0) {
        memset(result, 0, sizeof(*result));
        result->http_status = code;
        result->message = strdup(err[0] ? err : "failed to enter agent mode");
        return -1;
    }

    bool request_open = true;
    if (ds4_wrapper_ensure_agent_rt(w, err, sizeof(err)) != 0) {
        memset(result, 0, sizeof(*result));
        result->http_status = 500;
        result->message = strdup(err[0] ? err : "failed to initialize agent runtime");
        ds4_wrapper_leave_request(w);
        return -1;
    }

    int rc = ds4_agent_runtime_command(w->agent_rt, command, result);
    if (rc == 0 && result->switch_to_server) {
        ds4_wrapper_leave_request(w);
        request_open = false;
        code = ds4_wrapper_switch_mode(w, DS4_WRAP_MODE_SERVER,
                                       err, sizeof(err));
        if (code != 0) {
            result->ok = false;
            result->http_status = code;
            result->switch_to_server = false;
            free(result->message);
            result->message = strdup(err[0] ? err :
                                     "failed to switch to server mode");
            rc = -1;
        }
    }
    if (request_open) ds4_wrapper_leave_request(w);
    return rc;
}

static void send_native_agent_command_response(ds4_wrapper *w, int fd,
                                               const char *command) {
    ds4_agent_command_result result = {0};
    execute_native_agent_command(w, command, &result);
    pthread_mutex_lock(&w->mu);
    bool active = w->active_mode == DS4_WRAP_MODE_AGENT;
    pthread_mutex_unlock(&w->mu);
    char *body = native_agent_result_json(&result, active);
    int status = result.http_status ? result.http_status :
                 (result.ok ? 200 : 500);
    if (body) {
        send_response(fd, true, status, "application/json", body);
        free(body);
    } else {
        send_json_error(fd, true, 500, "serialization_error",
                        "failed to serialize native agent command result");
    }
    ds4_agent_command_result_free(&result);
}

static void send_legacy_native_agent_response(ds4_wrapper *w, int fd,
                                              const char *command,
                                              const char *legacy_name) {
    ds4_agent_command_result result = {0};
    execute_native_agent_command(w, command, &result);
    int status = result.http_status ? result.http_status :
                 (result.ok ? 200 : 500);

    if (!result.ok) {
        send_json_error(fd, true, status, "native_agent_error",
                        result.message ? result.message : "command failed");
    } else if (!strcmp(legacy_name, "list")) {
        send_response(fd, true, 200, "application/json",
                      result.data_json ? result.data_json : "[]");
    } else if (!strcmp(legacy_name, "save") && result.data_json) {
        size_t len = strlen(result.data_json);
        char *body = NULL;
        if (len >= 2 && result.data_json[0] == '{' &&
            result.data_json[len - 1] == '}')
        {
            if (asprintf(&body, "{\"ok\":true,%.*s}\n",
                         (int)(len - 2), result.data_json + 1) < 0)
                body = NULL;
        }
        if (body) {
            send_response(fd, true, 200, "application/json", body);
            free(body);
        } else {
            send_response(fd, true, 200, "application/json",
                          "{\"ok\":true}\n");
        }
    } else {
        send_response(fd, true, 200, "application/json",
                      "{\"ok\":true}\n");
    }
    ds4_agent_command_result_free(&result);
}

typedef struct {
    ds4_wrapper *w;
    int fd;
} wrap_client_arg;

static void *client_thread_main(void *arg) {
    wrap_client_arg *ca = arg;
    ds4_wrapper *w = ca->w;
    int fd = ca->fd;
    free(ca);

    struct timeval tv = {.tv_sec = 10, .tv_usec = 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    int one = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));

    wrap_http_request hr;
    memset(&hr, 0, sizeof(hr));

    if (!read_request(fd, &hr)) {
        send_response(fd, true, 400, "text/plain", "Bad Request");
        close(fd);
        return NULL;
    }

    if (!strcmp(hr.method, "OPTIONS")) {
        send_response(fd, true, 204, NULL, NULL);
    } else if (!strcmp(hr.method, "GET") && !strcmp(hr.path, "/api/wrapper/status")) {
        char *status = ds4_wrapper_status_json(w);
        if (status) {
            send_response(fd, true, 200, "application/json", status);
            free(status);
        } else {
            send_response(fd, true, 500, "application/json", "{\"error\":\"failed to generate status\"}");
        }
    } else if (!strcmp(hr.method, "GET") && (!strcmp(hr.path, "/v1/models") || !strncmp(hr.path, "/v1/models/", 11))) {
        char err_buf[256] = {0};
        int code = ds4_wrapper_enter_request(w, DS4_WRAP_MODE_SERVER, err_buf, sizeof(err_buf));
        if (code != 0) {
            send_json_error(fd, true, code, code == 409 ? "conflict" : "error", err_buf);
        } else {
            struct http_request req = { .method = hr.method, .path = hr.path, .body = hr.body, .body_len = hr.body_len };
            struct http_response res = { .fd = fd, .enable_cors = true };
            ds4_server_runtime_handle_models(w->server_rt, &req, &res);
            ds4_wrapper_leave_request(w);
        }
    } else if (!strcmp(hr.method, "GET") && !strcmp(hr.path, "/api/server/metrics")) {
        char err_buf[256] = {0};
        int code = ds4_wrapper_enter_request(w, DS4_WRAP_MODE_SERVER, err_buf, sizeof(err_buf));
        if (code != 0) {
            send_json_error(fd, true, code, code == 409 ? "conflict" : "error", err_buf);
        } else {
            struct http_request req = { .method = hr.method, .path = hr.path, .body = hr.body, .body_len = hr.body_len };
            struct http_response res = { .fd = fd, .enable_cors = true };
            ds4_server_runtime_handle_server_metrics(w->server_rt, &req, &res);
            ds4_wrapper_leave_request(w);
        }
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/api/wrapper/switch-mode")) {
        ds4_wrap_mode target_mode = DS4_WRAP_MODE_SERVER;
        bool has_mode = false;
        if (hr.body) {
            char *p = strstr(hr.body, "\"mode\"");
            if (p) {
                p = strchr(p + 6, ':');
                if (p) {
                    while (*p && (*p == ':' || *p == ' ' || *p == '\t' || *p == '"' || *p == '\'')) p++;
                    if (strncmp(p, "agent", 5) == 0) {
                        target_mode = DS4_WRAP_MODE_AGENT;
                        has_mode = true;
                    } else if (strncmp(p, "server", 6) == 0) {
                        target_mode = DS4_WRAP_MODE_SERVER;
                        has_mode = true;
                    }
                }
            }
        }
        if (!has_mode) {
            send_json_error(fd, true, 400, "bad_request", "Missing or invalid 'mode' in request body");
        } else {
            char err_buf[256] = {0};
            int code = ds4_wrapper_switch_mode(w, target_mode, err_buf, sizeof(err_buf));
            if (code == 0) {
                send_response(fd, true, 200, "application/json", "{\"ok\":true}\n");
            } else {
                send_json_error(fd, true, code, "switch_error", err_buf);
            }
        }
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/api/wrapper/freeze")) {
        pthread_mutex_lock(&w->mu);
        if (w->busy) {
            pthread_mutex_unlock(&w->mu);
            send_json_error(fd, true, 409, "busy", "cannot freeze while a request is running");
        } else if (!w->active_session) {
            pthread_mutex_unlock(&w->mu);
            send_response(fd, true, 200, "application/json", "{\"ok\":true,\"message\":\"no active session\"}\n");
        } else {
            w->state = DS4_WRAP_STATE_SWITCHING;
            pthread_mutex_unlock(&w->mu);

            char err_buf[256] = {0};
            int rc = ds4_wrapper_freeze_active_session(w, err_buf, sizeof(err_buf));

            pthread_mutex_lock(&w->mu);
            if (rc == 0) {
                w->state = DS4_WRAP_STATE_READY;
                pthread_cond_broadcast(&w->cv);
                pthread_mutex_unlock(&w->mu);
                send_response(fd, true, 200, "application/json", "{\"ok\":true}\n");
            } else {
                w->state = DS4_WRAP_STATE_ERROR;
                snprintf(w->last_error, sizeof(w->last_error), "%s", err_buf);
                pthread_cond_broadcast(&w->cv);
                pthread_mutex_unlock(&w->mu);
                send_json_error(fd, true, 500, "freeze_error", err_buf);
            }
        }
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/api/wrapper/thaw")) {
        pthread_mutex_lock(&w->mu);
        if (w->busy) {
            pthread_mutex_unlock(&w->mu);
            send_json_error(fd, true, 409, "busy", "cannot thaw while a request is running");
        } else if (w->active_session != NULL) {
            pthread_mutex_unlock(&w->mu);
            send_response(fd, true, 200, "application/json", "{\"ok\":true,\"message\":\"session already active\"}\n");
        } else {
            ds4_wrap_mode mode = w->active_mode;
            w->state = DS4_WRAP_STATE_SWITCHING;
            pthread_mutex_unlock(&w->mu);

            char err_buf[256] = {0};
            int rc = ds4_wrapper_thaw_session(w, mode, err_buf, sizeof(err_buf));

            pthread_mutex_lock(&w->mu);
            if (rc == 0) {
                w->state = DS4_WRAP_STATE_READY;
                pthread_cond_broadcast(&w->cv);
                pthread_mutex_unlock(&w->mu);
                send_response(fd, true, 200, "application/json", "{\"ok\":true}\n");
            } else {
                w->state = DS4_WRAP_STATE_ERROR;
                snprintf(w->last_error, sizeof(w->last_error), "%s", err_buf);
                pthread_cond_broadcast(&w->cv);
                pthread_mutex_unlock(&w->mu);
                send_json_error(fd, true, 500, "thaw_error", err_buf);
            }
        }
    } else if (!strcmp(hr.method, "POST") && (
               !strcmp(hr.path, "/v1/chat/completions") ||
               !strcmp(hr.path, "/v1/token-count") ||
               !strcmp(hr.path, "/v1/responses") ||
               !strcmp(hr.path, "/v1/messages") ||
               !strcmp(hr.path, "/v1/completions"))) {
        char err_buf[256] = {0};
        int code = ds4_wrapper_enter_request(w, DS4_WRAP_MODE_SERVER, err_buf, sizeof(err_buf));
        if (code != 0) {
            send_json_error(fd, true, code, code == 409 ? "conflict" : "error", err_buf);
        } else {
            struct http_request req = { .method = hr.method, .path = hr.path, .body = hr.body, .body_len = hr.body_len };
            struct http_response res = { .fd = fd, .enable_cors = true };
            if (!strcmp(hr.path, "/v1/chat/completions")) {
                ds4_server_runtime_handle_chat_completions(w->server_rt, &req, &res);
            } else if (!strcmp(hr.path, "/v1/token-count")) {
                ds4_server_runtime_handle_token_count(w->server_rt, &req, &res);
            } else if (!strcmp(hr.path, "/v1/responses")) {
                ds4_server_runtime_handle_responses(w->server_rt, &req, &res);
            } else if (!strcmp(hr.path, "/v1/messages")) {
                ds4_server_runtime_handle_messages(w->server_rt, &req, &res);
            } else if (!strcmp(hr.path, "/v1/completions")) {
                ds4_server_runtime_handle_completions(w->server_rt, &req, &res);
            }
            ds4_wrapper_leave_request(w);
        }
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/api/native-agent/chat")) {
        char err_buf[256] = {0};
        int code = ds4_wrapper_enter_request(w, DS4_WRAP_MODE_AGENT, err_buf, sizeof(err_buf));
        if (code != 0) {
            send_json_error(fd, true, code, code == 409 ? "conflict" : "error", err_buf);
        } else if (ds4_wrapper_ensure_agent_rt(w, err_buf, sizeof(err_buf)) != 0) {
            send_json_error(fd, true, 500, "agent_init_error", err_buf);
            ds4_wrapper_leave_request(w);
        } else {
            char *message = parse_json_string(hr.body, "message");
            if (!message) {
                send_json_error(fd, true, 400, "bad_request", "Missing 'message' in request body");
            } else {
                const char *headers =
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: text/event-stream\r\n"
                    "Cache-Control: no-cache\r\n"
                    "Connection: keep-alive\r\n"
                    "Access-Control-Allow-Origin: *\r\n\r\n";
                wrap_send_all(fd, headers, strlen(headers));
                chat_cb_ctx cbctx = { .fd = fd, .w = w, .aborted = false };
                int chat_rc = ds4_agent_runtime_chat(w->agent_rt, message, chat_event_cb, &cbctx, err_buf, sizeof(err_buf));
                if (chat_rc != 0) {
                    fprintf(stderr, "ds4-wrapper: chat failed: %s\n", err_buf);
                }
                free(message);
            }
            ds4_wrapper_leave_request(w);
        }
    } else if (!strcmp(hr.method, "POST") &&
               !strcmp(hr.path, "/api/native-agent/command")) {
        char *command = parse_json_string(hr.body, "command");
        if (!command) {
            send_json_error(fd, true, 400, "bad_request",
                            "Missing 'command' in request body");
        } else {
            send_native_agent_command_response(w, fd, command);
            free(command);
        }
    } else if (!strcmp(hr.method, "POST") &&
               !strcmp(hr.path, "/api/native-agent/save")) {
        send_legacy_native_agent_response(w, fd, "/save", "save");
    } else if ((!strcmp(hr.method, "GET") || !strcmp(hr.method, "POST")) &&
               !strcmp(hr.path, "/api/native-agent/list")) {
        send_legacy_native_agent_response(w, fd, "/list", "list");
    } else if (!strcmp(hr.method, "POST") &&
               (!strcmp(hr.path, "/api/native-agent/switch") ||
                !strcmp(hr.path, "/api/native-agent/strip"))) {
        char *sha = parse_json_string(hr.body, "sha");
        if (!sha) {
            send_json_error(fd, true, 400, "bad_request",
                            "Missing 'sha' in request body");
        } else {
            const char *name = !strcmp(hr.path, "/api/native-agent/switch") ?
                               "switch" : "strip";
            char *command = NULL;
            if (asprintf(&command, "/%s %s", name, sha) < 0) command = NULL;
            if (command) {
                send_legacy_native_agent_response(w, fd, command, name);
                free(command);
            } else {
                send_json_error(fd, true, 500, "allocation_error",
                                "Failed to build native agent command");
            }
            free(sha);
        }
    } else if (!strcmp(hr.method, "POST") &&
               !strcmp(hr.path, "/api/native-agent/new")) {
        send_legacy_native_agent_response(w, fd, "/new", "new");
    } else if (!strcmp(hr.method, "POST") &&
               !strcmp(hr.path, "/api/native-agent/compact")) {
        send_legacy_native_agent_response(w, fd, "/compact", "compact");
    } else {
        send_json_error(fd, true, 404, "not_found", "Endpoint not found");
    }

    wrap_http_request_free(&hr);
    close(fd);
    return NULL;
}

static void *accept_thread_main(void *arg) {
    ds4_wrapper *w = arg;
    while (server_running) {
        struct sockaddr_in addr;
        socklen_t len = sizeof(addr);
        int fd = accept(server_fd, (struct sockaddr *)&addr, &len);
        if (fd < 0) {
            if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) continue;
            if (!server_running) break;
            perror("ds4-wrapper http accept");
            sleep(1);
            continue;
        }

        wrap_client_arg *ca = malloc(sizeof(*ca));
        if (!ca) {
            close(fd);
            continue;
        }
        ca->w = w;
        ca->fd = fd;

        pthread_t tid;
        pthread_attr_t attr;
        pthread_attr_init(&attr);
        pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
        if (pthread_create(&tid, &attr, client_thread_main, ca) != 0) {
            close(fd);
            free(ca);
        }
        pthread_attr_destroy(&attr);
    }
    return NULL;
}

int ds4_wrapper_http_start(ds4_wrapper *w, const ds4_wrapper_config *cfg) {
    server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        perror("ds4-wrapper socket creation failed");
        return -1;
    }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(cfg->port);
    if (inet_pton(AF_INET, cfg->host, &addr.sin_addr) <= 0) {
        fprintf(stderr, "ds4-wrapper: invalid host address: %s\n", cfg->host);
        close(server_fd);
        server_fd = -1;
        return -1;
    }

    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("ds4-wrapper bind failed");
        close(server_fd);
        server_fd = -1;
        return -1;
    }

    if (listen(server_fd, 1024) < 0) {
        perror("ds4-wrapper listen failed");
        close(server_fd);
        server_fd = -1;
        return -1;
    }

    server_running = true;
    if (pthread_create(&accept_thread, NULL, accept_thread_main, w) != 0) {
        fprintf(stderr, "ds4-wrapper: failed to create accept thread\n");
        server_running = false;
        close(server_fd);
        server_fd = -1;
        return -1;
    }

    fprintf(stderr, "ds4-wrapper: HTTP server listening on %s:%d\n", cfg->host, cfg->port);
    return 0;
}

void ds4_wrapper_http_stop(ds4_wrapper *w) {
    (void)w;
    if (!server_running) return;
    server_running = false;
    if (server_fd != -1) {
        /* shutdown to wake up accept */
        shutdown(server_fd, SHUT_RDWR);
        close(server_fd);
        server_fd = -1;
    }
    pthread_join(accept_thread, NULL);
}
