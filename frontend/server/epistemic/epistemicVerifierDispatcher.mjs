/**
 * Execute the verification requirements attached to one epistemic claim.
 *
 * Requirements are obligations, not annotations: an unavailable, disabled or
 * inconclusive verifier always normalizes to UNKNOWN and never to PASSED.
 */

import { MATH_VERDICT, verifyMathClaim } from "./epistemicMathVerifier.mjs";
import {
  IDENTITY_VERDICT,
  resolveBibliographicIdentity
} from "./epistemicCitationIdentity.mjs";
import { ENTAILMENT_VERDICT, checkEntailment } from "./epistemicEntailment.mjs";
import {
  EXECUTION_VERDICT,
  verifyExecutionClaim
} from "./epistemicExecutionVerifier.mjs";
import {
  createVerificationPlan,
  reconcileVerificationPlan
} from "./epistemicVerificationPlan.mjs";
import {
  VERIFIER_CERTIFICATE_VERDICT,
  createVerifierCertificate
} from "./epistemicVerifierCertificate.mjs";
import {
  VERIFIER_SCOPE_STATUS,
  checkVerifierScope
} from "./epistemicVerifierScope.mjs";
import {
  aggregateSubchecks
} from "./epistemicSubcheckAggregator.mjs";

export const VERIFIER_NAME = Object.freeze({
  MATH: "epistemicMathVerifier",
  CITATION_IDENTITY: "epistemicCitationIdentity",
  ENTAILMENT: "epistemicEntailment",
  EXECUTION: "epistemicExecutionVerifier"
});

export const NORMALIZED_VERDICT = Object.freeze({
  PASSED: "PASSED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN"
});

export const REQUIREMENT_VERIFIER = Object.freeze({
  math_verification: VERIFIER_NAME.MATH,
  symbolic_verification: VERIFIER_NAME.MATH,
  ode_residual_verification: VERIFIER_NAME.MATH,

  source_identity: VERIFIER_NAME.CITATION_IDENTITY,
  primary_source: VERIFIER_NAME.CITATION_IDENTITY,
  source_entailment: VERIFIER_NAME.ENTAILMENT,

  execution_evidence: VERIFIER_NAME.EXECUTION,
  test_evidence: VERIFIER_NAME.EXECUTION,
  benchmark_evidence: VERIFIER_NAME.EXECUTION,
  observation_evidence: VERIFIER_NAME.EXECUTION,
  analysis_execution_or_source_artifact: VERIFIER_NAME.EXECUTION,
  verifier_result: VERIFIER_NAME.EXECUTION,

  // Expanded by the orchestrator from the challenged target's debts. It is
  // deliberately not mapped to a generic execution pass.
  challenge_verification: null
});

export function createVerifierBudget(maxCalls = 0) {
  const limit = Number.isInteger(maxCalls) && maxCalls >= 0 ? maxCalls : 0;
  return {
    limit,
    used: 0,
    remaining() {
      return Math.max(0, this.limit - this.used);
    },
    consume() {
      if (this.used >= this.limit) return false;
      this.used += 1;
      return true;
    }
  };
}

function unknownResult({ verifier, requirement, reasonCode, reason }) {
  return {
    verifier,
    requirement,
    status: NORMALIZED_VERDICT.UNKNOWN,
    evidenceIds: [],
    failureCodes: [],
    reasonCode,
    reason,
    observedAt: new Date().toISOString()
  };
}

export function normalizeMathResult(raw, requirement) {
  const evidenceIds = raw?.evidence?.id ? [raw.evidence.id] : [];
  if (raw?.verdict === MATH_VERDICT.VERIFIED || raw?.verdict === MATH_VERDICT.REFUTED) {
    const passed = raw.verdict === MATH_VERDICT.VERIFIED;
    return {
      verifier: VERIFIER_NAME.MATH,
      requirement,
      status: passed ? NORMALIZED_VERDICT.PASSED : NORMALIZED_VERDICT.FAILED,
      evidenceIds,
      failureCodes: [...(raw.failureCodes ?? [])],
      reasonCode: passed ? "MATH_VERIFIED" : "MATH_REFUTED",
      reason: raw.reason ?? "",
      observedAt: new Date().toISOString(),
      evidence: raw.evidence ?? null,
      maxEpistemicType: raw.maxEpistemicType ?? null,
      // REM-014: real subchecks from the Sage run pass through to the aggregator.
      subchecks: Array.isArray(raw.subchecks) ? raw.subchecks : null
    };
  }
  return unknownResult({
    verifier: VERIFIER_NAME.MATH,
    requirement,
    reasonCode: "MATH_UNKNOWN",
    reason: raw?.reason ?? "math verifier returned no conclusive verdict"
  });
}

export function normalizeExecutionResult(raw, requirement) {
  const evidenceIds = [
    ...new Set(
      (raw?.findings ?? []).flatMap((finding) =>
        Array.isArray(finding?.evidenceIds) ? finding.evidenceIds : []
      )
    )
  ];
  if (raw?.verdict === EXECUTION_VERDICT.SUPPORTED) {
    return {
      verifier: VERIFIER_NAME.EXECUTION,
      requirement,
      status: NORMALIZED_VERDICT.PASSED,
      evidenceIds,
      failureCodes: [],
      reasonCode: "EXECUTION_SUPPORTED",
      reason: raw.reason ?? "",
      observedAt: new Date().toISOString()
    };
  }
  if (
    raw?.verdict === EXECUTION_VERDICT.UNSUPPORTED ||
    raw?.verdict === EXECUTION_VERDICT.MISREPRESENTED
  ) {
    return {
      verifier: VERIFIER_NAME.EXECUTION,
      requirement,
      status: NORMALIZED_VERDICT.FAILED,
      evidenceIds,
      failureCodes: [...(raw.failureCodes ?? [])],
      reasonCode: raw.verdict,
      reason: raw.reason ?? "",
      observedAt: new Date().toISOString()
    };
  }
  return unknownResult({
    verifier: VERIFIER_NAME.EXECUTION,
    requirement,
    reasonCode: "EXECUTION_NOT_APPLICABLE_OR_UNKNOWN",
    reason: raw?.reason ?? "execution verifier returned no conclusive verdict"
  });
}

export function normalizeEntailmentResult(raw, requirement = "source_entailment") {
  if (raw?.verdict === ENTAILMENT_VERDICT.SUPPORTED) {
    return {
      verifier: VERIFIER_NAME.ENTAILMENT,
      requirement,
      status: NORMALIZED_VERDICT.PASSED,
      evidenceIds: [],
      failureCodes: [...(raw.failureCodes ?? [])],
      reasonCode: "SOURCE_ENTAILS_CLAIM",
      reason: raw.reason ?? "",
      supportingSpans: [...(raw.supportingSpans ?? [])],
      observedAt: new Date().toISOString()
    };
  }
  if (
    raw?.verdict === ENTAILMENT_VERDICT.ABSENT ||
    raw?.verdict === ENTAILMENT_VERDICT.CONTRADICTED
  ) {
    return {
      verifier: VERIFIER_NAME.ENTAILMENT,
      requirement,
      status: NORMALIZED_VERDICT.FAILED,
      evidenceIds: [],
      failureCodes: [...(raw.failureCodes ?? [])],
      reasonCode: raw.verdict,
      reason: raw.reason ?? "",
      supportingSpans: [...(raw.supportingSpans ?? [])],
      observedAt: new Date().toISOString()
    };
  }
  return unknownResult({
    verifier: VERIFIER_NAME.ENTAILMENT,
    requirement,
    reasonCode: `ENTAILMENT_${raw?.verdict ?? "UNKNOWN"}`,
    reason: raw?.reason ?? "source entailment is unresolved"
  });
}

export function normalizeIdentityResult(raw, requirement = "source_identity") {
  if (raw?.verdict === IDENTITY_VERDICT.VERIFIED) {
    return {
      verifier: VERIFIER_NAME.CITATION_IDENTITY,
      requirement,
      status: NORMALIZED_VERDICT.PASSED,
      evidenceIds: [],
      failureCodes: [...(raw.failureCodes ?? [])],
      reasonCode: "CITATION_IDENTITY_VERIFIED",
      reason: raw.reason ?? "",
      observedAt: new Date().toISOString(),
      resolved: raw.resolved ?? []
    };
  }
  if (
    raw?.verdict === IDENTITY_VERDICT.MISMATCH ||
    raw?.verdict === IDENTITY_VERDICT.NOT_FOUND
  ) {
    return {
      verifier: VERIFIER_NAME.CITATION_IDENTITY,
      requirement,
      status: NORMALIZED_VERDICT.FAILED,
      evidenceIds: [],
      failureCodes: [...(raw.failureCodes ?? [])],
      reasonCode: raw.verdict,
      reason: raw.reason ?? "",
      observedAt: new Date().toISOString(),
      resolved: raw.resolved ?? []
    };
  }
  return unknownResult({
    verifier: VERIFIER_NAME.CITATION_IDENTITY,
    requirement,
    reasonCode: `CITATION_${raw?.verdict ?? "UNKNOWN"}`,
    reason: raw?.reason ?? "citation identity unresolved"
  });
}

function identityClaimFromText(text) {
  const value = String(text ?? "");
  const arxivId = value.match(
    /\barxiv\s*:\s*((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?)/i
  )?.[1] ?? null;
  const doi = value.match(/\bdoi\s*:\s*(10\.\d{4,9}\/[^\s,;]+)/i)?.[1] ?? null;
  return { arxivId, doi };
}

function resolveSourceBinding(claim, sourceContext) {
  if (!sourceContext || !claim?.id) return null;
  if (typeof sourceContext.forClaim === "function") {
    return sourceContext.forClaim(claim.id) ?? null;
  }
  return sourceContext.bindings?.[claim.id] ?? sourceContext[claim.id] ?? null;
}

function buildCitationIdentityInput(claim, sourceContext) {
  const parsed = identityClaimFromText(claim?.text);
  const binding = resolveSourceBinding(claim, sourceContext);
  const citation = binding?.citation ?? binding?.source ?? binding?.metadata ?? {};
  return {
    title: citation.title ?? "",
    authors: Array.isArray(citation.authors) ? citation.authors : [],
    year: citation.year ?? citation.publishedAt ?? null,
    doi: citation.doi ?? parsed.doi,
    arxivId: citation.arxivId ?? parsed.arxivId
  };
}

/** Bind only evidence explicitly cited by a verifier result to this claim. */
export function bindEvidenceToClaim({ turnEvidence, claimId, result }) {
  const ids = new Set(result?.evidenceIds ?? []);
  if (ids.size === 0) return [];
  const bound = [];
  for (const item of turnEvidence?.items ?? []) {
    if (!ids.has(item?.id)) continue;
    if (!Array.isArray(item.supportsClaimIds)) item.supportsClaimIds = [];
    if (!item.supportsClaimIds.includes(claimId)) item.supportsClaimIds.push(claimId);
    bound.push(item.id);
  }
  return bound;
}

function disabledResult(verifier, requirement, reasonCode, reason) {
  return unknownResult({ verifier, requirement, reasonCode, reason });
}

/**
 * R02-PATCH-05: build the verification plan for a claim BEFORE any verifier
 * runs, so the plan pre-declares what will be checked instead of being
 * reconstructed from results post-hoc. A claim with no requirements yields
 * null (never a vacuous PASS).
 */
export function buildVerificationPlanForClaim(claim) {
  const requirements = [
    ...new Set(
      Array.isArray(claim?.verificationRequirements)
        ? claim.verificationRequirements.filter(Boolean)
        : []
    )
  ];
  if (!claim?.id || requirements.length === 0) return null;
  const checks = requirements.map((requirement, index) => ({
    id: `${claim.id}:${requirement}:${index + 1}`,
    requirement,
    mandatory: true,
    method: Object.prototype.hasOwnProperty.call(REQUIREMENT_VERIFIER, requirement)
      ? REQUIREMENT_VERIFIER[requirement]
      : "unmapped",
    expectedCertificateScope: claim.expectedCertificateScope ?? null,
    successCriterion: `verifier returns PASSED for ${requirement}`,
    failureCriterion:
      `verifier returns FAILED, UNKNOWN, ERROR, or cannot establish scope for ${requirement}`
  }));
  return createVerificationPlan({
    claimId: claim.id,
    assumptions: (Array.isArray(claim.assumptions) ? claim.assumptions : [])
      .map((a) => (typeof a === "string" ? a : a?.normalizedStatement ?? a?.text ?? a?.id))
      .filter(Boolean),
    checks
  });
}

/**
 * R02-PATCH-07..12: a claim-bound certificate describing what the verifier
 * actually established. Never invents a broader proposition than the verifier
 * checked: for tools without a precise statement the certificate stays narrow
 * and conservative.
 */
export function buildResultCertificate(result, claim) {
  if (!result?.verifier || !claim?.id) return null;
  const base = {
    claimId: claim.id,
    requirement: result.requirement,
    verdict:
      result.status === NORMALIZED_VERDICT.PASSED
        ? VERIFIER_CERTIFICATE_VERDICT.PASSED
        : result.status === NORMALIZED_VERDICT.FAILED
          ? VERIFIER_CERTIFICATE_VERDICT.FAILED
          : VERIFIER_CERTIFICATE_VERDICT.UNKNOWN,
    evidenceIds: Array.isArray(result.evidenceIds) ? result.evidenceIds : [],
    rawResultRef: {
      reasonCode: result.reasonCode,
      maxEpistemicType: result.maxEpistemicType ?? null
    },
    metadata: {
      normalizedStatement: claim.verificationTarget?.normalizedStatement ?? ""
    }
  };
  if (result.verifier === VERIFIER_NAME.MATH) {
    return createVerifierCertificate({
      ...base,
      verifier: VERIFIER_NAME.MATH,
      checkedStatement:
        result.checkedStatement ??
        `Sage evaluated the mathematical check generated for claim ${claim.id}.`,
      formalizationKind: result.formalizationKind ?? "CAS_EXPRESSION",
      domain: claim.domain ?? "MATHEMATICS",
      assumptionsUsed: result.assumptionsUsed ?? [],
      propertiesEstablished:
        result.propertiesEstablished ??
        (result.status === NORMALIZED_VERDICT.PASSED ? [result.requirement] : []),
      propertiesNotEstablished: result.propertiesNotEstablished ?? []
    });
  }
  if (result.verifier === VERIFIER_NAME.EXECUTION) {
    // §39: execution evidence certifies that the command completed with a
    // structured status and recorded a result class, never that the software
    // is correct.
    return createVerifierCertificate({
      ...base,
      verifier: VERIFIER_NAME.EXECUTION,
      checkedStatement:
        result.checkedStatement ??
        "The recorded command completed successfully with structured execution status.",
      formalizationKind: result.formalizationKind ?? "EXECUTION_OBSERVATION",
      domain: claim.domain ?? "EXECUTION"
    });
  }
  if (result.verifier === VERIFIER_NAME.CITATION_IDENTITY) {
    // §40: identity verifies identifier -> work identity, not that the paper
    // supports the claim.
    return createVerifierCertificate({
      ...base,
      verifier: VERIFIER_NAME.CITATION_IDENTITY,
      checkedStatement:
        result.checkedStatement ??
        `The cited identifiers resolve to the stated work identity for claim ${claim.id}.`,
      formalizationKind: result.formalizationKind ?? "SOURCE_IDENTITY",
      domain: claim.domain ?? "CITATION"
    });
  }
  if (result.verifier === VERIFIER_NAME.ENTAILMENT) {
    // §41: entailment verifies that the source passage supports, contradicts
    // or is absent for this claim.
    return createVerifierCertificate({
      ...base,
      verifier: VERIFIER_NAME.ENTAILMENT,
      checkedStatement:
        result.checkedStatement ??
        `The source passage supports, contradicts, or is absent for claim ${claim.id}.`,
      formalizationKind: result.formalizationKind ?? "SOURCE_ENTAILMENT",
      domain: claim.domain ?? "CITATION"
    });
  }
  return null;
}


/** Execute every unique requirement on one claim within the shared budget. */
export async function dispatchClaimVerifiers({
  claim,
  evidence = [],
  client = null,
  executeSage = null,
  citationProviders = null,
  sourceContext = null,
  config = {},
  budget = null,
  modelingBridge = null,
  signal
} = {}) {
  const requirements = [
    ...new Set(
      Array.isArray(claim?.verificationRequirements)
        ? claim.verificationRequirements.filter(Boolean)
        : []
    )
  ];
  const callBudget = budget ?? createVerifierBudget(config.maxVerifierCallsPerTurn);
  const startedUsed = callBudget.used;
  const results = [];
  const generatedEvidence = [];
  const executed = [];

  // REM-001: the verification plan is built BEFORE any verifier runs, so the
  // checks (and their check ids) are pre-declared rather than reconstructed
  // from results post-hoc. The plan is the single source of truth for which
  // checks exist and in what order.
  const verificationPlan = buildVerificationPlanForClaim(claim);
  const checkByRequirement = new Map(
    (verificationPlan?.checks ?? []).map((check) => [check.requirement, check])
  );
  const planCheckIdFor = (requirement) => checkByRequirement.get(requirement)?.id ?? null;

  const consumeOrExhaust = (requirement, verifier) => {
    if (callBudget.consume()) {
      executed.push({ requirement, verifier });
      return true;
    }
    results.push(
      unknownResult({
        verifier,
        requirement,
        reasonCode: "VERIFIER_BUDGET_EXHAUSTED",
        reason: "the turn verifier budget exhausted before the requirement could run"
      })
    );
    return false;
  };

  for (const requirement of requirements) {
    const checkId = planCheckIdFor(requirement);
    const verifier = Object.prototype.hasOwnProperty.call(REQUIREMENT_VERIFIER, requirement)
      ? REQUIREMENT_VERIFIER[requirement]
      : "unmapped";

    if (requirement === "challenge_verification") {
      results.push(
        unknownResult({
          checkId,
          verifier: "challenge_target_expansion",
          requirement,
          reasonCode: "CHALLENGE_REQUIRES_TARGET_EXPANSION",
          reason: "challenge verification must execute the challenged claim's requirements"
        })
      );
      continue;
    }
    if (verifier === "unmapped") {
      // REM-001.6: an unmapped check still yields a result (UNKNOWN), so the
      // plan reconciliation sees the debt instead of silently skipping.
      results.push(
        unknownResult({
          checkId,
          verifier,
          requirement,
          reasonCode: "VERIFIER_NOT_MAPPED",
          reason: `no verifier is registered for ${requirement}`
        })
      );
      continue;
    }

    try {
      if (
        requirement === "math_verification" ||
        requirement === "symbolic_verification" ||
        requirement === "ode_residual_verification"
      ) {
        if (config.verifyMath === false) {
          results.push(
            disabledResult(
              verifier,
              requirement,
              "MATH_DISABLED",
              "mathematical verification is disabled"
            )
          );
          continue;
        }
        if (!consumeOrExhaust(requirement, verifier)) continue;
        const raw = await verifyMathClaim({
          claim,
          kind: requirement === "math_verification" ? "numeric" : "symbolic",
          executeSage,
          signal
        });
        if (raw?.evidence?.id) generatedEvidence.push(raw.evidence);
        results.push(normalizeMathResult(raw, requirement));
        continue;
      }

      if (
        requirement === "execution_evidence" ||
        requirement === "test_evidence" ||
        requirement === "benchmark_evidence" ||
        requirement === "observation_evidence" ||
        requirement === "analysis_execution_or_source_artifact" ||
        requirement === "verifier_result"
      ) {
        if (config.verifyExecutionClaims === false) {
          results.push(
            disabledResult(
              verifier,
              requirement,
              "EXECUTION_VERIFICATION_DISABLED",
              "execution-claim verification is disabled"
            )
          );
          continue;
        }
        if (!consumeOrExhaust(requirement, verifier)) continue;
        results.push(normalizeExecutionResult(verifyExecutionClaim({ claim, evidence }), requirement));
        continue;
      }

      if (requirement === "source_identity" || requirement === "primary_source") {
        if (config.verifyCitations === false) {
          results.push(
            disabledResult(
              verifier,
              requirement,
              "CITATION_VERIFICATION_DISABLED",
              "citation verification is disabled"
            )
          );
          continue;
        }
        if (!consumeOrExhaust(requirement, verifier)) continue;
        const raw = await resolveBibliographicIdentity(
          buildCitationIdentityInput(claim, sourceContext),
          citationProviders ?? {},
          { signal }
        );
        results.push(normalizeIdentityResult(raw, requirement));
        continue;
      }

      if (requirement === "source_entailment") {
        if (config.verifyCitations === false) {
          results.push(
            disabledResult(
              verifier,
              requirement,
              "CITATION_VERIFICATION_DISABLED",
              "citation verification is disabled"
            )
          );
          continue;
        }
        const binding = resolveSourceBinding(claim, sourceContext);
        if (!binding?.evidenceId || !Array.isArray(binding.passages) || binding.passages.length === 0) {
          results.push(
            unknownResult({
              verifier,
              requirement,
              reasonCode: "SOURCE_BINDING_MISSING",
              reason: "no claim-specific source evidence and passages are bound to this claim"
            })
          );
          continue;
        }
        if (!consumeOrExhaust(requirement, verifier)) continue;
        const raw = await checkEntailment({
          claim,
          source: binding.source ?? null,
          passages: binding.passages,
          client,
          signal
        });
        const normalized = normalizeEntailmentResult(raw, requirement);
        if (raw?.verdict === ENTAILMENT_VERDICT.SUPPORTED) {
          normalized.evidenceIds = [binding.evidenceId];
        }
        results.push(normalized);
      }
    } catch (err) {
      results.push(
        unknownResult({
          verifier,
          requirement,
          reasonCode: "VERIFIER_ERROR",
          reason: `verifier failed without a conclusive result: ${String(err?.message ?? err)}`
        })
      );
    }
  }

  const certificates = [];
  const augmentedResults = results.map((result) => {
    const checkId = result.checkId ?? planCheckIdFor(result.requirement) ?? null;
    const certificate = buildResultCertificate(result, claim);
    if (certificate) certificates.push(certificate);
    // R03-PATCH-03: aggregate real sub-checks when a verifier reports them
    // (e.g. Sage commutator/normalization/recurrence), never a bare "exit 0".
    const subcheckAggregate =
      Array.isArray(result.subchecks) && result.subchecks.length > 0
        ? aggregateSubchecks(result.subchecks)
        : null;
    let scope = null;
    if (certificate && claim?.expectedCertificateScope) {
      const checked = checkVerifierScope({
        claim,
        certificate,
        modelingBridge: modelingBridge ?? null
      });
      scope = {
        status: checked.status,
        established: [...checked.established],
        missing: [...checked.missing],
        extraAssumptions: [...checked.extraAssumptions],
        failureCodes: [...new Set(checked.failureCodes)]
      };
    }
    let status = result.status;
    const extraCodes = new Set(result.failureCodes ?? []);
    // §43 R02-PATCH-14: a PASS only authorizes when the certificate scope also
    // matches; PASS + non-MATCH scope never verifies. The downgrade runs only
    // for claims that pre-declare an expected certificate scope, so the
    // existing corpus (no declared scope) keeps its established behavior and
    // no protected claim is granted a MATCH by default.
    if (
      claim?.expectedCertificateScope &&
      status === NORMALIZED_VERDICT.PASSED &&
      scope &&
      scope.status !== VERIFIER_SCOPE_STATUS.MATCH
    ) {
      status = NORMALIZED_VERDICT.UNKNOWN;
      for (const code of scope.failureCodes ?? []) extraCodes.add(code);
    }
    return {
      ...result,
      status,
      checkId,
      certificate,
      scope,
      subcheckAggregate,
      failureCodes: [...extraCodes]
    };
  });

  const planReconciliation = verificationPlan
    ? reconcileVerificationPlan(
        verificationPlan,
        augmentedResults.map(({ checkId, status: resultStatus }) => ({
          checkId,
          status: resultStatus
        }))
      )
    : null;

  return {
    claimId: claim?.id ?? null,
    verificationPlan,
    planReconciliation,
    requested: requirements,
    executed,
    results: augmentedResults,
    certificates,
    generatedEvidence,
    budgetUsed: callBudget.used - startedUsed,
    budgetExhausted: results.some((result) => result.reasonCode === "VERIFIER_BUDGET_EXHAUSTED")
  };
}
