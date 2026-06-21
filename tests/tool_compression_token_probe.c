#include "../ds4_tool_compress.h"

#include <errno.h>
#include <inttypes.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *read_all(const char *path, size_t *len_out) {
    FILE *fp = fopen(path, "rb");
    if (!fp) return NULL;
    if (fseeko(fp, 0, SEEK_END) != 0) {
        fclose(fp);
        return NULL;
    }
    off_t end = ftello(fp);
    if (end < 0) {
        fclose(fp);
        return NULL;
    }
    if (fseeko(fp, 0, SEEK_SET) != 0) {
        fclose(fp);
        return NULL;
    }
    char *buf = malloc((size_t)end + 1);
    if (!buf) {
        fclose(fp);
        return NULL;
    }
    size_t got = fread(buf, 1, (size_t)end, fp);
    if (got != (size_t)end && ferror(fp)) {
        free(buf);
        fclose(fp);
        return NULL;
    }
    fclose(fp);
    buf[got] = '\0';
    if (len_out) *len_out = got;
    return buf;
}

static bool write_all(const char *path, const char *data, size_t len) {
    FILE *fp = fopen(path, "wb");
    if (!fp) return false;
    bool ok = fwrite(data, 1, len, fp) == len;
    if (fclose(fp) != 0) ok = false;
    return ok;
}

static int parse_expect_changed(const char *s) {
    if (!s || !strcmp(s, "any")) return -1;
    if (!strcmp(s, "yes") || !strcmp(s, "true") || !strcmp(s, "1")) return 1;
    if (!strcmp(s, "no") || !strcmp(s, "false") || !strcmp(s, "0")) return 0;
    return -2;
}

int main(int argc, char **argv) {
    if (argc != 8) {
        fprintf(stderr,
                "usage: %s <blob-dir> <case-name> <tool-name> <input-file> <effective-output-file> <expect_changed yes|no|any> <max_ratio>\n",
                argv[0]);
        return 2;
    }
    const char *blob_dir = argv[1];
    const char *case_name = argv[2];
    const char *tool_name = argv[3];
    const char *input_path = argv[4];
    const char *effective_path = argv[5];
    int expect_changed = parse_expect_changed(argv[6]);
    if (expect_changed == -2) {
        fprintf(stderr, "invalid expect_changed: %s\n", argv[6]);
        return 2;
    }
    double max_ratio = strtod(argv[7], NULL);

    size_t len = 0;
    char *input = read_all(input_path, &len);
    if (!input) {
        fprintf(stderr, "read %s: %s\n", input_path, strerror(errno));
        return 2;
    }

    ds4_tool_compress_result r = {0};
    char err[512] = {0};
    bool api_ok = ds4_tool_compress_result_text(tool_name, input, len,
                                                blob_dir, &r,
                                                err, sizeof(err));
    bool retrievable = false;
    bool ok = api_ok;
    const char *note = "ok";
    if (!api_ok) {
        ok = false;
        note = err[0] ? err : "api_failed";
    } else if (expect_changed >= 0 && r.changed != (bool)expect_changed) {
        ok = false;
        note = expect_changed ? "expected_compression" : "unexpected_compression";
    }

    const char *effective_text = (api_ok && r.changed && r.text) ? r.text : input;
    size_t effective_len = strlen(effective_text);
    if (!write_all(effective_path, effective_text, effective_len)) {
        ok = false;
        note = "write_effective_failed";
    }

    uint64_t saved = (uint64_t)len > (uint64_t)effective_len ? (uint64_t)len - (uint64_t)effective_len : 0;
    double ratio = len ? (double)effective_len / (double)len : 1.0;

    if (api_ok && r.changed) {
        if (!r.text || !strstr(r.text, "[ds4 compressed tool output]")) {
            ok = false;
            note = "missing_marker";
        }
        if (!r.original_saved || !ds4_context_blob_id_valid(r.blob_id)) {
            ok = false;
            note = "missing_valid_blob";
        }
        if (effective_len >= len) {
            ok = false;
            note = "compression_expanded";
        }
        if (max_ratio >= 0.0 && ratio > max_ratio) {
            ok = false;
            note = "ratio_above_threshold";
        }
        if (r.original_saved) {
            char read_err[256] = {0};
            char *full = ds4_context_blob_read_range(blob_dir, r.blob_id, 0,
                                                     r.original_bytes,
                                                     read_err, sizeof(read_err));
            retrievable = full && strcmp(full, input) == 0;
            free(full);
            if (!retrievable) {
                ok = false;
                note = "blob_not_exactly_retrievable";
            }
        }
    }

    printf("case\tname=%s\ttool=%s\tinput=%s\teffective=%s\tkind=%s\tstrategy=%s\tchanged=%d"
           "\texpected_changed=%s\toriginal_bytes=%" PRIu64 "\teffective_bytes=%" PRIu64
           "\tsaved_bytes=%" PRIu64 "\tbyte_ratio=%.6f\tbyte_saved_pct=%.2f"
           "\toriginal_saved=%d\tretrievable=%d\tpass=%d\tnote=%s\n",
           case_name,
           tool_name,
           input_path,
           effective_path,
           ds4_tool_content_kind_name(r.kind),
           r.strategy[0] ? r.strategy : "none",
           r.changed ? 1 : 0,
           expect_changed < 0 ? "any" : (expect_changed ? "yes" : "no"),
           (uint64_t)len,
           (uint64_t)effective_len,
           saved,
           ratio,
           len ? (100.0 * (double)saved / (double)len) : 0.0,
           r.original_saved ? 1 : 0,
           retrievable ? 1 : 0,
           ok ? 1 : 0,
           note);

    ds4_tool_compress_result_free(&r);
    free(input);
    return ok ? 0 : 1;
}
