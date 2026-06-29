import { test } from "node:test";
import assert from "node:assert/strict";
import { crawlUrl } from "./crawlClient.mjs";

function jsonResponse(ok, status, body) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

function mockFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    return next;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const MANIFEST = { pages: [{ url: "https://example.com", state: "succeeded", content: "hi" }] };

test("crawlUrl returns manifest on success", async () => {
  const fetchImpl = mockFetch([
    jsonResponse(true, 200, { job_id: "job-1" }),
    jsonResponse(true, 200, { state: "succeeded", result_manifest: MANIFEST })
  ]);
  const res = await crawlUrl(fetchImpl, { baseUrl: "http://crawl", url: "https://example.com", pollIntervalMs: 0 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.manifest, MANIFEST);
  assert.equal(fetchImpl.calls[0].url, "http://crawl/jobs");
});

test("crawlUrl sends bearer token when provided", async () => {
  const fetchImpl = mockFetch([
    jsonResponse(true, 200, { job_id: "job-1" }),
    jsonResponse(true, 200, { state: "partially_succeeded", result_manifest: MANIFEST })
  ]);
  await crawlUrl(fetchImpl, { baseUrl: "http://crawl", token: "secret", url: "https://example.com", pollIntervalMs: 0 });
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, "Bearer secret");
});

test("crawlUrl rejects invalid url without calling fetch", async () => {
  const fetchImpl = mockFetch([]);
  const res = await crawlUrl(fetchImpl, { baseUrl: "http://crawl", url: "not a url" });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(fetchImpl.calls.length, 0);
});

test("crawlUrl rejects non-http protocol", async () => {
  const res = await crawlUrl(mockFetch([]), { baseUrl: "http://crawl", url: "ftp://example.com" });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
});

test("crawlUrl reports missing config", async () => {
  const res = await crawlUrl(mockFetch([]), { baseUrl: "", url: "https://example.com" });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
});

test("crawlUrl surfaces failed job state", async () => {
  const fetchImpl = mockFetch([
    jsonResponse(true, 200, { job_id: "job-1" }),
    jsonResponse(true, 200, { state: "failed", error: { message: "boom" } })
  ]);
  const res = await crawlUrl(fetchImpl, { baseUrl: "http://crawl", url: "https://example.com", pollIntervalMs: 0 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 502);
  assert.match(res.message, /boom/);
});

test("crawlUrl polls until terminal then times out", async () => {
  const fetchImpl = mockFetch([
    jsonResponse(true, 200, { job_id: "job-1" }),
    jsonResponse(true, 200, { state: "running" }),
    jsonResponse(true, 200, { state: "running" })
  ]);
  const res = await crawlUrl(fetchImpl, { baseUrl: "http://crawl", url: "https://example.com", maxPolls: 2, pollIntervalMs: 0 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 504);
});
