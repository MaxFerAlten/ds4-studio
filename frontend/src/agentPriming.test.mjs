import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentPrimingPreamble, withAgentPriming, commandRebuildsSessionKeepingContext, nativeCommandRearmsPriming } from "./utils.mjs";

test("returns empty string for missing or empty history", () => {
  assert.equal(buildAgentPrimingPreamble(undefined), "");
  assert.equal(buildAgentPrimingPreamble(null), "");
  assert.equal(buildAgentPrimingPreamble([]), "");
});

test("skips client-side agent notices, empty assistant placeholders and blank user turns", () => {
  const preamble = buildAgentPrimingPreamble([
    { role: "assistant", content: "Agent mode started.", agentNotice: true },
    { role: "assistant", content: "", reasoning: "" },
    { role: "user", content: "   " },
    { role: "tool", content: "ignored tool payload" }
  ]);
  assert.equal(preamble, "");
});

test("serialises a pending attachment user turn so the agent receives the document", () => {
  // Regression: when the user clicks "+" to attach a markdown file and then
  // flips into agent mode without ever sending a chat-mode turn, the attached
  // document lives in the message list as a single user turn with the
  // `attachment` flag. It must reach the native agent inside the first
  // outbound message, otherwise `sage` is invoked against nothing.
  const docBlock = "📎 **validazione.md**\n\n# Funzione\n\nf(x) = ...";
  const preamble = buildAgentPrimingPreamble([
    { role: "user", content: docBlock, attachment: true }
  ]);

  assert.match(preamble, /<chat_history>/);
  assert.match(preamble, /<\/chat_history>/);
  assert.match(preamble, /## User/);
  assert.match(preamble, /validazione\.md/);
  assert.match(preamble, /f\(x\) = \.\.\./);
});

test("preserves order and roles of multi-turn history", () => {
  const preamble = buildAgentPrimingPreamble([
    { role: "user", content: "ciao" },
    { role: "assistant", content: "salve" },
    { role: "user", content: "calcola 2+2" },
    { role: "assistant", content: "4" }
  ]);

  const userIdx = preamble.indexOf("ciao");
  const assistantIdx = preamble.indexOf("salve");
  const secondUserIdx = preamble.indexOf("calcola 2+2");
  const secondAssistantIdx = preamble.indexOf("4\n</chat_history>");

  assert.ok(userIdx > -1 && assistantIdx > userIdx, "user turn must precede assistant turn");
  assert.ok(secondUserIdx > assistantIdx, "second user turn must follow first assistant turn");
  assert.ok(secondAssistantIdx > secondUserIdx, "second assistant turn must come last");
  // Each turn must be tagged with its role label.
  assert.equal((preamble.match(/## User/g) || []).length, 2);
  assert.equal((preamble.match(/## Assistant/g) || []).length, 2);
});

test("withAgentPriming is a noop when there is nothing to prime", () => {
  assert.equal(withAgentPriming([], "validami con sage"), "validami con sage");
  assert.equal(withAgentPriming(null, "x"), "x");
});

test("withAgentPriming wraps the new request below the history block", () => {
  const wrapped = withAgentPriming(
    [{ role: "user", content: "📎 file.md\n\nformula" }],
    "validami con sage quanto è dimostrato nella chat fin qui"
  );

  assert.match(wrapped, /<chat_history>[\s\S]*formula[\s\S]*<\/chat_history>/);
  assert.match(wrapped, /New user request:\nvalidami con sage/);
  // The history must appear before the new request, never after it.
  assert.ok(
    wrapped.indexOf("</chat_history>") < wrapped.indexOf("New user request:"),
    "history block must precede the new user request"
  );
});

test("skill toggles re-arm priming; session-changing and other commands do not", () => {
  // Policy start/stop commands rebuild the native session from a new system
  // prompt and drop the live conversation — priming must replay it.
  for (const cmd of [
    "/soul start", "/soul stop", "/ethic start", "/ethic stop",
    "/metacognition start", "/metacognition stop",
    "/sage-pol start", "/sage-pol stop", "/sage start", "/sage stop",
    "/lean start", "/lean stop",
    "  /soul start  "
  ]) {
    assert.equal(commandRebuildsSessionKeepingContext(cmd), true, cmd);
  }
  // Status is read-only; /new and /switch intentionally move sessions.
  for (const cmd of [
    "/new", "/switch abc123", "/save", "/list", "/pony start",
    "/crawl https://x", "/metacognition status", "/soul status",
    "/ethic status", "/sage-pol status", "/sage status", "/soulmate start",
    "/lean status", "/lean preflight",
    "soul start", "", null, undefined
  ]) {
    assert.equal(commandRebuildsSessionKeepingContext(cmd), false, String(cmd));
  }
});

test("generic skill mutations re-arm priming only for exact canonical commands", () => {
  assert.equal(commandRebuildsSessionKeepingContext("/skill lean start"), true);
  assert.equal(commandRebuildsSessionKeepingContext("/skill lean stop"), true);
  assert.equal(commandRebuildsSessionKeepingContext("/skill lean status"), false);
  assert.equal(commandRebuildsSessionKeepingContext("/skill list"), false);
  assert.equal(commandRebuildsSessionKeepingContext("/skill ../lean start"), false);
  assert.equal(commandRebuildsSessionKeepingContext("/skill lean start extra"), false);
  assert.equal(commandRebuildsSessionKeepingContext("/skill LEAN start"), false);
});

test("priming replays the WHOLE conversation from the first turn (no cap / recent window)", () => {
  // Guards the "riassumi dall'inizio" case after /agent start: the fresh native
  // session must receive every prior turn, in order, from message 0.
  const messages = [];
  for (let i = 1; i <= 30; i++) {
    messages.push({ role: "user", content: `domanda ${i}` });
    messages.push({ role: "assistant", content: `risposta ${i}`, reasoning: "hidden-cot" });
  }
  messages.push({ role: "assistant", content: "Agent mode started.", agentNotice: true });

  const out = withAgentPriming(messages, "riassumi dall'inizio");

  // First and last real turns both present -> nothing was trimmed off either end.
  assert.match(out, /domanda 1\b/);
  assert.match(out, /risposta 30\b/);
  // In-order: turn 1 precedes turn 30 precedes the new request.
  assert.ok(out.indexOf("domanda 1") < out.indexOf("risposta 30"));
  assert.ok(out.indexOf("risposta 30") < out.indexOf("riassumi dall'inizio"));
  // Notices excluded; hidden reasoning never leaks into the replay.
  assert.ok(!out.includes("Agent mode started"));
  assert.ok(!out.includes("hidden-cot"));
});

// R2-08 — what the chat does with a control-plane answer.

test("a real mutation on a rebuilding command re-arms the priming replay", () => {
  const rearm = (payload, command = "/lean start", ok = true) =>
    nativeCommandRearmsPriming({ ok, payload, command });

  assert.equal(rearm({ changed: true }), true);
  // A repair is a mutation: the session was rebuilt under the chat.
  assert.equal(rearm({ changed: true, repaired: true }), true);
  assert.equal(rearm({ changed: false, repaired: true }), true);
  // Nothing moved.
  assert.equal(rearm({ changed: false, repaired: false }), false);
});

test("a status command never re-arms priming, however it answers", () => {
  assert.equal(
    nativeCommandRearmsPriming({ ok: true, payload: { changed: true }, command: "/lean status" }),
    false
  );
  assert.equal(
    nativeCommandRearmsPriming({ ok: true, payload: { changed: true }, command: "/skill list" }),
    false
  );
});

test("a failed command is not a success, whatever the payload says", () => {
  // 409 busy and 500 manifest error both arrive with ok=false; neither may
  // re-arm priming, and neither is retried automatically.
  assert.equal(
    nativeCommandRearmsPriming({
      ok: false,
      payload: { changed: true, errorCode: "AGENT_BUSY" },
      command: "/lean start"
    }),
    false
  );
  assert.equal(
    nativeCommandRearmsPriming({
      ok: false,
      payload: { changed: false, errorCode: "SKILL_MANIFEST_IO_FAILED" },
      command: "/lean stop"
    }),
    false
  );
});
