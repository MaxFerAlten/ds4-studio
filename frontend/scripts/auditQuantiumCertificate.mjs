// auditQuantiumCertificate.mjs — FI-PATCH-015 independent audit replay.
//
// Consumes a machine certificate (quantium-certificate.json) and recomputes every
// derived quantity from the raw counters it carries. It deliberately does NOT
// import the certifier's decision function (§21): a shared bug in certifyQuantium
// must not be able to bless itself. The only shared code is certificationGuards,
// whose sensitivity is proved by the M1..M8 negative controls.
//
// Property audited (§2): Claim_certificazione <= Evidence_osservata. Every
// CERTIFIED_* verdict is treated as a claim and must be re-derivable from the
// certificate's own raw evidence; anything missing is a failure, never a default
// pass (fail-closed).
//
// CLI:  node frontend/scripts/auditQuantiumCertificate.mjs <certificate.json>
// Exit: 0 iff AUDIT=PASS.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { guardNoPreGateLeak, guardHSCorpusNonEmpty, guardNativeFresh } from "./certificationGuards.mjs";

export const CERTIFIED_VERDICTS = ["CERTIFIED_DEV", "CERTIFIED_NATIVE_DEV", "CERTIFIED_RELEASE"];
export const ALL_VERDICTS = ["NOT_CERTIFIED", ...CERTIFIED_VERDICTS];

const isHex64 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/**
 * Recompute the certificate's self-hash the way the certifier derives it: the
 * canonical JSON of the certificate with the hash field removed.
 */
export function recomputeCertificateSha256(cert) {
  const splice = JSON.parse(JSON.stringify(cert));
  delete splice.certificateSha256;
  return createHash("sha256").update(JSON.stringify(splice, null, 2)).digest("hex");
}

/**
 * @returns {{verdict: "PASS"|"FAIL", failures: {check: string, reason: string}[], checks: string[]}}
 */
export function auditCertificate(cert) {
  const failures = [];
  const checks = [];
  const fail = (check, reason) => failures.push({ check, reason });
  const ok = (check) => checks.push(check);

  if (!cert || typeof cert !== "object") {
    return { verdict: "FAIL", failures: [{ check: "shape", reason: "certificate is not an object" }], checks };
  }

  if (cert.schema !== "ds4_quantium_certificate_v2") {
    fail("schema", `unknown certificate schema '${cert.schema}'`);
  } else ok("schema");

  const verdict = cert.verdict;
  if (!ALL_VERDICTS.includes(verdict)) {
    fail("verdict_vocabulary", `verdict '${verdict}' is not in ${ALL_VERDICTS.join("|")}`);
  } else ok("verdict_vocabulary");
  const claimsCertified = CERTIFIED_VERDICTS.includes(verdict);

  // --- test totals: recomputed from the per-scope numbers, never trusted ------
  const scopes = Array.isArray(cert.scopes) ? cert.scopes : [];
  const totals = cert.totals ?? {};
  if (scopes.length === 0) {
    fail("scopes_present", "certificate carries no scopes");
  } else {
    const sum = (k) => scopes.reduce((s, x) => s + (Number.isFinite(x?.[k]) ? x[k] : 0), 0);
    const recomputed = {
      total: sum("total"),
      passed: sum("pass"),
      failed: sum("fail"),
      skipped: sum("skipped")
    };
    for (const [key, value] of Object.entries(recomputed)) {
      if (Number(totals[key]) !== value) {
        // `failed` legitimately exceeds the TAP sum when a scope produced no
        // summary at all (the certifier counts that scope as one failure).
        const missingSummaries = scopes.filter((s) => !Number.isFinite(s?.total)).length;
        if (!(key === "failed" && Number(totals.failed) === value + missingSummaries)) {
          fail("totals_consistency", `totals.${key}=${totals[key]} but scopes sum to ${value}`);
        }
      }
    }
    if (failures.every((f) => f.check !== "totals_consistency")) ok("totals_consistency");
  }

  if (claimsCertified) {
    if (Number(totals.total) <= 0) fail("non_vacuous_tests", "TOTAL_TESTS is not positive");
    if (Number(totals.passed) <= 0) fail("non_vacuous_tests", "PASSED_TESTS is not positive");
    if (Number(totals.failed) !== 0) fail("tests_green", `FAILED_TESTS=${totals.failed}`);
    if (Number(totals.skipped) !== 0) fail("no_skips", `SKIPPED_TESTS=${totals.skipped}`);
    if (!scopes.every((s) => s.ok === true)) fail("scopes_green", "a scope is not ok");
  }

  // --- HSER ------------------------------------------------------------------
  const m = cert.metrics ?? {};
  const generated = Number(m.generatedHighSeverity ?? 0);
  const published = Number(m.publishedHighSeverity ?? 0);
  const rate = Number(m.escapeRate);
  const denom = guardHSCorpusNonEmpty(generated);
  if (!denom.ok) {
    if (claimsCertified) fail("hser_denominator", `VACUOUS_HSER_DENOMINATOR: ${denom.reason}`);
  } else {
    ok("hser_denominator");
    const expected = published / generated;
    if (!Number.isFinite(rate) || Math.abs(rate - expected) > 1e-12) {
      fail("hser_recompute", `escapeRate=${m.escapeRate} but published/generated=${expected}`);
    } else ok("hser_recompute");
  }
  if (claimsCertified) {
    if (published !== 0) fail("hser_zero", `HS_PUBLISHED=${published}`);
    if (rate !== 0) fail("hser_zero", `HIGH_SEVERITY_ESCAPE_RATE=${rate}`);
  }

  // --- JS pre-gate bytes -----------------------------------------------------
  const js = cert.jsLeak ?? {};
  const jsText = Number(js.textBytesBeforeGate ?? NaN);
  const jsReasoning = Number(js.reasoningBytesBeforeGate ?? NaN);
  const jsTotal = Number(js.totalBytesBeforeGate ?? NaN);
  if (![jsText, jsReasoning, jsTotal].every(Number.isFinite)) {
    fail("js_bytes_present", "JS text/reasoning/total pre-gate bytes are not all present");
  } else if (jsTotal !== jsText + jsReasoning) {
    fail("js_bytes_sum", `total=${jsTotal} != text=${jsText} + reasoning=${jsReasoning}`);
  } else ok("js_bytes_sum");
  if (claimsCertified) {
    const leak = guardNoPreGateLeak(jsText, jsReasoning);
    if (!leak.ok) fail("js_no_byte_leak", leak.reason);
    if (!(Number(js.blockedCases) > 0)) {
      fail("js_non_vacuous", `JS blocked corpus is empty (blockedCases=${js.blockedCases})`);
    }
  }

  // --- EPI manifest ----------------------------------------------------------
  if (!isHex64(m.epiManifestSha256)) {
    fail("manifest_hash", `EPI manifest hash missing or malformed: ${m.epiManifestSha256}`);
  } else ok("manifest_hash");
  if (claimsCertified && !(Number(m.epiManifestCount) > 0)) {
    fail("manifest_count", `EPI manifest count=${m.epiManifestCount}`);
  }

  // --- QHO→LLM adversarial closure (Q2-019 §34, §58) -------------------------
  const llm = cert.qhoLlmReplay ?? {};
  const strict = cert.strictMetrics ?? {};
  if (claimsCertified) {
    for (const [flag, label] of [
      ["adversarialIncluded", "QHO_LLM_ADVERSARIAL_INCLUDED"],
      ["adversarialBlocked", "QHO_LLM_ADVERSARIAL_BLOCKED"],
      ["safeRepairAllowed", "QHO_LLM_SAFE_REPAIR_ALLOWED"],
      ["universalCoverageBlocked", "QHO_LLM_UNIVERSAL_COVERAGE_BLOCKED"]
    ]) {
      if (llm[flag] !== true) fail("qho_llm_replay", `${label}=${llm[flag]}`);
      else ok("qho_llm_replay");
    }
  }

  // §33/§58 — recompute each rate from its own counters, and refuse a zero that
  // stands over an empty denominator.
  const RATE_SOURCES = [
    ["vccr", strict.strictVerificationContract, "satisfiedClaims", "assertiveClaims", 1],
    ["ufar", strict.formalArtifacts, "unboundVerifiedRendered", "verifiedRendered", 0],
    ["cber", strict.crossDomain, "bridgeEscapes", "claims", 0],
    ["bier", strict.bibliography, "identityEscapes", "certifiedIdentityClaims", 0],
    ["aper", strict.analogies, "promotedToFact", "published", 0],
    ["sor", strict.synthesis, "overclaims", "summaryClaims", 0]
  ];
  for (const [name, block, numeratorKey, denominatorKey, target] of RATE_SOURCES) {
    if (!block) {
      if (claimsCertified) fail("strict_metrics_present", `${name} counters absent`);
      continue;
    }
    const numerator = Number(block[numeratorKey]);
    const denominator = Number(block[denominatorKey]);
    if (!(denominator > 0)) {
      if (claimsCertified) fail("strict_metrics_denominator", `VACUOUS_${name.toUpperCase()}_DENOMINATOR`);
      continue;
    }
    ok("strict_metrics_denominator");
    const expected = numerator / denominator;
    if (!Number.isFinite(Number(block[name])) || Math.abs(Number(block[name]) - expected) > 1e-12) {
      fail("strict_metrics_recompute", `${name}=${block[name]} but ${numerator}/${denominator}=${expected}`);
    } else ok("strict_metrics_recompute");
    if (claimsCertified && Number(block[name]) !== target) {
      fail("strict_metrics_target", `${name.toUpperCase()}=${block[name]} (target ${target})`);
    }
  }

  // --- source provenance -----------------------------------------------------
  const prov = cert.provenance ?? {};
  if (claimsCertified && !prov.gitHead) fail("source_identity", "gitHead absent");
  if (prov.mode === "release") {
    if (prov.dirty !== false) fail("release_clean_tree", "release mode with a dirty tree");
    else ok("release_clean_tree");
  } else if (prov.mode === "dev") {
    if (claimsCertified && verdict === "CERTIFIED_RELEASE") {
      fail("mode_verdict", "CERTIFIED_RELEASE claimed under dev provenance");
    }
    // §15/§26 — a dirty dev tree is identified by HEAD + Diff(hash); without the
    // diff hash the certified source is not uniquely identified.
    if (claimsCertified && prov.dirty === true && !isHex64(prov.diffSha256)) {
      fail("dev_diff_hash", "dirty dev tree without a diff sha256");
    } else if (prov.dirty === true && isHex64(prov.diffSha256)) ok("dev_diff_hash");
  } else if (claimsCertified) {
    fail("mode_known", `unknown provenance mode '${prov.mode}'`);
  }

  // --- native ----------------------------------------------------------------
  const native = Array.isArray(cert.native) ? cert.native : [];
  const nativeIncluded = cert.nativeIncluded === true;
  if (verdict === "CERTIFIED_RELEASE" && !nativeIncluded) {
    fail("release_native_required", "CERTIFIED_RELEASE without the native scope");
  }
  if (nativeIncluded) {
    if (native.length === 0) fail("native_present", "--with-native but no native entries");
    for (const n of native) {
      const fresh = guardNativeFresh(n.build);
      if (!fresh.ok && claimsCertified) fail("native_fresh", `${n.name}: ${fresh.reason}`);
      if (!n.metrics) continue;
      const t = Number(n.metrics.candidateTextBytesBeforeVerdict ?? NaN);
      const r = Number(n.metrics.candidateReasoningBytesBeforeVerdict ?? NaN);
      const tot = Number(n.metrics.candidateBytesBeforeVerdict ?? NaN);
      if (![t, r, tot].every(Number.isFinite)) {
        fail("native_bytes_present", `${n.name}: native byte counters absent (NATIVE_BYTE_METRIC=UNKNOWN)`);
      } else if (tot !== t + r) {
        fail("native_bytes_sum", `${n.name}: total=${tot} != text=${t} + reasoning=${r}`);
      } else ok("native_bytes_sum");
      if (claimsCertified) {
        const leak = guardNoPreGateLeak(t, r);
        if (!leak.ok) fail("native_no_byte_leak", `${n.name}: ${leak.reason}`);
        if (!(Number(n.metrics.blockedCases) > 0)) {
          fail("native_non_vacuous", `${n.name}: native blocked corpus is empty`);
        }
        if (Number(n.metrics.blockedCases) !== Number(n.metrics.adversarialCases)) {
          fail(
            "native_all_blocked",
            `${n.name}: blocked=${n.metrics.blockedCases} of ${n.metrics.adversarialCases} adversarial`
          );
        }
      }
    }
    if (claimsCertified && !native.some((n) => n.metrics)) {
      fail("native_metrics_required", "no native target reported machine-readable metrics");
    }
  }

  // --- QHO replay ------------------------------------------------------------
  const qho = cert.qhoReplay ?? {};
  if (claimsCertified) {
    if (qho.broadBlocked !== true) fail("qho_broad_blocked", `QHO_BROAD_BLOCKED=${qho.broadBlocked}`);
    if (qho.narrowAllowed !== true) fail("qho_narrow_allowed", `QHO_NARROW_ALLOWED=${qho.narrowAllowed}`);
    if (qho.broadBlocked === true && qho.narrowAllowed === true) ok("qho_replay");
  }

  // --- certificate self-hash -------------------------------------------------
  if (cert.certificateSha256) {
    if (!isHex64(cert.certificateSha256)) {
      fail("certificate_hash", "certificateSha256 is not a 64-hex digest");
    } else if (recomputeCertificateSha256(cert) !== cert.certificateSha256) {
      fail("certificate_hash", "certificateSha256 does not match the certificate body (tampered)");
    } else ok("certificate_hash");
  }

  return { verdict: failures.length === 0 ? "PASS" : "FAIL", failures, checks };
}

function main(argv) {
  const path = argv.find((a) => !a.startsWith("--"));
  if (!path) {
    process.stdout.write("usage: auditQuantiumCertificate.mjs <quantium-certificate.json>\nAUDIT=FAIL\n");
    return 1;
  }
  let cert;
  try {
    cert = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    process.stdout.write(`AUDIT=FAIL reason=unreadable_certificate (${err.message})\n`);
    return 1;
  }
  const result = auditCertificate(cert);
  for (const f of result.failures) process.stdout.write(`[audit-fail] ${f.check}: ${f.reason}\n`);
  process.stdout.write(`AUDIT_CHECKS=${result.checks.length}\nAUDIT=${result.verdict}\n`);
  return result.verdict === "PASS" ? 0 : 1;
}

// Run only as a CLI, so the certifier can import auditCertificate() without
// executing the entry point.
if (process.argv[1] && process.argv[1].endsWith("auditQuantiumCertificate.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
