import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createHeadroomHandlers } from "./headroomControl.mjs";

async function withServer(config, requestFn) {
  const saves = [];
  const app = express();
  app.use(express.json());
  const handlers = createHeadroomHandlers({
    getConfig: () => config,
    saveConfig: async (next) => {
      saves.push(next);
      config = next;
      return config;
    }
  });
  app.get("/api/agent/headroom", handlers.status);
  app.post("/api/agent/headroom", handlers.set);

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await requestFn({ baseUrl, saves });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function jsonFetch(url, options) {
  const res = await fetch(url, options);
  return {
    status: res.status,
    json: await res.json()
  };
}

test("GET /api/agent/headroom returns the current compression flag", async () => {
  await withServer({ toolBlobs: { dir: "data/tool-blobs", compressEnabled: true } }, async ({ baseUrl }) => {
    const { status, json } = await jsonFetch(`${baseUrl}/api/agent/headroom`);
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.enabled, true);
  });
});

test("POST /api/agent/headroom persists a boolean compression toggle", async () => {
  await withServer({ toolBlobs: { dir: "data/tool-blobs", compressEnabled: false } }, async ({ baseUrl, saves }) => {
    const { status, json } = await jsonFetch(`${baseUrl}/api/agent/headroom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true })
    });

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.enabled, true);
    assert.equal(json.message, "Headroom compression enabled.");
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].toolBlobs, { dir: "data/tool-blobs", compressEnabled: true });

    const after = await jsonFetch(`${baseUrl}/api/agent/headroom`);
    assert.equal(after.json.enabled, true);
  });
});

test("POST /api/agent/headroom rejects non-boolean enabled values", async () => {
  await withServer({ toolBlobs: { dir: "data/tool-blobs", compressEnabled: false } }, async ({ baseUrl, saves }) => {
    const { status, json } = await jsonFetch(`${baseUrl}/api/agent/headroom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "true" })
    });

    assert.equal(status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error, "enabled must be boolean");
    assert.equal(saves.length, 0);
  });
});
