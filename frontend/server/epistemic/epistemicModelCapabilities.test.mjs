import test from "node:test";
import assert from "node:assert/strict";
import {
  capabilitiesOfSource,
  capabilityGaps,
  requiredCapabilitiesForClaim
} from "./epistemicModelCapabilities.mjs";

const FOCK_TOY = `
inductive FockState where
  | Zero : FockState
  | Basis : Nat -> FockState

def raise : FockState -> FockState
  | FockState.Zero => FockState.Zero
  | FockState.Basis n => FockState.Basis (n + 1)
`;

const FOCK_MODULE = `
variable {K : Type} [Field K] [AddCommGroup V] [Module K V]
noncomputable def number : V →ₗ[K] V := sorry
def basisState (n : Nat) : V := sorry
def scaled (c : K) (v : V) : V := c • v
`;

test("EPI-043: the toy Fock model has no scalar multiplication", () => {
  const provided = capabilitiesOfSource(FOCK_TOY);
  assert.equal(provided.includes("ZERO_ELEMENT"), true);
  assert.equal(provided.includes("BASIS_STATES"), true);
  assert.equal(provided.includes("SCALAR_MULTIPLICATION"), false);
  assert.equal(provided.includes("LINEAR_MAPS"), false);
});

test("EPI-043: the number-operator claim cannot be certified by the toy model", () => {
  const gaps = capabilityGaps({ claimText: "The model proves N|n> = n|n>.", source: FOCK_TOY });
  assert.equal(gaps.profile, "NUMBER_OPERATOR_EIGENSTATE");
  assert.equal(gaps.gaps.includes("SCALAR_MULTIPLICATION"), true);
  assert.deepEqual(gaps.failureCodes, ["F38", "F32"]);
});

test("a model that carries the structure closes the gap", () => {
  const gaps = capabilityGaps({ claimText: "The model proves N|n> = n|n>.", source: FOCK_MODULE });
  assert.deepEqual(gaps.gaps, []);
  assert.deepEqual(gaps.failureCodes, []);
});

test("a claim outside the profile asks for nothing", () => {
  assert.equal(requiredCapabilitiesForClaim("The build is green."), null);
  assert.deepEqual(capabilityGaps({ claimText: "The build is green.", source: FOCK_TOY }).failureCodes, []);
});

test("EPI-069 (Q2-006 §9): a constructor-injectivity toy cannot certify a QHO spectrum claim", () => {
  const source =
    "inductive EnergyLevel : Type where\n" +
    "  | mk (n : Nat) : EnergyLevel\n\n" +
    "theorem spectrum_discrete (n m : Nat) :\n" +
    "    EnergyLevel.mk n = EnergyLevel.mk m -> n = m := by\n  simp";
  const gaps = capabilityGaps({
    claimText:
      "Gli autovalori dell'Hamiltoniano formano uno spettro discreto e non degenere.",
    source
  });
  assert.equal(gaps.profile, "SPECTRUM_DISCRETE_NONDEGENERATE");
  assert.ok(gaps.gaps.includes("EIGENVALUE_SEMANTICS"));
  assert.ok(gaps.gaps.includes("LINEAR_OPERATOR"));
  assert.ok(gaps.failureCodes.includes("F32"));
  assert.ok(gaps.failureCodes.includes("F38"));
});

test("Q2-006 (§47): a formalization proving only the energy formula does not establish non-degeneracy", async () => {
  const { QHO_CLAIM_PROFILES } = await import("./domainProfiles/qhoProfile.mjs");
  const spectrum = QHO_CLAIM_PROFILES.SPECTRUM_DISCRETE_NONDEGENERATE;
  assert.ok(spectrum.requiredFormalProperties.includes("EIGENVALUES_NONDEGENERATE"));
  assert.ok(spectrum.requiredFormalProperties.includes("OPERATOR_SPECTRUM_DISCRETE"));
  assert.ok(spectrum.requiredFormalProperties.includes("HAMILTONIAN_DEFINED"));
  // Establishing only the energy formula leaves the other four open.
  const established = ["ENERGY_LEVEL_FORMULA"];
  const missing = spectrum.requiredFormalProperties.filter((p) => !established.includes(p));
  assert.equal(missing.length, 4);
});

test("Q2-006: a real operator formalization with eigenvalue semantics has no capability gap", () => {
  const source =
    "variable {E : Type} [NormedAddCommGroup E] [InnerProductSpace Complex E]\n" +
    "variable {H : E ->L[Complex] E}\n" +
    "theorem h_spectrum (psi : E) (lambda : Complex) (h : H psi = lambda • psi) :\n" +
    "    lambda \\in spectrum Complex H := by\n  exact eigenvalue_mem_spectrum h";
  const gaps = capabilityGaps({
    claimText: "Lo spettro dell'Hamiltoniano e discreto e non degenere.",
    source
  });
  assert.equal(gaps.gaps.length, 0, `unexpected gaps: ${gaps.gaps.join(", ")}`);
  assert.equal(gaps.failureCodes.length, 0);
});
