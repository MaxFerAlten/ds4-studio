import test from "node:test";
import assert from "node:assert/strict";
import {
  citationBindings,
  stripUnsupportedCitations,
  verifyCitationBindings
} from "./citationEntailment.mjs";

const SOURCES = [
  {
    id: "src_001",
    title: "Damped oscillators",
    content: "The energy levels scale as E_n proportional to n^(3/2). We leave the coefficient to future work."
  },
  { id: "src_002", title: "Unrelated survey", content: "This survey reviews attention mechanisms." }
];

const REPORT = [
  "# Report",
  "",
  "## Analisi",
  "The levels scale as n^(3/2) [src_001].",
  "The coefficient is 1.37 [src_001].",
  "Attention improves throughput by 42% [src_002].",
  "This sentence cites nothing."
].join("\n");

/** A verifier that answers per (claim, source) from a fixed table. */
function fakeClient(table) {
  return {
    calls: [],
    async completeRole(args) {
      this.calls.push(args);
      const payload = JSON.parse(args.userPrompt);
      const entry = Object.entries(table).find(([needle]) => payload.claim.includes(needle));
      return { json: entry ? entry[1] : { verdict: "ABSENT", reason: "not in the passages" } };
    }
  };
}

test("bindings are read per sentence, with the citation stripped from the claim", () => {
  const bindings = citationBindings(REPORT);
  assert.equal(bindings.length, 3);
  assert.equal(bindings[0].claim, "The levels scale as n^(3/2).");
  assert.deepEqual(bindings[0].sourceIds, ["src_001"]);
  assert.deepEqual(bindings[2].sourceIds, ["src_002"]);
  // A sentence citing nothing binds nothing.
  assert.equal(bindings.some((b) => b.claim.includes("cites nothing")), false);
  assert.deepEqual(citationBindings(""), []);

  // Several ids in one sentence are separate bindings to check.
  const multi = citationBindings("Both agree [src_001] [src_002].");
  assert.deepEqual(multi[0].sourceIds, ["src_001", "src_002"]);
});

test("a supported binding survives and an unsupported one loses its id", async () => {
  const client = fakeClient({
    "levels scale": { verdict: "SUPPORTED", supportingSpans: ["E_n proportional to n^(3/2)"] },
    "coefficient is 1.37": { verdict: "ABSENT", reason: "the passage declines to give one" },
    "Attention improves": { verdict: "CONTRADICTED", reason: "the survey says nothing about throughput" }
  });
  const result = await verifyCitationBindings({ markdown: REPORT, sources: SOURCES, client });
  assert.equal(result.checked, 3);
  assert.equal(result.unsupported, 2);

  const { markdown, removed } = stripUnsupportedCitations(REPORT, result.findings);
  // The supported binding is untouched.
  assert.match(markdown, /The levels scale as n\^\(3\/2\) \[src_001\]\./);
  // The refuted ones lose the id, and only the id: the prose is not rewritten.
  assert.match(markdown, /The coefficient is 1\.37\./);
  assert.match(markdown, /Attention improves throughput by 42%\./);
  assert.deepEqual(removed.sort(), ["src_001", "src_002"]);
  // Every sentence is still there.
  assert.equal(markdown.split("\n").length, REPORT.split("\n").length);
});

test("topical similarity is not support", async () => {
  // The source is a real paper on the right subject that does not contain the
  // claim. §41's case: a real paper is not evidence for a formula it lacks.
  const client = fakeClient({
    "eight KV heads": { verdict: "ABSENT", reason: "the passages never mention KV heads" }
  });
  const report = "The model uses eight KV heads [src_002].";
  const result = await verifyCitationBindings({ markdown: report, sources: SOURCES, client });
  assert.equal(result.unsupported, 1);
  assert.equal(stripUnsupportedCitations(report, result.findings).markdown, "The model uses eight KV heads.");
});

test("partial support keeps its citation", async () => {
  const client = fakeClient({
    "levels scale": {
      verdict: "PARTIAL",
      supportingSpans: ["E_n proportional to n^(3/2)"],
      unsupportedSubclaims: ["the coefficient"]
    }
  });
  const report = "The levels scale as n^(3/2) with coefficient 1.37 [src_001].";
  const result = await verifyCitationBindings({ markdown: report, sources: SOURCES, client });
  assert.equal(result.partial, 1);
  // The source does support part of it; withdrawing the citation would lose that.
  assert.equal(stripUnsupportedCitations(report, result.findings).markdown, report);
});

test("an unchecked binding is not a disproved one", async () => {
  const report = "The levels scale as n^(3/2) [src_001].";
  // No client: nothing was established, so nothing is withdrawn.
  const noClient = await verifyCitationBindings({ markdown: report, sources: SOURCES, client: null });
  assert.equal(noClient.unchecked, 1);
  assert.equal(noClient.unsupported, 0);
  assert.equal(stripUnsupportedCitations(report, noClient.findings).markdown, report);

  // An id that resolves to no source is formatCitations' business, not this
  // layer's: it has nothing to check against.
  const orphan = await verifyCitationBindings({
    markdown: "A claim [src_999].",
    sources: SOURCES,
    client: fakeClient({})
  });
  assert.equal(orphan.findings[0].reason, "unknown source id");
  assert.equal(orphan.checked, 0);
});

test("the number of model calls is bounded", async () => {
  const client = fakeClient({});
  const report = Array.from({ length: 8 }, (_, i) => `Claim ${i} [src_001].`).join(" ");
  const result = await verifyCitationBindings({ markdown: report, sources: SOURCES, client, maxChecks: 3 });
  assert.equal(result.checked, 3);
  assert.equal(client.calls.length, 3);
  // The bindings past the budget are reported as unchecked, not as supported.
  assert.equal(result.findings.filter((f) => f.reason === "check budget exhausted").length, 5);
});

test("passages come from the source's chunks when it has them", async () => {
  const client = fakeClient({ anything: { verdict: "SUPPORTED", supportingSpans: ["chunk text"] } });
  const chunked = [{ id: "src_001", chunks: ["chunk text here", "second chunk"] }];
  await verifyCitationBindings({ markdown: "anything [src_001].", sources: chunked, client });
  const payload = JSON.parse(client.calls[0].userPrompt);
  assert.equal(payload.passages.length, 2);
  assert.equal(payload.passages[0].text, "chunk text here");
});
