// The boot composition of index.mjs, exercised without booting the server.
//
// index.mjs starts vite and the process manager on import, so the invariants it
// has to hold — persistable config vs resolved runtime config, the semantic
// bridge to the C backend, the late-bound Sage registry — are asserted here
// against the same modules index.mjs composes.

import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeConfig, mergeRequestOverConfig, validateConfig } from "./config.mjs";
import { readContextConfig } from "./contextConfig.mjs";
import { resolveLeanConfig } from "./lean/leanConfig.mjs";
import { resolveSageConfig } from "./sageConfig.mjs";
import { buildDs4SemanticEnv } from "./semanticConfig.mjs";
import { SageRunRegistry } from "./sageRunRegistry.mjs";
import { DEFAULT_CONTEXT_LIMITS } from "./contextConfig.mjs";

/** The same composition index.mjs performs right after loadConfig(). */
function bootRuntimeConfig(env, config) {
  const leanResolution = resolveLeanConfig(env, {
    fileConfig: config.lean,
    runtimeRoot: "/tmp/lean-runtime",
    runsRoot: "/tmp/lean-runs"
  });
  const sageResolution = resolveSageConfig(env, config.sage);
  return Object.freeze({
    lean: {
      ...leanResolution.config,
      requested: leanResolution.requested,
      sources: leanResolution.sources
    },
    sage: sageResolution.config,
    contextWiki: readContextConfig(env, config.contextWiki)
  });
}

test("the persistable config never picks up Lean runtime fields", () => {
  const config = mergeConfig({ lean: { enabled: true } });
  const runtimeConfig = bootRuntimeConfig({}, config);
  // The resolution carries them...
  assert.ok(runtimeConfig.lean.requested);
  assert.ok(runtimeConfig.lean.sources);
  assert.ok(runtimeConfig.lean.runtimeRoot);
  // ...and the object that goes to disk does not.
  for (const key of ["requested", "sources", "runtimeRoot", "runsRoot", "sandboxRequired"]) {
    assert.equal(key in config.lean, false, `config.lean must not carry ${key}`);
  }
  assert.equal(validateConfig(config).ok, true);
});

test("the Sage registry is built with the budget from the JSON file", () => {
  const config = mergeConfig({ sage: { orchestration: { maxRepairAttempts: 7 } } });
  const runtimeConfig = bootRuntimeConfig({}, config);
  const registry = new SageRunRegistry({ config: runtimeConfig.sage.orchestration });
  assert.equal(registry.config.maxRepairAttempts, 7);
  assert.equal(registry.config.sources.maxRepairAttempts, "file");
});

test("a shell override beats the JSON file for Sage", () => {
  const config = mergeConfig({
    sage: { policyAuto: true, orchestration: { enabled: true, maxRepairAttempts: 7 } }
  });
  const runtimeConfig = bootRuntimeConfig(
    { DS4_SAGE_POLICY_AUTO: "0", DS4_SAGE_AUTONOMOUS_ORCHESTRATION: "0", DS4_SAGE_MAX_REPAIR_ATTEMPTS: "2" },
    config
  );
  assert.equal(runtimeConfig.sage.policyAuto, false);
  assert.equal(runtimeConfig.sage.orchestration.enabled, false);
  assert.equal(runtimeConfig.sage.orchestration.maxRepairAttempts, 2);
});

test("the C backend receives the six resolved semantic keys", () => {
  const config = mergeConfig({
    lean: { policyAuto: false, orchestration: { prompt: true } },
    sage: { policyAuto: false, orchestration: { prompt: true } },
    server: { env: { DS4_SKILL_AUTO: "1" } }
  });
  const runtimeConfig = bootRuntimeConfig({}, config);
  const semanticEnv = buildDs4SemanticEnv(runtimeConfig);
  const childEnv = { ...config.server.env, ...semanticEnv };
  assert.equal(childEnv.DS4_LEAN_POLICY_AUTO, "0");
  assert.equal(childEnv.DS4_SAGE_POLICY_AUTO, "0");
  assert.equal(childEnv.DS4_LEAN_AUTONOMOUS_ORCHESTRATION, "1");
  assert.equal(childEnv.DS4_LEAN_AUTONOMOUS_PROMPT, "1");
  assert.equal(childEnv.DS4_SAGE_AUTONOMOUS_ORCHESTRATION, "1");
  assert.equal(childEnv.DS4_SAGE_AUTONOMOUS_PROMPT, "1");
  // GPU/skill tuning still travels through server.env untouched.
  assert.equal(childEnv.DS4_SKILL_AUTO, "1");
});

test("semanticEnv wins over a legacy key that survived in server.env", () => {
  // An unparseable legacy value is deliberately left in server.env for
  // validateConfig to reject; it must still never reach the child as truth.
  const config = mergeConfig({ lean: { orchestration: { enabled: true } } });
  const withLegacy = {
    ...config,
    server: { ...config.server, env: { ...config.server.env, DS4_LEAN_AUTONOMOUS_ORCHESTRATION: "0" } }
  };
  const semanticEnv = buildDs4SemanticEnv(bootRuntimeConfig({}, config));
  const childEnv = { ...withLegacy.server.env, ...semanticEnv };
  assert.equal(childEnv.DS4_LEAN_AUTONOMOUS_ORCHESTRATION, "1");
});

test("a partial API update does not drop sibling fields", () => {
  const config = mergeConfig({
    server: { env: { DS4_SKILL_AUTO: "1" } },
    contextWiki: { enabled: true, maxEvidence: 4 },
    lean: { enabled: true, orchestration: { maxAttempts: 8 } },
    sage: { policyAuto: false, orchestration: { maxRepairAttempts: 7 } }
  });
  const next = mergeRequestOverConfig(config, {
    lean: { orchestration: { prompt: true } },
    contextWiki: { previewOnly: false },
    server: { env: { DS4_CUDA_MOE_TILE4: "1" } }
  });
  assert.equal(next.lean.orchestration.prompt, true);
  assert.equal(next.lean.orchestration.maxAttempts, 8);
  assert.equal(next.lean.enabled, true);
  assert.equal(next.contextWiki.previewOnly, false);
  assert.equal(next.contextWiki.enabled, true);
  assert.equal(next.contextWiki.maxEvidence, 4);
  assert.equal(next.sage.policyAuto, false);
  assert.equal(next.sage.orchestration.maxRepairAttempts, 7);
  assert.equal(next.server.env.DS4_SKILL_AUTO, "1");
  assert.equal(next.server.env.DS4_CUDA_MOE_TILE4, "1");
  assert.equal(validateConfig(next).ok, true);
});

test("saving a new value does not change the already resolved runtime", () => {
  const config = mergeConfig({ lean: { orchestration: { prompt: false } } });
  const runtimeConfig = bootRuntimeConfig({}, config);
  assert.equal(runtimeConfig.lean.orchestration.prompt, false);
  const next = mergeRequestOverConfig(config, { lean: { orchestration: { prompt: true } } });
  assert.equal(next.lean.orchestration.prompt, true);
  // Boot-resolved: the new value only applies to the next server start.
  assert.equal(runtimeConfig.lean.orchestration.prompt, false);
  assert.throws(() => {
    runtimeConfig.lean = {};
  }, TypeError);
});

test("ContextWiki resolves all nine fields from the file layer", () => {
  const config = mergeConfig({
    contextWiki: { enabled: true, softTokens: 900, hardTokens: 2000, maxEvidence: 4 }
  });
  const runtimeConfig = bootRuntimeConfig({}, config);
  assert.deepEqual(Object.keys(runtimeConfig.contextWiki).sort(), Object.keys(DEFAULT_CONTEXT_LIMITS).sort());
  assert.equal(runtimeConfig.contextWiki.enabled, true);
  assert.equal(runtimeConfig.contextWiki.softTokens, 900);
  assert.equal(runtimeConfig.contextWiki.hardTokens, 2000);
  assert.equal(runtimeConfig.contextWiki.maxEvidence, 4);
  assert.equal(runtimeConfig.contextWiki.maxLedgerEvents, DEFAULT_CONTEXT_LIMITS.maxLedgerEvents);
  // A shell override still wins over the file.
  const overridden = bootRuntimeConfig({ DS4_CONTEXT_WIKI_ENABLED: "0" }, config);
  assert.equal(overridden.contextWiki.enabled, false);
});
