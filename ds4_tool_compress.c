#include "ds4_tool_compress.h"

#include <ctype.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DS4_TOOL_COMPRESS_MIN_BYTES 4096u
#define DS4_TOOL_COMPRESS_HUGE_BYTES 32768u
#define DS4_TOOL_COMPRESS_MAX_INLINE_BYTES 12000u
#define DS4_TOOL_COMPRESS_MIN_RATIO_NUM 4u
#define DS4_TOOL_COMPRESS_MIN_RATIO_DEN 5u

typedef struct {
    char *ptr;
    size_t len;
    size_t cap;
} ds4_tc_buf;

typedef struct {
    size_t start;
    size_t content_end;
    size_t end;
} ds4_tc_line;

typedef struct {
    ds4_tc_line *v;
    size_t len;
    size_t cap;
} ds4_tc_lines;

typedef struct {
    char *text;
    uint64_t omitted_lines;
    const char *strategy;
} ds4_tc_candidate;

static void ds4_tc_set_err(char *err, size_t err_len, const char *msg) {
    if (err && err_len) snprintf(err, err_len, "%s", msg ? msg : "unknown error");
}

static bool ds4_tc_buf_reserve(ds4_tc_buf *b, size_t add) {
    if (add > (size_t)-1 - b->len - 1) return false;
    size_t need = b->len + add + 1;
    if (need <= b->cap) return true;
    size_t cap = b->cap ? b->cap * 2 : 1024;
    while (cap < need) {
        if (cap > (size_t)-1 / 2) {
            cap = need;
            break;
        }
        cap *= 2;
    }
    char *p = realloc(b->ptr, cap);
    if (!p) return false;
    b->ptr = p;
    b->cap = cap;
    return true;
}

static bool ds4_tc_buf_append(ds4_tc_buf *b, const char *s, size_t n) {
    if (!n) return true;
    if (!ds4_tc_buf_reserve(b, n)) return false;
    memcpy(b->ptr + b->len, s, n);
    b->len += n;
    b->ptr[b->len] = '\0';
    return true;
}

static bool ds4_tc_buf_puts(ds4_tc_buf *b, const char *s) {
    return ds4_tc_buf_append(b, s ? s : "", s ? strlen(s) : 0);
}

static bool ds4_tc_buf_printf(ds4_tc_buf *b, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    va_list aq;
    va_copy(aq, ap);
    int n = vsnprintf(NULL, 0, fmt, aq);
    va_end(aq);
    if (n < 0) {
        va_end(ap);
        return false;
    }
    if (!ds4_tc_buf_reserve(b, (size_t)n)) {
        va_end(ap);
        return false;
    }
    vsnprintf(b->ptr + b->len, b->cap - b->len, fmt, ap);
    va_end(ap);
    b->len += (size_t)n;
    return true;
}

static char *ds4_tc_buf_take(ds4_tc_buf *b) {
    if (!b->ptr) {
        b->ptr = malloc(1);
        if (!b->ptr) return NULL;
        b->ptr[0] = '\0';
    }
    char *p = b->ptr;
    b->ptr = NULL;
    b->len = b->cap = 0;
    return p;
}

static void ds4_tc_lines_free(ds4_tc_lines *lines) {
    free(lines->v);
    memset(lines, 0, sizeof(*lines));
}

static bool ds4_tc_lines_push(ds4_tc_lines *lines, ds4_tc_line line) {
    if (lines->len == lines->cap) {
        size_t cap = lines->cap ? lines->cap * 2 : 256;
        ds4_tc_line *p = realloc(lines->v, cap * sizeof(lines->v[0]));
        if (!p) return false;
        lines->v = p;
        lines->cap = cap;
    }
    lines->v[lines->len++] = line;
    return true;
}

static bool ds4_tc_split_lines(const char *text, size_t len, ds4_tc_lines *lines) {
    size_t pos = 0;
    while (pos < len) {
        size_t start = pos;
        while (pos < len && text[pos] != '\n' && text[pos] != '\r') pos++;
        size_t content_end = pos;
        if (pos < len) {
            if (text[pos] == '\r' && pos + 1 < len && text[pos + 1] == '\n') pos += 2;
            else pos++;
        }
        if (!ds4_tc_lines_push(lines, (ds4_tc_line){start, content_end, pos}))
            return false;
    }
    return true;
}

static bool ds4_tc_line_starts_with(const char *text, ds4_tc_line line, const char *prefix) {
    size_t n = strlen(prefix);
    return line.content_end - line.start >= n && memcmp(text + line.start, prefix, n) == 0;
}

static bool ds4_tc_line_contains_ci(const char *text, ds4_tc_line line, const char *needle) {
    size_t nn = strlen(needle);
    size_t ln = line.content_end - line.start;
    if (!nn || nn > ln) return false;
    for (size_t i = 0; i + nn <= ln; i++) {
        bool ok = true;
        for (size_t j = 0; j < nn; j++) {
            unsigned char a = (unsigned char)text[line.start + i + j];
            unsigned char b = (unsigned char)needle[j];
            if (tolower(a) != tolower(b)) {
                ok = false;
                break;
            }
        }
        if (ok) return true;
    }
    return false;
}

static bool ds4_tc_line_important(const char *text, ds4_tc_line line) {
    static const char *needles[] = {
        "error", "fatal", "failed", "traceback", "panic", "exception",
        "warning", "undefined reference", "segmentation fault", "todo", "fail"
    };
    for (size_t i = 0; i < sizeof(needles) / sizeof(needles[0]); i++) {
        if (ds4_tc_line_contains_ci(text, line, needles[i])) return true;
    }
    return false;
}

static bool ds4_tc_append_line(ds4_tc_buf *b, const char *text, ds4_tc_line line) {
    return ds4_tc_buf_append(b, text + line.start, line.end - line.start);
}

static const char *ds4_tc_first_nonspace(const char *text, size_t len) {
    size_t i = 0;
    while (i < len && isspace((unsigned char)text[i])) i++;
    return text + i;
}

static int ds4_tc_count_substring(const char *text, size_t len, const char *needle) {
    int count = 0;
    size_t nn = strlen(needle);
    if (!nn || nn > len) return 0;
    for (size_t i = 0; i + nn <= len; i++) {
        if (memcmp(text + i, needle, nn) == 0) count++;
    }
    return count;
}

static bool ds4_tc_looks_grep_line(const char *p, size_t n) {
    size_t i = 0;
    if (!n || p[0] == ' ' || p[0] == '\t') return false;
    while (i < n && p[i] != ':' && p[i] != '\n' && p[i] != '\r') i++;
    if (i == 0 || i + 2 >= n || p[i] != ':') return false;
    i++;
    size_t digits = 0;
    while (i < n && isdigit((unsigned char)p[i])) {
        digits++;
        i++;
    }
    return digits > 0 && i < n && p[i] == ':';
}

static bool ds4_tc_looks_numbered_match_line(const char *p, size_t n) {
    size_t i = 0;
    while (i < n && (p[i] == ' ' || p[i] == '\t')) i++;
    size_t digits = 0;
    while (i < n && isdigit((unsigned char)p[i])) {
        digits++;
        i++;
    }
    return digits > 0 && i < n && (p[i] == ' ' || p[i] == '\t');
}

const char *ds4_tool_content_kind_name(ds4_tool_content_kind kind) {
    switch (kind) {
    case DS4_TOOL_CONTENT_SEARCH: return "search";
    case DS4_TOOL_CONTENT_LOG: return "log";
    case DS4_TOOL_CONTENT_JSON_ARRAY: return "json_array";
    case DS4_TOOL_CONTENT_DIFF: return "diff";
    case DS4_TOOL_CONTENT_FILE: return "file";
    case DS4_TOOL_CONTENT_TRACE: return "trace";
    default: return "unknown";
    }
}

ds4_tool_content_kind ds4_tool_classify_output(const char *tool_name,
                                               const char *text,
                                               size_t len) {
    if (!text) text = "";
    if (tool_name && !strcmp(tool_name, "retrieve_context_blob"))
        return DS4_TOOL_CONTENT_UNKNOWN;
    if (tool_name && (!strcmp(tool_name, "read") || !strcmp(tool_name, "more") ||
                      !strcmp(tool_name, "cat") || !strcmp(tool_name, "crawl")))
        return DS4_TOOL_CONTENT_FILE;

    const char *p = ds4_tc_first_nonspace(text, len);
    size_t rem = len - (size_t)(p - text);
    if ((rem >= 10 && !memcmp(p, "diff --git", 10)) ||
        strstr(text, "\ndiff --git ") || ds4_tc_count_substring(text, len, "\n@@ ") >= 2)
        return DS4_TOOL_CONTENT_DIFF;
    if (rem && p[0] == '[' && strchr(p, '{') && len > DS4_TOOL_COMPRESS_MIN_BYTES)
        return DS4_TOOL_CONTENT_JSON_ARRAY;
    if ((tool_name && !strcmp(tool_name, "search")) || strstr(text, "matches shown\n") ||
        ds4_tc_count_substring(text, len, ":") > 20)
    {
        ds4_tc_lines lines = {0};
        int grepish = 0, numbered = 0;
        if (ds4_tc_split_lines(text, len, &lines)) {
            for (size_t i = 0; i < lines.len && i < 300; i++) {
                const char *lp = text + lines.v[i].start;
                size_t ln = lines.v[i].content_end - lines.v[i].start;
                if (ds4_tc_looks_grep_line(lp, ln)) grepish++;
                if (ds4_tc_looks_numbered_match_line(lp, ln)) numbered++;
            }
        }
        ds4_tc_lines_free(&lines);
        if (grepish >= 8 || numbered >= 8 || (tool_name && !strcmp(tool_name, "search")))
            return DS4_TOOL_CONTENT_SEARCH;
    }
    if (strstr(text, "Traceback") || strstr(text, "FAILED") || strstr(text, "panic") ||
        strstr(text, "error:") || strstr(text, "warning:") || strstr(text, "Exception") ||
        strstr(text, "undefined reference"))
        return DS4_TOOL_CONTENT_LOG;
    if (tool_name && (!strcmp(tool_name, "bash") || !strcmp(tool_name, "bash_status") ||
                      !strcmp(tool_name, "bash_stop")))
        return DS4_TOOL_CONTENT_LOG;
    if ((strstr(text, "Tool result") && (strstr(text, "(read)") || strstr(text, "(more)"))) ||
        strstr(text, "continue_offset=") || strstr(text, "[Read truncated"))
        return DS4_TOOL_CONTENT_FILE;
    return DS4_TOOL_CONTENT_UNKNOWN;
}

static void ds4_tc_candidate_free(ds4_tc_candidate *c) {
    free(c->text);
    memset(c, 0, sizeof(*c));
}

static ds4_tc_candidate ds4_tc_compress_log(const char *text, size_t len) {
    ds4_tc_candidate cand = {.strategy = "log_compressor"};
    ds4_tc_lines lines = {0};
    if (!ds4_tc_split_lines(text, len, &lines)) return cand;
    bool *show = calloc(lines.len ? lines.len : 1, sizeof(bool));
    if (!show) {
        ds4_tc_lines_free(&lines);
        return cand;
    }
    size_t head = lines.len < 40 ? lines.len : 40;
    for (size_t i = 0; i < head; i++) show[i] = true;
    size_t tail_start = lines.len > 80 ? lines.len - 80 : 0;
    for (size_t i = tail_start; i < lines.len; i++) show[i] = true;
    size_t important_added = 0;
    for (size_t i = 0; i < lines.len && important_added < 200; i++) {
        if (ds4_tc_line_important(text, lines.v[i])) {
            if (!show[i]) important_added++;
            show[i] = true;
        }
    }

    size_t shown = 0;
    for (size_t i = 0; i < lines.len; i++) if (show[i]) shown++;
    cand.omitted_lines = lines.len > shown ? (uint64_t)(lines.len - shown) : 0;

    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
            "[log output compressed]\noriginal_lines: %zu\nshown_lines: %zu\nomitted_lines: %llu\n\nimportant/head/tail lines:\n",
            lines.len, shown, (unsigned long long)cand.omitted_lines)) goto done;
    for (size_t i = 0; i < lines.len; i++) {
        if (!show[i]) continue;
        if (b.len > DS4_TOOL_COMPRESS_MAX_INLINE_BYTES) {
            cand.omitted_lines += (uint64_t)(shown - i);
            break;
        }
        if (!ds4_tc_append_line(&b, text, lines.v[i])) goto done;
    }
    cand.text = ds4_tc_buf_take(&b);
done:
    free(b.ptr);
    free(show);
    ds4_tc_lines_free(&lines);
    return cand;
}

typedef struct {
    char name[192];
    int total;
    int shown;
} ds4_tc_file_stat;

static int ds4_tc_find_file(ds4_tc_file_stat *stats, int n, const char *name, size_t len) {
    if (len >= sizeof(stats[0].name)) len = sizeof(stats[0].name) - 1;
    for (int i = 0; i < n; i++) {
        if (strlen(stats[i].name) == len && !memcmp(stats[i].name, name, len)) return i;
    }
    return -1;
}

static ds4_tc_candidate ds4_tc_compress_search(const char *text, size_t len) {
    ds4_tc_candidate cand = {.strategy = "search_compressor"};
    ds4_tc_lines lines = {0};
    if (!ds4_tc_split_lines(text, len, &lines)) return cand;
    ds4_tc_file_stat stats[96];
    memset(stats, 0, sizeof(stats));
    int stats_len = 0;
    const char *current_file = NULL;
    size_t current_file_len = 0;
    bool *show = calloc(lines.len ? lines.len : 1, sizeof(bool));
    if (!show) {
        ds4_tc_lines_free(&lines);
        return cand;
    }

    for (size_t i = 0; i < lines.len; i++) {
        const char *lp = text + lines.v[i].start;
        size_t ln = lines.v[i].content_end - lines.v[i].start;
        if (ln == 0) continue;
        const char *file_name = current_file;
        size_t file_len = current_file_len;
        bool match_line = false;
        if (ds4_tc_looks_grep_line(lp, ln)) {
            const char *colon = memchr(lp, ':', ln);
            file_name = lp;
            file_len = (size_t)(colon - lp);
            match_line = true;
        } else if (ds4_tc_looks_numbered_match_line(lp, ln) && current_file) {
            match_line = true;
        } else if (lp[0] != ' ' && lp[0] != '\t' && !strstr(lp, "matches shown")) {
            current_file = lp;
            current_file_len = ln;
            if (stats_len < (int)(sizeof(stats) / sizeof(stats[0])) &&
                ds4_tc_find_file(stats, stats_len, lp, ln) < 0)
            {
                size_t copy = ln < sizeof(stats[0].name) - 1 ? ln : sizeof(stats[0].name) - 1;
                memcpy(stats[stats_len].name, lp, copy);
                stats[stats_len].name[copy] = '\0';
                stats_len++;
            }
            show[i] = true;
        }
        if (!match_line) continue;
        int si = file_name ? ds4_tc_find_file(stats, stats_len, file_name, file_len) : -1;
        if (si < 0 && stats_len < (int)(sizeof(stats) / sizeof(stats[0]))) {
            si = stats_len++;
            size_t copy = file_len < sizeof(stats[0].name) - 1 ? file_len : sizeof(stats[0].name) - 1;
            memcpy(stats[si].name, file_name, copy);
            stats[si].name[copy] = '\0';
        }
        if (si >= 0) stats[si].total++;
        bool important = ds4_tc_line_important(text, lines.v[i]);
        if ((si >= 0 && stats[si].shown < 5) || important) {
            show[i] = true;
            if (si >= 0) stats[si].shown++;
        }
    }

    size_t shown = 0;
    for (size_t i = 0; i < lines.len; i++) if (show[i]) shown++;
    cand.omitted_lines = lines.len > shown ? (uint64_t)(lines.len - shown) : 0;

    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
            "[search output compressed]\noriginal_lines: %zu\nshown_lines: %zu\nomitted_lines: %llu\nmatches_by_file:\n",
            lines.len, shown, (unsigned long long)cand.omitted_lines)) goto done;
    for (int i = 0; i < stats_len; i++) {
        if (!stats[i].name[0]) continue;
        if (!ds4_tc_buf_printf(&b, "- %s: %d matches, shown %d\n",
                               stats[i].name, stats[i].total, stats[i].shown)) goto done;
    }
    if (!ds4_tc_buf_puts(&b, "\nTop matches:\n")) goto done;
    for (size_t i = 0; i < lines.len; i++) {
        if (!show[i]) continue;
        if (b.len > DS4_TOOL_COMPRESS_MAX_INLINE_BYTES) break;
        if (!ds4_tc_append_line(&b, text, lines.v[i])) goto done;
    }
    cand.text = ds4_tc_buf_take(&b);
done:
    free(b.ptr);
    free(show);
    ds4_tc_lines_free(&lines);
    return cand;
}

static ds4_tc_candidate ds4_tc_compress_diff(const char *text, size_t len) {
    ds4_tc_candidate cand = {.strategy = "diff_compressor"};
    ds4_tc_lines lines = {0};
    if (!ds4_tc_split_lines(text, len, &lines)) return cand;
    size_t files = 0, plus = 0, minus = 0, shown = 0;
    ds4_tc_buf body = {0};
    for (size_t i = 0; i < lines.len; i++) {
        const char *lp = text + lines.v[i].start;
        size_t ln = lines.v[i].content_end - lines.v[i].start;
        bool keep = false;
        if (ds4_tc_line_starts_with(text, lines.v[i], "diff --git")) { files++; keep = true; }
        else if (ds4_tc_line_starts_with(text, lines.v[i], "@@ ")) keep = true;
        else if (ds4_tc_line_starts_with(text, lines.v[i], "+++ ") ||
                 ds4_tc_line_starts_with(text, lines.v[i], "--- ")) keep = true;
        else if (ln && lp[0] == '+' && !ds4_tc_line_starts_with(text, lines.v[i], "+++")) { plus++; keep = true; }
        else if (ln && lp[0] == '-' && !ds4_tc_line_starts_with(text, lines.v[i], "---")) { minus++; keep = true; }
        if (!keep) continue;
        if (body.len < DS4_TOOL_COMPRESS_MAX_INLINE_BYTES && ds4_tc_append_line(&body, text, lines.v[i]))
            shown++;
    }
    cand.omitted_lines = lines.len > shown ? (uint64_t)(lines.len - shown) : 0;
    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
            "[diff compressed]\nfiles_changed: %zu\nsummary: +%zu -%zu\nshown_lines: %zu\nomitted_lines: %llu\nshown_hunks:\n",
            files, plus, minus, shown, (unsigned long long)cand.omitted_lines)) goto done;
    if (!ds4_tc_buf_puts(&b, body.ptr ? body.ptr : "")) goto done;
    cand.text = ds4_tc_buf_take(&b);
done:
    free(body.ptr);
    free(b.ptr);
    ds4_tc_lines_free(&lines);
    return cand;
}

static ds4_tc_candidate ds4_tc_compress_json_array(const char *text, size_t len) {
    ds4_tc_candidate cand = {.strategy = "json_array_compressor"};
    size_t objects = 0;
    for (size_t i = 0; i < len; i++) if (text[i] == '{') objects++;
    size_t head = len < 6000 ? len : 6000;
    size_t tail = len > head + 4000 ? 4000 : 0;
    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
            "[json array compressed]\nestimated_items: %zu\nshown: first %zu bytes%s\n\nsample_first:\n",
            objects, head, tail ? " + last 4000 bytes" : "")) goto done;
    if (!ds4_tc_buf_append(&b, text, head)) goto done;
    if (head && b.ptr[b.len - 1] != '\n' && !ds4_tc_buf_puts(&b, "\n")) goto done;
    if (tail) {
        if (!ds4_tc_buf_puts(&b, "\nsample_last:\n")) goto done;
        if (!ds4_tc_buf_append(&b, text + len - tail, tail)) goto done;
        if (b.ptr[b.len - 1] != '\n' && !ds4_tc_buf_puts(&b, "\n")) goto done;
    }
    cand.omitted_lines = 0;
    cand.text = ds4_tc_buf_take(&b);
done:
    free(b.ptr);
    return cand;
}

static ds4_tc_candidate ds4_tc_compress_file(const char *text, size_t len, const char *strategy) {
    ds4_tc_candidate cand = {.strategy = strategy};
    ds4_tc_lines lines = {0};
    if (!ds4_tc_split_lines(text, len, &lines)) return cand;
    size_t head = lines.len < 100 ? lines.len : 100;
    size_t tail = lines.len > head + 80 ? 80 : 0;
    size_t shown = head + tail;
    cand.omitted_lines = lines.len > shown ? (uint64_t)(lines.len - shown) : 0;
    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
            "[file content compressed]\noriginal_lines: %zu\nshown: head %zu lines%s\nomitted_lines: %llu\n\nhead:\n",
            lines.len, head, tail ? " + tail 80 lines" : "",
            (unsigned long long)cand.omitted_lines)) goto done;
    for (size_t i = 0; i < head; i++) {
        if (b.len > DS4_TOOL_COMPRESS_MAX_INLINE_BYTES) break;
        if (!ds4_tc_append_line(&b, text, lines.v[i])) goto done;
    }
    if (tail) {
        if (!ds4_tc_buf_puts(&b, "\ntail:\n")) goto done;
        for (size_t i = lines.len - tail; i < lines.len; i++) {
            if (b.len > DS4_TOOL_COMPRESS_MAX_INLINE_BYTES) break;
            if (!ds4_tc_append_line(&b, text, lines.v[i])) goto done;
        }
    }
    cand.text = ds4_tc_buf_take(&b);
done:
    free(b.ptr);
    ds4_tc_lines_free(&lines);
    return cand;
}

static char *ds4_tc_build_marker(const ds4_tool_compress_result *r,
                                 uint64_t compressed_bytes,
                                 const char *body) {
    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
        "[ds4 compressed tool output]\n"
        "strategy: %s\n"
        "kind: %s\n"
        "original_bytes: %llu\n"
        "compressed_bytes: %llu\n"
        "blob_id: %s\n"
        "retrieve: retrieve_context_blob id=%s offset=0 length=20000\n"
        "note: lossy live-zone compression; use retrieve_context_blob for exact original bytes.\n\n",
        r->strategy,
        ds4_tool_content_kind_name(r->kind),
        (unsigned long long)r->original_bytes,
        (unsigned long long)compressed_bytes,
        r->blob_id,
        r->blob_id))
    {
        free(b.ptr);
        return NULL;
    }
    if (!ds4_tc_buf_puts(&b, body ? body : "")) {
        free(b.ptr);
        return NULL;
    }
    return ds4_tc_buf_take(&b);
}

bool ds4_tool_compress_result_text(const char *tool_name,
                                   const char *text,
                                   size_t len,
                                   const char *blob_base_dir,
                                   ds4_tool_compress_result *out,
                                   char *err,
                                   size_t err_len) {
    if (err && err_len) err[0] = '\0';
    if (!out) {
        ds4_tc_set_err(err, err_len, "missing compression output");
        return false;
    }
    memset(out, 0, sizeof(*out));
    out->original_bytes = (uint64_t)len;
    out->kind = ds4_tool_classify_output(tool_name, text, len);
    if (!text) text = "";
    if (tool_name && !strcmp(tool_name, "retrieve_context_blob")) return true;
    if (len < DS4_TOOL_COMPRESS_MIN_BYTES) return true;

    ds4_tc_candidate cand = {0};
    switch (out->kind) {
    case DS4_TOOL_CONTENT_SEARCH:
        cand = ds4_tc_compress_search(text, len);
        break;
    case DS4_TOOL_CONTENT_DIFF:
        cand = ds4_tc_compress_diff(text, len);
        break;
    case DS4_TOOL_CONTENT_JSON_ARRAY:
        cand = ds4_tc_compress_json_array(text, len);
        break;
    case DS4_TOOL_CONTENT_FILE:
        cand = ds4_tc_compress_file(text, len, "file_head_tail_compressor");
        break;
    case DS4_TOOL_CONTENT_LOG:
        cand = ds4_tc_compress_log(text, len);
        break;
    default:
        if (len >= DS4_TOOL_COMPRESS_HUGE_BYTES) {
            out->kind = DS4_TOOL_CONTENT_FILE;
            cand = ds4_tc_compress_file(text, len, "generic_head_tail_compressor");
        }
        break;
    }

    if (!cand.text) return true;
    size_t cand_len = strlen(cand.text);
    if (cand_len * DS4_TOOL_COMPRESS_MIN_RATIO_DEN >= len * DS4_TOOL_COMPRESS_MIN_RATIO_NUM) {
        ds4_tc_candidate_free(&cand);
        return true;
    }
    if (!blob_base_dir || !blob_base_dir[0]) {
        ds4_tc_candidate_free(&cand);
        ds4_tc_set_err(err, err_len, "missing blob directory for lossy compression");
        return false;
    }

    ds4_context_blob_ref ref;
    if (!ds4_context_blob_put_text(blob_base_dir, text, len, &ref, err, err_len)) {
        ds4_tc_candidate_free(&cand);
        return false;
    }
    snprintf(out->strategy, sizeof(out->strategy), "%s", cand.strategy ? cand.strategy : "tool_compressor");
    snprintf(out->blob_id, sizeof(out->blob_id), "%s", ref.id);
    out->original_saved = true;
    out->omitted_lines = cand.omitted_lines;

    uint64_t compressed_bytes = (uint64_t)cand_len;
    char *final = NULL;
    for (int i = 0; i < 4; i++) {
        free(final);
        final = ds4_tc_build_marker(out, compressed_bytes, cand.text);
        if (!final) {
            ds4_tc_candidate_free(&cand);
            ds4_tc_set_err(err, err_len, "out of memory building compression marker");
            return false;
        }
        uint64_t actual = (uint64_t)strlen(final);
        if (actual == compressed_bytes) break;
        compressed_bytes = actual;
    }
    if (compressed_bytes * DS4_TOOL_COMPRESS_MIN_RATIO_DEN >= len * DS4_TOOL_COMPRESS_MIN_RATIO_NUM) {
        free(final);
        ds4_tc_candidate_free(&cand);
        memset(out, 0, sizeof(*out));
        out->original_bytes = (uint64_t)len;
        out->kind = ds4_tool_classify_output(tool_name, text, len);
        return true;
    }

    out->changed = true;
    out->compressed_bytes = compressed_bytes;
    out->text = final;
    ds4_tc_candidate_free(&cand);
    return true;
}

void ds4_tool_compress_result_free(ds4_tool_compress_result *r) {
    if (!r) return;
    free(r->text);
    memset(r, 0, sizeof(*r));
}
