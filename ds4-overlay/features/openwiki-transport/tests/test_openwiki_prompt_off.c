#define DS4_AGENT_TEST
#define DS4_AGENT_TEST_NO_MAIN
#include "../studio/ds4_agent.c"

/* Golden fixtures were emitted by the pre-WP09 studio-app-layer patch at
 * 5bda80ab4e08a0d1085f80a8f1f71e788986e4cb, using the same prompt routes. */
enum { TEST_DSML, TEST_GLM, TEST_QWEN, TEST_DSML41 };
static int test_family;
static char *captured_system_messages[8];
static size_t captured_system_message_count;

bool ds4_engine_is_qwen4(ds4_engine *engine) { (void)engine; return test_family == TEST_QWEN; }
bool ds4_engine_is_glm_dsa(ds4_engine *engine) { (void)engine; return test_family == TEST_GLM; }
bool ds4_engine_is_deepseek41(ds4_engine *engine) { (void)engine; return test_family == TEST_DSML41; }
bool ds4_engine_has_vision(ds4_engine *engine) { (void)engine; return false; }

static void capture_system_message(const char *text) {
    if (!text || !text[0] || captured_system_message_count >=
                                sizeof(captured_system_messages) / sizeof(captured_system_messages[0]))
        return;
    captured_system_messages[captured_system_message_count++] = xstrdup(text);
}

void ds4_chat_append_message(ds4_engine *engine, ds4_tokens *tokens,
                             const char *role, const char *content) {
    (void)engine;
    (void)tokens;
    (void)role;
    capture_system_message(content);
}

void ds4_tokenize_rendered_chat(ds4_engine *engine, const char *text,
                                ds4_tokens *tokens) {
    (void)engine;
    (void)tokens;
    capture_system_message(text);
}

/* Minimal deterministic hash/path stubs for the cache-name unit checks. */
void ds4_kvstore_sha1_bytes_hex(const void *ptr, size_t len, char out[41]) {
    const unsigned char *bytes = ptr;
    uint64_t hash = UINT64_C(1469598103934665603);
    for (size_t i = 0; i < len; ++i) hash = (hash ^ bytes[i]) * UINT64_C(1099511628211);
    snprintf(out, 41, "%016llx%016llx%08x", (unsigned long long)hash,
             (unsigned long long)(hash ^ (uint64_t)len), (unsigned)len);
}

char *ds4_kvstore_path_join(const char *dir, const char *name) {
    if (!dir || !name) return NULL;
    size_t n = strlen(dir) + strlen(name) + 2;
    char *path = malloc(n);
    if (path) snprintf(path, n, "%s/%s", dir, name);
    return path;
}

static int sysprompt_cache_paths_are_scoped(void) {
    const char prompt[] = "system prompt with OpenWiki tools";
    char *off = agent_worker_sysprompt_cache_path("/cache", DS4_OW_OFF,
                                                   prompt, sizeof(prompt) - 1, 1);
    char *shadow = agent_worker_sysprompt_cache_path("/cache", DS4_OW_SHADOW,
                                                     prompt, sizeof(prompt) - 1, 1);
    char *on = agent_worker_sysprompt_cache_path("/cache", DS4_OW_ON,
                                                  prompt, sizeof(prompt) - 1, 1);
    char *changed_prompt = agent_worker_sysprompt_cache_path(
        "/cache", DS4_OW_ON, "different prompt", 16, 1);
    char *changed_model = agent_worker_sysprompt_cache_path(
        "/cache", DS4_OW_ON, prompt, sizeof(prompt) - 1, 2);
    int ok = off && shadow && on && changed_prompt && changed_model &&
             !strcmp(off, "/cache/sysprompt.kv") && !strcmp(shadow, off) &&
             strcmp(on, off) != 0 && strcmp(on, changed_prompt) != 0 &&
             strcmp(on, changed_model) != 0;
    free(off); free(shadow); free(on); free(changed_prompt); free(changed_model);
    return ok;
}

static int write_bytes(const char *path, const char *data, size_t len) {
    FILE *fp = fopen(path, "wb");
    if (!fp) return -1;
    int ok = fwrite(data, 1, len, fp) == len && fclose(fp) == 0;
    return ok ? 0 : -1;
}

static int matches_fixture(const char *path, const char *data, size_t len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) return 0;
    if (fseek(fp, 0, SEEK_END) != 0) { fclose(fp); return 0; }
    long size = ftell(fp);
    if (size < 0 || (uintmax_t)size != len || fseek(fp, 0, SEEK_SET) != 0) {
        fclose(fp);
        return 0;
    }
    char *golden = malloc(len ? len : 1);
    if (!golden) { fclose(fp); return 0; }
    size_t read_len = fread(golden, 1, len, fp);
    int close_ok = fclose(fp) == 0;
    int ok = read_len == len && close_ok && !memcmp(data, golden, len);
    free(golden);
    return ok;
}

static int system_prompt_off_matches_fixture(ds4_engine *engine,
                                             const char *fixture_path) {
    ds4_tokens tokens = {0};
    captured_system_message_count = 0;
    agent_append_system_prompt(engine, &tokens, "OpenWiki baseline test",
                               false, false, false);
    char *expected_note = agent_build_conduct_note(true);
    static const char expected_extra[] = "\n\nOpenWiki baseline test";
    int ok = captured_system_message_count == 3 &&
             matches_fixture(fixture_path, captured_system_messages[0],
                             strlen(captured_system_messages[0])) &&
             !strcmp(captured_system_messages[1], expected_note) &&
             !strcmp(captured_system_messages[2], expected_extra);
    free(expected_note);
    for (size_t i = 0; i < captured_system_message_count; i++) {
        free(captured_system_messages[i]);
        captured_system_messages[i] = NULL;
    }
    captured_system_message_count = 0;
    return ok;
}

static int prompts_have_openwiki_tools(const char *first, const char *second) {
    return first && second && strstr(first, "openwiki_search") &&
           strstr(first, "openwiki_read") && strlen(first) == strlen(second) &&
           !memcmp(first, second, strlen(first));
}

static int parser_accepts_openwiki_read(agent_tool_syntax syntax) {
    const char *text =
        syntax == AGENT_TOOL_SYNTAX_QWEN
            ? "<tool_call>\n<function=openwiki_read>\n<parameter=page>Guide\n</parameter>\n<parameter=section>Setup\n</parameter>\n</function>\n</tool_call>"
        : syntax == AGENT_TOOL_SYNTAX_GLM
            ? "<tool_call>openwiki_read<arg_key>page</arg_key><arg_value>Guide</arg_value><arg_key>section</arg_key><arg_value>Setup</arg_value></tool_call>"
        : syntax == AGENT_TOOL_SYNTAX_DSML41
            ? "<｜DSML｜ calls><｜DSML｜ invoke name=\"openwiki_read\"><｜DSML｜ parameter name=\"page\" string=\"true\">Guide</｜DSML｜ parameter><｜DSML｜ parameter name=\"section\" string=\"true\">Setup</｜DSML｜ parameter></｜DSML｜ invoke></｜DSML｜ calls>"
            : "<｜DSML｜tool_calls><｜DSML｜invoke name=\"openwiki_read\"><｜DSML｜parameter name=\"page\" string=\"true\">Guide</｜DSML｜parameter><｜DSML｜parameter name=\"section\" string=\"true\">Setup</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>";
    agent_dsml_parser p = {.syntax = syntax, .state = AGENT_DSML_SEARCH};
    agent_dsml_feed(&p, text, strlen(text));
    agent_dsml_finish(&p);
    const char *page = p.calls.len == 1
        ? agent_tool_arg_value(&p.calls.v[0], "page") : NULL;
    const char *section = p.calls.len == 1
        ? agent_tool_arg_value(&p.calls.v[0], "section") : NULL;
    int ok = p.state == AGENT_DSML_DONE && p.calls.len == 1 &&
             p.calls.v[0].name && !strcmp(p.calls.v[0].name, "openwiki_read") &&
             p.calls.v[0].argc == 2 &&
             page && !strcmp(page, "Guide") && section && !strcmp(section, "Setup");
    agent_dsml_parser_free(&p);
    return ok;
}

static int parser_accepts_openwiki_search(agent_tool_syntax syntax) {
    const char *text =
        syntax == AGENT_TOOL_SYNTAX_QWEN
            ? "<tool_call>\n<function=openwiki_search>\n<parameter=query>OpenWiki search\n</parameter>\n<parameter=limit>3\n</parameter>\n</function>\n</tool_call>"
        : syntax == AGENT_TOOL_SYNTAX_GLM
            ? "<tool_call>openwiki_search<arg_key>query</arg_key><arg_value>OpenWiki search</arg_value><arg_key>limit</arg_key><arg_value>3</arg_value></tool_call>"
        : syntax == AGENT_TOOL_SYNTAX_DSML41
            ? "<｜DSML｜ calls><｜DSML｜ invoke name=\"openwiki_search\"><｜DSML｜ parameter name=\"query\" string=\"true\">OpenWiki search</｜DSML｜ parameter><｜DSML｜ parameter name=\"limit\" string=\"true\">3</｜DSML｜ parameter></｜DSML｜ invoke></｜DSML｜ calls>"
            : "<｜DSML｜tool_calls><｜DSML｜invoke name=\"openwiki_search\"><｜DSML｜parameter name=\"query\" string=\"true\">OpenWiki search</｜DSML｜parameter><｜DSML｜parameter name=\"limit\" string=\"true\">3</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>";
    agent_dsml_parser p = {.syntax = syntax, .state = AGENT_DSML_SEARCH};
    agent_dsml_feed(&p, text, strlen(text));
    agent_dsml_finish(&p);
    const char *query = p.calls.len == 1
        ? agent_tool_arg_value(&p.calls.v[0], "query") : NULL;
    const char *limit = p.calls.len == 1
        ? agent_tool_arg_value(&p.calls.v[0], "limit") : NULL;
    int ok = p.state == AGENT_DSML_DONE && p.calls.len == 1 &&
             p.calls.v[0].name && !strcmp(p.calls.v[0].name, "openwiki_search") &&
             p.calls.v[0].argc == 2 && query && !strcmp(query, "OpenWiki search") &&
             limit && !strcmp(limit, "3");
    if (!ok) {
        fprintf(stderr, "openwiki_search parser failed: syntax=%d state=%d calls=%d argc=%d name=%s query=%s limit=%s error=%s\n",
                syntax, p.state, p.calls.len,
                p.calls.len == 1 ? p.calls.v[0].argc : -1,
                p.calls.len == 1 && p.calls.v[0].name ? p.calls.v[0].name : "(none)",
                query ? query : "(none)", limit ? limit : "(none)", p.error);
    }
    agent_dsml_parser_free(&p);
    return ok;
}

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    if (!sysprompt_cache_paths_are_scoped()) return 1;
    static const char *names[] = {"deepseek", "glm", "qwen", "dsml41"};
    ds4_engine *engine = NULL;
    for (test_family = TEST_DSML; test_family <= TEST_DSML41; test_family++) {
        char actual_path[PATH_MAX], fixture_path[PATH_MAX];
        snprintf(actual_path, sizeof(actual_path), "%s/%s.actual", argv[1], names[test_family]);
        snprintf(fixture_path, sizeof(fixture_path), "%s/%s.prompt", argv[2], names[test_family]);
        char *actual = agent_build_tools_prompt_for_engine(engine, false, false, false);
        size_t actual_len = strlen(actual);
        int ok = matches_fixture(fixture_path, actual, actual_len) &&
                 write_bytes(actual_path, actual, actual_len) == 0 &&
                 system_prompt_off_matches_fixture(engine, fixture_path);
        free(actual);
        if (!ok) return 1;
    }

    static const char *on_names[] = {"deepseek.on", "glm.on", "qwen.on", "dsml41.on"};
    static const agent_tool_syntax syntaxes[] = {
        AGENT_TOOL_SYNTAX_DSML, AGENT_TOOL_SYNTAX_GLM,
        AGENT_TOOL_SYNTAX_QWEN, AGENT_TOOL_SYNTAX_DSML41
    };
    for (size_t i = 0; i < sizeof(syntaxes) / sizeof(syntaxes[0]); i++) {
        test_family = (int)i;
        char path[PATH_MAX];
        char *prompt = agent_build_tools_prompt_for_engine(engine, false, false, true);
        char *repeat = agent_build_tools_prompt_for_engine(engine, false, false, true);
        snprintf(path, sizeof(path), "%s/%s", argv[1], on_names[i]);
        int ok = prompts_have_openwiki_tools(prompt, repeat) &&
                 write_bytes(path, prompt, strlen(prompt)) == 0;
        snprintf(path, sizeof(path), "%s/%s.repeat", argv[1], on_names[i]);
        ok = ok && write_bytes(path, repeat, strlen(repeat)) == 0 &&
                 parser_accepts_openwiki_read(syntaxes[i]) &&
                 parser_accepts_openwiki_search(syntaxes[i]);
        if (!ok) fprintf(stderr, "OpenWiki ON prompt/parser check failed for %s\n", on_names[i]);
        free(prompt);
        free(repeat);
        if (!ok) return 1;
    }
    char reminder_path[PATH_MAX];
    char *baseline_reminder = agent_build_system_prompt_reminder();
    snprintf(reminder_path, sizeof(reminder_path), "%s/reminder.baseline", argv[1]);
    if (!baseline_reminder || write_bytes(reminder_path, baseline_reminder,
                                           strlen(baseline_reminder)) != 0) return 1;
    free(baseline_reminder);
    for (size_t i = 0; i < sizeof(syntaxes) / sizeof(syntaxes[0]); i++) {
        test_family = (int)i;
        char off_path[PATH_MAX], on_path[PATH_MAX], repeat_path[PATH_MAX];
        snprintf(off_path, sizeof(off_path), "%s/%s.reminder.off", argv[1], names[i]);
        snprintf(on_path, sizeof(on_path), "%s/%s.reminder.on", argv[1], names[i]);
        snprintf(repeat_path, sizeof(repeat_path), "%s/%s.reminder.on.repeat", argv[1], names[i]);
        char *off = agent_build_system_prompt_reminder_for_engine(engine, false);
        char *on = agent_build_system_prompt_reminder_for_engine(engine, true);
        char *repeat = agent_build_system_prompt_reminder_for_engine(engine, true);
        int ok = off && on && repeat &&
                 write_bytes(off_path, off, strlen(off)) == 0 &&
                 write_bytes(on_path, on, strlen(on)) == 0 &&
                 write_bytes(repeat_path, repeat, strlen(repeat)) == 0;
        free(off);
        free(on);
        free(repeat);
        if (!ok) return 1;
    }
    char schema_path[PATH_MAX];
    snprintf(schema_path, sizeof(schema_path), "%s/openwiki-schemas.jsonl", argv[1]);
    if (write_bytes(schema_path, agent_openwiki_tool_schemas,
                    strlen(agent_openwiki_tool_schemas)) != 0) return 1;
    snprintf(schema_path, sizeof(schema_path), "%s/openwiki-dsml-schemas.txt", argv[1]);
    if (write_bytes(schema_path, agent_openwiki_dsml_tool_schemas,
                    strlen(agent_openwiki_dsml_tool_schemas)) != 0) return 1;

    /* The config's zero/default state is OFF and does not initialize a client. */
    agent_config cfg = {0};
    return cfg.openwiki_enabled ? 1 : 0;
}
