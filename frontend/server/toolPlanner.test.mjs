import { test } from "node:test";
import assert from "node:assert/strict";
import { planTools } from "./toolPlanner.mjs";
import { createTaskState } from "./agentTaskState.mjs";

const caps = { crawl: true };

test("LINK_FOUND_NOT_OPENED intent plans a crawl for every unresolved link", () => {
  const taskState = createTaskState([
    { role: "assistant", content: "LINK_FOUND_NOT_OPENED: http://aideadlines.org/ https://mi-research.net/news/712" }
  ]);
  const actions = planTools({
    userText: "per ogni LINK_FOUND_NOT_OPENED usa la chiamata /crawl start...",
    taskState,
    capabilities: caps
  });
  assert.deepEqual(actions.map((a) => a.args.url), [
    "http://aideadlines.org/",
    "https://mi-research.net/news/712"
  ]);
  assert.ok(actions.every((a) => a.tool === "crawl"));
});

test("explicit url + open/crawl verb plans a crawl from the user text", () => {
  const actions = planTools({
    userText: "apri https://example.com/page",
    taskState: createTaskState([]),
    capabilities: caps
  });
  assert.deepEqual(actions, [{ tool: "crawl", args: { url: "https://example.com/page", purpose: "user requested URL" } }]);
});

test("english 'crawl all the links' also triggers unresolved-link planning", () => {
  const taskState = createTaskState([{ role: "assistant", content: "found http://a.test/ http://b.test/" }]);
  const actions = planTools({ userText: "crawl all the links you found", taskState, capabilities: caps });
  assert.deepEqual(actions.map((a) => a.args.url), ["http://a.test/", "http://b.test/"]);
});

test("§18.7 a bare 'sì/procedi' confirms and executes the pending crawl", () => {
  const taskState = createTaskState([{ role: "assistant", content: "found http://a.test/ http://b.test/" }]);
  for (const yes of ["sì", "si", "ok procedi", "yes", "vai", "go ahead"]) {
    const actions = planTools({ userText: yes, taskState, capabilities: caps });
    assert.deepEqual(actions.map((a) => a.args.url), ["http://a.test/", "http://b.test/"], `"${yes}" should execute pending crawl`);
  }
});

test("affirmative with no pending links does nothing", () => {
  assert.deepEqual(planTools({ userText: "sì", taskState: createTaskState([]), capabilities: caps }), []);
});

test("an affirmative buried in a longer request does not auto-fire", () => {
  const taskState = createTaskState([{ role: "assistant", content: "found http://a.test/" }]);
  assert.deepEqual(planTools({ userText: "sì, ma prima dimmi il meteo", taskState, capabilities: caps }), []);
});

test("no crawl intent returns no actions (tool choice stays with the model)", () => {
  assert.deepEqual(planTools({ userText: "what's the weather?", taskState: createTaskState([]), capabilities: caps }), []);
  assert.deepEqual(planTools({ userText: "summarize this", taskState: createTaskState([{ role: "assistant", content: "http://x.test/" }]), capabilities: caps }), []);
});

test("crawl capability disabled returns no actions", () => {
  const taskState = createTaskState([{ role: "assistant", content: "http://x.test/" }]);
  assert.deepEqual(planTools({ userText: "crawl all the links", taskState, capabilities: {} }), []);
});
