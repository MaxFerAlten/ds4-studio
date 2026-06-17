import test from "node:test";
import assert from "node:assert/strict";
import { exportHtml, exportMarkdown, exportPdf, exportSession, markdownToHtml } from "./researchExport.mjs";

const STATE = {
  query: "Redis Cluster vs Sentinel",
  finalReport: "# Titolo\n\n## Sintesi\n\nGrounded in [src_001].\n\n## Fonti\n\n- [src_001] Doc A — a.md"
};

test("exportMarkdown frames the report under the query title", () => {
  const md = exportMarkdown(STATE);
  assert.match(md, /# Redis Cluster vs Sentinel/);
  assert.match(md, /\[src_001\]/);
  assert.match(md, /## Fonti/);
});

test("exportMarkdown handles a missing report gracefully", () => {
  const md = exportMarkdown({ query: "q", finalReport: null });
  assert.match(md, /no report produced/);
});

test("exportMarkdown normalizes Obsidian math without changing ordinary code fences", () => {
  const md = exportMarkdown({
    query: "Math",
    finalReport: [
      "Inline \\(E=mc^2\\).",
      "",
      "\\[",
      "x+y",
      "\\]",
      "",
      "```text",
      "\\(literal\\)",
      "\\[literal\\]",
      "```"
    ].join("\n")
  });

  assert.match(md, /Inline \$E=mc\^2\$\./);
  assert.match(md, /\$\$\nx\+y\n\$\$/);
  assert.match(md, /```text\n\\\(literal\\\)\n\\\[literal\\\]\n```/);
  assert.doesNotMatch(md, /Inline \\\(/);
});

test("markdownToHtml renders headings, paragraphs and lists", () => {
  const html = markdownToHtml("# H1\n\ntext **bold**\n\n- a\n- b");
  assert.match(html, /<h1>H1<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
});

test("markdownToHtml renders ordered lists and fenced code, escaping html", () => {
  const html = markdownToHtml("1. one\n2. two\n\n```\n<script>x</script>\n```");
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<pre><code>&lt;script&gt;x&lt;\/script&gt;<\/code><\/pre>/);
});

test("markdownToHtml escapes inline html in paragraphs", () => {
  const html = markdownToHtml("a < b & c");
  assert.match(html, /<p>a &lt; b &amp; c<\/p>/);
});

test("exportHtml produces a self-contained document carrying the report", () => {
  const html = exportHtml(STATE);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Redis Cluster vs Sentinel<\/title>/);
  assert.match(html, /<h2>Sintesi<\/h2>/);
  assert.match(html, /src_001/);
});

test("exportSession dispatches by format and rejects unknown", async () => {
  assert.equal((await exportSession(STATE, "md")).ext, "md");
  assert.equal((await exportSession(STATE, "html")).contentType, "text/html; charset=utf-8");
  await assert.rejects(() => exportSession(STATE, "docx"), /unsupported export format/);
});

test("exportPdf generates a valid PDF via wkhtmltopdf", async () => {
  const pdf = await exportPdf(STATE);
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 0);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});

test("exportSession returns a PDF with correct content type", async () => {
  const result = await exportSession(STATE, "pdf");
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.ext, "pdf");
  assert.ok(Buffer.isBuffer(result.body));
  assert.ok(result.body.length > 0);
  assert.equal(result.body.subarray(0, 5).toString(), "%PDF-");
});
