import { LOCAL_THREAD_EVENT_LIMITS } from "./localThreadStorage.mjs";

// Serializes the public stream through a bounded persistence queue. A caller's
// delivery callback is invoked only after the corresponding SQLite commit.
export function createDurablePublicEventWriter({
  store, ownerId, threadId, runId, deliver,
  batchBytes = LOCAL_THREAD_EVENT_LIMITS.batchBytes,
  batchDelayMs = LOCAL_THREAD_EVENT_LIMITS.batchDelayMs,
  maxBufferedBytes = LOCAL_THREAD_EVENT_LIMITS.maxBufferedBytes,
  mapperVersion = 1
} = {}) {
  if (!store || typeof store.appendPublicEvents !== "function") throw new TypeError("durable writer requires a persistent thread store");
  if (typeof deliver !== "function") throw new TypeError("durable writer requires a delivery callback");
  let queue = [];
  let queuedBytes = 0;
  let pendingBytes = 0;
  let timer = null;
  let chain = Promise.resolve();
  let closed = false;
  let failure = null;

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!queue.length) return chain;
    const batch = queue;
    queue = [];
    queuedBytes = 0;
    chain = chain.then(async () => {
      if (failure) throw failure;
      const saved = store.appendPublicEvents(ownerId, threadId, runId, batch.map(({ payload }) => ({ mapperVersion, payload })));
      for (let index = 0; index < saved.length; index += 1) await deliver(saved[index].payload, saved[index].cursor);
      for (const item of batch) { pendingBytes -= item.bytes; item.resolve(); }
    }).catch((error) => {
      failure = error;
      for (const item of batch) { pendingBytes -= item.bytes; item.reject(error); }
      throw error;
    });
    chain.catch(() => {});
    return chain;
  }

  return Object.freeze({
    enqueue(payload) {
      if (closed) return Promise.reject(new Error("durable writer is closed"));
      if (failure) return Promise.reject(failure);
      const bytes = Buffer.byteLength(JSON.stringify(payload));
      if (pendingBytes + bytes > maxBufferedBytes) return Promise.reject(Object.assign(new Error("public event buffer limit exceeded"), { code: "PUBLIC_EVENT_BACKPRESSURE" }));
      let resolve;
      let reject;
      const delivered = new Promise((yes, no) => { resolve = yes; reject = no; });
      queue.push({ payload, bytes, resolve, reject });
      queuedBytes += bytes;
      pendingBytes += bytes;
      if (queuedBytes >= batchBytes) void flush();
      else if (!timer) timer = setTimeout(() => { void flush(); }, batchDelayMs);
      return delivered;
    },
    async close() {
      closed = true;
      await flush();
      await chain;
    },
    get bufferedBytes() { return pendingBytes; },
    get failed() { return failure; }
  });
}
