import test from "node:test";
import assert from "node:assert/strict";
import { CLAIM_EXTRACTOR_PROMPT, CLAIM_FLAGS } from "./epistemicPrompts.mjs";
import {
  EXTRACTION_STATUS,
  atomizeMathematicalClaim,
  atomizeBibliographicClaim,
  deterministicClaims,
  extractEpistemicClaims,
  requirementsForFlags
} from "./epistemicClaimExtractor.mjs";

/** A StructuredModelClient stand-in returning a fixed JSON payload. */
function fakeClient(json, { throws = null } = {}) {
  return {
    calls: [],
    async completeRole(args) {
      this.calls.push(args);
      if (throws) throw throws;
      return { json, content: JSON.stringify(json), attempts: 1 };
    }
  };
}

test("no model client means partial extraction, never a clean bill", async () => {
  const result = await extractEpistemicClaims({
    text: "The tests pass and the accuracy is 91%.",
    client: null
  });
  // §28: without a verifier the component must not claim extraction succeeded.
  assert.equal(result.status, EXTRACTION_STATUS.PARTIAL);
  assert.equal(result.source, "lexical");
  assert.match(result.reason, /no model client/);
  assert.ok(result.claims.length > 0);
});

test("a model failure degrades to partial, it does not report success", async () => {
  const client = fakeClient(null, { throws: new Error("model did not return valid JSON") });
  const result = await extractEpistemicClaims({
    text: "We measured 42 and the benchmark shows 3x.",
    client
  });
  assert.equal(result.status, EXTRACTION_STATUS.PARTIAL);
  assert.match(result.reason, /model extraction failed: model did not return valid JSON/);
  assert.ok(result.claims.length > 0);

  // A well-formed response with no claims array is equally partial.
  const noArray = await extractEpistemicClaims({
    text: "We measured 42.",
    client: fakeClient({ result: "fine" })
  });
  assert.equal(noArray.status, EXTRACTION_STATUS.PARTIAL);
  assert.match(noArray.reason, /no claims array/);
});

test("the model cannot hand back a verified claim", async () => {
  const client = fakeClient({
    claims: [
      {
        id: "C1",
        text: "The theorem is proved.",
        epistemicType: "SOURCE_FACT",
        status: "VERIFIED",
        severity: 5,
        evidenceIds: ["forged"]
      }
    ]
  });
  const result = await extractEpistemicClaims({ text: "The theorem is proved.", client });
  assert.equal(result.status, EXTRACTION_STATUS.COMPLETE);
  const [claim] = result.claims;
  // Enforced by construction through createClaim, not by the model obeying the
  // prompt's "Never output VERIFIED".
  assert.equal(claim.status, "PROPOSED");
  assert.equal(claim.severity, 0);
  assert.deepEqual(claim.evidenceIds, []);
});

test("an unknown type from the model becomes UNKNOWN, not itself", async () => {
  const client = fakeClient({
    claims: [{ id: "C1", text: "X holds.", epistemicType: "DEFINITELY_TRUE" }]
  });
  const { claims } = await extractEpistemicClaims({ text: "X holds.", client });
  assert.equal(claims[0].epistemicType, "UNKNOWN");
});

test("dependencies are resolved from local ids to claim ids", async () => {
  const client = fakeClient({
    claims: [
      { id: "C1", text: "GPT-3 uses X.", epistemicType: "SOURCE_FACT", dependencies: [] },
      { id: "C2", text: "X confirms Y.", epistemicType: "DERIVED", dependencies: ["C1"] },
      // A dangling reference must not become a dependency on nothing.
      { id: "C3", text: "Z follows.", epistemicType: "INFERRED", dependencies: ["C9"] },
      // Nor a self-dependency.
      { id: "C4", text: "W holds.", epistemicType: "INFERRED", dependencies: ["C4"] }
    ]
  });
  const { claims } = await extractEpistemicClaims({ text: "irrelevant", client });
  const [c1, c2, c3, c4] = claims;
  assert.deepEqual(c1.dependencies, []);
  assert.deepEqual(c2.dependencies, [c1.id]);
  assert.deepEqual(c3.dependencies, []);
  assert.deepEqual(c4.dependencies, []);
  assert.equal(claims.every((c) => c.modelDependencies === undefined), true);
});

test("flags are complete and the text can only add to them", async () => {
  const client = fakeClient({
    claims: [
      {
        id: "C1",
        text: "The tests pass and accuracy is 91%.",
        epistemicType: "OBSERVED",
        // The model claims nothing was asserted; the sentence says otherwise.
        flags: { assertsTest: false, containsArithmetic: false }
      }
    ]
  });
  const { claims } = await extractEpistemicClaims({ text: "irrelevant", client });
  const { flags } = claims[0];
  assert.deepEqual(Object.keys(flags).sort(), [...CLAIM_FLAGS].sort());
  // A detected true wins over a model-supplied false: the model may omit a
  // flag, it may not clear one the text plainly supports.
  assert.equal(flags.assertsTest, true);
  assert.equal(flags.containsArithmetic, true);
  assert.ok(claims[0].verificationRequirements.includes("test_evidence"));
  assert.ok(claims[0].verificationRequirements.includes("math_verification"));
});

test("the deterministic sweep finds high-risk sentences and skips plain prose", () => {
  const claims = deterministicClaims(
    "This section is an introduction. " +
      "We measured a 42% improvement. " +
      "The tests pass on every platform. " +
      "It may be useful to think of it as a spring."
  );
  const texts = claims.map((c) => c.text);
  assert.ok(texts.some((t) => /measured/.test(t)));
  assert.ok(texts.some((t) => /tests pass/.test(t)));
  assert.ok(!texts.some((t) => /introduction/.test(t)));
  // Every claim it produces is UNKNOWN: a lexical pass cannot tell a source
  // fact from a derivation, and guessing would invent the claim's nature.
  assert.ok(claims.every((c) => c.epistemicType === "UNKNOWN"));
  assert.ok(claims.every((c) => c.status === "PROPOSED"));
  assert.equal(deterministicClaims("").length, 0);
  assert.equal(deterministicClaims("Just some prose without any assertion.").length, 0);
});

test("requirements follow from what the wording asserts", () => {
  assert.deepEqual(requirementsForFlags({ containsArithmetic: true }), ["math_verification"]);
  assert.deepEqual(requirementsForFlags({ containsCitation: true }), ["source_identity"]);
  assert.deepEqual(requirementsForFlags({ assertsObservation: true }), ["observation_evidence"]);
  // A generic run cannot certify a test suite or a benchmark trace.
  assert.deepEqual(requirementsForFlags({ assertsExecution: true, assertsTest: true }), [
    "execution_evidence",
    "test_evidence"
  ]);
  assert.deepEqual(requirementsForFlags({ assertsBenchmark: true }), ["benchmark_evidence"]);
  assert.deepEqual(requirementsForFlags({}), []);
});

test("limits and empty input are handled", async () => {
  const claims = Array.from({ length: 200 }, (_, i) => ({
    id: `C${i}`,
    text: `Value ${i} is 1%.`,
    epistemicType: "COMPUTED"
  }));
  const { claims: capped } = await extractEpistemicClaims({
    text: "irrelevant",
    client: fakeClient({ claims }),
    maxClaims: 10
  });
  assert.equal(capped.length, 10);

  const empty = await extractEpistemicClaims({ text: "   ", client: null });
  assert.equal(empty.status, EXTRACTION_STATUS.COMPLETE);
  assert.deepEqual(empty.claims, []);
});

test("the prompt forbids the verdict it must not produce", () => {
  assert.match(CLAIM_EXTRACTOR_PROMPT, /Never output VERIFIED/);
  assert.match(CLAIM_EXTRACTOR_PROMPT, /Do not judge truth/);
  assert.match(CLAIM_EXTRACTOR_PROMPT, /Do not agree or disagree/);
  assert.match(CLAIM_EXTRACTOR_PROMPT, /Return JSON only/);
});

test("the model client is called as a structured JSON role", async () => {
  const client = fakeClient({ claims: [] });
  await extractEpistemicClaims({ text: "X.", client });
  const [call] = client.calls;
  assert.equal(call.roleName, "epistemic_claim_extractor");
  assert.equal(call.json, true);
  assert.equal(call.systemPrompt, CLAIM_EXTRACTOR_PROMPT);
  assert.equal(call.userPrompt, "X.");
});

test("a paraphrased prior claim inherits challenge debt", async () => {
  const prior = {
    id: "challenged-qho",
    text: "Lean proved the number-operator relation.",
    challengeDebtIds: ["ch-qho"],
    failureCodes: ["F39"],
    correctiveEpoch: 1
  };
  const result = await extractEpistemicClaims({
    text: "The number operator relation was machine certified.",
    priorClaims: [prior],
    client: fakeClient({
      claims: [
        {
          id: "C1",
          text: "The number operator relation was machine certified.",
          epistemicType: "DERIVED",
          flags: {}
        }
      ]
    })
  });

  assert.equal(result.claims[0].inheritedFromClaimId, prior.id);
  assert.deepEqual(result.claims[0].challengeDebtIds, ["ch-qho"]);
  assert.deepEqual(result.claims[0].failureCodes, ["F39"]);
  assert.equal(result.claims[0].status, "PROPOSED");
});

test("Q2-007 / Q2-007 control (§10, §48): 'discrete and nondegenerate' becomes two atomic claims", () => {
  assert.deepEqual(
    atomizeMathematicalClaim("The QHO spectrum is discrete and non-degenerate."),
    ["The QHO spectrum is discrete.", "The QHO spectrum is non-degenerate."]
  );
});

test("Q2-007: 'self-adjoint and positive' becomes two atomic claims", () => {
  const parts = atomizeMathematicalClaim("The Hamiltonian operator is self-adjoint and positive.");
  assert.equal(parts.length, 2);
  assert.match(parts[0], /self-adjoint\.$/);
  assert.match(parts[1], /positive\.$/);
});

test("Q2-007: the Italian conjunction splits the same way", () => {
  const parts = atomizeMathematicalClaim("Lo spettro dell'Hamiltoniano è discreto e non degenere.");
  assert.equal(parts.length, 2);
  assert.match(parts[0], /discreto\.$/);
  assert.match(parts[1], /non degenere\.$/);
});

test("Q2-007: a single property is left alone, and a non-property conjunction is not split", () => {
  assert.deepEqual(atomizeMathematicalClaim("The spectrum is discrete."), [
    "The spectrum is discrete."
  ]);
  const compound = "The energy is hbar*omega*(n+1/2) and the ground state was measured.";
  assert.deepEqual(atomizeMathematicalClaim(compound), [compound]);
});

test("Q2-007: one Lean certificate cannot cover three properties it never split", () => {
  const parts = atomizeMathematicalClaim(
    "Lo spettro è discreto, non degenere e limitato dal basso."
  );
  assert.equal(parts.length, 3);
});

test("Q2-011 (§14): 'published on arXiv and peer-reviewed' becomes two atomic claims", () => {
  const parts = atomizeBibliographicClaim("Both papers are published on arXiv and peer-reviewed.");
  assert.equal(parts.length, 2);
  assert.match(parts[0], /published on arXiv\.$/);
  assert.match(parts[1], /peer-reviewed\.$/);
});

test("Q2-011 (§14): the Italian bibliographic conjunction splits the same way", () => {
  const parts = atomizeBibliographicClaim(
    "Entrambi i paper sono pubblicati su arXiv e peer-reviewed."
  );
  assert.equal(parts.length, 2);
  assert.match(parts[0], /pubblicati su arXiv\.$/);
  assert.match(parts[1], /peer-reviewed\.$/);
});

test("Q2-011: ordinary prose about a paper is not split", () => {
  const sentence = "The paper is interesting and the authors were thorough.";
  assert.deepEqual(atomizeBibliographicClaim(sentence), [sentence]);
});

test("Q2-011: deterministic extraction emits the identity and the review separately", () => {
  const claims = deterministicClaims("Both papers are published on arXiv and peer-reviewed.");
  assert.ok(claims.some((claim) => /published on arXiv\.$/.test(claim.text)));
  assert.ok(claims.some((claim) => /peer-reviewed\.$/.test(claim.text)));
});

test("Q2-007: deterministic extraction emits the atomic claims, not the compound sentence", () => {
  const claims = deterministicClaims(
    "The eigenvalue spectrum is discrete and non-degenerate."
  );
  assert.ok(claims.length >= 2, `expected at least two claims, got ${claims.length}`);
  assert.ok(claims.some((claim) => /discrete\.$/.test(claim.text)));
  assert.ok(claims.some((claim) => /non-degenerate\.$/.test(claim.text)));
  // Each atom carries its own verification target, so one certificate cannot
  // silently cover both.
  const targets = new Set(claims.map((claim) => claim.verificationTarget?.normalizedStatement));
  assert.equal(targets.size, claims.length);
});
