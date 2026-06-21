#include "../ds4_tool_compress.h"

#include <errno.h>
#include <inttypes.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(__GNUC__) || defined(__clang__)
#define CERT_UNUSED __attribute__((unused))
#else
#define CERT_UNUSED
#endif

typedef struct cert_buf {
    char *ptr;
    size_t len;
    size_t cap;
} cert_buf;

static bool cert_buf_reserve(cert_buf *b, size_t add) {
    if (add > (size_t)-1 - b->len - 1) return false;
    size_t need = b->len + add + 1;
    if (need <= b->cap) return true;
    size_t cap = b->cap ? b->cap * 2 : 4096;
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

static bool cert_buf_append(cert_buf *b, const char *s, size_t n) {
    if (!cert_buf_reserve(b, n)) return false;
    memcpy(b->ptr + b->len, s, n);
    b->len += n;
    b->ptr[b->len] = '\0';
    return true;
}

static bool cert_buf_puts(cert_buf *b, const char *s) {
    return cert_buf_append(b, s, strlen(s));
}

static bool cert_buf_printf(cert_buf *b, const char *fmt, ...) {
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
    if (!cert_buf_reserve(b, (size_t)n)) {
        va_end(ap);
        return false;
    }
    vsnprintf(b->ptr + b->len, b->cap - b->len, fmt, ap);
    va_end(ap);
    b->len += (size_t)n;
    return true;
}

static char *cert_buf_take(cert_buf *b) {
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

static char *make_short_output(void) {
    cert_buf b = {0};
    cert_buf_puts(&b, "short tool output below compression threshold\n");
    return cert_buf_take(&b);
}

static char *make_long_log(void) {
    cert_buf b = {0};
    for (int i = 0; i < 1800; i++) {
        if (i == 731) {
            cert_buf_puts(&b, "src/runtime/link.c:42: fatal error: missing generated header ds4_generated_config.h\n");
        } else if (i == 1290) {
            cert_buf_puts(&b, "warning: retrying slow object write after transient filesystem stall\n");
        } else {
            cert_buf_printf(&b,
                "ordinary build noise line %04d with repeated compiler chatter and object archive progress\n",
                i);
        }
    }
    return cert_buf_take(&b);
}

static char *make_search_output(void) {
    cert_buf b = {0};
    for (int i = 0; i < 2400; i++) {
        cert_buf_printf(&b,
            "src/module%d/file%d.c:%d: repeated search match for compression certification value=%d\n",
            i % 9, i % 31, i + 10, i);
    }
    return cert_buf_take(&b);
}

static char *make_diff_output(void) {
    cert_buf b = {0};
    for (int f = 0; f < 10; f++) {
        cert_buf_printf(&b, "diff --git a/src/file%d.c b/src/file%d.c\n", f, f);
        cert_buf_printf(&b, "--- a/src/file%d.c\n+++ b/src/file%d.c\n", f, f);
        for (int h = 0; h < 80; h++) {
            cert_buf_printf(&b, "@@ -%d,12 +%d,12 @@ static void function_%d_%d(void)\n",
                            h * 20 + 1, h * 20 + 1, f, h);
            for (int c = 0; c < 10; c++) {
                cert_buf_printf(&b,
                    " context line %02d keeps enough unchanged diff payload to make compression measurable\n",
                    c);
            }
            cert_buf_printf(&b, "-    old_call_%d_%d(ctx, verbose_flag);\n", f, h);
            cert_buf_printf(&b, "+    new_call_%d_%d(ctx, compact_flag);\n", f, h);
        }
    }
    return cert_buf_take(&b);
}

static char *make_json_array(void) {
    cert_buf b = {0};
    cert_buf_puts(&b, "[\n");
    for (int i = 0; i < 900; i++) {
        cert_buf_printf(&b,
            "  {\"id\":%d,\"path\":\"src/generated/item_%04d.c\",\"status\":\"ok\",\"message\":\"long repeated metadata payload for compression certification with stable schema\",\"score\":%d}%s\n",
            i, i, i % 17, i == 899 ? "" : ",");
    }
    cert_buf_puts(&b, "]\n");
    return cert_buf_take(&b);
}

static char *make_file_output(void) {
    cert_buf b = {0};
    cert_buf_puts(&b, "Tool result 1 (read):\n");
    for (int i = 0; i < 1400; i++) {
        cert_buf_printf(&b,
            "%05d  long source file content line with deterministic filler for head tail compression measurement\n",
            i + 1);
    }
    return cert_buf_take(&b);
}

static char *make_generic_huge_output(void) {
    cert_buf b = {0};
    for (int i = 0; i < 1700; i++) {
        cert_buf_printf(&b,
            "plain telemetry sample %04d carries repetitive neutral payload without log keywords or grep syntax\n",
            i);
    }
    return cert_buf_take(&b);
}

static char *make_retrieve_context_blob_output(void) {
    cert_buf b = {0};
    for (int i = 0; i < 900; i++) {
        cert_buf_printf(&b,
            "context_blob_range line %04d should never be recursively compressed even if it is large\n",
            i);
    }
    return cert_buf_take(&b);
}

typedef struct cert_case {
    const char *name;
    const char *tool;
    char *input;
    bool expect_changed;
    double max_ratio;
} cert_case;

static void print_case_result(const cert_case *c,
                              const ds4_tool_compress_result *r,
                              bool ok,
                              bool retrievable,
                              const char *note) {
    uint64_t original = r->original_bytes;
    uint64_t effective = r->changed ? r->compressed_bytes : r->original_bytes;
    uint64_t saved = original > effective ? original - effective : 0;
    double ratio = original ? (double)effective / (double)original : 1.0;
    printf("case\tname=%s\ttool=%s\tkind=%s\tstrategy=%s\tchanged=%d\texpected_changed=%d"
           "\toriginal_bytes=%" PRIu64 "\tcompressed_bytes=%" PRIu64 "\tsaved_bytes=%" PRIu64
           "\tratio=%.6f\tsaved_pct=%.2f\toriginal_saved=%d\tretrievable=%d\tpass=%d\tnote=%s\n",
           c->name,
           c->tool,
           ds4_tool_content_kind_name(r->kind),
           r->strategy[0] ? r->strategy : "none",
           r->changed ? 1 : 0,
           c->expect_changed ? 1 : 0,
           original,
           effective,
           saved,
           ratio,
           original ? (100.0 * (double)saved / (double)original) : 0.0,
           r->original_saved ? 1 : 0,
           retrievable ? 1 : 0,
           ok ? 1 : 0,
           note ? note : "ok");
}

static bool run_one_case(const char *blob_dir, const cert_case *c,
                         uint64_t *total_original, uint64_t *total_effective,
                         int *changed_count) {
    ds4_tool_compress_result r = {0};
    char err[512] = {0};
    size_t len = strlen(c->input);
    bool api_ok = ds4_tool_compress_result_text(c->tool, c->input, len,
                                                blob_dir, &r,
                                                err, sizeof(err));
    bool retrievable = false;
    bool ok = api_ok;
    const char *note = "ok";

    if (!api_ok) {
        ok = false;
        note = err[0] ? err : "api_failed";
    } else if (r.changed != c->expect_changed) {
        ok = false;
        note = c->expect_changed ? "expected_compression" : "unexpected_compression";
    }

    if (api_ok && r.changed) {
        if (!r.text || !strstr(r.text, "[ds4 compressed tool output]")) {
            ok = false;
            note = "missing_marker";
        }
        if (!r.original_saved || !ds4_context_blob_id_valid(r.blob_id)) {
            ok = false;
            note = "missing_valid_blob";
        }
        if (r.compressed_bytes >= r.original_bytes) {
            ok = false;
            note = "compression_expanded";
        }
        double ratio = r.original_bytes ? (double)r.compressed_bytes / (double)r.original_bytes : 1.0;
        if (ratio > c->max_ratio) {
            ok = false;
            note = "ratio_above_threshold";
        }
        if (r.original_saved) {
            char read_err[256] = {0};
            char *full = ds4_context_blob_read_range(blob_dir, r.blob_id, 0,
                                                     r.original_bytes,
                                                     read_err, sizeof(read_err));
            retrievable = full && strcmp(full, c->input) == 0;
            free(full);
            if (!retrievable) {
                ok = false;
                note = "blob_not_exactly_retrievable";
            }
        }
        (*changed_count)++;
    }

    uint64_t effective = api_ok && r.changed ? r.compressed_bytes : (uint64_t)len;
    *total_original += (uint64_t)len;
    *total_effective += effective;
    print_case_result(c, &r, ok, retrievable, note);
    ds4_tool_compress_result_free(&r);
    return ok;
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s <blob-dir>\n", argv[0]);
        return 2;
    }
    const char *blob_dir = argv[1];
    cert_case cases[] = {
        {"short_below_threshold", "bash", make_short_output(), false, 1.0},
        {"long_log", "bash", make_long_log(), true, 0.80},
        {"search_grep", "search", make_search_output(), true, 0.80},
        {"unified_diff", "bash", make_diff_output(), true, 0.80},
        {"json_array", "api_result", make_json_array(), true, 0.80},
        {"large_file_read", "read", make_file_output(), true, 0.80},
        {"generic_huge", "generic_tool", make_generic_huge_output(), true, 0.80},
        {"retrieve_no_recompress", "retrieve_context_blob", make_retrieve_context_blob_output(), false, 1.0},
    };
    int case_count = (int)(sizeof(cases) / sizeof(cases[0]));
    uint64_t total_original = 0;
    uint64_t total_effective = 0;
    int passed = 0;
    int changed = 0;

    for (int i = 0; i < case_count; i++) {
        if (!cases[i].input) {
            fprintf(stderr, "failed to allocate case %s\n", cases[i].name);
            for (int j = 0; j < case_count; j++) free(cases[j].input);
            return 2;
        }
        if (run_one_case(blob_dir, &cases[i], &total_original, &total_effective, &changed))
            passed++;
    }

    uint64_t saved = total_original > total_effective ? total_original - total_effective : 0;
    double overall_ratio = total_original ? (double)total_effective / (double)total_original : 1.0;
    bool aggregate_ok = overall_ratio <= 0.50;
    bool all_ok = passed == case_count && aggregate_ok;
    printf("summary\tcases=%d\tpassed=%d\tchanged=%d\toriginal_bytes=%" PRIu64
           "\tcompressed_bytes=%" PRIu64 "\tsaved_bytes=%" PRIu64
           "\toverall_ratio=%.6f\toverall_saved_pct=%.2f\taggregate_threshold_ratio=0.500000\tpass=%d\n",
           case_count,
           passed,
           changed,
           total_original,
           total_effective,
           saved,
           overall_ratio,
           total_original ? (100.0 * (double)saved / (double)total_original) : 0.0,
           all_ok ? 1 : 0);

    for (int i = 0; i < case_count; i++) free(cases[i].input);
    return all_ok ? 0 : 1;
}
