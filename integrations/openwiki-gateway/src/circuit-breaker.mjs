// Upstream circuit breaker and single-flight lease for the OpenWiki MCP child
// (WP04a, plan §5.7).
//
// The breaker is a pure state machine: no timers, no I/O, no sleeps. Time comes
// from an injected monotonic clock and state is re-evaluated lazily on every
// call, so OPEN -> HALF_OPEN happens the first time the breaker is consulted
// at or after expiry.
//
//   CLOSED    --N consecutive infrastructure failures within windowMs--> OPEN
//   OPEN      --clock >= openUntil-->                                    HALF_OPEN
//   HALF_OPEN --probe success-->                                         CLOSED (history and backoff reset)
//   HALF_OPEN --probe failure / abandoned probe-->                       OPEN (bounded exponential backoff)
//
// Every upstream interaction must hold a lease. At most one lease exists at a
// time (MVP: one in-flight upstream request), so a held lease rejects every
// other acquire with UPSTREAM_BUSY. In HALF_OPEN only `acquire('probe')` is
// accepted; the caller (McpSupervisor) must use it for an explicit health /
// listTools call and never for a private search/read query.
//
// Usage from the supervisor:
//
//   const lease = breaker.acquire('request'); // throws CircuitBreakerError
//   try {
//     const result = await upstreamCall();
//     lease.settle(OUTCOMES.SUCCESS);
//     return result;
//   } catch (e) {
//     lease.settle(isInfra(e) ? OUTCOMES.INFRASTRUCTURE : OUTCOMES.CONTENT);
//     throw e;
//   } finally {
//     lease.release(); // no-op once settled; neutral abandon otherwise
//   }
//
// Content errors (400/403/404/409/413/429 and gateway-local 500) never count
// toward the threshold and never reset the streak: they say nothing about
// upstream health, and letting them reset it would let a caller hide a dying
// child behind a stream of cheap 404s.

export const BREAKER_STATES = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open',
});

export const OUTCOMES = Object.freeze({
  SUCCESS: 'success',
  INFRASTRUCTURE: 'infrastructure',
  CONTENT: 'content',
});

export const LEASE_KINDS = Object.freeze({ REQUEST: 'request', PROBE: 'probe' });

export const BREAKER_DEFAULTS = Object.freeze({
  failureThreshold: 3,
  windowMs: 60_000,
  openMs: 30_000,
  backoffFactor: 2,
  maxOpenMs: 300_000,
});

const OUTCOME_VALUES = new Set(Object.values(OUTCOMES));
const LEASE_KIND_VALUES = new Set(Object.values(LEASE_KINDS));
const OPTION_KEYS = new Set([...Object.keys(BREAKER_DEFAULTS), 'now', 'onTransition']);

export class CircuitBreakerError extends Error {
  // code: 'CIRCUIT_OPEN' | 'PROBE_REQUIRED' | 'UPSTREAM_BUSY'
  constructor(code, message, retryAfterMs = 0) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

// Maps a gateway HTTP status (§4.5) to a breaker outcome: 502/503/504 and any
// other 5xx (fail safe) are infrastructure; 500 is a gateway-local fault and
// every 4xx is a content error, neither says anything about the upstream child.
export function classifyHttpStatus(status) {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new TypeError('status must be an HTTP status code');
  }
  if (status < 400) return OUTCOMES.SUCCESS;
  if (status >= 500 && status !== 500) return OUTCOMES.INFRASTRUCTURE;
  return OUTCOMES.CONTENT;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

class BreakerLease {
  #settle;

  constructor(kind, probe, settle) {
    this.kind = kind;
    // True only for the single HALF_OPEN probe; its outcome decides CLOSED vs OPEN.
    this.probe = probe;
    this.#settle = settle;
  }

  get settled() {
    return this.#settle === null;
  }

  // Records the outcome and frees the slot. Returns false if already settled.
  settle(outcome) {
    if (!OUTCOME_VALUES.has(outcome)) throw new TypeError('unknown breaker outcome');
    return this.#finish(outcome);
  }

  // Frees the slot without an outcome (e.g. HTTP client went away). Neutral in
  // CLOSED; an abandoned HALF_OPEN probe counts as a failed probe.
  release() {
    return this.#finish(null);
  }

  #finish(outcome) {
    const settle = this.#settle;
    if (settle === null) return false;
    this.#settle = null;
    settle(this, outcome);
    return true;
  }
}

export class CircuitBreaker {
  #now;
  #onTransition;
  #failureThreshold;
  #windowMs;
  #openMs;
  #backoffFactor;
  #maxOpenMs;
  #state = BREAKER_STATES.CLOSED;
  #failures = []; // monotonic timestamps of the current consecutive streak
  #openUntil = 0;
  #reopenCount = 0;
  #lease = null;
  #lastTime = -Infinity;

  // options: { now?: () => number (monotonic ms, default performance.now),
  //            onTransition?: ({ from, to, at }) => void (content-free),
  //            failureThreshold, windowMs, openMs, backoffFactor, maxOpenMs }
  constructor(options = {}) {
    for (const key of Object.keys(options)) {
      if (!OPTION_KEYS.has(key)) throw new TypeError(`unknown circuit breaker option: ${key}`);
    }
    const o = { ...BREAKER_DEFAULTS, ...options };
    this.#now = o.now ?? (() => performance.now());
    if (typeof this.#now !== 'function') throw new TypeError('now must be a function');
    if (o.onTransition !== undefined && typeof o.onTransition !== 'function') {
      throw new TypeError('onTransition must be a function');
    }
    this.#onTransition = o.onTransition ?? null;
    this.#failureThreshold = positiveInteger(o.failureThreshold, 'failureThreshold');
    this.#windowMs = positiveInteger(o.windowMs, 'windowMs');
    this.#openMs = positiveInteger(o.openMs, 'openMs');
    this.#maxOpenMs = positiveInteger(o.maxOpenMs, 'maxOpenMs');
    if (this.#maxOpenMs < this.#openMs) throw new TypeError('maxOpenMs must be >= openMs');
    if (typeof o.backoffFactor !== 'number' || !Number.isFinite(o.backoffFactor) || o.backoffFactor < 1) {
      throw new TypeError('backoffFactor must be a finite number >= 1');
    }
    this.#backoffFactor = o.backoffFactor;
  }

  get state() {
    this.#refresh(this.#time());
    return this.#state;
  }

  // Content-free view for health endpoints and metrics (§5.8).
  snapshot() {
    const t = this.#time();
    this.#refresh(t);
    return {
      state: this.#state,
      consecutiveFailures: this.#state === BREAKER_STATES.CLOSED ? this.#liveFailures(t).length : 0,
      reopenCount: this.#reopenCount,
      retryAfterMs: this.#state === BREAKER_STATES.OPEN ? this.#openUntil - t : 0,
      inFlight: this.#lease === null ? null : this.#lease.kind,
    };
  }

  // Returns a lease or throws CircuitBreakerError. A 'probe' lease in CLOSED
  // behaves exactly like a 'request' lease.
  acquire(kind = LEASE_KINDS.REQUEST) {
    if (!LEASE_KIND_VALUES.has(kind)) throw new TypeError('unknown lease kind');
    const t = this.#time();
    this.#refresh(t);
    if (this.#lease !== null) {
      throw new CircuitBreakerError('UPSTREAM_BUSY', 'an upstream request is already in flight');
    }
    if (this.#state === BREAKER_STATES.OPEN) {
      throw new CircuitBreakerError('CIRCUIT_OPEN', 'upstream circuit is open', this.#openUntil - t);
    }
    const probe = this.#state === BREAKER_STATES.HALF_OPEN;
    if (probe && kind !== LEASE_KINDS.PROBE) {
      throw new CircuitBreakerError('PROBE_REQUIRED', 'upstream circuit is half-open; only a health probe is allowed');
    }
    const lease = new BreakerLease(kind, probe, (l, outcome) => this.#settle(l, outcome));
    this.#lease = lease;
    return lease;
  }

  #settle(lease, outcome) {
    if (this.#lease !== lease) return;
    this.#lease = null;
    const t = this.#time();
    if (lease.probe) {
      if (outcome === OUTCOMES.SUCCESS) {
        this.#failures = [];
        this.#reopenCount = 0;
        this.#transition(BREAKER_STATES.CLOSED, t);
      } else {
        this.#reopenCount += 1;
        this.#open(t);
      }
      return;
    }
    if (outcome === OUTCOMES.SUCCESS) {
      this.#failures = [];
    } else if (outcome === OUTCOMES.INFRASTRUCTURE) {
      this.#failures = this.#liveFailures(t);
      this.#failures.push(t);
      if (this.#failures.length >= this.#failureThreshold) this.#open(t);
    }
    // CONTENT and abandoned leases are neutral.
  }

  #open(t) {
    const duration = Math.min(this.#openMs * this.#backoffFactor ** this.#reopenCount, this.#maxOpenMs);
    this.#failures = [];
    this.#openUntil = t + duration;
    this.#transition(BREAKER_STATES.OPEN, t);
  }

  // A failure at f is inside the rolling window while t - f < windowMs.
  #liveFailures(t) {
    return this.#failures.filter((f) => t - f < this.#windowMs);
  }

  #refresh(t) {
    if (this.#state === BREAKER_STATES.OPEN && t >= this.#openUntil) {
      this.#transition(BREAKER_STATES.HALF_OPEN, t);
    }
  }

  #transition(to, at) {
    const from = this.#state;
    this.#state = to;
    if (this.#onTransition === null || from === to) return;
    try {
      this.#onTransition({ from, to, at });
    } catch {
      // Observers must not be able to corrupt breaker state.
    }
  }

  // Clamped so a misbehaving clock can never move the breaker backwards.
  #time() {
    const t = this.#now();
    if (typeof t !== 'number' || !Number.isFinite(t)) throw new TypeError('clock must return a finite number');
    if (t > this.#lastTime) this.#lastTime = t;
    return this.#lastTime;
  }
}
