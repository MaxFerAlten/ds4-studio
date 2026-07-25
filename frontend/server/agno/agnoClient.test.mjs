import assert from "node:assert";
import { describe, it } from "node:test";
import { AgnoClient } from "./agnoClient.mjs";

describe("AgnoClient", () => {
  const baseUrl = "http://127.0.0.1:7777";
  const serviceToken = "x".repeat(43);
  const ownerId = "test-owner-id";

  function mockFetch(result) {
    return async (url, options = {}) => {
      return {
        ok: true,
        status: 200,
        json: async () => result,
        body: null,
      };
    };
  }

  it("health() calls /ds4/health", async () => {
    const client = new AgnoClient({ baseUrl, serviceToken, ownerId, fetchImpl: mockFetch({ ok: true }) });
    const result = await client.health();
    assert(result.ok === true);
  });

  it("catalog() calls /ds4/catalog with auth headers", async () => {
    const client = new AgnoClient({ baseUrl, serviceToken, ownerId, fetchImpl: mockFetch({ agents: [] }) });
    const result = await client.catalog();
    assert(result.agents.length === 0);
  });

  it("createRun() sends POST to /ds4/runs", async () => {
    const client = new AgnoClient({ baseUrl, serviceToken, ownerId, fetchImpl: mockFetch({ runId: "abc" }) });
    const result = await client.createRun({ targetType: "agent", targetId: "ds4-assistant", message: "hi" });
    assert(result.runId === "abc");
  });

  it("listRuns() sends GET to /ds4/runs", async () => {
    const client = new AgnoClient({ baseUrl, serviceToken, ownerId, fetchImpl: mockFetch({ runs: [{ runId: "abc" }] }) });
    const result = await client.listRuns();
    assert(result.runs.length === 1);
  });

  it("getRun() sends GET to /ds4/runs/:id", async () => {
    const client = new AgnoClient({ baseUrl, serviceToken, ownerId, fetchImpl: mockFetch({ runId: "abc" }) });
    const result = await client.getRun("abc");
    assert(result.runId === "abc");
  });

  it("cancelRun() sends POST to /ds4/runs/:id/cancel", async () => {
    const client = new AgnoClient({ baseUrl, serviceToken, ownerId, fetchImpl: mockFetch({ status: "cancelled" }) });
    const result = await client.cancelRun("abc");
    assert(result.status === "cancelled");
  });

  it("traces() sends GET to /ds4/traces", async () => {
    const client = new AgnoClient({ baseUrl, serviceToken, ownerId, fetchImpl: mockFetch({ traces: [] }) });
    const result = await client.traces();
    assert(result.traces.length === 0);
  });
});
