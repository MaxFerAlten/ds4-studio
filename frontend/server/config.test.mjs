import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "./defaultConfig.mjs";
import { CONFIG_PATH, buildDs4Args, loadConfig, mergeConfig, saveConfig, validateConfig } from "./config.mjs";

test("default config path is anchored at the frontend package root", () => {
  const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(CONFIG_PATH, path.join(frontendRoot, "ds4-ui.config.json"));
});

test("mergeConfig keeps defaults for missing fields", () => {
  const merged = mergeConfig({ server: { port: 9001, backend: "cpu" } });
  assert.equal(merged.control.host, DEFAULT_CONFIG.control.host);
  assert.equal(merged.server.port, 9001);
  assert.equal(merged.server.backend, "cpu");
  assert.equal(merged.server.model, DEFAULT_CONFIG.server.model);
  assert.deepEqual(merged.history, DEFAULT_CONFIG.history);
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
    "toolMemoryMaxIds"
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
    const loaded = await loadConfig(configPath);

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
      toolMemoryMaxIds: 5000
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
