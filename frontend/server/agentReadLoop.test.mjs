// Verification tests for the "agent stuck re-reading the same range" failure
// mode observed in an external Pi agent benchmark run:
//
//   [AGENT] read {path: ".../django/contrib/auth/forms.py", offset: 55, limit: 30}
//   [WARN]  Loop detected! Tool read called 3 times with same arguments.
//   [INFO]  Recovering from tool loop...  -> "Operation aborted" -> retried -> looped
//
// In that harness the recovery only aborted a single call, then let the
// identical call through again (resetting the loop counter) → an infinite
// 2-good-1-aborted ping-pong.
//
// ds4-studio takes a different approach: the ReadGuard records every successful
// read range and the session loop (frontend/server/index.mjs ~L1110-1138)
// short-circuits any duplicate/covered read with a synthetic guidance result
// instead of re-executing it.  These tests reproduce the Pi scenario against the
// real ReadGuard to confirm the loop cannot happen here, and they document the
// one shape of read loop the guard does NOT catch (monotonic "drift").

import assert from "node:assert/strict";
import { test } from "node:test";
import { ReadGuard } from "./agentTools.mjs";

// Faithful re-implementation of the read-tool branch of the session's
// runToolCall loop: on each read the session asks the guard whether to block;
// a block returns guidance and the real read is NOT executed; otherwise the read
// runs and the range is remembered so later duplicates are blocked.  Replaying a
// call sequence through this lets us count how many reads actually reach disk.
function simulateAgentReadLoop(guard, callSequence, mode = "exact") {
  guard.beginTurn();
  const events = [];
  for (const args of callSequence) {
    const decision = guard.checkRead(args, mode);
    if (decision?.block) {
      events.push({ executed: false, blocked: true, reason: decision.reason });
      continue;
    }
    const start = Number(args.start_line) || 1;
    const max = args.whole ? null : Number(args.max_lines) || 50;
    guard.rememberRead(args, { next_offset: max ? start + max : null });
    events.push({ executed: true, blocked: false });
  }
  return events;
}

const executedCount = (events) => events.filter((e) => e.executed).length;
const blockedCount = (events) => events.filter((e) => e.blocked).length;

test("exact repeated read (the Pi loop scenario) executes once, then is blocked every time", () => {
  const guard = new ReadGuard();
  // The Pi tool used {offset, limit}; ds4's read tool uses {start_line, max_lines}.
  const args = { path: "django/contrib/auth/forms.py", start_line: 55, max_lines: 30 };
  const seq = Array.from({ length: 6 }, () => ({ ...args }));

  const events = simulateAgentReadLoop(guard, seq);

  assert.equal(executedCount(events), 1, "only the first identical read should reach the file");
  assert.equal(blockedCount(events), 5, "every subsequent identical read must be blocked");
  // Monotonic block: once blocked it never flips back to executed. This is the
  // exact property the Pi harness lacked (a blocked call later returned content).
  assert.deepEqual(events.map((e) => e.executed), [true, false, false, false, false, false]);
  assert.match(events[1].reason, /Duplicate read blocked/);
  assert.match(events[1].reason, /Do not retry/);
});

test("duplicate read stays blocked across turn boundaries (no per-turn reset)", () => {
  const guard = new ReadGuard();
  const args = { path: "forms.py", start_line: 55, max_lines: 30 };

  // Turn 1: first read executes and is remembered.
  let events = simulateAgentReadLoop(guard, [{ ...args }]);
  assert.equal(executedCount(events), 1);

  // Turn 2: beginTurn() clears only the per-turn block counter, not `seen`, so
  // the same range is still blocked. (seen is wiped only on stop/reset.)
  events = simulateAgentReadLoop(guard, [{ ...args }, { ...args }]);
  assert.equal(executedCount(events), 0, "the same range must remain blocked in a new turn");
  assert.equal(blockedCount(events), 2);
});

test("a revisiting read loop (A,B,A,B,A) is caught once any range repeats", () => {
  const guard = new ReadGuard();
  const A = { path: "forms.py", start_line: 55, max_lines: 30 };
  const B = { path: "forms.py", start_line: 200, max_lines: 30 };

  const events = simulateAgentReadLoop(guard, [A, B, { ...A }, { ...B }, { ...A }]);

  assert.equal(executedCount(events), 2, "A and B each reach disk exactly once");
  assert.equal(blockedCount(events), 3, "every revisit is blocked");
});

test("GAP: a monotonic drift loop (start_line +1 each step) is NOT caught in exact mode", () => {
  const guard = new ReadGuard();
  // An agent that nudges start_line by 1 every call produces a fresh key each
  // time; neither the duplicate nor the covered check fires (56-85 is not fully
  // covered by 55-84, etc.), so every read reaches disk.
  const seq = Array.from({ length: 6 }, (_, i) => ({ path: "forms.py", start_line: 55 + i, max_lines: 30 }));

  const events = simulateAgentReadLoop(guard, seq, "exact");

  assert.equal(executedCount(events), 6, "exact mode lets every drifting read through — residual loop risk");
});

test("GAP: strict mode also fails to catch a purely monotonic drift loop", () => {
  const guard = new ReadGuard();
  const seq = Array.from({ length: 6 }, (_, i) => ({ path: "forms.py", start_line: 55 + i, max_lines: 30 }));

  const events = simulateAgentReadLoop(guard, seq, "strict");

  // Strict mode only escalates after a duplicate/covered block has happened on
  // the path; a never-repeating drift never produces that first block, so strict
  // is no stronger than exact here.
  assert.equal(executedCount(events), 6);
});
