/** R08-PATCH-05/06 — real conversation replay.
 *
 * Drives the actual epistemic turn pipeline over the QHO finalization fixture:
 *   - the broad final ("QHO number operator formally verified") must be blocked;
 *   - the honest narrowed repair ("typechecked only the toy transition model",
 *     explicitly denying N|n> = n|n>) must be allowed.
 *
 * This is the end-to-end regression for the real conversation, not a unit test
 * of any single verifier.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createEpistemicTurn, evaluateEpistemicTurn } from "./epistemicTurn.mjs";
import { evidenceFromToolResult } from "./epistemicEvidence.mjs";
import { QHO_FINALIZATION_CASES } from "./fixtures/qhoFinalizationRegression.mjs";

const HARDENED = Object.freeze({
  enabled: true,
  mode: "block",
  withholdOutput: true,
  blockSeverity: 4,
  maxClaimsPerTurn: 64,
  maxVerifierCallsPerTurn: 4,
  verifyMath: true,
  verifyCitations: true,
  verifyExecutionClaims: true,
  verifyChallenges: true,
  verifyVerificationLanguage: true
});

function extractionClient(claims) {
  return {
    async completeRole(args) {
      if (args.roleName !== "epistemic_claim_extractor") {
        throw new Error(`unexpected semantic role ${args.roleName}`);
      }
      return { json: { claims }, content: JSON.stringify({ claims }) };
    }
  };
}

function runFixture(c) {
  const turn = createEpistemicTurn({ config: HARDENED });
  for (const ev of c.leanEvidence ?? []) {
    turn.evidence.add(
      evidenceFromToolResult({ callId: `call_${c.id}`, toolName: ev.toolName, arguments: {}, rawResult: ev.rawResult })
    );
  }
  const session = { ledger: turn.ledger };
  return evaluateEpistemicTurn(turn, {
    assistantContent: c.candidate,
    reasoning: c.assistantReasoning,
    client: extractionClient(c.claims),
    sessionLedger: session.ledger
  });
}

for (const c of QHO_FINALIZATION_CASES) {
  test(`R08 replay ${c.id}: expected ${c.expected}`, async () => {
    const decision = await runFixture(c);
    if (c.expected === "blocked") {
      assert.equal(decision.allowed, false, "broad final must be blocked");
    } else {
      assert.equal(decision.allowed, true, "honest narrowed final must be allowed");
    }
  });
}
