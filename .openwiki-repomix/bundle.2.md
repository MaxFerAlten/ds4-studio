This file is a merged representation of a subset of the codebase, containing files not matching ignore patterns, combined into a single document by Repomix.
The content has been processed where security check has been disabled.

# File Summary

## Purpose
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching these patterns are excluded: **/node_modules/**, **/__pycache__/**, **/.*/**, **/dist/**, **/build/**, **/temp/**, **/tmp/**, **/ultimate/**, **/reasoningfromagentic/**, **/gguf-tools/**, **/ggml/**, **/doc/**, **/docs/**, **/openwiki/**, **/openwiki-doc/**, **/graphify-out/**, **/speed-bench/**, **/*.orig, **/*.sage, **/*.sage.py, ds4_metal.m
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Security check has been disabled - content may contain sensitive information
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
benchmarks/
  agentic/
    pony/
      .gitignore
      README.md
      run.mjs
      tasks.mjs
crawl_service/
  src/
    ds4_crawl/
      migrations/
        001_initial.sql
      __init__.py
      adapter.py
      app.py
      artifacts.py
      auth.py
      cli.py
      models.py
      parity.py
      plugins.py
      previews.py
      repository.py
      runner.py
      serialize.py
      sessions.py
      settings.py
  tests/
    fixtures/
      __init__.py
      site.py
    conftest.py
    test_adapter_parity.py
    test_artifacts.py
    test_plugins_serialize.py
    test_previews.py
    test_repository.py
    test_runner.py
    test_settings.py
  .gitignore
  pyproject.toml
dir-steering/
  examples/
    eval_prompts.txt
    succinct.txt
    verbose.txt
  tools/
    build_direction.py
    run_sweep.py
  .gitignore
  README.md
frontend/
  scripts/
    reauth-prism.sh
  server/
    research/
      prompts/
        coordinator.md
        planner.md
        reporter.md
        researcher.md
        rewrite.md
        team.md
      providers/
        aliyunProvider.mjs
        arxivProvider.mjs
        arxivProvider.test.mjs
        baiduProvider.mjs
        baseSearchProvider.mjs
        cnProviders.test.mjs
        cnrProvider.mjs
        cnrProvider.test.mjs
        jinaReaderProvider.mjs
        openAlexProvider.mjs
        openTripMapProvider.mjs
        openTripMapProvider.test.mjs
        providers.mjs
        providers.test.mjs
        scrapingBeeProvider.mjs
        scrapingBeeProvider.test.mjs
        serpApiProvider.mjs
        serpApiProvider.test.mjs
        tavilyProvider.mjs
        tripAdvisorProvider.mjs
        tripAdvisorProvider.test.mjs
        wikipediaProvider.mjs
        worldBankProvider.mjs
        worldBankProvider.test.mjs
      authorVerification.mjs
      authorVerification.test.mjs
      geminiResearchClient.mjs
      geminiResearchClient.test.mjs
      geminiResearchEngine.mjs
      geminiResearchEngine.test.mjs
      localGraphEngine.mjs
      orcidClient.mjs
      orcidClient.test.mjs
      pageReader.mjs
      pageReader.test.mjs
      phase1Certification.test.mjs
      phase2bCertification.test.mjs
      phase2cCertification.test.mjs
      phase2Certification.test.mjs
      prismResearchClient.mjs
      prismResearchClient.test.mjs
      prismResearchEngine.mjs
      prismResearchEngine.test.mjs
      rateLimiter.mjs
      rateLimiter.test.mjs
      researchConfig.mjs
      researchConfig.test.mjs
      researchDocuments.test.mjs
      researchEvents.mjs
      researchEvents.test.mjs
      researchExport.mjs
      researchExport.test.mjs
      researchGraph.mjs
      researchGraph.test.mjs
      researchModelClient.mjs
      researchModelClient.test.mjs
      researchNodes.mjs
      researchNodes.test.mjs
      researchPrompts.mjs
      researchPrompts.test.mjs
      researchRag.mjs
      researchRag.test.mjs
      researchRuntime.mjs
      researchRuntime.test.mjs
      researchSearchService.mjs
      researchSearchService.test.mjs
      researchSources.mjs
      researchSources.test.mjs
      researchStateStore.mjs
      researchStateStore.test.mjs
      searchPlatformSelector.mjs
      searchPlatformSelector.test.mjs
      sourceCache.mjs
      sourceCache.test.mjs
      sourceQuality.mjs
      sourceQuality.test.mjs
      ssrfGuard.mjs
      ssrfGuard.test.mjs
      webSources.mjs
      webSources.test.mjs
    agentAutonomy.mjs
    agentAutonomy.test.mjs
    agentCapabilities.mjs
    agentCapabilities.test.mjs
    agentChatEndpoint.test.mjs
    agentGitnexusPolicy.mjs
    agentGitnexusPolicy.test.mjs
    agentLoopGuard.mjs
    agentLoopGuard.test.mjs
    agentOutputCompressionFlow.test.mjs
    agentPipeline.e2e.test.mjs
    agentPonyPolicy.mjs
    agentPonyPolicy.test.mjs
    agentReadLoop.test.mjs
    agentRuntimeRules.mjs
    agentRuntimeRules.test.mjs
    agentSession.mjs
    agentSession.test.mjs
    agentTaskState.mjs
    agentTaskState.test.mjs
    agentTools.mjs
    agentTools.test.mjs
    amdSmi.mjs
    amdSmi.test.mjs
    backendRetry.mjs
    backendRetry.test.mjs
    buildFlags.test.mjs
    callDebug.mjs
    callDebug.test.mjs
    certifyChatCompression.test.mjs
    chatCompression.test.mjs
    chatHistory.mjs
    chatHistory.test.mjs
    claimGuard.mjs
    claimGuard.test.mjs
    commandBuilder.mjs
    commandBuilder.test.mjs
    config.mjs
    config.test.mjs
    costLimits.mjs
    costLimits.test.mjs
    crawlClient.mjs
    crawlClient.test.mjs
    crawlSummarizer.mjs
    crawlSummarizer.test.mjs
    crawlTool.test.mjs
    defaultConfig.mjs
    evidenceStore.mjs
    evidenceStore.test.mjs
    fastMathGuardScript.test.mjs
    fileIngestion.mjs
    fileIngestion.test.mjs
    headroomControl.mjs
    headroomControl.test.mjs
    historyTool.mjs
    historyTool.test.mjs
    index.mjs
    nativeAgentCommands.mjs
    nativeAgentCommands.test.mjs
    pageagent-endpoint.test.mjs
    pageAgentAudit.mjs
    pageAgentAudit.test.mjs
    pageAgentBench.mjs
    pageAgentBridge.mjs
    pageAgentBridge.test.mjs
    pageAgentFixture.mjs
    pageAgentFixture.test.mjs
    pageagentMcp.mjs
    pageagentMcp.test.mjs
    pageAgentSafety.mjs
    pageAgentSafety.test.mjs
    pageAgentTask.mjs
    pageAgentTask.test.mjs
    pageAgentTool.mjs
    pageAgentTool.test.mjs
    pageBrowserBridge.mjs
    pageBrowserBridge.test.mjs
    perfMatrixScript.test.mjs
    processManager.mjs
    processManager.test.mjs
    profileLoader.mjs
    profileLoader.test.mjs
    proxy.mjs
    proxy.test.mjs
    regressionGateScript.test.mjs
    requestPayload.mjs
    requestPayload.test.mjs
    researchDiscover.test.mjs
    researchFormatter.mjs
    researchFormatter.test.mjs
    rocmSmi.mjs
    rocmSmi.test.mjs
    sage-exec-endpoint.test.mjs
    sageState.mjs
    sageState.test.mjs
    searchQueryGuard.mjs
    searchQueryGuard.test.mjs
    sourceCritic.mjs
    sourceCritic.test.mjs
    synthesisEngine.mjs
    synthesisEngine.test.mjs
    toolBlobStore.mjs
    toolBlobStore.test.mjs
    toolOutputCompressor.mjs
    toolOutputCompressor.test.mjs
    toolPlanner.mjs
    toolPlanner.test.mjs
    webSearchFlow.e2e.test.mjs
    webSearchQuery.test.mjs
    webSearchTool.mjs
  src/
    chat/
      ChatPanel.jsx
      ChatPanel.test.mjs
    pageagent/
      pageAgentClient.mjs
      pageAgentClient.test.mjs
      pageAgentEvents.mjs
      pageAgentEvents.test.mjs
      PageAgentPanel.jsx
      pageAgentProxy.mjs
    panels/
      HistoryPanel.jsx
      HistoryPanel.test.mjs
      LeftRail.jsx
      LeftRail.test.mjs
      RightRailPanels.jsx
      RightRailPanels.test.mjs
    research/
      researchApi.mjs
      researchApi.test.mjs
      ResearchPanel.jsx
      ResearchPlanReview.jsx
      ResearchSources.jsx
      researchStore.mjs
      researchStore.test.mjs
      ResearchThoughtChain.jsx
    agentCommands.mjs
    agentCommands.test.mjs
    agentPriming.mjs
    agentPriming.test.mjs
    App.jsx
    App.test.mjs
    appLogic.mjs
    backendStatus.mjs
    backendStatus.test.mjs
    callDebug.mjs
    callDebug.test.mjs
    conversationExport.mjs
    conversationExport.test.mjs
    deltaBatcher.mjs
    deltaBatcher.test.mjs
    exportPreferences.mjs
    exportPreferences.test.mjs
    historyPersistence.mjs
    historyPersistence.test.mjs
    main.jsx
    MermaidFullscreen.mjs
    MermaidFullscreen.test.mjs
    mermaidViewport.mjs
    mermaidViewport.test.mjs
    MessageContent.mjs
    MessageContent.test.mjs
    messageStyles.test.mjs
    obsidianMath.mjs
    polling.mjs
    polling.test.mjs
    serverMetrics.mjs
    serverMetrics.test.mjs
    styles.css
    throughputStats.mjs
    throughputStats.test.mjs
    utils.mjs
    webSearchInject.test.mjs
  .env.example
  ds4-ui.config.json
  index.html
  package.json
  vite.config.js
metal/
  argsort.metal
  bin.metal
  concat.metal
  cpy.metal
  dense.metal
  dsv4_hc.metal
  dsv4_kv.metal
  dsv4_misc.metal
  dsv4_rope.metal
  flash_attn.metal
  get_rows.metal
  glu.metal
  moe.metal
  norm.metal
  repeat.metal
  set_rows.metal
  softmax.metal
  sum_rows.metal
  unary.metal
profiles/
  ds4-profile-p1-strict-quality.json
  ds4-profile-p2-reasoning-high.json
  ds4-profile-p3-long-ingest.json
rocm/
  ds4_rocm_attention_launch.cuh
  ds4_rocm_attention.cuh
  ds4_rocm_common.cuh
  ds4_rocm_compressor.cuh
  ds4_rocm_current_api_compat.cuh
  ds4_rocm_embedding_launch.cuh
  ds4_rocm_fp8_kv_launch.cuh
  ds4_rocm_fp8_kv.cuh
  ds4_rocm_hc_output_launch.cuh
  ds4_rocm_hc.cuh
  ds4_rocm_hipblaslt.cuh
  ds4_rocm_indexer.cuh
  ds4_rocm_matmul.cuh
  ds4_rocm_misc_launch.cuh
  ds4_rocm_moe_launch.cuh
  ds4_rocm_moe.cuh
  ds4_rocm_norm_rope.cuh
  ds4_rocm_output.cuh
  ds4_rocm_q8.cuh
  ds4_rocm_router.cuh
  ds4_rocm_runtime.cuh
  ds4_rocm_shared_expert.cuh
scripts/
  build_tool_compression_evidence_report.py
  certify_tool_compression_model_backed.sh
  certify_tool_compression_operational_projected.sh
  certify_tool_compression_operational.sh
  certify_tool_compression_real_corpus.sh
  certify_tool_compression_repo_file_metadata_repeat.sh
  certify_tool_compression.sh
  rocm_progressive_perf_drift.sh
  rocm_settings.sh
  srun_tuning_gui.py
skills/
  metacognition/
    SKILL.md
tests/
  ds4-studio/
    fast_math_guard.sh
    perf_matrix.sh
    regression_gate.sh
  test-vectors/
    official/
      long_code_audit.official.json
      long_memory_archive.official.json
      short_code_completion.official.json
      short_italian_fact.official.json
      short_reasoning_plain.official.json
    prompts/
      long_code_audit.txt
      long_memory_archive.txt
      short_code_completion.txt
      short_italian_fact.txt
      short_reasoning_plain.txt
    fetch_official_vectors.py
    local-golden.vec
    manifest.json
    official.vec
    README.md
  cuda_long_context_smoke.c
  ds4_agent_test.c
  ds4_crawl_grounding_test.c
  ds4_test.c
  generate_long_context_story_prompt.py
  long_context_security_prompt.txt
  long_context_story_prompt.txt
  test_buf
  test_buf.c
  test_q4k_dot.c
  tool_compression_cert.c
  tool_compression_probe.c
  tool_compression_token_probe.c
tools/
  __init__.py
.gitignore
AGENT.md
AGENTS_BUILD.md
AGENTS.md
buf.c
buf.h
certify_all.sh
CLAUDE.md
CONTRIBUTING.md
download_model.sh
ds4_agent_runtime.c
ds4_agent_runtime.h
ds4_agent_session_store.c
ds4_agent_session_store.h
ds4_agent_test
ds4_agent.c
ds4_bench.c
ds4_cli.c
ds4_context_blob.c
ds4_context_blob.h
ds4_crawl_grounding.c
ds4_crawl_grounding.h
ds4_cuda.cu
ds4_distributed.c
ds4_distributed.h
ds4_eval.c
ds4_gpu.h
ds4_help.c
ds4_help.h
ds4_iq2_tables_cuda.inc
ds4_kvstore.c
ds4_kvstore.h
ds4_rocm.cu
ds4_rocm.h
ds4_server_runtime.c
ds4_server_runtime.h
ds4_server.c
ds4_ssd.c
ds4_ssd.h
ds4_streaming_hotlist.inc
ds4_tool_compress.c
ds4_tool_compress.h
ds4_web.c
ds4_web.h
ds4_wrapper_config.c
ds4_wrapper_config.h
ds4_wrapper_http.c
ds4_wrapper_http.h
ds4_wrapper_metrics.c
ds4_wrapper_metrics.h
ds4_wrapper_state.c
ds4_wrapper_state.h
ds4_wrapper.c
ds4_wrapper.h
ds4-wrapper
ds4.c
ds4.h
LICENSE
linenoise.c
linenoise.h
Makefile
MODEL_CARD.md
rax_malloc.h
rax.c
rax.h
README.md
repo.sh
simulate_loop_guard.sh
srun.sh
STRIXHALO.md
test_gitnexus_integration.sh
test_loop_guard.sh
```

# Files

## File: ds4_server.c
````c
#include "ds4.h"
#include "ds4_distributed.h"
#include "ds4_help.h"
#include "ds4_kvstore.h"
#include "rax.h"
#include <stdarg.h>
#include <stdlib.h>
#include "buf.h"

static void server_buf_error(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    fprintf(stderr, "ds4-server: ");
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    exit(1);
}

__attribute__((constructor)) static void init_buf_error(void) {
    g_dynbuf_error = server_buf_error;
}

/* OpenAI/Anthropic compatible local server.
 *
 * HTTP is intentionally simple: each client connection is handled by a small
 * blocking thread that parses one request, then queues a job to the single
 * Metal worker.  The worker owns the ds4_session and therefore owns all live KV
 * cache state.  That keeps session reuse, disk checkpointing, and future
 * batching decisions in one place instead of spreading graph mutations across
 * client threads. */

#include <arpa/inet.h>
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <float.h>
#include <fcntl.h>
#include <limits.h>
#include <math.h>
#include <netinet/in.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t g_stop_requested = 0;
static volatile sig_atomic_t g_listen_fd = -1;

#define DS4_SERVER_IO_TIMEOUT_SEC 10
#define DS4_SERVER_SEND_STALL_TIMEOUT_MS 2000

static void stop_signal_handler(int sig) {
    (void)sig;
    if (g_stop_requested) _exit(130);
    g_stop_requested = 1;
    if (g_listen_fd >= 0) {
        int fd = (int)g_listen_fd;
        g_listen_fd = -1;
        close(fd);
    }
}

typedef DynBuf buf;

static void die(const char *msg) {
    fprintf(stderr, "ds4-server: %s\n", msg);
    exit(1);
}

static void *xmalloc(size_t n) {
    void *p = malloc(n ? n : 1);
    if (!p) die("out of memory");
    return p;
}

static void *xrealloc(void *p, size_t n) {
    p = realloc(p, n ? n : 1);
    if (!p) die("out of memory");
    return p;
}

static char *xstrdup(const char *s) {
    size_t n = strlen(s);
    char *p = xmalloc(n + 1);
    memcpy(p, s, n + 1);
    return p;
}

static bool random_bytes(void *dst, size_t len) {
    unsigned char *p = dst;
    int fd = open("/dev/urandom", O_RDONLY);
    if (fd < 0) return false;
    while (len) {
        ssize_t n = read(fd, p, len);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            close(fd);
            return false;
        }
        p += (size_t)n;
        len -= (size_t)n;
    }
    close(fd);
    return true;
}

static char *xstrndup(const char *s, size_t n) {
    char *p = xmalloc(n + 1);
    memcpy(p, s, n);
    p[n] = '\0';
    return p;
}

void buf_reserve(buf *b, size_t add) { dynbuf_reserve((DynBuf *)b, add); }
void buf_append(buf *b, const void *p, size_t n) { dynbuf_append((DynBuf *)b, p, n); }
void buf_putc(buf *b, char c) { dynbuf_putc((DynBuf *)b, c); }
void buf_puts(buf *b, const char *s) { dynbuf_puts((DynBuf *)b, s); }
void buf_printf(buf *b, const char *fmt, ...) { va_list ap; va_start(ap, fmt); dynbuf_vprintf((DynBuf *)b, fmt, ap); va_end(ap); }

static char *buf_take(buf *b) {
    if (!b->ptr) return xstrdup("");
    char *p = b->ptr;
    memset(b, 0, sizeof(*b));
    return p;
}

static void buf_free(buf *b) {
    free(b->ptr);
    memset(b, 0, sizeof(*b));
}

static void json_ws(const char **p) {
    while (**p && isspace((unsigned char)**p)) (*p)++;
}

static bool json_lit(const char **p, const char *lit) {
    size_t n = strlen(lit);
    if (strncmp(*p, lit, n) != 0) return false;
    *p += n;
    return true;
}

static int json_hex(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return 10 + c - 'a';
    if (c >= 'A' && c <= 'F') return 10 + c - 'A';
    return -1;
}

static void utf8_put(buf *b, uint32_t cp) {
    if (cp <= 0x7f) {
        buf_putc(b, (char)cp);
    } else if (cp <= 0x7ff) {
        buf_putc(b, (char)(0xc0 | (cp >> 6)));
        buf_putc(b, (char)(0x80 | (cp & 0x3f)));
    } else if (cp <= 0xffff) {
        buf_putc(b, (char)(0xe0 | (cp >> 12)));
        buf_putc(b, (char)(0x80 | ((cp >> 6) & 0x3f)));
        buf_putc(b, (char)(0x80 | (cp & 0x3f)));
    } else {
        buf_putc(b, (char)(0xf0 | (cp >> 18)));
        buf_putc(b, (char)(0x80 | ((cp >> 12) & 0x3f)));
        buf_putc(b, (char)(0x80 | ((cp >> 6) & 0x3f)));
        buf_putc(b, (char)(0x80 | (cp & 0x3f)));
    }
}

static bool json_u16(const char **p, uint32_t *out) {
    if ((*p)[0] != '\\' || (*p)[1] != 'u') return false;
    uint32_t cp = 0;
    for (int i = 0; i < 4; i++) {
        int h = json_hex((*p)[2 + i]);
        if (h < 0) return false;
        cp = (cp << 4) | (uint32_t)h;
    }
    *p += 6;
    *out = cp;
    return true;
}

static bool json_string(const char **p, char **out) {
    json_ws(p);
    if (**p != '"') return false;
    (*p)++;
    buf b = {0};
    while (**p && **p != '"') {
        unsigned char c = (unsigned char)*(*p)++;
        if (c != '\\') {
            buf_putc(&b, (char)c);
            continue;
        }
        c = (unsigned char)*(*p)++;
        switch (c) {
        case '"': buf_putc(&b, '"'); break;
        case '\\': buf_putc(&b, '\\'); break;
        case '/': buf_putc(&b, '/'); break;
        case 'b': buf_putc(&b, '\b'); break;
        case 'f': buf_putc(&b, '\f'); break;
        case 'n': buf_putc(&b, '\n'); break;
        case 'r': buf_putc(&b, '\r'); break;
        case 't': buf_putc(&b, '\t'); break;
        case 'u': {
            *p -= 2;
            uint32_t cp = 0, lo = 0;
            if (!json_u16(p, &cp)) goto fail;
            if (cp >= 0xd800 && cp <= 0xdbff && json_u16(p, &lo) && lo >= 0xdc00 && lo <= 0xdfff) {
                cp = 0x10000u + ((cp - 0xd800u) << 10) + (lo - 0xdc00u);
            }
            utf8_put(&b, cp);
            break;
        }
        default:
            goto fail;
        }
    }
    if (**p != '"') goto fail;
    (*p)++;
    *out = buf_take(&b);
    return true;
fail:
    buf_free(&b);
    return false;
}

static bool json_number(const char **p, double *out) {
    json_ws(p);
    char *end = NULL;
    double v = strtod(*p, &end);
    if (end == *p) return false;
    *p = end;
    *out = v;
    return true;
}

static bool json_int(const char **p, int *out) {
    double v = 0.0;
    if (!json_number(p, &v)) return false;
    if (v < 0) v = 0;
    if (v > INT_MAX) v = INT_MAX;
    *out = (int)v;
    return true;
}

static bool json_bool(const char **p, bool *out) {
    json_ws(p);
    if (json_lit(p, "true")) {
        *out = true;
        return true;
    }
    if (json_lit(p, "false")) {
        *out = false;
        return true;
    }
    return false;
}

/* The request parser only understands the API fields we use and skips the
 * rest.  Skipping is recursive because JSON values nest, so keep an explicit
 * ceiling: without it, a useless ignored field like {"x":[[[...]]]} can spend
 * the whole C stack before the request is rejected. */
#define JSON_MAX_NESTING 256

static bool json_skip_value_depth(const char **p, int depth);

static bool json_skip_array_depth(const char **p, int depth) {
    if (depth >= JSON_MAX_NESTING) return false;
    json_ws(p);
    if (**p != '[') return false;
    (*p)++;
    json_ws(p);
    if (**p == ']') {
        (*p)++;
        return true;
    }
    for (;;) {
        if (!json_skip_value_depth(p, depth + 1)) return false;
        json_ws(p);
        if (**p == ']') {
            (*p)++;
            return true;
        }
        if (**p != ',') return false;
        (*p)++;
    }
}

static bool json_skip_object_depth(const char **p, int depth) {
    if (depth >= JSON_MAX_NESTING) return false;
    json_ws(p);
    if (**p != '{') return false;
    (*p)++;
    json_ws(p);
    if (**p == '}') {
        (*p)++;
        return true;
    }
    for (;;) {
        char *key = NULL;
        if (!json_string(p, &key)) return false;
        free(key);
        json_ws(p);
        if (**p != ':') return false;
        (*p)++;
        if (!json_skip_value_depth(p, depth + 1)) return false;
        json_ws(p);
        if (**p == '}') {
            (*p)++;
            return true;
        }
        if (**p != ',') return false;
        (*p)++;
    }
}

static bool json_skip_value_depth(const char **p, int depth) {
    json_ws(p);
    if (**p == '"') {
        char *s = NULL;
        bool ok = json_string(p, &s);
        free(s);
        return ok;
    }
    if (**p == '{') return json_skip_object_depth(p, depth);
    if (**p == '[') return json_skip_array_depth(p, depth);
    if (json_lit(p, "true") || json_lit(p, "false") || json_lit(p, "null")) return true;
    double v = 0.0;
    return json_number(p, &v);
}

static bool json_skip_value(const char **p) {
    return json_skip_value_depth(p, 0);
}

static bool json_raw_value(const char **p, char **out) {
    json_ws(p);
    const char *start = *p;
    if (!json_skip_value(p)) return false;
    size_t n = (size_t)(*p - start);
    char *s = xmalloc(n + 1);
    memcpy(s, start, n);
    s[n] = '\0';
    *out = s;
    return true;
}

static char *json_minify_raw_value(const char *json) {
    const char *p = json ? json : "null";
    json_ws(&p);
    const char *start = p;
    if (!json_skip_value(&p)) return xstrdup(json ? json : "null");
    const char *end = p;

    buf b = {0};
    bool in_string = false;
    bool escape = false;
    for (const char *s = start; s < end; s++) {
        unsigned char c = (unsigned char)*s;
        if (in_string) {
            buf_putc(&b, (char)c);
            if (escape) escape = false;
            else if (c == '\\') escape = true;
            else if (c == '"') in_string = false;
        } else if (c == '"') {
            in_string = true;
            buf_putc(&b, (char)c);
        } else if (!isspace(c)) {
            buf_putc(&b, (char)c);
        }
    }
    return buf_take(&b);
}

static bool json_content(const char **p, char **out) {
    json_ws(p);
    if (**p == '"') return json_string(p, out);
    if (json_lit(p, "null")) {
        *out = xstrdup("");
        return true;
    }
    if (**p != '[') {
        if (!json_skip_value(p)) return false;
        *out = xstrdup("");
        return true;
    }

    (*p)++;
    buf b = {0};
    json_ws(p);
    while (**p && **p != ']') {
        if (**p == '"') {
            char *s = NULL;
            if (!json_string(p, &s)) goto fail;
            buf_puts(&b, s);
            free(s);
        } else if (**p == '{') {
            (*p)++;
            json_ws(p);
            while (**p && **p != '}') {
                char *key = NULL;
                if (!json_string(p, &key)) goto fail;
                json_ws(p);
                if (**p != ':') {
                    free(key);
                    goto fail;
                }
                (*p)++;
                if (!strcmp(key, "text")) {
                    char *s = NULL;
                    if (!json_string(p, &s)) {
                        free(key);
                        goto fail;
                    }
                    buf_puts(&b, s);
                    free(s);
                } else if (!json_skip_value(p)) {
                    free(key);
                    goto fail;
                }
                free(key);
                json_ws(p);
                if (**p == ',') (*p)++;
                json_ws(p);
            }
            if (**p != '}') goto fail;
            (*p)++;
        } else if (!json_skip_value(p)) {
            goto fail;
        }
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != ']') goto fail;
    (*p)++;
    *out = buf_take(&b);
    return true;
fail:
    buf_free(&b);
    return false;
}

typedef enum {
    REQ_CHAT,
    REQ_COMPLETION,
} req_kind;

typedef enum {
    API_OPENAI,
    API_ANTHROPIC,
    API_RESPONSES,
} api_style;

static void random_tool_id(char *dst, size_t dstlen, api_style api) {
    static uint64_t fallback_ctr;
    unsigned char bytes[16];
    const char *prefix = api == API_ANTHROPIC ? "toolu_" : "call_";
    size_t pos = snprintf(dst, dstlen, "%s", prefix);
    if (pos >= dstlen) return;

    if (!random_bytes(bytes, sizeof(bytes))) {
        uint64_t a = ((uint64_t)time(NULL) << 32) ^ (uint64_t)getpid();
        uint64_t b = ++fallback_ctr ^ (uint64_t)(uintptr_t)dst;
        memcpy(bytes, &a, sizeof(a));
        memcpy(bytes + sizeof(a), &b, sizeof(b));
    }

    static const char hex[] = "0123456789abcdef";
    for (size_t i = 0; i < sizeof(bytes) && pos + 2 < dstlen; i++) {
        dst[pos++] = hex[bytes[i] >> 4];
        dst[pos++] = hex[bytes[i] & 15];
    }
    dst[pos] = '\0';
}

typedef struct server server;

typedef struct {
    char *id;
    char *name;
    char *arguments;
} tool_call;

typedef struct {
    tool_call *v;
    int len;
    int cap;
    char *raw_dsml;
} tool_calls;

typedef struct {
    int mem;
    int disk;
    int canonical;
    int missing_ids;
} tool_replay_stats;

typedef struct {
    char *name;
    char *wire_name;
    char *namespace;
    /* Distinguish the Responses hosted tool from a normal function that
     * happens to be named "tool_search". */
    bool responses_tool_search;
    char **prop;
    int len;
    int cap;
} tool_schema_order;

typedef struct {
    tool_schema_order *v;
    int len;
    int cap;
} tool_schema_orders;

typedef struct {
    char *role;
    char *content;
    char *reasoning;
    char *tool_call_id;
    char **tool_call_ids;
    int tool_call_ids_len;
    int tool_call_ids_cap;
    tool_calls calls;
} chat_msg;

typedef struct {
    chat_msg *v;
    int len;
    int cap;
} chat_msgs;

static void tool_memory_attach_to_messages(server *s, chat_msgs *msgs,
                                           tool_replay_stats *stats);
static bool tool_memory_has_id(server *s, const char *id);
static void kv_cache_restore_tool_memory_for_messages(server *s, const chat_msgs *msgs);

typedef struct {
    char **v;
    int len;
    int cap;
    size_t max_len;
} stop_list;

static void stop_list_clear(stop_list *stops);
static bool id_list_contains(const stop_list *ids, const char *id);
static void id_list_push_unique(stop_list *ids, const char *id);
static void id_list_free(stop_list *ids);
static bool responses_live_has_call_id(server *s, const char *id);
static bool anthropic_live_has_call_id(server *s, const char *id);

typedef struct {
    req_kind kind;
    api_style api;
    ds4_tokens prompt;
    char *model;
    bool model_from_request;
    stop_list stops;
    char *raw_body;
    char *prompt_text;
    tool_schema_orders tool_orders;
    int max_tokens;
    int top_k;
    float temperature;
    float top_p;
    float min_p;
    uint64_t seed;
    bool stream;
    bool stream_include_usage;
    int cache_read_tokens;
    int cache_write_tokens;
    ds4_think_mode think_mode;
    bool has_tools;
    bool prompt_preserves_reasoning;
    /* For /v1/responses: emit reasoning_summary_* events / fields only when the
     * client opted in via reasoning.summary. Other APIs leave this false; the
     * field is ignored on those code paths. */
    bool reasoning_summary_emit;
    /* Responses continuation contract:
     *
     * A live Responses tool loop is not a normal "new prompt with a long
     * prefix" request.  The protocol gives tool outputs a call_id that binds
     * them to a prior assistant tool call.  If that call_id is still known in
     * memory, the live KV is the authoritative prefix, including any hidden
     * thinking that the client did not replay.  These fields carry the parsed
     * evidence needed by generate_job() to append only the new suffix.
     *
     * A tool-output-only request has no stateless prefix to match.  If the live
     * call_id binding is gone by the time the worker executes it, DS4 must ask
     * for a full replay rather than cold-prefilling a prompt that starts with a
     * naked tool result.  Similarly, if live state is gone, a reasoning-mode
     * tool replay must contain the prior reasoning item (or an equivalent
     * opaque reasoning state from a future implementation). */
    bool responses_requires_live_tool_state;
    bool responses_requires_live_reasoning;
    stop_list responses_live_call_ids;
    char *responses_live_suffix_text;
    bool anthropic_requires_live_tool_state;
    stop_list anthropic_live_call_ids;
    char *anthropic_live_suffix_text;
    tool_replay_stats tool_replay;
} request;

static void tool_call_free(tool_call *tc) {
    free(tc->id);
    free(tc->name);
    free(tc->arguments);
    memset(tc, 0, sizeof(*tc));
}

static void tool_calls_free(tool_calls *calls) {
    for (int i = 0; i < calls->len; i++) tool_call_free(&calls->v[i]);
    free(calls->raw_dsml);
    free(calls->v);
    memset(calls, 0, sizeof(*calls));
}

static void tool_calls_push(tool_calls *calls, tool_call tc) {
    if (calls->len == calls->cap) {
        calls->cap = calls->cap ? calls->cap * 2 : 4;
        calls->v = xrealloc(calls->v, (size_t)calls->cap * sizeof(calls->v[0]));
    }
    calls->v[calls->len++] = tc;
}

static void chat_msg_add_tool_call_id(chat_msg *m, const char *id) {
    if (!m || !id || !id[0]) return;
    if (!m->tool_call_id) m->tool_call_id = xstrdup(id);
    for (int i = 0; i < m->tool_call_ids_len; i++) {
        if (m->tool_call_ids[i] && !strcmp(m->tool_call_ids[i], id)) return;
    }
    if (m->tool_call_ids_len == m->tool_call_ids_cap) {
        m->tool_call_ids_cap = m->tool_call_ids_cap ? m->tool_call_ids_cap * 2 : 2;
        m->tool_call_ids = xrealloc(m->tool_call_ids,
            (size_t)m->tool_call_ids_cap * sizeof(m->tool_call_ids[0]));
    }
    m->tool_call_ids[m->tool_call_ids_len++] = xstrdup(id);
}

static void chat_msg_free(chat_msg *m) {
    free(m->role);
    free(m->content);
    free(m->reasoning);
    free(m->tool_call_id);
    for (int i = 0; i < m->tool_call_ids_len; i++) free(m->tool_call_ids[i]);
    free(m->tool_call_ids);
    tool_calls_free(&m->calls);
    memset(m, 0, sizeof(*m));
}

static void chat_msgs_free(chat_msgs *msgs) {
    for (int i = 0; i < msgs->len; i++) chat_msg_free(&msgs->v[i]);
    free(msgs->v);
    memset(msgs, 0, sizeof(*msgs));
}

static void chat_msgs_push(chat_msgs *msgs, chat_msg msg) {
    if (msgs->len == msgs->cap) {
        msgs->cap = msgs->cap ? msgs->cap * 2 : 8;
        msgs->v = xrealloc(msgs->v, (size_t)msgs->cap * sizeof(msgs->v[0]));
    }
    msgs->v[msgs->len++] = msg;
}

static void tool_schema_order_free(tool_schema_order *o) {
    free(o->name);
    free(o->wire_name);
    free(o->namespace);
    for (int i = 0; i < o->len; i++) free(o->prop[i]);
    free(o->prop);
    memset(o, 0, sizeof(*o));
}

static void tool_schema_orders_free(tool_schema_orders *orders) {
    for (int i = 0; i < orders->len; i++) tool_schema_order_free(&orders->v[i]);
    free(orders->v);
    memset(orders, 0, sizeof(*orders));
}

static void tool_schema_order_prop_push(tool_schema_order *o, char *prop) {
    if (o->len == o->cap) {
        o->cap = o->cap ? o->cap * 2 : 8;
        o->prop = xrealloc(o->prop, (size_t)o->cap * sizeof(o->prop[0]));
    }
    o->prop[o->len++] = prop;
}

static int tool_schema_orders_find_index(const tool_schema_orders *orders, const char *name) {
    if (!orders || !name) return -1;
    for (int i = 0; i < orders->len; i++) {
        if (orders->v[i].name && !strcmp(orders->v[i].name, name)) return i;
    }
    return -1;
}

static void tool_schema_orders_push(tool_schema_orders *orders, tool_schema_order order) {
    int idx = tool_schema_orders_find_index(orders, order.name);
    if (idx >= 0) {
        tool_schema_order_free(&orders->v[idx]);
        orders->v[idx] = order;
        return;
    }
    if (orders->len == orders->cap) {
        orders->cap = orders->cap ? orders->cap * 2 : 8;
        orders->v = xrealloc(orders->v, (size_t)orders->cap * sizeof(orders->v[0]));
    }
    orders->v[orders->len++] = order;
}

static const tool_schema_order *tool_schema_orders_find(const tool_schema_orders *orders, const char *name) {
    int idx = tool_schema_orders_find_index(orders, name);
    return idx >= 0 ? &orders->v[idx] : NULL;
}

static void request_init(request *r, req_kind kind, int max_tokens) {
    memset(r, 0, sizeof(*r));
    r->kind = kind;
    r->api = API_OPENAI;
    r->model = xstrdup("deepseek-v4-flash");
    r->max_tokens = max_tokens;
    r->top_k = 0;
    r->temperature = DS4_DEFAULT_TEMPERATURE;
    r->top_p = DS4_DEFAULT_TOP_P;
    r->min_p = DS4_DEFAULT_MIN_P;
    r->think_mode = DS4_THINK_HIGH;
}

static void request_free(request *r) {
    ds4_tokens_free(&r->prompt);
    free(r->model);
    for (int i = 0; i < r->stops.len; i++) free(r->stops.v[i]);
    free(r->stops.v);
    free(r->raw_body);
    free(r->prompt_text);
    stop_list_clear(&r->responses_live_call_ids);
    free(r->responses_live_call_ids.v);
    free(r->responses_live_suffix_text);
    stop_list_clear(&r->anthropic_live_call_ids);
    free(r->anthropic_live_call_ids.v);
    free(r->anthropic_live_suffix_text);
    tool_schema_orders_free(&r->tool_orders);
    memset(r, 0, sizeof(*r));
}

static ds4_think_mode think_mode_from_enabled(bool enabled, ds4_think_mode effort) {
    if (!enabled || effort == DS4_THINK_NONE) return DS4_THINK_NONE;
    return effort == DS4_THINK_MAX ? DS4_THINK_MAX : DS4_THINK_HIGH;
}

static bool parse_reasoning_effort_name(const char *s, ds4_think_mode *out) {
    if (!s) return false;
    if (!strcmp(s, "max")) {
        *out = DS4_THINK_MAX;
        return true;
    }
    if (!strcmp(s, "xhigh") || !strcmp(s, "high") ||
        !strcmp(s, "medium") || !strcmp(s, "low") ||
        !strcmp(s, "minimal"))
    {
        /* DS4 only exposes HIGH and MAX above zero, so "minimal" collapses to
         * the smallest non-zero level (HIGH). Callers that need *no* reasoning
         * must use "none" instead. */
        *out = DS4_THINK_HIGH;
        return true;
    }
    if (!strcmp(s, "none")) {
        *out = DS4_THINK_NONE;
        return true;
    }
    return false;
}

static bool parse_reasoning_effort_value(const char **p, ds4_think_mode *out) {
    json_ws(p);
    if (json_lit(p, "null")) return true;
    char *effort = NULL;
    if (!json_string(p, &effort)) return false;
    bool ok = parse_reasoning_effort_name(effort, out);
    free(effort);
    return ok;
}

static bool parse_thinking_control_value(const char **p, bool *thinking_enabled) {
    json_ws(p);
    if (json_lit(p, "null")) return true;
    if (**p == 't' || **p == 'f') return json_bool(p, thinking_enabled);
    if (**p != '{') return json_skip_value(p);
    (*p)++;
    json_ws(p);
    while (**p && **p != '}') {
        char *key = NULL;
        if (!json_string(p, &key)) return false;
        json_ws(p);
        if (**p != ':') {
            free(key);
            return false;
        }
        (*p)++;
        if (!strcmp(key, "type")) {
            char *type = NULL;
            if (!json_string(p, &type)) {
                free(key);
                return false;
            }
            if (!strcmp(type, "enabled")) *thinking_enabled = true;
            else if (!strcmp(type, "disabled")) *thinking_enabled = false;
            free(type);
        } else if (!json_skip_value(p)) {
            free(key);
            return false;
        }
        free(key);
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != '}') return false;
    (*p)++;
    return true;
}

static bool parse_output_config_effort(const char **p, ds4_think_mode *effort) {
    json_ws(p);
    if (json_lit(p, "null")) return true;
    if (**p != '{') return json_skip_value(p);
    (*p)++;
    json_ws(p);
    while (**p && **p != '}') {
        char *key = NULL;
        if (!json_string(p, &key)) return false;
        json_ws(p);
        if (**p != ':') {
            free(key);
            return false;
        }
        (*p)++;
        if (!strcmp(key, "effort")) {
            if (!parse_reasoning_effort_value(p, effort)) {
                free(key);
                return false;
            }
        } else if (!json_skip_value(p)) {
            free(key);
            return false;
        }
        free(key);
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != '}') return false;
    (*p)++;
    return true;
}

static bool model_alias_disables_thinking(const char *model) {
    return model && !strcmp(model, "deepseek-chat");
}

static bool model_alias_enables_thinking(const char *model) {
    return model && !strcmp(model, "deepseek-reasoner");
}

static const char *server_model_id_from_engine(ds4_engine *engine) {
    return ds4_engine_model_id(engine) == 1 ?
           "deepseek-v4-pro" : "deepseek-v4-flash";
}

static bool server_model_alias_known(const char *id) {
    return id &&
           (!strcmp(id, "deepseek-v4-flash") ||
            !strcmp(id, "deepseek-v4-pro"));
}

static void stop_list_clear(stop_list *stops) {
    for (int i = 0; i < stops->len; i++) free(stops->v[i]);
    stops->len = 0;
    stops->max_len = 0;
}

static void stop_list_push(stop_list *stops, char *s) {
    if (!s || !s[0]) {
        free(s);
        return;
    }
    if (stops->len == stops->cap) {
        stops->cap = stops->cap ? stops->cap * 2 : 4;
        stops->v = xrealloc(stops->v, (size_t)stops->cap * sizeof(stops->v[0]));
    }
    size_t n = strlen(s);
    if (n > stops->max_len) stops->max_len = n;
    stops->v[stops->len++] = s;
}

static bool parse_stop(const char **p, stop_list *out) {
    json_ws(p);
    stop_list_clear(out);
    if (**p == '"') {
        char *s = NULL;
        if (!json_string(p, &s)) return false;
        stop_list_push(out, s);
        return true;
    }
    if (**p != '[') return json_skip_value(p);
    (*p)++;
    json_ws(p);
    while (**p && **p != ']') {
        if (**p == '"') {
            char *s = NULL;
            if (!json_string(p, &s)) return false;
            stop_list_push(out, s);
        } else if (!json_skip_value(p)) {
            return false;
        }
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != ']') return false;
    (*p)++;
    return true;
}

static bool stop_list_find_from(const stop_list *stops, const char *text,
                                size_t from, size_t *pos, size_t *len) {
    if (!stops->len || !text) return false;
    bool found = false;
    size_t best_pos = 0, best_len = 0;
    for (int i = 0; i < stops->len; i++) {
        char *p = strstr(text + from, stops->v[i]);
        if (!p) continue;
        size_t ppos = (size_t)(p - text);
        size_t plen = strlen(stops->v[i]);
        if (!found || ppos < best_pos) {
            found = true;
            best_pos = ppos;
            best_len = plen;
        }
    }
    if (!found) return false;
    *pos = best_pos;
    *len = best_len;
    return true;
}

static size_t stop_list_stream_safe_len(const stop_list *stops, size_t text_len) {
    /* Streaming cannot emit the last max_stop_len-1 bytes yet: a stop sequence
     * may start there and finish in the next token.  The final flush releases
     * this small tail once generation ends without a stop hit. */
    if (!stops->len || stops->max_len <= 1) return text_len;
    const size_t hold = stops->max_len - 1;
    return text_len > hold ? text_len - hold : 0;
}

static int utf8_expected_len(unsigned char c) {
    if (c < 0x80) return 1;
    if (c >= 0xc2 && c <= 0xdf) return 2;
    if (c >= 0xe0 && c <= 0xef) return 3;
    if (c >= 0xf0 && c <= 0xf4) return 4;
    return 1;
}

/* Tokenizers can split a multi-byte UTF-8 character across two tokens.  If an
 * SSE delta ends at that boundary, some clients replace the incomplete byte
 * sequence with U+FFFD and later send the corrupted text back, destroying KV
 * cache prefix matches.  Hold only the trailing incomplete character; the next
 * generated token will complete it. */
static size_t utf8_stream_safe_len(const char *s, size_t start,
                                   size_t limit, bool final) {
    if (final || !s || limit <= start) return limit;

    size_t p = limit;
    int cont = 0;
    while (p > start && cont < 4 &&
           (((unsigned char)s[p - 1] & 0xc0) == 0x80))
    {
        p--;
        cont++;
    }

    if (p == limit) {
        return utf8_expected_len((unsigned char)s[limit - 1]) > 1 ?
               limit - 1 : limit;
    }
    if (p == start && (((unsigned char)s[p] & 0xc0) == 0x80)) return start;

    size_t lead = p - 1;
    int need = utf8_expected_len((unsigned char)s[lead]);
    return (limit - lead) < (size_t)need ? lead : limit;
}

static bool parse_stream_options(const char **p, bool *include_usage) {
    json_ws(p);
    if (**p != '{') return json_skip_value(p);
    (*p)++;
    json_ws(p);
    while (**p && **p != '}') {
        char *key = NULL;
        if (!json_string(p, &key)) return false;
        json_ws(p);
        if (**p != ':') {
            free(key);
            return false;
        }
        (*p)++;
        if (!strcmp(key, "include_usage")) {
            if (!json_bool(p, include_usage)) {
                free(key);
                return false;
            }
        } else if (!json_skip_value(p)) {
            free(key);
            return false;
        }
        free(key);
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != '}') return false;
    (*p)++;
    return true;
}

static bool parse_function_call(const char **p, tool_call *tc) {
    json_ws(p);
    if (**p != '{') return false;
    (*p)++;
    json_ws(p);
    while (**p && **p != '}') {
        char *key = NULL;
        if (!json_string(p, &key)) goto bad;
        json_ws(p);
        if (**p != ':') {
            free(key);
            goto bad;
        }
        (*p)++;
        if (!strcmp(key, "name")) {
            free(tc->name);
            if (!json_string(p, &tc->name)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "arguments")) {
            free(tc->arguments);
            json_ws(p);
            if (**p == '"') {
                if (!json_string(p, &tc->arguments)) {
                    free(key);
                    goto bad;
                }
            } else if (!json_raw_value(p, &tc->arguments)) {
                free(key);
                goto bad;
            }
        } else if (!json_skip_value(p)) {
            free(key);
            goto bad;
        }
        free(key);
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != '}') goto bad;
    (*p)++;
    return true;
bad:
    return false;
}

static bool parse_tool_calls_value(const char **p, tool_calls *calls) {
    json_ws(p);
    if (json_lit(p, "null")) return true;
    if (**p != '[') return false;
    (*p)++;
    json_ws(p);
    while (**p && **p != ']') {
        if (**p != '{') return false;
        (*p)++;
        tool_call tc = {0};
        json_ws(p);
        while (**p && **p != '}') {
            char *key = NULL;
            if (!json_string(p, &key)) goto bad;
            json_ws(p);
            if (**p != ':') {
                free(key);
                goto bad;
            }
            (*p)++;
            if (!strcmp(key, "id")) {
                free(tc.id);
                if (!json_string(p, &tc.id)) {
                    free(key);
                    goto bad;
                }
            } else if (!strcmp(key, "function")) {
                if (!parse_function_call(p, &tc)) {
                    free(key);
                    goto bad;
                }
            } else if (!json_skip_value(p)) {
                free(key);
                goto bad;
            }
            free(key);
            json_ws(p);
            if (**p == ',') (*p)++;
            json_ws(p);
        }
        if (**p != '}') goto bad;
        (*p)++;
        if (tc.name && tc.arguments) {
            tool_calls_push(calls, tc);
            memset(&tc, 0, sizeof(tc));
        }
        tool_call_free(&tc);
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
        continue;
bad:
        tool_call_free(&tc);
        return false;
    }
    if (**p != ']') return false;
    (*p)++;
    return true;
}

static void append_raw_json_line(buf *b, const char *json) {
    if (!json || !json[0]) return;
    if (b->len) buf_putc(b, '\n');
    buf_puts(b, json);
}

static void json_escape(buf *b, const char *s);

static char *openai_function_schema_from_tool(const char *raw) {
    const char *p = raw;
    json_ws(&p);
    if (*p != '{') return NULL;
    p++;
    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        char *value = NULL;
        if (!json_string(&p, &key)) return NULL;
        json_ws(&p);
        if (*p != ':') {
            free(key);
            return NULL;
        }
        p++;
        if (!strcmp(key, "function")) {
            free(key);
            if (!json_raw_value(&p, &value)) return NULL;
            return value;
        }
        free(key);
        if (!json_skip_value(&p)) return NULL;
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }
    return NULL;
}

static char *responses_special_schema_from_tool(const char *raw) {
    const char *p = raw;
    json_ws(&p);
    if (*p != '{') return NULL;
    p++;

    char *type = NULL;
    char *description = NULL;
    char *parameters = NULL;
    char *out = NULL;

    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        if (!json_string(&p, &key)) goto done;
        json_ws(&p);
        if (*p != ':') {
            free(key);
            goto done;
        }
        p++;
        if (!strcmp(key, "type")) {
            free(type);
            if (!json_string(&p, &type)) {
                free(key);
                goto done;
            }
        } else if (!strcmp(key, "description")) {
            free(description);
            if (!json_string(&p, &description)) {
                free(key);
                goto done;
            }
        } else if (!strcmp(key, "parameters")) {
            free(parameters);
            if (!json_raw_value(&p, &parameters)) {
                free(key);
                goto done;
            }
        } else if (!json_skip_value(&p)) {
            free(key);
            goto done;
        }
        free(key);
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }

    if (type && !strcmp(type, "tool_search")) {
        buf b = {0};
        buf_puts(&b, "{\"name\":\"tool_search\",\"description\":");
        json_escape(&b, description ? description : "Search available tools.");
        buf_puts(&b, ",\"parameters\":");
        buf_puts(&b, parameters ? parameters :
                 "{\"type\":\"object\",\"properties\":{}}");
        buf_putc(&b, '}');
        out = buf_take(&b);
    }

done:
    free(type);
    free(description);
    free(parameters);
    return out;
}

static char *responses_namespace_function_schema_from_tool(const char *raw,
                                                           const char *namespace,
                                                           char **wire_name) {
    const char *p = raw;
    json_ws(&p);
    if (*p != '{') return NULL;
    p++;

    char *type = NULL;
    char *name = NULL;
    char *description = NULL;
    char *parameters = NULL;
    char *out = NULL;

    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        if (!json_string(&p, &key)) goto done;
        json_ws(&p);
        if (*p != ':') {
            free(key);
            goto done;
        }
        p++;
        if (!strcmp(key, "type")) {
            free(type);
            if (!json_string(&p, &type)) {
                free(key);
                goto done;
            }
        } else if (!strcmp(key, "name")) {
            free(name);
            if (!json_string(&p, &name)) {
                free(key);
                goto done;
            }
        } else if (!strcmp(key, "description")) {
            free(description);
            if (!json_string(&p, &description)) {
                free(key);
                goto done;
            }
        } else if (!strcmp(key, "parameters") || !strcmp(key, "input_schema")) {
            free(parameters);
            if (!json_raw_value(&p, &parameters)) {
                free(key);
                goto done;
            }
        } else if (!json_skip_value(&p)) {
            free(key);
            goto done;
        }
        free(key);
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }

    if ((!type || !strcmp(type, "function")) && namespace && name && name[0]) {
        buf prompt_name = {0};
        buf_puts(&prompt_name, namespace);
        buf_puts(&prompt_name, name);

        buf b = {0};
        buf_puts(&b, "{\"name\":");
        json_escape(&b, prompt_name.ptr ? prompt_name.ptr : name);
        buf_puts(&b, ",\"description\":");
        json_escape(&b, description ? description : "");
        buf_puts(&b, ",\"parameters\":");
        buf_puts(&b, parameters ? parameters :
                 "{\"type\":\"object\",\"properties\":{}}");
        buf_putc(&b, '}');
        out = buf_take(&b);
        if (wire_name) *wire_name = xstrdup(name);
        buf_free(&prompt_name);
    }

done:
    free(type);
    free(name);
    free(description);
    free(parameters);
    return out;
}

static bool parse_schema_properties(const char *json, tool_schema_order *order) {
    const char *p = json;
    json_ws(&p);
    if (*p != '{') return false;
    p++;
    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        if (!json_string(&p, &key)) return false;
        json_ws(&p);
        if (*p != ':') {
            free(key);
            return false;
        }
        p++;
        if (!strcmp(key, "properties")) {
            free(key);
            json_ws(&p);
            if (*p != '{') return false;
            p++;
            json_ws(&p);
            while (*p && *p != '}') {
                char *prop = NULL;
                if (!json_string(&p, &prop)) return false;
                json_ws(&p);
                if (*p != ':') {
                    free(prop);
                    return false;
                }
                p++;
                tool_schema_order_prop_push(order, prop);
                if (!json_skip_value(&p)) return false;
                json_ws(&p);
                if (*p == ',') p++;
                json_ws(&p);
            }
            if (*p != '}') return false;
            p++;
        } else {
            free(key);
            if (!json_skip_value(&p)) return false;
        }
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }
    return *p == '}';
}

static void tool_schema_orders_add_json_wire(tool_schema_orders *orders,
                                             const char *json,
                                             const char *namespace,
                                             const char *wire_name,
                                             bool responses_tool_search) {
    if (!orders || !json) return;
    const char *p = json;
    json_ws(&p);
    if (*p != '{') return;
    p++;
    tool_schema_order order = {0};
    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        if (!json_string(&p, &key)) goto done;
        json_ws(&p);
        if (*p != ':') {
            free(key);
            goto done;
        }
        p++;
        if (!strcmp(key, "name")) {
            free(order.name);
            if (!json_string(&p, &order.name)) {
                free(key);
                goto done;
            }
        } else if (!strcmp(key, "input_schema") || !strcmp(key, "parameters")) {
            char *schema = NULL;
            if (!json_raw_value(&p, &schema)) {
                free(key);
                goto done;
            }
            parse_schema_properties(schema, &order);
            free(schema);
        } else if (!json_skip_value(&p)) {
            free(key);
            goto done;
        }
        free(key);
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }
    if (order.name) {
        if (namespace && namespace[0]) order.namespace = xstrdup(namespace);
        if (wire_name && wire_name[0]) order.wire_name = xstrdup(wire_name);
        order.responses_tool_search = responses_tool_search;
        tool_schema_orders_push(orders, order);
        memset(&order, 0, sizeof(order));
    }
done:
    tool_schema_order_free(&order);
}

static void tool_schema_orders_add_json(tool_schema_orders *orders, const char *json) {
    tool_schema_orders_add_json_wire(orders, json, NULL, NULL, false);
}

static bool append_responses_namespace_tool_schemas(buf *schemas,
                                                    tool_schema_orders *orders,
                                                    const char *raw) {
    const char *p = raw;
    json_ws(&p);
    if (*p != '{') return false;
    p++;

    char *type = NULL;
    char *name = NULL;
    char *tools = NULL;
    bool appended = false;

    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        if (!json_string(&p, &key)) goto done;
        json_ws(&p);
        if (*p != ':') {
            free(key);
            goto done;
        }
        p++;
        if (!strcmp(key, "type")) {
            free(type);
            if (!json_string(&p, &type)) {
                free(key);
                goto done;
            }
        } else if (!strcmp(key, "name")) {
            free(name);
            if (!json_string(&p, &name)) {
                free(key);
                goto done;
            }
        } else if (!strcmp(key, "tools")) {
            free(tools);
            if (!json_raw_value(&p, &tools)) {
                free(key);
                goto done;
            }
        } else if (!json_skip_value(&p)) {
            free(key);
            goto done;
        }
        free(key);
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }

    if (!type || strcmp(type, "namespace") || !name || !tools) goto done;

    const char *tp = tools;
    json_ws(&tp);
    if (*tp != '[') goto done;
    tp++;
    json_ws(&tp);
    while (*tp && *tp != ']') {
        char *tool_raw = NULL;
        if (!json_raw_value(&tp, &tool_raw)) goto done;
        char *wire_name = NULL;
        char *schema =
            responses_namespace_function_schema_from_tool(tool_raw, name, &wire_name);
        if (schema) {
            append_raw_json_line(schemas, schema);
            tool_schema_orders_add_json_wire(orders, schema, name, wire_name, false);
            appended = true;
        }
        free(schema);
        free(wire_name);
        free(tool_raw);
        json_ws(&tp);
        if (*tp == ',') tp++;
        json_ws(&tp);
    }

done:
    free(type);
    free(name);
    free(tools);
    return appended;
}

/* OpenAI wraps tools as {"type":"function","function":{...}}. Anthropic sends
 * the function schema directly as {"name":...,"input_schema":...}. The DS4
 * prompt wants one raw function schema per line, so unwrap OpenAI tools and keep
 * already-direct schemas unchanged. Responses can additionally group tools in a
 * namespace item; those are flattened for DSML prompt rendering while preserving
 * their client-facing name and namespace for response output. */
static bool parse_tools_value(const char **p, char **out, tool_schema_orders *orders) {
    json_ws(p);
    if (json_lit(p, "null")) {
        *out = xstrdup("");
        return true;
    }
    if (**p != '[') return false;
    (*p)++;
    buf schemas = {0};

    json_ws(p);
    while (**p && **p != ']') {
        char *raw = NULL;
        if (!json_raw_value(p, &raw)) goto bad;
        char *function = openai_function_schema_from_tool(raw);
        if (function) {
            append_raw_json_line(&schemas, function);
            tool_schema_orders_add_json(orders, function);
        } else if (!append_responses_namespace_tool_schemas(&schemas, orders, raw)) {
            char *special = responses_special_schema_from_tool(raw);
            if (special) {
                append_raw_json_line(&schemas, special);
                tool_schema_orders_add_json_wire(orders, special,
                                                 NULL, NULL, true);
            } else {
                append_raw_json_line(&schemas, raw);
                tool_schema_orders_add_json(orders, raw);
            }
            free(special);
        }
        free(function);
        free(raw);
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != ']') goto bad;
    (*p)++;
    *out = buf_take(&schemas);
    return true;
bad:
    buf_free(&schemas);
    return false;
}

static bool parse_messages(const char **p, chat_msgs *msgs) {
    json_ws(p);
    if (**p != '[') return false;
    (*p)++;

    json_ws(p);
    while (**p && **p != ']') {
        if (**p != '{') return false;
        (*p)++;
        chat_msg msg = {0};
        json_ws(p);
        while (**p && **p != '}') {
            char *key = NULL;
            if (!json_string(p, &key)) goto fail;
            json_ws(p);
            if (**p != ':') {
                free(key);
                goto fail;
            }
            (*p)++;
            if (!strcmp(key, "role")) {
                free(msg.role);
                if (!json_string(p, &msg.role)) {
                    free(key);
                    goto fail;
                }
            } else if (!strcmp(key, "content")) {
                free(msg.content);
                if (!json_content(p, &msg.content)) {
                    free(key);
                    goto fail;
                }
            } else if (!strcmp(key, "reasoning_content")) {
                free(msg.reasoning);
                if (!json_content(p, &msg.reasoning)) {
                    free(key);
                    goto fail;
                }
            } else if (!strcmp(key, "tool_call_id")) {
                char *id = NULL;
                if (!json_string(p, &id)) {
                    free(key);
                    goto fail;
                }
                chat_msg_add_tool_call_id(&msg, id);
                free(id);
            } else if (!strcmp(key, "tool_calls")) {
                tool_calls_free(&msg.calls);
                if (!parse_tool_calls_value(p, &msg.calls)) {
                    free(key);
                    goto fail;
                }
            } else if (!json_skip_value(p)) {
                free(key);
                goto fail;
            }
            free(key);
            json_ws(p);
            if (**p == ',') (*p)++;
            json_ws(p);
        }
        if (**p != '}') goto fail;
        (*p)++;
        if (!msg.role) msg.role = xstrdup("user");
        if (!msg.content) msg.content = xstrdup("");
        chat_msgs_push(msgs, msg);
        memset(&msg, 0, sizeof(msg));
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
        continue;
fail:
        chat_msg_free(&msg);
        return false;
    }
    if (**p != ']') return false;
    (*p)++;
    return true;
}

static void append_tool_result_text(buf *b, const char *s);

static bool append_anthropic_block_content(buf *dst, const char *text) {
    if (!text || !text[0]) return true;
    buf_puts(dst, text);
    return true;
}

/* Anthropic content is block-structured, while the engine consumes one compact
 * chat_msg per role.  Parsing collapses text/thinking into strings, converts
 * assistant tool_use blocks to tool_calls, and keeps tool_result blocks as
 * escaped text because DS4 sees tool results in its chat template. */
static bool parse_anthropic_content_block(const char **p, const char *role, chat_msg *msg) {
    (void)role;
    if (**p != '{') return false;
    (*p)++;
    char *type = NULL;
    char *text = NULL;
    char *thinking = NULL;
    char *id = NULL;
    char *name = NULL;
    char *input = NULL;
    char *tool_result = NULL;

    json_ws(p);
    while (**p && **p != '}') {
        char *key = NULL;
        if (!json_string(p, &key)) goto bad;
        json_ws(p);
        if (**p != ':') {
            free(key);
            goto bad;
        }
        (*p)++;
        if (!strcmp(key, "type")) {
            free(type);
            if (!json_string(p, &type)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "text")) {
            free(text);
            if (!json_content(p, &text)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "thinking")) {
            free(thinking);
            if (!json_content(p, &thinking)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "id") || !strcmp(key, "tool_use_id")) {
            free(id);
            if (!json_string(p, &id)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "name")) {
            free(name);
            if (!json_string(p, &name)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "input")) {
            free(input);
            if (!json_raw_value(p, &input)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "content")) {
            free(tool_result);
            if (!json_content(p, &tool_result)) {
                free(key);
                goto bad;
            }
        } else if (!json_skip_value(p)) {
            free(key);
            goto bad;
        }
        free(key);
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != '}') goto bad;
    (*p)++;

    /* JSON object member order is not meaningful.  Some Anthropic-compatible
     * clients serialize a message as {"content": ..., "role": ...}, so the
     * caller may not know the enclosing role yet while parsing content blocks.
     * Classify protocol blocks by their own "type" field; later rendering and
     * validation use the final message role. */
    if (type && !strcmp(type, "tool_use")) {
        tool_call tc = {0};
        tc.id = id ? xstrdup(id) : NULL;
        tc.name = name ? xstrdup(name) : xstrdup("");
        tc.arguments = input ? xstrdup(input) : xstrdup("{}");
        tool_calls_push(&msg->calls, tc);
    } else if (type && !strcmp(type, "tool_result")) {
        chat_msg_add_tool_call_id(msg, id);
        buf b = {0};
        buf_puts(&b, msg->content ? msg->content : "");
        buf_puts(&b, "<tool_result>");
        append_tool_result_text(&b, tool_result);
        buf_puts(&b, "</tool_result>");
        free(msg->content);
        msg->content = buf_take(&b);
    } else {
        if (text) {
            buf b = {0};
            buf_puts(&b, msg->content ? msg->content : "");
            append_anthropic_block_content(&b, text);
            free(msg->content);
            msg->content = buf_take(&b);
        }
        if (thinking) {
            buf b = {0};
            buf_puts(&b, msg->reasoning ? msg->reasoning : "");
            append_anthropic_block_content(&b, thinking);
            free(msg->reasoning);
            msg->reasoning = buf_take(&b);
        }
    }

    free(type);
    free(text);
    free(thinking);
    free(id);
    free(name);
    free(input);
    free(tool_result);
    return true;
bad:
    free(type);
    free(text);
    free(thinking);
    free(id);
    free(name);
    free(input);
    free(tool_result);
    return false;
}

static bool parse_anthropic_content(const char **p, chat_msg *msg) {
    json_ws(p);
    if (**p == '"') return json_string(p, &msg->content);
    if (json_lit(p, "null")) {
        msg->content = xstrdup("");
        return true;
    }
    if (**p != '[') return json_skip_value(p);
    (*p)++;
    json_ws(p);
    while (**p && **p != ']') {
        if (**p == '"') {
            char *s = NULL;
            if (!json_string(p, &s)) return false;
            buf b = {0};
            buf_puts(&b, msg->content ? msg->content : "");
            buf_puts(&b, s);
            free(msg->content);
            msg->content = buf_take(&b);
            free(s);
        } else if (**p == '{') {
            if (!parse_anthropic_content_block(p, msg->role ? msg->role : "", msg)) return false;
        } else if (!json_skip_value(p)) {
            return false;
        }
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != ']') return false;
    (*p)++;
    if (!msg->content) msg->content = xstrdup("");
    return true;
}

static bool parse_anthropic_messages(const char **p, chat_msgs *msgs) {
    json_ws(p);
    if (**p != '[') return false;
    (*p)++;

    json_ws(p);
    while (**p && **p != ']') {
        if (**p != '{') return false;
        (*p)++;
        chat_msg msg = {0};
        json_ws(p);
        while (**p && **p != '}') {
            char *key = NULL;
            if (!json_string(p, &key)) goto fail;
            json_ws(p);
            if (**p != ':') {
                free(key);
                goto fail;
            }
            (*p)++;
            if (!strcmp(key, "role")) {
                free(msg.role);
                if (!json_string(p, &msg.role)) {
                    free(key);
                    goto fail;
                }
            } else if (!strcmp(key, "content")) {
                free(msg.content);
                msg.content = NULL;
                if (!parse_anthropic_content(p, &msg)) {
                    free(key);
                    goto fail;
                }
            } else if (!json_skip_value(p)) {
                free(key);
                goto fail;
            }
            free(key);
            json_ws(p);
            if (**p == ',') (*p)++;
            json_ws(p);
        }
        if (**p != '}') goto fail;
        (*p)++;
        if (!msg.role) msg.role = xstrdup("user");
        if (!msg.content) msg.content = xstrdup("");
        chat_msgs_push(msgs, msg);
        memset(&msg, 0, sizeof(msg));
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
        continue;
fail:
        chat_msg_free(&msg);
        return false;
    }
    if (**p != ']') return false;
    (*p)++;
    return true;
}

static bool anthropic_system_part_is_private(const char *s) {
    return s && !strncmp(s, "x-anthropic-", 12);
}

static void append_anthropic_system_part(buf *b, const char *s) {
    if (!s || !s[0] || anthropic_system_part_is_private(s)) return;
    if (b->len && b->ptr[b->len - 1] != '\n') buf_putc(b, '\n');
    buf_puts(b, s);
}

static bool parse_anthropic_system_object(const char **p, buf *out) {
    if (**p != '{') return false;
    (*p)++;
    json_ws(p);
    while (**p && **p != '}') {
        char *key = NULL;
        if (!json_string(p, &key)) return false;
        json_ws(p);
        if (**p != ':') {
            free(key);
            return false;
        }
        (*p)++;
        if (!strcmp(key, "text")) {
            char *text = NULL;
            if (!json_string(p, &text)) {
                free(key);
                return false;
            }
            append_anthropic_system_part(out, text);
            free(text);
        } else if (!json_skip_value(p)) {
            free(key);
            return false;
        }
        free(key);
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != '}') return false;
    (*p)++;
    return true;
}

static bool parse_anthropic_system(const char **p, char **out) {
    json_ws(p);
    buf b = {0};
    if (**p == '"') {
        char *text = NULL;
        if (!json_string(p, &text)) return false;
        append_anthropic_system_part(&b, text);
        free(text);
        *out = buf_take(&b);
        return true;
    }
    if (json_lit(p, "null")) {
        *out = xstrdup("");
        return true;
    }
    if (**p != '[') {
        if (!json_skip_value(p)) return false;
        *out = xstrdup("");
        return true;
    }
    (*p)++;
    json_ws(p);
    while (**p && **p != ']') {
        if (**p == '"') {
            char *text = NULL;
            if (!json_string(p, &text)) goto bad;
            append_anthropic_system_part(&b, text);
            free(text);
        } else if (**p == '{') {
            if (!parse_anthropic_system_object(p, &b)) goto bad;
        } else if (!json_skip_value(p)) {
            goto bad;
        }
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != ']') goto bad;
    (*p)++;
    *out = buf_take(&b);
    return true;
bad:
    buf_free(&b);
    return false;
}

static void append_tools_prompt_text(buf *b, const char *tool_schemas) {
    if (!tool_schemas || !tool_schemas[0]) return;
    buf_puts(b,
        "## Tools\n\n"
        "You have access to a set of tools to help answer the user question. "
        "You can invoke tools by writing a \"<｜DSML｜tool_calls>\" block like the following:\n\n"
        "<｜DSML｜tool_calls>\n"
        "<｜DSML｜invoke name=\"$TOOL_NAME\">\n"
        "<｜DSML｜parameter name=\"$PARAMETER_NAME\" string=\"true|false\">$PARAMETER_VALUE</｜DSML｜parameter>\n"
        "...\n"
        "</｜DSML｜invoke>\n"
        "<｜DSML｜invoke name=\"$TOOL_NAME2\">\n"
        "...\n"
        "</｜DSML｜invoke>\n"
        "</｜DSML｜tool_calls>\n\n"
        "String parameters should be specified as raw text and set `string=\"true\"`. "
        "Preserve characters such as `>`, `&`, and `&&` exactly; never replace normal string characters with XML or HTML entity escapes. "
        "Only if a string value itself contains the exact closing parameter tag `</｜DSML｜parameter>`, write that tag as `&lt;/｜DSML｜parameter>` inside the value. "
        "For all other types (numbers, booleans, arrays, objects), pass the value in JSON format and set `string=\"false\"`.\n\n"
        "If thinking_mode is enabled (triggered by <think>), you MUST output your complete reasoning inside <think>...</think> BEFORE any tool calls or final response.\n\n"
        "Otherwise, output directly after </think> with tool calls or final response.\n\n"
        "### Available Tool Schemas\n\n");
    buf_puts(b, tool_schemas);
    buf_puts(b, "\n\nYou MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls. "
                "Use the exact parameter names from the schemas.");
}

static void json_escape(buf *b, const char *s);

typedef struct {
    char *key;
    char *value;
    bool is_string;
    bool used;
} json_arg;

typedef struct {
    json_arg *v;
    int len;
    int cap;
} json_args;

static void json_args_free(json_args *args) {
    for (int i = 0; i < args->len; i++) {
        free(args->v[i].key);
        free(args->v[i].value);
    }
    free(args->v);
    memset(args, 0, sizeof(*args));
}

static void json_args_push(json_args *args, json_arg arg) {
    if (args->len == args->cap) {
        args->cap = args->cap ? args->cap * 2 : 8;
        args->v = xrealloc(args->v, (size_t)args->cap * sizeof(args->v[0]));
    }
    args->v[args->len++] = arg;
}

static int json_args_find_unused(json_args *args, const char *key) {
    if (!key) return -1;
    for (int i = 0; i < args->len; i++) {
        if (!args->v[i].used && args->v[i].key && !strcmp(args->v[i].key, key)) return i;
    }
    return -1;
}

static bool json_args_parse(const char *json, json_args *args) {
    const char *p = json ? json : "";
    json_ws(&p);
    if (*p != '{') return false;
    p++;
    json_ws(&p);
    while (*p && *p != '}') {
        bool is_string = false;
        char *key = NULL;
        char *value = NULL;
        if (!json_string(&p, &key)) goto bad;
        json_ws(&p);
        if (*p != ':') goto bad;
        p++;
        json_ws(&p);
        if (*p == '"') {
            is_string = true;
            if (!json_string(&p, &value)) goto bad;
        } else {
            char *raw = NULL;
            if (!json_raw_value(&p, &raw)) goto bad;
            value = json_minify_raw_value(raw);
            free(raw);
        }

        json_arg arg = {.key = key, .value = value, .is_string = is_string};
        json_args_push(args, arg);
        key = value = NULL;
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
        continue;
bad:
        free(key);
        free(value);
        json_args_free(args);
        return false;
    }
    if (*p != '}') {
        json_args_free(args);
        return false;
    }
    return true;
}

static void append_dsml_attr_escaped(buf *b, const char *s) {
    for (s = s ? s : ""; *s; s++) {
        if (*s == '&') buf_puts(b, "&amp;");
        else if (*s == '<') buf_puts(b, "&lt;");
        else if (*s == '>') buf_puts(b, "&gt;");
        else if (*s == '"') buf_puts(b, "&quot;");
        else buf_putc(b, *s);
    }
}

static void append_dsml_parameter_text(buf *b, const char *s) {
    const char *end = "</｜DSML｜parameter>";
    const size_t endlen = strlen(end);
    for (s = s ? s : ""; *s;) {
        if (!strncmp(s, end, endlen)) {
            buf_puts(b, "&lt;");
            s++;
        } else {
            buf_putc(b, *s++);
        }
    }
}

static void append_tool_result_text(buf *b, const char *s) {
    /* Tool output is data.  DeepSeek's renderer keeps it as ordinary text inside
     * <tool_result>...</tool_result>, so preserving literal '<', '>' and '&' is
     * important for read-file tools and shell output.  The only delimiter we must
     * protect is the wrapper's own closing tag; otherwise a file containing that
     * exact sentinel would terminate the result early. */
    const char *end = "</tool_result>";
    const size_t endlen = strlen(end);
    for (s = s ? s : ""; *s;) {
        if (!strncmp(s, end, endlen)) {
            buf_puts(b, "&lt;");
            s++;
        } else {
            buf_putc(b, *s++);
        }
    }
}

static void append_dsml_json_literal(buf *b, const char *s) {
    const char *end = "</｜DSML｜parameter>";
    const size_t endlen = strlen(end);
    for (s = s ? s : ""; *s;) {
        if (!strncmp(s, end, endlen)) {
            buf_puts(b, "\\u003c");
            s++;
        } else {
            buf_putc(b, *s++);
        }
    }
}

static void append_dsml_arg(buf *b, const json_arg *arg) {
    buf_puts(b, "<｜DSML｜parameter name=\"");
    append_dsml_attr_escaped(b, arg->key);
    buf_puts(b, "\" string=\"");
    buf_puts(b, arg->is_string ? "true" : "false");
    buf_puts(b, "\">");
    if (arg->is_string) append_dsml_parameter_text(b, arg->value);
    else append_dsml_json_literal(b, arg->value);
    buf_puts(b, "</｜DSML｜parameter>\n");
}

static bool append_dsml_arguments_from_json(buf *b, const char *json, const tool_schema_order *order) {
    json_args args = {0};
    if (!json_args_parse(json, &args)) return false;
    if (order) {
        for (int i = 0; i < order->len; i++) {
            int idx = json_args_find_unused(&args, order->prop[i]);
            if (idx < 0) continue;
            append_dsml_arg(b, &args.v[idx]);
            args.v[idx].used = true;
        }
    }
    for (int i = 0; i < args.len; i++) {
        if (args.v[i].used) continue;
        append_dsml_arg(b, &args.v[i]);
    }
    json_args_free(&args);
    return true;
}

static void append_json_arg_pair(buf *b, const json_arg *arg) {
    json_escape(b, arg->key);
    buf_puts(b, ":");
    if (arg->is_string) json_escape(b, arg->value);
    else buf_puts(b, arg->value);
}

static void append_json_object_or_empty(buf *b, const char *json) {
    json_args args = {0};
    if (!json_args_parse(json, &args)) {
        buf_puts(b, "{}");
        return;
    }
    buf_putc(b, '{');
    bool wrote = false;
    for (int i = 0; i < args.len; i++) {
        if (wrote) buf_putc(b, ',');
        append_json_arg_pair(b, &args.v[i]);
        wrote = true;
    }
    buf_putc(b, '}');
    json_args_free(&args);
}

static void append_dsml_tool_calls_text(buf *b, const tool_calls *calls) {
    if (!calls || calls->len == 0) return;
    if (calls->raw_dsml && calls->raw_dsml[0]) {
        buf_puts(b, calls->raw_dsml);
        return;
    }
    buf_puts(b, "\n\n<｜DSML｜tool_calls>\n");
    for (int i = 0; i < calls->len; i++) {
        const tool_call *tc = &calls->v[i];
        buf_puts(b, "<｜DSML｜invoke name=\"");
        append_dsml_attr_escaped(b, tc->name);
        buf_puts(b, "\">\n");
        if (!append_dsml_arguments_from_json(b, tc->arguments, NULL)) {
            buf_puts(b, "<｜DSML｜parameter name=\"arguments\" string=\"true\">");
            append_dsml_parameter_text(b, tc->arguments);
            buf_puts(b, "</｜DSML｜parameter>\n");
        }
        buf_puts(b, "</｜DSML｜invoke>\n");
    }
    buf_puts(b, "</｜DSML｜tool_calls>");
}

static bool role_is_system(const char *role) {
    return !strcmp(role, "system") || !strcmp(role, "developer");
}

static bool role_is_user_like(const char *role) {
    return !strcmp(role, "user") || !strcmp(role, "tool") || !strcmp(role, "function");
}

static bool chat_history_uses_tool_context(const chat_msgs *msgs,
                                           const char *tool_schemas) {
    if (tool_schemas && tool_schemas[0]) return true;
    for (int i = 0; msgs && i < msgs->len; i++) {
        const chat_msg *m = &msgs->v[i];
        if ((!strcmp(m->role, "assistant") && m->calls.len > 0) ||
            !strcmp(m->role, "tool") || !strcmp(m->role, "function"))
        {
            return true;
        }
    }
    return false;
}

static char *render_chat_prompt_text(const chat_msgs *msgs, const char *tool_schemas,
                                     const tool_schema_orders *tool_orders,
                                     ds4_think_mode think_mode) {
    (void)tool_orders;
    const bool think = ds4_think_mode_enabled(think_mode);
    const bool tool_context = chat_history_uses_tool_context(msgs, tool_schemas);
    int last_user_idx = -1;
    buf system = {0};
    /* Render tool schemas before the client system content so
     * --kv-cache-boundary-trim-tokens chops a dynamic tail from the client
     * message instead of the much larger tool-schema region. */
    if (tool_schemas && tool_schemas[0]) {
        append_tools_prompt_text(&system, tool_schemas);
    }
    for (int i = 0; i < msgs->len; i++) {
        const chat_msg *m = &msgs->v[i];
        if (!role_is_system(m->role)) continue;
        if (system.len) buf_puts(&system, "\n\n");
        buf_puts(&system, m->content ? m->content : "");
    }
    for (int i = 0; i < msgs->len; i++) {
        const chat_msg *m = &msgs->v[i];
        if (role_is_user_like(m->role)) last_user_idx = i;
    }

    buf out = {0};
    buf_puts(&out, "<｜begin▁of▁sentence｜>");
    if (think_mode == DS4_THINK_MAX) buf_puts(&out, ds4_think_max_prefix());
    buf_puts(&out, system.ptr ? system.ptr : "");

    bool pending_assistant = false;
    bool pending_tool_result = false;
    for (int i = 0; i < msgs->len; i++) {
        const chat_msg *m = &msgs->v[i];
        if (role_is_system(m->role)) {
            continue;
        } else if (!strcmp(m->role, "user")) {
            buf_puts(&out, "<｜User｜>");
            buf_puts(&out, m->content ? m->content : "");
            pending_assistant = true;
            pending_tool_result = false;
        } else if (!strcmp(m->role, "tool") || !strcmp(m->role, "function")) {
            if (!pending_tool_result) buf_puts(&out, "<｜User｜>");
            buf_puts(&out, "<tool_result>");
            append_tool_result_text(&out, m->content);
            buf_puts(&out, "</tool_result>");
            pending_assistant = true;
            pending_tool_result = true;
        } else if (!strcmp(m->role, "assistant")) {
            if (pending_assistant) {
                buf_puts(&out, "<｜Assistant｜>");
                if (think) {
                    if (tool_context || i > last_user_idx) {
                        buf_puts(&out, "<think>");
                        buf_puts(&out, m->reasoning ? m->reasoning : "");
                        buf_puts(&out, "</think>");
                    } else {
                        buf_puts(&out, "</think>");
                    }
                } else {
                    buf_puts(&out, "</think>");
                }
            }
            buf_puts(&out, m->content ? m->content : "");
            append_dsml_tool_calls_text(&out, &m->calls);
            buf_puts(&out, "<｜end▁of▁sentence｜>");
            pending_assistant = false;
            pending_tool_result = false;
        }
    }

    if (pending_assistant) {
        buf_puts(&out, "<｜Assistant｜>");
        buf_puts(&out, think ? "<think>" : "</think>");
    }

    buf_free(&system);
    return buf_take(&out);
}

/* Render only the semantic tail that must be appended to the live KV for a
 * tool-result continuation.
 *
 * In the common agent tool path, the previous assistant tool-call turn is
 * already in the model session, including hidden thinking and exact sampled
 * DSML.  The next request provides only the tool results, either as OpenAI
 * Responses tool-output items or Anthropic user content blocks.  Re-rendering
 * the assistant call here would duplicate it and destroy cache alignment, so
 * this function starts at the first new item and emits only:
 *
 *   previous EOS, tool results, and the next assistant prefix.
 *
 * This is intentionally independent from req.prompt's already-tokenized suffix:
 * suffix tokenization happens later after the cache decision, using the live
 * token prefix as the boundary.  That avoids BPE merges across the visible
 * replay/live-KV boundary. */
static char *render_live_tool_tail(const chat_msgs *msgs, int start,
                                   ds4_think_mode think_mode) {
    const bool think = ds4_think_mode_enabled(think_mode);
    buf out = {0};
    buf_puts(&out, "<｜end▁of▁sentence｜>");

    bool pending_assistant = false;
    bool pending_tool_result = false;
    for (int i = start; msgs && i < msgs->len; i++) {
        const chat_msg *m = &msgs->v[i];
        if (role_is_system(m->role)) {
            continue;
        } else if (!strcmp(m->role, "user")) {
            buf_puts(&out, "<｜User｜>");
            buf_puts(&out, m->content ? m->content : "");
            pending_assistant = true;
            pending_tool_result = false;
        } else if (!strcmp(m->role, "tool") || !strcmp(m->role, "function")) {
            if (!pending_tool_result) buf_puts(&out, "<｜User｜>");
            buf_puts(&out, "<tool_result>");
            append_tool_result_text(&out, m->content);
            buf_puts(&out, "</tool_result>");
            pending_assistant = true;
            pending_tool_result = true;
        } else if (!strcmp(m->role, "assistant")) {
            if (pending_assistant) {
                buf_puts(&out, "<｜Assistant｜>");
                if (think) {
                    buf_puts(&out, "<think>");
                    buf_puts(&out, m->reasoning ? m->reasoning : "");
                    buf_puts(&out, "</think>");
                } else {
                    buf_puts(&out, "</think>");
                }
            }
            buf_puts(&out, m->content ? m->content : "");
            append_dsml_tool_calls_text(&out, &m->calls);
            buf_puts(&out, "<｜end▁of▁sentence｜>");
            pending_assistant = false;
            pending_tool_result = false;
        }
    }

    if (pending_assistant) {
        buf_puts(&out, "<｜Assistant｜>");
        buf_puts(&out, think ? "<think>" : "</think>");
    }
    return buf_take(&out);
}

static bool chat_msg_has_call_id(const chat_msg *m, const char *id) {
    if (!m || !id || !id[0] || strcmp(m->role, "assistant")) return false;
    for (int i = 0; i < m->calls.len; i++) {
        if (m->calls.v[i].id && !strcmp(m->calls.v[i].id, id)) return true;
    }
    return false;
}

static void chat_msg_collect_tool_call_ids(const chat_msg *m, stop_list *ids) {
    if (!m || !ids) return;
    id_list_push_unique(ids, m->tool_call_id);
    for (int i = 0; i < m->tool_call_ids_len; i++) {
        id_list_push_unique(ids, m->tool_call_ids[i]);
    }
}

static const chat_msg *responses_find_prior_call_msg(const chat_msgs *msgs,
                                                     int before,
                                                     const char *id) {
    if (!msgs || !id || !id[0]) return NULL;
    if (before > msgs->len) before = msgs->len;
    for (int i = before - 1; i >= 0; i--) {
        if (chat_msg_has_call_id(&msgs->v[i], id)) return &msgs->v[i];
    }
    return NULL;
}

/* Validate Responses tool outputs before rendering.
 *
 * A tool output with a call_id is meaningful only if either:
 *   1. DS4 still has the matching live assistant call in memory, or
 *   2. the same request replays the prior assistant call item.
 *
 * Case 1 is the fast, protocol-native continuation path: keep the live KV and
 * append only the tool result.  Case 2 is stateless replay after restart or
 * branching.  In thinking mode, case 2 is less faithful if the replay omits
 * reasoning state for the assistant call.  Official Responses clients can
 * carry that state with reasoning items / encrypted reasoning content; when
 * they do not, the request is still renderable as visible history.  Mark that
 * condition so generate_job() can prefer live / visible checkpoints and emit a
 * warning if it must fall back to visible replay instead of aborting the
 * session. */
static bool responses_validate_tool_outputs(server *s, const chat_msgs *msgs,
                                            ds4_think_mode think_mode,
                                            bool *requires_live_tool_state,
                                            bool *requires_live_reasoning,
                                            char *err, size_t errlen) {
    if (!msgs) return true;
    if (requires_live_tool_state) *requires_live_tool_state = false;
    if (requires_live_reasoning) *requires_live_reasoning = false;
    const bool needs_reasoning = ds4_think_mode_enabled(think_mode);
    for (int i = 0; i < msgs->len; i++) {
        const chat_msg *m = &msgs->v[i];
        if (strcmp(m->role, "tool") && strcmp(m->role, "function")) continue;

        stop_list ids = {0};
        chat_msg_collect_tool_call_ids(m, &ids);
        for (int j = 0; j < ids.len; j++) {
            const char *id = ids.v[j];
            const bool live_known = responses_live_has_call_id(s, id);
            const chat_msg *prior = responses_find_prior_call_msg(msgs, i, id);
            if (!live_known && !prior) {
                snprintf(err, errlen,
                         "Responses continuation state is not available for call_id %s; retry by replaying the full input history",
                         id);
                id_list_free(&ids);
                return false;
            }
            if (!prior) {
                if (requires_live_tool_state) *requires_live_tool_state = true;
                continue;
            }
            if (needs_reasoning &&
                (!prior->reasoning || !prior->reasoning[0]))
            {
                if (requires_live_reasoning) *requires_live_reasoning = true;
            }
        }
        id_list_free(&ids);
    }
    return true;
}

/* Record the call ids and suffix candidate for a live Responses continuation.
 *
 * This only prepares evidence.  generate_job() later checks that the live
 * server state is still exactly at the remembered token frontier before using
 * it.  If another request already replaced the session, normal token/text/disk
 * prefix matching handles the request instead. */
static void responses_prepare_live_continuation(request *r,
                                                const chat_msgs *msgs) {
    if (!r || r->api != API_RESPONSES || !msgs || msgs->len == 0) return;

    int tail_start = msgs->len;
    while (tail_start > 0) {
        const chat_msg *m = &msgs->v[tail_start - 1];
        if (strcmp(m->role, "tool") && strcmp(m->role, "function")) break;
        tail_start--;
    }
    if (tail_start == msgs->len) return;

    stop_list_clear(&r->responses_live_call_ids);
    if (tail_start > 0) {
        const int anchor = tail_start - 1;
        const chat_msg *assistant = &msgs->v[anchor];
        if (strcmp(assistant->role, "assistant") || assistant->calls.len == 0) return;
        for (int i = 0; i < assistant->calls.len; i++) {
            id_list_push_unique(&r->responses_live_call_ids, assistant->calls.v[i].id);
        }
    } else {
        for (int i = tail_start; i < msgs->len; i++) {
            chat_msg_collect_tool_call_ids(&msgs->v[i], &r->responses_live_call_ids);
        }
    }
    if (r->responses_live_call_ids.len == 0) return;

    free(r->responses_live_suffix_text);
    r->responses_live_suffix_text =
        render_live_tool_tail(msgs, tail_start, r->think_mode);
}

static bool anthropic_msg_is_tool_result_tail(const chat_msg *m) {
    return m && !strcmp(m->role, "user") &&
           ((m->tool_call_id && m->tool_call_id[0]) ||
            m->tool_call_ids_len > 0);
}

/* Validate Anthropic tool results before rendering.
 *
 * A tool_result.tool_use_id is valid if it is either still bound to the live
 * Anthropic assistant tool-call frontier or the same request replays the prior
 * assistant tool_use block.  The first case is the fast path: keep the sampled
 * KV and append only the tool-result suffix.  The second case is a normal
 * stateless replay, where exact DSML tool memory can restore the sampled tool
 * bytes before prefix matching.  A tool-result-only request with an unknown
 * live id has no safe prefix to reconstruct, so report a clear client error. */
static bool anthropic_validate_tool_results(server *s, const chat_msgs *msgs,
                                            bool *requires_live_tool_state,
                                            char *err, size_t errlen) {
    if (requires_live_tool_state) *requires_live_tool_state = false;
    if (!msgs) return true;
    for (int i = 0; i < msgs->len; i++) {
        const chat_msg *m = &msgs->v[i];
        if (!anthropic_msg_is_tool_result_tail(m)) continue;

        stop_list ids = {0};
        chat_msg_collect_tool_call_ids(m, &ids);
        for (int j = 0; j < ids.len; j++) {
            const char *id = ids.v[j];
            const bool live_known = anthropic_live_has_call_id(s, id);
            const chat_msg *prior = responses_find_prior_call_msg(msgs, i, id);
            if (!live_known && !prior) {
                snprintf(err, errlen,
                         "Anthropic continuation state is not available for tool_use_id %s; retry by replaying the full messages history",
                         id);
                id_list_free(&ids);
                return false;
            }
            if (!prior && requires_live_tool_state) {
                *requires_live_tool_state = true;
            }
        }
        id_list_free(&ids);
    }
    return true;
}

/* Prepare the Anthropic live-tool fast path.
 *
 * Anthropic's visible replay normally includes the assistant tool_use JSON and
 * the user tool_result.  That replay is still only a description of what the
 * model sampled.  If the incoming tool_result IDs match the live sampled
 * frontier, generate_job() can skip replay matching entirely and append just
 * EOS + tool_result + next assistant prefix to the real KV. */
static void anthropic_prepare_live_continuation(request *r,
                                                const chat_msgs *msgs) {
    if (!r || r->api != API_ANTHROPIC || !msgs || msgs->len == 0) return;

    int tail_end = msgs->len;
    while (tail_end > 0 && role_is_system(msgs->v[tail_end - 1].role)) tail_end--;
    int tail_start = tail_end;
    while (tail_start > 0 &&
           anthropic_msg_is_tool_result_tail(&msgs->v[tail_start - 1]))
    {
        tail_start--;
    }
    if (tail_start == tail_end) return;

    stop_list_clear(&r->anthropic_live_call_ids);
    for (int i = tail_start; i < msgs->len; i++) {
        chat_msg_collect_tool_call_ids(&msgs->v[i], &r->anthropic_live_call_ids);
    }
    if (r->anthropic_live_call_ids.len == 0) return;

    free(r->anthropic_live_suffix_text);
    r->anthropic_live_suffix_text =
        render_live_tool_tail(msgs, tail_start, r->think_mode);
}

/* The API parsers are intentionally selective JSON parsers: they keep only
 * fields that affect model semantics, rendering, streaming, or cache keys, and
 * skip extension fields.  The output is always a rendered DS4 chat/completion
 * prompt plus the small amount of protocol state needed to translate the reply. */
static bool parse_chat_request(ds4_engine *e, server *s, const char *body, int def_tokens,
                               int ctx_size, request *r, char *err, size_t errlen) {
    request_init(r, REQ_CHAT, def_tokens);
    const char *p = body;
    bool got_messages = false;
    bool tool_choice_none = false;
    bool got_thinking = false;
    bool thinking_enabled = true;
    ds4_think_mode reasoning_effort = DS4_THINK_HIGH;
    chat_msgs msgs = {0};
    char *tool_schemas = NULL;

    json_ws(&p);
    if (*p != '{') goto bad;
    p++;
    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        if (!json_string(&p, &key)) goto bad;
        json_ws(&p);
        if (*p != ':') {
            free(key);
            goto bad;
        }
        p++;
        if (!strcmp(key, "messages")) {
            chat_msgs_free(&msgs);
            if (!parse_messages(&p, &msgs)) {
                free(key);
                goto bad;
            }
            got_messages = true;
        } else if (!strcmp(key, "tools")) {
            free(tool_schemas);
            tool_schemas = NULL;
            if (!parse_tools_value(&p, &tool_schemas, &r->tool_orders)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "tool_choice")) {
            json_ws(&p);
            if (*p == '"') {
                char *choice = NULL;
                if (!json_string(&p, &choice)) {
                    free(key);
                    goto bad;
                }
                tool_choice_none = !strcmp(choice, "none");
                free(choice);
            } else if (!json_skip_value(&p)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "model")) {
            free(r->model);
            if (!json_string(&p, &r->model)) {
                free(key);
                goto bad;
            }
            r->model_from_request = true;
        } else if (!strcmp(key, "max_tokens") || !strcmp(key, "max_completion_tokens")) {
            if (!json_int(&p, &r->max_tokens)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "temperature")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->temperature = (float)v;
        } else if (!strcmp(key, "top_p")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->top_p = (float)v;
        } else if (!strcmp(key, "min_p")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->min_p = (float)v;
        } else if (!strcmp(key, "top_k")) {
            if (!json_int(&p, &r->top_k)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "seed")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->seed = v > 0.0 ? (uint64_t)v : 0;
        } else if (!strcmp(key, "stream")) {
            if (!json_bool(&p, &r->stream)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "stream_options")) {
            if (!parse_stream_options(&p, &r->stream_include_usage)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "thinking")) {
            if (!parse_thinking_control_value(&p, &thinking_enabled)) {
                free(key);
                goto bad;
            }
            got_thinking = true;
        } else if (!strcmp(key, "reasoning_effort")) {
            if (!parse_reasoning_effort_value(&p, &reasoning_effort)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "think")) {
            if (!json_bool(&p, &thinking_enabled)) {
                free(key);
                goto bad;
            }
            got_thinking = true;
        } else if (!strcmp(key, "stop")) {
            if (!parse_stop(&p, &r->stops)) {
                free(key);
                goto bad;
            }
        } else if (!json_skip_value(&p)) {
            free(key);
            goto bad;
        }
        free(key);
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }
    if (*p != '}') goto bad;
    if (!got_messages) {
        snprintf(err, errlen, "missing messages");
        chat_msgs_free(&msgs);
        free(tool_schemas);
        request_free(r);
        return false;
    }
    r->has_tools = tool_schemas && tool_schemas[0] && !tool_choice_none;
    if (!got_thinking && model_alias_disables_thinking(r->model)) thinking_enabled = false;
    if (!got_thinking && model_alias_enables_thinking(r->model)) thinking_enabled = true;
    r->think_mode = ds4_think_mode_for_context(
        think_mode_from_enabled(thinking_enabled, reasoning_effort), ctx_size);
    kv_cache_restore_tool_memory_for_messages(s, &msgs);
    tool_memory_attach_to_messages(s, &msgs, &r->tool_replay);
    const char *active_tool_schemas = r->has_tools ? tool_schemas : NULL;
    r->prompt_preserves_reasoning =
        chat_history_uses_tool_context(&msgs, active_tool_schemas);
    r->prompt_text = render_chat_prompt_text(&msgs, active_tool_schemas,
                                             &r->tool_orders, r->think_mode);
    ds4_tokenize_rendered_chat(e, r->prompt_text, &r->prompt);
    chat_msgs_free(&msgs);
    free(tool_schemas);
    return true;
bad:
    chat_msgs_free(&msgs);
    free(tool_schemas);
    snprintf(err, errlen, "invalid JSON request");
    request_free(r);
    return false;
}

static bool parse_anthropic_request(ds4_engine *e, server *s, const char *body, int def_tokens,
                                    int ctx_size, request *r, char *err, size_t errlen) {
    request_init(r, REQ_CHAT, def_tokens);
    r->api = API_ANTHROPIC;
    const char *p = body;
    bool got_messages = false;
    bool tool_choice_none = false;
    bool got_thinking = false;
    bool thinking_enabled = true;
    ds4_think_mode reasoning_effort = DS4_THINK_HIGH;
    chat_msgs msgs = {0};
    char *system = NULL;
    char *tool_schemas = NULL;

    json_ws(&p);
    if (*p != '{') goto bad;
    p++;
    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        if (!json_string(&p, &key)) goto bad;
        json_ws(&p);
        if (*p != ':') {
            free(key);
            goto bad;
        }
        p++;
        if (!strcmp(key, "messages")) {
            chat_msgs_free(&msgs);
            if (!parse_anthropic_messages(&p, &msgs)) {
                free(key);
                goto bad;
            }
            got_messages = true;
        } else if (!strcmp(key, "system")) {
            free(system);
            if (!parse_anthropic_system(&p, &system)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "tools")) {
            free(tool_schemas);
            tool_schemas = NULL;
            if (!parse_tools_value(&p, &tool_schemas, &r->tool_orders)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "tool_choice")) {
            json_ws(&p);
            if (*p == '{') {
                p++;
                json_ws(&p);
                while (*p && *p != '}') {
                    char *ckey = NULL;
                    if (!json_string(&p, &ckey)) {
                        free(key);
                        goto bad;
                    }
                    json_ws(&p);
                    if (*p != ':') {
                        free(ckey);
                        free(key);
                        goto bad;
                    }
                    p++;
                    if (!strcmp(ckey, "type")) {
                        char *choice = NULL;
                        if (!json_string(&p, &choice)) {
                            free(ckey);
                            free(key);
                            goto bad;
                        }
                        tool_choice_none = !strcmp(choice, "none");
                        free(choice);
                    } else if (!json_skip_value(&p)) {
                        free(ckey);
                        free(key);
                        goto bad;
                    }
                    free(ckey);
                    json_ws(&p);
                    if (*p == ',') p++;
                    json_ws(&p);
                }
                if (*p != '}') {
                    free(key);
                    goto bad;
                }
                p++;
            } else if (!json_skip_value(&p)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "model")) {
            free(r->model);
            if (!json_string(&p, &r->model)) {
                free(key);
                goto bad;
            }
            r->model_from_request = true;
        } else if (!strcmp(key, "max_tokens")) {
            if (!json_int(&p, &r->max_tokens)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "temperature")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->temperature = (float)v;
        } else if (!strcmp(key, "top_p")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->top_p = (float)v;
        } else if (!strcmp(key, "top_k")) {
            if (!json_int(&p, &r->top_k)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "stream")) {
            if (!json_bool(&p, &r->stream)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "stop_sequences")) {
            if (!parse_stop(&p, &r->stops)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "thinking")) {
            if (!parse_thinking_control_value(&p, &thinking_enabled)) {
                free(key);
                goto bad;
            }
            got_thinking = true;
        } else if (!strcmp(key, "output_config")) {
            if (!parse_output_config_effort(&p, &reasoning_effort)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "reasoning_effort")) {
            if (!parse_reasoning_effort_value(&p, &reasoning_effort)) {
                free(key);
                goto bad;
            }
        } else if (!json_skip_value(&p)) {
            free(key);
            goto bad;
        }
        free(key);
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }
    if (*p != '}') goto bad;
    if (!got_messages) {
        snprintf(err, errlen, "missing messages");
        chat_msgs_free(&msgs);
        free(system);
        free(tool_schemas);
        request_free(r);
        return false;
    }
    if (system && system[0]) {
        chat_msg msg = {0};
        msg.role = xstrdup("system");
        msg.content = system;
        system = NULL;
        chat_msgs_push(&msgs, msg);
    }
    r->has_tools = tool_schemas && tool_schemas[0] && !tool_choice_none;
    if (!got_thinking && model_alias_disables_thinking(r->model)) thinking_enabled = false;
    if (!got_thinking && model_alias_enables_thinking(r->model)) thinking_enabled = true;
    r->think_mode = ds4_think_mode_for_context(
        think_mode_from_enabled(thinking_enabled, reasoning_effort), ctx_size);
    if (!anthropic_validate_tool_results(s, &msgs,
                                         &r->anthropic_requires_live_tool_state,
                                         err, errlen))
    {
        chat_msgs_free(&msgs);
        free(system);
        free(tool_schemas);
        request_free(r);
        return false;
    }
    kv_cache_restore_tool_memory_for_messages(s, &msgs);
    tool_memory_attach_to_messages(s, &msgs, &r->tool_replay);
    anthropic_prepare_live_continuation(r, &msgs);
    const char *active_tool_schemas = r->has_tools ? tool_schemas : NULL;
    r->prompt_preserves_reasoning =
        chat_history_uses_tool_context(&msgs, active_tool_schemas);
    r->prompt_text = render_chat_prompt_text(&msgs, active_tool_schemas,
                                             &r->tool_orders, r->think_mode);
    ds4_tokenize_rendered_chat(e, r->prompt_text, &r->prompt);
    chat_msgs_free(&msgs);
    free(system);
    free(tool_schemas);
    return true;
bad:
    chat_msgs_free(&msgs);
    free(system);
    free(tool_schemas);
    snprintf(err, errlen, "invalid JSON request");
    request_free(r);
    return false;
}

/* Responses API: convert a content-array item (input_text/output_text/text) into a
 * concatenated string. Strict shape check: bare string, null, or an array of
 * recognized text blocks. Numbers / objects / arrays-of-primitives at the top
 * level all reject so the client sees a 400 instead of an answer built on
 * silently dropped context. */
static bool parse_responses_content_array(const char **p, char **out) {
    json_ws(p);
    if (**p == '"') return json_string(p, out);
    if (json_lit(p, "null")) {
        *out = xstrdup("");
        return true;
    }
    if (**p != '[') {
        return false;
    }
    (*p)++;
    buf b = {0};
    json_ws(p);
    while (**p && **p != ']') {
        if (**p == '"') {
            char *s = NULL;
            if (!json_string(p, &s)) goto fail;
            buf_puts(&b, s);
            free(s);
        } else if (**p == '{') {
            (*p)++;
            char *type = NULL;
            char *text = NULL;
            json_ws(p);
            while (**p && **p != '}') {
                char *key = NULL;
                if (!json_string(p, &key)) {
                    free(type);
                    free(text);
                    goto fail;
                }
                json_ws(p);
                if (**p != ':') {
                    free(key);
                    free(type);
                    free(text);
                    goto fail;
                }
                (*p)++;
                if (!strcmp(key, "type")) {
                    free(type);
                    if (!json_string(p, &type)) {
                        free(key);
                        free(text);
                        goto fail;
                    }
                } else if (!strcmp(key, "text")) {
                    free(text);
                    /* The text field of a typed content block is a plain JSON
                     * string. Accept null as the empty string for parity with
                     * upstream serializers that emit null for empty blocks. */
                    json_ws(p);
                    if (json_lit(p, "null")) {
                        text = xstrdup("");
                    } else if (!json_string(p, &text)) {
                        free(key);
                        free(type);
                        goto fail;
                    }
                } else if (!json_skip_value(p)) {
                    free(key);
                    free(type);
                    free(text);
                    goto fail;
                }
                free(key);
                json_ws(p);
                if (**p == ',') (*p)++;
                json_ws(p);
            }
            if (**p != '}') {
                free(type);
                free(text);
                goto fail;
            }
            (*p)++;
            /* Fail closed: a content object must carry a known text-like type
             * AND a text field. Anything else — missing type, missing text,
             * image/file/audio types, future schema-drift — is rejected so the
             * client gets a 400 instead of an answer built on context the
             * server discarded silently. */
            bool is_text_block = type && (
                !strcmp(type, "input_text") ||
                !strcmp(type, "output_text") ||
                !strcmp(type, "text") ||
                !strcmp(type, "summary_text") ||
                !strcmp(type, "reasoning_text"));
            if (!is_text_block || !text) {
                free(type);
                free(text);
                goto fail;
            }
            buf_puts(&b, text);
            free(type);
            free(text);
        } else {
            /* Reject primitives, arrays-of-arrays, nulls: a content array
             * element must be either a string or a typed text object. */
            goto fail;
        }
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != ']') goto fail;
    (*p)++;
    *out = buf_take(&b);
    return true;
fail:
    buf_free(&b);
    return false;
}

/* Codex /v1/responses input items have a `type` discriminator (message,
 * function_call, function_call_output, reasoning, custom_tool_call,
 * custom_tool_call_output, ...). We collapse them into chat_msgs the same way
 * the chat completion / Anthropic parsers do, so the rest of the engine sees a
 * single conversation history shape.
 *
 * Protocol contract for stateless replay:
 *   - The client must replay response.output items before tool outputs.
 *   - For reasoning models, the replay must also include reasoning state.  DS4
 *     can render plain reasoning summaries/content, but it cannot decrypt
 *     reasoning.encrypted_content.  If live state is unavailable and the replay
 *     only contains visible messages/tool calls, later validation marks it as a
 *     lower-fidelity replay; generate_job() logs that and continues from the
 *     visible transcript rather than killing a recoverable agent session.
 *
 * Reasoning items are merged into the next assistant message so
 * render_chat_prompt_text can wrap them in <think>. */
static bool parse_responses_input(const char **p, chat_msgs *msgs,
                                  buf *loaded_tool_schemas,
                                  tool_schema_orders *orders) {
    json_ws(p);
    if (**p != '[') return false;
    (*p)++;

    buf pending_reasoning = {0};

    json_ws(p);
    while (**p && **p != ']') {
        if (**p != '{') goto fail;
        (*p)++;
        char *type = NULL;
        char *role = NULL;
        char *content = NULL;
        char *name = NULL;
        char *namespace = NULL;
        char *call_id = NULL;
        char *item_id = NULL;
        char *arguments = NULL;
        char *output = NULL;
        char *input_str = NULL;
        char *summary = NULL;
        char *action = NULL;
        char *result = NULL;
        char *tools_json = NULL;
        char *status_str = NULL;
        json_ws(p);
        while (**p && **p != '}') {
            char *key = NULL;
            if (!json_string(p, &key)) goto item_fail;
            json_ws(p);
            if (**p != ':') {
                free(key);
                goto item_fail;
            }
            (*p)++;
            if (!strcmp(key, "type")) {
                free(type);
                if (!json_string(p, &type)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "role")) {
                free(role);
                if (!json_string(p, &role)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "content")) {
                free(content);
                if (!parse_responses_content_array(p, &content)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "name")) {
                free(name);
                if (!json_string(p, &name)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "namespace")) {
                free(namespace);
                if (!json_string(p, &namespace)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "call_id")) {
                free(call_id);
                if (!json_string(p, &call_id)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "id")) {
                free(item_id);
                if (!json_string(p, &item_id)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "arguments")) {
                free(arguments);
                json_ws(p);
                if (**p == '"') {
                    if (!json_string(p, &arguments)) {
                        free(key);
                        goto item_fail;
                    }
                } else if (!json_raw_value(p, &arguments)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "output")) {
                free(output);
                json_ws(p);
                if (**p == '[') {
                    if (!parse_responses_content_array(p, &output)) {
                        free(key);
                        goto item_fail;
                    }
                } else if (**p == '"') {
                    if (!json_string(p, &output)) {
                        free(key);
                        goto item_fail;
                    }
                } else if (!json_raw_value(p, &output)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "input")) {
                free(input_str);
                json_ws(p);
                if (**p == '"') {
                    if (!json_string(p, &input_str)) {
                        free(key);
                        goto item_fail;
                    }
                } else if (!json_raw_value(p, &input_str)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "summary")) {
                free(summary);
                if (!parse_responses_content_array(p, &summary)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "action")) {
                free(action);
                if (!json_raw_value(p, &action)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "result")) {
                free(result);
                json_ws(p);
                if (**p == '"') {
                    if (!json_string(p, &result)) {
                        free(key);
                        goto item_fail;
                    }
                } else if (!json_raw_value(p, &result)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "status")) {
                free(status_str);
                if (!json_string(p, &status_str)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!strcmp(key, "tools")) {
                /* tool_search_output items carry their discovered tool list
                 * here instead of in `output` / `result`. Keep it separate
                 * from the human-visible result body so malformed tool lists
                 * never get mistaken for normal tool output. */
                free(tools_json);
                if (!json_raw_value(p, &tools_json)) {
                    free(key);
                    goto item_fail;
                }
            } else if (!json_skip_value(p)) {
                free(key);
                goto item_fail;
            }
            free(key);
            json_ws(p);
            if (**p == ',') (*p)++;
            json_ws(p);
            continue;
item_fail:
            free(type);
            free(role);
            free(content);
            free(name);
            free(namespace);
            free(call_id);
            free(item_id);
            free(arguments);
            free(output);
            free(input_str);
            free(summary);
            free(action);
            free(result);
            free(tools_json);
            free(status_str);
            buf_free(&pending_reasoning);
            return false;
        }
        if (**p != '}') {
            free(type);
            free(role);
            free(content);
            free(name);
            free(namespace);
            free(call_id);
            free(item_id);
            free(arguments);
            free(output);
            free(input_str);
            free(summary);
            free(action);
            free(result);
            free(tools_json);
            free(status_str);
            goto fail;
        }
        (*p)++;

        const char *t = type ? type : "message";
        /* Replayed items must be in a terminal "completed" state. in_progress,
         * incomplete, and failed all represent partial model state the client
         * never confirmed — feeding them back as history would let DS4 continue
         * from a tool action that never finished. Reject explicitly. */
        if (status_str && status_str[0] &&
            strcmp(status_str, "completed") != 0)
        {
            free(type);
            free(role);
            free(content);
            free(name);
            free(namespace);
            free(call_id);
            free(item_id);
            free(arguments);
            free(output);
            free(input_str);
            free(summary);
            free(action);
            free(result);
            free(tools_json);
            free(status_str);
            buf_free(&pending_reasoning);
            return false;
        }
        /* Three classes of items:
         *   1. consumes_reasoning: assistant message / function_call / hosted-tool
         *      call. Attaches pending reasoning to its own assistant message.
         *   2. is_bookkeeping: compaction / context_compaction etc. Semantically
         *      transparent — passes through without touching pending_reasoning.
         *   3. everything else (user message, tool output): forces pending
         *      reasoning to flush in-position as an empty assistant message so it
         *      stays before this item in the rendered history. */
        bool consumes_reasoning =
            (!strcmp(t, "message") && role && !strcmp(role, "assistant")) ||
            !strcmp(t, "function_call") || !strcmp(t, "custom_tool_call") ||
            !strcmp(t, "local_shell_call") || !strcmp(t, "web_search_call") ||
            !strcmp(t, "tool_search_call") || !strcmp(t, "image_generation_call");
        bool is_bookkeeping =
            !strcmp(t, "compaction") || !strcmp(t, "context_compaction");
        if (!consumes_reasoning && !is_bookkeeping && pending_reasoning.len) {
            chat_msg flush_msg = {0};
            flush_msg.role = xstrdup("assistant");
            flush_msg.content = xstrdup("");
            flush_msg.reasoning = buf_take(&pending_reasoning);
            chat_msgs_push(msgs, flush_msg);
        }
        if (!strcmp(t, "message")) {
            chat_msg msg = {0};
            msg.role = xstrdup(role ? role : "user");
            msg.content = content ? content : xstrdup("");
            content = NULL;
            if (!strcmp(msg.role, "assistant") && pending_reasoning.len) {
                msg.reasoning = buf_take(&pending_reasoning);
            }
            chat_msgs_push(msgs, msg);
        } else if (!strcmp(t, "function_call") || !strcmp(t, "custom_tool_call")) {
            tool_call tc = {0};
            tc.id = xstrdup(call_id ? call_id : item_id ? item_id : "");
            /* function_call uses `arguments` (JSON string); custom_tool_call uses
             * `input` (free text). Treat both as the same on-wire argument blob —
             * append_dsml_arguments_from_json will fall back to a single text param
             * if the value isn't a JSON object. */
            const char *args_src = arguments ? arguments :
                                   input_str ? input_str : "{}";
            tc.arguments = xstrdup(args_src);
            if (strcmp(t, "custom_tool_call") && namespace && namespace[0] &&
                name && name[0])
            {
                buf qualified = {0};
                buf_puts(&qualified, namespace);
                buf_puts(&qualified, name);
                tc.name = buf_take(&qualified);
            } else {
                tc.name = xstrdup(name ? name : "");
            }
            /* A Responses turn that has both message text and tool calls splits
             * them across separate output items; the chat template renders the
             * second assistant record without an `<|Assistant|>` prefix, leaving
             * the tool call bare. Merge into the previous assistant message
             * when nothing user-like / tool-output-like came between them. */
            chat_msg *last = msgs->len ? &msgs->v[msgs->len - 1] : NULL;
            if (last && !strcmp(last->role, "assistant")) {
                if (pending_reasoning.len && (!last->reasoning || !last->reasoning[0])) {
                    free(last->reasoning);
                    last->reasoning = buf_take(&pending_reasoning);
                }
                tool_calls_push(&last->calls, tc);
            } else {
                chat_msg msg = {0};
                msg.role = xstrdup("assistant");
                msg.content = xstrdup("");
                if (pending_reasoning.len) msg.reasoning = buf_take(&pending_reasoning);
                tool_calls_push(&msg.calls, tc);
                chat_msgs_push(msgs, msg);
            }
        } else if (!strcmp(t, "function_call_output") || !strcmp(t, "custom_tool_call_output")) {
            chat_msg msg = {0};
            msg.role = xstrdup("tool");
            msg.content = output ? output : xstrdup("");
            output = NULL;
            if (call_id || item_id) {
                chat_msg_add_tool_call_id(&msg, call_id ? call_id : item_id);
            }
            chat_msgs_push(msgs, msg);
        } else if (!strcmp(t, "reasoning")) {
            /* Stash so it merges into the next assistant message. summary is the
             * short-form list, content is the verbose chain. Either can be empty. */
            if (summary && summary[0]) {
                if (pending_reasoning.len) buf_putc(&pending_reasoning, '\n');
                buf_puts(&pending_reasoning, summary);
            }
            if (content && content[0]) {
                if (pending_reasoning.len) buf_putc(&pending_reasoning, '\n');
                buf_puts(&pending_reasoning, content);
            }
        } else if (!strcmp(t, "local_shell_call") || !strcmp(t, "web_search_call") ||
                   !strcmp(t, "tool_search_call") || !strcmp(t, "image_generation_call"))
        {
            /* Hosted-tool history isn't natively supported (DS4 doesn't register
             * these tools), but a Codex client may still replay them when the
             * model used them in a prior turn. Surface them as function_call
             * shaped history so the next prompt retains the action that ran. */
            tool_call tc = {0};
            tc.id = xstrdup(call_id ? call_id : item_id ? item_id : "");
            if (!strcmp(t, "tool_search_call")) {
                tc.name = xstrdup("tool_search");
            } else if (!strcmp(t, "local_shell_call")) {
                tc.name = xstrdup("local_shell");
            } else {
                tc.name = xstrdup(t);
            }
            const char *args_src = action ? action :
                                   arguments ? arguments :
                                   input_str ? input_str : "{}";
            tc.arguments = xstrdup(args_src);
            chat_msg *last = msgs->len ? &msgs->v[msgs->len - 1] : NULL;
            if (last && !strcmp(last->role, "assistant")) {
                if (pending_reasoning.len && (!last->reasoning || !last->reasoning[0])) {
                    free(last->reasoning);
                    last->reasoning = buf_take(&pending_reasoning);
                }
                tool_calls_push(&last->calls, tc);
            } else {
                chat_msg msg = {0};
                msg.role = xstrdup("assistant");
                msg.content = xstrdup("");
                if (pending_reasoning.len) msg.reasoning = buf_take(&pending_reasoning);
                tool_calls_push(&msg.calls, tc);
                chat_msgs_push(msgs, msg);
            }
        } else if (!strcmp(t, "local_shell_call_output") ||
                   !strcmp(t, "web_search_call_output") ||
                   !strcmp(t, "tool_search_output") ||
                   !strcmp(t, "tool_search_call_output") ||
                   !strcmp(t, "image_generation_call_output"))
        {
            if (!strcmp(t, "tool_search_output") && tools_json &&
                loaded_tool_schemas && orders)
            {
                const char *tools_p = tools_json;
                char *schemas = NULL;
                if (!parse_tools_value(&tools_p, &schemas, orders)) {
                    free(schemas);
                    free(type);
                    free(role);
                    free(content);
                    free(name);
                    free(namespace);
                    free(call_id);
                    free(item_id);
                    free(arguments);
                    free(output);
                    free(input_str);
                    free(summary);
                    free(action);
                    free(result);
                    free(tools_json);
                    free(status_str);
                    buf_free(&pending_reasoning);
                    return false;
                }
                if (schemas && schemas[0]) {
                    if (loaded_tool_schemas->len) buf_putc(loaded_tool_schemas, '\n');
                    buf_puts(loaded_tool_schemas, schemas);
                }
                free(schemas);
            }
            chat_msg msg = {0};
            msg.role = xstrdup("tool");
            const char *body = output ? output :
                               result ? result :
                               tools_json ? tools_json : "";
            msg.content = xstrdup(body);
            if (call_id || item_id) {
                chat_msg_add_tool_call_id(&msg, call_id ? call_id : item_id);
            }
            chat_msgs_push(msgs, msg);
        } else if (!is_bookkeeping) {
            /* Anything we don't have an explicit branch for would silently
             * drop replay context. Fail the parse instead so the client sees
             * the limitation rather than ending up with stale generation
             * built on an incomplete history. Only compaction/context_compaction
             * (true Codex bookkeeping) are allowed to pass through silently. */
            free(type);
            free(role);
            free(content);
            free(name);
            free(namespace);
            free(call_id);
            free(item_id);
            free(arguments);
            free(output);
            free(input_str);
            free(summary);
            free(action);
            free(result);
            free(tools_json);
            free(status_str);
            buf_free(&pending_reasoning);
            return false;
        }

        free(type);
        free(role);
        free(content);
        free(name);
        free(namespace);
        free(call_id);
        free(item_id);
        free(arguments);
        free(output);
        free(input_str);
        free(summary);
        free(action);
        free(result);
        free(tools_json);
        free(status_str);
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != ']') goto fail;
    (*p)++;
    /* Trailing reasoning with no following message/tool item: attach it to an
     * empty assistant message so the next turn still renders a <think>...</think>
     * block. Dropping it loses model state when a previous response ended with
     * a reasoning-only incomplete turn and the client replays the history. */
    if (pending_reasoning.len) {
        chat_msg msg = {0};
        msg.role = xstrdup("assistant");
        msg.content = xstrdup("");
        msg.reasoning = buf_take(&pending_reasoning);
        chat_msgs_push(msgs, msg);
    }
    buf_free(&pending_reasoning);
    return true;
fail:
    buf_free(&pending_reasoning);
    return false;
}

/* Responses API has `reasoning: {"effort": "...", "summary": "..."}`. effort
 * controls thinking depth; summary mode (auto/concise/detailed) controls
 * whether the wire emits summary deltas at all — per the spec, no reasoning
 * summary is surfaced unless the client opts in. */
static bool parse_responses_reasoning(const char **p, ds4_think_mode *effort,
                                      bool *summary_opted_in,
                                      bool *effort_seen) {
    json_ws(p);
    if (json_lit(p, "null")) return true;
    if (**p != '{') return json_skip_value(p);
    (*p)++;
    json_ws(p);
    while (**p && **p != '}') {
        char *key = NULL;
        if (!json_string(p, &key)) return false;
        json_ws(p);
        if (**p != ':') {
            free(key);
            return false;
        }
        (*p)++;
        if (!strcmp(key, "effort")) {
            json_ws(p);
            /* A `null` effort doesn't change thinking_enabled — it's the same
             * as omitting the field. Only treat the field as a control if it
             * carried an actual value. */
            if (json_lit(p, "null")) {
                /* nothing */
            } else {
                if (!parse_reasoning_effort_value(p, effort)) {
                    free(key);
                    return false;
                }
                if (effort_seen) *effort_seen = true;
            }
        } else if (!strcmp(key, "summary")) {
            json_ws(p);
            if (json_lit(p, "null")) {
                /* explicit null disables summary */
            } else if (**p == '"') {
                char *mode = NULL;
                if (!json_string(p, &mode)) {
                    free(key);
                    return false;
                }
                if (summary_opted_in &&
                    (!strcmp(mode, "auto") ||
                     !strcmp(mode, "concise") ||
                     !strcmp(mode, "detailed")))
                {
                    *summary_opted_in = true;
                }
                free(mode);
            } else if (!json_skip_value(p)) {
                free(key);
                return false;
            }
        } else if (!json_skip_value(p)) {
            free(key);
            return false;
        }
        free(key);
        json_ws(p);
        if (**p == ',') (*p)++;
        json_ws(p);
    }
    if (**p != '}') return false;
    (*p)++;
    return true;
}

static bool parse_responses_request(ds4_engine *e, server *s, const char *body, int def_tokens,
                                    int ctx_size, request *r, char *err, size_t errlen) {
    request_init(r, REQ_CHAT, def_tokens);
    r->api = API_RESPONSES;
    const char *p = body;
    bool got_input = false;
    bool tool_choice_none = false;
    bool got_thinking = false;
    bool thinking_enabled = true;
    ds4_think_mode reasoning_effort = DS4_THINK_HIGH;
    chat_msgs msgs = {0};
    buf loaded_tool_schemas = {0};
    char *instructions = NULL;
    char *tool_schemas = NULL;

    json_ws(&p);
    if (*p != '{') goto bad;
    p++;
    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        if (!json_string(&p, &key)) goto bad;
        json_ws(&p);
        if (*p != ':') {
            free(key);
            goto bad;
        }
        p++;
        if (!strcmp(key, "input")) {
            chat_msgs_free(&msgs);
            json_ws(&p);
            /* Codex CLI always sends `input` as an array; tolerate bare strings
             * for parity with other Responses-API callers. */
            if (*p == '"') {
                char *plain = NULL;
                if (!json_string(&p, &plain)) {
                    free(key);
                    goto bad;
                }
                chat_msg msg = {0};
                msg.role = xstrdup("user");
                msg.content = plain;
                chat_msgs_push(&msgs, msg);
            } else if (!parse_responses_input(&p, &msgs, &loaded_tool_schemas,
                                              &r->tool_orders)) {
                free(key);
                goto bad;
            }
            got_input = true;
        } else if (!strcmp(key, "instructions")) {
            free(instructions);
            instructions = NULL;
            json_ws(&p);
            if (json_lit(&p, "null")) {
                instructions = xstrdup("");
            } else if (!json_string(&p, &instructions)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "tools")) {
            free(tool_schemas);
            tool_schemas = NULL;
            if (!parse_tools_value(&p, &tool_schemas, &r->tool_orders)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "tool_choice")) {
            json_ws(&p);
            if (*p == '"') {
                char *choice = NULL;
                if (!json_string(&p, &choice)) {
                    free(key);
                    goto bad;
                }
                /* DS4 honours "none" (disable tools) and "auto" (model decides).
                 * "required" and explicit function targets need constrained
                 * decoding we don't implement — reject so clients see the
                 * limitation instead of silently downgrading to auto. */
                if (!strcmp(choice, "none")) {
                    tool_choice_none = true;
                } else if (strcmp(choice, "auto") != 0) {
                    snprintf(err, errlen, "tool_choice=%s not supported", choice);
                    free(choice);
                    free(key);
                    chat_msgs_free(&msgs);
                    buf_free(&loaded_tool_schemas);
                    free(instructions);
                    free(tool_schemas);
                    request_free(r);
                    return false;
                }
                free(choice);
            } else if (*p == '{') {
                snprintf(err, errlen, "forced tool_choice not supported");
                free(key);
                chat_msgs_free(&msgs);
                buf_free(&loaded_tool_schemas);
                free(instructions);
                free(tool_schemas);
                request_free(r);
                return false;
            } else if (!json_skip_value(&p)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "model")) {
            free(r->model);
            if (!json_string(&p, &r->model)) {
                free(key);
                goto bad;
            }
            r->model_from_request = true;
        } else if (!strcmp(key, "max_output_tokens") || !strcmp(key, "max_tokens")) {
            if (!json_int(&p, &r->max_tokens)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "temperature")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->temperature = (float)v;
        } else if (!strcmp(key, "top_p")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->top_p = (float)v;
        } else if (!strcmp(key, "stream")) {
            if (!json_bool(&p, &r->stream)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "reasoning")) {
            bool effort_seen = false;
            if (!parse_responses_reasoning(&p, &reasoning_effort,
                                           &r->reasoning_summary_emit,
                                           &effort_seen)) {
                free(key);
                goto bad;
            }
            /* Only an explicit effort value counts as the client opting into
             * thinking control. summary alone, or `reasoning: null`, leaves the
             * default behaviour (and the model_alias_* fallbacks below) intact. */
            if (effort_seen) {
                got_thinking = true;
                /* Responses-API effort of "minimal" / "none" maps to disabled
                 * thinking. Other effort values choose between HIGH and MAX. */
                if (reasoning_effort == DS4_THINK_NONE) thinking_enabled = false;
            }
        } else if (!strcmp(key, "previous_response_id") ||
                   !strcmp(key, "conversation"))
        {
            /* Official Responses state can be durable:
             *   previous_response_id chains to a stored prior response, and
             *   conversation points at a persistent Conversations object.
             *
             * DS4 does not yet implement that durable store.  The supported
             * modes are either (a) a live in-memory continuation checked by
             * visible transcript / tool call ids, or (b) stateless replay of
             * the full input items.  Accepting a non-null durable reference
             * without loading the referenced items would silently truncate the
             * prompt, so reject it explicitly. */
            json_ws(&p);
            if (!json_lit(&p, "null")) {
                snprintf(err, errlen,
                         "%s is not supported; replay full input instead",
                         key);
                free(key);
                chat_msgs_free(&msgs);
                buf_free(&loaded_tool_schemas);
                free(instructions);
                free(tool_schemas);
                request_free(r);
                return false;
            }
        } else if (!json_skip_value(&p)) {
            free(key);
            goto bad;
        }
        free(key);
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }
    if (*p != '}') goto bad;
    if (!got_input) {
        snprintf(err, errlen, "missing input");
        chat_msgs_free(&msgs);
        buf_free(&loaded_tool_schemas);
        free(instructions);
        free(tool_schemas);
        request_free(r);
        return false;
    }
    /* instructions in the Responses API replaces any system message — for Codex
     * it carries the full agent system prompt. Prepend it so render produces a
     * standard system+chat layout. */
    if (instructions && instructions[0]) {
        chat_msg msg = {0};
        msg.role = xstrdup("system");
        msg.content = instructions;
        instructions = NULL;
        /* Insert at the head so it precedes the conversation. */
        chat_msgs_push(&msgs, msg);
        if (msgs.len > 1) {
            chat_msg tmp = msgs.v[msgs.len - 1];
            for (int i = msgs.len - 1; i > 0; i--) msgs.v[i] = msgs.v[i - 1];
            msgs.v[0] = tmp;
        }
    }
    buf combined_tool_schemas = {0};
    if (tool_schemas && tool_schemas[0]) buf_puts(&combined_tool_schemas, tool_schemas);
    if (loaded_tool_schemas.len) {
        if (combined_tool_schemas.len) buf_putc(&combined_tool_schemas, '\n');
        buf_append(&combined_tool_schemas, loaded_tool_schemas.ptr,
                   loaded_tool_schemas.len);
    }
    const char *active_tool_schemas =
        (!tool_choice_none && combined_tool_schemas.len) ?
        combined_tool_schemas.ptr : NULL;
    r->has_tools = active_tool_schemas && active_tool_schemas[0];
    if (!got_thinking && model_alias_disables_thinking(r->model)) thinking_enabled = false;
    if (!got_thinking && model_alias_enables_thinking(r->model)) thinking_enabled = true;
    r->think_mode = ds4_think_mode_for_context(
        think_mode_from_enabled(thinking_enabled, reasoning_effort), ctx_size);
    if (!responses_validate_tool_outputs(s, &msgs, r->think_mode,
                                         &r->responses_requires_live_tool_state,
                                         &r->responses_requires_live_reasoning,
                                         err, errlen)) {
        chat_msgs_free(&msgs);
        buf_free(&combined_tool_schemas);
        buf_free(&loaded_tool_schemas);
        free(instructions);
        free(tool_schemas);
        request_free(r);
        return false;
    }
    kv_cache_restore_tool_memory_for_messages(s, &msgs);
    tool_memory_attach_to_messages(s, &msgs, &r->tool_replay);
    r->prompt_preserves_reasoning =
        chat_history_uses_tool_context(&msgs, active_tool_schemas);
    responses_prepare_live_continuation(r, &msgs);
    r->prompt_text = render_chat_prompt_text(&msgs, active_tool_schemas,
                                             &r->tool_orders, r->think_mode);
    ds4_tokenize_rendered_chat(e, r->prompt_text, &r->prompt);
    chat_msgs_free(&msgs);
    buf_free(&combined_tool_schemas);
    buf_free(&loaded_tool_schemas);
    free(instructions);
    free(tool_schemas);
    return true;
bad:
    chat_msgs_free(&msgs);
    buf_free(&loaded_tool_schemas);
    free(instructions);
    free(tool_schemas);
    snprintf(err, errlen, "invalid JSON request");
    request_free(r);
    return false;
}

static bool parse_prompt(const char **p, char **out) {
    json_ws(p);
    if (**p == '"') return json_string(p, out);
    if (**p != '[') {
        if (!json_skip_value(p)) return false;
        *out = xstrdup("");
        return true;
    }
    (*p)++;
    json_ws(p);
    if (**p == '"') {
        if (!json_string(p, out)) return false;
    } else {
        *out = xstrdup("");
        if (**p && **p != ']' && !json_skip_value(p)) return false;
    }
    while (**p && **p != ']') {
        json_ws(p);
        if (**p == ',') {
            (*p)++;
            if (!json_skip_value(p)) return false;
        } else {
            break;
        }
    }
    if (**p != ']') return false;
    (*p)++;
    return true;
}

static bool parse_completion_request(ds4_engine *e, const char *body, int def_tokens,
                                     int ctx_size, request *r, char *err, size_t errlen) {
    request_init(r, REQ_COMPLETION, def_tokens);
    const char *p = body;
    char *prompt = NULL;
    bool got_thinking = false;
    bool thinking_enabled = true;
    ds4_think_mode reasoning_effort = DS4_THINK_HIGH;

    json_ws(&p);
    if (*p != '{') goto bad;
    p++;
    json_ws(&p);
    while (*p && *p != '}') {
        char *key = NULL;
        if (!json_string(&p, &key)) goto bad;
        json_ws(&p);
        if (*p != ':') {
            free(key);
            goto bad;
        }
        p++;
        if (!strcmp(key, "prompt")) {
            free(prompt);
            if (!parse_prompt(&p, &prompt)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "model")) {
            free(r->model);
            if (!json_string(&p, &r->model)) {
                free(key);
                goto bad;
            }
            r->model_from_request = true;
        } else if (!strcmp(key, "max_tokens")) {
            if (!json_int(&p, &r->max_tokens)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "temperature")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->temperature = (float)v;
        } else if (!strcmp(key, "top_p")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->top_p = (float)v;
        } else if (!strcmp(key, "min_p")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->min_p = (float)v;
        } else if (!strcmp(key, "top_k")) {
            if (!json_int(&p, &r->top_k)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "seed")) {
            double v = 0.0;
            if (!json_number(&p, &v)) {
                free(key);
                goto bad;
            }
            r->seed = v > 0.0 ? (uint64_t)v : 0;
        } else if (!strcmp(key, "stream")) {
            if (!json_bool(&p, &r->stream)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "stream_options")) {
            if (!parse_stream_options(&p, &r->stream_include_usage)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "thinking")) {
            if (!parse_thinking_control_value(&p, &thinking_enabled)) {
                free(key);
                goto bad;
            }
            got_thinking = true;
        } else if (!strcmp(key, "reasoning_effort")) {
            if (!parse_reasoning_effort_value(&p, &reasoning_effort)) {
                free(key);
                goto bad;
            }
        } else if (!strcmp(key, "think")) {
            if (!json_bool(&p, &thinking_enabled)) {
                free(key);
                goto bad;
            }
            got_thinking = true;
        } else if (!strcmp(key, "stop")) {
            if (!parse_stop(&p, &r->stops)) {
                free(key);
                goto bad;
            }
        } else if (!json_skip_value(&p)) {
            free(key);
            goto bad;
        }
        free(key);
        json_ws(&p);
        if (*p == ',') p++;
        json_ws(&p);
    }
    if (*p != '}') goto bad;
    if (!prompt) {
        snprintf(err, errlen, "missing prompt");
        request_free(r);
        return false;
    }
    if (!got_thinking && model_alias_disables_thinking(r->model)) thinking_enabled = false;
    if (!got_thinking && model_alias_enables_thinking(r->model)) thinking_enabled = true;
    r->think_mode = ds4_think_mode_for_context(
        think_mode_from_enabled(thinking_enabled, reasoning_effort), ctx_size);
    buf rendered = {0};
    buf_puts(&rendered, "<｜begin▁of▁sentence｜>");
    if (r->think_mode == DS4_THINK_MAX) buf_puts(&rendered, ds4_think_max_prefix());
    buf_puts(&rendered, "You are a helpful assistant<｜User｜>");
    buf_puts(&rendered, prompt);
    buf_puts(&rendered, "<｜Assistant｜>");
    buf_puts(&rendered, ds4_think_mode_enabled(r->think_mode) ? "<think>" : "</think>");
    r->prompt_text = buf_take(&rendered);
    ds4_tokenize_rendered_chat(e, r->prompt_text, &r->prompt);
    free(prompt);
    return true;
bad:
    free(prompt);
    snprintf(err, errlen, "invalid JSON request");
    request_free(r);
    return false;
}

static long long wall_ms(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (long long)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static bool send_all(int fd, const void *p, size_t n) {
    const char *s = p;
    long long deadline = wall_ms() + DS4_SERVER_SEND_STALL_TIMEOUT_MS;
    while (n) {
        if (g_stop_requested) return false;
        ssize_t w = send(fd, s, n, 0);
        if (w < 0 && errno == EINTR) continue;
        if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            long long remaining = deadline - wall_ms();
            if (remaining <= 0) return false;
            struct pollfd pfd = {.fd = fd, .events = POLLOUT};
            int timeout = remaining > 50 ? 50 : (int)remaining;
            int rc;
            do {
                rc = poll(&pfd, 1, timeout);
            } while (rc < 0 && errno == EINTR);
            if (rc < 0 || (pfd.revents & (POLLERR | POLLHUP | POLLNVAL))) return false;
            continue;
        }
        if (w <= 0) return false;
        s += w;
        n -= (size_t)w;
        deadline = wall_ms() + DS4_SERVER_SEND_STALL_TIMEOUT_MS;
    }
    return true;
}

static void json_escape(buf *b, const char *s) {
    buf_putc(b, '"');
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') {
            buf_putc(b, '\\');
            buf_putc(b, (char)c);
        } else if (c == '\n') {
            buf_puts(b, "\\n");
        } else if (c == '\r') {
            buf_puts(b, "\\r");
        } else if (c == '\t') {
            buf_puts(b, "\\t");
        } else if (c < 0x20) {
            buf_printf(b, "\\u%04x", (unsigned)c);
        } else {
            buf_putc(b, (char)c);
        }
    }
    buf_putc(b, '"');
}

static void json_escape_n(buf *b, const char *s, size_t n) {
    char *tmp = xstrndup(s ? s : "", n);
    json_escape(b, tmp);
    free(tmp);
}

static void json_escape_fragment_n(buf *b, const char *s, size_t n) {
    for (size_t i = 0; i < n; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c == '"' || c == '\\') {
            buf_putc(b, '\\');
            buf_putc(b, (char)c);
        } else if (c == '\n') {
            buf_puts(b, "\\n");
        } else if (c == '\r') {
            buf_puts(b, "\\r");
        } else if (c == '\t') {
            buf_puts(b, "\\t");
        } else if (c < 0x20) {
            buf_printf(b, "\\u%04x", (unsigned)c);
        } else {
            buf_putc(b, (char)c);
        }
    }
}

#define DS4_DSML "｜DSML｜"
#define DS4_DSML_SHORT "DSML｜"
#define DS4_TOOL_CALLS_START "<" DS4_DSML "tool_calls>"
#define DS4_TOOL_CALLS_END "</" DS4_DSML "tool_calls>"
#define DS4_INVOKE_START "<" DS4_DSML "invoke"
#define DS4_INVOKE_END "</" DS4_DSML "invoke>"
#define DS4_PARAM_START "<" DS4_DSML "parameter"
#define DS4_PARAM_END "</" DS4_DSML "parameter>"
#define DS4_TOOL_CALLS_START_SHORT "<" DS4_DSML_SHORT "tool_calls>"
#define DS4_TOOL_CALLS_END_SHORT "</" DS4_DSML_SHORT "tool_calls>"
#define DS4_INVOKE_START_SHORT "<" DS4_DSML_SHORT "invoke"
#define DS4_INVOKE_END_SHORT "</" DS4_DSML_SHORT "invoke>"
#define DS4_PARAM_START_SHORT "<" DS4_DSML_SHORT "parameter"
#define DS4_PARAM_END_SHORT "</" DS4_DSML_SHORT "parameter>"

static const char *find_any_tool_start(const char *s) {
    const char *best = NULL;
    const char *candidates[] = {
        strstr(s, DS4_TOOL_CALLS_START),
        strstr(s, DS4_TOOL_CALLS_START_SHORT),
        strstr(s, "<tool_calls>"),
    };
    for (size_t i = 0; i < sizeof(candidates)/sizeof(candidates[0]); i++) {
        if (candidates[i] && (!best || candidates[i] < best)) best = candidates[i];
    }
    return best;
}

static const char *find_any_tool_end(const char *s) {
    const char *best = NULL;
    const char *candidates[] = {
        strstr(s, DS4_TOOL_CALLS_END),
        strstr(s, DS4_TOOL_CALLS_END_SHORT),
        strstr(s, "</tool_calls>"),
    };
    for (size_t i = 0; i < sizeof(candidates)/sizeof(candidates[0]); i++) {
        if (candidates[i] && (!best || candidates[i] < best)) best = candidates[i];
    }
    return best;
}

static void observe_tool_markers(const char *scan, bool *saw_start,
                                 bool *saw_end, bool *orphan_end) {
    if (!scan) return;
    bool had_start = *saw_start;
    const char *start = find_any_tool_start(scan);
    if (start) *saw_start = true;

    const char *end_scan = had_start ? scan : (start ? start : NULL);
    const char *end = end_scan ? find_any_tool_end(end_scan) : NULL;
    if (end) {
        *saw_end = true;
    } else if (!had_start && !start && find_any_tool_end(scan)) {
        if (orphan_end) *orphan_end = true;
    }
}

static size_t trim_tool_separator_ws(const char *raw, size_t start, size_t limit) {
    while (limit > start && isspace((unsigned char)raw[limit - 1])) limit--;
    return limit;
}

static const char *skip_ascii_ws(const char *p) {
    while (*p && isspace((unsigned char)*p)) p++;
    return p;
}

static const char *find_last_substr(const char *s, const char *needle) {
    if (!s || !needle || !needle[0]) return NULL;
    const char *last = NULL;
    const char *p = s;
    while ((p = strstr(p, needle)) != NULL) {
        last = p;
        p++;
    }
    return last;
}

/* The prompt renderer escapes DSML text so a tool argument can safely contain
 * shell operators or closing tags.  The generated-DSML parser must undo exactly
 * those entities before it turns parameters back into JSON; otherwise
 * parse->render is not a stable cache key. */
static char *dsml_unescape_text(const char *s) {
    buf b = {0};
    for (s = s ? s : ""; *s; s++) {
        if (*s != '&') {
            buf_putc(&b, *s);
        } else if (!strncmp(s, "&amp;", 5)) {
            buf_putc(&b, '&');
            s += 4;
        } else if (!strncmp(s, "&lt;", 4)) {
            buf_putc(&b, '<');
            s += 3;
        } else if (!strncmp(s, "&gt;", 4)) {
            buf_putc(&b, '>');
            s += 3;
        } else if (!strncmp(s, "&quot;", 6)) {
            buf_putc(&b, '"');
            s += 5;
        } else if (!strncmp(s, "&apos;", 6)) {
            buf_putc(&b, '\'');
            s += 5;
        } else {
            buf_putc(&b, '&');
        }
    }
    return buf_take(&b);
}

static char *dsml_attr(const char *tag, const char *name) {
    char pat[64];
    snprintf(pat, sizeof(pat), "%s=\"", name);
    const char *p = strstr(tag, pat);
    if (!p) return NULL;
    p += strlen(pat);
    const char *q = strchr(p, '"');
    if (!q) return NULL;
    char *raw = xstrndup(p, (size_t)(q - p));
    char *decoded = dsml_unescape_text(raw);
    free(raw);
    return decoded;
}

static void tool_call_json_args_add(buf *args, const char *name, const char *value, const char *is_string) {
    if (args->len) buf_puts(args, ", ");
    json_escape(args, name ? name : "");
    buf_puts(args, ": ");
    if (is_string && !strcmp(is_string, "true")) {
        json_escape(args, value ? value : "");
    } else {
        char *min = json_minify_raw_value(value ? value : "null");
        buf_puts(args, min && min[0] ? min : "null");
        free(min);
    }
}

/* DSML produced by the model is usually a flat list of typed parameters:
 *
 *   <parameter name="path" string="true">/tmp/x</parameter>
 *   <parameter name="timeout" string="false">10</parameter>
 *
 * Long generations sometimes drift into a looser XML-ish shape, omitting the
 * outer string attribute and putting child parameters inside it.  The server
 * does not know client tool schemas, so it cannot make that semantically
 * perfect.  Still, returning a structured JSON value lets the client/tool layer
 * reject or repair the call, which is much better than aborting the assistant
 * turn and losing the whole sampled continuation.
 */
static bool dsml_parse_leaf_param_json(const char **p_in, const char *param_start,
                                       const char *param_end, buf *out) {
    const char *p = *p_in;
    if (strncmp(p, param_start, strlen(param_start)) != 0) return false;
    const char *tag_end = strchr(p, '>');
    if (!tag_end) return false;

    char *tag = xstrndup(p, (size_t)(tag_end - p + 1));
    char *name = dsml_attr(tag, "name");
    char *is_string = dsml_attr(tag, "string");
    free(tag);
    if (!name) {
        free(is_string);
        return false;
    }

    const char *value_start = tag_end + 1;
    const char *value_end = strstr(value_start, param_end);
    if (!value_end) {
        free(name);
        free(is_string);
        return false;
    }

    char *raw_value = xstrndup(value_start, (size_t)(value_end - value_start));
    const char *type = is_string ? is_string : "true";
    char *value = !strcmp(type, "true") ?
        dsml_unescape_text(raw_value) : xstrdup(raw_value);
    tool_call_json_args_add(out, name, value, type);

    free(name);
    free(is_string);
    free(raw_value);
    free(value);
    *p_in = value_end + strlen(param_end);
    return true;
}

static bool dsml_parse_nested_params_object(const char **p_in,
                                            const char *param_start,
                                            const char *param_end,
                                            buf *out) {
    const char *p = *p_in;
    buf members = {0};
    bool any = false;

    for (;;) {
        p = skip_ascii_ws(p);
        if (strncmp(p, param_start, strlen(param_start)) != 0) break;
        if (!dsml_parse_leaf_param_json(&p, param_start, param_end, &members)) {
            buf_free(&members);
            return false;
        }
        any = true;
    }

    if (!any) {
        buf_free(&members);
        return false;
    }
    buf_putc(out, '{');
    buf_puts(out, members.ptr ? members.ptr : "");
    buf_putc(out, '}');
    buf_free(&members);
    *p_in = p;
    return true;
}

static void split_reasoning_content(const char *text, size_t n, char **content_out, char **reasoning_out) {
    char *s = xstrndup(text ? text : "", n);
    char *body = s;
    if (!strncmp(body, "<think>", 7)) body += 7;

    char *think_end = strstr(body, "</think>");
    if (think_end) {
        *think_end = '\0';
        *reasoning_out = xstrdup(body);
        *content_out = xstrdup(think_end + 8);
    } else {
        *reasoning_out = NULL;
        *content_out = xstrdup(s);
    }
    free(s);
}

static bool parse_generated_message_ex(const char *text, bool require_thinking_closed,
                                       char **content_out, char **reasoning_out,
                                       tool_calls *calls) {
    text = text ? text : "";
    const char *tool_search = text;

    /* When thinking mode is enabled the model is expected to close
     * </think> before it enters the executable assistant surface.  DSML inside
     * reasoning is just model text: it may be a mistaken attempt, a quotation,
     * or an explanation of the protocol.  Treating it as a real tool call
     * duplicates it into both reasoning and structured tool_calls, and can make
     * clients execute something the assistant had not actually emitted as its
     * post-thinking action. */
    if (require_thinking_closed) {
        const char *think_end = find_last_substr(text, "</think>");
        if (!think_end) {
            /* Model did not close thinking, ignore any DSML in reasoning */
            fprintf(stderr, "ds4-server: thinking not closed, ignoring DSML in reasoning\n");
            split_reasoning_content(text, strlen(text), content_out, reasoning_out);
            return true;
        }
        tool_search = think_end + 8;
    }

    const char *start = strstr(tool_search, "\n\n" DS4_TOOL_CALLS_START);
    int style = 0; /* 0: DSML, 1: plain XML, 2: DSML with the first vertical bar omitted. */
    if (!start) start = strstr(tool_search, DS4_TOOL_CALLS_START);
    if (!start) {
        start = strstr(tool_search, "\n\n" DS4_TOOL_CALLS_START_SHORT);
        style = start ? 2 : style;
    }
    if (!start) {
        start = strstr(tool_search, DS4_TOOL_CALLS_START_SHORT);
        style = start ? 2 : style;
    }
    if (!start) {
        start = strstr(tool_search, "\n\n<tool_calls>");
        style = start ? 1 : style;
    }
    if (!start) {
        start = strstr(tool_search, "<tool_calls>");
        style = start ? 1 : style;
    }
    if (!start) {
        split_reasoning_content(text, strlen(text), content_out, reasoning_out);
        return true;
    }

    size_t content_len = trim_tool_separator_ws(text, 0, (size_t)(start - text));
    const char *raw_block_start = start;
    const char *tool_calls_start = DS4_TOOL_CALLS_START;
    const char *tool_calls_end = DS4_TOOL_CALLS_END;
    const char *invoke_start = DS4_INVOKE_START;
    const char *invoke_end = DS4_INVOKE_END;
    const char *param_start = DS4_PARAM_START;
    const char *param_end = DS4_PARAM_END;
    if (style == 1) {
        tool_calls_start = "<tool_calls>";
        tool_calls_end = "</tool_calls>";
        invoke_start = "<invoke";
        invoke_end = "</invoke>";
        param_start = "<parameter";
        param_end = "</parameter>";
    } else if (style == 2) {
        tool_calls_start = DS4_TOOL_CALLS_START_SHORT;
        tool_calls_end = DS4_TOOL_CALLS_END_SHORT;
        invoke_start = DS4_INVOKE_START_SHORT;
        invoke_end = DS4_INVOKE_END_SHORT;
        param_start = DS4_PARAM_START_SHORT;
        param_end = DS4_PARAM_END_SHORT;
    }

    const char *p = strstr(start, tool_calls_start);
    if (!p) return false;
    p += strlen(tool_calls_start);

    for (;;) {
        p = skip_ascii_ws(p);
        if (!strncmp(p, tool_calls_end, strlen(tool_calls_end))) {
            const char *raw_block_end = p + strlen(tool_calls_end);
            free(calls->raw_dsml);
            calls->raw_dsml = xstrndup(raw_block_start, (size_t)(raw_block_end - raw_block_start));
            split_reasoning_content(text, content_len, content_out, reasoning_out);
            return true;
        }
        if (strncmp(p, invoke_start, strlen(invoke_start)) != 0) return false;
        const char *tag_end = strchr(p, '>');
        if (!tag_end) return false;
        char *tag = xstrndup(p, (size_t)(tag_end - p + 1));
        char *name = dsml_attr(tag, "name");
        free(tag);
        if (!name) return false;
        p = tag_end + 1;

        buf args = {0};
        while (true) {
            p = skip_ascii_ws(p);
            if (!strncmp(p, invoke_end, strlen(invoke_end))) {
                p += strlen(invoke_end);
                break;
            }
            if (strncmp(p, param_start, strlen(param_start)) != 0) {
                free(name);
                buf_free(&args);
                return false;
            }
            tag_end = strchr(p, '>');
            if (!tag_end) {
                free(name);
                buf_free(&args);
                return false;
            }
            tag = xstrndup(p, (size_t)(tag_end - p + 1));
            char *param_name = dsml_attr(tag, "name");
            char *param_is_string = dsml_attr(tag, "string");
            free(tag);
            if (!param_name) {
                free(name);
                free(param_name);
                free(param_is_string);
                buf_free(&args);
                return false;
            }
            const char *value_start = tag_end + 1;
            if (!param_is_string &&
                !strncmp(skip_ascii_ws(value_start), param_start, strlen(param_start)))
            {
                buf nested = {0};
                const char *nested_p = value_start;
                if (!dsml_parse_nested_params_object(&nested_p, param_start,
                                                     param_end, &nested)) {
                    free(name);
                    free(param_name);
                    buf_free(&nested);
                    buf_free(&args);
                    return false;
                }
                tool_call_json_args_add(&args, param_name,
                                        nested.ptr ? nested.ptr : "{}",
                                        "false");
                buf_free(&nested);
                p = skip_ascii_ws(nested_p);
                if (!strncmp(p, param_end, strlen(param_end))) {
                    p += strlen(param_end);
                }
                free(param_name);
                continue;
            }
            const char *value_end = strstr(value_start, param_end);
            if (!value_end) {
                free(name);
                free(param_name);
                free(param_is_string);
                buf_free(&args);
                return false;
            }
            char *raw_value = xstrndup(value_start, (size_t)(value_end - value_start));
            const char *type = param_is_string ? param_is_string : "true";
            char *value = !strcmp(type, "true") ?
                dsml_unescape_text(raw_value) : xstrdup(raw_value);
            tool_call_json_args_add(&args, param_name, value, type);
            free(param_name);
            free(param_is_string);
            free(raw_value);
            free(value);
            p = value_end + strlen(param_end);
        }

        tool_call tc = {0};
        tc.name = name;
        buf wrapped = {0};
        buf_putc(&wrapped, '{');
        buf_puts(&wrapped, args.ptr ? args.ptr : "");
        buf_putc(&wrapped, '}');
        tc.arguments = buf_take(&wrapped);
        tool_calls_push(calls, tc);
        buf_free(&args);
    }
}

/* Try to repair a truncated DSML block.
 *
 * DSML nesting order is: tool_calls > invoke > parameter.
 * Single-pass scan: count opens vs closes, then append missing closing tags.
 *
 * Returns true if repair was applied, false if the text had no recognizable DSML
 * or was already balanced.  This deliberately does not rewrite malformed but
 * balanced DSML into assistant text; semantic recovery belongs to the model. */
static bool try_repair_dsml(const char *s, size_t len, buf *out) {
    if (!s || !len) return false;

    /* Only scan DSML tags after the last </think>.  DSML mentioned inside
     * reasoning is not executable — it inflates tag counts and causes false
     * positive repairs.  If no </think> is found, scan from the start
     * (thinking mode is not active or thinking was never opened). */
    const char *think_end = find_last_substr(s, "</think>");
    const char *scan_start = think_end ? (think_end + 8) : s;
    size_t scan_len = (size_t)((s + len) - scan_start);

    /* Detect style from first <tool_calls> tag */
    const char *ts, *te, *is, *ie, *ps, *pe;
    if (strstr(scan_start, DS4_TOOL_CALLS_START)) {
        ts = DS4_TOOL_CALLS_START;  te = DS4_TOOL_CALLS_END;
        is = DS4_INVOKE_START;      ie = DS4_INVOKE_END;
        ps = DS4_PARAM_START;       pe = DS4_PARAM_END;
    } else if (strstr(scan_start, DS4_TOOL_CALLS_START_SHORT)) {
        ts = DS4_TOOL_CALLS_START_SHORT;  te = DS4_TOOL_CALLS_END_SHORT;
        is = DS4_INVOKE_START_SHORT;      ie = DS4_INVOKE_END_SHORT;
        ps = DS4_PARAM_START_SHORT;       pe = DS4_PARAM_END_SHORT;
    } else if (strstr(scan_start, "<tool_calls>")) {
        ts = "<tool_calls>";   te = "</tool_calls>";
        is = "<invoke";        ie = "</invoke>";
        ps = "<parameter";     pe = "</parameter>";
    } else {
        return false; /* No recognizable DSML start tag */
    }

    /* Single-pass: count all 6 tag types in one scan */
    size_t tos = 0, toe = 0, ios = 0, ioe = 0, pos = 0, poe = 0;
    const char *e = scan_start + scan_len;
    for (const char *p = scan_start; p < e; ) {
        size_t d;
        if ((d = strlen(ts)) && !strncmp(p, ts, d)) { tos++; p += d; }
        else if ((d = strlen(te)) && !strncmp(p, te, d)) { toe++; p += d; }
        else if ((d = strlen(is)) && !strncmp(p, is, d)) { ios++; p += d; }
        else if ((d = strlen(ie)) && !strncmp(p, ie, d)) { ioe++; p += d; }
        else if ((d = strlen(ps)) && !strncmp(p, ps, d)) { pos++; p += d; }
        else if ((d = strlen(pe)) && !strncmp(p, pe, d)) { poe++; p += d; }
        else p++;
    }
    if (tos == toe && ios == ioe && pos == poe) return false;
    if (toe > tos || ioe > ios || poe > pos) {
        /* Extra closing tags are not a truncation pattern.  Refuse repair so the
         * unsigned differences below cannot wrap and append a huge suffix. */
        return false;
    }
    /* Repair: copy original text and append missing closing tags in reverse order */
    buf_puts(out, s);
    for (size_t i = 0; i < pos - poe; i++) buf_puts(out, pe);
    for (size_t i = 0; i < ios - ioe; i++) buf_puts(out, ie);
    for (size_t i = 0; i < tos - toe; i++) buf_puts(out, te);
    return true;
}

static const char *tool_parse_failure_recovery_finish(const char *finish) {
    /* Once DSML failed to parse there is no executable tool call to report.
     * Preserve a true length stop, because callers can distinguish truncation
     * from a completed turn.  Every other non-error tool-parse failure becomes
     * a normal assistant stop with the raw model text returned as content. */
    if (finish && !strcmp(finish, "length")) return "length";
    return "stop";
}

static bool parse_generated_message_for_response(const char *text,
                                                 bool has_tools,
                                                 bool saw_tool_start,
                                                 bool require_thinking_closed,
                                                 const char **finish_io,
                                                 char *err,
                                                 size_t errlen,
                                                 char **content_out,
                                                 char **reasoning_out,
                                                 tool_calls *calls,
                                                 bool *recovered_out) {
    if (recovered_out) *recovered_out = false;

    bool parsed_ok = parse_generated_message_ex(text ? text : "",
                                                require_thinking_closed,
                                                content_out, reasoning_out,
                                                calls);
    if (parsed_ok) return true;

    free(*content_out);
    free(*reasoning_out);
    *content_out = xstrdup(text ? text : "");
    *reasoning_out = NULL;
    tool_calls_free(calls);

    /* A malformed tool block is model output, not a server failure.  The
     * generation worker may hide this turn from the client, append a tool error
     * plus protocol reminder to the live session, and let the model try again.
     * If that continuation is unavailable, parsed_content keeps the raw text as
     * a last-resort assistant fallback instead of crashing the request. */
    const char *finish = finish_io && *finish_io ? *finish_io : "stop";
    if (has_tools && saw_tool_start && strcmp(finish, "error") != 0) {
        if (finish_io) *finish_io = tool_parse_failure_recovery_finish(finish);
        if (err && errlen) snprintf(err, errlen, "invalid tool call");
        if (recovered_out) *recovered_out = true;
    }
    return false;
}

static void append_json_object_string(buf *b, const char *json) {
    buf tmp = {0};
    append_json_object_or_empty(&tmp, json);
    json_escape(b, tmp.ptr ? tmp.ptr : "{}");
    buf_free(&tmp);
}

static void append_tool_calls_json(buf *b, const tool_calls *calls, const char *id_prefix,
                                   const tool_schema_orders *orders) {
    (void)orders;
    buf_putc(b, '[');
    for (int i = 0; i < calls->len; i++) {
        const tool_call *tc = &calls->v[i];
        if (i) buf_putc(b, ',');
        char idbuf[128];
        snprintf(idbuf, sizeof(idbuf), "%s_tool_%d", id_prefix, i);
        buf_puts(b, "{\"id\":");
        json_escape(b, tc->id ? tc->id : idbuf);
        buf_puts(b, ",\"type\":\"function\",\"function\":{\"name\":");
        json_escape(b, tc->name ? tc->name : "");
        buf_puts(b, ",\"arguments\":");
        append_json_object_string(b, tc->arguments);
        buf_puts(b, "}}");
    }
    buf_putc(b, ']');
}

static void append_tool_call_deltas_json(buf *b, const tool_calls *calls, const char *id_prefix,
                                         const tool_schema_orders *orders) {
    (void)orders;
    buf_putc(b, '[');
    for (int i = 0; i < calls->len; i++) {
        const tool_call *tc = &calls->v[i];
        if (i) buf_putc(b, ',');
        char idbuf[128];
        snprintf(idbuf, sizeof(idbuf), "%s_tool_%d", id_prefix, i);
        buf_puts(b, "{\"index\":");
        buf_printf(b, "%d", i);
        buf_puts(b, ",\"id\":");
        json_escape(b, tc->id ? tc->id : idbuf);
        buf_puts(b, ",\"type\":\"function\",\"function\":{\"name\":");
        json_escape(b, tc->name ? tc->name : "");
        buf_puts(b, ",\"arguments\":");
        append_json_object_string(b, tc->arguments);
        buf_puts(b, "}}");
    }
    buf_putc(b, ']');
}

static void append_cors_headers(buf *h) {
    buf_puts(h,
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: *\r\n");
}

static bool http_response(int fd, bool enable_cors, int code, const char *type, const char *body) {
    const char *reason = code == 200 ? "OK" :
                         code == 204 ? "No Content" :
                         code == 400 ? "Bad Request" :
                         code == 404 ? "Not Found" :
                         code == 409 ? "Conflict" :
                         code == 500 ? "Internal Server Error" : "Error";
    const size_t body_len = body ? strlen(body) : 0;
    buf h = {0};
    buf_printf(&h,
        "HTTP/1.1 %d %s\r\n"
        "Content-Length: %zu\r\n",
        code, reason, body_len);
    if (type && type[0]) {
        buf_puts(&h, "Content-Type: ");
        buf_puts(&h, type);
        buf_puts(&h, "\r\n");
    }
    if (enable_cors) append_cors_headers(&h);
    buf_puts(&h, "Connection: close\r\n\r\n");
    bool ok = send_all(fd, h.ptr, h.len);
    if (ok && body_len) ok = send_all(fd, body, body_len);
    buf_free(&h);
    return ok;
}

static bool http_error(int fd, bool enable_cors, int code, const char *msg) {
    buf b = {0};
    buf_puts(&b, "{\"error\":{\"message\":");
    json_escape(&b, msg);
    buf_puts(&b, ",\"type\":\"invalid_request_error\"}}\n");
    bool ok = http_response(fd, enable_cors, code, "application/json", b.ptr);
    buf_free(&b);
    return ok;
}

static const char *context_length_error_param(const request *r) {
    if (!r) return "prompt";
    if (r->api == API_RESPONSES) return "input";
    return r->kind == REQ_COMPLETION ? "prompt" : "messages";
}

static bool request_exceeds_context(const request *r, int ctx_size) {
    /* ds4_session_sync() rejects prompt->len >= ctx_size because generation
     * needs at least one free context slot.  Catch the same boundary here so
     * clients get a normal protocol error instead of a later backend failure. */
    return r && r->prompt.len >= ctx_size;
}

static bool http_error_context_length_exceeded(int fd, bool enable_cors,
                                               const request *r,
                                               int n_prompt_tokens,
                                               int ctx_size) {
    buf b = {0};
    char msg[160];
    snprintf(msg, sizeof(msg),
             "Prompt has %d tokens, but the configured context size is %d tokens",
             n_prompt_tokens, ctx_size);

    if (r && r->api == API_ANTHROPIC) {
        buf_puts(&b, "{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":");
        json_escape(&b, msg);
        buf_puts(&b, ",\"n_prompt_tokens\":");
        buf_printf(&b, "%d", n_prompt_tokens);
        buf_puts(&b, ",\"n_ctx\":");
        buf_printf(&b, "%d", ctx_size);
        buf_puts(&b, "}}\n");
    } else {
        buf_puts(&b, "{\"error\":{\"message\":");
        json_escape(&b, msg);
        buf_puts(&b, ",\"type\":\"invalid_request_error\",\"param\":");
        json_escape(&b, context_length_error_param(r));
        buf_puts(&b, ",\"code\":\"context_length_exceeded\",\"n_prompt_tokens\":");
        buf_printf(&b, "%d", n_prompt_tokens);
        buf_puts(&b, ",\"n_ctx\":");
        buf_printf(&b, "%d", ctx_size);
        buf_puts(&b, "}}\n");
    }
    bool ok = http_response(fd, enable_cors, 400, "application/json", b.ptr);
    buf_free(&b);
    return ok;
}

typedef struct {
    int prompt_tokens;
    int max_tokens;
    int context_length;
    int required_tokens;
    int available_tokens;
    int excess_tokens;
    bool fits;
} token_count_result;

static token_count_result token_count_calculate(const request *r, int ctx_size) {
    const int prompt_tokens = r ? r->prompt.len : 0;
    const int max_tokens = r && r->max_tokens > 0 ? r->max_tokens : 0;
    /* 64-bit sum: prompt.len and max_tokens are both ints, so their sum can
     * overflow int before the fit comparison. */
    const int64_t required = (int64_t)prompt_tokens + (int64_t)max_tokens;
    const int64_t ctx = ctx_size;
    const int64_t available = required <= ctx ? ctx - required : 0;
    const int64_t excess = required > ctx ? required - ctx : 0;
    return (token_count_result) {
        .prompt_tokens = prompt_tokens,
        .max_tokens = max_tokens,
        .context_length = ctx_size,
        .required_tokens = required > INT_MAX ? INT_MAX : (int)required,
        .available_tokens = available > INT_MAX ? INT_MAX : (int)available,
        .excess_tokens = excess > INT_MAX ? INT_MAX : (int)excess,
        .fits = required <= ctx,
    };
}

/* Streaming is a translation state machine over the raw DS4 text.  The model
 * may produce <think> and DSML tool blocks; clients should receive those as
 * protocol-native reasoning/tool deltas, never as visible assistant text. */
static bool sse_headers(int fd, bool enable_cors) {
    buf h = {0};
    buf_puts(&h,
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: text/event-stream\r\n"
        "Cache-Control: no-cache\r\n");
    if (enable_cors) append_cors_headers(&h);
    buf_puts(&h, "Connection: close\r\n\r\n");
    bool ok = send_all(fd, h.ptr, h.len);
    buf_free(&h);
    return ok;
}

static bool sse_error_event(int fd, const request *r, const char *msg) {
    const char *message = msg && msg[0] ? msg : "internal server error";
    buf b = {0};
    if (r && r->api == API_ANTHROPIC) {
        buf_puts(&b, "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"api_error\",\"message\":");
        json_escape(&b, message);
        buf_puts(&b, "}}\n\n");
    } else {
        buf_puts(&b, "event: error\ndata: {\"error\":{\"message\":");
        json_escape(&b, message);
        buf_puts(&b, ",\"type\":\"server_error\"}}\n\n");
    }
    bool ok = send_all(fd, b.ptr, b.len);
    buf_free(&b);
    return ok;
}

static bool sse_chunk(int fd, const request *r, const char *id, const char *text, const char *finish) {
    buf b = {0};
    long now = (long)time(NULL);
    if (r->kind == REQ_CHAT) {
        buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
        json_escape(&b, r->model);
        buf_puts(&b, ",\"choices\":[{\"index\":0,\"delta\":");
        if (text) {
            buf_puts(&b, "{\"content\":");
            json_escape(&b, text);
            buf_putc(&b, '}');
        } else {
            buf_puts(&b, finish ? "{}" : "{\"role\":\"assistant\"}");
        }
        buf_puts(&b, ",\"finish_reason\":");
        if (finish) json_escape(&b, finish); else buf_puts(&b, "null");
        buf_puts(&b, "}]}\n\n");
    } else {
        buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"text_completion\",\"created\":%ld,\"model\":", id, now);
        json_escape(&b, r->model);
        buf_puts(&b, ",\"choices\":[{\"text\":");
        json_escape(&b, text ? text : "");
        buf_puts(&b, ",\"index\":0,\"finish_reason\":");
        if (finish) json_escape(&b, finish); else buf_puts(&b, "null");
        buf_puts(&b, "}]}\n\n");
    }
    bool ok = send_all(fd, b.ptr, b.len);
    buf_free(&b);
    return ok;
}

static int clamp_usage_tokens(int value, int max) {
    if (value < 0) return 0;
    if (max >= 0 && value > max) return max;
    return value;
}

static void append_openai_usage_json(buf *b, const request *r,
                                     int prompt_tokens, int completion_tokens) {
    int cached_tokens = r ? r->cache_read_tokens : 0;
    int cache_write_tokens = r ? r->cache_write_tokens : 0;
    cached_tokens = clamp_usage_tokens(cached_tokens, prompt_tokens);
    cache_write_tokens = clamp_usage_tokens(cache_write_tokens, prompt_tokens - cached_tokens);
    /* OpenAI defines cached_tokens as prompt tokens retrieved from cache.
     * Newly-prefilled tokens are useful to expose, but they are a DS4 extension
     * and must stay separate so OpenAI-compatible clients do not over-count
     * cache hits. */
    buf_printf(b,
               "{\"prompt_tokens\":%d,\"completion_tokens\":%d,\"total_tokens\":%d,"
               "\"prompt_tokens_details\":{\"cached_tokens\":%d,\"cache_write_tokens\":%d}}",
               prompt_tokens, completion_tokens, prompt_tokens + completion_tokens,
               cached_tokens, cache_write_tokens);
}

static bool sse_usage_chunk(int fd, const request *r, const char *id,
                            int prompt_tokens, int completion_tokens) {
    if (!r->stream_include_usage) return true;

    buf b = {0};
    long now = (long)time(NULL);
    if (r->kind == REQ_CHAT) {
        buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
        json_escape(&b, r->model);
        buf_puts(&b, ",\"choices\":[],\"usage\":");
    } else {
        buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"text_completion\",\"created\":%ld,\"model\":", id, now);
        json_escape(&b, r->model);
        buf_puts(&b, ",\"choices\":[],\"usage\":");
    }
    append_openai_usage_json(&b, r, prompt_tokens, completion_tokens);
    buf_puts(&b, "}\n\n");

    bool ok = send_all(fd, b.ptr, b.len);
    buf_free(&b);
    return ok;
}

static bool sse_done(int fd, const request *r, const char *id,
                     int prompt_tokens, int completion_tokens) {
    return sse_usage_chunk(fd, r, id, prompt_tokens, completion_tokens) &&
           send_all(fd, "data: [DONE]\n\n", 14);
}

static bool sse_chat_finish(int fd, const request *r, const char *id, const char *content,
                            const char *reasoning, const tool_calls *calls, const char *finish,
                            int prompt_tokens, int completion_tokens) {
    if (!sse_chunk(fd, r, id, NULL, NULL)) return false;

    buf b = {0};
    long now = (long)time(NULL);
    if (reasoning && reasoning[0]) {
        buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
        json_escape(&b, r->model);
        buf_puts(&b, ",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":");
        json_escape(&b, reasoning);
        buf_puts(&b, "},\"finish_reason\":null}]}\n\n");
    }
    if (content && content[0]) {
        buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
        json_escape(&b, r->model);
        buf_puts(&b, ",\"choices\":[{\"index\":0,\"delta\":{\"content\":");
        json_escape(&b, content);
        buf_puts(&b, "},\"finish_reason\":null}]}\n\n");
    }
    if (calls && calls->len) {
        buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
        json_escape(&b, r->model);
        buf_puts(&b, ",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":");
        append_tool_call_deltas_json(&b, calls, id, &r->tool_orders);
        buf_puts(&b, "},\"finish_reason\":null}]}\n\n");
    }
    buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
    json_escape(&b, r->model);
    buf_puts(&b, ",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":");
    json_escape(&b, finish);
    buf_puts(&b, "}]}\n\n");

    bool ok = send_all(fd, b.ptr, b.len) &&
              sse_done(fd, r, id, prompt_tokens, completion_tokens);
    buf_free(&b);
    return ok;
}

typedef enum {
    OPENAI_STREAM_THINKING,
    OPENAI_STREAM_TEXT,
    OPENAI_STREAM_TOOL,
    OPENAI_STREAM_SUPPRESS,
} openai_stream_mode;

typedef enum {
    DSML_TOOL_BETWEEN_INVOKES,
    DSML_TOOL_BETWEEN_PARAMS,
    DSML_TOOL_PARAM_VALUE,
    DSML_TOOL_DONE,
    DSML_TOOL_ERROR,
} dsml_tool_stream_state;

/* Shared states for protocol-specific DSML stream projections.  The model
 * still samples DSML; these states only translate already-sampled bytes into
 * OpenAI / Anthropic wire events while final parsing remains authoritative. */
typedef struct {
    dsml_tool_stream_state state;
    const char *tool_calls_end;
    const char *invoke_start;
    const char *invoke_end;
    const char *param_start;
    const char *param_end;
    size_t parse_pos;
    int index;
    bool active;
    bool emitted_any;
    bool args_open;
    bool first_param;
    bool param_is_string;
    char **ids;
    int ids_cap;
} openai_tool_stream;

typedef struct {
    openai_stream_mode mode;
    size_t emit_pos;
    bool active;
    bool checked_think_prefix;
    bool sent_reasoning;
    bool sent_content;
    openai_tool_stream tool;
} openai_stream;

static void openai_stream_start(const request *r, openai_stream *st) {
    memset(st, 0, sizeof(*st));
    st->active = true;
    st->mode = ds4_think_mode_enabled(r->think_mode) ? OPENAI_STREAM_THINKING : OPENAI_STREAM_TEXT;
}

static void openai_tool_stream_free(openai_tool_stream *ts) {
    if (!ts) return;
    for (int i = 0; i < ts->ids_cap; i++) free(ts->ids[i]);
    free(ts->ids);
    ts->ids = NULL;
    ts->ids_cap = 0;
}

static void openai_stream_free(openai_stream *st) {
    if (!st) return;
    openai_tool_stream_free(&st->tool);
}

static bool openai_tool_stream_has_id(const openai_tool_stream *ts,
                                      const char *id, int upto) {
    if (!ts || !id || !id[0]) return false;
    if (upto > ts->ids_cap) upto = ts->ids_cap;
    for (int i = 0; i < upto; i++) {
        if (ts->ids[i] && !strcmp(ts->ids[i], id)) return true;
    }
    return false;
}

static const char *openai_tool_stream_id(server *s, openai_tool_stream *ts,
                                         int index) {
    if (!ts || index < 0) return "";
    if (index >= ts->ids_cap) {
        int old = ts->ids_cap;
        int cap = old ? old : 4;
        while (cap <= index) cap *= 2;
        ts->ids = xrealloc(ts->ids, (size_t)cap * sizeof(ts->ids[0]));
        memset(ts->ids + old, 0, (size_t)(cap - old) * sizeof(ts->ids[0]));
        ts->ids_cap = cap;
    }
    if (!ts->ids[index]) {
        char id[64];
        for (;;) {
            random_tool_id(id, sizeof(id), API_OPENAI);
            if (!openai_tool_stream_has_id(ts, id, index) &&
                !tool_memory_has_id(s, id)) break;
        }
        ts->ids[index] = xstrdup(id);
    }
    return ts->ids[index];
}

static size_t text_stream_safe_limit(const char *raw, size_t start,
                                     size_t raw_len, bool has_tools,
                                     bool final);

static bool sse_chat_delta_n(int fd, const request *r, const char *id,
                             const char *field, const char *text, size_t len) {
    if (len == 0) return true;
    buf b = {0};
    long now = (long)time(NULL);
    buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
    json_escape(&b, r->model);
    buf_puts(&b, ",\"choices\":[{\"index\":0,\"delta\":{");
    json_escape(&b, field);
    buf_putc(&b, ':');
    json_escape_n(&b, text, len);
    buf_puts(&b, "},\"finish_reason\":null}]}\n\n");
    bool ok = send_all(fd, b.ptr, b.len);
    buf_free(&b);
    return ok;
}

/* OpenAI clients can consume function.arguments as a stream of JSON text
 * fragments.  DS4 generates XML-ish DSML instead, so this parser switches to a
 * hidden tool mode at <...tool_calls>, emits the tool header once the invoke tag
 * is complete, then translates each parameter body into argument deltas while
 * holding only tiny tails for partial closing tags, UTF-8, and DSML entities. */
static bool sse_chat_tool_call_start_delta(int fd, const request *r, const char *id,
                                           int index, const char *tool_id,
                                           const char *name) {
    buf b = {0};
    long now = (long)time(NULL);
    buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
    json_escape(&b, r->model);
    buf_puts(&b, ",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":");
    buf_printf(&b, "%d", index);
    buf_puts(&b, ",\"id\":");
    json_escape(&b, tool_id ? tool_id : "");
    buf_puts(&b, ",\"type\":\"function\",\"function\":{\"name\":");
    json_escape(&b, name ? name : "");
    buf_puts(&b, ",\"arguments\":\"\"}}]},\"finish_reason\":null}]}\n\n");
    bool ok = send_all(fd, b.ptr, b.len);
    buf_free(&b);
    return ok;
}

static bool sse_chat_tool_call_args_delta_n(int fd, const request *r, const char *id,
                                            int index, const char *text, size_t len) {
    if (len == 0) return true;
    buf b = {0};
    long now = (long)time(NULL);
    buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
    json_escape(&b, r->model);
    buf_puts(&b, ",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":");
    buf_printf(&b, "%d", index);
    buf_puts(&b, ",\"function\":{\"arguments\":");
    json_escape_n(&b, text, len);
    buf_puts(&b, "}}]},\"finish_reason\":null}]}\n\n");
    bool ok = send_all(fd, b.ptr, b.len);
    buf_free(&b);
    return ok;
}

static bool raw_full_lit(const char *raw, size_t raw_len, size_t pos, const char *lit) {
    size_t n = strlen(lit);
    return pos <= raw_len && raw_len - pos >= n && !memcmp(raw + pos, lit, n);
}

static bool raw_partial_lit(const char *raw, size_t raw_len, size_t pos, const char *lit) {
    size_t n = strlen(lit);
    if (pos > raw_len || raw_len - pos >= n) return false;
    return !memcmp(raw + pos, lit, raw_len - pos);
}

static bool raw_partial_any(const char *raw, size_t raw_len, size_t pos,
                            const char *a, const char *b) {
    return raw_partial_lit(raw, raw_len, pos, a) || raw_partial_lit(raw, raw_len, pos, b);
}

static const char *find_lit_bounded(const char *s, size_t n, const char *lit) {
    size_t m = strlen(lit);
    if (m == 0) return s;
    if (n < m) return NULL;
    for (size_t i = 0; i <= n - m; i++) {
        if (!memcmp(s + i, lit, m)) return s + i;
    }
    return NULL;
}

typedef enum {
    DSML_DECODE_OUTSIDE,
    DSML_DECODE_STRUCTURAL,
    DSML_DECODE_STRING_BODY,
    DSML_DECODE_JSON_STRUCTURAL,
    DSML_DECODE_JSON_STRING,
} dsml_decode_state;

typedef enum {
    DSML_TRACK_SEARCH,
    DSML_TRACK_STRUCTURAL,
    DSML_TRACK_STRING_BODY,
    DSML_TRACK_JSON_PARAM,
    DSML_TRACK_DONE,
} dsml_track_mode;

typedef struct {
    const char *tool_calls_start;
    const char *tool_calls_end;
    const char *invoke_start;
    const char *invoke_end;
    const char *param_start;
    const char *param_end;
} dsml_syntax;

static const dsml_syntax dsml_syntaxes[] = {
    {
        DS4_TOOL_CALLS_START, DS4_TOOL_CALLS_END,
        DS4_INVOKE_START, DS4_INVOKE_END,
        DS4_PARAM_START, DS4_PARAM_END,
    },
    {
        DS4_TOOL_CALLS_START_SHORT, DS4_TOOL_CALLS_END_SHORT,
        DS4_INVOKE_START_SHORT, DS4_INVOKE_END_SHORT,
        DS4_PARAM_START_SHORT, DS4_PARAM_END_SHORT,
    },
    {
        "<tool_calls>", "</tool_calls>",
        "<invoke", "</invoke>",
        "<parameter", "</parameter>",
    },
};

typedef struct {
    dsml_track_mode mode;
    dsml_decode_state decode;
    const dsml_syntax *syn;
    size_t pos;
    bool json_in_string;
    bool json_escaped;
} dsml_decode_tracker;

static bool raw_partial_lit_min(const char *raw, size_t raw_len, size_t pos,
                                const char *lit, size_t min_len) {
    size_t lit_len = strlen(lit);
    if (!raw || pos > raw_len || raw_len - pos >= lit_len) return false;
    size_t avail = raw_len - pos;
    return avail >= min_len && !memcmp(raw + pos, lit, avail);
}

static size_t dsml_max_tool_start_len(void) {
    size_t max = 0;
    for (size_t i = 0; i < sizeof(dsml_syntaxes) / sizeof(dsml_syntaxes[0]); i++) {
        size_t n = strlen(dsml_syntaxes[i].tool_calls_start);
        if (n > max) max = n;
    }
    return max;
}

static bool dsml_find_tool_start(const char *raw, size_t raw_len,
                                 size_t *pos_out,
                                 const dsml_syntax **syn_out) {
    const char *best = NULL;
    const dsml_syntax *best_syn = NULL;
    for (size_t i = 0; i < sizeof(dsml_syntaxes) / sizeof(dsml_syntaxes[0]); i++) {
        const char *p = find_lit_bounded(raw, raw_len, dsml_syntaxes[i].tool_calls_start);
        if (p && (!best || p < best)) {
            best = p;
            best_syn = &dsml_syntaxes[i];
        }
    }
    if (!best) return false;
    *pos_out = (size_t)(best - raw) + strlen(best_syn->tool_calls_start);
    *syn_out = best_syn;
    return true;
}

static bool dsml_find_tool_start_from(const char *raw, size_t raw_len,
                                      size_t start,
                                      size_t *pos_out,
                                      const dsml_syntax **syn_out) {
    if (start > raw_len) return false;
    size_t rel = 0;
    if (!dsml_find_tool_start(raw + start, raw_len - start, &rel, syn_out)) {
        return false;
    }
    *pos_out = start + rel;
    return true;
}

static bool dsml_attr_is_string_true(const char *raw, size_t raw_len,
                                     size_t tag_start, size_t tag_end) {
    if (tag_end <= tag_start || tag_end > raw_len) return false;
    char *tag = xstrndup(raw + tag_start, tag_end - tag_start);
    char *is_string = dsml_attr(tag, "string");
    bool result = is_string && !strcmp(is_string, "true");
    free(is_string);
    free(tag);
    return result;
}

#ifdef DS4_SERVER_TEST
static bool raw_suffix_partial_lit(const char *raw, size_t raw_len,
                                   const char *lit, size_t min_len) {
    size_t lit_len = strlen(lit);
    if (!raw || raw_len == 0 || lit_len == 0) return false;
    size_t max = raw_len < lit_len ? raw_len : lit_len - 1;
    for (size_t n = min_len; n <= max; n++) {
        if (!memcmp(raw + raw_len - n, lit, n)) return true;
    }
    return false;
}

static dsml_decode_state dsml_decode_scan_json_param(const char *raw,
                                                     size_t raw_len,
                                                     size_t pos,
                                                     const dsml_syntax *syn) {
    bool in_string = false;
    bool escaped = false;
    while (pos < raw_len) {
        if (!in_string && raw_full_lit(raw, raw_len, pos, syn->param_end)) {
            return DSML_DECODE_STRUCTURAL;
        }
        unsigned char c = (unsigned char)raw[pos++];
        if (in_string) {
            if (escaped) {
                escaped = false;
            } else if (c == '\\') {
                escaped = true;
            } else if (c == '"') {
                in_string = false;
            }
        } else if (c == '"') {
            in_string = true;
        }
    }
    if (!in_string && raw_suffix_partial_lit(raw, raw_len, syn->param_end, 2)) {
        return DSML_DECODE_STRUCTURAL;
    }
    return in_string ? DSML_DECODE_JSON_STRING : DSML_DECODE_JSON_STRUCTURAL;
}

/* Slow reference recognizer used by tests. */
static dsml_decode_state dsml_decode_state_for_text(const char *raw, size_t raw_len) {
    if (!raw || raw_len == 0) return DSML_DECODE_OUTSIDE;

    size_t pos = 0;
    const dsml_syntax *syn = NULL;
    if (!dsml_find_tool_start(raw, raw_len, &pos, &syn)) {
        return DSML_DECODE_OUTSIDE;
    }

    for (;;) {
        while (pos < raw_len && isspace((unsigned char)raw[pos])) pos++;
        if (pos >= raw_len) return DSML_DECODE_STRUCTURAL;

        if (raw_full_lit(raw, raw_len, pos, syn->tool_calls_end)) {
            return DSML_DECODE_OUTSIDE;
        }
        if (raw_full_lit(raw, raw_len, pos, syn->invoke_end)) {
            pos += strlen(syn->invoke_end);
            continue;
        }
        if (raw_full_lit(raw, raw_len, pos, syn->invoke_start)) {
            const char *tag_end = memchr(raw + pos, '>', raw_len - pos);
            if (!tag_end) return DSML_DECODE_STRUCTURAL;
            pos = (size_t)(tag_end - raw) + 1;
            continue;
        }
        if (raw_full_lit(raw, raw_len, pos, syn->param_start)) {
            size_t tag_start = pos;
            const char *tag_end_ptr = memchr(raw + pos, '>', raw_len - pos);
            if (!tag_end_ptr) return DSML_DECODE_STRUCTURAL;
            size_t tag_end = (size_t)(tag_end_ptr - raw) + 1;
            bool string_value = dsml_attr_is_string_true(raw, raw_len, tag_start, tag_end);
            pos = tag_end;

            if (string_value) {
                const char *end = find_lit_bounded(raw + pos, raw_len - pos, syn->param_end);
                if (!end) {
                    if (raw_suffix_partial_lit(raw, raw_len, syn->param_end, 2)) {
                        return DSML_DECODE_STRUCTURAL;
                    }
                    return DSML_DECODE_STRING_BODY;
                }
                pos = (size_t)(end - raw) + strlen(syn->param_end);
                continue;
            }

            dsml_decode_state json_state =
                dsml_decode_scan_json_param(raw, raw_len, pos, syn);
            if (json_state == DSML_DECODE_STRUCTURAL) {
                const char *end = find_lit_bounded(raw + pos, raw_len - pos, syn->param_end);
                if (!end) return DSML_DECODE_STRUCTURAL;
                pos = (size_t)(end - raw) + strlen(syn->param_end);
                continue;
            }
            return json_state;
        }

        for (size_t i = 0; i < sizeof(dsml_syntaxes) / sizeof(dsml_syntaxes[0]); i++) {
            if (raw_partial_lit(raw, raw_len, pos, dsml_syntaxes[i].tool_calls_end) ||
                raw_partial_lit(raw, raw_len, pos, dsml_syntaxes[i].invoke_start) ||
                raw_partial_lit(raw, raw_len, pos, dsml_syntaxes[i].invoke_end) ||
                raw_partial_lit(raw, raw_len, pos, dsml_syntaxes[i].param_start) ||
                raw_partial_lit(raw, raw_len, pos, dsml_syntaxes[i].param_end))
            {
                return DSML_DECODE_STRUCTURAL;
            }
        }
        return DSML_DECODE_STRUCTURAL;
    }
}
#endif

static bool dsml_decode_state_is_tool(dsml_decode_state state) {
    return state != DSML_DECODE_OUTSIDE;
}

static bool dsml_decode_state_uses_payload_sampling(dsml_decode_state state) {
    return state == DSML_DECODE_STRING_BODY || state == DSML_DECODE_JSON_STRING;
}

static void dsml_decode_tracker_init(dsml_decode_tracker *dt) {
    memset(dt, 0, sizeof(*dt));
    dt->mode = DSML_TRACK_SEARCH;
    dt->decode = DSML_DECODE_OUTSIDE;
}

/* Track where generation is inside a DSML tool call.  This is intentionally a
 * forgiving recognizer, not a validator: malformed DSML still gets parsed later
 * by the normal tool-call parser.  Here we only need enough state to decide
 * whether the next token belongs to protocol syntax or arbitrary payload. */
static void dsml_decode_tracker_update(dsml_decode_tracker *dt,
                                       const char *raw, size_t raw_len) {
    if (!dt || !raw) return;

    for (;;) {
        if (dt->mode == DSML_TRACK_DONE) {
            dt->decode = DSML_DECODE_OUTSIDE;
            return;
        }

        if (dt->mode == DSML_TRACK_SEARCH) {
            size_t pos = 0;
            const dsml_syntax *syn = NULL;
            if (!dsml_find_tool_start_from(raw, raw_len, dt->pos, &pos, &syn)) {
                size_t hold = dsml_max_tool_start_len();
                dt->pos = raw_len > hold ? raw_len - hold : 0;
                dt->decode = DSML_DECODE_OUTSIDE;
                return;
            }
            dt->syn = syn;
            dt->pos = pos;
            dt->mode = DSML_TRACK_STRUCTURAL;
            dt->decode = DSML_DECODE_STRUCTURAL;
        }

        if (dt->mode == DSML_TRACK_STRING_BODY) {
            while (dt->pos < raw_len) {
                if (raw_full_lit(raw, raw_len, dt->pos, dt->syn->param_end)) {
                    dt->pos += strlen(dt->syn->param_end);
                    dt->mode = DSML_TRACK_STRUCTURAL;
                    dt->decode = DSML_DECODE_STRUCTURAL;
                    goto structural;
                }
                if (raw_partial_lit_min(raw, raw_len, dt->pos, dt->syn->param_end, 2)) {
                    dt->decode = DSML_DECODE_STRUCTURAL;
                    return;
                }
                dt->pos++;
            }
            dt->decode = DSML_DECODE_STRING_BODY;
            return;
        }

        if (dt->mode == DSML_TRACK_JSON_PARAM) {
            while (dt->pos < raw_len) {
                if (!dt->json_in_string) {
                    if (raw_full_lit(raw, raw_len, dt->pos, dt->syn->param_end)) {
                        dt->pos += strlen(dt->syn->param_end);
                        dt->mode = DSML_TRACK_STRUCTURAL;
                        dt->decode = DSML_DECODE_STRUCTURAL;
                        goto structural;
                    }
                    if (raw_partial_lit_min(raw, raw_len, dt->pos, dt->syn->param_end, 2)) {
                        dt->decode = DSML_DECODE_STRUCTURAL;
                        return;
                    }
                }

                unsigned char c = (unsigned char)raw[dt->pos++];
                if (dt->json_in_string) {
                    if (dt->json_escaped) {
                        dt->json_escaped = false;
                    } else if (c == '\\') {
                        dt->json_escaped = true;
                    } else if (c == '"') {
                        dt->json_in_string = false;
                    }
                } else if (c == '"') {
                    dt->json_in_string = true;
                }
            }
            dt->decode = dt->json_in_string ?
                DSML_DECODE_JSON_STRING : DSML_DECODE_JSON_STRUCTURAL;
            return;
        }

structural:
        while (dt->mode == DSML_TRACK_STRUCTURAL) {
            while (dt->pos < raw_len && isspace((unsigned char)raw[dt->pos])) dt->pos++;
            if (dt->pos >= raw_len) {
                dt->decode = DSML_DECODE_STRUCTURAL;
                return;
            }

            if (raw_full_lit(raw, raw_len, dt->pos, dt->syn->tool_calls_end)) {
                dt->mode = DSML_TRACK_DONE;
                dt->pos += strlen(dt->syn->tool_calls_end);
                dt->decode = DSML_DECODE_OUTSIDE;
                return;
            }
            if (raw_full_lit(raw, raw_len, dt->pos, dt->syn->invoke_end)) {
                dt->pos += strlen(dt->syn->invoke_end);
                continue;
            }
            if (raw_full_lit(raw, raw_len, dt->pos, dt->syn->invoke_start)) {
                const char *tag_end = memchr(raw + dt->pos, '>', raw_len - dt->pos);
                if (!tag_end) {
                    dt->decode = DSML_DECODE_STRUCTURAL;
                    return;
                }
                dt->pos = (size_t)(tag_end - raw) + 1;
                continue;
            }
            if (raw_full_lit(raw, raw_len, dt->pos, dt->syn->param_start)) {
                size_t tag_start = dt->pos;
                const char *tag_end = memchr(raw + dt->pos, '>', raw_len - dt->pos);
                if (!tag_end) {
                    dt->decode = DSML_DECODE_STRUCTURAL;
                    return;
                }
                size_t tag_after = (size_t)(tag_end - raw) + 1;
                bool string_value = dsml_attr_is_string_true(raw, raw_len, tag_start, tag_after);
                dt->pos = tag_after;
                if (string_value) {
                    dt->mode = DSML_TRACK_STRING_BODY;
                    dt->decode = DSML_DECODE_STRING_BODY;
                } else {
                    dt->mode = DSML_TRACK_JSON_PARAM;
                    dt->json_in_string = false;
                    dt->json_escaped = false;
                    dt->decode = DSML_DECODE_JSON_STRUCTURAL;
                }
                break;
            }

            if (raw_partial_lit(raw, raw_len, dt->pos, dt->syn->tool_calls_end) ||
                raw_partial_lit(raw, raw_len, dt->pos, dt->syn->invoke_start) ||
                raw_partial_lit(raw, raw_len, dt->pos, dt->syn->invoke_end) ||
                raw_partial_lit(raw, raw_len, dt->pos, dt->syn->param_start) ||
                raw_partial_lit(raw, raw_len, dt->pos, dt->syn->param_end))
            {
                dt->decode = DSML_DECODE_STRUCTURAL;
                return;
            }

            dt->decode = DSML_DECODE_STRUCTURAL;
            return;
        }
    }
}

static size_t dsml_entity_stream_safe_len(const char *raw, size_t start, size_t limit) {
    static const char *ents[] = {"&amp;", "&lt;", "&gt;", "&quot;", "&apos;"};
    const size_t max_ent = 6;
    size_t scan = limit > start + max_ent ? limit - max_ent : start;
    for (size_t i = limit; i > scan; i--) {
        if (raw[i - 1] != '&') continue;
        size_t amp = i - 1;
        size_t tail = limit - amp;
        for (size_t ei = 0; ei < sizeof(ents) / sizeof(ents[0]); ei++) {
            size_t elen = strlen(ents[ei]);
            if (tail < elen && !memcmp(raw + amp, ents[ei], tail)) return amp;
        }
        break;
    }
    return limit;
}

static size_t tool_param_value_stream_safe_len(const char *raw, size_t start,
                                               size_t raw_len, const char *param_end,
                                               bool is_string) {
    size_t limit = raw_len;
    size_t end_len = strlen(param_end);
    size_t scan = raw_len > start + end_len ? raw_len - end_len : start;
    for (size_t i = raw_len; i > scan; i--) {
        if (raw[i - 1] != '<') continue;
        size_t marker = i - 1;
        size_t tail = raw_len - marker;
        if (tail < end_len && !memcmp(raw + marker, param_end, tail)) limit = marker;
        break;
    }
    if (is_string) limit = dsml_entity_stream_safe_len(raw, start, limit);
    return utf8_stream_safe_len(raw, start, limit, false);
}

static bool openai_tool_emit_args_fragment(int fd, const request *r, const char *id,
                                           openai_tool_stream *ts,
                                           const char *text, size_t len) {
    return sse_chat_tool_call_args_delta_n(fd, r, id, ts->index, text, len);
}

static bool openai_tool_emit_string_value(int fd, const request *r, const char *id,
                                          openai_tool_stream *ts,
                                          const char *text, size_t len) {
    if (len == 0) return true;
    char *raw = xstrndup(text, len);
    char *unescaped = dsml_unescape_text(raw);
    buf frag = {0};
    json_escape_fragment_n(&frag, unescaped, strlen(unescaped));
    bool ok = openai_tool_emit_args_fragment(fd, r, id, ts, frag.ptr ? frag.ptr : "", frag.len);
    buf_free(&frag);
    free(unescaped);
    free(raw);
    return ok;
}

static bool openai_tool_emit_param_prefix(int fd, const request *r, const char *id,
                                          openai_tool_stream *ts,
                                          const char *name, bool is_string) {
    buf frag = {0};
    if (ts->first_param) ts->first_param = false;
    else buf_putc(&frag, ',');
    json_escape(&frag, name ? name : "");
    buf_putc(&frag, ':');
    if (is_string) buf_putc(&frag, '"');
    bool ok = openai_tool_emit_args_fragment(fd, r, id, ts, frag.ptr ? frag.ptr : "", frag.len);
    buf_free(&frag);
    return ok;
}

static bool openai_tool_stream_init(openai_tool_stream *ts, const char *raw,
                                    size_t raw_len, size_t pos) {
    openai_tool_stream_free(ts);
    memset(ts, 0, sizeof(*ts));
    ts->active = true;
    ts->state = DSML_TOOL_BETWEEN_INVOKES;
    ts->parse_pos = pos;
    if (raw_full_lit(raw, raw_len, pos, DS4_TOOL_CALLS_START)) {
        ts->parse_pos += strlen(DS4_TOOL_CALLS_START);
        ts->tool_calls_end = DS4_TOOL_CALLS_END;
        ts->invoke_start = DS4_INVOKE_START;
        ts->invoke_end = DS4_INVOKE_END;
        ts->param_start = DS4_PARAM_START;
        ts->param_end = DS4_PARAM_END;
    } else if (raw_full_lit(raw, raw_len, pos, DS4_TOOL_CALLS_START_SHORT)) {
        ts->parse_pos += strlen(DS4_TOOL_CALLS_START_SHORT);
        ts->tool_calls_end = DS4_TOOL_CALLS_END_SHORT;
        ts->invoke_start = DS4_INVOKE_START_SHORT;
        ts->invoke_end = DS4_INVOKE_END_SHORT;
        ts->param_start = DS4_PARAM_START_SHORT;
        ts->param_end = DS4_PARAM_END_SHORT;
    } else if (raw_full_lit(raw, raw_len, pos, "<tool_calls>")) {
        ts->parse_pos += strlen("<tool_calls>");
        ts->tool_calls_end = "</tool_calls>";
        ts->invoke_start = "<invoke";
        ts->invoke_end = "</invoke>";
        ts->param_start = "<parameter";
        ts->param_end = "</parameter>";
    } else {
        ts->active = false;
        ts->state = DSML_TOOL_ERROR;
        return false;
    }
    return true;
}

static bool openai_tool_stream_fail(openai_tool_stream *ts) {
    ts->active = false;
    ts->state = DSML_TOOL_ERROR;
    return true;
}

static bool openai_tool_start_invoke(int fd, server *s, const request *r, const char *id,
                                     openai_tool_stream *ts,
                                     const char *raw, size_t raw_len) {
    const char *tag_end = memchr(raw + ts->parse_pos, '>', raw_len - ts->parse_pos);
    if (!tag_end) return true;
    char *tag = xstrndup(raw + ts->parse_pos, (size_t)(tag_end - (raw + ts->parse_pos) + 1));
    char *name = dsml_attr(tag, "name");
    free(tag);
    if (!name) return openai_tool_stream_fail(ts);

    const char *tool_id = openai_tool_stream_id(s, ts, ts->index);
    bool ok = sse_chat_tool_call_start_delta(fd, r, id, ts->index, tool_id, name) &&
              openai_tool_emit_args_fragment(fd, r, id, ts, "{", 1);
    free(name);
    if (!ok) return false;

    ts->emitted_any = true;
    ts->args_open = true;
    ts->first_param = true;
    ts->parse_pos = (size_t)(tag_end - raw) + 1;
    ts->state = DSML_TOOL_BETWEEN_PARAMS;
    return true;
}

static bool openai_tool_start_param(int fd, const request *r, const char *id,
                                    openai_tool_stream *ts,
                                    const char *raw, size_t raw_len) {
    const char *tag_end = memchr(raw + ts->parse_pos, '>', raw_len - ts->parse_pos);
    if (!tag_end) return true;
    char *tag = xstrndup(raw + ts->parse_pos, (size_t)(tag_end - (raw + ts->parse_pos) + 1));
    char *name = dsml_attr(tag, "name");
    char *is_string = dsml_attr(tag, "string");
    free(tag);
    if (!name || !is_string) {
        free(name);
        free(is_string);
        return openai_tool_stream_fail(ts);
    }
    bool string_value = !strcmp(is_string, "true");
    bool ok = openai_tool_emit_param_prefix(fd, r, id, ts, name, string_value);
    free(name);
    free(is_string);
    if (!ok) return false;

    ts->param_is_string = string_value;
    ts->parse_pos = (size_t)(tag_end - raw) + 1;
    ts->state = DSML_TOOL_PARAM_VALUE;
    return true;
}

static bool openai_tool_finish_param(int fd, const request *r, const char *id,
                                     openai_tool_stream *ts,
                                     const char *raw, size_t value_end) {
    if (value_end > ts->parse_pos) {
        bool ok = ts->param_is_string ?
            openai_tool_emit_string_value(fd, r, id, ts, raw + ts->parse_pos,
                                          value_end - ts->parse_pos) :
            openai_tool_emit_args_fragment(fd, r, id, ts, raw + ts->parse_pos,
                                           value_end - ts->parse_pos);
        if (!ok) return false;
    }
    if (ts->param_is_string &&
        !openai_tool_emit_args_fragment(fd, r, id, ts, "\"", 1)) return false;
    ts->parse_pos = value_end + strlen(ts->param_end);
    ts->state = DSML_TOOL_BETWEEN_PARAMS;
    return true;
}

static bool openai_tool_stream_update(int fd, server *s, const request *r, const char *id,
                                      openai_tool_stream *ts,
                                      const char *raw, size_t raw_len) {
    while (ts->active && ts->parse_pos < raw_len) {
        if (ts->state == DSML_TOOL_BETWEEN_INVOKES) {
            while (ts->parse_pos < raw_len && isspace((unsigned char)raw[ts->parse_pos])) ts->parse_pos++;
            if (ts->parse_pos >= raw_len) return true;
            if (raw_full_lit(raw, raw_len, ts->parse_pos, ts->tool_calls_end)) {
                ts->parse_pos += strlen(ts->tool_calls_end);
                ts->active = false;
                ts->state = DSML_TOOL_DONE;
                return true;
            }
            if (raw_partial_any(raw, raw_len, ts->parse_pos, ts->tool_calls_end, ts->invoke_start)) return true;
            if (raw_full_lit(raw, raw_len, ts->parse_pos, ts->invoke_start)) {
                size_t before_pos = ts->parse_pos;
                dsml_tool_stream_state before_state = ts->state;
                if (!openai_tool_start_invoke(fd, s, r, id, ts, raw, raw_len)) return false;
                if (ts->parse_pos == before_pos && ts->state == before_state) return true;
                continue;
            }
            return openai_tool_stream_fail(ts);
        }

        if (ts->state == DSML_TOOL_BETWEEN_PARAMS) {
            while (ts->parse_pos < raw_len && isspace((unsigned char)raw[ts->parse_pos])) ts->parse_pos++;
            if (ts->parse_pos >= raw_len) return true;
            if (raw_full_lit(raw, raw_len, ts->parse_pos, ts->invoke_end)) {
                if (ts->args_open &&
                    !openai_tool_emit_args_fragment(fd, r, id, ts, "}", 1)) return false;
                ts->args_open = false;
                ts->parse_pos += strlen(ts->invoke_end);
                ts->index++;
                ts->state = DSML_TOOL_BETWEEN_INVOKES;
                continue;
            }
            if (raw_partial_any(raw, raw_len, ts->parse_pos, ts->invoke_end, ts->param_start)) return true;
            if (raw_full_lit(raw, raw_len, ts->parse_pos, ts->param_start)) {
                size_t before_pos = ts->parse_pos;
                dsml_tool_stream_state before_state = ts->state;
                if (!openai_tool_start_param(fd, r, id, ts, raw, raw_len)) return false;
                if (ts->parse_pos == before_pos && ts->state == before_state) return true;
                continue;
            }
            return openai_tool_stream_fail(ts);
        }

        if (ts->state == DSML_TOOL_PARAM_VALUE) {
            const char *end = find_lit_bounded(raw + ts->parse_pos,
                                               raw_len - ts->parse_pos,
                                               ts->param_end);
            if (end) {
                if (!openai_tool_finish_param(fd, r, id, ts, raw,
                                              (size_t)(end - raw))) return false;
                continue;
            }
            size_t limit = tool_param_value_stream_safe_len(raw, ts->parse_pos,
                                                            raw_len, ts->param_end,
                                                            ts->param_is_string);
            if (limit > ts->parse_pos) {
                bool ok = ts->param_is_string ?
                    openai_tool_emit_string_value(fd, r, id, ts, raw + ts->parse_pos,
                                                  limit - ts->parse_pos) :
                    openai_tool_emit_args_fragment(fd, r, id, ts, raw + ts->parse_pos,
                                                   limit - ts->parse_pos);
                if (!ok) return false;
                ts->parse_pos = limit;
            }
            return true;
        }

        return true;
    }
    return true;
}

static bool openai_sse_stream_update(int fd, server *s, const request *r, const char *id,
                                     openai_stream *st,
                                     const char *raw, size_t raw_len,
                                     bool final) {
    if (!st->active || !raw) return true;

    if (st->mode == OPENAI_STREAM_THINKING) {
        if (!st->checked_think_prefix) {
            const char *open = "<think>";
            const size_t open_len = strlen(open);
            if (raw_len < open_len && !strncmp(raw, open, raw_len) && !final) {
                return true;
            }
            if (raw_len >= open_len && !strncmp(raw, open, open_len)) {
                st->emit_pos = open_len;
            }
            st->checked_think_prefix = true;
        }

        const char *close = strstr(raw + st->emit_pos, "</think>");
        size_t limit;
        if (close) {
            limit = (size_t)(close - raw);
        } else if (final) {
            limit = raw_len;
        } else {
            const size_t hold = strlen("</think>") - 1;
            limit = raw_len > hold ? raw_len - hold : st->emit_pos;
            limit = utf8_stream_safe_len(raw, st->emit_pos, limit, false);
        }

        if (limit > st->emit_pos) {
            if (!sse_chat_delta_n(fd, r, id, "reasoning_content",
                                  raw + st->emit_pos,
                                  limit - st->emit_pos)) return false;
            st->sent_reasoning = true;
            st->emit_pos = limit;
        }

        if (close) {
            st->emit_pos = (size_t)(close - raw) + strlen("</think>");
            st->mode = OPENAI_STREAM_TEXT;
        } else if (final) {
            st->mode = OPENAI_STREAM_SUPPRESS;
            return true;
        } else {
            return true;
        }
    }

    if (st->mode == OPENAI_STREAM_TEXT) {
        const char *tool = r->has_tools ? find_any_tool_start(raw + st->emit_pos) : NULL;
        size_t limit = text_stream_safe_limit(raw, st->emit_pos, raw_len,
                                              r->has_tools, final);

        if (limit > st->emit_pos) {
            if (!sse_chat_delta_n(fd, r, id, "content",
                                  raw + st->emit_pos,
                                  limit - st->emit_pos)) return false;
            st->sent_content = true;
            st->emit_pos = limit;
        }

        if (tool) {
            st->emit_pos = (size_t)(tool - raw);
            if (openai_tool_stream_init(&st->tool, raw, raw_len, st->emit_pos)) {
                st->mode = OPENAI_STREAM_TOOL;
            } else {
                st->mode = OPENAI_STREAM_SUPPRESS;
            }
        } else if (final) {
            st->mode = OPENAI_STREAM_SUPPRESS;
        }
    }

    if (st->mode == OPENAI_STREAM_TOOL) {
        if (!openai_tool_stream_update(fd, s, r, id, &st->tool, raw, raw_len)) return false;
        if (!st->tool.active) st->mode = OPENAI_STREAM_SUPPRESS;
    }
    return true;
}

static bool openai_sse_finish_live(int fd, server *s, const request *r, const char *id,
                                   openai_stream *st, const char *raw,
                                   size_t raw_len, const tool_calls *calls,
                                   const char *finish, int prompt_tokens,
                                   int completion_tokens) {
    if (!openai_sse_stream_update(fd, s, r, id, st, raw, raw_len, true)) return false;

    buf b = {0};
    long now = (long)time(NULL);
    if (calls && calls->len && !st->tool.emitted_any) {
        buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
        json_escape(&b, r->model);
        buf_puts(&b, ",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":");
        append_tool_call_deltas_json(&b, calls, id, &r->tool_orders);
        buf_puts(&b, "},\"finish_reason\":null}]}\n\n");
    }
    buf_printf(&b, "data: {\"id\":\"%s\",\"object\":\"chat.completion.chunk\",\"created\":%ld,\"model\":", id, now);
    json_escape(&b, r->model);
    buf_puts(&b, ",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":");
    json_escape(&b, finish);
    buf_puts(&b, "}]}\n\n");

    bool ok = send_all(fd, b.ptr, b.len) &&
              sse_done(fd, r, id, prompt_tokens, completion_tokens);
    buf_free(&b);
    return ok;
}

static bool request_uses_openai_live_stream(const request *r) {
    return r->stream && r->api == API_OPENAI && r->kind == REQ_CHAT;
}

static bool request_uses_responses_live_stream(const request *r) {
    return r->stream && r->api == API_RESPONSES && r->kind == REQ_CHAT;
}

static bool request_uses_structured_stream(const request *r) {
    return r->stream && (r->api == API_ANTHROPIC ||
                         r->api == API_RESPONSES ||
                         request_uses_openai_live_stream(r));
}

/* Codex' Responses API uses 24-hex suffixes for response/item ids. Prefix
 * controls the variant (resp_, rs_, msg_, fc_) so each event references a
 * stable identifier across output_item.added / .done. */
static void responses_random_id(char *dst, size_t dstlen, const char *prefix) {
    unsigned char bytes[12];
    size_t pos = snprintf(dst, dstlen, "%s", prefix);
    if (pos >= dstlen) return;
    static uint64_t fallback_ctr;
    if (!random_bytes(bytes, sizeof(bytes))) {
        uint64_t a = ((uint64_t)time(NULL) << 32) ^ (uint64_t)getpid();
        uint64_t b = ++fallback_ctr ^ (uint64_t)(uintptr_t)dst;
        memcpy(bytes, &a, sizeof(a));
        memcpy(bytes + sizeof(a), &b, sizeof(uint32_t));
    }
    static const char hex[] = "0123456789abcdef";
    for (size_t i = 0; i < sizeof(bytes) && pos + 2 < dstlen; i++) {
        dst[pos++] = hex[bytes[i] >> 4];
        dst[pos++] = hex[bytes[i] & 15];
    }
    dst[pos] = '\0';
}

typedef enum {
    RESP_STREAM_THINKING,
    RESP_STREAM_TEXT,
    RESP_STREAM_SUPPRESS,
} responses_stream_mode;

typedef struct {
    responses_stream_mode mode;
    size_t emit_pos;
    bool active;
    bool checked_think_prefix;
    bool reasoning_item_opened;
    bool reasoning_item_closed;
    bool reasoning_summary_started;
    bool reasoning_closed_naturally;
    bool message_item_opened;
    bool message_text_part_open;
    bool message_item_closed;
    bool reasoning_emitted_any;
    bool message_emitted_any;
    buf reasoning_text;
    buf message_text;
    char response_id[40];
    char reasoning_id[40];
    char message_id[40];
    int reasoning_index;   /* output_index of the reasoning item (0 if present) */
    int message_index;     /* output_index of the assistant message item */
    int next_output_index; /* monotonic counter for upcoming output items */
    int sequence;          /* monotonic per-event sequence_number Codex consumes */
} responses_stream;

static void responses_stream_init(const request *r, responses_stream *st) {
    memset(st, 0, sizeof(*st));
    st->mode = ds4_think_mode_enabled(r->think_mode) ? RESP_STREAM_THINKING : RESP_STREAM_TEXT;
    responses_random_id(st->response_id, sizeof(st->response_id), "resp_");
    responses_random_id(st->reasoning_id, sizeof(st->reasoning_id), "rs_");
    responses_random_id(st->message_id, sizeof(st->message_id), "msg_");
    st->reasoning_index = -1;
    st->message_index = -1;
}

static void responses_stream_free(responses_stream *st) {
    if (!st) return;
    buf_free(&st->reasoning_text);
    buf_free(&st->message_text);
}

/* Codex parses an explicit sequence_number on every Responses event for
 * ordering and reconnect resilience. We inject it after the `{"type":...` head
 * so emitters can stay readable while still producing the wire shape Codex
 * expects. */
static bool responses_sse_emit_event(int fd, responses_stream *st, const char *body) {
    buf b = {0};
    buf_puts(&b, "data: ");
    /* body always starts with `{"type":"..."`. We splice in sequence_number
     * after the closing quote of that string so every event has it as the
     * second field. */
    const char *type_close = NULL;
    if (body[0] == '{') {
        const char *p = body + 1;
        /* Skip the literal `"type":` then the value string. */
        if (!strncmp(p, "\"type\":\"", 8)) {
            const char *q = p + 8;
            while (*q && *q != '"') {
                if (*q == '\\' && q[1]) q += 2;
                else q++;
            }
            if (*q == '"') type_close = q + 1;
        }
    }
    if (type_close) {
        size_t head_len = (size_t)(type_close - body);
        buf_append(&b, body, head_len);
        buf_printf(&b, ",\"sequence_number\":%d", st->sequence++);
        buf_puts(&b, type_close);
    } else {
        buf_puts(&b, body);
    }
    buf_puts(&b, "\n\n");
    bool ok = send_all(fd, b.ptr, b.len);
    buf_free(&b);
    return ok;
}

static bool responses_sse_created(int fd, const request *r, responses_stream *st,
                                  long created_at) {
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.created\",\"response\":{\"id\":\"%s\","
        "\"object\":\"response\",\"created_at\":%ld,\"status\":\"in_progress\","
        "\"model\":", st->response_id, created_at);
    json_escape(&b, r->model);
    buf_puts(&b, ",\"output\":[]}}");
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

static bool responses_sse_reasoning_added(int fd, responses_stream *st) {
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.output_item.added\",\"output_index\":%d,"
        "\"item\":{\"id\":\"%s\",\"type\":\"reasoning\",\"status\":\"in_progress\","
        "\"summary\":[]}}",
        st->reasoning_index, st->reasoning_id);
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

static bool responses_sse_reasoning_summary_part_added(int fd, responses_stream *st) {
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.reasoning_summary_part.added\","
        "\"item_id\":\"%s\",\"output_index\":%d,\"summary_index\":0,"
        "\"part\":{\"type\":\"summary_text\",\"text\":\"\"}}",
        st->reasoning_id, st->reasoning_index);
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

static bool responses_sse_reasoning_delta(int fd, responses_stream *st,
                                          const char *text, size_t len) {
    if (len == 0) return true;
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.reasoning_summary_text.delta\","
        "\"item_id\":\"%s\",\"output_index\":%d,\"summary_index\":0,\"delta\":",
        st->reasoning_id, st->reasoning_index);
    json_escape_n(&b, text, len);
    buf_putc(&b, '}');
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

static const char *responses_item_status_for_finish(const char *finish) {
    if (finish && (!strcmp(finish, "length") || !strcmp(finish, "error"))) return "incomplete";
    return "completed";
}

static bool responses_sse_reasoning_done(int fd, responses_stream *st,
                                         const char *finish) {
    /* If the stream terminates before `</think>` was actually observed the
     * reasoning item is partial — regardless of why generation stopped (EOS,
     * stop sequence, tool_calls, length, error). Force the item to incomplete
     * so a client replay rejects it instead of feeding unfinished hidden state
     * back as completed history. */
    (void)finish;
    const char *item_status =
        st->reasoning_closed_naturally ? "completed" : "incomplete";
    /* Mirror the message-item close sequence: emit summary_text.done +
     * summary_part.done before the output_item.done so clients that key off
     * part lifecycle don't see a dangling open summary part. */
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.reasoning_summary_text.done\","
        "\"item_id\":\"%s\",\"output_index\":%d,\"summary_index\":0,\"text\":",
        st->reasoning_id, st->reasoning_index);
    json_escape_n(&b, st->reasoning_text.ptr ? st->reasoning_text.ptr : "",
                  st->reasoning_text.len);
    buf_putc(&b, '}');
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    if (!ok) {
        buf_free(&b);
        return false;
    }

    if (st->reasoning_summary_started) {
        buf_free(&b);
        buf_printf(&b,
            "{\"type\":\"response.reasoning_summary_part.done\","
            "\"item_id\":\"%s\",\"output_index\":%d,\"summary_index\":0,"
            "\"part\":{\"type\":\"summary_text\",\"text\":",
            st->reasoning_id, st->reasoning_index);
        json_escape_n(&b, st->reasoning_text.ptr ? st->reasoning_text.ptr : "",
                      st->reasoning_text.len);
        buf_puts(&b, "}}");
        ok = responses_sse_emit_event(fd, st, b.ptr);
        if (!ok) {
            buf_free(&b);
            return false;
        }
    }

    buf_free(&b);
    buf_printf(&b,
        "{\"type\":\"response.output_item.done\",\"output_index\":%d,"
        "\"item\":{\"id\":\"%s\",\"type\":\"reasoning\",\"status\":\"%s\",\"summary\":[",
        st->reasoning_index, st->reasoning_id, item_status);
    if (st->reasoning_text.len) {
        buf_puts(&b, "{\"type\":\"summary_text\",\"text\":");
        json_escape_n(&b, st->reasoning_text.ptr, st->reasoning_text.len);
        buf_putc(&b, '}');
    }
    buf_puts(&b, "]}}");
    ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

static bool responses_sse_message_added(int fd, responses_stream *st) {
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.output_item.added\",\"output_index\":%d,"
        "\"item\":{\"id\":\"%s\",\"type\":\"message\",\"status\":\"in_progress\","
        "\"role\":\"assistant\",\"content\":[]}}",
        st->message_index, st->message_id);
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

static bool responses_sse_message_text_part_added(int fd, responses_stream *st) {
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.content_part.added\","
        "\"item_id\":\"%s\",\"output_index\":%d,\"content_index\":0,"
        "\"part\":{\"type\":\"output_text\",\"text\":\"\",\"annotations\":[]}}",
        st->message_id, st->message_index);
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

static bool responses_sse_output_text_delta(int fd, responses_stream *st,
                                            const char *text, size_t len) {
    if (len == 0) return true;
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.output_text.delta\","
        "\"item_id\":\"%s\",\"output_index\":%d,\"content_index\":0,\"delta\":",
        st->message_id, st->message_index);
    json_escape_n(&b, text, len);
    buf_putc(&b, '}');
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

static bool responses_sse_message_done(int fd, responses_stream *st,
                                       const char *finish) {
    const char *item_status = responses_item_status_for_finish(finish);
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.output_text.done\","
        "\"item_id\":\"%s\",\"output_index\":%d,\"content_index\":0,\"text\":",
        st->message_id, st->message_index);
    json_escape_n(&b, st->message_text.ptr ? st->message_text.ptr : "",
                  st->message_text.len);
    buf_putc(&b, '}');
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    if (!ok) {
        buf_free(&b);
        return false;
    }

    buf_free(&b);
    buf_printf(&b,
        "{\"type\":\"response.content_part.done\","
        "\"item_id\":\"%s\",\"output_index\":%d,\"content_index\":0,"
        "\"part\":{\"type\":\"output_text\",\"text\":",
        st->message_id, st->message_index);
    json_escape_n(&b, st->message_text.ptr ? st->message_text.ptr : "",
                  st->message_text.len);
    buf_puts(&b, ",\"annotations\":[]}}");
    ok = responses_sse_emit_event(fd, st, b.ptr);
    if (!ok) {
        buf_free(&b);
        return false;
    }

    buf_free(&b);
    buf_printf(&b,
        "{\"type\":\"response.output_item.done\",\"output_index\":%d,"
        "\"item\":{\"id\":\"%s\",\"type\":\"message\",\"status\":\"%s\","
        "\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":",
        st->message_index, st->message_id, item_status);
    json_escape_n(&b, st->message_text.ptr ? st->message_text.ptr : "",
                  st->message_text.len);
    buf_puts(&b, ",\"annotations\":[]}]}}");
    ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

/* Item identity per tool call must be stable across added/done/completed. */
typedef struct {
    char fc_id[40];
    char call_id[64];
    bool is_custom;
    int output_index;
} responses_tool_item;

static bool responses_tool_call_is_tool_search(const tool_call *tc,
                                               const tool_schema_order *order) {
    return tc && tc->name && !strcmp(tc->name, "tool_search") &&
           (!order || order->responses_tool_search);
}

/* The internal tool_call doesn't track whether it came from a function_call or
 * a custom_tool_call (or what tool kind is registered). For round-trip
 * correctness with the rare custom_tool_call clients, we preserve any provided
 * call_id verbatim and pre-assign a stable fc_id; the discriminator currently
 * defaults to function_call because Codex CLI registers all its tools as
 * function tools. */
static void responses_tool_items_build(responses_tool_item **out,
                                       const tool_calls *calls,
                                       int starting_output_index) {
    *out = NULL;
    if (!calls || calls->len == 0) return;
    responses_tool_item *items = xmalloc((size_t)calls->len * sizeof(*items));
    for (int i = 0; i < calls->len; i++) {
        memset(&items[i], 0, sizeof(items[i]));
        responses_random_id(items[i].fc_id, sizeof(items[i].fc_id), "fc_");
        if (calls->v[i].id && calls->v[i].id[0]) {
            snprintf(items[i].call_id, sizeof(items[i].call_id), "%s", calls->v[i].id);
        } else {
            responses_random_id(items[i].call_id, sizeof(items[i].call_id), "call_");
        }
        items[i].is_custom = false;
        items[i].output_index = starting_output_index + i;
    }
    *out = items;
}

static void responses_append_function_call_item(buf *b, const tool_call *tc,
                                                const responses_tool_item *item,
                                                const char *item_status,
                                                bool with_args,
                                                const tool_schema_orders *orders) {
    const tool_schema_order *order = tool_schema_orders_find(orders, tc->name);
    if (responses_tool_call_is_tool_search(tc, order)) {
        buf_printf(b,
            "{\"id\":\"%s\",\"type\":\"tool_search_call\",\"status\":\"%s\","
            "\"call_id\":\"%s\",\"execution\":\"client\",\"arguments\":",
            item->fc_id, item_status, item->call_id);
        if (with_args) append_json_object_or_empty(b, tc->arguments);
        else buf_puts(b, "{}");
        buf_putc(b, '}');
        return;
    }

    const char *item_type = item->is_custom ? "custom_tool_call" : "function_call";
    const char *body_field = item->is_custom ? "input" : "arguments";
    buf_printf(b,
        "{\"id\":\"%s\",\"type\":\"%s\",\"status\":\"%s\",\"name\":",
        item->fc_id, item_type, item_status);
    json_escape(b, order && order->wire_name ? order->wire_name :
                   (tc->name ? tc->name : ""));
    if (order && order->namespace) {
        buf_puts(b, ",\"namespace\":");
        json_escape(b, order->namespace);
    }
    buf_puts(b, ",\"call_id\":");
    json_escape(b, item->call_id);
    buf_printf(b, ",\"%s\":", body_field);
    if (!with_args) {
        buf_puts(b, "\"\"");
    } else if (item->is_custom) {
        json_escape(b, tc->arguments ? tc->arguments : "");
    } else {
        append_json_object_string(b, tc->arguments);
    }
    buf_putc(b, '}');
}

static bool responses_sse_function_call_event(int fd, responses_stream *st,
                                              const tool_call *tc,
                                              const responses_tool_item *item,
                                              const tool_schema_orders *orders,
                                              const char *finish,
                                              bool done) {
    /* The added event marks a tool call as in_progress per the Responses
     * lifecycle; only output_item.done (and the terminal response output)
     * carry the final completed / incomplete status. The added item ships with
     * an empty arguments string so clients that accumulate via
     * function_call_arguments.delta + .done don't end up with doubled JSON. */
    const char *item_status = done ? responses_item_status_for_finish(finish) : "in_progress";
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.output_item.%s\",\"output_index\":%d,\"item\":",
        done ? "done" : "added", item->output_index);
    responses_append_function_call_item(&b, tc, item, item_status, done, orders);
    buf_putc(&b, '}');
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

/* Stream function-call arguments as a single delta + done, since DS4 generates
 * the whole DSML invoke as one unit before the worker decides which tool was
 * called. Clients that follow the OpenAI Responses lifecycle expect both
 * events between output_item.added (in_progress) and output_item.done. */
static bool responses_sse_function_call_arguments_done(int fd, responses_stream *st,
                                                       const tool_call *tc,
                                                       const responses_tool_item *item,
                                                       const tool_schema_orders *orders) {
    const tool_schema_order *order = tool_schema_orders_find(orders, tc->name);
    if (item->is_custom || responses_tool_call_is_tool_search(tc, order)) return true;
    buf args = {0};
    append_json_object_string(&args, tc->arguments);
    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"response.function_call_arguments.delta\","
        "\"item_id\":\"%s\",\"output_index\":%d,\"delta\":",
        item->fc_id, item->output_index);
    buf_append(&b, args.ptr ? args.ptr : "\"\"", args.ptr ? args.len : 2);
    buf_putc(&b, '}');
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    if (!ok) {
        buf_free(&b);
        buf_free(&args);
        return false;
    }

    buf_free(&b);
    buf_printf(&b,
        "{\"type\":\"response.function_call_arguments.done\","
        "\"item_id\":\"%s\",\"output_index\":%d,\"name\":",
        item->fc_id, item->output_index);
    json_escape(&b, order && order->wire_name ? order->wire_name :
                    (tc->name ? tc->name : ""));
    if (order && order->namespace) {
        buf_puts(&b, ",\"namespace\":");
        json_escape(&b, order->namespace);
    }
    buf_puts(&b, ",\"arguments\":");
    buf_append(&b, args.ptr ? args.ptr : "\"\"", args.ptr ? args.len : 2);
    buf_putc(&b, '}');
    ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    buf_free(&args);
    return ok;
}

static const char *responses_status_for_finish(const char *finish) {
    if (finish && !strcmp(finish, "length")) return "incomplete";
    if (finish && !strcmp(finish, "error")) return "failed";
    return "completed";
}

static void append_responses_usage_json(buf *b, const request *r,
                                        int input_tokens, int output_tokens) {
    int cached_tokens = r ? r->cache_read_tokens : 0;
    int cache_write_tokens = r ? r->cache_write_tokens : 0;
    cached_tokens = clamp_usage_tokens(cached_tokens, input_tokens);
    cache_write_tokens = clamp_usage_tokens(cache_write_tokens, input_tokens - cached_tokens);
    buf_printf(b,
        "{\"input_tokens\":%d,\"input_tokens_details\":{\"cached_tokens\":%d,\"cache_write_tokens\":%d},"
        "\"output_tokens\":%d,\"output_tokens_details\":{\"reasoning_tokens\":0},"
        "\"total_tokens\":%d}",
        input_tokens, cached_tokens, cache_write_tokens,
        output_tokens, input_tokens + output_tokens);
}

static bool responses_sse_completed(int fd, const request *r,
                                    responses_stream *st,
                                    const tool_calls *calls,
                                    const responses_tool_item *tool_items,
                                    const char *finish,
                                    int prompt_tokens, int completion_tokens,
                                    long created_at) {
    /* Codex routes terminal behaviour off the event type, not response.status.
     * Decide here so clients see response.failed / response.incomplete instead
     * of a "completed" wrapper marked failed in a sub-field. */
    const char *event_type = "response.completed";
    if (finish && !strcmp(finish, "error")) event_type = "response.failed";
    else if (finish && !strcmp(finish, "length")) event_type = "response.incomplete";
    const char *status = responses_status_for_finish(finish);

    buf b = {0};
    buf_printf(&b,
        "{\"type\":\"%s\",\"response\":{\"id\":\"%s\","
        "\"object\":\"response\",\"created_at\":%ld,\"status\":\"%s\",\"model\":",
        event_type, st->response_id, created_at, status);
    json_escape(&b, r->model);
    if (!strcmp(event_type, "response.failed")) {
        buf_puts(&b, ",\"error\":{\"code\":\"server_error\","
                     "\"message\":\"generation failed\"}");
    } else if (!strcmp(event_type, "response.incomplete")) {
        buf_puts(&b, ",\"incomplete_details\":{\"reason\":\"max_tokens\"}");
    }
    const char *item_status = responses_item_status_for_finish(finish);
    buf_puts(&b, ",\"output\":[");
    bool wrote = false;
    if (st->reasoning_emitted_any) {
        /* Match responses_sse_reasoning_done: if the stream stopped before
         * </think>, the reasoning item is partial regardless of the
         * response-level finish status, so replay must reject it. */
        const char *reasoning_status =
            st->reasoning_closed_naturally ? "completed" : "incomplete";
        buf_printf(&b,
            "{\"id\":\"%s\",\"type\":\"reasoning\",\"status\":\"%s\",\"summary\":[",
            st->reasoning_id, reasoning_status);
        if (st->reasoning_text.len) {
            buf_puts(&b, "{\"type\":\"summary_text\",\"text\":");
            json_escape_n(&b, st->reasoning_text.ptr, st->reasoning_text.len);
            buf_putc(&b, '}');
        }
        buf_puts(&b, "]}");
        wrote = true;
    }
    if (st->message_emitted_any) {
        if (wrote) buf_putc(&b, ',');
        buf_printf(&b,
            "{\"id\":\"%s\",\"type\":\"message\",\"status\":\"%s\","
            "\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":",
            st->message_id, item_status);
        json_escape_n(&b, st->message_text.ptr ? st->message_text.ptr : "",
                      st->message_text.len);
        buf_puts(&b, ",\"annotations\":[]}]}");
        wrote = true;
    }
    if (calls && tool_items) {
        for (int i = 0; i < calls->len; i++) {
            if (wrote) buf_putc(&b, ',');
            responses_append_function_call_item(&b, &calls->v[i], &tool_items[i],
                                                item_status, true,
                                                &r->tool_orders);
            wrote = true;
        }
    }
    buf_putc(&b, ']');
    buf_puts(&b, ",\"usage\":");
    append_responses_usage_json(&b, r, prompt_tokens, completion_tokens);
    buf_puts(&b, "}}");
    bool ok = responses_sse_emit_event(fd, st, b.ptr);
    buf_free(&b);
    return ok;
}

/* Responses streaming consumes the same raw token text the OpenAI live stream
 * consumes: <think>...</think> is reasoning, anything before the tool-call
 * marker is output text. Tool-call argument deltas are not surfaced because
 * Codex' SSE parser only ingests function_call items via output_item.done. */
static bool responses_sse_stream_update(int fd, const request *r,
                                        responses_stream *st,
                                        const char *raw, size_t raw_len,
                                        bool final) {
    if (!st->active || !raw) return true;

    /* The client only sees reasoning if it explicitly opted in via
     * reasoning.summary. Otherwise we still need to walk past <think>...</think>
     * to find the user-visible text, but we suppress the per-chunk emission. */
    const bool emit_reasoning = r->reasoning_summary_emit;

    if (st->mode == RESP_STREAM_THINKING) {
        if (!st->checked_think_prefix) {
            /* The chat template ends the prompt with the literal `<think>` (or
             * `</think>` when thinking is off), so generation usually starts
             * mid-reasoning rather than with the open tag. If the model does
             * happen to repeat `<think>` we skip it; otherwise start from
             * position 0. The earlier "no-think-prefix => switch to TEXT"
             * shortcut here was incorrect: it leaked reasoning to clients as
             * regular output_text because the model was already inside the
             * think block when it produced its first token. The actual
             * mode change to TEXT happens only when `</think>` is observed. */
            const char *open = "<think>";
            const size_t open_len = strlen(open);
            if (raw_len < open_len && !strncmp(raw, open, raw_len) && !final) {
                return true;
            }
            if (raw_len >= open_len && !strncmp(raw, open, open_len)) {
                st->emit_pos = open_len;
            }
            st->checked_think_prefix = true;
        }

        const char *close = strstr(raw + st->emit_pos, "</think>");
        size_t limit;
        if (close) {
            limit = (size_t)(close - raw);
        } else if (final) {
            limit = raw_len;
        } else {
            const size_t hold = strlen("</think>") - 1;
            limit = raw_len > hold ? raw_len - hold : st->emit_pos;
            limit = utf8_stream_safe_len(raw, st->emit_pos, limit, false);
        }

        if (limit > st->emit_pos) {
            if (emit_reasoning) {
                if (!st->reasoning_item_opened) {
                    st->reasoning_index = st->next_output_index++;
                    if (!responses_sse_reasoning_added(fd, st)) return false;
                    st->reasoning_item_opened = true;
                }
                if (!st->reasoning_summary_started) {
                    if (!responses_sse_reasoning_summary_part_added(fd, st)) return false;
                    st->reasoning_summary_started = true;
                }
                if (!responses_sse_reasoning_delta(fd, st,
                                                   raw + st->emit_pos,
                                                   limit - st->emit_pos)) return false;
                buf_append(&st->reasoning_text, raw + st->emit_pos, limit - st->emit_pos);
                st->reasoning_emitted_any = true;
            }
            st->emit_pos = limit;
        }

        if (close) {
            st->emit_pos = (size_t)(close - raw) + strlen("</think>");
            st->mode = RESP_STREAM_TEXT;
            st->reasoning_closed_naturally = true;
        } else if (final) {
            st->mode = RESP_STREAM_SUPPRESS;
            return true;
        } else {
            return true;
        }
    }

    if (st->mode == RESP_STREAM_TEXT) {
        const char *tool = r->has_tools ? find_any_tool_start(raw + st->emit_pos) : NULL;
        size_t limit = text_stream_safe_limit(raw, st->emit_pos, raw_len,
                                              r->has_tools, final);

        if (limit > st->emit_pos) {
            if (!st->message_item_opened) {
                st->message_index = st->next_output_index++;
                if (!responses_sse_message_added(fd, st)) return false;
                st->message_item_opened = true;
            }
            if (!st->message_text_part_open) {
                if (!responses_sse_message_text_part_added(fd, st)) return false;
                st->message_text_part_open = true;
            }
            if (!responses_sse_output_text_delta(fd, st,
                                                 raw + st->emit_pos,
                                                 limit - st->emit_pos)) return false;
            buf_append(&st->message_text, raw + st->emit_pos, limit - st->emit_pos);
            st->message_emitted_any = true;
            st->emit_pos = limit;
        }

        if (tool) {
            st->emit_pos = (size_t)(tool - raw);
            st->mode = RESP_STREAM_SUPPRESS;
        } else if (final) {
            st->mode = RESP_STREAM_SUPPRESS;
        }
    }
    return true;
}

static bool responses_sse_finish_live(int fd, const request *r,
                                      responses_stream *st,
                                      const char *raw, size_t raw_len,
                                      const char *recovered_content,
                                      const tool_calls *calls,
                                      const char *finish,
                                      int prompt_tokens, int completion_tokens,
                                      long created_at) {
    if (!responses_sse_stream_update(fd, r, st, raw, raw_len, true)) return false;

    /* Close any half-open reasoning summary so the TUI knows the part ended
     * before we slot in any tool calls or completion. */
    if (st->reasoning_item_opened && !st->reasoning_item_closed) {
        if (!responses_sse_reasoning_done(fd, st, finish)) return false;
        st->reasoning_item_closed = true;
    }
    /* Recovery path: when DSML tool parsing fails the worker promotes the entire
     * generation to assistant text. Streaming had already entered suppress mode
     * at the tool marker, so anything in raw[st->emit_pos..raw_len] never made
     * it to the client. Emit those bytes as additional output_text deltas so
     * what the client accumulates matches output_item.done and the terminal
     * response. We use the stream cursor instead of comparing against
     * recovered_content because the raw text can begin with `<think>...</think>`
     * which the streaming side consumed as reasoning, not message text. */
    if (recovered_content && raw && st->emit_pos < raw_len) {
        const char *tail = raw + st->emit_pos;
        size_t tail_len = raw_len - st->emit_pos;
        if (!st->message_item_opened) {
            st->message_index = st->next_output_index++;
            if (!responses_sse_message_added(fd, st)) return false;
            st->message_item_opened = true;
        }
        if (!st->message_text_part_open) {
            if (!responses_sse_message_text_part_added(fd, st)) return false;
            st->message_text_part_open = true;
        }
        if (!responses_sse_output_text_delta(fd, st, tail, tail_len)) return false;
        buf_append(&st->message_text, tail, tail_len);
        st->message_emitted_any = true;
        st->emit_pos = raw_len;
    }
    if (st->message_item_opened && !st->message_item_closed) {
        if (!responses_sse_message_done(fd, st, finish)) return false;
        st->message_item_closed = true;
    }
    responses_tool_item *items = NULL;
    responses_tool_items_build(&items, calls, st->next_output_index);
    if (items && calls) st->next_output_index += calls->len;
    bool ok = true;
    if (items && calls) {
        for (int i = 0; i < calls->len && ok; i++) {
            ok = responses_sse_function_call_event(fd, st, &calls->v[i], &items[i],
                                                   &r->tool_orders, finish, false);
            if (ok) ok = responses_sse_function_call_arguments_done(fd, st, &calls->v[i],
                                                                    &items[i],
                                                                    &r->tool_orders);
            if (ok) ok = responses_sse_function_call_event(fd, st, &calls->v[i], &items[i],
                                                           &r->tool_orders, finish, true);
        }
    }
    if (ok) ok = responses_sse_completed(fd, r, st, calls, items, finish,
                                         prompt_tokens, completion_tokens, created_at);
    free(items);
    return ok;
}

static bool responses_final_response(int fd, bool enable_cors,
                                     const request *r, const char *id,
                                     const char *text, const char *reasoning,
                                     const tool_calls *calls, const char *finish,
                                     int prompt_tokens, int completion_tokens) {
    (void)id;
    char response_id[40], reasoning_id[40], message_id[40];
    responses_random_id(response_id, sizeof(response_id), "resp_");
    responses_random_id(reasoning_id, sizeof(reasoning_id), "rs_");
    responses_random_id(message_id, sizeof(message_id), "msg_");

    responses_tool_item *items = NULL;
    responses_tool_items_build(&items, calls, 0);

    long now = (long)time(NULL);
    const char *status = responses_status_for_finish(finish);
    const char *item_status = responses_item_status_for_finish(finish);
    buf b = {0};
    buf_printf(&b,
        "{\"id\":\"%s\",\"object\":\"response\",\"created_at\":%ld,\"status\":\"%s\","
        "\"model\":",
        response_id, now, status);
    json_escape(&b, r->model);
    if (finish && !strcmp(finish, "error")) {
        buf_puts(&b, ",\"error\":{\"code\":\"server_error\","
                     "\"message\":\"generation failed\"}");
    } else if (finish && !strcmp(finish, "length")) {
        buf_puts(&b, ",\"incomplete_details\":{\"reason\":\"max_tokens\"}");
    }
    buf_puts(&b, ",\"output\":[");
    bool wrote = false;
    if (reasoning && reasoning[0] && r->reasoning_summary_emit) {
        /* Non-streaming path runs after the worker has post-processed the
         * generation, so any reasoning here came from a parsed assistant turn
         * where </think> was observed (otherwise the reasoning text would be
         * empty). Tag it with the response-level item_status which still flips
         * to incomplete/failed when finish is length/error. */
        buf_printf(&b,
            "{\"id\":\"%s\",\"type\":\"reasoning\",\"status\":\"%s\","
            "\"summary\":[{\"type\":\"summary_text\",\"text\":",
            reasoning_id, item_status);
        json_escape(&b, reasoning);
        buf_puts(&b, "}]}");
        wrote = true;
    }
    if (text && text[0]) {
        if (wrote) buf_putc(&b, ',');
        buf_printf(&b,
            "{\"id\":\"%s\",\"type\":\"message\",\"status\":\"%s\","
            "\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":",
            message_id, item_status);
        json_escape(&b, text);
        buf_puts(&b, ",\"annotations\":[]}]}");
        wrote = true;
    }
    if (calls && items) {
        for (int i = 0; i < calls->len; i++) {
            if (wrote) buf_putc(&b, ',');
            responses_append_function_call_item(&b, &calls->v[i], &items[i],
                                                item_status, true,
                                                &r->tool_orders);
            wrote = true;
        }
    }
    buf_putc(&b, ']');
    buf_puts(&b, ",\"usage\":");
    append_responses_usage_json(&b, r, prompt_tokens, completion_tokens);
    buf_putc(&b, '}');
    bool ok = http_response(fd, enable_cors, 200, "application/json", b.ptr);
    buf_free(&b);
    free(items);
    return ok;
}

static bool final_response(int fd, bool enable_cors,
                           const request *r, const char *id, const char *text,
                           const char *reasoning, const tool_calls *calls, const char *finish,
                           int prompt_tokens, int completion_tokens) {
    buf b = {0};
    long now = (long)time(NULL);
    if (r->kind == REQ_CHAT) {
        buf_printf(&b, "{\"id\":\"%s\",\"object\":\"chat.completion\",\"created\":%ld,\"model\":", id, now);
        json_escape(&b, r->model);
        buf_puts(&b, ",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":");
        json_escape(&b, text ? text : "");
        if (reasoning && reasoning[0]) {
            buf_puts(&b, ",\"reasoning_content\":");
            json_escape(&b, reasoning);
        }
        if (calls && calls->len) {
            buf_puts(&b, ",\"tool_calls\":");
            append_tool_calls_json(&b, calls, id, &r->tool_orders);
        }
        buf_puts(&b, "},\"finish_reason\":");
        json_escape(&b, finish);
        buf_puts(&b, "}],\"usage\":");
    } else {
        buf_printf(&b, "{\"id\":\"%s\",\"object\":\"text_completion\",\"created\":%ld,\"model\":", id, now);
        json_escape(&b, r->model);
        buf_puts(&b, ",\"choices\":[{\"text\":");
        json_escape(&b, text);
        buf_puts(&b, ",\"index\":0,\"finish_reason\":");
        json_escape(&b, finish);
        buf_puts(&b, "}],\"usage\":");
    }
    append_openai_usage_json(&b, r, prompt_tokens, completion_tokens);
    buf_puts(&b, "}\n");
    bool ok = http_response(fd, enable_cors, 200, "application/json", b.ptr);
    buf_free(&b);
    return ok;
}

static const char *anthropic_stop_reason(const char *finish) {
    if (finish && !strcmp(finish, "tool_calls")) return "tool_use";
    if (finish && !strcmp(finish, "length")) return "max_tokens";
    return "end_turn";
}

static void append_anthropic_tool_use(buf *b, const tool_call *tc, const char *id_prefix, int i,
                                      const tool_schema_orders *orders) {
    (void)orders;
    char idbuf[128];
    snprintf(idbuf, sizeof(idbuf), "toolu_%s_%d", id_prefix, i);
    buf_puts(b, "{\"type\":\"tool_use\",\"id\":");
    json_escape(b, tc->id && tc->id[0] ? tc->id : idbuf);
    buf_puts(b, ",\"name\":");
    json_escape(b, tc->name ? tc->name : "");
    buf_puts(b, ",\"input\":");
    append_json_object_or_empty(b, tc->arguments);
    buf_putc(b, '}');
}

static void append_anthropic_thinking(buf *b, const char *reasoning, const char *signature) {
    buf_puts(b, "{\"type\":\"thinking\",\"thinking\":");
    json_escape(b, reasoning ? reasoning : "");
    buf_puts(b, ",\"signature\":");
    json_escape(b, signature ? signature : "");
    buf_putc(b, '}');
}

static void append_anthropic_content(buf *b, const char *text, const char *reasoning,
                                     const tool_calls *calls, const char *id_prefix,
                                     const tool_schema_orders *orders) {
    buf_putc(b, '[');
    bool wrote = false;
    bool wrote_after_thinking = false;
    if (reasoning && reasoning[0]) {
        append_anthropic_thinking(b, reasoning, id_prefix);
        wrote = true;
    }
    if (text && text[0]) {
        if (wrote) buf_putc(b, ',');
        buf_puts(b, "{\"type\":\"text\",\"text\":");
        json_escape(b, text);
        buf_putc(b, '}');
        wrote = true;
        wrote_after_thinking = true;
    }
    if (calls) {
        for (int i = 0; i < calls->len; i++) {
            if (wrote) buf_putc(b, ',');
            append_anthropic_tool_use(b, &calls->v[i], id_prefix, i, orders);
            wrote = true;
            wrote_after_thinking = true;
        }
    }
    if (!wrote || ((reasoning && reasoning[0]) && !wrote_after_thinking)) {
        if (wrote) buf_putc(b, ',');
        buf_puts(b, "{\"type\":\"text\",\"text\":\"\"}");
    }
    buf_putc(b, ']');
}

static void append_anthropic_usage_json(buf *b, const request *r,
                                        int prompt_tokens, int completion_tokens) {
    int cache_read_tokens = r ? r->cache_read_tokens : 0;
    int cache_write_tokens = r ? r->cache_write_tokens : 0;
    cache_read_tokens = clamp_usage_tokens(cache_read_tokens, prompt_tokens);
    cache_write_tokens = clamp_usage_tokens(cache_write_tokens, prompt_tokens - cache_read_tokens);
    int input_tokens = prompt_tokens - cache_read_tokens - cache_write_tokens;
    if (input_tokens < 0) input_tokens = 0;
    buf_printf(b,
               "{\"input_tokens\":%d,\"output_tokens\":%d,"
               "\"cache_read_input_tokens\":%d,\"cache_creation_input_tokens\":%d}",
               input_tokens, completion_tokens, cache_read_tokens, cache_write_tokens);
}

static bool anthropic_final_response(int fd, bool enable_cors,
                                     const request *r, const char *id, const char *text,
                                     const char *reasoning, const tool_calls *calls, const char *finish,
                                     int prompt_tokens, int completion_tokens) {
    buf b = {0};
    buf_printf(&b, "{\"id\":\"%s\",\"type\":\"message\",\"role\":\"assistant\",\"model\":", id);
    json_escape(&b, r->model);
    buf_puts(&b, ",\"content\":");
    append_anthropic_content(&b, text, reasoning, calls, id, &r->tool_orders);
    buf_puts(&b, ",\"stop_reason\":");
    json_escape(&b, anthropic_stop_reason(finish));
    buf_puts(&b, ",\"stop_sequence\":null,\"usage\":");
    append_anthropic_usage_json(&b, r, prompt_tokens, completion_tokens);
    buf_puts(&b, "}\n");
    bool ok = http_response(fd, enable_cors, 200, "application/json", b.ptr);
    buf_free(&b);
    return ok;
}

static bool sse_event(int fd, const char *event, const char *data) {
    buf b = {0};
    buf_puts(&b, "event: ");
    buf_puts(&b, event);
    buf_puts(&b, "\ndata: ");
    buf_puts(&b, data);
    buf_puts(&b, "\n\n");
    bool ok = send_all(fd, b.ptr, b.len);
    buf_free(&b);
    return ok;
}

typedef enum {
    ANTH_STREAM_THINKING,
    ANTH_STREAM_TEXT,
    ANTH_STREAM_TOOL,
    ANTH_STREAM_SUPPRESS,
} anthropic_stream_mode;

typedef enum {
    ANTH_BLOCK_NONE,
    ANTH_BLOCK_THINKING,
    ANTH_BLOCK_TEXT,
    ANTH_BLOCK_TOOL,
} anthropic_block_type;

typedef struct {
    dsml_tool_stream_state state;
    const dsml_syntax *syn;
    size_t parse_pos;
    int index;
    bool active;
    bool emitted_any;
    bool args_open;
    bool first_param;
    bool param_is_string;
    char **ids;
    int ids_cap;
} anthropic_tool_stream;

/* Anthropic streaming uses the same sampled DSML bytes that will later be
 * parsed and remembered for exact continuation.  This state is only a wire
 * projection: it turns an in-progress DSML block into content_block/tool_use
 * SSE events, and never rewrites the model-visible transcript or cache key. */
typedef struct {
    anthropic_stream_mode mode;
    anthropic_block_type open_block;
    int next_index;
    size_t emit_pos;
    bool active;
    bool checked_think_prefix;
    bool sent_thinking;
    bool sent_text;
    anthropic_tool_stream tool;
} anthropic_stream;

static bool anthropic_sse_start_live(int fd, const request *r, const char *id,
                                     int prompt_tokens, anthropic_stream *st) {
    buf b = {0};
    json_escape(&b, r->model);
    char *model_json = buf_take(&b);

    buf_printf(&b,
        "{\"type\":\"message_start\",\"message\":{\"id\":\"%s\",\"type\":\"message\","
        "\"role\":\"assistant\",\"model\":%s,\"content\":[],\"stop_reason\":null,"
        "\"stop_sequence\":null,\"usage\":",
        id, model_json);
    append_anthropic_usage_json(&b, r, prompt_tokens, 0);
    buf_puts(&b, "}}");
    bool ok = sse_event(fd, "message_start", b.ptr);
    buf_free(&b);
    free(model_json);

    memset(st, 0, sizeof(*st));
    st->active = ok;
    st->mode = ds4_think_mode_enabled(r->think_mode) ? ANTH_STREAM_THINKING : ANTH_STREAM_TEXT;
    return ok;
}

static void anthropic_tool_stream_free(anthropic_tool_stream *ts) {
    if (!ts) return;
    for (int i = 0; i < ts->ids_cap; i++) free(ts->ids[i]);
    free(ts->ids);
    ts->ids = NULL;
    ts->ids_cap = 0;
}

static void anthropic_stream_free(anthropic_stream *st) {
    if (!st) return;
    anthropic_tool_stream_free(&st->tool);
}

static bool anthropic_tool_stream_has_id(const anthropic_tool_stream *ts,
                                         const char *id, int upto) {
    if (!ts || !id || !id[0]) return false;
    if (upto > ts->ids_cap) upto = ts->ids_cap;
    for (int i = 0; i < upto; i++) {
        if (ts->ids[i] && !strcmp(ts->ids[i], id)) return true;
    }
    return false;
}

static const char *anthropic_tool_stream_id(server *s, anthropic_tool_stream *ts,
                                            int index) {
    if (!ts || index < 0) return "";
    if (index >= ts->ids_cap) {
        int old = ts->ids_cap;
        int cap = old ? old : 4;
        while (cap <= index) cap *= 2;
        ts->ids = xrealloc(ts->ids, (size_t)cap * sizeof(ts->ids[0]));
        memset(ts->ids + old, 0, (size_t)(cap - old) * sizeof(ts->ids[0]));
        ts->ids_cap = cap;
    }
    if (!ts->ids[index]) {
        char id[64];
        for (;;) {
            random_tool_id(id, sizeof(id), API_ANTHROPIC);
            if (!anthropic_tool_stream_has_id(ts, id, index) &&
                !tool_memory_has_id(s, id)) break;
        }
        ts->ids[index] = xstrdup(id);
    }
    return ts->ids[index];
}

/* Text and thinking blocks have fixed JSON shapes.  Tool blocks are opened by
 * name later, after the DSML invoke tag is complete, so they use a dedicated
 * opener instead of this helper. */
static bool anthropic_sse_open_block(int fd, anthropic_stream *st,
                                     anthropic_block_type type) {
    if (st->open_block == type) return true;
    if (st->open_block != ANTH_BLOCK_NONE) return false;

    buf b = {0};
    if (type == ANTH_BLOCK_THINKING) {
        buf_printf(&b,
                   "{\"type\":\"content_block_start\",\"index\":%d,"
                   "\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\","
                   "\"signature\":\"\"}}",
                   st->next_index);
    } else {
        buf_printf(&b,
                   "{\"type\":\"content_block_start\",\"index\":%d,"
                   "\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
                   st->next_index);
    }
    bool ok = sse_event(fd, "content_block_start", b.ptr);
    buf_free(&b);
    if (ok) st->open_block = type;
    return ok;
}

static bool anthropic_sse_open_tool_block(int fd, anthropic_stream *st,
                                          const char *tool_id,
                                          const char *name) {
    if (st->open_block == ANTH_BLOCK_TOOL) return true;
    if (st->open_block != ANTH_BLOCK_NONE) return false;

    buf b = {0};
    buf_printf(&b,
               "{\"type\":\"content_block_start\",\"index\":%d,"
               "\"content_block\":{\"type\":\"tool_use\",\"id\":",
               st->next_index);
    json_escape(&b, tool_id ? tool_id : "");
    buf_puts(&b, ",\"name\":");
    json_escape(&b, name ? name : "");
    buf_puts(&b, ",\"input\":{}}}");
    bool ok = sse_event(fd, "content_block_start", b.ptr);
    buf_free(&b);
    if (ok) st->open_block = ANTH_BLOCK_TOOL;
    return ok;
}

static bool anthropic_sse_delta_live(int fd, const anthropic_stream *st,
                                     anthropic_block_type type,
                                     const char *text, size_t len) {
    if (len == 0) return true;
    buf b = {0};
    if (type == ANTH_BLOCK_THINKING) {
        buf_printf(&b,
                   "{\"type\":\"content_block_delta\",\"index\":%d,"
                   "\"delta\":{\"type\":\"thinking_delta\",\"thinking\":",
                   st->next_index);
        json_escape_n(&b, text, len);
        buf_puts(&b, "}}");
    } else {
        buf_printf(&b,
                   "{\"type\":\"content_block_delta\",\"index\":%d,"
                   "\"delta\":{\"type\":\"text_delta\",\"text\":",
                   st->next_index);
        json_escape_n(&b, text, len);
        buf_puts(&b, "}}");
    }
    bool ok = sse_event(fd, "content_block_delta", b.ptr);
    buf_free(&b);
    return ok;
}

/* Anthropic's input_json_delta carries a fragment of a JSON object, encoded as
 * a JSON string.  We stream exactly the same object that the final DSML parser
 * will build: an opening "{", quoted keys, raw JSON values or escaped string
 * contents, and the closing "}". */
static bool anthropic_sse_tool_delta_live(int fd, const anthropic_stream *st,
                                          const char *text, size_t len) {
    if (len == 0) return true;
    buf b = {0};
    buf_printf(&b,
               "{\"type\":\"content_block_delta\",\"index\":%d,"
               "\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":",
               st->next_index);
    json_escape_n(&b, text, len);
    buf_puts(&b, "}}");
    bool ok = sse_event(fd, "content_block_delta", b.ptr);
    buf_free(&b);
    return ok;
}

static bool anthropic_sse_close_block_live(int fd, const char *id,
                                           anthropic_stream *st) {
    if (st->open_block == ANTH_BLOCK_NONE) return true;

    buf b = {0};
    bool ok = true;
    if (st->open_block == ANTH_BLOCK_THINKING) {
        buf_printf(&b,
                   "{\"type\":\"content_block_delta\",\"index\":%d,"
                   "\"delta\":{\"type\":\"signature_delta\",\"signature\":",
                   st->next_index);
        json_escape(&b, id);
        buf_puts(&b, "}}");
        ok = sse_event(fd, "content_block_delta", b.ptr);
        buf_free(&b);
    }
    if (ok) {
        buf_printf(&b, "{\"type\":\"content_block_stop\",\"index\":%d}",
                   st->next_index);
        ok = sse_event(fd, "content_block_stop", b.ptr);
        buf_free(&b);
    }
    if (ok) {
        st->open_block = ANTH_BLOCK_NONE;
        st->next_index++;
    }
    return ok;
}

static bool anthropic_tool_emit_args_fragment(int fd, anthropic_stream *st,
                                              const char *text, size_t len) {
    return anthropic_sse_tool_delta_live(fd, st, text, len);
}

static bool anthropic_tool_emit_string_value(int fd, anthropic_stream *st,
                                             const char *text, size_t len) {
    if (len == 0) return true;
    char *raw = xstrndup(text, len);
    char *unescaped = dsml_unescape_text(raw);
    buf frag = {0};
    json_escape_fragment_n(&frag, unescaped, strlen(unescaped));
    bool ok = anthropic_tool_emit_args_fragment(fd, st,
                                                frag.ptr ? frag.ptr : "",
                                                frag.len);
    buf_free(&frag);
    free(unescaped);
    free(raw);
    return ok;
}

static bool anthropic_tool_emit_param_prefix(int fd, anthropic_stream *st,
                                             const char *name, bool is_string) {
    anthropic_tool_stream *ts = &st->tool;
    buf frag = {0};
    if (ts->first_param) ts->first_param = false;
    else buf_putc(&frag, ',');
    json_escape(&frag, name ? name : "");
    buf_putc(&frag, ':');
    if (is_string) buf_putc(&frag, '"');
    bool ok = anthropic_tool_emit_args_fragment(fd, st,
                                                frag.ptr ? frag.ptr : "",
                                                frag.len);
    buf_free(&frag);
    return ok;
}

/* The parser below mirrors the OpenAI tool-delta parser but keeps Anthropic's
 * content-block lifecycle local.  A callback abstraction would save lines, but
 * it would hide the different block/stop semantics that make this code easy to
 * audit when a client reports a streaming regression. */
static bool anthropic_tool_stream_init(anthropic_tool_stream *ts,
                                       const char *raw, size_t raw_len,
                                       size_t pos) {
    anthropic_tool_stream_free(ts);
    memset(ts, 0, sizeof(*ts));
    ts->active = true;
    ts->state = DSML_TOOL_BETWEEN_INVOKES;
    for (size_t i = 0; i < sizeof(dsml_syntaxes) / sizeof(dsml_syntaxes[0]); i++) {
        const dsml_syntax *syn = &dsml_syntaxes[i];
        if (raw_full_lit(raw, raw_len, pos, syn->tool_calls_start)) {
            ts->syn = syn;
            ts->parse_pos = pos + strlen(syn->tool_calls_start);
            return true;
        }
    }
    ts->active = false;
    ts->state = DSML_TOOL_ERROR;
    return false;
}

static bool anthropic_tool_stream_fail(anthropic_tool_stream *ts) {
    ts->active = false;
    ts->state = DSML_TOOL_ERROR;
    return true;
}

static bool anthropic_tool_start_invoke(int fd, server *s, anthropic_stream *st,
                                        const char *raw, size_t raw_len) {
    anthropic_tool_stream *ts = &st->tool;
    const char *tag_end = memchr(raw + ts->parse_pos, '>', raw_len - ts->parse_pos);
    if (!tag_end) return true;
    char *tag = xstrndup(raw + ts->parse_pos,
                         (size_t)(tag_end - (raw + ts->parse_pos) + 1));
    char *name = dsml_attr(tag, "name");
    free(tag);
    if (!name) return anthropic_tool_stream_fail(ts);

    /* This id is already visible to the client.  After final parsing,
     * apply_anthropic_stream_tool_ids() copies it into the parsed tool_call
     * before tool_memory_remember(), so the next tool_result can continue from
     * the live KV state instead of re-rendering canonical JSON. */
    const char *tool_id = anthropic_tool_stream_id(s, ts, ts->index);
    bool ok = anthropic_sse_open_tool_block(fd, st, tool_id, name) &&
              anthropic_tool_emit_args_fragment(fd, st, "{", 1);
    free(name);
    if (!ok) return false;

    ts->emitted_any = true;
    ts->args_open = true;
    ts->first_param = true;
    ts->parse_pos = (size_t)(tag_end - raw) + 1;
    ts->state = DSML_TOOL_BETWEEN_PARAMS;
    return true;
}

static bool anthropic_tool_start_param(int fd, anthropic_stream *st,
                                       const char *raw, size_t raw_len) {
    anthropic_tool_stream *ts = &st->tool;
    const char *tag_end = memchr(raw + ts->parse_pos, '>', raw_len - ts->parse_pos);
    if (!tag_end) return true;
    char *tag = xstrndup(raw + ts->parse_pos,
                         (size_t)(tag_end - (raw + ts->parse_pos) + 1));
    char *name = dsml_attr(tag, "name");
    char *is_string = dsml_attr(tag, "string");
    free(tag);
    if (!name || !is_string) {
        free(name);
        free(is_string);
        return anthropic_tool_stream_fail(ts);
    }
    bool string_value = !strcmp(is_string, "true");
    bool ok = anthropic_tool_emit_param_prefix(fd, st, name, string_value);
    free(name);
    free(is_string);
    if (!ok) return false;

    ts->param_is_string = string_value;
    ts->parse_pos = (size_t)(tag_end - raw) + 1;
    ts->state = DSML_TOOL_PARAM_VALUE;
    return true;
}

static bool anthropic_tool_finish_param(int fd, anthropic_stream *st,
                                        const char *raw, size_t value_end) {
    anthropic_tool_stream *ts = &st->tool;
    if (value_end > ts->parse_pos) {
        bool ok = ts->param_is_string ?
            anthropic_tool_emit_string_value(fd, st, raw + ts->parse_pos,
                                             value_end - ts->parse_pos) :
            anthropic_tool_emit_args_fragment(fd, st, raw + ts->parse_pos,
                                              value_end - ts->parse_pos);
        if (!ok) return false;
    }
    if (ts->param_is_string &&
        !anthropic_tool_emit_args_fragment(fd, st, "\"", 1)) return false;
    ts->parse_pos = value_end + strlen(ts->syn->param_end);
    ts->state = DSML_TOOL_BETWEEN_PARAMS;
    return true;
}

static bool anthropic_tool_stream_update(int fd, server *s, const char *id,
                                         anthropic_stream *st,
                                         const char *raw, size_t raw_len) {
    anthropic_tool_stream *ts = &st->tool;
    while (ts->active && ts->parse_pos < raw_len) {
        if (ts->state == DSML_TOOL_BETWEEN_INVOKES) {
            while (ts->parse_pos < raw_len && isspace((unsigned char)raw[ts->parse_pos])) ts->parse_pos++;
            if (ts->parse_pos >= raw_len) return true;
            if (raw_full_lit(raw, raw_len, ts->parse_pos, ts->syn->tool_calls_end)) {
                ts->parse_pos += strlen(ts->syn->tool_calls_end);
                ts->active = false;
                ts->state = DSML_TOOL_DONE;
                return true;
            }
            if (raw_partial_any(raw, raw_len, ts->parse_pos,
                                ts->syn->tool_calls_end, ts->syn->invoke_start)) return true;
            if (raw_full_lit(raw, raw_len, ts->parse_pos, ts->syn->invoke_start)) {
                size_t before_pos = ts->parse_pos;
                dsml_tool_stream_state before_state = ts->state;
                if (!anthropic_tool_start_invoke(fd, s, st, raw, raw_len)) return false;
                if (ts->parse_pos == before_pos && ts->state == before_state) return true;
                continue;
            }
            return anthropic_tool_stream_fail(ts);
        }

        if (ts->state == DSML_TOOL_BETWEEN_PARAMS) {
            while (ts->parse_pos < raw_len && isspace((unsigned char)raw[ts->parse_pos])) ts->parse_pos++;
            if (ts->parse_pos >= raw_len) return true;
            if (raw_full_lit(raw, raw_len, ts->parse_pos, ts->syn->invoke_end)) {
                if (ts->args_open &&
                    !anthropic_tool_emit_args_fragment(fd, st, "}", 1)) return false;
                ts->args_open = false;
                if (!anthropic_sse_close_block_live(fd, id, st)) return false;
                ts->parse_pos += strlen(ts->syn->invoke_end);
                ts->index++;
                ts->state = DSML_TOOL_BETWEEN_INVOKES;
                continue;
            }
            if (raw_partial_any(raw, raw_len, ts->parse_pos,
                                ts->syn->invoke_end, ts->syn->param_start)) return true;
            if (raw_full_lit(raw, raw_len, ts->parse_pos, ts->syn->param_start)) {
                size_t before_pos = ts->parse_pos;
                dsml_tool_stream_state before_state = ts->state;
                if (!anthropic_tool_start_param(fd, st, raw, raw_len)) return false;
                if (ts->parse_pos == before_pos && ts->state == before_state) return true;
                continue;
            }
            return anthropic_tool_stream_fail(ts);
        }

        if (ts->state == DSML_TOOL_PARAM_VALUE) {
            const char *end = find_lit_bounded(raw + ts->parse_pos,
                                               raw_len - ts->parse_pos,
                                               ts->syn->param_end);
            if (end) {
                if (!anthropic_tool_finish_param(fd, st, raw,
                                                 (size_t)(end - raw))) return false;
                continue;
            }
            size_t limit = tool_param_value_stream_safe_len(raw, ts->parse_pos,
                                                            raw_len,
                                                            ts->syn->param_end,
                                                            ts->param_is_string);
            if (limit > ts->parse_pos) {
                bool ok = ts->param_is_string ?
                    anthropic_tool_emit_string_value(fd, st, raw + ts->parse_pos,
                                                     limit - ts->parse_pos) :
                    anthropic_tool_emit_args_fragment(fd, st, raw + ts->parse_pos,
                                                      limit - ts->parse_pos);
                if (!ok) return false;
                ts->parse_pos = limit;
            }
            return true;
        }

        return true;
    }
    return true;
}

static size_t text_stream_safe_limit(const char *raw, size_t start,
                                     size_t raw_len, bool has_tools,
                                     bool final) {
    if (raw_len <= start) return raw_len;

    size_t limit = raw_len;
    if (has_tools) {
        const char *tool = find_any_tool_start(raw + start);
        if (tool) {
            limit = trim_tool_separator_ws(raw, start, (size_t)(tool - raw));
            return utf8_stream_safe_len(raw, start, limit, true);
        }

        if (!final) {
            /* Tool calls are hidden from the API client and returned as
             * structured tool_use/tool_calls blocks.  The whitespace just
             * before the DSML marker is syntax too: if we stream it as
             * assistant text, the next client request sends it back and our
             * renderer adds the canonical "\n\n" separator again.  Hold
             * trailing whitespace until a following non-whitespace byte proves
             * it is ordinary text, or until a tool marker proves it should be
             * dropped. */
            while (limit > start && isspace((unsigned char)raw[limit - 1])) limit--;

            /* Also hold a partial '<...tool_calls...' marker that may be split
             * across generated tokens. */
            const size_t max_marker = 80;
            size_t scan = raw_len - start > max_marker ? raw_len - max_marker : start;
            for (size_t i = raw_len; i > scan; i--) {
                if (raw[i - 1] == '<') {
                    size_t marker = i - 1;
                    if (marker < limit) limit = marker;
                    break;
                }
            }
            limit = trim_tool_separator_ws(raw, start, limit);
        }
    }
    return utf8_stream_safe_len(raw, start, limit, final);
}

static bool anthropic_sse_stream_update(int fd, server *s, const request *r, const char *id,
                                        anthropic_stream *st,
                                        const char *raw, size_t raw_len,
                                        bool final) {
    if (!st->active || !raw) return true;

    if (st->mode == ANTH_STREAM_THINKING) {
        if (!st->checked_think_prefix) {
            const char *open = "<think>";
            const size_t open_len = strlen(open);
            if (raw_len < open_len && !strncmp(raw, open, raw_len) && !final) {
                return true;
            }
            if (raw_len >= open_len && !strncmp(raw, open, open_len)) {
                st->emit_pos = open_len;
            }
            st->checked_think_prefix = true;
        }

        const char *close = strstr(raw + st->emit_pos, "</think>");
        size_t limit;
        if (close) {
            limit = (size_t)(close - raw);
        } else if (final) {
            limit = raw_len;
        } else {
            const size_t hold = strlen("</think>") - 1;
            limit = raw_len > hold ? raw_len - hold : st->emit_pos;
            limit = utf8_stream_safe_len(raw, st->emit_pos, limit, false);
        }

        if (limit > st->emit_pos) {
            if (!anthropic_sse_open_block(fd, st, ANTH_BLOCK_THINKING)) return false;
            if (!anthropic_sse_delta_live(fd, st, ANTH_BLOCK_THINKING,
                                          raw + st->emit_pos,
                                          limit - st->emit_pos)) return false;
            st->sent_thinking = true;
            st->emit_pos = limit;
        }

        if (close || final) {
            if (!anthropic_sse_close_block_live(fd, id, st)) return false;
            if (close) {
                st->emit_pos = (size_t)(close - raw) + strlen("</think>");
                st->mode = ANTH_STREAM_TEXT;
            } else {
                st->mode = ANTH_STREAM_SUPPRESS;
                return true;
            }
        } else {
            return true;
        }
    }

    if (st->mode == ANTH_STREAM_TEXT) {
        const char *tool = r->has_tools ? find_any_tool_start(raw + st->emit_pos) : NULL;
        size_t limit = text_stream_safe_limit(raw, st->emit_pos, raw_len,
                                              r->has_tools, final);

        if (limit > st->emit_pos) {
            if (!anthropic_sse_open_block(fd, st, ANTH_BLOCK_TEXT)) return false;
            if (!anthropic_sse_delta_live(fd, st, ANTH_BLOCK_TEXT,
                                          raw + st->emit_pos,
                                          limit - st->emit_pos)) return false;
            st->sent_text = true;
            st->emit_pos = limit;
        }

        if (tool) {
            if (!anthropic_sse_close_block_live(fd, id, st)) return false;
            st->emit_pos = (size_t)(tool - raw);
            /* On normal token-by-token updates, switch from hidden text to a
             * live tool_use projection as soon as the DSML block starts.  On
             * final catch-up from plain text, leave the block for the existing
             * final emitter so old non-incremental behavior stays unchanged. */
            if (!final &&
                anthropic_tool_stream_init(&st->tool, raw, raw_len, st->emit_pos)) {
                st->mode = ANTH_STREAM_TOOL;
            } else {
                st->mode = ANTH_STREAM_SUPPRESS;
            }
        } else if (final) {
            if (!anthropic_sse_close_block_live(fd, id, st)) return false;
            st->mode = ANTH_STREAM_SUPPRESS;
        }
    }

    if (st->mode == ANTH_STREAM_TOOL) {
        if (!anthropic_tool_stream_update(fd, s, id, st, raw, raw_len)) return false;
        if (!st->tool.active) st->mode = ANTH_STREAM_SUPPRESS;
    }
    return true;
}

static bool anthropic_sse_tool_blocks_live(int fd, const request *r, const char *id,
                                           anthropic_stream *st,
                                           const tool_calls *calls) {
    (void)r;
    if (!calls) return true;

    buf b = {0};
    /* Tool calls completed by anthropic_tool_stream_update() have already
     * produced start/delta/stop events.  Only emit the tail calls that were not
     * seen by the live projection, for example if the first DSML bytes only
     * become available during final flush. */
    int already_streamed = st->tool.emitted_any ? st->tool.index : 0;
    if (already_streamed > calls->len) already_streamed = calls->len;
    for (int i = already_streamed; i < calls->len; i++, st->next_index++) {
        const tool_call *tc = &calls->v[i];
        char idbuf[128];
        snprintf(idbuf, sizeof(idbuf), "toolu_%s_%d", id, i);
        buf_printf(&b,
                   "{\"type\":\"content_block_start\",\"index\":%d,"
                   "\"content_block\":{\"type\":\"tool_use\",\"id\":",
                   st->next_index);
        json_escape(&b, tc->id && tc->id[0] ? tc->id : idbuf);
        buf_puts(&b, ",\"name\":");
        json_escape(&b, tc->name ? tc->name : "");
        buf_puts(&b, ",\"input\":{}}}");
        bool ok = sse_event(fd, "content_block_start", b.ptr);
        buf_free(&b);
        if (!ok) return false;

        buf_printf(&b,
                   "{\"type\":\"content_block_delta\",\"index\":%d,"
                   "\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":",
                   st->next_index);
        append_json_object_string(&b, tc->arguments);
        buf_puts(&b, "}}");
        ok = sse_event(fd, "content_block_delta", b.ptr);
        buf_free(&b);
        if (!ok) return false;

        buf_printf(&b, "{\"type\":\"content_block_stop\",\"index\":%d}",
                   st->next_index);
        ok = sse_event(fd, "content_block_stop", b.ptr);
        buf_free(&b);
        if (!ok) return false;
    }
    return true;
}

static bool anthropic_sse_stop_live(int fd, const char *finish,
                                    int completion_tokens) {
    buf b = {0};
    buf_puts(&b, "{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":");
    json_escape(&b, anthropic_stop_reason(finish));
    buf_puts(&b, ",\"stop_sequence\":null},\"usage\":{\"output_tokens\":");
    buf_printf(&b, "%d}}", completion_tokens);
    bool ok = sse_event(fd, "message_delta", b.ptr);
    buf_free(&b);
    if (ok) ok = sse_event(fd, "message_stop", "{\"type\":\"message_stop\"}");
    return ok;
}

static bool anthropic_sse_finish_live(int fd, server *s, const request *r, const char *id,
                                      anthropic_stream *st, const char *raw,
                                      size_t raw_len, const tool_calls *calls,
                                      const char *finish, int completion_tokens) {
    if (!anthropic_sse_stream_update(fd, s, r, id, st, raw, raw_len, true)) return false;

    if (st->sent_thinking && !st->sent_text && (!calls || calls->len == 0)) {
        if (!anthropic_sse_open_block(fd, st, ANTH_BLOCK_TEXT)) return false;
        if (!anthropic_sse_close_block_live(fd, id, st)) return false;
    }

    if (!anthropic_sse_tool_blocks_live(fd, r, id, st, calls)) return false;
    return anthropic_sse_stop_live(fd, finish, completion_tokens);
}

static double now_sec(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

static void server_log(ds4_log_type type, const char *fmt, ...) {
    time_t now = time(NULL);
    struct tm tm;
    localtime_r(&now, &tm);
    char ts[16];
    strftime(ts, sizeof(ts), "%m%d %H:%M:%S", &tm);

    va_list ap;
    va_start(ap, fmt);
    va_list copy;
    va_copy(copy, ap);
    int n = vsnprintf(NULL, 0, fmt, copy);
    va_end(copy);

    fprintf(stderr, "%s ", ts);
    if (n < 0) {
        ds4_log(stderr, type, "%s", fmt);
    } else {
        char *line = xmalloc((size_t)n + 1);
        vsnprintf(line, (size_t)n + 1, fmt, ap);
        ds4_log(stderr, type, "%s", line);
        free(line);
    }
    va_end(ap);
    fputc('\n', stderr);
}

typedef struct job job;

typedef ds4_kvstore_entry kv_entry;
typedef ds4_kvstore_options kv_cache_options;
typedef ds4_kvstore kv_disk_cache;

typedef enum {
    TOOL_MEMORY_RAM = 0,
    TOOL_MEMORY_DISK = 1,
} tool_memory_source;

typedef struct tool_memory_entry tool_memory_entry;

typedef struct {
    char *dsml;
    size_t len;
    size_t bytes;
    int refs;
    uint64_t seen;
    tool_memory_entry *entries;
} tool_memory_block;

struct tool_memory_entry {
    char *id;
    tool_memory_block *block;
    size_t bytes;
    uint64_t stamp;
    tool_memory_source source;
    tool_memory_entry *prev;
    tool_memory_entry *next;
    tool_memory_entry *block_next;
};

typedef struct {
    rax *by_id;
    rax *by_block;
    tool_memory_entry *head;
    tool_memory_entry *tail;
    int entries;
    int max_entries;
    size_t bytes;
    size_t max_bytes;
    uint64_t clock;
    uint64_t scan_clock;
} tool_memory;

typedef struct {
    bool valid;
    /* Token frontier of a live assistant tool-call turn. Continuing from this
     * point preserves hidden thinking and sampled DSML bytes that are not
     * necessarily present in the client-visible replay. */
    int live_tokens;
    /* Optional rendered conversation text that the client is expected to replay.
     * Responses uses this because visible replay can omit hidden reasoning.
     * Anthropic currently uses only the call-id side of the state. */
    char *visible_text;
    size_t visible_len;
    /* Tool-call ids generated at the same live frontier. A following tool
     * result for these ids is a direct protocol continuation and should not
     * trigger prompt-prefix matching or checkpoint canonicalization. */
    stop_list call_ids;
} live_tool_state;

typedef struct {
    bool valid;
    /* Token frontier of the live sampled session.  The visible text below is
     * what clients will replay, but the payload at this frontier may also
     * contain hidden thinking tokens that are intentionally absent from that
     * visible replay. */
    int live_tokens;
    char *visible_text;
    size_t visible_len;
} visible_live_state;

static bool id_list_contains(const stop_list *ids, const char *id);
static void id_list_push_unique(stop_list *ids, const char *id);

struct server {
    ds4_engine *engine;
    ds4_session *session;
    int default_tokens;
    kv_disk_cache kv;
    tool_memory tool_mem;
    live_tool_state responses_live;
    live_tool_state anthropic_live;
    visible_live_state thinking_live;
    bool disable_exact_dsml_tool_replay;
    bool enable_cors;
    pthread_mutex_t tool_mu;
    pthread_mutex_t mu;
    pthread_cond_t cv;
    pthread_cond_t clients_cv;
    job *head;
    job *tail;
    bool stopping;
    int clients;
    uint64_t seq;
    FILE *trace;
    pthread_mutex_t trace_mu;
    uint64_t trace_seq;
};

/* Jobs are stack-owned by the client thread.  The worker signals completion
 * after the response has been written, so request data and the socket remain
 * valid without heap-allocating per-request job objects. */
struct job {
    int fd;
    request req;
    bool done;
    pthread_mutex_t mu;
    pthread_cond_t cv;
    job *next;
};

/* =========================================================================
 * Tool Call Text Memory.
 * =========================================================================
 *
 * The model speaks DSML, while OpenAI and Anthropic clients round-trip tool
 * calls as JSON.  Re-rendering that JSON is not always the same byte sequence:
 * clients may preserve, sort, or rebuild object keys differently.  Tool call
 * ids are the bridge between both worlds.  For every generated tool call we
 * remember the exact DSML block sampled by the model under a random id.  When
 * the client later sends the same id back in conversation history, we replay
 * the sampled DSML verbatim and keep the KV cache aligned with the live model
 * state.
 */

#define DS4_TOOL_MEMORY_DEFAULT_MAX_IDS 100000
#define DS4_TOOL_MEMORY_MAX_BYTES (512u * 1024u * 1024u)

static int tool_memory_max_entries(const tool_memory *m) {
    return m && m->max_entries > 0 ? m->max_entries : DS4_TOOL_MEMORY_DEFAULT_MAX_IDS;
}

static size_t tool_memory_max_bytes(const tool_memory *m) {
    return m && m->max_bytes > 0 ? m->max_bytes : DS4_TOOL_MEMORY_MAX_BYTES;
}

static void tool_memory_init_locked(tool_memory *m) {
    if (m->by_id && m->by_block) return;
    m->by_id = raxNew();
    m->by_block = raxNew();
    if (!m->by_id || !m->by_block) die("out of memory");
}

static void tool_memory_link_head(tool_memory *m, tool_memory_entry *e) {
    e->prev = NULL;
    e->next = m->head;
    if (m->head) m->head->prev = e;
    else m->tail = e;
    m->head = e;
}

static void tool_memory_unlink(tool_memory *m, tool_memory_entry *e) {
    if (e->prev) e->prev->next = e->next;
    else m->head = e->next;
    if (e->next) e->next->prev = e->prev;
    else m->tail = e->prev;
    e->prev = e->next = NULL;
}

static void tool_memory_touch(tool_memory *m, tool_memory_entry *e) {
    e->stamp = ++m->clock;
    if (m->head == e) return;
    tool_memory_unlink(m, e);
    tool_memory_link_head(m, e);
}

static void tool_block_unlink_entry(tool_memory_block *b, tool_memory_entry *e) {
    tool_memory_entry **p = &b->entries;
    while (*p) {
        if (*p == e) {
            *p = e->block_next;
            e->block_next = NULL;
            return;
        }
        p = &(*p)->block_next;
    }
}

static tool_memory_block *tool_memory_find_block_locked(tool_memory *m,
                                                        const char *dsml,
                                                        size_t len) {
    if (!m->by_block || !dsml || len == 0) return NULL;
    void *v = raxFind(m->by_block, (unsigned char *)dsml, len);
    return v == raxNotFound ? NULL : v;
}

static tool_memory_block *tool_memory_get_block_locked(tool_memory *m,
                                                       const char *dsml,
                                                       size_t len) {
    tool_memory_block *b = tool_memory_find_block_locked(m, dsml, len);
    if (b) return b;

    b = xmalloc(sizeof(*b));
    memset(b, 0, sizeof(*b));
    b->dsml = xstrndup(dsml, len);
    b->len = len;
    b->bytes = len + 1 + sizeof(*b);
    if (!raxInsert(m->by_block, (unsigned char *)b->dsml, b->len, b, NULL)) {
        free(b->dsml);
        free(b);
        die("out of memory");
    }
    m->bytes += b->bytes;
    return b;
}

static void tool_memory_release_block_locked(tool_memory *m, tool_memory_block *b) {
    if (!b) return;
    if (--b->refs > 0) return;
    if (m->by_block) {
        void *old = NULL;
        (void)raxRemove(m->by_block, (unsigned char *)b->dsml, b->len, &old);
    }
    if (m->bytes >= b->bytes) m->bytes -= b->bytes;
    else m->bytes = 0;
    free(b->dsml);
    free(b);
}

static void tool_memory_remove_entry_locked(tool_memory *m, tool_memory_entry *e) {
    if (!e) return;
    if (m->by_id && e->id) {
        void *old = NULL;
        (void)raxRemove(m->by_id, (unsigned char *)e->id, strlen(e->id), &old);
    }
    tool_memory_unlink(m, e);
    if (e->block) tool_block_unlink_entry(e->block, e);
    if (m->bytes >= e->bytes) m->bytes -= e->bytes;
    else m->bytes = 0;
    if (m->entries > 0) m->entries--;
    free(e->id);
    tool_memory_release_block_locked(m, e->block);
    free(e);
}

static void tool_memory_prune_locked(tool_memory *m) {
    while ((m->entries > tool_memory_max_entries(m) ||
            m->bytes > tool_memory_max_bytes(m)) && m->tail)
    {
        tool_memory_remove_entry_locked(m, m->tail);
    }
}

static tool_memory_entry *tool_memory_find_entry_locked(tool_memory *m,
                                                        const char *id) {
    if (!m->by_id || !id || !id[0]) return NULL;
    void *v = raxFind(m->by_id, (unsigned char *)id, strlen(id));
    return v == raxNotFound ? NULL : v;
}

static void tool_memory_put_locked(tool_memory *m, const char *id,
                                   const char *dsml, tool_memory_source source) {
    if (!id || !id[0] || !dsml || !dsml[0]) return;
    tool_memory_init_locked(m);

    size_t dsml_len = strlen(dsml);
    tool_memory_entry *old = tool_memory_find_entry_locked(m, id);
    if (old && old->block && old->block->len == dsml_len &&
        !memcmp(old->block->dsml, dsml, dsml_len))
    {
        if (source == TOOL_MEMORY_RAM) old->source = TOOL_MEMORY_RAM;
        tool_memory_touch(m, old);
        tool_memory_prune_locked(m);
        return;
    }
    if (old) tool_memory_remove_entry_locked(m, old);

    tool_memory_block *b = tool_memory_get_block_locked(m, dsml, dsml_len);
    tool_memory_entry *e = xmalloc(sizeof(*e));
    memset(e, 0, sizeof(*e));
    e->id = xstrdup(id);
    e->block = b;
    e->bytes = strlen(id) + 1 + sizeof(*e);
    e->stamp = ++m->clock;
    e->source = source;
    e->block_next = b->entries;
    b->entries = e;
    b->refs++;

    if (!raxInsert(m->by_id, (unsigned char *)e->id, strlen(e->id), e, NULL)) {
        tool_block_unlink_entry(b, e);
        free(e->id);
        free(e);
        tool_memory_release_block_locked(m, b);
        die("out of memory");
    }
    tool_memory_link_head(m, e);
    m->entries++;
    m->bytes += e->bytes;
    tool_memory_prune_locked(m);
}

static void tool_memory_free(tool_memory *m) {
    while (m->tail) tool_memory_remove_entry_locked(m, m->tail);
    if (m->by_id) raxFree(m->by_id);
    if (m->by_block) raxFree(m->by_block);
    memset(m, 0, sizeof(*m));
}

/* Single live protocol-tool state.
 *
 * This is not an implementation of durable remote conversation storage.  It is
 * only an in-memory binding from protocol tool-call IDs to the current sampled
 * KV frontier.  If it does not match, DS4 falls back to the same prefix and
 * disk-cache machinery used by chat/completions, or returns a clear error for
 * tool-result-only requests that have no replayable prefix. */
static void live_tool_state_clear_locked(live_tool_state *st) {
    if (!st) return;
    stop_list_clear(&st->call_ids);
    free(st->visible_text);
    st->visible_text = NULL;
    st->visible_len = 0;
    st->valid = false;
    st->live_tokens = 0;
}

static void live_tool_state_free(live_tool_state *st) {
    if (!st) return;
    live_tool_state_clear_locked(st);
    free(st->call_ids.v);
    memset(st, 0, sizeof(*st));
}

static void visible_live_clear_locked(visible_live_state *st) {
    if (!st) return;
    free(st->visible_text);
    st->visible_text = NULL;
    st->visible_len = 0;
    st->live_tokens = 0;
    st->valid = false;
}

static void visible_live_free(visible_live_state *st) {
    if (!st) return;
    visible_live_clear_locked(st);
    memset(st, 0, sizeof(*st));
}

static void thinking_live_clear(server *s) {
    if (!s) return;
    pthread_mutex_lock(&s->tool_mu);
    visible_live_clear_locked(&s->thinking_live);
    pthread_mutex_unlock(&s->tool_mu);
}

static void thinking_live_remember(server *s, const char *visible_text) {
    if (!s || !visible_text || !visible_text[0]) return;
    pthread_mutex_lock(&s->tool_mu);
    visible_live_clear_locked(&s->thinking_live);
    s->thinking_live.visible_text = xstrdup(visible_text);
    s->thinking_live.visible_len = strlen(visible_text);
    s->thinking_live.live_tokens = ds4_session_pos(s->session);
    s->thinking_live.valid = true;
    pthread_mutex_unlock(&s->tool_mu);
}

static void responses_live_remember(server *s, const char *visible_text,
                                    const tool_calls *calls) {
    if (!s || !visible_text || !visible_text[0]) return;
    pthread_mutex_lock(&s->tool_mu);
    live_tool_state_clear_locked(&s->responses_live);
    s->responses_live.visible_text = xstrdup(visible_text);
    s->responses_live.visible_len = strlen(visible_text);
    if (calls) {
        for (int i = 0; i < calls->len; i++) {
            id_list_push_unique(&s->responses_live.call_ids, calls->v[i].id);
        }
    }
    s->responses_live.live_tokens = ds4_session_pos(s->session);
    s->responses_live.valid = true;
    pthread_mutex_unlock(&s->tool_mu);
}

static void anthropic_live_remember(server *s, const tool_calls *calls) {
    if (!s || !calls || calls->len == 0) return;
    pthread_mutex_lock(&s->tool_mu);
    live_tool_state_clear_locked(&s->anthropic_live);
    for (int i = 0; i < calls->len; i++) {
        id_list_push_unique(&s->anthropic_live.call_ids, calls->v[i].id);
    }
    s->anthropic_live.live_tokens = ds4_session_pos(s->session);
    s->anthropic_live.valid = s->anthropic_live.call_ids.len > 0;
    pthread_mutex_unlock(&s->tool_mu);
}

static void responses_live_clear(server *s) {
    if (!s) return;
    pthread_mutex_lock(&s->tool_mu);
    live_tool_state_clear_locked(&s->responses_live);
    pthread_mutex_unlock(&s->tool_mu);
}

static void anthropic_live_clear(server *s) {
    if (!s) return;
    pthread_mutex_lock(&s->tool_mu);
    live_tool_state_clear_locked(&s->anthropic_live);
    pthread_mutex_unlock(&s->tool_mu);
}

static bool responses_live_has_call_id(server *s, const char *id) {
    if (!s || !id || !id[0]) return false;
    pthread_mutex_lock(&s->tool_mu);
    bool found = s->responses_live.valid &&
                 id_list_contains(&s->responses_live.call_ids, id);
    pthread_mutex_unlock(&s->tool_mu);
    return found;
}

static bool anthropic_live_has_call_id(server *s, const char *id) {
    if (!s || !id || !id[0]) return false;
    pthread_mutex_lock(&s->tool_mu);
    bool found = s->anthropic_live.valid &&
                 id_list_contains(&s->anthropic_live.call_ids, id);
    pthread_mutex_unlock(&s->tool_mu);
    return found;
}

static bool responses_live_matches_request(server *s, const stop_list *ids,
                                           int live_tokens) {
    if (!s || !ids || ids->len == 0) return false;
    pthread_mutex_lock(&s->tool_mu);
    bool ok = s->responses_live.valid &&
              s->responses_live.live_tokens == live_tokens &&
              s->responses_live.call_ids.len == ids->len;
    for (int i = 0; ok && i < ids->len; i++) {
        ok = id_list_contains(&s->responses_live.call_ids, ids->v[i]);
    }
    pthread_mutex_unlock(&s->tool_mu);
    return ok;
}

static bool anthropic_live_matches_request(server *s, const stop_list *ids,
                                           int live_tokens) {
    if (!s || !ids || ids->len == 0) return false;
    pthread_mutex_lock(&s->tool_mu);
    bool ok = s->anthropic_live.valid &&
              s->anthropic_live.live_tokens == live_tokens &&
              s->anthropic_live.call_ids.len == ids->len;
    for (int i = 0; ok && i < ids->len; i++) {
        ok = id_list_contains(&s->anthropic_live.call_ids, ids->v[i]);
    }
    pthread_mutex_unlock(&s->tool_mu);
    return ok;
}

static bool tool_memory_has_id(server *s, const char *id) {
    if (!s || s->disable_exact_dsml_tool_replay || !id || !id[0]) return false;
    pthread_mutex_lock(&s->tool_mu);
    bool found = tool_memory_find_entry_locked(&s->tool_mem, id) != NULL;
    pthread_mutex_unlock(&s->tool_mu);
    return found;
}

static const char *tool_memory_lookup_locked(tool_memory *m, const char *id,
                                             tool_memory_source *source,
                                             tool_memory_block **block) {
    tool_memory_entry *e = tool_memory_find_entry_locked(m, id);
    if (!e || !e->block) return NULL;
    tool_memory_touch(m, e);
    if (source) *source = e->source;
    if (block) *block = e->block;
    return e->block->dsml;
}

static void tool_memory_remember(server *s, const tool_calls *calls) {
    if (!s || s->disable_exact_dsml_tool_replay ||
        !calls || !calls->raw_dsml || !calls->raw_dsml[0]) return;
    pthread_mutex_lock(&s->tool_mu);
    for (int i = 0; i < calls->len; i++) {
        tool_memory_put_locked(&s->tool_mem, calls->v[i].id, calls->raw_dsml,
                               TOOL_MEMORY_RAM);
    }
    pthread_mutex_unlock(&s->tool_mu);
}

static void tool_memory_put_source(server *s, const char *id, const char *dsml,
                                   tool_memory_source source) {
    if (!s || s->disable_exact_dsml_tool_replay ||
        !id || !id[0] || !dsml || !dsml[0]) return;
    pthread_mutex_lock(&s->tool_mu);
    tool_memory_put_locked(&s->tool_mem, id, dsml, source);
    pthread_mutex_unlock(&s->tool_mu);
}

#ifdef DS4_SERVER_TEST
static void tool_memory_put(server *s, const char *id, const char *dsml) {
    tool_memory_put_source(s, id, dsml, TOOL_MEMORY_RAM);
}
#endif

static void tool_memory_attach_to_messages(server *s, chat_msgs *msgs,
                                           tool_replay_stats *stats) {
    if (!msgs) return;
    if (!s || s->disable_exact_dsml_tool_replay) {
        if (stats) {
            for (int i = 0; i < msgs->len; i++) {
                tool_calls *calls = &msgs->v[i].calls;
                if (calls->len == 0 || calls->raw_dsml) continue;
                stats->canonical++;
                stats->missing_ids += calls->len;
            }
        }
        return;
    }
    pthread_mutex_lock(&s->tool_mu);
    for (int i = 0; i < msgs->len; i++) {
        tool_calls *calls = &msgs->v[i].calls;
        if (calls->len == 0 || calls->raw_dsml) continue;
        tool_memory_block *matched = NULL;
        tool_memory_source matched_source = TOOL_MEMORY_DISK;
        bool exact = true;
        int missing = 0;
        for (int j = 0; j < calls->len; j++) {
            tool_memory_source source = TOOL_MEMORY_DISK;
            tool_memory_block *block = NULL;
            const char *dsml =
                tool_memory_lookup_locked(&s->tool_mem, calls->v[j].id,
                                          &source, &block);
            if (!dsml) {
                exact = false;
                missing++;
                continue;
            }
            if (!matched) {
                matched = block;
                matched_source = source;
            } else if (matched != block) {
                exact = false;
            }
            if (source == TOOL_MEMORY_RAM) matched_source = TOOL_MEMORY_RAM;
        }
        if (exact && matched) {
            calls->raw_dsml = xstrdup(matched->dsml);
            if (stats) {
                if (matched_source == TOOL_MEMORY_RAM) stats->mem++;
                else stats->disk++;
            }
        } else if (stats) {
            stats->canonical++;
            stats->missing_ids += missing;
        }
    }
    pthread_mutex_unlock(&s->tool_mu);
}

static bool tool_calls_contains_id(const tool_calls *calls, const char *id, int upto) {
    if (!calls || !id || !id[0]) return false;
    if (upto > calls->len) upto = calls->len;
    for (int i = 0; i < upto; i++) {
        if (calls->v[i].id && !strcmp(calls->v[i].id, id)) return true;
    }
    return false;
}

static void assign_tool_call_ids(server *s, tool_calls *calls, api_style api) {
    if (!calls) return;
    for (int i = 0; i < calls->len; i++) {
        if (calls->v[i].id && calls->v[i].id[0]) continue;
        char id[64];
        for (;;) {
            random_tool_id(id, sizeof(id), api);
            if (!tool_calls_contains_id(calls, id, i) && !tool_memory_has_id(s, id)) break;
        }
        calls->v[i].id = xstrdup(id);
    }
}

static void apply_openai_stream_tool_ids(tool_calls *calls,
                                         const openai_stream *st) {
    if (!calls || !st) return;
    int n = calls->len < st->tool.ids_cap ? calls->len : st->tool.ids_cap;
    for (int i = 0; i < n; i++) {
        if (calls->v[i].id && calls->v[i].id[0]) continue;
        if (st->tool.ids[i] && st->tool.ids[i][0]) calls->v[i].id = xstrdup(st->tool.ids[i]);
    }
}

static void apply_anthropic_stream_tool_ids(tool_calls *calls,
                                            const anthropic_stream *st) {
    if (!calls || !st) return;
    /* The SSE stream may have exposed tool ids before final DSML parsing.  The
     * parsed calls must inherit those ids before assign_tool_call_ids() and
     * tool_memory_remember(), otherwise the client returns a tool_result for an
     * id that the continuation fast path does not know. */
    int n = calls->len < st->tool.ids_cap ? calls->len : st->tool.ids_cap;
    for (int i = 0; i < n; i++) {
        if (calls->v[i].id && calls->v[i].id[0]) continue;
        if (st->tool.ids[i] && st->tool.ids[i][0]) calls->v[i].id = xstrdup(st->tool.ids[i]);
    }
}

/* =========================================================================
 * KV Cache.
 * =========================================================================
 *
 * The server has one live Metal session.  We persist reusable DS4 session
 * snapshots when a cold prompt reaches a useful prefix, when a long continued
 * conversation has grown far enough, and when a request evicts the live session.
 * The cache key is the SHA1 of the rendered byte prefix.  The payload still
 * stores exact token IDs and graph state; the filename only selects a checkpoint
 * whose decoded transcript bytes are a prefix of the next rendered request.
 *
 * Files are loaded with plain read/write I/O into the existing graph tensors;
 * mmap is deliberately avoided here so cache restore cannot add more VM
 * mappings to a process that already maps a very large GGUF.
 *
 * Stores are created only when the live graph is already at the checkpoint we
 * want to persist.  For long cold prompts this means prefill reaches the stable
 * boundary first, writes that prefix, and then continues with the suffix.  We
 * never roll the session backward just to build a disk cache entry: that would
 * turn cache population into a second hidden prefill.
 *
 * File layout:
 *
 *   "KVC" version
 *   quant bits, save reason, token count, hit count, context size
 *   creation time, last-used time, payload byte count
 *   rendered text byte count + rendered text for human inspection
 *   DS4 engine payload written by ds4_session_save_payload()
 *   optional tool-id map section
 *
 * The filename is SHA1(cache text bytes), not SHA1(token ids).  For ordinary
 * checkpoints the cache text is the rendered token prefix.  For live hidden
 * state it can instead be the client-visible transcript: the payload still
 * contains sampled reasoning KV, but the lookup key must be what the client can
 * replay after a process restart or session switch.
 *
 * The optional tool-id map is not part of model state, but it is needed to
 * render future client JSON back to the exact DSML sampled by the model.  We
 * persist only mappings whose DSML block appears in the saved cache text.
 */

#define KV_CACHE_FIXED_HEADER DS4_KVSTORE_FIXED_HEADER
#define KV_CACHE_HIT_HALF_LIFE_SECONDS DS4_KVSTORE_HIT_HALF_LIFE_SECONDS
#define KV_EXT_TOOL_MAP DS4_KVSTORE_EXT_TOOL_MAP
#define KV_EXT_RESPONSES_VISIBLE DS4_KVSTORE_EXT_RESPONSES_VISIBLE
#define KV_EXT_THINKING_VISIBLE DS4_KVSTORE_EXT_THINKING_VISIBLE
#define KV_TOOL_MAP_MAGIC0 'K'
#define KV_TOOL_MAP_MAGIC1 'T'
#define KV_TOOL_MAP_MAGIC2 'M'
#define KV_TOOL_MAP_VERSION 1u
#define KV_TOOL_MAP_HEADER 8u

typedef enum {
    KV_REASON_UNKNOWN   = DS4_KVSTORE_REASON_UNKNOWN,
    KV_REASON_COLD      = DS4_KVSTORE_REASON_COLD,
    KV_REASON_CONTINUED = DS4_KVSTORE_REASON_CONTINUED,
    KV_REASON_EVICT     = DS4_KVSTORE_REASON_EVICT,
    KV_REASON_SHUTDOWN  = DS4_KVSTORE_REASON_SHUTDOWN,
} kv_cache_reason;


static kv_cache_options kv_cache_default_options(void) {
    return ds4_kvstore_default_options();
}

static void le_put32(uint8_t *p, uint32_t v) {
    ds4_kvstore_le_put32(p, v);
}


static uint32_t le_get32(const uint8_t *p) {
    return ds4_kvstore_le_get32(p);
}


#ifdef DS4_SERVER_TEST
static void sha1_bytes_hex(const void *ptr, size_t len, char out[41]) {
    ds4_kvstore_sha1_bytes_hex(ptr, len, out);
}
#endif

static bool id_list_contains(const stop_list *ids, const char *id) {
    if (!ids || !id || !id[0]) return false;
    for (int i = 0; i < ids->len; i++) {
        if (ids->v[i] && !strcmp(ids->v[i], id)) return true;
    }
    return false;
}

static void id_list_push_unique(stop_list *ids, const char *id) {
    if (!ids || !id || !id[0] || id_list_contains(ids, id)) return;
    stop_list_push(ids, xstrdup(id));
}

static void id_list_free(stop_list *ids) {
    stop_list_clear(ids);
    free(ids->v);
    memset(ids, 0, sizeof(*ids));
}

static void collect_tool_call_ids(const chat_msgs *msgs, stop_list *ids) {
    if (!msgs || !ids) return;
    for (int i = 0; i < msgs->len; i++) {
        id_list_push_unique(ids, msgs->v[i].tool_call_id);
        for (int j = 0; j < msgs->v[i].tool_call_ids_len; j++) {
            id_list_push_unique(ids, msgs->v[i].tool_call_ids[j]);
        }
        const tool_calls *calls = &msgs->v[i].calls;
        for (int j = 0; j < calls->len; j++) {
            id_list_push_unique(ids, calls->v[j].id);
        }
    }
}

static bool sha_hex_name(const char *name, char sha[41]) {
    return ds4_kvstore_sha_hex_name(name, sha);
}

static char *path_join(const char *dir, const char *name) {
    return ds4_kvstore_path_join(dir, name);
}






static const char *find_next_dsml_tool_block(const char *p, const char **end_out) {
    struct block_form {
        const char *start;
        const char *end;
    } forms[] = {
        {"\n\n" DS4_TOOL_CALLS_START, DS4_TOOL_CALLS_END},
        {DS4_TOOL_CALLS_START, DS4_TOOL_CALLS_END},
        {"\n\n" DS4_TOOL_CALLS_START_SHORT, DS4_TOOL_CALLS_END_SHORT},
        {DS4_TOOL_CALLS_START_SHORT, DS4_TOOL_CALLS_END_SHORT},
        {"\n\n<tool_calls>", "</tool_calls>"},
        {"<tool_calls>", "</tool_calls>"},
    };

    const char *best = NULL;
    const char *best_end = NULL;
    for (size_t i = 0; i < sizeof(forms) / sizeof(forms[0]); i++) {
        const char *s = strstr(p, forms[i].start);
        if (!s || (best && s >= best)) continue;
        const char *e = strstr(s, forms[i].end);
        if (!e) continue;
        best = s;
        best_end = e + strlen(forms[i].end);
    }
    if (end_out) *end_out = best_end;
    return best;
}


static bool kv_tool_map_measure_locked(server *s, const char *text,
                                       uint32_t *count_out,
                                       uint64_t *bytes_out) {
    uint32_t count = 0;
    uint64_t bytes = KV_TOOL_MAP_HEADER;
    uint64_t scan = ++s->tool_mem.scan_clock;
    const char *p = text;
    for (;;) {
        const char *end = NULL;
        const char *start = find_next_dsml_tool_block(p, &end);
        if (!start || !end) break;
        tool_memory_block *b =
            tool_memory_find_block_locked(&s->tool_mem, start, (size_t)(end - start));
        if (b && b->seen != scan) {
            b->seen = scan;
            for (tool_memory_entry *e = b->entries; e; e = e->block_next) {
                size_t id_len = strlen(e->id);
                size_t dsml_len = b->len;
                if (id_len > UINT32_MAX || dsml_len > UINT32_MAX) continue;
                if (count == UINT32_MAX) return false;
                if (UINT64_MAX - bytes < 8u ||
                    UINT64_MAX - bytes - 8u < (uint64_t)id_len ||
                    UINT64_MAX - bytes - 8u - (uint64_t)id_len < (uint64_t)dsml_len)
                    return false;
                count++;
                bytes += 8u + (uint64_t)id_len + (uint64_t)dsml_len;
            }
        }
        p = end;
    }
    if (count == 0) bytes = 0;
    if (count_out) *count_out = count;
    if (bytes_out) *bytes_out = bytes;
    return true;
}

static bool kv_tool_map_serialized_size(server *s, const char *text,
                                        uint64_t *bytes_out) {
    if (bytes_out) *bytes_out = 0;
    if (!s || s->disable_exact_dsml_tool_replay || !text || !text[0]) return true;

    pthread_mutex_lock(&s->tool_mu);
    bool ok = kv_tool_map_measure_locked(s, text, NULL, bytes_out);
    pthread_mutex_unlock(&s->tool_mu);
    return ok;
}

static bool kv_tool_map_write(server *s, FILE *fp, const char *text,
                              uint64_t *written_bytes) {
    if (written_bytes) *written_bytes = 0;
    if (!s || s->disable_exact_dsml_tool_replay || !fp || !text || !text[0]) return true;

    pthread_mutex_lock(&s->tool_mu);
    uint32_t count = 0;
    uint64_t bytes = 0;
    bool ok = kv_tool_map_measure_locked(s, text, &count, &bytes);
    if (!ok) {
        pthread_mutex_unlock(&s->tool_mu);
        return false;
    }
    if (count == 0) {
        pthread_mutex_unlock(&s->tool_mu);
        return true;
    }

    uint8_t h[KV_TOOL_MAP_HEADER];
    h[0] = KV_TOOL_MAP_MAGIC0;
    h[1] = KV_TOOL_MAP_MAGIC1;
    h[2] = KV_TOOL_MAP_MAGIC2;
    h[3] = KV_TOOL_MAP_VERSION;
    le_put32(h + 4, count);
    ok = fwrite(h, 1, sizeof(h), fp) == sizeof(h);

    uint64_t scan = ++s->tool_mem.scan_clock;
    const char *p = text;
    for (;;) {
        const char *end = NULL;
        const char *start = find_next_dsml_tool_block(p, &end);
        if (!start || !end || !ok) break;
        tool_memory_block *b =
            tool_memory_find_block_locked(&s->tool_mem, start, (size_t)(end - start));
        if (b && b->seen != scan) {
            b->seen = scan;
            for (tool_memory_entry *e = b->entries; ok && e; e = e->block_next) {
                size_t id_len = strlen(e->id);
                size_t dsml_len = b->len;
                if (id_len > UINT32_MAX || dsml_len > UINT32_MAX) continue;
                uint8_t lens[8];
                le_put32(lens, (uint32_t)id_len);
                le_put32(lens + 4, (uint32_t)dsml_len);
                ok = fwrite(lens, 1, sizeof(lens), fp) == sizeof(lens) &&
                     fwrite(e->id, 1, id_len, fp) == id_len &&
                     fwrite(b->dsml, 1, dsml_len, fp) == dsml_len;
            }
        }
        p = end;
    }
    pthread_mutex_unlock(&s->tool_mu);

    if (ok && written_bytes) *written_bytes = bytes;
    return ok;
}

static int kv_tool_map_load_from_pos(server *s, FILE *fp, const stop_list *wanted) {
    if (!s || s->disable_exact_dsml_tool_replay || !fp) return 0;
    uint8_t h[KV_TOOL_MAP_HEADER];
    size_t n = fread(h, 1, sizeof(h), fp);
    if (n == 0 && feof(fp)) return 0;
    if (n != sizeof(h)) return 0;
    if (h[0] != KV_TOOL_MAP_MAGIC0 || h[1] != KV_TOOL_MAP_MAGIC1 ||
        h[2] != KV_TOOL_MAP_MAGIC2 || h[3] != KV_TOOL_MAP_VERSION) return 0;

    uint32_t count = le_get32(h + 4);
    if ((uint64_t)count > (uint64_t)tool_memory_max_entries(&s->tool_mem) * 4u) return 0;
    int loaded = 0;
    for (uint32_t i = 0; i < count; i++) {
        uint8_t lens[8];
        if (fread(lens, 1, sizeof(lens), fp) != sizeof(lens)) return loaded;
        uint32_t id_len = le_get32(lens);
        uint32_t dsml_len = le_get32(lens + 4);
        if (id_len == 0 || id_len > 256 || dsml_len == 0 ||
            dsml_len > DS4_TOOL_MEMORY_MAX_BYTES) return loaded;
        char *id = xmalloc((size_t)id_len + 1);
        char *dsml = xmalloc((size_t)dsml_len + 1);
        bool ok = fread(id, 1, id_len, fp) == id_len &&
                  fread(dsml, 1, dsml_len, fp) == dsml_len;
        id[id_len] = '\0';
        dsml[dsml_len] = '\0';
        if (ok && (!wanted || id_list_contains(wanted, id))) {
            tool_memory_put_source(s, id, dsml, TOOL_MEMORY_DISK);
            loaded++;
        }
        free(id);
        free(dsml);
        if (!ok) return loaded;
    }
    return loaded;
}

#ifdef DS4_SERVER_TEST
static void kv_fill_header(uint8_t h[KV_CACHE_FIXED_HEADER], uint8_t quant_bits,
                           uint8_t reason, uint8_t ext_flags,
                           uint32_t tokens, uint32_t hits, uint32_t ctx_size,
                           uint64_t created_at, uint64_t last_used,
                           uint64_t payload_bytes) {
    ds4_kvstore_fill_header(h, 0, quant_bits, reason, ext_flags, tokens, hits,
                            ctx_size, created_at, last_used, payload_bytes);
}
#endif

static bool kv_read_header(FILE *fp, kv_entry *e, uint32_t *text_bytes) {
    return ds4_kvstore_read_header(fp, e, text_bytes);
}




static void kv_cache_restore_tool_memory_for_messages(server *s, const chat_msgs *msgs) {
    if (!s || s->disable_exact_dsml_tool_replay || !s->kv.enabled || !msgs) return;
    stop_list wanted = {0};
    collect_tool_call_ids(msgs, &wanted);
    if (wanted.len == 0) return;
    /* Tool replay payloads are stored next to KV checkpoints; keep them model
     * scoped too, since token positions and graph state are not portable across
     * Flash/Pro shapes even when the rendered chat text is identical. */
    uint8_t model_id = s->engine ? (uint8_t)ds4_engine_model_id(s->engine) : 0;

    DIR *d = opendir(s->kv.dir);
    if (!d) {
        id_list_free(&wanted);
        return;
    }
    struct dirent *de;
    while ((de = readdir(d)) != NULL) {
        char sha[41];
        if (!sha_hex_name(de->d_name, sha)) continue;
        (void)sha;
        char *path = path_join(s->kv.dir, de->d_name);
        FILE *fp = fopen(path, "rb");
        free(path);
        if (!fp) continue;

        kv_entry hdr = {0};
        uint32_t text_bytes = 0;
        bool ok = kv_read_header(fp, &hdr, &text_bytes);
        uint64_t skip = (uint64_t)text_bytes + hdr.payload_bytes;
        if (ok && hdr.model_id == model_id && (hdr.ext_flags & KV_EXT_TOOL_MAP) &&
            skip <= (uint64_t)INT64_MAX &&
            fseeko(fp, (off_t)skip, SEEK_CUR) == 0)
        {
            kv_tool_map_load_from_pos(s, fp, &wanted);
        }
        fclose(fp);
    }
    closedir(d);
    id_list_free(&wanted);
}

#ifdef DS4_SERVER_TEST
static double kv_entry_eviction_score(const kv_entry *e, const ds4_tokens *live,
                                      uint64_t now,
                                      const ds4_kvstore_eviction_context *incoming) {
    return ds4_kvstore_entry_eviction_score(e, live, now, incoming);
}
#endif

#ifdef DS4_SERVER_TEST
static void kv_cache_evict(kv_disk_cache *kc, const ds4_tokens *live,
                           uint64_t extra_bytes,
                           const ds4_kvstore_eviction_context *incoming) {
    ds4_kvstore_evict(kc, live, extra_bytes, incoming);
}
#endif

static void kv_cache_log_cb(void *ud, ds4_kvstore_log_type type, const char *msg) {
    (void)ud;
    ds4_log_type stype = DS4_LOG_KVCACHE;
    if (type == DS4_KVSTORE_LOG_DEFAULT) stype = DS4_LOG_DEFAULT;
    else if (type == DS4_KVSTORE_LOG_WARNING) stype = DS4_LOG_WARNING;
    server_log(stype, "%s", msg);
}

static bool kv_cache_open(kv_disk_cache *kc, const char *dir, uint64_t budget_mb,
                          bool reject_different_quant, kv_cache_options opt) {
    return ds4_kvstore_open(kc, dir, budget_mb, reject_different_quant, opt,
                            "ds4-server", kv_cache_log_cb, NULL);
}

static void kv_cache_close(kv_disk_cache *kc) {
    ds4_kvstore_close(kc);
}

static char *render_tokens_text(ds4_engine *engine, const ds4_tokens *tokens, size_t *out_len) {
    return ds4_kvstore_render_tokens_text(engine, tokens, out_len);
}

static bool byte_prefix_match(const char *text, size_t text_len,
                              const char *prefix, size_t prefix_len) {
    return ds4_kvstore_byte_prefix_match(text, text_len, prefix, prefix_len);
}


static void tokens_copy_prefix(ds4_tokens *dst, const ds4_tokens *src, int n) {
    ds4_kvstore_tokens_copy_prefix(dst, src, n);
}


static void build_prompt_from_exact_prefix_and_text_suffix(
        ds4_engine *engine,
        const ds4_tokens *exact_prefix,
        const char *suffix_text,
        ds4_tokens *out)
{
    ds4_kvstore_build_prompt_from_exact_prefix_and_text_suffix(
        engine, exact_prefix, suffix_text, out);
}

static int kv_cache_store_len(const kv_disk_cache *kc, int tokens) {
    return ds4_kvstore_store_len(kc, tokens);
}

static int kv_cache_chat_anchor_pos(const kv_disk_cache *kc,
                                    const ds4_tokens *prompt,
                                    int user_token_id,
                                    int assistant_token_id) {
    return ds4_kvstore_chat_anchor_pos(kc, prompt, user_token_id, assistant_token_id);
}


static int kv_cache_continued_store_target(const kv_disk_cache *kc, int live_tokens) {
    return ds4_kvstore_continued_store_target(kc, live_tokens);
}

/* A same-text-prefix file can be reused by a larger context, but not by a
 * smaller one: the payload was validated against the context capacity recorded
 * in the file.  If the existing file cannot be used by this server, replace it
 * so this context can still populate its own cache. */



#ifdef DS4_SERVER_TEST
static bool kv_cache_file_size_fits(const kv_disk_cache *kc,
                                    uint64_t text_bytes,
                                    uint64_t payload_bytes,
                                    uint64_t tool_map_bytes,
                                    uint64_t *file_bytes_out,
                                    uint64_t *required_bytes_out) {
    return ds4_kvstore_file_size_fits(kc, text_bytes, payload_bytes,
                                      tool_map_bytes, file_bytes_out,
                                      required_bytes_out);
}
#endif



static bool kv_cache_tool_map_size_cb(void *ud, const char *text,
                                      uint64_t *bytes_out) {
    return kv_tool_map_serialized_size((server *)ud, text, bytes_out);
}

static bool kv_cache_tool_map_write_cb(void *ud, FILE *fp, const char *text,
                                       uint64_t *written_bytes) {
    return kv_tool_map_write((server *)ud, fp, text, written_bytes);
}

static int kv_cache_tool_map_load_cb(void *ud, FILE *fp, const void *wanted) {
    return kv_tool_map_load_from_pos((server *)ud, fp, (const stop_list *)wanted);
}

static ds4_kvstore_trailer_hooks kv_cache_tool_map_hooks(server *s,
                                                         const stop_list *wanted) {
    return (ds4_kvstore_trailer_hooks){
        .ud = s,
        .ext_flag = KV_EXT_TOOL_MAP,
        .serialized_size = kv_cache_tool_map_size_cb,
        .write = kv_cache_tool_map_write_cb,
        .load = kv_cache_tool_map_load_cb,
        .load_wanted = wanted,
    };
}

static bool kv_cache_store_live_prefix_text(server *s, const ds4_tokens *tokens,
                                            int store_len, const char *reason,
                                            const char *cache_text_override,
                                            uint8_t cache_text_ext,
                                            const char *cache_text_key) {
    char err[160] = {0};
    ds4_kvstore_trailer_hooks hooks = kv_cache_tool_map_hooks(s, NULL);
    return ds4_kvstore_store_live_prefix_text(&s->kv, s->engine, s->session,
                                              tokens, store_len, reason,
                                              cache_text_override,
                                              cache_text_ext,
                                              cache_text_key,
                                              &hooks, err, sizeof(err));
}

static bool kv_cache_store_live_prefix(server *s, const ds4_tokens *tokens,
                                       int store_len, const char *reason) {
    return kv_cache_store_live_prefix_text(s, tokens, store_len, reason,
                                           NULL, 0, NULL);
}

static void kv_cache_store_current(server *s, const char *reason) {
    const ds4_tokens *tokens = ds4_session_tokens(s->session);
    if (!tokens) return;

    char *visible_text = NULL;
    uint8_t visible_ext = 0;
    const char *visible_key = NULL;
    pthread_mutex_lock(&s->tool_mu);
    if (s->responses_live.valid &&
        s->responses_live.live_tokens == tokens->len &&
        s->responses_live.visible_text &&
        s->responses_live.visible_text[0])
    {
        visible_text = xstrdup(s->responses_live.visible_text);
        visible_ext = KV_EXT_RESPONSES_VISIBLE;
        visible_key = "responses-visible";
    } else if (s->thinking_live.valid &&
               s->thinking_live.live_tokens == tokens->len &&
               s->thinking_live.visible_text &&
               s->thinking_live.visible_text[0])
    {
        visible_text = xstrdup(s->thinking_live.visible_text);
        visible_ext = KV_EXT_THINKING_VISIBLE;
        visible_key = "thinking-visible";
    }
    pthread_mutex_unlock(&s->tool_mu);

    /* A visible live checkpoint can contain hidden reasoning that the client
     * intentionally does not replay.  For disk recovery after a session switch,
     * key that payload by the visible protocol transcript, not by rendering the
     * hidden sampled tokens.  On load, DS4 restores the hidden KV payload and
     * tokenizes only the visible suffix that follows this key. */
    if (visible_text) {
        kv_cache_store_live_prefix_text(s, tokens, tokens->len, reason,
                                        visible_text, visible_ext, visible_key);
        free(visible_text);
    } else {
        kv_cache_store_live_prefix(s, tokens, tokens->len, reason);
    }
}

static void kv_cache_note_store(kv_disk_cache *kc, int tokens) {
    ds4_kvstore_note_store(kc, tokens);
}

static int kv_cache_suppress_continued_store(kv_disk_cache *kc, int tokens) {
    return ds4_kvstore_suppress_continued_store(kc, tokens);
}

static void kv_cache_restore_suppressed_continued(kv_disk_cache *kc,
                                                  int old_tokens,
                                                  int suppressed_tokens) {
    ds4_kvstore_restore_suppressed_continued(kc, old_tokens, suppressed_tokens);
}

static void kv_cache_discard_failed_disk_entry(server *s, const char *path) {
    if (!s || !path) return;
    if (unlink(path) == 0) {
        server_log(DS4_LOG_KVCACHE,
                   "ds4-server: kv cache discarded reason=prefill-failed file=%s",
                   path);
    } else if (errno != ENOENT) {
        server_log(DS4_LOG_WARNING,
                   "ds4-server: kv cache failed to discard prefill-failed file=%s: %s",
                   path, strerror(errno));
    }
    s->kv.continued_last_store_tokens = 0;
    ds4_session_invalidate(s->session);
}

static void kv_cache_maybe_store_continued(server *s) {
    kv_disk_cache *kc = &s->kv;
    const ds4_tokens *tokens = ds4_session_tokens(s->session);
    if (!tokens) return;
    const int target = kv_cache_continued_store_target(kc, tokens->len);
    if (target == 0) return;
    if (kv_cache_store_live_prefix(s, tokens, target, "continued")) {
        kv_cache_note_store(kc, target);
    }
}

#ifdef DS4_SERVER_TEST
static int kv_cache_find_text_prefix(kv_disk_cache *kc, const char *prompt_text,
                                     int quant_bits, int ctx_size) {
    return ds4_kvstore_find_text_prefix(kc, prompt_text, 0, quant_bits, ctx_size);
}
#endif

static int kv_cache_try_load_text(server *s, const char *prompt_text,
                                  ds4_tokens *effective_prompt,
                                  char **loaded_path_out,
                                  uint8_t *loaded_ext_flags_out,
                                  bool responses_protocol) {
    if (loaded_path_out) *loaded_path_out = NULL;
    if (loaded_ext_flags_out) *loaded_ext_flags_out = 0;
    ds4_kvstore_load_result lr = {0};
    ds4_kvstore_trailer_hooks hooks = kv_cache_tool_map_hooks(s, NULL);
    int loaded = ds4_kvstore_try_load_text(&s->kv, s->engine, s->session,
                                           prompt_text, effective_prompt, &lr,
                                           &hooks, responses_protocol);
    if (loaded > 0) {
        if (loaded_path_out && lr.path) *loaded_path_out = xstrdup(lr.path);
        if (loaded_ext_flags_out) *loaded_ext_flags_out = lr.ext_flags;
    }
    ds4_kvstore_load_result_free(&lr);
    return loaded;
}

static int kv_cache_try_load(server *s, const request *req,
                             ds4_tokens *effective_prompt,
                             char **loaded_path_out,
                             uint8_t *loaded_ext_flags_out) {
    return kv_cache_try_load_text(s, req ? req->prompt_text : NULL,
                                  effective_prompt,
                                  loaded_path_out,
                                  loaded_ext_flags_out,
                                  req && req->api == API_RESPONSES);
}

static int live_text_prefix_prompt(server *s, const request *req,
                                   ds4_tokens *effective_prompt) {
    if (!s || !req || !req->prompt_text || !effective_prompt) return 0;
    const ds4_tokens *live_tokens = ds4_session_tokens(s->session);
    if (!live_tokens || live_tokens->len <= 0) return 0;

    size_t live_text_len = 0;
    char *live_text = render_tokens_text(s->engine, live_tokens, &live_text_len);
    const size_t prompt_text_len = strlen(req->prompt_text);
    if (!byte_prefix_match(req->prompt_text, prompt_text_len,
                           live_text, live_text_len))
    {
        free(live_text);
        return 0;
    }

    /* This is the core text-prefix case.  The live graph is authoritative, so
     * keep its sampled tokenization and tokenize only the request bytes that
     * come after it.  Reusing req->prompt's token suffix would be wrong: full
     * prompt BPE may have merged across this byte boundary. */
    build_prompt_from_exact_prefix_and_text_suffix(
        s->engine, live_tokens, req->prompt_text + live_text_len,
        effective_prompt);
    free(live_text);
    return live_tokens->len;
}

/* Tool-output-only Responses continuation.
 *
 * Some clients send just the new tool outputs after a tool call.  There is no
 * long visible prefix to match in that shape; the call_id itself is the
 * protocol binding to the previous live assistant output.  Use it only when the
 * remembered live frontier and call-id set match exactly. */
static int responses_live_continuation_prompt(server *s, const request *req,
                                              int live_pos,
                                              ds4_tokens *effective_prompt,
                                              int *matched_ids) {
    if (!s || !req || !effective_prompt) return 0;
    if (req->api != API_RESPONSES || !req->responses_live_suffix_text) return 0;
    if (req->responses_live_call_ids.len == 0) return 0;
    if (!responses_live_matches_request(s, &req->responses_live_call_ids,
                                        live_pos)) return 0;

    const ds4_tokens *live_tokens = ds4_session_tokens(s->session);
    if (!live_tokens || live_tokens->len != live_pos) return 0;

    build_prompt_from_exact_prefix_and_text_suffix(
        s->engine, live_tokens, req->responses_live_suffix_text,
        effective_prompt);
    if (matched_ids) *matched_ids = req->responses_live_call_ids.len;
    return live_tokens->len;
}

/* Tool-result Anthropic continuation.
 *
 * /v1/messages has no server-side response object like the OpenAI Responses
 * API, but its tool_use_id is still a precise continuation handle inside a live
 * local agent loop.  When the IDs and live token frontier match, continue from
 * the sampled DSML state and append only the user tool_result suffix. */
static int anthropic_live_continuation_prompt(server *s, const request *req,
                                              int live_pos,
                                              ds4_tokens *effective_prompt,
                                              int *matched_ids) {
    if (!s || !req || !effective_prompt) return 0;
    if (req->api != API_ANTHROPIC || !req->anthropic_live_suffix_text) return 0;
    if (req->anthropic_live_call_ids.len == 0) return 0;
    if (!anthropic_live_matches_request(s, &req->anthropic_live_call_ids,
                                        live_pos)) return 0;

    const ds4_tokens *live_tokens = ds4_session_tokens(s->session);
    if (!live_tokens || live_tokens->len != live_pos) return 0;

    build_prompt_from_exact_prefix_and_text_suffix(
        s->engine, live_tokens, req->anthropic_live_suffix_text,
        effective_prompt);
    if (matched_ids) *matched_ids = req->anthropic_live_call_ids.len;
    return live_tokens->len;
}

/* Visible-replay Responses continuation.
 *
 * Other clients send the full visible transcript on every turn even though the
 * API semantics still make the request a continuation.  For Responses, exact
 * token-prefix matching is the wrong first question: hidden reasoning may be
 * live in KV but absent from the replay by design.  Instead, verify that the
 * request's rendered text begins with the visible transcript remembered at the
 * live frontier.  If it does, continue from the live token prefix and tokenize
 * only the bytes after that visible boundary.
 *
 * If this check fails, DS4 has no special Responses state to trust.  The caller
 * then uses normal token/text/disk matching, which is the correct fallback for
 * cold starts, edits, restarts, or cross-client replays. */
static int responses_live_visible_prefix_prompt(server *s, const request *req,
                                                int live_pos,
                                                ds4_tokens *effective_prompt) {
    if (!s || !req || !req->prompt_text || !effective_prompt) return 0;
    if (req->api != API_RESPONSES) return 0;

    const size_t prompt_len = strlen(req->prompt_text);
    size_t visible_len = 0;
    pthread_mutex_lock(&s->tool_mu);
    bool ok = s->responses_live.valid &&
              s->responses_live.live_tokens == live_pos &&
              s->responses_live.visible_text &&
              s->responses_live.visible_len < prompt_len &&
              byte_prefix_match(req->prompt_text, prompt_len,
                                s->responses_live.visible_text,
                                s->responses_live.visible_len);
    if (ok) visible_len = s->responses_live.visible_len;
    pthread_mutex_unlock(&s->tool_mu);
    if (!ok) return 0;

    const ds4_tokens *live_tokens = ds4_session_tokens(s->session);
    if (!live_tokens || live_tokens->len != live_pos) return 0;

    build_prompt_from_exact_prefix_and_text_suffix(
        s->engine, live_tokens, req->prompt_text + visible_len,
        effective_prompt);
    return live_tokens->len;
}

/* Tool-less thinking continuation.
 *
 * Chat/completions and Anthropic do not have a previous_response_id object that
 * binds a later request to the last sampled turn.  Still, after a normal
 * tool-less thinking answer, the next prompt renderer intentionally omits that
 * hidden reasoning.  The live KV state is richer than the visible transcript.
 *
 * Remembering the visible transcript as a key lets us keep the sampled hidden
 * KV when the next request clearly extends that same visible history.  This is
 * the same byte-prefix idea used by the disk cache: the client-visible text
 * selects the checkpoint, while the payload stays the exact sampled token
 * frontier.  If the visible key does not match, callers fall back to ordinary
 * token/text/disk matching. */
static int thinking_live_visible_prefix_prompt(server *s, const request *req,
                                               int live_pos,
                                               ds4_tokens *effective_prompt) {
    if (!s || !req || !req->prompt_text || !effective_prompt) return 0;
    if (req->kind != REQ_CHAT || req->api == API_RESPONSES) return 0;

    const size_t prompt_len = strlen(req->prompt_text);
    size_t visible_len = 0;
    pthread_mutex_lock(&s->tool_mu);
    bool ok = s->thinking_live.valid &&
              s->thinking_live.live_tokens == live_pos &&
              s->thinking_live.visible_text &&
              s->thinking_live.visible_len < prompt_len &&
              byte_prefix_match(req->prompt_text, prompt_len,
                                s->thinking_live.visible_text,
                                s->thinking_live.visible_len);
    if (ok) visible_len = s->thinking_live.visible_len;
    pthread_mutex_unlock(&s->tool_mu);
    if (!ok) return 0;

    const ds4_tokens *live_tokens = ds4_session_tokens(s->session);
    if (!live_tokens || live_tokens->len != live_pos) return 0;

    build_prompt_from_exact_prefix_and_text_suffix(
        s->engine, live_tokens, req->prompt_text + visible_len,
        effective_prompt);
    return live_tokens->len;
}

/* =========================================================================
 * Trace Diagnostics.
 * =========================================================================
 *
 * The human transcript is not enough to debug prompt-cache misses.  The model
 * may generate text that is semantically accepted as a tool call, while the
 * next OpenAI request re-renders a slightly different canonical DSML block.
 * That creates a token mismatch even if the conversation "looks" continuous.
 *
 * When --trace is enabled we therefore record the exact cache decision and a
 * small token window around the first mismatch between the live KV checkpoint
 * and the incoming prompt.  Normal server logs stay compact; trace files get
 * enough data to diagnose tokenizer-boundary and canonicalization problems.
 */

#define TRACE_CACHE_BEFORE 8
#define TRACE_CACHE_AFTER  8
#define TRACE_CACHE_WINDOW (TRACE_CACHE_BEFORE + 1 + TRACE_CACHE_AFTER)

typedef struct {
    bool valid;
    int old_pos;
    int prompt_len;
    int common;
    int start;
    int count;
    int live_id[TRACE_CACHE_WINDOW];
    int prompt_id[TRACE_CACHE_WINDOW];
} trace_cache_diag;

static void trace_cache_capture(
        trace_cache_diag *d,
        const ds4_tokens *live,
        const ds4_tokens *prompt,
        int old_pos,
        int common)
{
    memset(d, 0, sizeof(*d));
    d->valid = true;
    d->old_pos = old_pos;
    d->prompt_len = prompt ? prompt->len : 0;
    d->common = common;

    const int live_len = live ? live->len : 0;
    const int prompt_len = prompt ? prompt->len : 0;
    int max_len = live_len > prompt_len ? live_len : prompt_len;
    int start = common - TRACE_CACHE_BEFORE;
    if (start < 0) start = 0;
    int end = common + TRACE_CACHE_AFTER + 1;
    if (end > max_len) end = max_len;
    if (end < start) end = start;

    d->start = start;
    d->count = end - start;
    if (d->count > TRACE_CACHE_WINDOW) d->count = TRACE_CACHE_WINDOW;
    for (int i = 0; i < d->count; i++) {
        int pos = start + i;
        d->live_id[i] = live && pos < live->len ? live->v[pos] : -1;
        d->prompt_id[i] = prompt && pos < prompt->len ? prompt->v[pos] : -1;
    }
}

static const char *trace_cache_miss_reason(const trace_cache_diag *d) {
    if (!d || !d->valid) return "unknown";
    if (d->old_pos == 0) return "no-live-checkpoint";
    if (d->common != d->old_pos) return "token-mismatch";
    if (d->prompt_len < d->old_pos) return "incoming-prompt-shorter-than-live-checkpoint";
    return "live-prefix-match";
}

static void trace_write_escaped_bytes(FILE *fp, const char *p, size_t len) {
    static const char hex[] = "0123456789abcdef";
    fputc('"', fp);
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)p[i];
        if (c == '"' || c == '\\') {
            fputc('\\', fp);
            fputc((char)c, fp);
        } else if (c == '\n') {
            fputs("\\n", fp);
        } else if (c == '\r') {
            fputs("\\r", fp);
        } else if (c == '\t') {
            fputs("\\t", fp);
        } else if (c < 0x20 || c == 0x7f) {
            fputs("\\x", fp);
            fputc(hex[c >> 4], fp);
            fputc(hex[c & 15], fp);
        } else {
            fputc((char)c, fp);
        }
    }
    fputc('"', fp);
}

static void trace_write_token(FILE *fp, ds4_engine *engine, int token) {
    if (token < 0) {
        fputs("- <none>", fp);
        return;
    }
    size_t len = 0;
    char *piece = ds4_token_text(engine, token, &len);
    fprintf(fp, "%d ", token);
    trace_write_escaped_bytes(fp, piece, len);
    free(piece);
}

static void trace_write_cache_diag(
        server *s,
        const trace_cache_diag *d,
        const tool_replay_stats *tool_replay,
        int cached,
        const char *cache_source,
        int disk_cached,
        const char *disk_path)
{
    fprintf(s->trace,
            "\n--- cache decision ---\n"
            "live_tokens_before: %d\n"
            "prompt_tokens: %d\n"
            "live_prompt_common: %d\n"
            "memory_token_reusable: %d\n"
            "memory_miss_reason: %s\n"
            "tool_replay: mem=%d disk=%d canonical=%d missing_ids=%d\n"
            "cache_source: %s\n"
            "cached_tokens: %d\n"
            "disk_cached_tokens: %d\n",
            d && d->valid ? d->old_pos : 0,
            d && d->valid ? d->prompt_len : 0,
            d && d->valid ? d->common : 0,
            d && d->valid && d->old_pos > 0 &&
                d->common == d->old_pos && d->prompt_len >= d->old_pos ? 1 : 0,
            trace_cache_miss_reason(d),
            tool_replay ? tool_replay->mem : 0,
            tool_replay ? tool_replay->disk : 0,
            tool_replay ? tool_replay->canonical : 0,
            tool_replay ? tool_replay->missing_ids : 0,
            cache_source ? cache_source : "none",
            cached,
            disk_cached);
    if (disk_path && disk_path[0]) fprintf(s->trace, "disk_cache_file: %s\n", disk_path);

    if (!d || !d->valid || d->old_pos == 0 ||
        (d->common == d->old_pos && d->prompt_len >= d->old_pos))
    {
        return;
    }

    fprintf(s->trace,
            "\nfirst_mismatch_token: %d\n"
            "token_window: [%d..%d)\n",
            d->common,
            d->start,
            d->start + d->count);
    for (int i = 0; i < d->count; i++) {
        int pos = d->start + i;
        int live = d->live_id[i];
        int prompt = d->prompt_id[i];
        const char *mark;
        if (live < 0) mark = "prompt-only";
        else if (prompt < 0) mark = "live-only";
        else mark = live == prompt ? "==" : "!=";

        fprintf(s->trace, "%7d %-11s live ", pos, mark);
        trace_write_token(s->trace, s->engine, live);
        fputs(" | prompt ", s->trace);
        trace_write_token(s->trace, s->engine, prompt);
        fputc('\n', s->trace);
    }
}

static void trace_time(FILE *fp) {
    time_t now = time(NULL);
    struct tm tm;
    localtime_r(&now, &tm);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &tm);
    fputs(buf, fp);
}

static uint64_t trace_begin(
        server *s,
        const job *j,
        int cached,
        int effective_prompt_tokens,
        const trace_cache_diag *cache_diag,
        const char *cache_source,
        int disk_cached,
        const char *disk_path) {
    if (!s->trace) return 0;

    pthread_mutex_lock(&s->trace_mu);
    uint64_t id = ++s->trace_seq;
    fprintf(s->trace, "\n===== request %llu ", (unsigned long long)id);
    trace_time(s->trace);
    fprintf(s->trace,
            " =====\nkind: %s\nmodel: %s\nstream: %d\ntools: %d\nthink_mode: %s\nprompt_tokens: %d\neffective_prompt_tokens: %d\ncached_tokens: %d\nmax_tokens: %d\ntemperature: %.3f\ntop_k: %d\ntop_p: %.3f\nmin_p: %.3f\nseed: %llu\n",
            j->req.kind == REQ_CHAT ? "chat" : "completion",
            j->req.model ? j->req.model : "",
            j->req.stream ? 1 : 0,
            j->req.has_tools ? 1 : 0,
            ds4_think_mode_name(j->req.think_mode),
            j->req.prompt.len,
            effective_prompt_tokens,
            cached,
            j->req.max_tokens,
            j->req.temperature,
            j->req.top_k,
            j->req.top_p,
            j->req.min_p,
            (unsigned long long)j->req.seed);
    fprintf(s->trace, "stream_include_usage: %d\n",
            j->req.stream_include_usage ? 1 : 0);
    trace_write_cache_diag(s, cache_diag, &j->req.tool_replay, cached,
                           cache_source, disk_cached, disk_path);
    if (j->req.raw_body) {
        fputs("\n--- raw request json ---\n", s->trace);
        fputs(j->req.raw_body, s->trace);
        if (!j->req.raw_body[0] || j->req.raw_body[strlen(j->req.raw_body) - 1] != '\n') {
            fputc('\n', s->trace);
        }
    }
    if (j->req.prompt_text) {
        fputs("\n--- rendered prompt ---\n", s->trace);
        fputs(j->req.prompt_text, s->trace);
        if (!j->req.prompt_text[0] || j->req.prompt_text[strlen(j->req.prompt_text) - 1] != '\n') {
            fputc('\n', s->trace);
        }
    }
    fputs("\n--- generated text ---\n", s->trace);
    fflush(s->trace);
    pthread_mutex_unlock(&s->trace_mu);
    return id;
}

static void trace_piece(server *s, uint64_t id, const char *piece, size_t len) {
    if (!s->trace || !id || !piece || !len) return;
    pthread_mutex_lock(&s->trace_mu);
    fwrite(piece, 1, len, s->trace);
    fflush(s->trace);
    pthread_mutex_unlock(&s->trace_mu);
}

static void trace_event(server *s, uint64_t id, const char *fmt, ...) {
    if (!s->trace || !id) return;
    pthread_mutex_lock(&s->trace_mu);
    fputs("\n\n--- trace: ", s->trace);
    va_list ap;
    va_start(ap, fmt);
    vfprintf(s->trace, fmt, ap);
    va_end(ap);
    fputs(" ---\n\n", s->trace);
    fflush(s->trace);
    pthread_mutex_unlock(&s->trace_mu);
}

static void trace_finish(
        server *s,
        uint64_t id,
        const request *r,
        const char *final_finish,
        int completion,
        bool saw_tool_start,
        bool saw_tool_end,
        const char *parsed_content,
        const char *parsed_reasoning,
        const tool_calls *parsed_calls,
        double elapsed) {
    if (!s->trace || !id) return;

    pthread_mutex_lock(&s->trace_mu);
    fprintf(s->trace,
            "\n\n--- parsed message ---\nfinish: %s\ngenerated_tokens: %d\ndsml_start: %d\ndsml_end: %d\nelapsed_sec: %.3f\n",
            final_finish,
            completion,
            saw_tool_start ? 1 : 0,
            saw_tool_end ? 1 : 0,
            elapsed);
    if (r->kind == REQ_CHAT) {
        if (parsed_reasoning && parsed_reasoning[0]) {
            fputs("\nreasoning:\n", s->trace);
            fputs(parsed_reasoning, s->trace);
            fputc('\n', s->trace);
        }
        if (parsed_content && parsed_content[0]) {
            fputs("\ncontent:\n", s->trace);
            fputs(parsed_content, s->trace);
            fputc('\n', s->trace);
        }
        for (int i = 0; i < parsed_calls->len; i++) {
            const tool_call *tc = &parsed_calls->v[i];
            fprintf(s->trace, "\ntool_call[%d]:\nid: %s\nname: %s\narguments:\n%s\n",
                    i,
                    tc->id ? tc->id : "",
                    tc->name ? tc->name : "",
                    tc->arguments ? tc->arguments : "");
        }
    }
    fprintf(s->trace, "\n===== end request %llu =====\n", (unsigned long long)id);
    fflush(s->trace);
    pthread_mutex_unlock(&s->trace_mu);
}

typedef struct {
    server *srv;
    req_kind kind;
    int prompt_tokens;
    int cached_tokens;
    char ctx[48];
    const char *phase;
    bool has_tools;
    bool responses_protocol;
    double t0;
    double last_t;
    int last_current;
    bool seen;
    /* SSE keepalive during long prefill: send HTTP/SSE headers ahead of
     * generation and emit a `:` comment line every few seconds so HTTP/TCP
     * idle timeouts on the client side don't close the connection while the
     * server is busy doing prefill. */
    int fd;
    bool stream;
    bool enable_cors;
    bool headers_sent;
    bool stream_failed;
    double last_keepalive;
} server_prefill_progress;

static void request_ctx_span(char *buf, size_t len, int cached, int prompt) {
    int suffix = prompt - cached;
    if (suffix < 0) suffix = 0;
    snprintf(buf, len, "%d..%d:%d", cached, prompt, suffix);
}

static void log_flags(char *buf, size_t len, bool responses_protocol,
                      bool tools, bool thinking,
                      bool dsml_start, bool dsml_end) {
    size_t used = 0;
    buf[0] = '\0';
#define ADD_FLAG(name) do { \
    int n = snprintf(buf + used, used < len ? len - used : 0, "%s%s", used ? " " : "", name); \
    if (n > 0) used += (size_t)n; \
} while (0)
    if (responses_protocol) ADD_FLAG("RESPPROTO");
    if (tools) ADD_FLAG("TOOLS");
    if (thinking) ADD_FLAG("THINKING");
    if (dsml_start) ADD_FLAG("DSML_START");
    if (dsml_end) ADD_FLAG("DSML_END");
#undef ADD_FLAG
}

static void log_decode_progress(req_kind kind, int prompt_tokens, int completion,
                                bool responses_protocol,
                                bool tools, bool thinking,
                                bool dsml_start, bool dsml_end,
                                double decode_t0,
                                double *last_t, int *last_completion) {
    const double now = now_sec();
    const double elapsed = now - decode_t0;
    const double interval_s = now - *last_t;
    const int interval_tokens = completion - *last_completion;
    const double chunk_tps = interval_s > 0.0 ? (double)interval_tokens / interval_s : 0.0;
    const double avg_tps = elapsed > 0.0 ? (double)completion / elapsed : 0.0;
    char ctx[48];
    request_ctx_span(ctx, sizeof(ctx),
                     prompt_tokens + *last_completion,
                     prompt_tokens + completion);
    char flags[80];
    log_flags(flags, sizeof(flags), responses_protocol,
              tools, thinking, dsml_start, dsml_end);
    server_log(DS4_LOG_GENERATION,
               "ds4-server: %s ctx=%s gen=%d%s%s decoding chunk=%.2f t/s avg=%.2f t/s %.3fs",
               kind == REQ_CHAT ? "chat" : "completion",
               ctx,
               completion,
               flags[0] ? " " : "",
               flags,
               chunk_tps,
               avg_tps,
               elapsed);
    *last_t = now;
    *last_completion = completion;
}

typedef struct {
    bool inside;
    char tail[8]; /* Long enough for "</think>". */
    int tail_len;
} thinking_state;

static bool thinking_tail_ends_with(const thinking_state *st, const char *s) {
    int n = (int)strlen(s);
    return st->tail_len >= n && !memcmp(st->tail + st->tail_len - n, s, (size_t)n);
}

static void thinking_state_feed(thinking_state *st, const char *p, size_t len) {
    if (!st || !p) return;
    for (size_t i = 0; i < len; i++) {
        if (st->tail_len == (int)sizeof(st->tail)) {
            memmove(st->tail, st->tail + 1, sizeof(st->tail) - 1);
            st->tail_len--;
        }
        st->tail[st->tail_len++] = p[i];
        if (thinking_tail_ends_with(st, "<think>")) st->inside = true;
        else if (thinking_tail_ends_with(st, "</think>")) st->inside = false;
    }
}

static thinking_state thinking_state_from_prompt(const request *r) {
    thinking_state st = {0};
    if (r && r->prompt_text) {
        thinking_state_feed(&st, r->prompt_text, strlen(r->prompt_text));
    } else if (r && ds4_think_mode_enabled(r->think_mode)) {
        st.inside = true;
    }
    return st;
}

/* Live recovery for a tool call started inside an unclosed <think> block.
 *
 * The model sometimes opens a DSML stanza without closing its thinking first.
 * Waiting for a </think> that never comes stalls the turn: the marker is never
 * scanned as executable and the block is dropped at parse time.  Instead of
 * rewriting sampled context, recover forward: force-feed "</think>" plus a
 * blank line and let the model continue.  Measured on the real model, that
 * position predicts a fresh stanza opening so strongly that the model
 * restarts the call cleanly on the executable side of the close.  Re-emitting
 * the stanza opening ourselves was tried and is counterproductive: with the
 * dangling opening right before the close and a forced copy right after it,
 * the model reads the call as already made and ends the turn.  The dangling
 * opening stays harmlessly inside reasoning.
 *
 * Detection works on accumulated text, so the tokenization of the marker does
 * not matter, and it triggers only on a complete stanza opening: a lone "<"
 * or a partial marker keeps decoding untouched, while *scan_from holds back
 * far enough that an opening split across future tokens is still seen from
 * its first byte.  The forced text is tokenized with the rendered-chat
 * tokenizer so </think> maps to its special token.
 *
 * Returns 1 when an injection was performed (text extended, thinking closed),
 * 0 when there is nothing to do or no budget, -1 on eval failure. */
static int chat_think_tool_recovery(server *s,
                                    buf *text,
                                    thinking_state *thinking,
                                    size_t *scan_from,
                                    int *completion,
                                    int max_tokens,
                                    char *err,
                                    size_t errlen) {
    if (!thinking->inside || !text->ptr) return 0;
    if (*scan_from > text->len) *scan_from = text->len;
    if (!find_any_tool_start(text->ptr + *scan_from)) {
        const size_t hold = 80; /* > longest stanza opening */
        *scan_from = text->len > hold ? text->len - hold : 0;
        return 0;
    }

    const char *inject = "</think>\n\n";
    const size_t inject_len = strlen(inject);
    ds4_tokens toks = {0};
    ds4_tokenize_rendered_chat(s->engine, inject, &toks);

    const int room = ds4_session_ctx(s->session) - ds4_session_pos(s->session);
    if (toks.len <= 0 ||
        toks.len >= room ||
        *completion + toks.len >= max_tokens) {
        /* Not enough budget to recover; leave the stream as generated and let
         * the parse-time fallback deal with it.  Skip past this marker so the
         * scan does not retry it every token. */
        ds4_tokens_free(&toks);
        *scan_from = text->len;
        return 0;
    }

    for (int i = 0; i < toks.len; i++) {
        if (ds4_session_eval(s->session, toks.v[i], err, errlen) != 0) {
            ds4_tokens_free(&toks);
            return -1;
        }
        (*completion)++;
    }
    buf_append(text, inject, inject_len);
    thinking_state_feed(thinking, inject, inject_len);
    *scan_from = text->len;
    ds4_tokens_free(&toks);
    return 1;
}

static char *rendered_chat_system_region(const char *prompt_text) {
    if (!prompt_text) return xstrdup("");
    const char *p = prompt_text;
    const char *bos = "<｜begin▁of▁sentence｜>";
    const size_t bos_len = strlen(bos);
    if (!strncmp(p, bos, bos_len)) p += bos_len;
    const char *max_prefix = ds4_think_max_prefix();
    const size_t max_prefix_len = strlen(max_prefix);
    if (max_prefix_len && !strncmp(p, max_prefix, max_prefix_len)) {
        p += max_prefix_len;
    }
    while (*p && isspace((unsigned char)*p)) p++;

    const char *user = strstr(p, "<｜User｜>");
    const char *assistant = strstr(p, "<｜Assistant｜>");
    const char *end = NULL;
    if (user && assistant) end = user < assistant ? user : assistant;
    else end = user ? user : assistant;
    if (!end) end = p + strlen(p);
    while (end > p && isspace((unsigned char)end[-1])) end--;
    return xstrndup(p, (size_t)(end - p));
}

static char *build_invalid_dsml_tool_error_suffix(const request *r,
                                                  const thinking_state *thinking,
                                                  const char *detail) {
    char *system = rendered_chat_system_region(r ? r->prompt_text : NULL);
    buf tool_error = {0};
    buf_puts(&tool_error, "Tool error: invalid DSML tool call");
    if (detail && detail[0]) {
        buf_puts(&tool_error, ": ");
        buf_puts(&tool_error, detail);
    }
    buf_puts(&tool_error,
             "\nThe previous assistant output was not executed because the DSML syntax was malformed. "
             "Emit a new valid DSML tool call, or answer normally if no tool is needed.");
    if (system && system[0]) {
        buf_puts(&tool_error, "\n\nSystem prompt reminder:\n");
        buf_puts(&tool_error, system);
    }

    buf suffix = {0};
    if (r && ds4_think_mode_enabled(r->think_mode) && thinking && thinking->inside) {
        buf_puts(&suffix, "</think>");
    }
    buf_puts(&suffix, "<｜end▁of▁sentence｜><｜User｜><tool_result>");
    append_tool_result_text(&suffix, tool_error.ptr ? tool_error.ptr : "");
    buf_puts(&suffix, "</tool_result><｜Assistant｜>");
    buf_puts(&suffix, r && ds4_think_mode_enabled(r->think_mode) ? "<think>" : "</think>");

    free(system);
    buf_free(&tool_error);
    return buf_take(&suffix);
}

static bool append_rendered_suffix_to_live_session(server *s, const char *suffix,
                                                   int *tokens_appended,
                                                   char *err, size_t errlen) {
    if (tokens_appended) *tokens_appended = 0;
    if (!s || !suffix || !suffix[0]) return true;
    const ds4_tokens *live = ds4_session_tokens(s->session);
    if (!live) {
        if (err && errlen) snprintf(err, errlen, "live session is unavailable");
        return false;
    }

    ds4_tokens target = {0};
    build_prompt_from_exact_prefix_and_text_suffix(s->engine, live, suffix, &target);
    const int before = ds4_session_pos(s->session);
    bool ok = ds4_session_sync(s->session, &target, err, errlen) == 0;
    if (ok && tokens_appended) {
        int delta = ds4_session_pos(s->session) - before;
        *tokens_appended = delta > 0 ? delta : 0;
    }
    ds4_tokens_free(&target);
    return ok;
}

static bool continue_after_invalid_dsml(server *s, const request *r,
                                        const thinking_state *thinking,
                                        const char *detail,
                                        int *tokens_appended,
                                        char *err, size_t errlen) {
    char *suffix = build_invalid_dsml_tool_error_suffix(r, thinking, detail);
    bool ok = append_rendered_suffix_to_live_session(s, suffix,
                                                     tokens_appended,
                                                     err, errlen);
    free(suffix);
    return ok;
}

static bool should_remember_thinking_checkpoint(const request *r,
                                                const thinking_state *thinking,
                                                const char *finish) {
    if (!r || r->kind != REQ_CHAT || r->has_tools) return false;
    if (r->prompt_preserves_reasoning) return false;
    if (!ds4_think_mode_enabled(r->think_mode)) return false;
    if (finish && (!strcmp(finish, "error") || !strcmp(finish, "length"))) return false;
    if (thinking && thinking->inside) return false;
    return true;
}

static void log_tool_calls_summary(const char *ctx, const tool_calls *calls,
                                   bool responses_protocol) {
    if (!calls || calls->len == 0) return;
    buf names = {0};
    buf ids = {0};
    for (int i = 0; i < calls->len; i++) {
        if (i) buf_putc(&names, ',');
        if (i) buf_putc(&ids, ',');
        buf_puts(&names, calls->v[i].name ? calls->v[i].name : "?");
        buf_puts(&ids, calls->v[i].id ? calls->v[i].id : "?");
    }
    char flags[32];
    log_flags(flags, sizeof(flags), responses_protocol, false, false, false, false);
    server_log(DS4_LOG_TOOL,
               "ds4-server: tool calls ctx=%s%s%s n=%d raw_dsml=%d ids=[%s] names=[%s]",
               ctx,
               flags[0] ? " " : "",
               flags,
               calls->len,
               calls->raw_dsml && calls->raw_dsml[0] ? 1 : 0,
               ids.ptr ? ids.ptr : "",
               names.ptr ? names.ptr : "");
    buf_free(&ids);
    buf_free(&names);
}

static void server_progress_cb(void *ud, const char *event, int current, int total) {
    server_prefill_progress *p = ud;
    if (!p || !event) return;
    const bool is_chunk = strcmp(event, "prefill_chunk") == 0;
    const bool is_display = strcmp(event, "prefill_display") == 0;
    if (!is_chunk && !is_display) return;

    double now = now_sec();
    /* Keep the HTTP/SSE connection alive while prefill runs.  We write the SSE
     * response headers the first time the callback fires and then emit a
     * comment line (`:` prefix, ignored by SSE clients) every few seconds.
     * Best-effort: if the client has already gone away, the writes fail
     * silently and the outer code will discover the closed socket the next
     * time it tries to stream a real event. */
    if (p->stream && p->fd >= 0 && !p->stream_failed) {
        if (!p->headers_sent) {
            p->headers_sent = true;
            if (sse_headers(p->fd, p->enable_cors)) {
                p->last_keepalive = now;
            } else {
                p->stream_failed = true;
            }
        } else if (now - p->last_keepalive >= 5.0) {
            static const char ka[] = ": prefill\n\n";
            if (send_all(p->fd, ka, sizeof(ka) - 1)) {
                p->last_keepalive = now;
            } else {
                p->stream_failed = true;
            }
        }
    }
    if (is_display) return;
    double elapsed = now - p->t0;
    if (p->seen && current == p->last_current) {
        if (p->srv && current > p->cached_tokens) {
            kv_cache_maybe_store_continued(p->srv);
        }
        return;
    }
    int display_start = p->cached_tokens;
    if (display_start < 0 || display_start > p->prompt_tokens) display_start = 0;
    int display_total = p->prompt_tokens - display_start;
    if (display_total <= 0) {
        display_start = 0;
        display_total = p->prompt_tokens > total ? p->prompt_tokens : total;
    }
    int display_current = current - display_start;
    if (display_current < 0) display_current = 0;
    if (display_current > display_total) display_current = display_total;
    double pct = display_total > 0 ? 100.0 * (double)display_current / (double)display_total : 100.0;
    double avg_tps = elapsed > 0.0 ? (double)display_current / elapsed : 0.0;
    int interval_tokens = p->seen ? current - p->last_current : 0;
    if (interval_tokens < 0) interval_tokens = 0;
    double interval_s = p->seen ? now - p->last_t : 0.0;
    double chunk_tps = interval_s > 0.0 ? (double)interval_tokens / interval_s : 0.0;
    p->last_current = current;
    p->last_t = now;
    p->seen = true;
    char flags[64];
    log_flags(flags, sizeof(flags), p->responses_protocol,
              p->has_tools, false, false, false);
    const char *phase = p->phase ? p->phase : "prefill";
    server_log(DS4_LOG_PREFILL,
               "ds4-server: %s ctx=%s%s%s %s chunk %d/%d (%.1f%%) chunk=%.2f t/s avg=%.2f t/s %.3fs",
               p->kind == REQ_CHAT ? "chat" : "completion",
               p->ctx,
               flags[0] ? " " : "",
               flags,
               phase,
               display_current,
               display_total,
               pct,
               chunk_tps,
               avg_tps,
               elapsed);
    if (p->srv && current > p->cached_tokens) {
        kv_cache_maybe_store_continued(p->srv);
    }
}

static void send_prefill_failure_response(server *s, const job *j,
                                          const server_prefill_progress *progress,
                                          const char *ctx, const char *flags,
                                          const char *err) {
    const char *kind = j->req.kind == REQ_CHAT ? "chat" : "completion";
    if (j->req.stream && progress && progress->headers_sent) {
        if (progress->stream_failed) {
            server_log(DS4_LOG_GENERATION,
                       "ds4-server: %s ctx=%s%s%s prefill failed after stream closed: %s",
                       kind, ctx, flags && flags[0] ? " " : "",
                       flags && flags[0] ? flags : "", err);
            return;
        }
        if (!sse_error_event(j->fd, &j->req, err)) {
            server_log(DS4_LOG_GENERATION,
                       "ds4-server: %s ctx=%s%s%s prefill SSE error failed: %s",
                       kind, ctx, flags && flags[0] ? " " : "",
                       flags && flags[0] ? flags : "", err);
        }
        return;
    }
    http_error(j->fd, s->enable_cors, 500, err);
}

static char *build_tool_checkpoint_suffix(const request *r, const char *content,
                                          const char *reasoning, const tool_calls *calls) {
    buf suffix = {0};
    if (ds4_think_mode_enabled(r->think_mode)) {
        buf_puts(&suffix, reasoning ? reasoning : "");
        buf_puts(&suffix, "</think>");
    }
    buf_puts(&suffix, content ? content : "");
    append_dsml_tool_calls_text(&suffix, calls);
    buf_puts(&suffix, "<｜end▁of▁sentence｜>");
    return buf_take(&suffix);
}

static char *build_responses_visible_assistant_suffix(const request *r,
                                                      const char *content,
                                                      const char *reasoning,
                                                      const tool_calls *calls) {
    buf suffix = {0};
    /* This suffix mirrors what a Responses client can replay, not necessarily
     * every token in KV.  Hidden reasoning stays live in the session unless the
     * next client replay is expected to include it.  In practice, pi replays
     * reasoning summaries for tool-call turns, but not for final assistant
     * answers; Codex currently requests no summaries at all.  So only include
     * reasoning in the remembered visible prefix when this assistant turn ended
     * in tool calls.  A client that does replay final-answer reasoning will not
     * match this visible shortcut and can still use exact token-prefix replay. */
    if (ds4_think_mode_enabled(r->think_mode)) {
        if (r->reasoning_summary_emit && calls && calls->len > 0) {
            buf_puts(&suffix, reasoning ? reasoning : "");
        }
        buf_puts(&suffix, "</think>");
    }
    buf_puts(&suffix, content ? content : "");
    append_dsml_tool_calls_text(&suffix, calls);
    buf_puts(&suffix, "<｜end▁of▁sentence｜>");
    return buf_take(&suffix);
}

/* In thinking mode without tools, old assistant reasoning is intentionally not
 * rendered back into later prompts.  The sampled live graph still contains the
 * reasoning bytes, so the next request would miss the session cache even though
 * the visible conversation prefix is logically the same.
 *
 *   prompt-without-final-<think> + </think> + visible-content + eos
 *
 * is exactly the visible prefix that render_chat_prompt_text() will produce on
 * the next turn.  Do not rebuild the KV cache to erase hidden reasoning here:
 * that caused long post-answer pauses and threw away useful sampled state.
 * Instead, remember the visible bytes as a key for the current sampled frontier.
 * The next request can then continue from live KV while tokenizing only the new
 * visible suffix. */
static char *build_toolless_thinking_visible_text(const request *r,
                                                  const char *content) {
    if (!r || !r->prompt_text) return NULL;
    if (!ds4_think_mode_enabled(r->think_mode)) return NULL;

    size_t pt_len = strlen(r->prompt_text);
    const char *think_tag = "<think>";
    size_t tag_len = strlen(think_tag);
    if (pt_len < tag_len ||
        memcmp(r->prompt_text + pt_len - tag_len, think_tag, tag_len) != 0) {
        return NULL;
    }

    buf visible = {0};
    buf_append(&visible, r->prompt_text, pt_len - tag_len);
    buf_puts(&visible, "</think>");
    buf_puts(&visible, content ? content : "");
    buf_puts(&visible, "<｜end▁of▁sentence｜>");
    return buf_take(&visible);
}

static void remember_thinking_checkpoint(server *s, const job *j, const char *ctx,
                                         uint64_t trace_id, const char *content) {
    char *visible = build_toolless_thinking_visible_text(&j->req, content);
    if (!visible) return;

    thinking_live_remember(s, visible);
    server_log(DS4_LOG_KVCACHE,
               "ds4-server: thinking live checkpoint remembered ctx=%s live=%d visible=%zu",
               ctx, ds4_session_pos(s->session), strlen(visible));
    trace_event(s, trace_id,
                "thinking live checkpoint remembered: live=%d visible=%zu",
                ds4_session_pos(s->session), strlen(visible));
    free(visible);
}

/* After a successful tool-call finish, make the live checkpoint match what the
 * next request will render.  Usually that is just the exact DSML remembered by
 * tool id.  If a client sends a tool call without an id we know, the fallback
 * renderer still builds valid DSML from JSON, and this function either rewrites
 * the short suffix in place or reloads an older disk checkpoint before replay. */
static void canonicalize_tool_checkpoint(server *s, const job *j, const char *ctx,
                                         uint64_t trace_id, const char *content,
                                         const char *reasoning, const tool_calls *calls) {
    if (!calls || calls->len == 0 || !j->req.prompt_text) return;

    char *suffix_text = build_tool_checkpoint_suffix(&j->req, content, reasoning, calls);

    buf rendered = {0};
    buf_puts(&rendered, j->req.prompt_text);
    buf_puts(&rendered, suffix_text);

    ds4_tokens canonical = {0};
    ds4_tokenize_rendered_chat(s->engine, rendered.ptr ? rendered.ptr : "", &canonical);
    const int live_len = ds4_session_pos(s->session);
    const int common = ds4_session_common_prefix(s->session, &canonical);
    if (common == live_len && canonical.len == live_len) goto done;

    size_t live_text_len = 0;
    char *live_text = render_tokens_text(s->engine, ds4_session_tokens(s->session), &live_text_len);
    if (live_text_len == rendered.len &&
        (live_text_len == 0 || memcmp(live_text, rendered.ptr, live_text_len) == 0))
    {
        /* The graph already represents the bytes the next request will render.
         * Token-level canonicalization would only replace a valid sampled
         * history with a different BPE spelling of the same transcript. */
        free(live_text);
        goto done;
    }
    free(live_text);

    if (common < j->req.prompt.len) {
        trace_event(s, trace_id,
                    "tool checkpoint canonicalization skipped: common=%d prompt=%d live=%d canonical=%d",
                    common, j->req.prompt.len, live_len, canonical.len);
        goto done;
    }

    char err[160] = {0};
    ds4_session_rewrite_result rr =
        ds4_session_rewrite_from_common(s->session, &canonical, common,
                                        err, sizeof(err));
    if (rr == DS4_SESSION_REWRITE_OK) {
        server_log(DS4_LOG_KVCACHE,
                   "ds4-server: tool checkpoint canonicalized ctx=%s common=%d live=%d canonical=%d",
                   ctx, common, live_len, canonical.len);
        trace_event(s, trace_id,
                    "tool checkpoint canonicalized: common=%d live=%d canonical=%d",
                    common, live_len, canonical.len);
    } else if (rr == DS4_SESSION_REWRITE_REBUILD_NEEDED) {
        /* The generated DSML suffix and the canonical prompt share a prefix,
         * but the generated tail is too large to overwrite safely inside the
         * live raw-window ring.  Prefer an older disk checkpoint over replaying
         * a very long conversation from token zero. */
        char *path = NULL;
        ds4_tokens effective = {0};
        int loaded = kv_cache_try_load_text(s, rendered.ptr ? rendered.ptr : "",
                                            &effective, &path, NULL, false);
        if (loaded == 0) ds4_session_invalidate(s->session);

        char sync_err[160] = {0};
        const ds4_tokens *sync_prompt = loaded > 0 ? &effective : &canonical;
        char rebuild_ctx[48];
        request_ctx_span(rebuild_ctx, sizeof(rebuild_ctx), loaded, sync_prompt->len);
        int replay_tokens = sync_prompt->len - loaded;
        if (replay_tokens < 0) replay_tokens = sync_prompt->len;
        int canonical_tail_tokens = canonical.len - common;
        if (canonical_tail_tokens < 0) canonical_tail_tokens = canonical.len;
        int discarded_live_tokens = live_len - common;
        if (discarded_live_tokens < 0) discarded_live_tokens = 0;
        const char *source = loaded > 0 ? "disk" : "full";
        const double rebuild_t0 = now_sec();
        server_log(DS4_LOG_KVCACHE,
                   "ds4-server: tool checkpoint canonicalization needs %d tokens rebuild ctx=%s request_ctx=%s reason=canonical-tail-rewrite tail=%d discard=%d common=%d live=%d target=%d cached=%d source=%s%s%s",
                   replay_tokens,
                   rebuild_ctx,
                   ctx,
                   canonical_tail_tokens,
                   discarded_live_tokens,
                   common,
                   live_len,
                   canonical.len,
                   loaded,
                   source,
                   path ? " file=" : "",
                   path ? path : "");
        server_prefill_progress rebuild_progress = {
            .srv = s,
            .kind = j->req.kind,
            .prompt_tokens = sync_prompt->len,
            .cached_tokens = loaded,
            .phase = "tool checkpoint rebuild",
            .has_tools = j->req.has_tools,
            .t0 = rebuild_t0,
            .fd = j->fd,
            .stream = j->req.stream,
            .enable_cors = s->enable_cors,
            /* Tool checkpoint rebuild only runs after the response stream is
             * already in flight, so the SSE headers were sent long ago.
             * Pre-arm the flag so the progress callback only emits keepalive
             * comments and never tries to write a second set of headers. */
            .headers_sent = true,
        };
        snprintf(rebuild_progress.ctx, sizeof(rebuild_progress.ctx), "%s", rebuild_ctx);
        ds4_session_set_progress(s->session, server_progress_cb, &rebuild_progress);
        ds4_session_set_display_progress(s->session, server_progress_cb, &rebuild_progress);
        if (ds4_session_sync(s->session, sync_prompt, sync_err, sizeof(sync_err)) == 0) {
            ds4_session_set_progress(s->session, NULL, NULL);
            ds4_session_set_display_progress(s->session, NULL, NULL);
            const double rebuild_sec = now_sec() - rebuild_t0;
            if (loaded > 0) {
                server_log(DS4_LOG_KVCACHE,
                           "ds4-server: tool checkpoint rebuild done ctx=%s request_ctx=%s source=disk cached=%d replay=%d target=%d %.3fs",
                           rebuild_ctx, ctx, loaded, replay_tokens, canonical.len, rebuild_sec);
                trace_event(s, trace_id,
                            "tool checkpoint canonicalized via disk: common=%d live=%d canonical=%d cached=%d file=%s",
                            common, live_len, canonical.len, loaded, path ? path : "");
            } else {
                server_log(DS4_LOG_KVCACHE,
                           "ds4-server: tool checkpoint rebuild done ctx=%s request_ctx=%s source=full cached=0 replay=%d target=%d %.3fs",
                           rebuild_ctx, ctx, replay_tokens, canonical.len, rebuild_sec);
                trace_event(s, trace_id,
                            "tool checkpoint canonicalized via rebuild: common=%d live=%d canonical=%d reason=%s",
                            common, live_len, canonical.len, err);
            }
        } else {
            ds4_session_set_progress(s->session, NULL, NULL);
            ds4_session_set_display_progress(s->session, NULL, NULL);
            server_log(DS4_LOG_KVCACHE,
                       "ds4-server: tool checkpoint rebuild failed ctx=%s request_ctx=%s source=%s cached=%d replay=%d target=%d error=\"%s\"",
                       rebuild_ctx, ctx, source, loaded, replay_tokens,
                       canonical.len, sync_err);
            trace_event(s, trace_id, "tool checkpoint canonicalization failed after rebuild request: %s", sync_err);
        }
        ds4_tokens_free(&effective);
        free(path);
    } else {
        server_log(DS4_LOG_KVCACHE,
                   "ds4-server: tool checkpoint canonicalization failed ctx=%s common=%d live=%d canonical=%d error=\"%s\"",
                   ctx, common, live_len, canonical.len, err);
        trace_event(s, trace_id, "tool checkpoint canonicalization failed: %s", err);
    }

done:
    ds4_tokens_free(&canonical);
    buf_free(&rendered);
    free(suffix_text);
}

static bool should_canonicalize_tool_checkpoint(const server *s, const tool_calls *calls) {
    if (!calls || calls->len == 0) return false;
    if (s && !s->disable_exact_dsml_tool_replay &&
        calls->raw_dsml && calls->raw_dsml[0])
    {
        return false;
    }
    return true;
}

/* Execute one request on the worker-owned session.
 *
 * Clients resend full prompts as text.  The worker first tries the old exact
 * token-prefix hit, then a rendered-text prefix hit for the live checkpoint,
 * then disk text-prefix restart snapshots, then a cold prefill.  On text-prefix
 * hits we build a fresh effective prompt from the checkpoint's exact token
 * history plus a newly tokenized string suffix; the canonical full-prompt
 * tokens are not sliced because BPE may merge across the byte boundary.  Cold
 * prompt caching is handled before generation: if the stable checkpoint is
 * shorter than the full prompt, we prefill to that boundary, store it, and
 * immediately continue to the real prompt.  The live graph therefore always
 * moves forward. */
static void generate_job(server *s, job *j) {
    char err[160];
    err[0] = '\0';
    const int old_pos = ds4_session_pos(s->session);
    const int common = ds4_session_common_prefix(s->session, &j->req.prompt);
    trace_cache_diag cache_diag = {0};
    trace_cache_capture(&cache_diag, ds4_session_tokens(s->session),
                        &j->req.prompt, old_pos, common);
    ds4_tokens effective_prompt = {0};
    const ds4_tokens *prompt_for_sync = &j->req.prompt;
    const bool responses_protocol = j->req.api == API_RESPONSES;
    bool responses_live_continuation = false;
    bool anthropic_live_continuation = false;
    bool thinking_live_continuation = false;
    const char *responses_live_match = NULL;
    int responses_live_match_ids = 0;
    int anthropic_live_match_ids = 0;
    /* Responses gets the first chance to continue from live state.  This is
     * the whole point of the API shape: a request that is bound to prior live
     * output by visible transcript or tool call ids does not need to prove an
     * exact token-prefix match.  Exact token/text/disk matching remains the
     * fallback when the live state is absent or no longer describes the
     * request. */
    int cached = responses_live_visible_prefix_prompt(s, &j->req, old_pos,
                                                      &effective_prompt);
    const char *cache_source = cached > 0 ? "responses-visible" : "none";
    if (cached > 0) {
        responses_live_match = "visible-prefix";
        if (responses_live_matches_request(s, &j->req.responses_live_call_ids,
                                           old_pos))
        {
            responses_live_match_ids = j->req.responses_live_call_ids.len;
        }
    }
    if (cached == 0) {
        cached = responses_live_continuation_prompt(s, &j->req, old_pos,
                                                    &effective_prompt,
                                                    &responses_live_match_ids);
        cache_source = cached > 0 ? "responses-tool-output" : "none";
        if (cached > 0) responses_live_match = "tool-output-ids";
    }
    if (cached > 0) {
        responses_live_continuation = true;
        prompt_for_sync = &effective_prompt;
    } else {
        cached = anthropic_live_continuation_prompt(s, &j->req, old_pos,
                                                    &effective_prompt,
                                                    &anthropic_live_match_ids);
        if (cached > 0) {
            anthropic_live_continuation = true;
            cache_source = "anthropic-tool-output";
            prompt_for_sync = &effective_prompt;
        }
    }
    if (cached == 0 && responses_protocol &&
        j->req.responses_requires_live_tool_state)
    {
        /* The parser saw a valid live call_id, but by worker execution time the
         * live frontier no longer matches.  Since the request did not replay
         * the prior assistant call, there is no stateless prefix to match and
         * no disk key to search by. */
        ds4_tokens_free(&effective_prompt);
        http_error(j->fd, s->enable_cors, 409,
                   "Responses continuation state is not available; retry by replaying the full input history");
        return;
    } else if (cached == 0 && j->req.api == API_ANTHROPIC &&
               j->req.anthropic_requires_live_tool_state)
    {
        ds4_tokens_free(&effective_prompt);
        http_error(j->fd, s->enable_cors, 409,
                   "Anthropic continuation state is not available; retry by replaying the full messages history");
        return;
    } else if (cached == 0) {
        cached = common == old_pos && j->req.prompt.len >= old_pos ? common : 0;
        cache_source = cached > 0 ? "memory-token" : "none";
    }
    if (cached == 0) {
        int thinking_cached =
            thinking_live_visible_prefix_prompt(s, &j->req, old_pos,
                                                &effective_prompt);
        if (thinking_cached > 0) {
            cached = thinking_cached;
            cache_source = "thinking-visible";
            thinking_live_continuation = true;
            prompt_for_sync = &effective_prompt;
        }
    }
    int disk_cached = 0;
    char *disk_cache_path = NULL;
    uint8_t disk_cache_ext_flags = 0;
    if (cached == 0) {
        int text_cached = live_text_prefix_prompt(s, &j->req, &effective_prompt);
        if (text_cached > 0) {
            cached = text_cached;
            cache_source = "memory-text";
            prompt_for_sync = &effective_prompt;
        }
    }
    if (cached == 0 && old_pos > 0) {
        server_log(DS4_LOG_WARNING,
                   "ds4-server: live kv cache miss%s live=%d prompt=%d common=%d reason=%s",
                   responses_protocol ? " RESPPROTO" : "",
                   old_pos, j->req.prompt.len, common,
                   trace_cache_miss_reason(&cache_diag));
    }
    if (cached == 0) s->kv.continued_last_store_tokens = 0;
    if (s->kv.enabled && cached == 0 && old_pos >= s->kv.opt.min_tokens) {
        /* Loading a disk snapshot replaces the live Metal session.  Persist the
         * current checkpoint first, otherwise a cache hit for an older prefix
         * would silently discard the newer conversation state. */
        kv_cache_store_current(s, "evict");
    }
    if (cached == 0) {
        disk_cached = kv_cache_try_load(s, &j->req, &effective_prompt,
                                        &disk_cache_path,
                                        &disk_cache_ext_flags);
        if (disk_cached > 0) {
            cached = disk_cached;
            cache_source = "disk-text";
            prompt_for_sync = &effective_prompt;
        }
    }
    const bool responses_reasoning_state_preserved =
        cached > 0 &&
        ((!strcmp(cache_source, "responses-visible") ||
          !strcmp(cache_source, "responses-tool-output")) ||
         (!strcmp(cache_source, "disk-text") &&
          (disk_cache_ext_flags & KV_EXT_RESPONSES_VISIBLE)));
    const bool responses_visible_replay_without_reasoning =
        responses_protocol &&
        j->req.responses_requires_live_reasoning &&
        !responses_reasoning_state_preserved;
    const int prompt_tokens = prompt_for_sync->len;
    /* OpenAI usage details: the reusable prefix is a cache read, while the
     * effective prompt suffix evaluated by ds4_session_sync() is written into
     * the live KV cache and can be reused by the next request. */
    j->req.cache_read_tokens = cached;
    j->req.cache_write_tokens = prompt_tokens > cached ? prompt_tokens - cached : 0;

    const double t0 = now_sec();
    uint64_t trace_id = trace_begin(s, j, cached, prompt_tokens, &cache_diag,
                                    cache_source, disk_cached, disk_cache_path);
    char ctx_span[48];
    request_ctx_span(ctx_span, sizeof(ctx_span), cached, prompt_tokens);
    server_prefill_progress progress = {
        .srv = s,
        .kind = j->req.kind,
        .prompt_tokens = prompt_tokens,
        .cached_tokens = cached,
        .has_tools = j->req.has_tools,
        .responses_protocol = responses_protocol,
        .t0 = t0,
        .fd = j->fd,
        .stream = j->req.stream,
        .enable_cors = s->enable_cors,
    };
    snprintf(progress.ctx, sizeof(progress.ctx), "%s", ctx_span);
    char req_flags[64];
    log_flags(req_flags, sizeof(req_flags), responses_protocol,
              j->req.has_tools, false, false, false);
    if (responses_live_continuation) {
        server_log(DS4_LOG_PREFILL,
                   "ds4-server: responses live continuation RESPPROTO match=%s ids=%d cached=%d prompt=%d",
                   responses_live_match ? responses_live_match : "unknown",
                   responses_live_match_ids,
                   cached,
                   prompt_tokens);
    } else if (anthropic_live_continuation) {
        server_log(DS4_LOG_PREFILL,
                   "ds4-server: anthropic live continuation match=tool-output-ids ids=%d cached=%d prompt=%d",
                   anthropic_live_match_ids,
                   cached,
                   prompt_tokens);
    } else if (thinking_live_continuation) {
        server_log(DS4_LOG_PREFILL,
                   "ds4-server: thinking live continuation match=visible-prefix cached=%d prompt=%d",
                   cached,
                   prompt_tokens);
    }
    if (responses_visible_replay_without_reasoning) {
        /* The request replays a prior tool-call turn but omits the hidden
         * reasoning that originally led to it.  A live Responses checkpoint, or
         * a responses-visible disk checkpoint, would preserve that hidden KV.
         * If neither is available, continue from the visible transcript instead
         * of surfacing a hard error to the user.  This is lower fidelity, but it
         * lets old / restarted agent sessions recover and is exactly what the
         * client asked us to prefill. */
        server_log(DS4_LOG_WARNING,
                   "ds4-server: responses replay RESPPROTO missing reasoning state; continuing from visible history source=%s cached=%d prompt=%d",
                   cache_source,
                   cached,
                   prompt_tokens);
        trace_event(s, trace_id,
                    "responses replay missing reasoning state; continuing from visible history source=%s cached=%d",
                    cache_source, cached);
    }
    server_log(DS4_LOG_PREFILL,
               "ds4-server: %s ctx=%s%s%s prompt start",
               j->req.kind == REQ_CHAT ? "chat" : "completion",
               ctx_span,
               req_flags[0] ? " " : "",
               req_flags);
    ds4_session_set_progress(s->session, server_progress_cb, &progress);
    ds4_session_set_display_progress(s->session, server_progress_cb, &progress);

    int cold_store_len = 0;
    if (cached == 0 &&
        s->kv.enabled &&
        prompt_for_sync->len >= s->kv.opt.min_tokens &&
        s->kv.opt.cold_max_tokens > 0 &&
        prompt_for_sync->len <= s->kv.opt.cold_max_tokens)
    {
        const int anchor = kv_cache_chat_anchor_pos(&s->kv, prompt_for_sync,
                                                    ds4_token_user(s->engine),
                                                    ds4_token_assistant(s->engine));
        cold_store_len = anchor >= s->kv.opt.min_tokens ?
                         anchor : kv_cache_store_len(&s->kv, prompt_for_sync->len);
    }
    int suppressed_continued_last = -1;
    if (cold_store_len >= s->kv.opt.min_tokens) {
        /* A cold checkpoint can land exactly on the continued-checkpoint
         * frontier.  The prefill progress callback would then write the same
         * prefix as "continued" while we are intentionally stopping there to
         * write it as "cold".  Mark the frontier as already handled before the
         * sync reaches it; if the cold write fails, restore the old schedule so
         * a later continued write can still try. */
        suppressed_continued_last =
            kv_cache_suppress_continued_store(&s->kv, cold_store_len);
    }

    if (s->kv.enabled &&
        cold_store_len >= s->kv.opt.min_tokens &&
        cold_store_len < prompt_for_sync->len)
    {
        ds4_tokens prefix = {0};
        tokens_copy_prefix(&prefix, prompt_for_sync, cold_store_len);
        if (ds4_session_sync(s->session, &prefix, err, sizeof(err)) != 0) {
            ds4_tokens_free(&prefix);
            ds4_tokens_free(&effective_prompt);
            ds4_session_set_progress(s->session, NULL, NULL);
            ds4_session_set_display_progress(s->session, NULL, NULL);
            kv_cache_restore_suppressed_continued(&s->kv, suppressed_continued_last,
                                                  cold_store_len);
            kv_cache_discard_failed_disk_entry(s, disk_cache_path);
            free(disk_cache_path);
            trace_event(s, trace_id, "prefill failed: %s", err);
            send_prefill_failure_response(s, j, &progress, ctx_span, req_flags, err);
            return;
        }
        if (kv_cache_store_live_prefix(s, prompt_for_sync, cold_store_len, "cold")) {
            kv_cache_note_store(&s->kv, cold_store_len);
            suppressed_continued_last = -1;
        } else {
            kv_cache_restore_suppressed_continued(&s->kv, suppressed_continued_last,
                                                  cold_store_len);
            suppressed_continued_last = -1;
        }
        ds4_tokens_free(&prefix);
    }

    if (ds4_session_sync(s->session, prompt_for_sync, err, sizeof(err)) != 0) {
        ds4_tokens_free(&effective_prompt);
        ds4_session_set_progress(s->session, NULL, NULL);
        ds4_session_set_display_progress(s->session, NULL, NULL);
        kv_cache_restore_suppressed_continued(&s->kv, suppressed_continued_last,
                                              cold_store_len);
        kv_cache_discard_failed_disk_entry(s, disk_cache_path);
        free(disk_cache_path);
        trace_event(s, trace_id, "prefill failed: %s", err);
        send_prefill_failure_response(s, j, &progress, ctx_span, req_flags, err);
        return;
    }
    free(disk_cache_path);
    /* Once a non-live request wins, old protocol live bindings are stale. Keep
     * a binding only when this request explicitly continued from it. */
    if (!responses_live_continuation) responses_live_clear(s);
    if (!anthropic_live_continuation) anthropic_live_clear(s);
    if (!thinking_live_continuation) thinking_live_clear(s);
    ds4_session_set_progress(s->session, NULL, NULL);
    ds4_session_set_display_progress(s->session, NULL, NULL);
    kv_cache_maybe_store_continued(s);
    server_log(DS4_LOG_PREFILL,
               "ds4-server: %s ctx=%s%s%s prompt done %.3fs",
               j->req.kind == REQ_CHAT ? "chat" : "completion",
               ctx_span,
               req_flags[0] ? " " : "",
               req_flags,
               now_sec() - t0);
    if (cold_store_len == prompt_for_sync->len) {
        if (kv_cache_store_live_prefix(s, prompt_for_sync, cold_store_len, "cold")) {
            kv_cache_note_store(&s->kv, cold_store_len);
            suppressed_continued_last = -1;
        } else {
            kv_cache_restore_suppressed_continued(&s->kv, suppressed_continued_last,
                                                  cold_store_len);
        }
    }
    char id[96];
    snprintf(id, sizeof(id), "%s-%llu",
             j->req.kind == REQ_CHAT ? "chatcmpl" : "cmpl",
             (unsigned long long)++s->seq);

    bool structured_stream = request_uses_structured_stream(&j->req);
    anthropic_stream anthropic_live = {0};
    openai_stream openai_live = {0};
    responses_stream responses_live = {0};
    const bool openai_live_chat = request_uses_openai_live_stream(&j->req);
    const bool responses_live_chat = request_uses_responses_live_stream(&j->req);
    long responses_created_at = (long)time(NULL);
    if (j->req.stream) {
        if (progress.stream_failed) {
            server_log(DS4_LOG_GENERATION,
                       "ds4-server: %s ctx=%s%s%s stream closed during prefill",
                       j->req.kind == REQ_CHAT ? "chat" : "completion",
                       ctx_span,
                       req_flags[0] ? " " : "",
                       req_flags);
            ds4_tokens_free(&effective_prompt);
            return;
        }
        /* The prefill progress callback may have already sent the SSE headers
         * to keep the connection alive during a long prefill. Only emit them
         * here when prefill never fired (e.g. fully cached prompt). */
        if (!progress.headers_sent && !sse_headers(j->fd, s->enable_cors)) {
            server_log(DS4_LOG_GENERATION,
                       "ds4-server: %s ctx=%s%s%s sse headers failed",
                       j->req.kind == REQ_CHAT ? "chat" : "completion",
                       ctx_span,
                       req_flags[0] ? " " : "",
                       req_flags);
            ds4_tokens_free(&effective_prompt);
            return;
        }
        progress.headers_sent = true;
        if (j->req.api == API_ANTHROPIC &&
            !anthropic_sse_start_live(j->fd, &j->req, id,
                                      prompt_tokens, &anthropic_live)) {
            server_log(DS4_LOG_GENERATION, "ds4-server: chat ctx=%s anthropic stream start failed", ctx_span);
            ds4_tokens_free(&effective_prompt);
            return;
        }
        if (j->req.api == API_OPENAI && j->req.kind == REQ_CHAT &&
            !sse_chunk(j->fd, &j->req, id, NULL, NULL)) {
            server_log(DS4_LOG_GENERATION, "ds4-server: chat ctx=%s openai role chunk failed", ctx_span);
            ds4_tokens_free(&effective_prompt);
            return;
        }
        if (openai_live_chat) openai_stream_start(&j->req, &openai_live);
        if (responses_live_chat) {
            responses_stream_init(&j->req, &responses_live);
            responses_live.active = true;
            if (!responses_sse_created(j->fd, &j->req, &responses_live, responses_created_at)) {
                server_log(DS4_LOG_GENERATION,
                           "ds4-server: chat ctx=%s%s%s responses created event failed",
                           ctx_span,
                           req_flags[0] ? " " : "",
                           req_flags);
                responses_stream_free(&responses_live);
                ds4_tokens_free(&effective_prompt);
                return;
            }
        }
    }

    bool dsml_recovery_attempted = false;
    uint64_t rng = j->req.seed ? j->req.seed :
        (((uint64_t)time(NULL) << 32) ^ ((uint64_t)s->seq << 1) ^ (uint64_t)(uintptr_t)j);
decode_again:
    ;
    buf text = {0};
    size_t plain_stream_pos = 0;
    size_t stop_scan_from = 0;
    const char *finish = "length";
    int completion = 0;
    int max_tokens = j->req.max_tokens;
    int room = ds4_session_ctx(s->session) - ds4_session_pos(s->session);
    bool saw_tool_start = false;
    bool saw_tool_end = false;
    bool saw_orphan_tool_end = false;
    size_t tool_scan_from = 0;
    int next_tool_progress = 128;
    int next_decode_log = 50;
    if (max_tokens < 0) max_tokens = 0;
    if (max_tokens > room) max_tokens = room;
    trace_event(s, trace_id, "prefill done; decode_max=%d ctx_room=%d", max_tokens, room);
    const double decode_t0 = now_sec();
    double last_decode_log_t = decode_t0;
    int last_decode_log_completion = 0;
    thinking_state thinking = thinking_state_from_prompt(&j->req);
    const bool thinking_gates_tool_markers = ds4_think_mode_enabled(j->req.think_mode);
    bool tool_scan_waiting_for_think_close =
        thinking_gates_tool_markers && thinking.inside;
    size_t think_recovery_scan_from = 0;
    const bool think_tool_recovery_enabled =
        getenv("DS4_SERVER_DISABLE_THINK_TOOL_RECOVERY") == NULL;
    dsml_decode_tracker dsml_tracker;
    dsml_decode_tracker_init(&dsml_tracker);

    while (!g_stop_requested && completion < max_tokens &&
           ds4_session_pos(s->session) < ds4_session_ctx(s->session)) {
        dsml_decode_state dsml_state = j->req.kind == REQ_CHAT && j->req.has_tools ?
            dsml_tracker.decode : DSML_DECODE_OUTSIDE;
        const bool in_tool_call = dsml_decode_state_is_tool(dsml_state);
        if (!(j->req.kind == REQ_CHAT && j->req.has_tools && (saw_tool_start || in_tool_call))) {
            kv_cache_maybe_store_continued(s);
        }
        float temperature = j->req.temperature;
        int top_k = j->req.top_k;
        float top_p = j->req.top_p;
        float min_p = j->req.min_p;
        if (ds4_think_mode_enabled(j->req.think_mode)) {
            temperature = DS4_DEFAULT_TEMPERATURE;
            top_k = 0;
            top_p = DS4_DEFAULT_TOP_P;
            min_p = DS4_DEFAULT_MIN_P;
        }
        if (in_tool_call && !dsml_decode_state_uses_payload_sampling(dsml_state)) {
            temperature = 0.0f;
        }
        int token = ds4_session_sample(s->session, temperature, top_k, top_p, min_p, &rng);
        if (token == ds4_token_eos(s->engine)) {
            finish = "stop";
            break;
        }

        int toks[17];
        int ntok = 0;
        if (temperature <= 0.0f &&
            ds4_engine_mtp_draft_tokens(s->engine) > 1 &&
            getenv("DS4_MTP_SPEC_DISABLE") == NULL)
        {
            ntok = ds4_session_eval_speculative_argmax(s->session,
                                                       token,
                                                       max_tokens - completion,
                                                       ds4_token_eos(s->engine),
                                                       toks,
                                                       (int)(sizeof(toks) / sizeof(toks[0])),
                                                       err,
                                                       sizeof(err));
            if (ntok < 0) {
                finish = "error";
                break;
            }
        } else {
            if (ds4_session_eval(s->session, token, err, sizeof(err)) != 0) {
                finish = "error";
                break;
            }
            toks[0] = token;
            ntok = 1;
        }

        bool stop_decode = false;
        for (int ti = 0; ti < ntok && completion < max_tokens; ti++) {
            token = toks[ti];
            if (token == ds4_token_eos(s->engine)) {
                finish = "stop";
                stop_decode = true;
                break;
            }

            size_t piece_len = 0;
            char *piece = ds4_token_text(s->engine, token, &piece_len);
            completion++;

            trace_piece(s, trace_id, piece, piece_len);
            buf_append(&text, piece, piece_len);
            thinking_state_feed(&thinking, piece, piece_len);
            if (j->req.kind == REQ_CHAT && j->req.has_tools) {
                dsml_decode_tracker_update(&dsml_tracker, text.ptr, text.len);
            }

            size_t stop_pos = 0, stop_len = 0;
            bool hit_stop = stop_list_find_from(&j->req.stops, text.ptr,
                                                stop_scan_from,
                                                &stop_pos, &stop_len);
            size_t stream_len = hit_stop ?
                stop_pos : stop_list_stream_safe_len(&j->req.stops, text.len);
            if (stream_len > text.len) stream_len = text.len;
            stream_len = utf8_stream_safe_len(text.ptr, plain_stream_pos,
                                              stream_len, hit_stop);
            if (!hit_stop && j->req.stops.max_len > 1) {
                const size_t hold = j->req.stops.max_len - 1;
                stop_scan_from = text.len > hold ? text.len - hold : 0;
            }

            if (j->req.stream && !structured_stream && stream_len > plain_stream_pos) {
                char *delta = xstrndup(text.ptr + plain_stream_pos, stream_len - plain_stream_pos);
                bool ok = sse_chunk(j->fd, &j->req, id, delta, NULL);
                free(delta);
                if (!ok) {
                    finish = "error";
                    snprintf(err, sizeof(err), "client stream write failed");
                    free(piece);
                    stop_decode = true;
                    break;
                }
                plain_stream_pos = stream_len;
            }
            if (j->req.stream && j->req.api == API_ANTHROPIC &&
                !anthropic_sse_stream_update(j->fd, s, &j->req, id,
                                             &anthropic_live, text.ptr, stream_len,
                                             false)) {
                finish = "error";
                snprintf(err, sizeof(err), "client stream write failed");
                free(piece);
                stop_decode = true;
                break;
            }
            if (openai_live_chat &&
                !openai_sse_stream_update(j->fd, s, &j->req, id,
                                          &openai_live, text.ptr, stream_len,
                                          false)) {
                finish = "error";
                snprintf(err, sizeof(err), "client stream write failed");
                free(piece);
                stop_decode = true;
                break;
            }
            if (responses_live_chat &&
                !responses_sse_stream_update(j->fd, &j->req,
                                             &responses_live, text.ptr, stream_len,
                                             false)) {
                finish = "error";
                snprintf(err, sizeof(err), "client stream write failed");
                free(piece);
                stop_decode = true;
                break;
            }
            free(piece);

            if (j->req.kind == REQ_CHAT && j->req.has_tools) {
                if (thinking_gates_tool_markers && thinking.inside) {
                    /* A DSML block inside reasoning is not executable.  This is
                     * the live guard: do not let a quoted or mistaken marker in
                     * <think> stop decoding as a real tool call.  A complete
                     * stanza opening, however, almost always means the model
                     * forgot to close its thinking; recover by forcing the
                     * close so the model restarts the call on the executable
                     * side. */
                    const int recovered = think_tool_recovery_enabled ?
                        chat_think_tool_recovery(s, &text, &thinking,
                                                 &think_recovery_scan_from,
                                                 &completion, max_tokens,
                                                 err, sizeof(err)) : 0;
                    if (recovered < 0) {
                        finish = "error";
                        stop_decode = true;
                        break;
                    }
                    if (recovered) {
                        server_log(DS4_LOG_WARNING,
                                   "ds4-server: chat ctx=%s%s%s tool call inside unclosed <think>; "
                                   "forced </think> after %d generated tokens",
                                   ctx_span,
                                   req_flags[0] ? " " : "",
                                   req_flags,
                                   completion);
                        trace_event(s, trace_id,
                                    "think tool recovery after %d generated tokens",
                                    completion);
                        dsml_decode_tracker_update(&dsml_tracker, text.ptr, text.len);
                        tool_scan_waiting_for_think_close = true;
                    } else {
                        tool_scan_waiting_for_think_close = true;
                        tool_scan_from = text.len;
                    }
                } else {
                    if (tool_scan_waiting_for_think_close) {
                        const char *think_end = find_last_substr(text.ptr, "</think>");
                        tool_scan_from = think_end ? (size_t)((think_end + 8) - text.ptr) : text.len;
                        if (tool_scan_from > text.len) tool_scan_from = text.len;
                        tool_scan_waiting_for_think_close = false;
                    }
                    if (tool_scan_from > text.len) tool_scan_from = text.len;
                    const char *tool_scan = text.ptr ? text.ptr + tool_scan_from : "";
                    bool orphan_end = false;
                    bool old_start = saw_tool_start;
                    bool old_end = saw_tool_end;
                    observe_tool_markers(tool_scan, &saw_tool_start, &saw_tool_end, &orphan_end);
                    if (orphan_end && !saw_orphan_tool_end) {
                        saw_orphan_tool_end = true;
                        server_log(DS4_LOG_WARNING,
                                   "ds4-server: chat ctx=%s%s%s ignored orphan tool-call end marker after %d generated tokens",
                                   ctx_span,
                                   req_flags[0] ? " " : "",
                                   req_flags,
                                   completion);
                        trace_event(s, trace_id,
                                    "ignored orphan tool-call end marker after %d generated tokens",
                                    completion);
                    }
                    if (saw_tool_start && !old_start) {
                        trace_event(s, trace_id, "entered tool-call block after %d generated tokens", completion);
                    }
                    if (saw_tool_end && !old_end) {
                        trace_event(s, trace_id, "closed tool-call block after %d generated tokens", completion);
                    }
                    const size_t marker_hold = 80;
                    size_t hold_from = text.len > marker_hold ? text.len - marker_hold : 0;
                    if (hold_from > tool_scan_from) tool_scan_from = hold_from;
                    if (s->trace && completion >= next_tool_progress) {
                        trace_event(s, trace_id,
                                    "progress gen=%d dsml_start=%d dsml_end=%d",
                                    completion, saw_tool_start ? 1 : 0, saw_tool_end ? 1 : 0);
                        next_tool_progress += 128;
                    }
                }
            }

            if (completion >= next_decode_log) {
                log_decode_progress(j->req.kind, prompt_tokens, completion,
                                    responses_protocol,
                                    j->req.has_tools,
                                    thinking.inside,
                                    saw_tool_start,
                                    saw_tool_end,
                                    decode_t0,
                                    &last_decode_log_t,
                                    &last_decode_log_completion);
                next_decode_log += 50;
            }

            if (hit_stop) {
                (void)stop_len;
                finish = "stop";
                text.len = stop_pos;
                text.ptr[text.len] = '\0';
                ds4_session_invalidate(s->session);
                stop_decode = true;
                break;
            }

            if (j->req.kind == REQ_CHAT && j->req.has_tools && saw_tool_end) {
                finish = "tool_calls";
                stop_decode = true;
                break;
            }
        }
        if (stop_decode) break;
    }

    if (g_stop_requested && strcmp(finish, "error") != 0) {
        finish = "error";
        snprintf(err, sizeof(err), "shutdown requested");
    }

    if (j->req.kind == REQ_CHAT && j->req.has_tools &&
        saw_tool_start && !saw_tool_end && strcmp(finish, "error") != 0)
    {
        /* Deterministically complete a simple truncation.  Anything more than
         * missing closing tags stays model-owned: for non-streaming requests,
         * append a tool error plus prompt reminder to the live session and let
         * the model issue a fresh call. */
        bool completed_truncation = false;
        buf repaired = {0};
        if (try_repair_dsml(text.ptr, text.len, &repaired)) {
            /* Parse repaired text to verify it produces valid tool calls */
            tool_calls test_calls = {0};
            char *test_content = NULL;
            char *test_reasoning = NULL;
            bool repair_ok = parse_generated_message_ex(repaired.ptr, false, &test_content, &test_reasoning, &test_calls);
            free(test_content);
            free(test_reasoning);
            if (repair_ok && test_calls.len > 0) {
                /* Repair succeeded - replace text with repaired version */
                free(text.ptr);
                text.ptr = buf_take(&repaired);
                text.len = strlen(text.ptr);
                saw_tool_end = true;
                completed_truncation = true;
                server_log(DS4_LOG_WARNING,
                           "ds4-server: chat ctx=%s%s%s repaired unterminated tool call (%d calls recovered)",
                           ctx_span,
                           req_flags[0] ? " " : "",
                           req_flags,
                           test_calls.len);
                trace_event(s, trace_id, "repaired unterminated tool call (%d calls recovered)", test_calls.len);
            }
            tool_calls_free(&test_calls);
        }
        if (!completed_truncation) {
            if (!j->req.stream && !dsml_recovery_attempted) {
                int recovery_tokens = 0;
                char recovery_err[160] = {0};
                server_log(DS4_LOG_WARNING,
                           "ds4-server: chat ctx=%s%s%s unterminated tool call; continuing with model-visible tool error",
                           ctx_span,
                           req_flags[0] ? " " : "",
                           req_flags);
                trace_event(s, trace_id,
                            "unterminated tool call; continuing with model-visible tool error");
                if (continue_after_invalid_dsml(s, &j->req, &thinking,
                                                "unterminated tool call",
                                                &recovery_tokens,
                                                recovery_err,
                                                sizeof(recovery_err)))
                {
                    dsml_recovery_attempted = true;
                    server_log(DS4_LOG_GENERATION,
                               "ds4-server: chat ctx=%s%s%s tool-error continuation appended %d tokens",
                               ctx_span,
                               req_flags[0] ? " " : "",
                               req_flags,
                               recovery_tokens);
                    trace_event(s, trace_id,
                                "tool-error continuation appended %d tokens",
                                recovery_tokens);
                    buf_free(&repaired);
                    buf_free(&text);
                    goto decode_again;
                }
                finish = "error";
                snprintf(err, sizeof(err), "invalid tool call recovery failed: %s",
                         recovery_err[0] ? recovery_err : "unknown error");
            } else {
                finish = "error";
                snprintf(err, sizeof(err), "unterminated tool call");
            }
        }
        buf_free(&repaired);
    }

    if (completion > last_decode_log_completion) {
        log_decode_progress(j->req.kind, prompt_tokens, completion,
                            responses_protocol,
                            j->req.has_tools,
                            thinking.inside,
                            saw_tool_start,
                            saw_tool_end,
                            decode_t0,
                            &last_decode_log_t,
                            &last_decode_log_completion);
    }

    if (j->req.stream && !structured_stream && text.len > plain_stream_pos) {
        char *tail = xstrndup(text.ptr + plain_stream_pos, text.len - plain_stream_pos);
        if (!sse_chunk(j->fd, &j->req, id, tail, NULL)) finish = "error";
        free(tail);
    }

    tool_calls parsed_calls = {0};
    char *parsed_content = NULL;
    char *parsed_reasoning = NULL;
    const char *final_finish = finish;
    bool recovered_tool_parse_failure = false;
    if (j->req.kind == REQ_CHAT) {
        bool parsed_ok = parse_generated_message_for_response(
            text.ptr ? text.ptr : "",
            j->req.has_tools,
            saw_tool_start,
            ds4_think_mode_enabled(j->req.think_mode),
            &final_finish,
            err,
            sizeof(err),
            &parsed_content,
            &parsed_reasoning,
            &parsed_calls,
            &recovered_tool_parse_failure);
        if (!parsed_ok && recovered_tool_parse_failure && j->req.has_tools && saw_tool_start) {
            /* parse_generated_message failed even though DSML was present.
             * Semantic repair is intentionally avoided: if the parser cannot
             * execute the block, feed the model a tool error and the protocol
             * reminder so it owns the corrected next action. */
            if (!j->req.stream && !dsml_recovery_attempted) {
                int recovery_tokens = 0;
                char recovery_err[160] = {0};
                const char *detail = err[0] ? err : "invalid tool call";
                server_log(DS4_LOG_WARNING,
                           "ds4-server: chat ctx=%s%s%s invalid tool call; continuing with model-visible tool error",
                           ctx_span,
                           req_flags[0] ? " " : "",
                           req_flags);
                trace_event(s, trace_id,
                            "invalid tool call; continuing with model-visible tool error");
                if (continue_after_invalid_dsml(s, &j->req, &thinking,
                                                detail,
                                                &recovery_tokens,
                                                recovery_err,
                                                sizeof(recovery_err)))
                {
                    dsml_recovery_attempted = true;
                    server_log(DS4_LOG_GENERATION,
                               "ds4-server: chat ctx=%s%s%s tool-error continuation appended %d tokens",
                               ctx_span,
                               req_flags[0] ? " " : "",
                               req_flags,
                               recovery_tokens);
                    trace_event(s, trace_id,
                                "tool-error continuation appended %d tokens",
                                recovery_tokens);
                    free(parsed_content);
                    free(parsed_reasoning);
                    tool_calls_free(&parsed_calls);
                    buf_free(&text);
                    goto decode_again;
                }
                final_finish = "error";
                snprintf(err, sizeof(err), "invalid tool call recovery failed: %s",
                         recovery_err[0] ? recovery_err : "unknown error");
            }
            if (!parsed_ok) {
                /* Print raw DSML snippet for debugging */
                size_t dsml_snippet_len = 0;
                const char *dsml_start = NULL;
                const char *p;
                for (p = text.ptr; p && (size_t)(p - text.ptr) < text.len - 20; p++) {
                    if ((strncmp(p, DS4_TOOL_CALLS_START, strlen(DS4_TOOL_CALLS_START)) == 0) ||
                        (strncmp(p, DS4_TOOL_CALLS_START_SHORT, strlen(DS4_TOOL_CALLS_START_SHORT)) == 0) ||
                        (strncmp(p, "<tool_calls>", 12) == 0)) {
                        dsml_start = p;
                        break;
                    }
                }
                if (dsml_start) {
                    dsml_snippet_len = text.len - (dsml_start - text.ptr);
                    if (dsml_snippet_len > 500) dsml_snippet_len = 500;
                }
                /* Also log a snippet of the full text to see what the model output */
                size_t text_snippet_len = text.len > 300 ? 300 : text.len;
                server_log(DS4_LOG_WARNING,
                           "ds4-server: chat ctx=%s%s%s invalid tool call returned as assistant text finish=%s [text_len=%zu saw_start=%d saw_end=%d text_snippet: %.*s]",
                           ctx_span,
                           req_flags[0] ? " " : "",
                           req_flags,
                           final_finish,
                           text.len,
                           saw_tool_start,
                           saw_tool_end,
                           (int)text_snippet_len,
                           text.ptr ? text.ptr : "(null)");
                server_log(DS4_LOG_WARNING,
                           "ds4-server: chat ctx=%s%s%s invalid tool call dsml_snippet: %.*s",
                           ctx_span,
                           req_flags[0] ? " " : "",
                           req_flags,
                           (int)dsml_snippet_len,
                           dsml_start ? dsml_start : "(none)");
                trace_event(s, trace_id,
                            "invalid tool call returned as assistant text finish=%s",
                            final_finish);
            }
        }
        if (parsed_calls.len) {
            if (openai_live_chat) apply_openai_stream_tool_ids(&parsed_calls, &openai_live);
            if (j->req.api == API_ANTHROPIC && j->req.stream)
                apply_anthropic_stream_tool_ids(&parsed_calls, &anthropic_live);
            assign_tool_call_ids(s, &parsed_calls, j->req.api);
            tool_memory_remember(s, &parsed_calls);
            final_finish = "tool_calls";
        } else if (j->req.api == API_RESPONSES) {
            responses_live_clear(s);
        }
    }
    log_tool_calls_summary(ctx_span, &parsed_calls,
                           responses_protocol);

    trace_finish(s, trace_id, &j->req, final_finish, completion,
                 saw_tool_start, saw_tool_end,
                 parsed_content ? parsed_content : (text.ptr ? text.ptr : ""),
                 parsed_reasoning, &parsed_calls, now_sec() - t0);

    if (j->req.api == API_RESPONSES) {
        if (strcmp(final_finish, "error") && strcmp(final_finish, "length")) {
            /* Store the post-turn visible transcript plus the live token
             * frontier.  The next Responses request may replay only this
             * visible surface, while the real session also contains hidden
             * reasoning and exact sampled tool-call bytes. */
            char *visible_suffix =
                build_responses_visible_assistant_suffix(&j->req,
                    parsed_content ? parsed_content : "",
                    parsed_reasoning,
                    &parsed_calls);
            buf visible = {0};
            buf_puts(&visible, j->req.prompt_text ? j->req.prompt_text : "");
            buf_puts(&visible, visible_suffix ? visible_suffix : "");
            responses_live_remember(s, visible.ptr ? visible.ptr : "",
                                    parsed_calls.len ? &parsed_calls : NULL);
            buf_free(&visible);
            free(visible_suffix);
        } else {
            responses_live_clear(s);
        }
    }
    if (j->req.api == API_ANTHROPIC) {
        if (parsed_calls.len && strcmp(final_finish, "error") &&
            strcmp(final_finish, "length"))
        {
            anthropic_live_remember(s, &parsed_calls);
        } else {
            anthropic_live_clear(s);
        }
    }

    if (j->req.kind == REQ_CHAT && parsed_calls.len &&
        j->req.api != API_RESPONSES &&
        should_canonicalize_tool_checkpoint(s, &parsed_calls))
    {
        /* Chat/completions has no protocol object that binds the next request
         * to this live KV state.  Canonicalize only the fallback tool-call
         * path where we lack exact sampled DSML replay; when raw DSML is known,
         * replaying those bytes keeps future prompts aligned without rebuilding
         * hidden reasoning.  Responses deliberately skips this path because its
         * previous_response_id contract binds the next turn to live state. */
        canonicalize_tool_checkpoint(s, j, ctx_span, trace_id,
                                     parsed_content ? parsed_content : "",
                                     parsed_reasoning, &parsed_calls);
        thinking_live_clear(s);
    } else if (parsed_calls.len) {
        thinking_live_clear(s);
    } else if (!parsed_calls.len &&
               should_remember_thinking_checkpoint(&j->req, &thinking, final_finish)) {
        remember_thinking_checkpoint(s, j, ctx_span, trace_id,
                                     parsed_content ? parsed_content : "");
    } else if (!parsed_calls.len) {
        thinking_live_clear(s);
    }

    if (j->req.stream) {
        bool response_ok = true;
        if (j->req.api == API_ANTHROPIC) {
            response_ok = anthropic_sse_finish_live(j->fd, s, &j->req, id, &anthropic_live,
                                                    text.ptr ? text.ptr : "", text.len,
                                                    &parsed_calls, final_finish, completion);
        } else if (openai_live_chat) {
            response_ok = openai_sse_finish_live(j->fd, s, &j->req, id, &openai_live,
                                                 text.ptr ? text.ptr : "", text.len,
                                                 &parsed_calls, final_finish,
                                                 prompt_tokens, completion);
        } else if (responses_live_chat) {
            /* If parse recovered a malformed tool call back to plain text,
             * pass parsed_content so the streaming tail can be flushed; in
             * the normal path parsed_content is the assistant text we already
             * streamed and the diff is empty. */
            const char *recover =
                recovered_tool_parse_failure ? parsed_content : NULL;
            response_ok = responses_sse_finish_live(j->fd, &j->req, &responses_live,
                                                    text.ptr ? text.ptr : "", text.len,
                                                    recover,
                                                    &parsed_calls, final_finish,
                                                    prompt_tokens, completion,
                                                    responses_created_at);
        } else if (structured_stream) {
            response_ok = sse_chat_finish(j->fd, &j->req, id,
                                          parsed_content ? parsed_content : (text.ptr ? text.ptr : ""),
                                          parsed_reasoning,
                                          &parsed_calls, final_finish,
                                          prompt_tokens, completion);
        } else {
            response_ok = sse_chunk(j->fd, &j->req, id, NULL, final_finish) &&
                          sse_done(j->fd, &j->req, id, prompt_tokens, completion);
        }
        if (!response_ok) {
            server_log(DS4_LOG_DEFAULT,
                       "ds4-server: %s ctx=%s%s%s final stream failed",
                       j->req.kind == REQ_CHAT ? "chat" : "completion",
                       ctx_span,
                       req_flags[0] ? " " : "",
                       req_flags);
        }
    } else if (j->req.api == API_ANTHROPIC) {
        anthropic_final_response(j->fd, s->enable_cors, &j->req, id,
                                 parsed_content ? parsed_content : (text.ptr ? text.ptr : ""),
                                 parsed_reasoning,
                                 &parsed_calls, final_finish,
                                 prompt_tokens, completion);
    } else if (j->req.api == API_RESPONSES) {
        responses_final_response(j->fd, s->enable_cors, &j->req, id,
                                 parsed_content ? parsed_content : (text.ptr ? text.ptr : ""),
                                 parsed_reasoning,
                                 &parsed_calls, final_finish,
                                 prompt_tokens, completion);
    } else {
        final_response(j->fd, s->enable_cors, &j->req, id,
                       parsed_content ? parsed_content : (text.ptr ? text.ptr : ""),
                       parsed_reasoning,
                       &parsed_calls, final_finish,
                       prompt_tokens, completion);
    }
    if (j->req.kind == REQ_CHAT && j->req.has_tools) {
        char flags[80];
        log_flags(flags, sizeof(flags),
                  responses_protocol,
                  true,
                  thinking.inside,
                  saw_tool_start,
                  saw_tool_end);
        if (!strcmp(final_finish, "error") && err[0]) {
            server_log(DS4_LOG_GENERATION,
                       "ds4-server: chat ctx=%s gen=%d%s%s finish=%s error=\"%s\" %.3fs",
                       ctx_span,
                       completion,
                       flags[0] ? " " : "",
                       flags,
                       final_finish,
                       err,
                       now_sec() - t0);
        } else {
            server_log(DS4_LOG_GENERATION,
                       "ds4-server: chat ctx=%s gen=%d%s%s finish=%s %.3fs",
                       ctx_span,
                       completion,
                       flags[0] ? " " : "",
                       flags,
                       final_finish,
                       now_sec() - t0);
        }
    } else {
        char flags[80];
        log_flags(flags, sizeof(flags),
                  responses_protocol,
                  j->req.has_tools,
                  thinking.inside,
                  false,
                  false);
        if (!strcmp(final_finish, "error") && err[0]) {
            server_log(DS4_LOG_GENERATION,
                       "ds4-server: %s ctx=%s gen=%d%s%s finish=%s error=\"%s\" %.3fs",
                       j->req.kind == REQ_CHAT ? "chat" : "completion",
                       ctx_span,
                       completion,
                       flags[0] ? " " : "",
                       flags,
                       final_finish,
                       err,
                       now_sec() - t0);
        } else {
            server_log(DS4_LOG_GENERATION,
                       "ds4-server: %s ctx=%s gen=%d%s%s finish=%s %.3fs",
                       j->req.kind == REQ_CHAT ? "chat" : "completion",
                       ctx_span,
                       completion,
                       flags[0] ? " " : "",
                       flags,
                       final_finish,
                       now_sec() - t0);
        }
    }
    free(parsed_content);
    free(parsed_reasoning);
    tool_calls_free(&parsed_calls);
    anthropic_stream_free(&anthropic_live);
    openai_stream_free(&openai_live);
    responses_stream_free(&responses_live);
    buf_free(&text);
    ds4_tokens_free(&effective_prompt);
}

static bool enqueue(server *s, job *j) {
    pthread_mutex_lock(&s->mu);
    if (s->stopping) {
        pthread_mutex_unlock(&s->mu);
        return false;
    }
    if (s->tail) s->tail->next = j; else s->head = j;
    s->tail = j;
    pthread_cond_signal(&s->cv);
    pthread_mutex_unlock(&s->mu);
    return true;
}

static job *dequeue(server *s) {
    pthread_mutex_lock(&s->mu);
    while (!s->head && !s->stopping) pthread_cond_wait(&s->cv, &s->mu);
    if (!s->head) {
        pthread_mutex_unlock(&s->mu);
        return NULL;
    }
    job *j = s->head;
    s->head = j->next;
    if (!s->head) s->tail = NULL;
    pthread_mutex_unlock(&s->mu);
    j->next = NULL;
    return j;
}

static void *worker_main(void *arg) {
    server *s = arg;
    for (;;) {
        job *j = dequeue(s);
        if (!j) break;
        generate_job(s, j);
        pthread_mutex_lock(&j->mu);
        j->done = true;
        pthread_cond_signal(&j->cv);
        pthread_mutex_unlock(&j->mu);
    }
    return NULL;
}

typedef struct {
    char method[8];
    char path[256];
    char *body;
    size_t body_len;
} http_request;

static void http_request_free(http_request *r) {
    free(r->body);
    memset(r, 0, sizeof(*r));
}

static ssize_t header_end(const char *p, size_t n) {
    for (size_t i = 3; i < n; i++) {
        if (p[i - 3] == '\r' && p[i - 2] == '\n' && p[i - 1] == '\r' && p[i] == '\n') return (ssize_t)(i + 1);
    }
    for (size_t i = 1; i < n; i++) {
        if (p[i - 1] == '\n' && p[i] == '\n') return (ssize_t)(i + 1);
    }
    return -1;
}

static long content_length(const char *h, size_t n) {
    const char *p = h, *end = h + n;
    while (p < end) {
        const char *line = p;
        while (p < end && *p != '\n') p++;
        size_t len = (size_t)(p - line);
        if (len && line[len - 1] == '\r') len--;
        if (len >= 15 && strncasecmp(line, "Content-Length:", 15) == 0) {
            const char *v = line + 15;
            while (v < line + len && isspace((unsigned char)*v)) v++;
            return strtol(v, NULL, 10);
        }
        if (p < end) p++;
    }
    return 0;
}

static bool read_http_request(int fd, http_request *r) {
    buf b = {0};
    ssize_t hend = -1;
    const size_t max_header = 64 * 1024;
    const size_t max_body = 64 * 1024 * 1024;

    while (hend < 0 && b.len < max_header) {
        char tmp[4096];
        ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) goto fail;
        buf_append(&b, tmp, (size_t)n);
        hend = header_end(b.ptr, b.len);
    }
    if (hend < 0) goto fail;

    char line[512];
    size_t i = 0;
    while (i < b.len && b.ptr[i] != '\n' && i + 1 < sizeof(line)) {
        line[i] = b.ptr[i];
        i++;
    }
    line[i] = '\0';
    if (sscanf(line, "%7s %255s", r->method, r->path) != 2) goto fail;
    char *q = strchr(r->path, '?');
    if (q) *q = '\0';

    long clen = content_length(b.ptr, (size_t)hend);
    if (clen < 0 || (size_t)clen > max_body) goto fail;
    while (b.len < (size_t)hend + (size_t)clen) {
        char tmp[8192];
        ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) goto fail;
        buf_append(&b, tmp, (size_t)n);
    }

    r->body_len = (size_t)clen;
    r->body = xmalloc(r->body_len + 1);
    memcpy(r->body, b.ptr + hend, r->body_len);
    r->body[r->body_len] = '\0';
    buf_free(&b);
    return true;
fail:
    buf_free(&b);
    return false;
}

typedef struct {
    server *srv;
    int fd;
} client_arg;

static void append_model_json_values(buf *b, const char *id, const char *name,
                                     int ctx, int default_tokens) {
    const int max_completion = default_tokens < ctx ? default_tokens : ctx;
    buf_printf(b,
        "{\"id\":");
    json_escape(b, id);
    buf_puts(b,
        ",\"object\":\"model\","
        "\"created\":1767225600,"
        "\"owned_by\":\"ds4.c\","
        "\"name\":");
    json_escape(b, name);
    buf_printf(b,
        ","
        "\"context_length\":%d,"
        "\"top_provider\":{"
            "\"context_length\":%d,"
            "\"max_completion_tokens\":%d,"
            "\"is_moderated\":false},"
        "\"supported_parameters\":["
            "\"tools\","
            "\"tool_choice\","
            "\"max_tokens\","
            "\"temperature\","
            "\"top_p\","
            "\"top_k\","
            "\"min_p\","
            "\"stop\","
            "\"seed\","
            "\"stream\","
            "\"reasoning_effort\"]}",
        ctx,
        ctx,
        max_completion);
}

static void append_model_json(buf *b, const server *s, const char *id) {
    append_model_json_values(b,
                             id,
                             ds4_engine_model_name(s->engine),
                             ds4_session_ctx(s->session),
                             s->default_tokens);
}

static bool send_token_count(server *s, int fd, const request *r, int ctx_size) {
    token_count_result result = token_count_calculate(r, ctx_size);
    buf b = {0};
    buf_puts(&b, "{\"model\":");
    json_escape(&b, r && r->model ? r->model : server_model_id_from_engine(s->engine));
    buf_printf(&b,
        ",\"prompt_tokens\":%d,\"max_tokens\":%d,\"context_length\":%d,"
        "\"required_tokens\":%d,\"available_tokens\":%d,\"excess_tokens\":%d,"
        "\"fits\":%s}\n",
        result.prompt_tokens, result.max_tokens, result.context_length,
        result.required_tokens, result.available_tokens, result.excess_tokens,
        result.fits ? "true" : "false");
    bool ok = http_response(fd, s->enable_cors, 200, "application/json", b.ptr);
    buf_free(&b);
    return ok;
}

static bool send_model(server *s, int fd, const char *id) {
    buf b = {0};
    append_model_json(&b, s, id);
    buf_putc(&b, '\n');
    bool ok = http_response(fd, s->enable_cors, 200, "application/json", b.ptr);
    buf_free(&b);
    return ok;
}

static bool send_models(server *s, int fd) {
    buf b = {0};
    buf_puts(&b, "{\"object\":\"list\",\"data\":[");
    append_model_json(&b, s, "deepseek-v4-flash");
    buf_putc(&b, ',');
    append_model_json(&b, s, "deepseek-v4-pro");
    buf_puts(&b, "]}\n");
    bool ok = http_response(fd, s->enable_cors, 200, "application/json", b.ptr);
    buf_free(&b);
    return ok;
}

static void client_done(server *s) {
    pthread_mutex_lock(&s->mu);
    if (s->clients > 0) s->clients--;
    pthread_cond_broadcast(&s->clients_cv);
    pthread_mutex_unlock(&s->mu);
}

static void set_client_socket_nonblocking(int fd);

static void *client_main(void *arg) {
    client_arg *ca = arg;
    server *s = ca->srv;
    int fd = ca->fd;
    free(ca);

    http_request hr = {0};
    if (!read_http_request(fd, &hr)) {
        http_error(fd, s->enable_cors, 400, "bad HTTP request");
        goto done;
    }

    if (!strcmp(hr.method, "OPTIONS")) {
        http_response(fd, s->enable_cors, 204, NULL, "");
        http_request_free(&hr);
        goto done;
    }

    if (!strcmp(hr.method, "GET") && !strcmp(hr.path, "/v1/models")) {
        send_models(s, fd);
        http_request_free(&hr);
        goto done;
    }
    const char *model_path_prefix = "/v1/models/";
    const size_t model_path_prefix_len = strlen(model_path_prefix);
    if (!strcmp(hr.method, "GET") &&
        !strncmp(hr.path, model_path_prefix, model_path_prefix_len) &&
        server_model_alias_known(hr.path + model_path_prefix_len))
    {
        send_model(s, fd, hr.path + model_path_prefix_len);
        http_request_free(&hr);
        goto done;
    }

    request req;
    char err[160];
    bool ok = false;
    bool token_count_only = false;
    const int ctx_size = ds4_session_ctx(s->session);
    if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/v1/messages")) {
        ok = parse_anthropic_request(s->engine, s, hr.body, s->default_tokens,
                                     ctx_size, &req, err, sizeof(err));
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/v1/chat/completions")) {
        ok = parse_chat_request(s->engine, s, hr.body, s->default_tokens,
                                ctx_size, &req, err, sizeof(err));
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/v1/token-count")) {
        ok = parse_chat_request(s->engine, s, hr.body, s->default_tokens,
                                ctx_size, &req, err, sizeof(err));
        token_count_only = true;
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/v1/responses")) {
        ok = parse_responses_request(s->engine, s, hr.body, s->default_tokens,
                                     ctx_size, &req, err, sizeof(err));
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/v1/completions")) {
        ok = parse_completion_request(s->engine, hr.body, s->default_tokens,
                                      ctx_size, &req, err, sizeof(err));
    } else {
        http_error(fd, s->enable_cors, 404, "unknown endpoint");
        http_request_free(&hr);
        goto done;
    }
    if (ok) req.raw_body = xstrndup(hr.body, hr.body_len);
    http_request_free(&hr);
    if (!ok) {
        http_error(fd, s->enable_cors, 400, err);
        goto done;
    }
    if (!req.model_from_request) {
        free(req.model);
        req.model = xstrdup(server_model_id_from_engine(s->engine));
    }
    if (token_count_only) {
        send_token_count(s, fd, &req, ctx_size);
        request_free(&req);
        goto done;
    }
    if (request_exceeds_context(&req, ctx_size)) {
        http_error_context_length_exceeded(fd, s->enable_cors, &req, req.prompt.len, ctx_size);
        request_free(&req);
        goto done;
    }

    set_client_socket_nonblocking(fd);
    job j;
    memset(&j, 0, sizeof(j));
    j.fd = fd;
    j.req = req;
    pthread_mutex_init(&j.mu, NULL);
    pthread_cond_init(&j.cv, NULL);

    pthread_mutex_lock(&j.mu);
    if (!enqueue(s, &j)) {
        pthread_mutex_unlock(&j.mu);
        http_error(fd, s->enable_cors, 503, "server shutting down");
        pthread_cond_destroy(&j.cv);
        pthread_mutex_destroy(&j.mu);
        request_free(&j.req);
        goto done;
    }
    while (!j.done) pthread_cond_wait(&j.cv, &j.mu);
    pthread_mutex_unlock(&j.mu);

    pthread_cond_destroy(&j.cv);
    pthread_mutex_destroy(&j.mu);
    request_free(&j.req);
done:
    close(fd);
    client_done(s);
    return NULL;
}

static int listen_on(const char *host, int port) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    int yes = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

    struct sockaddr_in sa;
    memset(&sa, 0, sizeof(sa));
    sa.sin_family = AF_INET;
    sa.sin_port = htons((uint16_t)port);
    if (!strcmp(host, "localhost")) host = "127.0.0.1";
    if (inet_pton(AF_INET, host, &sa.sin_addr) != 1) {
        close(fd);
        errno = EINVAL;
        return -1;
    }
    if (bind(fd, (struct sockaddr *)&sa, sizeof(sa)) != 0) {
        close(fd);
        return -1;
    }
    if (listen(fd, 128) != 0) {
        close(fd);
        return -1;
    }
    return fd;
}

static void configure_client_socket(int fd) {
    struct timeval tv;
    tv.tv_sec = DS4_SERVER_IO_TIMEOUT_SEC;
    tv.tv_usec = 0;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
}

static void set_client_socket_nonblocking(int fd) {
    /* The inference worker writes streaming responses itself.  Once a request is
     * queued, a blocked socket would block every other request too, so slow
     * clients are failed instead of back-pressuring the model session. */
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags >= 0) (void)fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

typedef struct {
    ds4_engine_options engine;
    const char *host;
    int port;
    int ctx_size;
    int default_tokens;
    const char *chdir_path;
    const char *trace_path;
    const char *kv_disk_dir;
    uint64_t kv_disk_space_mb;
    kv_cache_options kv_cache;
    bool kv_cache_reject_different_quant;
    bool disable_exact_dsml_tool_replay;
    int tool_memory_max_ids;
    bool enable_cors;
} server_config;

static int parse_int_arg(const char *s, const char *opt) {
    char *end = NULL;
    long v = strtol(s, &end, 10);
    if (!s[0] || *end || v <= 0 || v > INT_MAX) {
        server_log(DS4_LOG_DEFAULT, "ds4-server: invalid value for %s: %s", opt, s);
        exit(2);
    }
    return (int)v;
}

static int parse_nonneg_int_arg(const char *s, const char *opt) {
    char *end = NULL;
    long v = strtol(s, &end, 10);
    if (!s[0] || *end || v < 0 || v > INT_MAX) {
        server_log(DS4_LOG_DEFAULT, "ds4-server: invalid value for %s: %s", opt, s);
        exit(2);
    }
    return (int)v;
}

static float parse_float_arg(const char *s, const char *opt, float minv, float maxv) {
    char *end = NULL;
    float v = strtof(s, &end);
    if (!s[0] || *end || v < minv || v > maxv) {
        server_log(DS4_LOG_DEFAULT, "ds4-server: invalid value for %s: %s", opt, s);
        exit(2);
    }
    return v;
}

static const char *need_arg(int *i, int argc, char **argv, const char *opt) {
    if (*i + 1 >= argc) {
        server_log(DS4_LOG_DEFAULT, "ds4-server: missing value for %s", opt);
        exit(2);
    }
    return argv[++(*i)];
}

static void log_context_memory(ds4_backend backend,
                               int         ctx_size,
                               uint32_t    prefill_chunk) {
    ds4_context_memory m =
        ds4_context_memory_estimate_with_prefill(backend,
                                                 ctx_size,
                                                 prefill_chunk);
    server_log(DS4_LOG_DEFAULT,
               "ds4-server: context buffers %.2f MiB (ctx=%d, backend=%s, prefill_chunk=%u, raw_kv_rows=%u, compressed_kv_rows=%u)",
               (double)m.total_bytes / (1024.0 * 1024.0),
               ctx_size,
               ds4_backend_name(backend),
               m.prefill_cap,
               m.raw_cap,
               m.comp_cap);
}

static void server_close_resources(server *s) {
    if (s->trace) {
        fclose(s->trace);
        s->trace = NULL;
    }
    kv_cache_close(&s->kv);
    tool_memory_free(&s->tool_mem);
    live_tool_state_free(&s->responses_live);
    live_tool_state_free(&s->anthropic_live);
    visible_live_free(&s->thinking_live);
    pthread_mutex_destroy(&s->tool_mu);
    pthread_mutex_destroy(&s->trace_mu);
    pthread_cond_destroy(&s->clients_cv);
    pthread_cond_destroy(&s->cv);
    pthread_mutex_destroy(&s->mu);
    ds4_session_free(s->session);
    ds4_engine_close(s->engine);
    memset(s, 0, sizeof(*s));
}

static void usage(FILE *fp, const char *topic) {
    ds4_help_print(fp, DS4_HELP_SERVER, topic);
}

static ds4_backend parse_backend_arg(const char *s, const char *arg) {
    if (!strcmp(s, "metal")) return DS4_BACKEND_METAL;
#ifdef DS4_ROCM_BUILD
    if (!strcmp(s, "rocm")) return DS4_BACKEND_CUDA;
#else
    if (!strcmp(s, "cuda")) return DS4_BACKEND_CUDA;
#endif
    if (!strcmp(s, "cpu")) return DS4_BACKEND_CPU;
    server_log(DS4_LOG_DEFAULT, "ds4-server: invalid %s value: %s", arg, s);
#ifdef DS4_ROCM_BUILD
    server_log(DS4_LOG_DEFAULT, "ds4-server: valid server backends are: metal, rocm, cpu");
#else
    server_log(DS4_LOG_DEFAULT, "ds4-server: valid server backends are: metal, cuda, cpu");
#endif
    exit(2);
}

static ds4_backend default_server_backend(void) {
#ifdef DS4_NO_GPU
    return DS4_BACKEND_CPU;
#elif defined(__APPLE__)
    return DS4_BACKEND_METAL;
#else
    return DS4_BACKEND_CUDA;
#endif
}

static server_config parse_options(int argc, char **argv) {
    server_config c = {
        .engine = {
            .model_path = "ds4flash.gguf",
            .backend = default_server_backend(),
            .mtp_draft_tokens = 1,
            .mtp_margin = 3.0f,
        },
        .host = "127.0.0.1",
        .port = 8000,
        .ctx_size = 32768,
        .default_tokens = 393216,
        .tool_memory_max_ids = DS4_TOOL_MEMORY_DEFAULT_MAX_IDS,
    };
    c.kv_cache = kv_cache_default_options();

    bool directional_steering_scale_set = false;
    for (int i = 1; i < argc; i++) {
        const char *arg = argv[i];
        if (!strcmp(arg, "-h") || !strcmp(arg, "--help")) {
            const char *topic = (i + 1 < argc && argv[i + 1][0] != '-') ?
                argv[i + 1] : NULL;
            usage(stdout, topic);
            exit(0);
        }
        char dist_parse_err[256] = {0};
        ds4_dist_cli_parse_result dist_parse =
            ds4_dist_parse_cli_arg(arg,
                                   &i,
                                   argc,
                                   argv,
                                   &c.engine.distributed,
                                   dist_parse_err,
                                   sizeof(dist_parse_err));
        if (dist_parse == DS4_DIST_CLI_ERROR) {
            server_log(DS4_LOG_DEFAULT,
                       "ds4-server: %s",
                       dist_parse_err[0] ? dist_parse_err : "invalid distributed option");
            exit(2);
        }
        if (dist_parse == DS4_DIST_CLI_MATCHED) continue;

        if (!strcmp(arg, "-m") || !strcmp(arg, "--model")) {
            c.engine.model_path = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--mtp")) {
            c.engine.mtp_path = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--mtp-draft")) {
            c.engine.mtp_draft_tokens = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--mtp-margin")) {
            c.engine.mtp_margin = parse_float_arg(need_arg(&i, argc, argv, arg), arg, 0.0f, 1000.0f);
        } else if (!strcmp(arg, "-c") || !strcmp(arg, "--ctx")) {
            c.ctx_size = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "-n") || !strcmp(arg, "--tokens")) {
            c.default_tokens = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "-t") || !strcmp(arg, "--threads")) {
            c.engine.n_threads = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--chdir")) {
            c.chdir_path = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--host")) {
            c.host = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--port")) {
            c.port = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--cors")) {
            c.enable_cors = true;
        } else if (!strcmp(arg, "--trace")) {
            c.trace_path = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--kv-disk-dir")) {
            c.kv_disk_dir = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--kv-disk-space-mb")) {
            c.kv_disk_space_mb = (uint64_t)parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-min-tokens")) {
            c.kv_cache.min_tokens = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-cold-max-tokens")) {
            c.kv_cache.cold_max_tokens = parse_nonneg_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-continued-interval-tokens")) {
            c.kv_cache.continued_interval_tokens = parse_nonneg_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-boundary-trim-tokens")) {
            c.kv_cache.boundary_trim_tokens = parse_nonneg_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-boundary-align-tokens")) {
            c.kv_cache.boundary_align_tokens = parse_nonneg_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-reject-different-quant")) {
            c.kv_cache_reject_different_quant = true;
        } else if (!strcmp(arg, "--disable-exact-dsml-tool-replay")) {
            c.disable_exact_dsml_tool_replay = true;
        } else if (!strcmp(arg, "--tool-memory-max-ids")) {
            c.tool_memory_max_ids = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--quality")) {
            c.engine.quality = true;
        } else if (!strcmp(arg, "--ssd-streaming")) {
            c.engine.ssd_streaming = true;
        } else if (!strcmp(arg, "--ssd-streaming-cold")) {
            c.engine.ssd_streaming_cold = true;
        } else if (!strcmp(arg, "--ssd-streaming-cache-experts")) {
            uint32_t experts = 0;
            uint64_t bytes = 0;
            if (!ds4_parse_streaming_cache_experts_arg(
                    need_arg(&i, argc, argv, arg), &experts, &bytes)) {
                server_log(DS4_LOG_DEFAULT,
                           "ds4-server: --ssd-streaming-cache-experts must be a positive count or <number>GB");
                exit(2);
            }
            c.engine.ssd_streaming_cache_experts = experts;
            c.engine.ssd_streaming_cache_bytes = bytes;
        } else if (!strcmp(arg, "--ssd-streaming-preload-experts")) {
            int v = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
            if (v <= 0) {
                server_log(DS4_LOG_DEFAULT,
                           "ds4-server: --ssd-streaming-preload-experts must be positive");
                exit(2);
            }
            c.engine.ssd_streaming_preload_experts = (uint32_t)v;
        } else if (!strcmp(arg, "--simulate-used-memory")) {
            if (!ds4_parse_gib_arg(need_arg(&i, argc, argv, arg),
                                   &c.engine.simulate_used_memory_bytes)) {
                server_log(DS4_LOG_DEFAULT,
                           "ds4-server: --simulate-used-memory must be a positive GiB value, e.g. 64GB");
                exit(2);
            }
        } else if (!strcmp(arg, "--prefill-chunk")) {
            int v = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
            if (v <= 0) {
                server_log(DS4_LOG_DEFAULT,
                           "ds4-server: --prefill-chunk must be positive");
                exit(2);
            }
            c.engine.prefill_chunk = (uint32_t)v;
        } else if (!strcmp(arg, "--power")) {
            c.engine.power_percent = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
            if (c.engine.power_percent < 1 || c.engine.power_percent > 100) {
                server_log(DS4_LOG_DEFAULT, "ds4-server: --power must be between 1 and 100");
                exit(2);
            }
        } else if (!strcmp(arg, "--dir-steering-file")) {
            c.engine.directional_steering_file = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--dir-steering-ffn")) {
            c.engine.directional_steering_ffn = parse_float_arg(need_arg(&i, argc, argv, arg), arg, -100.0f, 100.0f);
            directional_steering_scale_set = true;
        } else if (!strcmp(arg, "--dir-steering-attn")) {
            c.engine.directional_steering_attn = parse_float_arg(need_arg(&i, argc, argv, arg), arg, -100.0f, 100.0f);
            directional_steering_scale_set = true;
        } else if (!strcmp(arg, "--warm-weights")) {
            c.engine.warm_weights = true;
        } else if (!strcmp(arg, "--metal")) {
            c.engine.backend = DS4_BACKEND_METAL;
#ifdef DS4_ROCM_BUILD
        } else if (!strcmp(arg, "--rocm")) {
            c.engine.backend = DS4_BACKEND_CUDA;
#else
        } else if (!strcmp(arg, "--cuda")) {
            c.engine.backend = DS4_BACKEND_CUDA;
#endif
        } else if (!strcmp(arg, "--backend")) {
            c.engine.backend = parse_backend_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--cpu")) {
            c.engine.backend = DS4_BACKEND_CPU;
        } else {
            server_log(DS4_LOG_DEFAULT, "ds4-server: unknown option: %s", arg);
            usage(stderr, NULL);
            exit(2);
        }
    }
    if (c.kv_cache.cold_max_tokens > 0 &&
        c.kv_cache.cold_max_tokens < c.kv_cache.min_tokens)
    {
        server_log(DS4_LOG_DEFAULT,
                   "ds4-server: --kv-cache-cold-max-tokens must be 0 or >= --kv-cache-min-tokens");
        exit(2);
    }
    if (c.engine.directional_steering_file && !directional_steering_scale_set) {
        c.engine.directional_steering_ffn = 1.0f;
    }
    char dist_err[256];
    if (ds4_dist_prepare_engine_options(&c.engine.distributed,
                                        &c.engine,
                                        dist_err,
                                        sizeof(dist_err)) != 0) {
        server_log(DS4_LOG_DEFAULT, "ds4-server: %s", dist_err);
        exit(2);
    }
    return c;
}

#ifndef DS4_SERVER_TEST
int main(int argc, char **argv) {
    signal(SIGPIPE, SIG_IGN);
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = stop_signal_handler;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    server_config cfg = parse_options(argc, argv);
    if (cfg.chdir_path && chdir(cfg.chdir_path) != 0) {
        server_log(DS4_LOG_DEFAULT, "ds4-server: failed to chdir to %s: %s",
                   cfg.chdir_path, strerror(errno));
        return 1;
    }

    ds4_engine *engine = NULL;
    if (ds4_engine_open(&engine, &cfg.engine) != 0) return 1;

    log_context_memory(cfg.engine.backend,
                       cfg.ctx_size,
                       cfg.engine.prefill_chunk);
    if (cfg.engine.distributed.role == DS4_DISTRIBUTED_WORKER) {
        ds4_dist_generation_options gen = {
            .ctx_size = cfg.ctx_size,
        };
        int rc = ds4_dist_run(engine, &cfg.engine.distributed, &gen);
        ds4_engine_close(engine);
        return rc;
    }

    ds4_session *session = NULL;
    if (ds4_session_create(&session, engine, cfg.ctx_size) != 0) {
        server_log(DS4_LOG_DEFAULT, "ds4-server: failed to create %s session",
                   ds4_backend_name(cfg.engine.backend));
        ds4_engine_close(engine);
        return 1;
    }

    server s;
    memset(&s, 0, sizeof(s));
    s.engine = engine;
    s.session = session;
    s.default_tokens = cfg.default_tokens;
    s.disable_exact_dsml_tool_replay = cfg.disable_exact_dsml_tool_replay;
    s.tool_mem.max_entries = cfg.tool_memory_max_ids;
    s.enable_cors = cfg.enable_cors;
    if (cfg.kv_disk_dir) {
        kv_cache_open(&s.kv, cfg.kv_disk_dir, cfg.kv_disk_space_mb,
                      cfg.kv_cache_reject_different_quant, cfg.kv_cache);
    }
    if (s.disable_exact_dsml_tool_replay) {
        server_log(DS4_LOG_DEFAULT,
                   "ds4-server: exact DSML tool replay disabled; tool history uses canonical JSON rendering");
    }
    pthread_mutex_init(&s.mu, NULL);
    pthread_cond_init(&s.cv, NULL);
    pthread_cond_init(&s.clients_cv, NULL);
    pthread_mutex_init(&s.tool_mu, NULL);
    pthread_mutex_init(&s.trace_mu, NULL);
    if (cfg.trace_path) {
        s.trace = fopen(cfg.trace_path, "w");
        if (!s.trace) {
            server_log(DS4_LOG_DEFAULT, "ds4-server: failed to open trace file %s: %s",
                       cfg.trace_path, strerror(errno));
            server_close_resources(&s);
            return 1;
        }
        setvbuf(s.trace, NULL, _IONBF, 0);
        server_log(DS4_LOG_DEFAULT, "ds4-server: tracing session to %s", cfg.trace_path);
    }

    pthread_t worker;
    if (pthread_create(&worker, NULL, worker_main, &s) != 0) die("failed to start worker");

    int lfd = listen_on(cfg.host, cfg.port);
    if (lfd < 0) {
        server_log(DS4_LOG_DEFAULT, "ds4-server: failed to listen on %s:%d: %s", cfg.host, cfg.port, strerror(errno));
        pthread_mutex_lock(&s.mu);
        s.stopping = true;
        pthread_cond_broadcast(&s.cv);
        pthread_mutex_unlock(&s.mu);
        pthread_join(worker, NULL);
        server_close_resources(&s);
        return 1;
    }
    g_listen_fd = lfd;
    server_log(DS4_LOG_DEFAULT, "ds4-server: listening on http://%s:%d", cfg.host, cfg.port);

    while (!g_stop_requested) {
        int fd = accept(lfd, NULL, NULL);
        if (fd < 0) {
            if (g_stop_requested) break;
            if (errno == EINTR) continue;
            server_log(DS4_LOG_DEFAULT, "ds4-server: accept failed: %s", strerror(errno));
            continue;
        }
        if (g_stop_requested) {
            close(fd);
            break;
        }

        configure_client_socket(fd);
        client_arg *ca = xmalloc(sizeof(*ca));
        ca->srv = &s;
        ca->fd = fd;
        pthread_mutex_lock(&s.mu);
        s.clients++;
        pthread_mutex_unlock(&s.mu);
        pthread_t th;
        if (pthread_create(&th, NULL, client_main, ca) != 0) {
            pthread_mutex_lock(&s.mu);
            s.clients--;
            pthread_cond_broadcast(&s.clients_cv);
            pthread_mutex_unlock(&s.mu);
            free(ca);
            close(fd);
            continue;
        }
        pthread_detach(th);
    }
    if (g_listen_fd >= 0) {
        close(lfd);
        g_listen_fd = -1;
    }

    server_log(DS4_LOG_DEFAULT, "ds4-server: shutdown requested, draining requests");
    pthread_mutex_lock(&s.mu);
    s.stopping = true;
    pthread_cond_broadcast(&s.cv);
    pthread_mutex_unlock(&s.mu);
    pthread_join(worker, NULL);
    pthread_mutex_lock(&s.mu);
    while (s.clients > 0) pthread_cond_wait(&s.clients_cv, &s.mu);
    pthread_mutex_unlock(&s.mu);

    const ds4_tokens *tokens = ds4_session_tokens(s.session);
    if (s.kv.enabled && tokens && tokens->len >= s.kv.opt.min_tokens) {
        server_log(DS4_LOG_KVCACHE,
                   "ds4-server: persisting current KV cache before shutdown tokens=%d",
                   tokens->len);
        kv_cache_store_current(&s, "shutdown");
    }
    server_close_resources(&s);
    return 0;
}
#else

static int test_failures = 0;

static void test_assert(bool cond, const char *file, int line, const char *expr) {
    if (cond) return;
    fprintf(stderr, "%s:%d: assertion failed: %s\n", file, line, expr);
    test_failures++;
}

#define TEST_ASSERT(expr) test_assert((expr), __FILE__, __LINE__, #expr)

static void test_tool_schema_order_from_anthropic_schema(void) {
    tool_schema_orders orders = {0};
    tool_schema_orders_add_json(&orders,
        "{\"name\":\"bash\",\"input_schema\":{\"type\":\"object\",\"properties\":{"
        "\"command\":{\"type\":\"string\"},"
        "\"description\":{\"type\":\"string\"}}}}");
    const tool_schema_order *order = tool_schema_orders_find(&orders, "bash");
    TEST_ASSERT(order != NULL);
    TEST_ASSERT(order && order->len == 2);
    TEST_ASSERT(order && !strcmp(order->prop[0], "command"));
    TEST_ASSERT(order && !strcmp(order->prop[1], "description"));
    tool_schema_orders_free(&orders);
}

static void test_tool_schema_order_from_openai_tools(void) {
    const char *json =
        "[{\"type\":\"function\",\"function\":{\"name\":\"edit\",\"parameters\":{"
        "\"type\":\"object\",\"properties\":{"
        "\"filePath\":{\"type\":\"string\"},"
        "\"oldString\":{\"type\":\"string\"},"
        "\"newString\":{\"type\":\"string\"}}}}}]";
    const char *p = json;
    char *schemas = NULL;
    tool_schema_orders orders = {0};
    TEST_ASSERT(parse_tools_value(&p, &schemas, &orders));
    TEST_ASSERT(schemas && strstr(schemas, "\"name\":\"edit\""));
    const tool_schema_order *order = tool_schema_orders_find(&orders, "edit");
    TEST_ASSERT(order != NULL);
    TEST_ASSERT(order && order->len == 3);
    TEST_ASSERT(order && !strcmp(order->prop[0], "filePath"));
    TEST_ASSERT(order && !strcmp(order->prop[1], "oldString"));
    TEST_ASSERT(order && !strcmp(order->prop[2], "newString"));
    free(schemas);
    tool_schema_orders_free(&orders);
}

static void test_tool_schema_order_from_responses_tool_search(void) {
    const char *json =
        "[{\"type\":\"tool_search\",\"execution\":\"client\","
        "\"description\":\"Search deferred tools\","
        "\"parameters\":{\"type\":\"object\",\"properties\":{"
        "\"query\":{\"type\":\"string\"},"
        "\"limit\":{\"type\":\"number\"}},\"required\":[\"query\"]}}]";
    const char *p = json;
    char *schemas = NULL;
    tool_schema_orders orders = {0};
    TEST_ASSERT(parse_tools_value(&p, &schemas, &orders));
    TEST_ASSERT(schemas && strstr(schemas, "\"name\":\"tool_search\""));
    TEST_ASSERT(schemas && strstr(schemas, "\"description\":\"Search deferred tools\""));
    const tool_schema_order *order = tool_schema_orders_find(&orders, "tool_search");
    TEST_ASSERT(order != NULL);
    TEST_ASSERT(order && order->responses_tool_search);
    TEST_ASSERT(order && order->len == 2);
    TEST_ASSERT(order && !strcmp(order->prop[0], "query"));
    TEST_ASSERT(order && !strcmp(order->prop[1], "limit"));
    free(schemas);
    tool_schema_orders_free(&orders);
}

static void test_responses_function_named_tool_search_stays_function_call(void) {
    const char *json =
        "[{\"type\":\"function\",\"function\":{\"name\":\"tool_search\","
        "\"description\":\"A normal user function that happens to use a reserved name\","
        "\"parameters\":{\"type\":\"object\",\"properties\":{"
        "\"query\":{\"type\":\"string\"}}}}}]";
    const char *p = json;
    char *schemas = NULL;
    tool_schema_orders orders = {0};
    TEST_ASSERT(parse_tools_value(&p, &schemas, &orders));
    const tool_schema_order *order = tool_schema_orders_find(&orders, "tool_search");
    TEST_ASSERT(order != NULL);
    TEST_ASSERT(order && !order->responses_tool_search);

    tool_calls calls = {0};
    tool_call tc = {0};
    tc.id = xstrdup("call_user_tool_search");
    tc.name = xstrdup("tool_search");
    tc.arguments = xstrdup("{\"query\":\"plain function\"}");
    tool_calls_push(&calls, tc);
    responses_tool_item item = {
        .fc_id = "fc_user_tool_search",
        .call_id = "call_user_tool_search",
        .is_custom = false,
        .output_index = 0,
    };

    buf out = {0};
    responses_append_function_call_item(&out, &calls.v[0], &item,
                                        "completed", true, &orders);
    TEST_ASSERT(strstr(out.ptr, "\"type\":\"function_call\"") != NULL);
    TEST_ASSERT(strstr(out.ptr, "\"type\":\"tool_search_call\"") == NULL);

    buf_free(&out);
    tool_calls_free(&calls);
    free(schemas);
    tool_schema_orders_free(&orders);
}

static void test_responses_namespace_tool_schemas_restore_wire_namespace(void) {
    const char *json =
        "[{\"type\":\"namespace\",\"name\":\"mcp__perplexity__\","
        "\"description\":\"Perplexity tools\","
        "\"tools\":[{\"type\":\"function\",\"name\":\"perplexity_search\","
        "\"description\":\"Search the web\","
        "\"parameters\":{\"type\":\"object\",\"properties\":{"
        "\"query\":{\"type\":\"string\"},"
        "\"recency\":{\"type\":\"number\"}}}}]}]";
    const char *p = json;
    char *schemas = NULL;
    tool_schema_orders orders = {0};
    TEST_ASSERT(parse_tools_value(&p, &schemas, &orders));
    TEST_ASSERT(schemas && strstr(schemas, "\"name\":\"mcp__perplexity__perplexity_search\""));
    TEST_ASSERT(schemas && strstr(schemas, "\"name\":\"perplexity_search\"") == NULL);

    const tool_schema_order *order =
        tool_schema_orders_find(&orders, "mcp__perplexity__perplexity_search");
    TEST_ASSERT(order != NULL);
    TEST_ASSERT(order && order->namespace && !strcmp(order->namespace, "mcp__perplexity__"));
    TEST_ASSERT(order && order->wire_name && !strcmp(order->wire_name, "perplexity_search"));
    TEST_ASSERT(order && order->len == 2);

    tool_calls calls = {0};
    tool_call tc = {0};
    tc.id = xstrdup("call_ns");
    tc.name = xstrdup("mcp__perplexity__perplexity_search");
    tc.arguments = xstrdup("{\"query\":\"deepseek\",\"recency\":7}");
    tool_calls_push(&calls, tc);
    responses_tool_item item = {
        .fc_id = "fc_ns",
        .call_id = "call_ns",
        .is_custom = false,
        .output_index = 0,
    };
    buf out = {0};
    responses_append_function_call_item(&out, &calls.v[0], &item,
                                        "completed", true, &orders);
    TEST_ASSERT(strstr(out.ptr, "\"name\":\"perplexity_search\"") != NULL);
    TEST_ASSERT(strstr(out.ptr, "\"namespace\":\"mcp__perplexity__\"") != NULL);
    TEST_ASSERT(strstr(out.ptr, "mcp__perplexity__perplexity_search") == NULL);

    buf_free(&out);
    tool_calls_free(&calls);
    free(schemas);
    tool_schema_orders_free(&orders);
}

static void test_responses_input_tool_search_output_loads_tools(void) {
    const char *json =
        "["
        "{\"type\":\"tool_search_call\",\"call_id\":\"call_search\","
        "\"execution\":\"client\",\"arguments\":{\"query\":\"perplexity\"}},"
        "{\"type\":\"tool_search_output\",\"call_id\":\"call_search\","
        "\"status\":\"completed\",\"execution\":\"client\",\"tools\":["
        "{\"type\":\"namespace\",\"name\":\"mcp__perplexity__\","
        "\"description\":\"Perplexity tools\","
        "\"tools\":[{\"type\":\"function\",\"name\":\"perplexity_search\","
        "\"description\":\"Search with Perplexity\","
        "\"parameters\":{\"type\":\"object\",\"properties\":{"
        "\"query\":{\"type\":\"string\"}}}}]}]}"
        "]";
    const char *p = json;
    chat_msgs msgs = {0};
    buf loaded = {0};
    tool_schema_orders orders = {0};
    TEST_ASSERT(parse_responses_input(&p, &msgs, &loaded, &orders));
    TEST_ASSERT(loaded.ptr && strstr(loaded.ptr, "\"name\":\"mcp__perplexity__perplexity_search\""));
    const tool_schema_order *order =
        tool_schema_orders_find(&orders, "mcp__perplexity__perplexity_search");
    TEST_ASSERT(order != NULL);
    TEST_ASSERT(order && order->namespace && !strcmp(order->namespace, "mcp__perplexity__"));
    TEST_ASSERT(order && order->wire_name && !strcmp(order->wire_name, "perplexity_search"));
    TEST_ASSERT(msgs.len == 2);
    TEST_ASSERT(msgs.v[0].calls.len == 1);
    TEST_ASSERT(!strcmp(msgs.v[0].calls.v[0].name, "tool_search"));
    TEST_ASSERT(strstr(msgs.v[1].content, "mcp__perplexity__") != NULL);

    buf_free(&loaded);
    tool_schema_orders_free(&orders);
    chat_msgs_free(&msgs);
}

static void test_responses_input_tool_search_output_rejects_bad_tools(void) {
    const char *json =
        "[{\"type\":\"tool_search_output\",\"call_id\":\"call_search\","
        "\"status\":\"completed\",\"tools\":{\"not\":\"a tool array\"}}]";
    const char *p = json;
    chat_msgs msgs = {0};
    buf loaded = {0};
    tool_schema_orders orders = {0};
    TEST_ASSERT(!parse_responses_input(&p, &msgs, &loaded, &orders));
    buf_free(&loaded);
    tool_schema_orders_free(&orders);
    chat_msgs_free(&msgs);
}

static void test_responses_input_function_call_namespace_round_trips_to_dsml(void) {
    const char *tools_json =
        "[{\"type\":\"namespace\",\"name\":\"mcp__perplexity__\","
        "\"tools\":[{\"type\":\"function\",\"name\":\"perplexity_search\","
        "\"parameters\":{\"type\":\"object\",\"properties\":{"
        "\"query\":{\"type\":\"string\"}}}}]}]";
    const char *tools_p = tools_json;
    char *schemas = NULL;
    tool_schema_orders orders = {0};
    TEST_ASSERT(parse_tools_value(&tools_p, &schemas, &orders));

    const char *input_json =
        "[{\"type\":\"function_call\",\"call_id\":\"call_ns\","
        "\"name\":\"perplexity_search\",\"namespace\":\"mcp__perplexity__\","
        "\"arguments\":{\"query\":\"deepseek\"}}]";
    const char *input_p = input_json;
    chat_msgs msgs = {0};
    TEST_ASSERT(parse_responses_input(&input_p, &msgs, NULL, NULL));
    TEST_ASSERT(msgs.len == 1);
    TEST_ASSERT(msgs.v[0].calls.len == 1);
    TEST_ASSERT(!strcmp(msgs.v[0].calls.v[0].name,
                        "mcp__perplexity__perplexity_search"));

    char *prompt = render_chat_prompt_text(&msgs, schemas, &orders, DS4_THINK_HIGH);
    TEST_ASSERT(prompt != NULL);
    TEST_ASSERT(strstr(prompt,
        "<｜DSML｜invoke name=\"mcp__perplexity__perplexity_search\">") != NULL);
    TEST_ASSERT(strstr(prompt, "<｜DSML｜invoke name=\"perplexity_search\">") == NULL);

    free(prompt);
    chat_msgs_free(&msgs);
    free(schemas);
    tool_schema_orders_free(&orders);
}

static void test_responses_output_sends_tool_search_call_item(void) {
    tool_calls calls = {0};
    tool_call tc = {0};
    tc.id = xstrdup("call_search");
    tc.name = xstrdup("tool_search");
    tc.arguments = xstrdup("{\"limit\":3,\"query\":\"perplexity\"}");
    tool_calls_push(&calls, tc);
    const char *tools_json =
        "[{\"type\":\"tool_search\",\"execution\":\"client\","
        "\"parameters\":{\"type\":\"object\",\"properties\":{"
        "\"query\":{\"type\":\"string\"},\"limit\":{\"type\":\"number\"}}}}]";
    const char *tools_p = tools_json;
    char *schemas = NULL;
    tool_schema_orders orders = {0};
    TEST_ASSERT(parse_tools_value(&tools_p, &schemas, &orders));
    responses_tool_item item = {
        .fc_id = "fc_search",
        .call_id = "call_search",
        .is_custom = false,
        .output_index = 0,
    };

    buf out = {0};
    responses_append_function_call_item(&out, &calls.v[0], &item,
                                        "completed", true, &orders);
    TEST_ASSERT(strstr(out.ptr, "\"type\":\"tool_search_call\"") != NULL);
    TEST_ASSERT(strstr(out.ptr, "\"execution\":\"client\"") != NULL);
    TEST_ASSERT(strstr(out.ptr, "\"status\":\"completed\"") != NULL);
    TEST_ASSERT(strstr(out.ptr, "\"arguments\":{\"limit\":3,\"query\":\"perplexity\"}") != NULL);
    TEST_ASSERT(strstr(out.ptr, "\"type\":\"function_call\"") == NULL);

    buf_free(&out);
    free(schemas);
    tool_schema_orders_free(&orders);
    tool_calls_free(&calls);
}

static tool_calls make_swapped_bash_call(void) {
    tool_calls calls = {0};
    tool_call tc = {0};
    tc.name = xstrdup("bash");
    tc.arguments = xstrdup("{\"description\":\"list files\",\"command\":\"ls -la\",\"timeout\":10}");
    tool_calls_push(&calls, tc);
    return calls;
}

static tool_schema_orders make_bash_order(void) {
    tool_schema_orders orders = {0};
    tool_schema_orders_add_json(&orders,
        "{\"name\":\"bash\",\"input_schema\":{\"type\":\"object\",\"properties\":{"
        "\"command\":{\"type\":\"string\"},"
        "\"description\":{\"type\":\"string\"}}}}");
    return orders;
}

static char *read_socket_text(int fd) {
    buf b = {0};
    char tmp[1024];
    ssize_t n;
    while ((n = read(fd, tmp, sizeof(tmp))) > 0) {
        buf_append(&b, tmp, (size_t)n);
    }
    return buf_take(&b);
}

static void test_context_length_error_uses_protocol_standard_shape(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.prompt.len = 16;
    TEST_ASSERT(request_exceeds_context(&r, 16));
    TEST_ASSERT(!request_exceeds_context(&r, 17));

    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] >= 0 && sv[1] >= 0) {
        TEST_ASSERT(http_error_context_length_exceeded(sv[0], false, &r, 16, 16));
        shutdown(sv[0], SHUT_WR);
        char *out = read_socket_text(sv[1]);
        TEST_ASSERT(strstr(out, "HTTP/1.1 400") != NULL);
        TEST_ASSERT(strstr(out, "\"type\":\"invalid_request_error\"") != NULL);
        TEST_ASSERT(strstr(out, "\"code\":\"context_length_exceeded\"") != NULL);
        TEST_ASSERT(strstr(out, "\"param\":\"messages\"") != NULL);
        TEST_ASSERT(strstr(out, "\"n_prompt_tokens\":16") != NULL);
        TEST_ASSERT(strstr(out, "\"n_ctx\":16") != NULL);
        free(out);
        close(sv[0]);
        close(sv[1]);
    }
    request_free(&r);

    request a;
    request_init(&a, REQ_CHAT, 128);
    a.api = API_ANTHROPIC;

    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] >= 0 && sv[1] >= 0) {
        TEST_ASSERT(http_error_context_length_exceeded(sv[0], false, &a, 20, 20));
        shutdown(sv[0], SHUT_WR);
        char *out = read_socket_text(sv[1]);
        TEST_ASSERT(strstr(out, "{\"type\":\"error\",\"error\"") != NULL);
        TEST_ASSERT(strstr(out, "\"type\":\"invalid_request_error\"") != NULL);
        TEST_ASSERT(strstr(out, "\"n_prompt_tokens\":20") != NULL);
        free(out);
        close(sv[0]);
        close(sv[1]);
    }
    request_free(&a);
}

static void test_token_count_result_reports_exact_budget(void) {
    request r;
    request_init(&r, REQ_CHAT, 8192);
    r.prompt.len = 9210;
    free(r.model);
    r.model = xstrdup("deepseek-v4-flash");

    token_count_result result = token_count_calculate(&r, 65536);

    TEST_ASSERT(result.prompt_tokens == 9210);
    TEST_ASSERT(result.max_tokens == 8192);
    TEST_ASSERT(result.required_tokens == 17402);
    TEST_ASSERT(result.available_tokens == 48134);
    TEST_ASSERT(result.excess_tokens == 0);
    TEST_ASSERT(result.fits);

    r.prompt.len = 60000;
    result = token_count_calculate(&r, 65536);
    TEST_ASSERT(result.required_tokens == 68192);
    TEST_ASSERT(result.excess_tokens == 2656);
    TEST_ASSERT(!result.fits);
    request_free(&r);
}

static void test_token_count_response_uses_openai_request_parser(void) {
    server s = {0};
    request r;
    request_init(&r, REQ_CHAT, 32);
    r.prompt.len = 12;
    free(r.model);
    r.model = xstrdup("deepseek-v4-flash");

    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    TEST_ASSERT(send_token_count(&s, sv[0], &r, 64));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    TEST_ASSERT(strstr(out, "HTTP/1.1 200 OK") != NULL);
    TEST_ASSERT(strstr(out, "\"prompt_tokens\":12") != NULL);
    TEST_ASSERT(strstr(out, "\"max_tokens\":32") != NULL);
    TEST_ASSERT(strstr(out, "\"context_length\":64") != NULL);
    TEST_ASSERT(strstr(out, "\"required_tokens\":44") != NULL);
    TEST_ASSERT(strstr(out, "\"fits\":true") != NULL);

    free(out);
    close(sv[0]);
    close(sv[1]);
    request_free(&r);
}

static void test_cors_headers_are_opt_in(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] >= 0 && sv[1] >= 0) {
        TEST_ASSERT(http_response(sv[0], false, 200, "application/json", "{}"));
        shutdown(sv[0], SHUT_WR);
        char *out = read_socket_text(sv[1]);
        TEST_ASSERT(strstr(out, "HTTP/1.1 200 OK") != NULL);
        TEST_ASSERT(strstr(out, "Access-Control-Allow-Origin") == NULL);
        free(out);
        close(sv[0]);
        close(sv[1]);
    }

    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] >= 0 && sv[1] >= 0) {
        TEST_ASSERT(http_response(sv[0], true, 200, "application/json", "{}"));
        shutdown(sv[0], SHUT_WR);
        char *out = read_socket_text(sv[1]);
        TEST_ASSERT(strstr(out, "HTTP/1.1 200 OK") != NULL);
        TEST_ASSERT(strstr(out, "Access-Control-Allow-Origin: *") != NULL);
        TEST_ASSERT(strstr(out, "Access-Control-Allow-Methods: GET, POST, OPTIONS") != NULL);
        TEST_ASSERT(strstr(out, "Access-Control-Allow-Headers: *") != NULL);
        free(out);
        close(sv[0]);
        close(sv[1]);
    }
}

static void test_cors_preflight_response_is_no_content(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    TEST_ASSERT(http_response(sv[0], true, 204, NULL, ""));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);
    TEST_ASSERT(strstr(out, "HTTP/1.1 204 No Content") != NULL);
    TEST_ASSERT(strstr(out, "Content-Length: 0") != NULL);
    TEST_ASSERT(strstr(out, "Content-Type:") == NULL);
    TEST_ASSERT(strstr(out, "Access-Control-Allow-Origin: *") != NULL);

    free(out);
    close(sv[0]);
    close(sv[1]);
}

static void test_cors_sse_headers(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    TEST_ASSERT(sse_headers(sv[0], true));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);
    TEST_ASSERT(strstr(out, "HTTP/1.1 200 OK") != NULL);
    TEST_ASSERT(strstr(out, "Content-Type: text/event-stream") != NULL);
    TEST_ASSERT(strstr(out, "Access-Control-Allow-Origin: *") != NULL);

    free(out);
    close(sv[0]);
    close(sv[1]);
}

static void test_anthropic_live_stream_sends_incremental_blocks(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_ANTHROPIC;
    r.stream = true;
    r.think_mode = DS4_THINK_HIGH;
    r.has_tools = true;
    r.tool_orders = make_bash_order();

    anthropic_stream st;
    TEST_ASSERT(anthropic_sse_start_live(sv[0], &r, "msg_test", 10, &st));
    const char *raw1 = "need a tool</think>Hello.\n\n";
    TEST_ASSERT(anthropic_sse_stream_update(sv[0], NULL, &r, "msg_test", &st,
                                            raw1, strlen(raw1), false));

    const char *raw =
        "need a tool</think>Hello.\n\n"
        DS4_TOOL_CALLS_START "\n";
    TEST_ASSERT(anthropic_sse_stream_update(sv[0], NULL, &r, "msg_test", &st,
                                            raw, strlen(raw), false));

    tool_calls calls = make_swapped_bash_call();
    TEST_ASSERT(anthropic_sse_finish_live(sv[0], NULL, &r, "msg_test", &st,
                                          raw, strlen(raw), &calls,
                                          "tool_calls", 8));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    const char *msg_start = strstr(out, "event: message_start");
    const char *thinking = strstr(out, "\"thinking\":\"need a tool\"");
    const char *signature = strstr(out, "\"type\":\"signature_delta\"");
    const char *text = strstr(out, "\"text\":\"Hello.\"");
    const char *tool = strstr(out, "\"type\":\"tool_use\"");
    const char *stop = strstr(out, "event: message_stop");
    TEST_ASSERT(msg_start != NULL);
    TEST_ASSERT(thinking != NULL);
    TEST_ASSERT(signature != NULL);
    TEST_ASSERT(text != NULL);
    TEST_ASSERT(tool != NULL);
    TEST_ASSERT(stop != NULL);
    TEST_ASSERT(msg_start < thinking);
    TEST_ASSERT(thinking < signature);
    TEST_ASSERT(signature < text);
    TEST_ASSERT(text < tool);
    TEST_ASSERT(tool < stop);
    TEST_ASSERT(strstr(out, DS4_TOOL_CALLS_START) == NULL);

    free(out);
    tool_calls_free(&calls);
    anthropic_stream_free(&st);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_anthropic_tool_stream_sends_live_tool_use(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_ANTHROPIC;
    r.stream = true;
    r.think_mode = DS4_THINK_NONE;
    r.has_tools = true;
    r.tool_orders = make_bash_order();

    anthropic_stream st;
    TEST_ASSERT(anthropic_sse_start_live(sv[0], &r, "msg_tool", 7, &st));

    const char *raw =
        "Before.\n\n"
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"bash\">\n"
        DS4_PARAM_START " name=\"command\" string=\"true\">echo partial";
    TEST_ASSERT(anthropic_sse_stream_update(sv[0], NULL, &r, "msg_tool", &st,
                                            raw, strlen(raw), false));

    const char *raw_complete =
        "Before.\n\n"
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"bash\">\n"
        DS4_PARAM_START " name=\"command\" string=\"true\">echo partial done" DS4_PARAM_END "\n"
        DS4_INVOKE_END "\n"
        DS4_TOOL_CALLS_END;
    TEST_ASSERT(anthropic_sse_stream_update(sv[0], NULL, &r, "msg_tool", &st,
                                            raw_complete, strlen(raw_complete), false));

    char *parsed_content = NULL;
    char *parsed_reasoning = NULL;
    tool_calls calls = {0};
    TEST_ASSERT(parse_generated_message_ex(raw_complete, false, &parsed_content,
                                           &parsed_reasoning, &calls));
    TEST_ASSERT(calls.len == 1);
    apply_anthropic_stream_tool_ids(&calls, &st);
    TEST_ASSERT(calls.v[0].id != NULL);
    TEST_ASSERT(!strncmp(calls.v[0].id, "toolu_", 6));
    TEST_ASSERT(anthropic_sse_finish_live(sv[0], NULL, &r, "msg_tool", &st,
                                          raw_complete, strlen(raw_complete),
                                          &calls, "tool_calls", 5));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    const char *text = strstr(out, "\"text\":\"Before.\"");
    const char *tool = strstr(out, "\"type\":\"tool_use\"");
    const char *key = strstr(out, "\\\"command\\\":\\\"");
    const char *partial = strstr(out, "\"partial_json\":\"echo partial\"");
    const char *rest = strstr(out, "\"partial_json\":\" done\"");
    const char *stop = strstr(out, "event: message_stop");
    int tool_use_count = 0;
    for (const char *p = out; (p = strstr(p, "\"type\":\"tool_use\"")) != NULL; p++) {
        tool_use_count++;
    }
    TEST_ASSERT(text != NULL);
    TEST_ASSERT(tool != NULL);
    TEST_ASSERT(key != NULL);
    TEST_ASSERT(partial != NULL);
    TEST_ASSERT(rest != NULL);
    TEST_ASSERT(stop != NULL);
    TEST_ASSERT(strstr(out, calls.v[0].id) != NULL);
    TEST_ASSERT(text < tool);
    TEST_ASSERT(tool < key);
    TEST_ASSERT(key < partial);
    TEST_ASSERT(partial < rest);
    TEST_ASSERT(rest < stop);
    TEST_ASSERT(tool_use_count == 1);
    TEST_ASSERT(strstr(out, DS4_TOOL_CALLS_START) == NULL);
    TEST_ASSERT(strstr(out, DS4_PARAM_START) == NULL);

    free(out);
    free(parsed_content);
    free(parsed_reasoning);
    tool_calls_free(&calls);
    anthropic_stream_free(&st);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_anthropic_usage_reports_cache_details(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_ANTHROPIC;
    r.cache_read_tokens = 7;
    r.cache_write_tokens = 3;

    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) {
        request_free(&r);
        return;
    }

    TEST_ASSERT(anthropic_final_response(sv[0], false, &r, "msg_usage", "OK", NULL, NULL, "stop", 10, 2));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    TEST_ASSERT(strstr(out, "\"usage\":{\"input_tokens\":0") != NULL);
    TEST_ASSERT(strstr(out, "\"output_tokens\":2") != NULL);
    TEST_ASSERT(strstr(out, "\"cache_read_input_tokens\":7") != NULL);
    TEST_ASSERT(strstr(out, "\"cache_creation_input_tokens\":3") != NULL);

    free(out);
    close(sv[0]);
    close(sv[1]);

    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) {
        request_free(&r);
        return;
    }

    anthropic_stream st;
    TEST_ASSERT(anthropic_sse_start_live(sv[0], &r, "msg_usage_stream", 10, &st));
    shutdown(sv[0], SHUT_WR);
    out = read_socket_text(sv[1]);

    TEST_ASSERT(strstr(out, "event: message_start") != NULL);
    TEST_ASSERT(strstr(out, "\"usage\":{\"input_tokens\":0") != NULL);
    TEST_ASSERT(strstr(out, "\"output_tokens\":0") != NULL);
    TEST_ASSERT(strstr(out, "\"cache_read_input_tokens\":7") != NULL);
    TEST_ASSERT(strstr(out, "\"cache_creation_input_tokens\":3") != NULL);

    free(out);
    close(sv[0]);
    close(sv[1]);
    request_free(&r);
}

static void test_openai_tool_stream_sends_incremental_text(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.stream = true;
    r.think_mode = DS4_THINK_HIGH;
    r.has_tools = true;
    r.tool_orders = make_bash_order();

    TEST_ASSERT(sse_chunk(sv[0], &r, "chatcmpl_test", NULL, NULL));

    openai_stream st;
    openai_stream_start(&r, &st);
    const char *raw1 = "<think>need a tool</think>Hello.\n\n";
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_test", &st,
                                         raw1, strlen(raw1), false));

    const char *raw =
        "<think>need a tool</think>Hello.\n\n"
        DS4_TOOL_CALLS_START "\n";
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_test", &st,
                                         raw, strlen(raw), false));

    tool_calls calls = make_swapped_bash_call();
    TEST_ASSERT(openai_sse_finish_live(sv[0], NULL, &r, "chatcmpl_test", &st,
                                       raw, strlen(raw), &calls,
                                       "tool_calls", 10, 8));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    const char *role = strstr(out, "\"role\":\"assistant\"");
    const char *thinking = strstr(out, "\"reasoning_content\":\"need a tool\"");
    const char *text = strstr(out, "\"content\":\"Hello.\"");
    const char *tool = strstr(out, "\"tool_calls\"");
    const char *done = strstr(out, "data: [DONE]");
    TEST_ASSERT(role != NULL);
    TEST_ASSERT(thinking != NULL);
    TEST_ASSERT(text != NULL);
    TEST_ASSERT(tool != NULL);
    TEST_ASSERT(done != NULL);
    TEST_ASSERT(role < thinking);
    TEST_ASSERT(thinking < text);
    TEST_ASSERT(text < tool);
    TEST_ASSERT(tool < done);
    TEST_ASSERT(strstr(out, DS4_TOOL_CALLS_START) == NULL);
    TEST_ASSERT(strstr(out, "<think>") == NULL);

    free(out);
    tool_calls_free(&calls);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_openai_stream_usage_reports_cache_details(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.stream = true;
    r.stream_include_usage = true;
    r.cache_read_tokens = 7;
    r.cache_write_tokens = 3;

    TEST_ASSERT(sse_done(sv[0], &r, "chatcmpl_usage", 10, 2));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    TEST_ASSERT(strstr(out, "\"usage\":{\"prompt_tokens\":10") != NULL);
    TEST_ASSERT(strstr(out, "\"completion_tokens\":2") != NULL);
    TEST_ASSERT(strstr(out, "\"total_tokens\":12") != NULL);
    TEST_ASSERT(strstr(out, "\"prompt_tokens_details\":{") != NULL);
    TEST_ASSERT(strstr(out, "\"cached_tokens\":7") != NULL);
    TEST_ASSERT(strstr(out, "\"cache_write_tokens\":3") != NULL);
    TEST_ASSERT(strstr(out, "data: [DONE]") != NULL);

    free(out);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_responses_usage_reports_cache_details(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_RESPONSES;
    r.cache_read_tokens = 7;
    r.cache_write_tokens = 3;

    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) {
        request_free(&r);
        return;
    }

    TEST_ASSERT(responses_final_response(sv[0], false, &r, "resp_usage", "OK", NULL, NULL,
                                         "stop", 10, 2));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    TEST_ASSERT(strstr(out, "\"usage\":{\"input_tokens\":10") != NULL);
    TEST_ASSERT(strstr(out, "\"input_tokens_details\":{") != NULL);
    TEST_ASSERT(strstr(out, "\"cached_tokens\":7") != NULL);
    TEST_ASSERT(strstr(out, "\"cache_write_tokens\":3") != NULL);
    TEST_ASSERT(strstr(out, "\"output_tokens\":2") != NULL);
    TEST_ASSERT(strstr(out, "\"total_tokens\":12") != NULL);

    free(out);
    close(sv[0]);
    close(sv[1]);

    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) {
        request_free(&r);
        return;
    }

    responses_stream st;
    responses_stream_init(&r, &st);
    TEST_ASSERT(responses_sse_completed(sv[0], &r, &st, NULL, NULL,
                                        "stop", 10, 2, 1234));
    shutdown(sv[0], SHUT_WR);
    out = read_socket_text(sv[1]);

    TEST_ASSERT(strstr(out, "\"type\":\"response.completed\"") != NULL);
    TEST_ASSERT(strstr(out, "\"usage\":{\"input_tokens\":10") != NULL);
    TEST_ASSERT(strstr(out, "\"input_tokens_details\":{") != NULL);
    TEST_ASSERT(strstr(out, "\"cached_tokens\":7") != NULL);
    TEST_ASSERT(strstr(out, "\"cache_write_tokens\":3") != NULL);
    TEST_ASSERT(strstr(out, "\"output_tokens\":2") != NULL);
    TEST_ASSERT(strstr(out, "\"total_tokens\":12") != NULL);

    free(out);
    responses_stream_free(&st);
    close(sv[0]);
    close(sv[1]);
    request_free(&r);
}

static void test_openai_chat_stream_splits_reasoning_without_tools(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.stream = true;
    r.think_mode = DS4_THINK_HIGH;
    r.has_tools = false;

    TEST_ASSERT(request_uses_structured_stream(&r));
    TEST_ASSERT(request_uses_openai_live_stream(&r));
    TEST_ASSERT(sse_chunk(sv[0], &r, "chatcmpl_title", NULL, NULL));

    openai_stream st;
    openai_stream_start(&r, &st);
    const char *raw1 = "We need to generate a title";
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_title", &st,
                                         raw1, strlen(raw1), false));

    const char *raw2 =
        "We need to generate a title</think>Free disk space check";
    TEST_ASSERT(openai_sse_finish_live(sv[0], NULL, &r, "chatcmpl_title", &st,
                                       raw2, strlen(raw2), NULL,
                                       "stop", 12, 8));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    const char *role = strstr(out, "\"role\":\"assistant\"");
    const char *reasoning1 = strstr(out, "\"reasoning_content\":\"We need to generate \"");
    const char *reasoning2 = strstr(out, "\"reasoning_content\":\"a title\"");
    const char *content = strstr(out, "\"content\":\"Free disk space check\"");
    const char *done = strstr(out, "data: [DONE]");
    TEST_ASSERT(role != NULL);
    TEST_ASSERT(reasoning1 != NULL);
    TEST_ASSERT(reasoning2 != NULL);
    TEST_ASSERT(content != NULL);
    TEST_ASSERT(done != NULL);
    TEST_ASSERT(role < reasoning1);
    TEST_ASSERT(reasoning1 < reasoning2);
    TEST_ASSERT(reasoning2 < content);
    TEST_ASSERT(content < done);
    TEST_ASSERT(strstr(out, "\"content\":\"We need to generate a title") == NULL);
    TEST_ASSERT(strstr(out, "</think>") == NULL);

    free(out);
    openai_stream_free(&st);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_openai_tool_stream_sends_partial_arguments(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.stream = true;
    r.think_mode = DS4_THINK_NONE;
    r.has_tools = true;
    r.tool_orders = make_bash_order();

    TEST_ASSERT(sse_chunk(sv[0], &r, "chatcmpl_partial_tool", NULL, NULL));

    openai_stream st;
    openai_stream_start(&r, &st);
    const char *raw =
        "Before.\n\n"
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"bash\">\n"
        DS4_PARAM_START " name=\"command\" string=\"true\">echo partial";
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_partial_tool", &st,
                                         raw, strlen(raw), false));

    const char *raw_complete =
        "Before.\n\n"
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"bash\">\n"
        DS4_PARAM_START " name=\"command\" string=\"true\">echo partial done" DS4_PARAM_END "\n"
        DS4_INVOKE_END "\n"
        DS4_TOOL_CALLS_END;
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_partial_tool", &st,
                                         raw_complete, strlen(raw_complete), false));

    char *parsed_content = NULL;
    char *parsed_reasoning = NULL;
    tool_calls calls = {0};
    TEST_ASSERT(parse_generated_message_ex(raw_complete, false, &parsed_content, &parsed_reasoning, &calls));
    TEST_ASSERT(calls.len == 1);
    apply_openai_stream_tool_ids(&calls, &st);
    TEST_ASSERT(calls.v[0].id != NULL);
    TEST_ASSERT(!strncmp(calls.v[0].id, "call_", 5));
    TEST_ASSERT(openai_sse_finish_live(sv[0], NULL, &r, "chatcmpl_partial_tool", &st,
                                       raw_complete, strlen(raw_complete), &calls,
                                       "tool_calls", 10, 4));

    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    const char *text = strstr(out, "\"content\":\"Before.\"");
    const char *tool = strstr(out, "\"tool_calls\"");
    const char *key = strstr(out, "\\\"command\\\":\\\"");
    const char *partial = strstr(out, "\"arguments\":\"echo partial\"");
    const char *rest = strstr(out, "\"arguments\":\" done\"");
    int tool_id_count = 0;
    for (const char *p = out; (p = strstr(p, "\"id\":\"call_")) != NULL; p++) tool_id_count++;
    TEST_ASSERT(text != NULL);
    TEST_ASSERT(tool != NULL);
    TEST_ASSERT(key != NULL);
    TEST_ASSERT(partial != NULL);
    TEST_ASSERT(rest != NULL);
    TEST_ASSERT(strstr(out, calls.v[0].id) != NULL);
    TEST_ASSERT(text < tool);
    TEST_ASSERT(tool < partial);
    TEST_ASSERT(partial < rest);
    TEST_ASSERT(tool_id_count == 1);
    TEST_ASSERT(strstr(out, DS4_TOOL_CALLS_START) == NULL);
    TEST_ASSERT(strstr(out, DS4_PARAM_START) == NULL);

    free(out);
    free(parsed_content);
    free(parsed_reasoning);
    tool_calls_free(&calls);
    openai_stream_free(&st);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_openai_tool_stream_waits_for_incomplete_tool_tags(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.stream = true;
    r.think_mode = DS4_THINK_NONE;
    r.has_tools = true;

    openai_stream st;
    openai_stream_start(&r, &st);
    const char *raw_invoke = DS4_TOOL_CALLS_START "\n" DS4_INVOKE_START;
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_incomplete_tool", &st,
                                         raw_invoke, strlen(raw_invoke), false));
    TEST_ASSERT(st.mode == OPENAI_STREAM_TOOL);
    TEST_ASSERT(st.tool.state == DSML_TOOL_BETWEEN_INVOKES);

    const char *raw_param =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"bash\">\n"
        DS4_PARAM_START;
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_incomplete_tool", &st,
                                         raw_param, strlen(raw_param), false));
    TEST_ASSERT(st.mode == OPENAI_STREAM_TOOL);
    TEST_ASSERT(st.tool.state == DSML_TOOL_BETWEEN_PARAMS);

    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);
    TEST_ASSERT(strstr(out, "\"name\":\"bash\"") != NULL);
    TEST_ASSERT(strstr(out, DS4_PARAM_START) == NULL);

    free(out);
    openai_stream_free(&st);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_openai_tool_stream_sends_partial_raw_arguments(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.stream = true;
    r.think_mode = DS4_THINK_NONE;
    r.has_tools = true;

    openai_stream st;
    openai_stream_start(&r, &st);
    const char *raw =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"edit\">\n"
        DS4_PARAM_START " name=\"edits\" string=\"false\">[1,2,3";
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_raw_tool", &st,
                                         raw, strlen(raw), false));

    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    TEST_ASSERT(strstr(out, "\"name\":\"edit\"") != NULL);
    TEST_ASSERT(strstr(out, "\\\"edits\\\":") != NULL);
    TEST_ASSERT(strstr(out, "\"arguments\":\"[1,2,3\"") != NULL);
    TEST_ASSERT(strstr(out, DS4_TOOL_CALLS_START) == NULL);

    free(out);
    openai_stream_free(&st);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_openai_tool_stream_holds_partial_dsml_entities(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.stream = true;
    r.think_mode = DS4_THINK_NONE;
    r.has_tools = true;

    openai_stream st;
    openai_stream_start(&r, &st);
    const char *raw_partial =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"bash\">\n"
        DS4_PARAM_START " name=\"command\" string=\"true\">echo &amp";
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_entity_tool", &st,
                                         raw_partial, strlen(raw_partial), false));

    const char *raw_complete =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"bash\">\n"
        DS4_PARAM_START " name=\"command\" string=\"true\">echo &amp; done" DS4_PARAM_END "\n"
        DS4_INVOKE_END "\n"
        DS4_TOOL_CALLS_END;
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_entity_tool", &st,
                                         raw_complete, strlen(raw_complete), false));

    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    TEST_ASSERT(strstr(out, "\"arguments\":\"echo \"") != NULL);
    TEST_ASSERT(strstr(out, "\"arguments\":\"& done\"") != NULL);
    TEST_ASSERT(strstr(out, "&amp") == NULL);

    free(out);
    openai_stream_free(&st);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_openai_tool_stream_holds_partial_utf8_arguments(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.stream = true;
    r.think_mode = DS4_THINK_NONE;
    r.has_tools = true;

    openai_stream st;
    openai_stream_start(&r, &st);
    const char prefix[] =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"write\">\n"
        DS4_PARAM_START " name=\"content\" string=\"true\">flag ";
    const char suffix[] =
        " done" DS4_PARAM_END "\n"
        DS4_INVOKE_END "\n"
        DS4_TOOL_CALLS_END;
    const char flag_utf8[] = {(char)0xf0, (char)0x9f, (char)0x9a, (char)0xa9, 0};
    const char replacement[] = {(char)0xef, (char)0xbf, (char)0xbd, 0};

    buf partial = {0};
    buf_append(&partial, prefix, strlen(prefix));
    buf_putc(&partial, (char)0xf0);
    buf_putc(&partial, (char)0x9f);
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_utf8_tool", &st,
                                         partial.ptr, partial.len, false));

    buf complete = {0};
    buf_append(&complete, prefix, strlen(prefix));
    buf_append(&complete, flag_utf8, 4);
    buf_append(&complete, suffix, strlen(suffix));
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_utf8_tool", &st,
                                         complete.ptr, complete.len, false));

    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    TEST_ASSERT(strstr(out, "\"arguments\":\"flag \"") != NULL);
    TEST_ASSERT(strstr(out, flag_utf8) != NULL);
    TEST_ASSERT(strstr(out, replacement) == NULL);

    free(out);
    buf_free(&partial);
    buf_free(&complete);
    openai_stream_free(&st);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_openai_tool_stream_handles_multiple_calls(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.stream = true;
    r.think_mode = DS4_THINK_NONE;
    r.has_tools = true;

    openai_stream st;
    openai_stream_start(&r, &st);
    const char *raw =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"read\">\n"
        DS4_PARAM_START " name=\"path\" string=\"true\">a.c" DS4_PARAM_END "\n"
        DS4_INVOKE_END "\n"
        DS4_INVOKE_START " name=\"bash\">\n"
        DS4_PARAM_START " name=\"command\" string=\"true\">wc -l a.c" DS4_PARAM_END "\n"
        DS4_INVOKE_END "\n"
        DS4_TOOL_CALLS_END;
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_multi_tool", &st,
                                         raw, strlen(raw), false));

    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    int tool_id_count = 0;
    for (const char *p = out; (p = strstr(p, "\"id\":\"call_")) != NULL; p++) tool_id_count++;
    TEST_ASSERT(tool_id_count == 2);
    TEST_ASSERT(strstr(out, "\"name\":\"read\"") != NULL);
    TEST_ASSERT(strstr(out, "\"name\":\"bash\"") != NULL);
    TEST_ASSERT(strstr(out, "\\\"path\\\":") != NULL);
    TEST_ASSERT(strstr(out, "\\\"command\\\":") != NULL);

    free(out);
    openai_stream_free(&st);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_streaming_holds_partial_utf8(void) {
    const char partial[] = {'A', ' ', (char)0xf0, (char)0x9f, 0};
    const char complete[] = {'A', ' ', (char)0xf0, (char)0x9f,
                             (char)0x9a, (char)0xa9, ' ', 'd', 'o', 'n', 'e', 0};
    const char flag_done[] = {(char)0xf0, (char)0x9f,
                              (char)0x9a, (char)0xa9, ' ', 'd', 'o', 'n', 'e', 0};
    const char replacement[] = {(char)0xef, (char)0xbf, (char)0xbd, 0};

    TEST_ASSERT(utf8_stream_safe_len(partial, 0, strlen(partial), false) == 2);
    TEST_ASSERT(utf8_stream_safe_len(complete, 0, strlen(complete), false) == strlen(complete));

    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_OPENAI;
    r.stream = true;
    r.think_mode = DS4_THINK_NONE;

    openai_stream st;
    openai_stream_start(&r, &st);
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_utf8", &st,
                                         partial, strlen(partial), false));
    TEST_ASSERT(openai_sse_stream_update(sv[0], NULL, &r, "chatcmpl_utf8", &st,
                                         complete, strlen(complete), false));
    shutdown(sv[0], SHUT_WR);
    char *out = read_socket_text(sv[1]);

    TEST_ASSERT(strstr(out, "\"content\":\"A \"") != NULL);
    TEST_ASSERT(strstr(out, flag_done) != NULL);
    TEST_ASSERT(strstr(out, replacement) == NULL);

    free(out);
    openai_stream_free(&st);
    request_free(&r);
    close(sv[0]);
    close(sv[1]);
}

static void test_request_defaults_use_min_p_filtering(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    TEST_ASSERT(r.think_mode == DS4_THINK_HIGH);
    TEST_ASSERT(r.temperature == DS4_DEFAULT_TEMPERATURE);
    TEST_ASSERT(r.top_p == DS4_DEFAULT_TOP_P);
    TEST_ASSERT(r.top_k == 0);
    TEST_ASSERT(r.min_p == DS4_DEFAULT_MIN_P);
    request_free(&r);
}

static void test_reasoning_effort_mapping(void) {
    ds4_think_mode mode = DS4_THINK_NONE;
    TEST_ASSERT(parse_reasoning_effort_name("low", &mode) && mode == DS4_THINK_HIGH);
    TEST_ASSERT(parse_reasoning_effort_name("medium", &mode) && mode == DS4_THINK_HIGH);
    TEST_ASSERT(parse_reasoning_effort_name("high", &mode) && mode == DS4_THINK_HIGH);
    TEST_ASSERT(parse_reasoning_effort_name("xhigh", &mode) && mode == DS4_THINK_HIGH);
    TEST_ASSERT(parse_reasoning_effort_name("max", &mode) && mode == DS4_THINK_MAX);
    TEST_ASSERT(!parse_reasoning_effort_name("banana", &mode));
    TEST_ASSERT(ds4_think_mode_for_context(DS4_THINK_MAX, 32768) == DS4_THINK_HIGH);
    TEST_ASSERT(ds4_think_mode_for_context(DS4_THINK_MAX,
                                           (int)ds4_think_max_min_context()) == DS4_THINK_MAX);
}

static void test_api_thinking_controls_parse(void) {
    bool enabled = true;
    const char *thinking = "{\"type\":\"disabled\",\"budget_tokens\":1024}";
    TEST_ASSERT(parse_thinking_control_value(&thinking, &enabled));
    TEST_ASSERT(!enabled);
    thinking = "true";
    TEST_ASSERT(parse_thinking_control_value(&thinking, &enabled));
    TEST_ASSERT(enabled);

    ds4_think_mode mode = DS4_THINK_HIGH;
    const char *anth_effort = "{\"effort\":\"max\",\"other\":true}";
    TEST_ASSERT(parse_output_config_effort(&anth_effort, &mode));
    TEST_ASSERT(mode == DS4_THINK_MAX);

    const char *openai_effort = "\"xhigh\"";
    mode = DS4_THINK_HIGH;
    TEST_ASSERT(parse_reasoning_effort_value(&openai_effort, &mode));
    TEST_ASSERT(mode == DS4_THINK_HIGH);
}

static void test_render_think_max_prompt_prefix(void) {
    chat_msgs msgs = {0};
    chat_msg sys = {0};
    sys.role = xstrdup("system");
    sys.content = xstrdup("You are terse.");
    chat_msgs_push(&msgs, sys);
    chat_msg user = {0};
    user.role = xstrdup("user");
    user.content = xstrdup("Hello");
    chat_msgs_push(&msgs, user);

    char *prompt = render_chat_prompt_text(&msgs, NULL, NULL, DS4_THINK_MAX);
    TEST_ASSERT(prompt != NULL);
    TEST_ASSERT(!strncmp(prompt, "<｜begin▁of▁sentence｜>", strlen("<｜begin▁of▁sentence｜>")));
    TEST_ASSERT(strstr(prompt, ds4_think_max_prefix()) != NULL);
    TEST_ASSERT(strstr(prompt, "You are terse.<｜User｜>Hello<｜Assistant｜><think>") != NULL);
    TEST_ASSERT(strstr(prompt, "</think>") == NULL);

    free(prompt);
    chat_msgs_free(&msgs);
}

static void test_render_non_thinking_prompt_closes_think(void) {
    chat_msgs msgs = {0};
    chat_msg user = {0};
    user.role = xstrdup("user");
    user.content = xstrdup("Hello");
    chat_msgs_push(&msgs, user);

    char *prompt = render_chat_prompt_text(&msgs, NULL, NULL, DS4_THINK_NONE);
    TEST_ASSERT(prompt != NULL);
    TEST_ASSERT(strstr(prompt, ds4_think_max_prefix()) == NULL);
    TEST_ASSERT(strstr(prompt, "<｜User｜>Hello<｜Assistant｜></think>") != NULL);
    free(prompt);
    chat_msgs_free(&msgs);
}

static void test_render_drops_old_reasoning_without_tools(void) {
    chat_msgs msgs = {0};
    chat_msg user1 = {0};
    user1.role = xstrdup("user");
    user1.content = xstrdup("first");
    chat_msgs_push(&msgs, user1);
    chat_msg assistant = {0};
    assistant.role = xstrdup("assistant");
    assistant.reasoning = xstrdup("old hidden reasoning");
    assistant.content = xstrdup("first answer");
    chat_msgs_push(&msgs, assistant);
    chat_msg user2 = {0};
    user2.role = xstrdup("user");
    user2.content = xstrdup("second");
    chat_msgs_push(&msgs, user2);

    char *prompt = render_chat_prompt_text(&msgs, NULL, NULL, DS4_THINK_HIGH);
    TEST_ASSERT(prompt != NULL);
    TEST_ASSERT(strstr(prompt, "old hidden reasoning") == NULL);
    TEST_ASSERT(strstr(prompt, "<｜Assistant｜></think>first answer") != NULL);
    TEST_ASSERT(strstr(prompt, "<｜User｜>second<｜Assistant｜><think>") != NULL);

    free(prompt);
    chat_msgs_free(&msgs);
}

static void test_render_preserves_reasoning_with_tools(void) {
    chat_msgs msgs = {0};
    chat_msg user1 = {0};
    user1.role = xstrdup("user");
    user1.content = xstrdup("first");
    chat_msgs_push(&msgs, user1);
    chat_msg assistant = {0};
    assistant.role = xstrdup("assistant");
    assistant.reasoning = xstrdup("tool reasoning");
    assistant.content = xstrdup("");
    tool_call tc = {0};
    tc.name = xstrdup("bash");
    tc.arguments = xstrdup("{\"command\":\"pwd\"}");
    tool_calls_push(&assistant.calls, tc);
    chat_msgs_push(&msgs, assistant);
    chat_msg tool = {0};
    tool.role = xstrdup("tool");
    tool.content = xstrdup("/tmp");
    chat_msgs_push(&msgs, tool);

    char *prompt = render_chat_prompt_text(&msgs, "{}", NULL, DS4_THINK_HIGH);
    TEST_ASSERT(prompt != NULL);
    TEST_ASSERT(strstr(prompt, "<think>tool reasoning</think>") != NULL);
    TEST_ASSERT(strstr(prompt, "<tool_result>/tmp</tool_result>") != NULL);
    free(prompt);

    prompt = render_chat_prompt_text(&msgs, NULL, NULL, DS4_THINK_HIGH);
    TEST_ASSERT(prompt != NULL);
    TEST_ASSERT(strstr(prompt, "<think>tool reasoning</think>") != NULL);
    TEST_ASSERT(strstr(prompt, "<tool_result>/tmp</tool_result>") != NULL);

    free(prompt);
    chat_msgs_free(&msgs);
}

static void test_render_chat_prompt_text_renders_tools_before_system(void) {
    /* The tool-schema block must sit at the head of the system region so the
     * client's system content stays at the tail, right before <｜User｜>.
     * That keeps a per-request dynamic tail (e.g. a timestamp) out of the
     * cached prefix without losing the tool schemas to the trim. */
    chat_msgs msgs = {0};
    chat_msg sys = {0};
    sys.role = xstrdup("system");
    sys.content = xstrdup("CLIENT_SYSTEM_MARKER");
    chat_msgs_push(&msgs, sys);
    chat_msg user = {0};
    user.role = xstrdup("user");
    user.content = xstrdup("hello");
    chat_msgs_push(&msgs, user);

    char *prompt = render_chat_prompt_text(&msgs, "TOOL_SCHEMA_MARKER", NULL,
                                           DS4_THINK_HIGH);
    TEST_ASSERT(prompt != NULL);
    const char *tools  = strstr(prompt, "## Tools");
    const char *client = strstr(prompt, "CLIENT_SYSTEM_MARKER");
    const char *user_m = strstr(prompt, "<｜User｜>");
    TEST_ASSERT(tools && client && user_m);
    TEST_ASSERT(tools  < client);
    TEST_ASSERT(client < user_m);
    free(prompt);
    chat_msgs_free(&msgs);
}

static void test_dsml_tool_args_preserve_call_order(void) {
    tool_calls calls = make_swapped_bash_call();
    buf b = {0};
    append_dsml_tool_calls_text(&b, &calls);
    const char *command = strstr(b.ptr, "name=\"command\"");
    const char *description = strstr(b.ptr, "name=\"description\"");
    const char *timeout = strstr(b.ptr, "name=\"timeout\"");
    TEST_ASSERT(command != NULL);
    TEST_ASSERT(description != NULL);
    TEST_ASSERT(timeout != NULL);
    TEST_ASSERT(description < command);
    TEST_ASSERT(command < timeout);
    buf_free(&b);
    tool_calls_free(&calls);
}

static void test_openai_tool_args_preserve_call_order(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    r.tool_orders = make_bash_order();
    tool_calls calls = make_swapped_bash_call();
    buf b = {0};
    append_tool_calls_json(&b, &calls, "test", &r.tool_orders);
    const char *command = strstr(b.ptr, "\\\"command\\\"");
    const char *description = strstr(b.ptr, "\\\"description\\\"");
    const char *timeout = strstr(b.ptr, "\\\"timeout\\\"");
    TEST_ASSERT(command != NULL);
    TEST_ASSERT(description != NULL);
    TEST_ASSERT(timeout != NULL);
    TEST_ASSERT(description < command);
    TEST_ASSERT(command < timeout);
    buf_free(&b);
    tool_calls_free(&calls);
    request_free(&r);
}

static void test_anthropic_thinking_and_tool_args_preserve_call_order(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    r.tool_orders = make_bash_order();
    tool_calls calls = make_swapped_bash_call();
    buf b = {0};
    append_anthropic_content(&b, "done", "thinking text", &calls, "msg_1", &r.tool_orders);
    const char *thinking = strstr(b.ptr, "\"type\":\"thinking\"");
    const char *text = strstr(b.ptr, "\"type\":\"text\"");
    const char *tool = strstr(b.ptr, "\"type\":\"tool_use\"");
    const char *command = strstr(b.ptr, "\"command\"");
    const char *description = strstr(b.ptr, "\"description\"");
    TEST_ASSERT(thinking != NULL);
    TEST_ASSERT(text != NULL);
    TEST_ASSERT(tool != NULL);
    TEST_ASSERT(thinking < text);
    TEST_ASSERT(text < tool);
    TEST_ASSERT(command != NULL);
    TEST_ASSERT(description != NULL);
    TEST_ASSERT(description < command);
    buf_free(&b);
    tool_calls_free(&calls);
    request_free(&r);
}

static void test_parse_short_dsml_and_canonical_suffix(void) {
    const char *generated =
        "<think>need a tool</think>"
        "<DSML｜tool_calls>\n"
        "<DSML｜invoke name=\"bash\">\n"
        "<DSML｜parameter name=\"description\" string=\"true\">list files</DSML｜parameter>\n"
        "<DSML｜parameter name=\"command\" string=\"true\">ls -la</DSML｜parameter>\n"
        "</DSML｜invoke>\n"
        "</DSML｜tool_calls>";
    char *content = NULL;
    char *reasoning = NULL;
    tool_calls calls = {0};
    TEST_ASSERT(parse_generated_message_ex(generated, false, &content, &reasoning, &calls));
    TEST_ASSERT(reasoning && !strcmp(reasoning, "need a tool"));
    TEST_ASSERT(content && content[0] == '\0');
    TEST_ASSERT(calls.len == 1);

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.think_mode = DS4_THINK_HIGH;
    r.tool_orders = make_bash_order();
    char *suffix = build_tool_checkpoint_suffix(&r, content, reasoning, &calls);
    const char *command = strstr(suffix, "name=\"command\"");
    const char *description = strstr(suffix, "name=\"description\"");
    TEST_ASSERT(command != NULL);
    TEST_ASSERT(description != NULL);
    TEST_ASSERT(description < command);
    TEST_ASSERT(strstr(suffix, "</think>") != NULL);
    TEST_ASSERT(strstr(suffix, "<｜end▁of▁sentence｜>") != NULL);

    free(suffix);
    free(content);
    free(reasoning);
    tool_calls_free(&calls);
    request_free(&r);
}

static void test_dsml_parser_recovers_loose_nested_parameters(void) {
    const char *generated =
        "review done\n\n"
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"edit\">\n"
        DS4_PARAM_START " name=\"path\">/private/tmp/tetris.c" DS4_PARAM_END "\n"
        DS4_PARAM_START " name=\"edits\">\n"
        DS4_PARAM_START " name=\"oldText\" string=\"true\">old &lt;text&gt;" DS4_PARAM_END "\n"
        DS4_PARAM_START " name=\"newText\" string=\"true\">new text" DS4_PARAM_END "\n"
        DS4_INVOKE_END "\n"
        DS4_TOOL_CALLS_END;

    char *content = NULL;
    char *reasoning = NULL;
    tool_calls calls = {0};
    TEST_ASSERT(parse_generated_message_ex(generated, false, &content, &reasoning, &calls));
    TEST_ASSERT(content && !strcmp(content, "review done"));
    TEST_ASSERT(calls.len == 1);
    TEST_ASSERT(calls.v[0].name && !strcmp(calls.v[0].name, "edit"));
    TEST_ASSERT(strstr(calls.v[0].arguments, "\"path\": \"/private/tmp/tetris.c\"") != NULL);
    TEST_ASSERT(strstr(calls.v[0].arguments, "\"edits\": {") != NULL);
    TEST_ASSERT(strstr(calls.v[0].arguments, "\"oldText\":\"old <text>\"") != NULL);
    TEST_ASSERT(strstr(calls.v[0].arguments, "\"newText\":\"new text\"") != NULL);

    free(content);
    free(reasoning);
    tool_calls_free(&calls);
}

/* Verify that try_repair_dsml + parse_generated_message produces structurally
   valid tool calls for all three DSML styles and multiple truncation scenarios.
   Balanced but malformed DSML is not repaired: the model must retry it.
   This tests repair ACCURACY, not just that it doesn't crash. */
static void test_dsml_repair_produces_parseable_calls(void) {
    char *content = NULL;
    char *reasoning = NULL;
    tool_calls calls = {0};
    buf repaired = {0};

    /* === TEST 1: Full DSML - missing </tool_calls> === */
    {
        const char *broken =
            "thinking done\n\n"
            DS4_TOOL_CALLS_START "\n"
            DS4_INVOKE_START " name=\"bash\">\n"
            DS4_PARAM_START " name=\"command\" string=\"true\">ls -la" DS4_PARAM_END "\n"
            DS4_INVOKE_END "\n";
        /* Missing: DS4_TOOL_CALLS_END */

        buf_free(&repaired);
        TEST_ASSERT(try_repair_dsml(broken, strlen(broken), &repaired));
        TEST_ASSERT(parse_generated_message_ex(repaired.ptr, false, &content, &reasoning, &calls));
        TEST_ASSERT(calls.len == 1);
        TEST_ASSERT(calls.v[0].name && !strcmp(calls.v[0].name, "bash"));
        TEST_ASSERT(strstr(calls.v[0].arguments, "\"command\": \"ls -la\"") != NULL);
        free(content); free(reasoning); tool_calls_free(&calls);
    }

    /* === TEST 2: Full DSML - missing </invoke> and </tool_calls> === */
    {
        const char *broken =
            "\n\n"
            DS4_TOOL_CALLS_START "\n"
            DS4_INVOKE_START " name=\"edit\">\n"
            DS4_PARAM_START " name=\"path\" string=\"true\">/tmp/test.c" DS4_PARAM_END "\n";
        /* Missing: DS4_INVOKE_END, DS4_TOOL_CALLS_END */

        buf_free(&repaired);
        TEST_ASSERT(try_repair_dsml(broken, strlen(broken), &repaired));
        TEST_ASSERT(parse_generated_message_ex(repaired.ptr, false, &content, &reasoning, &calls));
        TEST_ASSERT(calls.len == 1);
        TEST_ASSERT(calls.v[0].name && !strcmp(calls.v[0].name, "edit"));
        TEST_ASSERT(strstr(calls.v[0].arguments, "\"path\": \"/tmp/test.c\"") != NULL);
        free(content); free(reasoning); tool_calls_free(&calls);
    }

    /* === TEST 3: Full DSML - missing </parameter> === */
    {
        const char *broken =
            "\n\n"
            DS4_TOOL_CALLS_START "\n"
            DS4_INVOKE_START " name=\"bash\">\n"
            DS4_PARAM_START " name=\"command\" string=\"true\">echo hello";
        /* Missing: DS4_PARAM_END, DS4_INVOKE_END, DS4_TOOL_CALLS_END */

        buf_free(&repaired);
        TEST_ASSERT(try_repair_dsml(broken, strlen(broken), &repaired));
        TEST_ASSERT(parse_generated_message_ex(repaired.ptr, false, &content, &reasoning, &calls));
        TEST_ASSERT(calls.len == 1);
        TEST_ASSERT(calls.v[0].name && !strcmp(calls.v[0].name, "bash"));
        TEST_ASSERT(strstr(calls.v[0].arguments, "\"command\": \"echo hello\"") != NULL);
        free(content); free(reasoning); tool_calls_free(&calls);
    }

    /* === TEST 4: Short DSML - missing closing tags === */
    {
        const char *broken =
            "\n\n"
            DS4_TOOL_CALLS_START_SHORT "\n"
            DS4_INVOKE_START_SHORT " name=\"write_file\">\n"
            DS4_PARAM_START_SHORT " name=\"path\" string=\"true\">/tmp/out.txt" DS4_PARAM_END_SHORT "\n"
            DS4_PARAM_START_SHORT " name=\"content\" string=\"true\">hello world" DS4_PARAM_END_SHORT "\n"
            DS4_INVOKE_END_SHORT "\n";
        /* Missing: DS4_TOOL_CALLS_END_SHORT */

        buf_free(&repaired);
        TEST_ASSERT(try_repair_dsml(broken, strlen(broken), &repaired));
        TEST_ASSERT(parse_generated_message_ex(repaired.ptr, false, &content, &reasoning, &calls));
        TEST_ASSERT(calls.len == 1);
        TEST_ASSERT(calls.v[0].name && !strcmp(calls.v[0].name, "write_file"));
        TEST_ASSERT(strstr(calls.v[0].arguments, "\"path\": \"/tmp/out.txt\"") != NULL);
        TEST_ASSERT(strstr(calls.v[0].arguments, "\"content\": \"hello world\"") != NULL);
        free(content); free(reasoning); tool_calls_free(&calls);
    }

    /* === TEST 5: Plain XML - missing closing tags === */
    {
        const char *broken =
            "\n\n"
            "<tool_calls>\n"
            "<invoke name=\"execute_command\">\n"
            "<parameter name=\"command\" string=\"true\">pwd</parameter>\n"
            "</invoke>\n";
        /* Missing: </tool_calls> */

        buf_free(&repaired);
        TEST_ASSERT(try_repair_dsml(broken, strlen(broken), &repaired));
        TEST_ASSERT(parse_generated_message_ex(repaired.ptr, false, &content, &reasoning, &calls));
        TEST_ASSERT(calls.len == 1);
        TEST_ASSERT(calls.v[0].name && !strcmp(calls.v[0].name, "execute_command"));
        TEST_ASSERT(strstr(calls.v[0].arguments, "\"command\": \"pwd\"") != NULL);
        free(content); free(reasoning); tool_calls_free(&calls);
    }

    /* === TEST 6: Balanced text should NOT be modified === */
    {
        const char *balanced =
            "\n\n"
            DS4_TOOL_CALLS_START "\n"
            DS4_INVOKE_START " name=\"bash\">\n"
            DS4_PARAM_START " name=\"command\" string=\"true\">ls" DS4_PARAM_END "\n"
            DS4_INVOKE_END "\n"
            DS4_TOOL_CALLS_END;

        buf_free(&repaired);
        TEST_ASSERT(!try_repair_dsml(balanced, strlen(balanced), &repaired));
        /* No repair needed */
    }

    /* === TEST 7: No DSML tags should return false === */
    {
        const char *no_dsml = "just plain text, no tools";
        buf_free(&repaired);
        TEST_ASSERT(!try_repair_dsml(no_dsml, strlen(no_dsml), &repaired));
    }

    /* === TEST 8: Balanced DSML with no invoke is not repaired === */
    {
        const char *balanced_no_invoke =
            "Let me analyze this.\n\n"
            DS4_TOOL_CALLS_START
            "The write tool truncates this too, at what looks like the same content location."
            DS4_TOOL_CALLS_END;
        buf_free(&repaired);
        TEST_ASSERT(!try_repair_dsml(balanced_no_invoke, strlen(balanced_no_invoke), &repaired));
    }

    /* === TEST 9: Balanced short DSML with no invoke is not repaired === */
    {
        const char *balanced_short_no_invoke =
            "thinking...\n\n"
            DS4_TOOL_CALLS_START_SHORT
            "some content here"
            DS4_TOOL_CALLS_END_SHORT;
        buf_free(&repaired);
        TEST_ASSERT(!try_repair_dsml(balanced_short_no_invoke, strlen(balanced_short_no_invoke), &repaired));
    }

    /* === TEST 10: Balanced plain XML DSML with no invoke is not repaired === */
    {
        const char *balanced_xml_no_invoke =
            "Let me think.\n\n"
            "<tool_calls>"
            "I need to use a tool but I don't know which one."
            "</tool_calls>";
        buf_free(&repaired);
        TEST_ASSERT(!try_repair_dsml(balanced_xml_no_invoke, strlen(balanced_xml_no_invoke), &repaired));
    }

    /* === TEST 11: DSML mentioned inside thinking is not repaired === */
    {
        const char *thinking_quote =
            "<think>The protocol uses "
            DS4_TOOL_CALLS_START
            "some explanatory text"
            DS4_TOOL_CALLS_END
            ", but this is only a quote.</think>\nFinal answer.";
        buf_free(&repaired);
        TEST_ASSERT(!try_repair_dsml(thinking_quote, strlen(thinking_quote), &repaired));
    }

    /* === TEST 12: Extra closing tags are unrecoverable, not truncation === */
    {
        const char *orphan_close =
            "done\n\n"
            DS4_TOOL_CALLS_START
            DS4_TOOL_CALLS_END
            DS4_TOOL_CALLS_END;
        buf_free(&repaired);
        TEST_ASSERT(!try_repair_dsml(orphan_close, strlen(orphan_close), &repaired));
    }

    /* === TEST 13: Real DSML after thinking still repairs normally === */
    {
        const char *broken_after_think =
            "<think>"
            DS4_TOOL_CALLS_START
            "quoted DSML, not executable"
            DS4_TOOL_CALLS_END
            "</think>\n\n"
            DS4_TOOL_CALLS_START "\n"
            DS4_INVOKE_START " name=\"bash\">\n"
            DS4_PARAM_START " name=\"command\" string=\"true\">date" DS4_PARAM_END "\n"
            DS4_INVOKE_END "\n";
        buf_free(&repaired);
        TEST_ASSERT(try_repair_dsml(broken_after_think, strlen(broken_after_think), &repaired));
        TEST_ASSERT(parse_generated_message_ex(repaired.ptr, true, &content, &reasoning, &calls));
        TEST_ASSERT(calls.len == 1);
        TEST_ASSERT(calls.v[0].name && !strcmp(calls.v[0].name, "bash"));
        TEST_ASSERT(strstr(calls.v[0].arguments, "\"command\": \"date\"") != NULL);
        free(content); free(reasoning); tool_calls_free(&calls);
    }

    buf_free(&repaired);
}

static void test_tool_parse_failure_returns_recoverable_finish(void) {
    const char *generated =
        "trying a tool\n\n"
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START ">\n"
        DS4_TOOL_CALLS_END;

    char err[128] = {0};
    char *content = NULL;
    char *reasoning = NULL;
    tool_calls calls = {0};
    const char *finish = "tool_calls";
    bool recovered = false;

    TEST_ASSERT(!parse_generated_message_for_response(generated,
                                                       true,
                                                       true,
                                                       false,
                                                       &finish,
                                                       err,
                                                       sizeof(err),
                                                       &content,
                                                       &reasoning,
                                                       &calls,
                                                       &recovered));
    TEST_ASSERT(recovered);
    TEST_ASSERT(!strcmp(finish, "stop"));
    TEST_ASSERT(!strcmp(err, "invalid tool call"));
    TEST_ASSERT(content && strstr(content, DS4_TOOL_CALLS_START) != NULL);
    TEST_ASSERT(reasoning == NULL);
    TEST_ASSERT(calls.len == 0);

    free(content);
    free(reasoning);
    tool_calls_free(&calls);
}

static void test_invalid_dsml_tool_error_suffix_includes_system_prompt(void) {
    request r = {0};
    r.think_mode = DS4_THINK_HIGH;
    r.prompt_text = xstrdup(
        "<｜begin▁of▁sentence｜>"
        "## Tools\nschema\n\nSystem rule\n\n"
        "<｜User｜>Hi<｜Assistant｜><think>");
    thinking_state st = {.inside = true};

    char *suffix = build_invalid_dsml_tool_error_suffix(&r, &st, "missing invoke name");
    TEST_ASSERT(suffix != NULL);
    TEST_ASSERT(strstr(suffix, "</think><｜end▁of▁sentence｜><｜User｜><tool_result>") == suffix);
    TEST_ASSERT(strstr(suffix, "Tool error: invalid DSML tool call: missing invoke name") != NULL);
    TEST_ASSERT(strstr(suffix, "The previous assistant output was not executed") != NULL);
    TEST_ASSERT(strstr(suffix, "System prompt reminder:\n## Tools\nschema\n\nSystem rule") != NULL);
    TEST_ASSERT(strstr(suffix, "<｜User｜>Hi") == NULL);
    TEST_ASSERT(strstr(suffix, "</tool_result><｜Assistant｜><think>") != NULL);

    free(suffix);
    free(r.prompt_text);
}

static void test_thinking_dsml_is_not_executable_before_think_close(void) {
    const char *generated =
        "<think>I might mention a malformed or tentative tool call here:\n\n"
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"bash\">\n"
        DS4_PARAM_START " name=\"command\" string=\"true\">true" DS4_PARAM_END "\n"
        DS4_INVOKE_END "\n"
        DS4_TOOL_CALLS_END
        "\nBut it is still reasoning, not an assistant action.</think>Final answer.";

    char *content = NULL;
    char *reasoning = NULL;
    tool_calls calls = {0};
    TEST_ASSERT(parse_generated_message_ex(generated, true,
                                           &content, &reasoning, &calls));
    TEST_ASSERT(calls.len == 0);
    TEST_ASSERT(reasoning && strstr(reasoning, DS4_TOOL_CALLS_START) != NULL);
    TEST_ASSERT(content && !strcmp(content, "Final answer."));

    free(content);
    free(reasoning);
    tool_calls_free(&calls);
}

static void test_thinking_dsml_after_think_close_is_executable(void) {
    const char *generated =
        "<think>need a shell check</think>\n\n"
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"bash\">\n"
        DS4_PARAM_START " name=\"command\" string=\"true\">pwd" DS4_PARAM_END "\n"
        DS4_INVOKE_END "\n"
        DS4_TOOL_CALLS_END;

    char *content = NULL;
    char *reasoning = NULL;
    tool_calls calls = {0};
    TEST_ASSERT(parse_generated_message_ex(generated, true,
                                           &content, &reasoning, &calls));
    TEST_ASSERT(calls.len == 1);
    TEST_ASSERT(reasoning && !strcmp(reasoning, "need a shell check"));
    TEST_ASSERT(content && content[0] == '\0');
    TEST_ASSERT(calls.v[0].name && !strcmp(calls.v[0].name, "bash"));
    TEST_ASSERT(strstr(calls.v[0].arguments, "\"command\": \"pwd\"") != NULL);

    free(content);
    free(reasoning);
    tool_calls_free(&calls);
}

static void test_tool_checkpoint_suffix_is_future_prompt_canonical(void) {
    tool_schema_orders orders = make_bash_order();
    const char *tool_schemas =
        "{\"name\":\"bash\",\"parameters\":{\"type\":\"object\",\"properties\":{"
        "\"command\":{},\"description\":{},\"timeout\":{}}}}";

    chat_msgs prefix_msgs = {0};
    chat_msg user = {0};
    user.role = xstrdup("user");
    user.content = xstrdup("inspect");
    chat_msgs_push(&prefix_msgs, user);
    char *prompt_text = render_chat_prompt_text(&prefix_msgs, tool_schemas,
                                                &orders, DS4_THINK_HIGH);

    const char *generated =
        "need a tool</think>\n\n"
        DS4_TOOL_CALLS_START "\n"
        "<｜DSML｜invoke name=\"bash\">\n"
        "<｜DSML｜parameter name=\"command\" string=\"true\">cd /tmp && git diff 2>/dev/null</｜DSML｜parameter>\n"
        "<｜DSML｜parameter name=\"timeout\" string=\"false\">10</｜DSML｜parameter>\n"
        "</｜DSML｜invoke>\n"
        "</｜DSML｜tool_calls>";
    char *content = NULL;
    char *reasoning = NULL;
    tool_calls calls = {0};
    TEST_ASSERT(parse_generated_message_ex(generated, false, &content, &reasoning, &calls));
    TEST_ASSERT(calls.len == 1);
    TEST_ASSERT(strstr(calls.v[0].arguments, "cd /tmp && git diff 2>/dev/null") != NULL);
    TEST_ASSERT(strstr(calls.v[0].arguments, "&amp;&amp;") == NULL);

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.think_mode = DS4_THINK_HIGH;
    r.tool_orders = orders;
    memset(&orders, 0, sizeof(orders));
    char *suffix = build_tool_checkpoint_suffix(&r, content, reasoning, &calls);
    TEST_ASSERT(strstr(suffix, "cd /tmp && git diff 2>/dev/null") != NULL);
    TEST_ASSERT(strstr(suffix, "&amp;&amp;") == NULL);
    TEST_ASSERT(strstr(suffix, "2&gt;/dev/null") == NULL);
    buf canonical = {0};
    buf_puts(&canonical, prompt_text);
    buf_puts(&canonical, suffix);

    chat_msgs history_msgs = {0};
    chat_msg user2 = {0};
    user2.role = xstrdup("user");
    user2.content = xstrdup("inspect");
    chat_msgs_push(&history_msgs, user2);
    chat_msg assistant = {0};
    assistant.role = xstrdup("assistant");
    assistant.reasoning = xstrdup(reasoning ? reasoning : "");
    assistant.content = xstrdup(content ? content : "");
    assistant.calls = calls;
    memset(&calls, 0, sizeof(calls));
    chat_msgs_push(&history_msgs, assistant);
    char *future_prompt = render_chat_prompt_text(&history_msgs, tool_schemas,
                                                  &r.tool_orders, DS4_THINK_HIGH);

    TEST_ASSERT(!strcmp(canonical.ptr, future_prompt));

    free(future_prompt);
    buf_free(&canonical);
    free(suffix);
    free(prompt_text);
    free(content);
    free(reasoning);
    chat_msgs_free(&history_msgs);
    chat_msgs_free(&prefix_msgs);
    tool_calls_free(&calls);
    request_free(&r);
    tool_schema_orders_free(&orders);
}

static void test_tool_checkpoint_minifies_json_parameters(void) {
    tool_schema_orders orders = {0};
    tool_schema_orders_add_json(&orders,
        "{\"name\":\"edit\",\"parameters\":{\"type\":\"object\",\"properties\":{"
        "\"path\":{},\"edits\":{}}}}");
    const char *tool_schemas =
        "{\"name\":\"edit\",\"parameters\":{\"type\":\"object\",\"properties\":{"
        "\"path\":{},\"edits\":{}}}}";

    chat_msgs prefix_msgs = {0};
    chat_msg user = {0};
    user.role = xstrdup("user");
    user.content = xstrdup("edit");
    chat_msgs_push(&prefix_msgs, user);
    char *prompt_text = render_chat_prompt_text(&prefix_msgs, tool_schemas,
                                                &orders, DS4_THINK_HIGH);

    const char *generated =
        "need edit</think>\n\n"
        DS4_TOOL_CALLS_START "\n"
        "<｜DSML｜invoke name=\"edit\">\n"
        "<｜DSML｜parameter name=\"path\" string=\"true\">/tmp/file</｜DSML｜parameter>\n"
        "<｜DSML｜parameter name=\"edits\" string=\"false\">"
        "[{\"oldText\": \"status=created\", \"newText\": \"status=created\\nstatus2=resumed\"}]"
        "</｜DSML｜parameter>\n"
        "</｜DSML｜invoke>\n"
        "</｜DSML｜tool_calls>";

    char *content = NULL;
    char *reasoning = NULL;
    tool_calls calls = {0};
    TEST_ASSERT(parse_generated_message_ex(generated, false, &content, &reasoning, &calls));
    TEST_ASSERT(calls.len == 1);

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.think_mode = DS4_THINK_HIGH;
    r.tool_orders = orders;
    memset(&orders, 0, sizeof(orders));
    char *suffix = build_tool_checkpoint_suffix(&r, content, reasoning, &calls);
    buf canonical = {0};
    buf_puts(&canonical, prompt_text);
    buf_puts(&canonical, suffix);

    chat_msgs history_msgs = {0};
    chat_msg user2 = {0};
    user2.role = xstrdup("user");
    user2.content = xstrdup("edit");
    chat_msgs_push(&history_msgs, user2);
    chat_msg assistant = {0};
    assistant.role = xstrdup("assistant");
    assistant.reasoning = xstrdup(reasoning ? reasoning : "");
    assistant.content = xstrdup(content ? content : "");
    assistant.calls = calls;
    memset(&calls, 0, sizeof(calls));
    chat_msgs_push(&history_msgs, assistant);
    char *future_prompt = render_chat_prompt_text(&history_msgs, tool_schemas,
                                                  &r.tool_orders, DS4_THINK_HIGH);

    TEST_ASSERT(!strcmp(canonical.ptr, future_prompt));

    free(future_prompt);
    buf_free(&canonical);
    free(suffix);
    free(prompt_text);
    free(content);
    free(reasoning);
    chat_msgs_free(&history_msgs);
    chat_msgs_free(&prefix_msgs);
    tool_calls_free(&calls);
    request_free(&r);
    tool_schema_orders_free(&orders);
}

static void test_tool_memory_replays_sampled_dsml(void) {
    const char *generated =
        "<think>need shell</think>\n\n"
        DS4_TOOL_CALLS_START "\n"
        "<｜DSML｜invoke name=\"bash\">\n"
        "<｜DSML｜parameter name=\"command\" string=\"true\">ls -la</｜DSML｜parameter>\n"
        "<｜DSML｜parameter name=\"timeout\" string=\"false\">10</｜DSML｜parameter>\n"
        "<｜DSML｜parameter name=\"description\" string=\"true\">list files</｜DSML｜parameter>\n"
        "</｜DSML｜invoke>\n"
        "</｜DSML｜tool_calls>";

    char *content = NULL;
    char *reasoning = NULL;
    tool_calls sampled = {0};
    TEST_ASSERT(parse_generated_message_ex(generated, false, &content, &reasoning, &sampled));
    TEST_ASSERT(sampled.len == 1);

    server s;
    memset(&s, 0, sizeof(s));
    pthread_mutex_init(&s.tool_mu, NULL);
    assign_tool_call_ids(&s, &sampled, API_OPENAI);
    TEST_ASSERT(sampled.v[0].id != NULL);
    TEST_ASSERT(!strncmp(sampled.v[0].id, "call_", 5));
    tool_memory_remember(&s, &sampled);

    chat_msgs msgs = {0};
    chat_msg assistant = {0};
    assistant.role = xstrdup("assistant");
    assistant.reasoning = xstrdup(reasoning ? reasoning : "");
    assistant.content = xstrdup(content ? content : "");
    tool_call tc = {0};
    tc.id = xstrdup(sampled.v[0].id);
    tc.name = xstrdup("bash");
    tc.arguments = xstrdup("{\"description\":\"list files\",\"command\":\"ls -la\",\"timeout\":10}");
    tool_calls_push(&assistant.calls, tc);
    chat_msgs_push(&msgs, assistant);

    tool_replay_stats stats = {0};
    tool_memory_attach_to_messages(&s, &msgs, &stats);
    TEST_ASSERT(msgs.v[0].calls.raw_dsml != NULL);
    TEST_ASSERT(stats.mem == 1);
    TEST_ASSERT(stats.disk == 0);
    TEST_ASSERT(stats.canonical == 0);
    TEST_ASSERT(stats.missing_ids == 0);
    char *prompt = render_chat_prompt_text(&msgs, NULL, NULL, DS4_THINK_HIGH);
    const char *command = strstr(prompt, "name=\"command\"");
    const char *timeout = strstr(prompt, "name=\"timeout\"");
    const char *description = strstr(prompt, "name=\"description\"");
    TEST_ASSERT(command != NULL);
    TEST_ASSERT(timeout != NULL);
    TEST_ASSERT(description != NULL);
    TEST_ASSERT(command < timeout);
    TEST_ASSERT(timeout < description);

    free(prompt);
    chat_msgs_free(&msgs);
    free(content);
    free(reasoning);
    tool_calls_free(&sampled);
    tool_memory_free(&s.tool_mem);
    pthread_mutex_destroy(&s.tool_mu);
}

static void test_anthropic_tool_memory_replays_sampled_dsml(void) {
    const char *sampled_dsml =
        "\n\n" DS4_TOOL_CALLS_START "\n"
        "<｜DSML｜invoke name=\"Bash\">\n"
        "<｜DSML｜parameter name=\"command\" string=\"true\">ls -la</｜DSML｜parameter>\n"
        "<｜DSML｜parameter name=\"description\" string=\"true\">list files</｜DSML｜parameter>\n"
        "</｜DSML｜invoke>\n"
        DS4_TOOL_CALLS_END;

    server s;
    memset(&s, 0, sizeof(s));
    pthread_mutex_init(&s.tool_mu, NULL);
    tool_memory_put(&s, "toolu_exact", sampled_dsml);

    const char *json =
        "["
        "{\"role\":\"assistant\",\"content\":["
        "{\"type\":\"tool_use\",\"id\":\"toolu_exact\",\"name\":\"Bash\","
        "\"input\":{\"description\":\"list files\",\"command\":\"ls -la\"}}"
        "]},"
        "{\"role\":\"user\",\"content\":["
        "{\"type\":\"tool_result\",\"tool_use_id\":\"toolu_exact\",\"content\":\"ok\"}"
        "]}"
        "]";
    const char *p = json;
    chat_msgs msgs = {0};
    TEST_ASSERT(parse_anthropic_messages(&p, &msgs));
    TEST_ASSERT(msgs.len == 2);
    TEST_ASSERT(msgs.v[1].tool_call_id && !strcmp(msgs.v[1].tool_call_id, "toolu_exact"));

    stop_list ids = {0};
    collect_tool_call_ids(&msgs, &ids);
    TEST_ASSERT(id_list_contains(&ids, "toolu_exact"));
    id_list_free(&ids);

    tool_replay_stats stats = {0};
    tool_memory_attach_to_messages(&s, &msgs, &stats);
    TEST_ASSERT(msgs.v[0].calls.raw_dsml != NULL);
    TEST_ASSERT(stats.mem == 1);
    TEST_ASSERT(stats.canonical == 0);

    char *prompt = render_chat_prompt_text(&msgs, NULL, NULL, DS4_THINK_HIGH);
    const char *command = strstr(prompt, "name=\"command\"");
    const char *description = strstr(prompt, "name=\"description\"");
    TEST_ASSERT(command != NULL);
    TEST_ASSERT(description != NULL);
    TEST_ASSERT(command < description);

    free(prompt);
    chat_msgs_free(&msgs);
    tool_memory_free(&s.tool_mem);
    pthread_mutex_destroy(&s.tool_mu);
}

static void test_anthropic_live_tail_renders_tool_results_only(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_ANTHROPIC;
    r.think_mode = DS4_THINK_HIGH;

    chat_msgs msgs = {0};
    chat_msg assistant = {0};
    assistant.role = xstrdup("assistant");
    tool_call tc = {0};
    tc.id = xstrdup("toolu_live");
    tc.name = xstrdup("Bash");
    tc.arguments = xstrdup("{\"command\":\"pwd\"}");
    tool_calls_push(&assistant.calls, tc);
    chat_msgs_push(&msgs, assistant);

    chat_msg user = {0};
    user.role = xstrdup("user");
    user.content = xstrdup("<tool_result>/tmp</tool_result>");
    chat_msg_add_tool_call_id(&user, "toolu_live");
    chat_msgs_push(&msgs, user);

    /* Anthropic system text is parsed separately and appended to chat_msgs for
     * rendering.  The live-tail finder must ignore it when locating the final
     * tool_result run. */
    chat_msg system = {0};
    system.role = xstrdup("system");
    system.content = xstrdup("You are terse.");
    chat_msgs_push(&msgs, system);

    anthropic_prepare_live_continuation(&r, &msgs);
    TEST_ASSERT(r.anthropic_live_call_ids.len == 1);
    TEST_ASSERT(!strcmp(r.anthropic_live_call_ids.v[0], "toolu_live"));
    TEST_ASSERT(r.anthropic_live_suffix_text != NULL);
    TEST_ASSERT(!strncmp(r.anthropic_live_suffix_text,
                         "<｜end▁of▁sentence｜><｜User｜><tool_result>",
                         strlen("<｜end▁of▁sentence｜><｜User｜><tool_result>")));
    TEST_ASSERT(strstr(r.anthropic_live_suffix_text, "/tmp</tool_result>") != NULL);
    TEST_ASSERT(strstr(r.anthropic_live_suffix_text, "<｜Assistant｜><think>") != NULL);
    TEST_ASSERT(strstr(r.anthropic_live_suffix_text, "Bash") == NULL);

    chat_msgs_free(&msgs);
    request_free(&r);
}

static void test_anthropic_tool_result_id_validation(void) {
    server s = {0};
    pthread_mutex_init(&s.tool_mu, NULL);

    chat_msgs msgs = {0};
    chat_msg user = {0};
    user.role = xstrdup("user");
    user.content = xstrdup("<tool_result>out</tool_result>");
    chat_msg_add_tool_call_id(&user, "toolu_missing");
    chat_msgs_push(&msgs, user);

    char err[160] = {0};
    TEST_ASSERT(!anthropic_validate_tool_results(&s, &msgs, NULL,
                                                 err, sizeof(err)));
    TEST_ASSERT(strstr(err, "Anthropic continuation state is not available") != NULL);

    pthread_mutex_lock(&s.tool_mu);
    s.anthropic_live.valid = true;
    s.anthropic_live.live_tokens = 10;
    id_list_push_unique(&s.anthropic_live.call_ids, "toolu_missing");
    pthread_mutex_unlock(&s.tool_mu);
    bool needs_live_tool_state = false;
    err[0] = '\0';
    TEST_ASSERT(anthropic_validate_tool_results(&s, &msgs,
                                                &needs_live_tool_state,
                                                err, sizeof(err)));
    TEST_ASSERT(needs_live_tool_state);

    chat_msgs_free(&msgs);
    live_tool_state_free(&s.anthropic_live);
    pthread_mutex_destroy(&s.tool_mu);
}

static void test_anthropic_full_replay_allows_unknown_live_id(void) {
    server s = {0};
    pthread_mutex_init(&s.tool_mu, NULL);

    chat_msgs msgs = {0};
    chat_msg assistant = {0};
    assistant.role = xstrdup("assistant");
    tool_call tc = {0};
    tc.id = xstrdup("toolu_replay");
    tc.name = xstrdup("Bash");
    tc.arguments = xstrdup("{\"command\":\"pwd\"}");
    tool_calls_push(&assistant.calls, tc);
    chat_msgs_push(&msgs, assistant);

    chat_msg user = {0};
    user.role = xstrdup("user");
    user.content = xstrdup("<tool_result>/tmp</tool_result>");
    chat_msg_add_tool_call_id(&user, "toolu_replay");
    chat_msgs_push(&msgs, user);

    bool needs_live_tool_state = false;
    char err[160] = {0};
    TEST_ASSERT(anthropic_validate_tool_results(&s, &msgs,
                                                &needs_live_tool_state,
                                                err, sizeof(err)));
    TEST_ASSERT(!needs_live_tool_state);

    chat_msgs_free(&msgs);
    pthread_mutex_destroy(&s.tool_mu);
}

static void test_anthropic_tool_use_parses_before_role(void) {
    server s = {0};
    pthread_mutex_init(&s.tool_mu, NULL);

    /* GitHub #127 regression: Crush can replay full Anthropic history with
     * message objects serialized as {"content": ..., "role": ...}.  The parser
     * must still remember prior assistant tool_use ids, otherwise old
     * tool_result blocks are mistaken for live-only continuations and rejected
     * once the live frontier has moved on to newer tool calls. */
    pthread_mutex_lock(&s.tool_mu);
    s.anthropic_live.valid = true;
    s.anthropic_live.live_tokens = 100;
    id_list_push_unique(&s.anthropic_live.call_ids, "toolu_current");
    pthread_mutex_unlock(&s.tool_mu);

    const char *json =
        "["
        "{\"content\":["
        "{\"type\":\"tool_use\",\"id\":\"toolu_old\",\"name\":\"Bash\","
        "\"input\":{\"command\":\"ls\"}}"
        "],\"role\":\"assistant\"},"
        "{\"role\":\"user\",\"content\":["
        "{\"type\":\"tool_result\",\"tool_use_id\":\"toolu_old\",\"content\":\"ok\"}"
        "]},"
        "{\"role\":\"user\",\"content\":\"continue\"}"
        "]";
    const char *p = json;
    chat_msgs msgs = {0};
    TEST_ASSERT(parse_anthropic_messages(&p, &msgs));
    TEST_ASSERT(msgs.len == 3);
    TEST_ASSERT(msgs.v[0].calls.len == 1);
    TEST_ASSERT(msgs.v[0].calls.v[0].id &&
                !strcmp(msgs.v[0].calls.v[0].id, "toolu_old"));

    bool needs_live_tool_state = false;
    char err[160] = {0};
    TEST_ASSERT(anthropic_validate_tool_results(&s, &msgs,
                                                &needs_live_tool_state,
                                                err, sizeof(err)));
    TEST_ASSERT(!needs_live_tool_state);

    chat_msgs_free(&msgs);
    live_tool_state_free(&s.anthropic_live);
    pthread_mutex_destroy(&s.tool_mu);
}

static void test_tool_checkpoint_canonicalization_gate_exact_replay(void) {
    server s;
    memset(&s, 0, sizeof(s));

    tool_calls calls = {0};
    tool_call tc = {0};
    tc.id = xstrdup("call_exact");
    tc.name = xstrdup("bash");
    tc.arguments = xstrdup("{}");
    tool_calls_push(&calls, tc);
    calls.raw_dsml = xstrdup(
        "\n\n" DS4_TOOL_CALLS_START "\n"
        "<｜DSML｜invoke name=\"bash\">\n"
        "</｜DSML｜invoke>\n"
        DS4_TOOL_CALLS_END);

    TEST_ASSERT(!should_canonicalize_tool_checkpoint(&s, &calls));

    s.disable_exact_dsml_tool_replay = true;
    TEST_ASSERT(should_canonicalize_tool_checkpoint(&s, &calls));

    s.disable_exact_dsml_tool_replay = false;
    free(calls.raw_dsml);
    calls.raw_dsml = NULL;
    TEST_ASSERT(should_canonicalize_tool_checkpoint(&s, &calls));

    tool_calls_free(&calls);
}

static void test_responses_live_tail_renders_tool_outputs_only(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_RESPONSES;
    r.think_mode = DS4_THINK_HIGH;

    chat_msgs msgs = {0};
    chat_msg assistant = {0};
    assistant.role = xstrdup("assistant");
    tool_call tc = {0};
    tc.id = xstrdup("call_live");
    tc.name = xstrdup("exec_command");
    tc.arguments = xstrdup("{\"cmd\":\"pwd\"}");
    tool_calls_push(&assistant.calls, tc);
    chat_msgs_push(&msgs, assistant);

    chat_msg tool = {0};
    tool.role = xstrdup("tool");
    tool.tool_call_id = xstrdup("call_live");
    tool.content = xstrdup("/tmp");
    chat_msgs_push(&msgs, tool);

    responses_prepare_live_continuation(&r, &msgs);
    TEST_ASSERT(r.responses_live_call_ids.len == 1);
    TEST_ASSERT(!strcmp(r.responses_live_call_ids.v[0], "call_live"));
    TEST_ASSERT(r.responses_live_suffix_text != NULL);
    TEST_ASSERT(!strncmp(r.responses_live_suffix_text,
                         "<｜end▁of▁sentence｜><｜User｜><tool_result>",
                         strlen("<｜end▁of▁sentence｜><｜User｜><tool_result>")));
    TEST_ASSERT(strstr(r.responses_live_suffix_text, "/tmp</tool_result>") != NULL);
    TEST_ASSERT(strstr(r.responses_live_suffix_text, "<｜Assistant｜><think>") != NULL);
    TEST_ASSERT(strstr(r.responses_live_suffix_text, "exec_command") == NULL);

    chat_msgs_free(&msgs);
    request_free(&r);
}

static void test_responses_tool_output_id_validation(void) {
    server s = {0};
    pthread_mutex_init(&s.tool_mu, NULL);

    chat_msgs msgs = {0};
    chat_msg tool = {0};
    tool.role = xstrdup("tool");
    tool.tool_call_id = xstrdup("call_missing");
    tool.content = xstrdup("out");
    chat_msgs_push(&msgs, tool);

    char err[160] = {0};
    TEST_ASSERT(!responses_validate_tool_outputs(&s, &msgs, DS4_THINK_HIGH, NULL, NULL,
                                                 err, sizeof(err)));
    TEST_ASSERT(strstr(err, "Responses continuation state is not available") != NULL);

    pthread_mutex_lock(&s.tool_mu);
    s.responses_live.valid = true;
    s.responses_live.live_tokens = 10;
    id_list_push_unique(&s.responses_live.call_ids, "call_missing");
    pthread_mutex_unlock(&s.tool_mu);
    err[0] = '\0';
    bool needs_live_tool_state = false;
    TEST_ASSERT(responses_validate_tool_outputs(&s, &msgs, DS4_THINK_HIGH,
                                                &needs_live_tool_state, NULL,
                                                err, sizeof(err)));
    TEST_ASSERT(needs_live_tool_state);

    chat_msgs_free(&msgs);
    live_tool_state_free(&s.responses_live);
    pthread_mutex_destroy(&s.tool_mu);
}

static void test_responses_stateless_tool_replay_requires_reasoning(void) {
    server s = {0};
    pthread_mutex_init(&s.tool_mu, NULL);

    chat_msgs msgs = {0};
    chat_msg assistant = {0};
    assistant.role = xstrdup("assistant");
    tool_call tc = {0};
    tc.id = xstrdup("call_replay");
    tc.name = xstrdup("exec_command");
    tc.arguments = xstrdup("{\"cmd\":\"pwd\"}");
    tool_calls_push(&assistant.calls, tc);
    chat_msgs_push(&msgs, assistant);

    chat_msg tool = {0};
    tool.role = xstrdup("tool");
    tool.tool_call_id = xstrdup("call_replay");
    tool.content = xstrdup("/tmp");
    chat_msgs_push(&msgs, tool);

    char err[160] = {0};
    bool needs_live_reasoning = false;
    bool needs_live_tool_state = false;
    TEST_ASSERT(responses_validate_tool_outputs(&s, &msgs, DS4_THINK_HIGH,
                                                &needs_live_tool_state,
                                                &needs_live_reasoning,
                                                err, sizeof(err)));
    TEST_ASSERT(!needs_live_tool_state);
    TEST_ASSERT(needs_live_reasoning);

    pthread_mutex_lock(&s.tool_mu);
    s.responses_live.valid = true;
    s.responses_live.live_tokens = 123;
    id_list_push_unique(&s.responses_live.call_ids, "call_replay");
    pthread_mutex_unlock(&s.tool_mu);
    err[0] = '\0';
    needs_live_reasoning = false;
    needs_live_tool_state = false;
    TEST_ASSERT(responses_validate_tool_outputs(&s, &msgs, DS4_THINK_HIGH,
                                                &needs_live_tool_state,
                                                &needs_live_reasoning,
                                                err, sizeof(err)));
    TEST_ASSERT(!needs_live_tool_state);
    TEST_ASSERT(needs_live_reasoning);

    free(msgs.v[0].reasoning);
    msgs.v[0].reasoning = xstrdup("replayed hidden reasoning");
    err[0] = '\0';
    needs_live_reasoning = false;
    needs_live_tool_state = false;
    TEST_ASSERT(responses_validate_tool_outputs(&s, &msgs, DS4_THINK_HIGH,
                                                &needs_live_tool_state,
                                                &needs_live_reasoning,
                                                err, sizeof(err)));
    TEST_ASSERT(!needs_live_tool_state);
    TEST_ASSERT(!needs_live_reasoning);

    free(msgs.v[0].reasoning);
    msgs.v[0].reasoning = NULL;
    err[0] = '\0';
    needs_live_reasoning = false;
    needs_live_tool_state = false;
    TEST_ASSERT(responses_validate_tool_outputs(&s, &msgs, DS4_THINK_NONE,
                                                &needs_live_tool_state,
                                                &needs_live_reasoning,
                                                err, sizeof(err)));
    TEST_ASSERT(!needs_live_tool_state);
    TEST_ASSERT(!needs_live_reasoning);

    chat_msgs_free(&msgs);
    live_tool_state_free(&s.responses_live);
    pthread_mutex_destroy(&s.tool_mu);
}

static void test_responses_visible_suffix_matches_client_replay(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    r.api = API_RESPONSES;
    r.think_mode = DS4_THINK_HIGH;
    r.reasoning_summary_emit = true;

    char *suffix = build_responses_visible_assistant_suffix(&r, "5",
                                                            "hidden summary",
                                                            NULL);
    TEST_ASSERT(strstr(suffix, "hidden summary") == NULL);
    TEST_ASSERT(strstr(suffix, "</think>5") != NULL);
    free(suffix);

    tool_calls calls = {0};
    tool_call tc = {0};
    tc.id = xstrdup("call_live");
    tc.name = xstrdup("bash");
    tc.arguments = xstrdup("{\"command\":\"pwd\"}");
    tool_calls_push(&calls, tc);

    suffix = build_responses_visible_assistant_suffix(&r, "",
                                                      "tool summary",
                                                      &calls);
    TEST_ASSERT(strstr(suffix, "tool summary</think>") != NULL);
    TEST_ASSERT(strstr(suffix, "<｜DSML｜tool_calls>") != NULL);
    free(suffix);

    tool_calls_free(&calls);
    request_free(&r);
}

static void test_exact_dsml_tool_replay_can_be_disabled(void) {
    const char *dsml =
        "\n\n<｜DSML｜tool_calls>\n"
        "<｜DSML｜invoke name=\"bash\">\n"
        "<｜DSML｜parameter name=\"command\" string=\"true\">pwd</｜DSML｜parameter>\n"
        "</｜DSML｜invoke>\n"
        "</｜DSML｜tool_calls>";

    server s = {0};
    pthread_mutex_init(&s.tool_mu, NULL);
    tool_memory_put(&s, "call_disabled", dsml);
    s.disable_exact_dsml_tool_replay = true;

    chat_msgs msgs = {0};
    chat_msg assistant = {0};
    assistant.role = xstrdup("assistant");
    tool_call tc = {0};
    tc.id = xstrdup("call_disabled");
    tc.name = xstrdup("bash");
    tc.arguments = xstrdup("{\"command\":\"canonical\"}");
    tool_calls_push(&assistant.calls, tc);
    chat_msgs_push(&msgs, assistant);

    tool_replay_stats stats = {0};
    tool_memory_attach_to_messages(&s, &msgs, &stats);
    TEST_ASSERT(msgs.v[0].calls.raw_dsml == NULL);
    TEST_ASSERT(stats.canonical == 1);
    TEST_ASSERT(stats.missing_ids == 1);

    FILE *fp = tmpfile();
    TEST_ASSERT(fp != NULL);
    uint64_t bytes = 123;
    TEST_ASSERT(kv_tool_map_write(&s, fp, dsml, &bytes));
    TEST_ASSERT(bytes == 0);

    if (fp) fclose(fp);
    chat_msgs_free(&msgs);
    tool_memory_free(&s.tool_mem);
    pthread_mutex_destroy(&s.tool_mu);
}

static void test_dsml_decode_state_separates_structure_and_payload(void) {
    dsml_decode_tracker tracker;
    dsml_decode_tracker_init(&tracker);

    const char *prefix =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"edit\">\n";
    TEST_ASSERT(dsml_decode_state_for_text(prefix, strlen(prefix)) ==
                DSML_DECODE_STRUCTURAL);
    dsml_decode_tracker_update(&tracker, prefix, strlen(prefix));
    TEST_ASSERT(tracker.decode == DSML_DECODE_STRUCTURAL);

    const char *path_param =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"edit\">\n"
        DS4_PARAM_START " name=\"path\" string=\"true\">/tmp/a.py";
    TEST_ASSERT(dsml_decode_state_for_text(path_param, strlen(path_param)) ==
                DSML_DECODE_STRING_BODY);
    dsml_decode_tracker_update(&tracker, path_param, strlen(path_param));
    TEST_ASSERT(tracker.decode == DSML_DECODE_STRING_BODY);

    const char *path_closing =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"edit\">\n"
        DS4_PARAM_START " name=\"path\" string=\"true\">/tmp/a.py</";
    TEST_ASSERT(dsml_decode_state_for_text(path_closing, strlen(path_closing)) ==
                DSML_DECODE_STRUCTURAL);
    dsml_decode_tracker_update(&tracker, path_closing, strlen(path_closing));
    TEST_ASSERT(tracker.decode == DSML_DECODE_STRUCTURAL);

    const char *json_struct =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"edit\">\n"
        DS4_PARAM_START " name=\"edits\" string=\"false\">[{";
    TEST_ASSERT(dsml_decode_state_for_text(json_struct, strlen(json_struct)) ==
                DSML_DECODE_JSON_STRUCTURAL);
    dsml_decode_tracker_init(&tracker);
    dsml_decode_tracker_update(&tracker, json_struct, strlen(json_struct));
    TEST_ASSERT(tracker.decode == DSML_DECODE_JSON_STRUCTURAL);

    const char *json_string =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"edit\">\n"
        DS4_PARAM_START " name=\"edits\" string=\"false\">[{\"newText\":\"for i in";
    TEST_ASSERT(dsml_decode_state_for_text(json_string, strlen(json_string)) ==
                DSML_DECODE_JSON_STRING);
    dsml_decode_tracker_update(&tracker, json_string, strlen(json_string));
    TEST_ASSERT(tracker.decode == DSML_DECODE_JSON_STRING);

    const char *done =
        DS4_TOOL_CALLS_START "\n"
        DS4_INVOKE_START " name=\"edit\">\n"
        DS4_PARAM_START " name=\"edits\" string=\"false\">[]"
        DS4_PARAM_END "\n"
        DS4_INVOKE_END "\n"
        DS4_TOOL_CALLS_END;
    TEST_ASSERT(dsml_decode_state_for_text(done, strlen(done)) ==
                DSML_DECODE_OUTSIDE);
    dsml_decode_tracker_init(&tracker);
    dsml_decode_tracker_update(&tracker, done, strlen(done));
    TEST_ASSERT(tracker.decode == DSML_DECODE_OUTSIDE);
}

static void test_tool_memory_max_ids_prunes_oldest(void) {
    const char *a_dsml = "\n\n<｜DSML｜tool_calls>\n<｜DSML｜invoke name=\"bash\">\n<｜DSML｜parameter name=\"command\" string=\"true\">a</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>";
    const char *b_dsml = "\n\n<｜DSML｜tool_calls>\n<｜DSML｜invoke name=\"bash\">\n<｜DSML｜parameter name=\"command\" string=\"true\">b</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>";
    const char *c_dsml = "\n\n<｜DSML｜tool_calls>\n<｜DSML｜invoke name=\"bash\">\n<｜DSML｜parameter name=\"command\" string=\"true\">c</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>";

    server s = {0};
    pthread_mutex_init(&s.tool_mu, NULL);
    s.tool_mem.max_entries = 2;
    tool_memory_put(&s, "call_a", a_dsml);
    tool_memory_put(&s, "call_b", b_dsml);
    tool_memory_put(&s, "call_c", c_dsml);

    chat_msgs msgs = {0};
    chat_msg a = {0};
    a.role = xstrdup("assistant");
    tool_call tc = {.id = xstrdup("call_a"), .name = xstrdup("bash"), .arguments = xstrdup("{}")};
    tool_calls_push(&a.calls, tc);
    chat_msgs_push(&msgs, a);

    tool_replay_stats stats = {0};
    tool_memory_attach_to_messages(&s, &msgs, &stats);
    TEST_ASSERT(msgs.v[0].calls.raw_dsml == NULL);
    TEST_ASSERT(stats.canonical == 1);
    TEST_ASSERT(stats.missing_ids == 1);

    chat_msgs_free(&msgs);
    tool_memory_free(&s.tool_mem);
    pthread_mutex_destroy(&s.tool_mu);
}

static void test_tool_separator_whitespace_is_not_content(void) {
    const char *generated =
        "<think>need a tool</think>"
        "I will inspect the files.\n\n\n\n"
        DS4_TOOL_CALLS_START "\n"
        "<｜DSML｜invoke name=\"bash\">\n"
        "<｜DSML｜parameter name=\"description\" string=\"true\">list files</｜DSML｜parameter>\n"
        "<｜DSML｜parameter name=\"command\" string=\"true\">ls -la</｜DSML｜parameter>\n"
        "</｜DSML｜invoke>\n"
        "</｜DSML｜tool_calls>";
    char *content = NULL;
    char *reasoning = NULL;
    tool_calls calls = {0};
    TEST_ASSERT(parse_generated_message_ex(generated, false, &content, &reasoning, &calls));
    TEST_ASSERT(reasoning && !strcmp(reasoning, "need a tool"));
    TEST_ASSERT(content && !strcmp(content, "I will inspect the files."));
    TEST_ASSERT(calls.len == 1);

    free(content);
    free(reasoning);
    tool_calls_free(&calls);
}

static void test_dsml_prompt_escapes_tool_supplied_text(void) {
    tool_calls calls = {0};
    tool_call tc = {0};
    tc.name = xstrdup("bash");
    tc.arguments = xstrdup("{\"command\":\"echo 2>&1 && echo </｜DSML｜tool_calls>\",\"count\":1}");
    tool_calls_push(&calls, tc);

    buf b = {0};
    append_dsml_tool_calls_text(&b, &calls);
    TEST_ASSERT(strstr(b.ptr, "echo 2>&1 && echo </｜DSML｜tool_calls>") != NULL);
    TEST_ASSERT(strstr(b.ptr, "2&gt;&amp;1") == NULL);
    TEST_ASSERT(strstr(b.ptr, "&amp;&amp;") == NULL);
    buf_free(&b);
    tool_calls_free(&calls);

    memset(&calls, 0, sizeof(calls));
    memset(&tc, 0, sizeof(tc));
    tc.name = xstrdup("bash");
    tc.arguments = xstrdup("{\"command\":\"echo </｜DSML｜parameter>\",\"count\":1}");
    tool_calls_push(&calls, tc);

    append_dsml_tool_calls_text(&b, &calls);
    TEST_ASSERT(strstr(b.ptr, "echo &lt;/｜DSML｜parameter>") != NULL);
    TEST_ASSERT(strstr(b.ptr, "echo </｜DSML｜parameter>") == NULL);
    buf_free(&b);
    tool_calls_free(&calls);

    chat_msgs msgs = {0};
    chat_msg tool = {0};
    tool.role = xstrdup("tool");
    tool.content = xstrdup("console.log('<<< < > >>>');\n</tool_result>\n<｜DSML｜tool_calls>not a real tool call");
    chat_msgs_push(&msgs, tool);
    char *prompt = render_chat_prompt_text(&msgs, "{}", NULL, DS4_THINK_HIGH);
    TEST_ASSERT(prompt != NULL);
    TEST_ASSERT(strstr(prompt, "console.log('<<< < > >>>');") != NULL);
    TEST_ASSERT(strstr(prompt, "console.log('&lt;") == NULL);
    TEST_ASSERT(strstr(prompt, "&lt;/tool_result>\n<｜DSML｜tool_calls>not a real tool call") != NULL);
    TEST_ASSERT(strstr(prompt, "<tool_result>console.log('<<< < > >>>');\n</tool_result>\n") == NULL);
    free(prompt);
    chat_msgs_free(&msgs);
}

static void test_stop_list_parses_all_sequences(void) {
    stop_list stops = {0};
    const char *json = "[\"END\",\"STOP\"]";
    TEST_ASSERT(parse_stop(&json, &stops));
    TEST_ASSERT(stops.len == 2);
    TEST_ASSERT(stops.max_len == 4);

    size_t pos = 0, len = 0;
    TEST_ASSERT(stop_list_find_from(&stops, "hello STOP tail END", 0, &pos, &len));
    TEST_ASSERT(pos == strlen("hello "));
    TEST_ASSERT(len == strlen("STOP"));
    TEST_ASSERT(stop_list_stream_safe_len(&stops, strlen("abcdef")) == 3);
    stop_list_clear(&stops);
    free(stops.v);
}

static void test_stop_list_streaming_holds_and_trims_stop_text(void) {
    stop_list stops = {0};
    const char *json = "[\"</END>\",\"STOP\"]";
    TEST_ASSERT(parse_stop(&json, &stops));

    size_t safe = stop_list_stream_safe_len(&stops, strlen("hello </"));
    TEST_ASSERT(safe == strlen("hel"));

    size_t pos = 0, len = 0;
    TEST_ASSERT(stop_list_find_from(&stops, "answer STOP hidden", 0, &pos, &len));
    TEST_ASSERT(pos == strlen("answer "));
    TEST_ASSERT(len == strlen("STOP"));

    stop_list_clear(&stops);
    free(stops.v);
}

static char *test_nested_json_array(int depth) {
    buf b = {0};
    for (int i = 0; i < depth; i++) buf_putc(&b, '[');
    buf_putc(&b, '0');
    for (int i = 0; i < depth; i++) buf_putc(&b, ']');
    return buf_take(&b);
}

static void test_json_skip_has_nesting_limit(void) {
    char *ok = test_nested_json_array(JSON_MAX_NESTING);
    const char *p = ok;
    TEST_ASSERT(json_skip_value(&p));
    TEST_ASSERT(*p == '\0');
    free(ok);

    char *bad = test_nested_json_array(JSON_MAX_NESTING + 1);
    p = bad;
    TEST_ASSERT(!json_skip_value(&p));
    free(bad);
}

static void test_model_metadata_clamps_completion_to_context(void) {
    buf b = {0};
    append_model_json_values(&b, "deepseek-v4-flash", "DeepSeek V4 Flash",
                             32768, 393216);
    TEST_ASSERT(strstr(b.ptr, "\"id\":\"deepseek-v4-flash\"") != NULL);
    TEST_ASSERT(strstr(b.ptr, "\"name\":\"DeepSeek V4 Flash\"") != NULL);
    TEST_ASSERT(strstr(b.ptr, "\"context_length\":32768") != NULL);
    TEST_ASSERT(strstr(b.ptr, "\"max_completion_tokens\":32768") != NULL);
    buf_free(&b);

    append_model_json_values(&b, "deepseek-v4-pro", "DeepSeek V4 Pro",
                             100000, 4096);
    TEST_ASSERT(strstr(b.ptr, "\"id\":\"deepseek-v4-pro\"") != NULL);
    TEST_ASSERT(strstr(b.ptr, "\"name\":\"DeepSeek V4 Pro\"") != NULL);
    TEST_ASSERT(strstr(b.ptr, "\"context_length\":100000") != NULL);
    TEST_ASSERT(strstr(b.ptr, "\"max_completion_tokens\":4096") != NULL);
    buf_free(&b);
}

static void test_client_socket_nonblocking_flag(void) {
    int sv[2];
    TEST_ASSERT(socketpair(AF_UNIX, SOCK_STREAM, 0, sv) == 0);
    if (sv[0] < 0 || sv[1] < 0) return;
    set_client_socket_nonblocking(sv[0]);
    int flags = fcntl(sv[0], F_GETFL, 0);
    TEST_ASSERT(flags >= 0);
    TEST_ASSERT((flags & O_NONBLOCK) != 0);
    close(sv[0]);
    close(sv[1]);
}

static void test_thinking_state_tracks_prompt_and_generated_tags(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    r.think_mode = DS4_THINK_HIGH;
    r.prompt_text = xstrdup("<｜Assistant｜><think>");
    thinking_state st = thinking_state_from_prompt(&r);
    TEST_ASSERT(st.inside == true);
    thinking_state_feed(&st, "reasoning body", strlen("reasoning body"));
    TEST_ASSERT(st.inside == true);
    thinking_state_feed(&st, "</thi", strlen("</thi"));
    TEST_ASSERT(st.inside == true);
    thinking_state_feed(&st, "nk>answer", strlen("nk>answer"));
    TEST_ASSERT(st.inside == false);
    thinking_state_feed(&st, "<thi", strlen("<thi"));
    TEST_ASSERT(st.inside == false);
    thinking_state_feed(&st, "nk>more", strlen("nk>more"));
    TEST_ASSERT(st.inside == true);
    request_free(&r);

    request_init(&r, REQ_CHAT, 128);
    r.think_mode = DS4_THINK_NONE;
    r.prompt_text = xstrdup("<｜Assistant｜></think>");
    st = thinking_state_from_prompt(&r);
    TEST_ASSERT(st.inside == false);
    request_free(&r);
}

static void test_thinking_checkpoint_remember_gate(void) {
    request r;
    request_init(&r, REQ_CHAT, 128);
    r.think_mode = DS4_THINK_HIGH;
    thinking_state st = {.inside = true};

    TEST_ASSERT(!should_remember_thinking_checkpoint(&r, &st, "length"));
    TEST_ASSERT(!should_remember_thinking_checkpoint(&r, &st, "stop"));

    st.inside = false;
    TEST_ASSERT(!should_remember_thinking_checkpoint(&r, &st, "length"));
    TEST_ASSERT(should_remember_thinking_checkpoint(&r, &st, "stop"));

    r.prompt_preserves_reasoning = true;
    TEST_ASSERT(!should_remember_thinking_checkpoint(&r, &st, "stop"));
    r.prompt_preserves_reasoning = false;
    r.has_tools = true;
    TEST_ASSERT(!should_remember_thinking_checkpoint(&r, &st, "stop"));
    r.has_tools = false;
    r.think_mode = DS4_THINK_NONE;
    TEST_ASSERT(!should_remember_thinking_checkpoint(&r, &st, "stop"));

    request_free(&r);
}

static void test_tool_marker_state_ignores_orphan_end(void) {
    bool saw_start = false;
    bool saw_end = false;
    bool orphan_end = false;

    observe_tool_markers("reasoning\n" DS4_PARAM_END "\n" DS4_INVOKE_END "\n" DS4_TOOL_CALLS_END,
                         &saw_start, &saw_end, &orphan_end);
    TEST_ASSERT(!saw_start);
    TEST_ASSERT(!saw_end);
    TEST_ASSERT(orphan_end);

    orphan_end = false;
    observe_tool_markers(DS4_TOOL_CALLS_START "\n" DS4_INVOKE_START " name=\"bash\">",
                         &saw_start, &saw_end, &orphan_end);
    TEST_ASSERT(saw_start);
    TEST_ASSERT(!saw_end);
    TEST_ASSERT(!orphan_end);

    observe_tool_markers(DS4_INVOKE_END "\n" DS4_TOOL_CALLS_END,
                         &saw_start, &saw_end, &orphan_end);
    TEST_ASSERT(saw_start);
    TEST_ASSERT(saw_end);
}

static void test_canonical_rewrite_rebuilds_when_live_tail_changes(void) {
    /* Regression for the first canonical-KV rewrite attempt: replacing a small
     * live suffix looks tempting because the raw SWA ring may still contain the
     * needed rows, but compressed KV counters and compressor/indexer frontiers
     * are already past the shared prefix.  Until those graph frontiers can be
     * restored exactly, every rewrite behind the live end must rebuild or load a
     * disk checkpoint. */
    TEST_ASSERT(ds4_session_rewrite_requires_rebuild(19296, 19290, 19081));
    TEST_ASSERT(ds4_session_rewrite_requires_rebuild(1024, 1030, 1000));
    TEST_ASSERT(ds4_session_rewrite_requires_rebuild(1024, 900, 900));

    TEST_ASSERT(!ds4_session_rewrite_requires_rebuild(1024, 1024, 1024));
    TEST_ASSERT(!ds4_session_rewrite_requires_rebuild(1024, 1100, 1024));
}

static void test_kv_cache_store_len_uses_configured_boundary(void) {
    kv_disk_cache kc = {0};
    kc.opt = kv_cache_default_options();
    TEST_ASSERT(kv_cache_store_len(&kc, 11011) == 10240);
    TEST_ASSERT(kv_cache_store_len(&kc, 1695) == 1695);

    kc.opt.boundary_trim_tokens = 0;
    kc.opt.boundary_align_tokens = 1000;
    TEST_ASSERT(kv_cache_store_len(&kc, 3500) == 3000);

    kc.opt.boundary_align_tokens = 0;
    TEST_ASSERT(kv_cache_store_len(&kc, 3500) == 3500);
}

static void test_kv_cache_chat_anchor_uses_last_user_before_assistant(void) {
    const int user = 9001;
    const int assistant = 9002;
    kv_disk_cache kc = {0};
    kc.opt = kv_cache_default_options();
    kc.opt.min_tokens = 4;

    ds4_tokens codex = {0};
    ds4_tokens_push(&codex, 1);     /* BOS / system */
    ds4_tokens_push(&codex, 2);
    ds4_tokens_push(&codex, user);  /* environment_context item */
    ds4_tokens_push(&codex, 3);
    ds4_tokens_push(&codex, 4);
    ds4_tokens_push(&codex, user);  /* actual task starts here */
    ds4_tokens_push(&codex, 5);
    ds4_tokens_push(&codex, assistant);
    TEST_ASSERT(kv_cache_chat_anchor_pos(&kc, &codex, user, assistant) == 5);

    ds4_tokens claude = {0};
    ds4_tokens_push(&claude, 1);
    ds4_tokens_push(&claude, 2);
    ds4_tokens_push(&claude, 3);
    ds4_tokens_push(&claude, 4);
    ds4_tokens_push(&claude, user); /* system reminder and task share a turn */
    ds4_tokens_push(&claude, 5);
    ds4_tokens_push(&claude, assistant);
    TEST_ASSERT(kv_cache_chat_anchor_pos(&kc, &claude, user, assistant) == 4);

    ds4_tokens_free(&codex);
    ds4_tokens_free(&claude);
}

static void test_kv_cache_chat_anchor_ignores_multiturn_tail(void) {
    const int user = 9001;
    const int assistant = 9002;
    kv_disk_cache kc = {0};
    kc.opt = kv_cache_default_options();
    kc.opt.min_tokens = 2;

    ds4_tokens prompt = {0};
    ds4_tokens_push(&prompt, 1);
    ds4_tokens_push(&prompt, 2);
    ds4_tokens_push(&prompt, user);      /* first task */
    ds4_tokens_push(&prompt, 3);
    ds4_tokens_push(&prompt, assistant); /* stop scanning here */
    ds4_tokens_push(&prompt, 4);
    ds4_tokens_push(&prompt, user);      /* later turn: not a cold anchor */
    ds4_tokens_push(&prompt, 5);
    ds4_tokens_push(&prompt, assistant);
    TEST_ASSERT(kv_cache_chat_anchor_pos(&kc, &prompt, user, assistant) == 2);

    kc.opt.min_tokens = 3;
    TEST_ASSERT(kv_cache_chat_anchor_pos(&kc, &prompt, user, assistant) == -1);
    TEST_ASSERT(kv_cache_chat_anchor_pos(&kc, &prompt, -1, assistant) == -1);
    TEST_ASSERT(kv_cache_chat_anchor_pos(&kc, &prompt, user, -1) == -1);

    ds4_tokens_free(&prompt);
}

static void test_kv_cache_continued_uses_aligned_frontiers(void) {
    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.opt = kv_cache_default_options();

    TEST_ASSERT(kv_cache_continued_store_target(&kc, 10239) == 0);
    TEST_ASSERT(kv_cache_continued_store_target(&kc, 10240) == 10240);

    kc.continued_last_store_tokens = 4096;
    TEST_ASSERT(kv_cache_continued_store_target(&kc, 10240) == 10240);

    kc.continued_last_store_tokens = 24576;
    TEST_ASSERT(kv_cache_continued_store_target(&kc, 30720) == 30720);

    kc.continued_last_store_tokens = 10240;
    TEST_ASSERT(kv_cache_continued_store_target(&kc, 18432) == 0);
    TEST_ASSERT(kv_cache_continued_store_target(&kc, 20480) == 20480);

    kc.opt.boundary_align_tokens = 0;
    kc.continued_last_store_tokens = 20480;
    TEST_ASSERT(kv_cache_continued_store_target(&kc, 29999) == 0);
    TEST_ASSERT(kv_cache_continued_store_target(&kc, 30000) == 30000);
}

static void test_kv_cache_cold_store_suppresses_duplicate_continued_boundary(void) {
    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.opt = kv_cache_default_options();

    int old = kv_cache_suppress_continued_store(&kc, 10240);
    TEST_ASSERT(old == 0);
    TEST_ASSERT(kc.continued_last_store_tokens == 10240);
    TEST_ASSERT(kv_cache_continued_store_target(&kc, 10240) == 0);

    kv_cache_restore_suppressed_continued(&kc, old, 10240);
    TEST_ASSERT(kc.continued_last_store_tokens == 0);
    TEST_ASSERT(kv_cache_continued_store_target(&kc, 10240) == 10240);
}

static void test_kv_cache_file_size_must_fit_budget(void) {
    kv_disk_cache kc = {0};
    kc.budget_bytes = 1100;

    TEST_ASSERT(kv_cache_file_size_fits(&kc, 100, 930, 0, NULL, NULL));
    TEST_ASSERT(!kv_cache_file_size_fits(&kc, 100, 938, 0, NULL, NULL));
    TEST_ASSERT(!kv_cache_file_size_fits(&kc, 100, 900, 40, NULL, NULL));
    TEST_ASSERT(!kv_cache_file_size_fits(&kc, UINT64_MAX, 1, 0, NULL, NULL));

    kc.budget_bytes = 0;
    TEST_ASSERT(kv_cache_file_size_fits(&kc, 100, 900, 40, NULL, NULL));
    TEST_ASSERT(!kv_cache_file_size_fits(&kc, UINT64_MAX, 1, 0, NULL, NULL));
}

static void test_sha1_bytes_hex_matches_known_vector(void) {
    char sha[41];
    sha1_bytes_hex("abc", 3, sha);
    TEST_ASSERT(!strcmp(sha, "a9993e364706816aba3e25717850c26c9cd0d89d"));
}

static void test_kv_stub_file(const char *dir, const char *sha,
                              uint8_t reason, uint32_t tokens, uint32_t hits,
                              uint64_t last_used, uint64_t payload_bytes) {
    char name[44];
    snprintf(name, sizeof(name), "%.40s.kv", sha);
    char *path = path_join(dir, name);
    FILE *fp = fopen(path, "wb");
    TEST_ASSERT(fp != NULL);
    if (!fp) {
        free(path);
        return;
    }

    uint8_t h[KV_CACHE_FIXED_HEADER];
    kv_fill_header(h, 2, reason, 0, tokens, hits, 32768, 100, last_used, payload_bytes);
    uint8_t text_len[4] = {0};
    TEST_ASSERT(fwrite(h, 1, sizeof(h), fp) == sizeof(h));
    TEST_ASSERT(fwrite(text_len, 1, sizeof(text_len), fp) == sizeof(text_len));
    for (uint64_t i = 0; i < payload_bytes; i++) {
        TEST_ASSERT(fputc(0, fp) != EOF);
    }
    TEST_ASSERT(fclose(fp) == 0);
    free(path);
}

static void test_kv_text_stub_file_model(const char *dir, const char *text,
                                         uint8_t model_id, uint8_t reason,
                                         uint32_t tokens,
                                         uint64_t payload_bytes) {
    char sha[41];
    sha1_bytes_hex(text, strlen(text), sha);
    char name[44];
    snprintf(name, sizeof(name), "%.40s.kv", sha);
    char *path = path_join(dir, name);
    FILE *fp = fopen(path, "wb");
    TEST_ASSERT(fp != NULL);
    if (!fp) {
        free(path);
        return;
    }

    uint8_t h[KV_CACHE_FIXED_HEADER];
    ds4_kvstore_fill_header(h, model_id, 2, reason, 0, tokens, 0,
                            32768, 100, 100, payload_bytes);
    uint8_t text_len[4];
    le_put32(text_len, (uint32_t)strlen(text));
    TEST_ASSERT(fwrite(h, 1, sizeof(h), fp) == sizeof(h));
    TEST_ASSERT(fwrite(text_len, 1, sizeof(text_len), fp) == sizeof(text_len));
    TEST_ASSERT(fwrite(text, 1, strlen(text), fp) == strlen(text));
    for (uint64_t i = 0; i < payload_bytes; i++) {
        TEST_ASSERT(fputc(0, fp) != EOF);
    }
    TEST_ASSERT(fclose(fp) == 0);
    free(path);
}

static void test_kv_text_stub_file(const char *dir, const char *text,
                                   uint8_t reason,
                                   uint32_t tokens, uint64_t payload_bytes) {
    test_kv_text_stub_file_model(dir, text, 0, reason, tokens, payload_bytes);
}

static void test_kv_cache_lookup_uses_longest_text_prefix(void) {
    char tmpl[] = "/tmp/ds4-kv-text-prefix-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *short_text = "transcript prefix";
    const char *long_text = "transcript prefix with sampled token bytes";
    test_kv_text_stub_file(dir, short_text, KV_REASON_COLD, 512, 0);
    test_kv_text_stub_file(dir, long_text, KV_REASON_COLD, 768, 0);

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();

    int idx = kv_cache_find_text_prefix(&kc,
        "transcript prefix with sampled token bytes and suffix",
        2, 32768);
    TEST_ASSERT(idx >= 0);
    TEST_ASSERT(idx >= 0 && kc.entry[idx].tokens == 768);
    TEST_ASSERT(idx >= 0 && kc.entry[idx].text_bytes == strlen(long_text));
    TEST_ASSERT(kv_cache_find_text_prefix(&kc, "transcript prefiX", 2, 32768) < 0);

    kv_cache_close(&kc);
    char short_sha[41], long_sha[41];
    sha1_bytes_hex(short_text, strlen(short_text), short_sha);
    sha1_bytes_hex(long_text, strlen(long_text), long_sha);
    char short_name[44], long_name[44];
    snprintf(short_name, sizeof(short_name), "%.40s.kv", short_sha);
    snprintf(long_name, sizeof(long_name), "%.40s.kv", long_sha);
    char *short_path = path_join(dir, short_name);
    char *long_path = path_join(dir, long_name);
    unlink(short_path);
    unlink(long_path);
    free(short_path);
    free(long_path);
    rmdir(dir);
}

static void test_kv_cache_lookup_rejects_wrong_model(void) {
    char tmpl[] = "/tmp/ds4-kv-model-id-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *text = "shared rendered prefix";
    test_kv_text_stub_file_model(dir, text, 1, KV_REASON_COLD, 512, 0);

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();

    TEST_ASSERT(ds4_kvstore_find_text_prefix(&kc, "shared rendered prefix and tail",
                                             0, 2, 32768) < 0);
    int idx = ds4_kvstore_find_text_prefix(&kc, "shared rendered prefix and tail",
                                           1, 2, 32768);
    TEST_ASSERT(idx >= 0);
    TEST_ASSERT(idx >= 0 && kc.entry[idx].model_id == 1);

    kv_cache_close(&kc);
    char sha[41];
    sha1_bytes_hex(text, strlen(text), sha);
    char name[44];
    snprintf(name, sizeof(name), "%.40s.kv", sha);
    char *path = path_join(dir, name);
    unlink(path);
    free(path);
    rmdir(dir);
}

static void test_kv_cache_lookup_rejects_stale_payload_abi(void) {
    char tmpl[] = "/tmp/ds4-kv-stale-abi-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *text = "stale rendered prefix";
    char sha[41];
    sha1_bytes_hex(text, strlen(text), sha);
    char name[44];
    snprintf(name, sizeof(name), "%.40s.kv", sha);
    char *path = path_join(dir, name);

    FILE *fp = fopen(path, "wb");
    TEST_ASSERT(fp != NULL);
    if (fp) {
        uint8_t h[KV_CACHE_FIXED_HEADER];
        kv_fill_header(h, 2, KV_REASON_COLD, 0, 512, 0, 32768, 100, 100, 0);
        h[20] = 0; /* pre-ABI-guard files used this byte as reserved zero. */
        uint8_t text_len[4];
        le_put32(text_len, (uint32_t)strlen(text));
        TEST_ASSERT(fwrite(h, 1, sizeof(h), fp) == sizeof(h));
        TEST_ASSERT(fwrite(text_len, 1, sizeof(text_len), fp) == sizeof(text_len));
        TEST_ASSERT(fwrite(text, 1, strlen(text), fp) == strlen(text));
        TEST_ASSERT(fclose(fp) == 0);
    }

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();

    TEST_ASSERT(ds4_kvstore_find_text_prefix(&kc, "stale rendered prefix and tail",
                                             0, 2, 32768) < 0);

    kv_cache_close(&kc);
    unlink(path);
    free(path);
    rmdir(dir);
}

static void test_kv_tool_map_filters_by_dsml_text(void) {
    const char *dsml_keep =
        "\n\n<｜DSML｜tool_calls>\n"
        "<｜DSML｜invoke name=\"bash\">\n"
        "<｜DSML｜parameter name=\"command\" string=\"true\">pwd</｜DSML｜parameter>\n"
        "</｜DSML｜invoke>\n"
        "</｜DSML｜tool_calls>";
    const char *dsml_drop =
        "\n\n<｜DSML｜tool_calls>\n"
        "<｜DSML｜invoke name=\"bash\">\n"
        "<｜DSML｜parameter name=\"command\" string=\"true\">zzzz</｜DSML｜parameter>\n"
        "</｜DSML｜invoke>\n"
        "</｜DSML｜tool_calls>";

    server src = {0}, dst = {0};
    pthread_mutex_init(&src.tool_mu, NULL);
    pthread_mutex_init(&dst.tool_mu, NULL);
    tool_memory_put(&src, "call_keep", dsml_keep);
    tool_memory_put(&src, "call_drop", dsml_drop);

    FILE *fp = tmpfile();
    TEST_ASSERT(fp != NULL);
    uint64_t estimated_bytes = 0;
    TEST_ASSERT(kv_tool_map_serialized_size(&src, dsml_keep, &estimated_bytes));
    uint64_t bytes = 0;
    TEST_ASSERT(kv_tool_map_write(&src, fp, dsml_keep, &bytes));
    TEST_ASSERT(bytes > 0);
    TEST_ASSERT(estimated_bytes == bytes);
    rewind(fp);
    TEST_ASSERT(kv_tool_map_load_from_pos(&dst, fp, NULL) == 1);

    chat_msgs msgs = {0};
    chat_msg a = {0};
    a.role = xstrdup("assistant");
    tool_call keep = {.id = xstrdup("call_keep"), .name = xstrdup("bash"), .arguments = xstrdup("{}")};
    tool_calls_push(&a.calls, keep);
    chat_msgs_push(&msgs, a);
    chat_msg b = {0};
    b.role = xstrdup("assistant");
    tool_call drop = {.id = xstrdup("call_drop"), .name = xstrdup("bash"), .arguments = xstrdup("{}")};
    tool_calls_push(&b.calls, drop);
    chat_msgs_push(&msgs, b);
    tool_replay_stats stats = {0};
    tool_memory_attach_to_messages(&dst, &msgs, &stats);
    TEST_ASSERT(msgs.v[0].calls.raw_dsml != NULL);
    TEST_ASSERT(msgs.v[1].calls.raw_dsml == NULL);
    TEST_ASSERT(stats.disk == 1);
    TEST_ASSERT(stats.canonical == 1);
    TEST_ASSERT(stats.missing_ids == 1);
    TEST_ASSERT(strstr(msgs.v[0].calls.raw_dsml, "pwd") != NULL);
    TEST_ASSERT(strstr(msgs.v[0].calls.raw_dsml, "zzzz") == NULL);

    chat_msgs_free(&msgs);
    if (fp) fclose(fp);
    tool_memory_free(&src.tool_mem);
    tool_memory_free(&dst.tool_mem);
    pthread_mutex_destroy(&src.tool_mu);
    pthread_mutex_destroy(&dst.tool_mu);
}

static void test_kv_tool_map_restores_before_prompt_render(void) {
    char tmpl[] = "/tmp/ds4-kv-tool-map-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *sha = "3333333333333333333333333333333333333333";
    char name[44];
    snprintf(name, sizeof(name), "%.40s.kv", sha);
    char *path = path_join(dir, name);
    const char *dsml =
        "\n\n<｜DSML｜tool_calls>\n"
        "<｜DSML｜invoke name=\"bash\">\n"
        "<｜DSML｜parameter name=\"command\" string=\"true\">echo exact</｜DSML｜parameter>\n"
        "</｜DSML｜invoke>\n"
        "</｜DSML｜tool_calls>";
    const char *text = dsml;

    server src = {0};
    pthread_mutex_init(&src.tool_mu, NULL);
    tool_memory_put(&src, "call_disk", dsml);

    FILE *fp = fopen(path, "wb");
    TEST_ASSERT(fp != NULL);
    if (fp) {
        uint8_t h[KV_CACHE_FIXED_HEADER];
        kv_fill_header(h, 2, KV_REASON_CONTINUED, KV_EXT_TOOL_MAP, 512, 0, 32768, 100, 100, 0);
        uint8_t text_len[4];
        le_put32(text_len, (uint32_t)strlen(text));
        TEST_ASSERT(fwrite(h, 1, sizeof(h), fp) == sizeof(h));
        TEST_ASSERT(fwrite(text_len, 1, sizeof(text_len), fp) == sizeof(text_len));
        TEST_ASSERT(fwrite(text, 1, strlen(text), fp) == strlen(text));
        uint64_t ignored = 0;
        TEST_ASSERT(kv_tool_map_write(&src, fp, dsml, &ignored));
        TEST_ASSERT(fclose(fp) == 0);
    }

    server dst = {0};
    pthread_mutex_init(&dst.tool_mu, NULL);
    dst.kv.enabled = true;
    dst.kv.dir = xstrdup(dir);
    dst.kv.opt = kv_cache_default_options();

    chat_msgs msgs = {0};
    chat_msg a = {0};
    a.role = xstrdup("assistant");
    tool_call tc = {0};
    tc.id = xstrdup("call_disk");
    tc.name = xstrdup("bash");
    tc.arguments = xstrdup("{\"command\":\"echo canonical\"}");
    tool_calls_push(&a.calls, tc);
    chat_msgs_push(&msgs, a);

    kv_cache_restore_tool_memory_for_messages(&dst, &msgs);
    tool_replay_stats stats = {0};
    tool_memory_attach_to_messages(&dst, &msgs, &stats);
    TEST_ASSERT(msgs.v[0].calls.raw_dsml != NULL);
    TEST_ASSERT(stats.disk == 1);
    TEST_ASSERT(stats.canonical == 0);
    char *prompt = render_chat_prompt_text(&msgs, NULL, NULL, DS4_THINK_HIGH);
    TEST_ASSERT(strstr(prompt, "echo exact") != NULL);
    TEST_ASSERT(strstr(prompt, "echo canonical") == NULL);

    free(prompt);
    chat_msgs_free(&msgs);
    kv_cache_close(&dst.kv);
    tool_memory_free(&src.tool_mem);
    tool_memory_free(&dst.tool_mem);
    pthread_mutex_destroy(&src.tool_mu);
    pthread_mutex_destroy(&dst.tool_mu);
    unlink(path);
    free(path);
    rmdir(dir);
}

static void test_kv_cache_eviction_values_fresh_snapshots(void) {
    char tmpl[] = "/tmp/ds4-kv-evict-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *old_sha = "1111111111111111111111111111111111111111";
    const char *new_sha = "2222222222222222222222222222222222222222";
    uint64_t now = (uint64_t)time(NULL);
    test_kv_stub_file(dir, old_sha, KV_REASON_UNKNOWN, 512, 0, now, 4096);
    test_kv_stub_file(dir, new_sha, KV_REASON_UNKNOWN, 2048, 0, now, 2048);

    char old_name[44], new_name[44];
    snprintf(old_name, sizeof(old_name), "%.40s.kv", old_sha);
    snprintf(new_name, sizeof(new_name), "%.40s.kv", new_sha);
    char *old_path = path_join(dir, old_name);
    char *new_path = path_join(dir, new_name);

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();
    kc.budget_bytes = (KV_CACHE_FIXED_HEADER + 4u + 2048u) + 16u;
    kv_cache_evict(&kc, NULL, 0, NULL);

    TEST_ASSERT(access(old_path, F_OK) != 0);
    TEST_ASSERT(access(new_path, F_OK) == 0);

    kv_cache_close(&kc);
    unlink(old_path);
    unlink(new_path);
    free(old_path);
    free(new_path);
    rmdir(dir);
}

static void test_kv_cache_eviction_prefers_anchor_reason(void) {
    char tmpl[] = "/tmp/ds4-kv-anchor-reason-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *anchor_sha = "1111111111111111111111111111111111111111";
    const char *continued_sha = "2222222222222222222222222222222222222222";
    uint64_t now = (uint64_t)time(NULL);
    test_kv_stub_file(dir, anchor_sha, KV_REASON_COLD, 2048, 0, now, 2048);
    test_kv_stub_file(dir, continued_sha, KV_REASON_CONTINUED, 2048, 0, now, 2048);

    char anchor_name[44], continued_name[44];
    snprintf(anchor_name, sizeof(anchor_name), "%.40s.kv", anchor_sha);
    snprintf(continued_name, sizeof(continued_name), "%.40s.kv", continued_sha);
    char *anchor_path = path_join(dir, anchor_name);
    char *continued_path = path_join(dir, continued_name);

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();
    kc.budget_bytes = (KV_CACHE_FIXED_HEADER + 4u + 2048u) + 16u;
    kv_cache_evict(&kc, NULL, 0, NULL);

    TEST_ASSERT(access(anchor_path, F_OK) == 0);
    TEST_ASSERT(access(continued_path, F_OK) != 0);

    kv_cache_close(&kc);
    unlink(anchor_path);
    unlink(continued_path);
    free(anchor_path);
    free(continued_path);
    rmdir(dir);
}

static void test_kv_cache_eviction_makes_room_before_store(void) {
    char tmpl[] = "/tmp/ds4-kv-pre-store-evict-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *old_sha = "1111111111111111111111111111111111111111";
    uint64_t now = (uint64_t)time(NULL);
    test_kv_stub_file(dir, old_sha, KV_REASON_COLD, 4096, 0, now, 2048);

    char old_name[44];
    snprintf(old_name, sizeof(old_name), "%.40s.kv", old_sha);
    char *old_path = path_join(dir, old_name);

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();
    kc.budget_bytes = (KV_CACHE_FIXED_HEADER + 4u + 4096u) + 16u;
    kv_cache_evict(&kc, NULL, KV_CACHE_FIXED_HEADER + 4u + 4096u, NULL);

    TEST_ASSERT(access(old_path, F_OK) != 0);

    kv_cache_close(&kc);
    unlink(old_path);
    free(old_path);
    rmdir(dir);
}

static void test_kv_cache_eviction_ignores_oversize_incoming(void) {
    char tmpl[] = "/tmp/ds4-kv-oversize-store-evict-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *old_sha = "1111111111111111111111111111111111111111";
    uint64_t now = (uint64_t)time(NULL);
    test_kv_stub_file(dir, old_sha, KV_REASON_COLD, 4096, 0, now, 1024);

    char old_name[44];
    snprintf(old_name, sizeof(old_name), "%.40s.kv", old_sha);
    char *old_path = path_join(dir, old_name);

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();
    kc.budget_bytes = (KV_CACHE_FIXED_HEADER + 4u + 1024u) + 16u;
    kv_cache_evict(&kc, NULL, kc.budget_bytes + 1, NULL);

    TEST_ASSERT(access(old_path, F_OK) == 0);

    kv_cache_close(&kc);
    unlink(old_path);
    free(old_path);
    rmdir(dir);
}

static void test_kv_cache_eviction_prefers_superseded_continued_prefix(void) {
    char tmpl[] = "/tmp/ds4-kv-prefix-evict-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *continued_text = "system: hello world";
    const char *cold_text = "different stable prefix";
    const char *incoming_text = "system: hello world\nuser: prompt";
    test_kv_text_stub_file(dir, continued_text, KV_REASON_CONTINUED, 4096, 2048);
    test_kv_text_stub_file(dir, cold_text, KV_REASON_COLD, 1024, 2048);

    char continued_sha[41], cold_sha[41];
    sha1_bytes_hex(continued_text, strlen(continued_text), continued_sha);
    sha1_bytes_hex(cold_text, strlen(cold_text), cold_sha);
    char continued_name[44], cold_name[44];
    snprintf(continued_name, sizeof(continued_name), "%.40s.kv", continued_sha);
    snprintf(cold_name, sizeof(cold_name), "%.40s.kv", cold_sha);
    char *continued_path = path_join(dir, continued_name);
    char *cold_path = path_join(dir, cold_name);

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();
    uint64_t incoming_bytes =
        KV_CACHE_FIXED_HEADER + 4u + strlen(incoming_text) + 2048u;
    kc.budget_bytes =
        incoming_bytes + KV_CACHE_FIXED_HEADER + 4u + strlen(cold_text) + 2048u;
    ds4_kvstore_eviction_context incoming = {
        .text = incoming_text,
        .text_len = strlen(incoming_text),
        .model_id = 0,
        .quant_bits = 2,
        .ctx_size = 32768,
        .reject_different_quant = false,
    };
    kv_cache_evict(&kc, NULL, incoming_bytes, &incoming);

    TEST_ASSERT(access(continued_path, F_OK) != 0);
    TEST_ASSERT(access(cold_path, F_OK) == 0);

    kv_cache_close(&kc);
    unlink(continued_path);
    unlink(cold_path);
    free(continued_path);
    free(cold_path);
    rmdir(dir);
}

static void test_kv_cache_eviction_keeps_smaller_context_prefix(void) {
    char tmpl[] = "/tmp/ds4-kv-prefix-ctx-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *continued_text = "system: hello world";
    const char *cold_text = "different stable prefix";
    const char *incoming_text = "system: hello world\nuser: prompt";
    test_kv_text_stub_file(dir, continued_text, KV_REASON_CONTINUED, 4096, 2048);
    test_kv_text_stub_file(dir, cold_text, KV_REASON_COLD, 1024, 2048);

    char continued_sha[41], cold_sha[41];
    sha1_bytes_hex(continued_text, strlen(continued_text), continued_sha);
    sha1_bytes_hex(cold_text, strlen(cold_text), cold_sha);
    char continued_name[44], cold_name[44];
    snprintf(continued_name, sizeof(continued_name), "%.40s.kv", continued_sha);
    snprintf(cold_name, sizeof(cold_name), "%.40s.kv", cold_sha);
    char *continued_path = path_join(dir, continued_name);
    char *cold_path = path_join(dir, cold_name);

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();
    uint64_t incoming_bytes =
        KV_CACHE_FIXED_HEADER + 4u + strlen(incoming_text) + 2048u;
    kc.budget_bytes =
        incoming_bytes + KV_CACHE_FIXED_HEADER + 4u + strlen(continued_text) + 2048u;
    ds4_kvstore_eviction_context incoming = {
        .text = incoming_text,
        .text_len = strlen(incoming_text),
        .model_id = 0,
        .quant_bits = 2,
        .ctx_size = 65536,
        .reject_different_quant = false,
    };
    kv_cache_evict(&kc, NULL, incoming_bytes, &incoming);

    TEST_ASSERT(access(continued_path, F_OK) == 0);
    TEST_ASSERT(access(cold_path, F_OK) != 0);

    kv_cache_close(&kc);
    unlink(continued_path);
    unlink(cold_path);
    free(continued_path);
    free(cold_path);
    rmdir(dir);
}

static void test_kv_cache_eviction_score_decays_stale_hits(void) {
    /* stale: lower tokens-per-byte (e.g. tool-heavy prompt) but boosted by
     * 10 hits well in the past.  fresh: higher tokens-per-byte and zero hits,
     * just stored.  The stale hit bonus decays by inactivity, so fresh wins on
     * its better baseline even though stale once had more successful hits. */
    const uint64_t now = 1000u + 14u * KV_CACHE_HIT_HALF_LIFE_SECONDS;
    kv_entry stale = {.tokens = 1024, .hits = 10, .file_size = 4096, .last_used = 1000};
    kv_entry fresh = {.tokens = 2048, .hits = 0,  .file_size = 4096, .last_used = now};

    double s_on = kv_entry_eviction_score(&stale, NULL, now, NULL);
    double f_on = kv_entry_eviction_score(&fresh, NULL, now, NULL);
    TEST_ASSERT(s_on < f_on);

    /* A fresh entry's score never decays below its (0+1) * tokens/size floor,
     * regardless of how old another entry's hit history is. */
    TEST_ASSERT(f_on == 1.0 * (double)fresh.tokens / (double)fresh.file_size);
}

static void test_kv_cache_eviction_decayed_hits_tie_break_by_age(void) {
    char tmpl[] = "/tmp/ds4-kv-stale-hit-evict-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *old_sha = "1111111111111111111111111111111111111111";
    const char *new_sha = "2222222222222222222222222222222222222222";
    uint64_t now = (uint64_t)time(NULL);
    uint64_t stale = now > KV_CACHE_HIT_HALF_LIFE_SECONDS * 14ull
        ? now - KV_CACHE_HIT_HALF_LIFE_SECONDS * 14ull
        : 1;
    test_kv_stub_file(dir, old_sha, KV_REASON_COLD, 2048, 15, stale, 2048);
    test_kv_stub_file(dir, new_sha, KV_REASON_COLD, 2048, 0, now, 2048);

    char old_name[44], new_name[44];
    snprintf(old_name, sizeof(old_name), "%.40s.kv", old_sha);
    snprintf(new_name, sizeof(new_name), "%.40s.kv", new_sha);
    char *old_path = path_join(dir, old_name);
    char *new_path = path_join(dir, new_name);

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();
    kc.budget_bytes = (KV_CACHE_FIXED_HEADER + 4u + 2048u) + 16u;
    kv_cache_evict(&kc, NULL, 0, NULL);

    TEST_ASSERT(access(old_path, F_OK) != 0);
    TEST_ASSERT(access(new_path, F_OK) == 0);

    kv_cache_close(&kc);
    unlink(old_path);
    unlink(new_path);
    free(old_path);
    free(new_path);
    rmdir(dir);
}

static void test_kv_cache_eviction_keeps_aligned_continued_frontiers(void) {
    char tmpl[] = "/tmp/ds4-kv-live-prefix-test.XXXXXX";
    char *dir = mkdtemp(tmpl);
    TEST_ASSERT(dir != NULL);
    if (!dir) return;

    const char *cold_sha = "1111111111111111111111111111111111111111";
    const char *continued_sha = "2222222222222222222222222222222222222222";
    uint64_t now = (uint64_t)time(NULL);
    test_kv_stub_file(dir, cold_sha, KV_REASON_COLD, 512, 0, now, 2048);
    test_kv_stub_file(dir, continued_sha, KV_REASON_CONTINUED, 2048, 0, now, 2048);

    char cold_name[44], continued_name[44];
    snprintf(cold_name, sizeof(cold_name), "%.40s.kv", cold_sha);
    snprintf(continued_name, sizeof(continued_name), "%.40s.kv", continued_sha);
    char *cold_path = path_join(dir, cold_name);
    char *continued_path = path_join(dir, continued_name);

    kv_disk_cache kc = {0};
    kc.enabled = true;
    kc.dir = xstrdup(dir);
    kc.opt = kv_cache_default_options();
    kc.budget_bytes = (KV_CACHE_FIXED_HEADER + 4u + 2048u) + 16u;
    kv_cache_evict(&kc, NULL, 0, NULL);

    TEST_ASSERT(access(cold_path, F_OK) != 0);
    TEST_ASSERT(access(continued_path, F_OK) == 0);

    kv_cache_close(&kc);
    unlink(cold_path);
    unlink(continued_path);
    free(cold_path);
    free(continued_path);
    rmdir(dir);
}

static void test_thinking_checkpoint_canonical_matches_future_prompt(void) {
    /* Simulate: user sends a single message, thinking mode on, no tools.
     * Model generates reasoning + content.  The next request will drop the
     * reasoning from this turn.  Verify that:
     *   prompt_text[:-len("<think>")] + "</think>" + content + "<|eos|>"
     * equals what render_chat_prompt_text produces for the history. */

    chat_msgs prefix_msgs = {0};
    chat_msg user1 = {0};
    user1.role = xstrdup("user");
    user1.content = xstrdup("What is 2+2?");
    chat_msgs_push(&prefix_msgs, user1);

    /* This is what prompt_text looks like for the first generation */
    char *prompt_text = render_chat_prompt_text(&prefix_msgs, NULL, NULL, DS4_THINK_HIGH);
    /* prompt_text should end with <think> */
    size_t pt_len = strlen(prompt_text);
    TEST_ASSERT(pt_len >= 7);
    TEST_ASSERT(!memcmp(prompt_text + pt_len - 7, "<think>", 7));

    /* The model generates: reasoning + </think> + content */
    const char *reasoning = "Let me think... 2+2 = 4";
    const char *content = "The answer is 4.";

    /* Build the canonical checkpoint text (what we'd produce after canonicalization) */
    buf canonical = {0};
    buf_append(&canonical, prompt_text, pt_len - 7);  /* strip <think> */
    buf_puts(&canonical, "</think>");
    buf_puts(&canonical, content);
    buf_puts(&canonical, "<" "\xef\xbd\x9c" "end" "\xe2\x96\x81" "of" "\xe2\x96\x81" "sentence" "\xef\xbd\x9c" ">");

    request r;
    request_init(&r, REQ_CHAT, 128);
    r.think_mode = DS4_THINK_HIGH;
    r.prompt_text = xstrdup(prompt_text);
    char *visible = build_toolless_thinking_visible_text(&r, content);
    TEST_ASSERT(visible != NULL);
    TEST_ASSERT(!strcmp(visible, canonical.ptr));
    free(visible);
    request_free(&r);

    /* Now build what the NEXT request would render: history includes this
     * assistant message, plus a new user message.  Extract just the prefix
     * up to and including the eos of the assistant turn. */
    chat_msgs history_msgs = {0};
    chat_msg h_user1 = {0};
    h_user1.role = xstrdup("user");
    h_user1.content = xstrdup("What is 2+2?");
    chat_msgs_push(&history_msgs, h_user1);
    chat_msg h_asst = {0};
    h_asst.role = xstrdup("assistant");
    h_asst.reasoning = xstrdup(reasoning);
    h_asst.content = xstrdup(content);
    chat_msgs_push(&history_msgs, h_asst);
    chat_msg h_user2 = {0};
    h_user2.role = xstrdup("user");
    h_user2.content = xstrdup("Thanks!");
    chat_msgs_push(&history_msgs, h_user2);

    char *future_prompt = render_chat_prompt_text(&history_msgs, NULL, NULL, DS4_THINK_HIGH);

    /* The future prompt should START with our canonical text */
    size_t clen = canonical.len;
    TEST_ASSERT(strlen(future_prompt) > clen);
    TEST_ASSERT(!memcmp(future_prompt, canonical.ptr, clen));

    /* And what comes after is the new user turn + assistant prefix */
    const char *rest = future_prompt + clen;
    TEST_ASSERT(strstr(rest, "Thanks!") != NULL);
    TEST_ASSERT(strstr(rest, "<think>") != NULL);  /* new turn starts thinking */

    /* Verify reasoning is NOT in the future prompt for this turn */
    const char *asst_turn = strstr(future_prompt, "<" "\xef\xbd\x9c" "Assistant" "\xef\xbd\x9c" ">");
    TEST_ASSERT(asst_turn != NULL);
    TEST_ASSERT(strstr(future_prompt, reasoning) == NULL);  /* reasoning dropped */

    free(future_prompt);
    buf_free(&canonical);
    free(prompt_text);
    chat_msgs_free(&prefix_msgs);
    chat_msgs_free(&history_msgs);
}

static void test_thinking_canonical_empty_content(void) {
    /* Edge case: model thinks but produces empty content (e.g. tool-less
     * thinking where answer is entirely in reasoning).  Canonical should
     * still be valid: prompt_text[:-7] + "</think><|eos|>" */
    chat_msgs msgs = {0};
    chat_msg user = {0};
    user.role = xstrdup("user");
    user.content = xstrdup("Think about life");
    chat_msgs_push(&msgs, user);

    char *prompt_text = render_chat_prompt_text(&msgs, NULL, NULL, DS4_THINK_HIGH);
    size_t pt_len = strlen(prompt_text);

    /* Build canonical with empty content */
    buf canonical = {0};
    buf_append(&canonical, prompt_text, pt_len - 7);
    buf_puts(&canonical, "</think>");
    /* empty content */
    buf_puts(&canonical, "<" "\xef\xbd\x9c" "end" "\xe2\x96\x81" "of" "\xe2\x96\x81" "sentence" "\xef\xbd\x9c" ">");

    /* Future prompt with empty content assistant message */
    chat_msgs history = {0};
    chat_msg h_u = {0};
    h_u.role = xstrdup("user");
    h_u.content = xstrdup("Think about life");
    chat_msgs_push(&history, h_u);
    chat_msg h_a = {0};
    h_a.role = xstrdup("assistant");
    h_a.reasoning = xstrdup("Deep thoughts about existence...");
    h_a.content = xstrdup("");
    chat_msgs_push(&history, h_a);
    chat_msg h_u2 = {0};
    h_u2.role = xstrdup("user");
    h_u2.content = xstrdup("Continue");
    chat_msgs_push(&history, h_u2);

    char *future = render_chat_prompt_text(&history, NULL, NULL, DS4_THINK_HIGH);
    TEST_ASSERT(strlen(future) > canonical.len);
    TEST_ASSERT(!memcmp(future, canonical.ptr, canonical.len));
    /* reasoning dropped */
    TEST_ASSERT(strstr(future, "Deep thoughts") == NULL);

    free(future);
    buf_free(&canonical);
    free(prompt_text);
    chat_msgs_free(&msgs);
    chat_msgs_free(&history);
}

static void test_thinking_canonical_multi_turn(void) {
    /* Multi-turn: 3 user messages, 2 assistant responses with reasoning.
     * Both prior assistant turns should have reasoning dropped.
     * The canonical after the SECOND generation should produce text that
     * matches the start of a 3rd-turn future prompt. */
    chat_msgs turn2_prefix = {0};
    chat_msg u1 = {0};
    u1.role = xstrdup("user");
    u1.content = xstrdup("Hello");
    chat_msgs_push(&turn2_prefix, u1);
    chat_msg a1 = {0};
    a1.role = xstrdup("assistant");
    a1.reasoning = xstrdup("first reasoning");
    a1.content = xstrdup("Hi there");
    chat_msgs_push(&turn2_prefix, a1);
    chat_msg u2 = {0};
    u2.role = xstrdup("user");
    u2.content = xstrdup("How are you?");
    chat_msgs_push(&turn2_prefix, u2);

    /* prompt_text for the 2nd generation (includes 1st assistant turn) */
    char *prompt_text = render_chat_prompt_text(&turn2_prefix, NULL, NULL, DS4_THINK_HIGH);
    size_t pt_len = strlen(prompt_text);
    TEST_ASSERT(!memcmp(prompt_text + pt_len - 7, "<think>", 7));

    /* 1st turn reasoning is already dropped in this prompt_text */
    TEST_ASSERT(strstr(prompt_text, "first reasoning") == NULL);
    TEST_ASSERT(strstr(prompt_text, "Hi there") != NULL);

    /* After 2nd generation: canonical drops 2nd reasoning too */
    const char *content2 = "I'm doing well";
    buf canonical = {0};
    buf_append(&canonical, prompt_text, pt_len - 7);
    buf_puts(&canonical, "</think>");
    buf_puts(&canonical, content2);
    buf_puts(&canonical, "<" "\xef\xbd\x9c" "end" "\xe2\x96\x81" "of" "\xe2\x96\x81" "sentence" "\xef\xbd\x9c" ">");

    /* Future: 3rd user message arrives */
    chat_msgs future_msgs = {0};
    chat_msg fu1 = {0}; fu1.role = xstrdup("user"); fu1.content = xstrdup("Hello");
    chat_msgs_push(&future_msgs, fu1);
    chat_msg fa1 = {0}; fa1.role = xstrdup("assistant");
    fa1.reasoning = xstrdup("first reasoning");
    fa1.content = xstrdup("Hi there");
    chat_msgs_push(&future_msgs, fa1);
    chat_msg fu2 = {0}; fu2.role = xstrdup("user"); fu2.content = xstrdup("How are you?");
    chat_msgs_push(&future_msgs, fu2);
    chat_msg fa2 = {0}; fa2.role = xstrdup("assistant");
    fa2.reasoning = xstrdup("second reasoning");
    fa2.content = xstrdup(content2);
    chat_msgs_push(&future_msgs, fa2);
    chat_msg fu3 = {0}; fu3.role = xstrdup("user"); fu3.content = xstrdup("Great");
    chat_msgs_push(&future_msgs, fu3);

    char *future = render_chat_prompt_text(&future_msgs, NULL, NULL, DS4_THINK_HIGH);
    /* Both reasonings dropped */
    TEST_ASSERT(strstr(future, "first reasoning") == NULL);
    TEST_ASSERT(strstr(future, "second reasoning") == NULL);
    /* Canonical is a prefix of future */
    TEST_ASSERT(strlen(future) > canonical.len);
    TEST_ASSERT(!memcmp(future, canonical.ptr, canonical.len));

    free(future);
    buf_free(&canonical);
    free(prompt_text);
    chat_msgs_free(&turn2_prefix);
    chat_msgs_free(&future_msgs);
}

static void test_thinking_canonical_with_tools_preserves_reasoning(void) {
    /* When tools ARE present, reasoning is preserved in re-render.
     * The toolless thinking live binding should NOT fire (has_tools gate),
     * and the tool-call replay path handles it.  Verify the template
     * preserves reasoning when tool_context is true. */
    const char *tool_schemas = "{\"name\":\"bash\"}";

    chat_msgs msgs = {0};
    chat_msg u = {0};
    u.role = xstrdup("user");
    u.content = xstrdup("run ls");
    chat_msgs_push(&msgs, u);

    char *prompt_text = render_chat_prompt_text(&msgs, tool_schemas, NULL, DS4_THINK_HIGH);
    size_t pt_len = strlen(prompt_text);
    TEST_ASSERT(!memcmp(prompt_text + pt_len - 7, "<think>", 7));

    /* With tools, next render KEEPS reasoning */
    chat_msgs history = {0};
    chat_msg hu = {0}; hu.role = xstrdup("user"); hu.content = xstrdup("run ls");
    chat_msgs_push(&history, hu);
    chat_msg ha = {0}; ha.role = xstrdup("assistant");
    ha.reasoning = xstrdup("I should run bash");
    ha.content = xstrdup("Here you go");
    chat_msgs_push(&history, ha);
    chat_msg hu2 = {0}; hu2.role = xstrdup("user"); hu2.content = xstrdup("thanks");
    chat_msgs_push(&history, hu2);

    char *future = render_chat_prompt_text(&history, tool_schemas, NULL, DS4_THINK_HIGH);
    /* Reasoning IS preserved when tools present */
    TEST_ASSERT(strstr(future, "I should run bash") != NULL);
    TEST_ASSERT(strstr(future, "<think>I should run bash</think>") != NULL);

    free(future);
    free(prompt_text);
    chat_msgs_free(&msgs);
    chat_msgs_free(&history);
}

static void test_thinking_canonical_non_thinking_mode_noop(void) {
    /* When thinking is disabled (deepseek-chat), prompt_text ends with
     * </think> not <think>.  The toolless thinking live binding is a no-op
     * (early return on memcmp check). */
    chat_msgs msgs = {0};
    chat_msg u = {0};
    u.role = xstrdup("user");
    u.content = xstrdup("Hello");
    chat_msgs_push(&msgs, u);

    char *prompt_text = render_chat_prompt_text(&msgs, NULL, NULL, DS4_THINK_NONE);
    size_t pt_len = strlen(prompt_text);
    /* Should end with </think>, not <think> */
    TEST_ASSERT(pt_len >= 8);
    TEST_ASSERT(!memcmp(prompt_text + pt_len - 8, "</think>", 8));
    /* Does NOT end with <think> */
    TEST_ASSERT(memcmp(prompt_text + pt_len - 7, "<think>", 7) != 0);

    free(prompt_text);
    chat_msgs_free(&msgs);
}

static void ds4_server_unit_tests_run(void) {
    test_request_defaults_use_min_p_filtering();
    test_reasoning_effort_mapping();
    test_api_thinking_controls_parse();
    test_render_think_max_prompt_prefix();
    test_render_non_thinking_prompt_closes_think();
    test_render_drops_old_reasoning_without_tools();
    test_render_preserves_reasoning_with_tools();
    test_render_chat_prompt_text_renders_tools_before_system();
    test_tool_schema_order_from_anthropic_schema();
    test_tool_schema_order_from_openai_tools();
    test_tool_schema_order_from_responses_tool_search();
    test_responses_function_named_tool_search_stays_function_call();
    test_responses_namespace_tool_schemas_restore_wire_namespace();
    test_responses_input_tool_search_output_loads_tools();
    test_responses_input_tool_search_output_rejects_bad_tools();
    test_responses_input_function_call_namespace_round_trips_to_dsml();
    test_responses_output_sends_tool_search_call_item();
    test_dsml_tool_args_preserve_call_order();
    test_openai_tool_args_preserve_call_order();
    test_anthropic_thinking_and_tool_args_preserve_call_order();
    test_context_length_error_uses_protocol_standard_shape();
    test_token_count_result_reports_exact_budget();
    test_token_count_response_uses_openai_request_parser();
    test_cors_headers_are_opt_in();
    test_cors_preflight_response_is_no_content();
    test_cors_sse_headers();
    test_anthropic_live_stream_sends_incremental_blocks();
    test_anthropic_usage_reports_cache_details();
    test_anthropic_tool_stream_sends_live_tool_use();
    test_openai_tool_stream_sends_incremental_text();
    test_openai_stream_usage_reports_cache_details();
    test_responses_usage_reports_cache_details();
    test_openai_chat_stream_splits_reasoning_without_tools();
    test_openai_tool_stream_sends_partial_arguments();
    test_openai_tool_stream_waits_for_incomplete_tool_tags();
    test_openai_tool_stream_sends_partial_raw_arguments();
    test_openai_tool_stream_holds_partial_dsml_entities();
    test_openai_tool_stream_holds_partial_utf8_arguments();
    test_openai_tool_stream_handles_multiple_calls();
    test_streaming_holds_partial_utf8();
    test_parse_short_dsml_and_canonical_suffix();
    test_dsml_parser_recovers_loose_nested_parameters();
    test_dsml_repair_produces_parseable_calls();
    test_tool_parse_failure_returns_recoverable_finish();
    test_invalid_dsml_tool_error_suffix_includes_system_prompt();
    test_thinking_dsml_is_not_executable_before_think_close();
    test_thinking_dsml_after_think_close_is_executable();
    test_tool_checkpoint_suffix_is_future_prompt_canonical();
    test_tool_checkpoint_minifies_json_parameters();
    test_tool_memory_replays_sampled_dsml();
    test_anthropic_tool_memory_replays_sampled_dsml();
    test_anthropic_live_tail_renders_tool_results_only();
    test_anthropic_tool_result_id_validation();
    test_anthropic_full_replay_allows_unknown_live_id();
    test_anthropic_tool_use_parses_before_role();
    test_tool_checkpoint_canonicalization_gate_exact_replay();
    test_responses_live_tail_renders_tool_outputs_only();
    test_responses_tool_output_id_validation();
    test_responses_stateless_tool_replay_requires_reasoning();
    test_responses_visible_suffix_matches_client_replay();
    test_exact_dsml_tool_replay_can_be_disabled();
    test_dsml_decode_state_separates_structure_and_payload();
    test_tool_memory_max_ids_prunes_oldest();
    test_kv_tool_map_filters_by_dsml_text();
    test_kv_tool_map_restores_before_prompt_render();
    test_thinking_checkpoint_canonical_matches_future_prompt();
    test_thinking_canonical_empty_content();
    test_thinking_canonical_multi_turn();
    test_thinking_canonical_with_tools_preserves_reasoning();
    test_thinking_canonical_non_thinking_mode_noop();
    test_tool_separator_whitespace_is_not_content();
    test_dsml_prompt_escapes_tool_supplied_text();
    test_stop_list_parses_all_sequences();
    test_stop_list_streaming_holds_and_trims_stop_text();
    test_json_skip_has_nesting_limit();
    test_model_metadata_clamps_completion_to_context();
    test_client_socket_nonblocking_flag();
    test_thinking_state_tracks_prompt_and_generated_tags();
    test_thinking_checkpoint_remember_gate();
    test_tool_marker_state_ignores_orphan_end();
    test_canonical_rewrite_rebuilds_when_live_tail_changes();
    test_kv_cache_store_len_uses_configured_boundary();
    test_kv_cache_chat_anchor_uses_last_user_before_assistant();
    test_kv_cache_chat_anchor_ignores_multiturn_tail();
    test_kv_cache_continued_uses_aligned_frontiers();
    test_kv_cache_cold_store_suppresses_duplicate_continued_boundary();
    test_kv_cache_file_size_must_fit_budget();
    test_sha1_bytes_hex_matches_known_vector();
    test_kv_cache_lookup_uses_longest_text_prefix();
    test_kv_cache_lookup_rejects_wrong_model();
    test_kv_cache_lookup_rejects_stale_payload_abi();
    test_kv_cache_eviction_values_fresh_snapshots();
    test_kv_cache_eviction_prefers_anchor_reason();
    test_kv_cache_eviction_makes_room_before_store();
    test_kv_cache_eviction_ignores_oversize_incoming();
    test_kv_cache_eviction_prefers_superseded_continued_prefix();
    test_kv_cache_eviction_keeps_smaller_context_prefix();
    test_kv_cache_eviction_score_decays_stale_hits();
    test_kv_cache_eviction_decayed_hits_tie_break_by_age();
    test_kv_cache_eviction_keeps_aligned_continued_frontiers();
}

#ifndef DS4_SERVER_TEST_NO_MAIN
int main(void) {
    ds4_server_unit_tests_run();
    if (test_failures) {
        fprintf(stderr, "ds4-server tests: %d failure(s)\n", test_failures);
        return 1;
    }
    puts("ds4-server tests: ok");
    return 0;
}
#endif

#endif
````

## File: ds4_ssd.c
````c
#include "ds4_ssd.h"

#include <ctype.h>
#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#ifndef MAP_ANONYMOUS
#define MAP_ANONYMOUS MAP_ANON
#endif

static const uint64_t DS4_GIB = 1024ull * 1024ull * 1024ull;

bool ds4_parse_gib_arg(const char *s, uint64_t *bytes) {
    if (bytes) *bytes = 0;
    if (!s || !s[0] || !bytes) return false;

    size_t len = strlen(s);
    if (len > 2 &&
        (s[len - 2] == 'g' || s[len - 2] == 'G') &&
        (s[len - 1] == 'b' || s[len - 1] == 'B')) {
        len -= 2;
    }
    if (len == 0) return false;
    for (size_t i = 0; i < len; i++) {
        if (!isdigit((unsigned char)s[i])) return false;
    }

    char numbuf[32];
    if (len >= sizeof(numbuf)) return false;
    memcpy(numbuf, s, len);
    numbuf[len] = '\0';

    errno = 0;
    unsigned long long v = strtoull(numbuf, NULL, 10);
    if (errno != 0 || v == 0 || v > UINT64_MAX / DS4_GIB) return false;

    *bytes = (uint64_t)v * DS4_GIB;
    return true;
}

bool ds4_parse_streaming_cache_experts_arg(const char *s,
                                           uint32_t   *experts,
                                           uint64_t   *bytes) {
    if (experts) *experts = 0;
    if (bytes) *bytes = 0;
    if (!s || !s[0] || !experts || !bytes) return false;

    const size_t len = strlen(s);
    if (len > 2 &&
        (s[len - 2] == 'g' || s[len - 2] == 'G') &&
        (s[len - 1] == 'b' || s[len - 1] == 'B')) {
        return ds4_parse_gib_arg(s, bytes);
    }

    for (size_t i = 0; i < len; i++) {
        if (!isdigit((unsigned char)s[i])) return false;
    }

    errno = 0;
    unsigned long v = strtoul(s, NULL, 10);
    if (errno != 0 || v == 0 || v > UINT32_MAX) return false;

    *experts = (uint32_t)v;
    return true;
}

uint32_t ds4_ssd_cache_experts_for_byte_budget(uint64_t bytes,
                                               uint64_t per_expert_bytes) {
    if (bytes == 0 || per_expert_bytes == 0) return 0;
    const uint64_t experts = bytes / per_expert_bytes;
    if (experts == 0 || experts > UINT32_MAX) return 0;
    return (uint32_t)experts;
}

bool ds4_ssd_auto_cache_plan(uint64_t            recommended_bytes,
                             uint64_t            non_routed_bytes,
                             uint64_t            per_expert_bytes,
                             uint64_t            max_model_experts,
                             ds4_ssd_cache_plan *out) {
    if (!out) return false;
    memset(out, 0, sizeof(*out));
    if (recommended_bytes == 0 || per_expert_bytes == 0) return false;

    out->model_target_bytes =
        recommended_bytes > UINT64_MAX / 4ull ?
            UINT64_MAX : (recommended_bytes * 4ull) / 5ull;
    if (out->model_target_bytes > non_routed_bytes) {
        out->cache_bytes = out->model_target_bytes - non_routed_bytes;
    }

    uint64_t cache_experts = out->cache_bytes / per_expert_bytes;
    if (cache_experts == 0) cache_experts = 1;
    if (max_model_experts != 0 && cache_experts > max_model_experts) {
        cache_experts = max_model_experts;
    }
    if (cache_experts > UINT32_MAX) cache_experts = UINT32_MAX;

    out->cache_experts = (uint32_t)cache_experts;
    out->effective_cache_bytes = cache_experts * per_expert_bytes;
    return out->cache_experts != 0;
}

bool ds4_ssd_memory_lock_acquire(ds4_ssd_memory_lock *lock,
                                 uint64_t             bytes) {
    if (!lock) return false;
    lock->ptr = NULL;
    lock->bytes = 0;
    if (bytes == 0) return true;
    if (bytes > (uint64_t)SIZE_MAX) {
        fprintf(stderr,
                "ds4: --simulate-used-memory is too large for this process\n");
        return false;
    }

    void *ptr = mmap(NULL,
                     (size_t)bytes,
                     PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS,
                     -1,
                     0);
    if (ptr == MAP_FAILED) {
        fprintf(stderr,
                "ds4: --simulate-used-memory mmap %.2f GiB failed: %s\n",
                (double)bytes / (double)DS4_GIB,
                strerror(errno));
        return false;
    }

    const long page_long = sysconf(_SC_PAGESIZE);
    const uint64_t page = page_long > 0 ? (uint64_t)page_long : 4096ull;
    const uint64_t chunk_bytes = 256ull * 1024ull * 1024ull;
    volatile unsigned char *p = (volatile unsigned char *)ptr;

    /*
     * Touch and lock in bounded chunks.  A single very large mlock() is harder
     * to diagnose when it fails and can create long uninterruptible VM work on
     * macOS; chunking mirrors the standalone diagnostic utility.
     */
    uint64_t locked = 0;
    for (uint64_t off = 0; off < bytes; off += chunk_bytes) {
        uint64_t len = bytes - off;
        if (len > chunk_bytes) len = chunk_bytes;

        for (uint64_t pos = off; pos < off + len; pos += page) {
            p[pos] = (unsigned char)(pos / page);
        }
        if (len != 0) p[off + len - 1u] = 1;

        if (mlock((void *)(p + off), (size_t)len) != 0) {
            fprintf(stderr,
                    "ds4: --simulate-used-memory mlock failed after %.2f/%.2f GiB: %s\n",
                    (double)locked / (double)DS4_GIB,
                    (double)bytes / (double)DS4_GIB,
                    strerror(errno));
            if (locked != 0) munlock(ptr, (size_t)locked);
            munmap(ptr, (size_t)bytes);
            return false;
        }
        locked += len;
    }

    lock->ptr = ptr;
    lock->bytes = bytes;
    fprintf(stderr,
            "ds4: simulated used memory: locked %.2f GiB before model load\n",
            (double)bytes / (double)DS4_GIB);
    return true;
}

void ds4_ssd_memory_lock_release(ds4_ssd_memory_lock *lock) {
    if (!lock || !lock->ptr || lock->bytes == 0) return;
    munlock(lock->ptr, (size_t)lock->bytes);
    munmap(lock->ptr, (size_t)lock->bytes);
    lock->ptr = NULL;
    lock->bytes = 0;
}
````

## File: ds4_ssd.h
````c
#ifndef DS4_SSD_H
#define DS4_SSD_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    void *ptr;
    uint64_t bytes;
} ds4_ssd_memory_lock;

typedef struct {
    uint64_t model_target_bytes;
    uint64_t cache_bytes;
    uint64_t effective_cache_bytes;
    uint32_t cache_experts;
} ds4_ssd_cache_plan;

bool ds4_parse_gib_arg(const char *s, uint64_t *bytes);
bool ds4_parse_streaming_cache_experts_arg(const char *s,
                                           uint32_t   *experts,
                                           uint64_t   *bytes);

uint32_t ds4_ssd_cache_experts_for_byte_budget(uint64_t bytes,
                                               uint64_t per_expert_bytes);
bool ds4_ssd_auto_cache_plan(uint64_t            recommended_bytes,
                             uint64_t            non_routed_bytes,
                             uint64_t            per_expert_bytes,
                             uint64_t            max_model_experts,
                             ds4_ssd_cache_plan *out);

bool ds4_ssd_memory_lock_acquire(ds4_ssd_memory_lock *lock,
                                 uint64_t             bytes);
void ds4_ssd_memory_lock_release(ds4_ssd_memory_lock *lock);

#endif
````

## File: ds4_streaming_hotlist.inc
````
/* Generated from ds4 expert hotlist profiles; sorted by hits/weight. */
/* DeepSeek V4 Pro default streaming expert hotlist. */
static const uint16_t ds4_default_streaming_hotlist_pro[][2] = {
    {44, 213},
    {25, 315},
    {56, 253},
    {19, 161},
    {41, 262},
    {6, 322},
    {50, 29},
    {9, 287},
    {40, 358},
    {30, 350},
    {52, 124},
    {4, 83},
    {11, 110},
    {42, 189},
    {28, 168},
    {7, 49},
    {58, 270},
    {40, 31},
    {3, 314},
    {45, 325},
    {22, 260},
    {47, 115},
    {36, 232},
    {29, 14},
    {37, 58},
    {47, 197},
    {46, 326},
    {51, 257},
    {46, 194},
    {34, 380},
    {52, 183},
    {34, 29},
    {54, 155},
    {27, 113},
    {41, 374},
    {10, 3},
    {39, 1},
    {9, 143},
    {5, 174},
    {38, 301},
    {60, 94},
    {44, 61},
    {43, 343},
    {42, 322},
    {41, 324},
    {15, 141},
    {17, 126},
    {27, 275},
    {8, 272},
    {30, 242},
    {51, 106},
    {20, 43},
    {31, 98},
    {37, 22},
    {36, 20},
    {4, 214},
    {10, 211},
    {47, 313},
    {15, 375},
    {17, 165},
    {37, 109},
    {34, 240},
    {50, 244},
    {6, 67},
    {50, 313},
    {38, 92},
    {54, 164},
    {21, 203},
    {9, 151},
    {36, 288},
    {60, 16},
    {43, 258},
    {22, 278},
    {40, 100},
    {32, 365},
    {49, 44},
    {49, 202},
    {27, 348},
    {46, 162},
    {13, 44},
    {23, 180},
    {52, 159},
    {6, 32},
    {17, 200},
    {20, 210},
    {50, 136},
    {35, 281},
    {48, 173},
    {32, 44},
    {48, 5},
    {33, 140},
    {49, 16},
    {16, 143},
    {36, 351},
    {27, 13},
    {35, 114},
    {18, 45},
    {24, 105},
    {26, 150},
    {17, 236},
    {9, 185},
    {14, 264},
    {16, 323},
    {39, 129},
    {46, 235},
    {20, 75},
    {42, 206},
    {40, 368},
    {49, 32},
    {11, 90},
    {16, 297},
    {30, 141},
    {54, 161},
    {28, 142},
    {47, 295},
    {12, 296},
    {27, 62},
    {57, 119},
    {18, 308},
    {39, 110},
    {58, 252},
    {28, 178},
    {26, 140},
    {12, 117},
    {24, 7},
    {27, 169},
    {32, 336},
    {58, 167},
    {38, 135},
    {26, 380},
    {10, 365},
    {8, 108},
    {18, 49},
    {34, 71},
    {20, 367},
    {12, 262},
    {54, 16},
    {43, 197},
    {10, 246},
    {26, 136},
    {5, 57},
    {16, 251},
    {45, 157},
    {14, 134},
    {10, 136},
    {15, 311},
    {8, 67},
    {30, 161},
    {50, 102},
    {48, 229},
    {25, 276},
    {55, 372},
    {15, 174},
    {13, 348},
    {19, 26},
    {4, 300},
    {44, 45},
    {45, 369},
    {51, 32},
    {53, 342},
    {13, 319},
    {41, 201},
    {27, 362},
    {12, 219},
    {59, 339},
    {38, 238},
    {11, 278},
    {37, 327},
    {38, 285},
    {11, 78},
    {56, 5},
    {27, 260},
    {47, 283},
    {31, 0},
    {21, 204},
    {58, 8},
    {12, 26},
    {18, 322},
    {24, 102},
    {23, 133},
    {59, 71},
    {32, 328},
    {24, 6},
    {19, 270},
    {13, 362},
    {55, 54},
    {22, 149},
    {28, 132},
    {9, 199},
    {58, 359},
    {5, 98},
    {3, 209},
    {19, 312},
    {15, 314},
    {21, 267},
    {34, 158},
    {22, 127},
    {24, 318},
    {57, 304},
    {24, 355},
    {59, 80},
    {12, 255},
    {5, 273},
    {3, 66},
    {48, 76},
    {22, 375},
    {30, 87},
    {34, 278},
    {18, 116},
    {39, 57},
    {34, 274},
    {16, 206},
    {17, 309},
    {38, 73},
    {22, 93},
    {13, 338},
    {18, 120},
    {45, 380},
    {42, 12},
    {6, 28},
    {24, 214},
    {45, 26},
    {56, 118},
    {20, 49},
    {56, 154},
    {23, 321},
    {7, 94},
    {57, 336},
    {18, 237},
    {5, 77},
    {13, 89},
    {18, 280},
    {48, 16},
    {31, 187},
    {23, 163},
    {20, 125},
    {24, 149},
    {33, 85},
    {19, 304},
    {22, 161},
    {12, 114},
    {40, 201},
    {51, 79},
    {16, 316},
    {14, 291},
    {49, 269},
    {17, 141},
    {6, 147},
    {47, 208},
    {30, 265},
    {42, 222},
    {44, 221},
    {52, 202},
    {28, 93},
    {43, 45},
    {5, 233},
    {22, 45},
    {42, 337},
    {13, 249},
    {16, 231},
    {26, 63},
    {53, 141},
    {56, 247},
    {21, 345},
    {59, 112},
    {54, 131},
    {32, 278},
    {36, 37},
    {17, 57},
    {21, 91},
    {10, 319},
    {7, 292},
    {43, 140},
    {54, 35},
    {32, 116},
    {26, 158},
    {32, 306},
    {47, 52},
    {18, 63},
    {20, 112},
    {46, 145},
    {40, 357},
    {42, 313},
    {16, 236},
    {58, 299},
    {53, 178},
    {36, 214},
    {5, 165},
    {36, 79},
    {53, 359},
    {12, 316},
    {35, 181},
    {26, 287},
    {22, 29},
    {19, 32},
    {22, 71},
    {26, 290},
    {15, 162},
    {22, 359},
    {18, 299},
    {11, 226},
    {17, 138},
    {5, 346},
    {3, 18},
    {20, 148},
    {10, 51},
    {21, 259},
    {37, 40},
    {48, 131},
    {26, 249},
    {4, 222},
    {26, 336},
    {19, 90},
    {42, 87},
    {56, 103},
    {55, 51},
    {56, 28},
    {5, 48},
    {23, 209},
    {12, 298},
    {25, 340},
    {31, 375},
    {3, 232},
    {52, 294},
    {24, 260},
    {23, 218},
    {46, 251},
    {48, 354},
    {21, 22},
    {50, 327},
    {17, 30},
    {14, 343},
    {5, 370},
    {4, 318},
    {23, 211},
    {17, 328},
    {28, 308},
    {6, 199},
    {16, 115},
    {31, 219},
    {20, 161},
    {43, 23},
    {50, 252},
    {6, 349},
    {56, 363},
    {28, 28},
    {52, 361},
    {27, 351},
    {60, 162},
    {4, 319},
    {49, 74},
    {39, 247},
    {54, 268},
    {43, 215},
    {57, 206},
    {38, 329},
    {25, 42},
    {15, 209},
    {14, 37},
    {51, 3},
    {59, 237},
    {13, 380},
    {8, 341},
    {14, 292},
    {37, 53},
    {51, 269},
    {48, 147},
    {51, 143},
    {14, 256},
    {14, 159},
    {33, 279},
    {18, 220},
    {13, 325},
    {16, 282},
    {15, 275},
    {18, 300},
    {37, 329},
    {11, 168},
    {9, 244},
    {19, 199},
    {29, 82},
    {22, 123},
    {24, 104},
    {45, 47},
    {5, 227},
    {14, 203},
    {34, 67},
    {54, 159},
    {23, 175},
    {25, 62},
    {11, 121},
    {28, 118},
    {59, 6},
    {7, 354},
    {9, 85},
    {4, 252},
    {9, 48},
    {13, 64},
    {52, 378},
    {10, 142},
    {23, 376},
    {46, 189},
    {45, 260},
    {41, 271},
    {37, 259},
    {47, 300},
    {32, 218},
    {60, 206},
    {41, 291},
    {38, 363},
    {40, 99},
    {20, 235},
    {45, 209},
    {7, 267},
    {8, 382},
    {30, 82},
    {20, 304},
    {15, 185},
    {55, 331},
    {52, 324},
    {34, 113},
    {55, 59},
    {20, 163},
    {39, 349},
    {55, 220},
    {12, 33},
    {48, 143},
    {57, 353},
    {30, 243},
    {28, 71},
    {21, 366},
    {16, 285},
    {36, 280},
    {28, 68},
    {53, 29},
    {16, 45},
    {32, 367},
    {11, 352},
    {28, 309},
    {20, 94},
    {16, 329},
    {48, 303},
    {21, 55},
    {57, 235},
    {16, 16},
    {9, 373},
    {29, 187},
    {26, 301},
    {52, 160},
    {60, 324},
    {15, 254},
    {9, 314},
    {28, 169},
    {30, 367},
    {41, 376},
    {49, 218},
    {40, 315},
    {6, 31},
    {58, 182},
    {12, 260},
    {30, 111},
    {42, 244},
    {54, 7},
    {10, 213},
    {3, 253},
    {39, 265},
    {45, 114},
    {24, 31},
    {30, 372},
    {48, 144},
    {42, 43},
    {51, 218},
    {52, 169},
    {44, 124},
    {42, 366},
    {6, 176},
    {52, 97},
    {39, 371},
    {31, 201},
    {21, 343},
    {32, 27},
    {47, 364},
    {49, 207},
    {50, 268},
    {34, 344},
    {23, 24},
    {8, 194},
    {60, 311},
    {43, 281},
    {10, 201},
    {15, 172},
    {11, 118},
    {19, 106},
    {55, 137},
    {26, 268},
    {39, 370},
    {53, 57},
    {53, 327},
    {21, 40},
    {58, 243},
    {41, 73},
    {45, 161},
    {54, 233},
    {15, 72},
    {38, 269},
    {48, 255},
    {59, 118},
    {54, 203},
    {49, 216},
    {43, 146},
    {39, 175},
    {5, 314},
    {43, 124},
    {25, 237},
    {15, 205},
    {60, 197},
    {24, 92},
    {17, 81},
    {44, 187},
    {4, 327},
    {56, 272},
    {14, 189},
    {34, 73},
    {34, 342},
    {8, 271},
    {21, 162},
    {34, 308},
    {55, 191},
    {44, 296},
    {8, 1},
    {16, 261},
    {18, 216},
    {19, 143},
    {41, 363},
    {33, 283},
    {14, 101},
    {18, 53},
    {5, 371},
    {57, 231},
    {24, 294},
    {42, 210},
    {9, 301},
    {11, 49},
    {6, 50},
    {38, 327},
    {26, 49},
    {58, 272},
    {25, 29},
    {48, 287},
    {35, 162},
    {29, 281},
    {29, 78},
    {56, 341},
    {33, 118},
    {33, 126},
    {42, 331},
    {11, 202},
    {44, 253},
    {25, 214},
    {45, 133},
    {33, 29},
    {29, 295},
    {37, 172},
    {23, 190},
    {27, 312},
    {8, 340},
    {36, 184},
    {48, 200},
    {35, 290},
    {57, 291},
    {13, 147},
    {39, 99},
    {40, 350},
    {39, 108},
    {25, 112},
    {40, 302},
    {21, 229},
    {51, 176},
    {21, 292},
    {21, 50},
    {60, 67},
    {55, 113},
    {22, 144},
    {53, 205},
    {21, 181},
    {12, 25},
    {43, 177},
    {57, 307},
    {15, 369},
    {21, 104},
    {31, 90},
    {30, 241},
    {13, 49},
    {58, 198},
    {29, 181},
    {14, 322},
    {31, 315},
    {59, 58},
    {48, 96},
    {33, 205},
    {27, 170},
    {57, 23},
    {52, 158},
    {33, 173},
    {37, 321},
    {14, 312},
    {56, 326},
    {8, 8},
    {59, 26},
    {55, 187},
    {60, 23},
    {31, 49},
    {32, 50},
    {29, 5},
    {28, 117},
    {44, 339},
    {28, 34},
    {28, 85},
    {11, 249},
    {17, 231},
    {15, 33},
    {28, 198},
    {22, 339},
    {31, 271},
    {20, 67},
    {24, 37},
    {24, 191},
    {33, 94},
    {3, 338},
    {8, 218},
    {18, 14},
    {55, 76},
    {16, 286},
    {14, 116},
    {45, 74},
    {25, 240},
    {4, 309},
    {46, 308},
    {24, 381},
    {53, 335},
    {19, 285},
    {17, 14},
    {49, 5},
    {54, 309},
    {27, 288},
    {56, 101},
    {49, 45},
    {37, 152},
    {55, 287},
    {31, 25},
    {46, 378},
    {58, 356},
    {47, 375},
    {55, 6},
    {33, 319},
    {13, 267},
    {33, 262},
    {11, 145},
    {49, 116},
    {47, 290},
    {47, 163},
    {51, 245},
    {46, 377},
    {60, 205},
    {33, 284},
    {7, 180},
    {38, 147},
    {37, 79},
    {32, 9},
    {60, 157},
    {42, 359},
    {4, 122},
    {39, 58},
    {26, 129},
    {4, 9},
    {55, 117},
    {29, 63},
    {7, 310},
    {28, 365},
    {31, 345},
    {38, 114},
    {55, 64},
    {53, 381},
    {15, 379},
    {29, 317},
    {35, 64},
    {25, 217},
    {50, 227},
    {35, 143},
    {53, 338},
    {26, 114},
    {26, 122},
    {18, 73},
    {6, 89},
    {12, 253},
    {34, 103},
    {13, 252},
    {21, 152},
    {52, 305},
    {25, 257},
    {12, 370},
    {57, 271},
    {18, 224},
    {22, 331},
    {38, 139},
    {33, 334},
    {42, 192},
    {22, 302},
    {27, 60},
    {23, 147},
    {0, 21},
    {28, 377},
    {22, 358},
    {57, 237},
    {16, 95},
    {32, 31},
    {55, 383},
    {31, 262},
    {20, 117},
    {55, 88},
    {45, 93},
    {53, 55},
    {29, 86},
    {2, 288},
    {27, 211},
    {23, 65},
    {16, 129},
    {55, 128},
    {34, 200},
    {20, 36},
    {50, 323},
    {28, 257},
    {20, 175},
    {55, 127},
    {10, 234},
    {15, 229},
    {38, 188},
    {21, 166},
    {29, 65},
    {27, 374},
    {5, 27},
    {52, 356},
    {20, 236},
    {59, 87},
    {52, 267},
    {50, 87},
    {44, 257},
    {15, 164},
    {56, 273},
    {31, 212},
    {49, 336},
    {16, 208},
    {59, 193},
    {36, 340},
    {45, 302},
    {33, 131},
    {12, 367},
    {7, 221},
    {26, 381},
    {7, 295},
    {19, 353},
    {10, 317},
    {38, 356},
    {59, 230},
    {12, 288},
    {20, 170},
    {38, 215},
    {29, 160},
    {36, 24},
    {20, 374},
    {29, 297},
    {3, 316},
    {53, 161},
    {23, 273},
    {20, 320},
    {15, 265},
    {55, 193},
    {6, 324},
    {59, 197},
    {16, 13},
    {19, 82},
    {59, 261},
    {0, 135},
    {27, 328},
    {13, 233},
    {17, 377},
    {57, 242},
    {20, 14},
    {31, 239},
    {29, 200},
    {18, 192},
    {6, 310},
    {54, 219},
    {3, 84},
    {19, 382},
    {55, 159},
    {40, 338},
    {58, 381},
    {12, 297},
    {5, 90},
    {28, 8},
    {56, 268},
    {32, 109},
    {56, 250},
    {57, 210},
    {51, 238},
    {60, 241},
    {8, 141},
    {26, 55},
    {29, 50},
    {19, 51},
    {36, 140},
    {42, 239},
    {3, 362},
    {35, 355},
    {52, 60},
    {10, 178},
    {30, 257},
    {4, 188},
    {11, 248},
    {42, 130},
    {46, 195},
    {0, 45},
    {47, 106},
    {52, 129},
    {50, 96},
    {48, 374},
    {51, 204},
    {46, 181},
    {44, 137},
    {45, 338},
    {43, 284},
    {41, 215},
    {40, 157},
    {41, 107},
    {40, 234},
    {31, 126},
    {59, 210},
    {29, 202},
    {24, 170},
    {41, 36},
    {60, 19},
    {14, 329},
    {59, 331},
    {35, 354},
    {31, 79},
    {17, 149},
    {59, 278},
    {57, 244},
    {33, 239},
    {14, 358},
    {31, 297},
    {46, 13},
    {24, 147},
    {35, 185},
    {13, 83},
    {25, 105},
    {21, 108},
    {47, 274},
    {26, 73},
    {55, 26},
    {55, 22},
    {32, 381},
    {0, 184},
    {6, 74},
    {35, 213},
    {43, 106},
    {5, 175},
    {55, 56},
    {25, 316},
    {9, 311},
    {29, 96},
    {26, 143},
    {43, 132},
    {3, 353},
    {36, 150},
    {43, 204},
    {41, 57},
    {51, 174},
    {14, 49},
    {16, 259},
    {27, 346},
    {26, 361},
    {56, 104},
    {32, 300},
    {46, 169},
    {36, 166},
    {23, 102},
    {60, 69},
    {48, 277},
    {35, 292},
    {1, 375},
    {53, 269},
    {32, 63},
    {35, 360},
    {21, 356},
    {51, 350},
    {20, 246},
    {35, 11},
    {25, 99},
    {43, 278},
    {12, 357},
    {33, 253},
    {42, 253},
    {32, 182},
    {30, 179},
    {30, 215},
    {15, 177},
    {30, 338},
    {12, 154},
    {26, 330},
    {56, 199},
    {32, 107},
    {53, 83},
    {0, 290},
    {33, 178},
    {31, 322},
    {43, 313},
    {39, 353},
    {24, 270},
    {13, 103},
    {19, 248},
    {28, 380},
    {41, 259},
    {58, 128},
    {1, 160},
    {48, 156},
    {15, 301},
    {25, 134},
    {3, 310},
    {9, 62},
    {19, 25},
    {2, 337},
    {7, 56},
    {27, 332},
    {22, 75},
    {13, 179},
    {49, 115},
    {33, 244},
    {48, 48},
    {36, 11},
    {11, 355},
    {14, 68},
    {19, 167},
    {13, 268},
    {22, 40},
    {26, 199},
    {45, 359},
    {31, 168},
    {25, 344},
    {16, 196},
    {19, 181},
    {27, 308},
    {49, 99},
    {3, 100},
    {51, 64},
    {2, 124},
    {22, 150},
    {57, 361},
    {22, 138},
    {41, 74},
    {0, 114},
    {3, 130},
    {25, 57},
    {36, 96},
    {37, 168},
    {52, 244},
    {40, 280},
    {16, 358},
    {43, 155},
    {11, 358},
    {7, 335},
    {9, 58},
    {43, 271},
    {44, 201},
    {18, 76},
    {10, 273},
    {28, 339},
    {25, 163},
    {40, 78},
    {12, 376},
    {21, 15},
    {54, 291},
    {28, 176},
    {47, 303},
    {24, 150},
    {49, 108},
    {33, 32},
    {53, 247},
    {46, 376},
    {31, 248},
    {16, 160},
    {28, 333},
    {25, 11},
    {7, 299},
    {16, 46},
    {6, 318},
    {43, 47},
    {15, 250},
    {14, 85},
    {18, 182},
    {39, 174},
    {22, 83},
    {34, 313},
    {7, 371},
    {59, 341},
    {55, 232},
    {58, 45},
    {57, 323},
    {57, 357},
    {53, 95},
    {56, 382},
    {31, 42},
    {16, 245},
    {21, 137},
    {36, 2},
    {43, 380},
    {40, 376},
    {31, 115},
    {50, 196},
    {23, 131},
    {42, 212},
    {47, 193},
    {39, 258},
    {31, 292},
    {47, 27},
    {38, 328},
    {59, 221},
    {1, 44},
    {3, 300},
    {13, 4},
    {17, 201},
    {14, 146},
    {31, 356},
    {7, 82},
    {53, 224},
    {48, 214},
    {55, 169},
    {32, 203},
    {45, 58},
    {54, 211},
    {57, 346},
    {54, 44},
    {6, 71},
    {17, 185},
    {6, 273},
    {50, 362},
    {6, 223},
    {36, 382},
    {12, 381},
    {60, 125},
    {13, 150},
    {29, 34},
    {50, 282},
    {20, 149},
    {1, 143},
    {55, 327},
    {14, 75},
    {51, 250},
    {34, 62},
    {54, 54},
    {11, 99},
    {33, 1},
    {23, 280},
    {46, 202},
    {49, 198},
    {34, 83},
    {46, 215},
    {60, 57},
    {37, 277},
    {50, 22},
    {44, 101},
    {50, 139},
    {49, 307},
    {9, 41},
    {56, 356},
    {9, 135},
    {49, 162},
    {10, 309},
    {46, 278},
    {37, 138},
    {56, 140},
    {44, 235},
    {0, 60},
    {44, 9},
    {51, 219},
    {38, 349},
    {38, 240},
    {33, 17},
    {39, 305},
    {38, 181},
    {58, 377},
    {31, 91},
    {48, 321},
    {45, 201},
    {47, 155},
    {44, 134},
    {40, 8},
    {0, 346},
    {59, 219},
    {48, 90},
    {13, 215},
    {12, 294},
    {33, 55},
    {53, 281},
    {59, 204},
    {29, 138},
    {26, 75},
    {8, 238},
    {59, 335},
    {37, 328},
    {51, 273},
    {45, 22},
    {53, 204},
    {55, 352},
    {27, 367},
    {23, 157},
    {56, 256},
    {8, 117},
    {57, 77},
    {54, 85},
    {39, 195},
    {7, 5},
    {35, 120},
    {51, 117},
    {39, 340},
    {45, 223},
    {3, 279},
    {51, 286},
    {54, 88},
    {55, 190},
    {22, 151},
    {29, 8},
    {58, 239},
    {43, 338},
    {57, 71},
    {39, 73},
    {20, 88},
    {43, 51},
    {59, 187},
    {37, 227},
    {3, 49},
    {24, 93},
    {56, 357},
    {41, 151},
    {25, 96},
    {4, 58},
    {55, 245},
    {13, 48},
    {23, 202},
    {25, 244},
    {55, 282},
    {14, 84},
    {53, 144},
    {53, 88},
    {28, 342},
    {26, 373},
    {56, 86},
    {2, 290},
    {14, 330},
    {57, 178},
    {29, 161},
    {36, 77},
    {59, 53},
    {24, 113},
    {50, 296},
    {54, 37},
    {51, 343},
    {3, 334},
    {45, 210},
    {4, 198},
    {2, 345},
    {14, 22},
    {53, 41},
    {40, 122},
    {1, 293},
    {42, 30},
    {11, 374},
    {18, 41},
    {39, 264},
    {23, 2},
    {1, 319},
    {20, 78},
    {23, 266},
    {41, 360},
    {14, 179},
    {42, 201},
    {0, 78},
    {23, 268},
    {39, 327},
    {8, 131},
    {17, 134},
    {45, 372},
    {29, 113},
    {3, 82},
    {3, 277},
    {19, 11},
    {57, 88},
    {57, 13},
    {23, 97},
    {2, 75},
    {7, 261},
    {29, 282},
    {16, 174},
    {34, 217},
    {32, 78},
    {54, 42},
    {12, 332},
    {55, 157},
    {2, 269},
    {17, 43},
    {26, 3},
    {53, 133},
    {2, 297},
    {19, 271},
    {53, 4},
    {1, 31},
    {12, 2},
    {48, 284},
    {8, 339},
    {34, 40},
    {23, 315},
    {14, 294},
    {29, 276},
    {44, 33},
    {36, 189},
    {56, 283},
    {35, 39},
    {31, 230},
    {19, 23},
    {1, 329},
    {3, 128},
    {30, 186},
    {46, 314},
    {53, 215},
    {29, 61},
    {7, 86},
    {28, 19},
    {49, 248},
    {21, 319},
    {12, 191},
    {24, 301},
    {15, 297},
    {1, 85},
    {22, 353},
    {3, 104},
    {54, 151},
    {50, 74},
    {53, 275},
    {48, 243},
    {53, 138},
    {42, 171},
    {16, 55},
    {0, 336},
    {5, 144},
    {54, 74},
    {54, 279},
    {58, 147},
    {21, 291},
    {16, 54},
    {54, 133},
    {1, 182},
    {54, 6},
    {47, 267},
    {57, 52},
    {34, 108},
    {8, 368},
    {20, 0},
    {7, 228},
    {22, 241},
    {7, 144},
    {19, 237},
    {17, 229},
    {38, 123},
    {14, 370},
    {54, 86},
    {20, 276},
    {12, 194},
    {5, 99},
    {22, 377},
    {58, 170},
    {14, 31},
    {2, 145},
    {12, 184},
    {54, 294},
    {2, 341},
    {29, 261},
    {15, 362},
    {46, 262},
    {28, 378},
    {44, 250},
    {6, 340},
    {0, 165},
    {21, 295},
    {37, 143},
    {32, 215},
    {25, 329},
    {53, 140},
    {28, 172},
    {23, 330},
    {34, 21},
    {24, 58},
    {48, 27},
    {20, 247},
    {58, 306},
    {19, 257},
    {10, 238},
    {26, 93},
    {7, 12},
    {24, 258},
    {60, 357},
    {49, 174},
    {16, 102},
    {30, 200},
    {19, 5},
    {14, 233},
    {4, 224},
    {1, 120},
    {2, 343},
    {37, 101},
    {3, 377},
    {47, 14},
    {56, 33},
    {20, 279},
    {55, 79},
    {21, 81},
    {28, 382},
    {9, 202},
    {36, 238},
    {53, 35},
    {37, 264},
    {25, 40},
    {12, 172},
    {34, 352},
    {13, 91},
    {35, 66},
    {41, 128},
    {16, 34},
    {21, 16},
    {13, 259},
    {49, 70},
    {31, 336},
    {18, 373},
    {7, 151},
    {40, 289},
    {59, 276},
    {29, 137},
    {31, 257},
    {48, 128},
    {41, 305},
    {44, 47},
    {22, 341},
    {30, 309},
    {39, 214},
    {50, 309},
    {4, 374},
    {17, 34},
    {8, 322},
    {4, 55},
    {53, 184},
    {26, 90},
    {25, 366},
    {28, 245},
    {39, 86},
    {36, 342},
    {13, 356},
    {46, 209},
    {14, 40},
    {29, 265},
    {4, 25},
    {2, 60},
    {1, 141},
    {8, 246},
    {24, 231},
    {51, 329},
    {5, 229},
    {23, 227},
    {36, 179},
    {2, 242},
    {31, 133},
    {32, 1},
    {29, 83},
    {19, 276},
    {27, 316},
    {20, 39},
    {19, 259},
    {17, 242},
    {30, 159},
    {45, 346},
    {23, 26},
    {13, 94},
    {2, 162},
    {0, 29},
    {38, 79},
    {42, 128},
    {19, 187},
    {57, 16},
    {9, 83},
    {58, 207},
    {54, 70},
    {17, 17},
    {49, 257},
    {32, 351},
    {1, 3},
    {13, 36},
    {15, 195},
    {4, 208},
    {1, 55},
    {53, 9},
    {9, 72},
    {7, 135},
    {33, 339},
    {7, 320},
    {51, 41},
    {53, 227},
    {10, 91},
    {34, 138},
    {20, 227},
    {30, 10},
    {31, 362},
    {4, 280},
    {16, 85},
    {35, 123},
    {22, 109},
    {58, 50},
    {49, 356},
    {4, 15},
    {19, 207},
    {44, 94},
    {36, 66},
    {13, 248},
    {28, 207},
    {23, 85},
    {40, 133},
    {18, 108},
    {35, 32},
    {57, 207},
    {35, 113},
    {50, 372},
    {38, 36},
    {0, 344},
    {17, 39},
    {2, 278},
    {3, 238},
    {56, 120},
    {48, 43},
    {58, 208},
    {32, 352},
    {53, 319},
    {47, 195},
    {56, 213},
    {23, 318},
    {25, 380},
    {0, 345},
    {34, 317},
    {45, 326},
    {39, 119},
    {11, 107},
    {36, 356},
    {37, 48},
    {42, 245},
    {44, 359},
    {36, 84},
    {11, 124},
    {56, 72},
    {18, 125},
    {8, 172},
    {7, 359},
    {57, 198},
    {18, 269},
    {19, 242},
    {4, 279},
    {59, 249},
    {26, 70},
    {10, 75},
    {13, 289},
    {55, 68},
    {5, 231},
    {18, 6},
    {8, 290},
    {11, 55},
    {42, 299},
    {1, 40},
    {48, 112},
    {13, 30},
    {60, 347},
    {30, 31},
    {11, 47},
    {36, 338},
    {18, 25},
    {28, 361},
    {56, 131},
    {48, 51},
    {46, 70},
    {42, 319},
    {0, 327},
    {59, 30},
    {60, 36},
    {37, 353},
    {46, 258},
    {39, 32},
    {50, 131},
    {36, 134},
    {49, 190},
    {60, 83},
    {33, 280},
    {30, 32},
    {46, 221},
    {23, 33},
    {12, 98},
    {33, 323},
    {25, 77},
    {25, 280},
    {4, 24},
    {48, 72},
    {46, 324},
    {50, 51},
    {41, 21},
    {1, 357},
    {44, 119},
    {52, 155},
    {30, 282},
    {39, 120},
    {40, 94},
    {23, 224},
    {36, 42},
    {46, 368},
    {43, 144},
    {11, 320},
    {44, 366},
    {0, 150},
    {9, 39},
    {51, 215},
    {42, 90},
    {11, 235},
    {52, 207},
    {45, 104},
    {49, 117},
    {44, 264},
    {45, 365},
    {41, 297},
    {41, 146},
    {0, 256},
    {1, 272},
    {40, 261},
    {0, 147},
    {31, 330},
    {41, 273},
    {56, 354},
    {43, 359},
    {33, 306},
    {14, 45},
    {5, 34},
    {2, 96},
    {8, 270},
    {45, 167},
    {28, 33},
    {8, 378},
    {49, 67},
    {60, 345},
    {14, 278},
    {31, 203},
    {35, 265},
    {58, 11},
    {60, 283},
    {5, 336},
    {35, 6},
    {3, 10},
    {48, 328},
    {33, 175},
    {60, 293},
    {35, 280},
    {60, 12},
    {59, 168},
    {43, 162},
    {39, 336},
    {59, 319},
    {29, 309},
    {58, 61},
    {39, 240},
    {29, 1},
    {11, 368},
    {6, 271},
    {38, 242},
    {5, 30},
    {50, 290},
    {26, 353},
    {7, 158},
    {5, 105},
    {60, 265},
    {22, 1},
    {4, 35},
    {35, 168},
    {14, 282},
    {1, 75},
    {41, 129},
    {58, 125},
    {31, 223},
    {39, 166},
    {37, 12},
    {60, 183},
    {12, 64},
    {45, 160},
    {6, 185},
    {8, 345},
    {24, 10},
    {1, 326},
    {31, 232},
    {35, 284},
    {3, 53},
    {10, 300},
    {27, 287},
    {25, 331},
    {24, 312},
    {2, 19},
    {53, 277},
    {52, 203},
    {14, 46},
    {44, 274},
    {58, 5},
    {38, 350},
    {1, 235},
    {1, 354},
    {0, 247},
    {33, 136},
    {34, 358},
    {57, 282},
    {57, 299},
    {26, 22},
    {32, 180},
    {31, 107},
    {12, 312},
    {57, 309},
    {29, 348},
    {9, 181},
    {0, 20},
    {32, 301},
    {54, 269},
    {21, 216},
    {54, 105},
    {35, 188},
    {33, 249},
    {5, 378},
    {4, 366},
    {10, 235},
    {23, 317},
    {47, 310},
    {40, 277},
    {16, 134},
    {12, 181},
    {13, 327},
    {0, 197},
    {1, 285},
    {1, 328},
    {57, 57},
    {0, 162},
    {0, 54},
    {2, 279},
    {35, 242},
    {34, 215},
    {15, 50},
    {14, 127},
    {6, 291},
    {58, 20},
    {22, 281},
    {26, 154},
    {53, 262},
    {21, 335},
    {55, 318},
    {1, 252},
    {48, 68},
    {25, 36},
    {2, 18},
    {32, 287},
    {12, 380},
    {29, 106},
    {21, 138},
    {0, 70},
    {7, 16},
    {7, 184},
    {7, 98},
    {59, 345},
    {53, 58},
    {49, 339},
    {0, 351},
    {51, 44},
    {10, 305},
    {2, 166},
    {17, 171},
    {15, 337},
    {1, 276},
    {29, 247},
    {24, 359},
    {57, 84},
    {31, 243},
    {57, 380},
    {55, 29},
    {14, 182},
    {5, 149},
    {60, 341},
    {37, 275},
    {33, 71},
    {59, 266},
    {45, 147},
    {24, 215},
    {1, 251},
    {25, 347},
    {13, 115},
    {21, 287},
    {45, 142},
    {54, 356},
    {2, 194},
    {36, 32},
    {0, 46},
    {1, 380},
    {1, 185},
    {35, 138},
    {14, 118},
    {38, 212},
    {35, 0},
    {17, 381},
    {24, 380},
    {39, 44},
    {21, 177},
    {48, 66},
    {47, 292},
    {1, 134},
    {25, 108},
    {21, 331},
    {53, 223},
    {45, 115},
    {13, 343},
    {7, 120},
    {23, 150},
    {51, 42},
    {2, 62},
    {26, 219},
    {21, 0},
    {38, 116},
    {5, 63},
    {32, 364},
    {33, 114},
    {11, 158},
    {40, 54},
    {21, 314},
    {33, 112},
    {20, 101},
    {49, 134},
    {6, 296},
    {26, 207},
    {2, 99},
    {36, 266},
    {2, 127},
    {59, 355},
    {53, 2},
    {23, 5},
    {22, 36},
    {33, 278},
    {47, 160},
    {8, 177},
    {8, 18},
    {0, 217},
    {53, 152},
    {14, 363},
    {36, 23},
    {51, 97},
    {12, 129},
    {32, 62},
    {24, 336},
    {49, 253},
    {48, 203},
    {16, 273},
    {5, 72},
    {43, 114},
    {53, 87},
    {24, 99},
    {2, 304},
    {35, 222},
    {7, 102},
    {30, 69},
    {11, 120},
    {55, 52},
    {35, 302},
    {60, 276},
    {12, 84},
    {23, 272},
    {18, 277},
    {55, 130},
    {26, 35},
    {26, 156},
    {55, 40},
    {36, 341},
    {29, 242},
    {26, 238},
    {16, 153},
    {1, 294},
    {23, 207},
    {6, 15},
    {55, 316},
    {53, 15},
    {8, 298},
    {13, 24},
    {8, 83},
    {60, 165},
    {0, 368},
    {21, 37},
    {2, 93},
    {25, 301},
    {36, 17},
    {4, 257},
    {2, 328},
    {0, 286},
    {18, 84},
    {39, 358},
    {26, 321},
    {21, 64},
    {19, 246},
    {14, 108},
    {32, 37},
    {24, 262},
    {26, 47},
    {8, 110},
    {49, 97},
    {17, 238},
    {54, 26},
    {41, 54},
    {36, 0},
    {57, 92},
    {48, 7},
    {57, 4},
    {31, 353},
    {17, 53},
    {26, 16},
    {13, 278},
    {7, 383},
    {5, 146},
    {33, 231},
    {20, 356},
    {2, 351},
    {23, 311},
    {47, 358},
    {14, 129},
    {33, 276},
    {16, 17},
    {24, 13},
    {54, 190},
    {43, 75},
    {39, 142},
    {39, 113},
    {54, 316},
    {24, 23},
    {27, 271},
    {55, 358},
    {2, 220},
    {12, 318},
    {20, 290},
    {45, 38},
    {19, 358},
    {57, 162},
    {18, 8},
    {1, 50},
    {33, 18},
    {28, 74},
    {53, 323},
    {2, 211},
    {37, 279},
    {3, 118},
    {57, 263},
    {7, 131},
    {33, 355},
    {29, 182},
    {57, 25},
    {32, 158},
    {31, 370},
    {16, 172},
    {56, 47},
    {22, 41},
    {30, 343},
    {24, 107},
    {27, 137},
    {17, 35},
    {45, 98},
    {35, 8},
    {55, 78},
    {48, 151},
    {25, 116},
    {33, 349},
    {14, 263},
    {21, 202},
    {43, 203},
    {59, 307},
    {3, 365},
    {33, 122},
    {53, 163},
    {32, 235},
    {30, 136},
    {58, 297},
    {14, 213},
    {30, 293},
    {16, 378},
    {17, 160},
    {3, 366},
    {41, 346},
    {46, 329},
    {49, 182},
    {44, 248},
    {39, 184},
    {14, 72},
    {55, 182},
    {22, 119},
    {21, 51},
    {55, 71},
    {19, 226},
    {9, 381},
    {24, 80},
    {20, 47},
    {35, 238},
    {43, 13},
    {57, 255},
    {27, 37},
    {38, 190},
    {51, 91},
    {21, 277},
    {57, 298},
    {33, 288},
    {22, 344},
    {23, 262},
    {58, 331},
    {37, 188},
    {29, 10},
    {38, 355},
    {37, 322},
    {1, 11},
    {21, 227},
    {42, 229},
    {48, 154},
    {53, 125},
    {33, 79},
    {7, 366},
    {19, 228},
    {19, 46},
    {12, 299},
    {44, 142},
    {32, 333},
    {25, 209},
    {3, 233},
    {19, 201},
    {35, 352},
    {34, 112},
    {32, 213},
    {34, 90},
    {16, 105},
    {34, 164},
    {2, 121},
    {22, 170},
    {17, 27},
    {13, 81},
    {37, 185},
    {32, 25},
    {24, 277},
    {35, 101},
    {14, 148},
    {6, 124},
    {1, 196},
    {3, 364},
    {16, 97},
    {48, 281},
    {35, 336},
    {18, 79},
    {29, 259},
    {32, 340},
    {17, 335},
    {38, 194},
    {7, 212},
    {29, 244},
    {14, 359},
    {44, 380},
    {35, 50},
    {53, 354},
    {53, 62},
    {1, 243},
    {53, 287},
    {21, 188},
    {15, 277},
    {13, 41},
    {55, 235},
    {50, 170},
    {5, 103},
    {5, 255},
    {0, 322},
    {59, 100},
    {1, 130},
    {35, 171},
    {7, 337},
    {56, 98},
    {2, 41},
    {53, 226},
    {58, 178},
    {20, 371},
    {9, 133},
    {40, 362},
    {44, 154},
    {38, 225},
    {56, 50},
    {24, 364},
    {56, 175},
    {60, 343},
    {14, 73},
    {15, 261},
    {5, 209},
    {27, 339},
    {21, 194},
    {4, 134},
    {10, 263},
    {17, 123},
    {13, 172},
    {57, 17},
    {19, 14},
    {59, 205},
    {58, 268},
    {60, 305},
    {35, 140},
    {9, 49},
    {60, 238},
    {33, 188},
    {32, 335},
    {1, 110},
    {55, 303},
    {55, 247},
    {6, 64},
    {7, 84},
    {57, 118},
    {18, 13},
    {11, 96},
    {29, 90},
    {57, 40},
    {32, 102},
    {47, 67},
    {1, 103},
    {16, 21},
    {14, 373},
    {49, 365},
    {13, 369},
    {5, 92},
    {31, 261},
    {49, 358},
    {59, 36},
    {5, 152},
    {28, 250},
    {11, 126},
    {58, 348},
    {1, 41},
    {26, 54},
    {26, 66},
    {41, 372},
    {45, 263},
    {40, 46},
    {60, 349},
    {32, 366},
    {52, 191},
    {1, 82},
    {32, 150},
    {14, 157},
    {33, 123},
    {0, 302},
    {15, 204},
    {43, 293},
    {57, 277},
    {58, 226},
    {8, 195},
    {8, 224},
    {32, 157},
    {9, 51},
    {0, 81},
    {8, 306},
    {49, 311},
    {35, 133},
    {2, 105},
    {28, 317},
    {8, 364},
    {60, 149},
    {51, 214},
    {58, 333},
    {51, 212},
    {14, 120},
    {25, 370},
    {59, 292},
    {38, 38},
    {24, 354},
    {12, 18},
    {8, 92},
    {32, 124},
    {7, 258},
    {8, 365},
    {50, 311},
    {33, 0},
    {53, 320},
    {25, 321},
    {14, 306},
    {21, 6},
    {47, 135},
    {27, 270},
    {58, 148},
    {39, 31},
    {26, 69},
    {57, 268},
    {18, 212},
    {31, 81},
    {3, 80},
    {3, 42},
    {57, 234},
    {11, 67},
    {32, 227},
    {31, 173},
    {42, 172},
    {48, 49},
    {46, 25},
    {30, 321},
    {6, 150},
    {59, 304},
    {24, 126},
    {35, 126},
    {29, 80},
    {30, 124},
    {38, 345},
    {3, 8},
    {36, 199},
    {50, 189},
    {14, 15},
    {17, 51},
    {7, 87},
    {21, 145},
    {48, 273},
    {2, 212},
    {57, 85},
    {55, 58},
    {50, 379},
    {37, 127},
    {39, 290},
    {44, 5},
    {39, 193},
    {47, 374},
    {58, 52},
    {55, 243},
    {56, 2},
    {43, 31},
    {3, 56},
    {59, 311},
    {56, 331},
    {7, 187},
    {30, 75},
    {30, 64},
    {31, 2},
    {13, 295},
    {23, 349},
    {56, 150},
    {33, 238},
    {8, 166},
    {53, 380},
    {30, 74},
    {10, 357},
    {56, 231},
    {8, 276},
    {28, 273},
    {46, 306},
    {49, 220},
    {39, 152},
    {29, 272},
    {12, 304},
    {3, 167},
    {55, 257},
    {28, 90},
    {38, 144},
    {18, 61},
    {13, 131},
    {42, 274},
    {56, 191},
    {41, 383},
    {31, 150},
    {48, 216},
    {39, 36},
    {56, 304},
    {21, 190},
    {58, 343},
    {52, 41},
    {39, 374},
    {19, 335},
    {25, 224},
    {12, 247},
    {0, 44},
    {56, 319},
    {23, 244},
    {10, 41},
    {39, 301},
    {27, 72},
    {51, 338},
    {44, 131},
    {54, 108},
    {17, 6},
    {2, 110},
    {50, 249},
    {35, 92},
    {35, 159},
    {55, 354},
    {9, 3},
    {38, 331},
    {52, 84},
    {51, 130},
    {3, 345},
    {53, 344},
    {9, 356},
    {46, 40},
    {52, 292},
    {8, 120},
    {7, 138},
    {33, 88},
    {7, 189},
    {11, 136},
    {45, 236},
    {32, 87},
    {8, 383},
    {60, 266},
    {28, 44},
    {18, 111},
    {9, 367},
    {30, 303},
    {28, 95},
    {37, 37},
    {56, 204},
    {50, 0},
    {60, 189},
    {11, 298},
    {53, 309},
    {39, 116},
    {59, 285},
    {39, 229},
    {8, 176},
    {39, 230},
    {49, 86},
    {37, 284},
    {11, 299},
    {29, 139},
    {37, 124},
    {29, 22},
    {18, 355},
    {48, 344},
    {1, 9},
    {46, 319},
    {4, 105},
    {32, 307},
    {9, 317},
    {39, 154},
    {37, 257},
    {1, 30},
    {10, 296},
    {44, 269},
    {50, 127},
    {1, 1},
    {13, 171},
    {51, 83},
    {60, 342},
    {10, 269},
    {55, 238},
    {45, 127},
    {25, 152},
    {4, 174},
    {35, 47},
    {52, 166},
    {39, 8},
    {0, 138},
    {11, 86},
    {51, 52},
    {44, 301},
    {44, 329},
    {43, 254},
    {46, 87},
    {11, 342},
    {51, 271},
    {41, 311},
    {2, 230},
    {29, 19},
    {46, 41},
    {52, 168},
    {45, 0},
    {25, 162},
    {30, 299},
    {51, 39},
    {45, 108},
    {52, 360},
    {9, 215},
    {50, 114},
    {2, 248},
    {44, 56},
    {40, 44},
    {44, 305},
    {44, 173},
    {0, 312},
    {44, 4},
    {38, 272},
    {40, 215},
    {52, 116},
    {41, 56},
    {42, 123},
    {40, 284},
    {42, 200},
    {41, 283},
    {50, 322},
    {41, 270},
    {41, 255},
    {41, 344},
    {48, 120},
    {56, 329},
    {60, 292},
    {33, 227},
    {4, 125},
    {0, 89},
    {35, 310},
    {1, 376},
    {4, 274},
    {10, 20},
    {55, 343},
    {0, 103},
    {50, 284},
    {51, 1},
    {31, 300},
    {10, 356},
    {59, 182},
    {35, 325},
    {30, 250},
    {25, 3},
    {3, 273},
    {0, 126},
    {3, 259},
    {7, 328},
    {11, 347},
    {46, 115},
    {59, 371},
    {4, 126},
    {23, 161},
    {2, 58},
    {0, 202},
    {33, 345},
    {7, 301},
    {53, 255},
    {23, 362},
    {1, 352},
    {57, 120},
    {23, 200},
    {55, 189},
    {33, 352},
    {23, 52},
    {49, 380},
    {60, 200},
    {23, 129},
    {16, 230},
    {4, 330},
    {12, 55},
    {7, 52},
    {0, 263},
    {45, 252},
    {58, 146},
    {6, 235},
    {48, 319},
    {55, 42},
    {60, 302},
    {3, 189},
    {6, 338},
    {49, 332},
    {0, 195},
    {59, 153},
    {14, 216},
    {33, 49},
    {43, 227},
    {53, 156},
    {1, 79},
    {51, 296},
    {35, 208},
    {6, 84},
    {53, 248},
    {4, 312},
    {12, 88},
    {51, 90},
    {47, 227},
    {35, 61},
    {7, 53},
    {3, 204},
    {1, 381},
    {0, 357},
    {25, 345},
    {60, 244},
    {8, 133},
    {34, 361},
    {59, 129},
    {47, 189},
    {1, 187},
    {43, 294},
    {29, 284},
    {34, 26},
    {35, 135},
    {8, 48},
    {10, 338},
    {4, 74},
    {38, 216},
    {0, 153},
    {1, 126},
    {12, 169},
    {36, 344},
    {35, 216},
    {0, 209},
    {37, 135},
    {33, 116},
    {0, 111},
    {33, 13},
    {9, 94},
    {59, 365},
    {37, 256},
    {33, 166},
    {8, 105},
    {0, 341},
    {36, 256},
    {2, 253},
    {56, 108},
    {52, 55},
    {46, 19},
    {0, 25},
    {23, 32},
    {23, 137},
    {3, 123},
    {35, 98},
    {40, 141},
    {4, 1},
    {0, 174},
    {35, 259},
    {3, 249},
    {26, 319},
    {0, 192},
    {5, 187},
    {30, 53},
    {7, 137},
    {33, 225},
    {43, 170},
    {7, 10},
    {0, 17},
    {35, 19},
    {3, 343},
    {51, 282},
    {60, 31},
    {33, 292},
    {43, 370},
    {25, 238},
    {35, 127},
    {0, 324},
    {60, 65},
    {58, 368},
    {5, 315},
    {23, 25},
    {0, 83},
    {59, 326},
    {54, 123},
    {53, 257},
    {23, 139},
    {56, 87},
    {0, 279},
    {0, 300},
    {6, 69},
    {0, 84},
    {0, 361},
    {60, 224},
    {2, 213},
    {52, 201},
    {55, 47},
    {3, 14},
    {60, 33},
    {43, 286},
    {2, 334},
    {58, 33},
    {32, 253},
    {24, 145},
    {29, 178},
    {7, 211},
    {2, 372},
    {39, 283},
    {4, 140},
    {25, 339},
    {0, 77},
    {31, 213},
    {0, 350},
    {31, 93},
    {59, 218},
    {3, 340},
    {58, 75},
    {22, 126},
    {31, 287},
    {22, 234},
    {57, 108},
    {11, 135},
    {34, 208},
    {60, 5},
    {59, 179},
    {25, 154},
    {56, 336},
    {0, 65},
    {15, 354},
    {8, 206},
    {60, 193},
    {1, 361},
    {0, 292},
    {2, 258},
    {25, 45},
    {2, 295},
    {4, 97},
    {12, 293},
    {48, 221},
    {55, 84},
    {6, 217},
    {0, 222},
    {57, 208},
    {33, 185},
    {0, 314},
    {4, 31},
    {3, 289},
    {56, 148},
    {0, 67},
    {59, 49},
    {49, 96},
    {2, 4},
    {3, 344},
    {12, 281},
    {1, 203},
    {7, 242},
    {1, 342},
    {1, 212},
    {57, 286},
    {32, 35},
    {2, 219},
    {35, 5},
    {1, 133},
    {33, 184},
    {29, 201},
    {52, 67},
    {12, 209},
    {0, 187},
    {0, 358},
    {35, 251},
    {53, 173},
    {0, 225},
    {1, 266},
    {2, 0},
    {59, 89},
    {54, 51},
    {25, 118},
    {8, 149},
    {23, 329},
    {57, 364},
    {33, 56},
    {35, 272},
    {2, 252},
    {58, 341},
    {25, 291},
    {2, 289},
    {59, 130},
    {36, 216},
    {37, 147},
    {35, 278},
    {11, 71},
    {39, 245},
    {0, 253},
    {33, 119},
    {26, 362},
    {57, 316},
    {29, 140},
    {6, 360},
    {2, 65},
    {7, 168},
    {52, 71},
    {41, 194},
    {7, 146},
    {51, 172},
    {16, 164},
    {1, 208},
    {57, 272},
    {4, 299},
    {7, 191},
    {58, 285},
    {60, 142},
    {19, 176},
    {0, 383},
    {33, 97},
    {53, 220},
    {0, 321},
    {1, 13},
    {36, 163},
    {60, 245},
    {44, 320},
    {4, 271},
    {37, 357},
    {2, 363},
    {54, 148},
    {19, 247},
    {2, 348},
    {24, 304},
    {2, 139},
    {35, 169},
    {12, 12},
    {23, 18},
    {31, 106},
    {59, 336},
    {53, 273},
    {23, 189},
    {32, 73},
    {2, 298},
    {7, 222},
    {44, 147},
    {26, 364},
    {34, 191},
    {1, 234},
    {1, 155},
    {0, 190},
    {18, 170},
    {14, 214},
    {10, 22},
    {60, 320},
    {20, 297},
    {7, 234},
    {29, 143},
    {55, 355},
    {17, 370},
    {3, 211},
    {10, 376},
    {31, 288},
    {14, 140},
    {50, 133},
    {1, 250},
    {40, 221},
    {16, 25},
    {10, 81},
    {1, 256},
    {25, 70},
    {47, 84},
    {26, 370},
    {3, 152},
    {25, 185},
    {41, 233},
    {32, 241},
    {60, 80},
    {18, 40},
    {2, 205},
    {59, 300},
    {18, 323},
    {0, 13},
    {2, 67},
    {33, 380},
    {11, 69},
    {1, 284},
    {11, 52},
    {21, 109},
    {29, 13},
    {26, 168},
    {2, 137},
    {1, 189},
    {38, 276},
    {7, 330},
    {2, 9},
    {27, 114},
    {2, 97},
    {6, 225},
    {5, 308},
    {12, 235},
    {17, 302},
    {12, 118},
    {23, 302},
    {20, 314},
    {1, 244},
    {21, 127},
    {2, 182},
    {49, 353},
    {1, 137},
    {1, 347},
    {39, 324},
    {0, 379},
    {0, 106},
    {1, 67},
    {51, 361},
    {45, 311},
    {59, 101},
    {53, 280},
    {49, 179},
    {39, 235},
    {1, 348},
    {0, 371},
    {16, 336},
    {0, 278},
    {49, 124},
    {57, 184},
    {2, 125},
    {51, 61},
    {20, 154},
    {2, 369},
    {57, 194},
    {2, 126},
    {6, 207},
    {22, 12},
    {57, 226},
    {19, 214},
    {57, 47},
    {43, 327},
    {60, 18},
    {2, 383},
    {58, 258},
    {26, 358},
    {1, 123},
    {35, 170},
    {59, 213},
    {23, 236},
    {5, 237},
    {55, 270},
    {14, 316},
    {26, 227},
    {45, 292},
    {22, 182},
    {10, 377},
    {2, 122},
    {4, 378},
    {33, 219},
    {1, 125},
    {2, 195},
    {29, 211},
    {22, 25},
    {12, 282},
    {3, 320},
    {43, 136},
    {2, 151},
    {3, 111},
    {1, 205},
    {7, 307},
    {2, 203},
    {51, 96},
    {43, 105},
    {40, 375},
    {5, 184},
    {1, 165},
    {5, 379},
    {37, 382},
    {2, 22},
    {24, 169},
    {3, 371},
    {0, 134},
    {1, 154},
    {19, 129},
    {2, 360},
    {59, 243},
    {58, 344},
    {43, 201},
    {1, 273},
    {58, 230},
    {1, 274},
    {1, 28},
    {41, 210},
    {53, 33},
    {1, 378},
    {59, 238},
    {23, 260},
    {36, 173},
    {44, 346},
    {57, 224},
    {49, 308},
    {1, 277},
    {33, 169},
    {1, 88},
    {35, 192},
    {7, 246},
    {29, 315},
    {17, 259},
    {3, 308},
    {57, 300},
    {34, 27},
    {35, 65},
    {2, 251},
    {43, 119},
    {38, 255},
    {24, 373},
    {2, 240},
    {1, 217},
    {2, 138},
    {29, 217},
    {59, 90},
    {2, 192},
    {19, 326},
    {1, 198},
    {1, 98},
    {54, 371},
    {4, 7},
    {52, 200},
    {15, 146},
    {0, 12},
    {50, 301},
    {1, 370},
    {24, 222},
    {2, 26},
    {23, 356},
    {31, 122},
    {5, 124},
    {28, 100},
    {23, 162},
    {44, 161},
    {19, 36},
    {22, 337},
    {28, 64},
    {44, 46},
    {45, 212},
    {2, 321},
    {2, 100},
    {1, 74},
    {54, 120},
    {26, 264},
    {2, 196},
    {3, 294},
    {2, 141},
    {5, 109},
    {31, 39},
    {53, 259},
    {30, 375},
    {0, 261},
    {12, 301},
    {1, 0},
    {26, 81},
    {2, 286},
    {25, 357},
    {1, 280},
    {36, 188},
    {0, 180},
    {15, 79},
    {2, 157},
    {47, 149},
    {38, 69},
    {53, 31},
    {53, 193},
    {57, 83},
    {27, 182},
    {55, 317},
    {43, 5},
    {2, 367},
    {48, 370},
    {35, 274},
    {59, 289},
    {43, 24},
    {58, 203},
    {8, 314},
    {0, 266},
    {47, 40},
    {19, 294},
    {49, 176},
    {60, 370},
    {5, 226},
    {2, 94},
    {20, 319},
    {28, 234},
    {5, 178},
    {0, 248},
    {55, 221},
    {53, 169},
    {10, 184},
    {24, 134},
    {19, 180},
    {5, 35},
    {24, 267},
    {34, 266},
    {30, 139},
    {33, 229},
    {33, 241},
    {55, 116},
    {24, 328},
    {23, 298},
    {54, 143},
    {3, 4},
    {44, 30},
    {2, 1},
    {7, 161},
    {1, 142},
    {0, 214},
    {2, 354},
    {26, 345},
    {4, 131},
    {56, 1},
    {29, 192},
    {51, 186},
    {0, 57},
    {13, 98},
    {23, 186},
    {6, 8},
    {5, 338},
    {19, 287},
    {2, 144},
    {3, 43},
    {59, 96},
    {17, 172},
    {3, 113},
    {44, 190},
    {52, 298},
    {2, 357},
    {4, 311},
    {37, 202},
    {2, 20},
    {17, 157},
    {32, 339},
    {57, 46},
    {22, 72},
    {10, 284},
    {2, 95},
    {9, 129},
    {31, 225},
    {40, 325},
    {4, 354},
    {43, 1},
    {17, 92},
    {50, 319},
    {16, 338},
    {59, 32},
    {24, 77},
    {1, 306},
    {34, 42},
    {16, 108},
    {43, 55},
    {33, 298},
    {3, 171},
    {25, 234},
    {49, 383},
    {6, 267},
    {27, 9},
    {27, 366},
    {35, 27},
    {9, 292},
    {49, 305},
    {31, 260},
    {2, 325},
    {33, 60},
    {54, 365},
    {13, 245},
    {58, 303},
    {25, 68},
    {5, 93},
    {2, 353},
    {32, 259},
    {1, 331},
    {2, 76},
    {58, 310},
    {35, 379},
    {40, 275},
    {2, 256},
    {21, 322},
    {1, 121},
    {8, 349},
    {34, 333},
    {46, 333},
    {43, 358},
    {26, 262},
    {32, 177},
    {59, 185},
    {20, 140},
    {53, 376},
    {13, 231},
    {3, 194},
    {29, 205},
    {18, 261},
    {53, 358},
    {21, 208},
    {29, 179},
    {51, 370},
    {19, 24},
    {8, 6},
    {31, 75},
    {6, 330},
    {37, 177},
    {60, 379},
    {19, 150},
    {42, 374},
    {2, 42},
    {36, 104},
    {35, 29},
    {15, 126},
    {8, 379},
    {3, 151},
    {56, 129},
    {58, 316},
    {7, 32},
    {37, 38},
    {24, 32},
    {46, 322},
    {19, 125},
    {3, 129},
    {33, 211},
    {25, 346},
    {45, 364},
    {28, 160},
    {2, 198},
    {55, 201},
    {7, 207},
    {2, 377},
    {8, 32},
    {30, 98},
    {3, 181},
    {22, 313},
    {57, 337},
    {3, 62},
    {27, 16},
    {7, 244},
    {21, 260},
    {17, 140},
    {54, 237},
    {48, 246},
    {60, 99},
    {54, 50},
    {2, 133},
    {11, 27},
    {29, 186},
    {54, 80},
    {3, 88},
    {19, 110},
    {58, 69},
    {29, 97},
    {53, 346},
    {6, 244},
    {35, 116},
    {55, 122},
    {12, 345},
    {14, 190},
    {14, 337},
    {24, 348},
    {59, 175},
    {0, 235},
    {16, 191},
    {20, 341},
    {6, 304},
    {16, 302},
    {43, 81},
    {26, 65},
    {25, 287},
    {12, 313},
    {57, 144},
    {2, 368},
    {27, 85},
    {15, 96},
    {19, 348},
    {58, 101},
    {33, 113},
    {53, 170},
    {1, 248},
    {15, 194},
    {48, 4},
    {15, 121},
    {56, 16},
    {3, 90},
    {43, 263},
    {43, 29},
    {19, 272},
    {33, 307},
    {57, 21},
    {13, 22},
    {18, 371},
    {11, 366},
    {54, 24},
    {54, 352},
    {26, 157},
    {55, 36},
    {57, 274},
    {31, 137},
    {35, 244},
    {1, 138},
    {48, 75},
    {59, 330},
    {17, 161},
    {15, 19},
    {38, 321},
    {21, 62},
    {48, 23},
    {15, 255},
    {47, 39},
    {51, 263},
    {15, 191},
    {48, 111},
    {30, 297},
    {51, 265},
    {54, 91},
    {29, 73},
    {1, 87},
    {20, 232},
    {7, 152},
    {57, 1},
    {1, 2},
    {10, 362},
    {32, 71},
    {25, 210},
    {10, 371},
    {19, 172},
    {23, 10},
    {40, 264},
    {58, 54},
    {1, 145},
    {24, 266},
    {58, 274},
    {53, 294},
    {28, 327},
    {56, 299},
    {31, 88},
    {36, 300},
    {59, 102},
    {44, 237},
    {0, 380},
    {53, 145},
    {24, 269},
    {59, 270},
    {15, 80},
    {38, 197},
    {59, 60},
    {47, 122},
    {6, 283},
    {46, 303},
    {36, 44},
    {0, 173},
    {35, 323},
    {11, 340},
    {57, 45},
    {42, 316},
    {5, 334},
    {18, 105},
    {29, 99},
    {1, 291},
    {19, 148},
    {24, 342},
    {28, 324},
    {15, 119},
    {30, 134},
    {15, 325},
    {11, 246},
    {14, 65},
    {4, 147},
    {54, 283},
    {31, 183},
    {56, 322},
    {49, 287},
    {38, 145},
    {19, 239},
    {7, 236},
    {1, 171},
    {29, 345},
    {24, 34},
    {5, 128},
    {13, 45},
    {21, 381},
    {5, 7},
    {60, 84},
    {16, 86},
    {19, 9},
    {21, 289},
    {2, 43},
    {8, 28},
    {12, 306},
    {16, 137},
    {31, 109},
    {15, 160},
    {29, 189},
    {21, 149},
    {29, 305},
    {15, 66},
    {53, 332},
    {32, 229},
    {50, 380},
    {37, 252},
    {25, 242},
    {32, 165},
    {10, 60},
    {8, 82},
    {42, 89},
    {8, 116},
    {11, 270},
    {33, 170},
    {18, 274},
    {54, 98},
    {60, 169},
    {16, 117},
    {46, 348},
    {27, 238},
    {2, 232},
    {53, 217},
    {45, 66},
    {13, 286},
    {5, 101},
    {56, 373},
    {43, 43},
    {57, 11},
    {58, 68},
    {33, 193},
    {28, 274},
    {15, 324},
    {33, 374},
    {51, 352},
    {4, 60},
    {38, 107},
    {45, 373},
    {3, 81},
    {35, 79},
    {14, 268},
    {42, 295},
    {23, 334},
    {36, 254},
    {50, 68},
    {49, 187},
    {5, 287},
    {18, 283},
    {32, 219},
    {3, 342},
    {49, 139},
    {59, 63},
    {22, 237},
    {4, 238},
    {34, 88},
    {7, 225},
    {58, 169},
    {13, 189},
    {18, 326},
    {34, 271},
    {20, 8},
    {11, 354},
    {12, 289},
    {8, 3},
    {48, 3},
    {51, 116},
    {14, 377},
    {35, 74},
    {60, 77},
    {1, 169},
    {50, 364},
    {15, 257},
    {28, 51},
    {10, 280},
    {13, 8},
    {18, 378},
    {12, 23},
    {55, 97},
    {46, 173},
    {13, 209},
    {33, 177},
    {32, 354},
    {48, 259},
    {59, 372},
    {46, 205},
    {43, 314},
    {35, 304},
    {2, 109},
    {14, 368},
    {51, 371},
    {14, 10},
    {16, 0},
    {54, 197},
    {39, 157},
    {21, 20},
    {18, 12},
    {35, 296},
    {6, 194},
    {55, 46},
    {0, 156},
    {54, 76},
    {54, 263},
    {46, 31},
    {36, 148},
    {30, 351},
    {18, 110},
    {39, 341},
    {39, 295},
    {40, 9},
    {9, 71},
    {44, 136},
    {7, 288},
    {18, 367},
    {29, 35},
    {30, 2},
    {51, 145},
    {57, 288},
    {7, 181},
    {25, 361},
    {2, 361},
    {39, 244},
    {28, 253},
    {35, 240},
    {18, 341},
    {11, 77},
    {9, 257},
    {19, 171},
    {6, 93},
    {52, 173},
    {26, 144},
    {45, 268},
    {19, 101},
    {1, 353},
    {37, 95},
    {29, 258},
    {8, 200},
    {55, 252},
    {60, 78},
    {11, 138},
    {25, 229},
    {44, 160},
    {4, 346},
    {27, 127},
    {4, 109},
    {0, 26},
    {18, 38},
    {0, 307},
    {7, 233},
    {60, 273},
    {6, 372},
    {33, 174},
    {10, 189},
    {10, 109},
    {8, 190},
    {60, 323},
    {2, 45},
    {37, 69},
    {32, 304},
    {52, 195},
    {44, 300},
    {52, 313},
    {54, 117},
    {43, 226},
    {36, 176},
    {8, 182},
    {32, 341},
    {1, 269},
    {10, 140},
    {3, 19},
    {37, 183},
    {7, 105},
    {13, 270},
    {50, 156},
    {52, 332},
    {17, 279},
    {21, 321},
    {29, 362},
    {6, 288},
    {3, 315},
    {12, 218},
    {23, 258},
    {17, 189},
    {14, 235},
    {11, 222},
    {29, 36},
    {49, 221},
    {23, 342},
    {15, 262},
    {31, 29},
    {39, 76},
    {21, 112},
    {45, 41},
    {4, 217},
    {5, 293},
    {23, 229},
    {48, 242},
    {33, 316},
    {25, 352},
    {9, 312},
    {31, 312},
    {38, 195},
    {30, 14},
    {60, 139},
    {33, 196},
    {35, 367},
    {1, 14},
    {57, 41},
    {45, 118},
    {55, 340},
    {45, 110},
    {53, 200},
    {21, 151},
    {14, 74},
    {10, 46},
    {38, 375},
    {38, 286},
    {12, 248},
    {10, 337},
    {5, 81},
    {33, 179},
    {41, 314},
    {11, 176},
    {30, 312},
    {6, 86},
    {53, 174},
    {32, 143},
    {11, 74},
    {6, 87},
    {53, 203},
    {21, 220},
    {8, 77},
    {5, 148},
    {51, 200},
    {10, 241},
    {58, 176},
    {6, 141},
    {29, 134},
    {42, 382},
    {29, 306},
    {21, 255},
    {3, 263},
    {13, 133},
    {29, 190},
    {30, 327},
    {60, 337},
    {36, 311},
    {0, 129},
    {4, 329},
    {59, 323},
    {31, 124},
    {1, 23},
    {46, 249},
    {33, 224},
    {32, 38},
    {49, 93},
    {57, 365},
    {11, 237},
    {57, 44},
    {35, 161},
    {18, 68},
    {35, 324},
    {11, 330},
    {13, 281},
    {4, 336},
    {60, 166},
    {52, 377},
    {18, 204},
    {39, 35},
    {24, 223},
    {18, 92},
    {48, 315},
    {38, 332},
    {55, 171},
    {54, 8},
    {6, 13},
    {40, 296},
    {51, 115},
    {57, 90},
    {19, 307},
    {6, 329},
    {43, 80},
    {4, 239},
    {6, 353},
    {13, 318},
    {59, 172},
    {14, 221},
    {51, 184},
    {24, 273},
    {49, 204},
    {33, 265},
    {60, 82},
    {56, 64},
    {45, 20},
    {0, 193},
    {59, 297},
    {49, 85},
    {46, 290},
    {56, 297},
    {6, 106},
    {43, 287},
    {53, 168},
    {0, 246},
    {29, 332},
    {5, 335},
    {3, 327},
    {10, 328},
    {4, 250},
    {2, 342},
    {30, 143},
    {18, 350},
    {45, 154},
    {31, 299},
    {3, 83},
    {7, 253},
    {5, 194},
    {6, 332},
    {11, 297},
    {14, 60},
    {58, 324},
    {7, 227},
    {11, 160},
    {58, 291},
    {50, 352},
    {8, 57},
    {8, 239},
    {44, 280},
    {3, 304},
    {57, 220},
    {13, 5},
    {31, 208},
    {52, 17},
    {58, 18},
    {9, 64},
    {43, 12},
    {6, 103},
    {24, 224},
    {13, 253},
    {9, 52},
    {11, 29},
    {17, 319},
    {25, 35},
    {45, 207},
    {38, 203},
    {14, 57},
    {30, 129},
    {35, 160},
    {37, 224},
    {56, 97},
    {19, 191},
    {42, 10},
    {56, 236},
    {5, 24},
    {42, 215},
    {39, 34},
    {4, 0},
    {45, 50},
    {43, 340},
    {46, 383},
    {8, 208},
    {26, 172},
    {14, 204},
    {60, 359},
    {17, 95},
    {10, 225},
    {5, 25},
    {18, 264},
    {51, 337},
    {31, 381},
    {50, 109},
    {10, 341},
    {28, 214},
    {38, 193},
    {54, 217},
    {10, 181},
    {36, 224},
    {47, 377},
    {30, 50},
    {54, 34},
    {6, 22},
    {35, 270},
    {4, 69},
    {8, 266},
    {45, 322},
    {39, 100},
    {52, 126},
    {51, 62},
    {34, 370},
    {52, 327},
    {49, 302},
    {4, 303},
    {51, 223},
    {29, 352},
    {33, 68},
    {13, 17},
    {7, 345},
    {45, 319},
    {46, 238},
    {0, 211},
    {59, 114},
    {45, 39},
    {6, 343},
    {10, 97},
    {4, 98},
    {6, 118},
    {38, 277},
    {51, 28},
    {28, 78},
    {49, 354},
    {31, 215},
    {24, 334},
    {25, 356},
    {49, 38},
    {58, 351},
    {25, 254},
    {45, 227},
    {9, 18},
    {34, 180},
    {35, 163},
    {40, 365},
    {6, 365},
    {53, 367},
    {10, 6},
    {0, 159},
    {5, 352},
    {28, 236},
    {29, 114},
    {46, 57},
    {4, 255},
    {30, 311},
    {60, 134},
    {59, 93},
    {6, 191},
    {20, 196},
    {60, 236},
    {56, 369},
    {43, 382},
    {11, 261},
    {50, 59},
    {9, 16},
    {23, 103},
    {9, 316},
    {6, 263},
    {9, 159},
    {46, 375},
    {35, 254},
    {50, 208},
    {7, 245},
    {57, 332},
    {43, 20},
    {40, 107},
    {10, 112},
    {41, 371},
    {60, 70},
    {8, 374},
    {0, 4},
    {37, 289},
    {37, 88},
    {50, 361},
    {52, 359},
    {17, 347},
    {14, 102},
    {59, 376},
    {41, 144},
    {42, 137},
    {11, 319},
    {25, 231},
    {32, 193},
    {1, 246},
    {43, 357},
    {23, 23},
    {60, 309},
    {11, 304},
    {58, 31},
    {35, 289},
    {47, 11},
    {11, 151},
    {48, 191},
    {42, 279},
    {52, 13},
    {45, 362},
    {9, 172},
    {48, 167},
    {50, 118},
    {38, 278},
    {49, 109},
    {44, 43},
    {49, 40},
    {38, 78},
    {27, 153},
    {4, 197},
    {33, 35},
    {4, 61},
    {46, 85},
    {31, 56},
    {8, 60},
    {39, 55},
    {45, 332},
    {23, 187},
    {38, 106},
    {49, 267},
    {47, 372},
    {45, 308},
    {26, 67},
    {32, 250},
    {44, 127},
    {43, 147},
    {10, 24},
    {45, 355},
    {50, 88},
    {50, 258},
    {31, 224},
    {45, 233},
    {1, 163},
    {0, 69},
    {41, 138},
    {44, 292},
    {44, 82},
    {45, 173},
    {59, 14},
    {9, 294},
    {38, 299},
    {48, 73},
    {0, 169},
    {0, 177},
    {25, 61},
    {44, 171},
    {41, 313},
    {42, 308},
    {60, 270},
    {56, 32},
    {46, 110},
    {60, 1},
    {40, 231},
    {38, 202},
    {33, 167},
    {0, 155},
    {49, 28},
    {43, 57},
    {41, 258},
    {56, 58},
    {59, 35},
    {47, 108},
    {44, 336},
    {45, 48},
    {31, 371},
    {42, 265},
    {47, 301},
    {25, 135},
    {52, 339},
    {44, 265},
    {46, 95},
    {40, 13},
    {0, 112},
    {40, 114},
    {2, 259},
    {48, 17},
    {4, 260},
    {1, 17},
    {7, 248},
    {0, 105},
    {55, 339},
    {49, 145},
    {3, 361},
    {47, 68},
    {47, 72},
    {8, 113},
    {44, 99},
    {45, 284},
    {0, 328},
    {12, 356},
    {12, 242},
    {60, 160},
    {23, 13},
    {7, 165},
    {0, 269},
    {53, 76},
    {10, 220},
    {51, 198},
    {3, 239},
    {60, 176},
    {7, 339},
    {7, 305},
    {48, 157},
    {59, 171},
    {8, 85},
    {1, 242},
    {58, 26},
    {4, 223},
    {12, 285},
    {11, 161},
    {1, 193},
    {23, 118},
    {11, 198},
    {7, 322},
    {29, 79},
    {8, 356},
    {55, 218},
    {55, 119},
    {0, 224},
    {44, 158},
    {35, 263},
    {1, 197},
    {59, 67},
    {27, 4},
    {49, 163},
    {53, 188},
    {38, 141},
    {4, 193},
    {4, 348},
    {35, 81},
    {50, 378},
    {1, 369},
    {57, 311},
    {0, 212},
    {35, 176},
    {2, 233},
    {60, 332},
    {38, 297},
    {29, 324},
    {35, 344},
    {39, 225},
    {35, 187},
    {8, 78},
    {57, 356},
    {59, 247},
    {59, 28},
    {0, 154},
    {43, 64},
    {9, 93},
    {40, 67},
    {1, 78},
    {1, 157},
    {23, 40},
    {35, 17},
    {47, 123},
    {3, 274},
    {0, 373},
    {41, 70},
    {57, 78},
    {1, 72},
    {4, 40},
    {50, 62},
    {0, 252},
    {44, 198},
    {59, 258},
    {49, 131},
    {33, 243},
    {24, 238},
    {53, 116},
    {53, 377},
    {53, 175},
    {51, 346},
    {53, 181},
    {35, 332},
    {39, 4},
    {23, 251},
    {45, 211},
    {35, 330},
    {17, 183},
    {56, 186},
    {0, 23},
    {37, 206},
    {31, 33},
    {8, 125},
    {48, 226},
    {60, 307},
    {0, 164},
    {48, 70},
    {56, 133},
    {38, 61},
    {35, 338},
    {55, 370},
    {60, 248},
    {0, 265},
    {35, 299},
    {21, 269},
    {33, 290},
    {1, 166},
    {41, 83},
    {37, 334},
    {59, 198},
    {2, 113},
    {47, 285},
    {6, 105},
    {3, 256},
    {11, 177},
    {0, 24},
    {59, 351},
    {8, 174},
    {60, 122},
    {3, 287},
    {39, 286},
    {8, 287},
    {32, 20},
    {0, 267},
    {5, 283},
    {35, 307},
    {58, 338},
    {0, 360},
    {60, 68},
    {12, 135},
    {31, 347},
    {10, 104},
    {35, 141},
    {51, 126},
    {60, 81},
    {13, 124},
    {60, 93},
    {29, 271},
    {0, 339},
    {0, 157},
    {5, 359},
    {57, 143},
    {36, 111},
    {33, 373},
    {7, 208},
    {59, 344},
    {0, 68},
    {30, 184},
    {0, 216},
    {7, 260},
    {0, 73},
    {57, 73},
    {57, 351},
    {21, 325},
    {0, 163},
    {60, 234},
    {33, 271},
    {24, 309},
    {1, 292},
    {0, 276},
    {14, 293},
    {37, 374},
    {25, 181},
    {25, 351},
    {32, 56},
    {1, 173},
    {5, 264},
    {39, 249},
    {36, 57},
    {55, 214},
    {23, 191},
    {5, 4},
    {23, 104},
    {0, 320},
    {1, 224},
    {15, 326},
    {58, 378},
    {57, 331},
    {16, 124},
    {55, 263},
    {0, 109},
    {4, 141},
    {12, 157},
    {1, 65},
    {57, 130},
    {57, 169},
    {39, 338},
    {15, 286},
    {24, 280},
    {23, 113},
    {17, 198},
    {7, 85},
    {23, 259},
    {1, 290},
    {1, 366},
    {51, 256},
    {8, 247},
    {51, 213},
    {33, 105},
    {0, 237},
    {18, 39},
    {30, 278},
    {35, 339},
    {2, 249},
    {0, 16},
    {38, 3},
    {46, 93},
    {2, 373},
    {32, 372},
    {0, 93},
    {23, 185},
    {35, 308},
    {12, 232},
    {57, 328},
    {33, 312},
    {9, 87},
    {30, 140},
    {8, 54},
    {43, 83},
    {52, 177},
    {2, 235},
    {43, 320},
    {13, 354},
    {33, 155},
    {52, 48},
    {55, 241},
    {4, 41},
    {7, 37},
    {25, 249},
    {47, 257},
    {5, 292},
    {55, 131},
    {58, 21},
    {37, 87},
    {29, 150},
    {1, 19},
    {23, 14},
    {31, 142},
    {59, 17},
    {40, 14},
    {37, 181},
    {44, 138},
    {25, 369},
    {55, 92},
    {5, 33},
    {23, 351},
    {19, 136},
    {27, 136},
    {30, 171},
    {0, 287},
    {25, 102},
    {51, 349},
    {23, 178},
    {57, 254},
    {48, 65},
    {35, 179},
    {27, 297},
    {31, 85},
    {54, 64},
    {0, 359},
    {20, 63},
    {7, 81},
    {59, 12},
    {60, 9},
    {18, 325},
    {23, 382},
    {42, 39},
    {5, 271},
    {25, 124},
    {53, 251},
    {29, 146},
    {1, 321},
    {58, 379},
    {2, 375},
    {53, 264},
    {8, 330},
    {35, 16},
    {47, 237},
    {4, 323},
    {1, 91},
    {33, 27},
    {12, 143},
    {23, 365},
    {24, 278},
    {2, 44},
    {45, 254},
    {2, 322},
    {2, 79},
    {38, 265},
    {14, 244},
    {2, 281},
    {25, 358},
    {49, 127},
    {38, 248},
    {25, 136},
    {12, 228},
    {43, 220},
    {0, 251},
    {26, 344},
    {59, 222},
    {8, 316},
    {35, 25},
    {60, 4},
    {57, 355},
    {47, 268},
    {2, 358},
    {2, 261},
    {58, 212},
    {7, 353},
    {18, 364},
    {8, 87},
    {2, 156},
    {2, 287},
    {0, 98},
    {1, 115},
    {0, 340},
    {25, 199},
    {37, 378},
    {5, 372},
    {26, 78},
    {2, 319},
    {0, 185},
    {7, 273},
    {11, 341},
    {4, 291},
    {24, 202},
    {59, 37},
    {1, 150},
    {31, 73},
    {2, 379},
    {36, 122},
    {57, 106},
    {60, 119},
    {3, 193},
    {25, 172},
    {2, 57},
    {1, 69},
    {0, 329},
    {25, 4},
    {29, 164},
    {0, 52},
    {2, 335},
    {1, 16},
    {51, 80},
    {2, 347},
    {31, 197},
    {1, 363},
    {22, 81},
    {38, 236},
    {11, 295},
    {55, 367},
    {33, 302},
    {14, 173},
    {0, 168},
    {21, 266},
    {55, 268},
    {45, 75},
    {32, 135},
    {20, 55},
    {60, 221},
    {2, 324},
    {8, 75},
    {0, 146},
    {15, 323},
    {1, 60},
    {2, 216},
    {24, 62},
    {53, 345},
    {44, 59},
    {3, 271},
    {59, 294},
    {54, 370},
    {0, 262},
    {52, 175},
    {31, 8},
    {1, 112},
    {3, 201},
    {0, 90},
    {2, 191},
    {3, 192},
    {26, 299},
    {32, 201},
    {57, 147},
    {3, 382},
    {22, 167},
    {0, 293},
    {7, 250},
    {2, 164},
    {51, 140},
    {31, 310},
    {2, 178},
    {1, 288},
    {2, 300},
    {1, 81},
    {14, 345},
    {1, 77},
    {53, 167},
    {33, 180},
    {18, 295},
    {5, 312},
    {0, 285},
    {39, 302},
    {2, 86},
    {51, 33},
    {35, 201},
    {0, 272},
    {42, 106},
    {33, 246},
    {0, 132},
    {21, 89},
    {34, 303},
    {1, 202},
    {1, 334},
    {23, 297},
    {3, 6},
    {6, 290},
    {25, 95},
    {60, 328},
    {18, 133},
    {38, 382},
    {2, 17},
    {1, 56},
    {54, 136},
    {2, 356},
    {2, 339},
    {39, 30},
    {1, 240},
    {3, 103},
    {0, 166},
    {1, 325},
    {21, 303},
    {58, 127},
    {30, 79},
    {1, 45},
    {58, 346},
    {4, 47},
    {1, 5},
    {60, 299},
    {49, 304},
    {23, 153},
    {2, 243},
    {45, 19},
    {25, 310},
    {55, 314},
    {48, 198},
    {2, 46},
    {31, 117},
    {1, 350},
    {3, 78},
    {2, 382},
    {2, 163},
    {0, 172},
    {33, 301},
    {1, 48},
    {60, 231},
    {0, 87},
    {1, 225},
    {19, 316},
    {24, 125},
    {17, 374},
    {16, 22},
    {25, 348},
    {2, 344},
    {2, 148},
    {2, 189},
    {6, 383},
    {6, 302},
    {36, 109},
    {6, 166},
    {38, 137},
    {5, 86},
    {24, 184},
    {23, 278},
    {53, 46},
    {1, 241},
    {2, 199},
    {41, 96},
    {2, 207},
    {55, 101},
    {27, 41},
    {37, 151},
    {34, 281},
    {7, 243},
    {1, 151},
    {57, 232},
    {59, 343},
    {2, 147},
    {1, 118},
    {23, 346},
    {18, 177},
    {40, 339},
    {3, 86},
    {19, 298},
    {43, 38},
    {31, 256},
    {21, 119},
    {1, 116},
    {0, 63},
    {2, 184},
    {14, 336},
    {38, 352},
    {5, 275},
    {40, 217},
    {12, 4},
    {56, 377},
    {22, 266},
    {2, 116},
    {58, 382},
    {55, 275},
    {1, 311},
    {37, 200},
    {16, 29},
    {0, 104},
    {22, 315},
    {1, 265},
    {14, 96},
    {3, 321},
    {31, 58},
    {1, 259},
    {50, 172},
    {17, 272},
    {30, 7},
    {57, 329},
    {53, 196},
    {14, 78},
    {0, 113},
    {0, 210},
    {0, 334},
    {23, 205},
    {2, 202},
    {26, 173},
    {1, 102},
    {1, 178},
    {35, 41},
    {1, 305},
    {57, 289},
    {32, 13},
    {2, 154},
    {35, 273},
    {49, 112},
    {41, 127},
    {47, 96},
    {4, 372},
    {10, 293},
    {2, 89},
    {2, 228},
    {46, 207},
    {1, 222},
    {11, 58},
    {0, 178},
    {1, 159},
    {32, 251},
    {55, 288},
    {47, 104},
    {1, 128},
    {2, 355},
    {2, 260},
    {33, 93},
    {3, 36},
    {3, 329},
    {12, 152},
    {4, 118},
    {29, 311},
    {0, 186},
    {6, 209},
    {1, 302},
    {5, 20},
    {24, 151},
    {2, 302},
    {29, 322},
    {1, 255},
    {42, 138},
    {1, 338},
    {48, 307},
    {32, 370},
    {54, 253},
    {2, 296},
    {29, 109},
    {60, 335},
    {38, 261},
    {2, 53},
    {15, 147},
    {5, 198},
    {16, 48},
    {7, 324},
    {3, 212},
    {31, 196},
    {58, 149},
    {21, 136},
    {27, 82},
    {2, 186},
    {26, 295},
    {58, 349},
    {12, 290},
    {37, 129},
    {1, 286},
    {9, 321},
    {1, 144},
    {12, 246},
    {2, 371},
    {24, 176},
    {52, 186},
    {33, 82},
    {55, 72},
    {2, 217},
    {31, 24},
    {2, 14},
    {2, 250},
    {1, 156},
    {44, 23},
    {2, 206},
    {14, 42},
    {2, 201},
    {35, 117},
    {2, 68},
    {11, 159},
    {52, 179},
    {2, 88},
    {3, 299},
    {25, 292},
    {24, 225},
    {33, 96},
    {55, 112},
    {0, 227},
    {29, 20},
    {21, 294},
    {12, 167},
    {2, 226},
    {24, 39},
    {53, 37},
    {47, 176},
    {2, 52},
    {37, 90},
    {32, 3},
    {34, 55},
    {32, 374},
    {3, 337},
    {52, 372},
    {32, 293},
    {46, 167},
    {45, 245},
    {12, 70},
    {12, 346},
    {1, 132},
    {45, 87},
    {2, 83},
    {57, 58},
    {4, 133},
    {39, 74},
    {2, 364},
    {7, 136},
    {59, 73},
    {26, 224},
    {2, 323},
    {16, 227},
    {8, 102},
    {41, 141},
    {24, 177},
    {57, 183},
    {59, 275},
    {19, 119},
    {32, 292},
    {57, 61},
    {35, 107},
    {32, 277},
    {17, 223},
    {58, 350},
    {40, 147},
    {4, 370},
    {36, 213},
    {4, 178},
    {57, 290},
    {11, 102},
    {0, 273},
    {47, 338},
    {2, 15},
    {55, 373},
    {8, 257},
    {52, 0},
    {1, 25},
    {48, 334},
    {42, 197},
    {2, 185},
    {1, 131},
    {37, 26},
    {42, 318},
    {26, 131},
    {13, 300},
    {21, 278},
    {2, 366},
    {35, 150},
    {41, 306},
    {35, 196},
    {1, 351},
    {2, 264},
    {57, 214},
    {21, 12},
    {1, 188},
    {0, 374},
    {18, 186},
    {47, 77},
    {23, 335},
    {31, 332},
    {2, 284},
    {53, 27},
    {27, 141},
    {43, 199},
    {53, 26},
    {25, 324},
    {2, 174},
    {1, 129},
    {0, 141},
    {1, 339},
    {1, 35},
    {60, 137},
    {19, 127},
    {8, 282},
    {0, 148},
    {55, 145},
    {14, 335},
    {20, 326},
    {23, 375},
    {60, 181},
    {19, 197},
    {18, 348},
    {0, 309},
    {2, 276},
    {14, 290},
    {37, 350},
    {2, 223},
    {2, 359},
    {2, 188},
    {12, 352},
    {16, 291},
    {51, 327},
    {58, 40},
    {32, 97},
    {3, 50},
    {3, 240},
    {43, 156},
    {15, 173},
    {23, 34},
    {2, 5},
    {0, 137},
    {2, 177},
    {13, 181},
    {56, 262},
    {4, 335},
    {32, 117},
    {0, 305},
    {13, 199},
    {29, 299},
    {16, 114},
    {31, 319},
    {35, 184},
    {54, 152},
    {42, 241},
    {33, 370},
    {56, 116},
    {3, 44},
    {35, 56},
    {21, 288},
    {45, 383},
    {38, 374},
    {3, 71},
    {15, 109},
    {1, 374},
    {16, 296},
    {42, 257},
    {12, 75},
    {35, 109},
    {16, 367},
    {2, 204},
    {2, 224},
    {25, 30},
    {51, 82},
    {11, 292},
    {58, 380},
    {44, 17},
    {2, 11},
    {7, 68},
    {27, 326},
    {31, 355},
    {2, 291},
    {32, 161},
    {35, 315},
    {37, 42},
    {41, 243},
    {18, 290},
    {45, 121},
    {49, 159},
    {35, 227},
    {57, 97},
    {8, 302},
    {14, 265},
    {35, 189},
    {25, 271},
    {0, 42},
    {12, 322},
    {16, 288},
    {8, 0},
    {1, 229},
    {21, 281},
    {2, 378},
    {25, 275},
    {56, 144},
    {58, 345},
    {21, 328},
    {1, 33},
    {57, 24},
    {33, 351},
    {57, 195},
    {35, 245},
    {42, 97},
    {53, 256},
    {39, 339},
    {5, 136},
    {0, 22},
    {1, 29},
    {23, 285},
    {33, 353},
    {53, 160},
    {2, 50},
    {22, 300},
    {7, 26},
    {7, 130},
    {22, 193},
    {2, 294},
    {16, 50},
    {16, 59},
    {52, 133},
    {21, 299},
    {15, 320},
    {30, 333},
    {2, 283},
    {53, 260},
    {21, 378},
    {1, 221},
    {37, 116},
    {51, 283},
    {59, 259},
    {9, 163},
    {0, 333},
    {37, 27},
    {17, 345},
    {18, 44},
    {54, 373},
    {3, 63},
    {17, 29},
    {29, 122},
    {21, 70},
    {5, 114},
    {12, 153},
    {57, 379},
    {15, 132},
    {53, 240},
    {11, 350},
    {29, 224},
    {14, 209},
    {0, 91},
    {16, 178},
    {6, 381},
    {8, 72},
    {4, 42},
    {44, 98},
    {14, 229},
    {0, 354},
    {54, 204},
    {8, 26},
    {30, 100},
    {58, 36},
    {22, 178},
    {38, 372},
    {44, 262},
    {43, 218},
    {40, 188},
    {0, 229},
    {36, 196},
    {51, 281},
    {43, 217},
    {57, 296},
    {17, 158},
    {2, 149},
    {33, 128},
    {2, 327},
    {16, 365},
    {12, 124},
    {42, 275},
    {18, 181},
    {24, 138},
    {2, 112},
    {32, 198},
    {3, 169},
    {35, 371},
    {2, 134},
    {24, 135},
    {36, 107},
    {2, 169},
    {23, 27},
    {16, 352},
    {34, 321},
    {51, 365},
    {31, 350},
    {37, 111},
    {15, 305},
    {2, 254},
    {52, 170},
    {21, 79},
    {44, 220},
    {49, 14},
    {12, 268},
    {43, 365},
    {21, 238},
    {50, 35},
    {50, 203},
    {51, 113},
    {29, 204},
    {0, 208},
    {23, 188},
    {45, 329},
    {23, 117},
    {17, 110},
    {49, 229},
    {50, 89},
    {57, 165},
    {37, 219},
    {60, 42},
    {39, 199},
    {1, 108},
    {35, 125},
    {50, 315},
    {2, 168},
    {1, 192},
    {24, 156},
    {22, 3},
    {53, 16},
    {10, 167},
    {35, 36},
    {14, 158},
    {12, 291},
    {48, 189},
    {1, 232},
    {19, 120},
    {1, 228},
    {0, 377},
    {45, 250},
    {54, 122},
    {21, 147},
    {8, 167},
    {2, 132},
    {56, 156},
    {22, 256},
    {0, 319},
    {0, 188},
    {58, 244},
    {37, 260},
    {1, 239},
    {19, 345},
    {23, 344},
    {32, 186},
    {22, 131},
    {17, 192},
    {43, 211},
    {1, 83},
    {21, 244},
    {5, 135},
    {45, 306},
    {12, 100},
    {1, 267},
    {53, 242},
    {22, 202},
    {3, 229},
    {19, 370},
    {20, 84},
    {22, 136},
    {53, 183},
    {16, 35},
    {59, 209},
    {36, 219},
    {51, 129},
    {3, 224},
    {6, 94},
    {19, 62},
    {48, 350},
    {25, 166},
    {10, 105},
    {19, 151},
    {14, 123},
    {52, 86},
    {3, 176},
    {15, 110},
    {15, 264},
    {7, 216},
    {6, 196},
    {17, 88},
    {21, 271},
    {13, 332},
    {38, 257},
    {4, 235},
    {22, 243},
    {54, 330},
    {16, 118},
    {14, 342},
    {34, 101},
    {0, 3},
    {23, 127},
    {30, 23},
    {46, 216},
    {58, 383},
    {29, 167},
    {14, 178},
    {31, 285},
    {25, 259},
    {43, 213},
    {52, 357},
    {2, 299},
    {21, 66},
    {10, 232},
    {6, 292},
    {18, 171},
    {59, 274},
    {0, 259},
    {2, 119},
    {17, 343},
    {14, 168},
    {49, 140},
    {35, 383},
    {44, 91},
    {8, 51},
    {53, 213},
    {1, 199},
    {57, 72},
    {20, 169},
    {16, 331},
    {22, 262},
    {57, 366},
    {1, 90},
    {5, 316},
    {41, 268},
    {13, 187},
    {46, 247},
    {60, 372},
    {17, 96},
    {13, 19},
    {35, 146},
    {50, 132},
    {13, 317},
    {7, 192},
    {46, 367},
    {4, 50},
    {10, 254},
    {13, 190},
    {57, 22},
    {26, 31},
    {10, 218},
    {14, 382},
    {53, 363},
    {23, 279},
    {57, 177},
    {13, 344},
    {24, 160},
    {13, 57},
    {23, 210},
    {54, 19},
    {5, 164},
    {31, 11},
    {57, 199},
    {10, 374},
    {1, 21},
    {4, 376},
    {37, 345},
    {52, 221},
    {39, 316},
    {7, 70},
    {16, 232},
    {45, 107},
    {49, 199},
    {50, 213},
    {20, 10},
    {37, 269},
    {11, 260},
    {24, 331},
    {20, 13},
    {5, 355},
    {12, 361},
    {5, 68},
    {34, 140},
    {0, 282},
    {17, 294},
    {5, 193},
    {33, 101},
    {7, 141},
    {10, 56},
    {3, 172},
    {28, 122},
    {59, 378},
    {37, 78},
    {57, 94},
    {15, 327},
    {50, 9},
    {12, 362},
    {20, 215},
    {21, 142},
    {43, 141},
    {49, 36},
    {4, 310},
    {21, 158},
    {13, 70},
    {33, 63},
    {52, 243},
    {58, 327},
    {0, 356},
    {18, 75},
    {59, 356},
    {56, 359},
    {24, 106},
    {13, 366},
    {59, 11},
    {1, 299},
    {58, 229},
    {4, 317},
    {43, 88},
    {0, 245},
    {10, 32},
    {58, 328},
    {19, 170},
    {2, 263},
    {7, 205},
    {43, 42},
    {53, 243},
    {29, 225},
    {33, 61},
    {21, 82},
    {55, 118},
    {46, 327},
    {21, 286},
    {2, 38},
    {50, 299},
    {27, 370},
    {19, 205},
    {22, 14},
    {46, 159},
    {29, 76},
    {2, 208},
    {18, 329},
    {14, 115},
    {11, 34},
    {8, 138},
    {20, 81},
    {53, 194},
    {9, 26},
    {1, 70},
    {17, 357},
    {36, 350},
    {14, 234},
    {48, 199},
    {29, 7},
    {12, 68},
    {3, 306},
    {52, 2},
    {49, 310},
    {22, 105},
    {37, 265},
    {36, 235},
    {22, 168},
    {13, 122},
    {57, 256},
    {38, 205},
    {53, 382},
    {14, 36},
    {24, 283},
    {15, 378},
    {7, 210},
    {9, 333},
    {48, 349},
    {51, 287},
    {39, 223},
    {57, 142},
    {15, 77},
    {41, 65},
    {55, 115},
    {39, 69},
    {51, 118},
    {31, 101},
    {7, 148},
    {18, 365},
    {12, 179},
    {55, 49},
    {37, 148},
    {1, 263},
    {13, 51},
    {17, 50},
    {47, 175},
    {31, 325},
    {34, 64},
    {57, 259},
    {10, 116},
    {5, 364},
    {13, 321},
    {10, 100},
    {23, 80},
    {7, 14},
    {1, 153},
    {30, 340},
    {6, 48},
    {37, 96},
    {32, 58},
    {29, 157},
    {40, 136},
    {23, 219},
    {21, 367},
    {11, 133},
    {55, 81},
    {2, 350},
    {58, 123},
    {9, 50},
    {54, 308},
    {49, 4},
    {54, 40},
    {29, 290},
    {28, 335},
    {7, 17},
    {3, 207},
    {57, 246},
    {37, 281},
    {21, 169},
    {41, 206},
    {54, 147},
    {4, 72},
    {20, 26},
    {29, 314},
    {29, 168},
    {48, 338},
    {11, 303},
    {56, 141},
    {15, 259},
    {41, 153},
    {1, 37},
    {59, 183},
    {35, 348},
    {7, 379},
    {53, 379},
    {59, 241},
    {30, 63},
    {13, 328},
    {24, 114},
    {15, 184},
    {23, 114},
    {2, 91},
    {58, 118},
    {49, 242},
    {53, 209},
    {23, 246},
    {37, 161},
    {37, 361},
    {5, 284},
    {34, 45},
    {0, 288},
    {53, 43},
    {21, 383},
    {0, 243},
    {3, 307},
    {3, 252},
    {28, 314},
    {59, 136},
    {33, 347},
    {47, 263},
    {5, 327},
    {15, 192},
    {8, 312},
    {8, 25},
    {8, 323},
    {7, 35},
    {31, 48},
    {47, 166},
    {15, 217},
    {21, 215},
    {31, 331},
    {22, 370},
    {2, 36},
    {3, 275},
    {37, 34},
    {0, 306},
    {47, 23},
    {15, 90},
    {53, 63},
    {59, 246},
    {58, 30},
    {17, 154},
    {10, 195},
    {0, 62},
    {20, 309},
    {32, 47},
    {31, 221},
    {27, 177},
    {32, 156},
    {43, 66},
    {30, 378},
    {12, 61},
    {53, 279},
    {52, 303},
    {22, 141},
    {15, 247},
    {0, 131},
    {20, 124},
    {39, 16},
    {48, 206},
    {33, 48},
    {13, 353},
    {34, 335},
    {41, 196},
    {53, 368},
    {40, 211},
    {5, 269},
    {37, 66},
    {58, 264},
    {19, 138},
    {15, 5},
    {59, 152},
    {17, 28},
    {55, 213},
    {7, 9},
    {15, 32},
    {32, 152},
    {15, 242},
    {23, 201},
    {47, 42},
    {9, 123},
    {26, 376},
    {28, 155},
    {59, 290},
    {1, 204},
    {25, 177},
    {18, 298},
    {15, 140},
    {34, 374},
    {15, 260},
    {22, 160},
    {53, 218},
    {57, 59},
    {1, 220},
    {38, 90},
    {56, 122},
    {21, 192},
    {15, 129},
    {45, 378},
    {26, 197},
    {2, 55},
    {44, 117},
    {55, 311},
    {59, 317},
    {29, 344},
    {50, 245},
    {24, 118},
    {59, 50},
    {9, 353},
    {57, 321},
    {35, 48},
    {51, 331},
    {29, 373},
    {57, 211},
    {60, 194},
    {18, 247},
    {5, 113},
    {59, 127},
    {56, 370},
    {19, 92},
    {49, 170},
    {56, 69},
    {60, 195},
    {5, 220},
    {53, 250},
    {51, 275},
    {13, 104},
    {5, 104},
    {1, 168},
    {18, 173},
    {49, 377},
    {5, 279},
    {45, 314},
    {49, 168},
    {15, 227},
    {21, 83},
    {35, 232},
    {58, 191},
    {54, 186},
    {7, 323},
    {7, 115},
    {11, 338},
    {15, 263},
    {22, 184},
    {60, 258},
    {19, 267},
    {53, 318},
    {35, 220},
    {7, 29},
    {57, 101},
    {60, 217},
    {1, 180},
    {42, 312},
    {8, 293},
    {32, 310},
    {7, 287},
    {21, 329},
    {50, 160},
    {22, 322},
    {46, 102},
    {38, 171},
    {37, 362},
    {38, 319},
    {3, 74},
    {56, 43},
    {35, 132},
    {57, 190},
    {2, 39},
    {44, 177},
    {53, 68},
    {47, 346},
    {54, 214},
    {60, 98},
    {8, 245},
    {2, 346},
    {16, 182},
    {23, 381},
    {37, 333},
    {29, 24},
    {0, 335},
    {39, 19},
    {1, 113},
    {20, 24},
    {1, 38},
    {35, 255},
    {54, 107},
    {20, 20},
    {20, 178},
    {53, 371},
    {20, 106},
    {51, 328},
    {59, 253},
    {31, 286},
    {43, 121},
    {51, 81},
    {47, 248},
    {8, 191},
    {42, 356},
    {7, 318},
    {8, 168},
    {59, 320},
    {34, 4},
    {18, 43},
    {19, 340},
    {46, 351},
    {4, 162},
    {54, 325},
    {33, 236},
    {8, 49},
    {23, 235},
    {37, 132},
    {16, 184},
    {43, 242},
    {17, 106},
    {21, 74},
    {42, 8},
    {10, 339},
    {48, 279},
    {5, 265},
    {39, 68},
    {36, 55},
    {59, 313},
    {18, 153},
    {6, 10},
    {35, 267},
    {60, 76},
    {21, 221},
    {50, 3},
    {39, 293},
    {17, 228},
    {36, 183},
    {3, 265},
    {21, 337},
    {3, 177},
    {55, 33},
    {8, 259},
    {25, 143},
    {14, 231},
    {8, 158},
    {39, 208},
    {18, 161},
    {0, 378},
    {13, 211},
    {57, 98},
    {8, 103},
    {11, 148},
    {9, 332},
    {5, 6},
    {15, 367},
    {19, 325},
    {46, 9},
    {22, 307},
    {34, 311},
    {59, 134},
    {55, 246},
    {0, 140},
    {36, 133},
    {23, 112},
    {35, 70},
    {40, 334},
    {1, 152},
    {20, 239},
    {53, 14},
    {0, 130},
    {4, 373},
    {15, 99},
    {7, 106},
    {57, 18},
    {38, 72},
    {10, 190},
    {50, 99},
    {20, 221},
    {35, 136},
    {26, 272},
    {37, 171},
    {15, 59},
    {58, 211},
    {42, 135},
    {6, 350},
    {25, 110},
    {31, 175},
    {23, 120},
    {49, 120},
    {3, 183},
    {55, 103},
    {59, 164},
    {11, 360},
    {0, 88},
    {50, 367},
    {8, 107},
    {14, 366},
    {22, 209},
    {26, 226},
    {5, 239},
    {20, 271},
    {37, 299},
    {38, 230},
    {55, 188},
    {10, 95},
    {59, 267},
    {4, 377},
    {18, 361},
    {38, 146},
    {35, 58},
    {60, 377},
    {1, 320},
    {29, 328},
    {19, 235},
    {22, 132},
    {39, 178},
    {17, 219},
    {19, 77},
    {8, 66},
    {53, 207},
    {15, 306},
    {26, 153},
    {6, 261},
    {25, 52},
    {50, 158},
    {3, 11},
    {17, 136},
    {8, 333},
    {13, 34},
    {16, 311},
    {15, 86},
    {40, 59},
    {55, 326},
    {26, 43},
    {20, 122},
    {39, 188},
    {50, 153},
    {35, 212},
    {32, 172},
    {7, 43},
    {1, 264},
    {27, 106},
    {42, 143},
    {57, 200},
    {34, 372},
    {24, 341},
    {21, 182},
    {20, 311},
    {18, 137},
    {8, 198},
    {14, 364},
    {44, 333},
    {7, 142},
    {46, 131},
    {48, 138},
    {60, 136},
    {53, 339},
    {47, 25},
    {44, 271},
    {8, 331},
    {49, 226},
    {41, 300},
    {9, 252},
    {37, 215},
    {1, 179},
    {26, 378},
    {8, 320},
    {8, 15},
    {6, 229},
    {22, 311},
    {43, 111},
    {3, 48},
    {15, 101},
    {49, 284},
    {20, 15},
    {43, 266},
    {31, 68},
    {40, 251},
    {6, 270},
    {20, 381},
    {44, 370},
    {47, 367},
    {21, 2},
    {14, 381},
    {31, 283},
    {51, 183},
    {52, 276},
    {12, 31},
    {24, 35},
    {59, 38},
    {53, 176},
    {48, 313},
    {36, 61},
    {21, 165},
    {43, 21},
    {57, 26},
    {8, 84},
    {2, 77},
    {52, 224},
    {18, 250},
    {53, 25},
    {51, 75},
    {30, 133},
    {24, 382},
    {30, 298},
    {3, 114},
    {11, 254},
    {39, 176},
    {14, 198},
    {5, 180},
    {58, 352},
    {10, 17},
    {27, 229},
    {1, 283},
    {14, 355},
    {28, 305},
    {36, 206},
    {55, 351},
    {39, 246},
    {14, 29},
    {59, 363},
    {25, 378},
    {5, 21},
    {24, 76},
    {16, 107},
    {26, 326},
    {58, 56},
    {17, 349},
    {60, 59},
    {6, 43},
    {7, 274},
    {8, 24},
    {52, 245},
    {60, 55},
    {57, 63},
    {33, 6},
    {56, 308},
    {0, 59},
    {58, 261},
    {31, 334},
    {53, 298},
    {15, 56},
    {41, 24},
    {21, 120},
    {5, 16},
    {57, 164},
    {38, 55},
    {25, 26},
    {4, 143},
    {33, 367},
    {49, 89},
    {12, 350},
    {27, 223},
    {51, 232},
    {6, 321},
    {18, 254},
    {38, 87},
    {15, 8},
    {5, 74},
    {19, 57},
    {19, 300},
    {6, 357},
    {17, 75},
    {33, 363},
    {13, 288},
    {47, 134},
    {18, 198},
    {3, 280},
    {10, 111},
    {43, 269},
    {8, 360},
    {6, 143},
    {17, 369},
    {55, 195},
    {26, 96},
    {12, 155},
    {54, 317},
    {1, 184},
    {7, 254},
    {55, 292},
    {45, 206},
    {59, 66},
    {2, 180},
    {37, 164},
    {15, 105},
    {25, 37},
    {8, 147},
    {26, 296},
    {5, 78},
    {24, 291},
    {8, 338},
    {52, 147},
    {8, 354},
    {33, 311},
    {6, 202},
    {7, 47},
    {7, 18},
    {52, 250},
    {2, 28},
    {23, 12},
    {5, 323},
    {58, 76},
    {29, 188},
    {18, 77},
    {33, 255},
    {57, 179},
    {53, 222},
    {29, 248},
    {1, 42},
    {40, 232},
    {4, 135},
    {53, 372},
    {20, 197},
    {45, 134},
    {60, 285},
    {30, 248},
    {20, 336},
    {20, 66},
    {5, 345},
    {0, 14},
    {59, 184},
    {7, 374},
    {57, 273},
    {55, 132},
    {54, 128},
    {20, 207},
    {18, 297},
    {20, 164},
    {4, 212},
    {43, 149},
    {15, 23},
    {21, 111},
    {33, 210},
    {19, 80},
    {2, 172},
    {39, 94},
    {56, 123},
    {43, 11},
    {15, 218},
    {52, 282},
    {51, 324},
    {45, 25},
    {48, 357},
    {29, 18},
    {32, 140},
    {12, 371},
    {56, 328},
    {35, 78},
    {41, 209},
    {7, 11},
    {15, 187},
    {1, 335},
    {19, 54},
    {50, 58},
    {13, 23},
    {23, 54},
    {44, 10},
    {24, 250},
    {3, 12},
    {53, 119},
    {8, 188},
    {17, 101},
    {25, 360},
    {7, 143},
    {25, 207},
    {4, 57},
    {28, 30},
    {10, 67},
    {59, 163},
    {11, 33},
    {29, 69},
    {58, 0},
    {58, 271},
    {14, 137},
    {49, 153},
    {6, 197},
    {7, 340},
    {36, 36},
    {25, 335},
    {30, 84},
    {31, 235},
    {57, 192},
    {48, 164},
    {1, 7},
    {5, 322},
    {15, 169},
    {0, 144},
    {42, 80},
    {7, 194},
    {0, 61},
    {37, 379},
    {51, 158},
    {19, 299},
    {37, 229},
    {12, 102},
    {4, 261},
    {18, 346},
    {55, 293},
    {50, 238},
    {8, 197},
    {46, 309},
    {58, 374},
    {21, 245},
    {60, 53},
    {21, 214},
    {25, 377},
    {23, 107},
    {21, 163},
    {46, 142},
    {0, 11},
    {14, 111},
    {2, 143},
    {10, 108},
    {8, 317},
    {3, 359},
    {6, 95},
    {41, 19},
    {32, 299},
    {54, 236},
    {35, 106},
    {57, 65},
    {58, 150},
    {14, 135},
    {51, 293},
    {18, 183},
    {57, 145},
    {26, 37},
    {6, 269},
    {24, 339},
    {8, 91},
    {14, 64},
    {4, 75},
    {18, 343},
    {30, 313},
    {46, 286},
    {34, 192},
    {10, 207},
    {24, 186},
    {31, 65},
    {26, 270},
    {56, 345},
    {55, 154},
    {59, 286},
    {5, 183},
    {15, 54},
    {11, 247},
    {21, 100},
    {4, 343},
    {25, 313},
    {35, 375},
    {48, 192},
    {55, 280},
    {13, 312},
    {0, 2},
    {5, 235},
    {26, 281},
    {45, 231},
    {8, 358},
    {6, 117},
    {45, 229},
    {9, 323},
    {32, 75},
    {57, 347},
    {3, 93},
    {50, 232},
    {48, 107},
    {29, 308},
    {32, 48},
    {29, 43},
    {8, 359},
    {15, 9},
    {26, 206},
    {37, 117},
    {37, 208},
    {9, 144},
    {53, 92},
    {1, 364},
    {11, 156},
    {6, 81},
    {11, 31},
    {49, 156},
    {36, 195},
    {31, 373},
    {7, 164},
    {30, 317},
    {37, 194},
    {51, 222},
    {8, 225},
    {26, 222},
    {16, 300},
    {23, 76},
    {56, 267},
    {45, 163},
    {13, 157},
    {58, 323},
    {53, 64},
    {30, 67},
    {5, 330},
    {10, 93},
    {39, 60},
    {8, 150},
    {5, 134},
    {26, 26},
    {37, 205},
    {18, 191},
    {56, 181},
    {39, 213},
    {6, 362},
    {15, 335},
    {19, 131},
    {59, 140},
    {19, 339},
    {52, 320},
    {35, 108},
    {0, 34},
    {58, 74},
    {12, 229},
    {25, 160},
    {32, 200},
    {29, 64},
    {15, 124},
    {39, 137},
    {17, 367},
    {56, 290},
    {4, 333},
    {31, 63},
    {55, 328},
    {29, 230},
    {15, 373},
    {15, 161},
    {36, 364},
    {19, 158},
    {53, 69},
    {23, 212},
    {13, 100},
    {58, 193},
    {7, 289},
    {35, 34},
    {58, 87},
    {36, 91},
    {7, 325},
    {8, 39},
    {38, 208},
    {22, 198},
    {43, 85},
    {17, 284},
    {12, 226},
    {30, 236},
    {31, 102},
    {3, 147},
    {14, 43},
    {57, 228},
    {53, 85},
    {54, 63},
    {32, 51},
    {32, 294},
    {4, 195},
    {60, 14},
    {55, 60},
    {17, 48},
    {4, 359},
    {5, 383},
    {49, 185},
    {0, 116},
    {1, 104},
    {22, 201},
    {10, 299},
    {11, 172},
    {15, 252},
    {49, 278},
    {39, 206},
    {31, 263},
    {8, 4},
    {55, 21},
    {9, 222},
    {46, 138},
    {57, 67},
    {40, 156},
    {30, 320},
    {12, 71},
    {28, 285},
    {51, 148},
    {3, 196},
    {54, 104},
    {9, 233},
    {42, 157},
    {47, 276},
    {4, 344},
    {11, 311},
    {36, 221},
    {37, 125},
    {55, 366},
    {43, 26},
    {58, 89},
    {56, 223},
    {59, 48},
    {57, 136},
    {7, 252},
    {16, 250},
    {60, 48},
    {51, 203},
    {19, 202},
    {43, 322},
    {13, 35},
    {59, 216},
    {22, 175},
    {31, 84},
    {13, 116},
    {29, 321},
    {1, 6},
    {6, 125},
    {34, 360},
    {26, 48},
    {18, 106},
    {11, 84},
    {18, 17},
    {19, 309},
    {11, 309},
    {10, 10},
    {40, 86},
    {59, 337},
    {26, 341},
    {20, 54},
    {3, 76},
    {30, 218},
    {60, 226},
    {58, 262},
    {44, 110},
    {14, 150},
    {60, 355},
    {48, 110},
    {33, 41},
    {11, 353},
    {57, 317},
    {8, 68},
    {8, 169},
    {55, 165},
    {54, 41},
    {59, 113},
    {26, 34},
    {3, 92},
    {27, 329},
    {59, 255},
    {28, 255},
    {37, 218},
    {19, 364},
    {7, 100},
    {4, 59},
    {26, 284},
    {9, 79},
    {29, 130},
    {25, 323},
    {41, 354},
    {43, 160},
    {40, 153},
    {5, 342},
    {10, 127},
    {40, 173},
    {0, 284},
    {44, 318},
    {56, 66},
    {19, 240},
    {42, 166},
    {39, 248},
    {18, 131},
    {55, 50},
    {49, 343},
    {22, 139},
    {60, 29},
    {29, 52},
    {48, 98},
    {29, 368},
    {60, 133},
    {56, 49},
    {29, 234},
    {8, 134},
    {40, 48},
    {7, 264},
    {55, 160},
    {55, 173},
    {8, 348},
    {31, 26},
    {16, 332},
    {13, 197},
    {26, 280},
    {11, 201},
    {23, 226},
    {23, 287},
    {59, 263},
    {14, 166},
    {42, 243},
    {45, 228},
    {49, 286},
    {23, 60},
    {32, 42},
    {27, 217},
    {38, 25},
    {32, 347},
    {11, 365},
    {15, 113},
    {58, 192},
    {33, 47},
    {12, 333},
    {34, 319},
    {8, 199},
    {60, 27},
    {33, 281},
    {33, 318},
    {9, 65},
    {44, 328},
    {57, 148},
    {18, 314},
    {56, 225},
    {59, 126},
    {54, 229},
    {25, 289},
    {24, 216},
    {3, 54},
    {9, 359},
    {34, 87},
    {56, 342},
    {42, 2},
    {55, 299},
    {0, 119},
    {58, 222},
    {38, 239},
    {17, 31},
    {9, 319},
    {9, 219},
    {39, 292},
    {4, 148},
    {32, 321},
    {53, 229},
    {39, 10},
    {30, 349},
    {43, 377},
    {17, 164},
    {56, 172},
    {8, 202},
    {6, 341},
    {6, 120},
    {47, 351},
    {25, 128},
    {28, 163},
    {11, 125},
    {60, 90},
    {33, 4},
    {11, 325},
    {7, 314},
    {31, 19},
    {3, 133},
    {18, 357},
    {53, 111},
    {31, 275},
    {10, 259},
    {8, 61},
    {39, 220},
    {23, 62},
    {6, 251},
    {17, 79},
    {48, 325},
    {37, 136},
    {42, 349},
    {59, 208},
    {11, 323},
    {50, 147},
    {6, 114},
    {13, 227},
    {25, 20},
    {7, 104},
    {53, 49},
    {33, 383},
    {53, 120},
    {50, 134},
    {60, 232},
    {34, 267},
    {38, 9},
    {37, 204},
    {41, 143},
    {8, 299},
    {33, 165},
    {54, 376},
    {26, 367},
    {23, 98},
    {4, 120},
    {49, 107},
    {47, 53},
    {4, 166},
    {25, 327},
    {30, 266},
    {52, 367},
    {49, 155},
    {34, 248},
    {45, 350},
    {39, 162},
    {2, 265},
    {0, 85},
    {59, 141},
    {34, 310},
    {14, 109},
    {46, 120},
    {8, 118},
    {33, 67},
    {9, 7},
    {0, 149},
    {38, 112},
    {33, 285},
    {11, 72},
    {29, 351},
    {38, 60},
    {22, 265},
    {39, 171},
    {11, 100},
    {57, 28},
    {10, 248},
    {37, 287},
    {55, 175},
    {17, 46},
    {59, 33},
    {10, 359},
    {15, 43},
    {54, 231},
    {34, 11},
    {25, 299},
    {19, 48},
    {30, 166},
    {1, 254},
    {53, 311},
    {43, 115},
    {1, 101},
    {36, 335},
    {29, 32},
    {7, 257},
    {59, 366},
    {17, 315},
    {28, 110},
    {47, 320},
    {46, 334},
    {17, 184},
    {37, 33},
    {28, 130},
    {28, 376},
    {25, 293},
    {40, 19},
    {43, 341},
    {36, 58},
    {52, 44},
    {34, 238},
    {39, 102},
    {32, 85},
    {28, 204},
    {22, 174},
    {43, 303},
    {37, 267},
    {38, 27},
    {40, 239},
    {45, 63},
    {10, 327},
    {10, 5},
    {4, 110},
    {25, 278},
    {29, 214},
    {12, 303},
    {19, 216},
    {10, 196},
    {52, 237},
    {7, 0},
    {21, 323},
    {59, 91},
    {58, 309},
    {18, 124},
    {49, 212},
    {11, 4},
    {11, 200},
    {33, 51},
    {29, 357},
    {54, 346},
    {10, 301},
    {47, 185},
    {34, 241},
    {44, 74},
    {25, 295},
    {13, 263},
    {6, 276},
    {29, 367},
    {55, 295},
    {9, 382},
    {29, 87},
    {37, 341},
    {55, 325},
    {22, 332},
    {43, 198},
    {36, 178},
    {11, 155},
    {12, 338},
    {53, 295},
    {51, 190},
    {27, 380},
    {13, 303},
    {10, 308},
    {7, 196},
    {39, 289},
    {56, 21},
    {52, 63},
    {5, 332},
    {47, 244},
    {52, 75},
    {25, 191},
    {10, 231},
    {7, 31},
    {39, 111},
    {14, 365},
    {36, 8},
    {35, 366},
    {46, 246},
    {33, 200},
    {54, 36},
    {4, 380},
    {35, 340},
    {0, 175},
    {59, 291},
    {3, 374},
    {48, 13},
    {23, 1},
    {47, 33},
    {45, 330},
    {57, 89},
    {1, 349},
    {37, 49},
    {5, 160},
    {23, 269},
    {25, 227},
    {56, 60},
    {38, 128},
    {8, 294},
    {52, 318},
    {17, 142},
    {40, 180},
    {4, 324},
    {39, 59},
    {27, 251},
    {9, 372},
    {40, 26},
    {46, 99},
    {31, 158},
    {11, 301},
    {23, 58},
    {31, 272},
    {34, 123},
    {13, 264},
    {51, 353},
    {10, 72},
    {13, 345},
    {32, 258},
    {7, 308},
    {10, 321},
    {3, 68},
    {10, 330},
    {23, 248},
    {50, 298},
    {8, 203},
    {6, 200},
    {15, 16},
    {56, 91},
    {38, 347},
    {4, 307},
    {56, 84},
    {6, 111},
    {56, 169},
    {28, 167},
    {57, 8},
    {48, 236},
    {59, 234},
    {23, 177},
    {35, 349},
    {46, 241},
    {0, 183},
    {37, 47},
    {10, 138},
    {49, 136},
    {44, 156},
    {43, 68},
    {25, 1},
    {31, 92},
    {0, 94},
    {43, 145},
    {10, 155},
    {46, 231},
    {4, 86},
    {45, 43},
    {35, 13},
    {28, 366},
    {23, 319},
    {51, 122},
    {60, 383},
    {23, 213},
    {46, 263},
    {56, 17},
    {41, 48},
    {56, 203},
    {4, 196},
    {52, 31},
    {13, 68},
    {23, 130},
    {30, 153},
    {25, 126},
    {55, 16},
    {7, 77},
    {6, 137},
    {25, 308},
    {13, 142},
    {4, 204},
    {8, 324},
    {59, 354},
    {0, 207},
    {39, 161},
    {42, 122},
    {30, 276},
    {25, 31},
    {43, 127},
    {17, 371},
    {29, 215},
    {41, 4},
    {51, 14},
    {45, 382},
    {8, 375},
    {13, 375},
    {51, 325},
    {5, 234},
    {14, 124},
    {11, 186},
    {59, 186},
    {52, 238},
    {58, 136},
    {28, 330},
    {46, 371},
    {10, 37},
    {9, 13},
    {35, 316},
    {47, 69},
    {27, 49},
    {12, 265},
    {60, 112},
    {45, 184},
    {45, 162},
    {48, 261},
    {35, 84},
    {46, 11},
    {4, 161},
    {46, 74},
    {7, 170},
    {53, 118},
    {50, 217},
    {19, 116},
    {30, 258},
    {46, 10},
    {37, 359},
    {50, 240},
    {42, 111},
    {58, 151},
    {14, 367},
    {42, 62},
    {11, 15},
    {8, 22},
    {38, 367},
    {44, 96},
    {13, 229},
    {13, 6},
    {25, 71},
    {60, 247},
    {10, 353},
    {10, 152},
    {35, 91},
    {45, 186},
    {43, 352},
    {10, 250},
    {20, 108},
    {57, 319},
    {7, 186},
    {54, 55},
    {55, 150},
    {49, 101},
    {22, 20},
    {26, 315},
    {32, 243},
    {7, 316},
    {29, 380},
    {12, 109},
    {27, 26},
    {58, 250},
    {7, 370},
    {10, 335},
    {43, 73},
    {53, 23},
    {35, 31},
    {10, 23},
    {47, 131},
    {20, 22},
    {43, 190},
    {54, 140},
    {49, 173},
    {18, 345},
    {23, 240},
    {37, 174},
    {35, 145},
    {27, 109},
    {46, 211},
    {5, 296},
    {20, 238},
    {44, 83},
    {56, 246},
    {14, 95},
    {4, 44},
    {12, 137},
    {11, 348},
    {46, 64},
    {48, 341},
    {10, 329},
    {29, 17},
    {33, 275},
    {10, 368},
    {11, 282},
    {37, 320},
    {50, 12},
    {11, 22},
    {36, 322},
    {22, 374},
    {35, 18},
    {55, 309},
    {44, 317},
    {28, 3},
    {4, 113},
    {40, 229},
    {8, 41},
    {27, 195},
    {60, 135},
    {21, 5},
    {48, 109},
    {34, 15},
    {37, 165},
    {4, 242},
    {48, 121},
    {38, 99},
    {42, 145},
    {51, 270},
    {36, 343},
    {45, 323},
    {28, 162},
    {18, 3},
    {13, 182},
    {24, 350},
    {48, 116},
    {30, 41},
    {29, 273},
    {4, 361},
    {29, 312},
    {55, 74},
    {52, 217},
    {44, 354},
    {37, 85},
    {59, 192},
    {46, 139},
    {27, 157},
    {45, 54},
    {33, 127},
    {37, 365},
    {60, 60},
    {14, 122},
    {38, 313},
    {49, 371},
    {31, 40},
    {9, 88},
    {59, 373},
    {24, 168},
    {30, 91},
    {10, 86},
    {53, 42},
    {14, 281},
    {28, 77},
    {16, 356},
    {60, 100},
    {52, 300},
    {9, 89},
    {59, 377},
    {38, 259},
    {8, 79},
    {56, 39},
    {24, 41},
    {44, 326},
    {33, 5},
    {36, 200},
    {60, 203},
    {44, 66},
    {41, 336},
    {47, 279},
    {9, 210},
    {45, 216},
    {57, 243},
    {35, 236},
    {43, 290},
    {23, 142},
    {48, 326},
    {60, 296},
    {58, 266},
    {42, 151},
    {27, 70},
    {8, 357},
    {28, 320},
    {13, 297},
    {7, 204},
    {59, 174},
    {4, 52},
    {50, 148},
    {45, 265},
    {2, 31},
    {40, 160},
    {9, 136},
    {40, 378},
    {30, 262},
    {14, 21},
    {34, 13},
    {40, 85},
    {56, 168},
    {0, 51},
    {27, 213},
    {11, 242},
    {7, 215},
    {27, 181},
    {41, 97},
    {30, 187},
    {49, 56},
    {9, 138},
    {31, 337},
    {35, 368},
    {24, 306},
    {55, 376},
    {33, 361},
    {13, 74},
    {51, 23},
    {28, 315},
    {44, 121},
    {0, 86},
    {17, 52},
    {28, 20},
    {3, 41},
    {32, 297},
    {26, 191},
    {9, 297},
    {60, 158},
    {43, 79},
    {34, 364},
    {11, 2},
    {36, 3},
    {52, 317},
    {29, 216},
    {30, 302},
    {30, 138},
    {48, 56},
    {28, 81},
    {10, 134},
    {60, 297},
    {33, 46},
    {35, 215},
    {3, 55},
    {4, 101},
    {23, 84},
    {3, 170},
    {59, 116},
    {10, 194},
    {7, 277},
    {12, 14},
    {38, 264},
    {24, 360},
    {13, 2},
    {29, 263},
    {60, 274},
    {55, 185},
    {9, 14},
    {58, 159},
    {9, 283},
    {44, 343},
    {44, 0},
    {39, 212},
    {41, 260},
    {28, 185},
    {3, 357},
    {8, 86},
    {11, 51},
    {28, 287},
    {7, 279},
    {1, 181},
    {44, 87},
    {14, 5},
    {52, 346},
    {60, 71},
    {35, 286},
    {58, 284},
    {32, 59},
    {8, 284},
    {6, 208},
    {10, 90},
    {11, 64},
    {54, 340},
    {5, 170},
    {34, 175},
    {29, 287},
    {49, 76},
    {13, 158},
    {33, 14},
    {60, 161},
    {46, 136},
    {48, 366},
    {50, 116},
    {38, 127},
    {59, 321},
    {24, 121},
    {35, 207},
    {60, 151},
    {33, 53},
    {7, 278},
    {34, 315},
    {37, 131},
    {2, 87},
    {33, 359},
    {52, 208},
    {6, 104},
    {30, 373},
    {41, 318},
    {14, 39},
    {14, 17},
    {14, 297},
    {19, 366},
    {4, 3},
    {0, 151},
    {35, 75},
    {24, 370},
    {43, 280},
    {51, 317},
    {39, 62},
    {12, 310},
    {51, 159},
    {48, 194},
    {0, 241},
    {27, 107},
    {28, 352},
    {12, 47},
    {48, 67},
    {29, 370},
    {10, 129},
    {12, 315},
    {60, 230},
    {43, 86},
    {43, 139},
    {5, 96},
    {8, 152},
    {10, 50},
    {34, 25},
    {25, 274},
    {9, 249},
    {13, 86},
    {51, 229},
    {52, 192},
    {23, 203},
    {36, 271},
    {7, 285},
    {11, 308},
    {49, 175},
    {10, 360},
    {25, 150},
    {47, 337},
    {7, 39},
    {47, 144},
    {10, 61},
    {52, 25},
    {27, 189},
    {12, 10},
    {33, 320},
    {33, 149},
    {10, 145},
    {29, 60},
    {35, 326},
    {35, 20},
    {22, 80},
    {42, 204},
    {10, 11},
    {38, 120},
    {45, 327},
    {11, 183},
    {50, 328},
    {9, 259},
    {13, 265},
    {58, 205},
    {36, 12},
    {44, 218},
    {27, 140},
    {51, 36},
    {41, 370},
    {60, 124},
    {55, 17},
    {30, 240},
    {8, 300},
    {13, 177},
    {47, 264},
    {9, 180},
    {45, 298},
    {52, 104},
    {29, 220},
    {4, 32},
    {51, 268},
    {52, 22},
    {59, 59},
    {3, 231},
    {9, 114},
    {51, 136},
    {50, 199},
    {4, 246},
    {9, 137},
    {42, 104},
    {29, 75},
    {29, 93},
    {28, 188},
    {14, 241},
    {40, 347},
    {23, 176},
    {9, 166},
    {8, 215},
    {7, 372},
    {11, 70},
    {25, 247},
    {48, 11},
    {52, 77},
    {46, 265},
    {48, 54},
    {49, 368},
    {15, 30},
    {49, 46},
    {41, 373},
    {50, 45},
    {56, 187},
    {47, 105},
    {25, 64},
    {3, 348},
    {10, 222},
    {50, 204},
    {50, 314},
    {0, 289},
    {42, 300},
    {35, 198},
    {38, 35},
    {51, 171},
    {23, 128},
    {8, 230},
    {18, 23},
    {48, 125},
    {47, 212},
    {9, 68},
    {3, 230},
    {25, 256},
    {42, 5},
    {42, 108},
    {43, 59},
    {46, 17},
    {11, 240},
    {3, 34},
    {36, 41},
    {11, 241},
    {19, 190},
    {43, 137},
    {44, 342},
    {6, 379},
    {30, 273},
    {48, 69},
    {35, 282},
    {22, 99},
    {26, 278},
    {59, 312},
    {37, 44},
    {49, 183},
    {48, 146},
    {47, 360},
    {43, 291},
    {38, 49},
    {44, 28},
    {32, 130},
    {40, 223},
    {4, 87},
    {52, 330},
    {10, 55},
    {7, 44},
    {13, 71},
    {11, 73},
    {49, 342},
    {0, 35},
    {9, 260},
    {6, 238},
    {8, 353},
    {0, 176},
    {5, 108},
    {52, 229},
    {55, 350},
    {8, 50},
    {51, 312},
    {54, 287},
    {13, 203},
    {48, 310},
    {49, 133},
    {42, 262},
    {10, 122},
    {15, 197},
    {31, 365},
    {35, 257},
    {1, 238},
    {6, 298},
    {33, 163},
    {56, 248},
    {56, 291},
    {40, 137},
    {9, 118},
    {33, 289},
    {48, 381},
    {41, 235},
    {49, 314},
    {54, 18},
    {42, 114},
    {45, 89},
    {50, 269},
    {27, 160},
    {51, 9},
    {59, 64},
    {39, 297},
    {52, 285},
    {39, 122},
    {23, 234},
    {47, 259},
    {52, 307},
    {39, 97},
    {40, 319},
    {39, 281},
    {39, 131},
    {42, 178},
    {52, 43},
    {60, 316},
    {45, 128},
    {40, 269},
    {43, 93},
    {42, 309},
    {6, 21},
    {36, 28},
    {31, 210},
    {41, 38},
    {8, 178},
    {50, 370},
    {47, 350},
    {39, 126},
    {9, 196},
    {9, 98},
    {45, 32},
    {44, 107},
    {40, 346},
    {14, 225},
    {60, 156},
    {40, 151},
    {60, 17},
    {51, 258},
    {31, 15},
    {48, 47},
    {0, 39},
    {39, 203},
    {26, 232},
    {51, 103},
    {60, 102},
    {46, 114},
    {14, 128},
    {39, 363},
    {43, 148},
    {45, 99},
    {40, 65},
    {44, 93},
    {18, 146},
    {50, 295},
    {51, 4},
    {36, 248},
    {52, 107},
    {6, 181},
    {60, 306},
    {4, 349},
    {43, 301},
    {52, 252},
    {52, 258},
    {51, 209},
    {9, 266},
    {49, 292},
    {44, 8},
    {51, 178},
    {44, 36},
    {37, 273},
    {26, 83},
    {0, 71},
    {8, 9},
    {31, 211},
    {51, 333},
    {59, 329},
    {41, 241},
    {31, 128},
    {40, 306},
    {42, 173},
    {54, 154},
    {32, 273},
    {42, 237},
    {49, 243},
    {40, 39},
    {52, 197},
    {44, 184},
    {39, 382},
    {59, 169},
    {42, 169},
    {41, 122},
    {52, 233},
    {44, 278},
    {44, 200},
    {25, 60},
    {41, 177},
    {60, 204},
    {42, 16},
    {38, 113},
    {41, 72},
    {26, 308},
    {43, 225},
    {41, 361},
    {50, 176},
    {42, 190},
    {51, 251},
    {0, 204},
    {44, 77},
    {42, 247},
    {41, 174},
    {13, 186},
    {44, 7},
    {44, 347},
    {48, 360},
    {45, 136},
    {31, 12},
    {31, 339},
    {40, 244},
    {47, 254},
    {41, 272},
    {41, 125},
    {59, 157},
    {47, 98},
    {33, 264},
    {44, 255},
    {44, 357},
    {38, 241},
    {35, 144},
    {40, 204},
    {40, 379},
    {47, 342},
    {46, 91},
    {41, 11},
    {45, 57},
    {43, 76},
    {1, 80},
    {42, 220},
    {49, 293},
    {40, 383},
    {48, 15},
    {36, 95},
    {41, 31},
    {40, 199},
    {42, 321},
    {40, 311},
    {0, 316},
    {0, 10},
    {41, 104},
    {40, 66},
    {31, 80},
    {35, 370},
    {40, 220},
    {49, 334},
    {27, 81},
    {39, 66},
    {49, 234},
    {31, 361},
    {41, 299},
    {31, 222},
    {41, 76},
    {41, 77},
    {53, 137},
    {48, 57},
    {0, 301},
    {36, 277},
    {40, 127},
    {41, 229},
    {40, 104},
    {46, 54},
    {41, 85},
    {49, 63},
    {41, 188},
    {52, 85},
    {44, 122},
    {41, 217},
    {42, 283},
    {45, 95},
    {41, 245},
    {53, 149},
    {40, 290},
    {40, 60},
    {40, 169},
    {2, 56},
    {48, 101},
    {41, 223},
};
static const uint32_t ds4_default_streaming_hotlist_pro_count =
    (uint32_t)(sizeof(ds4_default_streaming_hotlist_pro) /
               sizeof(ds4_default_streaming_hotlist_pro[0]));

/* DeepSeek V4 Flash default streaming expert hotlist. */
static const uint16_t ds4_default_streaming_hotlist_flash[][2] = {
    {25, 53},
    {22, 66},
    {38, 63},
    {40, 104},
    {34, 44},
    {28, 209},
    {32, 164},
    {39, 139},
    {28, 79},
    {38, 27},
    {13, 122},
    {27, 25},
    {36, 106},
    {26, 191},
    {33, 90},
    {40, 108},
    {26, 88},
    {41, 253},
    {31, 89},
    {12, 127},
    {7, 170},
    {17, 3},
    {42, 225},
    {29, 226},
    {8, 128},
    {36, 5},
    {21, 59},
    {33, 213},
    {5, 42},
    {18, 79},
    {5, 10},
    {7, 233},
    {9, 191},
    {36, 199},
    {7, 160},
    {15, 246},
    {4, 233},
    {34, 113},
    {6, 203},
    {8, 28},
    {8, 189},
    {11, 94},
    {36, 20},
    {13, 146},
    {37, 55},
    {15, 97},
    {30, 118},
    {42, 67},
    {31, 43},
    {24, 64},
    {16, 176},
    {35, 143},
    {37, 32},
    {40, 22},
    {27, 76},
    {3, 72},
    {4, 26},
    {6, 86},
    {24, 132},
    {29, 43},
    {10, 150},
    {18, 179},
    {39, 223},
    {17, 187},
    {7, 141},
    {4, 100},
    {25, 69},
    {29, 70},
    {37, 142},
    {30, 104},
    {23, 63},
    {39, 218},
    {42, 234},
    {31, 208},
    {33, 247},
    {36, 76},
    {29, 247},
    {32, 109},
    {15, 6},
    {12, 195},
    {13, 145},
    {11, 7},
    {18, 234},
    {41, 236},
    {4, 139},
    {24, 36},
    {25, 2},
    {37, 69},
    {38, 56},
    {27, 242},
    {3, 101},
    {8, 194},
    {11, 33},
    {11, 129},
    {22, 181},
    {37, 27},
    {24, 110},
    {34, 135},
    {37, 147},
    {10, 15},
    {13, 144},
    {14, 10},
    {19, 181},
    {25, 5},
    {8, 200},
    {3, 188},
    {36, 63},
    {19, 44},
    {14, 1},
    {20, 169},
    {42, 15},
    {14, 81},
    {14, 120},
    {40, 59},
    {21, 130},
    {33, 187},
    {16, 14},
    {20, 60},
    {19, 254},
    {27, 134},
    {28, 126},
    {18, 131},
    {9, 32},
    {15, 26},
    {8, 106},
    {26, 202},
    {18, 166},
    {31, 74},
    {5, 149},
    {13, 129},
    {24, 195},
    {32, 204},
    {26, 253},
    {14, 112},
    {3, 237},
    {14, 136},
    {24, 180},
    {28, 191},
    {40, 109},
    {6, 138},
    {9, 106},
    {12, 177},
    {30, 155},
    {3, 203},
    {9, 186},
    {14, 56},
    {23, 57},
    {23, 175},
    {27, 10},
    {28, 227},
    {18, 238},
    {11, 185},
    {14, 118},
    {26, 157},
    {15, 104},
    {5, 5},
    {6, 233},
    {10, 30},
    {13, 184},
    {14, 126},
    {9, 149},
    {16, 222},
    {38, 133},
    {20, 206},
    {29, 96},
    {3, 10},
    {15, 53},
    {30, 192},
    {23, 253},
    {26, 154},
    {32, 99},
    {24, 174},
    {10, 89},
    {11, 221},
    {12, 39},
    {25, 157},
    {34, 176},
    {7, 154},
    {27, 180},
    {41, 234},
    {4, 97},
    {17, 133},
    {23, 190},
    {30, 238},
    {41, 209},
    {9, 253},
    {16, 0},
    {16, 96},
    {17, 228},
    {22, 244},
    {28, 1},
    {35, 188},
    {35, 162},
    {36, 169},
    {40, 161},
    {15, 40},
    {15, 173},
    {26, 117},
    {26, 177},
    {34, 241},
    {38, 210},
    {28, 176},
    {33, 25},
    {6, 16},
    {21, 170},
    {24, 176},
    {41, 82},
    {42, 18},
    {4, 43},
    {8, 115},
    {16, 179},
    {25, 205},
    {30, 248},
    {34, 53},
    {34, 240},
    {4, 91},
    {17, 120},
    {27, 145},
    {35, 84},
    {40, 127},
    {30, 199},
    {20, 73},
    {31, 178},
    {3, 71},
    {9, 12},
    {35, 105},
    {42, 50},
    {5, 112},
    {15, 215},
    {28, 85},
    {40, 199},
    {41, 247},
    {7, 86},
    {17, 61},
    {26, 196},
    {30, 183},
    {42, 242},
    {6, 51},
    {6, 195},
    {12, 122},
    {12, 229},
    {12, 235},
    {29, 167},
    {39, 100},
    {10, 19},
    {14, 227},
    {32, 15},
    {11, 207},
    {13, 175},
    {15, 7},
    {17, 20},
    {18, 100},
    {25, 143},
    {5, 56},
    {6, 111},
    {9, 221},
    {11, 58},
    {14, 132},
    {20, 91},
    {22, 233},
    {32, 79},
    {3, 50},
    {16, 85},
    {38, 94},
    {38, 213},
    {12, 59},
    {14, 222},
    {28, 243},
    {32, 215},
    {41, 241},
    {12, 29},
    {16, 240},
    {23, 36},
    {23, 134},
    {25, 222},
    {29, 105},
    {40, 121},
    {42, 4},
    {6, 224},
    {15, 85},
    {16, 229},
    {17, 1},
    {18, 195},
    {21, 47},
    {31, 32},
    {32, 120},
    {6, 50},
    {10, 229},
    {12, 90},
    {13, 111},
    {22, 80},
    {22, 122},
    {31, 137},
    {31, 255},
    {33, 251},
    {36, 191},
    {41, 91},
    {15, 139},
    {20, 53},
    {23, 54},
    {25, 81},
    {26, 127},
    {29, 78},
    {34, 1},
    {35, 247},
    {37, 207},
    {5, 181},
    {7, 200},
    {9, 161},
    {24, 125},
    {26, 130},
    {27, 138},
    {33, 56},
    {7, 122},
    {9, 78},
    {11, 162},
    {14, 187},
    {16, 48},
    {20, 163},
    {37, 122},
    {4, 38},
    {6, 134},
    {12, 171},
    {13, 41},
    {21, 201},
    {27, 233},
    {34, 136},
    {3, 241},
    {17, 125},
    {22, 50},
    {23, 100},
    {23, 224},
    {30, 163},
    {34, 178},
    {21, 176},
    {23, 39},
    {25, 17},
    {34, 209},
    {39, 60},
    {40, 208},
    {3, 176},
    {10, 248},
    {12, 100},
    {16, 29},
    {16, 193},
    {19, 60},
    {20, 144},
    {32, 53},
    {35, 0},
    {37, 70},
    {41, 32},
    {5, 126},
    {8, 168},
    {12, 248},
    {15, 174},
    {17, 50},
    {23, 71},
    {23, 132},
    {29, 109},
    {33, 160},
    {41, 235},
    {42, 80},
    {6, 80},
    {7, 214},
    {12, 68},
    {13, 173},
    {17, 26},
    {19, 134},
    {20, 88},
    {21, 49},
    {25, 174},
    {30, 184},
    {32, 68},
    {32, 254},
    {33, 132},
    {35, 158},
    {35, 240},
    {41, 0},
    {4, 32},
    {8, 15},
    {9, 122},
    {11, 191},
    {12, 131},
    {13, 172},
    {15, 249},
    {16, 13},
    {17, 41},
    {21, 190},
    {22, 197},
    {23, 140},
    {26, 218},
    {31, 84},
    {33, 147},
    {41, 190},
    {42, 244},
    {12, 108},
    {13, 165},
    {18, 37},
    {18, 182},
    {21, 173},
    {22, 16},
    {27, 236},
    {28, 198},
    {30, 0},
    {31, 55},
    {33, 233},
    {35, 35},
    {37, 186},
    {38, 255},
    {39, 194},
    {41, 23},
    {41, 102},
    {10, 216},
    {12, 140},
    {18, 213},
    {19, 13},
    {21, 72},
    {21, 208},
    {21, 228},
    {25, 183},
    {29, 235},
    {30, 247},
    {32, 114},
    {35, 156},
    {39, 70},
    {41, 44},
    {9, 60},
    {12, 26},
    {14, 153},
    {15, 148},
    {21, 111},
    {21, 247},
    {23, 2},
    {23, 7},
    {23, 103},
    {27, 248},
    {30, 170},
    {32, 246},
    {35, 252},
    {36, 69},
    {37, 6},
    {38, 244},
    {39, 9},
    {42, 125},
    {3, 102},
    {6, 125},
    {8, 231},
    {14, 196},
    {19, 222},
    {21, 65},
    {23, 160},
    {23, 165},
    {27, 77},
    {28, 25},
    {31, 63},
    {31, 142},
    {35, 48},
    {35, 182},
    {35, 254},
    {38, 178},
    {39, 180},
    {41, 36},
    {42, 131},
    {42, 233},
    {4, 137},
    {7, 54},
    {7, 194},
    {8, 29},
    {12, 8},
    {13, 230},
    {16, 129},
    {18, 232},
    {19, 202},
    {20, 103},
    {21, 42},
    {22, 214},
    {23, 119},
    {30, 33},
    {32, 96},
    {35, 71},
    {35, 110},
    {3, 193},
    {10, 33},
    {10, 125},
    {16, 16},
    {19, 207},
    {20, 94},
    {20, 181},
    {21, 151},
    {21, 155},
    {21, 198},
    {33, 69},
    {35, 206},
    {41, 95},
    {41, 170},
    {42, 239},
    {4, 39},
    {5, 40},
    {5, 164},
    {10, 24},
    {11, 59},
    {12, 128},
    {12, 168},
    {13, 185},
    {14, 97},
    {16, 52},
    {16, 74},
    {16, 177},
    {17, 112},
    {17, 138},
    {17, 252},
    {18, 9},
    {18, 60},
    {19, 168},
    {20, 173},
    {20, 242},
    {21, 91},
    {21, 123},
    {21, 251},
    {22, 23},
    {23, 240},
    {24, 170},
    {24, 223},
    {29, 76},
    {29, 159},
    {29, 180},
    {30, 59},
    {31, 112},
    {32, 231},
    {34, 5},
    {40, 30},
    {11, 41},
    {14, 82},
    {14, 131},
    {15, 134},
    {16, 104},
    {19, 212},
    {19, 249},
    {21, 138},
    {30, 19},
    {31, 161},
    {31, 229},
    {35, 142},
    {37, 148},
    {37, 253},
    {39, 54},
    {39, 170},
    {41, 171},
    {3, 108},
    {4, 177},
    {9, 24},
    {9, 226},
    {9, 242},
    {11, 182},
    {13, 42},
    {16, 171},
    {17, 84},
    {17, 109},
    {18, 107},
    {20, 22},
    {20, 200},
    {20, 255},
    {22, 2},
    {22, 215},
    {23, 172},
    {29, 88},
    {29, 115},
    {29, 238},
    {32, 136},
    {33, 43},
    {39, 11},
    {39, 108},
    {39, 221},
    {40, 146},
    {0, 112},
    {4, 33},
    {6, 253},
    {11, 176},
    {11, 232},
    {16, 37},
    {17, 204},
    {18, 57},
    {19, 28},
    {19, 174},
    {20, 116},
    {22, 144},
    {22, 170},
    {23, 75},
    {24, 198},
    {28, 107},
    {30, 36},
    {30, 243},
    {34, 180},
    {35, 6},
    {35, 85},
    {39, 144},
    {40, 12},
    {41, 208},
    {42, 7},
    {0, 106},
    {5, 186},
    {7, 196},
    {8, 74},
    {9, 240},
    {10, 84},
    {11, 93},
    {11, 113},
    {15, 8},
    {16, 209},
    {17, 241},
    {18, 46},
    {19, 251},
    {21, 121},
    {26, 94},
    {28, 8},
    {28, 117},
    {28, 151},
    {30, 177},
    {32, 233},
    {32, 240},
    {34, 93},
    {34, 175},
    {35, 108},
    {36, 159},
    {37, 13},
    {38, 149},
    {39, 115},
    {4, 53},
    {7, 43},
    {7, 242},
    {10, 81},
    {10, 197},
    {11, 23},
    {14, 198},
    {18, 242},
    {19, 5},
    {19, 47},
    {19, 210},
    {20, 145},
    {21, 48},
    {21, 135},
    {22, 78},
    {22, 201},
    {24, 108},
    {24, 231},
    {25, 54},
    {29, 17},
    {31, 65},
    {35, 179},
    {36, 165},
    {36, 237},
    {38, 61},
    {38, 162},
    {40, 107},
    {41, 52},
    {41, 78},
    {41, 239},
    {4, 104},
    {5, 217},
    {6, 170},
    {7, 76},
    {8, 91},
    {11, 117},
    {12, 152},
    {13, 14},
    {14, 210},
    {17, 6},
    {17, 75},
    {18, 160},
    {19, 131},
    {20, 0},
    {22, 26},
    {22, 91},
    {25, 16},
    {25, 51},
    {25, 116},
    {25, 195},
    {27, 93},
    {27, 104},
    {27, 250},
    {29, 205},
    {30, 117},
    {32, 25},
    {33, 45},
    {34, 6},
    {39, 117},
    {40, 24},
    {40, 111},
    {40, 145},
    {41, 167},
    {42, 79},
    {42, 240},
    {0, 86},
    {1, 2},
    {1, 179},
    {2, 5},
    {2, 68},
    {2, 134},
    {4, 27},
    {5, 208},
    {6, 29},
    {6, 162},
    {7, 125},
    {8, 195},
    {9, 90},
    {10, 92},
    {10, 135},
    {10, 164},
    {11, 105},
    {14, 201},
    {15, 137},
    {15, 244},
    {19, 182},
    {19, 228},
    {21, 28},
    {22, 49},
    {23, 35},
    {24, 6},
    {24, 106},
    {28, 13},
    {29, 24},
    {29, 246},
    {30, 12},
    {30, 101},
    {32, 147},
    {33, 177},
    {34, 225},
    {35, 170},
    {37, 48},
    {38, 227},
    {0, 132},
    {2, 198},
    {3, 61},
    {3, 185},
    {5, 93},
    {5, 204},
    {8, 141},
    {8, 239},
    {9, 131},
    {10, 98},
    {11, 6},
    {14, 147},
    {16, 107},
    {16, 115},
    {16, 120},
    {17, 179},
    {19, 3},
    {19, 64},
    {19, 211},
    {21, 45},
    {21, 188},
    {22, 105},
    {26, 233},
    {28, 93},
    {28, 249},
    {29, 215},
    {30, 111},
    {33, 131},
    {33, 228},
    {35, 50},
    {35, 74},
    {36, 249},
    {37, 136},
    {39, 154},
    {40, 132},
    {41, 58},
    {41, 107},
    {42, 162},
    {0, 115},
    {4, 128},
    {5, 107},
    {5, 246},
    {6, 3},
    {6, 28},
    {8, 196},
    {10, 46},
    {10, 140},
    {10, 172},
    {10, 215},
    {10, 235},
    {12, 49},
    {15, 122},
    {16, 151},
    {17, 101},
    {18, 45},
    {18, 151},
    {19, 10},
    {19, 73},
    {19, 110},
    {20, 29},
    {20, 187},
    {20, 213},
    {20, 229},
    {21, 89},
    {21, 99},
    {22, 115},
    {24, 11},
    {24, 126},
    {25, 32},
    {25, 151},
    {26, 35},
    {26, 141},
    {27, 105},
    {28, 188},
    {30, 194},
    {30, 221},
    {31, 120},
    {32, 95},
    {32, 213},
    {34, 58},
    {37, 170},
    {37, 173},
    {38, 221},
    {39, 49},
    {39, 101},
    {39, 175},
    {1, 96},
    {2, 236},
    {2, 245},
    {3, 172},
    {3, 173},
    {4, 220},
    {5, 22},
    {6, 62},
    {7, 71},
    {8, 1},
    {9, 155},
    {9, 245},
    {9, 246},
    {10, 18},
    {10, 49},
    {10, 203},
    {11, 19},
    {13, 57},
    {16, 166},
    {17, 202},
    {18, 98},
    {20, 182},
    {20, 199},
    {21, 179},
    {22, 34},
    {22, 46},
    {22, 75},
    {23, 44},
    {23, 108},
    {26, 169},
    {27, 174},
    {31, 193},
    {32, 154},
    {32, 175},
    {33, 47},
    {34, 238},
    {34, 246},
    {35, 49},
    {36, 77},
    {36, 158},
    {37, 114},
    {37, 233},
    {39, 214},
    {39, 226},
    {41, 117},
    {41, 128},
    {41, 161},
    {42, 250},
    {0, 44},
    {0, 76},
    {0, 240},
    {1, 77},
    {1, 245},
    {2, 21},
    {2, 66},
    {2, 184},
    {3, 15},
    {4, 235},
    {5, 49},
    {5, 203},
    {6, 1},
    {7, 252},
    {9, 2},
    {9, 55},
    {9, 251},
    {11, 20},
    {11, 102},
    {11, 244},
    {12, 25},
    {12, 169},
    {13, 40},
    {13, 157},
    {13, 159},
    {14, 158},
    {15, 167},
    {16, 24},
    {16, 147},
    {17, 66},
    {17, 195},
    {19, 25},
    {20, 251},
    {21, 156},
    {21, 219},
    {22, 24},
    {22, 83},
    {22, 89},
    {23, 168},
    {24, 220},
    {25, 63},
    {26, 19},
    {26, 129},
    {27, 56},
    {29, 55},
    {29, 222},
    {30, 136},
    {30, 145},
    {30, 228},
    {31, 6},
    {31, 52},
    {31, 252},
    {32, 121},
    {32, 239},
    {33, 152},
    {33, 203},
    {34, 68},
    {34, 109},
    {34, 184},
    {35, 117},
    {35, 137},
    {35, 243},
    {36, 127},
    {36, 220},
    {38, 47},
    {42, 70},
    {42, 85},
    {42, 133},
    {42, 159},
    {42, 161},
    {0, 100},
    {0, 212},
    {1, 20},
    {1, 157},
    {1, 162},
    {1, 182},
    {1, 216},
    {2, 48},
    {3, 68},
    {3, 84},
    {3, 142},
    {3, 148},
    {3, 240},
    {4, 248},
    {5, 220},
    {5, 245},
    {5, 254},
    {6, 92},
    {6, 168},
    {7, 139},
    {9, 179},
    {10, 71},
    {10, 149},
    {11, 187},
    {11, 227},
    {12, 16},
    {12, 123},
    {12, 209},
    {13, 66},
    {14, 13},
    {14, 184},
    {16, 228},
    {17, 215},
    {18, 90},
    {18, 143},
    {19, 220},
    {19, 233},
    {20, 160},
    {21, 248},
    {22, 18},
    {22, 117},
    {23, 118},
    {23, 208},
    {24, 31},
    {24, 41},
    {24, 155},
    {25, 118},
    {25, 175},
    {25, 189},
    {25, 241},
    {27, 141},
    {27, 152},
    {29, 35},
    {29, 153},
    {30, 75},
    {31, 2},
    {31, 38},
    {31, 129},
    {32, 104},
    {32, 173},
    {33, 28},
    {33, 196},
    {34, 8},
    {34, 97},
    {35, 224},
    {36, 144},
    {36, 154},
    {37, 242},
    {38, 84},
    {38, 89},
    {39, 59},
    {39, 87},
    {39, 229},
    {40, 130},
    {0, 165},
    {1, 19},
    {1, 49},
    {1, 112},
    {1, 197},
    {2, 89},
    {2, 183},
    {2, 185},
    {2, 207},
    {5, 62},
    {5, 228},
    {6, 157},
    {6, 205},
    {6, 239},
    {7, 80},
    {8, 80},
    {9, 80},
    {9, 187},
    {10, 116},
    {11, 125},
    {12, 15},
    {12, 104},
    {12, 223},
    {13, 75},
    {13, 116},
    {14, 46},
    {14, 91},
    {14, 133},
    {14, 245},
    {16, 198},
    {16, 201},
    {16, 211},
    {17, 219},
    {18, 194},
    {19, 54},
    {19, 112},
    {19, 218},
    {20, 95},
    {20, 166},
    {20, 167},
    {20, 178},
    {20, 232},
    {20, 247},
    {21, 4},
    {21, 34},
    {22, 10},
    {22, 251},
    {23, 66},
    {24, 62},
    {24, 80},
    {25, 114},
    {25, 120},
    {27, 211},
    {28, 138},
    {29, 67},
    {30, 84},
    {30, 106},
    {30, 156},
    {31, 88},
    {31, 166},
    {32, 118},
    {32, 212},
    {34, 149},
    {34, 183},
    {35, 201},
    {36, 115},
    {37, 33},
    {38, 59},
    {38, 218},
    {38, 248},
    {39, 15},
    {40, 151},
    {40, 166},
    {40, 255},
    {41, 232},
    {42, 0},
    {42, 149},
    {0, 13},
    {0, 118},
    {0, 159},
    {0, 178},
    {1, 6},
    {1, 127},
    {2, 33},
    {2, 141},
    {2, 164},
    {3, 92},
    {3, 133},
    {4, 249},
    {5, 76},
    {6, 95},
    {8, 249},
    {9, 18},
    {9, 206},
    {10, 31},
    {10, 42},
    {10, 47},
    {10, 73},
    {10, 146},
    {10, 176},
    {11, 3},
    {11, 144},
    {12, 110},
    {12, 125},
    {13, 28},
    {14, 124},
    {16, 64},
    {16, 189},
    {17, 38},
    {18, 80},
    {18, 163},
    {18, 217},
    {19, 43},
    {19, 45},
    {19, 141},
    {19, 161},
    {19, 180},
    {21, 38},
    {21, 85},
    {22, 55},
    {22, 74},
    {22, 156},
    {23, 193},
    {24, 56},
    {24, 156},
    {24, 167},
    {24, 246},
    {25, 201},
    {26, 28},
    {26, 188},
    {27, 27},
    {27, 95},
    {28, 125},
    {29, 9},
    {29, 196},
    {30, 30},
    {30, 31},
    {30, 50},
    {31, 190},
    {31, 246},
    {32, 252},
    {33, 77},
    {33, 91},
    {34, 127},
    {35, 146},
    {35, 195},
    {35, 212},
    {36, 70},
    {37, 115},
    {37, 157},
    {37, 225},
    {38, 86},
    {39, 21},
    {39, 168},
    {39, 182},
    {40, 105},
    {41, 166},
    {42, 182},
    {0, 15},
    {0, 66},
    {0, 224},
    {1, 26},
    {1, 36},
    {1, 114},
    {1, 151},
    {1, 212},
    {2, 20},
    {2, 74},
    {2, 108},
    {2, 129},
    {2, 209},
    {2, 223},
    {3, 4},
    {3, 23},
    {3, 89},
    {3, 165},
    {3, 198},
    {3, 247},
    {4, 80},
    {4, 124},
    {5, 101},
    {5, 239},
    {6, 130},
    {6, 174},
    {7, 15},
    {7, 253},
    {8, 105},
    {9, 10},
    {9, 49},
    {9, 126},
    {10, 0},
    {10, 12},
    {10, 108},
    {10, 168},
    {10, 211},
    {10, 230},
    {10, 250},
    {10, 251},
    {12, 200},
    {12, 202},
    {13, 217},
    {14, 47},
    {14, 223},
    {15, 9},
    {15, 241},
    {16, 39},
    {16, 169},
    {16, 230},
    {17, 121},
    {17, 157},
    {18, 2},
    {18, 215},
    {19, 11},
    {19, 31},
    {19, 130},
    {19, 140},
    {19, 223},
    {19, 238},
    {19, 246},
    {20, 37},
    {20, 64},
    {20, 69},
    {20, 96},
    {20, 115},
    {20, 118},
    {20, 192},
    {22, 48},
    {22, 73},
    {22, 107},
    {22, 134},
    {23, 68},
    {23, 104},
    {23, 242},
    {24, 0},
    {24, 133},
    {25, 108},
    {26, 192},
    {27, 26},
    {27, 31},
    {27, 175},
    {27, 219},
    {29, 132},
    {30, 82},
    {31, 254},
    {32, 22},
    {32, 221},
    {33, 50},
    {33, 144},
    {33, 146},
    {34, 94},
    {35, 21},
    {35, 109},
    {37, 91},
    {37, 171},
    {37, 240},
    {38, 167},
    {38, 168},
    {38, 201},
    {38, 231},
    {39, 86},
    {39, 129},
    {39, 199},
    {40, 91},
    {41, 160},
    {42, 36},
    {42, 192},
    {0, 154},
    {0, 174},
    {0, 211},
    {0, 225},
    {0, 232},
    {1, 13},
    {1, 75},
    {1, 97},
    {1, 103},
    {1, 137},
    {1, 163},
    {1, 201},
    {1, 229},
    {1, 250},
    {2, 40},
    {2, 49},
    {2, 62},
    {2, 208},
    {2, 247},
    {3, 7},
    {3, 57},
    {3, 83},
    {3, 244},
    {4, 37},
    {4, 83},
    {4, 138},
    {4, 192},
    {4, 250},
    {5, 79},
    {5, 114},
    {5, 175},
    {6, 9},
    {6, 83},
    {6, 192},
    {7, 61},
    {7, 121},
    {7, 140},
    {7, 143},
    {8, 67},
    {9, 48},
    {9, 83},
    {9, 167},
    {9, 172},
    {9, 174},
    {9, 218},
    {10, 2},
    {10, 41},
    {10, 99},
    {10, 101},
    {10, 147},
    {11, 2},
    {11, 11},
    {11, 80},
    {11, 89},
    {11, 110},
    {11, 151},
    {11, 174},
    {12, 252},
    {13, 104},
    {13, 190},
    {13, 204},
    {14, 86},
    {14, 94},
    {15, 87},
    {16, 43},
    {16, 236},
    {16, 245},
    {17, 16},
    {17, 43},
    {17, 108},
    {17, 188},
    {19, 22},
    {19, 74},
    {19, 97},
    {19, 160},
    {20, 55},
    {20, 235},
    {21, 1},
    {21, 11},
    {21, 46},
    {21, 238},
    {22, 209},
    {22, 220},
    {22, 253},
    {23, 17},
    {23, 182},
    {24, 63},
    {24, 122},
    {24, 212},
    {25, 43},
    {26, 18},
    {26, 197},
    {27, 100},
    {27, 203},
    {27, 227},
    {28, 28},
    {29, 31},
    {30, 35},
    {30, 123},
    {30, 222},
    {30, 236},
    {31, 54},
    {31, 62},
    {31, 143},
    {31, 181},
    {31, 226},
    {32, 24},
    {32, 160},
    {32, 237},
    {33, 54},
    {34, 29},
    {34, 85},
    {37, 102},
    {37, 155},
    {37, 239},
    {38, 165},
    {39, 85},
    {39, 150},
    {39, 234},
    {39, 242},
    {40, 76},
    {40, 114},
    {41, 97},
    {41, 141},
    {41, 192},
    {41, 238},
    {42, 34},
    {42, 81},
    {42, 140},
    {0, 1},
    {0, 62},
    {0, 116},
    {0, 117},
    {0, 126},
    {0, 139},
    {0, 218},
    {0, 222},
    {0, 230},
    {0, 231},
    {0, 242},
    {1, 76},
    {1, 153},
    {1, 155},
    {1, 178},
    {1, 192},
    {1, 193},
    {1, 249},
    {2, 15},
    {2, 59},
    {2, 87},
    {2, 93},
    {2, 112},
    {2, 115},
    {2, 153},
    {2, 167},
    {2, 172},
    {4, 15},
    {4, 73},
    {5, 29},
    {5, 115},
    {5, 160},
    {5, 209},
    {5, 224},
    {6, 31},
    {6, 58},
    {6, 129},
    {6, 165},
    {6, 166},
    {7, 51},
    {7, 168},
    {7, 226},
    {9, 44},
    {9, 96},
    {9, 166},
    {10, 130},
    {10, 156},
    {10, 210},
    {10, 217},
    {11, 24},
    {11, 79},
    {11, 138},
    {11, 224},
    {12, 142},
    {12, 196},
    {12, 246},
    {13, 96},
    {13, 139},
    {14, 11},
    {14, 138},
    {14, 235},
    {15, 60},
    {15, 176},
    {16, 119},
    {17, 69},
    {17, 127},
    {17, 128},
    {17, 134},
    {17, 208},
    {17, 224},
    {18, 85},
    {18, 88},
    {18, 187},
    {19, 83},
    {19, 102},
    {19, 193},
    {19, 197},
    {19, 253},
    {20, 32},
    {20, 49},
    {20, 98},
    {20, 112},
    {20, 124},
    {20, 129},
    {20, 130},
    {20, 134},
    {20, 184},
    {21, 6},
    {21, 249},
    {22, 99},
    {22, 250},
    {23, 95},
    {24, 33},
    {24, 118},
    {24, 240},
    {25, 26},
    {25, 228},
    {26, 178},
    {26, 209},
    {26, 215},
    {27, 200},
    {28, 29},
    {28, 71},
    {28, 158},
    {28, 162},
    {29, 243},
    {30, 94},
    {30, 141},
    {30, 173},
    {31, 27},
    {31, 57},
    {31, 76},
    {32, 12},
    {32, 170},
    {32, 188},
    {32, 219},
    {33, 112},
    {33, 128},
    {34, 13},
    {34, 107},
    {34, 164},
    {34, 250},
    {35, 2},
    {35, 63},
    {35, 111},
    {35, 126},
    {35, 133},
    {35, 216},
    {36, 18},
    {37, 94},
    {38, 105},
    {39, 90},
    {39, 207},
    {39, 220},
    {42, 30},
    {42, 98},
    {42, 232},
    {0, 69},
    {0, 89},
    {0, 107},
    {0, 111},
    {0, 113},
    {0, 123},
    {0, 129},
    {0, 210},
    {0, 250},
    {1, 7},
    {1, 51},
    {1, 68},
    {1, 69},
    {1, 84},
    {1, 118},
    {1, 187},
    {1, 224},
    {1, 230},
    {1, 231},
    {1, 232},
    {1, 251},
    {2, 7},
    {2, 12},
    {2, 22},
    {2, 55},
    {2, 119},
    {2, 128},
    {2, 137},
    {2, 146},
    {2, 173},
    {2, 193},
    {2, 212},
    {3, 103},
    {3, 105},
    {3, 107},
    {3, 223},
    {4, 45},
    {4, 94},
    {4, 95},
    {4, 164},
    {4, 226},
    {5, 45},
    {5, 85},
    {5, 132},
    {6, 15},
    {6, 91},
    {6, 112},
    {6, 121},
    {6, 132},
    {6, 194},
    {7, 74},
    {7, 221},
    {7, 239},
    {8, 24},
    {8, 45},
    {8, 146},
    {9, 13},
    {9, 105},
    {9, 198},
    {10, 8},
    {10, 234},
    {11, 84},
    {11, 169},
    {12, 215},
    {13, 94},
    {13, 95},
    {13, 115},
    {13, 123},
    {15, 43},
    {15, 105},
    {15, 217},
    {15, 218},
    {16, 46},
    {16, 173},
    {16, 192},
    {16, 231},
    {17, 123},
    {17, 166},
    {17, 168},
    {18, 141},
    {19, 8},
    {19, 93},
    {19, 209},
    {19, 216},
    {20, 77},
    {20, 93},
    {20, 122},
    {20, 219},
    {20, 220},
    {20, 252},
    {22, 51},
    {22, 52},
    {22, 61},
    {22, 64},
    {22, 157},
    {22, 190},
    {23, 21},
    {23, 23},
    {23, 64},
    {23, 73},
    {23, 125},
    {23, 142},
    {23, 159},
    {23, 221},
    {23, 249},
    {24, 218},
    {25, 71},
    {25, 212},
    {26, 54},
    {26, 131},
    {26, 179},
    {26, 228},
    {26, 245},
    {27, 37},
    {27, 73},
    {27, 80},
    {27, 133},
    {27, 163},
    {27, 224},
    {27, 247},
    {27, 254},
    {29, 4},
    {29, 60},
    {29, 85},
    {29, 93},
    {29, 240},
    {30, 7},
    {31, 21},
    {31, 80},
    {31, 102},
    {31, 144},
    {31, 156},
    {31, 169},
    {31, 223},
    {32, 2},
    {33, 29},
    {33, 38},
    {33, 116},
    {33, 181},
    {33, 216},
    {33, 249},
    {34, 242},
    {34, 247},
    {35, 29},
    {35, 57},
    {35, 61},
    {35, 113},
    {35, 144},
    {36, 153},
    {37, 162},
    {38, 34},
    {38, 80},
    {38, 148},
    {38, 253},
    {40, 54},
    {41, 63},
    {42, 73},
    {42, 112},
    {42, 117},
    {42, 189},
    {0, 2},
    {0, 29},
    {0, 40},
    {0, 51},
    {0, 77},
    {0, 168},
    {0, 190},
    {0, 195},
    {0, 200},
    {0, 204},
    {0, 205},
    {0, 248},
    {1, 32},
    {1, 52},
    {1, 78},
    {1, 85},
    {1, 99},
    {1, 122},
    {1, 133},
    {1, 140},
    {1, 154},
    {1, 175},
    {1, 185},
    {1, 210},
    {2, 13},
    {2, 19},
    {2, 32},
    {2, 39},
    {2, 61},
    {2, 76},
    {2, 113},
    {2, 120},
    {2, 174},
    {2, 181},
    {2, 195},
    {2, 231},
    {2, 238},
    {3, 0},
    {3, 14},
    {3, 17},
    {3, 26},
    {3, 139},
    {4, 56},
    {4, 68},
    {4, 112},
    {4, 114},
    {4, 209},
    {4, 216},
    {5, 1},
    {5, 47},
    {5, 242},
    {6, 254},
    {7, 30},
    {7, 32},
    {7, 181},
    {7, 188},
    {7, 235},
    {8, 13},
    {8, 161},
    {9, 53},
    {9, 81},
    {9, 118},
    {9, 133},
    {9, 181},
    {9, 219},
    {10, 7},
    {10, 40},
    {10, 44},
    {10, 142},
    {10, 162},
    {10, 178},
    {10, 214},
    {10, 232},
    {11, 30},
    {11, 88},
    {11, 243},
    {12, 64},
    {12, 220},
    {12, 239},
    {13, 63},
    {13, 127},
    {13, 197},
    {13, 252},
    {14, 6},
    {14, 73},
    {14, 205},
    {15, 10},
    {15, 66},
    {15, 82},
    {15, 130},
    {15, 196},
    {15, 213},
    {16, 102},
    {16, 105},
    {16, 137},
    {16, 139},
    {16, 181},
    {16, 191},
    {17, 117},
    {18, 6},
    {18, 32},
    {18, 128},
    {18, 157},
    {18, 173},
    {18, 233},
    {19, 103},
    {19, 108},
    {19, 123},
    {19, 148},
    {19, 158},
    {19, 170},
    {20, 12},
    {20, 48},
    {20, 162},
    {20, 202},
    {21, 26},
    {21, 78},
    {21, 137},
    {22, 27},
    {22, 62},
    {23, 43},
    {23, 60},
    {23, 115},
    {23, 173},
    {24, 48},
    {24, 59},
    {24, 77},
    {24, 96},
    {24, 134},
    {24, 166},
    {24, 222},
    {25, 65},
    {25, 103},
    {25, 197},
    {26, 71},
    {26, 213},
    {27, 14},
    {27, 102},
    {27, 235},
    {28, 19},
    {28, 51},
    {28, 67},
    {29, 12},
    {29, 44},
    {29, 94},
    {29, 126},
    {29, 165},
    {30, 41},
    {30, 105},
    {30, 200},
    {30, 251},
    {31, 34},
    {32, 140},
    {32, 158},
    {32, 172},
    {33, 7},
    {33, 104},
    {33, 118},
    {33, 136},
    {33, 209},
    {34, 69},
    {34, 249},
    {35, 51},
    {35, 124},
    {35, 127},
    {35, 229},
    {36, 126},
    {37, 2},
    {37, 112},
    {37, 152},
    {37, 159},
    {37, 175},
    {38, 30},
    {38, 33},
    {38, 145},
    {38, 216},
    {39, 45},
    {39, 89},
    {39, 140},
    {39, 146},
    {39, 165},
    {39, 177},
    {39, 181},
    {39, 208},
    {40, 135},
    {41, 140},
    {41, 197},
    {41, 214},
    {42, 14},
    {42, 107},
    {42, 165},
    {0, 4},
    {0, 6},
    {0, 14},
    {0, 18},
    {0, 19},
    {0, 25},
    {0, 27},
    {0, 54},
    {0, 58},
    {0, 60},
    {0, 63},
    {0, 74},
    {0, 75},
    {0, 79},
    {0, 85},
    {0, 91},
    {0, 98},
    {0, 105},
    {0, 122},
    {0, 131},
    {0, 150},
    {0, 152},
    {0, 177},
    {0, 184},
    {0, 189},
    {0, 194},
    {0, 202},
    {0, 229},
    {0, 236},
    {1, 4},
    {1, 5},
    {1, 21},
    {1, 25},
    {1, 29},
    {1, 30},
    {1, 47},
    {1, 58},
    {1, 65},
    {1, 79},
    {1, 82},
    {1, 86},
    {1, 91},
    {1, 110},
    {1, 116},
    {1, 120},
    {1, 136},
    {1, 141},
    {1, 161},
    {1, 164},
    {1, 169},
    {1, 183},
    {1, 217},
    {2, 6},
    {2, 10},
    {2, 36},
    {2, 58},
    {2, 63},
    {2, 77},
    {2, 101},
    {2, 133},
    {2, 199},
    {2, 227},
    {2, 233},
    {2, 239},
    {2, 251},
    {3, 3},
    {3, 109},
    {4, 21},
    {4, 69},
    {4, 136},
    {4, 150},
    {4, 165},
    {4, 194},
    {4, 242},
    {4, 251},
    {5, 83},
    {5, 133},
    {5, 150},
    {5, 155},
    {5, 161},
    {5, 176},
    {5, 183},
    {6, 103},
    {6, 120},
    {6, 137},
    {7, 23},
    {7, 28},
    {7, 90},
    {7, 182},
    {7, 185},
    {7, 187},
    {8, 51},
    {8, 81},
    {8, 103},
    {8, 118},
    {8, 180},
    {8, 210},
    {8, 213},
    {9, 58},
    {9, 140},
    {9, 162},
    {11, 26},
    {11, 96},
    {11, 141},
    {11, 193},
    {11, 204},
    {12, 188},
    {13, 12},
    {13, 222},
    {13, 225},
    {14, 15},
    {14, 139},
    {14, 206},
    {15, 45},
    {15, 59},
    {15, 64},
    {15, 119},
    {15, 141},
    {15, 151},
    {15, 240},
    {16, 59},
    {16, 110},
    {17, 71},
    {17, 76},
    {17, 124},
    {17, 177},
    {17, 205},
    {17, 234},
    {17, 243},
    {18, 39},
    {18, 198},
    {19, 68},
    {19, 149},
    {19, 189},
    {19, 203},
    {20, 7},
    {20, 74},
    {20, 110},
    {20, 216},
    {21, 50},
    {21, 234},
    {21, 239},
    {21, 245},
    {22, 68},
    {22, 102},
    {22, 169},
    {23, 107},
    {23, 167},
    {24, 40},
    {24, 58},
    {24, 150},
    {24, 153},
    {25, 4},
    {25, 135},
    {26, 3},
    {26, 16},
    {26, 142},
    {26, 204},
    {27, 94},
    {27, 106},
    {27, 143},
    {27, 193},
    {27, 209},
    {28, 146},
    {29, 28},
    {29, 68},
    {29, 182},
    {29, 186},
    {29, 195},
    {29, 239},
    {29, 249},
    {30, 18},
    {30, 45},
    {31, 109},
    {31, 133},
    {31, 238},
    {32, 33},
    {32, 86},
    {32, 113},
    {32, 131},
    {32, 146},
    {32, 168},
    {33, 19},
    {33, 75},
    {33, 166},
    {34, 233},
    {35, 119},
    {35, 138},
    {35, 150},
    {35, 198},
    {35, 202},
    {35, 210},
    {36, 172},
    {37, 1},
    {37, 12},
    {37, 15},
    {37, 57},
    {37, 82},
    {37, 123},
    {37, 191},
    {37, 201},
    {37, 213},
    {37, 254},
    {38, 3},
    {38, 13},
    {39, 55},
    {39, 149},
    {39, 200},
    {39, 203},
    {40, 242},
    {41, 5},
    {41, 54},
    {41, 59},
    {41, 81},
    {41, 127},
    {41, 129},
    {41, 153},
    {42, 21},
    {42, 64},
    {42, 78},
    {42, 224},
    {0, 16},
    {0, 24},
    {0, 30},
    {0, 39},
    {0, 42},
    {0, 46},
    {0, 70},
    {0, 95},
    {0, 96},
    {0, 97},
    {0, 120},
    {0, 127},
    {0, 135},
    {0, 166},
    {0, 186},
    {0, 188},
    {0, 245},
    {1, 18},
    {1, 31},
    {1, 35},
    {1, 48},
    {1, 64},
    {1, 72},
    {1, 80},
    {1, 100},
    {1, 111},
    {1, 138},
    {1, 142},
    {1, 172},
    {1, 186},
    {1, 196},
    {1, 255},
    {2, 0},
    {2, 4},
    {2, 8},
    {2, 11},
    {2, 31},
    {2, 34},
    {2, 44},
    {2, 52},
    {2, 60},
    {2, 79},
    {2, 80},
    {2, 106},
    {2, 122},
    {2, 131},
    {2, 135},
    {2, 140},
    {2, 156},
    {2, 160},
    {2, 182},
    {2, 214},
    {2, 219},
    {2, 230},
    {2, 242},
    {3, 13},
    {3, 18},
    {3, 36},
    {3, 123},
    {3, 200},
    {3, 227},
    {3, 233},
    {3, 252},
    {4, 81},
    {4, 127},
    {4, 131},
    {4, 154},
    {4, 175},
    {4, 186},
    {4, 189},
    {4, 213},
    {4, 236},
    {5, 43},
    {5, 64},
    {5, 94},
    {5, 154},
    {5, 159},
    {5, 171},
    {5, 193},
    {5, 222},
    {5, 237},
    {6, 117},
    {6, 139},
    {6, 144},
    {6, 149},
    {6, 164},
    {6, 221},
    {7, 78},
    {7, 103},
    {7, 209},
    {8, 63},
    {8, 134},
    {8, 218},
    {8, 219},
    {8, 225},
    {8, 228},
    {9, 36},
    {9, 42},
    {9, 99},
    {9, 100},
    {9, 130},
    {9, 176},
    {9, 196},
    {10, 21},
    {10, 70},
    {10, 72},
    {10, 138},
    {10, 196},
    {11, 98},
    {11, 168},
    {11, 194},
    {12, 92},
    {12, 97},
    {13, 10},
    {13, 24},
    {13, 151},
    {14, 27},
    {14, 49},
    {14, 123},
    {14, 162},
    {14, 178},
    {15, 37},
    {15, 165},
    {16, 70},
    {16, 77},
    {16, 135},
    {16, 145},
    {16, 170},
    {17, 12},
    {17, 183},
    {18, 25},
    {18, 28},
    {18, 84},
    {18, 110},
    {18, 189},
    {18, 199},
    {18, 224},
    {19, 16},
    {19, 91},
    {19, 100},
    {19, 194},
    {19, 215},
    {20, 4},
    {20, 8},
    {20, 15},
    {20, 27},
    {20, 75},
    {20, 85},
    {20, 86},
    {20, 154},
    {20, 157},
    {20, 164},
    {20, 171},
    {21, 115},
    {21, 129},
    {21, 183},
    {21, 202},
    {21, 203},
    {21, 254},
    {22, 135},
    {22, 241},
    {23, 31},
    {23, 225},
    {24, 2},
    {24, 15},
    {24, 60},
    {24, 121},
    {24, 138},
    {25, 36},
    {25, 38},
    {25, 244},
    {26, 136},
    {26, 247},
    {26, 255},
    {27, 24},
    {27, 131},
    {27, 155},
    {27, 218},
    {27, 232},
    {28, 31},
    {28, 94},
    {28, 157},
    {28, 167},
    {28, 177},
    {28, 232},
    {28, 234},
    {29, 69},
    {29, 98},
    {29, 157},
    {29, 251},
    {30, 39},
    {30, 74},
    {30, 214},
    {30, 229},
    {31, 67},
    {31, 125},
    {31, 211},
    {32, 8},
    {32, 37},
    {32, 102},
    {32, 142},
    {32, 162},
    {33, 86},
    {33, 102},
    {33, 122},
    {33, 161},
    {33, 218},
    {34, 33},
    {34, 37},
    {34, 83},
    {34, 98},
    {34, 114},
    {34, 144},
    {34, 253},
    {35, 86},
    {35, 115},
    {35, 134},
    {35, 177},
    {35, 178},
    {35, 185},
    {35, 207},
    {35, 217},
    {35, 245},
    {36, 118},
    {36, 198},
    {37, 89},
    {37, 120},
    {37, 181},
    {38, 10},
    {38, 38},
    {38, 41},
    {38, 67},
    {38, 230},
    {39, 95},
    {39, 142},
    {39, 178},
    {39, 230},
    {40, 4},
    {40, 37},
    {40, 93},
    {40, 194},
    {40, 237},
    {40, 239},
    {41, 12},
    {41, 60},
    {41, 134},
    {41, 138},
    {42, 122},
    {42, 136},
    {42, 137},
    {42, 172},
    {42, 202},
    {42, 236},
    {0, 5},
    {0, 8},
    {0, 10},
    {0, 41},
    {0, 48},
    {0, 49},
    {0, 52},
    {0, 68},
    {0, 71},
    {0, 99},
    {0, 102},
    {0, 114},
    {0, 121},
    {0, 133},
    {0, 147},
    {0, 151},
    {0, 153},
    {0, 164},
    {0, 179},
    {0, 180},
    {0, 181},
    {0, 185},
    {0, 207},
    {0, 239},
    {1, 8},
    {1, 12},
    {1, 34},
    {1, 38},
    {1, 54},
    {1, 56},
    {1, 95},
    {1, 105},
    {1, 107},
    {1, 113},
    {1, 117},
    {1, 143},
    {1, 160},
    {1, 184},
    {1, 207},
    {1, 211},
    {1, 226},
    {1, 236},
    {2, 17},
    {2, 30},
    {2, 41},
    {2, 43},
    {2, 46},
    {2, 64},
    {2, 85},
    {2, 86},
    {2, 92},
    {2, 107},
    {2, 109},
    {2, 114},
    {2, 118},
    {2, 125},
    {2, 166},
    {2, 178},
    {2, 202},
    {2, 224},
    {3, 11},
    {3, 20},
    {3, 31},
    {3, 34},
    {3, 114},
    {3, 121},
    {3, 152},
    {3, 174},
    {3, 205},
    {3, 212},
    {3, 234},
    {3, 248},
    {4, 55},
    {4, 106},
    {4, 118},
    {4, 153},
    {5, 48},
    {5, 145},
    {5, 169},
    {5, 180},
    {5, 205},
    {5, 207},
    {5, 226},
    {6, 13},
    {6, 20},
    {6, 55},
    {6, 127},
    {6, 198},
    {6, 207},
    {6, 236},
    {7, 47},
    {7, 136},
    {8, 2},
    {8, 46},
    {8, 85},
    {8, 88},
    {8, 90},
    {8, 172},
    {8, 191},
    {8, 253},
    {8, 254},
    {9, 14},
    {9, 52},
    {9, 112},
    {9, 148},
    {9, 180},
    {9, 192},
    {9, 252},
    {10, 9},
    {10, 74},
    {10, 85},
    {10, 94},
    {10, 103},
    {10, 109},
    {10, 245},
    {11, 1},
    {11, 40},
    {11, 101},
    {11, 165},
    {11, 205},
    {11, 217},
    {11, 223},
    {12, 109},
    {12, 167},
    {12, 185},
    {12, 210},
    {13, 33},
    {13, 180},
    {13, 201},
    {13, 237},
    {14, 99},
    {14, 100},
    {14, 137},
    {14, 141},
    {14, 236},
    {15, 25},
    {15, 63},
    {15, 121},
    {15, 189},
    {16, 5},
    {16, 34},
    {16, 109},
    {16, 239},
    {16, 255},
    {17, 165},
    {17, 171},
    {17, 175},
    {17, 198},
    {17, 236},
    {18, 27},
    {18, 124},
    {18, 223},
    {19, 30},
    {19, 77},
    {19, 86},
    {19, 98},
    {19, 154},
    {20, 36},
    {20, 43},
    {20, 109},
    {20, 114},
    {21, 124},
    {22, 3},
    {22, 31},
    {22, 33},
    {22, 176},
    {22, 218},
    {22, 219},
    {22, 232},
    {23, 13},
    {23, 25},
    {23, 81},
    {23, 96},
    {23, 149},
    {23, 177},
    {24, 28},
    {24, 29},
    {24, 86},
    {24, 120},
    {24, 173},
    {24, 193},
    {24, 225},
    {25, 31},
    {25, 89},
    {25, 137},
    {25, 171},
    {25, 194},
    {25, 206},
    {25, 209},
    {26, 77},
    {26, 91},
    {26, 162},
    {26, 254},
    {27, 39},
    {27, 88},
    {27, 92},
    {27, 114},
    {27, 116},
    {28, 14},
    {28, 112},
    {28, 121},
    {29, 32},
    {29, 101},
    {29, 110},
    {29, 130},
    {29, 136},
    {29, 255},
    {30, 8},
    {30, 21},
    {30, 95},
    {30, 211},
    {30, 212},
    {30, 240},
    {31, 94},
    {31, 99},
    {31, 160},
    {32, 116},
    {32, 205},
    {33, 12},
    {33, 18},
    {33, 21},
    {33, 191},
    {33, 229},
    {34, 110},
    {34, 188},
    {34, 203},
    {34, 204},
    {35, 47},
    {35, 53},
    {35, 64},
    {35, 90},
    {35, 130},
    {35, 253},
    {36, 4},
    {36, 17},
    {36, 67},
    {36, 116},
    {36, 182},
    {36, 203},
    {37, 108},
    {37, 221},
    {38, 32},
    {38, 124},
    {38, 143},
    {38, 179},
    {38, 184},
    {39, 33},
    {39, 37},
    {39, 38},
    {39, 78},
    {39, 80},
    {39, 227},
    {40, 41},
    {40, 224},
    {41, 3},
    {41, 21},
    {42, 58},
    {42, 92},
    {42, 209},
    {0, 20},
    {0, 28},
    {0, 31},
    {0, 38},
    {0, 50},
    {0, 57},
    {0, 61},
    {0, 83},
    {0, 119},
    {0, 124},
    {0, 138},
    {0, 145},
    {0, 156},
    {0, 162},
    {0, 169},
    {0, 173},
    {0, 183},
    {0, 187},
    {0, 192},
    {0, 199},
    {0, 208},
    {0, 217},
    {0, 241},
    {0, 249},
    {0, 252},
    {1, 0},
    {1, 3},
    {1, 9},
    {1, 11},
    {1, 15},
    {1, 22},
    {1, 27},
    {1, 39},
    {1, 59},
    {1, 93},
    {1, 102},
    {1, 135},
    {1, 149},
    {1, 150},
    {1, 167},
    {1, 190},
    {1, 203},
    {1, 205},
    {1, 214},
    {1, 220},
    {1, 221},
    {1, 223},
    {1, 227},
    {1, 239},
    {1, 252},
    {1, 253},
    {2, 3},
    {2, 14},
    {2, 18},
    {2, 24},
    {2, 28},
    {2, 37},
    {2, 83},
    {2, 94},
    {2, 97},
    {2, 99},
    {2, 105},
    {2, 110},
    {2, 117},
    {2, 124},
    {2, 126},
    {2, 144},
    {2, 148},
    {2, 149},
    {2, 152},
    {2, 168},
    {2, 175},
    {2, 176},
    {2, 204},
    {2, 206},
    {2, 235},
    {2, 248},
    {2, 252},
    {2, 255},
    {3, 54},
    {3, 99},
    {3, 106},
    {3, 115},
    {3, 145},
    {3, 187},
    {3, 218},
    {3, 230},
    {3, 232},
    {4, 63},
    {4, 82},
    {4, 199},
    {4, 231},
    {4, 237},
    {4, 255},
    {5, 2},
    {5, 31},
    {5, 38},
    {5, 95},
    {5, 125},
    {5, 148},
    {5, 230},
    {5, 243},
    {5, 250},
    {6, 4},
    {6, 27},
    {6, 147},
    {6, 190},
    {6, 208},
    {6, 226},
    {6, 229},
    {6, 238},
    {7, 7},
    {7, 39},
    {7, 129},
    {7, 135},
    {7, 156},
    {8, 10},
    {8, 42},
    {8, 82},
    {8, 135},
    {8, 229},
    {8, 248},
    {9, 108},
    {9, 135},
    {9, 141},
    {9, 150},
    {9, 178},
    {9, 193},
    {9, 212},
    {9, 227},
    {10, 23},
    {10, 51},
    {10, 68},
    {10, 119},
    {10, 129},
    {10, 180},
    {10, 182},
    {10, 207},
    {10, 239},
    {10, 255},
    {11, 91},
    {11, 119},
    {11, 179},
    {12, 23},
    {12, 144},
    {12, 162},
    {12, 211},
    {12, 222},
    {13, 15},
    {13, 20},
    {13, 114},
    {13, 171},
    {13, 245},
    {14, 55},
    {14, 76},
    {14, 113},
    {14, 134},
    {14, 173},
    {14, 209},
    {15, 17},
    {15, 21},
    {15, 50},
    {15, 94},
    {15, 123},
    {15, 142},
    {16, 69},
    {16, 132},
    {16, 152},
    {16, 190},
    {16, 206},
    {16, 224},
    {16, 251},
    {17, 77},
    {17, 81},
    {17, 83},
    {17, 87},
    {17, 106},
    {17, 126},
    {17, 164},
    {17, 235},
    {18, 26},
    {18, 38},
    {18, 58},
    {18, 61},
    {18, 67},
    {18, 97},
    {18, 126},
    {18, 145},
    {18, 150},
    {18, 167},
    {18, 171},
    {19, 40},
    {19, 53},
    {19, 229},
    {20, 65},
    {20, 105},
    {20, 147},
    {20, 174},
    {20, 205},
    {20, 207},
    {20, 236},
    {20, 254},
    {21, 60},
    {21, 71},
    {21, 94},
    {21, 101},
    {21, 108},
    {21, 159},
    {21, 168},
    {21, 211},
    {22, 21},
    {22, 145},
    {22, 162},
    {22, 174},
    {23, 12},
    {23, 70},
    {23, 161},
    {23, 197},
    {23, 220},
    {24, 14},
    {24, 19},
    {24, 26},
    {24, 101},
    {24, 112},
    {24, 139},
    {24, 140},
    {24, 154},
    {24, 171},
    {24, 184},
    {24, 248},
    {24, 250},
    {25, 1},
    {25, 8},
    {25, 167},
    {25, 187},
    {25, 198},
    {25, 214},
    {25, 226},
    {26, 56},
    {26, 79},
    {26, 102},
    {26, 112},
    {26, 214},
    {26, 223},
    {27, 63},
    {27, 140},
    {27, 153},
    {27, 168},
    {27, 179},
    {27, 221},
    {28, 37},
    {28, 88},
    {28, 129},
    {28, 179},
    {28, 219},
    {28, 241},
    {29, 75},
    {29, 158},
    {29, 197},
    {29, 223},
    {30, 58},
    {30, 140},
    {30, 146},
    {30, 167},
    {31, 33},
    {31, 39},
    {31, 47},
    {31, 73},
    {31, 113},
    {31, 114},
    {31, 134},
    {31, 212},
    {31, 216},
    {31, 235},
    {31, 240},
    {31, 249},
    {32, 5},
    {32, 45},
    {32, 71},
    {32, 124},
    {32, 196},
    {32, 220},
    {33, 27},
    {33, 64},
    {33, 111},
    {33, 117},
    {33, 186},
    {33, 253},
    {34, 159},
    {34, 179},
    {34, 181},
    {34, 195},
    {34, 244},
    {35, 5},
    {35, 8},
    {35, 96},
    {35, 116},
    {35, 120},
    {35, 129},
    {35, 136},
    {35, 204},
    {35, 244},
    {36, 100},
    {36, 194},
    {36, 248},
    {37, 43},
    {37, 45},
    {38, 21},
    {38, 72},
    {38, 73},
    {38, 97},
    {38, 107},
    {38, 110},
    {38, 173},
    {38, 174},
    {38, 188},
    {38, 190},
    {38, 203},
    {38, 224},
    {38, 234},
    {38, 249},
    {39, 6},
    {39, 43},
    {39, 84},
    {39, 138},
    {39, 163},
    {40, 92},
    {40, 113},
    {40, 174},
    {40, 175},
    {40, 180},
    {40, 213},
    {41, 48},
    {41, 66},
    {41, 70},
    {41, 186},
    {41, 205},
    {42, 46},
    {42, 71},
    {42, 138},
    {42, 200},
    {42, 203},
    {42, 211},
    {42, 227},
    {0, 3},
    {0, 9},
    {0, 17},
    {0, 35},
    {0, 36},
    {0, 55},
    {0, 78},
    {0, 88},
    {0, 104},
    {0, 108},
    {0, 134},
    {0, 137},
    {0, 144},
    {0, 146},
    {0, 198},
    {0, 206},
    {0, 209},
    {0, 213},
    {0, 219},
    {0, 251},
    {0, 255},
    {1, 17},
    {1, 33},
    {1, 37},
    {1, 43},
    {1, 44},
    {1, 53},
    {1, 57},
    {1, 66},
    {1, 70},
    {1, 73},
    {1, 74},
    {1, 83},
    {1, 87},
    {1, 123},
    {1, 128},
    {1, 132},
    {1, 146},
    {1, 158},
    {1, 176},
    {1, 180},
    {1, 181},
    {1, 195},
    {1, 206},
    {1, 209},
    {1, 218},
    {1, 219},
    {1, 225},
    {1, 234},
    {1, 238},
    {1, 240},
    {2, 1},
    {2, 23},
    {2, 26},
    {2, 29},
    {2, 38},
    {2, 45},
    {2, 57},
    {2, 67},
    {2, 75},
    {2, 84},
    {2, 96},
    {2, 116},
    {2, 132},
    {2, 139},
    {2, 150},
    {2, 151},
    {2, 158},
    {2, 170},
    {2, 177},
    {2, 186},
    {2, 197},
    {2, 200},
    {2, 203},
    {2, 215},
    {2, 225},
    {2, 234},
    {2, 254},
    {3, 27},
    {3, 32},
    {3, 90},
    {3, 127},
    {3, 144},
    {3, 196},
    {3, 201},
    {3, 204},
    {3, 221},
    {3, 246},
    {3, 253},
    {4, 29},
    {4, 98},
    {4, 102},
    {4, 144},
    {4, 147},
    {4, 156},
    {4, 163},
    {4, 181},
    {4, 210},
    {4, 230},
    {4, 252},
    {5, 19},
    {5, 55},
    {5, 58},
    {5, 65},
    {5, 67},
    {5, 90},
    {5, 172},
    {5, 177},
    {5, 201},
    {5, 232},
    {6, 64},
    {6, 90},
    {6, 177},
    {6, 200},
    {6, 219},
    {6, 228},
    {6, 230},
    {6, 248},
    {7, 21},
    {7, 59},
    {7, 69},
    {7, 110},
    {7, 157},
    {7, 174},
    {7, 177},
    {7, 230},
    {7, 234},
    {7, 245},
    {8, 101},
    {8, 131},
    {8, 152},
    {8, 177},
    {8, 202},
    {8, 241},
    {8, 247},
    {9, 9},
    {9, 102},
    {9, 128},
    {9, 145},
    {9, 200},
    {10, 11},
    {10, 37},
    {10, 50},
    {10, 112},
    {10, 124},
    {10, 133},
    {10, 154},
    {10, 166},
    {11, 64},
    {11, 121},
    {11, 135},
    {11, 199},
    {12, 21},
    {12, 63},
    {12, 65},
    {12, 82},
    {12, 136},
    {12, 137},
    {12, 183},
    {12, 236},
    {13, 37},
    {13, 83},
    {13, 103},
    {13, 124},
    {13, 195},
    {14, 8},
    {14, 23},
    {14, 26},
    {14, 78},
    {15, 27},
    {15, 69},
    {15, 153},
    {15, 201},
    {15, 203},
    {15, 223},
    {15, 225},
    {15, 237},
    {15, 248},
    {16, 57},
    {17, 70},
    {17, 80},
    {17, 96},
    {17, 137},
    {17, 144},
    {17, 152},
    {17, 207},
    {17, 217},
    {18, 99},
    {18, 135},
    {18, 178},
    {18, 183},
    {18, 216},
    {18, 252},
    {19, 17},
    {19, 19},
    {19, 38},
    {19, 85},
    {19, 101},
    {19, 105},
    {19, 143},
    {19, 155},
    {19, 178},
    {19, 208},
    {19, 224},
    {20, 101},
    {20, 128},
    {20, 140},
    {20, 159},
    {20, 190},
    {20, 243},
    {20, 250},
    {21, 44},
    {21, 58},
    {21, 75},
    {21, 83},
    {21, 93},
    {21, 172},
    {21, 193},
    {21, 194},
    {21, 217},
    {21, 221},
    {21, 225},
    {21, 252},
    {22, 42},
    {22, 149},
    {22, 159},
    {22, 193},
    {22, 206},
    {22, 208},
    {22, 229},
    {22, 230},
    {22, 239},
    {22, 254},
    {23, 10},
    {23, 45},
    {23, 65},
    {23, 92},
    {23, 235},
    {24, 57},
    {24, 65},
    {24, 87},
    {24, 161},
    {24, 196},
    {24, 209},
    {25, 68},
    {25, 83},
    {25, 88},
    {25, 104},
    {25, 124},
    {25, 128},
    {25, 148},
    {25, 176},
    {25, 207},
    {26, 32},
    {26, 113},
    {26, 132},
    {26, 167},
    {26, 211},
    {26, 219},
    {27, 35},
    {27, 126},
    {27, 167},
    {27, 196},
    {27, 228},
    {28, 4},
    {28, 9},
    {28, 20},
    {28, 34},
    {28, 142},
    {28, 197},
    {28, 201},
    {28, 211},
    {28, 222},
    {29, 46},
    {29, 74},
    {29, 87},
    {29, 171},
    {29, 200},
    {29, 241},
    {30, 2},
    {30, 6},
    {30, 23},
    {30, 66},
    {30, 125},
    {30, 132},
    {30, 168},
    {30, 195},
    {30, 213},
    {30, 233},
    {30, 253},
    {31, 19},
    {31, 44},
    {31, 92},
    {31, 189},
    {31, 244},
    {32, 6},
    {32, 100},
    {32, 112},
    {32, 180},
    {32, 183},
    {32, 206},
    {32, 209},
    {32, 234},
    {32, 250},
    {33, 61},
    {33, 65},
    {33, 115},
    {33, 120},
    {33, 140},
    {33, 156},
    {33, 190},
    {33, 226},
    {34, 18},
    {34, 19},
    {34, 54},
    {34, 134},
    {34, 160},
    {34, 214},
    {35, 28},
    {35, 31},
    {35, 88},
    {35, 95},
    {35, 160},
    {35, 161},
    {35, 166},
    {35, 168},
    {35, 175},
    {36, 33},
    {36, 47},
    {36, 48},
    {36, 92},
    {36, 102},
    {36, 162},
    {36, 174},
    {36, 187},
    {36, 197},
    {36, 201},
    {36, 251},
    {37, 60},
    {37, 76},
    {37, 80},
    {37, 87},
    {37, 153},
    {37, 160},
    {37, 205},
    {37, 216},
    {38, 76},
    {38, 108},
    {38, 117},
    {38, 126},
    {38, 144},
    {38, 169},
    {38, 176},
    {38, 187},
    {38, 197},
    {38, 208},
    {38, 242},
    {39, 14},
    {39, 26},
    {39, 132},
    {39, 162},
    {39, 237},
    {40, 7},
    {40, 197},
    {40, 205},
    {40, 225},
    {40, 238},
    {41, 131},
    {41, 143},
    {41, 151},
    {41, 251},
    {41, 255},
    {42, 135},
    {42, 178},
    {42, 197},
    {42, 219},
    {0, 0},
    {0, 7},
    {0, 23},
    {0, 37},
    {0, 43},
    {0, 56},
    {0, 65},
    {0, 81},
    {0, 82},
    {0, 84},
    {0, 87},
    {0, 93},
    {0, 94},
    {0, 130},
    {0, 141},
    {0, 143},
    {0, 149},
    {0, 155},
    {0, 157},
    {0, 163},
    {0, 170},
    {0, 171},
    {0, 175},
    {0, 176},
    {0, 182},
    {0, 203},
    {0, 214},
    {0, 215},
    {0, 253},
    {1, 41},
    {1, 45},
    {1, 50},
    {1, 60},
    {1, 62},
    {1, 67},
    {1, 81},
    {1, 106},
    {1, 109},
    {1, 115},
    {1, 119},
    {1, 126},
    {1, 139},
    {1, 144},
    {1, 145},
    {1, 147},
    {1, 156},
    {1, 168},
    {1, 170},
    {1, 173},
    {1, 204},
    {1, 208},
    {1, 213},
    {1, 228},
    {1, 235},
    {1, 242},
    {1, 243},
    {1, 247},
    {1, 248},
    {1, 254},
    {2, 2},
    {2, 27},
    {2, 35},
    {2, 42},
    {2, 50},
    {2, 51},
    {2, 54},
    {2, 73},
    {2, 81},
    {2, 82},
    {2, 91},
    {2, 95},
    {2, 100},
    {2, 102},
    {2, 121},
    {2, 130},
    {2, 145},
    {2, 155},
    {2, 157},
    {2, 159},
    {2, 161},
    {2, 163},
    {2, 169},
    {2, 179},
    {2, 180},
    {2, 187},
    {2, 188},
    {2, 191},
    {2, 192},
    {2, 196},
    {2, 210},
    {2, 229},
    {3, 77},
    {3, 98},
    {3, 116},
    {3, 122},
    {3, 136},
    {3, 140},
    {3, 175},
    {3, 209},
    {3, 236},
    {3, 251},
    {4, 13},
    {4, 22},
    {4, 75},
    {4, 120},
    {4, 148},
    {5, 15},
    {5, 21},
    {5, 32},
    {5, 61},
    {5, 80},
    {5, 89},
    {5, 104},
    {5, 111},
    {5, 130},
    {5, 191},
    {5, 197},
    {5, 200},
    {5, 241},
    {5, 249},
    {6, 5},
    {6, 25},
    {6, 67},
    {6, 124},
    {6, 136},
    {6, 196},
    {6, 201},
    {6, 209},
    {6, 212},
    {6, 218},
    {6, 222},
    {6, 223},
    {6, 241},
    {6, 244},
    {6, 246},
    {7, 117},
    {7, 166},
    {7, 216},
    {7, 236},
    {7, 248},
    {8, 35},
    {8, 36},
    {8, 38},
    {8, 58},
    {8, 111},
    {8, 112},
    {8, 137},
    {8, 158},
    {8, 192},
    {9, 28},
    {9, 54},
    {9, 175},
    {9, 209},
    {9, 213},
    {9, 228},
    {9, 239},
    {10, 22},
    {10, 25},
    {10, 48},
    {10, 75},
    {10, 82},
    {10, 88},
    {10, 111},
    {10, 152},
    {10, 187},
    {10, 201},
    {10, 231},
    {10, 246},
    {10, 252},
    {11, 9},
    {11, 47},
    {11, 61},
    {11, 66},
    {11, 77},
    {11, 127},
    {11, 132},
    {11, 150},
    {11, 160},
    {11, 208},
    {11, 226},
    {11, 241},
    {12, 34},
    {12, 40},
    {12, 70},
    {12, 86},
    {12, 88},
    {12, 106},
    {12, 148},
    {12, 173},
    {12, 192},
    {12, 207},
    {12, 238},
    {12, 245},
    {13, 6},
    {13, 45},
    {13, 97},
    {13, 132},
    {13, 192},
    {14, 16},
    {14, 61},
    {14, 142},
    {14, 171},
    {14, 176},
    {14, 229},
    {14, 240},
    {15, 2},
    {15, 5},
    {15, 34},
    {15, 42},
    {15, 68},
    {15, 114},
    {15, 220},
    {16, 17},
    {16, 42},
    {16, 45},
    {16, 125},
    {16, 130},
    {16, 172},
    {16, 187},
    {16, 199},
    {16, 212},
    {16, 249},
    {17, 10},
    {17, 40},
    {17, 57},
    {17, 74},
    {17, 78},
    {17, 100},
    {17, 105},
    {17, 111},
    {17, 170},
    {18, 36},
    {18, 47},
    {18, 63},
    {18, 123},
    {18, 132},
    {18, 136},
    {18, 185},
    {18, 188},
    {18, 196},
    {18, 228},
    {18, 239},
    {19, 7},
    {19, 37},
    {19, 62},
    {19, 113},
    {19, 124},
    {19, 139},
    {19, 159},
    {19, 187},
    {19, 196},
    {19, 225},
    {19, 244},
    {20, 1},
    {20, 3},
    {20, 135},
    {20, 188},
    {20, 194},
    {20, 215},
    {20, 217},
    {21, 7},
    {21, 17},
    {21, 27},
    {21, 73},
    {21, 102},
    {21, 113},
    {21, 157},
    {21, 166},
    {21, 185},
    {21, 222},
    {22, 11},
    {22, 17},
    {22, 19},
    {22, 25},
    {22, 103},
    {22, 125},
    {22, 133},
    {22, 212},
    {22, 228},
    {23, 0},
    {23, 11},
    {23, 14},
    {23, 40},
    {23, 41},
    {23, 42},
    {23, 48},
    {23, 51},
    {23, 58},
    {23, 67},
    {23, 72},
    {23, 88},
    {23, 99},
    {23, 127},
    {23, 136},
    {23, 153},
    {23, 158},
    {23, 199},
    {23, 203},
    {23, 209},
    {23, 210},
    {23, 215},
    {23, 228},
    {24, 47},
    {24, 91},
    {24, 146},
    {24, 172},
    {24, 191},
    {24, 202},
    {25, 29},
    {25, 82},
    {25, 90},
    {25, 101},
    {25, 121},
    {25, 129},
    {25, 141},
    {25, 161},
    {25, 162},
    {25, 200},
    {25, 232},
    {25, 233},
    {26, 8},
    {26, 10},
    {26, 58},
    {26, 66},
    {26, 68},
    {26, 80},
    {26, 116},
    {26, 133},
    {26, 212},
    {26, 236},
    {27, 29},
    {27, 41},
    {27, 65},
    {27, 135},
    {27, 139},
    {28, 11},
    {28, 33},
    {28, 59},
    {28, 65},
    {28, 66},
    {28, 82},
    {28, 136},
    {28, 139},
    {28, 178},
    {28, 193},
    {28, 228},
    {28, 239},
    {29, 20},
    {29, 30},
    {29, 73},
    {29, 83},
    {29, 95},
    {29, 118},
    {29, 131},
    {30, 11},
    {30, 34},
    {30, 51},
    {30, 53},
    {30, 54},
    {30, 80},
    {30, 91},
    {30, 151},
    {30, 154},
    {30, 227},
    {30, 237},
    {30, 239},
    {30, 245},
    {31, 10},
    {31, 30},
    {31, 116},
    {31, 152},
    {31, 159},
    {31, 197},
    {31, 204},
    {32, 39},
    {32, 74},
    {32, 92},
    {32, 119},
    {32, 141},
    {32, 193},
    {33, 5},
    {33, 81},
    {33, 127},
    {33, 145},
    {33, 175},
    {33, 189},
    {33, 206},
    {34, 59},
    {34, 60},
    {34, 82},
    {34, 92},
    {34, 124},
    {34, 158},
    {34, 173},
    {34, 193},
    {35, 14},
    {35, 17},
    {35, 54},
    {35, 60},
    {35, 81},
    {35, 100},
    {35, 131},
    {35, 132},
    {35, 148},
    {35, 187},
    {35, 193},
    {35, 214},
    {35, 249},
    {36, 3},
    {36, 24},
    {36, 57},
    {36, 62},
    {36, 82},
    {36, 94},
    {36, 123},
    {36, 132},
    {36, 190},
    {36, 226},
    {36, 228},
    {36, 244},
    {37, 10},
    {37, 17},
    {37, 50},
    {37, 67},
    {37, 81},
    {37, 83},
    {37, 158},
    {37, 194},
    {37, 202},
    {37, 209},
    {37, 224},
    {37, 250},
    {38, 8},
    {38, 20},
    {38, 88},
    {38, 93},
    {38, 175},
    {38, 211},
    {39, 1},
    {39, 22},
    {39, 25},
    {39, 40},
    {39, 61},
    {39, 82},
    {39, 119},
    {39, 147},
    {39, 219},
    {39, 235},
    {39, 239},
    {40, 36},
    {40, 52},
    {40, 62},
    {40, 71},
    {40, 90},
    {40, 100},
    {40, 215},
    {41, 7},
    {41, 10},
    {41, 80},
    {41, 93},
    {41, 109},
    {41, 155},
    {41, 164},
    {41, 168},
    {41, 185},
    {41, 189},
    {41, 221},
    {42, 44},
    {42, 54},
    {42, 99},
    {42, 160},
    {42, 190},
    {42, 191},
    {42, 222},
    {0, 11},
    {0, 22},
    {0, 26},
    {0, 32},
    {0, 34},
    {0, 53},
    {0, 64},
    {0, 67},
    {0, 72},
    {0, 92},
    {0, 101},
    {0, 103},
    {0, 109},
    {0, 140},
    {0, 142},
    {0, 148},
    {0, 158},
    {0, 172},
    {0, 191},
    {0, 196},
    {0, 201},
    {0, 216},
    {0, 223},
    {0, 227},
    {0, 228},
    {0, 234},
    {0, 237},
    {0, 243},
    {1, 10},
    {1, 14},
    {1, 24},
    {1, 40},
    {1, 88},
    {1, 89},
    {1, 94},
    {1, 98},
    {1, 101},
    {1, 121},
    {1, 124},
    {1, 148},
    {1, 165},
    {1, 166},
    {1, 171},
    {1, 188},
    {1, 189},
    {1, 222},
    {1, 237},
    {1, 241},
    {1, 246},
    {2, 16},
    {2, 25},
    {2, 47},
    {2, 53},
    {2, 65},
    {2, 70},
    {2, 71},
    {2, 72},
    {2, 88},
    {2, 90},
    {2, 123},
    {2, 138},
    {2, 147},
    {2, 154},
    {2, 165},
    {2, 189},
    {2, 190},
    {2, 194},
    {2, 205},
    {2, 217},
    {2, 220},
    {2, 221},
    {2, 226},
    {2, 228},
    {2, 237},
    {2, 240},
    {2, 243},
    {3, 37},
    {3, 45},
    {3, 48},
    {3, 60},
    {3, 75},
    {3, 85},
    {3, 86},
    {3, 93},
    {3, 113},
    {3, 120},
    {3, 137},
    {3, 141},
    {3, 163},
    {3, 170},
    {3, 178},
    {3, 180},
    {3, 217},
    {3, 228},
    {3, 229},
    {3, 231},
    {3, 235},
    {4, 41},
    {4, 46},
    {4, 66},
    {4, 78},
    {4, 90},
    {4, 122},
    {4, 184},
    {4, 185},
    {4, 198},
    {4, 204},
    {4, 221},
    {4, 244},
    {5, 8},
    {5, 18},
    {5, 35},
    {5, 44},
    {5, 66},
    {5, 81},
    {5, 92},
    {5, 96},
    {5, 110},
    {5, 113},
    {5, 129},
    {5, 134},
    {5, 179},
    {5, 235},
    {5, 236},
    {5, 247},
    {6, 14},
    {6, 30},
    {6, 35},
    {6, 47},
    {6, 54},
    {6, 102},
    {6, 109},
    {6, 131},
    {6, 142},
    {6, 176},
    {6, 242},
    {6, 243},
    {6, 251},
    {6, 255},
    {7, 5},
    {7, 27},
    {7, 40},
    {7, 50},
    {7, 52},
    {7, 72},
    {7, 84},
    {7, 163},
    {7, 172},
    {7, 175},
    {7, 189},
    {7, 201},
    {7, 220},
    {7, 247},
    {7, 254},
    {8, 7},
    {8, 12},
    {8, 16},
    {8, 18},
    {8, 33},
    {8, 34},
    {8, 54},
    {8, 56},
    {8, 73},
    {8, 76},
    {8, 86},
    {8, 98},
    {8, 129},
    {8, 133},
    {8, 147},
    {8, 166},
    {8, 170},
    {8, 179},
    {8, 184},
    {8, 193},
    {8, 237},
    {9, 33},
    {9, 56},
    {9, 73},
    {9, 114},
    {9, 182},
    {9, 188},
    {9, 194},
    {9, 223},
    {9, 229},
    {9, 243},
    {10, 4},
    {10, 106},
    {10, 118},
    {10, 120},
    {10, 132},
    {10, 160},
    {10, 169},
    {10, 189},
    {10, 195},
    {10, 209},
    {10, 241},
    {10, 242},
    {11, 5},
    {11, 32},
    {11, 43},
    {11, 52},
    {11, 99},
    {11, 153},
    {11, 233},
    {11, 237},
    {12, 11},
    {12, 14},
    {12, 72},
    {12, 83},
    {12, 91},
    {12, 95},
    {12, 99},
    {12, 134},
    {12, 138},
    {12, 139},
    {12, 194},
    {12, 230},
    {13, 3},
    {13, 18},
    {13, 52},
    {13, 61},
    {13, 67},
    {13, 93},
    {13, 117},
    {13, 134},
    {13, 148},
    {13, 161},
    {13, 162},
    {13, 207},
    {14, 24},
    {14, 60},
    {14, 66},
    {14, 67},
    {14, 156},
    {14, 159},
    {14, 191},
    {14, 211},
    {14, 230},
    {15, 44},
    {15, 72},
    {15, 79},
    {15, 103},
    {15, 118},
    {15, 140},
    {15, 184},
    {15, 192},
    {16, 27},
    {16, 87},
    {16, 113},
    {16, 117},
    {16, 122},
    {16, 175},
    {16, 185},
    {16, 194},
    {16, 196},
    {16, 203},
    {16, 238},
    {16, 243},
    {17, 4},
    {17, 32},
    {17, 52},
    {17, 104},
    {17, 140},
    {17, 143},
    {17, 163},
    {17, 178},
    {17, 182},
    {17, 190},
    {17, 220},
    {17, 242},
    {18, 0},
    {18, 10},
    {18, 19},
    {18, 20},
    {18, 56},
    {18, 156},
    {18, 190},
    {18, 202},
    {18, 209},
    {18, 222},
    {18, 231},
    {18, 237},
    {18, 247},
    {18, 253},
    {19, 9},
    {19, 36},
    {19, 39},
    {19, 46},
    {19, 56},
    {19, 59},
    {19, 65},
    {19, 117},
    {19, 150},
    {19, 164},
    {19, 221},
    {19, 242},
    {19, 247},
    {19, 252},
    {20, 11},
    {20, 31},
    {20, 44},
    {20, 63},
    {20, 92},
    {20, 191},
    {20, 197},
    {20, 226},
    {20, 237},
    {21, 23},
    {21, 55},
    {21, 61},
    {21, 92},
    {21, 117},
    {21, 119},
    {21, 142},
    {21, 143},
    {21, 158},
    {21, 180},
    {21, 230},
    {22, 4},
    {22, 29},
    {22, 43},
    {22, 45},
    {22, 53},
    {22, 60},
    {22, 97},
    {22, 100},
    {22, 141},
    {22, 148},
    {22, 153},
    {22, 158},
    {22, 161},
    {22, 163},
    {22, 187},
    {22, 199},
    {22, 200},
    {22, 213},
    {22, 234},
    {22, 243},
    {22, 252},
    {23, 1},
    {23, 28},
    {23, 30},
    {23, 37},
    {23, 49},
    {23, 61},
    {23, 87},
    {23, 94},
    {23, 113},
    {23, 129},
    {23, 133},
    {23, 135},
    {23, 156},
    {23, 180},
    {23, 185},
    {23, 186},
    {23, 192},
    {23, 206},
    {23, 216},
    {23, 217},
    {23, 231},
    {23, 234},
    {23, 236},
    {23, 255},
    {24, 30},
    {24, 54},
    {24, 127},
    {24, 179},
    {24, 183},
    {24, 204},
    {24, 228},
    {24, 241},
    {24, 255},
    {25, 20},
    {25, 40},
    {25, 80},
    {25, 98},
    {25, 111},
    {25, 119},
    {25, 122},
    {25, 140},
    {25, 149},
    {25, 186},
    {25, 227},
    {26, 4},
    {26, 15},
    {26, 38},
    {26, 44},
    {26, 62},
    {26, 148},
    {26, 150},
    {26, 189},
    {26, 193},
    {26, 230},
    {26, 250},
    {27, 69},
    {27, 70},
    {27, 85},
    {27, 137},
    {27, 149},
    {27, 160},
    {27, 165},
    {27, 173},
    {27, 176},
    {27, 195},
    {27, 201},
    {27, 213},
    {27, 240},
    {27, 243},
    {27, 245},
    {28, 21},
    {28, 54},
    {28, 62},
    {28, 72},
    {28, 76},
    {28, 81},
    {28, 83},
    {28, 101},
    {28, 103},
    {28, 109},
    {28, 135},
    {28, 148},
    {28, 149},
    {28, 156},
    {28, 189},
    {28, 231},
    {28, 235},
    {28, 245},
    {28, 253},
    {28, 254},
    {29, 29},
    {29, 57},
    {29, 89},
    {29, 106},
    {29, 156},
    {29, 207},
    {29, 227},
    {30, 13},
    {30, 20},
    {30, 120},
    {30, 162},
    {30, 181},
    {30, 205},
    {30, 234},
    {30, 255},
    {31, 9},
    {31, 13},
    {31, 22},
    {31, 45},
    {31, 72},
    {31, 118},
    {31, 128},
    {31, 130},
    {31, 135},
    {31, 183},
    {31, 198},
    {31, 206},
    {31, 215},
    {31, 219},
    {31, 225},
    {31, 242},
    {32, 1},
    {32, 3},
    {32, 49},
    {32, 123},
    {32, 137},
    {32, 166},
    {32, 181},
    {32, 216},
    {32, 244},
    {32, 255},
    {33, 3},
    {33, 37},
    {33, 40},
    {33, 51},
    {33, 68},
    {33, 78},
    {33, 87},
    {33, 98},
    {33, 103},
    {33, 143},
    {33, 151},
    {33, 222},
    {33, 230},
    {33, 234},
    {33, 238},
    {33, 254},
    {34, 12},
    {34, 32},
    {34, 34},
    {34, 51},
    {34, 57},
    {34, 118},
    {34, 196},
    {34, 210},
    {34, 211},
    {34, 248},
    {35, 13},
    {35, 16},
    {35, 25},
    {35, 32},
    {35, 190},
    {35, 194},
    {35, 234},
    {35, 236},
    {35, 251},
    {36, 36},
    {36, 52},
    {36, 72},
    {36, 206},
    {36, 212},
    {36, 236},
    {37, 40},
    {37, 47},
    {37, 62},
    {37, 72},
    {37, 78},
    {37, 96},
    {37, 139},
    {37, 144},
    {37, 161},
    {37, 168},
    {37, 203},
    {37, 215},
    {37, 230},
    {37, 243},
    {37, 248},
    {37, 251},
    {38, 0},
    {38, 6},
    {38, 16},
    {38, 40},
    {38, 48},
    {38, 49},
    {38, 55},
    {38, 109},
    {38, 114},
    {38, 141},
    {38, 147},
    {38, 155},
    {38, 194},
    {38, 196},
    {38, 217},
    {38, 228},
    {38, 245},
    {38, 247},
    {39, 7},
    {39, 13},
    {39, 34},
    {39, 36},
    {39, 39},
    {39, 52},
    {39, 75},
    {39, 98},
    {39, 134},
    {39, 155},
    {39, 185},
    {39, 198},
    {39, 224},
    {39, 225},
    {39, 233},
    {39, 249},
    {40, 1},
    {40, 43},
    {40, 57},
    {40, 63},
    {40, 87},
    {40, 89},
    {40, 112},
    {40, 131},
    {40, 154},
    {40, 157},
    {40, 165},
    {40, 182},
    {40, 193},
    {40, 211},
    {40, 227},
    {40, 235},
    {41, 27},
    {41, 46},
    {41, 57},
    {41, 103},
    {41, 120},
    {41, 136},
    {41, 156},
    {41, 165},
    {41, 182},
    {41, 202},
    {41, 207},
    {41, 212},
    {41, 213},
    {41, 246},
    {41, 250},
    {42, 29},
    {42, 35},
    {42, 51},
    {42, 75},
    {42, 90},
    {42, 104},
    {42, 120},
    {42, 175},
    {42, 186},
    {42, 201},
    {0, 45},
    {0, 59},
    {0, 73},
    {0, 80},
    {0, 90},
    {0, 110},
    {0, 125},
    {0, 161},
    {0, 193},
    {0, 197},
    {0, 220},
    {0, 221},
    {0, 244},
    {0, 246},
    {0, 247},
    {1, 23},
    {1, 28},
    {1, 42},
    {1, 46},
    {1, 55},
    {1, 61},
    {1, 63},
    {1, 71},
    {1, 90},
    {1, 92},
    {1, 104},
    {1, 125},
    {1, 129},
    {1, 131},
    {1, 134},
    {1, 159},
    {1, 174},
    {1, 191},
    {1, 198},
    {1, 200},
    {1, 202},
    {1, 233},
    {1, 244},
    {2, 9},
    {2, 69},
    {2, 98},
    {2, 103},
    {2, 111},
    {2, 136},
    {2, 142},
    {2, 162},
    {2, 171},
    {2, 211},
    {2, 213},
    {2, 218},
    {2, 222},
    {2, 246},
    {2, 249},
    {2, 250},
    {2, 253},
    {3, 16},
    {3, 19},
    {3, 29},
    {3, 38},
    {3, 52},
    {3, 66},
    {3, 69},
    {3, 91},
    {3, 119},
    {3, 131},
    {3, 147},
    {3, 157},
    {3, 169},
    {3, 194},
    {3, 206},
    {3, 245},
    {4, 1},
    {4, 8},
    {4, 9},
    {4, 34},
    {4, 50},
    {4, 54},
    {4, 60},
    {4, 64},
    {4, 84},
    {4, 85},
    {4, 116},
    {4, 125},
    {4, 129},
    {4, 141},
    {4, 157},
    {4, 158},
    {4, 162},
    {4, 166},
    {4, 167},
    {4, 169},
    {4, 190},
    {4, 195},
    {4, 206},
    {4, 218},
    {4, 219},
    {4, 232},
    {4, 238},
    {4, 240},
    {5, 9},
    {5, 13},
    {5, 46},
    {5, 71},
    {5, 88},
    {5, 105},
    {5, 117},
    {5, 118},
    {5, 119},
    {5, 127},
    {5, 131},
    {5, 141},
    {5, 151},
    {5, 185},
    {5, 202},
    {5, 211},
    {5, 216},
    {5, 221},
    {6, 8},
    {6, 38},
    {6, 43},
    {6, 56},
    {6, 57},
    {6, 61},
    {6, 108},
    {6, 119},
    {6, 123},
    {6, 140},
    {6, 148},
    {6, 173},
    {6, 184},
    {6, 193},
    {6, 197},
    {6, 214},
    {6, 227},
    {6, 231},
    {7, 22},
    {7, 70},
    {7, 81},
    {7, 93},
    {7, 96},
    {7, 130},
    {7, 132},
    {7, 150},
    {7, 169},
    {7, 171},
    {7, 192},
    {7, 198},
    {7, 202},
    {7, 205},
    {7, 210},
    {8, 0},
    {8, 22},
    {8, 41},
    {8, 47},
    {8, 75},
    {8, 94},
    {8, 97},
    {8, 110},
    {8, 114},
    {8, 120},
    {8, 122},
    {8, 124},
    {8, 126},
    {8, 139},
    {8, 157},
    {8, 164},
    {8, 176},
    {8, 217},
    {8, 220},
    {8, 250},
    {8, 255},
    {9, 4},
    {9, 25},
    {9, 31},
    {9, 40},
    {9, 41},
    {9, 62},
    {9, 79},
    {9, 82},
    {9, 93},
    {9, 104},
    {9, 117},
    {9, 125},
    {9, 137},
    {9, 138},
    {9, 146},
    {9, 147},
    {9, 157},
    {9, 204},
    {9, 222},
    {9, 230},
    {9, 238},
    {9, 244},
    {10, 20},
    {10, 34},
    {10, 39},
    {10, 45},
    {10, 59},
    {10, 65},
    {10, 69},
    {10, 90},
    {10, 96},
    {10, 100},
    {10, 127},
    {10, 137},
    {10, 139},
    {10, 153},
    {10, 167},
    {10, 177},
    {10, 183},
    {10, 184},
    {10, 186},
    {10, 202},
    {10, 224},
    {11, 4},
    {11, 15},
    {11, 16},
    {11, 25},
    {11, 38},
    {11, 46},
    {11, 53},
    {11, 55},
    {11, 65},
    {11, 90},
    {11, 104},
    {11, 124},
    {11, 128},
    {11, 134},
    {11, 140},
    {11, 152},
    {11, 202},
    {11, 210},
    {11, 214},
    {11, 225},
    {12, 4},
    {12, 9},
    {12, 10},
    {12, 43},
    {12, 50},
    {12, 58},
    {12, 115},
    {12, 119},
    {12, 121},
    {12, 133},
    {12, 180},
    {12, 203},
    {12, 208},
    {12, 213},
    {13, 4},
    {13, 29},
    {13, 32},
    {13, 34},
    {13, 53},
    {13, 72},
    {13, 85},
    {13, 91},
    {13, 99},
    {13, 100},
    {13, 107},
    {13, 126},
    {13, 135},
    {13, 189},
    {13, 203},
    {13, 224},
    {13, 231},
    {13, 242},
    {13, 247},
    {14, 33},
    {14, 38},
    {14, 107},
    {14, 122},
    {14, 149},
    {14, 154},
    {14, 179},
    {14, 185},
    {14, 228},
    {14, 233},
    {14, 237},
    {14, 239},
    {14, 244},
    {14, 246},
    {14, 248},
    {14, 251},
    {15, 1},
    {15, 16},
    {15, 30},
    {15, 46},
    {15, 62},
    {15, 65},
    {15, 78},
    {15, 81},
    {15, 90},
    {15, 93},
    {15, 125},
    {15, 129},
    {15, 156},
    {15, 166},
    {15, 175},
    {15, 187},
    {15, 232},
    {15, 253},
    {15, 254},
    {16, 2},
    {16, 28},
    {16, 36},
    {16, 62},
    {16, 75},
    {16, 121},
    {16, 124},
    {16, 141},
    {16, 162},
    {16, 174},
    {16, 200},
    {16, 219},
    {16, 225},
    {17, 18},
    {17, 21},
    {17, 45},
    {17, 58},
    {17, 63},
    {17, 93},
    {17, 95},
    {17, 118},
    {17, 154},
    {17, 158},
    {17, 160},
    {17, 169},
    {17, 173},
    {17, 174},
    {17, 254},
    {18, 8},
    {18, 21},
    {18, 24},
    {18, 30},
    {18, 52},
    {18, 54},
    {18, 65},
    {18, 68},
    {18, 81},
    {18, 86},
    {18, 108},
    {18, 138},
    {18, 169},
    {18, 176},
    {18, 180},
    {18, 204},
    {18, 208},
    {18, 214},
    {19, 4},
    {19, 6},
    {19, 15},
    {19, 20},
    {19, 23},
    {19, 33},
    {19, 78},
    {19, 81},
    {19, 94},
    {19, 96},
    {19, 109},
    {19, 121},
    {19, 125},
    {19, 144},
    {19, 157},
    {19, 162},
    {19, 163},
    {19, 167},
    {19, 175},
    {19, 176},
    {19, 177},
    {19, 183},
    {19, 232},
    {20, 9},
    {20, 14},
    {20, 28},
    {20, 38},
    {20, 61},
    {20, 79},
    {20, 117},
    {20, 121},
    {20, 142},
    {20, 152},
    {20, 168},
    {20, 186},
    {20, 227},
    {20, 228},
    {20, 238},
    {20, 244},
    {20, 253},
    {21, 5},
    {21, 9},
    {21, 18},
    {21, 57},
    {21, 66},
    {21, 105},
    {21, 122},
    {21, 127},
    {21, 148},
    {21, 163},
    {21, 186},
    {21, 214},
    {21, 255},
    {22, 1},
    {22, 20},
    {22, 37},
    {22, 71},
    {22, 76},
    {22, 79},
    {22, 126},
    {22, 127},
    {22, 154},
    {22, 186},
    {22, 237},
    {23, 8},
    {23, 19},
    {23, 20},
    {23, 29},
    {23, 76},
    {23, 98},
    {23, 101},
    {23, 111},
    {23, 117},
    {23, 130},
    {23, 143},
    {23, 251},
    {24, 7},
    {24, 46},
    {24, 51},
    {24, 79},
    {24, 114},
    {24, 130},
    {24, 157},
    {24, 169},
    {24, 185},
    {24, 186},
    {24, 224},
    {24, 242},
    {24, 245},
    {24, 251},
    {25, 13},
    {25, 37},
    {25, 52},
    {25, 74},
    {25, 91},
    {25, 95},
    {25, 102},
    {25, 112},
    {25, 138},
    {25, 142},
    {25, 150},
    {25, 154},
    {25, 164},
    {25, 169},
    {25, 178},
    {25, 180},
    {25, 184},
    {25, 192},
    {25, 216},
    {25, 223},
    {25, 231},
    {25, 239},
    {26, 2},
    {26, 11},
    {26, 53},
    {26, 60},
    {26, 61},
    {26, 81},
    {26, 82},
    {26, 128},
    {26, 138},
    {26, 163},
    {26, 187},
    {26, 210},
    {26, 217},
    {26, 251},
    {27, 6},
    {27, 12},
    {27, 16},
    {27, 21},
    {27, 48},
    {27, 49},
    {27, 75},
    {27, 87},
    {27, 109},
    {27, 110},
    {27, 121},
    {27, 122},
    {27, 128},
    {27, 132},
    {27, 144},
    {27, 147},
    {27, 182},
    {27, 184},
    {27, 192},
    {27, 197},
    {27, 229},
    {27, 244},
    {28, 16},
    {28, 22},
    {28, 35},
    {28, 45},
    {28, 47},
    {28, 48},
    {28, 49},
    {28, 55},
    {28, 95},
    {28, 102},
    {28, 120},
    {28, 131},
    {28, 132},
    {28, 134},
    {28, 147},
    {28, 182},
    {28, 195},
    {28, 202},
    {28, 207},
    {28, 212},
    {28, 225},
    {28, 240},
    {29, 3},
    {29, 15},
    {29, 18},
    {29, 135},
    {29, 143},
    {29, 148},
    {29, 151},
    {29, 161},
    {29, 201},
    {29, 209},
    {29, 216},
    {29, 237},
    {30, 3},
    {30, 5},
    {30, 40},
    {30, 62},
    {30, 85},
    {30, 119},
    {30, 147},
    {30, 148},
    {30, 204},
    {30, 225},
    {30, 246},
    {31, 20},
    {31, 28},
    {31, 49},
    {31, 58},
    {31, 70},
    {31, 91},
    {31, 110},
    {31, 141},
    {31, 151},
    {31, 175},
    {31, 177},
    {31, 207},
    {31, 227},
    {31, 247},
    {31, 248},
    {32, 0},
    {32, 26},
    {32, 27},
    {32, 56},
    {32, 65},
    {32, 126},
    {32, 182},
    {32, 197},
    {32, 201},
    {32, 217},
    {32, 226},
    {33, 49},
    {33, 59},
    {33, 72},
    {33, 109},
    {33, 134},
    {33, 139},
    {33, 149},
    {33, 154},
    {33, 155},
    {33, 164},
    {33, 165},
    {33, 173},
    {33, 174},
    {33, 185},
    {33, 200},
    {33, 227},
    {33, 231},
    {33, 237},
    {33, 244},
    {33, 252},
    {34, 9},
    {34, 11},
    {34, 14},
    {34, 15},
    {34, 67},
    {34, 74},
    {34, 90},
    {34, 104},
    {34, 121},
    {34, 147},
    {34, 152},
    {34, 153},
    {34, 169},
    {34, 186},
    {34, 189},
    {34, 190},
    {34, 192},
    {34, 199},
    {34, 206},
    {34, 207},
    {34, 213},
    {35, 39},
    {35, 56},
    {35, 80},
    {35, 102},
    {35, 107},
    {35, 118},
    {35, 145},
    {35, 151},
    {35, 167},
    {35, 215},
    {35, 227},
    {35, 232},
    {36, 41},
    {36, 44},
    {36, 51},
    {36, 60},
    {36, 105},
    {36, 138},
    {36, 161},
    {36, 195},
    {36, 209},
    {36, 222},
    {36, 232},
    {36, 239},
    {37, 20},
    {37, 22},
    {37, 34},
    {37, 63},
    {37, 68},
    {37, 101},
    {37, 106},
    {37, 107},
    {37, 113},
    {37, 135},
    {37, 138},
    {37, 145},
    {37, 146},
    {37, 151},
    {37, 163},
    {37, 176},
    {37, 177},
    {37, 204},
    {37, 237},
    {38, 12},
    {38, 22},
    {38, 31},
    {38, 35},
    {38, 42},
    {38, 46},
    {38, 75},
    {38, 81},
    {38, 90},
    {38, 95},
    {38, 101},
    {38, 131},
    {38, 157},
    {38, 171},
    {38, 199},
    {38, 214},
    {38, 219},
    {38, 254},
    {39, 10},
    {39, 28},
    {39, 41},
    {39, 56},
    {39, 65},
    {39, 79},
    {39, 93},
    {39, 104},
    {39, 112},
    {39, 131},
    {39, 156},
    {39, 157},
    {39, 166},
    {39, 169},
    {39, 171},
    {39, 187},
    {39, 202},
    {39, 204},
    {39, 211},
    {39, 216},
    {39, 228},
    {39, 232},
    {39, 240},
    {39, 250},
    {39, 255},
    {40, 5},
    {40, 10},
    {40, 11},
    {40, 14},
    {40, 29},
    {40, 35},
    {40, 38},
    {40, 73},
    {40, 78},
    {40, 85},
    {40, 95},
    {40, 98},
    {40, 99},
    {40, 136},
    {40, 143},
    {40, 150},
    {40, 164},
    {40, 192},
    {40, 233},
    {40, 245},
    {40, 250},
    {41, 39},
    {41, 42},
    {41, 43},
    {41, 45},
    {41, 47},
    {41, 53},
    {41, 64},
    {41, 69},
    {41, 76},
    {41, 77},
    {41, 88},
    {41, 110},
    {41, 125},
    {41, 146},
    {41, 179},
    {41, 180},
    {41, 188},
    {41, 199},
    {41, 204},
    {41, 226},
    {41, 240},
    {41, 243},
    {41, 248},
    {42, 25},
    {42, 33},
    {42, 41},
    {42, 86},
    {42, 105},
    {42, 119},
    {42, 130},
    {42, 132},
    {42, 171},
    {42, 184},
    {42, 188},
    {42, 193},
    {42, 194},
    {42, 195},
    {42, 198},
    {42, 205},
    {42, 213},
    {42, 243},
    {42, 252},
    {0, 21},
    {0, 128},
    {0, 136},
    {0, 167},
    {0, 226},
    {0, 233},
    {0, 235},
    {0, 238},
    {1, 1},
    {1, 108},
    {1, 130},
    {1, 152},
    {1, 215},
    {2, 56},
    {2, 78},
    {2, 104},
    {2, 143},
    {2, 201},
    {2, 216},
    {2, 241},
    {2, 244},
    {3, 2},
    {3, 5},
    {3, 8},
    {3, 30},
    {3, 33},
    {3, 43},
    {3, 44},
    {3, 46},
    {3, 47},
    {3, 49},
    {3, 53},
    {3, 62},
    {3, 64},
    {3, 67},
    {3, 74},
    {3, 78},
    {3, 81},
    {3, 82},
    {3, 94},
    {3, 96},
    {3, 111},
    {3, 112},
    {3, 126},
    {3, 128},
    {3, 130},
    {3, 132},
    {3, 134},
    {3, 149},
    {3, 156},
    {3, 160},
    {3, 166},
    {3, 171},
    {3, 181},
    {3, 183},
    {3, 184},
    {3, 195},
    {3, 208},
    {3, 213},
    {3, 219},
    {3, 224},
    {3, 226},
    {3, 239},
    {3, 242},
    {3, 254},
    {4, 3},
    {4, 7},
    {4, 20},
    {4, 23},
    {4, 28},
    {4, 47},
    {4, 59},
    {4, 72},
    {4, 86},
    {4, 87},
    {4, 93},
    {4, 101},
    {4, 109},
    {4, 110},
    {4, 111},
    {4, 117},
    {4, 145},
    {4, 170},
    {4, 178},
    {4, 187},
    {4, 191},
    {4, 193},
    {4, 196},
    {4, 200},
    {4, 201},
    {4, 205},
    {4, 207},
    {4, 215},
    {4, 222},
    {4, 223},
    {4, 225},
    {4, 227},
    {4, 241},
    {4, 254},
    {5, 0},
    {5, 3},
    {5, 7},
    {5, 14},
    {5, 20},
    {5, 26},
    {5, 27},
    {5, 50},
    {5, 52},
    {5, 53},
    {5, 60},
    {5, 68},
    {5, 72},
    {5, 73},
    {5, 91},
    {5, 97},
    {5, 98},
    {5, 100},
    {5, 102},
    {5, 108},
    {5, 136},
    {5, 138},
    {5, 142},
    {5, 144},
    {5, 152},
    {5, 153},
    {5, 157},
    {5, 158},
    {5, 163},
    {5, 178},
    {5, 182},
    {5, 184},
    {5, 189},
    {5, 190},
    {5, 212},
    {5, 214},
    {5, 227},
    {5, 231},
    {5, 234},
    {5, 251},
    {6, 0},
    {6, 6},
    {6, 17},
    {6, 19},
    {6, 21},
    {6, 22},
    {6, 26},
    {6, 32},
    {6, 36},
    {6, 45},
    {6, 49},
    {6, 59},
    {6, 68},
    {6, 69},
    {6, 70},
    {6, 73},
    {6, 81},
    {6, 101},
    {6, 104},
    {6, 107},
    {6, 114},
    {6, 141},
    {6, 145},
    {6, 150},
    {6, 153},
    {6, 156},
    {6, 175},
    {6, 178},
    {6, 179},
    {6, 199},
    {6, 204},
    {6, 211},
    {6, 215},
    {6, 216},
    {6, 232},
    {6, 237},
    {6, 247},
    {6, 250},
    {7, 1},
    {7, 4},
    {7, 6},
    {7, 11},
    {7, 12},
    {7, 14},
    {7, 16},
    {7, 20},
    {7, 25},
    {7, 34},
    {7, 41},
    {7, 57},
    {7, 83},
    {7, 88},
    {7, 100},
    {7, 113},
    {7, 115},
    {7, 127},
    {7, 128},
    {7, 142},
    {7, 145},
    {7, 190},
    {7, 193},
    {7, 208},
    {7, 211},
    {7, 212},
    {7, 213},
    {7, 215},
    {7, 218},
    {7, 219},
    {7, 222},
    {7, 224},
    {7, 227},
    {7, 228},
    {7, 229},
    {7, 232},
    {7, 237},
    {7, 240},
    {7, 249},
    {7, 250},
    {8, 5},
    {8, 17},
    {8, 23},
    {8, 32},
    {8, 49},
    {8, 52},
    {8, 70},
    {8, 71},
    {8, 77},
    {8, 78},
    {8, 84},
    {8, 89},
    {8, 92},
    {8, 102},
    {8, 116},
    {8, 117},
    {8, 132},
    {8, 151},
    {8, 155},
    {8, 171},
    {8, 187},
    {8, 201},
    {8, 203},
    {8, 224},
    {8, 235},
    {8, 242},
    {9, 6},
    {9, 7},
    {9, 20},
    {9, 27},
    {9, 37},
    {9, 50},
    {9, 71},
    {9, 75},
    {9, 91},
    {9, 95},
    {9, 101},
    {9, 103},
    {9, 111},
    {9, 115},
    {9, 136},
    {9, 139},
    {9, 142},
    {9, 143},
    {9, 152},
    {9, 165},
    {9, 170},
    {9, 177},
    {9, 185},
    {9, 195},
    {9, 202},
    {9, 215},
    {9, 217},
    {9, 224},
    {9, 235},
    {10, 36},
    {10, 62},
    {10, 63},
    {10, 102},
    {10, 105},
    {10, 114},
    {10, 122},
    {10, 136},
    {10, 141},
    {10, 144},
    {10, 171},
    {10, 181},
    {10, 193},
    {10, 204},
    {10, 220},
    {10, 221},
    {10, 222},
    {10, 226},
    {10, 233},
    {10, 240},
    {10, 244},
    {10, 253},
    {11, 21},
    {11, 27},
    {11, 34},
    {11, 36},
    {11, 44},
    {11, 45},
    {11, 57},
    {11, 68},
    {11, 69},
    {11, 72},
    {11, 76},
    {11, 85},
    {11, 86},
    {11, 97},
    {11, 111},
    {11, 122},
    {11, 130},
    {11, 145},
    {11, 149},
    {11, 156},
    {11, 161},
    {11, 170},
    {11, 184},
    {11, 186},
    {11, 188},
    {11, 190},
    {11, 212},
    {11, 215},
    {11, 216},
    {11, 222},
    {11, 238},
    {11, 240},
    {11, 249},
    {11, 251},
    {12, 19},
    {12, 38},
    {12, 48},
    {12, 52},
    {12, 74},
    {12, 84},
    {12, 113},
    {12, 120},
    {12, 124},
    {12, 146},
    {12, 155},
    {12, 163},
    {12, 170},
    {12, 184},
    {12, 187},
    {12, 191},
    {12, 199},
    {12, 204},
    {12, 216},
    {12, 217},
    {12, 242},
    {12, 244},
    {12, 247},
    {12, 249},
    {12, 255},
    {13, 2},
    {13, 5},
    {13, 9},
    {13, 16},
    {13, 21},
    {13, 26},
    {13, 27},
    {13, 30},
    {13, 46},
    {13, 47},
    {13, 59},
    {13, 79},
    {13, 84},
    {13, 109},
    {13, 118},
    {13, 120},
    {13, 137},
    {13, 138},
    {13, 152},
    {13, 153},
    {13, 154},
    {13, 160},
    {13, 168},
    {13, 177},
    {13, 178},
    {13, 183},
    {13, 186},
    {13, 199},
    {13, 200},
    {13, 215},
    {13, 219},
    {13, 220},
    {13, 228},
    {13, 229},
    {13, 235},
    {13, 236},
    {13, 238},
    {13, 241},
    {13, 243},
    {13, 244},
    {13, 253},
    {14, 2},
    {14, 29},
    {14, 40},
    {14, 42},
    {14, 50},
    {14, 54},
    {14, 62},
    {14, 63},
    {14, 64},
    {14, 79},
    {14, 80},
    {14, 88},
    {14, 101},
    {14, 106},
    {14, 114},
    {14, 127},
    {14, 130},
    {14, 144},
    {14, 150},
    {14, 194},
    {14, 226},
    {14, 252},
    {14, 255},
    {15, 12},
    {15, 14},
    {15, 18},
    {15, 35},
    {15, 39},
    {15, 52},
    {15, 57},
    {15, 71},
    {15, 73},
    {15, 76},
    {15, 83},
    {15, 84},
    {15, 86},
    {15, 89},
    {15, 98},
    {15, 108},
    {15, 110},
    {15, 115},
    {15, 127},
    {15, 132},
    {15, 133},
    {15, 143},
    {15, 149},
    {15, 158},
    {15, 160},
    {15, 178},
    {15, 179},
    {15, 183},
    {15, 197},
    {15, 226},
    {15, 228},
    {15, 235},
    {15, 245},
    {16, 3},
    {16, 10},
    {16, 19},
    {16, 25},
    {16, 50},
    {16, 55},
    {16, 58},
    {16, 63},
    {16, 68},
    {16, 78},
    {16, 79},
    {16, 81},
    {16, 88},
    {16, 91},
    {16, 95},
    {16, 101},
    {16, 103},
    {16, 111},
    {16, 126},
    {16, 127},
    {16, 142},
    {16, 148},
    {16, 155},
    {16, 158},
    {16, 180},
    {16, 197},
    {16, 204},
    {16, 227},
    {16, 233},
    {16, 235},
    {16, 253},
    {17, 5},
    {17, 28},
    {17, 29},
    {17, 33},
    {17, 42},
    {17, 48},
    {17, 68},
    {17, 72},
    {17, 86},
    {17, 91},
    {17, 99},
    {17, 115},
    {17, 129},
    {17, 132},
    {17, 135},
    {17, 146},
    {17, 148},
    {17, 185},
    {17, 186},
    {17, 194},
    {17, 216},
    {17, 231},
    {17, 237},
    {17, 240},
    {17, 246},
    {17, 249},
    {17, 255},
    {18, 3},
    {18, 11},
    {18, 23},
    {18, 29},
    {18, 40},
    {18, 48},
    {18, 66},
    {18, 82},
    {18, 87},
    {18, 89},
    {18, 112},
    {18, 118},
    {18, 121},
    {18, 125},
    {18, 127},
    {18, 137},
    {18, 148},
    {18, 172},
    {18, 220},
    {18, 225},
    {18, 227},
    {18, 240},
    {18, 245},
    {18, 249},
    {19, 1},
    {19, 12},
    {19, 18},
    {19, 24},
    {19, 29},
    {19, 41},
    {19, 48},
    {19, 49},
    {19, 52},
    {19, 61},
    {19, 66},
    {19, 69},
    {19, 70},
    {19, 71},
    {19, 79},
    {19, 87},
    {19, 88},
    {19, 90},
    {19, 99},
    {19, 107},
    {19, 111},
    {19, 114},
    {19, 120},
    {19, 132},
    {19, 133},
    {19, 137},
    {19, 152},
    {19, 165},
    {19, 171},
    {19, 172},
    {19, 199},
    {19, 201},
    {19, 205},
    {19, 206},
    {19, 219},
    {19, 234},
    {19, 235},
    {19, 236},
    {19, 237},
    {19, 239},
    {19, 240},
    {19, 245},
    {19, 250},
    {20, 5},
    {20, 6},
    {20, 13},
    {20, 16},
    {20, 24},
    {20, 50},
    {20, 59},
    {20, 100},
    {20, 108},
    {20, 125},
    {20, 155},
    {20, 156},
    {20, 158},
    {20, 165},
    {20, 175},
    {20, 177},
    {20, 193},
    {20, 196},
    {20, 204},
    {20, 212},
    {20, 218},
    {20, 240},
    {20, 246},
    {20, 248},
    {20, 249},
    {21, 12},
    {21, 13},
    {21, 16},
    {21, 30},
    {21, 35},
    {21, 52},
    {21, 80},
    {21, 96},
    {21, 100},
    {21, 106},
    {21, 109},
    {21, 136},
    {21, 141},
    {21, 146},
    {21, 165},
    {21, 175},
    {21, 178},
    {21, 199},
    {21, 205},
    {21, 210},
    {21, 213},
    {21, 227},
    {21, 231},
    {21, 243},
    {21, 253},
    {22, 0},
    {22, 6},
    {22, 14},
    {22, 57},
    {22, 59},
    {22, 63},
    {22, 65},
    {22, 67},
    {22, 69},
    {22, 72},
    {22, 81},
    {22, 92},
    {22, 96},
    {22, 118},
    {22, 119},
    {22, 121},
    {22, 150},
    {22, 155},
    {22, 164},
    {22, 165},
    {22, 168},
    {22, 175},
    {22, 189},
    {22, 194},
    {22, 203},
    {22, 204},
    {22, 211},
    {22, 240},
    {22, 246},
    {23, 5},
    {23, 6},
    {23, 15},
    {23, 27},
    {23, 32},
    {23, 56},
    {23, 78},
    {23, 105},
    {23, 106},
    {23, 114},
    {23, 124},
    {23, 128},
    {23, 131},
    {23, 146},
    {23, 148},
    {23, 179},
    {23, 181},
    {23, 187},
    {23, 201},
    {23, 219},
    {23, 226},
    {23, 227},
    {23, 232},
    {23, 237},
    {23, 248},
    {24, 1},
    {24, 20},
    {24, 22},
    {24, 24},
    {24, 42},
    {24, 45},
    {24, 49},
    {24, 84},
    {24, 93},
    {24, 103},
    {24, 124},
    {24, 128},
    {24, 142},
    {24, 152},
    {24, 188},
    {24, 217},
    {24, 244},
    {24, 247},
    {25, 9},
    {25, 10},
    {25, 11},
    {25, 15},
    {25, 19},
    {25, 22},
    {25, 24},
    {25, 33},
    {25, 39},
    {25, 49},
    {25, 56},
    {25, 57},
    {25, 58},
    {25, 61},
    {25, 72},
    {25, 75},
    {25, 85},
    {25, 92},
    {25, 93},
    {25, 94},
    {25, 109},
    {25, 117},
    {25, 125},
    {25, 134},
    {25, 147},
    {25, 152},
    {25, 159},
    {25, 168},
    {25, 188},
    {25, 190},
    {25, 193},
    {25, 203},
    {25, 215},
    {25, 229},
    {25, 234},
    {25, 236},
    {25, 240},
    {25, 242},
    {25, 247},
    {25, 250},
    {25, 251},
    {26, 0},
    {26, 5},
    {26, 6},
    {26, 12},
    {26, 17},
    {26, 25},
    {26, 52},
    {26, 72},
    {26, 76},
    {26, 87},
    {26, 92},
    {26, 96},
    {26, 101},
    {26, 108},
    {26, 118},
    {26, 121},
    {26, 122},
    {26, 126},
    {26, 135},
    {26, 140},
    {26, 158},
    {26, 168},
    {26, 183},
    {26, 184},
    {26, 186},
    {26, 190},
    {26, 195},
    {26, 206},
    {26, 221},
    {26, 232},
    {26, 238},
    {26, 239},
    {26, 241},
    {27, 5},
    {27, 19},
    {27, 30},
    {27, 33},
    {27, 34},
    {27, 36},
    {27, 46},
    {27, 58},
    {27, 74},
    {27, 83},
    {27, 97},
    {27, 107},
    {27, 117},
    {27, 119},
    {27, 136},
    {27, 170},
    {27, 186},
    {27, 199},
    {27, 202},
    {27, 220},
    {27, 222},
    {27, 238},
    {27, 239},
    {27, 241},
    {28, 3},
    {28, 10},
    {28, 24},
    {28, 41},
    {28, 42},
    {28, 53},
    {28, 58},
    {28, 61},
    {28, 69},
    {28, 110},
    {28, 130},
    {28, 137},
    {28, 165},
    {28, 174},
    {28, 186},
    {28, 203},
    {28, 204},
    {28, 206},
    {28, 214},
    {28, 218},
    {28, 238},
    {28, 242},
    {28, 247},
    {28, 251},
    {28, 255},
    {29, 7},
    {29, 11},
    {29, 13},
    {29, 23},
    {29, 37},
    {29, 53},
    {29, 56},
    {29, 59},
    {29, 61},
    {29, 62},
    {29, 66},
    {29, 72},
    {29, 79},
    {29, 81},
    {29, 91},
    {29, 92},
    {29, 100},
    {29, 103},
    {29, 111},
    {29, 120},
    {29, 121},
    {29, 125},
    {29, 129},
    {29, 134},
    {29, 140},
    {29, 141},
    {29, 147},
    {29, 149},
    {29, 164},
    {29, 166},
    {29, 172},
    {29, 181},
    {29, 187},
    {29, 203},
    {29, 208},
    {29, 212},
    {29, 224},
    {29, 225},
    {29, 232},
    {29, 236},
    {29, 245},
    {30, 15},
    {30, 16},
    {30, 26},
    {30, 38},
    {30, 70},
    {30, 78},
    {30, 79},
    {30, 89},
    {30, 96},
    {30, 100},
    {30, 108},
    {30, 115},
    {30, 131},
    {30, 143},
    {30, 150},
    {30, 160},
    {30, 171},
    {30, 174},
    {30, 179},
    {30, 180},
    {30, 190},
    {30, 193},
    {30, 198},
    {30, 201},
    {30, 203},
    {30, 206},
    {30, 218},
    {30, 223},
    {30, 252},
    {31, 15},
    {31, 16},
    {31, 40},
    {31, 42},
    {31, 46},
    {31, 53},
    {31, 61},
    {31, 75},
    {31, 79},
    {31, 81},
    {31, 82},
    {31, 83},
    {31, 87},
    {31, 93},
    {31, 104},
    {31, 119},
    {31, 122},
    {31, 124},
    {31, 131},
    {31, 165},
    {31, 171},
    {31, 172},
    {31, 173},
    {31, 185},
    {31, 187},
    {31, 194},
    {31, 218},
    {31, 222},
    {31, 224},
    {31, 234},
    {31, 250},
    {31, 251},
    {32, 11},
    {32, 19},
    {32, 30},
    {32, 32},
    {32, 35},
    {32, 46},
    {32, 51},
    {32, 57},
    {32, 64},
    {32, 72},
    {32, 77},
    {32, 83},
    {32, 84},
    {32, 90},
    {32, 106},
    {32, 111},
    {32, 127},
    {32, 128},
    {32, 135},
    {32, 150},
    {32, 155},
    {32, 161},
    {32, 171},
    {32, 185},
    {32, 190},
    {32, 198},
    {32, 203},
    {32, 211},
    {32, 223},
    {32, 224},
    {32, 228},
    {32, 230},
    {32, 242},
    {32, 249},
    {33, 1},
    {33, 4},
    {33, 6},
    {33, 11},
    {33, 13},
    {33, 15},
    {33, 22},
    {33, 30},
    {33, 60},
    {33, 71},
    {33, 76},
    {33, 113},
    {33, 137},
    {33, 159},
    {33, 172},
    {33, 180},
    {33, 192},
    {33, 195},
    {33, 221},
    {33, 223},
    {33, 236},
    {33, 250},
    {33, 255},
    {34, 17},
    {34, 20},
    {34, 25},
    {34, 26},
    {34, 30},
    {34, 39},
    {34, 45},
    {34, 47},
    {34, 49},
    {34, 56},
    {34, 64},
    {34, 75},
    {34, 84},
    {34, 88},
    {34, 95},
    {34, 96},
    {34, 102},
    {34, 108},
    {34, 115},
    {34, 119},
    {34, 122},
    {34, 129},
    {34, 133},
    {34, 138},
    {34, 145},
    {34, 151},
    {34, 157},
    {34, 171},
    {34, 177},
    {34, 182},
    {34, 191},
    {34, 198},
    {34, 201},
    {34, 208},
    {34, 212},
    {34, 216},
    {34, 219},
    {34, 221},
    {34, 228},
    {34, 235},
    {34, 255},
    {35, 7},
    {35, 11},
    {35, 18},
    {35, 23},
    {35, 30},
    {35, 40},
    {35, 45},
    {35, 58},
    {35, 59},
    {35, 65},
    {35, 66},
    {35, 67},
    {35, 70},
    {35, 73},
    {35, 89},
    {35, 92},
    {35, 122},
    {35, 125},
    {35, 139},
    {35, 152},
    {35, 163},
    {35, 171},
    {35, 186},
    {35, 189},
    {35, 191},
    {35, 218},
    {35, 220},
    {35, 238},
    {35, 246},
    {36, 9},
    {36, 45},
    {36, 50},
    {36, 61},
    {36, 71},
    {36, 80},
    {36, 89},
    {36, 91},
    {36, 93},
    {36, 96},
    {36, 121},
    {36, 122},
    {36, 135},
    {36, 180},
    {36, 181},
    {36, 186},
    {36, 192},
    {36, 204},
    {36, 208},
    {36, 211},
    {36, 216},
    {36, 224},
    {36, 230},
    {36, 234},
    {36, 235},
    {36, 254},
    {37, 0},
    {37, 25},
    {37, 29},
    {37, 38},
    {37, 39},
    {37, 42},
    {37, 53},
    {37, 54},
    {37, 56},
    {37, 64},
    {37, 73},
    {37, 74},
    {37, 77},
    {37, 100},
    {37, 116},
    {37, 117},
    {37, 132},
    {37, 133},
    {37, 137},
    {37, 143},
    {37, 154},
    {37, 211},
    {37, 219},
    {37, 226},
    {37, 235},
    {37, 236},
    {37, 238},
    {38, 4},
    {38, 11},
    {38, 14},
    {38, 69},
    {38, 71},
    {38, 78},
    {38, 82},
    {38, 85},
    {38, 104},
    {38, 106},
    {38, 120},
    {38, 121},
    {38, 129},
    {38, 140},
    {38, 142},
    {38, 150},
    {38, 172},
    {38, 192},
    {38, 212},
    {38, 226},
    {38, 237},
    {38, 239},
    {39, 3},
    {39, 8},
    {39, 23},
    {39, 27},
    {39, 31},
    {39, 32},
    {39, 46},
    {39, 63},
    {39, 66},
    {39, 69},
    {39, 73},
    {39, 74},
    {39, 94},
    {39, 99},
    {39, 109},
    {39, 110},
    {39, 111},
    {39, 114},
    {39, 118},
    {39, 120},
    {39, 136},
    {39, 137},
    {39, 143},
    {39, 148},
    {39, 176},
    {39, 184},
    {39, 190},
    {39, 192},
    {39, 193},
    {39, 205},
    {39, 206},
    {39, 217},
    {39, 222},
    {39, 236},
    {39, 243},
    {40, 2},
    {40, 9},
    {40, 23},
    {40, 25},
    {40, 60},
    {40, 61},
    {40, 80},
    {40, 81},
    {40, 94},
    {40, 118},
    {40, 119},
    {40, 137},
    {40, 149},
    {40, 155},
    {40, 156},
    {40, 169},
    {40, 172},
    {40, 178},
    {40, 189},
    {40, 195},
    {40, 198},
    {40, 200},
    {40, 202},
    {40, 220},
    {40, 223},
    {40, 230},
    {40, 243},
    {40, 252},
    {40, 253},
    {41, 1},
    {41, 8},
    {41, 11},
    {41, 13},
    {41, 22},
    {41, 26},
    {41, 29},
    {41, 40},
    {41, 55},
    {41, 56},
    {41, 72},
    {41, 73},
    {41, 86},
    {41, 89},
    {41, 99},
    {41, 105},
    {41, 108},
    {41, 113},
    {41, 132},
    {41, 137},
    {41, 144},
    {41, 147},
    {41, 158},
    {41, 174},
    {41, 181},
    {41, 183},
    {41, 187},
    {41, 200},
    {41, 223},
    {41, 233},
    {41, 244},
    {41, 249},
    {42, 11},
    {42, 12},
    {42, 16},
    {42, 20},
    {42, 26},
    {42, 32},
    {42, 39},
    {42, 53},
    {42, 60},
    {42, 84},
    {42, 103},
    {42, 114},
    {42, 118},
    {42, 121},
    {42, 123},
    {42, 124},
    {42, 126},
    {42, 142},
    {42, 143},
    {42, 147},
    {42, 150},
    {42, 152},
    {42, 158},
    {42, 164},
    {42, 168},
    {42, 176},
    {42, 196},
    {42, 208},
    {42, 212},
    {42, 214},
    {42, 217},
    {42, 226},
    {42, 228},
    {42, 235},
    {42, 241},
    {42, 246},
    {42, 247},
    {42, 251},
    {42, 254},
};
static const uint32_t ds4_default_streaming_hotlist_flash_count =
    (uint32_t)(sizeof(ds4_default_streaming_hotlist_flash) /
               sizeof(ds4_default_streaming_hotlist_flash[0]));
````

## File: ds4_tool_compress.c
````c
#include "ds4_tool_compress.h"

#include <ctype.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DS4_TOOL_COMPRESS_MIN_BYTES 4096u
#define DS4_TOOL_COMPRESS_HUGE_BYTES 32768u
#define DS4_TOOL_COMPRESS_MAX_INLINE_BYTES 12000u
#define DS4_TOOL_COMPRESS_MIN_RATIO_NUM 4u
#define DS4_TOOL_COMPRESS_MIN_RATIO_DEN 5u

typedef struct {
    char *ptr;
    size_t len;
    size_t cap;
} ds4_tc_buf;

typedef struct {
    size_t start;
    size_t content_end;
    size_t end;
} ds4_tc_line;

typedef struct {
    ds4_tc_line *v;
    size_t len;
    size_t cap;
} ds4_tc_lines;

typedef struct {
    char *text;
    uint64_t omitted_lines;
    const char *strategy;
} ds4_tc_candidate;

static void ds4_tc_set_err(char *err, size_t err_len, const char *msg) {
    if (err && err_len) snprintf(err, err_len, "%s", msg ? msg : "unknown error");
}

static bool ds4_tc_buf_reserve(ds4_tc_buf *b, size_t add) {
    if (add > (size_t)-1 - b->len - 1) return false;
    size_t need = b->len + add + 1;
    if (need <= b->cap) return true;
    size_t cap = b->cap ? b->cap * 2 : 1024;
    while (cap < need) {
        if (cap > (size_t)-1 / 2) {
            cap = need;
            break;
        }
        cap *= 2;
    }
    char *p = realloc(b->ptr, cap);
    if (!p) return false;
    b->ptr = p;
    b->cap = cap;
    return true;
}

static bool ds4_tc_buf_append(ds4_tc_buf *b, const char *s, size_t n) {
    if (!n) return true;
    if (!ds4_tc_buf_reserve(b, n)) return false;
    memcpy(b->ptr + b->len, s, n);
    b->len += n;
    b->ptr[b->len] = '\0';
    return true;
}

static bool ds4_tc_buf_puts(ds4_tc_buf *b, const char *s) {
    return ds4_tc_buf_append(b, s ? s : "", s ? strlen(s) : 0);
}

static bool ds4_tc_buf_printf(ds4_tc_buf *b, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    va_list aq;
    va_copy(aq, ap);
    int n = vsnprintf(NULL, 0, fmt, aq);
    va_end(aq);
    if (n < 0) {
        va_end(ap);
        return false;
    }
    if (!ds4_tc_buf_reserve(b, (size_t)n)) {
        va_end(ap);
        return false;
    }
    vsnprintf(b->ptr + b->len, b->cap - b->len, fmt, ap);
    va_end(ap);
    b->len += (size_t)n;
    return true;
}

static char *ds4_tc_buf_take(ds4_tc_buf *b) {
    if (!b->ptr) {
        b->ptr = malloc(1);
        if (!b->ptr) return NULL;
        b->ptr[0] = '\0';
    }
    char *p = b->ptr;
    b->ptr = NULL;
    b->len = b->cap = 0;
    return p;
}

static void ds4_tc_lines_free(ds4_tc_lines *lines) {
    free(lines->v);
    memset(lines, 0, sizeof(*lines));
}

static bool ds4_tc_lines_push(ds4_tc_lines *lines, ds4_tc_line line) {
    if (lines->len == lines->cap) {
        size_t cap = lines->cap ? lines->cap * 2 : 256;
        ds4_tc_line *p = realloc(lines->v, cap * sizeof(lines->v[0]));
        if (!p) return false;
        lines->v = p;
        lines->cap = cap;
    }
    lines->v[lines->len++] = line;
    return true;
}

static bool ds4_tc_split_lines(const char *text, size_t len, ds4_tc_lines *lines) {
    size_t pos = 0;
    while (pos < len) {
        size_t start = pos;
        while (pos < len && text[pos] != '\n' && text[pos] != '\r') pos++;
        size_t content_end = pos;
        if (pos < len) {
            if (text[pos] == '\r' && pos + 1 < len && text[pos + 1] == '\n') pos += 2;
            else pos++;
        }
        if (!ds4_tc_lines_push(lines, (ds4_tc_line){start, content_end, pos}))
            return false;
    }
    return true;
}

static bool ds4_tc_line_starts_with(const char *text, ds4_tc_line line, const char *prefix) {
    size_t n = strlen(prefix);
    return line.content_end - line.start >= n && memcmp(text + line.start, prefix, n) == 0;
}

static bool ds4_tc_line_contains_ci(const char *text, ds4_tc_line line, const char *needle) {
    size_t nn = strlen(needle);
    size_t ln = line.content_end - line.start;
    if (!nn || nn > ln) return false;
    for (size_t i = 0; i + nn <= ln; i++) {
        bool ok = true;
        for (size_t j = 0; j < nn; j++) {
            unsigned char a = (unsigned char)text[line.start + i + j];
            unsigned char b = (unsigned char)needle[j];
            if (tolower(a) != tolower(b)) {
                ok = false;
                break;
            }
        }
        if (ok) return true;
    }
    return false;
}

static bool ds4_tc_line_important(const char *text, ds4_tc_line line) {
    static const char *needles[] = {
        "error", "fatal", "failed", "traceback", "panic", "exception",
        "warning", "undefined reference", "segmentation fault", "todo", "fail"
    };
    for (size_t i = 0; i < sizeof(needles) / sizeof(needles[0]); i++) {
        if (ds4_tc_line_contains_ci(text, line, needles[i])) return true;
    }
    return false;
}

static bool ds4_tc_append_line(ds4_tc_buf *b, const char *text, ds4_tc_line line) {
    return ds4_tc_buf_append(b, text + line.start, line.end - line.start);
}

static const char *ds4_tc_first_nonspace(const char *text, size_t len) {
    size_t i = 0;
    while (i < len && isspace((unsigned char)text[i])) i++;
    return text + i;
}

static int ds4_tc_count_substring(const char *text, size_t len, const char *needle) {
    int count = 0;
    size_t nn = strlen(needle);
    if (!nn || nn > len) return 0;
    for (size_t i = 0; i + nn <= len; i++) {
        if (memcmp(text + i, needle, nn) == 0) count++;
    }
    return count;
}

static bool ds4_tc_looks_grep_line(const char *p, size_t n) {
    size_t i = 0;
    if (!n || p[0] == ' ' || p[0] == '\t') return false;
    while (i < n && p[i] != ':' && p[i] != '\n' && p[i] != '\r') i++;
    if (i == 0 || i + 2 >= n || p[i] != ':') return false;
    i++;
    size_t digits = 0;
    while (i < n && isdigit((unsigned char)p[i])) {
        digits++;
        i++;
    }
    return digits > 0 && i < n && p[i] == ':';
}

static bool ds4_tc_looks_numbered_match_line(const char *p, size_t n) {
    size_t i = 0;
    while (i < n && (p[i] == ' ' || p[i] == '\t')) i++;
    size_t digits = 0;
    while (i < n && isdigit((unsigned char)p[i])) {
        digits++;
        i++;
    }
    return digits > 0 && i < n && (p[i] == ' ' || p[i] == '\t');
}

const char *ds4_tool_content_kind_name(ds4_tool_content_kind kind) {
    switch (kind) {
    case DS4_TOOL_CONTENT_SEARCH: return "search";
    case DS4_TOOL_CONTENT_LOG: return "log";
    case DS4_TOOL_CONTENT_JSON_ARRAY: return "json_array";
    case DS4_TOOL_CONTENT_DIFF: return "diff";
    case DS4_TOOL_CONTENT_FILE: return "file";
    case DS4_TOOL_CONTENT_TRACE: return "trace";
    default: return "unknown";
    }
}

ds4_tool_content_kind ds4_tool_classify_output(const char *tool_name,
                                               const char *text,
                                               size_t len) {
    if (!text) text = "";
    if (tool_name && !strcmp(tool_name, "retrieve_context_blob"))
        return DS4_TOOL_CONTENT_UNKNOWN;
    if (tool_name && (!strcmp(tool_name, "read") || !strcmp(tool_name, "more") ||
                      !strcmp(tool_name, "cat") || !strcmp(tool_name, "crawl")))
        return DS4_TOOL_CONTENT_FILE;

    const char *p = ds4_tc_first_nonspace(text, len);
    size_t rem = len - (size_t)(p - text);
    if ((rem >= 10 && !memcmp(p, "diff --git", 10)) ||
        strstr(text, "\ndiff --git ") || ds4_tc_count_substring(text, len, "\n@@ ") >= 2)
        return DS4_TOOL_CONTENT_DIFF;
    if (rem && p[0] == '[' && strchr(p, '{') && len > DS4_TOOL_COMPRESS_MIN_BYTES)
        return DS4_TOOL_CONTENT_JSON_ARRAY;
    if ((tool_name && !strcmp(tool_name, "search")) || strstr(text, "matches shown\n") ||
        ds4_tc_count_substring(text, len, ":") > 20)
    {
        ds4_tc_lines lines = {0};
        int grepish = 0, numbered = 0;
        if (ds4_tc_split_lines(text, len, &lines)) {
            for (size_t i = 0; i < lines.len && i < 300; i++) {
                const char *lp = text + lines.v[i].start;
                size_t ln = lines.v[i].content_end - lines.v[i].start;
                if (ds4_tc_looks_grep_line(lp, ln)) grepish++;
                if (ds4_tc_looks_numbered_match_line(lp, ln)) numbered++;
            }
        }
        ds4_tc_lines_free(&lines);
        if (grepish >= 8 || numbered >= 8 || (tool_name && !strcmp(tool_name, "search")))
            return DS4_TOOL_CONTENT_SEARCH;
    }
    if (strstr(text, "Traceback") || strstr(text, "FAILED") || strstr(text, "panic") ||
        strstr(text, "error:") || strstr(text, "warning:") || strstr(text, "Exception") ||
        strstr(text, "undefined reference"))
        return DS4_TOOL_CONTENT_LOG;
    if (tool_name && (!strcmp(tool_name, "bash") || !strcmp(tool_name, "bash_status") ||
                      !strcmp(tool_name, "bash_stop")))
        return DS4_TOOL_CONTENT_LOG;
    if ((strstr(text, "Tool result") && (strstr(text, "(read)") || strstr(text, "(more)"))) ||
        strstr(text, "continue_offset=") || strstr(text, "[Read truncated"))
        return DS4_TOOL_CONTENT_FILE;
    return DS4_TOOL_CONTENT_UNKNOWN;
}

static void ds4_tc_candidate_free(ds4_tc_candidate *c) {
    free(c->text);
    memset(c, 0, sizeof(*c));
}

static ds4_tc_candidate ds4_tc_compress_log(const char *text, size_t len) {
    ds4_tc_candidate cand = {.strategy = "log_compressor"};
    ds4_tc_lines lines = {0};
    if (!ds4_tc_split_lines(text, len, &lines)) return cand;
    bool *show = calloc(lines.len ? lines.len : 1, sizeof(bool));
    if (!show) {
        ds4_tc_lines_free(&lines);
        return cand;
    }
    size_t head = lines.len < 40 ? lines.len : 40;
    for (size_t i = 0; i < head; i++) show[i] = true;
    size_t tail_start = lines.len > 80 ? lines.len - 80 : 0;
    for (size_t i = tail_start; i < lines.len; i++) show[i] = true;
    size_t important_added = 0;
    for (size_t i = 0; i < lines.len && important_added < 200; i++) {
        if (ds4_tc_line_important(text, lines.v[i])) {
            if (!show[i]) important_added++;
            show[i] = true;
        }
    }

    size_t shown = 0;
    for (size_t i = 0; i < lines.len; i++) if (show[i]) shown++;
    cand.omitted_lines = lines.len > shown ? (uint64_t)(lines.len - shown) : 0;

    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
            "[log output compressed]\noriginal_lines: %zu\nshown_lines: %zu\nomitted_lines: %llu\n\nimportant/head/tail lines:\n",
            lines.len, shown, (unsigned long long)cand.omitted_lines)) goto done;
    for (size_t i = 0; i < lines.len; i++) {
        if (!show[i]) continue;
        if (b.len > DS4_TOOL_COMPRESS_MAX_INLINE_BYTES) {
            cand.omitted_lines += (uint64_t)(shown - i);
            break;
        }
        if (!ds4_tc_append_line(&b, text, lines.v[i])) goto done;
    }
    cand.text = ds4_tc_buf_take(&b);
done:
    free(b.ptr);
    free(show);
    ds4_tc_lines_free(&lines);
    return cand;
}

typedef struct {
    char name[192];
    int total;
    int shown;
} ds4_tc_file_stat;

static int ds4_tc_find_file(ds4_tc_file_stat *stats, int n, const char *name, size_t len) {
    if (len >= sizeof(stats[0].name)) len = sizeof(stats[0].name) - 1;
    for (int i = 0; i < n; i++) {
        if (strlen(stats[i].name) == len && !memcmp(stats[i].name, name, len)) return i;
    }
    return -1;
}

static ds4_tc_candidate ds4_tc_compress_search(const char *text, size_t len) {
    ds4_tc_candidate cand = {.strategy = "search_compressor"};
    ds4_tc_lines lines = {0};
    if (!ds4_tc_split_lines(text, len, &lines)) return cand;
    ds4_tc_file_stat stats[96];
    memset(stats, 0, sizeof(stats));
    int stats_len = 0;
    const char *current_file = NULL;
    size_t current_file_len = 0;
    bool *show = calloc(lines.len ? lines.len : 1, sizeof(bool));
    if (!show) {
        ds4_tc_lines_free(&lines);
        return cand;
    }

    for (size_t i = 0; i < lines.len; i++) {
        const char *lp = text + lines.v[i].start;
        size_t ln = lines.v[i].content_end - lines.v[i].start;
        if (ln == 0) continue;
        const char *file_name = current_file;
        size_t file_len = current_file_len;
        bool match_line = false;
        if (ds4_tc_looks_grep_line(lp, ln)) {
            const char *colon = memchr(lp, ':', ln);
            file_name = lp;
            file_len = (size_t)(colon - lp);
            match_line = true;
        } else if (ds4_tc_looks_numbered_match_line(lp, ln) && current_file) {
            match_line = true;
        } else if (lp[0] != ' ' && lp[0] != '\t' && !strstr(lp, "matches shown")) {
            current_file = lp;
            current_file_len = ln;
            if (stats_len < (int)(sizeof(stats) / sizeof(stats[0])) &&
                ds4_tc_find_file(stats, stats_len, lp, ln) < 0)
            {
                size_t copy = ln < sizeof(stats[0].name) - 1 ? ln : sizeof(stats[0].name) - 1;
                memcpy(stats[stats_len].name, lp, copy);
                stats[stats_len].name[copy] = '\0';
                stats_len++;
            }
            show[i] = true;
        }
        if (!match_line) continue;
        int si = file_name ? ds4_tc_find_file(stats, stats_len, file_name, file_len) : -1;
        if (si < 0 && stats_len < (int)(sizeof(stats) / sizeof(stats[0]))) {
            si = stats_len++;
            size_t copy = file_len < sizeof(stats[0].name) - 1 ? file_len : sizeof(stats[0].name) - 1;
            memcpy(stats[si].name, file_name, copy);
            stats[si].name[copy] = '\0';
        }
        if (si >= 0) stats[si].total++;
        bool important = ds4_tc_line_important(text, lines.v[i]);
        if ((si >= 0 && stats[si].shown < 5) || important) {
            show[i] = true;
            if (si >= 0) stats[si].shown++;
        }
    }

    size_t shown = 0;
    for (size_t i = 0; i < lines.len; i++) if (show[i]) shown++;
    cand.omitted_lines = lines.len > shown ? (uint64_t)(lines.len - shown) : 0;

    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
            "[search output compressed]\noriginal_lines: %zu\nshown_lines: %zu\nomitted_lines: %llu\nmatches_by_file:\n",
            lines.len, shown, (unsigned long long)cand.omitted_lines)) goto done;
    for (int i = 0; i < stats_len; i++) {
        if (!stats[i].name[0]) continue;
        if (!ds4_tc_buf_printf(&b, "- %s: %d matches, shown %d\n",
                               stats[i].name, stats[i].total, stats[i].shown)) goto done;
    }
    if (!ds4_tc_buf_puts(&b, "\nTop matches:\n")) goto done;
    for (size_t i = 0; i < lines.len; i++) {
        if (!show[i]) continue;
        if (b.len > DS4_TOOL_COMPRESS_MAX_INLINE_BYTES) break;
        if (!ds4_tc_append_line(&b, text, lines.v[i])) goto done;
    }
    cand.text = ds4_tc_buf_take(&b);
done:
    free(b.ptr);
    free(show);
    ds4_tc_lines_free(&lines);
    return cand;
}

static ds4_tc_candidate ds4_tc_compress_diff(const char *text, size_t len) {
    ds4_tc_candidate cand = {.strategy = "diff_compressor"};
    ds4_tc_lines lines = {0};
    if (!ds4_tc_split_lines(text, len, &lines)) return cand;
    size_t files = 0, plus = 0, minus = 0, shown = 0;
    ds4_tc_buf body = {0};
    for (size_t i = 0; i < lines.len; i++) {
        const char *lp = text + lines.v[i].start;
        size_t ln = lines.v[i].content_end - lines.v[i].start;
        bool keep = false;
        if (ds4_tc_line_starts_with(text, lines.v[i], "diff --git")) { files++; keep = true; }
        else if (ds4_tc_line_starts_with(text, lines.v[i], "@@ ")) keep = true;
        else if (ds4_tc_line_starts_with(text, lines.v[i], "+++ ") ||
                 ds4_tc_line_starts_with(text, lines.v[i], "--- ")) keep = true;
        else if (ln && lp[0] == '+' && !ds4_tc_line_starts_with(text, lines.v[i], "+++")) { plus++; keep = true; }
        else if (ln && lp[0] == '-' && !ds4_tc_line_starts_with(text, lines.v[i], "---")) { minus++; keep = true; }
        if (!keep) continue;
        if (body.len < DS4_TOOL_COMPRESS_MAX_INLINE_BYTES && ds4_tc_append_line(&body, text, lines.v[i]))
            shown++;
    }
    cand.omitted_lines = lines.len > shown ? (uint64_t)(lines.len - shown) : 0;
    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
            "[diff compressed]\nfiles_changed: %zu\nsummary: +%zu -%zu\nshown_lines: %zu\nomitted_lines: %llu\nshown_hunks:\n",
            files, plus, minus, shown, (unsigned long long)cand.omitted_lines)) goto done;
    if (!ds4_tc_buf_puts(&b, body.ptr ? body.ptr : "")) goto done;
    cand.text = ds4_tc_buf_take(&b);
done:
    free(body.ptr);
    free(b.ptr);
    ds4_tc_lines_free(&lines);
    return cand;
}

static ds4_tc_candidate ds4_tc_compress_json_array(const char *text, size_t len) {
    ds4_tc_candidate cand = {.strategy = "json_array_compressor"};
    size_t objects = 0;
    for (size_t i = 0; i < len; i++) if (text[i] == '{') objects++;
    size_t head = len < 6000 ? len : 6000;
    size_t tail = len > head + 4000 ? 4000 : 0;
    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
            "[json array compressed]\nestimated_items: %zu\nshown: first %zu bytes%s\n\nsample_first:\n",
            objects, head, tail ? " + last 4000 bytes" : "")) goto done;
    if (!ds4_tc_buf_append(&b, text, head)) goto done;
    if (head && b.ptr[b.len - 1] != '\n' && !ds4_tc_buf_puts(&b, "\n")) goto done;
    if (tail) {
        if (!ds4_tc_buf_puts(&b, "\nsample_last:\n")) goto done;
        if (!ds4_tc_buf_append(&b, text + len - tail, tail)) goto done;
        if (b.ptr[b.len - 1] != '\n' && !ds4_tc_buf_puts(&b, "\n")) goto done;
    }
    cand.omitted_lines = 0;
    cand.text = ds4_tc_buf_take(&b);
done:
    free(b.ptr);
    return cand;
}

static ds4_tc_candidate ds4_tc_compress_file(const char *text, size_t len, const char *strategy) {
    ds4_tc_candidate cand = {.strategy = strategy};
    ds4_tc_lines lines = {0};
    if (!ds4_tc_split_lines(text, len, &lines)) return cand;
    size_t head = lines.len < 100 ? lines.len : 100;
    size_t tail = lines.len > head + 80 ? 80 : 0;
    size_t shown = head + tail;
    cand.omitted_lines = lines.len > shown ? (uint64_t)(lines.len - shown) : 0;
    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
            "[file content compressed]\noriginal_lines: %zu\nshown: head %zu lines%s\nomitted_lines: %llu\n\nhead:\n",
            lines.len, head, tail ? " + tail 80 lines" : "",
            (unsigned long long)cand.omitted_lines)) goto done;
    for (size_t i = 0; i < head; i++) {
        if (b.len > DS4_TOOL_COMPRESS_MAX_INLINE_BYTES) break;
        if (!ds4_tc_append_line(&b, text, lines.v[i])) goto done;
    }
    if (tail) {
        if (!ds4_tc_buf_puts(&b, "\ntail:\n")) goto done;
        for (size_t i = lines.len - tail; i < lines.len; i++) {
            if (b.len > DS4_TOOL_COMPRESS_MAX_INLINE_BYTES) break;
            if (!ds4_tc_append_line(&b, text, lines.v[i])) goto done;
        }
    }
    cand.text = ds4_tc_buf_take(&b);
done:
    free(b.ptr);
    ds4_tc_lines_free(&lines);
    return cand;
}

static char *ds4_tc_build_marker(const ds4_tool_compress_result *r,
                                 uint64_t compressed_bytes,
                                 const char *body) {
    ds4_tc_buf b = {0};
    if (!ds4_tc_buf_printf(&b,
        "[ds4 compressed tool output]\n"
        "strategy: %s\n"
        "kind: %s\n"
        "original_bytes: %llu\n"
        "compressed_bytes: %llu\n"
        "blob_id: %s\n"
        "retrieve: retrieve_context_blob id=%s offset=0 length=20000\n"
        "note: lossy live-zone compression; use retrieve_context_blob for exact original bytes.\n\n",
        r->strategy,
        ds4_tool_content_kind_name(r->kind),
        (unsigned long long)r->original_bytes,
        (unsigned long long)compressed_bytes,
        r->blob_id,
        r->blob_id))
    {
        free(b.ptr);
        return NULL;
    }
    if (!ds4_tc_buf_puts(&b, body ? body : "")) {
        free(b.ptr);
        return NULL;
    }
    return ds4_tc_buf_take(&b);
}

bool ds4_tool_compress_result_text(const char *tool_name,
                                   const char *text,
                                   size_t len,
                                   const char *blob_base_dir,
                                   ds4_tool_compress_result *out,
                                   char *err,
                                   size_t err_len) {
    if (err && err_len) err[0] = '\0';
    if (!out) {
        ds4_tc_set_err(err, err_len, "missing compression output");
        return false;
    }
    memset(out, 0, sizeof(*out));
    out->original_bytes = (uint64_t)len;
    out->kind = ds4_tool_classify_output(tool_name, text, len);
    if (!text) text = "";
    if (tool_name && !strcmp(tool_name, "retrieve_context_blob")) return true;
    /* read/more/cat are line-paginated by the agent: the result size is the
     * model's explicit window. Head/tail compression here discards the middle
     * the model asked for and forces a blob-retrieve flow that smaller models
     * loop on, so only compress these when the result is genuinely huge. */
    bool paginated_read = tool_name && (!strcmp(tool_name, "read") ||
                                        !strcmp(tool_name, "more") ||
                                        !strcmp(tool_name, "cat"));
    size_t min_bytes = paginated_read ? DS4_TOOL_COMPRESS_HUGE_BYTES
                                      : DS4_TOOL_COMPRESS_MIN_BYTES;
    if (len < min_bytes) return true;

    ds4_tc_candidate cand = {0};
    switch (out->kind) {
    case DS4_TOOL_CONTENT_SEARCH:
        cand = ds4_tc_compress_search(text, len);
        break;
    case DS4_TOOL_CONTENT_DIFF:
        cand = ds4_tc_compress_diff(text, len);
        break;
    case DS4_TOOL_CONTENT_JSON_ARRAY:
        cand = ds4_tc_compress_json_array(text, len);
        break;
    case DS4_TOOL_CONTENT_FILE:
        cand = ds4_tc_compress_file(text, len, "file_head_tail_compressor");
        break;
    case DS4_TOOL_CONTENT_LOG:
        cand = ds4_tc_compress_log(text, len);
        break;
    default:
        if (len >= DS4_TOOL_COMPRESS_HUGE_BYTES) {
            out->kind = DS4_TOOL_CONTENT_FILE;
            cand = ds4_tc_compress_file(text, len, "generic_head_tail_compressor");
        }
        break;
    }

    if (!cand.text) return true;
    size_t cand_len = strlen(cand.text);
    if (cand_len * DS4_TOOL_COMPRESS_MIN_RATIO_DEN >= len * DS4_TOOL_COMPRESS_MIN_RATIO_NUM) {
        ds4_tc_candidate_free(&cand);
        return true;
    }
    if (!blob_base_dir || !blob_base_dir[0]) {
        ds4_tc_candidate_free(&cand);
        ds4_tc_set_err(err, err_len, "missing blob directory for lossy compression");
        return false;
    }

    ds4_context_blob_ref ref;
    if (!ds4_context_blob_put_text(blob_base_dir, text, len, &ref, err, err_len)) {
        ds4_tc_candidate_free(&cand);
        return false;
    }
    snprintf(out->strategy, sizeof(out->strategy), "%s", cand.strategy ? cand.strategy : "tool_compressor");
    snprintf(out->blob_id, sizeof(out->blob_id), "%s", ref.id);
    out->original_saved = true;
    out->omitted_lines = cand.omitted_lines;

    uint64_t compressed_bytes = (uint64_t)cand_len;
    char *final = NULL;
    for (int i = 0; i < 4; i++) {
        free(final);
        final = ds4_tc_build_marker(out, compressed_bytes, cand.text);
        if (!final) {
            ds4_tc_candidate_free(&cand);
            ds4_tc_set_err(err, err_len, "out of memory building compression marker");
            return false;
        }
        uint64_t actual = (uint64_t)strlen(final);
        if (actual == compressed_bytes) break;
        compressed_bytes = actual;
    }
    if (compressed_bytes * DS4_TOOL_COMPRESS_MIN_RATIO_DEN >= len * DS4_TOOL_COMPRESS_MIN_RATIO_NUM) {
        free(final);
        ds4_tc_candidate_free(&cand);
        memset(out, 0, sizeof(*out));
        out->original_bytes = (uint64_t)len;
        out->kind = ds4_tool_classify_output(tool_name, text, len);
        return true;
    }

    out->changed = true;
    out->compressed_bytes = compressed_bytes;
    out->text = final;
    ds4_tc_candidate_free(&cand);
    return true;
}

void ds4_tool_compress_result_free(ds4_tool_compress_result *r) {
    if (!r) return;
    free(r->text);
    memset(r, 0, sizeof(*r));
}
````

## File: ds4_tool_compress.h
````c
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
````

## File: ds4_web.c
````c
#include "ds4_web.h"

#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <netdb.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

#define DS4_WEB_DEFAULT_PORT 9333
#define DS4_WEB_CONNECT_TIMEOUT_MS 3000
#define DS4_WEB_CDP_TIMEOUT_MS 20000
#define DS4_WEB_MAX_RESULT_BYTES (1024*1024)

typedef struct {
    char *ptr;
    size_t len;
    size_t cap;
} web_buf;

struct ds4_web {
    char home[PATH_MAX];
    char profile_dir[PATH_MAX];
    int port;
    pid_t chrome_pid;
    bool browser_allowed;
    ds4_web_confirm_fn confirm;
    void *confirm_privdata;
    ds4_web_log_fn log;
    void *log_privdata;
    ds4_web_cancel_fn cancel;
    void *cancel_privdata;
    int next_cdp_id;
};

typedef struct {
    int fd;
    int next_id;
    ds4_web *web;
} cdp_ws;

typedef struct {
    char *id;
    char *ws_url;
} web_tab;

static void *web_xmalloc(size_t n) {
    void *p = malloc(n ? n : 1);
    if (!p) {
        perror("ds4_web: malloc");
        exit(1);
    }
    return p;
}

static char *web_xstrdup(const char *s) {
    if (!s) s = "";
    size_t n = strlen(s);
    char *p = web_xmalloc(n + 1);
    memcpy(p, s, n + 1);
    return p;
}

static void web_buf_append(web_buf *b, const char *s, size_t n) {
    if (!n) return;
    if (b->len + n + 1 > b->cap) {
        size_t cap = b->cap ? b->cap * 2 : 4096;
        while (cap < b->len + n + 1) cap *= 2;
        char *p = realloc(b->ptr, cap);
        if (!p) {
            perror("ds4_web: realloc");
            exit(1);
        }
        b->ptr = p;
        b->cap = cap;
    }
    memcpy(b->ptr + b->len, s, n);
    b->len += n;
    b->ptr[b->len] = '\0';
}

static void web_buf_puts(web_buf *b, const char *s) {
    web_buf_append(b, s, strlen(s));
}

static char *web_buf_take(web_buf *b) {
    if (!b->ptr) return web_xstrdup("");
    char *p = b->ptr;
    b->ptr = NULL;
    b->len = b->cap = 0;
    return p;
}

static void web_set_err(char *err, size_t err_len, const char *fmt, ...) {
    if (!err || err_len == 0) return;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(err, err_len, fmt, ap);
    va_end(ap);
}

static void web_log(ds4_web *web, const char *msg) {
    if (web && web->log) web->log(web->log_privdata, msg);
}

static double web_now_sec(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1000000000.0;
}

static bool web_cancelled(ds4_web *web) {
    return web && web->cancel && web->cancel(web->cancel_privdata);
}

static bool web_set_cancel_err(ds4_web *web, char *err, size_t err_len) {
    if (!web_cancelled(web)) return false;
    web_set_err(err, err_len, "interrupted");
    return true;
}

static bool web_sleep_ms(ds4_web *web, int ms) {
    int left = ms;
    while (left > 0) {
        if (web_cancelled(web)) return false;
        int step = left < 50 ? left : 50;
        usleep((useconds_t)step * 1000u);
        left -= step;
    }
    return !web_cancelled(web);
}

static bool web_err_is_interrupted(const char *err) {
    return err && !strcmp(err, "interrupted");
}

static bool web_mkdir_p(const char *path) {
    if (!path || !path[0]) return false;
    char tmp[PATH_MAX];
    snprintf(tmp, sizeof(tmp), "%s", path);
    for (char *p = tmp + 1; *p; p++) {
        if (*p != '/') continue;
        *p = '\0';
        if (mkdir(tmp, 0700) != 0 && errno != EEXIST) return false;
        *p = '/';
    }
    return mkdir(tmp, 0700) == 0 || errno == EEXIST;
}

static int web_tcp_connect(const char *host, int port, int timeout_ms,
                           char *err, size_t err_len) {
    char service[32];
    snprintf(service, sizeof(service), "%d", port);
    struct addrinfo hints;
    memset(&hints, 0, sizeof(hints));
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_family = AF_UNSPEC;
    struct addrinfo *res = NULL;
    int gai = getaddrinfo(host, service, &hints, &res);
    if (gai != 0) {
        web_set_err(err, err_len, "getaddrinfo %s: %s", host, gai_strerror(gai));
        return -1;
    }

    int fd = -1;
    for (struct addrinfo *ai = res; ai; ai = ai->ai_next) {
        fd = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd < 0) continue;
        int flags = fcntl(fd, F_GETFL, 0);
        if (flags >= 0) fcntl(fd, F_SETFL, flags | O_NONBLOCK);
        int rc = connect(fd, ai->ai_addr, ai->ai_addrlen);
        if (rc == 0) {
            if (flags >= 0) fcntl(fd, F_SETFL, flags);
            break;
        }
        if (errno == EINPROGRESS) {
            struct pollfd pfd = {.fd = fd, .events = POLLOUT};
            rc = poll(&pfd, 1, timeout_ms);
            if (rc > 0) {
                int soerr = 0;
                socklen_t slen = sizeof(soerr);
                getsockopt(fd, SOL_SOCKET, SO_ERROR, &soerr, &slen);
                if (soerr == 0) {
                    if (flags >= 0) fcntl(fd, F_SETFL, flags);
                    break;
                }
                errno = soerr;
            }
        }
        close(fd);
        fd = -1;
    }
    freeaddrinfo(res);
    if (fd < 0) web_set_err(err, err_len, "connect %s:%d failed: %s",
                            host, port, strerror(errno));
    return fd;
}

static int web_write_all(int fd, const void *buf, size_t len) {
    const char *p = buf;
    while (len) {
#ifdef MSG_NOSIGNAL
        ssize_t n = send(fd, p, len, MSG_NOSIGNAL);
#else
        ssize_t n = write(fd, p, len);
#endif
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return -1;
        p += n;
        len -= (size_t)n;
    }
    return 0;
}

static ssize_t web_read_some(int fd, char *buf, size_t len, int timeout_ms) {
    struct pollfd pfd = {.fd = fd, .events = POLLIN};
    int rc = poll(&pfd, 1, timeout_ms);
    if (rc <= 0) return rc == 0 ? 0 : -1;
    for (;;) {
        ssize_t n = read(fd, buf, len);
        if (n < 0 && errno == EINTR) continue;
        return n;
    }
}

static char *web_http_request(const char *method, int port, const char *path,
                              char *err, size_t err_len) {
    int fd = web_tcp_connect("127.0.0.1", port, DS4_WEB_CONNECT_TIMEOUT_MS,
                             err, err_len);
    if (fd < 0) return NULL;
    web_buf req = {0};
    char line[512];
    snprintf(line, sizeof(line),
             "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nConnection: close\r\n\r\n",
             method, path, port);
    web_buf_puts(&req, line);
    if (web_write_all(fd, req.ptr, req.len) != 0) {
        web_set_err(err, err_len, "write HTTP request failed: %s", strerror(errno));
        close(fd);
        free(req.ptr);
        return NULL;
    }
    free(req.ptr);

    web_buf resp = {0};
    char tmp[4096];
    for (;;) {
        ssize_t n = web_read_some(fd, tmp, sizeof(tmp), DS4_WEB_CONNECT_TIMEOUT_MS);
        if (n < 0) {
            web_set_err(err, err_len, "read HTTP response failed: %s", strerror(errno));
            close(fd);
            free(resp.ptr);
            return NULL;
        }
        if (n == 0) break;
        web_buf_append(&resp, tmp, (size_t)n);
    }
    close(fd);
    if (!resp.ptr) {
        web_set_err(err, err_len, "empty HTTP response");
        return NULL;
    }
    char *body = strstr(resp.ptr, "\r\n\r\n");
    if (!body) {
        web_set_err(err, err_len, "malformed HTTP response");
        free(resp.ptr);
        return NULL;
    }
    body += 4;
    char *out = web_xstrdup(body);
    free(resp.ptr);
    return out;
}

static bool web_cdp_alive(ds4_web *web) {
    char err[160] = {0};
    char *body = web_http_request("GET", web->port, "/json/version", err, sizeof(err));
    if (!body) return false;
    bool ok = strstr(body, "webSocketDebuggerUrl") != NULL;
    free(body);
    return ok;
}

static char *web_json_get_string(const char *json, const char *key);

static char *web_url_encode(const char *s) {
    static const char hex[] = "0123456789ABCDEF";
    web_buf b = {0};
    for (const unsigned char *p = (const unsigned char *)s; p && *p; p++) {
        unsigned char c = *p;
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            web_buf_append(&b, (const char *)&c, 1);
        } else {
            char e[3] = {'%', hex[c >> 4], hex[c & 15]};
            web_buf_append(&b, e, 3);
        }
    }
    return web_buf_take(&b);
}

static void web_random_bytes(unsigned char *buf, size_t len) {
    int fd = open("/dev/urandom", O_RDONLY);
    if (fd >= 0) {
        size_t off = 0;
        while (off < len) {
            ssize_t n = read(fd, buf + off, len - off);
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) break;
            off += (size_t)n;
        }
        close(fd);
        if (off == len) return;
    }
    uint64_t x = (uint64_t)time(NULL) ^ ((uint64_t)getpid() << 32);
    for (size_t i = 0; i < len; i++) {
        x = x * 6364136223846793005ULL + 1;
        buf[i] = (unsigned char)(x >> 32);
    }
}

static char *web_base64(const unsigned char *data, size_t len) {
    static const char tab[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    size_t outlen = ((len + 2) / 3) * 4;
    char *out = web_xmalloc(outlen + 1);
    size_t j = 0;
    for (size_t i = 0; i < len; i += 3) {
        uint32_t v = (uint32_t)data[i] << 16;
        if (i + 1 < len) v |= (uint32_t)data[i + 1] << 8;
        if (i + 2 < len) v |= data[i + 2];
        out[j++] = tab[(v >> 18) & 63];
        out[j++] = tab[(v >> 12) & 63];
        out[j++] = (i + 1 < len) ? tab[(v >> 6) & 63] : '=';
        out[j++] = (i + 2 < len) ? tab[v & 63] : '=';
    }
    out[j] = '\0';
    return out;
}

static char *web_json_quote(const char *s) {
    web_buf b = {0};
    web_buf_puts(&b, "\"");
    for (const unsigned char *p = (const unsigned char *)s; p && *p; p++) {
        unsigned char c = *p;
        switch (c) {
        case '\\': web_buf_puts(&b, "\\\\"); break;
        case '"': web_buf_puts(&b, "\\\""); break;
        case '\n': web_buf_puts(&b, "\\n"); break;
        case '\r': web_buf_puts(&b, "\\r"); break;
        case '\t': web_buf_puts(&b, "\\t"); break;
        default:
            if (c < 0x20) {
                char tmp[8];
                snprintf(tmp, sizeof(tmp), "\\u%04x", c);
                web_buf_puts(&b, tmp);
            } else {
                web_buf_append(&b, (const char *)&c, 1);
            }
            break;
        }
    }
    web_buf_puts(&b, "\"");
    return web_buf_take(&b);
}

static int web_ws_connect(const char *ws_url, cdp_ws *ws,
                          char *err, size_t err_len) {
    const char *p = ws_url;
    if (strncmp(p, "ws://", 5) != 0) {
        web_set_err(err, err_len, "unsupported websocket URL: %s", ws_url);
        return -1;
    }
    p += 5;
    const char *slash = strchr(p, '/');
    if (!slash) {
        web_set_err(err, err_len, "malformed websocket URL");
        return -1;
    }
    char hostport[256];
    size_t hp_len = (size_t)(slash - p);
    if (hp_len >= sizeof(hostport)) hp_len = sizeof(hostport) - 1;
    memcpy(hostport, p, hp_len);
    hostport[hp_len] = '\0';
    char *colon = strrchr(hostport, ':');
    int port = 80;
    if (colon) {
        *colon = '\0';
        port = atoi(colon + 1);
    }
    const char *host = hostport;
    int fd = web_tcp_connect(host, port, DS4_WEB_CONNECT_TIMEOUT_MS, err, err_len);
    if (fd < 0) return -1;

    unsigned char rnd[16];
    web_random_bytes(rnd, sizeof(rnd));
    char *key = web_base64(rnd, sizeof(rnd));
    web_buf req = {0};
    char line[512];
    snprintf(line, sizeof(line),
             "GET %s HTTP/1.1\r\n"
             "Host: %s:%d\r\n"
             "Upgrade: websocket\r\n"
             "Connection: Upgrade\r\n"
             "Sec-WebSocket-Key: %s\r\n"
             "Sec-WebSocket-Version: 13\r\n\r\n",
             slash, host, port, key);
    web_buf_puts(&req, line);
    free(key);
    if (web_write_all(fd, req.ptr, req.len) != 0) {
        web_set_err(err, err_len, "websocket handshake write failed");
        close(fd);
        free(req.ptr);
        return -1;
    }
    free(req.ptr);

    web_buf resp = {0};
    char tmp[1024];
    double deadline = web_now_sec() + (double)DS4_WEB_CONNECT_TIMEOUT_MS / 1000.0;
    while (!strstr(resp.ptr ? resp.ptr : "", "\r\n\r\n")) {
        if (web_set_cancel_err(ws ? ws->web : NULL, err, err_len)) {
            close(fd);
            free(resp.ptr);
            return -1;
        }
        double now = web_now_sec();
        if (now >= deadline) {
            web_set_err(err, err_len, "websocket handshake read failed");
            close(fd);
            free(resp.ptr);
            return -1;
        }
        int slice = 100;
        int remaining = (int)((deadline - now) * 1000.0);
        if (remaining < slice) slice = remaining > 0 ? remaining : 1;
        ssize_t n = web_read_some(fd, tmp, sizeof(tmp), slice);
        if (n < 0) {
            web_set_err(err, err_len, "websocket handshake read failed");
            close(fd);
            free(resp.ptr);
            return -1;
        }
        if (n == 0) continue;
        web_buf_append(&resp, tmp, (size_t)n);
        if (resp.len > 8192) break;
    }
    bool ok = resp.ptr && strstr(resp.ptr, " 101 ") != NULL;
    free(resp.ptr);
    if (!ok) {
        web_set_err(err, err_len, "websocket handshake rejected");
        close(fd);
        return -1;
    }
    ws->fd = fd;
    ws->next_id = 1;
    return 0;
}

static void web_ws_close(cdp_ws *ws) {
    if (ws && ws->fd >= 0) {
        close(ws->fd);
        ws->fd = -1;
    }
}

static int web_read_exact(cdp_ws *ws, unsigned char *buf, size_t len,
                          int timeout_ms, char *err, size_t err_len) {
    size_t off = 0;
    double deadline = web_now_sec() + (double)timeout_ms / 1000.0;
    while (off < len) {
        if (web_set_cancel_err(ws ? ws->web : NULL, err, err_len)) return -1;
        double now = web_now_sec();
        if (now >= deadline) {
            web_set_err(err, err_len, "websocket read timeout");
            return -1;
        }
        int slice = 100;
        int remaining = (int)((deadline - now) * 1000.0);
        if (remaining < slice) slice = remaining > 0 ? remaining : 1;
        ssize_t n = web_read_some(ws->fd, (char *)buf + off, len - off, slice);
        if (n < 0) {
            web_set_err(err, err_len, "websocket frame read failed");
            return -1;
        }
        if (n == 0) continue;
        off += (size_t)n;
    }
    return 0;
}

static int web_ws_send_text(cdp_ws *ws, const char *text,
                            char *err, size_t err_len) {
    size_t len = strlen(text);
    web_buf frame = {0};
    unsigned char hdr[14];
    size_t h = 0;
    hdr[h++] = 0x81;
    if (len < 126) {
        hdr[h++] = 0x80 | (unsigned char)len;
    } else if (len <= 0xffff) {
        hdr[h++] = 0x80 | 126;
        hdr[h++] = (unsigned char)(len >> 8);
        hdr[h++] = (unsigned char)len;
    } else {
        hdr[h++] = 0x80 | 127;
        for (int i = 7; i >= 0; i--) hdr[h++] = (unsigned char)((uint64_t)len >> (i * 8));
    }
    unsigned char mask[4];
    web_random_bytes(mask, sizeof(mask));
    for (int i = 0; i < 4; i++) hdr[h++] = mask[i];
    web_buf_append(&frame, (const char *)hdr, h);
    for (size_t i = 0; i < len; i++) {
        char c = text[i] ^ mask[i & 3];
        web_buf_append(&frame, &c, 1);
    }
    int rc = web_write_all(ws->fd, frame.ptr, frame.len);
    free(frame.ptr);
    if (rc != 0) {
        web_set_err(err, err_len, "websocket write failed: %s", strerror(errno));
        return -1;
    }
    return 0;
}

static int web_ws_send_pong(cdp_ws *ws, const unsigned char *payload, size_t len) {
    if (len > 125) len = 125;
    unsigned char hdr[2 + 4 + 125];
    hdr[0] = 0x8a;
    hdr[1] = 0x80 | (unsigned char)len;
    unsigned char mask[4];
    web_random_bytes(mask, sizeof(mask));
    memcpy(hdr + 2, mask, 4);
    for (size_t i = 0; i < len; i++) hdr[6 + i] = payload[i] ^ mask[i & 3];
    return web_write_all(ws->fd, hdr, 6 + len);
}

static char *web_ws_read_message(cdp_ws *ws, char *err, size_t err_len) {
    web_buf msg = {0};
    for (;;) {
        unsigned char h[2];
        if (web_read_exact(ws, h, 2, DS4_WEB_CDP_TIMEOUT_MS, err, err_len) != 0) {
            free(msg.ptr);
            return NULL;
        }
        bool fin = (h[0] & 0x80) != 0;
        int opcode = h[0] & 0x0f;
        bool masked = (h[1] & 0x80) != 0;
        uint64_t len = h[1] & 0x7f;
        if (len == 126) {
            unsigned char x[2];
            if (web_read_exact(ws, x, 2, DS4_WEB_CDP_TIMEOUT_MS, err, err_len) != 0) goto fail;
            len = ((uint64_t)x[0] << 8) | x[1];
        } else if (len == 127) {
            unsigned char x[8];
            if (web_read_exact(ws, x, 8, DS4_WEB_CDP_TIMEOUT_MS, err, err_len) != 0) goto fail;
            len = 0;
            for (int i = 0; i < 8; i++) len = (len << 8) | x[i];
        }
        unsigned char mask[4] = {0};
        if (masked && web_read_exact(ws, mask, 4, DS4_WEB_CDP_TIMEOUT_MS, err, err_len) != 0)
            goto fail;
        if (len > DS4_WEB_MAX_RESULT_BYTES * 4ULL) {
            web_set_err(err, err_len, "websocket message too large");
            free(msg.ptr);
            return NULL;
        }
        unsigned char *payload = web_xmalloc((size_t)len + 1);
        if (len && web_read_exact(ws, payload, (size_t)len,
                                  DS4_WEB_CDP_TIMEOUT_MS, err, err_len) != 0) {
            free(payload);
            goto fail;
        }
        for (uint64_t i = 0; masked && i < len; i++) payload[i] ^= mask[i & 3];
        payload[len] = '\0';
        if (opcode == 0x8) {
            free(payload);
            web_set_err(err, err_len, "websocket closed");
            free(msg.ptr);
            return NULL;
        } else if (opcode == 0x9) {
            web_ws_send_pong(ws, payload, (size_t)len);
            free(payload);
            continue;
        } else if (opcode == 0x1 || opcode == 0x0) {
            web_buf_append(&msg, (const char *)payload, (size_t)len);
            free(payload);
            if (fin) return web_buf_take(&msg);
        } else {
            free(payload);
        }
    }
fail:
    if (err && err_len && !err[0]) web_set_err(err, err_len, "websocket frame read failed");
    free(msg.ptr);
    return NULL;
}

static bool web_json_id_matches(const char *json, int id) {
    const char *p = strstr(json, "\"id\"");
    if (!p) return false;
    p = strchr(p, ':');
    if (!p) return false;
    p++;
    while (*p == ' ' || *p == '\t') p++;
    return atoi(p) == id;
}

static char *web_cdp_call(cdp_ws *ws, const char *method, const char *params,
                          char *err, size_t err_len) {
    if (web_set_cancel_err(ws ? ws->web : NULL, err, err_len)) return NULL;
    int id = ws->next_id++;
    web_buf req = {0};
    char head[256];
    snprintf(head, sizeof(head), "{\"id\":%d,\"method\":", id);
    web_buf_puts(&req, head);
    char *qmethod = web_json_quote(method);
    web_buf_puts(&req, qmethod);
    free(qmethod);
    if (params && params[0]) {
        web_buf_puts(&req, ",\"params\":");
        web_buf_puts(&req, params);
    }
    web_buf_puts(&req, "}");
    char *wire = web_buf_take(&req);
    if (web_ws_send_text(ws, wire, err, err_len) != 0) {
        free(wire);
        return NULL;
    }
    free(wire);
    for (;;) {
        if (web_set_cancel_err(ws ? ws->web : NULL, err, err_len)) return NULL;
        char *msg = web_ws_read_message(ws, err, err_len);
        if (!msg) return NULL;
        if (web_json_id_matches(msg, id)) return msg;
        free(msg);
    }
}

static void web_cdp_call_optional(cdp_ws *ws, const char *method, const char *params) {
    char err[160] = {0};
    char *resp = web_cdp_call(ws, method, params, err, sizeof(err));
    free(resp);
}

static int web_hex4(const char *p) {
    int v = 0;
    for (int i = 0; i < 4; i++) {
        char c = p[i];
        int x;
        if (c >= '0' && c <= '9') x = c - '0';
        else if (c >= 'a' && c <= 'f') x = c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') x = c - 'A' + 10;
        else return -1;
        v = (v << 4) | x;
    }
    return v;
}

static void web_utf8_append(web_buf *b, unsigned code) {
    char out[4];
    if (code <= 0x7f) {
        out[0] = (char)code;
        web_buf_append(b, out, 1);
    } else if (code <= 0x7ff) {
        out[0] = (char)(0xc0 | (code >> 6));
        out[1] = (char)(0x80 | (code & 0x3f));
        web_buf_append(b, out, 2);
    } else if (code <= 0xffff) {
        out[0] = (char)(0xe0 | (code >> 12));
        out[1] = (char)(0x80 | ((code >> 6) & 0x3f));
        out[2] = (char)(0x80 | (code & 0x3f));
        web_buf_append(b, out, 3);
    } else {
        out[0] = (char)(0xf0 | (code >> 18));
        out[1] = (char)(0x80 | ((code >> 12) & 0x3f));
        out[2] = (char)(0x80 | ((code >> 6) & 0x3f));
        out[3] = (char)(0x80 | (code & 0x3f));
        web_buf_append(b, out, 4);
    }
}

static char *web_json_parse_string_at(const char *q, const char **endp) {
    if (*q != '"') return NULL;
    q++;
    web_buf b = {0};
    while (*q && *q != '"') {
        if (*q != '\\') {
            web_buf_append(&b, q++, 1);
            continue;
        }
        q++;
        switch (*q) {
        case '"': web_buf_append(&b, "\"", 1); q++; break;
        case '\\': web_buf_append(&b, "\\", 1); q++; break;
        case '/': web_buf_append(&b, "/", 1); q++; break;
        case 'b': web_buf_append(&b, "\b", 1); q++; break;
        case 'f': web_buf_append(&b, "\f", 1); q++; break;
        case 'n': web_buf_append(&b, "\n", 1); q++; break;
        case 'r': web_buf_append(&b, "\r", 1); q++; break;
        case 't': web_buf_append(&b, "\t", 1); q++; break;
        case 'u': {
            int v = web_hex4(q + 1);
            if (v < 0) { free(b.ptr); return NULL; }
            q += 5;
            if (v >= 0xd800 && v <= 0xdbff && q[0] == '\\' && q[1] == 'u') {
                int lo = web_hex4(q + 2);
                if (lo >= 0xdc00 && lo <= 0xdfff) {
                    unsigned code = 0x10000 + (((unsigned)v - 0xd800) << 10) +
                                    ((unsigned)lo - 0xdc00);
                    web_utf8_append(&b, code);
                    q += 6;
                    break;
                }
            }
            web_utf8_append(&b, (unsigned)v);
            break;
        }
        default:
            if (*q) web_buf_append(&b, q++, 1);
            break;
        }
    }
    if (*q != '"') {
        free(b.ptr);
        return NULL;
    }
    if (endp) *endp = q + 1;
    return web_buf_take(&b);
}

static char *web_json_get_string(const char *json, const char *key) {
    char pat[128];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = json;
    while ((p = strstr(p, pat)) != NULL) {
        p += strlen(pat);
        while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
        if (*p++ != ':') continue;
        while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
        if (*p == '"') return web_json_parse_string_at(p, NULL);
    }
    return NULL;
}

static char *web_cdp_eval_string(cdp_ws *ws, const char *expr,
                                 char *err, size_t err_len) {
    char *qexpr = web_json_quote(expr);
    web_buf params = {0};
    web_buf_puts(&params, "{\"expression\":");
    web_buf_puts(&params, qexpr);
    web_buf_puts(&params, ",\"returnByValue\":true,\"awaitPromise\":true,\"includeCommandLineAPI\":true}");
    free(qexpr);
    char *params_s = web_buf_take(&params);
    char *resp = web_cdp_call(ws, "Runtime.evaluate", params_s, err, err_len);
    free(params_s);
    if (!resp) return NULL;
    if (strstr(resp, "\"exceptionDetails\"")) {
        web_set_err(err, err_len, "JavaScript evaluation failed");
        free(resp);
        return NULL;
    }
    char *val = web_json_get_string(resp, "value");
    free(resp);
    if (!val) web_set_err(err, err_len, "Runtime.evaluate did not return a string");
    return val;
}

static bool web_wait_ready(cdp_ws *ws, char *err, size_t err_len) {
    const char *expr = "document.readyState";
    for (int i = 0; i < 80; i++) {
        if (web_set_cancel_err(ws ? ws->web : NULL, err, err_len)) return false;
        char *state = web_cdp_eval_string(ws, expr, err, err_len);
        if (state && (!strcmp(state, "complete") || !strcmp(state, "interactive"))) {
            free(state);
            if (web_sleep_ms(ws ? ws->web : NULL, 800)) return true;
            web_set_err(err, err_len, "interrupted");
            return false;
        }
        free(state);
        if (!web_sleep_ms(ws ? ws->web : NULL, 250)) {
            web_set_err(err, err_len, "interrupted");
            return false;
        }
    }
    return true;
}

static bool web_cdp_navigate(cdp_ws *ws, const char *url,
                             char *err, size_t err_len) {
    char *qurl = web_json_quote(url);
    web_buf params = {0};
    web_buf_puts(&params, "{\"url\":");
    web_buf_puts(&params, qurl);
    web_buf_puts(&params, "}");
    free(qurl);
    char *params_s = web_buf_take(&params);
    char *resp = web_cdp_call(ws, "Page.navigate", params_s, err, err_len);
    free(params_s);
    if (!resp) return false;
    free(resp);
    return true;
}

static bool web_page_probe(cdp_ws *ws, char **href_out, char **ready_out,
                           long *text_len_out, char *err, size_t err_len) {
    const char *expr =
        "location.href+'\\n'+document.readyState+'\\n'+"
        "((document.body&&document.body.innerText)||'').length";
    char *probe = web_cdp_eval_string(ws, expr, err, err_len);
    if (!probe) return false;

    char *nl1 = strchr(probe, '\n');
    char *nl2 = nl1 ? strchr(nl1 + 1, '\n') : NULL;
    if (!nl1 || !nl2) {
        free(probe);
        web_set_err(err, err_len, "page readiness probe returned malformed data");
        return false;
    }
    *nl1 = '\0';
    *nl2 = '\0';
    if (href_out) *href_out = web_xstrdup(probe);
    if (ready_out) *ready_out = web_xstrdup(nl1 + 1);
    if (text_len_out) *text_len_out = strtol(nl2 + 1, NULL, 10);
    free(probe);
    return true;
}

static bool web_wait_navigated_ready(cdp_ws *ws, const char *url,
                                     char *err, size_t err_len) {
    (void)url;
    long last_len = -1;
    int stable = 0;
    bool saw_real_url = false;

    for (int i = 0; i < 100; i++) {
        if (web_set_cancel_err(ws ? ws->web : NULL, err, err_len)) return false;
        char *href = NULL;
        char *ready = NULL;
        long text_len = 0;
        bool ok = web_page_probe(ws, &href, &ready, &text_len, err, err_len);
        if (!ok) {
            free(href);
            free(ready);
            if (!web_sleep_ms(ws ? ws->web : NULL, 250)) {
                web_set_err(err, err_len, "interrupted");
                return false;
            }
            continue;
        }

        bool real_url = href && href[0] &&
                        strcmp(href, "about:blank") &&
                        strncmp(href, "chrome://", 9);
        bool ready_state = ready &&
            (!strcmp(ready, "complete") || !strcmp(ready, "interactive"));
        if (real_url) saw_real_url = true;
        if (text_len > 0 && text_len == last_len) stable++;
        else stable = 0;
        last_len = text_len;

        free(href);
        free(ready);

        if (saw_real_url && ready_state && text_len > 0 && stable >= 2) {
            if (web_sleep_ms(ws ? ws->web : NULL, 500)) return true;
            web_set_err(err, err_len, "interrupted");
            return false;
        }
        if (saw_real_url && ready_state && i >= 24) return true;
        if (!web_sleep_ms(ws ? ws->web : NULL, 250)) {
            web_set_err(err, err_len, "interrupted");
            return false;
        }
    }
    return true;
}

static bool web_cdp_prepare_page(cdp_ws *ws, char *err, size_t err_len) {
    char *resp = web_cdp_call(ws, "Page.enable", "{}", err, err_len);
    if (!resp) return false;
    free(resp);
    resp = web_cdp_call(ws, "Runtime.enable", "{}", err, err_len);
    if (!resp) return false;
    free(resp);
    web_cdp_call_optional(ws, "Emulation.setFocusEmulationEnabled",
                          "{\"enabled\":true}");
    web_cdp_call_optional(ws, "Emulation.setDeviceMetricsOverride",
                          "{\"width\":1365,\"height\":900,\"deviceScaleFactor\":1,\"mobile\":false}");
    return web_wait_ready(ws, err, err_len);
}

static bool web_scroll_dynamic_page(cdp_ws *ws, char *err, size_t err_len) {
    const char *expr =
        "(() => new Promise(resolve => {"
        "const root=()=>document.scrollingElement||document.documentElement||document.body;"
        "const blockSel='h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,[id=\"content-text\"],[class*=\"comment-body\"],[class*=\"comment-content\"],[data-testid*=\"comment-text\"]';"
        "const lazySel='[onscroll],[loading=\"lazy\"],[data-src],[data-lazy],[class*=\"lazy\"],[class*=\"infinite\"],[class*=\"virtual\"],[role=\"feed\"],[id*=\"comment\"],[class*=\"comment\"],[data-testid*=\"comment\"]';"
        "const hookCount=()=>{let n=0;try{if(window.onscroll)n++;if(document.onscroll)n++;if(document.body&&document.body.onscroll)n++;}catch(e){}"
        "try{if(typeof getEventListeners==='function'){for(const o of [window,document,document.body]){if(!o)continue;const ev=getEventListeners(o);if(ev&&ev.scroll)n+=ev.scroll.length;}}}catch(e){}"
        "try{n+=document.querySelectorAll(lazySel).length;}catch(e){}return n;};"
        "const metrics=()=>{const r=root();return {"
        "height:r?r.scrollHeight:0,"
        "view:innerHeight||900,"
        "y:scrollY||(r&&r.scrollTop)||0,"
        "text:((document.body&&document.body.innerText)||'').length,"
        "links:document.links?document.links.length:0,"
        "blocks:document.body?document.body.querySelectorAll(blockSel).length:0,"
        "hooks:hookCount()};};"
        "const sig=m=>[m.height,m.text,m.links,m.blocks].join('|');"
        "const grew=(a,b)=>b.height>a.height+20||b.text>a.text+200||b.links>a.links+2||b.blocks>a.blocks+2;"
        "const scrollOnce=()=>{const r=root();if(!r)return;"
        "const h=Math.max(700,Math.floor((innerHeight||900)*0.85));"
        "window.scrollTo(0,Math.min(r.scrollHeight,(scrollY||r.scrollTop||0)+h));};"
        "let last=metrics(),lastSig=sig(last),same=0,steps=0;"
        "const scrollable=last.height>last.view*1.35;"
        "if(!scrollable||last.hooks===0){resolve('scroll skipped hooks='+last.hooks+' text='+last.text);return;}"
        "const tick=()=>{"
        "if(steps>=28){resolve('scrolled '+steps+' text='+last.text);return;}"
        "const before=last;"
        "scrollOnce();steps++;"
        "setTimeout(()=>{const now=metrics(),nowSig=sig(now);"
        "if(nowSig===lastSig)same++;else same=0;"
        "const loaded=grew(before,now);"
        "last=now;lastSig=nowSig;"
        "if(steps===1&&!loaded){resolve('scroll probe unchanged text='+now.text);return;}"
        "const atBottom=now.y+now.view+20>=now.height;"
        "if(same>=4||(atBottom&&same>=1)){resolve('scrolled '+steps+' text='+now.text);return;}"
        "tick();},900);"
        "};tick();"
        "}))()";
    if (web_set_cancel_err(ws ? ws->web : NULL, err, err_len)) return false;

    char local_err[160] = {0};
    char *res = web_cdp_eval_string(ws, expr, local_err, sizeof(local_err));
    if (!res && web_err_is_interrupted(local_err)) {
        web_set_err(err, err_len, "interrupted");
        return false;
    }
    free(res);
    if (web_set_cancel_err(ws ? ws->web : NULL, err, err_len)) return false;
    return true;
}

static char *web_chrome_executable(void) {
    const char *env = getenv("DS4_CHROME");
    if (env && env[0]) return web_xstrdup(env);
#ifdef __APPLE__
    if (access("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", X_OK) == 0)
        return web_xstrdup("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    if (access("/Applications/Chromium.app/Contents/MacOS/Chromium", X_OK) == 0)
        return web_xstrdup("/Applications/Chromium.app/Contents/MacOS/Chromium");
#endif
    const char *paths[] = {
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/opt/google/chrome/chrome",
        NULL
    };
    for (int i = 0; paths[i]; i++) {
        if (access(paths[i], X_OK) == 0) return web_xstrdup(paths[i]);
    }

    const char *names[] = {
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        NULL
    };
    const char *pathenv = getenv("PATH");
    if (pathenv) {
        char *path = web_xstrdup(pathenv);
        char *save = NULL;
        for (char *dir = strtok_r(path, ":", &save); dir; dir = strtok_r(NULL, ":", &save)) {
            for (int i = 0; names[i]; i++) {
                char candidate[PATH_MAX];
                snprintf(candidate, sizeof(candidate), "%s/%s", dir[0] ? dir : ".", names[i]);
                if (access(candidate, X_OK) == 0) {
                    char *res = web_xstrdup(candidate);
                    free(path);
                    return res;
                }
            }
        }
        free(path);
    }
    return web_xstrdup("google-chrome");
}

#ifdef __APPLE__
static const char *web_macos_chrome_app_name(void) {
    if (getenv("DS4_CHROME")) return NULL;
    if (access("/Applications/Google Chrome.app", F_OK) == 0)
        return "Google Chrome";
    if (access("/Applications/Chromium.app", F_OK) == 0)
        return "Chromium";
    return NULL;
}
#endif

static bool web_spawn_chrome(ds4_web *web, char *err, size_t err_len) {
    if (!web_mkdir_p(web->profile_dir)) {
        web_set_err(err, err_len, "failed to create Chrome profile dir %s: %s",
                    web->profile_dir, strerror(errno));
        return false;
    }
    char *exe = web_chrome_executable();
#ifdef __APPLE__
    const char *mac_app_name = web_macos_chrome_app_name();
    bool launched_via_open = mac_app_name != NULL && access("/usr/bin/open", X_OK) == 0;
#else
    bool launched_via_open = false;
#endif
    char port_arg[64], profile_arg[PATH_MAX + 64];
    snprintf(port_arg, sizeof(port_arg), "--remote-debugging-port=%d", web->port);
    snprintf(profile_arg, sizeof(profile_arg), "--user-data-dir=%s", web->profile_dir);
    pid_t pid = fork();
    if (pid < 0) {
        web_set_err(err, err_len, "failed to fork Chrome: %s", strerror(errno));
        free(exe);
        return false;
    }
    if (pid == 0) {
        int nullfd = open("/dev/null", O_RDWR);
        if (nullfd >= 0) {
            dup2(nullfd, STDOUT_FILENO);
            dup2(nullfd, STDERR_FILENO);
            if (nullfd > 2) close(nullfd);
        }
#ifdef __APPLE__
        if (launched_via_open) {
            execlp("/usr/bin/open", "open", "-g", "-na", mac_app_name,
                   "--args", port_arg, "--remote-allow-origins=*",
                   profile_arg, "--no-first-run", "--no-default-browser-check",
                   "--disable-sync", "--use-mock-keychain", "--password-store=basic",
                   "--mute-audio", "about:blank", (char *)NULL);
        } else {
            execlp(exe, exe, port_arg, "--remote-allow-origins=*",
                   profile_arg, "--no-first-run", "--no-default-browser-check",
                   "--disable-sync", "--use-mock-keychain", "--password-store=basic",
                   "--mute-audio", "about:blank", (char *)NULL);
        }
#else
        if (geteuid() == 0) {
            execlp(exe, exe, port_arg, "--remote-allow-origins=*",
                   profile_arg, "--no-first-run", "--no-default-browser-check",
                   "--disable-sync", "--password-store=basic", "--no-sandbox",
                   "--mute-audio", "about:blank", (char *)NULL);
        } else {
            execlp(exe, exe, port_arg, "--remote-allow-origins=*",
                   profile_arg, "--no-first-run", "--no-default-browser-check",
                   "--disable-sync", "--password-store=basic",
                   "--mute-audio", "about:blank", (char *)NULL);
        }
#endif
        _exit(127);
    }
    free(exe);
    web->chrome_pid = pid;
    for (int i = 0; i < 80; i++) {
        if (web_set_cancel_err(web, err, err_len)) return false;
        if (web_cdp_alive(web)) {
            web_log(web, "Chrome browser session is ready");
            return true;
        }
        int status = 0;
        pid_t rc = waitpid(pid, &status, WNOHANG);
        if (rc == pid) {
            web->chrome_pid = 0;
            if (launched_via_open) continue;
            web_set_err(err, err_len, "Chrome exited before CDP became ready");
            return false;
        }
        if (!web_sleep_ms(web, 250)) {
            web_set_err(err, err_len, "interrupted");
            return false;
        }
    }
    web_set_err(err, err_len, "Chrome did not expose CDP on port %d", web->port);
    return false;
}

static bool web_ensure_browser(ds4_web *web, char *err, size_t err_len) {
    if (web_cdp_alive(web)) return true;
    if (web->chrome_pid > 0) {
        int status = 0;
        waitpid(web->chrome_pid, &status, WNOHANG);
        web->chrome_pid = 0;
    }
    if (!web->browser_allowed) {
        if (!web->confirm) {
            web_set_err(err, err_len,
                        "starting a visible Chrome browser requires interactive approval");
            return false;
        }
        if (!web->confirm(web->confirm_privdata,
                          "The web tool wants to start a visible Chrome browser. Allow? (y/n) ",
                          err, err_len))
        {
            if (err && !err[0]) web_set_err(err, err_len, "user denied Chrome browser start");
            return false;
        }
        web->browser_allowed = true;
    }
    return web_spawn_chrome(web, err, err_len);
}

static void web_tab_free(web_tab *tab) {
    if (!tab) return;
    free(tab->id);
    free(tab->ws_url);
    tab->id = NULL;
    tab->ws_url = NULL;
}

static char *web_browser_ws_url(ds4_web *web, char *err, size_t err_len) {
    char *body = web_http_request("GET", web->port, "/json/version", err, err_len);
    if (!body) return NULL;
    char *ws = web_json_get_string(body, "webSocketDebuggerUrl");
    free(body);
    if (!ws) web_set_err(err, err_len, "Chrome did not return a browser WebSocket URL");
    return ws;
}

static bool web_open_tab(ds4_web *web, const char *url, web_tab *tab,
                         char *err, size_t err_len) {
    memset(tab, 0, sizeof(*tab));

    char *browser_url = web_browser_ws_url(web, err, err_len);
    if (!browser_url) return false;
    cdp_ws browser = {.fd = -1, .web = web};
    if (web_ws_connect(browser_url, &browser, err, err_len) != 0) {
        free(browser_url);
        return false;
    }
    free(browser_url);

    char *qurl = web_json_quote(url);
    web_buf params = {0};
    web_buf_puts(&params, "{\"url\":");
    web_buf_puts(&params, qurl);
    web_buf_puts(&params, ",\"background\":true,\"newWindow\":false}");
    free(qurl);
    char *params_s = web_buf_take(&params);
    char *resp = web_cdp_call(&browser, "Target.createTarget",
                              params_s, err, err_len);
    free(params_s);
    web_ws_close(&browser);
    if (!resp) return false;

    tab->id = web_json_get_string(resp, "targetId");
    free(resp);
    if (!tab->id) {
        web_tab_free(tab);
        web_set_err(err, err_len, "Chrome did not return a page target id");
        return false;
    }

    char ws_url[PATH_MAX + 128];
    snprintf(ws_url, sizeof(ws_url), "ws://127.0.0.1:%d/devtools/page/%s",
             web->port, tab->id);
    tab->ws_url = web_xstrdup(ws_url);
    return true;
}

static void web_close_tab(ds4_web *web, const web_tab *tab) {
    if (!web || !tab || !tab->id || !tab->id[0]) return;
    char *enc = web_url_encode(tab->id);
    web_buf path = {0};
    web_buf_puts(&path, "/json/close/");
    web_buf_puts(&path, enc);
    free(enc);

    char err[160] = {0};
    char *path_s = web_buf_take(&path);
    char *body = web_http_request("GET", web->port, path_s, err, sizeof(err));
    free(path_s);
    if (body) {
        free(body);
    } else if (err[0]) {
        web_log(web, err);
    }
}

static const char *web_click_google_consent_js =
"(() => {"
"const clean=s=>(s||'').replace(/\\s+/g,' ').trim();"
"const pats=[/accept all/i,/i agree/i,/agree/i,/accetta tutto/i,/tout accepter/i,/aceptar todo/i,/alle akzeptieren/i];"
"const els=[...document.querySelectorAll('button,[role=button],input[type=submit],a')];"
"for (const el of els){const t=clean(el.innerText||el.value||el.textContent);"
"if(!t)continue; if(pats.some(p=>p.test(t))){el.click(); return 'clicked '+t;}}"
"return '';"
"})()";

static const char *web_extract_search_js =
"(() => {"
"const clean=s=>(s||'').replace(/\\s+/g,' ').trim();"
"const esc=s=>clean(s).replace(/\\\\/g,'\\\\\\\\').replace(/\\[/g,'\\\\[').replace(/\\]/g,'\\\\]').replace(/\\n/g,' ');"
"const visible=el=>{const r=el.getBoundingClientRect();const st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden'&&st.opacity!=='0';};"
"const bad=h=>(/(^|\\.)google\\./.test(h)||/(^|\\.)gstatic\\./.test(h)||/(^|\\.)googleusercontent\\./.test(h));"
"const lines=['# Google search results','',`URL: ${location.href}`,'','## Visible links'];"
"const seen=new Set();"
"for(const a of document.querySelectorAll('a[href]')){if(!visible(a))continue;let href=a.href||'';"
"try{const u=new URL(href);if(u.pathname==='/url'&&u.searchParams.get('q'))href=u.searchParams.get('q');}catch{}"
"let u;try{u=new URL(href);}catch{continue;}if(!/^https?:$/.test(u.protocol))continue;if(bad(u.hostname))continue;"
"const text=esc(a.innerText||a.textContent);if(text.length<3)continue;if(seen.has(u.href))continue;seen.add(u.href);"
"lines.push(`- [${text.slice(0,180)}](${u.href})`);if(seen.size>=20)break;}"
"lines.push('','## Text snapshot',clean(document.body.innerText).slice(0,1200));"
"return lines.join('\\n');"
"})()";

static const char *web_extract_page_js =
"(() => {"
"const clean=s=>(s||'').replace(/\\s+/g,' ').trim();"
"const esc=s=>clean(s).replace(/\\\\/g,'\\\\\\\\').replace(/\\[/g,'\\\\[').replace(/\\]/g,'\\\\]').replace(/\\n/g,' ');"
"const visible=el=>{const r=el.getBoundingClientRect();const st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden'&&st.opacity!=='0';};"
"const inline=n=>{if(!n)return'';if(n.nodeType===3)return n.nodeValue;if(n.nodeType!==1)return'';const el=n;"
"if(el.tagName==='SCRIPT'||el.tagName==='STYLE'||el.tagName==='NOSCRIPT')return'';"
"if(el.tagName==='A'){const t=esc(el.innerText||el.textContent);const h=el.href||'';return t&&h?`[${t}](${h})`:t;}"
"if(el.tagName==='CODE')return '`'+clean(el.innerText||el.textContent).replace(/`/g,'\\\\`')+'`';"
"return [...el.childNodes].map(inline).join('');};"
"const lines=[`# ${clean(document.title)||location.href}`,'',`URL: ${location.href}`,'','## Content'];"
"const blocks=[...document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,[id=\"content-text\"],[class*=\"comment-body\"],[class*=\"comment-content\"],[data-testid*=\"comment-text\"]')];"
"const seen=new Set();"
"for(const el of blocks){if(!visible(el))continue;let s='';const tag=el.tagName;"
"if(/^H[1-6]$/.test(tag)){s='#'.repeat(Number(tag[1]))+' '+inline(el);}"
"else if(tag==='LI'){s='- '+inline(el);}"
"else if(tag==='PRE'){s='```\\n'+(el.innerText||el.textContent||'').trimEnd()+'\\n```';}"
"else if(tag==='BLOCKQUOTE'){s='> '+clean(el.innerText||el.textContent);}"
"else{s=inline(el);}s=s.trim();if(!s||seen.has(s))continue;seen.add(s);lines.push('',s);"
"if(lines.join('\\n').length>900000){lines.push('','[Content truncated by browser extractor.]');break;}}"
"lines.push('','## Visible links');let n=0;const linkSeen=new Set();"
"for(const a of document.querySelectorAll('a[href]')){if(!visible(a))continue;const t=esc(a.innerText||a.textContent);if(t.length<3)continue;"
"let u;try{u=new URL(a.href);}catch{continue;}if(!/^https?:$/.test(u.protocol)||linkSeen.has(u.href))continue;linkSeen.add(u.href);"
"lines.push(`- [${t.slice(0,160)}](${u.href})`);if(++n>=80)break;}"
"return lines.join('\\n');"
"})()";

static char *web_run_page_js(ds4_web *web, const char *url, const char *js,
                             bool dynamic_scroll,
                             char *err, size_t err_len) {
    if (!web_ensure_browser(web, err, err_len)) return NULL;
    web_tab tab = {0};
    if (!web_open_tab(web, "about:blank", &tab, err, err_len)) return NULL;
    cdp_ws ws = {.fd = -1, .web = web};
    if (web_ws_connect(tab.ws_url, &ws, err, err_len) != 0) {
        web_close_tab(web, &tab);
        web_tab_free(&tab);
        return NULL;
    }
    if (!web_cdp_prepare_page(&ws, err, err_len)) {
        web_ws_close(&ws);
        web_close_tab(web, &tab);
        web_tab_free(&tab);
        return NULL;
    }
    if (!web_cdp_navigate(&ws, url, err, err_len) ||
        !web_wait_navigated_ready(&ws, url, err, err_len))
    {
        web_ws_close(&ws);
        web_close_tab(web, &tab);
        web_tab_free(&tab);
        return NULL;
    }
    char *clicked = web_cdp_eval_string(&ws, web_click_google_consent_js, err, err_len);
    if (clicked && clicked[0]) {
        web_log(web, clicked);
        if (!web_sleep_ms(web, 1500)) {
            free(clicked);
            web_set_err(err, err_len, "interrupted");
            web_ws_close(&ws);
            web_close_tab(web, &tab);
            web_tab_free(&tab);
            return NULL;
        }
        char wait_err[160] = {0};
        if (!web_wait_navigated_ready(&ws, url, wait_err, sizeof(wait_err)) &&
            web_err_is_interrupted(wait_err))
        {
            free(clicked);
            web_set_err(err, err_len, "interrupted");
            web_ws_close(&ws);
            web_close_tab(web, &tab);
            web_tab_free(&tab);
            return NULL;
        }
    }
    free(clicked);
    if (dynamic_scroll && !web_scroll_dynamic_page(&ws, err, err_len)) {
        web_ws_close(&ws);
        web_close_tab(web, &tab);
        web_tab_free(&tab);
        return NULL;
    }
    /* Wait for JS rendering (e.g. Google AI Overview) before extracting content */
    if (!web_sleep_ms(web, 3000)) {
        web_set_err(err, err_len, "interrupted");
        web_ws_close(&ws);
        web_close_tab(web, &tab);
        web_tab_free(&tab);
        return NULL;
    }
    char *out = web_cdp_eval_string(&ws, js, err, err_len);
    web_ws_close(&ws);
    web_close_tab(web, &tab);
    web_tab_free(&tab);
    return out;
}

ds4_web *ds4_web_create(const ds4_web_config *cfg) {
    ds4_web *web = web_xmalloc(sizeof(*web));
    memset(web, 0, sizeof(*web));
    const char *home = cfg && cfg->home_dir && cfg->home_dir[0] ?
        cfg->home_dir : getenv("HOME");
    if (!home || !home[0]) home = ".";
    snprintf(web->home, sizeof(web->home), "%s", home);
    snprintf(web->profile_dir, sizeof(web->profile_dir), "%s/.ds4/browser", home);
    web->port = cfg && cfg->port > 0 ? cfg->port : DS4_WEB_DEFAULT_PORT;
    web->chrome_pid = 0;
    web->next_cdp_id = 1;
    if (cfg) {
        web->confirm = cfg->confirm;
        web->confirm_privdata = cfg->confirm_privdata;
        web->log = cfg->log;
        web->log_privdata = cfg->log_privdata;
        web->cancel = cfg->cancel;
        web->cancel_privdata = cfg->cancel_privdata;
    }
    return web;
}

void ds4_web_free(ds4_web *web) {
    if (!web) return;
    /* Do not kill Chrome.  The browser profile is user-visible state and keeping
     * it alive makes repeated web tool calls cheaper and less suspicious. */
    free(web);
}

char *ds4_web_google_search(ds4_web *web, const char *query,
                            char *err, size_t err_len) {
    if (!web) {
        web_set_err(err, err_len, "web subsystem is not initialized");
        return NULL;
    }
    if (!query || !query[0]) {
        web_set_err(err, err_len, "google_search requires query");
        return NULL;
    }
    char *q = web_url_encode(query);
    web_buf url = {0};
    web_buf_puts(&url, "https://www.google.com/search?q=");
    web_buf_puts(&url, q);
    free(q);
    char *url_s = web_buf_take(&url);
    char *out = web_run_page_js(web, url_s, web_extract_search_js, false, err, err_len);
    free(url_s);
    return out;
}

char *ds4_web_visit_page(ds4_web *web, const char *url,
                         char *err, size_t err_len) {
    if (!web) {
        web_set_err(err, err_len, "web subsystem is not initialized");
        return NULL;
    }
    if (!url || !url[0]) {
        web_set_err(err, err_len, "visit_page requires url");
        return NULL;
    }
    return web_run_page_js(web, url, web_extract_page_js, true, err, err_len);
}
````

## File: ds4_web.h
````c
#ifndef DS4_WEB_H
#define DS4_WEB_H

#include <stddef.h>
#include <stdbool.h>

typedef int (*ds4_web_confirm_fn)(void *privdata, const char *message,
                                  char *err, size_t err_len);
typedef void (*ds4_web_log_fn)(void *privdata, const char *message);
typedef bool (*ds4_web_cancel_fn)(void *privdata);

typedef struct {
    const char *home_dir;
    int port;
    ds4_web_confirm_fn confirm;
    void *confirm_privdata;
    ds4_web_log_fn log;
    void *log_privdata;
    ds4_web_cancel_fn cancel;
    void *cancel_privdata;
} ds4_web_config;

typedef struct ds4_web ds4_web;

ds4_web *ds4_web_create(const ds4_web_config *cfg);
void ds4_web_free(ds4_web *web);

char *ds4_web_google_search(ds4_web *web, const char *query,
                            char *err, size_t err_len);
char *ds4_web_visit_page(ds4_web *web, const char *url,
                         char *err, size_t err_len);

#endif
````

## File: ds4_wrapper_config.c
````c
#include "ds4_wrapper_config.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <errno.h>

static int parse_int_arg(const char *s, const char *opt) {
    char *end = NULL;
    long v = strtol(s, &end, 10);
    if (!s[0] || *end || v <= 0 || v > INT_MAX) {
        fprintf(stderr, "ds4-wrapper: invalid value for %s: %s\n", opt, s);
        exit(2);
    }
    return (int)v;
}

static int parse_nonneg_int_arg(const char *s, const char *opt) {
    char *end = NULL;
    long v = strtol(s, &end, 10);
    if (!s[0] || *end || v < 0 || v > INT_MAX) {
        fprintf(stderr, "ds4-wrapper: invalid value for %s: %s\n", opt, s);
        exit(2);
    }
    return (int)v;
}

static float parse_float_arg(const char *s, const char *opt, float minv, float maxv) {
    char *end = NULL;
    float v = strtof(s, &end);
    if (!s[0] || *end || v < minv || v > maxv) {
        fprintf(stderr, "ds4-wrapper: invalid value for %s: %s\n", opt, s);
        exit(2);
    }
    return v;
}

static const char *need_arg(int *i, int argc, char **argv, const char *opt) {
    if (*i + 1 >= argc) {
        fprintf(stderr, "ds4-wrapper: missing value for %s\n", opt);
        exit(2);
    }
    return argv[++(*i)];
}

static ds4_backend parse_backend_arg(const char *s, const char *arg) {
    if (!strcmp(s, "metal")) return DS4_BACKEND_METAL;
    if (!strcmp(s, "cuda")) return DS4_BACKEND_CUDA;
    if (!strcmp(s, "cpu")) return DS4_BACKEND_CPU;
    fprintf(stderr, "ds4-wrapper: invalid %s value: %s\n", arg, s);
    fprintf(stderr, "ds4-wrapper: valid backends are: metal, cuda, cpu\n");
    exit(2);
}

static ds4_backend default_backend(void) {
#ifdef DS4_NO_GPU
    return DS4_BACKEND_CPU;
#elif defined(__APPLE__)
    return DS4_BACKEND_METAL;
#else
    return DS4_BACKEND_CUDA;
#endif
}

ds4_wrapper_config ds4_wrapper_default_config(void) {
    ds4_wrapper_config c = {
        .engine = {
            .model_path = "ds4flash.gguf",
            .backend = default_backend(),
            .mtp_draft_tokens = 1,
            .mtp_margin = 3.0f,
        },
        .ctx_size = 32768,
        .default_tokens = 393216,
        .host = "127.0.0.1",
        .port = 8000,
        .max_queued_jobs = 1,
        .tool_memory_max_ids = 1000,
        .startup_mode = DS4_WRAP_MODE_SERVER,
        .agent_system_prompt = "You are a helpful coding assistant running inside ds4-studio.",
        .freeze_on_switch = false,
        .free_inactive_session = false,
        .allow_browser = false,
        .ram_freeze_max_mb = 0,
    };
    c.kv_options = ds4_kvstore_default_options();
    return c;
}

static void usage(FILE *fp) {
    fprintf(fp,
        "Usage: ds4-wrapper [options]\n"
        "\n"
        "Options:\n"
        "  -m, --model FILE                      Model path. Default: ds4flash.gguf\n"
        "  --mtp FILE                            MTP model path\n"
        "  --mtp-draft N                         Maximum autoregressive MTP draft tokens\n"
        "  --mtp-margin F                        Minimum speculative confidence confidence\n"
        "  -c, --ctx N                           Context size allocated at startup. Default: 32768\n"
        "  -n, --tokens N                        Default max output tokens\n"
        "  -t, --threads N                       CPU helper threads\n"
        "  --host HOST                           Bind address. Default: 127.0.0.1\n"
        "  --port PORT                           Bind port. Default: 8000\n"
        "  --trace FILE                          Trace file path\n"
        "  --backend auto|metal|cuda|cpu         Select backend explicitly\n"
        "  --metal                               Use Metal backend\n"
        "  --cuda                                Use CUDA backend\n"
        "  --cpu                                 Use CPU backend\n"
        "  --quality                             Prefer exact kernels\n"
        "  --warm-weights                        Touch mapped pages before serving\n"
        "  --dir-steering-file FILE              Steering direction file\n"
        "  --dir-steering-ffn F                  Apply steering after FFN outputs\n"
        "  --dir-steering-attn F                 Apply steering after attention outputs\n"
        "  --power N                             Target GPU duty cycle percentage (1..100)\n"
        "  --kv-disk-dir DIR                     Enable disk KV checkpoints in DIR\n"
        "  --kv-disk-space-mb MB                 Disk budget for checkpoint files\n"
        "  --kv-cache-min-tokens N               Do not save checkpoints shorter than N\n"
        "  --kv-cache-cold-max-tokens N          Save stable prefix of long prompts\n"
        "  --kv-cache-continued-interval-tokens N Save aligned frontiers spaced N tokens\n"
        "  --kv-cache-boundary-trim-tokens N     Trim tail tokens before boundary save\n"
        "  --kv-cache-boundary-align-tokens N    Align boundary saves down to multiple N\n"
        "  --kv-cache-reject-different-quant     Refuse checkpoints with different quantization\n"
        "  --tool-memory-max-ids N               Max tool memory entries. Default: 1000\n"
        "  --startup-mode server|agent           Initial mode on launch. Default: server\n"
        "  --freeze-on-switch                    Freeze active session to disk on switch\n"
        "  --free-inactive-session               Free memory of inactive session\n"
        "  --agent-allow-browser                 Allow the agent to open visible Chrome (default: off)\n"
        "  --ram-freeze-max-mb MB                Max RAM snapshot size in MB\n"
        "  --agent-system-prompt TEXT             System prompt for agent mode. Default: helpful coding assistant\n"
        "  --max-queued-jobs N                   Max queued jobs. Must be 1. Default: 1\n"
        "  -h, --help                            Show this help\n"
    );
}

ds4_wrapper_config ds4_wrapper_parse_options(int argc, char **argv) {
    ds4_wrapper_config c = ds4_wrapper_default_config();
    bool directional_steering_scale_set = false;

    for (int i = 1; i < argc; i++) {
        const char *arg = argv[i];
        if (!strcmp(arg, "-h") || !strcmp(arg, "--help")) {
            usage(stdout);
            exit(0);
        } else if (!strcmp(arg, "-m") || !strcmp(arg, "--model")) {
            c.engine.model_path = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--mtp")) {
            c.engine.mtp_path = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--mtp-draft")) {
            c.engine.mtp_draft_tokens = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--mtp-margin")) {
            c.engine.mtp_margin = parse_float_arg(need_arg(&i, argc, argv, arg), arg, 0.0f, 1000.0f);
        } else if (!strcmp(arg, "-c") || !strcmp(arg, "--ctx")) {
            c.ctx_size = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "-n") || !strcmp(arg, "--tokens")) {
            c.default_tokens = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "-t") || !strcmp(arg, "--threads")) {
            c.engine.n_threads = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--host")) {
            c.host = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--port")) {
            c.port = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--trace")) {
            c.trace_path = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--backend")) {
            c.engine.backend = parse_backend_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--metal")) {
            c.engine.backend = DS4_BACKEND_METAL;
        } else if (!strcmp(arg, "--cuda")) {
            c.engine.backend = DS4_BACKEND_CUDA;
        } else if (!strcmp(arg, "--cpu")) {
            c.engine.backend = DS4_BACKEND_CPU;
        } else if (!strcmp(arg, "--quality")) {
            c.engine.quality = true;
        } else if (!strcmp(arg, "--warm-weights")) {
            c.engine.warm_weights = true;
        } else if (!strcmp(arg, "--dir-steering-file")) {
            c.engine.directional_steering_file = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--dir-steering-ffn")) {
            c.engine.directional_steering_ffn = parse_float_arg(need_arg(&i, argc, argv, arg), arg, -100.0f, 100.0f);
            directional_steering_scale_set = true;
        } else if (!strcmp(arg, "--dir-steering-attn")) {
            c.engine.directional_steering_attn = parse_float_arg(need_arg(&i, argc, argv, arg), arg, -100.0f, 100.0f);
            directional_steering_scale_set = true;
        } else if (!strcmp(arg, "--power")) {
            c.engine.power_percent = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
            if (c.engine.power_percent < 1 || c.engine.power_percent > 100) {
                fprintf(stderr, "ds4-wrapper: --power must be between 1 and 100\n");
                exit(2);
            }
        } else if (!strcmp(arg, "--kv-disk-dir")) {
            c.kv_disk_dir = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--kv-disk-space-mb")) {
            c.kv_disk_space_mb = (uint64_t)parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-min-tokens")) {
            c.kv_options.min_tokens = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-cold-max-tokens")) {
            c.kv_options.cold_max_tokens = parse_nonneg_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-continued-interval-tokens")) {
            c.kv_options.continued_interval_tokens = parse_nonneg_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-boundary-trim-tokens")) {
            c.kv_options.boundary_trim_tokens = parse_nonneg_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-boundary-align-tokens")) {
            c.kv_options.boundary_align_tokens = parse_nonneg_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--kv-cache-reject-different-quant")) {
            c.kv_reject_different_quant = true;
        } else if (!strcmp(arg, "--tool-memory-max-ids")) {
            c.tool_memory_max_ids = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--agent-system-prompt")) {
            c.agent_system_prompt = need_arg(&i, argc, argv, arg);
        } else if (!strcmp(arg, "--startup-mode")) {
            const char *mode_str = need_arg(&i, argc, argv, arg);
            if (!strcmp(mode_str, "server")) {
                c.startup_mode = DS4_WRAP_MODE_SERVER;
            } else if (!strcmp(mode_str, "agent")) {
                c.startup_mode = DS4_WRAP_MODE_AGENT;
            } else {
                fprintf(stderr, "ds4-wrapper: invalid --startup-mode: %s\n", mode_str);
                exit(2);
            }
        } else if (!strcmp(arg, "--freeze-on-switch")) {
            c.freeze_on_switch = true;
        } else if (!strcmp(arg, "--free-inactive-session")) {
            c.free_inactive_session = true;
        } else if (!strcmp(arg, "--agent-allow-browser")) {
            c.allow_browser = true;
        } else if (!strcmp(arg, "--ram-freeze-max-mb")) {
            c.ram_freeze_max_mb = (uint64_t)parse_int_arg(need_arg(&i, argc, argv, arg), arg);
        } else if (!strcmp(arg, "--max-queued-jobs")) {
            int max_jobs = parse_int_arg(need_arg(&i, argc, argv, arg), arg);
            if (max_jobs != 1) {
                fprintf(stderr, "ds4-wrapper: --max-queued-jobs must be 1 in wrapper mutual-exclusive mode\n");
                exit(2);
            }
            c.max_queued_jobs = max_jobs;
        } else {
            fprintf(stderr, "ds4-wrapper: unknown option: %s\n", arg);
            usage(stderr);
            exit(2);
        }
    }

    if (c.kv_options.cold_max_tokens > 0 &&
        c.kv_options.cold_max_tokens < c.kv_options.min_tokens)
    {
        fprintf(stderr, "ds4-wrapper: --kv-cache-cold-max-tokens must be 0 or >= --kv-cache-min-tokens\n");
        exit(2);
    }
    if (c.engine.directional_steering_file && !directional_steering_scale_set) {
        c.engine.directional_steering_ffn = 1.0f;
    }
    return c;
}
````

## File: ds4_wrapper_config.h
````c
#ifndef DS4_WRAPPER_CONFIG_H
#define DS4_WRAPPER_CONFIG_H

#include "ds4.h"
#include "ds4_kvstore.h"
#include "ds4_wrapper.h"

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    ds4_engine_options engine;

    int ctx_size;
    int default_tokens;

    const char *host;
    int port;

    const char *trace_path;

    const char *kv_disk_dir;
    uint64_t kv_disk_space_mb;
    ds4_kvstore_options kv_options;
    bool kv_reject_different_quant;

    int max_queued_jobs;
    int tool_memory_max_ids;

    ds4_wrap_mode startup_mode;

    bool freeze_on_switch;
    bool free_inactive_session;
    bool allow_browser;

    uint64_t ram_freeze_max_mb;

    const char *agent_system_prompt;
    const char *server_session_key;
    const char *agent_session_key;
} ds4_wrapper_config;

ds4_wrapper_config ds4_wrapper_default_config(void);
ds4_wrapper_config ds4_wrapper_parse_options(int argc, char **argv);

#endif
````

## File: ds4_wrapper_http.c
````c
#include "ds4_wrapper_http.h"
#include "ds4_wrapper_metrics.h"
#include "ds4_wrapper_state.h"
#include "ds4_server_runtime.h"
#include "ds4_agent_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <ctype.h>
#include <stdint.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <poll.h>

#define MAX_HEADER (64 * 1024)
#define MAX_BODY (64 * 1024 * 1024)
#define WRAP_JSON_STRING_MAX MAX_BODY

static int server_fd = -1;
static pthread_t accept_thread;
static volatile bool server_running = false;

typedef struct {
    char method[16];
    char path[256];
    char *body;
    size_t body_len;
} wrap_http_request;

static void wrap_http_request_free(wrap_http_request *r) {
    free(r->body);
    memset(r, 0, sizeof(*r));
}

static bool wrap_send_all(int fd, const void *p, size_t n) {
    const char *s = p;
    while (n) {
        ssize_t w = send(fd, s, n, 0);
        if (w < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        if (w == 0) return false;
        s += w;
        n -= (size_t)w;
    }
    return true;
}

static const char *agent_event_name(ds4_agent_event_type type) {
    switch (type) {
    case DS4_AGENT_EVENT_TEXT:        return "agent_text";
    case DS4_AGENT_EVENT_REASONING:  return "agent_reasoning";
    case DS4_AGENT_EVENT_TOOL_CALL:  return "agent_tool_call";
    case DS4_AGENT_EVENT_TOOL_RESULT:return "agent_tool_result";
    case DS4_AGENT_EVENT_STATUS:     return "agent_status";
    case DS4_AGENT_EVENT_USAGE:      return "agent_usage";
    case DS4_AGENT_EVENT_DONE:       return "agent_done";
    case DS4_AGENT_EVENT_ERROR:      return "agent_error";
    default:                         return "agent_text";
    }
}

typedef struct {
    int fd;
    ds4_wrapper *w;
    bool aborted;
} chat_cb_ctx;

static void chat_event_cb(void *ud, const ds4_agent_event *ev) {
    chat_cb_ctx *ctx = (chat_cb_ctx *)ud;
    const char *name = agent_event_name(ev->type);
    char sse[8192];
    int len = snprintf(sse, sizeof(sse), "event: %s\ndata: %s\n\n", name, ev->json_payload);
    if (len > 0) {
        if (!wrap_send_all(ctx->fd, sse, (size_t)len) && !ctx->aborted) {
            /* Client disconnected (browser Stop). Interrupt the worker so the
             * current turn ends and the wrapper releases busy, instead of
             * generating to completion with no consumer. */
            ctx->aborted = true;
            ds4_agent_runtime_interrupt(ctx->w->agent_rt);
        }
    }
}

static char *parse_json_string(const char *json, const char *key) {
    if (!json) return NULL;
    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *p = strstr(json, pattern);
    if (!p) return NULL;
    p = strchr(p + strlen(pattern), ':');
    if (!p) return NULL;
    p++;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p != '"') return NULL;
    p++;
    size_t cap = 256;
    size_t len = 0;
    char *val = malloc(cap);
    if (!val) return NULL;
    while (*p && *p != '"') {
        if (len + 2 >= cap) {
            if (cap >= WRAP_JSON_STRING_MAX + 1) {
                free(val);
                return NULL;
            }
            size_t new_cap = cap > SIZE_MAX / 2 ? WRAP_JSON_STRING_MAX + 1 : cap * 2;
            if (new_cap > WRAP_JSON_STRING_MAX + 1) new_cap = WRAP_JSON_STRING_MAX + 1;
            if (new_cap <= cap) {
                free(val);
                return NULL;
            }
            char *new_val = realloc(val, new_cap);
            if (!new_val) {
                free(val);
                return NULL;
            }
            val = new_val;
            cap = new_cap;
        }
        if (*p == '\\') {
            p++;
            if (*p == 'n') { val[len++] = '\n'; }
            else if (*p == 'r') { val[len++] = '\r'; }
            else if (*p == 't') { val[len++] = '\t'; }
            else if (*p == '"' || *p == '\\' || *p == '/') { val[len++] = *p; }
            else { val[len++] = '\\'; val[len++] = *p; }
        } else {
            val[len++] = *p;
        }
        p++;
    }
    val[len] = '\0';
    return val;
}

static ssize_t find_header_end(const char *p, size_t n) {
    for (size_t i = 3; i < n; i++) {
        if (p[i - 3] == '\r' && p[i - 2] == '\n' && p[i - 1] == '\r' && p[i] == '\n') {
            return (ssize_t)(i + 1);
        }
    }
    for (size_t i = 1; i < n; i++) {
        if (p[i - 1] == '\n' && p[i] == '\n') {
            return (ssize_t)(i + 1);
        }
    }
    return -1;
}

static long get_content_length(const char *h, size_t n) {
    const char *p = h, *end = h + n;
    while (p < end) {
        const char *line = p;
        while (p < end && *p != '\n') p++;
        size_t len = (size_t)(p - line);
        if (len && line[len - 1] == '\r') len--;
        if (len >= 15 && strncasecmp(line, "Content-Length:", 15) == 0) {
            const char *v = line + 15;
            while (v < line + len && isspace((unsigned char)*v)) v++;
            return strtol(v, NULL, 10);
        }
        if (p < end) p++;
    }
    return 0;
}

static bool read_request(int fd, wrap_http_request *r) {
    char *buf = NULL;
    size_t buf_len = 0;
    size_t buf_cap = 4096;
    buf = malloc(buf_cap);
    if (!buf) return false;

    ssize_t hend = -1;
    while (hend < 0 && buf_len < MAX_HEADER) {
        size_t want = MAX_HEADER - buf_len;
        if (want > 1024) want = 1024;
        if (want == 0 || buf_len > SIZE_MAX - want - 1) {
            free(buf);
            return false;
        }
        const size_t need_cap = buf_len + want + 1;
        if (need_cap > buf_cap) {
            size_t new_cap = buf_cap;
            while (new_cap < need_cap) {
                if (new_cap >= MAX_HEADER + 1 || new_cap > SIZE_MAX / 2) {
                    free(buf);
                    return false;
                }
                new_cap *= 2;
                if (new_cap > MAX_HEADER + 1) new_cap = MAX_HEADER + 1;
            }
            char *new_buf = realloc(buf, new_cap);
            if (!new_buf) {
                free(buf);
                return false;
            }
            buf = new_buf;
            buf_cap = new_cap;
        }
        ssize_t n = recv(fd, buf + buf_len, want, 0);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            free(buf);
            return false;
        }
        buf_len += (size_t)n;
        hend = find_header_end(buf, buf_len);
    }

    if (hend < 0) {
        free(buf);
        return false;
    }

    char line[512];
    size_t i = 0;
    while (i < buf_len && buf[i] != '\n' && i + 1 < sizeof(line)) {
        line[i] = buf[i];
        i++;
    }
    line[i] = '\0';
    if (sscanf(line, "%15s %255s", r->method, r->path) != 2) {
        free(buf);
        return false;
    }

    char *q = strchr(r->path, '?');
    if (q) *q = '\0';

    long clen = get_content_length(buf, (size_t)hend);
    if (clen < 0 || (size_t)clen > MAX_BODY) {
        free(buf);
        return false;
    }

    if ((size_t)hend > SIZE_MAX - (size_t)clen - 1) {
        free(buf);
        return false;
    }
    size_t total_needed = (size_t)hend + (size_t)clen;
    if (buf_cap < total_needed + 1) {
        char *new_buf = realloc(buf, total_needed + 1);
        if (!new_buf) {
            free(buf);
            return false;
        }
        buf = new_buf;
    }

    while (buf_len < total_needed) {
        ssize_t n = recv(fd, buf + buf_len, total_needed - buf_len, 0);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            free(buf);
            return false;
        }
        buf_len += (size_t)n;
    }

    r->body_len = (size_t)clen;
    r->body = malloc(r->body_len + 1);
    if (!r->body) {
        free(buf);
        return false;
    }
    memcpy(r->body, buf + hend, r->body_len);
    r->body[r->body_len] = '\0';
    free(buf);
    return true;
}

static bool send_response(int fd, bool enable_cors, int code, const char *type, const char *body) {
    const char *reason = code == 200 ? "OK" :
                         code == 204 ? "No Content" :
                         code == 400 ? "Bad Request" :
                         code == 404 ? "Not Found" :
                         code == 409 ? "Conflict" :
                         code == 500 ? "Internal Server Error" : "Error";
    const size_t body_len = body ? strlen(body) : 0;
    char header[512];
    int hlen = snprintf(header, sizeof(header),
                        "HTTP/1.1 %d %s\r\n"
                        "Content-Length: %zu\r\n",
                        code, reason, body_len);
    if (hlen < 0 || (size_t)hlen >= sizeof(header)) return false;

    if (!wrap_send_all(fd, header, (size_t)hlen)) return false;

    if (type && type[0]) {
        char type_hdr[128];
        int tlen = snprintf(type_hdr, sizeof(type_hdr), "Content-Type: %s\r\n", type);
        if (tlen > 0 && !wrap_send_all(fd, type_hdr, (size_t)tlen)) return false;
    }

    if (enable_cors) {
        const char *cors_hdr = "Access-Control-Allow-Origin: *\r\n"
                               "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
                               "Access-Control-Allow-Headers: Content-Type, Authorization\r\n";
        if (!wrap_send_all(fd, cors_hdr, strlen(cors_hdr))) return false;
    }

    const char *conn_hdr = "Connection: close\r\n\r\n";
    if (!wrap_send_all(fd, conn_hdr, strlen(conn_hdr))) return false;

    if (body_len && !wrap_send_all(fd, body, body_len)) return false;

    return true;
}

static void send_json_error(int fd, bool enable_cors, int code, const char *err_code, const char *msg) {
    char *body = NULL;
    int len = asprintf(&body, "{\"ok\":false,\"error\":\"%s\",\"message\":\"%s\"}\n", err_code, msg);
    if (len >= 0 && body) {
        send_response(fd, enable_cors, code, "application/json", body);
        free(body);
    }
}

static char *wrap_json_escape_dup(const char *s) {
    if (!s) s = "";
    size_t len = strlen(s);
    size_t cap = len * 6 + 1;
    char *out = malloc(cap);
    if (!out) return NULL;
    size_t w = 0;
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c == '"' || c == '\\') {
            out[w++] = '\\';
            out[w++] = (char)c;
        } else if (c == '\n') {
            out[w++] = '\\';
            out[w++] = 'n';
        } else if (c == '\r') {
            out[w++] = '\\';
            out[w++] = 'r';
        } else if (c == '\t') {
            out[w++] = '\\';
            out[w++] = 't';
        } else if (c < 0x20) {
            w += (size_t)snprintf(out + w, cap - w, "\\u%04x", c);
        } else {
            out[w++] = (char)c;
        }
    }
    out[w] = '\0';
    return out;
}

static char *native_agent_result_json(const ds4_agent_command_result *result,
                                      bool active) {
    char *message = wrap_json_escape_dup(result->message);
    if (!message) return NULL;
    const char *data = result->data_json ? result->data_json : "null";
    char *body = NULL;
    if (asprintf(&body,
                 "{\"ok\":%s,\"command\":\"%s\",\"message\":\"%s\","
                 "\"data\":%s,\"active\":%s}\n",
                 result->ok ? "true" : "false",
                 result->command,
                 message,
                 data,
                 active ? "true" : "false") < 0)
        body = NULL;
    free(message);
    return body;
}

static int execute_native_agent_command(ds4_wrapper *w, const char *command,
                                        ds4_agent_command_result *result) {
    char err[256] = {0};
    int code = ds4_wrapper_enter_request(w, DS4_WRAP_MODE_AGENT,
                                         err, sizeof(err));
    if (code != 0) {
        memset(result, 0, sizeof(*result));
        result->http_status = code;
        result->message = strdup(err[0] ? err : "failed to enter agent mode");
        return -1;
    }

    bool request_open = true;
    if (ds4_wrapper_ensure_agent_rt(w, err, sizeof(err)) != 0) {
        memset(result, 0, sizeof(*result));
        result->http_status = 500;
        result->message = strdup(err[0] ? err : "failed to initialize agent runtime");
        ds4_wrapper_leave_request(w);
        return -1;
    }

    int rc = ds4_agent_runtime_command(w->agent_rt, command, result);
    if (rc == 0 && result->switch_to_server) {
        ds4_wrapper_leave_request(w);
        request_open = false;
        code = ds4_wrapper_switch_mode(w, DS4_WRAP_MODE_SERVER,
                                       err, sizeof(err));
        if (code != 0) {
            result->ok = false;
            result->http_status = code;
            result->switch_to_server = false;
            free(result->message);
            result->message = strdup(err[0] ? err :
                                     "failed to switch to server mode");
            rc = -1;
        }
    }
    if (request_open) ds4_wrapper_leave_request(w);
    return rc;
}

static void send_native_agent_command_response(ds4_wrapper *w, int fd,
                                               const char *command) {
    ds4_agent_command_result result = {0};
    execute_native_agent_command(w, command, &result);
    pthread_mutex_lock(&w->mu);
    bool active = w->active_mode == DS4_WRAP_MODE_AGENT;
    pthread_mutex_unlock(&w->mu);
    char *body = native_agent_result_json(&result, active);
    int status = result.http_status ? result.http_status :
                 (result.ok ? 200 : 500);
    if (body) {
        send_response(fd, true, status, "application/json", body);
        free(body);
    } else {
        send_json_error(fd, true, 500, "serialization_error",
                        "failed to serialize native agent command result");
    }
    ds4_agent_command_result_free(&result);
}

static void send_legacy_native_agent_response(ds4_wrapper *w, int fd,
                                              const char *command,
                                              const char *legacy_name) {
    ds4_agent_command_result result = {0};
    execute_native_agent_command(w, command, &result);
    int status = result.http_status ? result.http_status :
                 (result.ok ? 200 : 500);

    if (!result.ok) {
        send_json_error(fd, true, status, "native_agent_error",
                        result.message ? result.message : "command failed");
    } else if (!strcmp(legacy_name, "list")) {
        send_response(fd, true, 200, "application/json",
                      result.data_json ? result.data_json : "[]");
    } else if (!strcmp(legacy_name, "save") && result.data_json) {
        size_t len = strlen(result.data_json);
        char *body = NULL;
        if (len >= 2 && result.data_json[0] == '{' &&
            result.data_json[len - 1] == '}')
        {
            if (asprintf(&body, "{\"ok\":true,%.*s}\n",
                         (int)(len - 2), result.data_json + 1) < 0)
                body = NULL;
        }
        if (body) {
            send_response(fd, true, 200, "application/json", body);
            free(body);
        } else {
            send_response(fd, true, 200, "application/json",
                          "{\"ok\":true}\n");
        }
    } else {
        send_response(fd, true, 200, "application/json",
                      "{\"ok\":true}\n");
    }
    ds4_agent_command_result_free(&result);
}

static void send_agent_compression_metrics(ds4_wrapper *w, int fd) {
    pthread_mutex_lock(&w->mu);
    bool active = w->active_mode == DS4_WRAP_MODE_AGENT;
    ds4_agent_compression_metrics m = {0};
    if (active && w->agent_rt)
        ds4_agent_runtime_get_compression_metrics(w->agent_rt, &m);
    pthread_mutex_unlock(&w->mu);

    /* Build JSON manually to avoid printf %% format confusion. */
    char buf[2048];
    int n = snprintf(buf, sizeof(buf),
                     "{\"ok\":true,\"active\":%s,"
                     "\"events\":%llu,"
                     "\"originalBytes\":%llu,"
                     "\"compressedBytes\":%llu,"
                     "\"blobCount\":%llu,"
                     "\"retrieveCount\":%llu,"
                     "\"lastStrategy\":\"%s\","
                     "\"lastBlobId\":\"%s\"}\n",
                     active ? "true" : "false",
                     (unsigned long long)m.events,
                     (unsigned long long)m.original_bytes,
                     (unsigned long long)m.compressed_bytes,
                     (unsigned long long)m.blob_count,
                     (unsigned long long)m.retrieve_count,
                     m.last_strategy[0] ? m.last_strategy : "",
                     m.last_blob_id[0] ? m.last_blob_id : "");
    if (n > 0 && (size_t)n < sizeof(buf))
        send_response(fd, true, 200, "application/json", buf);
    else
        send_json_error(fd, true, 500, "serialization_error",
                        "Compression metrics too large or failed to serialize");
}

typedef struct {
    ds4_wrapper *w;
    int fd;
} wrap_client_arg;

static void *client_thread_main(void *arg) {
    wrap_client_arg *ca = arg;
    ds4_wrapper *w = ca->w;
    int fd = ca->fd;
    free(ca);

    struct timeval tv = {.tv_sec = 10, .tv_usec = 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    int one = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));

    wrap_http_request hr;
    memset(&hr, 0, sizeof(hr));

    if (!read_request(fd, &hr)) {
        send_response(fd, true, 400, "text/plain", "Bad Request");
        close(fd);
        return NULL;
    }

    if (!strcmp(hr.method, "OPTIONS")) {
        send_response(fd, true, 204, NULL, NULL);
    } else if (!strcmp(hr.method, "GET") && !strcmp(hr.path, "/api/wrapper/status")) {
        char *status = ds4_wrapper_status_json(w);
        if (status) {
            send_response(fd, true, 200, "application/json", status);
            free(status);
        } else {
            send_response(fd, true, 500, "application/json", "{\"error\":\"failed to generate status\"}");
        }
    } else if (!strcmp(hr.method, "GET") && (!strcmp(hr.path, "/v1/models") || !strncmp(hr.path, "/v1/models/", 11))) {
        char err_buf[256] = {0};
        int code = ds4_wrapper_enter_request(w, DS4_WRAP_MODE_SERVER, err_buf, sizeof(err_buf));
        if (code != 0) {
            send_json_error(fd, true, code, code == 409 ? "conflict" : "error", err_buf);
        } else {
            struct http_request req = { .method = hr.method, .path = hr.path, .body = hr.body, .body_len = hr.body_len };
            struct http_response res = { .fd = fd, .enable_cors = true };
            ds4_server_runtime_handle_models(w->server_rt, &req, &res);
            ds4_wrapper_leave_request(w);
        }
    } else if (!strcmp(hr.method, "GET") && !strcmp(hr.path, "/api/server/metrics")) {
        char err_buf[256] = {0};
        int code = ds4_wrapper_enter_request(w, DS4_WRAP_MODE_SERVER, err_buf, sizeof(err_buf));
        if (code != 0) {
            send_json_error(fd, true, code, code == 409 ? "conflict" : "error", err_buf);
        } else {
            struct http_request req = { .method = hr.method, .path = hr.path, .body = hr.body, .body_len = hr.body_len };
            struct http_response res = { .fd = fd, .enable_cors = true };
            ds4_server_runtime_handle_server_metrics(w->server_rt, &req, &res);
            ds4_wrapper_leave_request(w);
        }
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/api/wrapper/switch-mode")) {
        ds4_wrap_mode target_mode = DS4_WRAP_MODE_SERVER;
        bool has_mode = false;
        if (hr.body) {
            char *p = strstr(hr.body, "\"mode\"");
            if (p) {
                p = strchr(p + 6, ':');
                if (p) {
                    while (*p && (*p == ':' || *p == ' ' || *p == '\t' || *p == '"' || *p == '\'')) p++;
                    if (strncmp(p, "agent", 5) == 0) {
                        target_mode = DS4_WRAP_MODE_AGENT;
                        has_mode = true;
                    } else if (strncmp(p, "server", 6) == 0) {
                        target_mode = DS4_WRAP_MODE_SERVER;
                        has_mode = true;
                    }
                }
            }
        }
        if (!has_mode) {
            send_json_error(fd, true, 400, "bad_request", "Missing or invalid 'mode' in request body");
        } else {
            char err_buf[256] = {0};
            int code = ds4_wrapper_switch_mode(w, target_mode, err_buf, sizeof(err_buf));
            if (code == 0) {
                send_response(fd, true, 200, "application/json", "{\"ok\":true}\n");
            } else {
                send_json_error(fd, true, code, "switch_error", err_buf);
            }
        }
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/api/wrapper/freeze")) {
        pthread_mutex_lock(&w->mu);
        if (w->busy) {
            pthread_mutex_unlock(&w->mu);
            send_json_error(fd, true, 409, "busy", "cannot freeze while a request is running");
        } else if (!w->active_session) {
            pthread_mutex_unlock(&w->mu);
            send_response(fd, true, 200, "application/json", "{\"ok\":true,\"message\":\"no active session\"}\n");
        } else {
            w->state = DS4_WRAP_STATE_SWITCHING;
            pthread_mutex_unlock(&w->mu);

            char err_buf[256] = {0};
            int rc = ds4_wrapper_freeze_active_session(w, err_buf, sizeof(err_buf));

            pthread_mutex_lock(&w->mu);
            if (rc == 0) {
                w->state = DS4_WRAP_STATE_READY;
                pthread_cond_broadcast(&w->cv);
                pthread_mutex_unlock(&w->mu);
                send_response(fd, true, 200, "application/json", "{\"ok\":true}\n");
            } else {
                w->state = DS4_WRAP_STATE_ERROR;
                snprintf(w->last_error, sizeof(w->last_error), "%s", err_buf);
                pthread_cond_broadcast(&w->cv);
                pthread_mutex_unlock(&w->mu);
                send_json_error(fd, true, 500, "freeze_error", err_buf);
            }
        }
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/api/wrapper/thaw")) {
        pthread_mutex_lock(&w->mu);
        if (w->busy) {
            pthread_mutex_unlock(&w->mu);
            send_json_error(fd, true, 409, "busy", "cannot thaw while a request is running");
        } else if (w->active_session != NULL) {
            pthread_mutex_unlock(&w->mu);
            send_response(fd, true, 200, "application/json", "{\"ok\":true,\"message\":\"session already active\"}\n");
        } else {
            ds4_wrap_mode mode = w->active_mode;
            w->state = DS4_WRAP_STATE_SWITCHING;
            pthread_mutex_unlock(&w->mu);

            char err_buf[256] = {0};
            int rc = ds4_wrapper_thaw_session(w, mode, err_buf, sizeof(err_buf));

            pthread_mutex_lock(&w->mu);
            if (rc == 0) {
                w->state = DS4_WRAP_STATE_READY;
                pthread_cond_broadcast(&w->cv);
                pthread_mutex_unlock(&w->mu);
                send_response(fd, true, 200, "application/json", "{\"ok\":true}\n");
            } else {
                w->state = DS4_WRAP_STATE_ERROR;
                snprintf(w->last_error, sizeof(w->last_error), "%s", err_buf);
                pthread_cond_broadcast(&w->cv);
                pthread_mutex_unlock(&w->mu);
                send_json_error(fd, true, 500, "thaw_error", err_buf);
            }
        }
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/v1/cancel")) {
        /* Cancellation is driven by the client aborting the streaming
         * connection: the in-flight generation observes the closed socket and
         * stops. This endpoint exists so the studio's belt-and-suspenders
         * /v1/cancel POST is acknowledged instead of 404'd. It deliberately
         * bypasses ds4_wrapper_enter_request so a cancel issued while a request
         * is streaming (state BUSY) is not itself rejected with 409. */
        send_response(fd, true, 200, "application/json", "{\"ok\":true}\n");
    } else if (!strcmp(hr.method, "POST") && (
               !strcmp(hr.path, "/v1/chat/completions") ||
               !strcmp(hr.path, "/v1/token-count") ||
               !strcmp(hr.path, "/v1/responses") ||
               !strcmp(hr.path, "/v1/messages") ||
               !strcmp(hr.path, "/v1/completions"))) {
        char err_buf[256] = {0};
        int code = ds4_wrapper_enter_request(w, DS4_WRAP_MODE_SERVER, err_buf, sizeof(err_buf));
        if (code != 0) {
            send_json_error(fd, true, code, code == 409 ? "conflict" : "error", err_buf);
        } else {
            struct http_request req = { .method = hr.method, .path = hr.path, .body = hr.body, .body_len = hr.body_len };
            struct http_response res = { .fd = fd, .enable_cors = true };
            if (!strcmp(hr.path, "/v1/chat/completions")) {
                ds4_server_runtime_handle_chat_completions(w->server_rt, &req, &res);
            } else if (!strcmp(hr.path, "/v1/token-count")) {
                ds4_server_runtime_handle_token_count(w->server_rt, &req, &res);
            } else if (!strcmp(hr.path, "/v1/responses")) {
                ds4_server_runtime_handle_responses(w->server_rt, &req, &res);
            } else if (!strcmp(hr.path, "/v1/messages")) {
                ds4_server_runtime_handle_messages(w->server_rt, &req, &res);
            } else if (!strcmp(hr.path, "/v1/completions")) {
                ds4_server_runtime_handle_completions(w->server_rt, &req, &res);
            }
            ds4_wrapper_leave_request(w);
        }
    } else if (!strcmp(hr.method, "POST") && !strcmp(hr.path, "/api/native-agent/chat")) {
        char err_buf[256] = {0};
        int code = ds4_wrapper_enter_request(w, DS4_WRAP_MODE_AGENT, err_buf, sizeof(err_buf));
        if (code != 0) {
            send_json_error(fd, true, code, code == 409 ? "conflict" : "error", err_buf);
        } else if (ds4_wrapper_ensure_agent_rt(w, err_buf, sizeof(err_buf)) != 0) {
            send_json_error(fd, true, 500, "agent_init_error", err_buf);
            ds4_wrapper_leave_request(w);
        } else {
            char *message = parse_json_string(hr.body, "message");
            if (!message) {
                send_json_error(fd, true, 400, "bad_request", "Missing 'message' in request body");
            } else {
                const char *headers =
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: text/event-stream\r\n"
                    "Cache-Control: no-cache\r\n"
                    "Connection: keep-alive\r\n"
                    "Access-Control-Allow-Origin: *\r\n\r\n";
                wrap_send_all(fd, headers, strlen(headers));
                chat_cb_ctx cbctx = { .fd = fd, .w = w, .aborted = false };
                int chat_rc = ds4_agent_runtime_chat(w->agent_rt, message, chat_event_cb, &cbctx, err_buf, sizeof(err_buf));
                if (chat_rc != 0) {
                    fprintf(stderr, "ds4-wrapper: chat failed: %s\n", err_buf);
                }
                free(message);
            }
            ds4_wrapper_leave_request(w);
        }
    } else if (!strcmp(hr.method, "POST") &&
               !strcmp(hr.path, "/api/native-agent/command")) {
        char *command = parse_json_string(hr.body, "command");
        if (!command) {
            send_json_error(fd, true, 400, "bad_request",
                            "Missing 'command' in request body");
        } else {
            send_native_agent_command_response(w, fd, command);
            free(command);
        }
    } else if (!strcmp(hr.method, "POST") &&
               !strcmp(hr.path, "/api/native-agent/save")) {
        send_legacy_native_agent_response(w, fd, "/save", "save");
    } else if ((!strcmp(hr.method, "GET") || !strcmp(hr.method, "POST")) &&
               !strcmp(hr.path, "/api/native-agent/list")) {
        send_legacy_native_agent_response(w, fd, "/list", "list");
    } else if (!strcmp(hr.method, "POST") &&
               (!strcmp(hr.path, "/api/native-agent/switch") ||
                !strcmp(hr.path, "/api/native-agent/strip"))) {
        char *sha = parse_json_string(hr.body, "sha");
        if (!sha) {
            send_json_error(fd, true, 400, "bad_request",
                            "Missing 'sha' in request body");
        } else {
            const char *name = !strcmp(hr.path, "/api/native-agent/switch") ?
                               "switch" : "strip";
            char *command = NULL;
            if (asprintf(&command, "/%s %s", name, sha) < 0) command = NULL;
            if (command) {
                send_legacy_native_agent_response(w, fd, command, name);
                free(command);
            } else {
                send_json_error(fd, true, 500, "allocation_error",
                                "Failed to build native agent command");
            }
            free(sha);
        }
    } else if (!strcmp(hr.method, "POST") &&
               !strcmp(hr.path, "/api/native-agent/new")) {
        send_legacy_native_agent_response(w, fd, "/new", "new");
    } else if (!strcmp(hr.method, "POST") &&
               !strcmp(hr.path, "/api/native-agent/compact")) {
        send_legacy_native_agent_response(w, fd, "/compact", "compact");
    } else if (!strcmp(hr.method, "GET") &&
               !strcmp(hr.path, "/api/agent/compression-metrics")) {
        send_agent_compression_metrics(w, fd);
    } else {
        send_json_error(fd, true, 404, "not_found", "Endpoint not found");
    }

    wrap_http_request_free(&hr);
    close(fd);
    return NULL;
}

static void *accept_thread_main(void *arg) {
    ds4_wrapper *w = arg;
    while (server_running) {
        struct sockaddr_in addr;
        socklen_t len = sizeof(addr);
        int fd = accept(server_fd, (struct sockaddr *)&addr, &len);
        if (fd < 0) {
            if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) continue;
            if (!server_running) break;
            perror("ds4-wrapper http accept");
            sleep(1);
            continue;
        }

        wrap_client_arg *ca = malloc(sizeof(*ca));
        if (!ca) {
            close(fd);
            continue;
        }
        ca->w = w;
        ca->fd = fd;

        pthread_t tid;
        pthread_attr_t attr;
        pthread_attr_init(&attr);
        pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
        if (pthread_create(&tid, &attr, client_thread_main, ca) != 0) {
            close(fd);
            free(ca);
        }
        pthread_attr_destroy(&attr);
    }
    return NULL;
}

int ds4_wrapper_http_start(ds4_wrapper *w, const ds4_wrapper_config *cfg) {
    server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        perror("ds4-wrapper socket creation failed");
        return -1;
    }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(cfg->port);
    if (inet_pton(AF_INET, cfg->host, &addr.sin_addr) <= 0) {
        fprintf(stderr, "ds4-wrapper: invalid host address: %s\n", cfg->host);
        close(server_fd);
        server_fd = -1;
        return -1;
    }

    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("ds4-wrapper bind failed");
        close(server_fd);
        server_fd = -1;
        return -1;
    }

    if (listen(server_fd, 1024) < 0) {
        perror("ds4-wrapper listen failed");
        close(server_fd);
        server_fd = -1;
        return -1;
    }

    server_running = true;
    if (pthread_create(&accept_thread, NULL, accept_thread_main, w) != 0) {
        fprintf(stderr, "ds4-wrapper: failed to create accept thread\n");
        server_running = false;
        close(server_fd);
        server_fd = -1;
        return -1;
    }

    fprintf(stderr, "ds4-wrapper: HTTP server listening on %s:%d\n", cfg->host, cfg->port);
    return 0;
}

void ds4_wrapper_http_stop(ds4_wrapper *w) {
    (void)w;
    if (!server_running) return;
    server_running = false;
    if (server_fd != -1) {
        /* shutdown to wake up accept */
        shutdown(server_fd, SHUT_RDWR);
        close(server_fd);
        server_fd = -1;
    }
    pthread_join(accept_thread, NULL);
}
````

## File: ds4_wrapper_http.h
````c
#ifndef DS4_WRAPPER_HTTP_H
#define DS4_WRAPPER_HTTP_H

#include "ds4_wrapper.h"
#include "ds4_wrapper_config.h"

int ds4_wrapper_http_start(ds4_wrapper *w, const ds4_wrapper_config *cfg);
void ds4_wrapper_http_stop(ds4_wrapper *w);

#endif
````

## File: ds4_wrapper_metrics.c
````c
#include "ds4_wrapper_metrics.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

static void *met_xrealloc(void *p, size_t n) {
    p = realloc(p, n ? n : 1);
    if (!p) { fprintf(stderr, "ds4-wrapper: out of memory\n"); abort(); }
    return p;
}

typedef struct {
    char *ptr;
    size_t len;
    size_t cap;
} met_buf;

static void met_buf_reserve(met_buf *b, size_t add) {
    size_t need = b->len + add + 1;
    if (need <= b->cap) return;
    size_t cap = b->cap ? b->cap * 2 : 256;
    while (cap < need) cap *= 2;
    b->ptr = met_xrealloc(b->ptr, cap);
    b->cap = cap;
}

static void met_buf_puts(met_buf *b, const char *s) {
    size_t n = strlen(s);
    met_buf_reserve(b, n);
    memcpy(b->ptr + b->len, s, n);
    b->len += n;
    b->ptr[b->len] = '\0';
}

static void met_buf_printf(met_buf *b, const char *fmt, ...)
    __attribute__((format(printf, 2, 3)));

static void met_buf_printf(met_buf *b, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    va_list ap2;
    va_copy(ap2, ap);
    int n = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (n < 0) { fprintf(stderr, "ds4-wrapper: vsnprintf failed\n"); abort(); }
    met_buf_reserve(b, (size_t)n);
    vsnprintf(b->ptr + b->len, b->cap - b->len, fmt, ap2);
    va_end(ap2);
    b->len += (size_t)n;
}

static void session_meta_json(met_buf *b, const char *key, const ds4_wrap_session_meta *m) {
    met_buf_printf(b,
        "\"%s\":{"
        "\"exists\":%s,"
        "\"active\":%s,"
        "\"tokens\":%d,"
        "\"frozen_kind\":\"%s\","
        "\"last_freeze_ms\":%.2f,"
        "\"last_thaw_ms\":%.2f"
        "}",
        key,
        m->exists ? "true" : "false",
        m->active ? "true" : "false",
        m->tokens,
        ds4_wrap_frozen_kind_name(m->frozen_kind),
        m->last_freeze_ms,
        m->last_thaw_ms);
}

char *ds4_wrapper_status_json(const ds4_wrapper *w) {
    met_buf b = {0};
    met_buf_puts(&b, "{");

    /* Fields required by §14.4 of the codex */
    met_buf_puts(&b,
        "\"running\":true,"
        "\"healthy\":true,"
        "\"backend\":\"wrapper\","
        "\"model_loaded\":true,");

    /* Active session summary */
    int active_tokens = w->active_session ?
        (int)ds4_session_pos(w->active_session) : 0;
    met_buf_printf(&b,
        "\"active_session\":{"
        "\"mode\":\"%s\","
        "\"tokens\":%d"
        "},",
        ds4_wrap_mode_name(w->active_mode),
        active_tokens);

    met_buf_printf(&b,
        "\"active_mode\":\"%s\","
        "\"state\":\"%s\","
        "\"busy\":%s,"
        "\"configured_ctx_size\":%d,"
        "\"configured_tokens\":%d,",
        ds4_wrap_mode_name(w->active_mode),
        ds4_wrap_state_name(w->state),
        w->busy ? "true" : "false",
        w->configured_ctx_size,
        w->configured_tokens);

    met_buf_puts(&b, "\"sessions\":{");
    session_meta_json(&b, "server", &w->server_meta);
    met_buf_puts(&b, ",");
    session_meta_json(&b, "agent", &w->agent_meta);
    met_buf_puts(&b, "},");

    met_buf_printf(&b,
        "\"metrics\":{"
        "\"total_requests\":%llu,"
        "\"rejected_busy\":%llu,"
        "\"rejected_wrong_mode\":%llu,"
        "\"switch_count\":%llu,"
        "\"freeze_count\":%llu,"
        "\"thaw_count\":%llu,"
        "\"last_freeze_ms\":%.2f,"
        "\"last_thaw_ms\":%.2f,"
        "\"last_switch_ms\":%.2f"
        "}",
        (unsigned long long)w->total_requests,
        (unsigned long long)w->rejected_busy,
        (unsigned long long)w->rejected_wrong_mode,
        (unsigned long long)w->switch_count,
        (unsigned long long)w->freeze_count,
        (unsigned long long)w->thaw_count,
        w->last_freeze_ms,
        w->last_thaw_ms,
        w->last_switch_ms);

    if (w->last_error[0]) {
        met_buf_puts(&b, ",\"last_error\":\"");
        /* Simple escape for the error string */
        for (const char *p = w->last_error; *p; p++) {
            if (*p == '"') met_buf_puts(&b, "\\\"");
            else if (*p == '\\') met_buf_puts(&b, "\\\\");
            else if (*p == '\n') met_buf_puts(&b, "\\n");
            else { char c[2] = {*p, 0}; met_buf_puts(&b, c); }
        }
        met_buf_puts(&b, "\"");
    }

    met_buf_puts(&b, "}\n");
    return b.ptr;
}
````

## File: ds4_wrapper_metrics.h
````c
#ifndef DS4_WRAPPER_METRICS_H
#define DS4_WRAPPER_METRICS_H

#include "ds4_wrapper.h"

#include <stddef.h>

/* Write a JSON status blob into buf (caller must free).
 * Returns the allocated string or NULL on failure. */
char *ds4_wrapper_status_json(const ds4_wrapper *w);

#endif
````

## File: ds4_wrapper_state.c
````c
#include "ds4_wrapper_state.h"
#include "ds4_agent_session_store.h"
#include "ds4_agent_runtime.h"

#include <stdio.h>
#include <string.h>
#include <time.h>

/* Defined in ds4_wrapper.c */
extern double now_ms(void);

int ds4_wrapper_init(ds4_wrapper *w, ds4_engine *engine, const ds4_wrapper_config *cfg) {
    memset(w, 0, sizeof(*w));
    w->engine = engine;
    w->configured_ctx_size = cfg->ctx_size;
    w->configured_tokens = cfg->default_tokens;
    w->active_mode = cfg->startup_mode;
    w->state = DS4_WRAP_STATE_STARTING;
    w->prefer_ram_freeze = (cfg->ram_freeze_max_mb > 0);
    w->ram_freeze_max_bytes = cfg->ram_freeze_max_mb * 1024ULL * 1024ULL;

    w->agent_system_prompt = cfg->agent_system_prompt;
    w->agent_n_predict = cfg->default_tokens;
    w->agent_allow_browser = cfg->allow_browser;

    pthread_mutex_init(&w->mu, NULL);
    pthread_cond_init(&w->cv, NULL);

    return 0;
}

void ds4_wrapper_close(ds4_wrapper *w) {
    if (w->active_session) {
        ds4_session_free(w->active_session);
        w->active_session = NULL;
    }
    ds4_session_snapshot_free(&w->server_meta.ram);
    ds4_session_snapshot_free(&w->agent_meta.ram);
    pthread_cond_destroy(&w->cv);
    pthread_mutex_destroy(&w->mu);
}

int ds4_wrapper_startup_session(ds4_wrapper *w, ds4_wrap_mode mode, char *err, size_t err_len) {
    ds4_session *session = NULL;
    if (ds4_session_create(&session, w->engine, w->configured_ctx_size) != 0) {
        snprintf(err, err_len, "failed to create ds4_session for %s mode",
                 ds4_wrap_mode_name(mode));
        return -1;
    }
    w->active_session = session;
    w->active_mode = mode;

    ds4_wrap_session_meta *m =
        (mode == DS4_WRAP_MODE_SERVER) ? &w->server_meta : &w->agent_meta;
    m->active = true;
    m->exists = true;
    m->tokens = 0;

    w->state = DS4_WRAP_STATE_READY;

    fprintf(stderr, "ds4-wrapper: %s session created (ctx=%d)\n",
            ds4_wrap_mode_name(mode), w->configured_ctx_size);
    return 0;
}

int ds4_wrapper_enter_request(ds4_wrapper *w, ds4_wrap_mode required, char *err, size_t err_len) {
    pthread_mutex_lock(&w->mu);

    if (w->state == DS4_WRAP_STATE_SWITCHING) {
        snprintf(err, err_len, "wrapper is switching mode");
        pthread_mutex_unlock(&w->mu);
        return 409;
    }

    if (w->active_mode != required) {
        w->rejected_wrong_mode++;
        snprintf(err, err_len, "wrong mode: active=%s required=%s",
                 ds4_wrap_mode_name(w->active_mode),
                 ds4_wrap_mode_name(required));
        pthread_mutex_unlock(&w->mu);
        return 409;
    }

    if (w->busy) {
        w->rejected_busy++;
        snprintf(err, err_len, "wrapper is busy");
        pthread_mutex_unlock(&w->mu);
        return 409;
    }

    if (!w->active_session) {
        snprintf(err, err_len, "no active session (frozen or not loaded)");
        pthread_mutex_unlock(&w->mu);
        return 503;
    }

    w->busy = true;
    w->state = DS4_WRAP_STATE_BUSY;
    w->total_requests++;

    pthread_mutex_unlock(&w->mu);
    return 0;
}

void ds4_wrapper_leave_request(ds4_wrapper *w) {
    pthread_mutex_lock(&w->mu);
    w->busy = false;
    if (w->state != DS4_WRAP_STATE_ERROR && w->state != DS4_WRAP_STATE_STOPPING) {
        w->state = DS4_WRAP_STATE_READY;
    }
    pthread_cond_broadcast(&w->cv);
    pthread_mutex_unlock(&w->mu);
}

int ds4_wrapper_freeze_active_session(ds4_wrapper *w, char *err, size_t err_len) {
    if (!w->active_session) return 0;

    ds4_wrap_session_meta *m =
        (w->active_mode == DS4_WRAP_MODE_SERVER) ? &w->server_meta : &w->agent_meta;

    const ds4_tokens *tokens = ds4_session_tokens(w->active_session);

    if (!tokens || tokens->len == 0) {
        ds4_session_free(w->active_session);
        w->active_session = NULL;
        m->exists = false;
        m->frozen_kind = DS4_WRAP_FROZEN_NONE;
        m->tokens = 0;
        return 0;
    }

    double t0 = now_ms();
    uint64_t payload_bytes = ds4_session_payload_bytes(w->active_session);
    bool use_ram = w->prefer_ram_freeze &&
                   payload_bytes > 0 &&
                   payload_bytes <= w->ram_freeze_max_bytes;

    if (use_ram) {
        if (!ds4_sess_store_ram(w->active_session, &m->ram, err, err_len)) return -1;
        m->frozen_kind = DS4_WRAP_FROZEN_RAM;
    } else {
        if (!ds4_sess_store_disk(w->engine, w->active_session, tokens,
                                 m->disk_path, m->title, 0,
                                 err, err_len)) return -1;
        m->frozen_kind = DS4_WRAP_FROZEN_DISK;
    }

    m->exists = true;
    m->active = false;
    m->tokens = tokens->len;
    m->last_freeze_ms = now_ms() - t0;

    w->last_freeze_ms = m->last_freeze_ms;
    w->freeze_count++;

    ds4_session_free(w->active_session);
    w->active_session = NULL;

    return 0;
}

int ds4_wrapper_thaw_session(ds4_wrapper *w, ds4_wrap_mode target, char *err, size_t err_len) {
    ds4_wrap_session_meta *m =
        (target == DS4_WRAP_MODE_SERVER) ? &w->server_meta : &w->agent_meta;

    double t0 = now_ms();

    ds4_session *session = NULL;
    if (ds4_session_create(&session, w->engine, w->configured_ctx_size) != 0) {
        snprintf(err, err_len, "failed to create ds4_session");
        return -1;
    }

    if (!m->exists || m->frozen_kind == DS4_WRAP_FROZEN_NONE) {
        w->active_session = session;
        m->last_thaw_ms = now_ms() - t0;
        w->last_thaw_ms = m->last_thaw_ms;
        w->thaw_count++;
        return 0;
    }

    bool ok = false;

    if (m->frozen_kind == DS4_WRAP_FROZEN_RAM) {
        ok = ds4_sess_load_ram(session, &m->ram, err, err_len);
    } else if (m->frozen_kind == DS4_WRAP_FROZEN_DISK) {
        ds4_tokens toks;
        memset(&toks, 0, sizeof(toks));
        ds4_kvstore_load_result lr;
        memset(&lr, 0, sizeof(lr));

        ok = ds4_sess_load_disk(w->engine, session, m->disk_path, &toks, &lr, err, err_len);

        ds4_tokens_free(&toks);
        ds4_kvstore_load_result_free(&lr);
    } else {
        snprintf(err, err_len, "invalid frozen kind");
        ok = false;
    }

    if (!ok) {
        ds4_session_free(session);
        return -1;
    }

    w->active_session = session;
    m->active = true;
    m->last_thaw_ms = now_ms() - t0;
    w->last_thaw_ms = m->last_thaw_ms;
    w->thaw_count++;

    return 0;
}

int ds4_wrapper_switch_mode(ds4_wrapper *w, ds4_wrap_mode target, char *err, size_t err_len) {
    pthread_mutex_lock(&w->mu);

    if (w->busy) {
        /* Interrupt the running request and wait for it to finish. */
        if (w->agent_rt) ds4_agent_runtime_interrupt(w->agent_rt);
        while (w->busy)
            pthread_cond_wait(&w->cv, &w->mu);
    }

    if (w->active_mode == target) {
        pthread_mutex_unlock(&w->mu);
        return 0;
    }

    ds4_wrap_mode previous = w->active_mode;
    w->state = DS4_WRAP_STATE_SWITCHING;

    pthread_mutex_unlock(&w->mu);

    double t0 = now_ms();

    if (ds4_wrapper_freeze_active_session(w, err, err_len) != 0) {
        pthread_mutex_lock(&w->mu);
        w->state = DS4_WRAP_STATE_ERROR;
        snprintf(w->last_error, sizeof(w->last_error), "%s", err);
        pthread_mutex_unlock(&w->mu);
        return 500;
    }

    if (ds4_wrapper_thaw_session(w, target, err, err_len) != 0) {
        pthread_mutex_lock(&w->mu);
        w->state = DS4_WRAP_STATE_ERROR;
        snprintf(w->last_error, sizeof(w->last_error), "%s", err);
        pthread_mutex_unlock(&w->mu);
        return 500;
    }

    pthread_mutex_lock(&w->mu);

    w->active_mode = target;
    w->server_meta.active = (target == DS4_WRAP_MODE_SERVER);
    w->agent_meta.active = (target == DS4_WRAP_MODE_AGENT);
    w->state = DS4_WRAP_STATE_READY;
    w->switch_count++;
    w->last_switch_ms = now_ms() - t0;

    pthread_cond_broadcast(&w->cv);
    pthread_mutex_unlock(&w->mu);

    fprintf(stderr, "ds4-wrapper: switched %s -> %s in %.2f ms\n",
            ds4_wrap_mode_name(previous), ds4_wrap_mode_name(target), w->last_switch_ms);

    return 0;
}
````

## File: ds4_wrapper_state.h
````c
#ifndef DS4_WRAPPER_STATE_H
#define DS4_WRAPPER_STATE_H

#include "ds4_wrapper.h"
#include "ds4_wrapper_config.h"

#include <stddef.h>

int ds4_wrapper_init(ds4_wrapper *w, ds4_engine *engine, const ds4_wrapper_config *cfg);
void ds4_wrapper_close(ds4_wrapper *w);

int ds4_wrapper_startup_session(ds4_wrapper *w, ds4_wrap_mode mode, char *err, size_t err_len);

int ds4_wrapper_enter_request(ds4_wrapper *w, ds4_wrap_mode required, char *err, size_t err_len);
void ds4_wrapper_leave_request(ds4_wrapper *w);

int ds4_wrapper_switch_mode(ds4_wrapper *w, ds4_wrap_mode target, char *err, size_t err_len);

int ds4_wrapper_freeze_active_session(ds4_wrapper *w, char *err, size_t err_len);
int ds4_wrapper_thaw_session(ds4_wrapper *w, ds4_wrap_mode target, char *err, size_t err_len);

#endif
````

## File: ds4_wrapper.c
````c
#include "ds4_wrapper.h"
#include "ds4_wrapper_config.h"
#include "ds4_wrapper_state.h"
#include "ds4_wrapper_http.h"
#include "ds4_server_runtime.h"
#include "ds4_agent_runtime.h"

#include <time.h>
#include <signal.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>

const char *ds4_wrap_mode_name(ds4_wrap_mode mode) {
    switch (mode) {
    case DS4_WRAP_MODE_SERVER: return "server";
    case DS4_WRAP_MODE_AGENT:  return "agent";
    default: return "unknown";
    }
}

const char *ds4_wrap_state_name(ds4_wrap_state state) {
    switch (state) {
    case DS4_WRAP_STATE_STARTING:  return "starting";
    case DS4_WRAP_STATE_READY:     return "ready";
    case DS4_WRAP_STATE_BUSY:      return "busy";
    case DS4_WRAP_STATE_SWITCHING: return "switching";
    case DS4_WRAP_STATE_ERROR:     return "error";
    case DS4_WRAP_STATE_STOPPING:  return "stopping";
    default: return "unknown";
    }
}

const char *ds4_wrap_frozen_kind_name(ds4_wrap_frozen_kind kind) {
    switch (kind) {
    case DS4_WRAP_FROZEN_NONE: return "none";
    case DS4_WRAP_FROZEN_RAM:  return "ram";
    case DS4_WRAP_FROZEN_DISK: return "disk";
    default: return "unknown";
    }
}

double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec * 1e-6;
}

static volatile sig_atomic_t g_stop_requested = 0;

static void stop_signal_handler(int sig) {
    (void)sig;
    g_stop_requested = 1;
}

int main(int argc, char **argv) {
    /* Setup signal handlers */
    signal(SIGPIPE, SIG_IGN);
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = stop_signal_handler;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    /* Parse configuration */
    ds4_wrapper_config cfg = ds4_wrapper_parse_options(argc, argv);

    /* Open engine (once) */
    ds4_engine *engine = NULL;
    if (ds4_engine_open(&engine, &cfg.engine) != 0) {
        fprintf(stderr, "ds4-wrapper: failed to open engine\n");
        return 1;
    }

    /* Initialize wrapper context */
    ds4_wrapper w;
    if (ds4_wrapper_init(&w, engine, &cfg) != 0) {
        fprintf(stderr, "ds4-wrapper: failed to initialize wrapper state\n");
        ds4_engine_close(engine);
        return 1;
    }

    /* Initialize server runtime */
    ds4_server_runtime_options srv_opt;
    memset(&srv_opt, 0, sizeof(srv_opt));
    srv_opt.default_tokens = cfg.default_tokens;
    srv_opt.enable_cors = true;
    srv_opt.disable_exact_dsml_tool_replay = false;
    srv_opt.tool_memory_max_ids = cfg.tool_memory_max_ids;
    srv_opt.kv_disk_dir = cfg.kv_disk_dir;
    srv_opt.kv_disk_space_mb = cfg.kv_disk_space_mb;
    srv_opt.kv_reject_different_quant = cfg.kv_reject_different_quant;
    srv_opt.kv_options = cfg.kv_options;

    if (ds4_server_runtime_init(&w.server_rt, &w, &srv_opt) != 0) {
        fprintf(stderr, "ds4-wrapper: failed to initialize server runtime\n");
        ds4_wrapper_close(&w);
        ds4_engine_close(engine);
        return 1;
    }

    /* Startup initial session based on startup mode */
    char err[256];
    if (ds4_wrapper_startup_session(&w, cfg.startup_mode, err, sizeof(err)) != 0) {
        fprintf(stderr, "ds4-wrapper: session startup failed: %s\n", err);
        ds4_server_runtime_free(w.server_rt);
        ds4_wrapper_close(&w);
        ds4_engine_close(engine);
        return 1;
    }

    /* Agent runtime is lazily initialized on first agent request to avoid
     * slow system-prompt processing at startup on large models. */

    /* Start HTTP server */
    if (ds4_wrapper_http_start(&w, &cfg) != 0) {
        fprintf(stderr, "ds4-wrapper: failed to start HTTP server\n");
        ds4_server_runtime_free(w.server_rt);
        ds4_wrapper_close(&w);
        ds4_engine_close(engine);
        return 1;
    }

    /* Main wait loop */
    while (!g_stop_requested) {
        sleep(1);
    }

    fprintf(stderr, "ds4-wrapper: shutting down...\n");

    /* Cleanup and exit */
    ds4_wrapper_http_stop(&w);
    ds4_agent_runtime_free(w.agent_rt);
    ds4_server_runtime_free(w.server_rt);
    ds4_wrapper_close(&w);
    ds4_engine_close(engine);

    return 0;
}

int ds4_wrapper_ensure_agent_rt(ds4_wrapper *w, char *err, size_t err_len) {
    if (w->agent_rt) return 0;

    ds4_agent_runtime_options opt;
    memset(&opt, 0, sizeof(opt));
    opt.system_prompt = w->agent_system_prompt;
    opt.n_predict = w->agent_n_predict;

    if (ds4_agent_runtime_init(&w->agent_rt, w, &opt) != 0) {
        snprintf(err, err_len, "failed to initialize agent runtime");
        return -1;
    }
    return 0;
}
````

## File: ds4_wrapper.h
````c
#ifndef DS4_WRAPPER_H
#define DS4_WRAPPER_H

#include "ds4.h"
#include "ds4_kvstore.h"

#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>

#define DS4_WRAP_PATH_MAX 512
#define DS4_WRAP_TITLE_MAX 128
#define DS4_WRAP_ERROR_MAX 256

typedef enum {
    DS4_WRAP_MODE_SERVER = 0,
    DS4_WRAP_MODE_AGENT  = 1
} ds4_wrap_mode;

typedef enum {
    DS4_WRAP_STATE_STARTING = 0,
    DS4_WRAP_STATE_READY,
    DS4_WRAP_STATE_BUSY,
    DS4_WRAP_STATE_SWITCHING,
    DS4_WRAP_STATE_ERROR,
    DS4_WRAP_STATE_STOPPING
} ds4_wrap_state;

typedef enum {
    DS4_WRAP_FROZEN_NONE = 0,
    DS4_WRAP_FROZEN_RAM,
    DS4_WRAP_FROZEN_DISK
} ds4_wrap_frozen_kind;

typedef struct {
    char id[32];
    char title[DS4_WRAP_TITLE_MAX];
    char disk_path[DS4_WRAP_PATH_MAX];

    ds4_session_snapshot ram;
    ds4_wrap_frozen_kind frozen_kind;

    bool exists;
    bool active;
    int tokens;

    double last_freeze_ms;
    double last_thaw_ms;
} ds4_wrap_session_meta;

typedef struct {
    ds4_engine *engine;
    ds4_session *active_session;

    int configured_ctx_size;
    int configured_tokens;

    ds4_wrap_mode active_mode;
    ds4_wrap_state state;

    pthread_mutex_t mu;
    pthread_cond_t cv;

    bool busy;
    bool stop_requested;

    ds4_kvstore kv;

    bool prefer_ram_freeze;
    uint64_t ram_freeze_max_bytes;

    ds4_wrap_session_meta server_meta;
    ds4_wrap_session_meta agent_meta;

    uint64_t total_requests;
    uint64_t rejected_busy;
    uint64_t rejected_wrong_mode;
    uint64_t switch_count;
    uint64_t freeze_count;
    uint64_t thaw_count;

    double last_freeze_ms;
    double last_thaw_ms;
    double last_switch_ms;

    struct ds4_server_runtime *server_rt;
    struct ds4_agent_runtime *agent_rt;

    /* Agent config stored for lazy runtime init */
    const char *agent_system_prompt;
    int agent_n_predict;
    bool agent_allow_browser;

    char last_error[DS4_WRAP_ERROR_MAX];
} ds4_wrapper;

const char *ds4_wrap_mode_name(ds4_wrap_mode mode);
const char *ds4_wrap_state_name(ds4_wrap_state state);
const char *ds4_wrap_frozen_kind_name(ds4_wrap_frozen_kind kind);

int ds4_wrapper_ensure_agent_rt(ds4_wrapper *w, char *err, size_t err_len);

#endif
````
