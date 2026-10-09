// WP12 of convergenza.loop.md — guard parity tests.
//
// Positive and negative phrases are copied from the C detectors themselves
// (shadow ds4_agent.c:20214-20221 fake_markers, :20243-20249 defense_phrases)
// and the injected texts from C :24096-24101, :24184-24191, :24194, :3364-3366.
// The C tree has no dedicated unit tests for these two detectors (declared
// deviation in docs/convergenza/WP12.md), so the implementation tables are
// the reference.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  FABRICATION_MARKERS,
  DEFENSE_PHRASES,
  FABRICATION_TOOL_ERROR_TEXT,
  DEFENSIVE_LOOP_ERROR_TEXT,
  LOOP_GUARD_STATUS_TEXT,
  DEFENSIVE_STOP_THRESHOLD,
  isFabricatedResult,
  isDefensiveText,
  noteFabricatedResult,
  evaluateDefensiveLoop,
  formatLocalDateTime,
  datetimeContextMessage,
  createLoopGuardState
} from "./agentLoopGuards.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("fabrication detector: every C marker, and nothing else", () => {
  assert.deepEqual(FABRICATION_MARKERS, [
    "<search_results>",
    "</search_results>",
    "<crawl_results>",
    "</crawl_results>",
    "<tool_results>",
    "</tool_results>"
  ]);
  for (const marker of FABRICATION_MARKERS) {
    assert.equal(isFabricatedResult(`answer ${marker} body`), true, marker);
  }
  assert.equal(isFabricatedResult("the <search_result> block looked fine"), false);
  assert.equal(isFabricatedResult("<SEARCH_RESULTS>"), false); // strstr is case-sensitive
  assert.equal(isFabricatedResult(""), false);
  assert.equal(isFabricatedResult(null), false);
});

test("defensive detector: every C phrase, and nothing else", () => {
  assert.deepEqual(DEFENSE_PHRASES, [
    "I did search", "i did search",
    "the block shows", "the search results show",
    "as proof", "prova che ho cercato",
    "ho cercato", "la ricerca ha prodotto",
    "sostengo di aver", "continuo a sostenere"
  ]);
  for (const phrase of DEFENSE_PHRASES) {
    assert.equal(isDefensiveText(`model said: ${phrase}!`), true, phrase);
  }
  // negatives
  assert.equal(isDefensiveText("I have not searched yet."), false);
  assert.equal(isDefensiveText("the block is empty"), false);
  assert.equal(isDefensiveText("HO CERCATO"), false); // case-sensitive
  // C uses strstr: a substring inside a denial still matches (faithful)
  assert.equal(isDefensiveText("non ho cercato nulla, lo ammetto"), true);
  assert.equal(isDefensiveText(""), false);
  assert.equal(isDefensiveText(null), false);
});

test("injected texts are byte-identical to C", () => {
  assert.equal(
    FABRICATION_TOOL_ERROR_TEXT,
    "Tool error: simulated result detected — you wrote " +
    "<search_results>, <crawl_results> or <tool_results> " +
    "without executing a real tool call. Do not simulate " +
    "tool output. Use the proper DSML syntax to invoke the " +
    "tool, then report its real result.\n"
  );
  assert.equal(
    DEFENSIVE_LOOP_ERROR_TEXT,
    "Tool error: loop detected — repeated defensive responses " +
    "without admitting the error. Stop defending and answer " +
    "directly with what was learned so far:\n" +
    "[OBSERVATION] what was learned\n" +
    "[COMPRESSED] <= 10 lines\n" +
    "[TARGET_SELECTED] the single next thing to try\n" +
    "[VERDICT] GO / STOP / RETEST\n"
  );
  assert.equal(LOOP_GUARD_STATUS_TEXT, "Loop guard: difesa ripetuta senza ammissione — arresto.");
});

test("loop counter: C semantics — stop when the counter is already >= 3", () => {
  assert.equal(DEFENSIVE_STOP_THRESHOLD, 3);
  const g = createLoopGuardState();
  assert.deepEqual(g, { consecutiveDefensive: 0, datetimeInjected: false });
  // three defensive plain-text turns pass, the fourth stops (C checks the
  // counter before incrementing it, ds4_agent.c:24181)
  for (let i = 0; i < 3; i++) {
    const r = evaluateDefensiveLoop(g, "I did search, the block shows it");
    assert.equal(r.stop, false);
  }
  assert.equal(g.consecutiveDefensive, 3);
  const stop = evaluateDefensiveLoop(g, "I did search again");
  assert.equal(stop.stop, true);
  // a plain non-defensive final answer resets the counter
  g.consecutiveDefensive = 2;
  evaluateDefensiveLoop(g, "here is what was learned");
  assert.equal(g.consecutiveDefensive, 0);
  // fabricated turns share the counter (C :24094)
  noteFabricatedResult(g);
  noteFabricatedResult(g);
  noteFabricatedResult(g);
  assert.equal(evaluateDefensiveLoop(g, "ho cercato").stop, true);
});

test("datetime context: C shape, once per session", () => {
  const date = new Date(2025, 5, 11, 14, 3, 22); // local time by construction
  const when = formatLocalDateTime(date);
  assert.match(when, /^2025-06-11 14:03:22 \S+$/); // %Y-%m-%d %H:%M:%S %Z
  const message = datetimeContextMessage(date);
  assert.match(
    message,
    /^Current local date and time at session start: 2025-06-11 14:03:22 \S+\. Use this only when date or time matters\.$/
  );
});

test("JS loop wiring: fabrication before the lean gate, defensive stop before commit", () => {
  const source = readFileSync(join(here, "index.mjs"), "utf8");
  const fabAt = source.indexOf("isFabricatedResult(assistantContent)");
  const leanAt = source.indexOf("evaluateLeanFinalCandidate({");
  const stopAt = source.indexOf("DEFENSIVE_LOOP_ERROR_TEXT");
  const commitAt = source.indexOf("agentSession.commit(modeChoice.pending, assistantMessage);");
  assert.ok(fabAt > 0 && leanAt > 0 && stopAt > 0 && commitAt > 0);
  assert.ok(fabAt < leanAt, "fabrication must be checked before the authoritative gate (C order)");
  assert.ok(stopAt < commitAt, "defensive stop must happen before the commit");
  // the fabricated path counts in the iteration limit: it continues the loop
  assert.match(source, /pushGuidanceMessage\(fullMessages, FABRICATION_TOOL_ERROR_TEXT\)/);
  // the defensive turn publishes nothing
  assert.match(source, /finish_reason: "loop_guard"/);
  // datetime: injected once per session right after the system prompt
  assert.match(source, /loopGuardState\.datetimeInjected/);
});

test("session switch: restoring a transcript voids datetime re-injection (C :9981)", () => {
  const source = readFileSync(join(here, "index.mjs"), "utf8");
  const switchAt = source.indexOf('else if (command === "switch") {');
  const doneAt = source.indexOf("Switched to session", switchAt);
  assert.ok(switchAt > 0 && doneAt > switchAt);
  // C sets datetime_context_injected = true when a session file is loaded
  // (shadow ds4_agent.c:9981): the restored transcript already carries the
  // datetime message, so a later turn must not splice a second one.
  assert.match(
    source.slice(switchAt, doneAt),
    /loopGuardState\.datetimeInjected = true/,
    "/switch must disable datetime re-injection like C"
  );
});

test("session state: loopGuardState lives on the manager (loopGuard is the pre-existing JS guard)", async () => {
  const { AgentSessionManager } = await import("./agentSession.mjs");
  const manager = new AgentSessionManager();
  assert.deepEqual(manager.loopGuardState, { consecutiveDefensive: 0, datetimeInjected: false });
  manager.start();
  manager.loopGuardState.consecutiveDefensive = 5;
  manager.loopGuardState.datetimeInjected = true;
  manager.reset("test");
  assert.deepEqual(manager.loopGuardState, { consecutiveDefensive: 0, datetimeInjected: false });
});
