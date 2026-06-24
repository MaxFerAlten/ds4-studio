// Non-regression test for HistoryPanel extraction.
// HistoryPanel is presentational; this test locks the data/function contracts.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  historyHasPersistableAssistant,
  sessionHasAgentMetadata,
  sessionsExposeMetadata
} from "../utils.mjs";

test("HistoryPanel: historyHasPersistableAssistant accepts transcripts ending with empty placeholder", () => {
  assert.equal(historyHasPersistableAssistant([
    { role: "user", content: "do it" },
    { role: "assistant", content: "", tool_calls: [{ id: "1", name: "list" }] },
    { role: "tool", content: "ok" },
    { role: "assistant", content: "", reasoning: "" }
  ]), true);
});

test("HistoryPanel: historyHasPersistableAssistant ignores notices and blank turns", () => {
  assert.equal(historyHasPersistableAssistant([
    { role: "assistant", content: "Agent enabled", agentNotice: true },
    { role: "user", content: "hello" },
    { role: "assistant", content: "", reasoning: "" }
  ]), false);
});

test("HistoryPanel: sessionHasAgentMetadata and sessionsExposeMetadata work correctly", () => {
  assert.equal(sessionHasAgentMetadata({ metadata: { agentMode: true } }), true);
  assert.equal(sessionHasAgentMetadata({ metadata: null }), false);
  assert.equal(sessionsExposeMetadata([{ fileName: "old.md" }]), false);
  assert.equal(sessionsExposeMetadata([{ fileName: "new.md", metadata: null }]), true);
});
