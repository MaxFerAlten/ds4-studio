const VERIFIER_TOOLS = new Set(["sage", "lean_check", "lean_prepare", "lean_inspect"]);
const SUMMARY_PREFIX = "[DS4 VERIFICATION HISTORY SUMMARY]";

// The verifier policies live in the system prompt; the phase instruction is a
// short message appended after the newest result, in the same form as the
// plan's own nudges, so a phase change only adds tokens at the tail.
export function verificationPhaseInstruction(plan) {
  return `[DS4 Studio] ${plan.complete ? plan.finalPrompt() : plan.promptForActiveVerifier()}`;
}

function messageText(message) {
  return typeof message?.content === "string" ? message.content : "";
}

function isPlanInstruction(message) {
  if (message?.role !== "user") return false;
  const text = messageText(message).trim();
  return /(?:^|\n)(?:\[DS4 Studio\]\s*)?VERIFICATION_(?:PLAN(?:_COMPLETE)?|CALL_REQUIRED)\b/.test(text);
}

function shortOutcome(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const code = normalized.match(/\b(?:LEAN|SAGE)_[A-Z0-9_]+\b/)?.[0];
  if (code) return code;
  return normalized.slice(0, 180) || "risultato ricevuto";
}

/**
 * Keep the original conversation and the newest verifier call/result, while
 * replacing earlier source/result pairs from this verification turn with a
 * bounded summary. The UI transcript is untouched; this only reduces the
 * model context and the server-side continuation state for the active turn.
 */
export function compactVerificationConversation(messages, {
  turnAnchor,
  activeInstruction,
  activeTool,
  activeTools,
  blockedCallIds = [],
  maxSummaryEntries = 4,
  maxRetainedCalls = 1,
  maxRetainedChars = 24000
} = {}) {
  if (!Array.isArray(messages) || !turnAnchor || typeof activeInstruction !== "string") {
    return { messages, compactedCalls: 0, changed: false };
  }
  let start = messages.indexOf(turnAnchor);
  if (start < 0) {
    const anchorContent = messageText(turnAnchor);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user" && messageText(messages[index]) === anchorContent) {
        start = index;
        break;
      }
    }
  }
  if (start < 0) return { messages, compactedCalls: 0, changed: false };

  const callGroups = [];
  const nameByCallId = new Map();
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    const verifierCalls = message.tool_calls;
    if (!verifierCalls.length) continue;
    const ids = verifierCalls.map((call) => String(call.id || "")).filter(Boolean);
    for (const call of verifierCalls) nameByCallId.set(String(call.id || ""), call.function.name);
    callGroups.push({ index, ids, calls: verifierCalls });
  }

  const blocked = new Set(blockedCallIds.map(String));
  const contextTools = new Set(activeTools?.length ? activeTools : activeTool ? [activeTool] : VERIFIER_TOOLS);
  const turnMessages = messages.slice(start);
  const existingSummary = turnMessages.find((message) => messageText(message).startsWith(SUMMARY_PREFIX));
  const priorCount = Number(messageText(existingSummary).match(/\n(\d+) prior verifier call/)?.[1] || 0);
  // Every round stays append-only while the turn fits the window: rewriting an
  // earlier message (a phase change, a blocked batch) re-prefills everything
  // after it, a Sage report and its reasoning included. Only an overflowing
  // window is compacted, and that one rewrite then buys another full window.
  const windowFits = maxRetainedCalls > 1 &&
    callGroups.length <= maxRetainedCalls &&
    JSON.stringify(turnMessages).length <= maxRetainedChars;
  if (windowFits) {
    const hasInstruction = messageText(turnMessages.findLast(isPlanInstruction)) === activeInstruction;
    return {
      messages: hasInstruction ? messages : [...messages, { role: "user", content: activeInstruction }],
      compactedCalls: priorCount,
      retainedCalls: callGroups.length,
      changed: !hasInstruction
    };
  }
  // A rejected Sage/foreign/mixed batch must never displace the Lean source
  // and diagnostics needed to repair the active proof.
  const latest = callGroups.findLast((group) => group.calls.length === 1 &&
    group.calls.every((call) => VERIFIER_TOOLS.has(call.function?.name) &&
      contextTools.has(call.function.name) && !blocked.has(String(call.id))));
  const proof = contextTools.has("lean_check") ? callGroups.findLast((group) => group.calls.length === 1 &&
    group.calls[0].function?.name === "lean_check" && !blocked.has(String(group.calls[0].id))) : null;
  const retained = new Set([latest, proof].filter(Boolean));
  const previous = callGroups.filter((group) => !retained.has(group));
  const previousIds = new Set(previous.flatMap((group) => group.ids));
  const latestIds = new Set([...retained].flatMap((group) => group.ids));
  const outcomes = new Map();
  for (const message of messages.slice(start)) {
    if (message?.role === "tool" && previousIds.has(String(message.tool_call_id || ""))) {
      const name = nameByCallId.get(String(message.tool_call_id)) || "verificatore";
      const outcome = shortOutcome(messageText(message));
      const key = `${name}: ${outcome}`;
      outcomes.set(key, (outcomes.get(key) || 0) + 1);
    }
  }

  const compacted = messages.slice(0, start);
  const priorEntries = existingSummary ? messageText(existingSummary).split("\n").slice(2, -1) : [];
  const retainedIndices = new Set([...retained].map((group) => group.index));
  for (let offset = 0; offset < turnMessages.length; offset += 1) {
    const message = turnMessages[offset];
    const absoluteIndex = start + offset;
    if (isPlanInstruction(message) || messageText(message).startsWith(SUMMARY_PREFIX)) {
      continue;
    }
    if (message?.role === "assistant" && Array.isArray(message.tool_calls)) {
      if (message.tool_calls.length && !retainedIndices.has(absoluteIndex)) {
        continue;
      }
    }
    if (message?.role === "tool" && previousIds.has(String(message.tool_call_id || ""))) {
      continue;
    }
    if (message?.role === "assistant" && !retainedIndices.has(absoluteIndex)) {
      // Provisional prose and reasoning from earlier verification rounds is
      // not evidence; the exact tool receipt is represented below instead.
      continue;
    }
    if (message?.role === "tool" && latestIds.size && !latestIds.has(String(message.tool_call_id || "")) &&
        nameByCallId.has(String(message.tool_call_id || ""))) {
      continue;
    }
    compacted.push(message);
  }

  const compactedCalls = priorCount + previous.reduce((count, group) => count + group.calls.length, 0);
  if (compactedCalls || outcomes.size) {
    const entries = [...new Set([
      ...priorEntries,
      ...[...outcomes.entries()].map(([outcome, count]) => `${outcome}${count > 1 ? ` (×${count})` : ""}`)
    ])].slice(-Math.max(1, Number(maxSummaryEntries) || 4));
    const summary = [
      SUMMARY_PREFIX,
      `${compactedCalls} prior verifier call(s) omitted from model context; older source bodies are not repeated.`,
      ...entries,
      "Use the retained source/result and the active verifier instruction; blocked calls are not executions."
    ].join("\n");
    compacted.push(messageText(existingSummary) === summary ? existingSummary : { role: "user", content: summary });
  }

  const last = messages.at(-1);
  compacted.push(last?.role === "user" && messageText(last) === activeInstruction ? last : { role: "user", content: activeInstruction });
  const retainedCalls = [...retained].reduce((count, group) => count + group.calls.length, 0);
  const unchanged = compacted.length === messages.length &&
    compacted.every((message, index) => message === messages[index]) &&
    messageText(messages.at(-1)) === activeInstruction;
  if (unchanged) return { messages, compactedCalls, retainedCalls, changed: false };
  return { messages: compacted, compactedCalls, retainedCalls, changed: true };
}
