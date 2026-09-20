import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "./defaultConfig.mjs";
import {
  CONFIG_PATH,
  DEEP_RESEARCH_CONFIG_PATH,
  buildDs4Args,
  loadConfig,
  mergeConfig,
  mergeRequestOverConfig,
  redactConfigSecrets,
  saveConfig,
  validateConfig
} from "./config.mjs";

test("default config path is anchored at the frontend package root", () => {
  const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(CONFIG_PATH, path.join(frontendRoot, "ds4-ui.config.json"));
});

test("default deep research config path is anchored at the project root", () => {
  const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(DEEP_RESEARCH_CONFIG_PATH, path.resolve(frontendRoot, "..", "config-deepresearch.json"));
});

test("mergeConfig keeps defaults for missing fields", () => {
  const merged = mergeConfig({ server: { port: 9001, backend: "cpu" } });
  assert.equal(merged.control.host, DEFAULT_CONFIG.control.host);
  assert.equal(merged.server.port, 9001);
  assert.equal(merged.server.backend, "cpu");
  assert.equal(merged.server.model, DEFAULT_CONFIG.server.model);
  assert.deepEqual(merged.history, DEFAULT_CONFIG.history);
});

test("mergeConfig uses tuned CUDA env defaults for fresh starts", () => {
  const merged = mergeConfig({});
  assert.equal(merged.server.env.DS4_METAL_PREFILL_CHUNK, "8192");
  assert.equal(merged.server.env.DS4_CUDA_Q8_F16_CACHE_MB, "11264");
  assert.equal(merged.server.env.DS4_CUDA_Q8_F16_CACHE_RESERVE_MB, "512");
  assert.equal(merged.server.env.DS4_CUDA_WEIGHT_ARENA_CHUNK_MB, "1024");
  assert.equal(merged.server.env.DS4_CUDA_COPY_MODEL_CHUNKED, "1");
  assert.equal(merged.server.env.DS4_CUDA_MOE_PROFILE, "");
  assert.equal(merged.server.env.DS4_METAL_GRAPH_PREFILL_PROFILE, "");
});

test("validateConfig rejects invalid ports and context", () => {
  const bad = mergeConfig({ server: { port: 70000, ctx: 0 } });
  const result = validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.server.port, /between 1 and 65535/);
  assert.match(result.errors.server.ctx, /positive integer/);
});

test("validateConfig only allows loopback control hosts", () => {
  for (const host of ["127.0.0.1", "localhost", "::1"]) {
    const result = validateConfig(mergeConfig({ control: { host } }));
    assert.equal(result.ok, true);
  }

  for (const host of ["0.0.0.0", "192.168.1.10", "example.com"]) {
    const result = validateConfig(mergeConfig({ control: { host } }));
    assert.equal(result.ok, false);
    assert.match(result.errors.control.host, /loopback-only/);
  }
});

test("validateConfig accepts decimal integer strings only", () => {
  const positiveIntKeys = [
    "ctx",
    "tokens",
    "mtpDraft",
    "kvDiskSpaceMb",
    "kvCacheMinTokens",
    "toolMemoryMaxIds",
    "maxQueuedJobs"
  ];
  const nonNegativeIntKeys = [
    "threads",
    "kvCacheColdMaxTokens",
    "kvCacheContinuedIntervalTokens",
    "kvCacheBoundaryTrimTokens",
    "kvCacheBoundaryAlignTokens"
  ];
  const good = validateConfig(mergeConfig({
    control: { port: "05174" },
    server: {
      port: "08100",
      ...Object.fromEntries(positiveIntKeys.map((key) => [key, "08"])),
      ...Object.fromEntries(nonNegativeIntKeys.map((key) => [key, "0"]))
    }
  }));
  assert.equal(good.ok, true);

  for (const value of ["1e2", "0x10", "", null]) {
    for (const section of ["control", "server"]) {
      const bad = validateConfig(mergeConfig({ [section]: { port: value } }));
      assert.equal(bad.ok, false);
      assert.match(bad.errors[section].port, /between 1 and 65535/);
    }
    for (const key of positiveIntKeys) {
      const bad = validateConfig(mergeConfig({ server: { [key]: value } }));
      assert.equal(bad.ok, false);
      assert.match(bad.errors.server[key], /positive integer/);
    }
    for (const key of nonNegativeIntKeys) {
      const bad = validateConfig(mergeConfig({ server: { [key]: value } }));
      assert.equal(bad.ok, false);
      assert.match(bad.errors.server[key], /non-negative integer/);
    }
  }
});

test("validateConfig aligns ds4 positive and bounded number fields", () => {
  const bad = validateConfig(mergeConfig({
    server: {
      kvDiskSpaceMb: 0,
      kvCacheMinTokens: 0,
      mtpMargin: 1001,
      dirSteeringFfn: 101,
      dirSteeringAttn: -101
    }
  }));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.server.kvDiskSpaceMb, /positive integer/);
  assert.match(bad.errors.server.kvCacheMinTokens, /positive integer/);
  assert.match(bad.errors.server.mtpMargin, /between 0 and 1000/);
  assert.match(bad.errors.server.dirSteeringFfn, /between -100 and 100/);
  assert.match(bad.errors.server.dirSteeringAttn, /between -100 and 100/);

  const good = validateConfig(mergeConfig({
    server: {
      threads: "0",
      kvCacheColdMaxTokens: "0",
      kvCacheContinuedIntervalTokens: "0",
      kvCacheBoundaryTrimTokens: "0",
      kvCacheBoundaryAlignTokens: "0",
      mtpMargin: "1000",
      dirSteeringFfn: "-100",
      dirSteeringAttn: "100"
    }
  }));
  assert.equal(good.ok, true);
});

test("validateConfig rejects cache cold max below min unless disabled", () => {
  const bad = validateConfig(mergeConfig({
    server: {
      kvCacheMinTokens: 512,
      kvCacheColdMaxTokens: 511
    }
  }));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.server.kvCacheColdMaxTokens, /0 or >= kv cache min tokens/);

  const disabled = validateConfig(mergeConfig({
    server: {
      kvCacheMinTokens: 512,
      kvCacheColdMaxTokens: 0
    }
  }));
  assert.equal(disabled.ok, true);
});

test("validateConfig rejects negative and overflowing integer fields", () => {
  const negative = validateConfig(mergeConfig({
    server: {
      threads: -1,
      kvCacheColdMaxTokens: -1
    }
  }));
  assert.equal(negative.ok, false);
  assert.match(negative.errors.server.threads, /non-negative integer/);
  assert.match(negative.errors.server.kvCacheColdMaxTokens, /non-negative integer/);

  const overflow = validateConfig(mergeConfig({
    server: {
      ctx: 2147483648,
      tokens: "999999999999999999999999999999",
      threads: 2147483648
    }
  }));
  assert.equal(overflow.ok, false);
  assert.match(overflow.errors.server.ctx, /positive integer/);
  assert.match(overflow.errors.server.tokens, /positive integer/);
  assert.match(overflow.errors.server.threads, /non-negative integer/);
});

test("validateConfig accepts DS4 startup tuning env keys", () => {
  const good = validateConfig(mergeConfig({
    server: {
      env: {
        DS4_METAL_PREFILL_CHUNK: "4096",
        DS4_CUDA_Q8_F16_CACHE_MB: "512",
        DS4_CUDA_Q8_F16_CACHE_RESERVE_MB: "",
        DS4_CUDA_WEIGHT_ARENA_CHUNK_MB: "1024",
        DS4_CUDA_COPY_MODEL_CHUNKED: "1",
        DS4_CUDA_DIRECT_MODEL: "1",
        DS4_CUDA_NO_FD_CACHE: "",
        DS4_CUDA_MOE_PROFILE: "1",
        DS4_METAL_GRAPH_PREFILL_PROFILE: "1",
        DS4_CUDA_MOE_NO_DIRECT_DOWN_SUM6: "1",
        DS4_CUSTOM_EXPERIMENT_FLAG: "enabled"
      }
    }
  }));
  assert.equal(good.ok, true);

  const bad = validateConfig(mergeConfig({
    server: {
      env: {
        DS4_CUDA_Q8_F16_CACHE_MB: "512",
        LD_PRELOAD: "/tmp/not-allowed.so"
      }
    }
  }));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.server.env, /unsupported env key/);
});

test("validateConfig rejects CUDA env values outside the GPU OOM guardrail", () => {
  for (const [key, value, pattern] of [
    ["DS4_METAL_PREFILL_CHUNK", "0", /prefill chunk.*between 1 and 131072 tokens/],
    ["DS4_CUDA_Q8_F16_CACHE_MB", "12289", /Q8\/F16 cache.*0 and 12288 MiB/],
    ["DS4_CUDA_Q8_F16_CACHE_RESERVE_MB", "0", /Q8\/F16 reserve.*at least 512 MiB/],
    ["DS4_CUDA_WEIGHT_ARENA_CHUNK_MB", "128", /weight arena.*between 256 and 8192 MiB/],
    ["DS4_CUDA_COPY_MODEL_CHUNKED", "0", /DS4_CUDA_COPY_MODEL_CHUNKED.*empty or 1/],
    ["DS4_CUDA_DIRECT_MODEL", "0", /DS4_CUDA_DIRECT_MODEL.*empty or 1/],
    ["DS4_CUDA_NO_FD_CACHE", "0", /DS4_CUDA_NO_FD_CACHE.*empty or 1/],
    ["DS4_CUDA_MOE_PROFILE", "yes", /DS4_CUDA_MOE_PROFILE.*empty or 1/],
    ["DS4_METAL_GRAPH_PREFILL_PROFILE", "yes", /DS4_METAL_GRAPH_PREFILL_PROFILE.*empty or 1/]
  ]) {
    const result = validateConfig(mergeConfig({
      server: {
        backend: "cuda",
        env: {
          DS4_CUDA_Q8_F16_CACHE_MB: "11264",
          DS4_CUDA_Q8_F16_CACHE_RESERVE_MB: "512",
          DS4_CUDA_WEIGHT_ARENA_CHUNK_MB: "1024",
          DS4_CUDA_COPY_MODEL_CHUNKED: "1",
          [key]: value
        }
      }
    }));
    assert.equal(result.ok, false, `${key}=${value} should fail`);
    assert.match(result.errors.server.env, pattern);
  }
});

test("validateConfig requires a history directory when history is enabled", () => {
  const bad = validateConfig(mergeConfig({ history: { enabled: true, dir: "" } }));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.history.dir, /is required/);

  const good = validateConfig(mergeConfig({ history: { enabled: true, dir: "/tmp/ds4-history" } }));
  assert.equal(good.ok, true);
});

test("saveConfig and loadConfig round trip merged config and report validation errors", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-config-test-"));
  const configPath = path.join(tmpDir, "ds4-ui.config.json");
  try {
    const input = { server: { port: 8123, backend: "cpu" }, history: { enabled: true, dir: "/tmp/ds4-history" } };
    const expected = mergeConfig(input);
    const saved = await saveConfig(input, configPath);
    const raw = await fs.readFile(configPath, "utf8");
    const loaded = await loadConfig(configPath, path.join(tmpDir, "missing-deep-research.json"));

    assert.deepEqual(saved, expected);
    assert.equal(raw, `${JSON.stringify(expected, null, 2)}\n`);
    assert.deepEqual(loaded, expected);

    await assert.rejects(
      saveConfig({ server: { ctx: "1e2" } }, configPath),
      (err) => {
        assert.equal(err.message, "invalid config");
        assert.match(err.validation.errors.server.ctx, /positive integer/);
        return true;
      }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("loadConfig merges external deep research config before UI research overrides", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-deep-config-test-"));
  const configPath = path.join(tmpDir, "ds4-ui.config.json");
  const deepResearchPath = path.join(tmpDir, "config-deepresearch.json");
  try {
    await fs.writeFile(
      deepResearchPath,
      `${JSON.stringify({
        search: {
          enabled: true,
          maxSourcesTotal: 44,
          providers: {
            tavily: {
              enabled: true,
              endpoint: "https://api.tavily.test/search",
              apiKey: "TAVILY_FROM_FILE",
              apiKeyEnv: "TAVILY_API_KEY"
            }
          }
        }
      }, null, 2)}\n`
    );
    await fs.writeFile(
      configPath,
      `${JSON.stringify({
        research: {
          search: {
            maxSourcesTotal: 12
          }
        }
      }, null, 2)}\n`
    );

    const loaded = await loadConfig(configPath, deepResearchPath);
    assert.equal(loaded.research.search.enabled, true);
    assert.equal(loaded.research.search.maxSourcesTotal, 12);
    assert.equal(loaded.research.search.providers.tavily.apiKey, "TAVILY_FROM_FILE");
    assert.equal(loaded.research.search.providers.tavily.endpoint, "https://api.tavily.test/search");
    assert.equal(loaded.research.search.providers.arxiv.enabled, true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("loadConfig accepts a deep research config wrapped in a research object", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-deep-config-test-"));
  const configPath = path.join(tmpDir, "ds4-ui.config.json");
  const deepResearchPath = path.join(tmpDir, "config-deepresearch.json");
  try {
    await fs.writeFile(
      deepResearchPath,
      `${JSON.stringify({
        research: {
          enabled: true,
          gemini: {
            apiKey: "GEMINI_FROM_FILE"
          },
          prism: {
            cliPath: "/opt/prism/prism-pp-cli",
            cookiesEnv: "DS4_PRISM_COOKIES"
          }
        }
      }, null, 2)}\n`
    );

    const loaded = await loadConfig(configPath, deepResearchPath);
    assert.equal(loaded.research.enabled, true);
    assert.equal(loaded.research.gemini.apiKey, "GEMINI_FROM_FILE");
    assert.equal(loaded.research.gemini.apiKeyEnv, "GEMINI_API_KEY");
    assert.equal(loaded.research.prism.cliPath, "/opt/prism/prism-pp-cli");
    assert.equal(loaded.research.prism.cliPathEnv, "PRISM_CLI_PATH");
    assert.equal(loaded.research.prism.cookiesEnv, "DS4_PRISM_COOKIES");
    assert.equal(Object.hasOwn(loaded.research.prism, "apiKey"), false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("redactConfigSecrets removes direct API keys from public config payloads", () => {
  const config = mergeConfig({
    research: {
      gemini: { apiKey: "GEMINI_SECRET" },
      search: {
        providers: {
          tavily: {
            enabled: true,
            apiKey: "TAVILY_SECRET",
            apiKeyEnv: "TAVILY_API_KEY",
            endpoint: "https://api.tavily.test/search"
          }
        }
      }
    }
  });

  const publicConfig = redactConfigSecrets(config);
  assert.equal(publicConfig.research.gemini.apiKey, "");
  assert.equal(Object.hasOwn(publicConfig.research.prism, "apiKey"), false);
  assert.equal(publicConfig.research.search.providers.tavily.apiKey, "");
  assert.equal(publicConfig.research.search.providers.tavily.apiKeyEnv, "TAVILY_API_KEY");
  assert.equal(publicConfig.research.search.providers.tavily.endpoint, "https://api.tavily.test/search");
  assert.equal(config.research.gemini.apiKey, "GEMINI_SECRET");
  assert.equal(Object.hasOwn(config.research.prism, "apiKey"), false);
  assert.equal(config.research.search.providers.tavily.apiKey, "TAVILY_SECRET");
});

test("buildDs4Args emits every enabled startup flag without shell quoting", () => {
  const config = mergeConfig({
    server: {
      binary: "./ds4-server",
      model: "model.gguf",
      mtp: "mtp.gguf",
      mtpDraft: 2,
      mtpMargin: 4.5,
      ctx: 100000,
      tokens: 2048,
      threads: 8,
      backend: "cuda",
      quality: true,
      warmWeights: true,
      host: "127.0.0.1",
      port: 8100,
      trace: "/tmp/ds4-trace.txt",
      dirSteeringFile: "direction.f32",
      dirSteeringFfn: 1.25,
      dirSteeringAttn: 0.5,
      kvDiskDir: "/tmp/ds4-kv",
      kvDiskSpaceMb: 8192,
      kvCacheMinTokens: 1024,
      kvCacheColdMaxTokens: 30000,
      kvCacheContinuedIntervalTokens: 12000,
      kvCacheBoundaryTrimTokens: 16,
      kvCacheBoundaryAlignTokens: 1024,
      kvCacheRejectDifferentQuant: true,
      disableExactDsmlToolReplay: true,
      toolMemoryMaxIds: 5000,
      maxQueuedJobs: 3
    }
  });
  const { command, args } = buildDs4Args(config);
  assert.equal(command, "./ds4-server");
  assert.deepEqual(args, [
    "--model", "model.gguf",
    "--mtp", "mtp.gguf",
    "--mtp-draft", "2",
    "--mtp-margin", "4.5",
    "--ctx", "100000",
    "--tokens", "2048",
    "--threads", "8",
    "--cuda",
    "--quality",
    "--warm-weights",
    "--host", "127.0.0.1",
    "--port", "8100",
    "--max-queued-jobs", "3",
    "--trace", "/tmp/ds4-trace.txt",
    "--dir-steering-file", "direction.f32",
    "--dir-steering-ffn", "1.25",
    "--dir-steering-attn", "0.5",
    "--kv-disk-dir", "/tmp/ds4-kv",
    "--kv-disk-space-mb", "8192",
    "--kv-cache-min-tokens", "1024",
    "--kv-cache-cold-max-tokens", "30000",
    "--kv-cache-continued-interval-tokens", "12000",
    "--kv-cache-boundary-trim-tokens", "16",
    "--kv-cache-boundary-align-tokens", "1024",
    "--kv-cache-reject-different-quant",
    "--disable-exact-dsml-tool-replay",
    "--tool-memory-max-ids", "5000"
  ]);
});

test("buildDs4Args omits optional empty and zero thread fields", () => {
  const config = mergeConfig({ server: { backend: "auto", mtp: "", threads: 0, kvDiskDir: "" } });
  const { args } = buildDs4Args(config);
  assert.equal(args.includes("--mtp"), false);
  assert.equal(args.includes("--threads"), false);
  assert.equal(args.includes("--backend"), false);
  assert.equal(args.includes("--kv-disk-dir"), false);
});

test("validateConfig accepts a valid wrapper block", () => {
  const result = validateConfig(mergeConfig({ wrapper: { enabled: true } }));
  assert.equal(result.ok, true);
});

test("validateConfig rejects an invalid wrapper startupMode", () => {
  const result = validateConfig(mergeConfig({ wrapper: { startupMode: "bogus" } }));
  assert.equal(result.ok, false);
  assert.match(result.errors.wrapper.startupMode, /server.*agent/);
});

test("validateConfig rejects a negative wrapper ramFreezeMaxMb", () => {
  const result = validateConfig(mergeConfig({ wrapper: { ramFreezeMaxMb: -1 } }));
  assert.equal(result.ok, false);
  assert.match(result.errors.wrapper.ramFreezeMaxMb, /non-negative/);
});

test("validateConfig rejects an empty wrapper binary", () => {
  const result = validateConfig(mergeConfig({ wrapper: { binary: "" } }));
  assert.equal(result.ok, false);
  assert.match(result.errors.wrapper.binary, /required/);
});

test("mergeConfig fills research defaults", () => {
  const config = mergeConfig({});
  assert.equal(config.research.enabled, false);
  assert.equal(config.research.maxPlanIterations, 3);
  assert.equal(config.research.model.max_tokens, 8192);
});

test("mergeConfig fills lean defaults and merges the file layer", () => {
  const defaults = mergeConfig({});
  assert.deepEqual(defaults.lean, {
    enabled: false,
    policyAuto: true,
    defaultProfile: "core",
    orchestration: {
      enabled: true,
      prompt: false,
      maxAttempts: 6,
      maxSameFailure: 2,
      maxPrematureFinalizations: 3,
      maxWallClockMs: 360000,
    },
  });
  const merged = mergeConfig({ lean: { enabled: true } });
  assert.equal(merged.lean.enabled, true);
  assert.equal(merged.lean.policyAuto, true);
  assert.equal(merged.lean.defaultProfile, "core");
  // A file that overrides one budget key must keep the rest, or the missing
  // ones silently fall back to a different layer's defaults.
  const partial = mergeConfig({ lean: { orchestration: { maxAttempts: 8 } } });
  assert.equal(partial.lean.orchestration.maxAttempts, 8);
  assert.equal(partial.lean.orchestration.maxSameFailure, 2);
  assert.equal(partial.lean.orchestration.maxWallClockMs, 360000);
  // Non-object input must not blow up the merge.
  assert.deepEqual(mergeConfig({ lean: "x" }).lean, defaults.lean);
});

test("validateConfig accepts a valid lean block", () => {
  const result = validateConfig(mergeConfig({ lean: { enabled: true, policyAuto: false, defaultProfile: "mathlib" } }));
  assert.equal(result.ok, true);
});

test("validateConfig rejects invalid lean blocks", () => {
  const badBool = validateConfig(mergeConfig({ lean: { enabled: "yes" } }));
  assert.equal(badBool.ok, false);
  assert.match(badBool.errors.lean.enabled, /boolean/);

  const badPolicy = validateConfig(mergeConfig({ lean: { policyAuto: 1 } }));
  assert.equal(badPolicy.ok, false);
  assert.match(badPolicy.errors.lean.policyAuto, /boolean/);

  const badProfile = validateConfig(mergeConfig({ lean: { defaultProfile: "banana" } }));
  assert.equal(badProfile.ok, false);
  assert.match(badProfile.errors.lean.defaultProfile, /core.*mathlib/);
});

test("mergeConfig keeps research overrides", () => {
  const config = mergeConfig({ research: { enabled: true } });
  assert.equal(config.research.enabled, true);
  assert.equal(config.research.autoAcceptPlan, false);
});

test("validateConfig rejects invalid research block", () => {
  const config = mergeConfig({ research: { maxPlanIterations: 99 } });
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.research.maxPlanIterations, /between 1 and 10/);
});

test("default pageAgent config is disabled", () => {
  assert.equal(DEFAULT_CONFIG.pageAgent.enabled, false);
  assert.equal(DEFAULT_CONFIG.pageAgent.clientUiEnabled, true);
  assert.equal(DEFAULT_CONFIG.pageAgent.serverBrowserEnabled, false);
  assert.equal(DEFAULT_CONFIG.pageAgent.mcpEnabled, false);
  assert.equal(DEFAULT_CONFIG.pageAgent.experimentalScriptExecutionTool, false);
  assert.equal(DEFAULT_CONFIG.pageAgent.allowExternalDomains, false);
  assert.equal(DEFAULT_CONFIG.pageAgent.requireConfirmation, true);
});

test("mergeConfig keeps pageAgent defaults", () => {
  const merged = mergeConfig({});
  assert.equal(merged.pageAgent.enabled, false);
  assert.equal(merged.pageAgent.maxSteps, 20);
  assert.equal(merged.pageAgent.actionTimeoutMs, 120000);
  assert.deepEqual(merged.pageAgent.allowedOrigins, ["http://127.0.0.1:5173", "http://localhost:5173"]);
});

test("mergeConfig merges pageAgent overrides", () => {
  const merged = mergeConfig({
    pageAgent: { enabled: true, maxSteps: 10, baseURL: "http://127.0.0.1:8081/v1" }
  });
  assert.equal(merged.pageAgent.enabled, true);
  assert.equal(merged.pageAgent.maxSteps, 10);
  assert.equal(merged.pageAgent.baseURL, "http://127.0.0.1:8081/v1");
  assert.equal(merged.pageAgent.clientUiEnabled, true); // default preserved
});

test("validateConfig accepts valid pageAgent config", () => {
  const config = mergeConfig({ pageAgent: { enabled: true } });
  const result = validateConfig(config);
  assert.equal(result.ok, true);
});

test("validateConfig rejects invalid pageAgent maxSteps", () => {
  const config = mergeConfig({ pageAgent: { maxSteps: 0 } });
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.pageAgent.maxSteps, /between 1 and 40/);
});

test("validateConfig rejects invalid pageAgent actionTimeoutMs", () => {
  const config = mergeConfig({ pageAgent: { actionTimeoutMs: 500 } });
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.pageAgent.actionTimeoutMs, /between 1000 and 600000/);
});

test("validateConfig rejects invalid pageAgent allowedOrigins", () => {
  const config = mergeConfig({ pageAgent: { allowedOrigins: "not-an-array" } });
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.pageAgent.allowedOrigins, /array of strings/);
});

test("Evolution is disabled by default and config merges bounded overrides", () => {
  const config = mergeConfig({ evolution: { enabled: true, maxLevel: "D" } });
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const relativeWorkDir = path.relative(projectRoot, path.resolve(projectRoot, config.evolution.workDir));
  assert.equal(config.evolution.enabled, true);
  assert.equal(config.evolution.maxLevel, "D");
  assert.equal(config.evolution.writeTokenEnv, "DS4_EVOLUTION_WRITE_TOKEN");
  assert.equal(relativeWorkDir === ".." || relativeWorkDir.startsWith(`..${path.sep}`), true);
  assert.equal(validateConfig(config).ok, true);
});

test("Evolution config rejects Level E without its feature gate and literal token values", () => {
  const levelE = validateConfig(mergeConfig({ evolution: { maxLevel: "E" } }));
  assert.equal(levelE.ok, false);
  assert.match(levelE.errors.evolution.maxLevel, /requires/);
  const token = validateConfig(mergeConfig({ evolution: { writeTokenEnv: "secret literal with spaces" } }));
  assert.equal(token.ok, false);
  assert.match(token.errors.evolution.writeTokenEnv, /environment variable/);
});

test("merges nested agno.agentUi defaults", () => {
  const config = mergeConfig({
    agno: {
      agentUi: {
        port: 3001
      }
    }
  });
  assert.equal(config.agno.agentUi.port, 3001);
  assert.equal(config.agno.agentUi.host, "127.0.0.1");
  assert.equal(config.agno.agentUi.enabled, true);
  assert.equal(config.agno.agentUi.autoStart, false);
  assert.equal(config.agno.agentUi.telemetry, false);
});

test("accepts custom loopback Agent UI port", () => {
  const v = validateConfig(mergeConfig({ agno: { agentUi: { port: 3001 } } }));
  assert.equal(v.ok, true);
});

test("rejects Agent UI port equal to control port", () => {
  const v = validateConfig(mergeConfig({ control: { port: 3000 }, agno: { agentUi: { port: 3000 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.agentUiPort, /control/);
});

test("rejects Agent UI port equal to AgentOS port", () => {
  const v = validateConfig(mergeConfig({ agno: { port: 7777, agentUi: { port: 7777 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.agentUiPort, /agno/);
});

test("rejects Agent UI port equal to backend port", () => {
  const v = validateConfig(mergeConfig({ server: { port: 3000 }, agno: { agentUi: { port: 3000 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.agentUiPort, /server/);
});

test("rejects Agent UI port equal to crawl port", () => {
  const v = validateConfig(mergeConfig({ crawl: { port: 3000 }, agno: { agentUi: { port: 3000 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.agentUiPort, /crawl/);
});

test("rejects 0.0.0.0 for Agent UI host", () => {
  const v = validateConfig(mergeConfig({ agno: { agentUi: { host: "0.0.0.0" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.agentUiHost, /loopback/);
});

test("rejects empty runtimeDir", () => {
  const v = validateConfig(mergeConfig({ agno: { agentUi: { runtimeDir: "" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.agentUiRuntimeDir, /non-empty/);
});

test("rejects autoStart non boolean", () => {
  const v = validateConfig(mergeConfig({ agno: { agentUi: { autoStart: "yes" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.agentUiAutoStart, /boolean/);
});

test("rejects telemetry true", () => {
  const v = validateConfig(mergeConfig({ agno: { agentUi: { telemetry: true } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.agentUiTelemetry, /false/);
});

test("rejects openMode different from new-tab", () => {
  const v = validateConfig(mergeConfig({ agno: { agentUi: { openMode: "iframe" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.agentUiOpenMode, /new-tab/);
});

test("does not mutate DEFAULT_CONFIG", () => {
  const before = JSON.stringify(DEFAULT_CONFIG.agno.agentUi);
  mergeConfig({ agno: { agentUi: { port: 9999 } } });
  assert.equal(JSON.stringify(DEFAULT_CONFIG.agno.agentUi), before);
});

test("merges default agno.tools when omitted", () => {
  const config = mergeConfig({});
  assert.deepEqual(config.agno.tools, DEFAULT_CONFIG.agno.tools);
});

test("partial agno.tools merge preserves untouched defaults", () => {
  const config = mergeConfig({ agno: { tools: { enabled: true } } });
  assert.equal(config.agno.tools.enabled, true);
  assert.equal(config.agno.tools.profile, DEFAULT_CONFIG.agno.tools.profile);
  assert.equal(config.agno.tools.maxQueued, DEFAULT_CONFIG.agno.tools.maxQueued);
  assert.equal(config.agno.tools.auditDir, DEFAULT_CONFIG.agno.tools.auditDir);
});

test("mergeConfig does not mutate DEFAULT_CONFIG.agno.tools", () => {
  const before = JSON.stringify(DEFAULT_CONFIG.agno.tools);
  mergeConfig({ agno: { tools: { enabled: true, maxQueued: 2 } } });
  assert.equal(JSON.stringify(DEFAULT_CONFIG.agno.tools), before);
});

test("accepts a fully specified valid agno.tools config", () => {
  const v = validateConfig(mergeConfig({
    agno: {
      tools: {
        enabled: true,
        profile: "safe",
        allowedTools: ["bash", "read"],
        deniedTools: ["write"],
        requestTimeoutMs: 60000,
        maxInflight: 1,
        maxQueued: 4,
        maxHistoryMessages: 32,
        maxHistoryBytes: 32768,
        maxRequestBytes: 131072,
        maxResponseBytes: 131072,
        auditEnabled: true,
        auditDir: "data/agno/tool-audit-test"
      }
    }
  }));
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors.agno, {});
});

test("rejects agno.tools.enabled non-boolean", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { enabled: "yes" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsEnabled, /boolean/);
});

test("rejects agno.tools.auditEnabled non-boolean", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { auditEnabled: "yes" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsAuditEnabled, /boolean/);
});

test("rejects an unknown agno.tools.profile", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { profile: "yolo" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsProfile, /safe or full/);
});

test("rejects a non-array allowedTools", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { allowedTools: "bash" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsAllowedTools, /array/);
});

test("rejects a non-array deniedTools", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { deniedTools: "bash" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsDeniedTools, /array/);
});

test("rejects an unknown tool name in allowedTools", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { allowedTools: ["not_a_real_tool"] } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsAllowedTools, /unknown tools/);
});

test("rejects an unknown tool name in deniedTools", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { deniedTools: ["not_a_real_tool"] } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsDeniedTools, /unknown tools/);
});

test("rejects allowedTools/deniedTools overlap", () => {
  const v = validateConfig(mergeConfig({
    agno: { tools: { allowedTools: ["bash"], deniedTools: ["bash"] } }
  }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsOverlap, /overlap/);
});

test("accepts non-overlapping allowedTools/deniedTools with known names", () => {
  const v = validateConfig(mergeConfig({
    agno: { tools: { allowedTools: ["bash"], deniedTools: ["write"] } }
  }));
  assert.equal(v.errors.agno.toolsOverlap, undefined);
  assert.equal(v.errors.agno.toolsAllowedTools, undefined);
  assert.equal(v.errors.agno.toolsDeniedTools, undefined);
});

test("rejects requestTimeoutMs that is not a positive integer", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { requestTimeoutMs: 0 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsRequestTimeoutMs, /positive integer/);
});

test("rejects maxHistoryMessages that is not a positive integer", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { maxHistoryMessages: -1 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsMaxHistoryMessages, /positive integer/);
});

test("rejects maxHistoryBytes that is not a positive integer", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { maxHistoryBytes: 0 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsMaxHistoryBytes, /positive integer/);
});

test("rejects maxInflight of 0", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { maxInflight: 0 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsMaxInflight, /positive integer/);
});

test("rejects maxInflight greater than 1 in this release", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { maxInflight: 2 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsMaxInflight, /exactly 1/);
});

test("rejects maxQueued above 32", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { maxQueued: 33 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsMaxQueued, /<= 32/);
});

test("accepts maxQueued at the 32 boundary", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { maxQueued: 32 } } }));
  assert.equal(v.errors.agno.toolsMaxQueued, undefined);
});

test("rejects maxRequestBytes above 1 MiB", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { maxRequestBytes: 1048577 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsMaxRequestBytes, /1048576/);
});

test("rejects maxResponseBytes above 1 MiB", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { maxResponseBytes: 1048577 } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsMaxResponseBytes, /1048576/);
});

test("rejects an empty auditDir", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { auditDir: "" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsAuditDir, /required/);
});

test("rejects an absolute audit path", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { auditDir: "/etc/passwd" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsAuditDir, /relative/);
});

test("rejects an audit path containing ..", () => {
  const v = validateConfig(mergeConfig({ agno: { tools: { auditDir: "data/../../etc" } } }));
  assert.equal(v.ok, false);
  assert.match(v.errors.agno.toolsAuditDir, /\.\./);
});

// --- typed Lean/Sage schema + legacy server.env migration (refactoring 000 F2) ---

test("mergeConfig migrates the six legacy server.env switches onto typed fields", () => {
  const merged = mergeConfig({
    server: {
      env: {
        DS4_LEAN_POLICY_AUTO: "0",
        DS4_SAGE_POLICY_AUTO: "0",
        DS4_LEAN_AUTONOMOUS_ORCHESTRATION: "1",
        DS4_LEAN_AUTONOMOUS_PROMPT: "1",
        DS4_SAGE_AUTONOMOUS_ORCHESTRATION: "1",
        DS4_SAGE_AUTONOMOUS_PROMPT: "1",
        DS4_SKILL_AUTO: "1"
      }
    }
  });
  assert.equal(merged.lean.policyAuto, false);
  assert.equal(merged.sage.policyAuto, false);
  assert.equal(merged.lean.orchestration.enabled, true);
  assert.equal(merged.lean.orchestration.prompt, true);
  assert.equal(merged.sage.orchestration.enabled, true);
  assert.equal(merged.sage.orchestration.prompt, true);
  // DS4_SKILL_AUTO is a child-process env, not a typed field.
  assert.equal(merged.server.env.DS4_SKILL_AUTO, "1");
  for (const key of [
    "DS4_LEAN_POLICY_AUTO",
    "DS4_SAGE_POLICY_AUTO",
    "DS4_LEAN_AUTONOMOUS_ORCHESTRATION",
    "DS4_LEAN_AUTONOMOUS_PROMPT",
    "DS4_SAGE_AUTONOMOUS_ORCHESTRATION",
    "DS4_SAGE_AUTONOMOUS_PROMPT"
  ]) {
    assert.equal(key in merged.server.env, false, `${key} must not survive the merge`);
  }
  assert.equal(validateConfig(merged).ok, true);
});

test("an explicit typed field beats the legacy server.env value", () => {
  const merged = mergeConfig({
    lean: { orchestration: { prompt: false } },
    server: { env: { DS4_LEAN_AUTONOMOUS_PROMPT: "1" } }
  });
  assert.equal(merged.lean.orchestration.prompt, false);
  assert.equal("DS4_LEAN_AUTONOMOUS_PROMPT" in merged.server.env, false);
});

test("an unparseable legacy boolean is rejected instead of defaulted", () => {
  const merged = mergeConfig({ server: { env: { DS4_SAGE_AUTONOMOUS_PROMPT: "perhaps" } } });
  assert.equal(merged.server.env.DS4_SAGE_AUTONOMOUS_PROMPT, "perhaps");
  const v = validateConfig(merged);
  assert.equal(v.ok, false);
  assert.match(v.errors.server.env, /typed Lean\/Sage fields/);
});

test("validateConfig checks the ContextWiki block", () => {
  assert.equal(validateConfig(mergeConfig({})).ok, true);
  const badBool = validateConfig(mergeConfig({ contextWiki: { telemetry: "yes" } }));
  assert.equal(badBool.ok, false);
  assert.match(badBool.errors.contextWiki.telemetry, /boolean/);
  const badInt = validateConfig(mergeConfig({ contextWiki: { maxEvidence: 0 } }));
  assert.equal(badInt.ok, false);
  assert.match(badInt.errors.contextWiki.maxEvidence, /positive integer/);
  const softOverHard = validateConfig(
    mergeConfig({ contextWiki: { softTokens: 4000, hardTokens: 3000 } })
  );
  assert.equal(softOverHard.ok, false);
  assert.match(softOverHard.errors.contextWiki.softTokens, /hardTokens/);
});

test("a partial orchestration update keeps its sibling fields", () => {
  const lean = mergeConfig({ lean: { orchestration: { prompt: true } } }).lean.orchestration;
  assert.equal(lean.prompt, true);
  assert.equal(lean.enabled, true);
  assert.equal(lean.maxAttempts, DEFAULT_CONFIG.lean.orchestration.maxAttempts);
  const sage = mergeConfig({ sage: { orchestration: { enabled: false } } }).sage.orchestration;
  assert.equal(sage.enabled, false);
  assert.equal(sage.prompt, false);
  assert.equal(sage.maxTotalToolCalls, DEFAULT_CONFIG.sage.orchestration.maxTotalToolCalls);
});

test("validateConfig rejects non-boolean semantic fields", () => {
  const badSagePolicy = validateConfig(mergeConfig({ sage: { policyAuto: "1" } }));
  assert.equal(badSagePolicy.ok, false);
  assert.match(badSagePolicy.errors.sage.policyAuto, /boolean/);
  const badLeanEnabled = validateConfig(mergeConfig({ lean: { orchestration: { enabled: "1" } } }));
  assert.equal(badLeanEnabled.ok, false);
  assert.match(badLeanEnabled.errors.lean.orchestration, /boolean/);
});

test("saving a legacy file writes the typed schema back to disk", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-semantic-test-"));
  const configPath = path.join(tmpDir, "ds4-ui.config.json");
  try {
    const saved = await saveConfig(
      { server: { env: { DS4_LEAN_AUTONOMOUS_PROMPT: "1", DS4_SKILL_AUTO: "1" } } },
      configPath
    );
    assert.equal(saved.lean.orchestration.prompt, true);
    const onDisk = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal("DS4_LEAN_AUTONOMOUS_PROMPT" in onDisk.server.env, false);
    assert.equal(onDisk.server.env.DS4_SKILL_AUTO, "1");
    assert.equal(onDisk.lean.orchestration.prompt, true);
    // Reloading the migrated file must not change it again.
    const reloaded = await loadConfig(configPath, path.join(tmpDir, "missing-deep-research.json"));
    assert.deepEqual(reloaded, saved);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("mergeConfig keeps the agent block instead of dropping it", () => {
  // Regression: mergeConfig() builds an explicit object literal, and `agent`
  // was not one of its keys, so DEFAULT_CONFIG.agent was discarded on every
  // load, save and API merge. index.mjs reads config.agent?.nativeChatTimeoutMs
  // and falls back to Infinity when it is missing, which left the native-stream
  // watchdog permanently unarmed.
  assert.deepEqual(mergeConfig({}).agent, DEFAULT_CONFIG.agent);
  assert.equal(mergeConfig({}).agent.nativeChatTimeoutMs, 180_000);
  assert.equal(
    mergeConfig({ agent: { nativeChatTimeoutMs: 900_000 } }).agent.nativeChatTimeoutMs,
    900_000
  );
  // A sibling key survives the merge, and a non-object never spreads into it.
  assert.equal(mergeConfig({ agent: { extra: 1 } }).agent.nativeChatTimeoutMs, 180_000);
  for (const bad of [null, [], "x", 7]) {
    assert.deepEqual(mergeConfig({ agent: bad }).agent, DEFAULT_CONFIG.agent);
  }
});

test("validateConfig bounds the native chat timeout", () => {
  const at = (nativeChatTimeoutMs) =>
    validateConfig(mergeConfig({ agent: { nativeChatTimeoutMs } })).errors.agent
      ?.nativeChatTimeoutMs;
  // 0 means "no deadline" to index.mjs, so it stays legal.
  assert.equal(at(0), undefined);
  assert.equal(at(1000), undefined);
  assert.equal(at(180_000), undefined);
  assert.equal(at(7_200_000), undefined);
  // Anything that would arm setTimeout with a nonsense delay is rejected.
  for (const bad of [999, 7_200_001, -1, 1.5, Number.NaN, "abc", null, undefined]) {
    assert.ok(at(bad), `expected ${String(bad)} to be rejected`);
  }
  assert.equal(validateConfig(mergeConfig({ agent: { nativeChatTimeoutMs: -1 } })).ok, false);
  assert.equal(validateConfig(mergeConfig({})).ok, true);
});

test("mergeConfig keeps agent epistemic defaults", () => {
  const ep = mergeConfig({}).agent.epistemic;
  assert.deepEqual(ep, DEFAULT_CONFIG.agent.epistemic);
  // Ships inert: the early Quantum Fix commits observe, they do not change
  // what a turn publishes.
  assert.equal(ep.enabled, false);
  assert.equal(ep.mode, "shadow");
});

test("mergeConfig preserves nested epistemic siblings", () => {
  // A UI panel that posts one epistemic field must not wipe the rest, the same
  // guarantee lean.orchestration and sage.orchestration already have.
  const merged = mergeConfig({ agent: { epistemic: { mode: "block" } } });
  assert.equal(merged.agent.epistemic.mode, "block");
  assert.equal(merged.agent.epistemic.maxClaimsPerTurn, 64);
  assert.equal(merged.agent.epistemic.blockSeverity, 4);
  assert.equal(merged.agent.nativeChatTimeoutMs, 180_000);
  for (const bad of [null, [], "x"]) {
    assert.deepEqual(
      mergeConfig({ agent: { epistemic: bad } }).agent.epistemic,
      DEFAULT_CONFIG.agent.epistemic
    );
  }
});

test("validateConfig rejects invalid epistemic mode", () => {
  const at = (mode) =>
    validateConfig(mergeConfig({ agent: { epistemic: { mode } } })).errors.agent?.[
      "epistemic.mode"
    ];
  for (const ok of ["off", "shadow", "block"]) assert.equal(at(ok), undefined);
  for (const bad of ["Block", "on", "", null, 1]) assert.ok(at(bad), `expected ${String(bad)} rejected`);
  assert.equal(validateConfig(mergeConfig({ agent: { epistemic: { mode: "nope" } } })).ok, false);
});

test("validateConfig rejects invalid blockSeverity", () => {
  const at = (blockSeverity) =>
    validateConfig(mergeConfig({ agent: { epistemic: { blockSeverity } } })).errors.agent?.[
      "epistemic.blockSeverity"
    ];
  // Both ends are meaningful: 0 blocks everything, 5 blocks only the top class.
  for (const ok of [0, 1, 4, 5]) assert.equal(at(ok), undefined);
  for (const bad of [-1, 6, 2.5, Number.NaN, "4", null]) {
    assert.ok(at(bad), `expected ${String(bad)} rejected`);
  }
});

test("mergeRequestOverConfig does not drop nativeChatTimeoutMs", () => {
  // An API save that touches only one epistemic flag used to come back with the
  // whole agent block missing, because mergeConfig rebuilt the config without
  // it and mergeRequestOverConfig had no agent case.
  const current = mergeConfig({ agent: { nativeChatTimeoutMs: 900_000 } });
  const merged = mergeRequestOverConfig(current, { agent: { epistemic: { enabled: true } } });
  assert.equal(merged.agent.nativeChatTimeoutMs, 900_000);
  assert.equal(merged.agent.epistemic.enabled, true);
  assert.equal(merged.agent.epistemic.mode, "shadow");
  assert.equal(merged.agent.epistemic.maxVerifierCallsPerTurn, 24);
  assert.equal(validateConfig(merged).ok, true);
});
