// auditQuantiumCertificate.test.mjs — FI-015 / FI-024 / FI-025.
//
// The auditor consumes a certificate and recomputes its derived quantities. Each
// test tampers with exactly one field of an otherwise valid certificate and
// asserts AUDIT=FAIL: a certificate can never claim more than its raw counters
// prove (§2, Claim <= Evidence).

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { auditCertificate, recomputeCertificateSha256 } from "./auditQuantiumCertificate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(HERE, "auditQuantiumCertificate.mjs");

/** A structurally valid dev certificate: every claim backed by its own counters. */
function benignCertificate(overrides = {}) {
  const cert = {
    schema: "ds4_quantium_certificate_v2",
    verdict: "CERTIFIED_DEV",
    timestamp: "2026-08-30T00:00:00.000Z",
    oid: "QuantiumCert-0000000000000000",
    provenance: {
      mode: "dev",
      dirty: true,
      allowDirty: true,
      gitHead: "f".repeat(40),
      gitBranch: "fix/lean-integration-remediation",
      diffSha256: "d".repeat(64),
      withNative: false
    },
    totals: { total: 388, passed: 388, failed: 0, skipped: 0 },
    scopes: [
      { name: "epistemic_unit", ok: true, total: 300, pass: 300, fail: 0, skipped: 0 },
      { name: "qho_replay", ok: true, total: 88, pass: 88, fail: 0, skipped: 0 }
    ],
    native: [],
    nativeIncluded: false,
    metrics: {
      escapeRate: 0,
      generatedHighSeverity: 6,
      publishedHighSeverity: 0,
      jsCandidateBytesBeforeGate: 0,
      jsNoByteLeak: true,
      registryRange: "001..068",
      epiManifestSha256: "a".repeat(64),
      epiManifestCount: 68,
      epiManifestRange: "EPI-001..EPI-068"
    },
    jsLeak: {
      blockedCases: 6,
      textBytesBeforeGate: 0,
      reasoningBytesBeforeGate: 0,
      totalBytesBeforeGate: 0
    },
    qhoReplay: { broadBlocked: true, narrowAllowed: true },
    // Q2-019 (§34, §72) — the QHO→LLM adversarial closure and its six rates.
    qhoLlmReplay: {
      adversarialIncluded: true,
      adversarialBlocked: true,
      safeRepairAllowed: true,
      universalCoverageBlocked: true
    },
    strictMetrics: {
      strictVerificationContract: {
        present: true,
        coverageMode: "ALL_ASSERTIVE_CLAIMS",
        assertiveClaims: 1,
        satisfiedClaims: 1,
        vccr: 1
      },
      formalArtifacts: { verifiedRendered: 2, unboundVerifiedRendered: 0, ufar: 0 },
      crossDomain: { claims: 3, bridgeEscapes: 0, cber: 0 },
      bibliography: { certifiedIdentityClaims: 1, identityEscapes: 0, bier: 0 },
      analogies: { published: 2, promotedToFact: 0, aper: 0 },
      synthesis: { summaryClaims: 1, overclaims: 0, sor: 0 },
      nonVacuous: true,
      allTargetsMet: true
    },
    ...overrides
  };
  return cert;
}

function nativeCertificate(metricOverrides = {}) {
  const cert = benignCertificate({
    verdict: "CERTIFIED_RELEASE",
    provenance: {
      mode: "release",
      dirty: false,
      allowDirty: false,
      gitHead: "f".repeat(40),
      gitBranch: "main",
      diffSha256: null,
      withNative: true
    },
    nativeIncluded: true
  });
  cert.native = [
    {
      name: "native_agent_epistemic_test",
      build: {
        built: true,
        binaryExists: true,
        binarySha256: "b".repeat(64),
        sources: ["tests/ds4_agent_epistemic_test.c"],
        sourceSha256: "c".repeat(64),
        buildExit: 0
      },
      metrics: {
        blockedCases: 7,
        adversarialCases: 7,
        candidateTextBytesBeforeVerdict: 0,
        candidateReasoningBytesBeforeVerdict: 0,
        candidateBytesBeforeVerdict: 0,
        ...metricOverrides
      },
      probeOk: true,
      ok: true
    }
  ];
  return cert;
}

test("FI-024: a benign dev certificate audits PASS", () => {
  const result = auditCertificate(benignCertificate());
  assert.deepEqual(result.failures, []);
  assert.equal(result.verdict, "PASS");
  assert.ok(result.checks.length > 0, "the audit actually recomputed something");
});

test("FI-024: a benign release certificate with native evidence audits PASS", () => {
  const result = auditCertificate(nativeCertificate());
  assert.deepEqual(result.failures, []);
  assert.equal(result.verdict, "PASS");
});

// §21 — the plan's named tampering vector.
test("FI-025: tampering HS_PUBLISHED 0 -> 1 makes the audit FAIL", () => {
  const cert = benignCertificate();
  cert.metrics.publishedHighSeverity = 1;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(
    result.failures.some((f) => f.check === "hser_recompute" || f.check === "hser_zero"),
    `expected an HSER failure, got ${JSON.stringify(result.failures)}`
  );
});

test("FI-025: a vacuous HS denominator cannot certify", () => {
  const cert = benignCertificate();
  cert.metrics.generatedHighSeverity = 0;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "hser_denominator"));
});

test("FI-025: JS totals that are not text + reasoning make the audit FAIL", () => {
  const cert = benignCertificate();
  cert.jsLeak.textBytesBeforeGate = 5;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "js_bytes_sum"));
});

test("FI-025: one pre-gate reasoning byte cannot be certified", () => {
  const cert = benignCertificate();
  cert.jsLeak.reasoningBytesBeforeGate = 1;
  cert.jsLeak.totalBytesBeforeGate = 1;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "js_no_byte_leak"));
});

test("FI-025: an empty JS blocked corpus makes zero bytes vacuous", () => {
  const cert = benignCertificate();
  cert.jsLeak.blockedCases = 0;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "js_non_vacuous"));
});

// FI-015 (§15/§26) — a dirty dev tree is only identified by HEAD + Diff(hash).
test("FI-015: a dirty dev certificate without a diff hash is rejected", () => {
  const cert = benignCertificate();
  cert.provenance.diffSha256 = null;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "dev_diff_hash"));
});

test("FI-014: a dirty tree can never audit as CERTIFIED_RELEASE", () => {
  const cert = nativeCertificate();
  cert.provenance.dirty = true;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "release_clean_tree"));
});

test("FI-014: CERTIFIED_RELEASE under dev provenance is rejected", () => {
  const cert = benignCertificate({ verdict: "CERTIFIED_RELEASE" });
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "mode_verdict"));
});

test("FI-018: a native binary that was not rebuilt from hashed source is rejected", () => {
  const cert = nativeCertificate();
  cert.native[0].build.sourceSha256 = null;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "native_fresh"));
});

test("FI-006: a single native pre-verdict byte is detected", () => {
  const cert = nativeCertificate({ candidateTextBytesBeforeVerdict: 1, candidateBytesBeforeVerdict: 1 });
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "native_no_byte_leak"));
});

test("FI-005: an unknown native byte counter is NOT_CERTIFIED, never a default zero", () => {
  const cert = nativeCertificate();
  delete cert.native[0].metrics.candidateBytesBeforeVerdict;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "native_bytes_present"));
});

test("FI-019/020: a missing QHO replay outcome cannot be certified", () => {
  const cert = benignCertificate();
  cert.qhoReplay = { broadBlocked: true, narrowAllowed: false };
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "qho_narrow_allowed"));
});

test("FI-025: a tampered certificate self-hash is detected", () => {
  const cert = benignCertificate();
  cert.certificateSha256 = recomputeCertificateSha256(cert);
  assert.equal(auditCertificate(cert).verdict, "PASS");
  cert.totals.passed = 999;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "certificate_hash"));
});

test("FI-025: an unknown verdict word is rejected", () => {
  const result = auditCertificate(benignCertificate({ verdict: "CERTIFIED" }));
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "verdict_vocabulary"));
});

// The CLI is the audit replay a reviewer actually runs (§42).
test("FI-024/025: the CLI exits 0 on PASS and 1 on a tampered certificate", () => {
  const dir = mkdtempSync(join(tmpdir(), "quant-audit-"));
  try {
    const good = join(dir, "quantium-certificate.json");
    const cert = benignCertificate();
    cert.certificateSha256 = recomputeCertificateSha256(cert);
    writeFileSync(good, JSON.stringify(cert, null, 2) + "\n");
    const okRun = spawnSync(process.execPath, [AUDIT, good], { encoding: "utf8" });
    assert.match(okRun.stdout, /AUDIT=PASS/);
    assert.equal(okRun.status, 0);

    const bad = join(dir, "tampered.json");
    const tampered = JSON.parse(JSON.stringify(cert));
    tampered.metrics.publishedHighSeverity = 1;
    writeFileSync(bad, JSON.stringify(tampered, null, 2) + "\n");
    const failRun = spawnSync(process.execPath, [AUDIT, bad], { encoding: "utf8" });
    assert.match(failRun.stdout, /AUDIT=FAIL/);
    assert.equal(failRun.status, 1);

    const missing = spawnSync(process.execPath, [AUDIT, join(dir, "nope.json")], { encoding: "utf8" });
    assert.match(missing.stdout, /AUDIT=FAIL/);
    assert.equal(missing.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Q2-019 (§34, §58) — the new counters must be as tamper-evident as the old ones.
test("Q2-019: a certificate that never ran the adversarial replay cannot be CERTIFIED", () => {
  const cert = benignCertificate();
  cert.qhoLlmReplay.adversarialBlocked = false;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "qho_llm_replay"));
});

test("Q2-019: a safe repair that did not publish cannot be CERTIFIED", () => {
  const cert = benignCertificate();
  cert.qhoLlmReplay.safeRepairAllowed = false;
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "qho_llm_replay"));
});

test("Q2-019 (§58): a zero escape rate over an empty denominator is refused", () => {
  const cert = benignCertificate();
  cert.strictMetrics.crossDomain = { claims: 0, bridgeEscapes: 0, cber: 0 };
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "strict_metrics_denominator"));
});

test("Q2-019 (§33): a rate that does not match its own counters is refused", () => {
  const cert = benignCertificate();
  cert.strictMetrics.formalArtifacts = { verifiedRendered: 2, unboundVerifiedRendered: 1, ufar: 0 };
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "strict_metrics_recompute"));
});

test("Q2-019 (§55): VCCR below 1 cannot be CERTIFIED", () => {
  const cert = benignCertificate();
  cert.strictMetrics.strictVerificationContract = {
    present: true,
    coverageMode: "ALL_ASSERTIVE_CLAIMS",
    assertiveClaims: 1000,
    satisfiedClaims: 999,
    vccr: 0.999
  };
  const result = auditCertificate(cert);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.failures.some((f) => f.check === "strict_metrics_target"));
});
