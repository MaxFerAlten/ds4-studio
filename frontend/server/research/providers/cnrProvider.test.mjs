import test from "node:test";
import assert from "node:assert/strict";
import { CnrProvider, parseCnrSolr, toSolrTextQuery } from "./cnrProvider.mjs";

const SOLR = `<?xml version="1.0" encoding="UTF-8"?>
<response>
<result name="response" numFound="2" start="0">
<doc>
  <str name="ID">485722</str>
  <str name="titolo_s-s">Propagating quantum microwaves &amp; sensing</str>
  <str name="abstract_s-s">The field of propagating quantum microwaves is new.</str>
  <arr name="autori_s-i-s-m"><str>Rossi A.</str><str>Bianchi B.</str></arr>
  <str name="anno_s-i-s">2017</str>
  <arr name="doi_s-i-s-m"><str>10.1016/j.x.2017.07.002</str></arr>
  <arr name="source_s-s-m"><str>Quantum Sci. Tech. 8 (2)</str></arr>
</doc>
<doc>
  <str name="ID">999</str>
  <str name="titolo_s-s">No DOI paper</str>
  <str name="abstract_s-s">Abstract two.</str>
</doc>
</result>
</response>`;

function textRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

test("toSolrTextQuery strips Solr metacharacters and wraps in TEXT", () => {
  assert.equal(toSolrTextQuery("quantum oscillator"), "TEXT:(quantum oscillator)");
  assert.equal(toSolrTextQuery("c++ : (AI) & ml?"), "TEXT:(c AI ml)");
  assert.equal(toSolrTextQuery("   "), "TEXT:(*)");
});

test("parseCnrSolr extracts docs, arrays, and decodes entities", () => {
  const docs = parseCnrSolr(SOLR);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].title, "Propagating quantum microwaves & sensing");
  assert.deepEqual(docs[0].authors, ["Rossi A.", "Bianchi B."]);
  assert.equal(docs[0].doi, "10.1016/j.x.2017.07.002");
  assert.equal(docs[0].year, "2017");
});

test("cnr provider is keyless and academic", () => {
  const p = new CnrProvider({});
  assert.equal(p.name(), "cnr");
  assert.equal(p.requiresApiKey(), false);
  assert.equal(p.isConfigured(), true);
  assert.deepEqual(p.supports(), ["ACADEMIC_RESEARCH"]);
});

test("cnr search builds the query and maps results with DOI/handle urls", async () => {
  let calledUrl = null;
  const p = new CnrProvider({
    fetchImpl: async (url) => {
      calledUrl = url;
      return textRes(SOLR);
    }
  });
  const out = await p.search("quantum oscillator", { maxResults: 5 });
  assert.match(calledUrl, /publications\.cnr\.it\/api\/v1\/search/);
  assert.match(calledUrl, /q=TEXT%3A\(quantum%20oscillator\)/);
  assert.match(calledUrl, /rows=5/);
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].url, "https://doi.org/10.1016/j.x.2017.07.002");
  assert.equal(out.results[0].sourceType, "paper");
  assert.match(out.results[0].content, /Authors: Rossi A\., Bianchi B\./);
  assert.equal(out.results[1].url, "https://publications.cnr.it/handle/999"); // no DOI fallback
});

test("cnr warns on empty result and throws on HTTP error", async () => {
  const empty = new CnrProvider({ fetchImpl: async () => textRes("<response></response>") });
  const out = await empty.search("x");
  assert.deepEqual(out.warnings, ["cnr: no results"]);
  const bad = new CnrProvider({ fetchImpl: async () => textRes("", 500) });
  await assert.rejects(() => bad.search("x"), /HTTP 500/);
});
