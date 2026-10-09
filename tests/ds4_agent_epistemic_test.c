/* Native epistemic turn state: command classification (piano WP17).
 *
 * The classifier decides whether a bash call ran a test or a benchmark, which
 * is the execution evidence the epistemic gate (and the evidence guard on top
 * of it) relies on.  Only the executable of each command segment may decide
 * that; a word deep inside an argument list must never become one.
 *
 *   make -f Makefile.studio tests/ds4_agent_epistemic_test
 */
#include "ds4_agent_epistemic.h"

#include <stdio.h>
#include <string.h>

static int failures;

#define CHECK(expr) do { \
    if (!(expr)) { \
        fprintf(stderr, "%s:%d: assertion failed: %s\n", \
                __FILE__, __LINE__, #expr); \
        failures++; \
    } \
} while (0)

static bool is_test(const char *command) {
    ds4_agent_epistemic_turn turn;
    ds4_agent_epistemic_turn_reset(&turn);
    ds4_agent_epistemic_note_command(&turn, command, NULL);
    return turn.observed_test_command;
}

static bool is_benchmark(const char *command) {
    ds4_agent_epistemic_turn turn;
    ds4_agent_epistemic_turn_reset(&turn);
    ds4_agent_epistemic_note_command(&turn, command, NULL);
    return turn.observed_benchmark_command;
}

/* "echo w1 w2 ... wN" with `word` placed at token position `pos` (1-based,
 * the executable being token 1). */
static void innocuous_command(char *buf, size_t len, int tokens,
                              int pos, const char *word) {
    size_t used = (size_t)snprintf(buf, len, "echo");
    for (int i = 2; i <= tokens && used < len; i++)
        used += (size_t)snprintf(buf + used, len - used, " %s",
                                 i == pos ? word : "arg");
}

static void test_real_executable(void) {
    CHECK(is_test("pytest -q tests/"));
    CHECK(is_test("/usr/bin/pytest"));
    CHECK(is_test("rtk pytest"));
    CHECK(is_test("npm run test:unit"));
    CHECK(is_test("make -C build test"));
    CHECK(!is_test("ls -la"));
}

static void test_word_33_is_not_an_executable(void) {
    char cmd[4096];
    innocuous_command(cmd, sizeof(cmd), 40, 33, "pytest");
    CHECK(!is_test(cmd));
    innocuous_command(cmd, sizeof(cmd), 70, 65, "pytest");
    CHECK(!is_test(cmd));
    innocuous_command(cmd, sizeof(cmd), 40, 33, "hyperfine");
    CHECK(!is_benchmark(cmd));
}

static void test_operators_start_new_segments(void) {
    CHECK(is_test("echo start && pytest"));
    CHECK(is_test("cd tests; pytest -x"));
    CHECK(is_test("false || pytest"));
    CHECK(is_test("cat list | xargs pytest") == false); /* xargs is the executable */
    /* Past 32 words a real operator still opens a real command. */
    char cmd[4096];
    innocuous_command(cmd, sizeof(cmd), 50, 0, "");
    strncat(cmd, " && pytest -q", sizeof(cmd) - strlen(cmd) - 1);
    CHECK(is_test(cmd));
}

static void test_quoted_words_are_arguments(void) {
    CHECK(!is_test("echo \"pytest\""));
    CHECK(!is_test("printf 'pytest'"));
    CHECK(!is_test("echo 'run pytest && done'")); /* && inside quotes */
    CHECK(!is_test("grep -r \"pytest; npm test\" docs"));
}

static void test_long_command_without_operators(void) {
    char cmd[8192];
    /* > 128 words, every one of them a test runner name except the first. */
    size_t used = (size_t)snprintf(cmd, sizeof(cmd), "echo");
    for (int i = 0; i < 140 && used < sizeof(cmd); i++)
        used += (size_t)snprintf(cmd + used, sizeof(cmd) - used, " pytest");
    CHECK(!is_test(cmd));
}

int main(void) {
    test_real_executable();
    test_word_33_is_not_an_executable();
    test_operators_start_new_segments();
    test_quoted_words_are_arguments();
    test_long_command_without_operators();
    if (failures) {
        fprintf(stderr, "epistemic tests: %d failure(s)\n", failures);
        return 1;
    }
    puts("epistemic tests: ok");
    return 0;
}
