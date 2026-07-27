/**
 * FIFO concurrency gate for Agno tool execution.
 *
 * Ensures at most `maxInflight` tool calls run at the same time (default: 1,
 * single-flight) to avoid races between concurrent tool invocations that
 * touch the same workspace — e.g. two concurrent writes, bash + edit,
 * two PageAgent tasks, or Sage collisions. Remaining requests queue in
 * FIFO order until a slot frees up.
 *
 * Deliberately independent from AgnoModelGate (./agnoModelGate.mjs): tool
 * execution has a different default wait timeout and its own error-code
 * namespace, since the two gates protect different resources with
 * different failure semantics. Do not import/subclass AgnoModelGate here.
 *
 * HTTP mapping for the error codes below is documented for future callers
 * (an execution route/service not yet built). This class itself only sets
 * `err.code` on thrown/rejected errors — it does not attach an HTTP
 * `.status`, mirroring how AgnoModelGate leaves that mapping to the call
 * site (see agnoModelGateway.mjs):
 *   AGNO_TOOL_QUEUE_FULL    -> 429 (Too Many Requests)
 *   AGNO_TOOL_WAIT_TIMEOUT  -> 504 (Gateway Timeout)
 *   AGNO_TOOL_CANCELLED     -> 499 (internal "client closed request") or
 *                              408 (HTTP Request Timeout), caller's choice
 */
export class AgnoToolGate {
  #maxInflight;
  #maxQueued;
  #waitTimeoutMs;
  #inflight = 0;
  #queue = [];
  #closed = false;
  #totalAcquired = 0;
  #totalRejected = 0;
  #totalTimedOut = 0;
  #totalCancelled = 0;

  constructor({ maxInflight = 1, maxQueued = 8, waitTimeoutMs = 120_000 }) {
    this.#maxInflight = maxInflight;
    this.#maxQueued = maxQueued;
    this.#waitTimeoutMs = waitTimeoutMs;
  }

  /**
   * Acquire a lease to run a tool call.
   *
   * @param {object} [options]
   * @param {AbortSignal} [options.signal] - optional abort signal
   * @returns {Promise<{ acquiredAt: number, release: () => void }>}
   * @throws {Error} with a `.code` property if the lease cannot be acquired
   */
  async acquire({ signal } = {}) {
    if (this.#closed) {
      this.#totalRejected++;
      throw this.#error("AGNO_TOOL_CANCELLED");
    }

    // Fast path: an inflight slot is free
    if (this.#inflight < this.#maxInflight) {
      this.#inflight++;
      this.#totalAcquired++;
      return this.#createLease();
    }

    // Queue capacity check
    if (this.#queue.length >= this.#maxQueued) {
      this.#totalRejected++;
      throw this.#error("AGNO_TOOL_QUEUE_FULL");
    }

    // Enqueue
    const entry = {};
    const promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });

    const timeout = setTimeout(() => {
      const idx = this.#queue.indexOf(entry);
      if (idx !== -1) {
        this.#queue.splice(idx, 1);
        this.#totalTimedOut++;
        entry.reject(this.#error("AGNO_TOOL_WAIT_TIMEOUT"));
      }
    }, this.#waitTimeoutMs);
    timeout.unref?.();
    entry.timeout = timeout;

    this.#queue.push(entry);

    if (signal) {
      if (signal.aborted) {
        this.#removeAndCancel(entry);
      } else {
        signal.addEventListener("abort", () => {
          this.#removeAndCancel(entry);
        }, { once: true });
      }
    }

    try {
      return await promise;
    } finally {
      clearTimeout(timeout);
    }
  }

  #removeAndCancel(entry) {
    const idx = this.#queue.indexOf(entry);
    if (idx !== -1) {
      this.#queue.splice(idx, 1);
      clearTimeout(entry.timeout);
      this.#totalCancelled++;
      entry.reject(this.#error("AGNO_TOOL_CANCELLED"));
    }
  }

  #createLease() {
    const acquiredAt = Date.now();
    let released = false;
    return {
      acquiredAt,
      release: () => {
        if (released) return;
        released = true;
        if (this.#inflight > 0) this.#inflight--;
        this.#drainQueue();
      },
    };
  }

  #drainQueue() {
    if (this.#closed) return;
    while (this.#inflight < this.#maxInflight && this.#queue.length > 0) {
      const entry = this.#queue.shift();
      clearTimeout(entry.timeout);
      this.#inflight++;
      this.#totalAcquired++;
      entry.resolve(this.#createLease());
    }
  }

  /**
   * Permanently shut the gate down: rejects every currently-queued waiter
   * with AGNO_TOOL_CANCELLED, and causes any future acquire() call to
   * reject immediately with the same code (the gate never reopens).
   * Mirrors AgnoModelGate.close()'s permanent-closure behavior under a
   * different name, per task 7 brief.
   */
  cancelAll(reason = "shutdown") {
    this.#closed = true;
    for (const entry of this.#queue) {
      clearTimeout(entry.timeout);
      this.#totalCancelled++;
      entry.reject(this.#error("AGNO_TOOL_CANCELLED", reason));
    }
    this.#queue = [];
  }

  /**
   * Sanitized status/metrics.
   */
  status() {
    return {
      inflight: this.#inflight,
      queued: this.#queue.length,
      maxInflight: this.#maxInflight,
      maxQueued: this.#maxQueued,
      totalAcquired: this.#totalAcquired,
      totalRejected: this.#totalRejected,
      totalTimedOut: this.#totalTimedOut,
      totalCancelled: this.#totalCancelled,
    };
  }

  #error(code, reason) {
    const err = new Error(reason ? `${code}: ${reason}` : code);
    err.code = code;
    return err;
  }
}
