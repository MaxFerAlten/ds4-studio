import test from "node:test";
import assert from "node:assert/strict";
import {
  PROOF_DEPENDENCY_STATUS,
  assertsLeanProof,
  auditLeanSource,
  certificateScopeMismatch,
  proofClaimFailureCodes
} from "./epistemicLeanAxiomAudit.mjs";

test("an axiom is postulated, never proved", () => {
  const audit = auditLeanSource(`
    axiom commutation : ∀ a b : Nat, a + b = b + a
    theorem uses_it (a b : Nat) : a + b = b + a := commutation a b
  `);
  assert.equal(audit.status, PROOF_DEPENDENCY_STATUS.LOCAL_AXIOM_DEPENDENCY);
  assert.equal(audit.localAxioms.length, 1);
  assert.equal(audit.localAxioms[0].name, "commutation");
  assert.deepEqual(proofClaimFailureCodes(audit), ["F35", "F40"]);
});

test("a theorem that proves its own statement is clean", () => {
  const audit = auditLeanSource("theorem t (n : Nat) : 0 < n.succ := Nat.succ_pos n");
  assert.equal(audit.status, PROOF_DEPENDENCY_STATUS.CLEAN);
  assert.deepEqual(audit.theoremNames, ["t"]);
  // (n : Nat) is data, not a premise: it must not be reported as an assumption.
  assert.deepEqual(audit.theoremPremises, []);
  assert.deepEqual(proofClaimFailureCodes(audit), []);
});

test("a premise stays visible in the audit", () => {
  const audit = auditLeanSource("theorem t (h : 0 < n) : 0 < n + 1 := by omega");
  assert.equal(audit.status, PROOF_DEPENDENCY_STATUS.CONDITIONAL);
  assert.equal(audit.theoremPremises.length, 1);
  assert.deepEqual(proofClaimFailureCodes(audit), ["F31", "F40"]);
});

test("sorry closes nothing", () => {
  const audit = auditLeanSource("theorem t : 1 = 1 := by sorry");
  assert.equal(audit.status, PROOF_DEPENDENCY_STATUS.LOCAL_AXIOM_DEPENDENCY);
  assert.equal(audit.sorries, true);
});

test("comments cannot introduce or hide an axiom", () => {
  const commented = auditLeanSource(`
    -- axiom fake : False
    /- axiom also_fake : False -/
    theorem t : 1 = 1 := rfl
  `);
  assert.equal(commented.status, PROOF_DEPENDENCY_STATUS.CLEAN);
  assert.equal(commented.localAxioms.length, 0);
});

test("a source with nothing recognisable is UNKNOWN, not clean", () => {
  for (const source of ["", "   ", "#eval 2 + 2"]) {
    const audit = auditLeanSource(source);
    assert.equal(audit.status, PROOF_DEPENDENCY_STATUS.UNKNOWN);
    assert.deepEqual(proofClaimFailureCodes(audit), ["F40"]);
  }
});

test("proof language is recognised in both languages the agent answers in", () => {
  assert.equal(assertsLeanProof("Lean proved the commutation relation."), true);
  assert.equal(assertsLeanProof("Lean ha verificato formalmente la relazione."), true);
  assert.equal(assertsLeanProof("La relazione è stata dimostrata formalmente."), true);
  assert.equal(assertsLeanProof("Lean typechecked the toy model."), false);
  assert.equal(assertsLeanProof("The tests pass."), false);
});

test("EPI-044: a proof about naturals does not cover a claim about QHO energy", () => {
  const source = "theorem t (n : Nat) : 0 < n.succ := Nat.succ_pos n";
  const mismatch = certificateScopeMismatch({
    claimText: "Lean proves all QHO energy levels are positive.",
    source
  });
  assert.equal(mismatch.mismatch, true);
  assert.deepEqual(mismatch.failureCodes, ["F27"]);

  // The narrow reading of the same run is in scope.
  const narrow = certificateScopeMismatch({
    claimText: "Lean proves that the successor of a natural number is positive.",
    source
  });
  assert.equal(narrow.mismatch, false);
});

test("Q2-019 (§22): a theorem name confers zero authority on the scope it names", () => {
  const source =
    "theorem proved_general_relativity (n m : Nat) :\n" +
    "    Foo.mk n = Foo.mk m -> n = m := by\n  simp";
  const scope = certificateScopeMismatch({
    claimText: "Lean proved general relativity.",
    source
  });
  assert.equal(scope.mismatch, true);
  assert.deepEqual(scope.failureCodes, ["F27"]);
});

test("EPI-069 (§9.1): constructor injectivity does not cover the QHO spectrum claim", () => {
  const source =
    "inductive EnergyLevel : Type where\n" +
    "  | mk (n : Nat) : EnergyLevel\n\n" +
    "theorem spectrum_discrete (n m : Nat) :\n" +
    "    EnergyLevel.mk n = EnergyLevel.mk m -> n = m := by\n  simp";
  const scope = certificateScopeMismatch({
    claimText: "Lean proved the QHO Hamiltonian spectrum is discrete and non-degenerate.",
    source
  });
  assert.equal(scope.mismatch, true, "the declaration name must not launder the scope");
  assert.ok(scope.failureCodes.includes("F27"));
});

test("Q2-020 (§23): a docstring claiming more than the statement confers zero authority", () => {
  const source =
    "/-- This proves QHO spectrum discreteness and non-degeneracy. -/\n" +
    "theorem t (n m : Nat) : Foo.mk n = Foo.mk m -> n = m := by\n  simp";
  const scope = certificateScopeMismatch({
    claimText: "The QHO spectrum is discrete.",
    source
  });
  assert.equal(scope.mismatch, true);
});

test("Q2-019: a source that really is about the claim's subject still passes scope", () => {
  const source =
    "theorem energy_positive (hbar omega : Real) (n : Nat) :\n" +
    "    0 < hbar * omega * (n + 1/2) := by\n  positivity";
  const scope = certificateScopeMismatch({
    claimText: "the energy hbar omega is positive",
    source
  });
  assert.equal(scope.mismatch, false);
});
