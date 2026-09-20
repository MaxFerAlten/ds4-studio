// Tests for leanRuntimeState.mjs — the R5 runtime-state shape, the advertising
// predicate, and the cached userns probe. All async deps are injected so these
// stay hermetic (no bwrap, no fs access).
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  buildLeanRuntimeState,
  createLeanRuntimeStateCache,
  isLeanToolAdvertised,
  leanToolCapability,
  probeUserNamespaces,
  USERNS_PROBE_ARGS
} from "./leanRuntimeState.mjs";

const POLICY_REVISION = "a".repeat(40);

function readyPreflight({ mathlibOk = true, sandboxAvailable = true } = {}) {
  return {
    ok: true,
    enabled: true,
    sandboxAvailable,
    profiles: {
      core: { ok: true, toolchain: "leanprover/lean4:stable", reason: null },
      mathlib: mathlibOk
        ? { ok: true, toolchain: "leanprover/lean4:stable", reason: null }
        : { ok: false, toolchain: null, reason: "Missing .lake/build in …/mathlib" }
    },
    errors: [],
    warnings: []
  };
}

function leanConfig(overrides = {}) {
  return {
    enabled: true,
    requested: { enabled: true, ...overrides.requested },
    bwrapBin: "/usr/bin/bwrap",
    ...overrides
  };
}

/** Fake spawn: controllable exit code / spawn error / never-exits child. */
function fakeSpawn(exited) {
  return () => {
    const child = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      if (exited.kind === "exit") {
        child.emit("close", exited.code);
      } else if (exited.kind === "timeout") {
        child.emit("close", 9); // killed by SIGKILL
      }
    };
    if (exited.kind === "error") {
      process.nextTick(() => child.emit("error", new Error("ENOENT")));
    } else if (exited.kind === "exit" && exited.code === 0) {
      process.nextTick(() => child.emit("close", 0));
    } else if (exited.kind === "exit") {
      process.nextTick(() => child.emit("close", exited.code));
    }
    return child;
  };
}

test("disabled feature returns a closed, cheap state without touching deps", async () => {
  const config = leanConfig({ enabled: false, requested: { enabled: false } });
  let probed = false;
  const state = await buildLeanRuntimeState(config, {
    getPreflight: () => { throw new Error("must not run"); },
    getLeanPolicyState: () => { throw new Error("must not run"); },
    probeUserNamespaces: () => { probed = true; return Promise.resolve(true); }
  });

  assert.equal(state.requestedEnabled, false);
  assert.equal(state.effectiveReady, false);
  assert.deepEqual(state.sandbox, { available: false, userNamespaces: false });
  assert.equal(state.profiles.core.ready, false);
  assert.equal(state.profiles.mathlib.ready, false);
  assert.equal(state.policy.available, false);
  assert.equal(state.policy.active, null);
  assert.equal(state.policy.activeRevision, null);
  assert.ok(state.reasons.length > 0);
  assert.equal(probed, false, "disabled state must not probe user namespaces");
  assert.equal(isLeanToolAdvertised(state), false);
  assert.equal(leanToolCapability(state), "off");
});

test("fully ready state matches the R5 shape", async () => {
  const state = await buildLeanRuntimeState(leanConfig(), {
    getPreflight: async () => readyPreflight(),
    getLeanPolicyState: async () => ({ loaded: true, revision: POLICY_REVISION }),
    probeUserNamespaces: async () => true
  });

  assert.equal(state.requestedEnabled, true);
  assert.equal(state.effectiveReady, true);
  assert.deepEqual(state.sandbox, { available: true, userNamespaces: true });
  assert.deepEqual(state.profiles.core, { ready: true, toolchain: "leanprover/lean4:stable" });
  assert.deepEqual(state.profiles.mathlib, { ready: true, toolchain: "leanprover/lean4:stable" });
  assert.deepEqual(state.policy, {
    available: true,
    availableRevision: POLICY_REVISION,
    active: null,
    activeRevision: null
  });
  assert.deepEqual(state.reasons, []);
  assert.equal(isLeanToolAdvertised(state), true);
  assert.equal(leanToolCapability(state), "full");
});

test("active policy is null even when the skill is loaded (session state is not visible to Node)", async () => {
  const state = await buildLeanRuntimeState(leanConfig(), {
    getPreflight: async () => readyPreflight(),
    getLeanPolicyState: async () => ({ loaded: true, revision: POLICY_REVISION }),
    probeUserNamespaces: async () => true
  });

  assert.equal(state.policy.active, null);
  assert.equal(state.policy.activeRevision, null);
});

test("policy missing means not available but still not turned active", async () => {
  const state = await buildLeanRuntimeState(leanConfig(), {
    getPreflight: async () => readyPreflight(),
    getLeanPolicyState: async () => ({ loaded: false, revision: "" }),
    probeUserNamespaces: async () => true
  });

  assert.equal(state.policy.available, false);
  assert.equal(state.policy.availableRevision, "");
  assert.equal(state.policy.active, null);
  assert.ok(state.reasons.some((r) => r.includes("policy")));
  assert.equal(isLeanToolAdvertised(state), true, "policy availability does not gate advertising");
});

test("userns probe failing blocks advertising and readiness", async () => {
  const state = await buildLeanRuntimeState(leanConfig(), {
    getPreflight: async () => readyPreflight(),
    getLeanPolicyState: async () => ({ loaded: true, revision: POLICY_REVISION }),
    probeUserNamespaces: async () => false
  });

  assert.equal(state.sandbox.userNamespaces, false);
  assert.equal(state.effectiveReady, false);
  assert.equal(isLeanToolAdvertised(state), false);
  assert.ok(state.reasons.some((r) => r.includes("User namespaces")));
});

test("missing sandbox binaries block advertising and readiness", async () => {
  const state = await buildLeanRuntimeState(leanConfig(), {
    getPreflight: async () => readyPreflight({ sandboxAvailable: false }),
    getLeanPolicyState: async () => ({ loaded: true, revision: POLICY_REVISION }),
    probeUserNamespaces: async () => true
  });

  assert.equal(state.sandbox.available, false);
  assert.equal(state.effectiveReady, false);
  assert.equal(isLeanToolAdvertised(state), false);
});

test("core ready but mathlib not advertises the tool as core-only", async () => {
  const state = await buildLeanRuntimeState(leanConfig(), {
    getPreflight: async () => readyPreflight({ mathlibOk: false }),
    getLeanPolicyState: async () => ({ loaded: true, revision: POLICY_REVISION }),
    probeUserNamespaces: async () => true
  });

  assert.equal(state.profiles.core.ready, true);
  assert.equal(state.profiles.mathlib.ready, false);
  assert.equal(isLeanToolAdvertised(state), true);
  assert.equal(leanToolCapability(state), "core-only");
  assert.ok(state.reasons.some((r) => r.includes("mathlib")));
});

test("unprepared core profile never advertises", async () => {
  const preflight = readyPreflight();
  preflight.profiles.core = { ok: false, toolchain: null, reason: "Missing .lake/build" };
  const state = await buildLeanRuntimeState(leanConfig(), {
    getPreflight: async () => preflight,
    getLeanPolicyState: async () => ({ loaded: true, revision: POLICY_REVISION }),
    probeUserNamespaces: async () => true
  });

  assert.equal(state.profiles.core.ready, false);
  assert.equal(isLeanToolAdvertised(state), false);
  assert.equal(leanToolCapability(state), "off");
});

test("requested.enabled drives requestedEnabled when it differs from config.enabled", async () => {
  const state = await buildLeanRuntimeState(leanConfig({ enabled: true, requested: { enabled: false } }), {
    getPreflight: async () => readyPreflight(),
    getLeanPolicyState: async () => ({ loaded: true, revision: POLICY_REVISION }),
    probeUserNamespaces: async () => true
  });

  assert.equal(state.requestedEnabled, false);
  assert.equal(state.effectiveReady, false);
});

test("probeUserNamespaces resolves true on exit 0", async () => {
  const result = await probeUserNamespaces({ spawnFn: fakeSpawn({ kind: "exit", code: 0 }) });
  assert.equal(result, true);
});

test("probeUserNamespaces resolves false on nonzero exit", async () => {
  const result = await probeUserNamespaces({ spawnFn: fakeSpawn({ kind: "exit", code: 1 }) });
  assert.equal(result, false);
});

test("probeUserNamespaces resolves false on spawn error (missing binary)", async () => {
  const result = await probeUserNamespaces({ spawnFn: fakeSpawn({ kind: "error" }) });
  assert.equal(result, false);
});

test("probeUserNamespaces resolves false when the probe hangs and is killed", async () => {
  const result = await probeUserNamespaces({
    spawnFn: fakeSpawn({ kind: "timeout" }),
    timeoutMs: 20
  });
  assert.equal(result, false);
});

test("USERNS_PROBE_ARGS request --unshare-user and nothing writable", () => {
  assert.ok(USERNS_PROBE_ARGS.includes("--unshare-user"));
  assert.ok(USERNS_PROBE_ARGS.includes("--ro-bind"));
  assert.ok(!USERNS_PROBE_ARGS.includes("--bind"));
});

test("cache serves the same object within TTL and rebuilds on refresh", async () => {
  let probes = 0;
  const cache = createLeanRuntimeStateCache(
    leanConfig(),
    {
      getPreflight: async () => readyPreflight(),
      getLeanPolicyState: async () => ({ loaded: true, revision: POLICY_REVISION }),
      probeUserNamespaces: async () => { probes += 1; return true; }
    },
    { ttlMs: 60000 }
  );

  const first = await cache.get();
  const second = await cache.get();
  assert.equal(first, second, "cache must return the identical state object");
  assert.equal(probes, 1, "one probe for the first build only");

  const refreshed = await cache.refresh();
  assert.notEqual(refreshed, first, "refresh builds a new state");
  assert.equal(probes, 2);
  assert.equal(await cache.get(), refreshed);
});

test("cache coalesces concurrent get() calls into a single build", async () => {
  let builds = 0;
  const cache = createLeanRuntimeStateCache(
    leanConfig(),
    {
      getPreflight: async () => { builds += 1; return readyPreflight(); },
      getLeanPolicyState: async () => ({ loaded: true, revision: POLICY_REVISION }),
      probeUserNamespaces: async () => true
    },
    { ttlMs: 60000 }
  );

  const results = await Promise.all([cache.get(), cache.get(), cache.get()]);
  assert.equal(builds, 1);
  assert.equal(results[0], results[1]);
  assert.equal(results[1], results[2]);
});

test("cache respects TTL expiry and rebuilds on demand", async () => {
  let nowMs = 0;
  let builds = 0;
  const cache = createLeanRuntimeStateCache(
    leanConfig(),
    {
      getPreflight: async () => { builds += 1; return readyPreflight(); },
      getLeanPolicyState: async () => ({ loaded: true, revision: POLICY_REVISION }),
      probeUserNamespaces: async () => true
    },
    { ttlMs: 100, now: () => nowMs }
  );

  const first = await cache.get();
  nowMs = 50;
  assert.equal(await cache.get(), first, "within TTL");
  nowMs = 150;
  const second = await cache.get();
  assert.notEqual(second, first, "past TTL rebuilds");
  assert.equal(builds, 2);
});
