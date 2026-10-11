#include "ds4_openwiki_request.h"

#include <stddef.h>
#include <string.h>

static void ws(const char **p) {
    while (**p == ' ' || **p == '\t' || **p == '\r' || **p == '\n') ++*p;
}

static bool hex4(const char **p) {
    for (int i = 0; i < 4; ++i) {
        char c = *(*p)++;
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
              (c >= 'A' && c <= 'F'))) return false;
    }
    return true;
}

static bool string_value(const char **p, char *plain, size_t cap) {
    if (**p != '"') return false;
    ++*p;
    size_t n = 0;
    bool simple = true;
    while (**p && **p != '"') {
        unsigned char c = (unsigned char)*(*p)++;
        if (c < 0x20) return false;
        if (c == '\\') {
            char e = *(*p)++;
            if (!e) return false;
            /* Keys are deliberately compared without decoding. Reject escaped
             * keys so aliases cannot evade duplicate/security checks. */
            if (plain) return false;
            if (e == 'u') { if (!hex4(p)) return false; }
            else if (!strchr("\"\\/bfnrt", e)) return false;
            simple = false;
        } else if (plain && n + 1 < cap) {
            plain[n++] = (char)c;
        } else if (plain) {
            simple = false;
        }
    }
    if (**p != '"') return false;
    ++*p;
    if (plain) plain[simple ? n : 0] = '\0';
    return true;
}

static bool value(const char **p, unsigned depth);

static bool object(const char **p, unsigned depth) {
    if (depth > 32 || *(*p)++ != '{') return false;
    ws(p);
    if (**p == '}') { ++*p; return true; }
    for (;;) {
        if (!string_value(p, NULL, 0)) return false;
        ws(p);
        if (*(*p)++ != ':') return false;
        ws(p);
        if (!value(p, depth + 1)) return false;
        ws(p);
        if (**p == '}') { ++*p; return true; }
        if (*(*p)++ != ',') return false;
        ws(p);
    }
}

static bool array(const char **p, unsigned depth) {
    if (depth > 32 || *(*p)++ != '[') return false;
    ws(p);
    if (**p == ']') { ++*p; return true; }
    for (;;) {
        if (!value(p, depth + 1)) return false;
        ws(p);
        if (**p == ']') { ++*p; return true; }
        if (*(*p)++ != ',') return false;
        ws(p);
    }
}

static bool number(const char **p) {
    const char *s = *p;
    if (**p == '-') ++*p;
    if (**p == '0') ++*p;
    else {
        if (**p < '1' || **p > '9') return false;
        do { ++*p; } while (**p >= '0' && **p <= '9');
    }
    if (**p == '.') {
        ++*p;
        if (**p < '0' || **p > '9') return false;
        do { ++*p; } while (**p >= '0' && **p <= '9');
    }
    if (**p == 'e' || **p == 'E') {
        ++*p;
        if (**p == '+' || **p == '-') ++*p;
        if (**p < '0' || **p > '9') return false;
        do { ++*p; } while (**p >= '0' && **p <= '9');
    }
    return *p != &s[0];
}

static bool value(const char **p, unsigned depth) {
    if (depth > 32) return false;
    ws(p);
    if (**p == '"') return string_value(p, NULL, 0);
    if (**p == '{') return object(p, depth);
    if (**p == '[') return array(p, depth);
    if (**p == 't' && strncmp(*p, "true", 4) == 0) { *p += 4; return true; }
    if (**p == 'f' && strncmp(*p, "false", 5) == 0) { *p += 5; return true; }
    if (**p == 'n' && strncmp(*p, "null", 4) == 0) { *p += 4; return true; }
    return number(p);
}

static bool request_flag(const char **p, bool *enabled) {
    if (**p != '{') return false;
    ++*p;
    ws(p);
    if (**p == '}') { ++*p; return true; }
    bool seen = false;
    for (;;) {
        char key[32] = {0};
        if (!string_value(p, key, sizeof(key))) return false;
        ws(p);
        if (*(*p)++ != ':') return false;
        ws(p);
        if (strcmp(key, "openwiki_enabled") == 0) {
            if (seen) return false;
            seen = true;
            if (strncmp(*p, "true", 4) == 0 &&
                ((*p)[4] == ',' || (*p)[4] == '}' || (*p)[4] == ' ' ||
                 (*p)[4] == '\t' || (*p)[4] == '\r' || (*p)[4] == '\n')) {
                *enabled = true;
                *p += 4;
            } else if (strncmp(*p, "false", 5) == 0 &&
                       ((*p)[5] == ',' || (*p)[5] == '}' || (*p)[5] == ' ' ||
                        (*p)[5] == '\t' || (*p)[5] == '\r' || (*p)[5] == '\n')) {
                *enabled = false;
                *p += 5;
            } else {
                return false;
            }
        } else if (!value(p, 1)) return false;
        ws(p);
        if (**p == '}') { ++*p; return true; }
        if (*(*p)++ != ',') return false;
        ws(p);
    }
}

bool ds4_ow_request_enabled(const char *json) {
    if (!json) return false;
    const char *p = json;
    ws(&p);
    if (*p++ != '{') return false;
    ws(&p);
    bool found = false, enabled = false;
    if (*p == '}') { ++p; ws(&p); return *p == '\0' && false; }
    for (;;) {
        char key[16] = {0};
        if (!string_value(&p, key, sizeof(key))) return false;
        ws(&p);
        if (*p++ != ':') return false;
        ws(&p);
        if (strcmp(key, "request") == 0) {
            if (found) return false;
            found = true;
            if (!request_flag(&p, &enabled)) return false;
        } else if (!value(&p, 1)) return false;
        ws(&p);
        if (*p == '}') { ++p; break; }
        if (*p++ != ',') return false;
        ws(&p);
    }
    ws(&p);
    return *p == '\0' && found && enabled;
}
