import test from "node:test";
import assert from "node:assert/strict";
import { verifyCitedAuthors } from "./authorVerification.mjs";

function fakeClient(map) {
  return {
    calls: [],
    async verifyAuthor(name) {
      this.calls.push(name);
      return map[name] || { name, found: false, orcidId: null, institutions: [], numFound: 0 };
    }
  };
}

const state = () => ({
  finalReport: "See [src_001] and [src_002] only. The rest are uncited.",
  sources: [
    { id: "src_001", title: "A", authors: ["K. Fujii"] },
    { id: "src_002", title: "B", authors: ["Rossi A."] },
    { id: "src_003", title: "C", authors: ["Nobody X"] }, // not cited
    { id: "src_004", title: "D", authors: [] } // cited? no, and no authors
  ]
});

test("verifies only cited sources that have authors", async () => {
  const client = fakeClient({
    "K. Fujii": { name: "K. Fujii", found: true, orcidId: "0000-1", institutions: ["U Tokyo"], numFound: 1 },
    "Rossi A.": { name: "Rossi A.", found: false, orcidId: null, institutions: [], numFound: 0 }
  });
  const s = state();
  const summary = await verifyCitedAuthors(s, { client });
  assert.deepEqual(client.calls.sort(), ["K. Fujii", "Rossi A."]);
  assert.equal(summary.checked, 2);
  assert.equal(summary.verified, 1);
  assert.equal(s.sources[0].authorVerification.found, true);
  assert.equal(s.sources[0].authorVerification.orcidId, "0000-1");
  assert.equal(s.sources[1].authorVerification.found, false);
  assert.equal(s.sources[2].authorVerification, undefined); // not cited
});

test("respects maxAuthors cap and caches repeated authors", async () => {
  const client = fakeClient({});
  const s = {
    finalReport: "[src_001][src_002][src_003]",
    sources: [
      { id: "src_001", authors: ["Same Author"] },
      { id: "src_002", authors: ["Same Author"] },
      { id: "src_003", authors: ["Other Author"] }
    ]
  };
  const summary = await verifyCitedAuthors(s, { client, maxAuthors: 1 });
  // cap=1 -> only first distinct lookup happens
  assert.equal(summary.checked, 1);
  assert.equal(client.calls.length, 1);
});

test("no client or no report -> no-op", async () => {
  assert.deepEqual(await verifyCitedAuthors(state(), { client: null }), { checked: 0, verified: 0 });
  assert.deepEqual(await verifyCitedAuthors({ sources: [] }, { client: fakeClient({}) }), {
    checked: 0,
    verified: 0
  });
});
