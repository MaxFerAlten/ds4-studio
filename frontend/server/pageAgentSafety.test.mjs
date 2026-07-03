import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPageAction,
  isAllowedOrigin,
  requiresConfirmation,
  isSensitiveInput,
  validatePageAction
} from "./pageAgentSafety.mjs";

test("classifyPageAction allows safe actions", () => {
  const result = classifyPageAction({ action: "click", target: "chat-send-button" });
  assert.equal(result.allowed, true);
});

test("classifyPageAction flags destructive words", () => {
  const result = classifyPageAction({ action: "click", target: "delete-account-button", elementText: "Delete" });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "destructive_action_requires_confirmation");
  assert.equal(result.requireConfirmation, true);
});

test("classifyPageAction blocks sensitive input", () => {
  const result = classifyPageAction({ action: "input", target: "password-field", elementText: "Password" });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "sensitive_input_blocked");
});

test("classifyPageAction allows non-sensitive input", () => {
  const result = classifyPageAction({ action: "input", target: "chat-input", value: "hello" });
  assert.equal(result.allowed, true);
});

test("isAllowedOrigin matches allowed origins", () => {
  assert.equal(isAllowedOrigin("http://127.0.0.1:5173", ["http://127.0.0.1:5173"]), true);
  assert.equal(isAllowedOrigin("http://localhost:5173", ["http://localhost:5173"]), true);
});

test("isAllowedOrigin rejects unknown origins", () => {
  assert.equal(isAllowedOrigin("https://evil.com", ["http://127.0.0.1:5173"]), false);
  assert.equal(isAllowedOrigin("", ["http://127.0.0.1:5173"]), false);
});

test("validatePageAction rejects missing args", () => {
  const result = validatePageAction({});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PAGEAGENT_INVALID_ARGS");
});

test("validatePageAction rejects invalid action", () => {
  const result = validatePageAction({ action: "execute_javascript", target: "x" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PAGEAGENT_INVALID_ACTION");
});

test("validatePageAction rejects disallowed origin", () => {
  const result = validatePageAction(
    { action: "click", target: "test" },
    { url: "https://evil.com", allowedOrigins: ["http://127.0.0.1:5173"] }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PAGEAGENT_ORIGIN_DENIED");
});

test("validatePageAction blocks destructive actions", () => {
  const result = validatePageAction(
    { action: "click", target: "delete-button" },
    { elementText: "Delete account" }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PAGEAGENT_DESTRUCTIVE_CONFIRMATION_REQUIRED");
});

test("validatePageAction blocks sensitive input", () => {
  const result = validatePageAction(
    { action: "input", target: "password-input" },
    { elementText: "Password" }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PAGEAGENT_SENSITIVE_INPUT_BLOCKED");
});

test("validatePageAction allows valid safe actions", () => {
  const result = validatePageAction(
    { action: "click", target: "chat-send-button" },
    { url: "http://127.0.0.1:5173", allowedOrigins: ["http://127.0.0.1:5173"] }
  );
  assert.equal(result.ok, true);
});
