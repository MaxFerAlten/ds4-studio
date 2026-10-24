// Regression: inside sendAgentMessage's SSE loop a bare `return` (used to skip
// a hidden Sage tool call/result) left the whole function, so the page
// stopped reading the agent stream at the first Sage call while the server
// finished the turn unseen.  Skipping an event must be `continue`.
//
// Source contract: App.jsx is a React module; the loop is not importable.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("the agent SSE loop never returns out of sendAgentMessage to skip an event", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const fn = source.indexOf("async function sendAgentMessage(");
  assert.notEqual(fn, -1);
  const loop = source.indexOf("for (const part of parts) {", fn);
  const end = source.indexOf("deltaBatcher.flush();\n      if (streamUsage)", loop);
  assert.ok(loop > fn && end > loop, "stream loop located");
  const offenders = source.slice(loop, end).split("\n")
    .map((line, i) => ({ line: line.trim(), i }))
    .filter(({ line }) => /^(if \(.*\) )?return;$/.test(line));
  assert.deepEqual(offenders, [], "use `continue` to skip an SSE event");
});
