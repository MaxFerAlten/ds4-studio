import test from "node:test";
import assert from "node:assert/strict";
import { CHALLENGE_EXTRACTOR_PROMPT } from "./epistemicPrompts.mjs";
import { EpistemicLedger, createClaim } from "./epistemicLedger.mjs";
import {
  CHALLENGE_EXTRACTION_STATUS,
  applyChallenges,
  detectSycophancy,
  extractChallenges,
  isChallenge
} from "./epistemicChallengeExtractor.mjs";

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

/** A claim parked in a state a challenge may be raised against. */
function challengeableClaim(ledger, text) {
  const claim = ledger.create({ text });
  ledger.transition(claim.id, "CLASSIFIED");
  ledger.transition(claim.id, "VERIFICATION_PENDING");
  ledger.transition(claim.id, "UNKNOWN");
  return claim;
}

test("criticism is recognised in both languages", () => {
  assert.equal(isChallenge("Hai sbagliato, quel DOI non esiste."), true);
  assert.equal(isChallenge("You are wrong, that DOI does not exist."), true);
  // An accented trigger: \b is ASCII-only, so these matched nothing until the
  // boundaries were made Unicode-aware.
  assert.equal(isChallenge("Quel valore è falso."), true);
  assert.equal(isChallenge("Il dato corretto è 3.2."), true);
  assert.equal(isChallenge("Grazie, molto utile."), false);
  assert.equal(isChallenge(""), false);
});

test("conceding to a critique without checking is F25", () => {
  const context = { isReplyToChallenge: true };
  const bare = detectSycophancy("Hai perfettamente ragione, mi scuso.", context);
  assert.equal(bare.sycophantic, true);
  assert.deepEqual(bare.failureCodes, ["F25"]);

  // A substitute value carried in on the critic's authority is additionally an
  // unverified fact presented as a correction.
  const replaced = detectSycophancy("Hai ragione, il valore corretto è 3.2.", context);
  assert.deepEqual(replaced.failureCodes, ["F25", "F11"]);
  assert.deepEqual(
    detectSycophancy("You are right, it is actually 3.2.", context).failureCodes,
    ["F25", "F11"]
  );
});

test("agreeing after verifying is not sycophancy", () => {
  // EPI-016 targets agreement bought by pushback, not agreement earned by a
  // check. Conceding once something has run is the loop working.
  const verified = detectSycophancy("You are right, it is actually 3.2.", {
    isReplyToChallenge: true,
    hasNewEvidence: true
  });
  assert.equal(verified.sycophantic, false);
  assert.deepEqual(verified.failureCodes, []);

  // Nor is politeness outside a critique.
  assert.equal(detectSycophancy("You are right, that is the plan.", {}).sycophantic, false);
  assert.equal(detectSycophancy("Ecco i risultati.", { isReplyToChallenge: true }).sycophantic, false);
});

test("without a model the criticism reaches every claim in scope", async () => {
  const claims = [createClaim({ text: "The DOI is 10.1000/x." }), createClaim({ text: "It was published in 2019." })];
  const result = await extractChallenges({
    userText: "Hai sbagliato, quel DOI non esiste.",
    priorClaims: claims,
    client: null
  });
  // PARTIAL, not COMPLETE: a lexical pass cannot tell which claim the sentence
  // is aimed at, and an unchallenged claim keeps authority the criticism may
  // have removed.
  assert.equal(result.status, CHALLENGE_EXTRACTION_STATUS.PARTIAL);
  assert.equal(result.source, "lexical");
  assert.deepEqual(
    result.challenges.map((c) => c.targetClaimId).sort(),
    claims.map((c) => c.id).sort()
  );
  assert.deepEqual(result.replacements, []);
});

test("a model failure degrades to partial, it does not report success", async () => {
  const priorClaims = [createClaim({ text: "The DOI is 10.1000/x." })];
  const userText = "Hai sbagliato, quel DOI non esiste.";

  const threw = await extractChallenges({
    userText,
    priorClaims,
    client: fakeClient(null, { throws: new Error("model did not return valid JSON") })
  });
  assert.equal(threw.status, CHALLENGE_EXTRACTION_STATUS.PARTIAL);
  assert.match(threw.reason, /model challenge extraction failed: model did not return valid JSON/);
  assert.equal(threw.challenges.length, 1);

  const noArray = await extractChallenges({ userText, priorClaims, client: fakeClient({ ok: true }) });
  assert.equal(noArray.status, CHALLENGE_EXTRACTION_STATUS.PARTIAL);
  assert.match(noArray.reason, /no challenges array/);
});

test("a challenge against an unknown claim is dropped, not invented", async () => {
  const known = createClaim({ text: "The DOI is 10.1000/x." });
  const client = fakeClient({
    challenges: [
      { targetClaimId: known.id, challengeText: "that DOI does not resolve" },
      { targetClaimId: "claim_never_seen", challengeText: "and this one is wrong too" },
      { targetClaimId: known.id, challengeText: "   " }
    ]
  });
  const result = await extractChallenges({
    userText: "You are wrong, that DOI does not exist.",
    priorClaims: [known],
    client
  });
  assert.equal(result.status, CHALLENGE_EXTRACTION_STATUS.COMPLETE);
  assert.equal(result.challenges.length, 1);
  assert.equal(result.challenges[0].targetClaimId, known.id);

  // Nothing mappable at all falls back rather than returning an empty COMPLETE,
  // which would read as "the criticism touched no claim".
  const unmappable = await extractChallenges({
    userText: "You are wrong, that DOI does not exist.",
    priorClaims: [known],
    client: fakeClient({ challenges: [{ targetClaimId: "claim_never_seen", challengeText: "x" }] })
  });
  assert.equal(unmappable.status, CHALLENGE_EXTRACTION_STATUS.PARTIAL);
  assert.equal(unmappable.source, "lexical");
});

test("a proposed replacement enters as an ordinary PROPOSED claim", async () => {
  const known = createClaim({ text: "The DOI is 10.1000/x." });
  const { replacements } = await extractChallenges({
    userText: "You are wrong, the correct value is 10.1000/y.",
    priorClaims: [known],
    client: fakeClient({
      challenges: [
        {
          targetClaimId: known.id,
          challengeText: "that DOI is wrong",
          // The model asserting a verdict changes nothing: createClaim builds
          // the replacement in no state but PROPOSED.
          proposedReplacement: "The DOI is 10.1000/y.",
          status: "VERIFIED"
        }
      ]
    })
  });
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].status, "PROPOSED");
  assert.equal(replacements[0].epistemicType, "UNKNOWN");
  assert.deepEqual(replacements[0].evidenceIds, []);
});

test("text that disputes nothing produces nothing", async () => {
  const priorClaims = [createClaim({ text: "The DOI is 10.1000/x." })];
  for (const userText of ["Grazie, molto utile.", "   "]) {
    const result = await extractChallenges({ userText, priorClaims, client: null });
    assert.equal(result.status, CHALLENGE_EXTRACTION_STATUS.COMPLETE);
    assert.deepEqual(result.challenges, []);
  }
  // No prior claims means nothing to contest, whatever the wording.
  const orphan = await extractChallenges({ userText: "Hai sbagliato.", priorClaims: [], client: null });
  assert.deepEqual(orphan.challenges, []);
});

test("applying a challenge marks the target CHALLENGED and never REJECTED", () => {
  const ledger = new EpistemicLedger();
  const target = challengeableClaim(ledger, "The DOI is 10.1000/x.");
  const replacement = createClaim({ text: "The DOI is 10.1000/y." });

  const result = applyChallenges(ledger, {
    challenges: [{ targetClaimId: target.id, challengerType: "user", challengeText: "that DOI is wrong" }],
    replacements: [replacement]
  });

  assert.deepEqual(result.challenged, [target.id]);
  // §90: challenge -> verification -> outcome. The criticism moves the claim
  // back into question; it does not decide it.
  assert.equal(ledger.getClaim(target.id).status, "CHALLENGED");
  assert.equal(ledger.challengesFor(target.id).length, 1);
  assert.deepEqual(result.replacements, [replacement.id]);
  assert.equal(ledger.getClaim(replacement.id).status, "PROPOSED");
  assert.deepEqual(result.skipped, []);
});

test("a claim whose state cannot take a challenge is reported, not forced", () => {
  const ledger = new EpistemicLedger();
  // PROPOSED is not challengeable: nothing has been asserted to the user yet.
  const pending = ledger.create({ text: "The DOI is 10.1000/x." });
  const result = applyChallenges(ledger, {
    challenges: [{ targetClaimId: pending.id, challengeText: "wrong" }]
  });
  assert.deepEqual(result.challenged, []);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].id, pending.id);
  assert.equal(ledger.getClaim(pending.id).status, "PROPOSED");
});

test("the prompt forbids the verdicts it must not produce", () => {
  assert.match(CHALLENGE_EXTRACTOR_PROMPT, /Do not say the user is correct/);
  assert.match(CHALLENGE_EXTRACTOR_PROMPT, /Do not reject the target claim/);
  assert.match(CHALLENGE_EXTRACTOR_PROMPT, /replacement proposition separately as PROPOSED/);
  assert.match(CHALLENGE_EXTRACTOR_PROMPT, /Return JSON only/);
});

test("the model client is called as a structured JSON role", async () => {
  const known = createClaim({ text: "The DOI is 10.1000/x." });
  const client = fakeClient({ challenges: [] });
  await extractChallenges({ userText: "You are wrong.", priorClaims: [known], client });
  const [call] = client.calls;
  assert.equal(call.roleName, "epistemic_challenge_extractor");
  assert.equal(call.json, true);
  assert.equal(call.systemPrompt, CHALLENGE_EXTRACTOR_PROMPT);
  // Prior claims travel as id + text only: the verifier state is not the
  // mapper's business.
  const payload = JSON.parse(call.userPrompt);
  assert.deepEqual(payload.priorClaims, [{ id: known.id, text: known.text }]);
  assert.equal(payload.criticism, "You are wrong.");
});
