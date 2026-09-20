/**
 * Q2-018 (remediation.Quantiom.002 §33, §58, §72) — the six strict-mode rates.
 *
 * §34 is explicit that these are measured, not aliases for a test exit code, and
 * §58 that a zero over an empty denominator certifies nothing. So every rate
 * carries its own numerator, denominator and `hasCoverage`, and a corpus that
 * never produced a cross-domain claim reports CBER as null rather than 0.
 *
 * Each observation is one candidate that the gate ruled on, with whatever the
 * turn already computed. Nothing is recomputed from prose here.
 */

import { unboundVerifiedArtifacts } from "./epistemicFormalArtifactBinding.mjs";
import { requiredBridgeForClaim } from "./epistemicModelingBridge.mjs";
import { analogyAuthorityForClaim, ANALOGY_AUTHORITY } from "./epistemicAnalogyAuthorization.mjs";
import { assessSynthesisAuthorization } from "./epistemicSynthesisAuthorization.mjs";
import { assessBibliographicAuthorization } from "./epistemicSourceIdentityAuthority.mjs";
import {
  claimSatisfiesMechanism,
  isStrictContract,
  requiredMechanismsForClaim
} from "./epistemicUserVerificationContract.mjs";

export const STRICT_METRICS_SCHEMA = "ds4_quantium_strict_metrics_v1";

function rate({ numerator, denominator, target = 0 }) {
  const value = denominator === 0 ? null : numerator / denominator;
  return Object.freeze({
    numerator,
    denominator,
    value,
    hasCoverage: denominator > 0,
    target,
    // §58: an uncovered rate never counts as met.
    targetMet: denominator > 0 && value === target
  });
}

/**
 * §33.1 — how much of what the contract governs actually has its mechanism.
 *
 * The denominator is not "claims the extractor produced": an assertive span the
 * extractor missed is still governed, and counting only what was extracted is
 * exactly the false green §6 exists to stop.
 */
export function measureContractCoverage({
  claims = [],
  verificationContract = null,
  leanCertificates = [],
  claimCoverage = null
} = {}) {
  if (!isStrictContract(verificationContract)) {
    return Object.freeze({ governed: 0, satisfied: 0, vccr: null, hasCoverage: false });
  }

  let governed = 0;
  let satisfied = 0;
  for (const claim of Array.isArray(claims) ? claims.filter(Boolean) : []) {
    const required = requiredMechanismsForClaim({ claim, verificationContract });
    if (required.length === 0) continue;
    governed += 1;
    if (required.every((requirement) => claimSatisfiesMechanism(claim, requirement, leanCertificates))) {
      satisfied += 1;
    }
  }

  // Uncovered assertive spans are governed and unsatisfied by construction.
  const uncovered = claimCoverage?.uncoveredSpans?.length ?? 0;
  governed += uncovered;

  return Object.freeze({
    governed,
    satisfied,
    vccr: governed === 0 ? null : satisfied / governed,
    hasCoverage: governed > 0
  });
}

/** Claims whose subject spans two domains and therefore needs a bridge (§12, §38). */
function crossDomainClaims(claims) {
  return claims.filter((claim) => requiredBridgeForClaim(claim?.text ?? "") !== null);
}

/** Claims that assert a paper's identity, publication or review (§14). */
function bibliographicClaims(claims) {
  return claims.filter((claim) =>
    /\b(?:paper|articol\w+|preprint\w*|arxiv|doi|pubblicazion\w+|publication|journal|rivista|peer[-\s]?review\w*)\b/iu.test(
      String(claim?.text ?? "")
    )
  );
}

/**
 * Fold one corpus of gate observations into the §33 rates.
 *
 * @param {object[]} observations — `{published, claims, formalArtifacts, claimCoverage,
 *   verificationContract, leanCertificates, bridges, sourceCertificates, assistantContent}`
 * @returns {Readonly<object>}
 */
export function measureStrictMetrics(observations = []) {
  const runs = (Array.isArray(observations) ? observations : []).filter(Boolean);

  let governed = 0;
  let satisfied = 0;
  let renderedVerifiedArtifacts = 0;
  let unboundRenderedArtifacts = 0;
  let crossDomain = 0;
  let bridgeEscapes = 0;
  let identityClaims = 0;
  let identityEscapes = 0;
  let analogyClaims = 0;
  let analogyPromotions = 0;
  let summaryClaims = 0;
  let summaryOverclaims = 0;

  for (const run of runs) {
    const claims = (Array.isArray(run.claims) ? run.claims : []).filter(Boolean);
    const artifacts = Array.isArray(run.formalArtifacts) ? run.formalArtifacts : [];
    const bridges = Array.isArray(run.bridges) ? run.bridges : [];
    const published = run.published === true;

    const coverage = measureContractCoverage({
      claims,
      verificationContract: run.verificationContract,
      leanCertificates: run.leanCertificates ?? [],
      claimCoverage: run.claimCoverage
    });
    // §33.1/§55 — VCCR is a property of what was published: a blocked candidate
    // owes the reader nothing, so it contributes neither numerator nor
    // denominator. The five escape rates below work the other way: the corpus
    // supplies the denominator and only a published escape counts.
    if (published) {
      governed += coverage.governed;
      satisfied += coverage.satisfied;
    }

    renderedVerifiedArtifacts += artifacts.filter((a) => a?.renderedAsVerified === true).length;
    if (published) unboundRenderedArtifacts += unboundVerifiedArtifacts(artifacts).length;

    const cross = crossDomainClaims(claims);
    crossDomain += cross.length;
    if (published) {
      bridgeEscapes += cross.filter(
        (claim) => analogyAuthorityForClaim({ claim, bridges }) !== ANALOGY_AUTHORITY.FACT
      ).length;
    }

    const bibliographic = bibliographicClaims(claims);
    identityClaims += bibliographic.length;
    if (published && bibliographic.length > 0) {
      const decision = assessBibliographicAuthorization({
        assistantContent: run.assistantContent ?? "",
        claims: bibliographic,
        sourceCertificates: run.sourceCertificates ?? []
      });
      identityEscapes += decision ? decision.blockedClaimIds.length || 1 : 0;
    }

    const analogies = claims.filter((claim) =>
      ["ANALOGY", "HYPOTHESIS"].includes(String(claim.epistemicType ?? "").toUpperCase())
    );
    analogyClaims += analogies.length;
    if (published) {
      analogyPromotions += analogies.filter(
        (claim) => analogyAuthorityForClaim({ claim, bridges }) === ANALOGY_AUTHORITY.FACT
      ).length;
    }

    const summaries = claims.filter(
      (claim) => Array.isArray(claim.dependencies) && claim.dependencies.length > 0
    );
    summaryClaims += summaries.length;
    if (published && summaries.length > 0) {
      const decision = assessSynthesisAuthorization({
        assistantContent: run.assistantContent ?? "",
        claims
      });
      summaryOverclaims += decision ? summaries.length : 0;
    }
  }

  const vccr = rate({ numerator: satisfied, denominator: governed, target: 1 });
  const ufar = rate({ numerator: unboundRenderedArtifacts, denominator: renderedVerifiedArtifacts });
  const cber = rate({ numerator: bridgeEscapes, denominator: crossDomain });
  const bier = rate({ numerator: identityEscapes, denominator: identityClaims });
  const aper = rate({ numerator: analogyPromotions, denominator: analogyClaims });
  const sor = rate({ numerator: summaryOverclaims, denominator: summaryClaims });

  const rates = { vccr, ufar, cber, bier, aper, sor };
  return Object.freeze({
    schema: STRICT_METRICS_SCHEMA,
    observations: runs.length,
    ...rates,
    // §58 — every denominator class must be non-empty before any of this
    // certifies anything.
    nonVacuous: Object.values(rates).every((r) => r.hasCoverage),
    allTargetsMet: Object.values(rates).every((r) => r.targetMet)
  });
}
