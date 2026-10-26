// Fake backends for agent tests: the server classifies every natural-language
// agent turn with a separate model call (classifyAgentRequestIntent) before the
// scripted agent rounds start. Fixtures written before that call script only the
// agent rounds, so the fake answers the classifier itself with a neutral intent.
// A fixture that wants a specific intent scripts it as its next turn: a turn
// whose content is an intent object is consumed as the classifier's reply.

import { AGENT_INTENT_SYSTEM_PROMPT } from "../agentRequestIntent.mjs";

export const NEUTRAL_INTENT = Object.freeze({
  verification_requested: false, required_tools: [], tool_selection: [], skill_actions: []
});

export function isIntentRequest(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages[0]?.role === "system" && messages[0]?.content === AGENT_INTENT_SYSTEM_PROMPT;
}

export function isScriptedIntent(turn) {
  if (typeof turn?.content !== "string") return false;
  try {
    return typeof JSON.parse(turn.content)?.verification_requested === "boolean";
  } catch {
    return false;
  }
}

export function neutralIntentCompletion(model = "fake") {
  return {
    id: "chatcmpl-intent", object: "chat.completion", created: 0, model,
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(NEUTRAL_INTENT) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}
