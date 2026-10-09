// WP3 of piano.esecutivo.integrazione.opendots.v2.md (§12, §14): the one place
// that decides whether the AG-UI POC is on.  Off by default; the legacy UI and
// POST /api/agent/chat are untouched either way.
//
//   DS4_AGUI_ENABLED=1   mounts the gateway behaviour of /api/agui/* (the
//                        capability endpoint answers in both states)
//   DS4_LOCAL_THREADS_ENABLED=1 requires AG-UI and DS4_LOCAL_THREADS_DB; it
//                        enables SQLite history and persist-before-emit.
//
// Fixed in this POC, not configurable (plan §5, §11, ADR-005):
//   - loopback only (no LAN, no reverse proxy);
//   - JS engine only; native multi-thread stays off;
//   - one thread per owner; SQLite is opt-in and remains off by default.

export function aguiFeatureFlags(env = process.env) {
  const aguiEnabled = env.DS4_AGUI_ENABLED === "1";
  const localThreads = env.DS4_LOCAL_THREADS_ENABLED === "1";
  if (localThreads && !aguiEnabled) throw new Error("DS4_LOCAL_THREADS_ENABLED requires DS4_AGUI_ENABLED=1");
  return Object.freeze({
    aguiEnabled,
    localThreads,
    nativeMultiThread: false,
    durableHistory: localThreads
  });
}
