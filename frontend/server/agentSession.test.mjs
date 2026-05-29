import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSessionManager, AgentSessionStore, AGENT_TOOLS, stableJson } from "./agentSession.mjs";

function assistantToolCall(id = "call_read") {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id,
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ path: "ds4.h" }) }
      }
    ]
  };
}

test("agent session starts, reports status, and stores committed messages", () => {
  const session = new AgentSessionManager();
  const status = session.start();
  const messages = [
    { role: "system", content: "tools" },
    { role: "user", content: "read ds4.h" }
  ];
  const selected = session.choosePayload({ messages, tools: AGENT_TOOLS }, { allowDelta: false });

  assert.equal(status.active, true);
  assert.equal(selected.mode, "reset");
  assert.deepEqual(selected.payload.messages, messages);

  session.commit(selected.pending, { role: "assistant", content: "ok" });

  assert.equal(session.status().revision, 1);
  assert.deepEqual(session.messages(), [...messages, { role: "assistant", content: "ok" }]);
});

test("agent session keeps full payloads for stateless chat completions", () => {
  const session = new AgentSessionManager();
  session.start();
  const firstMessages = [
    { role: "system", content: "tools" },
    { role: "user", content: "read ds4.h" }
  ];
  const first = session.choosePayload({ messages: firstMessages, tools: AGENT_TOOLS }, { allowDelta: false });
  const call = assistantToolCall();
  session.commit(first.pending, call);

  const withToolResult = [...session.messages(), {
    role: "tool",
    tool_call_id: "call_read",
    content: "1: #ifndef DS4_H"
  }];
  const selected = session.choosePayload(
    { messages: withToolResult, tools: AGENT_TOOLS },
    { allowDelta: false }
  );

  assert.equal(selected.mode, "reset");
  assert.equal(selected.payload.delta, undefined);
  assert.deepEqual(selected.payload.messages, withToolResult);
  assert.match(selected.reason, /stateful disabled|full reset/i);
});

test("agent session can select tool-only deltas when explicitly enabled", () => {
  const session = new AgentSessionManager();
  session.start();
  const firstMessages = [
    { role: "system", content: "tools" },
    { role: "user", content: "read ds4.h" }
  ];
  const first = session.choosePayload({ messages: firstMessages, tools: AGENT_TOOLS }, { allowDelta: true });
  const call = assistantToolCall("call_read_2");
  session.commit(first.pending, call);

  const toolResult = {
    role: "tool",
    tool_call_id: "call_read_2",
    content: "1: #ifndef DS4_H"
  };
  const selected = session.choosePayload(
    { messages: [...session.messages(), toolResult], tools: AGENT_TOOLS },
    { allowDelta: true }
  );

  assert.equal(selected.mode, "delta");
  assert.deepEqual(selected.payload.messages, [toolResult]);
  assert.deepEqual(selected.payload.delta, { messages: [toolResult] });
  assert.equal(selected.payload.parent_revision, 1);
});

test("stable JSON sorts object keys recursively", () => {
  const a = stableJson({ b: 1, a: { y: 2, x: 1 } });
  const b = stableJson({ a: { x: 1, y: 2 }, b: 1 });
  assert.equal(a, b);
});

test("choosePayload survives caller swapping equal-but-unequal-by-reference message objects", () => {
  const session = new AgentSessionManager();
  session.start();
  const first = session.choosePayload(
    { messages: [{ role: "system", content: "tools" }, { role: "user", content: "hello" }], tools: AGENT_TOOLS },
    { allowDelta: true }
  );
  session.commit(first.pending, { role: "assistant", content: "hi" });

  // Caller re-builds a structurally identical transcript with NEW objects.
  const replicated = [
    { role: "system", content: "tools" },
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
    { role: "user", content: "follow-up" }
  ];
  const second = session.choosePayload(
    { messages: replicated, tools: AGENT_TOOLS },
    { allowDelta: true, userTurnPolicy: "delta" }
  );
  assert.equal(second.mode, "delta");
  assert.equal(second.payload.parent_revision, 1);
  assert.deepEqual(second.payload.messages, [{ role: "user", content: "follow-up" }]);
});

test("forceReset retries the same payload as a full replay on the existing session id", () => {
  const session = new AgentSessionManager();
  session.start();
  const sessionId = session.status().sessionId;

  const first = session.choosePayload(
    { messages: [{ role: "system", content: "tools" }, { role: "user", content: "hi" }], tools: AGENT_TOOLS },
    { allowDelta: true }
  );
  session.commit(first.pending, { role: "assistant", content: "ack" });

  const fullMessages = [
    ...session.messages(),
    { role: "user", content: "again" }
  ];

  const deltaPick = session.choosePayload(
    { messages: fullMessages, tools: AGENT_TOOLS },
    { allowDelta: true, userTurnPolicy: "delta" }
  );
  assert.equal(deltaPick.mode, "delta");

  const reset = session.choosePayload(
    { messages: fullMessages, tools: AGENT_TOOLS },
    { allowDelta: true, forceReset: true }
  );
  assert.equal(reset.mode, "reset");
  assert.equal(reset.payload.session_id, sessionId);
  assert.equal(reset.payload.delta, undefined);
  assert.deepEqual(reset.payload.messages, fullMessages);
  assert.match(reset.reason, /retrying full reset/);
});

test("hashing is incremental: repeat choosePayload calls reuse the stored prefix", () => {
  const session = new AgentSessionManager();
  session.start();

  let hashCalls = 0;
  const trackedUser = { role: "user", get content() { hashCalls++; return "watch me"; } };
  const messages = [{ role: "system", content: "tools" }, trackedUser];

  session.choosePayload({ messages, tools: AGENT_TOOLS }, { allowDelta: true });
  const before = hashCalls;
  // Same array, same object references → the second call must not rehash
  // the existing transcript suffix; new content getters should not fire.
  session.choosePayload({ messages, tools: AGENT_TOOLS }, { allowDelta: true });
  assert.equal(hashCalls, before);
});

test("AgentSessionStore isolates concurrent agent sessions", () => {
  const store = new AgentSessionStore();
  const tabA = store.start("tab-a");
  const tabB = store.start("tab-b");
  assert.notEqual(tabA.sessionId, tabB.sessionId);
  assert.equal(store.size(), 2);

  const a = store.get("tab-a");
  const b = store.get("tab-b");
  const aSel = a.choosePayload({ messages: [{ role: "user", content: "from A" }], tools: AGENT_TOOLS });
  a.commit(aSel.pending, { role: "assistant", content: "A reply" });

  assert.equal(a.status().revision, 1);
  assert.equal(b.status().revision, 0);
  assert.deepEqual(b.messages(), []);

  store.stop("tab-a");
  assert.equal(store.size(), 1);
  assert.equal(store.status("tab-a").active, false);
  assert.equal(store.status("tab-b").active, true);
});
