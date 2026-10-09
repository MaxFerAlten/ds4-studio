// WP8 of convergenza.loop.md: context compaction in the JS loop.
//
// Formulas copied from the C (studio/ds4_agent.c of the composed shadow):
//   - agent_worker_should_compact (19179-19190): soft percent, then the
//     free-space branch max(min(compactMinFreeTokens, ctx/8), reserve + 128);
//   - agent_compact_make_prompt (19239-19266): compact-prompt text, the
//     optional Evidence clause, then "\nCompaction reason: <reason>\n";
//   - agent_compact_summary_budget (19269-19275): clamp(ctx/8, 256, max);
//   - agent_compact_tail_start (19219-19227): min(ctx / divisor, cap);
//   - the summary wrapper of agent_worker_compact_transcript (9986-9993):
//     begin marker, summary, end marker, appended as a *user* message.
// The texts themselves are the shared config/agent-text files (WP2), never a
// second copy.
//
// Declared deviations from the C:
//   - the extracted wrapper-end text ends with the rendered chat role token
//     ("user") that C's ChatML rendering needs; JS sends structured messages,
//     so the trailing role marker is stripped and the marker itself stays
//     byte-identical;
//   - `reserveTokens` is a parameter (the C adds the token count of the
//     prompt itself plus 128); the JS route passes 0 plus the same +128;
//   - the tail alignment works on message boundaries with an estimate, while
//     C walks token boundaries inside the transcript (plan §11.2: "taglia
//     solo su confini di messaggio").

import { loadAgentText } from "./agentText.mjs";

const texts = {
  prompt: () => loadAgentText("compact-prompt"),
  evidenceClause: () => loadAgentText("compact-evidence-clause"),
  wrapperBegin: () => loadAgentText("compact-summary-wrapper-begin"),
  wrapperEnd: () => loadAgentText("compact-summary-wrapper-end")
};

// The wrapper-end file carries the C's rendered role marker ("\n\nuser");
// structured messages do not need it.
function wrapperEndText() {
  return texts.wrapperEnd().replace(/\s*user\s*$/, "");
}

export function shouldCompact({ usedTokens, ctx, policy, reserveTokens = 0 }) {
  if (!(ctx > 0) || !(usedTokens > 0)) return false;
  const softPercent = Number(policy.compactSoftPercent) || 85;
  if (usedTokens >= Math.floor((ctx * softPercent) / 100)) return true;
  const minFree = Number(policy.compactMinFreeTokens) || 8192;
  let freeThreshold = Math.min(minFree, Math.floor(ctx / 8));
  const reserve = Math.max(0, Number(reserveTokens) || 0) + 128; // C: + 128
  if (freeThreshold < reserve) freeThreshold = reserve;
  return ctx - usedTokens <= freeThreshold;
}

export function summaryBudget(ctx, policy) {
  const max = Number(policy.compactSummaryMaxTokens) || 4096;
  let budget = Math.floor(ctx / 8);
  if (budget < 256) budget = 256;
  if (budget > max) budget = max;
  return budget;
}

export function tailBudget(ctx, policy) {
  const divisor = Number(policy.compactTailDivisor) || 10;
  const cap = Number(policy.compactTailCapTokens) || 50000;
  return Math.max(1, Math.min(Math.floor(ctx / divisor), cap));
}

// Tail selection on message boundaries.  Never cut between an assistant
// carrying tool_calls and the tool answers that respond to it: if the cut
// lands on a tool message, walk back to the owning assistant.
export function selectTail(messages, tailTokenBudget, estimate) {
  let start = messages.length;
  let total = 0;
  while (start > 0) {
    const next = total + estimate(messages[start - 1]);
    if (next > tailTokenBudget && start < messages.length) break;
    total = next;
    start -= 1;
  }
  while (start > 0 && messages[start]?.role === "tool") start -= 1;
  return start;
}

// agent_compact_make_prompt(): prompt text + optional Evidence clause +
// "\nCompaction reason: <reason>\n".
export function compactPromptText(reason, evidenceActive = false) {
  let text = texts.prompt();
  if (evidenceActive) text += texts.evidenceClause();
  if (reason) text += `\nCompaction reason: ${reason}\n`;
  return text;
}

async function summarizeOnce(callModel, messages, options) {
  const summary = String((await callModel(messages, options)) ?? "").trim();
  if (!summary) throw new Error("COMPACTION_FAILED: empty summary");
  return summary;
}

// The C wrapper, byte for byte: begin + "\n" + summary + ("\n") + end.
function wrapSummary(summary) {
  return {
    role: "user",
    content: `${texts.wrapperBegin()}\n${summary}${summary.endsWith("\n") ? "" : "\n"}${wrapperEndText()}`
  };
}

// A single message larger than the chunk budget keeps its head and its tail.
function clipMessage(message, budget, estimate) {
  const tokens = estimate(message);
  if (tokens <= budget || typeof message.content !== "string") return message;
  const keep = Math.max(0, Math.floor(message.content.length * (budget / tokens)) - 120);
  const head = message.content.slice(0, Math.ceil((keep * 2) / 3));
  const tail = message.content.slice(message.content.length - Math.floor(keep / 3));
  const omitted = message.content.length - head.length - tail.length;
  return { ...message, content: `${head}\n[... ${omitted} chars omitted for compaction ...]\n${tail}` };
}

// Splits on message boundaries; a chunk never starts with a tool answer, so
// an assistant carrying tool_calls stays with its tools (clipped if needed).
export function chunkHistory(messages, budget, estimate) {
  const groups = [];
  for (const message of messages) {
    if (message?.role === "tool" && groups.length) groups.at(-1).push(message);
    else groups.push([message]);
  }
  const chunks = [];
  let current = [];
  let used = 0;
  for (const group of groups) {
    const per = Math.floor(budget / group.length);
    const clipped = group.map((m) => clipMessage(m, per, estimate));
    const size = clipped.reduce((sum, m) => sum + estimate(m), 0);
    if (current.length && used + size > budget) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(...clipped);
    used += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// compactConversation({ messages, reason, ctx, policy, callModel, estimate, evidence, maxInputTokens })
//   -> the rebuilt transcript [system, summary(user), (evidence), tail]
//
// callModel(messagesForSummary, { max_tokens, tools: undefined }) resolves to
// the summary text; an empty summary throws (the conversation must stay
// intact, the caller decides what to report).  evidence: { text } re-anchors
// the short contract between summary and tail, like the C; the ledger itself
// is never fed through the summary (plan §11.1: the digest comes from the
// ledger, not from the text).
export async function compactConversation({
  messages,
  reason,
  ctx,
  policy,
  callModel,
  estimate,
  evidence = null,
  maxInputTokens = 0
} = {}) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error("COMPACTION_FAILED: nothing to summarize");
  }
  if (typeof callModel !== "function") throw new Error("COMPACTION_FAILED: callModel is required");
  const system = messages[0]?.role === "system" ? messages[0] : null;
  const history = system ? messages.slice(1) : [...messages];

  const start = selectTail(history, tailBudget(ctx, policy), estimate);
  const toSummarize = history.slice(0, start);
  // With an input cap, a tail message alone near the context size (a pasted
  // dump, a giant tool output) would break the very next round: clip it.
  const tail = maxInputTokens > 0
    ? history.slice(start).map((m) => clipMessage(m, Math.floor(maxInputTokens / 4), estimate))
    : history.slice(start);
  if (!toSummarize.length) throw new Error("COMPACTION_FAILED: nothing to summarize");

  const promptMessage = { role: "user", content: compactPromptText(reason, Boolean(evidence)) };
  const options = { max_tokens: summaryBudget(ctx, policy), tools: undefined };
  const fixed = (system ? estimate(system) : 0) + estimate(promptMessage);
  const historyTokens = toSummarize.reduce((sum, m) => sum + estimate(m), 0);

  let summary;
  if (!(maxInputTokens > 0) || fixed + historyTokens <= maxInputTokens) {
    summary = await summarizeOnce(callModel, [
      ...(system ? [system] : []), ...toSummarize, promptMessage
    ], options);
  } else {
    // JS-only deviation: the transcript is larger than one request can carry
    // (e.g. rebuilt from the UI history after a server restart, never
    // compacted).  C never gets here: its transcript lives in the KV and is
    // bounded by ctx.  Summarize in rolling chunks, each carrying the
    // previous summary, so every request fits the backend's context.
    const chunkBudget = maxInputTokens - fixed - options.max_tokens;
    if (chunkBudget < 256) throw new Error("COMPACTION_FAILED: context too small to summarize");
    for (const chunk of chunkHistory(toSummarize, chunkBudget, estimate)) {
      const carried = summary ? [wrapSummary(summary)] : [];
      summary = await summarizeOnce(callModel, [
        ...(system ? [system] : []), ...carried, ...chunk, promptMessage
      ], options);
    }
  }

  const summaryMessage = wrapSummary(summary);
  const evidenceMessages = evidence?.text
    ? [{ role: "user", content: `[DS4 Studio] ${evidence.text}` }]
    : [];

  return [
    ...(system ? [system] : []),
    summaryMessage,
    ...evidenceMessages,
    ...tail
  ];
}
