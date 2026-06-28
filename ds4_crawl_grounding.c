#include "ds4_crawl_grounding.h"

#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DS4_JSON_MAX_DEPTH 128

typedef struct {
    char *data;
    size_t len;
    size_t cap;
    bool contains_nul;
} ds4_string;

typedef struct {
    const char *start;
    const char *cur;
    const char *end;
    char *err;
    size_t err_len;
    bool failed;
    bool found_content;
    bool truncated;
    ds4_string source;
    size_t max_bytes;
} ds4_json_parser;

static void ds4_set_error(ds4_json_parser *parser, const char *format, ...) {
    va_list ap;
    size_t offset;

    if (parser->failed)
        return;
    parser->failed = true;
    if (parser->err == NULL || parser->err_len == 0)
        return;
    offset = (size_t)(parser->cur - parser->start);
    snprintf(parser->err, parser->err_len, "invalid JSON at byte %zu: ", offset);
    if (strlen(parser->err) >= parser->err_len - 1)
        return;
    va_start(ap, format);
    vsnprintf(parser->err + strlen(parser->err),
              parser->err_len - strlen(parser->err), format, ap);
    va_end(ap);
}

static bool ds4_string_reserve(ds4_json_parser *parser, ds4_string *string,
                               size_t extra) {
    size_t needed;
    size_t capacity;
    char *grown;

    if (extra > SIZE_MAX - string->len - 1) {
        ds4_set_error(parser, "string is too large");
        return false;
    }
    needed = string->len + extra + 1;
    if (needed <= string->cap)
        return true;
    capacity = string->cap == 0 ? 64 : string->cap;
    while (capacity < needed) {
        if (capacity > SIZE_MAX / 2) {
            capacity = needed;
            break;
        }
        capacity *= 2;
    }
    grown = (char *)realloc(string->data, capacity);
    if (grown == NULL) {
        ds4_set_error(parser, "out of memory");
        return false;
    }
    string->data = grown;
    string->cap = capacity;
    return true;
}

static bool ds4_string_append(ds4_json_parser *parser, ds4_string *string,
                              const char *bytes, size_t length) {
    if (!ds4_string_reserve(parser, string, length))
        return false;
    if (length > 0)
        memcpy(string->data + string->len, bytes, length);
    string->len += length;
    string->data[string->len] = '\0';
    return true;
}

static void ds4_skip_space(ds4_json_parser *parser) {
    while (parser->cur < parser->end &&
           (*parser->cur == ' ' || *parser->cur == '\t' ||
            *parser->cur == '\n' || *parser->cur == '\r'))
        parser->cur++;
}

static int ds4_hex_digit(unsigned char byte) {
    if (byte >= '0' && byte <= '9')
        return byte - '0';
    if (byte >= 'a' && byte <= 'f')
        return byte - 'a' + 10;
    if (byte >= 'A' && byte <= 'F')
        return byte - 'A' + 10;
    return -1;
}

static bool ds4_parse_hex4(ds4_json_parser *parser, uint32_t *value) {
    size_t i;
    uint32_t result = 0;

    if ((size_t)(parser->end - parser->cur) < 4) {
        ds4_set_error(parser, "incomplete Unicode escape");
        return false;
    }
    for (i = 0; i < 4; i++) {
        int digit = ds4_hex_digit((unsigned char)parser->cur[i]);
        if (digit < 0) {
            ds4_set_error(parser, "invalid Unicode escape");
            return false;
        }
        result = result * 16 + (uint32_t)digit;
    }
    parser->cur += 4;
    *value = result;
    return true;
}

static size_t ds4_raw_utf8_length(const char *bytes, const char *end) {
    const unsigned char *s = (const unsigned char *)bytes;
    size_t available = (size_t)(end - bytes);

    if (available == 0)
        return 0;
    if (s[0] < 0x80)
        return 1;
    if (s[0] >= 0xc2 && s[0] <= 0xdf) {
        if (available >= 2 && (s[1] & 0xc0) == 0x80)
            return 2;
        return 0;
    }
    if (s[0] >= 0xe0 && s[0] <= 0xef) {
        if (available < 3 || (s[2] & 0xc0) != 0x80)
            return 0;
        if (s[0] == 0xe0 && (s[1] < 0xa0 || s[1] > 0xbf))
            return 0;
        if (s[0] == 0xed && (s[1] < 0x80 || s[1] > 0x9f))
            return 0;
        if (s[0] != 0xe0 && s[0] != 0xed && (s[1] & 0xc0) != 0x80)
            return 0;
        return 3;
    }
    if (s[0] >= 0xf0 && s[0] <= 0xf4) {
        if (available < 4 || (s[2] & 0xc0) != 0x80 ||
            (s[3] & 0xc0) != 0x80)
            return 0;
        if (s[0] == 0xf0 && (s[1] < 0x90 || s[1] > 0xbf))
            return 0;
        if (s[0] == 0xf4 && (s[1] < 0x80 || s[1] > 0x8f))
            return 0;
        if (s[0] != 0xf0 && s[0] != 0xf4 && (s[1] & 0xc0) != 0x80)
            return 0;
        return 4;
    }
    return 0;
}

static bool ds4_append_codepoint(ds4_json_parser *parser, ds4_string *string,
                                 uint32_t codepoint) {
    char encoded[4];
    size_t length;

    if (codepoint == 0) {
        if (string != NULL)
            string->contains_nul = true;
        return true;
    }
    if (codepoint <= 0x7f) {
        encoded[0] = (char)codepoint;
        length = 1;
    } else if (codepoint <= 0x7ff) {
        encoded[0] = (char)(0xc0 | (codepoint >> 6));
        encoded[1] = (char)(0x80 | (codepoint & 0x3f));
        length = 2;
    } else if (codepoint <= 0xffff) {
        encoded[0] = (char)(0xe0 | (codepoint >> 12));
        encoded[1] = (char)(0x80 | ((codepoint >> 6) & 0x3f));
        encoded[2] = (char)(0x80 | (codepoint & 0x3f));
        length = 3;
    } else {
        encoded[0] = (char)(0xf0 | (codepoint >> 18));
        encoded[1] = (char)(0x80 | ((codepoint >> 12) & 0x3f));
        encoded[2] = (char)(0x80 | ((codepoint >> 6) & 0x3f));
        encoded[3] = (char)(0x80 | (codepoint & 0x3f));
        length = 4;
    }
    if (string == NULL)
        return true;
    return ds4_string_append(parser, string, encoded, length);
}

static bool ds4_string_equals(const ds4_string *string, const char *literal) {
    size_t length = strlen(literal);
    return !string->contains_nul && string->len == length &&
           memcmp(string->data, literal, length) == 0;
}

static bool ds4_parse_string(ds4_json_parser *parser, ds4_string *decoded) {
    if (decoded != NULL)
        memset(decoded, 0, sizeof(*decoded));
    if (parser->cur >= parser->end || *parser->cur != '"') {
        ds4_set_error(parser, "expected string");
        return false;
    }
    parser->cur++;
    while (parser->cur < parser->end) {
        unsigned char byte = (unsigned char)*parser->cur++;

        if (byte == '"') {
            if (decoded != NULL && decoded->data == NULL &&
                !ds4_string_append(parser, decoded, "", 0))
                return false;
            return true;
        }
        if (byte < 0x20) {
            ds4_set_error(parser, "unescaped control character in string");
            return false;
        }
        if (byte == '\\') {
            char escaped;
            if (parser->cur >= parser->end) {
                ds4_set_error(parser, "incomplete string escape");
                return false;
            }
            escaped = *parser->cur++;
            switch (escaped) {
            case '"': case '\\': case '/':
                if (decoded != NULL &&
                    !ds4_string_append(parser, decoded, &escaped, 1))
                    return false;
                break;
            case 'b': escaped = '\b'; goto append_escape;
            case 'f': escaped = '\f'; goto append_escape;
            case 'n': escaped = '\n'; goto append_escape;
            case 'r': escaped = '\r'; goto append_escape;
            case 't': escaped = '\t';
append_escape:
                if (decoded != NULL &&
                    !ds4_string_append(parser, decoded, &escaped, 1))
                    return false;
                break;
            case 'u': {
                uint32_t codepoint;
                if (!ds4_parse_hex4(parser, &codepoint))
                    return false;
                if (codepoint >= 0xd800 && codepoint <= 0xdbff) {
                    uint32_t low;
                    if ((size_t)(parser->end - parser->cur) < 6 ||
                        parser->cur[0] != '\\' || parser->cur[1] != 'u') {
                        ds4_set_error(parser, "high surrogate lacks low surrogate");
                        return false;
                    }
                    parser->cur += 2;
                    if (!ds4_parse_hex4(parser, &low))
                        return false;
                    if (low < 0xdc00 || low > 0xdfff) {
                        ds4_set_error(parser, "invalid low surrogate");
                        return false;
                    }
                    codepoint = 0x10000 + ((codepoint - 0xd800) << 10) +
                                (low - 0xdc00);
                } else if (codepoint >= 0xdc00 && codepoint <= 0xdfff) {
                    ds4_set_error(parser, "unexpected low surrogate");
                    return false;
                }
                if (!ds4_append_codepoint(parser, decoded, codepoint))
                    return false;
                break;
            }
            default:
                ds4_set_error(parser, "unknown string escape");
                return false;
            }
        } else if (byte >= 0x80) {
            const char *lead = parser->cur - 1;
            size_t length = ds4_raw_utf8_length(lead, parser->end);
            if (length == 0) {
                ds4_set_error(parser, "invalid UTF-8 in string");
                return false;
            }
            if (decoded != NULL &&
                !ds4_string_append(parser, decoded, lead, length))
                return false;
            parser->cur = lead + length;
        } else if (decoded != NULL &&
                   !ds4_string_append(parser, decoded, (const char *)&byte, 1)) {
            return false;
        }
    }
    ds4_set_error(parser, "unterminated string");
    return false;
}

static bool ds4_parse_value(ds4_json_parser *parser, unsigned depth);

static bool ds4_parse_array(ds4_json_parser *parser, unsigned depth) {
    if (depth > DS4_JSON_MAX_DEPTH) {
        ds4_set_error(parser, "nesting is too deep");
        return false;
    }
    parser->cur++;
    ds4_skip_space(parser);
    if (parser->cur < parser->end && *parser->cur == ']') {
        parser->cur++;
        return true;
    }
    for (;;) {
        if (!ds4_parse_value(parser, depth + 1))
            return false;
        ds4_skip_space(parser);
        if (parser->cur >= parser->end) {
            ds4_set_error(parser, "unterminated array");
            return false;
        }
        if (*parser->cur == ']') {
            parser->cur++;
            return true;
        }
        if (*parser->cur++ != ',') {
            ds4_set_error(parser, "expected ',' or ']' in array");
            return false;
        }
        ds4_skip_space(parser);
    }
}

static bool ds4_parse_object(ds4_json_parser *parser, unsigned depth) {
    if (depth > DS4_JSON_MAX_DEPTH) {
        ds4_set_error(parser, "nesting is too deep");
        return false;
    }
    parser->cur++;
    ds4_skip_space(parser);
    if (parser->cur < parser->end && *parser->cur == '}') {
        parser->cur++;
        return true;
    }
    for (;;) {
        if (!ds4_parse_string(parser, NULL))
            return false;
        ds4_skip_space(parser);
        if (parser->cur >= parser->end || *parser->cur++ != ':') {
            ds4_set_error(parser, "expected ':' after object key");
            return false;
        }
        ds4_skip_space(parser);
        if (!ds4_parse_value(parser, depth + 1))
            return false;
        ds4_skip_space(parser);
        if (parser->cur >= parser->end) {
            ds4_set_error(parser, "unterminated object");
            return false;
        }
        if (*parser->cur == '}') {
            parser->cur++;
            return true;
        }
        if (*parser->cur++ != ',') {
            ds4_set_error(parser, "expected ',' or '}' in object");
            return false;
        }
        ds4_skip_space(parser);
    }
}

static bool ds4_parse_number(ds4_json_parser *parser) {
    if (parser->cur < parser->end && *parser->cur == '-')
        parser->cur++;
    if (parser->cur >= parser->end) {
        ds4_set_error(parser, "incomplete number");
        return false;
    }
    if (*parser->cur == '0') {
        parser->cur++;
    } else if (*parser->cur >= '1' && *parser->cur <= '9') {
        do {
            parser->cur++;
        } while (parser->cur < parser->end &&
                 *parser->cur >= '0' && *parser->cur <= '9');
    } else {
        ds4_set_error(parser, "invalid number");
        return false;
    }
    if (parser->cur < parser->end && *parser->cur == '.') {
        parser->cur++;
        if (parser->cur >= parser->end ||
            *parser->cur < '0' || *parser->cur > '9') {
            ds4_set_error(parser, "invalid number fraction");
            return false;
        }
        while (parser->cur < parser->end &&
               *parser->cur >= '0' && *parser->cur <= '9')
            parser->cur++;
    }
    if (parser->cur < parser->end &&
        (*parser->cur == 'e' || *parser->cur == 'E')) {
        parser->cur++;
        if (parser->cur < parser->end &&
            (*parser->cur == '+' || *parser->cur == '-'))
            parser->cur++;
        if (parser->cur >= parser->end ||
            *parser->cur < '0' || *parser->cur > '9') {
            ds4_set_error(parser, "invalid number exponent");
            return false;
        }
        while (parser->cur < parser->end &&
               *parser->cur >= '0' && *parser->cur <= '9')
            parser->cur++;
    }
    return true;
}

static bool ds4_parse_literal(ds4_json_parser *parser, const char *literal) {
    size_t length = strlen(literal);
    if ((size_t)(parser->end - parser->cur) < length ||
        memcmp(parser->cur, literal, length) != 0) {
        ds4_set_error(parser, "invalid literal");
        return false;
    }
    parser->cur += length;
    return true;
}

static bool ds4_parse_value(ds4_json_parser *parser, unsigned depth) {
    ds4_skip_space(parser);
    if (parser->cur >= parser->end) {
        ds4_set_error(parser, "expected value");
        return false;
    }
    switch (*parser->cur) {
    case '{': return ds4_parse_object(parser, depth);
    case '[': return ds4_parse_array(parser, depth);
    case '"': return ds4_parse_string(parser, NULL);
    case 't': return ds4_parse_literal(parser, "true");
    case 'f': return ds4_parse_literal(parser, "false");
    case 'n': return ds4_parse_literal(parser, "null");
    default:
        if (*parser->cur == '-' ||
            (*parser->cur >= '0' && *parser->cur <= '9'))
            return ds4_parse_number(parser);
        ds4_set_error(parser, "unexpected value");
        return false;
    }
}

static bool ds4_has_nonspace(const char *text) {
    const unsigned char *byte = (const unsigned char *)text;
    while (*byte) {
        if (*byte != ' ' && *byte != '\t' && *byte != '\n' &&
            *byte != '\r' && *byte != '\f' && *byte != '\v')
            return true;
        byte++;
    }
    return false;
}

static size_t ds4_valid_codepoint_length(const char *text, size_t remaining) {
    unsigned char lead = (unsigned char)*text;
    size_t length;

    if (lead < 0x80)
        length = 1;
    else if (lead < 0xe0)
        length = 2;
    else if (lead < 0xf0)
        length = 3;
    else
        length = 4;
    return length <= remaining ? length : 0;
}

static bool ds4_append_page(ds4_json_parser *parser, const ds4_string *content) {
    static const char separator[] = "\n\n--- PAGE BREAK ---\n\n";
    size_t offset = 0;

    if (parser->truncated)
        return true;
    if (parser->source.len > 0) {
        size_t first = ds4_valid_codepoint_length(content->data, content->len);
        size_t needed = sizeof(separator) - 1 + first;
        if (needed > parser->max_bytes - parser->source.len) {
            parser->truncated = true;
            return true;
        }
        if (!ds4_string_append(parser, &parser->source,
                               separator, sizeof(separator) - 1))
            return false;
    }
    while (offset < content->len) {
        size_t length = ds4_valid_codepoint_length(content->data + offset,
                                                   content->len - offset);
        if (length == 0 || length > parser->max_bytes - parser->source.len) {
            parser->truncated = true;
            return true;
        }
        if (!ds4_string_append(parser, &parser->source,
                               content->data + offset, length))
            return false;
        offset += length;
    }
    return true;
}

static bool ds4_parse_page(ds4_json_parser *parser, unsigned depth) {
    ds4_string state = {0};
    ds4_string content = {0};
    bool ok = false;

    parser->cur++;
    ds4_skip_space(parser);
    if (parser->cur < parser->end && *parser->cur == '}') {
        parser->cur++;
        ok = true;
        goto done;
    }
    for (;;) {
        ds4_string key = {0};
        if (!ds4_parse_string(parser, &key)) {
            free(key.data);
            goto done;
        }
        ds4_skip_space(parser);
        if (parser->cur >= parser->end || *parser->cur++ != ':') {
            free(key.data);
            ds4_set_error(parser, "expected ':' after page key");
            goto done;
        }
        ds4_skip_space(parser);
        if (ds4_string_equals(&key, "state") &&
            parser->cur < parser->end && *parser->cur == '"') {
            ds4_string replacement;
            if (!ds4_parse_string(parser, &replacement)) {
                free(key.data);
                free(replacement.data);
                goto done;
            }
            free(state.data);
            state = replacement;
        } else if (ds4_string_equals(&key, "content") &&
                   parser->cur < parser->end && *parser->cur == '"') {
            ds4_string replacement;
            if (!ds4_parse_string(parser, &replacement)) {
                free(key.data);
                free(replacement.data);
                goto done;
            }
            free(content.data);
            content = replacement;
        } else if (!ds4_parse_value(parser, depth + 1)) {
            free(key.data);
            goto done;
        }
        free(key.data);
        ds4_skip_space(parser);
        if (parser->cur >= parser->end) {
            ds4_set_error(parser, "unterminated page object");
            goto done;
        }
        if (*parser->cur == '}') {
            parser->cur++;
            ok = true;
            break;
        }
        if (*parser->cur++ != ',') {
            ds4_set_error(parser, "expected ',' or '}' in page object");
            goto done;
        }
        ds4_skip_space(parser);
    }
done:
    if (ok && state.data != NULL && content.data != NULL &&
        ds4_string_equals(&state, "succeeded")) {
        if (content.contains_nul) {
            ds4_set_error(parser,
                          "NUL is not supported in succeeded page content");
            ok = false;
        } else if (ds4_has_nonspace(content.data)) {
            parser->found_content = true;
            ok = ds4_append_page(parser, &content);
        }
    }
    free(state.data);
    free(content.data);
    return ok;
}

static bool ds4_parse_pages(ds4_json_parser *parser, unsigned depth) {
    parser->cur++;
    ds4_skip_space(parser);
    if (parser->cur < parser->end && *parser->cur == ']') {
        parser->cur++;
        return true;
    }
    for (;;) {
        if (parser->cur < parser->end && *parser->cur == '{') {
            if (!ds4_parse_page(parser, depth + 1))
                return false;
        } else if (!ds4_parse_value(parser, depth + 1)) {
            return false;
        }
        ds4_skip_space(parser);
        if (parser->cur >= parser->end) {
            ds4_set_error(parser, "unterminated pages array");
            return false;
        }
        if (*parser->cur == ']') {
            parser->cur++;
            return true;
        }
        if (*parser->cur++ != ',') {
            ds4_set_error(parser, "expected ',' or ']' in pages array");
            return false;
        }
        ds4_skip_space(parser);
    }
}

static bool ds4_parse_root_object(ds4_json_parser *parser) {
    parser->cur++;
    ds4_skip_space(parser);
    if (parser->cur < parser->end && *parser->cur == '}') {
        parser->cur++;
        return true;
    }
    for (;;) {
        ds4_string key = {0};
        if (!ds4_parse_string(parser, &key)) {
            free(key.data);
            return false;
        }
        ds4_skip_space(parser);
        if (parser->cur >= parser->end || *parser->cur++ != ':') {
            free(key.data);
            ds4_set_error(parser, "expected ':' after root key");
            return false;
        }
        ds4_skip_space(parser);
        if (ds4_string_equals(&key, "pages") &&
            parser->cur < parser->end && *parser->cur == '[') {
            if (!ds4_parse_pages(parser, 1)) {
                free(key.data);
                return false;
            }
        } else if (!ds4_parse_value(parser, 1)) {
            free(key.data);
            return false;
        }
        free(key.data);
        ds4_skip_space(parser);
        if (parser->cur >= parser->end) {
            ds4_set_error(parser, "unterminated root object");
            return false;
        }
        if (*parser->cur == '}') {
            parser->cur++;
            return true;
        }
        if (*parser->cur++ != ',') {
            ds4_set_error(parser, "expected ',' or '}' in root object");
            return false;
        }
        ds4_skip_space(parser);
    }
}

ds4_crawl_source_status ds4_crawl_extract_source(
    const char *manifest, size_t max_bytes,
    char **source_out, bool *truncated_out,
    char *err, size_t err_len) {
    ds4_json_parser parser;
    bool parsed;

    if (source_out != NULL)
        *source_out = NULL;
    if (truncated_out != NULL)
        *truncated_out = false;
    if (err != NULL && err_len > 0)
        err[0] = '\0';
    if (source_out == NULL || truncated_out == NULL) {
        if (err != NULL && err_len > 0)
            snprintf(err, err_len, "output pointers are required");
        return DS4_CRAWL_SOURCE_INVALID;
    }
    if (manifest == NULL)
        return DS4_CRAWL_SOURCE_EMPTY;

    memset(&parser, 0, sizeof(parser));
    parser.start = manifest;
    parser.cur = manifest;
    parser.end = manifest + strlen(manifest);
    parser.err = err;
    parser.err_len = err_len;
    parser.max_bytes = max_bytes;

    ds4_skip_space(&parser);
    if (parser.cur < parser.end && *parser.cur == '{')
        parsed = ds4_parse_root_object(&parser);
    else
        parsed = ds4_parse_value(&parser, 0);
    ds4_skip_space(&parser);
    if (parsed && parser.cur != parser.end) {
        ds4_set_error(&parser, "trailing data");
        parsed = false;
    }
    if (!parsed || parser.failed) {
        free(parser.source.data);
        return DS4_CRAWL_SOURCE_INVALID;
    }
    if (!parser.found_content) {
        free(parser.source.data);
        return DS4_CRAWL_SOURCE_EMPTY;
    }
    if (parser.source.data == NULL &&
        !ds4_string_append(&parser, &parser.source, "", 0)) {
        free(parser.source.data);
        return DS4_CRAWL_SOURCE_INVALID;
    }
    *source_out = parser.source.data;
    *truncated_out = parser.truncated;
    return DS4_CRAWL_SOURCE_OK;
}

/* -------------------------------------------------------------------------- */
/* Verifier result scoring                                                    */
/* -------------------------------------------------------------------------- */

typedef struct {
    char **items;
    size_t count;
    size_t cap;
} ds4_evidence_list;

static bool ds4_evidence_push(ds4_evidence_list *list, char *item) {
    if (list->count == list->cap) {
        size_t cap = list->cap ? list->cap * 2 : 8;
        char **grown = (char **)realloc(list->items, cap * sizeof(*grown));
        if (grown == NULL)
            return false;
        list->items = grown;
        list->cap = cap;
    }
    list->items[list->count++] = item;
    return true;
}

static void ds4_evidence_free(ds4_evidence_list *list) {
    size_t i;
    for (i = 0; i < list->count; i++)
        free(list->items[i]);
    free(list->items);
}

/* Collapse every run of whitespace to a single space and trim the ends.
 * Returns a freshly allocated copy, or NULL on allocation failure. */
static char *ds4_normalize_ws(const char *text) {
    size_t length = strlen(text);
    char *out = (char *)malloc(length + 1);
    size_t i;
    size_t w = 0;
    bool pending_space = false;
    bool started = false;

    if (out == NULL)
        return NULL;
    for (i = 0; i < length; i++) {
        unsigned char c = (unsigned char)text[i];
        bool space = c == ' ' || c == '\t' || c == '\n' ||
                     c == '\r' || c == '\f' || c == '\v';
        if (space) {
            pending_space = started;
            continue;
        }
        if (pending_space) {
            out[w++] = ' ';
            pending_space = false;
        }
        out[w++] = (char)c;
        started = true;
    }
    out[w] = '\0';
    return out;
}

static bool ds4_parse_evidence_array(ds4_json_parser *parser,
                                     ds4_evidence_list *evidence) {
    parser->cur++;
    ds4_skip_space(parser);
    if (parser->cur < parser->end && *parser->cur == ']') {
        parser->cur++;
        return true;
    }
    for (;;) {
        ds4_skip_space(parser);
        if (parser->cur < parser->end && *parser->cur == '"') {
            ds4_string item;
            char *owned;
            if (!ds4_parse_string(parser, &item)) {
                free(item.data);
                return false;
            }
            owned = item.data != NULL ? item.data : (char *)calloc(1, 1);
            if (owned == NULL || !ds4_evidence_push(evidence, owned)) {
                free(owned);
                ds4_set_error(parser, "out of memory");
                return false;
            }
        } else if (!ds4_parse_value(parser, 1)) {
            return false;
        }
        ds4_skip_space(parser);
        if (parser->cur >= parser->end) {
            ds4_set_error(parser, "unterminated evidence array");
            return false;
        }
        if (*parser->cur == ']') {
            parser->cur++;
            return true;
        }
        if (*parser->cur++ != ',') {
            ds4_set_error(parser, "expected ',' or ']' in evidence array");
            return false;
        }
    }
}

static bool ds4_verifier_key_is_score(const ds4_string *key) {
    return ds4_string_equals(key, "semantic_support") ||
           ds4_string_equals(key, "semantic_score") ||
           ds4_string_equals(key, "support") ||
           ds4_string_equals(key, "score");
}

static bool ds4_parse_verifier_object(ds4_json_parser *parser,
                                      bool *have_score, double *score,
                                      ds4_evidence_list *evidence) {
    parser->cur++;
    ds4_skip_space(parser);
    if (parser->cur < parser->end && *parser->cur == '}') {
        parser->cur++;
        return true;
    }
    for (;;) {
        ds4_string key = {0};
        if (!ds4_parse_string(parser, &key)) {
            free(key.data);
            return false;
        }
        ds4_skip_space(parser);
        if (parser->cur >= parser->end || *parser->cur++ != ':') {
            free(key.data);
            ds4_set_error(parser, "expected ':' after key");
            return false;
        }
        ds4_skip_space(parser);
        if (ds4_verifier_key_is_score(&key) && parser->cur < parser->end &&
            (*parser->cur == '-' ||
             (*parser->cur >= '0' && *parser->cur <= '9'))) {
            const char *num_start = parser->cur;
            if (!ds4_parse_number(parser)) {
                free(key.data);
                return false;
            }
            *score = strtod(num_start, NULL);
            *have_score = true;
        } else if (ds4_verifier_key_is_score(&key) &&
                   parser->cur < parser->end && *parser->cur == '"') {
            ds4_string value;
            if (!ds4_parse_string(parser, &value)) {
                free(value.data);
                free(key.data);
                return false;
            }
            if (value.data != NULL) {
                *score = strtod(value.data, NULL);
                *have_score = true;
            }
            free(value.data);
        } else if (ds4_string_equals(&key, "evidence") &&
                   parser->cur < parser->end && *parser->cur == '[') {
            if (!ds4_parse_evidence_array(parser, evidence)) {
                free(key.data);
                return false;
            }
        } else if (!ds4_parse_value(parser, 1)) {
            free(key.data);
            return false;
        }
        free(key.data);
        ds4_skip_space(parser);
        if (parser->cur >= parser->end) {
            ds4_set_error(parser, "unterminated verifier object");
            return false;
        }
        if (*parser->cur == '}') {
            parser->cur++;
            return true;
        }
        if (*parser->cur++ != ',') {
            ds4_set_error(parser, "expected ',' or '}' in verifier object");
            return false;
        }
        ds4_skip_space(parser);
    }
}

int ds4_crawl_verify_result(const char *source, const char *verifier_json,
                            ds4_crawl_verification *out,
                            char *err, size_t err_len) {
    ds4_json_parser parser;
    ds4_evidence_list evidence = {0};
    const char *brace;
    char *normalized_source;
    bool have_score = false;
    double score = 0.0;
    size_t i;
    size_t total = 0;
    size_t found = 0;
    int semantic;
    int accuracy;

    if (out != NULL)
        memset(out, 0, sizeof(*out));
    if (err != NULL && err_len > 0)
        err[0] = '\0';
    if (source == NULL || verifier_json == NULL || out == NULL) {
        if (err != NULL && err_len > 0)
            snprintf(err, err_len, "invalid arguments");
        return 1;
    }

    brace = strchr(verifier_json, '{');
    if (brace == NULL) {
        if (err != NULL && err_len > 0)
            snprintf(err, err_len, "no JSON object in verifier response");
        return 1;
    }

    memset(&parser, 0, sizeof(parser));
    parser.start = verifier_json;
    parser.cur = brace;
    parser.end = verifier_json + strlen(verifier_json);
    parser.err = err;
    parser.err_len = err_len;

    /* Trailing prose after the object is tolerated on purpose. */
    if (!ds4_parse_verifier_object(&parser, &have_score, &score, &evidence) ||
        parser.failed) {
        ds4_evidence_free(&evidence);
        return 1;
    }
    if (!have_score) {
        ds4_evidence_free(&evidence);
        if (err != NULL && err_len > 0)
            snprintf(err, err_len,
                     "verifier response missing semantic support score");
        return 1;
    }

    if (score < 0.0)
        semantic = 0;
    else if (score > 100.0)
        semantic = 100;
    else
        semantic = (int)(score + 0.5);

    normalized_source = ds4_normalize_ws(source);
    if (normalized_source == NULL) {
        ds4_evidence_free(&evidence);
        if (err != NULL && err_len > 0)
            snprintf(err, err_len, "out of memory");
        return 1;
    }
    for (i = 0; i < evidence.count; i++) {
        char *excerpt = ds4_normalize_ws(evidence.items[i]);
        if (excerpt == NULL)
            continue;
        if (excerpt[0] != '\0') {
            total++;
            if (strstr(normalized_source, excerpt) != NULL)
                found++;
        }
        free(excerpt);
    }
    free(normalized_source);
    ds4_evidence_free(&evidence);

    if (total == 0) {
        accuracy = semantic;
    } else {
        double evidence_pct = 100.0 * (double)found / (double)total;
        accuracy = (int)(0.8 * (double)semantic + 0.2 * evidence_pct + 0.5);
    }
    if (accuracy < 0)
        accuracy = 0;
    else if (accuracy > 100)
        accuracy = 100;

    out->semantic_score = semantic;
    out->evidence_total = total;
    out->evidence_found = found;
    out->accuracy_score = accuracy;
    return 0;
}
