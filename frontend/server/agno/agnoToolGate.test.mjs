import assert from "node:assert";
import { describe, it } from "node:test";
import { AgnoToolGate } from "./agnoToolGate.mjs";

async function settle() {
  await new Promise((r) => setImmediate(r));
}

describe("AgnoToolGate", () => {
  it("prima acquisizione immediata: resolves right away when a slot is free", async () => {
    const gate = new AgnoToolGate({});
    const lease = await gate.acquire();
    assert(lease.acquiredAt > 0);
    assert.strictEqual(gate.status().inflight, 1);
    lease.release();
    assert.strictEqual(gate.status().inflight, 0);
  });

  it("seconda in coda: a second acquire queues while the first is held", async () => {
    const gate = new AgnoToolGate({ maxInflight: 1 });
    const l1 = await gate.acquire();
    const p2 = gate.acquire();
    await settle();
    assert.strictEqual(gate.status().inflight, 1);
    assert.strictEqual(gate.status().queued, 1);

    l1.release();
    const l2 = await p2;
    assert(l2.acquiredAt > 0);
    l2.release();
    assert.strictEqual(gate.status().queued, 0);
  });

  it("FIFO: queued acquires resolve in the order they were requested", async () => {
    const gate = new AgnoToolGate({ maxInflight: 1 });
    const order = [];

    const l1 = await gate.acquire();
    order.push(1);

    const p2 = gate.acquire().then((l) => { order.push(2); return l; });
    const p3 = gate.acquire().then((l) => { order.push(3); return l; });
    const p4 = gate.acquire().then((l) => { order.push(4); return l; });

    await settle();
    l1.release();
    const l2 = await p2;
    await settle();
    l2.release();
    const l3 = await p3;
    await settle();
    l3.release();
    const l4 = await p4;
    await settle();
    l4.release();

    assert.deepStrictEqual(order, [1, 2, 3, 4]);
  });

  it("release idempotente: double release does not double-decrement inflight", async () => {
    const gate = new AgnoToolGate({ maxInflight: 1 });
    const lease = await gate.acquire();
    lease.release();
    lease.release();
    assert.strictEqual(gate.status().inflight, 0);
  });

  it("queue full: rejects with AGNO_TOOL_QUEUE_FULL once the queue is saturated", async () => {
    const gate = new AgnoToolGate({ maxInflight: 1, maxQueued: 2 });
    const l1 = await gate.acquire();
    gate.acquire().catch(() => {});
    gate.acquire().catch(() => {});
    await settle();
    assert.strictEqual(gate.status().queued, 2);

    await assert.rejects(
      () => gate.acquire(),
      (err) => err.code === "AGNO_TOOL_QUEUE_FULL",
    );
    assert.strictEqual(gate.status().totalRejected, 1);

    l1.release();
    await settle();
  });

  it("wait timeout: a queued acquire not drained in time rejects with AGNO_TOOL_WAIT_TIMEOUT", async () => {
    const gate = new AgnoToolGate({ maxInflight: 1, waitTimeoutMs: 15 });
    const l1 = await gate.acquire();
    const p2 = gate.acquire().catch((err) => err);

    // the gate's internal timer is unref'd, so keep the loop alive
    // ourselves long enough for it to fire.
    await new Promise((r) => setTimeout(r, 30));
    const err = await p2;
    assert.strictEqual(err.code, "AGNO_TOOL_WAIT_TIMEOUT");
    assert.strictEqual(gate.status().queued, 0);
    assert.strictEqual(gate.status().totalTimedOut, 1);

    l1.release();
    await settle();
  });

  it("abort prima: an already-aborted signal rejects immediately without ever queueing", async () => {
    const gate = new AgnoToolGate({ maxInflight: 1 });
    const l1 = await gate.acquire();
    const ac = new AbortController();
    ac.abort();

    await assert.rejects(
      () => gate.acquire({ signal: ac.signal }),
      (err) => err.code === "AGNO_TOOL_CANCELLED",
    );
    assert.strictEqual(gate.status().queued, 0);

    l1.release();
  });

  it("abort durante attesa: aborting a queued request rejects it and drains it from the queue", async () => {
    const gate = new AgnoToolGate({ maxInflight: 1 });
    const l1 = await gate.acquire();
    const ac = new AbortController();
    const p2 = gate.acquire({ signal: ac.signal }).catch((err) => err);

    await settle();
    assert.strictEqual(gate.status().queued, 1);

    ac.abort();
    const err = await p2;
    assert.strictEqual(err.code, "AGNO_TOOL_CANCELLED");
    assert.strictEqual(gate.status().queued, 0);

    l1.release();
    await settle();
  });

  it("cancelAll: rejects all currently-queued waiters and closes the gate permanently", async () => {
    const gate = new AgnoToolGate({ maxInflight: 1 });
    const l1 = await gate.acquire();
    const p2 = gate.acquire().catch((err) => err);
    const p3 = gate.acquire().catch((err) => err);
    await settle();

    gate.cancelAll("shutdown");
    const [err2, err3] = await Promise.all([p2, p3]);
    assert.strictEqual(err2.code, "AGNO_TOOL_CANCELLED");
    assert.strictEqual(err3.code, "AGNO_TOOL_CANCELLED");
    assert.strictEqual(gate.status().queued, 0);

    // future acquisitions are rejected too (permanent closure)
    await assert.rejects(
      () => gate.acquire(),
      (err) => err.code === "AGNO_TOOL_CANCELLED",
    );

    l1.release();
  });

  it("metriche: status() exposes the documented fields and counters increment correctly", async () => {
    const gate = new AgnoToolGate({ maxInflight: 1, maxQueued: 1, waitTimeoutMs: 15 });

    assert.deepStrictEqual(
      Object.keys(gate.status()).sort(),
      [
        "inflight", "maxInflight", "maxQueued", "queued",
        "totalAcquired", "totalCancelled", "totalRejected", "totalTimedOut",
      ].sort(),
    );

    const l1 = await gate.acquire();
    assert.strictEqual(gate.status().totalAcquired, 1);

    // fills the single queue slot, then times out
    const p2 = gate.acquire().catch((err) => err);
    await settle();

    // now queue is full -> immediate rejection
    await assert.rejects(() => gate.acquire(), (err) => err.code === "AGNO_TOOL_QUEUE_FULL");
    assert.strictEqual(gate.status().totalRejected, 1);

    // the gate's internal timer is unref'd, so keep the loop alive
    // ourselves long enough for it to fire.
    await new Promise((r) => setTimeout(r, 30));
    const err2 = await p2;
    assert.strictEqual(err2.code, "AGNO_TOOL_WAIT_TIMEOUT");
    assert.strictEqual(gate.status().totalTimedOut, 1);

    l1.release();
    const l2 = await gate.acquire();
    assert.strictEqual(gate.status().totalAcquired, 2);

    const ac = new AbortController();
    const p3 = gate.acquire({ signal: ac.signal }).catch((err) => err);
    await settle();
    ac.abort();
    const err3 = await p3;
    assert.strictEqual(err3.code, "AGNO_TOOL_CANCELLED");
    assert.strictEqual(gate.status().totalCancelled, 1);

    assert.strictEqual(gate.status().maxInflight, 1);
    assert.strictEqual(gate.status().maxQueued, 1);

    l2.release();
  });

  it("nessun lease negativo: inflight never drops below 0", async () => {
    const gate = new AgnoToolGate({ maxInflight: 1 });
    const lease = await gate.acquire();
    lease.release();
    lease.release();
    lease.release();
    assert.strictEqual(gate.status().inflight, 0);

    // releasing after cancelAll must also never go negative
    const gate2 = new AgnoToolGate({ maxInflight: 1 });
    const l2 = await gate2.acquire();
    gate2.cancelAll("shutdown");
    l2.release();
    l2.release();
    assert(gate2.status().inflight >= 0);
    assert.strictEqual(gate2.status().inflight, 0);
  });
});
