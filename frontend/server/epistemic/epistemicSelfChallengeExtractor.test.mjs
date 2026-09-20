import test from "node:test";
import assert from "node:assert/strict";

import {
  SELF_CHALLENGE_CLASS,
  SELF_CHALLENGE_EXTRACTION_STATUS,
  SELF_CHALLENGE_PROMPT,
  extractSelfChallenges,
  isExplicitSelfChallenge
} from "./epistemicSelfChallengeExtractor.mjs";

const claims = [
  { id: "c-qho", text: "The toy FockState proves N|n> = n|n>." },
  { id: "c-source", text: "The cited paper establishes vocabulary completeness." }
];

test("explicit self-challenge creates conservative routing candidates", async () => {
  const out = await extractSelfChallenges({
    text: "We are missing scalar multiplication; the model is insufficient.",
    knownClaims: [claims[0]]
  });
  assert.equal(out.status, SELF_CHALLENGE_EXTRACTION_STATUS.PARTIAL);
  assert.equal(out.challenges.length, 1);
  assert.equal(out.challenges[0].targetClaimId, "c-qho");
  assert.equal(out.challenges[0].challengeClass, SELF_CHALLENGE_CLASS.MODEL_INADEQUACY);
  assert.equal(out.challenges[0].confidenceForRoutingOnly, 0);
});

test("stylistic uncertainty is not a self-challenge", async () => {
  assert.equal(isExplicitSelfChallenge("This could perhaps be explained more clearly."), false);
  const out = await extractSelfChallenges({ text: "I am not completely certain.", knownClaims: claims });
  assert.deepEqual(out.challenges, []);
  assert.equal(out.source, "none");
});

test("structured extraction reuses completeRole and binds known claims only", async () => {
  const calls = [];
  const client = {
    async completeRole(input) {
      calls.push(input);
      return {
        json: {
          challenges: [
            {
              targetClaimId: "c-qho",
              text: "the formal model cannot represent scalar multiplication",
              challengeClass: "MODEL_INADEQUACY",
              severity: 5,
              confidenceForRoutingOnly: 0.93
            },
            { targetClaimId: "invented", text: "unknown claim", severity: 5 }
          ]
        }
      };
    }
  };
  const out = await extractSelfChallenges({
    text: "The theorem statement is incorrect; I need to fix it.",
    knownClaims: claims,
    client
  });

  assert.equal(out.status, SELF_CHALLENGE_EXTRACTION_STATUS.COMPLETE);
  assert.equal(out.source, "model");
  assert.deepEqual(out.challenges.map((challenge) => challenge.targetClaimId), ["c-qho"]);
  assert.equal(out.challenges[0].confidenceForRoutingOnly, 0.93);
  assert.equal(calls[0].roleName, "epistemic_self_challenge_extractor");
  assert.equal(calls[0].json, true);
  assert.equal(calls[0].systemPrompt, SELF_CHALLENGE_PROMPT);
});

test("model failure remains partial and does not erase explicit debt", async () => {
  const out = await extractSelfChallenges({
    text: "La mia affermazione precedente era sbagliata.",
    knownClaims: [claims[0]],
    client: { async completeRole() { throw new Error("offline"); } }
  });
  assert.equal(out.status, SELF_CHALLENGE_EXTRACTION_STATUS.PARTIAL);
  assert.equal(out.challenges.length, 1);
  assert.match(out.reason, /offline/);
});

test("extractor consumes only supplied candidate text and claim summaries", async () => {
  let payload;
  const client = {
    async completeRole(input) {
      payload = JSON.parse(input.userPrompt);
      return { json: { challenges: [{ targetClaimId: "c-qho", text: "this is wrong" }] } };
    }
  };
  await extractSelfChallenges({ text: "This is wrong.", knownClaims: [claims[0]], client });
  assert.deepEqual(Object.keys(payload).sort(), ["candidateText", "priorClaims"]);
  assert.equal(Object.hasOwn(payload, "reasoning"), false);
});
