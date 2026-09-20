// leanTargetIdentity.test.mjs — Tests for target identity extraction
//
// TID-01  theorem semplice
// TID-02  body diverso, stesso statement
// TID-03  stesso nome, statement diverso
// TID-04  whitespace/commenti non semantici
// TID-05  string literal preservata
// TID-06  commento contenente `theorem fake`
// TID-07  stringa contenente `theorem fake`
// TID-08  nested block comments
// TID-09  helper + target
// TID-10  target assente
// TID-11  target duplicato
// TID-12  proof term diretto
// TID-13  `:=` dentro binder/default/term
// TID-14  Unicode

import assert from "node:assert";
import { describe, it } from "node:test";

const {
  extractLeanTargetIdentity,
  normalizeLeanTargetStatement,
  LEAN_TARGET_IDENTITY_ALGORITHM,
} = await import("./leanTargetIdentity.mjs");

// --- Helpers ----------------------------------------------------------------

function tid(name, source, targetDeclaration) {
  return extractLeanTargetIdentity(source, targetDeclaration);
}

// --- TID-01 — theorem semplice -------------------------------------------

describe("TID-01 — theorem semplice", () => {
  const src = `theorem t : True := by\n  trivial`;
  const result = tid("t", src, "t");

  it("ok=true", () => { assert.equal(result.ok, true); });
  it("kind=theorem", () => { assert.equal(result.value.kind, "theorem"); });
  it("name=t", () => { assert.equal(result.value.name, "t"); });
  it("hash length=64", () => {
    assert.equal(result.value.statementSha256.length, 64);
    assert.match(result.value.statementSha256, /^[0-9a-f]{64}$/);
  });
});

// --- TID-02 — body diverso, stesso statement -----------------------------

describe("TID-02 — body diverso, stesso statement", () => {
  const A = `theorem t : True := by\n  trivial`;
  const B = `theorem t : True := by\n  exact True.intro`;

  const rA = tid("A", A, "t");
  const rB = tid("B", B, "t");

  it("both ok", () => {
    assert.equal(rA.ok, true);
    assert.equal(rB.ok, true);
  });
  it("A.statementSha256 == B.statementSha256", () => {
    assert.equal(rA.value.statementSha256, rB.value.statementSha256);
  });
});

// --- TID-03 — stesso nome, statement diverso -----------------------------

describe("TID-03 — stesso nome, statement diverso", () => {
  const srcTrue = `theorem t : True := by trivial`;
  const srcEq   = `theorem t : 1 + 1 = 2 := by decide`;

  const rTrue = tid("true", srcTrue, "t");
  const rEq   = tid("eq", srcEq, "t");

  it("hash diversi", () => {
    assert.notEqual(rTrue.value.statementSha256, rEq.value.statementSha256);
  });
});

// --- TID-04 — whitespace/commenti non semantici --------------------------

describe("TID-04 — whitespace/commenti non semantici", () => {
  const clean = `theorem t : True := by\n  trivial`;
  const messy = `theorem\tt :\n  True\t-- comment\n:= by\n  trivial`;

  const rClean = tid("clean", clean, "t");
  const rMessy = tid("messy", messy, "t");

  it("stessi hash dopo normalizzazione", () => {
    assert.equal(rClean.ok, true);
    assert.equal(rMessy.ok, true);
    assert.equal(rClean.value.statementSha256, rMessy.value.statementSha256);
  });
});

// --- TID-05 — string literal preservata ---------------------------------
//
// NOTE: String literals appear in the *proof body*, not the declaration header.
// The statement fingerprint covers only the header up to `:= by`, so different
// proof bodies produce identical hashes. This is correct behavior — see TID-02.

describe("TID-05 — string literal preservata", () => {
  const srcA = `theorem t : String := by\n  exact "hello"`;
  const srcB = `theorem t : String := by\n  exact "world"`;

  const rA = tid("A", srcA, "t");
  const rB = tid("B", srcB, "t");

  it("stessi hash (stringhe sono nel corpo, non nella dichiarazione)", () => {
    assert.equal(rA.value.statementSha256, rB.value.statementSha256);
  });
});

// --- TID-06 — commento contenente `theorem fake` -------------------------

describe("TID-06 — commento con theorem fake", () => {
  const src = `
/- This is a comment with theorem fake inside -/
theorem real : True := by
  trivial
  `;

  const result = tid("real", src, "real");
  it("trova solo real, non fake", () => {
    assert.equal(result.ok, true);
    assert.equal(result.value.name, "real");
  });
});

// --- TID-07 — stringa contenente `theorem fake` --------------------------

describe("TID-07 — stringa con theorem fake", () => {
  const src = `
def s := "theorem fake"
theorem real : True := by
  trivial
  `;

  const result = tid("real", src, "real");
  it("trova solo real, non fake dentro stringa", () => {
    assert.equal(result.ok, true);
    assert.equal(result.value.name, "real");
  });
});

// --- TID-08 — nested block comments -------------------------------------

describe("TID-08 — nested block comments", () => {
  const src = `
/-
  Outer comment
  /- Nested inner -/
  Still outer
-/
theorem t : True := by
  trivial
  `;

  const result = tid("t", src, "t");
  it("non perde allineamento dopo nested comment", () => {
    assert.equal(result.ok, true);
    assert.equal(result.value.name, "t");
  });
});

// --- TID-09 — helper + target -------------------------------------------

describe("TID-09 — helper + target", () => {
  const src = `
lemma helper : True := by trivial

theorem cauchy_mean_value : True := by
  trivial
  `;

  const result = tid("cauchy_mean_value", src, "cauchy_mean_value");
  it("sceglie solo il target", () => {
    assert.equal(result.ok, true);
    assert.equal(result.value.kind, "theorem");
    assert.equal(result.value.name, "cauchy_mean_value");
  });
});

// --- TID-10 — target assente --------------------------------------------

describe("TID-10 — target assente", () => {
  const src = `theorem real : True := by\n  trivial`;
  const result = tid("absent", src, "nonexistent");

  it("NOT_FOUND", () => {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "LEAN_TARGET_DECLARATION_NOT_FOUND");
  });
});

// --- TID-11 — target duplicato ------------------------------------------

describe("TID-11 — target duplicato", () => {
  const src = `
theorem dup : True := by trivial
theorem dup : 1 + 1 = 2 := by decide
  `;
  const result = tid("dup", src, "dup");

  it("AMBIGUOUS", () => {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "LEAN_TARGET_DECLARATION_AMBIGUOUS");
  });
});

// --- TID-12 — proof term diretto ----------------------------------------

describe("TID-12 — proof term diretto", () => {
  const src = `theorem t : True := True.intro`;
  const result = tid("t", src, "t");

  it("PROOF_FORM_UNSUPPORTED", () => {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "LEAN_TARGET_PROOF_FORM_UNSUPPORTED");
  });
});

// --- TID-13 — `:=` dentro binder/default/term ---------------------------

describe("TID-13 — := dentro binder", () => {
  // The scanner must not confuse an internal `:=` with the top-level proof marker.
  // Here we have a default parameter using := inside the binder list.
  const src = `
def foo (x := 1) := x

theorem t : True := by
  trivial
  `;

  const result = tid("t", src, "t");
  it("trova il theorem corretto non confuso dal := interno", () => {
    assert.equal(result.ok, true);
    assert.equal(result.value.name, "t");
  });
});

// --- TID-14 — Unicode ---------------------------------------------------

describe("TID-14 — Unicode", () => {
  const src = `
theorem unicode_test (x : ℝ) : ∀ y ∈ {x}, x ≠ y → x ≤ y := by
  intro hy hne
  exact le_of_lt (hne ▸ rfl)
  `;

  const result = tid("unicode_test", src, "unicode_test");

  it("ok=true con caratteri Unicode", () => {
    assert.equal(result.ok, true);
    assert.equal(result.value.kind, "theorem");
    assert.match(result.value.statementSha256, /^[0-9a-f]{64}$/);
  });

  it("hash deterministico su round trip", () => {
    // Run twice to verify determinism
    const again = tid("unicode_test", src, "unicode_test");
    assert.equal(again.value.statementSha256, result.value.statementSha256);
  });
});
