import test from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "./rateLimiter.mjs";

test("acquire/release tracks concurrency per provider", async () => {
  const rl = new RateLimiter({ default: { perMinute: 1000, concurrent: 2 } });
  const r1 = await rl.acquire("tavily");
  const r2 = await rl.acquire("tavily");
  let r3done = false;
  const p3 = rl.acquire("tavily").then((r) => {
    r3done = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(r3done, false, "third acquire blocks at concurrency 2");
  r1();
  const r3 = await p3;
  assert.equal(r3done, true, "release frees a slot");
  r2();
  r3();
});

test("perMinute window blocks the (n+1)th call until the window advances", async () => {
  let now = 0;
  const rl = new RateLimiter(
    { default: { perMinute: 2, concurrent: 10 } },
    { now: () => now }
  );
  (await rl.acquire("x"))();
  (await rl.acquire("x"))();
  let fourthStarted = false;
  const p = rl.acquire("x").then((r) => {
    fourthStarted = true;
    r();
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fourthStarted, false, "rate cap reached, blocked");
  now += 60001;
  await p;
  assert.equal(fourthStarted, true);
});

test("unknown provider uses the default bucket", async () => {
  const rl = new RateLimiter({ default: { perMinute: 1000, concurrent: 1 } });
  const release = await rl.acquire("never-configured");
  assert.equal(typeof release, "function");
  release();
});

test("release is idempotent", async () => {
  const rl = new RateLimiter({ default: { perMinute: 1000, concurrent: 1 } });
  const release = await rl.acquire("x");
  release();
  release();
  const next = await rl.acquire("x");
  let extraStarted = false;
  const extraPromise = rl.acquire("x").then((extra) => {
    extraStarted = true;
    return extra;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(extraStarted, false);
  next();
  const extra = await extraPromise;
  extra();
});
