// WP3: temporary in-memory recorder of the AG-UI events a run delivered.
//
// POC only (plan §12 WP3): bounded, per process, lost on restart.  It is a
// diagnostic copy of what was sent, keyed by owner/thread/run; it is not the
// public history (WP4), not a replay source and never written to disk.

export function createAguiRecorder({ maxRuns = 32, maxBytesPerRun = 4 * 1024 * 1024 } = {}) {
  const runs = new Map();

  const keyOf = (ownerId, threadId, runId) => JSON.stringify([ownerId, threadId, runId]);

  return Object.freeze({
    begin(ownerId, threadId, runId) {
      const key = keyOf(ownerId, threadId, runId);
      const entry = { ownerId, threadId, runId, events: [], bytes: 0, truncated: false, terminal: null };
      runs.delete(key);
      runs.set(key, entry);
      while (runs.size > maxRuns) runs.delete(runs.keys().next().value);
      return Object.freeze({
        record(event) {
          if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") entry.terminal = event.type;
          if (entry.truncated) return;
          const bytes = Buffer.byteLength(JSON.stringify(event));
          if (entry.bytes + bytes > maxBytesPerRun) {
            entry.truncated = true;
            return;
          }
          entry.bytes += bytes;
          entry.events.push(Object.freeze({ seq: entry.events.length + 1, event }));
        }
      });
    },
    get(ownerId, threadId, runId) {
      const entry = runs.get(keyOf(ownerId, threadId, runId));
      if (!entry) return null;
      return Object.freeze({
        runId: entry.runId,
        terminal: entry.terminal,
        truncated: entry.truncated,
        events: entry.events.slice()
      });
    },
    size() {
      return runs.size;
    }
  });
}
