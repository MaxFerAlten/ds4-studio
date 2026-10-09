import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REP_MIN_CYCLES,
  REP_WARN_CYCLES,
  createRepetitionDetector
} from "./agentRepetitionDetector.mjs";

// Same cases as the C test_agent_repetition_detector (studio/ds4_agent.c).

test("varied prose stays below the warn threshold", () => {
  const d = createRepetitionDetector();
  const prose =
    "The user is asking about fix #6.\n" +
    "Let me look at the history saving code.\n" +
    "The history POST is triggered on new messages.\n" +
    "So it should not affect typing performance.\n" +
    "However the problem might persist.\n" +
    "Let me think about what else could cause it.\n";
  assert.ok(d.feed(prose) < REP_WARN_CYCLES);
});

test("a period-2 cycle aborts on the fifth repeat; blank lines are ignored", () => {
  const d = createRepetitionDetector();
  const cycle =
    "Let me check the index.mjs file for any WebSocket connections.\n" +
    "\n" +
    "Let me also check if there is any JavaScript that monitors.\n" +
    "\n";
  let worst = 0;
  let feeds = 0;
  while (worst < REP_MIN_CYCLES && feeds < 10) {
    worst = d.feed(cycle);
    feeds++;
  }
  assert.ok(worst >= REP_MIN_CYCLES);
  assert.equal(feeds, REP_MIN_CYCLES);
});

test("the same line aborts at MIN_CYCLES, not before", () => {
  const d = createRepetitionDetector();
  let worst = 0;
  for (let i = 0; i < REP_MIN_CYCLES - 1; i++) worst = d.feed("same line again\n");
  assert.equal(worst, REP_MIN_CYCLES - 1);
  assert.ok(d.feed("same line again\n") >= REP_MIN_CYCLES);
});

test("indentation and trailing-space variants hash the same", () => {
  const d = createRepetitionDetector();
  let worst = 0;
  worst = d.feed("same line again\n");
  worst = d.feed("  same line again\n");
  worst = d.feed("same line again  \n");
  worst = d.feed("\tsame  line\tagain\n");
  assert.equal(worst, REP_MIN_CYCLES - 1);
  assert.ok(d.feed("same line again\n") >= REP_MIN_CYCLES);
});

test("a line split across stream chunks counts once", () => {
  const d = createRepetitionDetector();
  let worst = 0;
  for (let i = 0; i < REP_MIN_CYCLES; i++) {
    worst = Math.max(worst, d.feed("same li"), d.feed("ne again\n"));
  }
  assert.ok(worst >= REP_MIN_CYCLES);
});
