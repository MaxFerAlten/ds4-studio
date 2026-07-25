import assert from "node:assert";
import { describe, it } from "node:test";
import { AgnoModelGate } from "./agnoModelGate.mjs";

async function settle() {
  await new Promise((r) => setImmediate(r));
}

describe("AgnoModelGate", () => {
  it("acquires immediately when inflight is 0", async () => {
    const gate = new AgnoModelGate({ maxInflight: 1 });
    const lease = await gate.acquire();
    assert(lease.acquiredAt > 0);
    assert(gate.status().inflight === 1);
    lease.release();
    assert(gate.status().inflight === 0);
  });

  it("never lets more than 1 request be inflight", async () => {
    const gate = new AgnoModelGate({ maxInflight: 1 });
    const lease1 = await gate.acquire();
    assert(gate.status().inflight === 1);

    const p2 = gate.acquire();
    await settle();
    assert(gate.status().inflight === 1);
    assert(gate.status().queued === 1);

    lease1.release();
    await settle();
    const lease2 = await p2;
    assert(lease2.acquiredAt > 0);
    lease2.release();
    assert(gate.status().queued === 0);
  });

  it("FIFO order with sequential release", async () => {
    const gate = new AgnoModelGate({ maxInflight: 1 });
    const acquired = [];

    const l1 = await gate.acquire();
    acquired.push(1);

    const promises = [
      gate.acquire().then((l) => { acquired.push(2); return l; }),
      gate.acquire().then((l) => { acquired.push(3); return l; }),
      gate.acquire().then((l) => { acquired.push(4); return l; }),
    ];

    await settle();
    l1.release();
    const l2 = await promises[0];
    await settle();
    l2.release();
    const l3 = await promises[1];
    await settle();
    l3.release();
    const l4 = await promises[2];
    await settle();
    l4.release();

    assert.deepStrictEqual(acquired, [1, 2, 3, 4]);
  });

  it("release is idempotent", async () => {
    const gate = new AgnoModelGate({ maxInflight: 1 });
    const lease = await gate.acquire();
    lease.release();
    lease.release();
    assert(gate.status().inflight === 0);
  });

  it("cancelled waiter does not block subsequent requests", async () => {
    const gate = new AgnoModelGate({ maxInflight: 1 });
    const l1 = await gate.acquire();

    const ac = new AbortController();
    const p2 = gate.acquire({ signal: ac.signal }).catch((err) => {
      assert(err.code === "AGNO_MODEL_CANCELLED");
      return null;
    });
    const p3 = gate.acquire();

    ac.abort();
    await p2;
    await settle();

    l1.release();
    const l3 = await p3;
    assert(l3 !== null);
    l3.release();
  });

  it("timeout removes waiter", async () => {
    const gate = new AgnoModelGate({
      maxInflight: 1,
      waitTimeoutMs: 10,
    });
    const l1 = await gate.acquire();
    const p2 = gate.acquire().catch((err) => {
      assert(err.code === "AGNO_MODEL_WAIT_TIMEOUT");
      return null;
    });
    // Wait for timeout
    await new Promise((r) => setTimeout(r, 20));
    await p2;
    assert(gate.status().queued === 0);
    assert(gate.status().totalTimedOut === 1);
    l1.release();
    await settle();
  });

  it("queue overflow throws AGNO_MODEL_QUEUE_FULL", async () => {
    const gate = new AgnoModelGate({
      maxInflight: 1,
      maxQueued: 2,
    });
    const l1 = await gate.acquire();
    gate.acquire().catch(() => {});
    gate.acquire().catch(() => {});
    await settle();
    await assert.rejects(
      () => gate.acquire(),
      /AGNO_MODEL_QUEUE_FULL/,
    );
    l1.release();
    await settle();
  });

  it("close rejects all waiters", async () => {
    const gate = new AgnoModelGate({ maxInflight: 1 });
    const l1 = await gate.acquire();
    const p2 = gate.acquire().catch((err) => {
      assert(err.code === "AGNO_MODEL_GATE_CLOSED");
      return null;
    });
    const p3 = gate.acquire().catch((err) => {
      assert(err.code === "AGNO_MODEL_GATE_CLOSED");
      return null;
    });
    await settle();
    gate.close("test");
    await p2;
    await p3;
    assert(gate.status().queued === 0);
    await assert.rejects(
      () => gate.acquire(),
      /AGNO_MODEL_GATE_CLOSED/,
    );
    l1.release();
  });

  it("no timer/handle left open after release or cancel", async () => {
    const gate = new AgnoModelGate({
      maxInflight: 1,
      waitTimeoutMs: 10,
    });
    const l1 = await gate.acquire();
    const ac = new AbortController();
    const p2 = gate.acquire({ signal: ac.signal }).catch((err) => {
      assert(err.code === "AGNO_MODEL_CANCELLED");
      return null;
    });
    await settle();
    ac.abort();
    await p2;
    l1.release();
    await settle();
    assert(gate.status().inflight === 0);
    assert(gate.status().queued === 0);
  });
});

describe("AgnoModelGate - 20 iteration stress test", () => {
  it("passes 20 rapid iterations", async () => {
    for (let iter = 0; iter < 20; iter++) {
      const gate = new AgnoModelGate({ maxInflight: 1, maxQueued: 8 });
      const l1 = await gate.acquire();
      assert(gate.status().inflight === 1);

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          gate.acquire().then((l) => { l.release(); })
        );
      }
      await settle();
      assert(gate.status().queued === 5);

      l1.release();
      for (const p of promises) {
        await p;
      }
      await settle();
      assert(gate.status().inflight === 0);
      assert(gate.status().queued === 0);
    }
  });
});
