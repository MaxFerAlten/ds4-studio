import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSearchQuery,
  validateSearchQuery
} from "./searchQueryGuard.mjs";

test("normalizeSearchQuery trims quotes and whitespace", () => {
  assert.equal(
    normalizeSearchQuery("  `top AI conferences 2025`  "),
    "top AI conferences 2025"
  );
});

test("validateSearchQuery accepts clean task queries", () => {
  for (const q of [
    "top AI conferences 2025",
    "best journals for artificial intelligence research",
    "QS World University Rankings 2026",
    "universities with acceptance rate above 50 percent 2025 list",
    "AI conference ranking CORE 2025"
  ]) {
    assert.equal(validateSearchQuery(q).ok, true, q);
  }
});

test("validateSearchQuery rejects reasoning and assistant metatext", () => {
  for (const q of [
    "L'utente ha scritto si quindi devo cercare conferenze AI",
    "We need to understand what the user is asking",
    "Given the ambiguity, I think the user wants either",
    "Rispondi SOLO con la query finale",
    "Tuttavia, il sistema dovrebbe cercare altro",
    "La query migliore potrebbe essere top AI conferences"
  ]) {
    const result = validateSearchQuery(q);
    assert.equal(result.ok, false, q);
    assert.match(result.reason, /reasoning|metatext|long/i);
  }
});

test("validateSearchQuery rejects empty and non-searchable queries", () => {
  assert.equal(validateSearchQuery("").ok, false);
  assert.equal(validateSearchQuery("   ").ok, false);
  assert.equal(validateSearchQuery("???").ok, false);
});
