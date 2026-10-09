// WP3 of piano.esecutivo.integrazione.opendots.v2.md (§12, §14): the one place
// that decides whether the AG-UI POC is on.  On by default; the legacy UI and
// POST /api/agent/chat are untouched either way.
//
//   DS4_AGUI_ENABLED=0   disables the gateway behaviour of /api/agui/*
//   DS4_LOCAL_THREADS_ENABLED=0 disables SQLite history and persist-before-emit.
//
// Fixed in this POC, not configurable (plan §5, §11, ADR-005):
//   - loopback only (no LAN, no reverse proxy);
//   - JS engine only; native multi-thread stays off;
//   - one thread per owner; local SQLite history is enabled by default.

export function aguiFeatureFlags(env = process.env) {
  const aguiEnabled = env.DS4_AGUI_ENABLED !== "0";
  const localThreads = env.DS4_LOCAL_THREADS_ENABLED === "1" || (aguiEnabled && env.DS4_LOCAL_THREADS_ENABLED !== "0");
  if (localThreads && !aguiEnabled) throw new Error("DS4_LOCAL_THREADS_ENABLED requires DS4_AGUI_ENABLED=1");
  return Object.freeze({
    aguiEnabled,
    localThreads,
    nativeMultiThread: false,
    durableHistory: localThreads
  });
}
