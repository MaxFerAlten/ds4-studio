// UTF8-001 §45/§129/§180 — presentation integrity primitives.
//
// Two distinct checks are needed and neither replaces the other:
//
//   validUtf8(bytes)      catches invalid bytes before a decoder sees them
//   containsUfffd(text)   catches corruption that already happened upstream
//
// None of these repair anything. U+FFFD is information already lost: three
// replacement characters could have been ℝ, →, ∃, ∈, ✓ or €, so guessing the
// original would silently rewrite a source presented to the user as verified.

export const UNICODE_REPLACEMENT_CHARACTER = "�";

/** True when the text carries at least one U+FFFD. */
export function containsReplacementCharacter(text) {
  if (text === null || text === undefined) return false;
  return String(text).includes(UNICODE_REPLACEMENT_CHARACTER);
}

/**
 * Throw if the text carries U+FFFD. Detection only — never repair.
 * @param {string} text
 * @param {string} context - where the check ran, for the error message
 */
export function assertNoUnicodeReplacementCharacter(text, context) {
  if (!containsReplacementCharacter(text)) return;
  const error = new Error(
    `${context}: Unicode replacement character U+FFFD detected`
  );
  error.code = "DS4_UTF8_REPLACEMENT_CHARACTER";
  throw error;
}

/**
 * Decoder that fails instead of substituting U+FFFD. Use on certification and
 * Lean authoritative paths, where a silently rewritten glyph is worse than a
 * visible error.
 */
export function strictUtf8Decoder() {
  return new TextDecoder("utf-8", { fatal: true });
}

/**
 * Strict decode of raw bytes.
 * @returns {{ ok: true, text: string } | { ok: false, code: string, message: string }}
 */
export function decodeStrictUtf8(bytes) {
  try {
    const text = strictUtf8Decoder().decode(bytes);
    if (containsReplacementCharacter(text)) {
      return {
        ok: false,
        code: "DS4_UTF8_REPLACEMENT_CHARACTER",
        message: "decoded text contains U+FFFD"
      };
    }
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      code: "DS4_UTF8_INVALID_STREAM",
      message: err?.message || "invalid UTF-8"
    };
  }
}
