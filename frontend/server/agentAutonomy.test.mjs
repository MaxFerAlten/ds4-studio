import { test } from "node:test";
import assert from "node:assert/strict";
import { requiresConfirmation, isSafeTool, autonomyPromptSection } from "./agentAutonomy.mjs";

test("read-only / non-destructive actions do not require confirmation", () => {
  assert.equal(requiresConfirmation({ type: "read" }), false);
  assert.equal(requiresConfirmation({ type: "crawl" }), false);
  assert.equal(requiresConfirmation({}), false);
});

test("destructive / outward-facing actions require confirmation", () => {
  for (const type of ["write", "edit", "delete", "publish", "send", "bash_destructive"]) {
    assert.equal(requiresConfirmation({ type }), true, `${type} must confirm`);
  }
});

test("isSafeTool covers the read-only agent tools", () => {
  for (const name of ["web_search", "web_read", "crawl", "research_discover", "chat_history_search"]) {
    assert.equal(isSafeTool(name), true, `${name} should be safe`);
  }
  assert.equal(isSafeTool("write"), false);
});

test("autonomy prompt section tells the model not to ask permission for safe tools", () => {
  const section = autonomyPromptSection();
  assert.match(section, /Autonomy policy/);
  assert.match(section, /without asking permission/);
  assert.match(section, /crawl/);
  assert.match(section, /never reply "Authorize\?"/);
  assert.match(section, /confirmation only before destructive/);
});
