/**
 * FIFO single-flight gate for Agno model calls.
 *
 * Ensures at most one model request is in-flight at any time.
 * Remaining requests queue in FIFO order.
 */
export class AgnoModelGate {
  #maxInflight;
  #maxQueued;
  #waitTimeoutMs;
  #clock;
  #inflight = 0;
  #queue = [];
  #closed = false;
  #totalAcquired = 0;
  #totalRejected = 0;
  #totalCancelled = 0;
  #totalTimedOut = 0;
  #lastWaitMs = null;
  #maxObservedWaitMs = 0;

  constructor({ maxInflight = 1, maxQueued = 8, waitTimeoutMs = 3_600_000, clock = Date }) {
    this.#maxInflight = maxInflight;
    this.#maxQueued = maxQueued;
    this.#waitTimeoutMs = waitTimeoutMs;
    this.#clock = clock;
  }

  /**
   * Acquire a lease to issue a model call.
   *
   * @param {object} options
   * @param {AbortSignal} [options.signal] - optional abort signal
   * @param {string} [options.runId] - run identifier for diagnostics
   * @param {string} [options.requestId] - request identifier for diagnostics
   * @returns {Promise<{ acquiredAt: number, release: () => void }>}
   * @throws {Error} with code property if cannot acquire
   */
  async acquire({ signal, runId, requestId } = {}) {
    if (this.#closed) {
      this.#totalRejected++;
      const err = new Error("AGNO_MODEL_GATE_CLOSED");
      err.code = "AGNO_MODEL_GATE_CLOSED";
      throw err;
    }

    // Fast path: inflight slot available
    if (this.#inflight < this.#maxInflight) {
      this.#inflight = 1;
      this.#totalAcquired++;
      return this.#createLease();
    }

    // Check queue capacity
    if (this.#queue.length >= this.#maxQueued) {
      this.#totalRejected++;
      const err = new Error("AGNO_MODEL_QUEUE_FULL");
      err.code = "AGNO_MODEL_QUEUE_FULL";
      throw err;
    }

    // Enqueue
    const entry = { runId, requestId, acquiredAt: null };
    const promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });

    // Timeout
    const timeout = setTimeout(() => {
      const idx = this.#queue.indexOf(entry);
      if (idx !== -1) {
        this.#queue.splice(idx, 1);
        this.#totalTimedOut++;
        const err = new Error("AGNO_MODEL_WAIT_TIMEOUT");
        err.code = "AGNO_MODEL_WAIT_TIMEOUT";
        entry.reject(err);
      }
    }, this.#waitTimeoutMs);
    timeout.unref?.();

    entry.timeout = timeout;
    this.#queue.push(entry);

    // Abort handling
    if (signal) {
      if (signal.aborted) {
        return this.#removeAndReject(entry, "AGNO_MODEL_CANCELLED");
      }
      signal.addEventListener("abort", () => {
        this.#removeAndReject(entry, "AGNO_MODEL_CANCELLED");
      }, { once: true });
    }

    try {
      const lease = await promise;
      return lease;
    } finally {
      clearTimeout(timeout);
    }
  }

  #removeAndReject(entry, code) {
    const idx = this.#queue.indexOf(entry);
    if (idx !== -1) {
      this.#queue.splice(idx, 1);
      this.#totalCancelled++;
      const err = new Error(code);
      err.code = code;
      entry.reject(err);
    }
  }

  #createLease() {
    const acquiredAt = this.#clock.now();
    let released = false;
    return {
      acquiredAt,
      release: () => {
        if (released) return;
        released = true;
        this.#inflight = 0;
        this.#drainQueue();
      },
    };
  }

  #drainQueue() {
    if (this.#closed) return;
    if (this.#queue.length === 0) return;
    const entry = this.#queue.shift();
    clearTimeout(entry.timeout);
    this.#inflight = 1;
    this.#totalAcquired++;
    const now = this.#clock.now();
    const waitMs = now - (entry.acquiredAt || now);
    this.#lastWaitMs = waitMs;
    if (waitMs > this.#maxObservedWaitMs) this.#maxObservedWaitMs = waitMs;
    entry.resolve(this.#createLease());
  }

  /**
   * Close the gate, rejecting all waiters.
   */
  close(reason = "shutdown") {
    this.#closed = true;
    for (const entry of this.#queue) {
      clearTimeout(entry.timeout);
      const err = new Error(`AGNO_MODEL_GATE_CLOSED: ${reason}`);
      err.code = "AGNO_MODEL_GATE_CLOSED";
      entry.reject(err);
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
      maxQueued: this.#maxQueued,
      totalAcquired: this.#totalAcquired,
      totalRejected: this.#totalRejected,
      totalCancelled: this.#totalCancelled,
      totalTimedOut: this.#totalTimedOut,
      lastWaitMs: this.#lastWaitMs,
      maxObservedWaitMs: this.#maxObservedWaitMs,
    };
  }
}
