#include "../ds4_crawl_grounding.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures;

#define CHECK(condition) do {                                                \
    if (!(condition)) {                                                      \
        fprintf(stderr, "%s:%d: check failed: %s\n",                       \
                __FILE__, __LINE__, #condition);                             \
        failures++;                                                          \
    }                                                                        \
} while (0)

static ds4_crawl_source_status extract(const char *manifest, size_t max_bytes,
                                       char **source, bool *truncated,
                                       char *err, size_t err_len) {
    *source = (char *)0x1;
    *truncated = true;
    if (err_len > 0)
        memset(err, 'x', err_len);
    return ds4_crawl_extract_source(manifest, max_bytes, source, truncated,
                                    err, err_len);
}

static bool valid_utf8(const unsigned char *s) {
    while (*s) {
        size_t continuation;
        unsigned char lead = *s++;

        if (lead < 0x80)
            continue;
        if (lead >= 0xc2 && lead <= 0xdf)
            continuation = 1;
        else if (lead >= 0xe0 && lead <= 0xef)
            continuation = 2;
        else if (lead >= 0xf0 && lead <= 0xf4)
            continuation = 3;
        else
            return false;
        while (continuation--) {
            if ((*s & 0xc0) != 0x80)
                return false;
            s++;
        }
    }
    return true;
}

static void test_missing_and_empty_manifest(void) {
    char *source;
    bool truncated;
    char err[128];

    CHECK(extract(NULL, 1024, &source, &truncated, err, sizeof(err)) ==
          DS4_CRAWL_SOURCE_EMPTY);
    CHECK(source == NULL);
    CHECK(!truncated);
    CHECK(err[0] == '\0');

    CHECK(extract("{}", 1024, &source, &truncated, err, sizeof(err)) ==
          DS4_CRAWL_SOURCE_EMPTY);
    CHECK(source == NULL);
    CHECK(!truncated);
    CHECK(err[0] == '\0');
}

static void test_empty_text_is_invalid_json(void) {
    const char *manifests[] = {"", " \n\t\r "};
    size_t i;

    for (i = 0; i < sizeof(manifests) / sizeof(manifests[0]); i++) {
        char *source;
        bool truncated;
        char err[128];

        CHECK(extract(manifests[i], 1024, &source, &truncated,
                      err, sizeof(err)) == DS4_CRAWL_SOURCE_INVALID);
        CHECK(source == NULL);
        CHECK(!truncated);
        CHECK(err[0] != '\0');
    }
}

static void test_whitespace_only_success_is_empty(void) {
    const char *manifest =
        "{\"pages\":[{\"state\":\"succeeded\","
        "\"content\":\" \\n\\t  \\r\"}]}";
    char *source;
    bool truncated;
    char err[128];

    CHECK(extract(manifest, 1024, &source, &truncated, err, sizeof(err)) ==
          DS4_CRAWL_SOURCE_EMPTY);
    CHECK(source == NULL);
    CHECK(!truncated);
}

static void test_failed_pages_are_ignored(void) {
    const char *manifest =
        "{\"pages\":[{\"state\":\"failed\","
        "\"content\":\"This text must not be summarized\"}]}";
    char *source;
    bool truncated;
    char err[128];

    CHECK(extract(manifest, 1024, &source, &truncated, err, sizeof(err)) ==
          DS4_CRAWL_SOURCE_EMPTY);
    CHECK(source == NULL);
    CHECK(!truncated);
}

static void test_failed_page_with_escaped_nul_is_ignored(void) {
    const char *manifest =
        "{\"pages\":[{\"content\":\"ignored\\u0000text\","
        "\"state\":\"failed\"}]}";
    char *source;
    bool truncated;
    char err[128];

    CHECK(extract(manifest, 1024, &source, &truncated, err, sizeof(err)) ==
          DS4_CRAWL_SOURCE_EMPTY);
    CHECK(source == NULL);
    CHECK(!truncated);
    CHECK(err[0] == '\0');
}

static void test_successful_page_with_escaped_nul_is_invalid(void) {
    const char *manifest =
        "{\"pages\":[{\"state\":\"succeeded\","
        "\"content\":\"unsafe\\u0000text\"}]}";
    char *source;
    bool truncated;
    char err[128];

    CHECK(extract(manifest, 1024, &source, &truncated, err, sizeof(err)) ==
          DS4_CRAWL_SOURCE_INVALID);
    CHECK(source == NULL);
    CHECK(!truncated);
    CHECK(err[0] != '\0');
}

static void test_malformed_json_is_invalid(void) {
    const char *manifest =
        "{\"pages\":[{\"state\":\"succeeded\",\"content\":\"oops\"}]";
    char *source;
    bool truncated;
    char err[128];

    CHECK(extract(manifest, 1024, &source, &truncated, err, sizeof(err)) ==
          DS4_CRAWL_SOURCE_INVALID);
    CHECK(source == NULL);
    CHECK(!truncated);
    CHECK(err[0] != '\0');
}

static void test_medium_style_content_is_decoded(void) {
    const char *manifest =
        "{\"job\":\"medium\",\"pages\":[{\"url\":\"https://medium.com/x\","
        "\"state\":\"succeeded\",\"content\":"
        "\"Line one\\nQuote: \\\"yes\\\"; slash: \\\\; apostrophe: "
        "\\u2019; emoji: \\uD83D\\uDE00\"}]}";
    const char *expected =
        "Line one\nQuote: \"yes\"; slash: \\; apostrophe: "
        "\xe2\x80\x99; emoji: \xf0\x9f\x98\x80";
    char *source;
    bool truncated;
    char err[128];

    CHECK(extract(manifest, 4096, &source, &truncated, err, sizeof(err)) ==
          DS4_CRAWL_SOURCE_OK);
    CHECK(source != NULL);
    if (source != NULL)
        CHECK(strcmp(source, expected) == 0);
    CHECK(!truncated);
    free(source);
}

static void test_successful_pages_have_unambiguous_separator(void) {
    const char *manifest =
        "{\"pages\":["
        "{\"state\":\"succeeded\",\"content\":\"first page\"},"
        "{\"state\":\"failed\",\"content\":\"ignored\"},"
        "{\"content\":\"second page\",\"state\":\"succeeded\"}]}";
    char *source;
    bool truncated;
    char err[128];

    CHECK(extract(manifest, 4096, &source, &truncated, err, sizeof(err)) ==
          DS4_CRAWL_SOURCE_OK);
    CHECK(source != NULL);
    if (source != NULL)
        CHECK(strcmp(source,
                     "first page\n\n--- PAGE BREAK ---\n\nsecond page") == 0);
    CHECK(!truncated);
    free(source);
}

static void test_truncation_preserves_utf8_codepoints(void) {
    const char *manifest =
        "{\"pages\":[{\"state\":\"succeeded\","
        "\"content\":\"ab\\u20acZ\"}]}";
    char *source;
    bool truncated;
    char err[128];

    CHECK(extract(manifest, 4, &source, &truncated, err, sizeof(err)) ==
          DS4_CRAWL_SOURCE_OK);
    CHECK(source != NULL);
    if (source != NULL) {
        CHECK(strlen(source) <= 4);
        CHECK(strcmp(source, "ab") == 0);
        CHECK(valid_utf8((const unsigned char *)source));
    }
    CHECK(truncated);
    free(source);
}

static void test_verify_full_evidence(void) {
    const char *source = "The sky is blue and grass is green.";
    const char *verifier =
        "{\"semantic_support\": 80, "
        "\"evidence\": [\"sky is blue\", \"grass is green\"]}";
    ds4_crawl_verification v;
    char err[128];

    CHECK(ds4_crawl_verify_result(source, verifier, &v, err, sizeof(err)) == 0);
    CHECK(v.semantic_score == 80);
    CHECK(v.evidence_total == 2);
    CHECK(v.evidence_found == 2);
    CHECK(v.accuracy_score == 84); /* 0.8*80 + 0.2*100 */
}

static void test_verify_partial_evidence(void) {
    const char *source = "The sky is blue.";
    const char *verifier =
        "{\"semantic_support\":80,"
        "\"evidence\":[\"sky is blue\",\"grass is green\"]}";
    ds4_crawl_verification v;
    char err[128];

    CHECK(ds4_crawl_verify_result(source, verifier, &v, err, sizeof(err)) == 0);
    CHECK(v.evidence_total == 2);
    CHECK(v.evidence_found == 1);
    CHECK(v.accuracy_score == 74); /* 0.8*80 + 0.2*50 */
}

static void test_verify_no_evidence_uses_semantic(void) {
    const char *verifier = "{\"semantic_support\": 91, \"evidence\": []}";
    ds4_crawl_verification v;
    char err[128];

    CHECK(ds4_crawl_verify_result("anything", verifier, &v, err,
                                  sizeof(err)) == 0);
    CHECK(v.evidence_total == 0);
    CHECK(v.evidence_found == 0);
    CHECK(v.accuracy_score == 91);
}

static void test_verify_hallucinated_evidence(void) {
    const char *verifier =
        "{\"semantic_support\":100,\"evidence\":[\"not present here\"]}";
    ds4_crawl_verification v;
    char err[128];

    CHECK(ds4_crawl_verify_result("only this text", verifier, &v, err,
                                  sizeof(err)) == 0);
    CHECK(v.evidence_total == 1);
    CHECK(v.evidence_found == 0);
    CHECK(v.accuracy_score == 80); /* 0.8*100 + 0.2*0 */
}

static void test_verify_whitespace_normalized_match(void) {
    const char *source = "alpha   beta\n\tgamma";
    const char *verifier =
        "{\"semantic_support\":50,\"evidence\":[\"alpha beta gamma\"]}";
    ds4_crawl_verification v;
    char err[128];

    CHECK(ds4_crawl_verify_result(source, verifier, &v, err, sizeof(err)) == 0);
    CHECK(v.evidence_total == 1);
    CHECK(v.evidence_found == 1);
    CHECK(v.accuracy_score == 60); /* 0.8*50 + 0.2*100 */
}

static void test_verify_empty_excerpts_ignored(void) {
    const char *verifier =
        "{\"semantic_support\":60,\"evidence\":[\"\",\"  \"]}";
    ds4_crawl_verification v;
    char err[128];

    CHECK(ds4_crawl_verify_result("source", verifier, &v, err,
                                  sizeof(err)) == 0);
    CHECK(v.evidence_total == 0);
    CHECK(v.accuracy_score == 60);
}

static void test_verify_missing_score_fails(void) {
    const char *verifier = "{\"evidence\":[\"x\"]}";
    ds4_crawl_verification v;
    char err[128];

    CHECK(ds4_crawl_verify_result("x", verifier, &v, err, sizeof(err)) != 0);
    CHECK(err[0] != '\0');
}

static void test_verify_malformed_json_fails(void) {
    ds4_crawl_verification v;
    char err[128];

    CHECK(ds4_crawl_verify_result("x", "not json at all", &v, err,
                                  sizeof(err)) != 0);
    CHECK(err[0] != '\0');
}

static void test_verify_clamps_out_of_range_score(void) {
    const char *verifier = "{\"semantic_support\": 250}";
    ds4_crawl_verification v;
    char err[128];

    CHECK(ds4_crawl_verify_result("x", verifier, &v, err, sizeof(err)) == 0);
    CHECK(v.semantic_score == 100);
    CHECK(v.accuracy_score == 100);
}

static void test_verify_tolerates_surrounding_prose(void) {
    const char *source = "fact one";
    const char *verifier =
        "Here is my assessment:\n```json\n"
        "{\"semantic_support\": 70, \"evidence\": [\"fact one\"]}\n"
        "```\nDone.";
    ds4_crawl_verification v;
    char err[128];

    CHECK(ds4_crawl_verify_result(source, verifier, &v, err, sizeof(err)) == 0);
    CHECK(v.semantic_score == 70);
    CHECK(v.evidence_found == 1);
    CHECK(v.accuracy_score == 76); /* 0.8*70 + 0.2*100 */
}

int main(void) {
    test_missing_and_empty_manifest();
    test_empty_text_is_invalid_json();
    test_whitespace_only_success_is_empty();
    test_failed_pages_are_ignored();
    test_failed_page_with_escaped_nul_is_ignored();
    test_successful_page_with_escaped_nul_is_invalid();
    test_malformed_json_is_invalid();
    test_medium_style_content_is_decoded();
    test_successful_pages_have_unambiguous_separator();
    test_truncation_preserves_utf8_codepoints();
    test_verify_full_evidence();
    test_verify_partial_evidence();
    test_verify_no_evidence_uses_semantic();
    test_verify_hallucinated_evidence();
    test_verify_whitespace_normalized_match();
    test_verify_empty_excerpts_ignored();
    test_verify_missing_score_fails();
    test_verify_malformed_json_fails();
    test_verify_clamps_out_of_range_score();
    test_verify_tolerates_surrounding_prose();

    if (failures != 0) {
        fprintf(stderr, "ds4 crawl grounding tests: %d failure(s)\n", failures);
        return 1;
    }
    puts("ds4 crawl grounding tests: ok");
    return 0;
}
