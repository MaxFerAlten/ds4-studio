import test from "node:test";
import assert from "node:assert/strict";

import {
  assertNoUnicodeReplacementCharacter,
  containsReplacementCharacter,
  decodeStrictUtf8,
  strictUtf8Decoder
} from "./utf8Integrity.mjs";

// APPENDICE D regression sentinel: 2-, 3- and 4-byte sequences, the Lean
// notation and the Italian accents observed corrupted in the transcript.
const SENTINEL =
  "ℝ → ← ↔ ∀ ∃ ∈ ∉ ⊆ ∧ ∨ ¬ λ α β γ ≤ ≥ ≠ × ∘ ⟨ ⟩\n" +
  "à è ì ò ù é ² ³ ✓ 🚩\n" +
  "variable (f g : ℝ → ℝ) {a b : ℝ}\n";

test("Lean notation is not mistaken for corruption", () => {
  assert.equal(containsReplacementCharacter(SENTINEL), false);
  assert.doesNotThrow(() =>
    assertNoUnicodeReplacementCharacter(SENTINEL, "sentinel")
  );
});

test("U+FFFD is detected, never repaired", () => {
  const corrupted = "variable (f g : ��� ��� ���)";
  assert.equal(containsReplacementCharacter(corrupted), true);
  assert.throws(
    () => assertNoUnicodeReplacementCharacter(corrupted, "lean source retention"),
    (err) =>
      err.code === "DS4_UTF8_REPLACEMENT_CHARACTER" &&
      /lean source retention/.test(err.message)
  );
  // Detection only: the input is not rewritten into a guess.
  assert.equal(corrupted, "variable (f g : ��� ��� ���)");
});

test("empty and nullish inputs are not corruption", () => {
  assert.equal(containsReplacementCharacter(""), false);
  assert.equal(containsReplacementCharacter(null), false);
  assert.equal(containsReplacementCharacter(undefined), false);
});

test("strict decoder round-trips the sentinel", () => {
  const bytes = Buffer.from(SENTINEL, "utf8");
  const result = decodeStrictUtf8(bytes);
  assert.equal(result.ok, true);
  assert.equal(result.text, SENTINEL);
});

test("strict decoder fails closed on invalid bytes instead of yielding U+FFFD", () => {
  // First two bytes of ℝ with the tail lost — exactly what a per-byte publish
  // used to put on the wire.
  const truncated = Buffer.from([0xe2, 0x84]);
  const result = decodeStrictUtf8(truncated);
  assert.equal(result.ok, false);
  assert.equal(result.code, "DS4_UTF8_INVALID_STREAM");

  // The lenient decoder is what produced the corrupted transcript.
  assert.equal(new TextDecoder().decode(truncated).includes("�"), true);
});

test("strict decoder rejects surrogates and overlong forms", () => {
  for (const bytes of [
    [0x80],
    [0xc0, 0xaf],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80]
  ]) {
    assert.equal(decodeStrictUtf8(Buffer.from(bytes)).ok, false);
  }
});

test("strictUtf8Decoder is fatal", () => {
  assert.throws(() => strictUtf8Decoder().decode(Buffer.from([0xe2, 0x84])));
});

test("a byte stream split mid-code-point still decodes when framed correctly", () => {
  // §103/§130 — the network may split anywhere; TextDecoder({stream:true})
  // must reassemble. This is the frontend-side counterpart of the C framing.
  const bytes = Buffer.from(SENTINEL, "utf8");
  for (const chunk of [1, 2, 3, 5, 7, 64]) {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let out = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      out += decoder.decode(bytes.subarray(i, Math.min(i + chunk, bytes.length)), {
        stream: true
      });
    }
    out += decoder.decode();
    assert.equal(out, SENTINEL, `chunk size ${chunk}`);
    assert.equal(out.includes("�"), false);
  }
});
