import test from "node:test";
import assert from "node:assert/strict";
import {
  attachEvidence,
  citedSourceIds,
  dedupeSources,
  formatCitations,
  normalizeSource,
  normalizeSources,
  rankSources
} from "./researchSources.mjs";

test("normalizeSource assigns a stable id and infers kind", () => {
  assert.equal(normalizeSource({ text: "x" }, 1).id, "src_001");
  assert.equal(normalizeSource({ url: "http://a" }, 2).kind, "web");
  assert.equal(normalizeSource({ filename: "a.md" }, 3).kind, "file");
  assert.equal(normalizeSource({ text: "x" }, 4).kind, "manual");
});

test("normalizeSource preserves full content for retrieval", () => {
  const long = "The ladder operators raise and lower energy eigenstates. ".repeat(40);
  const s = normalizeSource({ url: "https://x", title: "T", snippet: "short", content: long }, 1);
  assert.match(s.content, /ladder operators/);
  assert.ok(s.content.length > s.snippet.length, "content richer than snippet");
  // falls back to text when no content given
  assert.equal(normalizeSource({ text: "body text" }, 2).content, "body text");
});

test("normalizeSources numbers in order and preserves explicit ids", () => {
  const out = normalizeSources([{ text: "a" }, { id: "src_keep", text: "b" }, { text: "c" }]);
  assert.deepEqual(out.map((s) => s.id), ["src_001", "src_keep", "src_003"]);
});

test("dedupeSources removes duplicate urls and identical text", () => {
  const sources = normalizeSources([
    { url: "http://a", text: "one" },
    { url: "http://a", text: "one again" },
    { text: "same body" },
    { text: "same body" }
  ]);
  const deduped = dedupeSources(sources);
  assert.equal(deduped.length, 2);
});

test("rankSources orders by snippet relevance to the query", () => {
  const sources = normalizeSources([
    { title: "Kafka", text: "kafka partitions and topics" },
    { title: "Sentinel", text: "redis sentinel failover monitoring" }
  ]);
  const ranked = rankSources("sentinel failover", sources);
  assert.equal(ranked[0].title, "Sentinel");
});

test("attachEvidence drops references to unknown source ids", () => {
  const finding = {
    step_id: "s1",
    finding: "f",
    evidence: [{ source_id: "src_001" }, { source_id: "src_999" }]
  };
  const out = attachEvidence(finding, ["src_001"]);
  assert.deepEqual(out.evidence.map((e) => e.source_id), ["src_001"]);
});

test("citedSourceIds extracts unique src ids", () => {
  assert.deepEqual(
    citedSourceIds("foo [src_001] bar src_002 baz [src_001]"),
    ["src_001", "src_002"]
  );
});

test("formatCitations appends a Fonti section for present ids", () => {
  const sources = normalizeSources([{ filename: "a.md", title: "Doc A", text: "x" }]);
  const out = formatCitations("Claim grounded in [src_001].", sources);
  assert.match(out.markdown, /## Fonti/);
  assert.match(out.markdown, /\[src_001\] Doc A — a\.md/);
  assert.deepEqual(out.citedIds, ["src_001"]);
  assert.deepEqual(out.missingIds, []);
});

test("formatCitations flags cited ids with no matching source", () => {
  const out = formatCitations("Bold claim [src_404].", []);
  assert.deepEqual(out.missingIds, ["src_404"]);
  assert.deepEqual(out.citedIds, []);
  assert.ok(!out.markdown.includes("## Fonti"), "no section when nothing valid is cited");
});

test("formatCitations excludes non-citable sources from scientific references", () => {
  const sources = normalizeSources([
    { url: "https://arxiv.org/abs/1234.5678", title: "Paper", snippet: "x" },
    { url: "https://reddit.com/r/science/comments/1", title: "Thread", snippet: "x" }
  ]);
  const out = formatCitations("Compare [src_001] with [src_002].", sources);

  assert.match(out.markdown, /\[src_001\] Paper — https:\/\/arxiv\.org\/abs\/1234\.5678/);
  assert.doesNotMatch(out.markdown, /\[src_002\] Thread/);
  assert.deepEqual(out.citedIds, ["src_001"]);
  assert.deepEqual(out.nonCitableIds, ["src_002"]);
  assert.deepEqual(out.missingIds, []);
});
