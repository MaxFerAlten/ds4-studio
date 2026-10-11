#include "ds4_openwiki_request.h"

#include <stdio.h>

typedef struct { const char *json; int expected; } test_case;

int main(void) {
    static const test_case cases[] = {
        {"{\"message\":\"hi\",\"request\":{\"openwiki_enabled\":true}}", 1},
        {"{\"request\":{\"openwiki_enabled\":false}}", 0},
        {"{\"request\":{}}", 0},
        {"{\"message\":\"request openwiki_enabled true\"}", 0},
        {"{\"other\":{\"request\":{\"openwiki_enabled\":true}}}", 0},
        {"{\"request\":{\"openwiki_enabled\":1}}", 0},
        {"{\"request\":{\"openwiki_enabled\":\"true\"}}", 0},
        {"{\"request\":{\"openwiki_enabled\":truex}}", 0},
        {"{\"request\":{\"openwiki_enabled\":true,\"x\":}}", 0},
        {"{\"request\":{\"openwiki_enabled\":true},\"request\":{}}", 0},
        {"{\"request\":{\"openwiki_enabled\":true,\"openwiki_\\u0065nabled\":false}}", 0},
        {"{\"request\":{\"openwiki_enabled\":true}", 0},
        {"[]", 0},
        {NULL, 0},
    };
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); ++i) {
        int got = ds4_ow_request_enabled(cases[i].json);
        if (got != cases[i].expected) {
            fprintf(stderr, "case %zu expected %d got %d: %s\n", i,
                    cases[i].expected, got,
                    cases[i].json ? cases[i].json : "(null)");
            return 1;
        }
    }
    puts("openwiki request parsing: PASS");
    return 0;
}
