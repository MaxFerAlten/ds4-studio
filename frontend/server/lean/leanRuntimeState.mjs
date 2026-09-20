// Lean 4 runtime state — one normalized view of "is Lean actually usable".
// Composes the preflight (sandbox + profiles), the policy skill revision, and a
// user-namespace probe into the shape the R5 plan requires, so every consumer
// (capabilities, advertised tools, executor) reasons over the same booleans.

import {
  runLeanPreflight,
  probeUserNamespaces,
  USERNS_PROBE_ARGS,
  USERNS_PROBE_TIMEOUT_MS,
} from "./leanPreflight.mjs";

// Re-exported for callers/tests that historically imported them here.
export { probeUserNamespaces, USERNS_PROBE_ARGS, USERNS_PROBE_TIMEOUT_MS };

/**
 * Build the normalized Lean runtime state.
 *
 * `policy.active` is intentionally null: whether the *session* is primed with
 * the policy skill is session state that Node cannot see, so it must never be
 * turned into true here.
 *
 * @param {object} config - Resolved Lean config (index.mjs `config.lean`).
 * @param {object} [deps]
 * @param {Function} [deps.getPreflight] - () => Promise<preflight>
 * @param {Function} [deps.getLeanPolicyState] - () => Promise<{loaded, revision}>
 * @param {Function} [deps.probeUserNamespaces]
 * @returns {Promise<{
 *   requestedEnabled: boolean,
 *   effectiveReady: boolean,
 *   sandbox: { available: boolean, userNamespaces: boolean },
 *   profiles: Record<string, { ready: boolean, toolchain: string|null }>,
 *   policy: { available: boolean, availableRevision: string, active: null, activeRevision: null },
 *   reasons: string[]
 * }>}
 */
export async function buildLeanRuntimeState(config, deps = {}) {
  const requestedEnabled = Boolean(config?.requested?.enabled ?? config?.enabled ?? false);

  const disabled = {
    requestedEnabled: false,
    effectiveReady: false,
    sandbox: { available: false, userNamespaces: false },
    profiles: { core: { ready: false, toolchain: null }, mathlib: { ready: false, toolchain: null } },
    policy: { available: false, availableRevision: "", active: null, activeRevision: null },
    reasons: ["Lean is not enabled (requested.enabled=false)."]
  };

  if (!requestedEnabled) {
    return disabled;
  }

  const getPreflight = deps.getPreflight ?? (() => runLeanPreflight(config));
  const getPolicy = deps.getLeanPolicyState ?? (() => Promise.resolve({ loaded: false, revision: "" }));
  const probe = deps.probeUserNamespaces ?? probeUserNamespaces;

  const [preflight, policy, userNamespaces] = await Promise.all([
    getPreflight(),
    getPolicy(),
    probe({ bwrapBin: config?.bwrapBin })
  ]);

  const sandbox = {
    available: Boolean(preflight?.sandboxAvailable),
    userNamespaces
  };

  const profiles = {};
  for (const name of ["core", "mathlib"]) {
    const p = preflight?.profiles?.[name];
    profiles[name] = {
      ready: Boolean(p?.ok),
      toolchain: p?.toolchain ?? null
    };
  }

  const policyState = {
    available: Boolean(policy?.loaded),
    availableRevision: policy?.loaded ? policy.revision : "",
    active: null,
    activeRevision: null
  };

  const reasons = [];
  if (!preflight?.enabled) reasons.push("Lean is not enabled.");
  if (!sandbox.available) reasons.push("Sandbox tools (bwrap/prlimit) are not available.");
  if (!sandbox.userNamespaces) reasons.push("User namespaces are not available to the sandbox.");
  if (!profiles.core.ready) reasons.push("The core Lean profile is not ready.");
  if (!profiles.mathlib.ready) reasons.push("The mathlib Lean profile is not ready.");
  if (!policyState.available) reasons.push("The Lean policy skill is not available.");

  return {
    requestedEnabled: true,
    effectiveReady: sandbox.available && sandbox.userNamespaces && profiles.core.ready,
    sandbox,
    profiles,
    policy: policyState,
    reasons
  };
}

/**
 * The advertising predicate from the R5 plan:
 *
 *   requestedEnabled && sandbox ready && core ready
 *
 * The sandbox is ready only when both bwrap is present and user namespaces
 * actually work. Mathlib readiness is advertised separately via
 * {@link leanToolCapability}.
 *
 * @param {object} state - State from buildLeanRuntimeState()
 * @returns {boolean}
 */
export function isLeanToolAdvertised(state) {
  return Boolean(
    state?.requestedEnabled &&
    state?.sandbox?.available &&
    state?.sandbox?.userNamespaces &&
    state?.profiles?.core?.ready
  );
}

/**
 * Advertised Lean capability level: "off", "core-only" or "full".
 * Core-only means the tool is advertised but requests with profile=mathlib
 * must fail deterministically (the executor already rejects unready profiles
 * with 503 LEAN_RUNTIME_UNAVAILABLE).
 *
 * @param {object} state - State from buildLeanRuntimeState()
 * @returns {"off"|"core-only"|"full"}
 */
export function leanToolCapability(state) {
  if (!isLeanToolAdvertised(state)) return "off";
  return state.profiles.mathlib.ready ? "full" : "core-only";
}

/**
 * TTL-cached runtime state. Within a request every consumer must agree on the
 * same state, and the userns probe (a process spawn) should not run per tool
 * call, so the cache resolves all get() calls to the same object until TTL
 * expiry, then rebuilds on demand. A concurrent caller during a rebuild joins
 * the same in-flight build instead of starting a second one.
 *
 * @param {object} config - Resolved Lean config.
 * @param {object} [deps] - Same deps as buildLeanRuntimeState().
 * @param {object} [options]
 * @param {number} [options.ttlMs] - Cache lifetime in ms (default 30s).
 * @param {Function} [options.now]
 * @returns {{ get(): Promise<object>, refresh(): Promise<object> }}
 */
export function createLeanRuntimeStateCache(config, deps = {}, { ttlMs = 30000, now = Date.now } = {}) {
  let cached = { state: null, at: 0 };
  let pending = null;

  async function refresh() {
    const state = await buildLeanRuntimeState(config, deps);
    cached = { state, at: now() };
    return state;
  }

  function get() {
    if (cached.state !== null && now() - cached.at < ttlMs) {
      return Promise.resolve(cached.state);
    }
    if (!pending) {
      pending = refresh().finally(() => {
        pending = null;
      });
    }
    return pending;
  }

  return {
    get,
    refresh
  };
}
