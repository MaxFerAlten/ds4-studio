/* Unit tests of the Studio-edited agent (studio/ds4_agent.c in a composed
 * shadow).  tests/ds4_agent_test.c includes upstream ../ds4_agent.c, so the
 * Studio layer -- skill registry, epistemic gate, protocol guard, evidence
 * guard -- is only exercised from here.  Makefile.studio passes the Studio
 * source as DS4_AGENT_UPSTREAM_SRC, the same macro ds4_agent_runtime.c uses.
 *
 *   make -f Makefile.studio tests/ds4_agent_runtime_skill_test
 *   ./tests/ds4_agent_runtime_skill_test
 */
#define DS4_AGENT_TEST
#define DS4_AGENT_TEST_NO_MAIN

#ifndef DS4_AGENT_UPSTREAM_SRC
#error "build through Makefile.studio: DS4_AGENT_UPSTREAM_SRC names studio/ds4_agent.c"
#endif
#include DS4_AGENT_UPSTREAM_SRC

int main(void) {
    ds4_agent_unit_tests_run();
    if (agent_test_failures) {
        fprintf(stderr, "ds4-agent studio tests: %d failure(s)\n",
                agent_test_failures);
        return 1;
    }
    puts("ds4-agent studio tests: ok");
    return 0;
}
