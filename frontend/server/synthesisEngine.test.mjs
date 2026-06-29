import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSynthesisBrief } from "./synthesisEngine.mjs";
import { evidenceFromCrawlManifest } from "./evidenceStore.mjs";

test("brief instructs synthesis + citation and lists usable evidence", () => {
  const evidence = evidenceFromCrawlManifest({ pages: [
    { url: "https://conf.org/cfp", state: "succeeded", content: "Official call for papers. Submission deadline May 2026. Program committee listed." },
    { url: "https://neuronfeed.test", state: "succeeded", content: "Top 10 best conferences, curated ranking. Acceptance rate 18%." }
  ] });
  const brief = buildSynthesisBrief(evidence, { question: "which AI conferences in 2026?" });
  assert.match(brief, /SYNTHESIS REQUIRED/);
  assert.match(brief, /cit/i);
  assert.match(brief, /which AI conferences in 2026/);
  assert.match(brief, /https:\/\/conf\.org\/cfp/);
  assert.match(brief, /PRIMARY_OFFICIAL/);
  assert.match(brief, /SECONDARY_EDITORIAL/);
});

test("brief flags no-usable-evidence and forbids fabrication", () => {
  const evidence = evidenceFromCrawlManifest({ pages: [
    { url: "https://x.test", state: "failed", content: "" },
    { url: "https://y.test", state: "succeeded", content: "404 Not Found" }
  ] });
  const brief = buildSynthesisBrief(evidence, { question: "q" });
  assert.match(brief, /No usable evidence/);
  assert.match(brief, /Do not fabricate/);
});

test("brief surfaces unresolved follow-up links from a hub", () => {
  const links = Array.from({ length: 16 }, (_, i) => `https://aideadlines.org/c/${i}`).join(" ");
  const evidence = evidenceFromCrawlManifest({ pages: [{ url: "https://hub.test", state: "succeeded", content: links }] });
  const brief = buildSynthesisBrief(evidence, {});
  assert.match(brief, /Unresolved \(consider crawling next\)/);
  assert.match(brief, /aideadlines\.org/);
});
