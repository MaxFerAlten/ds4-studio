import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EvidenceStore, EXTRACTED_FROM_SOURCE, extractClaims, normalizeEvidenceItem,
  buildEvidenceItem, evidenceFromCrawlManifest, evidenceFromResearchSources
} from "./evidenceStore.mjs";

test("extractClaims keeps sentences that look like factual claims, caps count", () => {
  const text = "ICML is a conference. Its acceptance rate is 21%. It ranks tier 1. " +
    "The deadline is May 2026. Some prose with no claim here. Another with 99 papers. One more number 7 here.";
  const claims = extractClaims(text, { max: 5 });
  assert.ok(claims.length > 0 && claims.length <= 5);
  // Not SUPPORTED_BY_THIS_SOURCE: a regex that matched a sentence establishes
  // that the sentence is in the page, nothing about whether the page supports
  // the proposition. Entailment is a separate step with its own verdict.
  assert.ok(claims.every((c) => c.status === EXTRACTED_FROM_SOURCE));
  assert.equal(EXTRACTED_FROM_SOURCE, "EXTRACTED_FROM_SOURCE");
  assert.ok(claims.some((c) => /21%/.test(c.claim)));
  assert.ok(!claims.some((c) => /no claim here/.test(c.claim)));
});

test("normalizeEvidenceItem fills id and defaults", () => {
  const a = normalizeEvidenceItem({ url: "https://x.test" });
  assert.match(a.id, /^ev_/);
  assert.deepEqual(a.extractedClaims, []);
  assert.deepEqual(a.limitations, []);
  assert.equal(a.status, "EMPTY");
  const b = normalizeEvidenceItem({ url: "https://y.test" });
  assert.notEqual(a.id, b.id, "ids must be unique");
});

test("buildEvidenceItem fuses critic judgment + claims for an editorial source", () => {
  const item = buildEvidenceItem(
    { url: "https://neuronfeed.test", title: "Top conferences", content: "Top 10 best AI conferences, curated ranking. Acceptance rate around 18%." },
    { acquisition: "crawl" }
  );
  assert.equal(item.sourceType, "SECONDARY_EDITORIAL");
  assert.equal(item.acquisition, "crawl");
  assert.equal(item.status, "CRAWLED");
  assert.ok(item.limitations.length > 0);
  assert.ok(item.extractedClaims.some((c) => c.scope === "third_party_ranking"));
});

test("buildEvidenceItem captures follow-up links for a link hub", () => {
  const links = Array.from({ length: 16 }, (_, i) => `https://aideadlines.org/c/${i}`).join(" ");
  const item = buildEvidenceItem({ url: "https://hub.test", content: links }, { acquisition: "crawl" });
  assert.equal(item.sourceType, "LINK_HUB");
  assert.equal(item.nextAction, "extract_links_and_crawl_selected");
  assert.ok(item.nextLinks.length >= 8);
});

test("evidenceFromCrawlManifest maps pages to items", () => {
  const items = evidenceFromCrawlManifest({ pages: [
    { url: "https://a.test", state: "succeeded", content: "Acceptance rate 21% reported here." },
    { url: "https://b.test", state: "failed", content: "" }
  ] });
  assert.equal(items.length, 2);
  assert.equal(items[1].status, "EMPTY");
});

test("EvidenceStore add/byUrl/useful/unresolved", () => {
  const store = new EvidenceStore();
  store.addMany(evidenceFromResearchSources([
    { url: "https://p.test", content: "Official call for papers. Submission deadline 2026." },
    { url: "https://err.test", content: "404 Not Found" }
  ]));
  store.add(buildEvidenceItem({ url: "https://hub.test", content: Array.from({ length: 16 }, (_, i) => `https://x.test/${i}`).join(" ") }, { acquisition: "crawl" }));

  assert.equal(store.byUrl("https://p.test").length, 1);
  const usefulUrls = store.useful().map((e) => e.url);
  assert.ok(usefulUrls.includes("https://p.test"));
  assert.ok(!usefulUrls.includes("https://err.test"), "UNRELATED/empty source excluded from useful()");
  assert.ok(store.unresolved().some((e) => e.url === "https://hub.test"), "link hub is unresolved");
});

test("normalizeEvidenceItem carries provenance without breaking existing callers", () => {
  // QF-03 §25.3. Every new field is additive: a caller that knew nothing about
  // provenance still gets the shape it always got.
  const legacy = normalizeEvidenceItem({ url: "https://x.test", contentSummary: "hello" });
  assert.equal(legacy.url, "https://x.test");
  assert.equal(legacy.contentSummary, "hello");
  assert.deepEqual(legacy.extractedClaims, []);

  assert.equal(legacy.evidenceType, "source_document");
  assert.equal(legacy.exactResult, false);
  assert.equal(legacy.isError, false);
  assert.equal(legacy.toolName, "");
  assert.deepEqual(legacy.supportsClaimIds, []);
  assert.deepEqual(legacy.sourceSpans, []);
  assert.match(legacy.retrievedAt, /^\d{4}-\d{2}-\d{2}T/);
  // sha256 of the content, not a custom construction.
  assert.equal(legacy.sourceHash.length, 64);
  assert.equal(
    legacy.sourceHash,
    normalizeEvidenceItem({ contentSummary: "hello" }).sourceHash
  );
  assert.notEqual(
    legacy.sourceHash,
    normalizeEvidenceItem({ contentSummary: "hello!" }).sourceHash
  );
});
