// Which agent loop serves Agent Mode.  "native" keeps the C agent inside
// ds4-wrapper; "js" runs the Node loop against any OpenAI-compatible
// backend, ds4-wrapper in server mode included (convergenza.loop.md D1/D2).
//
// WP17: the JS loop is the default (parity in WP15, live acceptance on DS4
// and Vitronia in WP16). "native" stays selectable, deprecated, until its
// removal is planned separately; see docs/AGENT_ENGINE.md.
export const AGENT_ENGINES = Object.freeze(["native", "js"]);

export function resolveAgentEngine({ wrapperEnabled = false, engine } = {}) {
  // Without the wrapper there is no C agent to hand the turn to, so the JS
  // loop is the only engine that exists regardless of the configured value.
  if (!wrapperEnabled) return "js";
  return engine === "native" ? "native" : "js";
}

// Logged once at startup when the configured engine is the C agent.
export function engineStartupWarning(engine) {
  return engine === "native"
    ? "native agent engine selected for local DS4; see docs/AGENT_ENGINE.md"
    : null;
}

/**
 * WP13 of convergenza.loop.md — prepare the wrapper for the JS engine.
 *
 * With engine "js" the loop talks to the wrapper's OpenAI-compatible server
 * endpoints, so the wrapper must be in "server" mode, never in "agent" mode,
 * and the native runtime must not be prepared.  The mode field is
 * "active_mode" in the wrapper status JSON (shadow ds4_wrapper_metrics.c:98,
 * ds4_wrapper_status_json; names from ds4_wrapper.c:14 ds4_wrap_mode_name).
 *
 * Never issues switch-mode {mode:"agent"} and never touches
 * /api/native-agent/prepare — that is the plan §16 test contract.
 */
export async function ensureServerModeForJsEngine({
  fetchImpl = globalThis.fetch,
  base,
  statusTimeoutMs = 5000,
  switchTimeoutMs = 120000
} = {}) {
  let statusRes;
  try {
    statusRes = await fetchImpl(`${base}/api/wrapper/status`, {
      signal: AbortSignal.timeout(statusTimeoutMs)
    });
  } catch (err) {
    return { ok: false, switched: false, error: String(err?.message || err) };
  }
  let status = null;
  try {
    status = await statusRes.json();
  } catch {
    status = null;
  }
  if (!statusRes.ok) {
    return { ok: false, switched: false, status: statusRes.status, payload: status };
  }
  const activeMode = status && status.active_mode;
  if (activeMode !== "agent") {
    // "server" or "unknown": only agent mode blocks the JS loop.
    return { ok: true, switched: false, activeMode };
  }
  const switchRes = await fetchImpl(`${base}/api/wrapper/switch-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "server" }),
    signal: AbortSignal.timeout(switchTimeoutMs)
  });
  const payload = await switchRes.json().catch(() => null);
  if (!switchRes.ok) {
    return { ok: false, switched: false, status: switchRes.status, payload };
  }
  return { ok: true, switched: true, activeMode: "server", payload };
}
