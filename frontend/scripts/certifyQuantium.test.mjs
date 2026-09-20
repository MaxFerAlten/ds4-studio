import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CERT = join(HERE, "certifyQuantium.mjs");

// Certificate artifacts go to a scratch dir unless a test asks for its own: a test
// run must not rewrite the repository's own certificate artifacts.
const SCRATCH = mkdtempSync(join(tmpdir(), "quant-cert-run-"));
process.on("exit", () => rmSync(SCRATCH, { recursive: true, force: true }));

function runCert(extra = []) {
  const dir = extra.some((a) => a.startsWith("--cert-dir=")) ? [] : [`--cert-dir=${SCRATCH}`];
  return spawnSync(process.execPath, [CERT, "--allow-dirty", ...dir, ...extra], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 300_000
  });
}

// REM-011.5 / CERT-NATIVE-001 — --with-native adds the native invocations and is
// never silently ignored: on a box without the native binaries the verdict must be
// NOT_CERTIFIED (the flag refuses to pass rather than pretend the native scope ran).
test("CERT-NATIVE-001: --with-native adds native invocations", () => {
  const withFlag = runCert(["--with-native"]);
  assert.match(withFlag.stdout, /NATIVE_INCLUDED=true/);
  assert.match(withFlag.stdout, /native_ds4_agent_test/);
  assert.match(withFlag.stdout, /native_agent_runtime_skill_test/);
  if (!existsSync(join(ROOT, "ds4_agent_test"))) {
    assert.match(withFlag.stdout, /VERDICT=NOT_CERTIFIED/);
    assert.notEqual(withFlag.status, 0);
  } else {
    // build-then-run (FI-002) must not fail the build step on a healthy tree
    assert.doesNotMatch(withFlag.stdout, /\[fail\] native_build_/);
  }
});

// Without the flag no native scope is exercised.
test("CERT-NATIVE-002: no --with-native implies NATIVE_INCLUDED=false", () => {
  const noFlag = runCert();
  assert.match(noFlag.stdout, /NATIVE_INCLUDED=false/);
  assert.doesNotMatch(noFlag.stdout, /native_ds4_agent_test/);
});

// FI-001 — the epistemic native target is part of the native set.
test("FI-001: --with-native includes the epistemic native target", () => {
  const withFlag = runCert(["--with-native"]);
  assert.match(withFlag.stdout, /native_agent_epistemic_test/);
});

// FI-003 — the epistemic native target emits machine-readable metrics and the
// certifier parses them (bytes-before-verdict zero with non-vacuous substance).
test("FI-003: epistemic native metrics are parsed and non-vacuous", () => {
  const withFlag = runCert(["--with-native"]);
  const jsonLine = withFlag.stdout.split("\n").find((l) => l.startsWith("CERTIFICATE_JSON="));
  if (jsonLine) {
    const cert = JSON.parse(jsonLine.slice("CERTIFICATE_JSON=".length));
    const epi = cert.native.find((n) => n.metrics);
    if (epi) {
      assert.equal(epi.metrics.candidateBytesBeforeVerdict, 0);
      assert.equal(epi.metrics.blockedCases, epi.metrics.adversarialCases);
      assert.equal(epi.metrics.adversarialBlocked, true);
      assert.equal(epi.metrics.publishedCleanAfterVerdict, true);
      assert.ok(Number(epi.metrics.publishedCleanBytesAfterVerdict) > 0, "clean candidate published");
      assert.equal(epi.probeOk, true);
    }
  } else {
    // Box without native binaries: still must not claim CERTIFIED for native.
    assert.match(withFlag.stdout, /VERDICT=NOT_CERTIFIED/);
  }
});

// FI-008 — non-vacuity field: EPI_MANIFEST_SHA256 must be a 64-hex hash, and the
// machine certificate must carry it.
test("FI-008: EPI manifest hash is present and well-formed", () => {
  const res = runCert();
  const m = /EPI_MANIFEST_SHA256=([0-9a-f]{64})/.exec(res.stdout);
  assert.ok(m, `expected 64-hex manifest hash, got: ${res.stdout}`);
  const jsonLine = res.stdout.split("\n").find((l) => l.startsWith("CERTIFICATE_JSON="));
  assert.ok(jsonLine);
  const cert = JSON.parse(jsonLine.slice("CERTIFICATE_JSON=".length));
  assert.equal(cert.metrics.epiManifestSha256, m[1]);
});

// FI-010/011 — a machine-readable certificate JSON and markdown are written with
// artifact hashes and a self-hash that is stable across the same run.
test("FI-010/011: certificate JSON + markdown artifacts are written", () => {
  const dir = mkdtempSync(join(tmpdir(), "quant-cert-"));
  const res = runCert([`--cert-dir=${dir}`]);
  const jsonPath = join(dir, "quantium-certificate.json");
  const mdPath = join(dir, "quantium-certificate.md");
  assert.equal(res.status, 0);
  assert.ok(existsSync(jsonPath), "certificate JSON written");
  assert.ok(existsSync(mdPath), "certificate markdown written");
  const cert = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(cert.schema, "ds4_quantium_certificate_v2");
  assert.match(cert.certificateSha256, /^[0-9a-f]{64}$/);
  const manifestPath = join(dir, "quantium-certificate.manifest.json");
  assert.ok(existsSync(manifestPath), "certificate manifest written");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.match(manifest.certificateSha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.artifactJsonSha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.artifactMdSha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.manifestSha256, /^[0-9a-f]{64}$/);
  assert.match(readFileSync(mdPath, "utf8"), /# Quantium Certification/);
  rmSync(dir, { recursive: true, force: true });
});

// FI-009 — --mode=release requires a clean tree, and a release verdict is never
// minted without the native scope (§22): CERTIFIED_RELEASE is the only verdict
// that may claim binary provenance, so it must never appear here.
test("FI-009: release mode requires a clean tree and native evidence", () => {
  const res = spawnSync(process.execPath, [CERT, "--mode=release"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300_000
  });
  assert.match(res.stdout, /MODE=release/);
  assert.doesNotMatch(res.stdout, /VERDICT=CERTIFIED_RELEASE/);
  assert.notEqual(res.status, 0);
  if (gitIsDirty()) {
    assert.match(res.stdout, /VERDICT=NOT_CERTIFIED/);
    assert.match(res.stdout, /phase=dirty_tree/);
  }
});

// FI-013 — graded verdict vocabulary. The bare word CERTIFIED is no longer a
// verdict: a dev run says CERTIFIED_DEV, and only a clean+native run may say
// CERTIFIED_RELEASE.
test("FI-013: dev provenance yields CERTIFIED_DEV, never a bare CERTIFIED", () => {
  const res = runCert();
  const m = /^VERDICT=(.+)$/m.exec(res.stdout);
  assert.ok(m, `no verdict line in: ${res.stdout}`);
  assert.ok(
    ["CERTIFIED_DEV", "NOT_CERTIFIED"].includes(m[1]),
    `dev run must not claim ${m[1]}`
  );
  assert.match(res.stdout, /MODE=dev/);
  if (m[1] === "CERTIFIED_DEV") assert.equal(res.status, 0);
});

// FI-015 — the certifier embeds an independent audit of its own certificate and
// downgrades the verdict when the audit fails (fail-closed).
test("FI-015: the certificate carries an independent audit result", () => {
  const res = runCert();
  assert.match(res.stdout, /INDEPENDENT_AUDIT=(PASS|FAIL)/);
  const jsonLine = res.stdout.split("\n").find((l) => l.startsWith("CERTIFICATE_JSON="));
  assert.ok(jsonLine);
  const cert = JSON.parse(jsonLine.slice("CERTIFICATE_JSON=".length));
  assert.ok(cert.audit.checks > 0, "the audit recomputed at least one quantity");
  if (cert.verdict !== "NOT_CERTIFIED") {
    assert.equal(cert.audit.verdict, "PASS");
    assert.deepEqual(cert.audit.failures, []);
  }
});

// §43 — the human report must carry the split byte metrics and the QHO replay
// outcomes, not a single aggregate number.
test("FI-005/§43: the report carries split JS bytes and QHO replay outcomes", () => {
  const res = runCert();
  for (const key of [
    "JS_BLOCKED_CASES",
    "JS_TEXT_BYTES_BEFORE_GATE",
    "JS_REASONING_BYTES_BEFORE_GATE",
    "JS_CANDIDATE_BYTES_BEFORE_GATE",
    "QHO_BROAD_BLOCKED",
    "QHO_NARROW_ALLOWED",
    "SOURCE_DIRTY",
    "EPI_MANIFEST_SHA256"
  ]) {
    assert.match(res.stdout, new RegExp(`^${key}=`, "m"), `${key} missing from the report`);
  }
  const jsonLine = res.stdout.split("\n").find((l) => l.startsWith("CERTIFICATE_JSON="));
  const cert = JSON.parse(jsonLine.slice("CERTIFICATE_JSON=".length));
  assert.equal(
    cert.jsLeak.totalBytesBeforeGate,
    cert.jsLeak.textBytesBeforeGate + cert.jsLeak.reasoningBytesBeforeGate
  );
});

function gitIsDirty() {
  const g = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  return g.status === 0 && String(g.stdout).trim().length > 0;
}
