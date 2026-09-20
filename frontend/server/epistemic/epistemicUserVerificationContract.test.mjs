/**
 * Q2-001 (remediation.Quantiom.002 §4) — the user's verification contract is
 * state, not prose. UVC-001..UVC-006.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  USER_VERIFICATION_POLICY,
  VERIFICATION_COVERAGE_MODE,
  deriveUserVerificationContract,
  isStrictContract
} from "./epistemicUserVerificationContract.mjs";

test("UVC-001: a strict Italian every-claim Lean request becomes ALL_ASSERTIVE_CLAIMS + LEAN_REQUIRED", () => {
  const contract = deriveUserVerificationContract({
    userText:
      "Scrivi una sintesi QHO/LLM. Ogni affermazione deve essere dimostrata con Lean."
  });
  assert.equal(contract.coverageMode, VERIFICATION_COVERAGE_MODE.ALL_ASSERTIVE_CLAIMS);
  assert.equal(contract.mathematicalClaims, USER_VERIFICATION_POLICY.LEAN_REQUIRED);
  assert.equal(contract.analogyPolicy, USER_VERIFICATION_POLICY.EXPLICIT_ANALOGY);
  assert.equal(contract.unverifiablePolicy, USER_VERIFICATION_POLICY.OMIT_OR_DISCLOSE);
  assert.equal(isStrictContract(contract), true);
});

test("UVC-002: 'i paper devono essere certificati esistenti tramite ricerca sul web' requires primary sources", () => {
  const contract = deriveUserVerificationContract({
    userText:
      "Ogni affermazione deve essere dimostrata con Lean e i paper devono essere certificati esistenti tramite ricerca sul web."
  });
  assert.equal(contract.bibliographicIdentity, USER_VERIFICATION_POLICY.PRIMARY_SOURCE_REQUIRED);
  assert.equal(contract.sourceContentClaims, USER_VERIFICATION_POLICY.SOURCE_ENTAILMENT_REQUIRED);
});

test("UVC-002b: the English 'prove every statement in Lean / verify every paper exists' triggers the same contract", () => {
  const contract = deriveUserVerificationContract({
    userText: "Prove every statement in Lean and verify every paper exists on the web."
  });
  assert.equal(contract.coverageMode, VERIFICATION_COVERAGE_MODE.ALL_ASSERTIVE_CLAIMS);
  assert.equal(contract.mathematicalClaims, USER_VERIFICATION_POLICY.LEAN_REQUIRED);
  assert.equal(contract.bibliographicIdentity, USER_VERIFICATION_POLICY.PRIMARY_SOURCE_REQUIRED);
});

test("UVC-003: an ordinary question stays DEFAULT and is not strict", () => {
  const contract = deriveUserVerificationContract({
    userText: "Puoi spiegarmi come funziona l'oscillatore armonico quantistico?"
  });
  assert.equal(contract.coverageMode, VERIFICATION_COVERAGE_MODE.DEFAULT);
  assert.equal(contract.mathematicalClaims, USER_VERIFICATION_POLICY.DEFAULT);
  assert.equal(isStrictContract(contract), false);
});

test("UVC-004: assistant reasoning cannot weaken the contract — only user text is read", () => {
  const userText = "Ogni affermazione deve essere dimostrata con Lean.";
  const strict = deriveUserVerificationContract({ userText });
  // The weakening the transcript actually performed, offered as if it were input.
  const withAssistantWeakening = deriveUserVerificationContract({
    userText,
    assistantReasoning:
      "that's extremely broad; for each major claim I will provide a Lean snippet",
    coverageMode: VERIFICATION_COVERAGE_MODE.SELECTED_CLAIMS,
    mathematicalClaims: USER_VERIFICATION_POLICY.DEFAULT
  });
  assert.equal(withAssistantWeakening.coverageMode, strict.coverageMode);
  assert.equal(withAssistantWeakening.mathematicalClaims, strict.mathematicalClaims);
  assert.equal(withAssistantWeakening.sourceTextHash, strict.sourceTextHash);
});

test("UVC-005: the contract is frozen, so a repair round cannot mutate it", () => {
  const contract = deriveUserVerificationContract({
    userText: "Ogni affermazione deve essere dimostrata con Lean."
  });
  assert.throws(() => {
    contract.coverageMode = VERIFICATION_COVERAGE_MODE.DEFAULT;
  }, TypeError);
});

test("UVC-006: the same user text yields the same contract hash across turns", () => {
  const userText = "Ogni claim deve essere verificato.";
  const a = deriveUserVerificationContract({ userText });
  const b = deriveUserVerificationContract({ userText });
  assert.equal(a.sourceTextHash, b.sourceTextHash);
  assert.equal(a.coverageMode, b.coverageMode);
  assert.notEqual(a.id, "");
});
