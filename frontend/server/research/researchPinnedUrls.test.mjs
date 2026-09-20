import assert from "node:assert/strict";
import { test } from "node:test";
import { backgroundInvestigatorNode, explicitUrlsIn, relevantSourcesFor } from "./researchNodes.mjs";

test("only URLs the user typed are extracted", () => {
  const q = "descrivi gli oscillatori e cerca su https://massimilianosassolidebianchi.ch/it/articles-peer, " +
            "poi confronta con http://example.org/a.html (vedi https://example.org/a.html) e ftp://nope/x";
  // http:// and https:// of the same path are different URLs and both are kept;
  // only an exact repeat is dropped.
  assert.deepEqual(explicitUrlsIn(q), [
    "https://massimilianosassolidebianchi.ch/it/articles-peer",
    "http://example.org/a.html",
    "https://example.org/a.html"
  ]);
  assert.deepEqual(explicitUrlsIn("https://x.example/a https://x.example/a"), ["https://x.example/a"]);
  assert.deepEqual(explicitUrlsIn("nessun indirizzo qui"), []);
  assert.deepEqual(explicitUrlsIn(null), []);
});

function ctxWith({ query, readPage, webFetchEnabled = true }) {
  return {
    state: { query, optimizedQueries: [] },
    config: { webFetchEnabled, maxSourcesPerQuery: 2, maxCharsPerPage: 4000, timeoutMs: 100 },
    emit: () => {},
    readPage,
    searchService: {
      enabled: () => true,
      gather: async () => [
        // Distinct text: dedupeSources folds identical bodies by hash.
        { title: "Un risultato di ricerca", url: "https://search.example/1",
          content: "oscillatore armonico quantistico energia ".repeat(60), snippet: "s1", provider: "tavily", sourceType: "web", score: 9 },
        { title: "Un altro", url: "https://search.example/2",
          content: "oscillatore armonico operatori scala ".repeat(60), snippet: "s2", provider: "tavily", sourceType: "web", score: 8 }
      ]
    }
  };
}

test("a requested URL becomes a source and outranks search results", async () => {
  const ctx = ctxWith({
    query: "oscillatori armonici, vedi https://sassoli.example/it/articles-peer",
    readPage: async (url) => ({ url, title: "Articles peer", content: "un testo che non contiene la parola cercata ".repeat(20) })
  });
  const out = await backgroundInvestigatorNode(ctx);
  assert.equal(out.pinnedCount, 1);

  const picked = relevantSourcesFor(ctx, { question: "oscillatore armonico" });
  // maxSourcesPerQuery is 2 and two search results score higher on the query,
  // so without the pin the requested page places third out of two.
  assert.equal(picked[0].url, "https://sassoli.example/it/articles-peer");
  assert.ok(picked[0].relevantText.length > 0, "a pinned page nothing matched still carries text");
});

test("an unreadable URL warns and does not abort the run", async () => {
  const warnings = [];
  const ctx = ctxWith({
    query: "vedi https://down.example/x",
    readPage: async () => null
  });
  ctx.emit = (name, payload) => warnings.push([name, payload]);
  const out = await backgroundInvestigatorNode(ctx);
  assert.equal(out.pinnedCount, 0);
  assert.ok(out.sourceCount >= 2, "search sources still gathered");
  assert.ok(warnings.some(([n, p]) => n === "search_provider_warning" && p.url === "https://down.example/x"));
});

test("webFetchEnabled false refuses to open the URL", async () => {
  let called = false;
  const ctx = ctxWith({
    query: "vedi https://sassoli.example/x",
    readPage: async () => { called = true; return { content: "x" }; },
    webFetchEnabled: false
  });
  const out = await backgroundInvestigatorNode(ctx);
  assert.equal(called, false);
  assert.equal(out.pinnedCount, 0);
});
