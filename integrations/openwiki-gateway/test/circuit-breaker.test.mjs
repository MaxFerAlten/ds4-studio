// WP04a circuit breaker (plan §5.7). Pure state machine driven by a fake
// monotonic clock: no timers, no sleeps, no child processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BREAKER_DEFAULTS,
  BREAKER_STATES,
  CircuitBreaker,
  CircuitBreakerError,
  LEASE_KINDS,
  OUTCOMES,
  classifyHttpStatus,
} from '../src/circuit-breaker.mjs';

const { CLOSED, OPEN, HALF_OPEN } = BREAKER_STATES;
const { SUCCESS, INFRASTRUCTURE, CONTENT } = OUTCOMES;

function makeBreaker(options = {}) {
  const clock = { t: 1_000 };
  const transitions = [];
  const breaker = new CircuitBreaker({
    now: () => clock.t,
    onTransition: (e) => transitions.push(`${e.from}->${e.to}@${e.at}`),
    ...options,
  });
  return { breaker, clock, transitions };
}

function run(breaker, outcome, kind = LEASE_KINDS.REQUEST) {
  const lease = breaker.acquire(kind);
  assert.equal(lease.settle(outcome), true);
  return lease;
}

function rejects(breaker, kind, code) {
  assert.throws(
    () => breaker.acquire(kind),
    (e) => e instanceof CircuitBreakerError && e.code === code,
  );
}

// Drives a fresh breaker into OPEN at clock.t.
function tripOpen(ctx) {
  for (let i = 0; i < 3; i++) run(ctx.breaker, INFRASTRUCTURE);
  assert.equal(ctx.breaker.state, OPEN);
}

test('defaults match plan §5.7', () => {
  assert.deepEqual({ ...BREAKER_DEFAULTS }, {
    failureThreshold: 3,
    windowMs: 60_000,
    openMs: 30_000,
    backoffFactor: 2,
    maxOpenMs: 300_000,
  });
  const breaker = new CircuitBreaker();
  assert.equal(breaker.state, CLOSED);
});

test('CLOSED accepts requests and stays closed on success', () => {
  const { breaker } = makeBreaker();
  for (let i = 0; i < 10; i++) run(breaker, SUCCESS);
  assert.deepEqual(breaker.snapshot(), {
    state: CLOSED,
    consecutiveFailures: 0,
    reopenCount: 0,
    retryAfterMs: 0,
    inFlight: null,
  });
});

test('three consecutive infrastructure failures open the breaker; two do not', () => {
  const { breaker, clock, transitions } = makeBreaker();
  run(breaker, INFRASTRUCTURE);
  clock.t += 10;
  run(breaker, INFRASTRUCTURE);
  assert.equal(breaker.state, CLOSED);
  assert.equal(breaker.snapshot().consecutiveFailures, 2);
  clock.t += 10;
  run(breaker, INFRASTRUCTURE);
  assert.equal(breaker.state, OPEN);
  assert.deepEqual(transitions, ['closed->open@1020']);
  assert.equal(breaker.snapshot().retryAfterMs, 30_000);
});

test('success resets the consecutive failure streak', () => {
  const { breaker } = makeBreaker();
  run(breaker, INFRASTRUCTURE);
  run(breaker, INFRASTRUCTURE);
  run(breaker, SUCCESS);
  run(breaker, INFRASTRUCTURE);
  run(breaker, INFRASTRUCTURE);
  assert.equal(breaker.state, CLOSED);
  run(breaker, INFRASTRUCTURE);
  assert.equal(breaker.state, OPEN);
});

test('rolling window: failure exactly windowMs old has expired', () => {
  const { breaker, clock } = makeBreaker();
  run(breaker, INFRASTRUCTURE); // t=1000
  clock.t += 1;
  run(breaker, INFRASTRUCTURE); // t=1001
  clock.t = 1_000 + 60_000;
  assert.equal(breaker.snapshot().consecutiveFailures, 1);
  run(breaker, INFRASTRUCTURE); // first failure is exactly 60s old: out
  assert.equal(breaker.state, CLOSED);
  assert.equal(breaker.snapshot().consecutiveFailures, 2);
});

test('rolling window: failure one ms inside the window still counts', () => {
  const { breaker, clock } = makeBreaker();
  run(breaker, INFRASTRUCTURE); // t=1000
  run(breaker, INFRASTRUCTURE);
  clock.t = 1_000 + 59_999;
  run(breaker, INFRASTRUCTURE);
  assert.equal(breaker.state, OPEN);
});

test('rolling window: sparse failures never open', () => {
  const { breaker, clock } = makeBreaker();
  for (let i = 0; i < 20; i++) {
    run(breaker, INFRASTRUCTURE);
    clock.t += 30_000;
  }
  assert.equal(breaker.state, CLOSED);
});

test('content errors neither count nor reset the streak', () => {
  const { breaker } = makeBreaker();
  for (const status of [400, 403, 404, 409, 413, 429, 500]) {
    for (let i = 0; i < 5; i++) run(breaker, classifyHttpStatus(status));
  }
  assert.equal(breaker.state, CLOSED);
  assert.equal(breaker.snapshot().consecutiveFailures, 0);

  run(breaker, INFRASTRUCTURE);
  run(breaker, CONTENT);
  run(breaker, INFRASTRUCTURE);
  run(breaker, CONTENT);
  assert.equal(breaker.snapshot().consecutiveFailures, 2);
  run(breaker, INFRASTRUCTURE);
  assert.equal(breaker.state, OPEN);
});

test('classifyHttpStatus maps §4.5 statuses', () => {
  for (const s of [200, 204]) assert.equal(classifyHttpStatus(s), SUCCESS);
  for (const s of [400, 403, 404, 409, 413, 429, 500]) assert.equal(classifyHttpStatus(s), CONTENT);
  for (const s of [502, 503, 504, 501, 599]) assert.equal(classifyHttpStatus(s), INFRASTRUCTURE);
  for (const s of [99, 600, 200.5, '502', null]) assert.throws(() => classifyHttpStatus(s), TypeError);
});

test('OPEN rejects requests and probes until expiry, then HALF_OPEN', () => {
  const ctx = makeBreaker();
  const { breaker, clock, transitions } = ctx;
  tripOpen(ctx); // opened at t=1000, until 31000
  clock.t = 31_000 - 1;
  rejects(breaker, LEASE_KINDS.REQUEST, 'CIRCUIT_OPEN');
  rejects(breaker, LEASE_KINDS.PROBE, 'CIRCUIT_OPEN');
  assert.throws(() => breaker.acquire(), (e) => e.retryAfterMs === 1);
  clock.t = 31_000;
  assert.equal(breaker.state, HALF_OPEN);
  assert.deepEqual(transitions, ['closed->open@1000', 'open->half_open@31000']);
});

test('HALF_OPEN rejects ordinary requests and admits exactly one probe', () => {
  const ctx = makeBreaker();
  const { breaker, clock } = ctx;
  tripOpen(ctx);
  clock.t += 30_000;
  rejects(breaker, LEASE_KINDS.REQUEST, 'PROBE_REQUIRED');
  const probe = breaker.acquire(LEASE_KINDS.PROBE);
  assert.equal(probe.probe, true);
  assert.equal(breaker.snapshot().inFlight, 'probe');
  rejects(breaker, LEASE_KINDS.PROBE, 'UPSTREAM_BUSY');
  rejects(breaker, LEASE_KINDS.REQUEST, 'UPSTREAM_BUSY');
  clock.t += 120_000; // a slow probe does not let anything else through
  rejects(breaker, LEASE_KINDS.PROBE, 'UPSTREAM_BUSY');
  assert.equal(breaker.state, HALF_OPEN);
  probe.release();
});

test('probe success closes and resets failure history and backoff', () => {
  const ctx = makeBreaker();
  const { breaker, clock, transitions } = ctx;
  tripOpen(ctx);
  clock.t += 30_000;
  run(breaker, SUCCESS, LEASE_KINDS.PROBE);
  assert.equal(breaker.state, CLOSED);
  assert.deepEqual(breaker.snapshot(), {
    state: CLOSED,
    consecutiveFailures: 0,
    reopenCount: 0,
    retryAfterMs: 0,
    inFlight: null,
  });
  assert.deepEqual(transitions.slice(-1), ['half_open->closed@31000']);
  run(breaker, SUCCESS);
  run(breaker, INFRASTRUCTURE);
  run(breaker, INFRASTRUCTURE);
  assert.equal(breaker.state, CLOSED);
  run(breaker, INFRASTRUCTURE);
  assert.equal(breaker.snapshot().retryAfterMs, 30_000);
});

test('probe failure reopens with bounded exponential backoff', () => {
  const ctx = makeBreaker();
  const { breaker, clock } = ctx;
  tripOpen(ctx);
  clock.t += 30_000;
  const observed = [];
  for (let i = 0; i < 6; i++) {
    run(breaker, INFRASTRUCTURE, LEASE_KINDS.PROBE);
    assert.equal(breaker.state, OPEN);
    const { retryAfterMs, reopenCount } = breaker.snapshot();
    observed.push(retryAfterMs);
    assert.equal(reopenCount, i + 1);
    clock.t += retryAfterMs - 1;
    assert.equal(breaker.state, OPEN);
    clock.t += 1;
    assert.equal(breaker.state, HALF_OPEN);
  }
  assert.deepEqual(observed, [60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
  run(breaker, SUCCESS, LEASE_KINDS.PROBE);
  tripOpen(ctx);
  assert.equal(breaker.snapshot().retryAfterMs, 30_000);
});

test('backoff honours custom factor and cap', () => {
  const ctx = makeBreaker({ openMs: 1_000, backoffFactor: 3, maxOpenMs: 5_000 });
  const { breaker, clock } = ctx;
  tripOpen(ctx);
  const observed = [breaker.snapshot().retryAfterMs];
  for (let i = 0; i < 3; i++) {
    clock.t += observed.at(-1);
    run(breaker, INFRASTRUCTURE, LEASE_KINDS.PROBE);
    observed.push(breaker.snapshot().retryAfterMs);
  }
  assert.deepEqual(observed, [1_000, 3_000, 5_000, 5_000]);
});

test('content outcome or abandoned probe counts as a failed probe', () => {
  for (const finish of [(l) => l.settle(CONTENT), (l) => l.release()]) {
    const ctx = makeBreaker();
    const { breaker, clock } = ctx;
    tripOpen(ctx);
    clock.t += 30_000;
    finish(breaker.acquire(LEASE_KINDS.PROBE));
    assert.equal(breaker.state, OPEN);
    assert.equal(breaker.snapshot().retryAfterMs, 60_000);
  }
});

test('probe lease in CLOSED behaves like an ordinary request', () => {
  const { breaker } = makeBreaker();
  const lease = breaker.acquire(LEASE_KINDS.PROBE);
  assert.equal(lease.probe, false);
  lease.settle(INFRASTRUCTURE);
  run(breaker, INFRASTRUCTURE, LEASE_KINDS.PROBE);
  assert.equal(breaker.state, CLOSED);
  run(breaker, INFRASTRUCTURE);
  assert.equal(breaker.state, OPEN);
});

test('single-flight: a held lease rejects every other acquire', () => {
  const { breaker } = makeBreaker();
  const lease = breaker.acquire();
  assert.equal(breaker.snapshot().inFlight, 'request');
  rejects(breaker, LEASE_KINDS.REQUEST, 'UPSTREAM_BUSY');
  rejects(breaker, LEASE_KINDS.PROBE, 'UPSTREAM_BUSY');
  lease.settle(SUCCESS);
  assert.equal(breaker.snapshot().inFlight, null);
  breaker.acquire().release();
});

test('lease settles exactly once; later settle/release are no-ops', () => {
  const { breaker } = makeBreaker();
  const first = breaker.acquire();
  assert.equal(first.settle(INFRASTRUCTURE), true);
  assert.equal(first.settled, true);
  assert.equal(first.settle(INFRASTRUCTURE), false);
  assert.equal(first.release(), false);
  assert.equal(breaker.snapshot().consecutiveFailures, 1);

  // A stale lease must not free or account against a newer one.
  const second = breaker.acquire();
  assert.equal(first.settle(INFRASTRUCTURE), false);
  assert.equal(breaker.snapshot().inFlight, 'request');
  assert.equal(breaker.snapshot().consecutiveFailures, 1);
  second.release();
});

test('release without outcome is neutral in CLOSED', () => {
  const { breaker } = makeBreaker();
  run(breaker, INFRASTRUCTURE);
  run(breaker, INFRASTRUCTURE);
  breaker.acquire().release();
  assert.equal(breaker.snapshot().consecutiveFailures, 2);
  assert.equal(breaker.state, CLOSED);
});

test('invalid outcome throws and keeps the lease held', () => {
  const { breaker } = makeBreaker();
  const lease = breaker.acquire();
  assert.throws(() => lease.settle('timeout'), TypeError);
  assert.equal(lease.settled, false);
  rejects(breaker, LEASE_KINDS.REQUEST, 'UPSTREAM_BUSY');
  lease.settle(SUCCESS);
  assert.throws(() => breaker.acquire('search'), TypeError);
});

test('clock going backwards is clamped; non-finite clock throws', () => {
  const ctx = makeBreaker();
  const { breaker, clock } = ctx;
  tripOpen(ctx); // until 31000
  clock.t = 0; // regression must not extend or shorten OPEN
  assert.equal(breaker.snapshot().retryAfterMs, 30_000);
  clock.t = 31_000;
  assert.equal(breaker.state, HALF_OPEN);

  for (const bad of [NaN, Infinity, '5', undefined]) {
    const b = new CircuitBreaker({ now: () => bad });
    assert.throws(() => b.acquire(), TypeError);
  }
});

test('throwing onTransition observer cannot corrupt state', () => {
  const clock = { t: 0 };
  const breaker = new CircuitBreaker({
    now: () => clock.t,
    onTransition: () => {
      throw new Error('observer bug');
    },
  });
  for (let i = 0; i < 3; i++) run(breaker, INFRASTRUCTURE);
  assert.equal(breaker.state, OPEN);
  clock.t = 30_000;
  run(breaker, SUCCESS, LEASE_KINDS.PROBE);
  assert.equal(breaker.state, CLOSED);
});

test('constructor validates options strictly', () => {
  const bad = [
    { failureThreshold: 0 },
    { failureThreshold: 1.5 },
    { windowMs: -1 },
    { openMs: '30000' },
    { maxOpenMs: 10, openMs: 20 },
    { backoffFactor: 0.5 },
    { backoffFactor: Infinity },
    { now: 5 },
    { onTransition: 'x' },
    { threshold: 3 },
  ];
  for (const options of bad) assert.throws(() => new CircuitBreaker(options), TypeError);
  const one = new CircuitBreaker({ failureThreshold: 1, backoffFactor: 1, now: () => 0 });
  run(one, INFRASTRUCTURE);
  assert.equal(one.state, OPEN);
});
