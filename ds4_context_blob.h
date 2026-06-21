#ifndef DS4_CONTEXT_BLOB_H
#define DS4_CONTEXT_BLOB_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct ds4_context_blob_ref {
    char id[80];
    char path[1024];
    uint64_t bytes;
    uint64_t created_at;
} ds4_context_blob_ref;

/* Store exact text under base_dir/sha256/<hex>.txt and return id=sha256:<hex>.
 * Existing blobs are reused; callers own no additional resources. */
bool ds4_context_blob_put_text(const char *base_dir,
                               const char *text,
                               size_t len,
                               ds4_context_blob_ref *out,
                               char *err,
                               size_t err_len);

/* Read an exact byte range from a stored blob.  The returned string is
 * NUL-terminated and must be freed by the caller.  Offset past EOF returns an
 * allocated empty string. */
char *ds4_context_blob_read_range(const char *base_dir,
                                  const char *id,
                                  uint64_t offset,
                                  uint64_t length,
                                  char *err,
                                  size_t err_len);

bool ds4_context_blob_id_valid(const char *id);

#endif /* DS4_CONTEXT_BLOB_H */
