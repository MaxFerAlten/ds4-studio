import test from "node:test";
import assert from "node:assert/strict";
import { toolPageTask } from "./pageAgentTask.mjs";

test("page_task returns error for empty task", async () => {
  const result = await toolPageTask({ task: "" }, {});
  assert.equal(result.isError, true);
  assert.match(result.content, /task description/);
});

test("page_task returns error for missing task", async () => {
  const result = await toolPageTask({}, {});
  assert.equal(result.isError, true);
  assert.match(result.content, /task description/);
});

test("page_task infers click action from task text", async () => {
  const result = await toolPageTask({ task: "Click the send button" }, { uiState: {} });
  assert.equal(result.isError, false);
  assert.match(result.content, /Task: Click the send button/);
  assert.match(result.content, /click/);
  assert.match(result.content, /send/);
  assert.match(result.content, /Initial UI State/);
  assert.match(result.content, /Final UI State/);
});

test("page_task infers input action with value", async () => {
  const result = await toolPageTask({ task: "Type hello in the chat input" }, { uiState: {} });
  assert.equal(result.isError, false);
  assert.match(result.content, /input/);
  assert.match(result.content, /chat input/);
});

test("page_task includes planned action in output", async () => {
  const result = await toolPageTask({ task: "Click the send button" }, { uiState: {} });
  assert.equal(result.isError, false);
  assert.match(result.content, /Planned action/);
});
