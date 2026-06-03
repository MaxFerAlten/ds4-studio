import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG, REQUEST_DEFAULTS } from "./defaultConfig.mjs";
import { validateConfig } from "./config.mjs";
import {
  buildProfileCandidate,
  listProfiles,
  mapProfileToServerConfig
} from "./profileLoader.mjs";

test("ROCm profiles use the CUDA runtime backend flag", () => {
  const profile = {
    server: {
      runtime: {
        backend: "cuda"
      }
    }
  };

  assert.equal(mapProfileToServerConfig(profile).backend, "cuda");
});

test("backend rocm remains invalid until an end-to-end alias exists", () => {
  const result = validateConfig({
    ...DEFAULT_CONFIG,
    server: {
      ...DEFAULT_CONFIG.server,
      backend: "rocm"
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.server.backend, /auto, metal, cuda, cpu/);
});

test("buildProfileCandidate leaves active state unchanged when validation fails", () => {
  const baseConfig = {
    ...DEFAULT_CONFIG,
    selectedProfile: "stable",
    server: {
      ...DEFAULT_CONFIG.server,
      backend: "cuda"
    }
  };
  const baseRequestDefaults = {
    ...REQUEST_DEFAULTS,
    max_tokens: 1234
  };
  const invalidEntry = {
    name: "invalid-rocm",
    profile: {
      server: {
        runtime: {
          backend: "rocm"
        }
      },
      request_defaults: {
        max_tokens: 9999
      }
    }
  };

  const candidate = buildProfileCandidate(invalidEntry, baseConfig, baseRequestDefaults);
  const validation = validateConfig(candidate.config);

  assert.equal(validation.ok, false);
  assert.equal(baseConfig.selectedProfile, "stable");
  assert.equal(baseConfig.server.backend, "cuda");
  assert.equal(baseRequestDefaults.max_tokens, 1234);
});

test("mapProfileToServerConfig maps DS4 CUDA env from profile", () => {
  const mapped = mapProfileToServerConfig({
    server: {
      env: {
        DS4_METAL_PREFILL_CHUNK: "2048",
        DS4_CUDA_Q8_F16_CACHE_MB: "512",
        DS4_CUDA_COPY_MODEL_CHUNKED: "1",
        DS4_CUDA_WEIGHT_ARENA_CHUNK_MB: "1024"
      }
    }
  });

  assert.equal(mapped.env.DS4_METAL_PREFILL_CHUNK, "2048");
  assert.equal(mapped.env.DS4_CUDA_Q8_F16_CACHE_MB, "512");
  assert.equal(mapped.env.DS4_CUDA_Q8_F16_CACHE_RESERVE_MB, "512");
  assert.equal(mapped.env.DS4_CUDA_WEIGHT_ARENA_CHUNK_MB, "1024");
  assert.equal(mapped.env.DS4_CUDA_COPY_MODEL_CHUNKED, "1");
  assert.equal(mapped.env.DS4_CUDA_DIRECT_MODEL, "");
  assert.equal(mapped.env.DS4_CUDA_NO_FD_CACHE, "");
  assert.equal(mapped.env.DS4_CUDA_MOE_PROFILE, "");
});

test("bundled DS4 CUDA profiles request chunked full model copy", async () => {
  const profiles = (await listProfiles()).filter((entry) => entry.name.startsWith("ds4-profile-") && !entry.error);

  assert.ok(profiles.length > 0);
  for (const entry of profiles) {
    assert.equal(entry.profile.server?.env?.DS4_CUDA_COPY_MODEL_CHUNKED, "1", entry.name);
  }
});

test("bundled DS4 CUDA profiles use the tuned Q8/F16 cache budget and reserve", async () => {
  const profiles = (await listProfiles()).filter((entry) => entry.name.startsWith("ds4-profile-") && !entry.error);

  assert.ok(profiles.length > 0);
  for (const entry of profiles) {
    assert.equal(entry.profile.server?.env?.DS4_CUDA_Q8_F16_CACHE_MB, "11264", entry.name);
    assert.equal(entry.profile.server?.env?.DS4_CUDA_Q8_F16_CACHE_RESERVE_MB, "512", entry.name);
  }
});
