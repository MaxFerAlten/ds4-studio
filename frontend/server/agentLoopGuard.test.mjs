import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgentLoopGuard,
  checkAssistantFileListEcho,
  guardAssistantDelta,
  hasStructuredSynthesis,
  normalizeAgentIntentText
} from "./agentLoopGuard.mjs";
import * as loopGuardModule from "./agentLoopGuard.mjs";

test("normalizes look/check/read inspection variants to same intent", () => {
  assert.equal(
    normalizeAgentIntentText("Let me look at the bug resolution document."),
    normalizeAgentIntentText("Let me check the bug resolution document.")
  );
});

test("blocks repeated narrative inspection intent on second occurrence", () => {
  const guard = new AgentLoopGuard({ maxSameIntent: 2 });
  assert.equal(guard.checkAssistantText("Let me look at the bug resolution document."), undefined);
  const block = guard.checkAssistantText("Let me check the bug resolution document.");
  assert.ok(block?.block);
  assert.equal(block.type, "STOP_LOOP");
});

test("does not block normal non-inspection prose", () => {
  const guard = new AgentLoopGuard({ maxSameIntent: 1 });
  assert.equal(guard.checkAssistantText("The acceptance rate is 21% and the venue is tier 1."), undefined);
});

test("blocks repeated action signature", () => {
  const guard = new AgentLoopGuard({ maxSameAction: 1 });
  const action = {
    phase: "phase-01",
    tool: "read",
    target: "doc/bug-resolution-with-gitnexus.md",
    args: { path: "doc/bug-resolution-with-gitnexus.md", start_line: 1, max_lines: 120 }
  };
  assert.equal(guard.checkAction(action), undefined);
  const block = guard.checkAction({ ...action });
  assert.ok(block?.block);
  assert.equal(block.type, "STOP_ACTION_LOOP");
});

test("different action args do not collide", () => {
  const guard = new AgentLoopGuard({ maxSameAction: 1 });
  assert.equal(guard.checkAction({ tool: "read", target: "a", args: { path: "a" } }), undefined);
  assert.equal(guard.checkAction({ tool: "read", target: "b", args: { path: "b" } }), undefined);
});

test("blocks after maxNoProgress identical tool results", () => {
  const guard = new AgentLoopGuard({ maxNoProgress: 3 });
  const same = { tool: "read", target: "a", content: "same text" };
  assert.equal(guard.recordProgress("tool-result", same), undefined); // first: progress
  assert.equal(guard.recordProgress("tool-result", same), undefined); // no-progress 1
  assert.equal(guard.recordProgress("tool-result", same), undefined); // no-progress 2
  const block = guard.recordProgress("tool-result", same);            // no-progress 3 -> block
  assert.ok(block?.block);
  assert.equal(block.type, "STOP_NO_PROGRESS");
});

test("new observation resets no-progress", () => {
  const guard = new AgentLoopGuard({ maxNoProgress: 2 });
  guard.recordProgress("tool-result", { content: "a" });
  guard.recordProgress("tool-result", { content: "a" }); // no-progress 1
  assert.equal(guard.recordProgress("tool-result", { content: "b" }), undefined); // resets
  assert.equal(guard.recordProgress("tool-result", { content: "b" }), undefined); // no-progress 1 again
});

test("blocks repeated ambiguity reasoning", () => {
  const guard = new AgentLoopGuard();

  assert.equal(typeof loopGuardModule.normalizeAmbiguityText, "function");
  assert.match(
    loopGuardModule.normalizeAmbiguityText("Perhaps the user means the doc directory, or perhaps the parent codebase."),
    /ambiguity/
  );
  assert.equal(
    guard.checkAssistantText("Perhaps the user means the doc directory, or perhaps the parent codebase."),
    undefined
  );

  const block = guard.checkAssistantText("Given the ambiguity, perhaps the user wants the docs or the real codebase.");
  assert.equal(block?.type, "STOP_AMBIGUITY_LOOP");
  assert.equal(block?.block, true);
});

test("beginTurn clears all counters", () => {
  const guard = new AgentLoopGuard({ maxSameAction: 1 });
  guard.checkAction({ tool: "read", target: "a", args: { path: "a" } });
  guard.beginTurn();
  assert.equal(guard.checkAction({ tool: "read", target: "a", args: { path: "a" } }), undefined);
});

test("blocks assistant repeated repository file enumeration", () => {
  const text = Array.from({ length: 6 }, () =>
    "ds4.c ds4.h ds4_agent.c ds4_server.c ds4_cuda.cu ds4_rocm.cu"
  ).join(" ");
  const block = checkAssistantFileListEcho(text);

  assert.ok(block?.block);
  assert.equal(block.type, "STOP_REPEATED_FILE_ECHO");
});

test("blocks more than forty file tokens in assistant output", () => {
  const text = Array.from({ length: 80 }, (_, i) => `file_${i}.c`).join(" ");
  assert.equal(checkAssistantFileListEcho(text)?.type, "STOP_FILE_LIST_ECHO");
});

test("allows a short useful assistant file list", () => {
  const text = "Targets: ds4.c, frontend/server/agentLoopGuard.mjs, frontend/server/agentLoopGuard.test.mjs";
  assert.equal(checkAssistantFileListEcho(text), undefined);
});

test("blocks repeated five-gram narration", () => {
  const text = Array.from({ length: 3 }, () => "let me inspect the same target now").join(" ");
  assert.equal(checkAssistantFileListEcho(text)?.type, "STOP_REPEATED_TEXT_ECHO");
});

test("output echo guard supports warn mode without blocking", () => {
  const guard = new AgentLoopGuard({ outputEchoMode: "warn" });
  const text = Array.from({ length: 80 }, (_, i) => `file_${i}.c`).join(" ");
  const decision = guard.checkAssistantOutput(text);

  assert.equal(decision?.block, false);
  assert.equal(decision?.warn, true);
  assert.equal(decision?.type, "STOP_FILE_LIST_ECHO");
});

test("compressed observations require ordered compression target and verdict markers", () => {
  const guard = new AgentLoopGuard();
  guard.recordCompressedObservation();
  assert.equal(guard.requiresStructuredObservation(), true);

  const block = guard.checkAssistantText("I will keep reading the repository.");
  assert.ok(block?.block);
  assert.equal(block.type, "STOP_MISSING_OBSERVATION_FLOW");
});

test("valid observation flow clears the structured-output requirement", () => {
  const guard = new AgentLoopGuard();
  guard.recordCompressedObservation();
  const text = [
    "[OBSERVATION] Large listing suppressed.",
    "[COMPRESSED] Agent runtime files are relevant.",
    "[TARGET_SELECTED] frontend/server/agentLoopGuard.mjs",
    "[VERDICT] GO"
  ].join("\n");

  assert.equal(guard.checkAssistantText(text), undefined);
  assert.equal(guard.requiresStructuredObservation(), false);
});

test("loop guard supports warn mode for repeated actions", () => {
  const guard = new AgentLoopGuard({ loopMode: "warn", maxSameAction: 1 });
  const action = { tool: "read", target: "a", args: { path: "a" } };
  guard.checkAction(action);
  const decision = guard.checkAction(action);

  assert.equal(decision?.block, false);
  assert.equal(decision?.warn, true);
  assert.equal(decision?.type, "STOP_ACTION_LOOP");
});

test("stream guard rejects the delta that crosses the file-token limit", () => {
  const guard = new AgentLoopGuard();
  const firstText = Array.from({ length: 40 }, (_, i) => `file_${i}.c`).join(" ");
  const first = guardAssistantDelta("", firstText, guard);
  assert.equal(first.decision, undefined);

  const blocked = guardAssistantDelta(first.content, " file_40.c", guard);

  assert.equal(blocked.decision?.type, "STOP_FILE_LIST_ECHO");
  assert.equal(blocked.decision?.block, true);
  assert.equal(blocked.content, first.content, "the violating delta must not enter the emitted buffer");
});

test("warn mode keeps observation flow required after invalid synthesis", () => {
  const guard = new AgentLoopGuard({ loopMode: "warn" });
  guard.recordCompressedObservation();

  const decision = guard.checkAssistantText("[OBSERVATION] partial only");

  assert.equal(decision?.warn, true);
  assert.equal(decision?.block, false);
  assert.equal(guard.requiresStructuredObservation(), true);
});

test("structured synthesis requires all four markers in order", () => {
  assert.equal(hasStructuredSynthesis("[OBSERVATION] partial"), false);
  assert.equal(
    hasStructuredSynthesis("[VERDICT] GO\n[OBSERVATION] x\n[COMPRESSED] y\n[TARGET_SELECTED] z"),
    false
  );
  assert.equal(
    hasStructuredSynthesis(
      "[OBSERVATION] x\n[COMPRESSED] y\n[TARGET_SELECTED] target\n[VERDICT] GO"
    ),
    true
  );
});
