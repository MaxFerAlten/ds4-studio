// R13 — the operator-facing reading of /api/lean/status.
//
// The rule this file exists to enforce: never show "Ready" because
// `enabled=true`. Enabled is a request; readiness is a measurement, and the
// two disagreed in every failure mode this integration had.

/**
 * @typedef {object} LeanView
 * @property {string} state    - machine-readable state id
 * @property {string} label    - short label for the pill
 * @property {string} detail   - one line of explanation, may be empty
 * @property {"ok"|"warn"|"bad"|""} tone
 * @property {boolean} restartRequired
 */

/**
 * Derive what to display from the live status and, optionally, the config file
 * the UI has in hand (to notice a toggle that has not been restarted into).
 *
 * @param {object|null} status - payload of GET /api/lean/status
 * @param {object|null} [configLean] - `lean` block of the saved config
 * @param {{ busy?: boolean }} [runtime] - live client-side hints
 * @returns {LeanView}
 */
export function leanStatusView(status, configLean = null, runtime = {}) {
  if (!status) {
    return view("unknown", "Status unavailable", "The server did not answer /api/lean/status.", "bad");
  }

  const effectiveEnabled = Boolean(status.effective?.enabled ?? status.enabled);
  const savedEnabled = configLean ? Boolean(configLean.enabled) : effectiveEnabled;
  // The Lean config is resolved once at boot: a saved toggle only takes effect
  // when the Node process restarts, and pretending otherwise is how an
  // operator ends up believing a disabled feature is on.
  const restartRequired = savedEnabled !== effectiveEnabled;

  if (!effectiveEnabled) {
    return restartRequired
      ? view(
          "configured-restart-required",
          "Configured, restart required",
          "lean.enabled is saved as true; the running server still has Lean disabled.",
          "warn",
          true
        )
      : view("disabled", "Disabled", "lean.enabled is false (DS4_LEAN_ENABLED overrides the file).", "");
  }

  const preflight = status.preflight || {};
  const profiles = preflight.profiles || {};
  const core = profiles.core || {};
  const mathlib = profiles.mathlib || {};

  if (preflight.sandboxAvailable === false) {
    return view(
      "sandbox-unavailable",
      "Sandbox unavailable",
      firstReason(preflight, "bubblewrap or user namespaces are not usable on this host"),
      "bad",
      restartRequired
    );
  }

  if (!core.ok) {
    return view(
      "runtime-unavailable",
      "Runtime unavailable",
      firstReason(preflight, "the core profile is not prepared (scripts/lean-prepare-runtime.sh)"),
      "bad",
      restartRequired
    );
  }

  const policy = readPolicy(status);
  const base = mathlib.ok ? "Core + Mathlib ready" : "Core ready";
  const baseState = mathlib.ok ? "core-mathlib-ready" : "core-ready";

  if (runtime.busy) {
    return view("busy", "Busy", `${base}; a check is running.`, "ok", restartRequired);
  }

  // A profile that is ready while another is not is a degraded — not broken —
  // capability: core-only requests still work, mathlib ones fail closed.
  if (profiles.mathlib && !mathlib.ok) {
    return view(
      "degraded",
      "Core ready (Mathlib unavailable)",
      policySuffix("profile=mathlib requests will fail closed", policy),
      "warn",
      restartRequired
    );
  }

  if (policy.active === true) {
    return view("policy-active", `${base} · policy active`, policyDetail(policy), "ok", restartRequired);
  }
  if (policy.available) {
    return view(
      baseState,
      `${base} · policy available`,
      policySuffix("run /skill lean start to activate it in this session", policy),
      "ok",
      restartRequired
    );
  }
  return view(baseState, base, "The Lean policy file is not readable; lean_check stays fail-closed.", "warn", restartRequired);
}

/**
 * `policyLoaded` on the wire means "the file is readable", never "the session
 * is primed with it" — the two are reported apart (§6.8).
 */
function readPolicy(status) {
  const p = status.policy || {};
  return {
    available: Boolean(p.available ?? status.policyLoaded),
    availableRevision: p.availableRevision ?? status.policyRevision ?? "",
    active: p.active === undefined ? null : p.active,
    activeRevision: p.activeRevision ?? null,
  };
}

function policyDetail(policy) {
  const rev = (policy.activeRevision || policy.availableRevision || "").slice(0, 8);
  return rev ? `policy revision ${rev}` : "";
}

function policySuffix(text, policy) {
  const rev = (policy.availableRevision || "").slice(0, 8);
  return rev ? `${text} (revision ${rev})` : text;
}

function firstReason(preflight, fallback) {
  const errors = Array.isArray(preflight.errors) ? preflight.errors : [];
  const profileReason = Object.values(preflight.profiles || {})
    .map((p) => p.reason)
    .find(Boolean);
  return errors[0] || profileReason || fallback;
}

function view(state, label, detail, tone, restartRequired = false) {
  return { state, label, detail: detail || "", tone, restartRequired };
}
