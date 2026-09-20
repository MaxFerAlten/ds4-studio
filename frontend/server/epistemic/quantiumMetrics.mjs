// quantiumMetrics.mjs — REM-010 metric runner.
//
// A thin, non-test entry point the certifier spawns to read the SAME metrics the
// e2e tests assert. It must not reimplement any corpus/escape-rate logic: both
// are imported from quantiumCorpus.mjs (the single source of truth).
//
// Usage:
//   node frontend/server/epistemic/quantiumMetrics.mjs
// Prints a single JSON line: the combined HSER + JS byte-leak evidence.

import {
  measureJsNoByteLeak,
  runQhoLlmAdversarialCorpus,
  runQuantiumHallucinationCorpus
} from "./quantiumCorpus.mjs";
import { EPI_MANIFEST } from "./epistemicRegressionManifest.mjs";

async function main() {
  const [corpus, js, strict] = await Promise.all([
    runQuantiumHallucinationCorpus(),
    measureJsNoByteLeak(),
    // Q2-018 (§33, §72) — the six strict-mode rates, measured over the real
    // QHO→LLM replay rather than restated from this document.
    runQhoLlmAdversarialCorpus()
  ]);

  let registryRange = "001..000";
  try {
    const registry = await import("./epistemicRegressionSuite.mjs");
    const ids = registry.EPI_REGRESSION_SUITE.map((e) => e.id);
    if (ids.length > 0) {
      const from = ids[0];
      const to = ids[ids.length - 1];
      registryRange = `${from.slice(4)}..${to.slice(4)}`;
    }
  } catch {
    // registry unavailable -> range reported as non-contiguous sentinel.
  }

  process.stdout.write(
    JSON.stringify({
      schema: "ds4_quantium_certification_metrics_v2",
      generatedHighSeverity: corpus.generatedHighSeverity,
      publishedHighSeverity: corpus.publishedHighSeverity,
      escapeRate: corpus.escapeRate,
      jsBlockedCases: js.blockedCases,
      jsCandidateTextBytesBeforeGate: js.candidateTextBytesBeforeGate,
      jsCandidateReasoningBytesBeforeGate: js.candidateReasoningBytesBeforeGate,
      jsCandidateBytesBeforeGate: js.candidateBytesBeforeGate,
      jsNoByteLeak: js.noByteLeak,
      registryRange,
      epiManifestSha256: EPI_MANIFEST.manifestSha256,
      epiManifestCount: EPI_MANIFEST.count,
      epiManifestRange: EPI_MANIFEST.range,
      strictVerificationContract: {
        present: strict.runs.some((run) => run.verificationContract?.coverageMode === "ALL_ASSERTIVE_CLAIMS"),
        coverageMode: "ALL_ASSERTIVE_CLAIMS",
        assertiveClaims: strict.metrics.vccr.denominator,
        satisfiedClaims: strict.metrics.vccr.numerator,
        vccr: strict.metrics.vccr.value
      },
      formalArtifacts: {
        verifiedRendered: strict.metrics.ufar.denominator,
        unboundVerifiedRendered: strict.metrics.ufar.numerator,
        ufar: strict.metrics.ufar.value
      },
      crossDomain: {
        claims: strict.metrics.cber.denominator,
        bridgeEscapes: strict.metrics.cber.numerator,
        cber: strict.metrics.cber.value
      },
      bibliography: {
        certifiedIdentityClaims: strict.metrics.bier.denominator,
        identityEscapes: strict.metrics.bier.numerator,
        bier: strict.metrics.bier.value
      },
      analogies: {
        published: strict.metrics.aper.denominator,
        promotedToFact: strict.metrics.aper.numerator,
        aper: strict.metrics.aper.value
      },
      synthesis: {
        summaryClaims: strict.metrics.sor.denominator,
        overclaims: strict.metrics.sor.numerator,
        sor: strict.metrics.sor.value
      },
      strictMetricsNonVacuous: strict.metrics.nonVacuous,
      strictMetricsTargetsMet: strict.metrics.allTargetsMet,
      qhoLlmAdversarialBlockedAsExpected: strict.blockedAsExpected
    })
  );
}

main().catch((err) => {
  process.stderr.write(`metric runner failed: ${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
