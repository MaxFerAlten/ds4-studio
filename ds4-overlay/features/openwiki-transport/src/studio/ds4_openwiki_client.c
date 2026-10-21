#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "ds4_openwiki_client.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#define OW_HEADER_CAP (16u * 1024u)
#define OW_POLL_SLICE_MS 100

static _Atomic uint64_t request_counter = 1;

static void set_error(char *err, size_t cap, const char *message) {
    if (err && cap) snprintf(err, cap, "%s", message);
}

static bool is_cancelled(ds4_ow_cancel_fn cancel, void *ud) { return cancel && cancel(ud); }

static int64_t monotonic_ms(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts)) return -1;
    return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static ds4_ow_result wait_fd(int fd, short events, int64_t deadline,
                             ds4_ow_cancel_fn cancel, void *ud) {
    struct pollfd pfd = { .fd = fd, .events = events, .revents = 0 };
    for (;;) {
        int64_t now, remain;
        int timeout, rc;
        if (is_cancelled(cancel, ud)) return DS4_OW_CANCELLED;
        now = monotonic_ms();
        if (now < 0) return DS4_OW_UPSTREAM_DOWN;
        remain = deadline - now;
        if (remain <= 0) return DS4_OW_TIMEOUT;
        timeout = remain < OW_POLL_SLICE_MS ? (int)remain : OW_POLL_SLICE_MS;
        rc = poll(&pfd, 1, timeout);
        if (rc > 0) {
            if (pfd.revents & events) return DS4_OW_OK;
            if (pfd.revents & (POLLERR | POLLHUP | POLLNVAL)) return DS4_OW_UPSTREAM_DOWN;
        } else if (rc < 0 && errno != EINTR) return DS4_OW_UPSTREAM_DOWN;
    }
}

static bool valid_utf8(const unsigned char *s, size_t n, size_t *codepoints, bool reject_c1) {
    size_t i = 0, count = 0;
    while (i < n) {
        unsigned char c = s[i++];
        uint32_t cp;
        size_t more;
        if (c == 0) return false;
        if (c < 0x80) { cp = c; more = 0; }
        else if (c >= 0xC2 && c <= 0xDF) { cp = c & 0x1F; more = 1; }
        else if (c >= 0xE0 && c <= 0xEF) { cp = c & 0x0F; more = 2; }
        else if (c >= 0xF0 && c <= 0xF4) { cp = c & 0x07; more = 3; }
        else return false;
        if (i + more > n) return false;
        while (more--) {
            unsigned char t = s[i++];
            if ((t & 0xC0) != 0x80) return false;
            cp = (cp << 6) | (t & 0x3F);
        }
        if ((cp >= 0xD800 && cp <= 0xDFFF) || cp > 0x10FFFF ||
            (cp < 0x80 && c >= 0xC0) || (cp < 0x800 && c >= 0xE0) ||
            (cp < 0x10000 && c >= 0xF0) || (reject_c1 && cp >= 0x80 && cp <= 0x9F)) return false;
        ++count;
    }
    if (codepoints) *codepoints = count;
    return true;
}

static bool valid_text(const char *s, size_t max_bytes, size_t max_points, bool path) {
    size_t n, points, i;
    if (!s || !(n = strlen(s)) || n > max_bytes || !valid_utf8((const unsigned char *)s, n, &points, true) || points > max_points) return false;
    for (i = 0; i < n; ++i) {
        unsigned char c = (unsigned char)s[i];
        if (c < 0x20 || c == 0x7f) return false;
    }
    if (path) {
        const char *part;
        if (s[0] == '/' || s[0] == '~' ||
            (((s[0] >= 'A' && s[0] <= 'Z') || (s[0] >= 'a' && s[0] <= 'z')) && s[1] == ':') ||
            strchr(s, '\\') || strchr(s, '#') || strchr(s, ':')) return false;
        for (part = s; *part;) {
            const char *end = strchr(part, '/');
            size_t len = end ? (size_t)(end - part) : strlen(part);
            if (!len || (len == 1 && part[0] == '.') || (len == 2 && part[0] == '.' && part[1] == '.')) return false;
            if (!end) break;
            part = end + 1;
        }
    }
    return true;
}

static bool append(char *dst, size_t cap, size_t *used, const char *src, size_t n) {
    if (n > cap - *used) return false;
    memcpy(dst + *used, src, n);
    *used += n;
    return true;
}

#define APPEND_LITERAL(dst, cap, used, literal) append((dst), (cap), (used), (literal), sizeof(literal) - 1)

static bool append_json_string(char *dst, size_t cap, size_t *used, const char *s) {
    const unsigned char *p = (const unsigned char *)s;
    if (!append(dst, cap, used, "\"", 1)) return false;
    while (*p) {
        char esc[7];
        size_t n = 1;
        const char *q = (const char *)p;
        if (*p == '"' || *p == '\\') { esc[0] = '\\'; esc[1] = (char)*p; q = esc; n = 2; }
        if (!append(dst, cap, used, q, n)) return false;
        ++p;
    }
    return append(dst, cap, used, "\"", 1);
}

static bool build_search_json(const ds4_ow_config *cfg, const char *query,
                              const char *const *paths, size_t paths_len, unsigned limit,
                              char *dst, size_t cap, size_t *used) {
    size_t i;
    if (paths_len > 8 || (paths_len && !paths) || limit < 1 || limit > 5 ||
        !valid_text(query, 8192, 1200, false) || !valid_text(cfg->workspace_id, 64, 64, false)) return false;
    *used = 0;
    if (!APPEND_LITERAL(dst, cap, used, "{\"protocol\":\"ds4-openwiki.v1\",\"workspaceId\":") ||
        !append_json_string(dst, cap, used, cfg->workspace_id) ||
        !APPEND_LITERAL(dst, cap, used, ",\"requestId\":\"c-")) return false;
    {
        char id[64];
        uint64_t serial = atomic_fetch_add(&request_counter, 1);
        int n = snprintf(id, sizeof(id), "%ld-%llu", (long)getpid(), (unsigned long long)serial);
        if (n < 0 || (size_t)n >= sizeof(id) || !append(dst, cap, used, id, (size_t)n)) return false;
    }
    if (!APPEND_LITERAL(dst, cap, used, "\",\"query\":") || !append_json_string(dst, cap, used, query)) return false;
    if (paths_len) {
        if (!APPEND_LITERAL(dst, cap, used, ",\"paths\":[")) return false;
        for (i = 0; i < paths_len; ++i) {
            if (!valid_text(paths[i], 250, 250, true) || (i && !append(dst, cap, used, ",", 1)) || !append_json_string(dst, cap, used, paths[i])) return false;
        }
        if (!append(dst, cap, used, "]", 1)) return false;
    }
    {
        char n[24];
        int len = snprintf(n, sizeof(n), ",\"limit\":%u}", limit);
        return len > 0 && (size_t)len < sizeof(n) && append(dst, cap, used, n, (size_t)len);
    }
}

static bool build_read_json(const ds4_ow_config *cfg, const char *page,
                            const char *const *sections, size_t sections_len,
                            char *dst, size_t cap, size_t *used) {
    size_t i;
    if (!valid_text(page, 250, 250, true) || !valid_text(cfg->workspace_id, 64, 64, false) ||
        !sections || sections_len < 1 || sections_len > 3) return false;
    *used = 0;
    if (!APPEND_LITERAL(dst, cap, used, "{\"protocol\":\"ds4-openwiki.v1\",\"workspaceId\":") ||
        !append_json_string(dst, cap, used, cfg->workspace_id) ||
        !APPEND_LITERAL(dst, cap, used, ",\"requestId\":\"c-")) return false;
    {
        char id[64];
        uint64_t serial = atomic_fetch_add(&request_counter, 1);
        int n = snprintf(id, sizeof(id), "%ld-%llu", (long)getpid(), (unsigned long long)serial);
        if (n < 0 || (size_t)n >= sizeof(id) || !append(dst, cap, used, id, (size_t)n)) return false;
    }
    if (!APPEND_LITERAL(dst, cap, used, "\",\"page\":") || !append_json_string(dst, cap, used, page) ||
        !APPEND_LITERAL(dst, cap, used, ",\"sections\":[")) return false;
    for (i = 0; i < sections_len; ++i) {
        if (!valid_text(sections[i], 800, 200, false) || (i && !append(dst, cap, used, ",", 1)) || !append_json_string(dst, cap, used, sections[i])) return false;
    }
    return append(dst, cap, used, "]}", 2);
}

static bool trusted_peer(int fd, uid_t expected) {
#if defined(__linux__) && defined(SO_PEERCRED)
    struct ucred cred;
    socklen_t len = sizeof(cred);
    return getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) == 0 && cred.uid == expected;
#elif defined(__FreeBSD__) || defined(__APPLE__)
    uid_t uid;
    gid_t gid;
    return getpeereid(fd, &uid, &gid) == 0 && uid == expected;
#else
    (void)fd; (void)expected;
    return false;
#endif
}

static ds4_ow_result connect_socket(const ds4_ow_config *cfg, int64_t deadline,
                                    ds4_ow_cancel_fn cancel, void *ud, int *out_fd) {
    struct sockaddr_un addr;
    int fd, flags, rc, error = 0;
    socklen_t error_len = sizeof(error);
    *out_fd = -1;
    if (!ds4_ow_socket_is_trusted(cfg->socket_path, cfg->expected_peer_uid)) return DS4_OW_ACCESS_DENIED;
    fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return DS4_OW_UPSTREAM_DOWN;
    flags = fcntl(fd, F_GETFL, 0);
    if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) { close(fd); return DS4_OW_UPSTREAM_DOWN; }
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    memcpy(addr.sun_path, cfg->socket_path, strlen(cfg->socket_path) + 1);
    if (is_cancelled(cancel, ud)) { close(fd); return DS4_OW_CANCELLED; }
    rc = connect(fd, (struct sockaddr *)&addr, sizeof(addr));
    if (rc && errno != EINPROGRESS) { close(fd); return DS4_OW_UPSTREAM_DOWN; }
    if (rc) {
        ds4_ow_result r = wait_fd(fd, POLLOUT, deadline, cancel, ud);
        if (r != DS4_OW_OK) { close(fd); return r; }
        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &error_len) || error) { close(fd); return DS4_OW_UPSTREAM_DOWN; }
    }
    if (!trusted_peer(fd, cfg->expected_peer_uid)) { close(fd); return DS4_OW_ACCESS_DENIED; }
    *out_fd = fd;
    return DS4_OW_OK;
}

static ds4_ow_result send_all(int fd, const char *data, size_t len, int64_t deadline,
                              ds4_ow_cancel_fn cancel, void *ud) {
    size_t off = 0;
    while (off < len) {
        ssize_t n;
        ds4_ow_result r;
        if (is_cancelled(cancel, ud)) return DS4_OW_CANCELLED;
        n = send(fd, data + off, len - off, MSG_NOSIGNAL);
        if (n > 0) { off += (size_t)n; continue; }
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            r = wait_fd(fd, POLLOUT, deadline, cancel, ud);
            if (r != DS4_OW_OK) return r;
            continue;
        }
        return DS4_OW_UPSTREAM_DOWN;
    }
    return DS4_OW_OK;
}

static ds4_ow_result recv_exact(int fd, unsigned char *dst, size_t want, size_t *have,
                                int64_t deadline, ds4_ow_cancel_fn cancel, void *ud) {
    while (*have < want) {
        ssize_t n;
        ds4_ow_result r;
        if (is_cancelled(cancel, ud)) return DS4_OW_CANCELLED;
        n = recv(fd, dst + *have, want - *have, 0);
        if (n > 0) { *have += (size_t)n; continue; }
        if (n == 0) return DS4_OW_PROTOCOL_ERROR;
        if (errno == EINTR) continue;
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
            r = wait_fd(fd, POLLIN, deadline, cancel, ud);
            if (r == DS4_OW_UPSTREAM_DOWN) return DS4_OW_PROTOCOL_ERROR;
            if (r != DS4_OW_OK) return r;
            continue;
        }
        return DS4_OW_UPSTREAM_DOWN;
    }
    return DS4_OW_OK;
}

struct response_headers {
    int status;
    size_t content_length;
    char request_id[96];
    bool have_length, have_protocol, have_request_id, have_type, type_plain, chunked;
};

static bool parse_decimal(const char *s, size_t *out) {
    size_t n = 0;
    if (!s || !*s) return false;
    for (; *s; ++s) {
        if (*s < '0' || *s > '9' || n > (SIZE_MAX - 9) / 10) return false;
        n = n * 10 + (size_t)(*s - '0');
    }
    *out = n;
    return true;
}

static bool parse_headers(char *raw, struct response_headers *h) {
    char *line, *next;
    memset(h, 0, sizeof(*h));
    if (strncmp(raw, "HTTP/1.1 ", 9) || !isdigit((unsigned char)raw[9]) || !isdigit((unsigned char)raw[10]) || !isdigit((unsigned char)raw[11]) || raw[12] != ' ') return false;
    h->status = (raw[9] - '0') * 100 + (raw[10] - '0') * 10 + raw[11] - '0';
    line = strstr(raw, "\r\n");
    if (!line) return false;
    line += 2;
    while (*line) {
        char *colon;
        next = strstr(line, "\r\n");
        if (!next) return false;
        if (next == line) break;
        *next = '\0';
        colon = strchr(line, ':');
        if (!colon || colon == line) return false;
        *colon++ = '\0';
        while (*colon == ' ' || *colon == '\t') ++colon;
        for (char *p = line; *p; ++p) *p = (char)tolower((unsigned char)*p);
        if (!strcmp(line, "content-length")) {
            if (h->have_length || !parse_decimal(colon, &h->content_length)) return false;
            h->have_length = true;
        } else if (!strcmp(line, "transfer-encoding")) {
            h->chunked = true;
        } else if (!strcmp(line, "x-ds4-ow-protocol")) {
            if (h->have_protocol || strcmp(colon, "1")) return false;
            h->have_protocol = true;
        } else if (!strcmp(line, "x-ds4-ow-request-id")) {
            size_t n = strlen(colon);
            if (h->have_request_id || !n || n >= sizeof(h->request_id)) return false;
            memcpy(h->request_id, colon, n + 1);
            h->have_request_id = true;
        } else if (!strcmp(line, "content-type")) {
            if (h->have_type || (strcmp(colon, "text/plain; charset=utf-8") && strcmp(colon, "application/json"))) return false;
            h->have_type = true;
            h->type_plain = !strcmp(colon, "text/plain; charset=utf-8");
        }
        line = next + 2;
    }
    return h->have_length && h->have_protocol && h->have_request_id && !h->chunked;
}

static ds4_ow_result exchange(const ds4_ow_config *cfg, const char *route,
                              const char *body, size_t body_len, uint32_t timeout_ms,
                              ds4_ow_cancel_fn cancel, void *ud,
                              char **out, size_t *out_len, char *err, size_t err_len) {
    char req[DS4_OW_REQUEST_CAP + 1024], req_id[96], header[OW_HEADER_CAP + 1];
    size_t req_len, header_len = 0, body_have = 0, response_cap, max_body;
    struct response_headers h;
    int64_t deadline, now;
    int fd = -1;
    ds4_ow_result result;
    int n;
    if (out) *out = NULL;
    if (out_len) *out_len = 0;
    if (!cfg || !out || !out_len || !body || body_len > DS4_OW_REQUEST_CAP || body_len > cfg->max_request_bytes ||
        !timeout_ms || timeout_ms > 3000 || (strcmp(route, "/v1/wiki/search") && strcmp(route, "/v1/wiki/read")) ||
        memchr(body, '\0', body_len)) { set_error(err, err_len, "invalid OpenWiki request"); return DS4_OW_BAD_ARG; }
    if (cfg->mode != DS4_OW_ON) { set_error(err, err_len, "OpenWiki is disabled"); return DS4_OW_DISABLED; }
    now = monotonic_ms();
    if (now < 0) { set_error(err, err_len, "OpenWiki clock unavailable"); return DS4_OW_UPSTREAM_DOWN; }
    deadline = now + timeout_ms;
    {
        const char *marker = "\"requestId\":\"";
        const char *start = strstr(body, marker);
        const char *end;
        size_t id_len;
        if (!start) {
            set_error(err, err_len, "request ID missing"); return DS4_OW_BAD_ARG;
        }
        start += strlen(marker);
        end = strchr(start, '"');
        if (!end || !(id_len = (size_t)(end - start)) || id_len >= sizeof(req_id)) { set_error(err, err_len, "request ID invalid"); return DS4_OW_BAD_ARG; }
        memcpy(req_id, start, id_len);
        req_id[id_len] = '\0';
    }
    n = snprintf(req, sizeof(req), "POST %s HTTP/1.1\r\nHost: ds4-openwiki.local\r\nContent-Type: application/json\r\nAccept: text/plain\r\nX-DS4-OW-Protocol: 1\r\nX-Request-Id: %s\r\nConnection: close\r\nContent-Length: %zu\r\n\r\n", route, req_id, body_len);
    if (n < 0 || (size_t)n >= sizeof(req) || (size_t)n + body_len >= sizeof(req)) { set_error(err, err_len, "request too large"); return DS4_OW_OVERSIZE; }
    req_len = (size_t)n;
    memcpy(req + req_len, body, body_len);
    req_len += body_len;
    result = connect_socket(cfg, deadline, cancel, ud, &fd);
    if (result != DS4_OW_OK) goto done;
    result = send_all(fd, req, req_len, deadline, cancel, ud);
    if (result != DS4_OW_OK) goto done;
    while (header_len < OW_HEADER_CAP) {
        size_t have = header_len;
        result = recv_exact(fd, (unsigned char *)header, header_len + 1, &have, deadline, cancel, ud);
        if (result != DS4_OW_OK) goto done;
        header_len = have;
        if (header_len >= 4 && !memcmp(header + header_len - 4, "\r\n\r\n", 4)) break;
    }
    if (header_len >= OW_HEADER_CAP || header_len < 4) { result = DS4_OW_PROTOCOL_ERROR; goto done; }
    header[header_len - 2] = '\0';
    if (!parse_headers(header, &h) || strcmp(h.request_id, req_id)) { result = DS4_OW_PROTOCOL_ERROR; goto done; }
    if (h.content_length > DS4_OW_RESPONSE_CAP || h.content_length > cfg->max_response_bytes) { result = DS4_OW_OVERSIZE; goto done; }
    if (h.status != 200) {
        if (h.status == 413) result = DS4_OW_OVERSIZE;
        else if (h.status == 403) result = DS4_OW_ACCESS_DENIED;
        else if (h.status == 504) result = DS4_OW_TIMEOUT;
        else if (h.status == 503 || h.status == 429) result = DS4_OW_UPSTREAM_DOWN;
        else if (h.status == 400 || h.status == 404 || h.status == 409) result = DS4_OW_BAD_ARG;
        else result = DS4_OW_PROTOCOL_ERROR;
        set_error(err, err_len, ds4_ow_result_name(result));
        goto done;
    }
    if (!h.have_type || !h.type_plain || h.content_length == 0) { result = DS4_OW_PROTOCOL_ERROR; goto done; }
    response_cap = cfg->max_response_bytes;
    max_body = h.content_length;
    (void)response_cap;
    *out = (char *)malloc(max_body + 1);
    if (!*out) { result = DS4_OW_NO_MEMORY; goto done; }
    result = recv_exact(fd, (unsigned char *)*out, max_body, &body_have, deadline, cancel, ud);
    if (result != DS4_OW_OK) { free(*out); *out = NULL; goto done; }
    if (!valid_utf8((const unsigned char *)*out, max_body, NULL, false)) { free(*out); *out = NULL; result = DS4_OW_PROTOCOL_ERROR; goto done; }
    (*out)[max_body] = '\0';
    *out_len = max_body;
    result = DS4_OW_OK;
done:
    if (fd >= 0) close(fd);
    if (result != DS4_OW_OK) {
        if (out && *out) { free(*out); *out = NULL; }
        if (out_len) *out_len = 0;
        if (err && err_len && !err[0]) set_error(err, err_len, ds4_ow_result_name(result));
    } else set_error(err, err_len, "");
    return result;
}

static ds4_ow_result make_and_exchange(const ds4_ow_config *cfg, bool search,
                                       const char *first, const char *const *items,
                                       size_t items_len, unsigned limit,
                                       ds4_ow_cancel_fn cancel, void *ud,
                                       char **out, size_t *out_len, char *err, size_t err_len) {
    char body[DS4_OW_REQUEST_CAP + 1];
    size_t used = 0;
    ds4_ow_result result;
    if (out) *out = NULL;
    if (out_len) *out_len = 0;
    if (!cfg || !out || !out_len) { set_error(err, err_len, "invalid output pointers"); return DS4_OW_BAD_ARG; }
    if (cfg->mode != DS4_OW_ON) { set_error(err, err_len, "OpenWiki is disabled"); return DS4_OW_DISABLED; }
    if (search) {
        if (!build_search_json(cfg, first, items, items_len, limit, body, sizeof(body) - 1, &used)) {
            set_error(err, err_len, "invalid OpenWiki search arguments"); return DS4_OW_BAD_ARG;
        }
    } else {
        if (!build_read_json(cfg, first, items, items_len, body, sizeof(body) - 1, &used)) {
            set_error(err, err_len, "invalid OpenWiki read arguments"); return DS4_OW_BAD_ARG;
        }
    }
    body[used] = '\0';
    result = exchange(cfg, search ? "/v1/wiki/search" : "/v1/wiki/read", body, used,
                      search ? cfg->search_timeout_ms : cfg->read_timeout_ms,
                      cancel, ud, out, out_len, err, err_len);
    if (result != DS4_OW_OK && err && err_len && !err[0]) set_error(err, err_len, ds4_ow_result_name(result));
    return result;
}

ds4_ow_result ds4_ow_search(const ds4_ow_config *cfg, const char *query,
                            const char *const *paths, size_t paths_len, unsigned limit,
                            ds4_ow_cancel_fn cancel, void *ud, char **out, size_t *out_len,
                            char *err, size_t err_len) {
    return make_and_exchange(cfg, true, query, paths, paths_len, limit, cancel, ud, out, out_len, err, err_len);
}

ds4_ow_result ds4_ow_read(const ds4_ow_config *cfg, const char *page,
                          const char *const *sections, size_t sections_len,
                          ds4_ow_cancel_fn cancel, void *ud, char **out, size_t *out_len,
                          char *err, size_t err_len) {
    return make_and_exchange(cfg, false, page, sections, sections_len, 0, cancel, ud, out, out_len, err, err_len);
}
