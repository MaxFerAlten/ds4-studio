/**
 * SSE event stream parser for Agno runs.
 * Handles chunked data, heartbeat, deduplication, and terminal events.
 */

export class AgnoEventStream {
  constructor({ onEvent, onError } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onError = onError || console.error;
    this.buffer = "";
    this.currentEvent = null;
    this.currentData = null;
    this.lastSeqs = {}; // runId -> highest seq applied
  }

  /**
   * Feed a chunk of SSE data to the parser.
   * @param {string} chunk - raw SSE chunk from the stream
   */
  feed(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        this.currentEvent = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data: ")) {
        this.currentData = line.slice(6).trim();
        continue;
      }
      if (line.startsWith(":")) {
        // Heartbeat comment, ignore
        continue;
      }

      if (this.currentEvent && this.currentData !== null) {
        try {
          const parsed = JSON.parse(this.currentData);
          const runId = parsed.runId;
          const seq = parsed.seq || 0;
          // Deduplicate: ignore seq at or below the highest already applied for this runId
          if ((this.lastSeqs[runId] ?? -1) >= seq) {
            this.currentEvent = null;
            this.currentData = null;
            continue;
          }
          this.lastSeqs[runId] = seq;
          this.onEvent(parsed);
        } catch (err) {
          this.onError(err);
        }
        this.currentEvent = null;
        this.currentData = null;
      }
    }
  }

  // Clears line-parsing state only; dedup memory survives so replayed
  // events after a reconnect are never re-applied.
  reset() {
    this.buffer = "";
    this.currentEvent = null;
    this.currentData = null;
  }
}
