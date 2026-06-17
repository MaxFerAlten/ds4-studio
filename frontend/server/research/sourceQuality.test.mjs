import test from "node:test";
import assert from "node:assert/strict";
import { classifySource, domainOf } from "./sourceQuality.mjs";

const SCI = { mode: "scientific" };

test("domainOf strips www and lowercases", () => {
  assert.equal(domainOf("https://WWW.Nature.com/articles/x"), "nature.com");
  assert.equal(domainOf("not a url"), null);
});

test("tier 1: scholarly hosts, DOI, .edu/.gov, academic providers, files", () => {
  assert.deepEqual(classifySource({ url: "https://arxiv.org/abs/1" }, SCI), { tier: 1, citable: true });
  assert.deepEqual(classifySource({ url: "https://doi.org/10.1/x" }, SCI), { tier: 1, citable: true });
  assert.deepEqual(classifySource({ url: "https://cs.stanford.edu/p" }, SCI), { tier: 1, citable: true });
  assert.deepEqual(classifySource({ url: "https://nih.gov/p" }, SCI), { tier: 1, citable: true });
  assert.deepEqual(classifySource({ url: "https://x.ac.uk/p" }, SCI), { tier: 1, citable: true });
  assert.deepEqual(classifySource({ url: "https://anything", provider: "cnr" }, SCI), { tier: 1, citable: true });
  assert.deepEqual(classifySource({ kind: "file", filename: "a.pdf" }, SCI), { tier: 1, citable: true });
  assert.deepEqual(classifySource({ url: "https://link.springer.com/a" }, SCI), { tier: 1, citable: true });
});

test("sourceType can classify provider results without a known host", () => {
  assert.deepEqual(classifySource({ url: "https://example.com/x", sourceType: "paper" }, SCI), { tier: 1, citable: true });
  assert.deepEqual(classifySource({ url: "https://example.com/x", sourceType: "dataset" }, SCI), { tier: 1, citable: true });
  assert.deepEqual(classifySource({ url: "https://example.com/x", sourceType: "forum" }, SCI), { tier: 3, citable: false });
  assert.deepEqual(classifySource({ url: "https://example.com/x", sourceType: "blog" }, SCI), { tier: 3, citable: false });
});

test("tier 3: social, forums, blogs, SEO tutorials are never citable", () => {
  for (const url of [
    "https://twitter.com/x", "https://www.reddit.com/r/p", "https://medium.com/@a/b",
    "https://stackoverflow.com/q/1", "https://w3schools.com/x", "https://youtube.com/watch"
  ]) {
    assert.deepEqual(classifySource({ url }, SCI), { tier: 3, citable: false }, url);
  }
});

test("tier 2: general web is contextual, not citable in scientific mode", () => {
  assert.deepEqual(classifySource({ url: "https://en.wikipedia.org/wiki/X" }, SCI), { tier: 2, citable: false });
  assert.deepEqual(classifySource({ url: "https://somenews.com/a" }, SCI), { tier: 2, citable: false });
});

test("general mode makes tier 2 citable but still drops tier 3", () => {
  assert.equal(classifySource({ url: "https://en.wikipedia.org/wiki/X" }, { mode: "general" }).citable, true);
  assert.equal(classifySource({ url: "https://reddit.com/r/x" }, { mode: "general" }).citable, false);
});

test("config allow/deny domains override the defaults", () => {
  assert.equal(classifySource({ url: "https://myjournal.io/a" }, { mode: "scientific", allowDomains: ["myjournal.io"] }).tier, 1);
  assert.equal(classifySource({ url: "https://nature.com/a" }, { mode: "scientific", denyDomains: ["nature.com"] }).tier, 1); // allow/tier1 wins
  assert.equal(classifySource({ url: "https://blogfarm.net/a" }, { mode: "scientific", denyDomains: ["blogfarm.net"] }).tier, 3);
});
