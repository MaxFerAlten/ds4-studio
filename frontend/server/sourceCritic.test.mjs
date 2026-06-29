import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySource, classifySourceType, decideNextAction, critiqueLine, detectLinkHub, SOURCE_TYPES
} from "./sourceCritic.mjs";

const linkHubText = Array.from({ length: 16 }, (_, i) => `https://aideadlines.org/conf/${i}`).join(" ");
const article = "This conference reports an acceptance rate of 21%. It was held in Vancouver. " +
  "The proceedings include 1500 papers across many tracks. ".repeat(8);

test("editorial 'Top N / curated / tier 1' page is SECONDARY_EDITORIAL", () => {
  const text = "Top 10 AI conferences of 2026. Our curated ranking. Tier 1 must-attend events.";
  assert.equal(classifySourceType("https://neuronfeed.test/post", text), SOURCE_TYPES.SECONDARY_EDITORIAL);
});

test("known ranking database host is RANKING_DATABASE", () => {
  assert.equal(classifySourceType("https://portal.core.edu.au/conf-ranks/", "ICML A* rank"), SOURCE_TYPES.RANKING_DATABASE);
});

test("official venue page with a CFP is PRIMARY_OFFICIAL", () => {
  const text = "Call for papers. Submission deadline May 2026. Program committee listed below.";
  assert.equal(classifySourceType("https://someconf.org/cfp", text), SOURCE_TYPES.PRIMARY_OFFICIAL);
});

test("commercial page is COMMERCIAL_NOISE", () => {
  assert.equal(classifySourceType("https://shop.test", "Buy now! Free trial and discount code inside."), SOURCE_TYPES.COMMERCIAL_NOISE);
});

test("link-heavy page is LINK_HUB", () => {
  assert.equal(classifySourceType("https://hub.test", linkHubText), SOURCE_TYPES.LINK_HUB);
});

test("detectLinkHub needs many links AND little prose (§16.2)", () => {
  assert.equal(detectLinkHub({ content: linkHubText }), true);
  // few links → not a hub
  assert.equal(detectLinkHub({ content: "https://a.test only one link here" }), false);
  // many links but lots of prose → not a hub
  const linksPlusProse = linkHubText + " " + "word ".repeat(700);
  assert.equal(detectLinkHub({ content: linksPlusProse }), false);
  // explicit links array honored
  assert.equal(detectLinkHub({ content: "x", links: Array.from({ length: 20 }, (_, i) => `u${i}`) }), true);
});

test("error page is UNRELATED, not THIN_PAGE", () => {
  assert.equal(classifySourceType("https://x.test", "404 Not Found"), SOURCE_TYPES.UNRELATED);
});

test("short non-error page is THIN_PAGE", () => {
  assert.equal(classifySourceType("https://x.test", "A two-line bio. Nothing else here."), SOURCE_TYPES.THIN_PAGE);
});

test("decideNextAction follows the plan's ladder", () => {
  assert.equal(decideNextAction("https://x.test", ""), "discard");
  assert.equal(decideNextAction("https://x.test", "404 not found"), "discard");
  assert.equal(decideNextAction("https://hub.test", linkHubText), "extract_links_and_crawl_selected");
  assert.equal(decideNextAction("https://x.test", "short."), "seek_better_source");
  assert.equal(decideNextAction("https://x.test", article), "extract_claims");
});

test("classifySource returns the full critique shape", () => {
  const c = classifySource({ url: "https://neuronfeed.test", content: "Top 10 best conferences, curated ranking." });
  assert.equal(c.sourceType, SOURCE_TYPES.SECONDARY_EDITORIAL);
  assert.equal(c.quality, "useful but not authoritative");
  assert.ok(Array.isArray(c.limitations) && c.limitations.length > 0);
  assert.ok("nextAction" in c && "contentType" in c);
});

test("critiqueLine is a compact single line with type, action and limits", () => {
  const line = critiqueLine({ url: "https://neuronfeed.test", content: "Top 10 best, curated ranking." });
  assert.match(line, /^↳ critique: SECONDARY_EDITORIAL/);
  assert.match(line, /limits:/);
  assert.ok(!line.includes("\n"), "must stay on one line");
});
