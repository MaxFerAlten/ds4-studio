import test from "node:test";
import assert from "node:assert/strict";
import {
  CallDebugRecorder,
  categorize,
  isStreamResponse,
  sanitizeHeaders,
  sanitizeUrl,
  truncateBody
} from "./callDebug.mjs";

// --- in-memory fake fs (sync subset used by the recorder) -------------------
function fakeFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    mkdirSync() {},
    existsSync: (p) => files.has(p),
    statSync: (p) => ({ size: Buffer.byteLength(files.get(p) || "") }),
    readFileSync: (p) => files.get(p) ?? "",
    writeFileSync: (p, c) => files.set(p, c),
    appendFileSync: (p, c) => files.set(p, (files.get(p) || "") + c),
    renameSync: (a, b) => {
      files.set(b, files.get(a) || "");
      files.delete(a);
    },
    rmSync: (p) => files.delete(p)
  };
}

function makeRes(body, { status = 200, contentType = "application/json" } = {}) {
  const headers = new Map([["content-type", contentType]]);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    clone() {
      return { text: async () => body };
    },
    text: async () => body
  };
}

test("sanitizeUrl masks secret query params, keeps the rest", () => {
  const out = sanitizeUrl("https://serpapi.com/search?q=cats&api_key=SECRET&engine=google");
  assert.match(out, /api_key=\*\*\*/);
  assert.match(out, /engine=google/);
  assert.match(out, /q=cats/);
  assert.doesNotMatch(out, /SECRET/);
});

test("sanitizeUrl passes through non-url strings", () => {
  assert.equal(sanitizeUrl("not a url"), "not a url");
});

test("sanitizeHeaders masks Authorization and api keys", () => {
  const out = sanitizeHeaders({ Authorization: "Bearer abc", "X-Api-Key": "k", Accept: "text/plain" });
  assert.equal(out.Authorization, "***");
  assert.equal(out["X-Api-Key"], "***");
  assert.equal(out.Accept, "text/plain");
});

test("truncateBody adds a suffix marker past the limit", () => {
  assert.equal(truncateBody("hello", 10), "hello");
  assert.equal(truncateBody("hello world", 5), "hello…[+6 chars]");
  assert.equal(truncateBody(null, 5), null);
  assert.equal(truncateBody(123, 5), null);
});

test("categorize splits model base from providers", () => {
  const base = "http://127.0.0.1:8002";
  assert.equal(categorize("http://127.0.0.1:8002/v1/chat/completions", base), "model");
  assert.equal(categorize("https://api.tavily.com/search", base), "provider");
});

test("isStreamResponse detects event-stream", () => {
  assert.equal(isStreamResponse(makeRes("x", { contentType: "text/event-stream" })), true);
  assert.equal(isStreamResponse(makeRes("x", { contentType: "application/json" })), false);
});

test("recorder records, caps the ring, lists newest-first", () => {
  const fs = fakeFs();
  const rec = new CallDebugRecorder({ dir: "/d", maxEntries: 2, maxBodyChars: 100, maxFileBytes: 1e9, fs, clock: () => 0 });
  rec.record({ url: "u1", method: "GET" });
  rec.record({ url: "u2", method: "GET" });
  rec.record({ url: "u3", method: "GET" });
  const list = rec.list({ limit: 10 });
  assert.equal(list.length, 2); // capped
  assert.equal(list[0].url, "u3"); // newest first
  assert.equal(list[1].url, "u2");
  assert.ok(list[0].id && list[0].ts);
  // persisted to disk
  assert.equal((fs.files.get("/d/calls.ndjson") || "").trim().split("\n").length, 3);
});

test("recorder warm-loads the ring tail from disk on construct", () => {
  const line = (u) => JSON.stringify({ id: u, ts: "t", url: u }) + "\n";
  const fs = fakeFs({ "/d/calls.ndjson": line("a") + line("b") + line("c") });
  const rec = new CallDebugRecorder({ dir: "/d", maxEntries: 2, fs, clock: () => 0 });
  const list = rec.list({});
  assert.deepEqual(list.map((e) => e.url), ["c", "b"]);
});

test("recorder rotates when the file exceeds maxFileBytes", () => {
  const fs = fakeFs();
  const rec = new CallDebugRecorder({ dir: "/d", maxEntries: 100, maxBodyChars: 100, maxFileBytes: 30, fs, clock: () => 0 });
  rec.record({ url: "first-call-padding-to-exceed", method: "GET" });
  rec.record({ url: "second", method: "GET" });
  assert.ok(fs.files.has("/d/calls.ndjson.1"), "rotated file exists");
});

test("recorder clear empties ring and files", () => {
  const fs = fakeFs();
  const rec = new CallDebugRecorder({ dir: "/d", maxEntries: 10, maxFileBytes: 5, fs, clock: () => 0 });
  rec.record({ url: "x-very-long-to-force-rotate", method: "GET" });
  rec.record({ url: "y-very-long-to-force-rotate", method: "GET" });
  rec.clear();
  assert.equal(rec.list({}).length, 0);
  assert.equal(fs.files.get("/d/calls.ndjson"), "");
  assert.equal(fs.files.has("/d/calls.ndjson.1"), false);
});

test("wrapped fetch captures a non-stream body and leaves the original readable", async () => {
  const fs = fakeFs();
  const rec = new CallDebugRecorder({ dir: "/d", maxEntries: 10, maxBodyChars: 4, fs, clock: () => 0 });
  const fake = async () => makeRes("RESPONSEBODY", { status: 201 });
  const wrapped = rec.wrap(fake, "http://127.0.0.1:8002");
  const res = await wrapped("https://api.tavily.com/search", { method: "POST", body: "QUERYBODY" });
  assert.equal(await res.text(), "RESPONSEBODY"); // caller body intact
  const [entry] = rec.list({});
  assert.equal(entry.category, "provider");
  assert.equal(entry.status, 201);
  assert.equal(entry.method, "POST");
  assert.equal(entry.reqBody, "QUER…[+5 chars]");
  assert.equal(entry.respBody, "RESP…[+8 chars]");
  assert.equal(entry.error, null);
});

test("wrapped fetch does not consume a stream body", async () => {
  const fs = fakeFs();
  const rec = new CallDebugRecorder({ dir: "/d", maxEntries: 10, maxBodyChars: 100, fs, clock: () => 0 });
  let cloned = false;
  const streamRes = {
    status: 200,
    ok: true,
    headers: new Map([["content-type", "text/event-stream"]]),
    clone() {
      cloned = true;
      return { text: async () => "should-not-read" };
    }
  };
  const wrapped = rec.wrap(async () => streamRes, "http://127.0.0.1:8002");
  await wrapped("http://127.0.0.1:8002/v1/chat/completions", { method: "POST", body: "{}" });
  const [entry] = rec.list({});
  assert.equal(entry.respBody, "[stream]");
  assert.equal(entry.category, "model");
  assert.equal(cloned, false, "stream must not be cloned/read");
});

test("wrapped fetch records network errors", async () => {
  const fs = fakeFs();
  const rec = new CallDebugRecorder({ dir: "/d", maxEntries: 10, fs, clock: () => 0 });
  const wrapped = rec.wrap(async () => {
    throw new Error("ECONNREFUSED");
  }, "http://127.0.0.1:8002");
  await assert.rejects(() => wrapped("https://api.tavily.com/x", { method: "GET" }));
  const [entry] = rec.list({});
  assert.equal(entry.status, null);
  assert.equal(entry.ok, false);
  assert.match(entry.error, /ECONNREFUSED/);
});

test("non-http urls are passed through without recording", async () => {
  const fs = fakeFs();
  const rec = new CallDebugRecorder({ dir: "/d", maxEntries: 10, fs, clock: () => 0 });
  const wrapped = rec.wrap(async () => makeRes("x"), "http://127.0.0.1:8002");
  await wrapped("data:text/plain,hello", {});
  assert.equal(rec.list({}).length, 0);
});
