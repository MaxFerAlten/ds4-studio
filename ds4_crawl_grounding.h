#ifndef DS4_CRAWL_GROUNDING_H
#define DS4_CRAWL_GROUNDING_H

#include <stdbool.h>
#include <stddef.h>

typedef enum {
    DS4_CRAWL_SOURCE_OK = 0,
    DS4_CRAWL_SOURCE_INVALID,
    DS4_CRAWL_SOURCE_EMPTY
} ds4_crawl_source_status;

typedef struct {
    int semantic_score;
    size_t evidence_total;
    size_t evidence_found;
    int accuracy_score;
} ds4_crawl_verification;

ds4_crawl_source_status ds4_crawl_extract_source(
    const char *manifest, size_t max_bytes,
    char **source_out, bool *truncated_out,
    char *err, size_t err_len);

int ds4_crawl_verify_result(
    const char *source, const char *verifier_json,
    ds4_crawl_verification *out,
    char *err, size_t err_len);

#endif
