import { buildGitnexusPolicy } from "./agentGitnexusPolicy.mjs";

test("buildGitnexusPolicy returns empty string when disabled", () => {
  const result = buildGitnexusPolicy(false);
  assert.equal(result, "");
});

test("buildGitnexusPolicy returns policy text when enabled", () => {
  const result = buildGitnexusPolicy(true);
  assert.ok(result.startsWith("## GitNexus mandatory impact analysis"));
  assert.ok(result.includes("gitnexus_impact"));
  assert.ok(result.includes("gitnexus_detect_changes"));
  assert.ok(result.includes("Never skip GitNexus analysis"));
});

test("buildGitnexusPolicy handles undefined gracefully", () => {
  const result = buildGitnexusPolicy(undefined);
  assert.equal(result, "");
});

test("buildGitnexusPolicy handles null gracefully", () => {
  const result = buildGitnexusPolicy(null);
  assert.equal(result, "");
});
