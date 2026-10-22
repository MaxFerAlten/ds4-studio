/* Part of DS4-Studio DeepInfer integration (plan §5.3, PR-05).
 *
 * Golden oracle: renders a Chat Completions body with DS4's own request
 * parsing (parse_messages, parse_tools_value) and prompt renderer
 * (render_chat_prompt_text_for_syntax), the same calls parse_chat_request
 * makes before tokenizing. ds4_server.c is included unmodified, the way
 * tests/ds4_test.c includes it. No engine, model or GPU is involved.
 *
 * usage: ds4_render_oracle deepseek|deepseek41 none|high|max < body.json
 */
#define DS4_SERVER_TEST
#define DS4_SERVER_TEST_NO_MAIN
#include "../../../../ds4_server.c"

#define ORACLE_MAX_BODY (16u << 20)

static char *oracle_read_stdin(void) {
    size_t cap = 1 << 16, len = 0;
    char *buf = xmalloc(cap);
    for (;;) {
        if (len + 1 >= cap) {
            if (cap >= ORACLE_MAX_BODY) return NULL;
            cap *= 2;
            buf = xrealloc(buf, cap);
        }
        size_t n = fread(buf + len, 1, cap - len - 1, stdin);
        if (n == 0) break;
        len += n;
    }
    buf[len] = '\0';
    return buf;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: %s deepseek|deepseek41 none|high|max < body.json\n", argv[0]);
        return 2;
    }
    server_model_syntax syntax;
    if (!strcmp(argv[1], "deepseek")) syntax = SERVER_MODEL_SYNTAX_DEEPSEEK;
    else if (!strcmp(argv[1], "deepseek41")) syntax = SERVER_MODEL_SYNTAX_DEEPSEEK41;
    else return 2;
    ds4_think_mode mode;
    if (!strcmp(argv[2], "none")) mode = DS4_THINK_NONE;
    else if (!strcmp(argv[2], "high")) mode = DS4_THINK_HIGH;
    else if (!strcmp(argv[2], "max")) mode = DS4_THINK_MAX;
    else return 2;

    char *body = oracle_read_stdin();
    if (!body) {
        fprintf(stderr, "body too large\n");
        return 1;
    }
    const char *p = body;
    chat_msgs msgs = {0};
    tool_schema_orders orders = {0};
    char *tool_schemas = NULL;
    bool tool_choice_none = false, got_messages = false;
    json_ws(&p);
    if (*p++ != '{') goto bad;
    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        if (!json_string(&p, &key)) goto bad;
        json_ws(&p);
        if (*p++ != ':') goto bad;
        bool ok;
        if (!strcmp(key, "messages")) {
            ok = parse_messages(&p, &msgs);
            got_messages = ok;
        } else if (!strcmp(key, "tools")) {
            ok = parse_tools_value(&p, &tool_schemas, &orders);
        } else if (!strcmp(key, "tool_choice")) {
            json_ws(&p);
            if (*p == '"') {
                char *choice = NULL;
                ok = json_string(&p, &choice);
                tool_choice_none = ok && !strcmp(choice, "none");
                free(choice);
            } else ok = json_skip_value(&p);
        } else ok = json_skip_value(&p);
        free(key);
        if (!ok) goto bad;
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }
    if (*p != '}' || !got_messages) goto bad;

    /* Same tool gating as parse_chat_request (ds4_server.c:4266-4278). */
    const bool has_tools = tool_schemas && tool_schemas[0] && !tool_choice_none;
    char *prompt = render_chat_prompt_text_for_syntax(
        syntax, &msgs, has_tools ? tool_schemas : NULL, &orders, mode);
    fputs(prompt, stdout);
    free(prompt);
    chat_msgs_free(&msgs);
    tool_schema_orders_free(&orders);
    free(tool_schemas);
    free(body);
    return 0;
bad:
    fprintf(stderr, "invalid JSON request\n");
    return 1;
}
