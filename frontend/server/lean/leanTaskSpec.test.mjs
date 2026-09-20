import test from "node:test";
import assert from "node:assert/strict";

import {
  assertLeanTaskSpecUnchanged,
  createLeanTaskSpec,
  hashLeanTargetStatement,
  LEAN_TASKSPEC_MUTATION_ATTEMPT
} from "./leanTaskSpec.mjs";
import { extractLeanTargetIdentity } from "./leanTargetIdentity.mjs";

const CAUCHY_HEADER =
  "theorem cauchy_mvt (f g : ℝ → ℝ) (a b : ℝ) (hab : a < b) :\n" +
  "    ∃ c ∈ Set.Ioo a b, deriv f c * (g b - g a) = deriv g c * (f b - f a)";

function spec(overrides = {}) {
  return createLeanTaskSpec({
    targetDeclaration: "cauchy_mvt",
    targetStatement: CAUCHY_HEADER,
    requiredProfile: "mathlib",
    ...overrides
  });
}

test("a sealed spec hashes the statement exactly as the extractor reads it from a source", () => {
  // The whole design rests on this: the digest sealed before any candidate
  // exists must equal the digest computed from the same header inside a real
  // candidate, or nothing would ever match.
  const sealed = spec();
  assert.equal(sealed.ok, true);

  const candidate = `import Mathlib\nopen Set\n\n${CAUCHY_HEADER} := by\n  exact foo\n`;
  const fromSource = extractLeanTargetIdentity(candidate, "cauchy_mvt");
  assert.equal(fromSource.ok, true);
  assert.equal(sealed.value.targetStatementSha256, fromSource.value.statementSha256);
});

test("whitespace and line breaks do not change the sealed digest", () => {
  // §12.2 — binder formatting is presentation, not identity.
  const reflowed = CAUCHY_HEADER.replace(/\s+/g, " ");
  assert.equal(
    spec().value.targetStatementSha256,
    spec({ targetStatement: reflowed }).value.targetStatementSha256
  );
});

test("§61 the trivial substitution gets a different digest", () => {
  const trivial = extractLeanTargetIdentity(
    "theorem cauchy_mvt : True := by\n  trivial\n",
    "cauchy_mvt"
  );
  assert.equal(trivial.ok, true);
  assert.notEqual(trivial.value.statementSha256, spec().value.targetStatementSha256);
});

test("§63 dropping a hypothesis changes the digest", () => {
  const weakened = CAUCHY_HEADER.replace(" (hab : a < b)", "");
  assert.notEqual(
    spec({ targetStatement: weakened }).value.targetStatementSha256,
    spec().value.targetStatementSha256
  );
});

test("§64 changing the domain changes the digest", () => {
  const rationals = CAUCHY_HEADER.replaceAll("ℝ", "ℚ");
  assert.notEqual(
    spec({ targetStatement: rationals }).value.targetStatementSha256,
    spec().value.targetStatementSha256
  );
});

test("a proof task must name its target", () => {
  const result = createLeanTaskSpec({ targetStatement: CAUCHY_HEADER });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_TARGET_DECLARATION_REQUIRED");
});

test("a proof task must state its target", () => {
  const result = createLeanTaskSpec({ targetDeclaration: "cauchy_mvt" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_TASKSPEC_STATEMENT_REQUIRED");
  assert.match(result.error.message, /declaration header/);
});

test("the statement must define the declaration it claims", () => {
  // Extraction is by name, so a header declaring something else simply is not
  // found — refused either way, and the message names what was expected.
  const result = createLeanTaskSpec({
    targetDeclaration: "lagrange_mvt",
    targetStatement: CAUCHY_HEADER
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_TASKSPEC_STATEMENT_INVALID");
  assert.match(result.error.message, /lagrange_mvt/);
});

test("an unparseable statement is refused rather than hashed as text", () => {
  const result = createLeanTaskSpec({
    targetDeclaration: "cauchy_mvt",
    targetStatement: "prove the mean value theorem please"
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LEAN_TASKSPEC_STATEMENT_INVALID");
});

test("a statement already carrying ':= by' is accepted and hashes the same", () => {
  const withProof = `${CAUCHY_HEADER} := by\n  sorry`;
  assert.equal(
    spec({ targetStatement: withProof }).value.targetStatementSha256,
    spec().value.targetStatementSha256
  );
});

test("§342-§345 a sealed spec is deeply immutable", () => {
  const sealed = spec({ expectedDeclarations: ["lagrange_mvt"] }).value;
  assert.equal(sealed.sealed, true);

  assert.throws(() => {
    "use strict";
    sealed.targetDeclaration = "something_else";
  }, TypeError);
  assert.throws(() => {
    "use strict";
    sealed.expectedDeclarations.push("smuggled");
  }, TypeError);

  assert.equal(sealed.targetDeclaration, "cauchy_mvt");
  assert.deepEqual(sealed.expectedDeclarations, ["cauchy_mvt", "lagrange_mvt"]);
});

test("§336 the primary target leads the expected declarations", () => {
  const sealed = spec({ expectedDeclarations: ["lagrange_mvt", "cauchy_mvt"] }).value;
  assert.equal(sealed.expectedDeclarations[0], "cauchy_mvt");
  assert.equal(sealed.expectedDeclarations.length, 2);
});

test("§60 drift against a sealed spec is named, not absorbed", () => {
  const sealed = spec().value;

  assert.equal(assertLeanTaskSpecUnchanged(sealed, { targetDeclaration: "cauchy_mvt" }).ok, true);

  const renamed = assertLeanTaskSpecUnchanged(sealed, { targetDeclaration: "easier_thm" });
  assert.equal(renamed.ok, false);
  assert.equal(renamed.error.code, LEAN_TASKSPEC_MUTATION_ATTEMPT);

  const reprofiled = assertLeanTaskSpecUnchanged(sealed, { requiredProfile: "core" });
  assert.equal(reprofiled.ok, false);
  assert.equal(reprofiled.error.code, LEAN_TASKSPEC_MUTATION_ATTEMPT);

  const unsealed = assertLeanTaskSpecUnchanged(null, { targetDeclaration: "x" });
  assert.equal(unsealed.error.code, "LEAN_TASKSPEC_NOT_SEALED");
});

test("hashLeanTargetStatement rejects an empty statement", () => {
  assert.equal(hashLeanTargetStatement("", "t").ok, false);
  assert.equal(hashLeanTargetStatement("   ", "t").error.code, "LEAN_TASKSPEC_STATEMENT_REQUIRED");
});
