import test from "node:test";
import assert from "node:assert/strict";
import { assertUrlSafe, checkUrlSafe } from "./ssrfGuard.mjs";

test("allows normal public http(s) urls", () => {
  assert.equal(checkUrlSafe("https://en.wikipedia.org/wiki/Redis").ok, true);
  assert.equal(checkUrlSafe("http://example.com/page").ok, true);
});

test("blocks non-http schemes", () => {
  assert.equal(checkUrlSafe("file:///etc/passwd").ok, false);
  assert.equal(checkUrlSafe("ftp://host/x").ok, false);
  assert.equal(checkUrlSafe("javascript:alert(1)").ok, false);
});

test("blocks localhost and loopback", () => {
  assert.equal(checkUrlSafe("http://localhost:8000/").ok, false);
  assert.equal(checkUrlSafe("http://127.0.0.1/").ok, false);
  assert.equal(checkUrlSafe("http://127.255.1.2/").ok, false);
  assert.equal(checkUrlSafe("http://[::1]/").ok, false);
});

test("blocks private and link-local ranges", () => {
  assert.equal(checkUrlSafe("http://10.0.0.5/").ok, false);
  assert.equal(checkUrlSafe("http://192.168.1.1/").ok, false);
  assert.equal(checkUrlSafe("http://172.16.0.1/").ok, false);
  assert.equal(checkUrlSafe("http://172.31.255.255/").ok, false);
  assert.equal(checkUrlSafe("http://169.254.169.254/").ok, false, "cloud metadata must be blocked");
});

test("allows 172.32 (outside the private /12)", () => {
  assert.equal(checkUrlSafe("http://172.32.0.1/").ok, true);
});

test("blocks cloud metadata hostname", () => {
  assert.equal(checkUrlSafe("http://metadata.google.internal/").ok, false);
});

test("blocks IPv6 unique-local and link-local", () => {
  assert.equal(checkUrlSafe("http://[fd00::1]/").ok, false);
  assert.equal(checkUrlSafe("http://[fe80::1]/").ok, false);
});

test("rejects malformed urls", () => {
  assert.equal(checkUrlSafe("not a url").ok, false);
  assert.equal(checkUrlSafe("").ok, false);
});

test("assertUrlSafe throws with status 400 on blocked url", () => {
  assert.throws(() => assertUrlSafe("http://127.0.0.1/"), (e) => e.status === 400 && /SSRF blocked/.test(e.message));
  assert.doesNotThrow(() => assertUrlSafe("https://example.com/"));
});
