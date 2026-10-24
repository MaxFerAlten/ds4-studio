// Relays ds4-server prefill progress to an agent turn.
//
// A 34k-token agent prompt prefills for ~6 minutes and the backend streams no
// byte meanwhile: the chat looked dead.  ds4-server logs every 1024-token
// chunk ("... TOOLS prefill chunk 2048/7981 (25.7%) chunk=98.04 t/s
// avg=98.99 t/s 20.688s"); the process manager re-emits those lines, and this
// turns them into progress events.

const PREFILL_LINE =
  /prefill chunk (\d+)\/(\d+) \(([\d.]+)%\).*?avg=([\d.]+) t\/s\s+([\d.]+)s/;

export function parsePrefillProgress(message) {
  const match = PREFILL_LINE.exec(String(message ?? ""));
  if (!match) return null;
  const [, done, total, pct, avgTps, elapsedSec] = match;
  const doneTokens = Number(done);
  const totalTokens = Number(total);
  const tps = Number(avgTps);
  return {
    doneTokens,
    totalTokens,
    percent: Number(pct),
    tokensPerSecond: tps,
    elapsedSeconds: Number(elapsedSec),
    etaSeconds: tps > 0 ? Math.max(0, Math.round((totalTokens - doneTokens) / tps)) : null
  };
}

// Subscribe to a process manager's "log" events; returns the unsubscribe.
// Only one turn runs at a time (shared admission lease), so every prefill line
// belongs to the turn that subscribed.
export function relayPrefillProgress(manager, onProgress) {
  if (!manager || typeof manager.on !== "function") return () => {};
  const onLog = (entry) => {
    const progress = parsePrefillProgress(entry?.message);
    if (progress) onProgress(progress);
  };
  manager.on("log", onLog);
  return () => manager.off("log", onLog);
}
