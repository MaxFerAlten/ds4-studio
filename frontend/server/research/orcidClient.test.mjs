import test from "node:test";
import assert from "node:assert/strict";
import { OrcidClient, parseAuthorName } from "./orcidClient.mjs";

test("parseAuthorName handles the common author formats", () => {
  assert.deepEqual(parseAuthorName("Carberry, Josiah"), { given: "Josiah", family: "Carberry" });
  assert.deepEqual(parseAuthorName("K. Fujii"), { given: "K", family: "Fujii" }); // arXiv: initial first
  assert.deepEqual(parseAuthorName("Rossi A."), { given: "A", family: "Rossi" }); // CNR: family first
  assert.deepEqual(parseAuthorName("Andrea Rossi"), { given: "Andrea", family: "Rossi" });
  assert.deepEqual(parseAuthorName("Mononymous"), { given: "", family: "Mononymous" });
  assert.deepEqual(parseAuthorName(""), { given: "", family: "" });
});

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("verifyAuthor builds a structured query and maps a match", async () => {
  let calledUrl = null;
  const client = new OrcidClient({
    fetchImpl: async (url) => {
      calledUrl = url;
      return jsonRes({
        "num-found": 56,
        "expanded-result": [
          { "orcid-id": "0000-0001-6837-2490", "institution-name": ["Università di Firenze"] }
        ]
      });
    }
  });
  const out = await client.verifyAuthor("Andrea Rossi");
  assert.match(calledUrl, /expanded-search\/\?q=/);
  assert.match(calledUrl, /family-name%3ARossi/);
  assert.match(calledUrl, /given-names%3AAndrea/);
  assert.equal(out.found, true);
  assert.equal(out.orcidId, "0000-0001-6837-2490");
  assert.deepEqual(out.institutions, ["Università di Firenze"]);
  assert.equal(out.numFound, 56);
});

test("verifyAuthor reports not-found and never throws on errors", async () => {
  const none = new OrcidClient({ fetchImpl: async () => jsonRes({ "num-found": 0, "expanded-result": [] }) });
  const r1 = await none.verifyAuthor("Zxqwklmn Q");
  assert.equal(r1.found, false);
  assert.equal(r1.numFound, 0);

  const boom = new OrcidClient({ fetchImpl: async () => { throw new Error("network"); } });
  const r2 = await boom.verifyAuthor("Some Author");
  assert.equal(r2.found, false);

  const http = new OrcidClient({ fetchImpl: async () => jsonRes({}, 503) });
  assert.equal((await http.verifyAuthor("Some Author")).found, false);
});

test("verifyAuthor skips lookup when no family name is parseable", async () => {
  let called = false;
  const client = new OrcidClient({ fetchImpl: async () => { called = true; return jsonRes({}); } });
  const out = await client.verifyAuthor("");
  assert.equal(out.found, false);
  assert.equal(called, false);
});
