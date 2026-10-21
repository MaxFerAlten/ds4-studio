#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "ds4_openwiki_policy.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

static void set_error(char *err, size_t cap, const char *message) {
    if (err && cap) snprintf(err, cap, "%s", message);
}

static bool safe_id(const char *s, size_t cap) {
    size_t i, n;
    if (!s || !(n = strlen(s)) || n >= cap || n > 64) return false;
    if (!((*s >= 'a' && *s <= 'z') || (*s >= '0' && *s <= '9'))) return false;
    for (i = 1; i < n; ++i) {
        unsigned char c = (unsigned char)s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
    }
    return true;
}

static bool normalized_absolute_path(const char *path) {
    const char *p;
    if (!path || path[0] != '/' || !path[1] || strstr(path, "//") || strchr(path, '\\') ||
        strchr(path, '\r') || strchr(path, '\n')) return false;
    for (p = path + 1; *p;) {
        const char *start = p;
        while (*p && *p != '/') ++p;
        if ((p - start == 1 && start[0] == '.') || (p - start == 2 && start[0] == '.' && start[1] == '.')) return false;
        if (*p == '/') ++p;
    }
    return true;
}

static bool parent_is_private(const char *path, uid_t uid) {
    char parent[DS4_OW_SOCKET_PATH_CAP];
    char *slash;
    struct stat st;
    size_t n = strlen(path);
    if (n >= sizeof(parent)) return false;
    memcpy(parent, path, n + 1);
    slash = strrchr(parent, '/');
    if (!slash) return false;
    if (slash == parent) slash[1] = '\0';
    else *slash = '\0';
    if (lstat(parent, &st) || !S_ISDIR(st.st_mode) || S_ISLNK(st.st_mode) || st.st_uid != uid || (st.st_mode & 0077)) return false;
    return true;
}

static bool path_has_no_symlink_components(const char *path) {
    char prefix[DS4_OW_SOCKET_PATH_CAP];
    size_t i, n = strlen(path);
    if (n >= sizeof(prefix)) return false;
    memcpy(prefix, path, n + 1);
    for (i = 1; i < n; ++i) {
        struct stat st;
        if (prefix[i] != '/') continue;
        prefix[i] = '\0';
        if (lstat(prefix, &st) || S_ISLNK(st.st_mode) || !S_ISDIR(st.st_mode)) return false;
        prefix[i] = '/';
    }
    return true;
}

bool ds4_ow_socket_is_trusted(const char *path, uid_t expected_uid) {
    struct stat st;
    struct sockaddr_un addr;
    if (!normalized_absolute_path(path) || strlen(path) >= sizeof(addr.sun_path) ||
        !path_has_no_symlink_components(path) || !parent_is_private(path, expected_uid)) return false;
    if (lstat(path, &st) || !S_ISSOCK(st.st_mode) || S_ISLNK(st.st_mode) || st.st_uid != expected_uid || (st.st_mode & 0777) != 0600) return false;
    return true;
}

static bool parse_timeout(const char *name, uint32_t fallback, uint32_t max, uint32_t *out) {
    const char *s = getenv(name);
    char *end = NULL;
    unsigned long value;
    if (!s || !*s) { *out = fallback; return true; }
    if (*s == '-' || *s == '+') return false;
    errno = 0;
    value = strtoul(s, &end, 10);
    if (errno || !end || *end || value < 1 || value > max) return false;
    *out = (uint32_t)value;
    return true;
}

bool ds4_ow_config_from_env(ds4_ow_config *dst, char *err, size_t err_len) {
    const char *mode, *socket_path, *workspace;
    ds4_ow_config cfg;
    if (!dst) { set_error(err, err_len, "invalid config target"); return false; }
    memset(&cfg, 0, sizeof(cfg));
    cfg.mode = DS4_OW_OFF;
    cfg.search_timeout_ms = 2000;
    cfg.read_timeout_ms = 3000;
    cfg.max_request_bytes = DS4_OW_REQUEST_CAP;
    cfg.max_response_bytes = DS4_OW_RESPONSE_CAP;
    cfg.max_search_token_count = 4096;
    cfg.max_read_token_count = 12288;
    cfg.expected_peer_uid = geteuid();
    mode = getenv("DS4_OPENWIKI_MODE");
    if (mode && *mode) {
        if (!strcmp(mode, "off")) cfg.mode = DS4_OW_OFF;
        else if (!strcmp(mode, "shadow")) cfg.mode = DS4_OW_SHADOW;
        else if (!strcmp(mode, "on")) cfg.mode = DS4_OW_ON;
        else { set_error(err, err_len, "invalid OpenWiki mode"); return false; }
    }
    if (!parse_timeout("DS4_OPENWIKI_SEARCH_TIMEOUT_MS", 2000, 2000, &cfg.search_timeout_ms) ||
        !parse_timeout("DS4_OPENWIKI_READ_TIMEOUT_MS", 3000, 3000, &cfg.read_timeout_ms)) {
        set_error(err, err_len, "invalid OpenWiki timeout"); return false;
    }
    if (cfg.mode == DS4_OW_ON) {
        socket_path = getenv("DS4_OPENWIKI_SOCKET");
        workspace = getenv("DS4_OPENWIKI_WORKSPACE");
        if (!normalized_absolute_path(socket_path) || strlen(socket_path) >= sizeof(cfg.socket_path) ||
            strlen(socket_path) >= sizeof(((struct sockaddr_un *)0)->sun_path)) {
            set_error(err, err_len, "invalid OpenWiki socket path"); return false;
        }
        if (!safe_id(workspace, sizeof(cfg.workspace_id))) { set_error(err, err_len, "invalid OpenWiki workspace"); return false; }
        if (!ds4_ow_socket_is_trusted(socket_path, cfg.expected_peer_uid)) { set_error(err, err_len, "untrusted OpenWiki socket"); return false; }
        memcpy(cfg.socket_path, socket_path, strlen(socket_path) + 1);
        memcpy(cfg.workspace_id, workspace, strlen(workspace) + 1);
    }
    *dst = cfg;
    set_error(err, err_len, "");
    return true;
}

const char *ds4_ow_result_name(ds4_ow_result code) {
    static const char *const names[] = {"ok", "disabled", "bad_argument", "access_denied", "timeout", "cancelled", "unavailable", "protocol_error", "oversize", "no_memory"};
    return (unsigned)code < sizeof(names) / sizeof(names[0]) ? names[code] : "unknown";
}
