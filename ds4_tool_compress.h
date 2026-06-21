#ifndef DS4_TOOL_COMPRESS_H
#define DS4_TOOL_COMPRESS_H

#include "ds4_context_blob.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum ds4_tool_content_kind {
    DS4_TOOL_CONTENT_UNKNOWN = 0,
    DS4_TOOL_CONTENT_SEARCH,
    DS4_TOOL_CONTENT_LOG,
    DS4_TOOL_CONTENT_JSON_ARRAY,
    DS4_TOOL_CONTENT_DIFF,
    DS4_TOOL_CONTENT_FILE,
    DS4_TOOL_CONTENT_TRACE
} ds4_tool_content_kind;

typedef struct ds4_tool_compress_result {
    bool changed;
    bool original_saved;
    ds4_tool_content_kind kind;
    char strategy[64];
    char blob_id[80];
    uint64_t original_bytes;
    uint64_t compressed_bytes;
    uint64_t omitted_lines;
    char *text;
} ds4_tool_compress_result;

ds4_tool_content_kind ds4_tool_classify_output(const char *tool_name,
                                               const char *text,
                                               size_t len);

/* Compress only freshly produced tool output.  Lossy outputs are stored in the
 * context blob store first; if that fails, this returns false so callers can
 * append the original safely. */
bool ds4_tool_compress_result_text(const char *tool_name,
                                   const char *text,
                                   size_t len,
                                   const char *blob_base_dir,
                                   ds4_tool_compress_result *out,
                                   char *err,
                                   size_t err_len);

void ds4_tool_compress_result_free(ds4_tool_compress_result *r);
const char *ds4_tool_content_kind_name(ds4_tool_content_kind kind);

#endif /* DS4_TOOL_COMPRESS_H */
