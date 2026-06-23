import test from "node:test";
import assert from "node:assert/strict";
import { ArxivProvider, parseArxivFeed } from "./providers.mjs";

const FEED = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/0710.2724v4</id>
    <title>General Solution of the Quantum Damped
      Harmonic Oscillator</title>
    <summary>  In this paper the general solution is given &amp; verified.</summary>
    <author><name>K. Fujii</name></author>
    <author><name>T. Suzuki</name></author>
    <published>2007-10-15T06:21:19Z</published>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/1234.5678v1</id>
    <title>Second Paper</title>
    <summary>Abstract two.</summary>
    <published>2020-01-01T00:00:00Z</published>
  </entry>
</feed>`;

function textRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

test("parseArxivFeed extracts entries, decodes entities, collapses whitespace", () => {
  const out = parseArxivFeed(FEED);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "General Solution of the Quantum Damped Harmonic Oscillator");
  assert.equal(out[0].summary, "In this paper the general solution is given & verified.");
  assert.deepEqual(out[0].authors, ["K. Fujii", "T. Suzuki"]);
  assert.equal(out[0].id, "http://arxiv.org/abs/0710.2724v4");
});

test("arxiv provider is keyless and academic", () => {
  const p = new ArxivProvider({});
  assert.equal(p.name(), "arxiv");
  assert.equal(p.requiresApiKey(), false);
  assert.equal(p.isConfigured(), true);
  assert.deepEqual(p.supports(), ["ACADEMIC_RESEARCH"]);
});

test("arxiv search builds the query url and maps papers", async () => {
  let calledUrl = null;
  const p = new ArxivProvider({
    fetchImpl: async (url) => {
      calledUrl = url;
      return textRes(FEED);
    }
  });
  const out = await p.search("quantum oscillator", { maxResults: 2 });
  assert.match(calledUrl, /export\.arxiv\.org\/api\/query/);
  assert.match(calledUrl, /search_query=all%3Aquantum%20oscillator/);
  assert.match(calledUrl, /max_results=2/);
  assert.equal(out.provider, "arxiv");
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].sourceType, "paper");
  assert.equal(out.results[0].url, "http://arxiv.org/abs/0710.2724v4");
  assert.match(out.results[0].content, /Authors: K\. Fujii, T\. Suzuki/);
});

test("arxiv warns on empty feed and throws on HTTP error", async () => {
  const empty = new ArxivProvider({ fetchImpl: async () => textRes("<feed></feed>") });
  const out = await empty.search("x");
  assert.equal(out.results.length, 0);
  assert.deepEqual(out.warnings, ["arxiv: no results"]);
  const bad = new ArxivProvider({ fetchImpl: async () => textRes("", 503) });
  await assert.rejects(() => bad.search("x"), /HTTP 503/);
});
