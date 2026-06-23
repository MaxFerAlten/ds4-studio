import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeltaBatcher } from "./utils.mjs";

function fakeTimers() {
  const timers = [];
  const cleared = [];
  return {
    timers,
    cleared,
    setTimeoutFn(fn, delayMs) {
      const id = { fn, delayMs };
      timers.push(id);
      return id;
    },
    clearTimeoutFn(id) {
      cleared.push(id);
    }
  };
}

test("coalesces content and reasoning until scheduled flush", () => {
  const timer = fakeTimers();
  const flushed = [];
  const batcher = createDeltaBatcher(
    (content, reasoning) => flushed.push({ content, reasoning }),
    { delayMs: 40, setTimeoutFn: timer.setTimeoutFn, clearTimeoutFn: timer.clearTimeoutFn }
  );

  batcher.push("hel", "rea");
  batcher.push("lo", "son");

  assert.equal(timer.timers.length, 1);
  assert.equal(timer.timers[0].delayMs, 40);
  assert.deepEqual(flushed, []);

  timer.timers[0].fn();
  assert.deepEqual(flushed, [{ content: "hello", reasoning: "reason" }]);

  batcher.push("!", "");
  assert.equal(timer.timers.length, 2);
});

test("flush emits pending delta immediately and clears scheduled timer", () => {
  const timer = fakeTimers();
  const flushed = [];
  const batcher = createDeltaBatcher(
    (content, reasoning) => flushed.push({ content, reasoning }),
    { setTimeoutFn: timer.setTimeoutFn, clearTimeoutFn: timer.clearTimeoutFn }
  );

  batcher.push("a", "");

  assert.equal(batcher.flush(), true);
  assert.equal(timer.cleared.length, 1);
  assert.deepEqual(flushed, [{ content: "a", reasoning: "" }]);
  assert.equal(batcher.flush(), false);

  timer.timers[0].fn();
  assert.deepEqual(flushed, [{ content: "a", reasoning: "" }]);
});

test("cancel drops buffered delta", () => {
  const timer = fakeTimers();
  const flushed = [];
  const batcher = createDeltaBatcher(
    (content, reasoning) => flushed.push({ content, reasoning }),
    { setTimeoutFn: timer.setTimeoutFn, clearTimeoutFn: timer.clearTimeoutFn }
  );

  batcher.push("lost", "reasoning");
  batcher.cancel();
  timer.timers[0].fn();

  assert.equal(timer.cleared.length, 1);
  assert.deepEqual(flushed, []);
});
