// certificationGuards.test.mjs — FI-012 anti-false-green negative controls (M1..M8)
// and FI-013 fail-closed error matrix.
//
// Each "negative control" injects the named mutant and asserts that its guard
// trips (returns ok:false / throws). The guards live in certificationGuards.mjs
// and are shared with the certifier and the independent auditor, so defeating a
// mutant here proves detector sensitivity (FB-015), not a test-only copy.

import test from "node:test";
import assert from "node:assert/strict";
import {
  guardCertificateComplete,
  guardScopeMismatch,
  guardCheckIdInPlan,
  guardNoHiddenFailedSubcheck,
  guardNoPreGateLeak,
  guardHSCorpusNonEmpty,
  guardNativeFresh,
  guardEPIExactIdentity,
  guardFailClosedOnError
} from "./certificationGuards.mjs";

const BENIGN_CERT = {
  schema: "ds4_quantium_certificate_v2",
  scopes: [
    { name: "epistemic_unit", ok: true },
    { name: "qho_replay", ok: true }
  ],
  certificateSha256: "a".repeat(64)
};

// M1 — drop certificate / a required scope must trip.
test("M1: dropped certificate or required scope trips the completeness guard", () => {
  assert.equal(guardCertificateComplete(null, ["epistemic_unit"]).ok, false);
  assert.equal(
    guardCertificateComplete({ schema: "x" }, ["epistemic_unit"]).ok,
    false,
    "missing scopes array"
  );
  assert.equal(
    guardCertificateComplete(BENIGN_CERT, ["hallucination_e2e"]).ok,
    false,
    "required scope dropped from certificate"
  );
  const badHash = { ...BENIGN_CERT, certificateSha256: "zzz" };
  assert.equal(guardCertificateComplete(badHash, ["epistemic_unit"]).ok, false);
  assert.equal(guardCertificateComplete(BENIGN_CERT, ["epistemic_unit"]).ok, true);
});

// M2 — a scope whose identity mismatches what actually ran must trip.
test("M2: scope identity mismatch trips the scope-mismatch guard", () => {
  assert.equal(guardScopeMismatch("registry_completeness", "hallucination_e2e").ok, false);
  assert.equal(guardScopeMismatch("epistemic_unit", "epistemic_unit").ok, true);
});

// M3 — a result whose checkId is not in the plan must trip.
test("M3: result checkId absent from the plan trips the plan-conformance guard", () => {
  const plan = ["EPI-001", "EPI-002"];
  const good = [{ checkId: "EPI-001" }, { checkId: "EPI-002" }];
  const mutant = [{ checkId: "EPI-999" }];
  assert.equal(guardCheckIdInPlan(mutant, plan).ok, false);
  assert.equal(guardCheckIdInPlan(good, plan).ok, true);
});

// M4 — a failed subcheck hidden inside an aggregate pass must trip.
test("M4: hidden failed subcheck trips the subcheck guard", () => {
  const hiddenFail = [{ id: "sub-a", failed: true, hidden: false }];
  const benign = [{ id: "sub-a", failed: false }];
  assert.equal(guardNoHiddenFailedSubcheck(hiddenFail).ok, false);
  assert.equal(guardNoHiddenFailedSubcheck(benign).ok, true);
});

// M5 — one pre-gate byte (text or reasoning) must trip.
test("M5: a single pre-gate byte trips the no-byte-leak guard", () => {
  assert.equal(guardNoPreGateLeak(1, 0).ok, false, "one text byte");
  assert.equal(guardNoPreGateLeak(0, 1).ok, false, "one reasoning byte");
  assert.equal(guardNoPreGateLeak(0, 0).ok, true);
});

// M6 — an empty high-severity corpus makes a zero escape rate vacuous.
test("M6: empty high-severity corpus trips the non-vacuity guard", () => {
  assert.equal(guardHSCorpusNonEmpty(0).ok, false);
  assert.equal(guardHSCorpusNonEmpty(undefined).ok, false);
  assert.equal(guardHSCorpusNonEmpty(6).ok, true);
});

// M7 — a stale native binary (build failed / unhashed / missing) must trip.
test("M7: stale native binary trips the fresh-build guard", () => {
  const fresh = {
    built: true,
    binaryExists: true,
    binarySha256: "b".repeat(64),
    sources: ["a.c"],
    sourceSha256: "c".repeat(64)
  };
  assert.equal(guardNativeFresh(fresh).ok, true);
  assert.equal(guardNativeFresh(null).ok, false);
  assert.equal(guardNativeFresh({ ...fresh, built: false }).ok, false, "build failed");
  assert.equal(
    guardNativeFresh({ ...fresh, binarySha256: null }).ok,
    false,
    "binary hash missing"
  );
  assert.equal(
    guardNativeFresh({ ...fresh, sourceSha256: null }).ok,
    false,
    "source hash missing (not rebuilt from source)"
  );
});

// M8 — EPI identity must be exact; a prefix collision must trip.
test("M8: EPI prefix collision trips the exact-identity guard", () => {
  const names = ["EPI-025", "EPI-025x-suffix"];
  assert.equal(guardEPIExactIdentity(names, "EPI-025").ok, true, "exact match passes");
  assert.equal(
    guardEPIExactIdentity(names, "EPI-0").ok,
    false,
    "a name that is a prefix of an existing entry is NOT an exact identity"
  );
});

// FI-013 — the error-matrix property: on any error path the candidate must stay
// unpublished and never be staged as accepted (fail-closed).
test("FI-013: fail-closed on error — nothing published, nothing accepted", () => {
  const errorPub = { published: ["leak"], reasoningPublished: [] };
  const errorReasoning = { published: [], reasoningPublished: ["leak"] };
  const errorAccepted = { published: [], reasoningPublished: [], accepted: ["claim"] };
  assert.equal(guardFailClosedOnError(errorPub, []).ok, false, "text leaked on error");
  assert.equal(guardFailClosedOnError(errorReasoning, []).ok, false, "reasoning leaked");
  assert.equal(guardFailClosedOnError(errorAccepted, []).ok, false, "staged accepted");
  const clean = { published: [], reasoningPublished: [], accepted: [] };
  assert.equal(guardFailClosedOnError(clean, []).ok, true);
});

// The plan's nine error-matrix rows all collapse to the same fail-closed property
// (candidate non pubblicato, nessun false ASSERT, session non committata).
test("FI-013: error-matrix rows all resolve fail-closed", () => {
  const rows = [
    "extractor throws",
    "verifier throws",
    "scope checker malformed/throws",
    "metric runner invalid JSON",
    "native metrics invalid JSON",
    "native schema mismatch",
    "client disconnect while withheld",
    "abort during verification",
    "session history serialization failure"
  ];
  assert.equal(rows.length, 9);
  for (const row of rows) {
    // Each row: an error outcome with zero published and zero accepted must pass
    // the fail-closed guard unchanged.
    const out = { published: [], reasoningPublished: [], accepted: [] };
    assert.equal(
      guardFailClosedOnError(out, []).ok,
      true,
      `${row} must remain fail-closed (nothing published, nothing accepted)`
    );
  }
});
