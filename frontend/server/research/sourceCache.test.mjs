import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SourceCache, cacheKey, isFreshQuery } from "./sourceCache.mjs";

async function tmpCache(t, opts = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-srccache-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new SourceCache({
    dir,
    defaultTtlMs: 1000,
    freshQueryTtlMs: 100,
    ...opts
  });
}

test("cacheKey is stable and option-sensitive", () => {
  assert.equal(
    cacheKey("tavily", "redis", { n: 1 }),
    cacheKey("tavily", "redis", { n: 1 })
  );
  assert.notEqual(
    cacheKey("tavily", "redis", { n: 1 }),
    cacheKey("tavily", "redis", { n: 2 })
  );
});

test("isFreshQuery flags time-sensitive queries", () => {
  assert.equal(isFreshQuery("latest redis news 2026"), true);
  assert.equal(isFreshQuery("redis architecture overview"), false);
});

test("set then get returns the payload while fresh", async (t) => {
  const cache = await tmpCache(t);
  await cache.set("tavily", "redis", {}, { results: [1, 2] });
  const hit = await cache.get("tavily", "redis", {});
  assert.deepEqual(hit, { results: [1, 2] });
});

test("get returns null after the ttl expires", async (t) => {
  let now = 0;
  const cache = await tmpCache(t, { now: () => now });
  await cache.set("tavily", "redis", {}, { results: [1] });
  now = 2000;
  assert.equal(await cache.get("tavily", "redis", {}), null);
});

test("fresh queries use the shorter ttl", async (t) => {
  let now = 0;
  const cache = await tmpCache(t, { now: () => now });
  await cache.set("tavily", "latest redis news", {}, { results: [1] });
  now = 101;
  assert.equal(await cache.get("tavily", "latest redis news", {}), null);
});

test("get returns null on a miss", async (t) => {
  const cache = await tmpCache(t);
  assert.equal(await cache.get("tavily", "nope", {}), null);
});

test("get returns null for corrupt JSON", async (t) => {
  const cache = await tmpCache(t);
  const key = cacheKey("tavily", "broken", {});
  const dir = path.join(cache.dir, "search", "tavily");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${key}.json`), "{broken", "utf8");
  assert.equal(await cache.get("tavily", "broken", {}), null);
});

test("disabled cache is a no-op", async (t) => {
  const cache = await tmpCache(t, { enabled: false });
  await cache.set("tavily", "redis", {}, { results: [1] });
  assert.equal(await cache.get("tavily", "redis", {}), null);
});
