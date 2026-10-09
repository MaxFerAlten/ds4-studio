// WP7 of convergenza.loop.md: system prompt reminders in the JS loop.
//
// Threshold semantics were read from agent_worker_maybe_append_system_prompt_reminder
// (studio/ds4_agent.c of the composed shadow, line 3426) and the numbers come
// from config/agent-loop-policy.json via loadAgentLoopPolicy() (WP2):
// systemPromptReminderTokens 50000, reminderToolBurstTokens 20000.
//
// Deviations implemented on purpose (see docs/convergenza/WP7.md):
//   - the reminder is appended as role "user" with the "[DS4 Studio]" prefix
//     (plan §10 point 3: Qwen templates reject a mid-conversation "system");
//   - both counters restart after a reminder (plan §10 "i contatori
//     ripartono"); the C resets only last_system_prompt_reminder_at.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createReminderState,
  estimateTextTokens,
  estimateMessagesTokens,
  maybeAppendSystemPromptReminder,
  pushGuidanceMessage
} from "./agentSystemReminder.mjs";
import { AgentSessionManager } from "./agentSession.mjs";

const THRESHOLDS = { systemPromptReminderTokens: 100, reminderToolBurstTokens: 50 };

function messagesWithTokensAtLeast(chars) {
  // role+content rendering costs a few extra characters; overshoot slightly.
  return [{ role: "user", content: "x".repeat(chars) }];
}

// ---------------------------------------------------------------- estimates

test("estimateTextTokens is characters / 3.5 rounded up", () => {
  assert.equal(estimateTextTokens(""), 0);
  assert.equal(estimateTextTokens("12345"), 2); // ceil(5 / 3.5)
  assert.equal(estimateTextTokens("a".repeat(350)), 100);
  assert.equal(estimateMessagesTokens([{ role: "user", content: "" }]), 2); // "user\n" -> ceil(5/3.5)
});

// ---------------------------------------------------------------- trigger

test("the first call only notes the prompt position", () => {
  const reminder = createReminderState();
  const messages = [{ role: "system", content: "sys" }];
  const result = maybeAppendSystemPromptReminder({
    messages, reminder, thresholds: THRESHOLDS, reminderText: "REMINDER"
  });
  assert.equal(result.appended, false);
  assert.equal(result.reason, "init");
  assert.ok(reminder.lastAtTokens > 0);
  assert.equal(messages.length, 1);
});

test("below both thresholds nothing is appended", () => {
  const reminder = createReminderState();
  const messages = [{ role: "system", content: "sys" }];
  maybeAppendSystemPromptReminder({ messages, reminder, thresholds: THRESHOLDS, reminderText: "R" });
  messages.push(...messagesWithTokensAtLeast(100)); // ~30 tokens < 100
  const result = maybeAppendSystemPromptReminder({ messages, reminder, thresholds: THRESHOLDS, reminderText: "R" });
  assert.equal(result.appended, false);
  assert.equal(result.reason, null);
});

test("the distance threshold appends once and restarts the counters", () => {
  const reminder = createReminderState();
  const messages = [{ role: "system", content: "sys" }];
  maybeAppendSystemPromptReminder({ messages, reminder, thresholds: THRESHOLDS, reminderText: "R" });
  messages.push(...messagesWithTokensAtLeast(1000)); // ~287 tokens >= 100

  const result = maybeAppendSystemPromptReminder({
    messages, reminder, thresholds: THRESHOLDS, reminderText: "CORE RULES\n\nEPISTEMIC"
  });
  assert.equal(result.appended, true);
  assert.equal(result.reason, "distance");
  const appended = messages.at(-1);
  assert.equal(appended.role, "user"); // never "system" mid-conversation
  assert.ok(appended.content.startsWith("[DS4 Studio]"));
  assert.match(appended.content, /CORE RULES/);
  assert.match(appended.content, /EPISTEMIC/);
  assert.ok(reminder.lastAtTokens > 0);
  assert.equal(reminder.toolTokensSince, 0);

  // Immediately after, the distance is back below the threshold.
  const again = maybeAppendSystemPromptReminder({
    messages, reminder, thresholds: THRESHOLDS, reminderText: "R"
  });
  assert.equal(again.appended, false);
});

test("the tool burst appends even with a small distance", () => {
  const reminder = createReminderState();
  const messages = [{ role: "system", content: "sys" }];
  maybeAppendSystemPromptReminder({ messages, reminder, thresholds: THRESHOLDS, reminderText: "R" });
  reminder.toolTokensSince = THRESHOLDS.reminderToolBurstTokens; // one huge tool result

  const result = maybeAppendSystemPromptReminder({ messages, reminder, thresholds: THRESHOLDS, reminderText: "R" });
  assert.equal(result.appended, true);
  assert.equal(result.reason, "burst");
  assert.equal(reminder.toolTokensSince, 0); // the burst counter restarts too
});

// ---------------------------------------------------------------- guidance

test("pushGuidanceMessage never writes system after the first message", () => {
  const messages = [{ role: "system", content: "the one system prompt" }];
  pushGuidanceMessage(messages, "repair guidance");
  pushGuidanceMessage(messages, "[DS4 Studio] already prefixed");
  assert.equal(messages.length, 3);
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "[DS4 Studio] repair guidance");
  assert.equal(messages[2].content, "[DS4 Studio] already prefixed"); // no double prefix
  for (const message of messages.slice(1)) assert.notEqual(message.role, "system");
});

test("the JS loop source contains no mid-conversation system push", () => {
  // The plan requires the proof that after the first message no "system"
  // ever appears: every former fullMessages.push({ role: "system" }) site
  // must be gone from index.mjs.
  const source = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  assert.equal(/fullMessages\.\s*push\(\s*\{\s*role:\s*"system"/.test(source), false);
});

// ---------------------------------------------------------------- session

test("AgentSessionManager owns and resets the reminder state", () => {
  const manager = new AgentSessionManager();
  assert.deepEqual(manager.reminder, { lastAtTokens: 0, toolTokensSince: 0 });
  manager.reminder.lastAtTokens = 42;
  manager.start();
  assert.deepEqual(manager.reminder, { lastAtTokens: 0, toolTokensSince: 0 });
  manager.reminder.toolTokensSince = 7;
  manager.state = { messages: [], messageHashes: [], revision: 0 };
  manager.reset();
  assert.deepEqual(manager.reminder, { lastAtTokens: 0, toolTokensSince: 0 });
});
