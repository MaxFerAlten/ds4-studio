import test from "node:test";
import assert from "node:assert/strict";
import { SEVERITY } from "./epistemicContracts.mjs";
import {
  IDENTITY_VERDICT,
  authorOverlap,
  normalizeArxivId,
  normalizeDoi,
  resolveBibliographicIdentity,
  surname,
  titleOverlap
} from "./epistemicCitationIdentity.mjs";

/**
 * The QHO failure pattern from §30: a real author/title tuple (paper A) cited
 * with an identifier that resolves to an unrelated paper (paper B).
 */
const PAPER_A = {
  title: "General Solution of the Quantum Damped Harmonic Oscillator",
  authors: ["K. Fujii", "T. Suzuki"],
  arxivId: "0710.2724",
  publishedAt: "2007-10-15T06:21:19Z"
};

const PAPER_B = {
  title: "Sequence to Sequence Learning with Neural Networks",
  authors: ["I. Sutskever", "O. Vinyals", "Q. V. Le"],
  arxivId: "1409.3215",
  publishedAt: "2014-09-10T00:00:00Z"
};

/** A provider with a fixed table. No network, no clock, no ranking. */
function fixtureProvider(source, records, { throws = null } = {}) {
  const byId = new Map(records.map((r) => [r.arxivId ?? r.doi, r]));
  return {
    lookups: [],
    async lookup(id) {
      this.lookups.push(id);
      if (throws) throw throws;
      const record = byId.get(id);
      return record ? { source, ...record } : null;
    }
  };
}

const arxiv = (records, opts) => ({ arxivProvider: fixtureProvider("arxiv", records, opts) });

test("identifiers are reduced to their canonical form or rejected", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1088/1751-8113/41/8/085303"), "10.1088/1751-8113/41/8/085303");
  assert.equal(normalizeDoi("DOI: 10.5555/X"), "10.5555/x");
  assert.equal(normalizeDoi("10.5555/x"), "10.5555/x");
  // A DOI prefix is 10. plus at least four digits; anything else is not one.
  assert.equal(normalizeDoi("10.1/x"), null);
  assert.equal(normalizeDoi("not-a-doi"), null);
  assert.equal(normalizeDoi(null), null);

  assert.equal(normalizeArxivId("https://arxiv.org/abs/0710.2724v4"), "0710.2724");
  assert.equal(normalizeArxivId("arXiv:0710.2724"), "0710.2724");
  assert.equal(normalizeArxivId("https://arxiv.org/pdf/math.GT/0309136.pdf"), "math.gt/0309136");
  assert.equal(normalizeArxivId("0710"), null);
});

test("title and author comparison tolerates formatting, not different papers", () => {
  assert.ok(
    titleOverlap("General Solution of the Quantum Damped Harmonic Oscillator", "general solution: quantum damped harmonic oscillator") > 0.6
  );
  assert.ok(titleOverlap(PAPER_A.title, PAPER_B.title) < 0.3);
  // An unknown title agrees with nothing rather than with everything.
  assert.equal(titleOverlap("", PAPER_A.title), 0);

  assert.equal(surname("Kazuyuki Fujii"), "fujii");
  assert.equal(surname("Q. V. Le"), "le");
  assert.equal(authorOverlap(["K. Fujii", "T. Suzuki"], ["Kazuyuki Fujii", "Tatsuo Suzuki"]), 1);
  assert.equal(authorOverlap(["K. Fujii"], PAPER_B.authors), 0);
  // Nothing to compare is null, not zero: no overlap is not a disagreement.
  assert.equal(authorOverlap([], PAPER_A.authors), null);
});

test("an identifier that resolves to the cited paper is VERIFIED", async () => {
  const providers = arxiv([PAPER_A]);
  const out = await resolveBibliographicIdentity(
    { title: PAPER_A.title, authors: ["Kazuyuki Fujii", "Tatsuo Suzuki"], arxivId: "arXiv:0710.2724v4", year: 2007 },
    providers
  );
  assert.equal(out.verdict, IDENTITY_VERDICT.VERIFIED);
  assert.deepEqual(out.failureCodes, []);
  assert.equal(out.severity, SEVERITY.NONE);
  // The lookup received the canonical id, not the string the citation used.
  assert.deepEqual(providers.arxivProvider.lookups, ["0710.2724"]);
});

test("QHO pattern: a real tuple carrying someone else's identifier is F17", async () => {
  // Paper A's title and authors, paper B's arXiv id. Both halves are real; the
  // citation is not.
  const citation = { title: PAPER_A.title, authors: PAPER_A.authors, arxivId: "1409.3215" };
  const out = await resolveBibliographicIdentity(citation, arxiv([PAPER_A, PAPER_B]));
  assert.equal(out.verdict, IDENTITY_VERDICT.MISMATCH);
  assert.deepEqual(out.failureCodes, ["F17"]);
  assert.equal(out.severity, SEVERITY.HIGH);
  assert.equal(out.resolved[0].title, PAPER_B.title);
  assert.ok(out.checks[0].titleOverlap < 0.3);
});

test("the same mismatch rendered as a verified citation is S5", async () => {
  const out = await resolveBibliographicIdentity(
    { title: PAPER_A.title, authors: PAPER_A.authors, arxivId: "1409.3215" },
    arxiv([PAPER_A, PAPER_B]),
    { renderedAsVerified: true }
  );
  assert.equal(out.verdict, IDENTITY_VERDICT.MISMATCH);
  assert.equal(out.severity, SEVERITY.CRITICAL);
});

test("an identifier resolving to nothing is NOT_FOUND and a fabricated source", async () => {
  const out = await resolveBibliographicIdentity(
    { title: PAPER_A.title, authors: PAPER_A.authors, arxivId: "9999.99999" },
    arxiv([PAPER_A])
  );
  assert.equal(out.verdict, IDENTITY_VERDICT.NOT_FOUND);
  assert.deepEqual(out.failureCodes, ["F01"]);
  assert.equal(out.severity, SEVERITY.CRITICAL);
});

test("a provider that failed is not evidence that the paper is fake", async () => {
  const out = await resolveBibliographicIdentity(
    { title: PAPER_A.title, authors: PAPER_A.authors, arxivId: "0710.2724" },
    arxiv([PAPER_A], { throws: new Error("ETIMEDOUT") })
  );
  // PARTIAL, not NOT_FOUND: a network fault would otherwise manufacture an F01.
  assert.equal(out.verdict, IDENTITY_VERDICT.PARTIAL);
  assert.deepEqual(out.failureCodes, []);
  assert.match(out.reason, /identifier lookup failed: arxiv: ETIMEDOUT/);
});

test("a check that could not run never reports VERIFIED", async () => {
  // No identifier at all.
  const noId = await resolveBibliographicIdentity(
    { title: PAPER_A.title, authors: PAPER_A.authors },
    arxiv([PAPER_A])
  );
  assert.equal(noId.verdict, IDENTITY_VERDICT.PARTIAL);
  assert.match(noId.reason, /no resolvable identifier/);

  // An identifier nobody can resolve.
  const noProvider = await resolveBibliographicIdentity(
    { title: PAPER_A.title, authors: PAPER_A.authors, arxivId: "0710.2724" },
    {}
  );
  assert.equal(noProvider.verdict, IDENTITY_VERDICT.PARTIAL);
  assert.match(noProvider.errors[0], /no provider available/);

  // Resolved, but nothing in the citation to compare it with.
  const noTitle = await resolveBibliographicIdentity({ arxivId: "0710.2724" }, arxiv([PAPER_A]));
  assert.equal(noTitle.verdict, IDENTITY_VERDICT.PARTIAL);
  assert.match(noTitle.reason, /no title to compare/);
});

test("a matching title without matching authors stops short of VERIFIED", async () => {
  const noAuthors = await resolveBibliographicIdentity(
    { title: PAPER_A.title, arxivId: "0710.2724" },
    arxiv([PAPER_A])
  );
  assert.equal(noAuthors.verdict, IDENTITY_VERDICT.PARTIAL);
  assert.equal(noAuthors.checks[0].authorOverlap, null);

  // Right title, wrong people: still not the same citation.
  const wrongAuthors = await resolveBibliographicIdentity(
    { title: PAPER_A.title, authors: PAPER_B.authors, arxivId: "0710.2724" },
    arxiv([PAPER_A])
  );
  assert.equal(wrongAuthors.verdict, IDENTITY_VERDICT.PARTIAL);
  assert.equal(wrongAuthors.checks[0].authorOverlap, 0);

  // A year that disagrees with the record is a reason to look again.
  const wrongYear = await resolveBibliographicIdentity(
    { title: PAPER_A.title, authors: PAPER_A.authors, arxivId: "0710.2724", year: 2019 },
    arxiv([PAPER_A])
  );
  assert.equal(wrongYear.verdict, IDENTITY_VERDICT.PARTIAL);
  assert.equal(wrongYear.checks[0].yearAgrees, false);
});

test("two identifiers resolving to different papers is a mismatch", async () => {
  const out = await resolveBibliographicIdentity(
    { title: PAPER_A.title, authors: PAPER_A.authors, arxivId: "0710.2724", doi: "10.5555/seq2seq" },
    {
      arxivProvider: fixtureProvider("arxiv", [PAPER_A]),
      openAlexProvider: fixtureProvider("openalex", [{ ...PAPER_B, doi: "10.5555/seq2seq", arxivId: null }])
    }
  );
  assert.equal(out.verdict, IDENTITY_VERDICT.MISMATCH);
  assert.deepEqual(out.failureCodes, ["F17"]);
  assert.match(out.reason, /resolve to different papers/);
  assert.equal(out.resolved.length, 2);
});

test("a cited identifier that is not identifier-shaped is reported, not dropped", async () => {
  const out = await resolveBibliographicIdentity(
    { title: PAPER_A.title, authors: PAPER_A.authors, doi: "10.1/made-up" },
    { openAlexProvider: fixtureProvider("openalex", []) }
  );
  assert.equal(out.verdict, IDENTITY_VERDICT.PARTIAL);
  assert.deepEqual(out.errors, ['doi: "10.1/made-up" is not a DOI']);
});
