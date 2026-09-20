// Gate for the suites that need a provisioned host (real Lean, real sandbox).
//
// R12 rule (§6.18): without the flag a real suite may skip, because a laptop
// without the runtime should still be able to run `node --test`. *With* the
// flag the host is claiming to be provisioned, so a missing runtime is a
// failure — a certification run must never be able to pass by skipping.

/**
 * @param {object|null|undefined} state - preflight profile entry ({ ok, reason })
 * @param {object} opts
 * @param {string} opts.flag - env var that makes readiness mandatory
 * @param {string} opts.label - what is not ready, for the message
 * @returns {object} node:test options ({} to run, { skip } to skip)
 * @throws when the flag is set and the host is not ready
 */
export function requireReady(state, { flag, label }) {
  if (state?.ok) return {};
  const reason = state?.reason || `${label} is not prepared`;
  if (process.env[flag] === "1") {
    throw new Error(
      `${flag}=1 but ${label} is not ready: ${reason}. ` +
        `A required real test must fail, never skip.`
    );
  }
  return { skip: reason };
}
