// Locks the shared grounding helper that feeds web-search results to the model in
// BOTH chat mode (injectSearchResults → user turn) and agent mode (searchResultsBlock
// → outbound message). Regression guard for the bug where agent mode answered blind.
import test from "node:test";
import assert from "node:assert/strict";
import { injectSearchResults, searchResultsBlock } from "./appLogic.mjs";

test("searchResultsBlock carries the grounding directive and the results", () => {
  const block = searchResultsBlock("RESULT-XYZ");
  assert.match(block, /Answer using ONLY these results/);
  assert.match(block, /do not invent/);
  assert.ok(block.includes("RESULT-XYZ"));
});

test("injectSearchResults appends the block to the latest user turn", () => {
  const messages = [
    { role: "user", content: "old" },
    { role: "assistant", content: "old reply" },
    { role: "user", content: "find papers" },
    { role: "assistant", content: "" } // empty assistant placeholder
  ];
  const out = injectSearchResults(messages, "RESULT-XYZ");
  const userTurn = out[out.length - 2];
  assert.equal(userTurn.role, "user");
  assert.ok(userTurn.content.startsWith("find papers"));
  assert.ok(userTurn.content.includes("RESULT-XYZ"));
  assert.match(userTurn.content, /Answer using ONLY these results/);
  assert.equal(out[0].content, "old"); // other turns untouched
});

test("injectSearchResults is a no-op without results", () => {
  const messages = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "" }
  ];
  assert.equal(injectSearchResults(messages, ""), messages);
  assert.equal(injectSearchResults(messages, null), messages);
});
