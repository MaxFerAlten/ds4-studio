import assert from "node:assert/strict";
import test from "node:test";

import { approveEvolutionRevision, listEvolutionRuns, startEvolutionRun, submitEvolutionCandidate } from "./evolutionApi.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("Evolution mutations attach Bearer token and exact review body", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return response({ ok: true }); };
  await startEvolutionRun("evo_0123456789abcdefabcd", "secret", { fetchImpl });
  const review = { revision: 1, candidateHash: "a", parentHash: "b", reviewHash: "c", reviewer: "R" };
  await approveEvolutionRevision("evo_0123456789abcdefabcd", 1, review, "secret", { fetchImpl });
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(calls[1].options.body), review);
});

test("Evolution reads do not attach authorization and server errors remain failures", async () => {
  let headers;
  await listEvolutionRuns({ fetchImpl: async (_url, options) => { headers = options.headers; return response({ items: [] }); } });
  assert.equal(headers.Authorization, undefined);
  await assert.rejects(
    () => listEvolutionRuns({ fetchImpl: async () => response({ error: "EVOLUTION_DISABLED" }, 404) }),
    (error) => error.code === "EVOLUTION_DISABLED" && error.status === 404
  );
});

test("submitEvolutionCandidate posts candidate to the manual candidate endpoint with token", async () => {
  let capturedUrl;
  let capturedBody;
  let capturedHeaders;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    capturedHeaders = options.headers;
    return response({ run: {}, result: { state: "MANUAL_REVIEW" } });
  };
  const candidate = { proposal: { revision: 1, summary: "fix" }, patchText: "diff --git a/x b/x" };
  const result = await submitEvolutionCandidate("run-abc", candidate, "tok123", { fetchImpl });
  assert.ok(capturedUrl.includes("/runs/run-abc/candidates"));
  assert.deepEqual(capturedBody, candidate);
  assert.equal(capturedHeaders.Authorization, "Bearer tok123");
  assert.equal(result.result.state, "MANUAL_REVIEW");
});
