import assert from "node:assert/strict";
import { test } from "node:test";
import { workspaceFromPath, pathForWorkspace } from "./workspaceRouting.mjs";

test("workspaceFromPath maps /agno to agno mode", () => {
  assert.equal(workspaceFromPath("/agno"), "agno");
  assert.equal(workspaceFromPath("/agno/"), "agno");
});

test("workspaceFromPath maps everything else to chat mode", () => {
  assert.equal(workspaceFromPath("/"), "chat");
  assert.equal(workspaceFromPath("/research"), "chat");
  assert.equal(workspaceFromPath(""), "chat");
});

test("pathForWorkspace round-trips agno and chat", () => {
  assert.equal(pathForWorkspace("agno"), "/agno");
  assert.equal(pathForWorkspace("chat"), "/");
  assert.equal(pathForWorkspace("research"), "/");
});
