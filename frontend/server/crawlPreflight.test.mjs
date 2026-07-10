import { test } from "node:test";
import assert from "node:assert/strict";
import { crawlPreflight } from "./crawlPreflight.mjs";
import { proxyNativeAgentCommand } from "./nativeAgentCommands.mjs";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("preflight reports crawl token, service owner, and wrapper mode", async () => {
  const expectedOwner = "ds4-ui:test";
  const token = "x".repeat(43);
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith("/health")) {
      return jsonResponse(200, {
        status: "ok",
        service: "ds4-crawl-service",
        owner: expectedOwner,
        pid: 123
      });
    }
    if (url.endsWith("/auth/check")) {
      return jsonResponse(init.headers?.Authorization === `Bearer ${token}` ? 200 : 401, { ok: true });
    }
    if (url.endsWith("/api/wrapper/status")) {
      return jsonResponse(200, { active_mode: "agent", state: "ready", busy: false });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const res = await crawlPreflight({
    fetchImpl,
    crawlBaseUrl: "http://crawl",
    token,
    expectedOwner,
    wrapperBaseUrl: "http://wrapper",
    wrapperEnabled: true
  });

  assert.equal(res.ok, true);
  assert.equal(res.crawl.health.ok, true);
  assert.equal(res.crawl.token.authOk, true);
  assert.equal(res.crawl.owner.status, "owned");
  assert.equal(res.wrapper.activeMode, "agent");
  assert.equal(res.wrapper.serverReady, false);
});

test("agent mode -> crawl -> server mode keeps each boundary explicit", async () => {
  const expectedOwner = "ds4-ui:test";
  const token = "t".repeat(43);
  let wrapperMode = "agent";
  let pendingUrl = "";
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/health")) {
      return jsonResponse(200, {
        status: "ok",
        service: "ds4-crawl-service",
        owner: expectedOwner,
        pid: 456
      });
    }
    if (url.endsWith("/auth/check")) {
      return jsonResponse(init.headers?.Authorization === `Bearer ${token}` ? 200 : 401, { ok: true });
    }
    if (url.endsWith("/api/wrapper/status")) {
      return jsonResponse(200, { active_mode: wrapperMode, state: "ready", busy: false });
    }
    if (url.endsWith("/api/wrapper/switch-mode")) {
      wrapperMode = JSON.parse(init.body).mode;
      return jsonResponse(200, { ok: true, active_mode: wrapperMode });
    }
    if (url.endsWith("/jobs")) {
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      pendingUrl = JSON.parse(init.body).url;
      return jsonResponse(200, { job_id: "job-1", state: "queued" });
    }
    if (url.endsWith("/jobs/job-1")) {
      return jsonResponse(200, {
        job_id: "job-1",
        state: "succeeded",
        result_manifest: {
          pages: [{ url: pendingUrl, state: "succeeded", content: "page text" }],
          total_pages: 1,
          all_succeeded: true
        }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const before = await crawlPreflight({
    fetchImpl,
    crawlBaseUrl: "http://crawl",
    token,
    expectedOwner,
    wrapperBaseUrl: "http://wrapper",
    wrapperEnabled: true
  });
  assert.equal(before.wrapper.activeMode, "agent");
  assert.equal(before.crawl.token.authOk, true);

  const crawl = await proxyNativeAgentCommand(
    fetchImpl,
    "http://wrapper",
    "/crawl start https://example.com",
    undefined,
    { crawlBaseUrl: "http://crawl", crawlToken: token, pollIntervalMs: 0, maxPolls: 2 }
  );
  assert.equal(crawl.ok, true);

  await fetchImpl("http://wrapper/api/wrapper/switch-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "server" })
  });
  const after = await crawlPreflight({
    fetchImpl,
    crawlBaseUrl: "http://crawl",
    token,
    expectedOwner,
    wrapperBaseUrl: "http://wrapper",
    wrapperEnabled: true
  });

  assert.equal(after.wrapper.activeMode, "server");
  assert.equal(after.wrapper.serverReady, true);
  assert.ok(calls.some((call) => call.url === "http://crawl/jobs"));
});
