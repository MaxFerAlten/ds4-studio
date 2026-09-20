import test from "node:test";
import assert from "node:assert/strict";

import { SEVERITY } from "./epistemicContracts.mjs";
import { buildEpistemicShadowTrace } from "./epistemicShadow.mjs";
import { createEpistemicTurn, evaluateEpistemicTurn, withholdsOutput } from "./epistemicTurn.mjs";

const SHADOW = Object.freeze({ enabled: true, mode: "shadow", blockSeverity: 4 });

test("§63 shadow trace records claims, verifier debt, would-block, code and severity", () => {
  const trace = buildEpistemicShadowTrace({
    decision: { allowed: true, mustContinue: false, wouldBlock: true, code: "X" },
    extraction: { status: "EXTRACTION_PARTIAL", source: "deterministic" },
    assistantContent: "This is working code.",
    claims: [
      {
        id: "claim_1",
        text: "This is working code.",
        epistemicType: "UNKNOWN",
        status: "PROPOSED",
        verificationRequirements: ["execution_evidence"]
      }
    ]
  });

  assert.equal(trace.event, "EPISTEMIC_SHADOW");
  assert.equal(trace.extractedClaims[0].text, "This is working code.");
  assert.deepEqual(trace.verifierRequirements[0], {
    claimId: "claim_1",
    requirements: ["execution_evidence"]
  });
  assert.equal(trace.wouldBlock, true);
  assert.equal(trace.failureCode, "F04");
  assert.deepEqual(trace.failureCodes, ["F04"]);
  assert.equal(trace.severity, SEVERITY.HIGH);
});

test("shadow scans and publishes without buffering or repair", async () => {
  const turn = createEpistemicTurn({ sessionKey: "shadow", revision: 1, config: SHADOW });
  const decision = await evaluateEpistemicTurn(turn, {
    assistantContent: "This is working code."
  });

  assert.equal(withholdsOutput(SHADOW), false);
  assert.equal(decision.allowed, true);
  assert.equal(decision.mustContinue, false);
  assert.equal(decision.wouldBlock, true);
  assert.equal(decision.shadowTrace.event, "EPISTEMIC_SHADOW");
  assert.equal(decision.shadowTrace.failureCode, "F04");
});

test("a clean shadow trace has no invented failure", () => {
  const trace = buildEpistemicShadowTrace({
    decision: { allowed: true, mustContinue: false, wouldBlock: false, code: "EPISTEMIC_CLEAN" },
    extraction: { status: "EXTRACTION_PARTIAL", source: "deterministic" },
    assistantContent: "Here is a concise explanation.",
    claims: []
  });
  assert.equal(trace.wouldBlock, false);
  assert.equal(trace.failureCode, null);
  assert.deepEqual(trace.failureCodes, []);
  assert.equal(trace.severity, SEVERITY.NONE);
});
