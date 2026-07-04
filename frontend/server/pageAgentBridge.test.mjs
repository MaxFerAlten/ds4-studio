import test from "node:test";
import assert from "node:assert/strict";

test("enqueue and resolve a tool", async () => {
  const bridge = await import("./pageAgentBridge.mjs");
  const p = bridge.enqueuePageAgentTool("page_snapshot", {});
  assert.equal(bridge.hasPendingTools(), true);
  const tools = bridge.getPendingTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "page_snapshot");
  const ok = bridge.resolvePageAgentTool(tools[0].id, { content: "done", isError: false });
  assert.equal(ok, true);
  const result = await p;
  assert.deepEqual(result, { content: "done", isError: false });
  assert.equal(bridge.hasPendingTools(), false);
});

test("resolve with unknown id returns false", async () => {
  const bridge = await import("./pageAgentBridge.mjs");
  assert.equal(bridge.resolvePageAgentTool(999), false);
});

test("markClientConnected / isClientConnected / resetClientConnection", async () => {
  const bridge = await import("./pageAgentBridge.mjs");
  assert.equal(bridge.isClientConnected(), false);
  bridge.markClientConnected();
  assert.equal(bridge.isClientConnected(), true);
  bridge.resetClientConnection();
  assert.equal(bridge.isClientConnected(), false);
});

test("setServerEnabled / isServerEnabled", async () => {
  const bridge = await import("./pageAgentBridge.mjs");
  assert.equal(bridge.isServerEnabled(), false);
  bridge.setServerEnabled(true);
  assert.equal(bridge.isServerEnabled(), true);
  bridge.setServerEnabled(false);
  assert.equal(bridge.isServerEnabled(), false);
});

test("getPendingTools returns only active entries", async () => {
  const bridge = await import("./pageAgentBridge.mjs");
  const p1 = bridge.enqueuePageAgentTool("page_snapshot", { includeControls: true });
  const p2 = bridge.enqueuePageAgentTool("page_action", { action: "click" });
  assert.equal(bridge.hasPendingTools(), true);
  const tools = bridge.getPendingTools();
  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, "page_snapshot");
  assert.equal(tools[1].name, "page_action");
  bridge.resolvePageAgentTool(tools[0].id, { content: "a" });
  bridge.resolvePageAgentTool(tools[1].id, { content: "b" });
  await Promise.all([p1, p2]);
  assert.equal(bridge.hasPendingTools(), false);
});
