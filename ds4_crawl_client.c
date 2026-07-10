#include "ds4_crawl_client.h"

#include <ctype.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>

#define DS4_CRAWL_BASE_URL "http://127.0.0.1:9090"

static void crawl_err(char *err, size_t err_len, const char *fmt, ...) {
    va_list ap;
    if (!err || err_len == 0) return;
    va_start(ap, fmt);
    vsnprintf(err, err_len, fmt, ap);
    va_end(ap);
}

static bool valid_token_char(char c) {
    return isalnum((unsigned char)c) || c == '-' || c == '_';
}

int ds4_crawl_client_read_token(char *token, size_t token_len,
                                char *err, size_t err_len) {
    const char *home = getenv("HOME");
    if (!token || token_len == 0) {
        crawl_err(err, err_len, "crawl token buffer is unavailable");
        return 1;
    }
    token[0] = '\0';
    if (!home || !home[0]) {
        crawl_err(err, err_len, "HOME is not set; cannot locate crawl token");
        return 1;
    }

    char path[512];
    int n = snprintf(path, sizeof(path), "%s/.config/ds4-studio/crawl/token", home);
    if (n < 0 || (size_t)n >= sizeof(path)) {
        crawl_err(err, err_len, "crawl token path is too long");
        return 1;
    }

    FILE *f = fopen(path, "r");
    if (!f) {
        crawl_err(err, err_len, "crawl token not found at %s", path);
        return 1;
    }
    if (!fgets(token, (int)token_len, f)) {
        fclose(f);
        crawl_err(err, err_len, "crawl token file is empty");
        return 1;
    }
    fclose(f);

    size_t len = strlen(token);
    while (len > 0 && (token[len - 1] == '\n' || token[len - 1] == '\r'))
        token[--len] = '\0';
    if (len < 43) {
        crawl_err(err, err_len, "crawl token is missing or too short");
        return 1;
    }
    for (size_t i = 0; i < len; i++) {
        if (!valid_token_char(token[i])) {
            crawl_err(err, err_len, "crawl token contains unsafe characters");
            token[0] = '\0';
            return 1;
        }
    }
    return 0;
}

static bool valid_method(const char *method) {
    return method &&
        (!strcmp(method, "GET") || !strcmp(method, "POST") ||
         !strcmp(method, "DELETE"));
}

static bool valid_path(const char *path) {
    if (!path || path[0] != '/') return false;
    for (const char *p = path; *p; p++) {
        unsigned char c = (unsigned char)*p;
        if (isalnum(c) || c == '/' || c == '-' || c == '_' || c == '.')
            continue;
        return false;
    }
    return true;
}

static char *shell_quote(const char *s) {
    size_t len = strlen(s);
    size_t cap = len * 4 + 3;
    char *out = malloc(cap);
    if (!out) return NULL;
    char *w = out;
    *w++ = '\'';
    for (const char *p = s; *p; p++) {
        if (*p == '\'') {
            memcpy(w, "'\\''", 4);
            w += 4;
        } else {
            *w++ = *p;
        }
    }
    *w++ = '\'';
    *w = '\0';
    return out;
}

static int append_json_char(char **cursor, size_t *remaining, unsigned char c) {
    int n;
    if (*remaining == 0) return 1;
    if (c == '"' || c == '\\') {
        if (*remaining < 3) return 1;
        *(*cursor)++ = '\\';
        *(*cursor)++ = (char)c;
        *remaining -= 2;
        return 0;
    }
    if (c == '\n' || c == '\r' || c == '\t') {
        if (*remaining < 3) return 1;
        *(*cursor)++ = '\\';
        *(*cursor)++ = c == '\n' ? 'n' : c == '\r' ? 'r' : 't';
        *remaining -= 2;
        return 0;
    }
    if (c < 0x20) {
        if (*remaining < 7) return 1;
        n = snprintf(*cursor, *remaining, "\\u%04x", c);
        if (n < 0 || (size_t)n >= *remaining) return 1;
        *cursor += n;
        *remaining -= (size_t)n;
        return 0;
    }
    if (*remaining < 2) return 1;
    *(*cursor)++ = (char)c;
    *remaining -= 1;
    return 0;
}

int ds4_crawl_client_build_url_body(const char *url, char *out,
                                    size_t out_len, char *err,
                                    size_t err_len) {
    if (!url || !url[0]) {
        crawl_err(err, err_len, "crawl requires url");
        return 1;
    }
    if (!out || out_len == 0) {
        crawl_err(err, err_len, "crawl request buffer is unavailable");
        return 1;
    }
    char *w = out;
    size_t rem = out_len;
    int n = snprintf(w, rem, "{\"url\":\"");
    if (n < 0 || (size_t)n >= rem) {
        crawl_err(err, err_len, "crawl request too large");
        return 1;
    }
    w += n;
    rem -= (size_t)n;
    for (const unsigned char *p = (const unsigned char *)url; *p; p++) {
        if (append_json_char(&w, &rem, *p) != 0) {
            crawl_err(err, err_len, "crawl request too large");
            return 1;
        }
    }
    n = snprintf(w, rem, "\"}");
    if (n < 0 || (size_t)n >= rem) {
        crawl_err(err, err_len, "crawl request too large");
        return 1;
    }
    return 0;
}

int ds4_crawl_client_request(const char *method, const char *path,
                             const char *body, int timeout_sec,
                             char *out, size_t out_len,
                             char *err, size_t err_len) {
    char token[256];
    char auth_hdr[512] = "";
    char token_err[160] = "";
    char *body_arg = NULL;
    char *cmd = NULL;
    int rc = 1;

    if (!out || out_len == 0) {
        crawl_err(err, err_len, "crawl response buffer is unavailable");
        return 1;
    }
    out[0] = '\0';
    if (!valid_method(method)) {
        crawl_err(err, err_len, "invalid crawl HTTP method");
        return 1;
    }
    if (!valid_path(path)) {
        crawl_err(err, err_len, "invalid crawl HTTP path");
        return 1;
    }
    if (timeout_sec <= 0) timeout_sec = 30;

    if (ds4_crawl_client_read_token(token, sizeof(token),
                                    token_err, sizeof(token_err)) != 0) {
        crawl_err(err, err_len, "%s",
                  token_err[0] ? token_err : "crawl token is unavailable");
        return 1;
    }
    int auth_len = snprintf(auth_hdr, sizeof(auth_hdr),
                            "-H 'Authorization: Bearer %s'", token);
    if (auth_len < 0 || (size_t)auth_len >= sizeof(auth_hdr)) {
        crawl_err(err, err_len, "crawl auth header is too long");
        return 1;
    }

    if (body && body[0]) {
        body_arg = shell_quote(body);
        if (!body_arg) {
            crawl_err(err, err_len, "crawl request allocation failed");
            return 1;
        }
    }

    const char *fmt = body_arg ?
        "curl -s -X %s %s%s -H 'Content-Type: application/json' %s -d %s --max-time %d 2>/dev/null" :
        "curl -s -X %s %s%s %s --max-time %d 2>/dev/null";
    int needed = body_arg ?
        snprintf(NULL, 0, fmt, method, DS4_CRAWL_BASE_URL, path,
                 auth_hdr, body_arg, timeout_sec) :
        snprintf(NULL, 0, fmt, method, DS4_CRAWL_BASE_URL, path,
                 auth_hdr, timeout_sec);
    if (needed < 0) {
        crawl_err(err, err_len, "crawl command formatting failed");
        goto done;
    }
    cmd = malloc((size_t)needed + 1);
    if (!cmd) {
        crawl_err(err, err_len, "crawl command allocation failed");
        goto done;
    }
    if (body_arg) {
        snprintf(cmd, (size_t)needed + 1, fmt, method, DS4_CRAWL_BASE_URL,
                 path, auth_hdr, body_arg, timeout_sec);
    } else {
        snprintf(cmd, (size_t)needed + 1, fmt, method, DS4_CRAWL_BASE_URL,
                 path, auth_hdr, timeout_sec);
    }

    FILE *fp = popen(cmd, "r");
    if (!fp) {
        crawl_err(err, err_len, "crawl service unavailable");
        goto done;
    }

    size_t used = 0;
    char chunk[4096];
    while (fgets(chunk, (int)sizeof(chunk), fp)) {
        size_t len = strlen(chunk);
        if (used + 1 < out_len) {
            size_t room = out_len - used - 1;
            size_t copy = len < room ? len : room;
            memcpy(out + used, chunk, copy);
            used += copy;
            out[used] = '\0';
        }
    }
    int st = pclose(fp);
    if (st != 0 || used == 0) {
        int exit_code = WIFEXITED(st) ? WEXITSTATUS(st) : -1;
        if (token_err[0]) {
            crawl_err(err, err_len, "%s", token_err);
        } else if (exit_code >= 0) {
            crawl_err(err, err_len, "crawl HTTP request failed (curl exit %d)",
                      exit_code);
        } else {
            crawl_err(err, err_len, "crawl HTTP request failed");
        }
        goto done;
    }
    rc = 0;

done:
    free(body_arg);
    free(cmd);
    return rc;
}

int ds4_crawl_client_get(const char *path, char *out, size_t out_len,
                         char *err, size_t err_len) {
    return ds4_crawl_client_request("GET", path, NULL, 30,
                                    out, out_len, err, err_len);
}

int ds4_crawl_client_post(const char *path, const char *body,
                          char *out, size_t out_len,
                          char *err, size_t err_len) {
    return ds4_crawl_client_request("POST", path, body, 120,
                                    out, out_len, err, err_len);
}

int ds4_crawl_client_delete(const char *path, char *out, size_t out_len,
                            char *err, size_t err_len) {
    return ds4_crawl_client_request("DELETE", path, NULL, 30,
                                    out, out_len, err, err_len);
}
