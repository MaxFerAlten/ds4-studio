// WP7 of convergenza.loop.md: system prompt reminders in the JS loop.
//
// The trigger is a copy of agent_worker_maybe_append_system_prompt_reminder
// (studio/ds4_agent.c of the composed shadow, line 3426):
//   - the session remembers the transcript position of the last prompt
//     (C: last_system_prompt_reminder_at, in tokens; JS: lastAtTokens, in
//     estimated tokens because the JS loop has no local tokenizer);
//   - tool results accumulate into a burst counter;
//   - burst >= reminderToolBurstTokens OR distance >= systemPromptReminderTokens
//     appends the reminder; the first call only notes the position.
// The thresholds come from config/agent-loop-policy.json (WP2), never from
// literals here.
//
// Declared deviations from the C (plan §10 imposes them):
//   - the reminder rides as role "user" with the "[DS4 Studio]" prefix:
//     Qwen chat templates reject a non-leading "system" message, and the
//     summary turn (AGENT_ITERATION_LIMIT_PROMPT) already works this way;
//   - both counters restart after a reminder.  The C resets only
//     last_system_prompt_reminder_at: tool_result_tokens_since_reminder is
//     never assigned 0 there (only += at shadow line 3348 and read at 3431),
//     so a C session past the burst threshold reminds every turn.  The plan
//     (§10 "dopo il reminder i contatori ripartono") asks for the restart;
//     the difference is recorded for section 23.
//   - token counts are estimates (characters / 3.5), as the plan allows;
//     the C counts real tokens (also recorded for section 23).

export function estimateTextTokens(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  return Math.ceil(s.length / 3.5);
}

function messageText(message) {
  const content = message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join("")
      : content == null ? "" : JSON.stringify(content);
  // Tool-call arguments count toward the prompt like any content.
  return Array.isArray(message?.tool_calls) && message.tool_calls.length
    ? `${text}\n${JSON.stringify(message.tool_calls.map((call) => call?.function ?? call))}`
    : text;
}

export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const message of messages ?? []) {
    const reasoning = message?.reasoning_content || message?.reasoning || "";
    total += estimateTextTokens(`${message?.role ?? "user"}\n${reasoning}${messageText(message)}`);
  }
  return total;
}

export function createReminderState() {
  return { lastAtTokens: 0, toolTokensSince: 0 };
}

// "[DS4 Studio] ..." like the summary turn; never a second prefix.
function prefixed(content) {
  const text = String(content ?? "");
  return text.startsWith("[DS4 Studio]") ? text : `[DS4 Studio] ${text}`;
}

// The replacement for every mid-conversation fullMessages.push({role:
// "system", ...}): guidance must reach the model as a user turn.
export function pushGuidanceMessage(messages, content) {
  const message = { role: "user", content: prefixed(content) };
  messages.push(message);
  return message;
}

// maybeAppendSystemPromptReminder({ messages, reminder, thresholds, reminderText })
//   -> { appended, reason: "init" | "burst" | "distance" | null, tokens }
//
// thresholds: { systemPromptReminderTokens, reminderToolBurstTokens } from
// the shared policy.  reminderText is the JS prompt's own sections (core
// rules + epistemic rules, plus the Evidence Core Contract when loaded); the
// C's DSML reminder text is deliberately not reused (plan §10 point 4).
export function maybeAppendSystemPromptReminder({
  messages,
  reminder,
  thresholds = {},
  reminderText = ""
} = {}) {
  if (!messages || !reminder) throw new Error("messages and reminder are required");
  const tokens = estimateMessagesTokens(messages);
  if (reminder.lastAtTokens <= 0) {
    reminder.lastAtTokens = tokens; // agent_worker_note_system_prompt_seen
    return { appended: false, reason: "init", tokens };
  }
  const burstThreshold = Number(thresholds.reminderToolBurstTokens) || 20000;
  const distanceThreshold = Number(thresholds.systemPromptReminderTokens) || 50000;
  const burst = reminder.toolTokensSince >= burstThreshold;
  if (!burst && tokens - reminder.lastAtTokens < distanceThreshold) {
    return { appended: false, reason: null, tokens };
  }
  const message = pushGuidanceMessage(messages, reminderText);
  // The C notes the position after the append, so the reminder itself counts
  // into lastAtTokens.
  reminder.lastAtTokens = tokens + estimateMessagesTokens([message]);
  reminder.toolTokensSince = 0; // plan §10: the counters restart (C does not; declared)
  return { appended: true, reason: burst ? "burst" : "distance", tokens };
}
