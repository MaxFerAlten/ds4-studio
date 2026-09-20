// Tests for leanDiagnostics.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as diagnostics from "./leanDiagnostics.mjs";
import {
  parseLeanDiagnostics,
  summarizeLeanDiagnostics,
  detectLeanPlaceholders,
  collectLeanDeclarations,
} from "./leanDiagnostics.mjs";

test("parseLeanDiagnostics — empty input", () => {
  const { diagnostics, truncated } = parseLeanDiagnostics("");
  assert.equal(diagnostics.length, 0);
  assert.equal(truncated, false);
});

test("parseLeanDiagnostics — error diagnostic", () => {
  const { diagnostics } = parseLeanDiagnostics("/tmp/Main.lean:3:17: error: type mismatch\n");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "error");
  assert.equal(diagnostics[0].line, 3);
  assert.equal(diagnostics[0].column, 17);
  assert.equal(diagnostics[0].message, "type mismatch");
});

test("parseLeanDiagnostics — warning diagnostic", () => {
  const { diagnostics } = parseLeanDiagnostics("/tmp/Main.lean:5:10: warning: unused variable\n");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].line, 5);
});

test("parseLeanDiagnostics — ranged header keeps the end position", () => {
  const { diagnostics } = parseLeanDiagnostics(
    "./Main.lean:5:10-5:21: warning: unused variable `x`\n"
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].line, 5);
  assert.equal(diagnostics[0].column, 10);
  assert.equal(diagnostics[0].endLine, 5);
  assert.equal(diagnostics[0].endColumn, 21);
});

test("parseLeanDiagnostics — Lean 4.32 spells info as 'information'", () => {
  const { diagnostics } = parseLeanDiagnostics("Main.lean:1:0: information: 42\n");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "info");
  assert.equal(diagnostics[0].message, "42");
});

test("parseLeanDiagnostics — continuation lines keep their indentation", () => {
  const text =
    "/tmp/Main.lean:2:8: error: type mismatch\n" +
    "  Nat.succ n\n" +
    "has type\n" +
    "  Nat : Type\n";
  const { diagnostics } = parseLeanDiagnostics(text);
  assert.equal(diagnostics.length, 1);
  assert.ok(diagnostics[0].message.includes("\n  Nat.succ n"));
  assert.ok(diagnostics[0].raw.includes("\n  Nat : Type"));
});

test("parseLeanDiagnostics — multiple diagnostics", () => {
  const text =
    "/tmp/Main.lean:3:17: error: type mismatch\n" +
    "/tmp/Main.lean:7:12: error: unknown identifier\n";
  const { diagnostics, truncated } = parseLeanDiagnostics(text);
  assert.equal(diagnostics.length, 2);
  assert.equal(truncated, false);
});

test("parseLeanDiagnostics — truncated only when a further header exists", () => {
  const two =
    "Main.lean:1:0: error: a\n" +
    "Main.lean:2:0: error: b\n";
  const exact = parseLeanDiagnostics(two, { maxDiagnostics: 2 });
  assert.equal(exact.diagnostics.length, 2);
  assert.equal(exact.truncated, false, "hitting the cap alone is not proof of truncation");

  const three = two + "Main.lean:3:0: error: c\n";
  const over = parseLeanDiagnostics(three, { maxDiagnostics: 2 });
  assert.equal(over.diagnostics.length, 2);
  assert.equal(over.truncated, true);
});

test("parseLeanDiagnostics — verbatim Lean 4.32.2 stdout", () => {
  // Captured from `lean Main.lean` with the pinned toolchain
  // (Lean 4.32.2, commit f3b06c7): multi-paragraph messages, a blank line
  // inside the linter warning, and bare `#eval` output with no header.
  const real =
    "/work/Main.lean:2:30: error: Tactic `decide` proved that the proposition\n" +
    "  1 + 1 = 3\n" +
    "is false\n" +
    "/work/Main.lean:3:15: warning: Variable name `x` is not explicitly referenced.\n" +
    "\n" +
    "The binding can be removed (if unused) or named `_` (if used implicitly).\n" +
    "\n" +
    "Note: This linter can be disabled with `set_option linter.unusedVariables false`\n" +
    "42\n" +
    "/work/Main.lean:5:8: warning: declaration uses `sorry`\n";

  const { diagnostics, truncated } = parseLeanDiagnostics(real);
  assert.equal(truncated, false);
  assert.equal(diagnostics.length, 3);

  assert.equal(diagnostics[0].severity, "error");
  assert.equal(diagnostics[0].line, 2);
  assert.equal(diagnostics[0].column, 30);
  assert.ok(diagnostics[0].message.startsWith("Tactic `decide` proved"));
  assert.ok(diagnostics[0].message.includes("\n  1 + 1 = 3\nis false"), "indentation of the term is kept");

  assert.equal(diagnostics[1].severity, "warning");
  assert.ok(diagnostics[1].message.includes("\n\nThe binding can be removed"), "blank line inside a message is content");

  assert.equal(diagnostics[2].line, 5);
  assert.equal(diagnostics[2].message, "declaration uses `sorry`");

  assert.equal(summarizeLeanDiagnostics(diagnostics, "failed", { exitCode: 1 }), "Lean elaboration failed with 1 error and 2 warnings.");
});

test("summarizeLeanDiagnostics — no diagnostics, checked", () => {
  assert.equal(summarizeLeanDiagnostics([], "checked"), "Lean elaboration completed without errors.");
});

test("summarizeLeanDiagnostics — checked with warnings still reads as success", () => {
  const summary = summarizeLeanDiagnostics([{ severity: "warning" }], "checked");
  assert.ok(summary.includes("without errors"));
  assert.ok(summary.includes("1 warning"));
});

test("summarizeLeanDiagnostics — with errors", () => {
  const diag = [
    { severity: "error", message: "type mismatch" },
    { severity: "warning", message: "unused variable" },
  ];
  const summary = summarizeLeanDiagnostics(diag, "failed");
  assert.ok(summary.includes("1 error"));
  assert.ok(summary.includes("1 warning"));
});

test("summarizeLeanDiagnostics — timeout and cancel are never empty", () => {
  assert.equal(summarizeLeanDiagnostics([], "timeout", { timeoutSec: 30 }), "Lean elaboration exceeded 30s.");
  assert.equal(summarizeLeanDiagnostics([], "cancelled"), "Lean elaboration was cancelled.");
});

test("summarizeLeanDiagnostics — failure without diagnostics names the exit code", () => {
  const summary = summarizeLeanDiagnostics([], "failed", { exitCode: 2 });
  assert.ok(summary.includes("exit 2"));
  assert.notEqual(summary, "");
});

test("detectLeanPlaceholders — clean source", () => {
  const result = detectLeanPlaceholders("theorem t : 1 + 1 = 2 := by decide");
  assert.equal(result.containsPlaceholders, false);
  assert.equal(result.evidence.length, 0);
});

test("detectLeanPlaceholders — sorry detected", () => {
  const result = detectLeanPlaceholders("theorem bad : False := by\n  sorry");
  assert.equal(result.containsPlaceholders, true);
  assert.ok(result.evidence.some((e) => e.keyword === "sorry" && e.line === 2));
});

test("detectLeanPlaceholders — admit detected", () => {
  const result = detectLeanPlaceholders("theorem bad : False := by\n  admit");
  assert.equal(result.containsPlaceholders, true);
  assert.ok(result.evidence.some((e) => e.keyword === "admit"));
});

test("detectLeanPlaceholders — axiom is evidence but not a placeholder", () => {
  const result = detectLeanPlaceholders("axiom myAx : False");
  assert.equal(result.containsPlaceholders, false, "an axiom is an explicit choice, not an unfinished proof");
  assert.ok(result.evidence.some((e) => e.type === "axiom" && e.placeholder === false));
});

test("detectLeanPlaceholders — an axiom next to a sorry does not hide the sorry", () => {
  const result = detectLeanPlaceholders("axiom a : False\ntheorem t : False := by sorry");
  assert.equal(result.containsPlaceholders, true);
  assert.equal(result.evidence.length, 2);
});

test("detectLeanPlaceholders — set_option detected", () => {
  const result = detectLeanPlaceholders("set_option warn.sorry false");
  assert.equal(result.containsPlaceholders, true);
  assert.ok(result.evidence.some((e) => e.type === "option"));
});

test("detectLeanPlaceholders — comment ignored", () => {
  const result = detectLeanPlaceholders("-- sorry is just a comment\ntheorem t : True := by rfl");
  assert.equal(result.containsPlaceholders, false);
});

test("detectLeanPlaceholders — string literal ignored", () => {
  const result = detectLeanPlaceholders('s := "sorry is inside a string"\ntheorem t : True := by rfl');
  assert.equal(result.containsPlaceholders, false);
});

test("detectLeanPlaceholders — nested block comment hides its whole body", () => {
  const src = "/- outer /- inner sorry -/ still comment -/\ntheorem t : True := trivial";
  assert.equal(detectLeanPlaceholders(src).containsPlaceholders, false);
});

test("detectLeanPlaceholders — code after a nested block comment is still scanned", () => {
  const src = "/- /- x -/ -/ theorem t : False := by sorry";
  const result = detectLeanPlaceholders(src);
  assert.equal(result.containsPlaceholders, true, "the scanner must not swallow code past the outer -/");
});

test("detectLeanPlaceholders — a prime in an identifier is not a char literal", () => {
  // With naive char-literal handling everything between the two primes is
  // blanked, which would hide the sorry.
  const src = "theorem t (h' : True) (k' : True) : False := by sorry";
  assert.equal(detectLeanPlaceholders(src).containsPlaceholders, true);
});

test("detectLeanPlaceholders — a real char literal is ignored", () => {
  const src = "def c : Char := 's'\ntheorem t : True := trivial";
  assert.equal(detectLeanPlaceholders(src).containsPlaceholders, false);
});

test("detectLeanPlaceholders — doc comments are block comments", () => {
  const src = "/-- proves nothing, sorry -/\ntheorem t : True := trivial";
  assert.equal(detectLeanPlaceholders(src).containsPlaceholders, false);
});

// --- WP-20 — this module must stay name-only -------------------------------
//
// collectLeanDeclarations answers "which names does this source declare", and
// that is all it is allowed to answer. Teaching it to fingerprint statements
// would recreate the name-only identity bug in a second place: target identity
// belongs to leanTargetIdentity.mjs, which parses the `:= by` boundary rather
// than a declaration head regex.

test("collectLeanDeclarations reports names, not statements", () => {
  const src = [
    "lemma helper : True := trivial",
    "theorem cauchy_mvt (P : Prop) : P → P := by",
    "  intro h",
    "  exact h",
  ].join("\n");
  assert.deepEqual(collectLeanDeclarations(src), ["helper", "cauchy_mvt"]);
});

test("collectLeanDeclarations does not distinguish two statements sharing a name", () => {
  // Precisely the case it must NOT be trusted for — and the reason the module
  // is deliberately not extended.
  const a = collectLeanDeclarations("theorem t : 1 + 1 = 2 := by decide");
  const b = collectLeanDeclarations("theorem t : True := by trivial");
  assert.deepEqual(a, b);
});

test("leanDiagnostics exposes no statement fingerprinting", () => {
  const exported = Object.keys(diagnostics).sort();
  assert.deepEqual(exported, [
    "collectLeanDeclarations",
    "detectLeanPlaceholders",
    "parseLeanDiagnostics",
    "summarizeLeanDiagnostics",
  ]);
});
