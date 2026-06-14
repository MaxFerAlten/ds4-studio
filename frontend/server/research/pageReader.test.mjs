import test from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, htmlToText, readPage, tryReadPage } from "./pageReader.mjs";

function htmlResponse(body, { status = 200, contentType = "text/html" } = {}) {
  return new Response(body, { status, headers: { "Content-Type": contentType } });
}

test("decodeEntities decodes named and numeric entities", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &#65;"), "a & b <c> A");
});

test("htmlToText strips scripts/styles/tags and decodes entities", () => {
  const html = "<html><head><style>x{}</style></head><body><script>evil()</script>" +
    "<h1>Title</h1><p>Hello &amp; world</p><nav>menu</nav></body></html>";
  const text = htmlToText(html);
  assert.match(text, /Title/);
  assert.match(text, /Hello & world/);
  assert.ok(!/evil\(\)/.test(text), "script content removed");
  assert.ok(!/menu/.test(text), "nav removed");
});

test("readPage extracts text from an html response", async () => {
  const out = await readPage("https://example.com/a", {
    fetchImpl: async () => htmlResponse("<p>Redis sentinel failover</p>")
  });
  assert.match(out.content, /Redis sentinel failover/);
  assert.equal(out.contentType, "text/html");
});

test("readPage passes plain text through unchanged", async () => {
  const out = await readPage("https://example.com/a.txt", {
    fetchImpl: async () => htmlResponse("plain body", { contentType: "text/plain" })
  });
  assert.equal(out.content, "plain body");
});

test("readPage caps characters and flags truncation", async () => {
  const big = "x".repeat(50);
  const out = await readPage("https://example.com/big", {
    fetchImpl: async () => htmlResponse(big, { contentType: "text/plain" }),
    maxChars: 10
  });
  assert.equal(out.content.length, 10);
  assert.equal(out.truncated, true);
});

test("readPage rejects disallowed MIME types", async () => {
  await assert.rejects(
    () => readPage("https://example.com/x.bin", {
      fetchImpl: async () => htmlResponse("data", { contentType: "application/octet-stream" })
    }),
    /blocked content-type/
  );
});

test("readPage refuses SSRF targets before fetching", async () => {
  let called = false;
  await assert.rejects(
    () => readPage("http://169.254.169.254/latest/meta-data", {
      fetchImpl: async () => { called = true; return htmlResponse("secret"); }
    }),
    /SSRF blocked/
  );
  assert.equal(called, false, "must not fetch a blocked url");
});

test("readPage throws on HTTP errors", async () => {
  await assert.rejects(
    () => readPage("https://example.com/missing", {
      fetchImpl: async () => htmlResponse("nope", { status: 404 })
    }),
    /HTTP 404/
  );
});

test("tryReadPage swallows failures and returns null", async () => {
  const out = await tryReadPage("https://example.com/x", {
    fetchImpl: async () => { throw new Error("network down"); }
  });
  assert.equal(out, null);
});
