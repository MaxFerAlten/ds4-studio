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
