import assert from "node:assert/strict";
import test from "node:test";

import { approveEvolutionRevision, listEvolutionRuns, startEvolutionRun } from "./evolutionApi.mjs";

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
