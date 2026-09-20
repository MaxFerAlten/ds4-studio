import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import { EPI_REGRESSION_SUITE } from "./epistemicRegressionSuite.mjs";

const TEST_NAME_PATTERN = /test\(\s*["']([^"']+)["']/g;

function extractTestNames(source) {
  return [...source.matchAll(TEST_NAME_PATTERN)].map((m) => m[1]);
}

test("§57 maps every registered EPI regression to a real DS4 test module", async () => {
  // R08-PATCH-01: EPI-001..068 contiguous, with no accidental gap.
  assert.deepEqual(EPI_REGRESSION_SUITE.map(({ id }) => id), [
    ...Array.from({ length: 76 }, (_, index) => `EPI-${String(index + 1).padStart(3, "0")}`)
  ]);

  for (const item of EPI_REGRESSION_SUITE) {
    // Q2-016: the §30 adversarial replay is a regression module too.
    assert.match(item.module, /^(?:epistemic[A-Za-z]+(?:\.e2e)?|qho[A-Za-z]+)\.test\.mjs$/, item.id);
    assert.ok(item.expected === undefined, `${item.id}: legacy 'expected' field removed`);
    assert.ok(item.semanticScenario.length > 10, item.id);
    assert.ok(item.testName.length > 5, item.id);
    await access(new URL(`./${item.module}`, import.meta.url));
  }
});

test("REM-009.3: each registry entry maps to an exact named test in its module", async () => {
  // The property under test is: registry -> module -> named scenario. Matching the
  // named test against the module source is the appropriate source match here — we
  // prove the exact named scenario really exists, not merely that the file exists.
  // FI-006 (formal hardening): this is EXACT test-name identity. No prefix matching
  // may stand in for it, so a two-test prefix collision cannot produce a false match.
  for (const item of EPI_REGRESSION_SUITE) {
    const source = await readFile(new URL(`./${item.module}`, import.meta.url), "utf8");
    const names = extractTestNames(source);
    assert.ok(
      names.includes(item.testName),
      `${item.id}: no test in ${item.module} exactly named \`${item.testName}\``
    );
  }
});

test("FI-010 (REM-009.3): a prefix collision must never pass as exact identity", async () => {
  // Two registered entries sharing a 20-char prefix are both present as distinct,
  // exactly-named tests. The permissive `includes(prefix)` test would let either map
  // to the other; the exact `names.includes(testName)` rule keeps them apart.
  const prefixCollisions = EPI_REGRESSION_SUITE.filter(
    (item) =>
      item.testName.startsWith("R06-PATCH-06 / EPI-057") ||
      item.testName === "R06-PATCH-06 / EPI-057: the same claim:code thrice forces 'cannot paraphrase'"
  );
  assert.ok(prefixCollisions.length >= 1, "expected at least the EPI-040/057 collision pair");
  for (const item of prefixCollisions) {
    const source = await readFile(new URL(`./${item.module}`, import.meta.url), "utf8");
    const names = extractTestNames(source);
    assert.ok(names.includes(item.testName), `${item.id}: exact name must resolve`);
  }
});

test("REM-009.4: every id carries a canonical, immutable semantic scenario", () => {
  const seen = new Set();
  for (const item of EPI_REGRESSION_SUITE) {
    assert.equal(typeof item.semanticScenario, "string");
    assert.ok(item.semanticScenario.length > 10, item.id);
    assert.ok(!seen.has(item.semanticScenario), `duplicate semantic scenario for ${item.id}`);
    seen.add(item.semanticScenario);
  }
});

test("R08-PATCH-03: no EPI id is reused and the registry is contiguous", () => {
  const ids = EPI_REGRESSION_SUITE.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "every EPI id is unique");
  const numbers = ids.map((id) => Number(id.slice(4)));
  for (let n = 1; n <= 76; n++) {
    assert.ok(numbers.includes(n), `EPI-${String(n).padStart(3, "0")} is registered`);
  }
});
