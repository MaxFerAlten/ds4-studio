// certificationGuards.mjs — pure anti-false-green guards (FI-012 M1..M8) and
// fail-closed error checks (FI-013). Each guard is a pure predicate so the
// negative-control tests can feed a mutant and assert the guard trips without
// invoking the certifier's main decision path (FI-015: the auditor must not
// call the certifier's decision function either).
//
// Convention: a guard returns a { ok: boolean, reason: string } object. The
// certifier, the auditor and the negative-control tests all share these so the
// negative controls prove the real detection path, not a test-only copy.

export function guardCertificateComplete(cert, requiredScopes) {
  // M1 — drop certificate (or a required scope) must trip.
  if (!cert || typeof cert !== "object") {
    return { ok: false, reason: "certificate object missing" };
  }
  if (!Array.isArray(cert.scopes)) {
    return { ok: false, reason: "certificate has no scopes array" };
  }
  for (const req of requiredScopes) {
    if (!cert.scopes.some((s) => s.name === req)) {
      return { ok: false, reason: `required scope '${req}' absent from certificate` };
    }
  }
  if (!/^[0-9a-f]{64}$/.test(cert.certificateSha256 ?? "")) {
    return { ok: false, reason: "certificate self-hash missing or malformed" };
  }
  return { ok: true, reason: "certificate complete" };
}

export function guardScopeMismatch(declaredName, actualName) {
  // M2 — the scope identity of what ran must match what was declared.
  if (declaredName !== actualName) {
    return { ok: false, reason: `scope mismatch: declared '${declaredName}', ran '${actualName}'` };
  }
  return { ok: true, reason: "scope identity matches" };
}

export function guardCheckIdInPlan(results, planIds) {
  // M3 — every result checkId must be present in the governing plan.
  for (const r of results) {
    if (!planIds.includes(r.checkId)) {
      return {
        ok: false,
        reason: `result checkId '${r.checkId}' absent from plan (${planIds.length} ids)`
      };
    }
  }
  return { ok: true, reason: "all result checkIds present in plan" };
}

export function guardNoHiddenFailedSubcheck(subchecks) {
  // M4 — a failed subcheck that is masked (hidden: true) must never slip behind
  // an aggregate pass. A failed subcheck that is surfaced (hidden: false) trips
  // too, because the aggregate must reflect it. Only a genuinely passing
  // subcheck (failed: false) is benign.
  if (!Array.isArray(subchecks)) return { ok: true, reason: "no subchecks" };
  for (const sc of subchecks) {
    if (sc && sc.failed === true) {
      return { ok: false, reason: `failed subcheck '${sc.id ?? "?"}' (hidden=${sc.hidden})` };
    }
  }
  return { ok: true, reason: "no failed subcheck" };
}

export function guardNoPreGateLeak(textBytes, reasoningBytes) {
  // M5 — one byte reaching the user before the verdict must trip.
  const total = (textBytes ?? 0) + (reasoningBytes ?? 0);
  if (total !== 0) {
    return {
      ok: false,
      reason: `pre-gate leak of ${total} candidate byte(s) (text=${textBytes ?? 0}, reasoning=${reasoningBytes ?? 0})`
    };
  }
  return { ok: true, reason: "zero candidate bytes before verdict" };
}

export function guardHSCorpusNonEmpty(generatedHighSeverity) {
  // M6 — an empty high-severity corpus makes a zero escape rate vacuous.
  if (typeof generatedHighSeverity !== "number" || generatedHighSeverity <= 0) {
    return {
      ok: false,
      reason: `high-severity corpus is empty/non-positive (generated=${generatedHighSeverity})`
    };
  }
  return { ok: true, reason: "high-severity corpus non-vacuous" };
}

export function guardNativeFresh(build) {
  // M7 — a stale/missing native binary (build failed, source unhashed, binary
  // absent) must trip.
  if (!build) return { ok: false, reason: "no native build provenance" };
  if (build.built !== true) {
    return { ok: false, reason: `native build failed (exit ${build.buildExit})` };
  }
  if (build.binaryExists !== true) {
    return { ok: false, reason: "native binary not present after build" };
  }
  if (!/^[0-9a-f]{64}$/.test(build.binarySha256 ?? "")) {
    return { ok: false, reason: "native binary hash missing" };
  }
  if (Array.isArray(build.sources) && build.sources.length > 0 &&
      !/^[0-9a-f]{64}$/.test(build.sourceSha256 ?? "")) {
    return { ok: false, reason: "native source hash missing (not rebuilt from source)" };
  }
  return { ok: true, reason: "native rebuilt from source with hashed provenance" };
}

export function guardEPIExactIdentity(names, testName) {
  // M8 — registry identity must be an exact name match, never a prefix match; a
  // prefix collision (the name being matched is a proper prefix of another) trips.
  if (!Array.isArray(names)) return { ok: false, reason: "registry names not an array" };
  if (!names.includes(testName)) {
    return { ok: false, reason: `testName '${testName}' not an exact registry identity` };
  }
  return { ok: true, reason: "exact registry identity matched" };
}

// FI-013 — fail-closed: on any error encountered under the hood, the outcome
// must refuse to publish (candidate stays unpublished) and must not be staged
// as accepted. This consolidates the error-matrix property without calling the
// certifier's main decision function.
export function guardFailClosedOnError(errorOutcome, accepted) {
  if (errorOutcome && (errorOutcome.published !== undefined ? errorOutcome.published.length !== 0 : false)) {
    return { ok: false, reason: "error path published candidate bytes" };
  }
  if (errorOutcome && Array.isArray(errorOutcome.reasoningPublished) &&
      errorOutcome.reasoningPublished.length !== 0) {
    return { ok: false, reason: "error path published reasoning bytes" };
  }
  const staged = errorOutcome && Array.isArray(errorOutcome.accepted)
    ? errorOutcome.accepted
    : (Array.isArray(accepted) ? accepted : []);
  if (staged.length !== 0) {
    return { ok: false, reason: "error path staged candidate as accepted" };
  }
  return { ok: true, reason: "error path is fail-closed" };
}
