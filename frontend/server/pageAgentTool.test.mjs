import { test } from "node:test";
import assert from "node:assert/strict";
import { toolPageSnapshot, toolPageAction } from "./pageAgentTool.mjs";

test("page_snapshot returns snapshot content", async () => {
  const result = await toolPageSnapshot({ includeControls: true });
  assert.equal(result.isError, false);
  assert.match(result.content, /URL:/);
  assert.match(result.content, /data-agent-id=/);
});

test("page_snapshot without controls omits control list", async () => {
  const result = await toolPageSnapshot({ includeControls: false });
  assert.equal(result.isError, false);
  assert.ok(!result.content.includes("data-agent-id="));
});

test("page_action requires action and target", async () => {
  const result = await toolPageAction({});
  assert.equal(result.isError, true);
  assert.match(result.content, /PAGEAGENT_INVALID_ARGS/);
});

test("page_action rejects invalid action", async () => {
  const result = await toolPageAction({ action: "execute_javascript", target: "test" });
  assert.equal(result.isError, true);
  assert.match(result.content, /PAGEAGENT_INVALID_ACTION/);
});

test("page_action accepts valid actions", async () => {
  for (const action of ["click", "input", "select", "scroll", "wait"]) {
    const result = await toolPageAction({ action, target: "chat-send-button" });
    assert.equal(result.isError, false, `${action} should not error`);
    assert.match(result.content, new RegExp(`Action: ${action}`));
  }
});

test("page_action includes value when provided", async () => {
  const result = await toolPageAction({ action: "input", target: "chat-input", value: "hello" });
  assert.equal(result.isError, false);
  assert.match(result.content, /Value: hello/);
});

test("page_action blocks destructive actions via safety", async () => {
  const result = await toolPageAction({ action: "click", target: "delete-button" });
  assert.equal(result.isError, true);
  assert.match(result.content, /PAGEAGENT_DESTRUCTIVE_CONFIRMATION_REQUIRED/);
});

test("page_action blocks sensitive input via safety", async () => {
  const result = await toolPageAction({ action: "input", target: "password-field" });
  assert.equal(result.isError, true);
  assert.match(result.content, /PAGEAGENT_SENSITIVE_INPUT_BLOCKED/);
});

test("page_action includes safety result in output", async () => {
  const result = await toolPageAction({ action: "click", target: "chat-send-button" });
  assert.equal(result.isError, false);
  assert.match(result.content, /Safety: passed/);
});
