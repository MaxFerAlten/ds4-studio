import assert from "node:assert/strict";
import test from "node:test";
import {
  historyHasPersistableAssistant,
  sessionHasAgentMetadata,
  sessionsExposeMetadata
} from "./utils.mjs";

test("historyHasPersistableAssistant accepts agent transcripts ending with an empty placeholder", () => {
  assert.equal(historyHasPersistableAssistant([
    { role: "user", content: "do it" },
    { role: "assistant", content: "", tool_calls: [{ id: "1", name: "list" }] },
    { role: "tool", content: "ok" },
    { role: "assistant", content: "", reasoning: "" }
  ]), true);
});

test("historyHasPersistableAssistant ignores UI notices and blank turns", () => {
  assert.equal(historyHasPersistableAssistant([
    { role: "assistant", content: "Agent enabled", agentNotice: true },
    { role: "user", content: "hello" },
    { role: "assistant", content: "", reasoning: "" }
  ]), false);
});

test("history metadata helpers distinguish stale summaries from non-agent sessions", () => {
  assert.equal(sessionHasAgentMetadata({ metadata: { agentMode: true } }), true);
  assert.equal(sessionHasAgentMetadata({ metadata: null }), false);
  assert.equal(sessionsExposeMetadata([{ fileName: "old.md" }]), false);
  assert.equal(sessionsExposeMetadata([{ fileName: "new.md", metadata: null }]), true);
});
