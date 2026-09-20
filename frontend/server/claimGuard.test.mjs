import assert from "node:assert/strict";
import { test } from "node:test";

async function claimGuard() {
  return import("./claimGuard.mjs");
}

test("blocks verified claim without evidence", async () => {
  const { checkVerifiedClaim } = await claimGuard();
  const block = checkVerifiedClaim("Tutti i bug sono stati fixati e make cpu passa.", "");

  assert.equal(block?.type, "STOP_UNSUPPORTED_VERIFIED_CLAIM");
  assert.equal(block?.block, true);
});

test("blocks Lean-specific positive claims without checked evidence", async () => {
  const { checkVerifiedClaim } = await claimGuard();
  for (const text of ["STATO: VERIFIED", "Teorema dimostrato", "Lean ha verificato la prova"]) {
    const decision = checkVerifiedClaim(text, "", { mode: "block" });
    assert.equal(decision?.block, true, text);
  }
});

test("checked Lean evidence permits the claim for the authoritative source gate", async () => {
  const { checkVerifiedClaim } = await claimGuard();
  assert.equal(
    checkVerifiedClaim("STATO: VERIFIED", "lean_result_v1 status=checked", { mode: "block" }),
    undefined
  );
});

test("allows verified claim with direct evidence", async () => {
  const { checkVerifiedClaim } = await claimGuard();
  const block = checkVerifiedClaim(
    "make cpu passa.",
    "command: make cpu\nexit code 0\npassed"
  );

  assert.equal(block, undefined);
});

test("allows explicitly documented claim without build evidence", async () => {
  const { checkVerifiedClaim } = await claimGuard();
  const block = checkVerifiedClaim(
    "Il documento dichiara che i bug sono stati fixati.",
    ""
  );

  assert.equal(block, undefined);
});

test("protected language is detected per category with its evidence hint", async () => {
  const { scanProtectedLanguage, CATEGORY_REQUIREMENTS } = await claimGuard();

  const exec = scanProtectedLanguage("Here is the working code, tested and benchmarked.");
  assert.equal(exec.highRiskCandidate, true);
  assert.ok(exec.protectedClaims.some((c) => c.category === "EXECUTION"));
  assert.ok(exec.requirements.includes("execution_evidence"));

  const obs = scanProtectedLanguage("Confirmed by our internal analysis; we measured 42.");
  assert.ok(obs.protectedClaims.some((c) => c.category === "OBSERVATION"));
  assert.ok(obs.requirements.includes("observation_evidence"));

  const bib = scanProtectedLanguage("See arXiv:2103.00020 and doi:10.1000/xyz.");
  assert.ok(bib.protectedClaims.some((c) => c.category === "BIBLIOGRAPHIC_PRECISION"));
  assert.ok(bib.requirements.includes("source_identity"));

  const off = scanProtectedLanguage("This is the official exact architecture.");
  assert.ok(off.protectedClaims.some((c) => c.category === "OFFICIALITY"));
  assert.ok(off.requirements.includes("primary_source"));

  // Italian is covered too: a guard that only reads English is a guard with a
  // documented bypass.
  const it = scanProtectedLanguage("Il teorema è dimostrato e i test passano.");
  assert.ok(it.protectedClaims.some((c) => c.category === "VERIFICATION"));
  assert.ok(it.protectedClaims.some((c) => c.category === "EXECUTION"));

  // Plain prose is not a candidate.
  const plain = scanProtectedLanguage("This is an analogy that may help intuition.");
  assert.equal(plain.highRiskCandidate, false);
  assert.deepEqual(plain.protectedClaims, []);
  assert.deepEqual(plain.requirements, []);
  assert.equal(scanProtectedLanguage(null).highRiskCandidate, false);

  // Requirements are deduplicated, one per category.
  assert.equal(new Set(Object.values(CATEGORY_REQUIREMENTS)).size, 5);
});

test("the lexical guard flags risk without deciding the verdict", async () => {
  const { checkVerifiedClaim, scanProtectedLanguage } = await claimGuard();

  // §27: the regex decides highRiskCandidate and evidence hints, never VERIFIED.
  const scan = scanProtectedLanguage("The proof is verified.");
  assert.equal(scan.highRiskCandidate, true);
  assert.equal(scan.verified, undefined);
  assert.equal(scan.block, undefined);

  // The decision object carries the risk alongside the unchanged verdict.
  const decision = checkVerifiedClaim("Teorema dimostrato.", "", { mode: "block" });
  assert.equal(decision.block, true);
  assert.equal(decision.type, "STOP_UNSUPPORTED_VERIFIED_CLAIM");
  assert.equal(decision.risk.highRiskCandidate, true);
  assert.ok(decision.risk.requirements.includes("verifier_result"));

  // Expanding the lexicon must not expand what blocks. Wording that the new
  // categories catch, but the strong-claim rule does not, still returns
  // undefined — widening the block policy belongs to the promotion gate.
  assert.equal(checkVerifiedClaim("This is the official architecture.", ""), undefined);
  assert.equal(checkVerifiedClaim("We measured the spectrum.", ""), undefined);
  assert.equal(checkVerifiedClaim("See arXiv:2103.00020.", ""), undefined);
});
