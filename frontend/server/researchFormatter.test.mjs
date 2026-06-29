import { test } from "node:test";
import assert from "node:assert/strict";
import { formatResearchSources } from "./researchFormatter.mjs";

const sources = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Title ${i}`, url: `https://s.test/${i}`, provider: "tavily", snippet: `snippet ${i}`
}));

test("formats sources with metadata + synthesize directive", () => {
  const out = formatResearchSources([{ title: "T", url: "https://a.test", provider: "arxiv", qualityTier: "primary", snippet: "abc" }]);
  assert.match(out, /\[1\] T/);
  assert.match(out, /URL: https:\/\/a\.test/);
  assert.match(out, /provider: arxiv/);
  assert.match(out, /tier: primary/);
  assert.match(out, /do not paste them back verbatim/i);
});

test("depth caps the number of sources", () => {
  assert.match(formatResearchSources(sources(30), { depth: "shallow" }), /showing 5 ranked/);
  assert.match(formatResearchSources(sources(30), { depth: "normal" }), /showing 10 ranked/);
  assert.match(formatResearchSources(sources(30), { depth: "deep" }), /showing 20 ranked/);
  assert.ok(!formatResearchSources(sources(30), { depth: "shallow" }).includes("https://s.test/5"));
});

test("requirePrimarySources keeps only primary/citable sources", () => {
  const mixed = [
    { title: "blog", url: "https://b.test", snippet: "x" },
    { title: "paper", url: "https://p.test", citable: true, snippet: "y" }
  ];
  const out = formatResearchSources(mixed, { requirePrimarySources: true });
  assert.match(out, /https:\/\/p\.test/);
  assert.ok(!out.includes("https://b.test"), "non-primary must be dropped");
});

test("requirePrimarySources falls back to all when none are primary", () => {
  const out = formatResearchSources([{ title: "blog", url: "https://b.test", snippet: "x" }], { requirePrimarySources: true });
  assert.match(out, /no primary sources found/);
  assert.match(out, /https:\/\/b\.test/);
});

test("truncates long content instead of dumping it raw", () => {
  const big = "z".repeat(5000);
  const out = formatResearchSources([{ title: "T", url: "https://a.test", content: big }], { snippetChars: 100 });
  assert.ok(!out.includes(big));
  assert.match(out, /truncated \d+ chars/);
});

test("handles empty input", () => {
  assert.match(formatResearchSources([]), /found no sources/);
  assert.match(formatResearchSources(null), /found no sources/);
});
