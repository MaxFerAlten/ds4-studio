// WP8 of convergenza.loop.md: compaction in the JS loop.
//
// Every formula was read from the C (studio/ds4_agent.c of the composed
// shadow): agent_worker_should_compact (19179-19190), agent_compact_make_prompt
// (19239-19266), agent_compact_summary_budget (19269-19275), the tail budget
// of agent_compact_tail_start (19219-19227) and the summary wrapper of
// agent_worker_compact_transcript (9986-9993).  The shared texts are the
// config/agent-text files extracted by WP2.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  shouldCompact,
  selectTail,
  summaryBudget,
  tailBudget,
  compactPromptText,
  compactConversation,
  chunkHistory
} from "./agentCompaction.mjs";
import { AgentSessionManager } from "./agentSession.mjs";
import { loadAgentText } from "./agentText.mjs";

const POLICY = {
  compactSoftPercent: 85,
  compactMinFreeTokens: 8192,
  compactTailDivisor: 10,
  compactTailCapTokens: 50000,
  compactSummaryMaxTokens: 4096
};

const estimate = (m) => Math.ceil(`${m.role}\n${m.content ?? ""}`.length / 3.5);

// ---------------------------------------------------------------- threshold

test("shouldCompact: soft percent edges", () => {
  // used >= (ctx * 85) / 100 with C integer division.
  assert.equal(shouldCompact({ usedTokens: 849, ctx: 1000, policy: POLICY }), false);
  assert.equal(shouldCompact({ usedTokens: 850, ctx: 1000, policy: POLICY }), true);
});

test("shouldCompact: free-space branch with the reserve floor", () => {
  // free_threshold = max(min(compactMinFreeTokens, ctx/8), reserve + 128).
  // With the default policy the soft percent (15 % of ctx) always dominates
  // the proportional floor (12.5 %), so the free-space branch is observable
  // exactly when the reserve raises the floor above the soft distance —
  // which is what the C does, since its reserve is the prompt itself + 128.
  // ctx = 10000: soft at 8500; reserve 2000 -> floor 2128 -> trigger at 7872.
  assert.equal(shouldCompact({ usedTokens: 7872, ctx: 10000, policy: POLICY, reserveTokens: 2000 }), true); // 2128 free
  assert.equal(shouldCompact({ usedTokens: 7871, ctx: 10000, policy: POLICY, reserveTokens: 2000 }), false); // 2129 free
  // A small minFree is capped by ctx/8, then the constant +128 reserve floor
  // of the C takes over: the trigger is 128 free tokens, never 50.
  const capped = { ...POLICY, compactMinFreeTokens: 50, compactSoftPercent: 99 };
  assert.equal(shouldCompact({ usedTokens: 9871, ctx: 10000, policy: capped, reserveTokens: 0 }), false); // 129 free
  assert.equal(shouldCompact({ usedTokens: 9872, ctx: 10000, policy: capped, reserveTokens: 0 }), true); // 128 free
});

test("shouldCompact: nonsense inputs never compact", () => {
  assert.equal(shouldCompact({ usedTokens: 0, ctx: 1000, policy: POLICY }), false);
  assert.equal(shouldCompact({ usedTokens: 999, ctx: 0, policy: POLICY }), false);
});

test("budgets follow the C formulas", () => {
  assert.equal(summaryBudget(1000, POLICY), 256); // 125 clamped up to 256
  assert.equal(summaryBudget(100000, POLICY), 4096); // 12500 clamped down
  assert.equal(summaryBudget(8 * 3000, POLICY), 3000);
  assert.equal(tailBudget(100000, POLICY), 10000); // ctx / 10
  assert.equal(tailBudget(1000000, POLICY), 50000); // cap
});

// ---------------------------------------------------------------- tail

test("selectTail never splits an assistant-with-tool_calls from its tools", () => {
  const messages = [
    { role: "user", content: "a".repeat(700) },
    { role: "assistant", content: "call", tool_calls: [{ id: "1" }] },
    { role: "tool", tool_call_id: "1", content: "t1" },
    { role: "tool", tool_call_id: "2", content: "t2" },
    { role: "user", content: "latest" }
  ];
  // A budget that only fits the very last message would start on a "tool".
  const start = selectTail(messages, estimate(messages[4]), estimate);
  assert.equal(messages[start].role, "user"); // the last message alone
  const tight = selectTail(messages, estimate(messages[3]) + estimate(messages[4]), estimate);
  // Cutting between the tools and their assistant is illegal: the start must
  // walk back to the assistant that owns the tool results.
  assert.notEqual(messages[tight].role, "tool");
  if (messages[tight].role === "assistant") assert.ok(messages[tight].tool_calls);
  const wide = selectTail(messages, 100000, estimate);
  assert.equal(wide, 0); // a generous budget keeps everything
});

test("selectTail keeps at least the last message", () => {
  const messages = [{ role: "user", content: "x".repeat(10000) }];
  assert.equal(selectTail(messages, 1, estimate), 0);
});

// ---------------------------------------------------------------- prompt

test("compactPromptText appends the clause and the reason like the C", () => {
  const plain = compactPromptText("context pressure", false);
  assert.ok(plain.startsWith("Internal ds4-agent context compaction request."));
  assert.ok(plain.endsWith("\nCompaction reason: context pressure\n"));
  assert.ok(!plain.includes("Do not invent, promote"));
  const withEvidence = compactPromptText("user request", true);
  assert.ok(withEvidence.includes("Do not invent, promote"));
  assert.ok(withEvidence.indexOf("Do not invent, promote") < withEvidence.indexOf("Compaction reason: user request"));
});

// ---------------------------------------------------------------- compact

function fakeModel(summary) {
  const calls = [];
  const callModel = async (messages, options) => {
    calls.push({ messages, options });
    return summary;
  };
  return { callModel, calls };
}

test("compactConversation rebuilds [system, summary(user), tail]", async () => {
  const messages = [
    { role: "system", content: "SYS" },
    { role: "user", content: "old question " + "y".repeat(40000) },
    { role: "assistant", content: "old answer " + "z".repeat(40000) },
    { role: "user", content: "latest" }
  ];
  const { callModel, calls } = fakeModel("DURABLE SUMMARY");
  const next = await compactConversation({
    messages, reason: "context pressure", ctx: 200000, policy: POLICY, callModel, estimate
  });
  assert.equal(next[0].role, "system");
  assert.equal(next[0].content, "SYS");
  const summary = next[1];
  assert.equal(summary.role, "user"); // never system
  assert.match(summary.content, /Durable task-state summary follows\./);
  assert.match(summary.content, /DURABLE SUMMARY/);
  assert.match(summary.content, /\[End compacted summary\. Recent conversation continues verbatim below\.\]/);
  assert.deepEqual(next.at(-1), messages.at(-1)); // tail verbatim

  // The summary call gets the C budget, no tools, and the reason in the prompt.
  const call = calls[0];
  assert.equal(call.options.max_tokens, 4096); // clamp(25000, 256, 4096)
  assert.equal(call.options.tools, undefined);
  assert.equal(call.messages.filter((m) => m.role === "system").length, 1); // only the SYS prompt
  assert.match(call.messages.at(-1).content, /Compaction reason: context pressure/);
  // The tail is not summarized twice.
  assert.ok(!JSON.stringify(call.messages).includes("latest"));
});

test("the wrapper markers are the WP2 shared bytes", async () => {
  const { callModel } = fakeModel("S");
  const next = await compactConversation({
    messages: [
      { role: "system", content: "S" },
      { role: "user", content: "x".repeat(4000) },
      { role: "user", content: "tail" }
    ],
    reason: "r", ctx: 10000, policy: POLICY, callModel, estimate
  });
  const begin = loadAgentText("compact-summary-wrapper-begin");
  assert.ok(next[1].content.includes(begin.trim()));
});

test("an empty summary is an explicit failure", async () => {
  const { callModel } = fakeModel("   \n ");
  await assert.rejects(
    () => compactConversation({
      messages: [
        { role: "system", content: "S" },
        { role: "user", content: "x".repeat(4000) },
        { role: "user", content: "tail" }
      ],
      reason: "r", ctx: 10000, policy: POLICY, callModel, estimate
    }),
    /COMPACTION_FAILED: empty summary/
  );
});

test("an active evidence block is re-anchored between summary and tail", async () => {
  const { callModel } = fakeModel("S");
  const next = await compactConversation({
    messages: [
      { role: "system", content: "S" },
      { role: "user", content: "x".repeat(4000) },
      { role: "user", content: "tail" }
    ],
    reason: "r", ctx: 10000, policy: POLICY, callModel, estimate,
    evidence: { text: "EVIDENCE CORE CONTRACT" }
  });
  assert.equal(next.length, 4); // system, summary, evidence, tail
  assert.equal(next[2].role, "user");
  assert.match(next[2].content, /EVIDENCE CORE CONTRACT/);
  assert.equal(next[3].content, "tail");
});

test("two consecutive compactions keep a valid single-summary structure", async () => {
  const { callModel } = fakeModel("ROUND 2");
  const first = await compactConversation({
    messages: [
      { role: "system", content: "S" },
      { role: "user", content: "x".repeat(4000) },
      { role: "user", content: "tail one" }
    ],
    reason: "r1", ctx: 10000, policy: POLICY, callModel, estimate
  });
  assert.equal(first.filter((m) => /compacted earlier conversation/.test(m.content ?? "")).length, 1);
  const second = await compactConversation({
    messages: [...first, { role: "assistant", content: "a".repeat(4000) }, { role: "user", content: "tail two" }],
    reason: "r2", ctx: 10000, policy: POLICY, callModel, estimate
  });
  assert.equal(second[0].role, "system");
  // Exactly one summary block survives: the older one is folded into the text.
  assert.equal(second.filter((m) => /compacted earlier conversation/.test(m.content ?? "")).length, 1);
});

// ---------------------------------------------------------------- session

test("replaceMessages swaps the transcript and forces a fresh delta state", () => {
  const manager = new AgentSessionManager();
  manager.start();
  manager.state.messages = [{ role: "user", content: "old" }];
  manager.state.messageHashes = ["h"];
  const revision = manager.state.revision;
  const ok = manager.replaceMessages([{ role: "user", content: "new" }], "context compaction");
  assert.equal(ok, true);
  assert.deepEqual(manager.state.messages, [{ role: "user", content: "new" }]);
  assert.equal(manager.state.revision, revision + 1);
  assert.equal(manager.state.messageHashes.length, 1);
  assert.equal(manager.lastReason, "context compaction");
});

test("selectTail works with the route's real per-message estimator", async () => {
  const { estimateMessagesTokens } = await import("./agentSystemReminder.mjs");
  const estimate = (message) => estimateMessagesTokens([message]);
  const messages = [
    { role: "user", content: "a".repeat(400) },
    { role: "assistant", content: "ok", reasoning_content: "t".repeat(400) },
    { role: "user", content: "short" }
  ];
  const start = selectTail(messages, 50, estimate);
  assert.ok(start > 0 && start < messages.length);
});

// ------------------------------------------------- input larger than ctx

test("a transcript larger than the input cap is summarized in rolling chunks", async () => {
  // Regression: the transcript rebuilt from the UI history after a restart
  // was 478879 tokens on a 262144 context and the single summary call 400'd.
  const history = [];
  for (let i = 0; i < 40; i++) {
    history.push({ role: "user", content: `q${i} ` + "a".repeat(35000) });
    history.push({ role: "assistant", content: `r${i} ` + "b".repeat(35000) });
  }
  const messages = [{ role: "system", content: "SYS" }, ...history, { role: "user", content: "latest" }];
  const cap = 60000;
  const calls = [];
  const callModel = async (msgs, options) => {
    calls.push({ msgs, options });
    return `SUMMARY-${calls.length}`;
  };
  const next = await compactConversation({
    messages, reason: "r", ctx: 262144, policy: POLICY, callModel, estimate, maxInputTokens: cap
  });
  assert.ok(calls.length > 1);
  for (const call of calls) {
    const total = call.msgs.reduce((sum, m) => sum + estimate(m), 0);
    assert.ok(total + call.options.max_tokens <= cap, `request ${total} over cap`);
    assert.equal(call.msgs[0].content, "SYS");
    assert.equal(call.msgs.filter((m) => m.role === "system").length, 1);
  }
  // Each chunk after the first carries the previous summary.
  assert.match(calls[1].msgs[1].content, /SUMMARY-1/);
  assert.match(next[1].content, new RegExp(`SUMMARY-${calls.length}`));
  assert.deepEqual(next.at(-1), messages.at(-1));
});

test("under the input cap a single summary call is made (prefix cache path)", async () => {
  const messages = [
    { role: "system", content: "SYS" },
    { role: "user", content: "old " + "y".repeat(40000) },
    { role: "assistant", content: "ans " + "z".repeat(40000) },
    { role: "user", content: "latest" }
  ];
  const { callModel, calls } = fakeModel("S");
  await compactConversation({
    messages, reason: "r", ctx: 200000, policy: POLICY, callModel, estimate, maxInputTokens: 150000
  });
  assert.equal(calls.length, 1);
});

test("chunkHistory keeps tool answers with their assistant and clips giants", () => {
  const msgs = [
    { role: "user", content: "u" },
    { role: "assistant", content: "", tool_calls: [{ id: "1" }] },
    { role: "tool", content: "x".repeat(70000) },
    { role: "tool", content: "y".repeat(70000) },
    { role: "user", content: "z".repeat(350000) }
  ];
  const chunks = chunkHistory(msgs, 10000, estimate);
  for (const chunk of chunks) {
    assert.notEqual(chunk[0].role, "tool");
    assert.ok(chunk.reduce((s, m) => s + estimate(m), 0) <= 10000);
  }
  const flat = chunks.flat();
  assert.equal(flat.length, msgs.length);
  assert.match(flat.at(-1).content, /chars omitted for compaction/);
});
