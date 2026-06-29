// Guards the news-intent gate: the Google News block (changing "most recent first"
// RSS) must NOT be prepended to ordinary searches, which made answers look
// fabricated / "always different". Pure unit test — no browser.
import test from "node:test";
import assert from "node:assert/strict";
import { isNewsQuery } from "./webSearchTool.mjs";

test("isNewsQuery true for news-intent queries", () => {
  for (const q of [
    "le 10 news della giornata",
    "ultime notizie su AI",
    "latest AI news today",
    "breaking news"
  ]) {
    assert.equal(isNewsQuery(q), true, q);
  }
});

test("isNewsQuery false for ordinary searches", () => {
  for (const q of [
    "trovami sul web 5 migliori siti dove pubblicare paper sulla intelligenza artificiale",
    "quantum harmonic oscillator theory in LLM papers",
    "best python json library"
  ]) {
    assert.equal(isNewsQuery(q), false, q);
  }
});
