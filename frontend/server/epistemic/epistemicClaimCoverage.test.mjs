/**
 * Q2-003 (remediation.Quantiom.002 §6, §44) — strict claim coverage.
 *
 * Under ALL_ASSERTIVE_CLAIMS every assertive sentence must be bound to a claim.
 * A response is not "fully verified" when the extractor simply never saw part of it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { evaluateClaimCoverage } from "./epistemicClaimCoverage.mjs";
import { deriveUserVerificationContract } from "./epistemicUserVerificationContract.mjs";

const STRICT = deriveUserVerificationContract({
  userText: "Ogni affermazione deve essere dimostrata con Lean."
});
const DEFAULT_CONTRACT = deriveUserVerificationContract({ userText: "Spiegami il QHO." });

test("CC-001: every assertive sentence bound to a claim gives coverage 1", () => {
  const content =
    "Lo spettro del QHO e discreto. Il vocabolario indicizza uno spazio ausiliario.";
  const out = evaluateClaimCoverage({
    assistantContent: content,
    claims: [
      { id: "C1", text: "Lo spettro del QHO e discreto." },
      { id: "C2", text: "Il vocabolario indicizza uno spazio ausiliario." }
    ],
    verificationContract: STRICT,
    extractionStatus: "EXTRACTION_COMPLETE"
  });
  assert.equal(out.assertiveSpanCount, 2);
  assert.equal(out.uncoveredSpans.length, 0);
  assert.equal(out.coverage, 1);
  assert.equal(out.complete, true);
});

test("Q2-003 negative control (§44): a factual sentence the extractor missed leaves coverage incomplete", () => {
  const out = evaluateClaimCoverage({
    assistantContent:
      "Lo spettro del QHO e discreto. Gli embedding di un LLM formano una base ortogonale.",
    claims: [{ id: "C1", text: "Lo spettro del QHO e discreto." }],
    verificationContract: STRICT,
    extractionStatus: "EXTRACTION_COMPLETE"
  });
  assert.equal(out.uncoveredSpans.length, 1);
  assert.match(out.uncoveredSpans[0], /base ortogonale/);
  assert.ok(out.coverage < 1);
  assert.equal(out.complete, false);
});

test("CC-002: partial extraction can never report complete coverage in strict mode", () => {
  const out = evaluateClaimCoverage({
    assistantContent: "Lo spettro del QHO e discreto.",
    claims: [{ id: "C1", text: "Lo spettro del QHO e discreto." }],
    verificationContract: STRICT,
    extractionStatus: "EXTRACTION_PARTIAL"
  });
  assert.equal(out.complete, false);
  assert.equal(out.extractionComplete, false);
});

test("CC-003: headings, fences, questions and explicit uncertainty are not assertive spans", () => {
  const content = [
    "## Dimostrazione Lean",
    "```lean",
    "theorem t : True := trivial",
    "```",
    "Questo e verificato?",
    "Non sono riuscito a verificare la seconda fonte.",
    "- ",
    "Lo spettro del QHO e discreto."
  ].join("\n");
  const out = evaluateClaimCoverage({
    assistantContent: content,
    claims: [{ id: "C1", text: "Lo spettro del QHO e discreto." }],
    verificationContract: STRICT,
    extractionStatus: "EXTRACTION_COMPLETE"
  });
  assert.equal(out.assertiveSpanCount, 1);
  assert.equal(out.complete, true);
});

test("CC-004: a DEFAULT contract does not impose coverage", () => {
  const out = evaluateClaimCoverage({
    assistantContent: "Gli embedding di un LLM formano una base ortogonale.",
    claims: [],
    verificationContract: DEFAULT_CONTRACT,
    extractionStatus: "EXTRACTION_PARTIAL"
  });
  assert.equal(out.mode, "DEFAULT");
  assert.equal(out.complete, true);
  assert.equal(out.uncoveredSpans.length, 0);
});

test("Q2-014 control (§55): VCCR below 1 is never rounded up to complete", () => {
  // Disjoint vocabulary, so nothing binds by accident: exactly one is unbound.
  const spans = Array.from(
    { length: 1000 },
    (_, i) => `Alfa${i} beta${i} gamma${i} delta${i} epsilon${i} risulta stabilito.`
  );
  const out = evaluateClaimCoverage({
    assistantContent: spans.join(" "),
    claims: spans.slice(0, 999).map((text, i) => ({ id: `C${i}`, text })),
    verificationContract: STRICT,
    extractionStatus: "EXTRACTION_COMPLETE"
  });
  assert.ok(out.coverage > 0.998 && out.coverage < 1);
  assert.equal(out.complete, false);
});

test("Q2-003 (§6.2): a colon or semicolon does not split one disclosure into an uncovered half", () => {
  const contract = deriveUserVerificationContract({
    userText: "Ogni affermazione deve essere dimostrata con Lean."
  });
  const result = evaluateClaimCoverage({
    assistantContent:
      "La decomposizione in sovrapposizione non e stata verificata: il run e andato in timeout.",
    claims: [],
    verificationContract: contract,
    extractionStatus: "EXTRACTION_COMPLETE"
  });
  assert.deepEqual(result.uncoveredSpans, []);
  assert.equal(result.complete, true);
});

test("Q2-003 (§6.2, §31): naming a statement's epistemic status is not an uncovered assertion", () => {
  const contract = deriveUserVerificationContract({
    userText: "Ogni affermazione deve essere dimostrata con Lean."
  });
  const result = evaluateClaimCoverage({
    assistantContent: [
      "Lean ha controllato soltanto l'iniettivita del costruttore; non e una dimostrazione dello spettro QHO.",
      "Il parallelo fra attenzione e misura quantistica resta un'analogia, non un meccanismo fisico.",
      "Lo spazio C^V indicizzato dai token e una costruzione ausiliaria."
    ].join("\n\n"),
    claims: [],
    verificationContract: contract,
    extractionStatus: "EXTRACTION_COMPLETE"
  });
  assert.deepEqual(result.uncoveredSpans, []);
});

test("Q2-003: an ordinary factual sentence is still uncovered", () => {
  const contract = deriveUserVerificationContract({
    userText: "Ogni affermazione deve essere dimostrata con Lean."
  });
  const result = evaluateClaimCoverage({
    assistantContent: "Gli embedding degli LLM si raggruppano in stati semantici discreti.",
    claims: [],
    verificationContract: contract,
    extractionStatus: "EXTRACTION_COMPLETE"
  });
  assert.equal(result.uncoveredSpans.length, 1);
  assert.equal(result.complete, false);
});
