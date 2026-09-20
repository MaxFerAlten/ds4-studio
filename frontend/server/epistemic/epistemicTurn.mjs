/**
 * DS4 Quantum Fix — per-turn epistemic state.
 *
 * QF-14 §36 calls createEpistemicTurn and evaluateEpistemicTurn from index.mjs
 * without defining them: this is that binding. It holds the turn's evidence and
 * ledger, and at the end runs the extraction and the finalization gate as one
 * call, so the route has a single object to create and a single decision to
 * read.
 *
 * Two rules govern everything here. It runs inside the live chat loop, so
 * collection must never be able to fail the turn it is observing; and the gate
 * fails closed in block mode, because a gate that could not run is not a gate
 * that passed (§262).
 */

import { EpistemicLedger } from "./epistemicLedger.mjs";
import { TurnEvidence } from "./epistemicEvidence.mjs";
import { extractEpistemicClaims } from "./epistemicClaimExtractor.mjs";
import { evaluateEpistemicFinalCandidate } from "./epistemicFinalizationGate.mjs";
import { buildEpistemicShadowTrace } from "./epistemicShadow.mjs";
import {
  bindEvidenceToClaim,
  createVerifierBudget,
  dispatchClaimVerifiers
} from "./epistemicVerifierDispatcher.mjs";
import {
  PROMOTION_DECISION,
  decideClaimPromotion
} from "./epistemicPromotionGate.mjs";
import { planSelfCritique } from "./epistemicSelfCritique.mjs";
import { extractSelfChallenges } from "./epistemicSelfChallengeExtractor.mjs";
import { openChallengeDebt } from "./epistemicChallengeDebt.mjs";
import {
  PROOF_DEPENDENCY_STATUS,
  assertsLeanProof,
  auditLeanSource,
  certificateScopeMismatch,
  proofClaimFailureCodes
} from "./epistemicLeanAxiomAudit.mjs";
import { domainInvariantFailureCodes } from "./epistemicDomainInvariants.mjs";
import { capabilityGaps } from "./epistemicModelCapabilities.mjs";
import { classifySourceClaimRole, sourceRolePromotion } from "./epistemicSourceRole.mjs";
import {
  deriveUserVerificationContract,
  requiredMechanismsForClaim
} from "./epistemicUserVerificationContract.mjs";
import { leanCertificateFromToolResult } from "./epistemicLeanCertificateAdapter.mjs";
import { bindFormalArtifacts } from "./epistemicFormalArtifactBinding.mjs";
import { evaluateClaimCoverage } from "./epistemicClaimCoverage.mjs";
import { buildRepairDebt } from "./epistemicRepairPolicy.mjs";

const INACTIVE_CONFIG = Object.freeze({ enabled: false, mode: "off" });

const MAX_EPISTEMIC_REASONING_CHARS = 32_000;

/**
 * Whether candidate assistant prose must be withheld until the gate has ruled.
 *
 * QF-15 §37. Only block mode owes a verdict before publication; shadow keeps
 * streaming and reports what block would have done. withholdOutput exists so an
 * operator can run block mode without the buffering, so it is read rather than
 * assumed — but only an explicit false turns it off.
 */
export function withholdsOutput(config) {
  return (
    config?.enabled === true && config?.mode === "block" && config?.withholdOutput !== false
  );
}

/**
 * Create the epistemic state for one turn.
 *
 * @param {{sessionKey?: string, revision?: number, config?: object, userText?: string}} [input]
 */
export function createEpistemicTurn({
  sessionKey = null,
  revision = null,
  config = {},
  userText = ""
} = {}) {
  const settings = config && typeof config === "object" ? config : INACTIVE_CONFIG;
  const evidence = new TurnEvidence();
  const ledger = new EpistemicLedger();
  const text = String(userText ?? "");
  // Q2-001/Q2-002 (§4.3, §5): derived here, from the user's words only. The
  // contract is not a parameter, so no caller — and no repair round reusing a
  // caller — can hand in a weakened one.
  const verificationContract = deriveUserVerificationContract({ userText: text });

  const turn = {
    sessionKey,
    revision,
    userText: text,
    verificationContract,
    config: settings,
    enabled: settings.enabled === true && settings.mode !== "off",
    evidence,
    ledger,
    challenges: [],
    modelingBridges: [],
    repairState: { summarizing: false, round: 0 },
    // What each lean_check run in this turn actually established (§30).
    leanAudits: [],

    /**
     * Record a tool result as evidence. Never throws: this sits on the tool
     * path, and an observer must not be able to break the call it observes.
     */
    addToolResult(call) {
      const item = evidence.addToolResult(call);
      if (call?.toolName === "lean_check") {
        // Audited from the submitted source, not from the evidence summary:
        // the summary is truncated, and an axiom past the cut would read clean.
        const source = String(call?.arguments?.code ?? "");
        this.leanAudits.push({
          evidenceId: item?.id ?? null,
          source,
          audit: auditLeanSource(source),
          // Q2-005: the runtime's own target-identity verdict travels with the
          // run. `raw` is the lean contract result as agentTools returns it.
          result:
            call?.rawResult?.raw && typeof call.rawResult.raw === "object"
              ? call.rawResult.raw
              : {}
        });
      }
      return item;
    },

    /** Challenges raised against prior claims in this turn (QF-07). */
    noteChallenges(list = []) {
      for (const challenge of Array.isArray(list) ? list : []) {
        if (challenge) this.challenges.push(challenge);
      }
      return this.challenges.length;
    },

    /** Record an independently evidenced cross-domain bridge for this turn. */
    noteModelingBridge(bridge) {
      if (bridge && typeof bridge === "object") this.modelingBridges.push(bridge);
      return this.modelingBridges.length;
    },

    /** Mark this turn as summarising a repair, which tightens §35's sixth rule. */
    markRepairSummary(round = 1) {
      this.repairState = { summarizing: true, round };
    },

    canRepair() {
      const max = Number.isInteger(settings.maxRepairRounds) ? settings.maxRepairRounds : 0;
      return this.repairState.round < max;
    },

    beginRepair() {
      this.repairState = {
        ...this.repairState,
        summarizing: false,
        round: this.repairState.round + 1
      };
      return this.repairState.round;
    },

    snapshot() {
      return {
        sessionKey,
        revision,
        enabled: this.enabled,
        mode: settings.mode ?? "off",
        evidenceCount: evidence.size,
        droppedEvidence: evidence.dropped.length,
        challengeCount: this.challenges.length,
        contractId: verificationContract.id,
        coverageMode: verificationContract.coverageMode,
        ...ledger.snapshot()
      };
    }
  };

  // §5: immutable across repair rounds. Reassignment is the only way the
  // contract could be renegotiated mid-turn, so the slot itself is closed.
  Object.defineProperty(turn, "verificationContract", {
    value: verificationContract,
    writable: false,
    configurable: false,
    enumerable: true
  });
  return turn;
}

/**
 * Q2-008 (§11) — which kind of formal debt a failed Lean run leaves.
 *
 * The distinction matters for the repair: an environment failure asks for a
 * rerun, an incomplete proof asks for the proof, and a scope mismatch asks for
 * a different theorem. None of them licence "Lean verified it".
 */
const LEAN_CHALLENGE_CLASS = Object.freeze({
  INCOMPLETE: "FORMAL_PROOF_INCOMPLETE",
  UNPROVEN: "FORMAL_TARGET_FALSE_OR_UNPROVEN",
  ENVIRONMENT: "FORMAL_ENVIRONMENT_UNAVAILABLE",
  SCOPE: "FORMAL_TARGET_SCOPE_MISMATCH"
});

const LEAN_CHALLENGE_TEXT = Object.freeze({
  [LEAN_CHALLENGE_CLASS.INCOMPLETE]:
    "the submitted Lean proof contains sorry/admit or a postulated assumption and closes nothing",
  [LEAN_CHALLENGE_CLASS.UNPROVEN]:
    "no Lean run in this turn established the locked target for this claim",
  [LEAN_CHALLENGE_CLASS.ENVIRONMENT]:
    "the Lean run did not complete (timeout or environment failure), so the target is unchecked",
  [LEAN_CHALLENGE_CLASS.SCOPE]:
    "the Lean run checked a statement other than the locked target for this claim"
});

const LEAN_ENVIRONMENT_STATUS = new Set(["timeout", "error", "unavailable", "cancelled"]);

function leanChallengeClass(leanAudits, certificates) {
  if (leanAudits.some((entry) => entry.audit?.sorries === true)) {
    return LEAN_CHALLENGE_CLASS.INCOMPLETE;
  }
  if (leanAudits.some((entry) => (entry.audit?.localAxioms?.length ?? 0) > 0)) {
    return LEAN_CHALLENGE_CLASS.INCOMPLETE;
  }
  if (
    leanAudits.some((entry) =>
      LEAN_ENVIRONMENT_STATUS.has(String(entry.result?.status ?? "").toLowerCase())
    )
  ) {
    return LEAN_CHALLENGE_CLASS.ENVIRONMENT;
  }
  if (certificates.some((certificate) => certificate.integrationGap !== null)) {
    return LEAN_CHALLENGE_CLASS.SCOPE;
  }
  return LEAN_CHALLENGE_CLASS.UNPROVEN;
}

function dependencyStatesFor(ledger, claim) {
  return Object.fromEntries(
    (claim.dependencies ?? []).map((id) => [id, ledger.getClaim(id)?.status ?? "UNKNOWN"])
  );
}

function dependencyFailureReason(claimId) {
  const safe = String(claimId ?? "CLAIM")
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]/g, "_")
    .slice(0, 80);
  return `PREMISE_${safe}_REJECTED`;
}

function applyPromotionDecision(ledger, claim, promotion) {
  ledger.recordFailureCodes(claim.id, promotion.failureCodes ?? []);
  switch (promotion.decision) {
    case PROMOTION_DECISION.VERIFY:
      ledger.transition(claim.id, "VERIFIED", { requirementsComplete: true });
      return "VERIFIED";
    case PROMOTION_DECISION.PARTIAL:
      ledger.transition(claim.id, "PARTIAL");
      return "PARTIAL";
    case PROMOTION_DECISION.REJECT: {
      const contradicted = (claim.verifierResults ?? []).some(
        (result) =>
          result?.status === "FAILED" &&
          ["CONTRADICTED", "MATH_REFUTED", "MISMATCH"].includes(
            String(result?.reasonCode ?? "")
          )
      );
      const state = contradicted ? "CONTRADICTED" : "REJECTED";
      ledger.transition(claim.id, state);
      ledger.invalidateDependents(claim.id, dependencyFailureReason(claim.id));
      return state;
    }
    case PROMOTION_DECISION.UNKNOWN:
    default:
      ledger.transition(claim.id, "UNKNOWN");
      return "UNKNOWN";
  }
}

function sessionBlockedPromotion(promotion, sessionDecision) {
  if (sessionDecision?.allowed !== false || promotion.decision !== PROMOTION_DECISION.VERIFY) {
    return promotion;
  }
  return Object.freeze({
    ...promotion,
    decision: PROMOTION_DECISION.UNKNOWN,
    hardFailures: Object.freeze([
      ...new Set([...(promotion.hardFailures ?? []), "SESSION_REPROMOTION_BLOCKED"])
    ]),
    requiredRepair: sessionDecision.reason ?? "produce new claim-specific evidence"
  });
}

/**
 * Extract this turn's claims and decide whether the answer may be published.
 *
 * @param {object} turn - from createEpistemicTurn.
 * @param {object} [input]
 * @param {string} [input.assistantContent]
 * @param {string} [input.assistantReasoning]
 * @param {object|null} [input.client]
 * @param {Function|null} [input.executeSage]
 * @param {object|null} [input.citationProviders]
 * @param {object|null} [input.sourceContext]
 * @param {object|null} [input.sessionLedger]
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<object>} the finalization decision, with `extraction` attached.
 */
export async function evaluateEpistemicTurn(
  turn,
  {
    assistantContent = "",
    assistantReasoning = "",
    client = null,
    executeSage = null,
    citationProviders = null,
    sourceContext = null,
    sessionLedger = null,
    signal
  } = {}
) {
  if (!turn?.enabled) {
    return {
      ...evaluateEpistemicFinalCandidate({ config: INACTIVE_CONFIG }),
      extraction: null,
      snapshot: null
    };
  }

  try {
    // §75: a rewording is not a new claim. Without the claims already on the
    // ledger there is nothing to inherit debt from, and a paraphrase would
    // arrive with a clean record.
    // R05-PATCH-02: the session's prior claims (rejected/unresolved/accepted,
    // priority-ordered) enter cross-turn semantic matching too, so a paraphrase
    // of a claim rejected in an earlier turn cannot escape its rejection.
    const sessionPrior =
      typeof sessionLedger?.priorClaimsForMatching === "function"
        ? sessionLedger.priorClaimsForMatching()
        : [];
    const priorClaims = [
      ...sessionPrior,
      ...turn.ledger.allClaims()
    ];
    const extraction = await extractEpistemicClaims({
      text: assistantContent,
      client,
      maxClaims: Number.isInteger(turn.config.maxClaimsPerTurn) ? turn.config.maxClaimsPerTurn : undefined,
      priorClaims,
      signal
    });

    const activeClaims = [];
    for (const extracted of extraction.claims) {
      let claim = turn.ledger.findByText(extracted.text);
      if (!claim) {
        try {
          claim = turn.ledger.addClaim(extracted);
        } catch {
          continue;
        }
      }
      activeClaims.push(claim);
    }

    // Claims imported and challenged at user-turn start, plus any replacement
    // claims proposed by that challenge, must traverse the same verifier path.
    for (const existing of turn.ledger.allClaims()) {
      if (
        (existing.status === "CHALLENGED" || existing.status === "PROPOSED") &&
        !activeClaims.some((claim) => claim.id === existing.id)
      ) {
        activeClaims.push(existing);
      }
    }

    // RFQ001-04 §22: an objection the answer raises against its own claims is
    // debt on those claims. It is recorded before verification runs, so the
    // promotion gate sees it whatever the rest of the turn produces — and it
    // never touches claim state, because the objection may itself be wrong.
    const boundedReasoning = String(assistantReasoning ?? "").slice(-MAX_EPISTEMIC_REASONING_CHARS);
    const selfChallengeText = [
      String(boundedReasoning).trim(),
      String(assistantContent ?? "").trim()
    ]
      .filter(Boolean)
      .join("\n\n");

    const selfChallenges = await extractSelfChallenges({
      text: selfChallengeText,
      knownClaims: activeClaims,
      client,
      signal
    });
    for (const challenge of selfChallenges.challenges) {
      try {
        turn.ledger.noteChallenge({
          claimId: challenge.targetClaimId,
          origin: "MODEL_SELF",
          text: challenge.text,
          severity: challenge.severity,
          challengeClass: challenge.challengeClass
        });
      } catch {
        // Binding a challenge must not fail the turn it is observing.
      }
    }

    const initialStates = new Map(activeClaims.map((claim) => [claim.id, claim.status]));
    const selfCritiquePlan = planSelfCritique({
      assistantContent,
      claims: activeClaims,
      challenges: turn.challenges,
      userText: turn.userText
    });
    const selfCritiqueRequests = selfCritiquePlan.triggered ? selfCritiquePlan.requests : [];
    for (const request of selfCritiqueRequests) {
      const claim = turn.ledger.getClaim(request.claimId);
      if (!claim || !request.requirement) continue;
      if (!claim.verificationRequirements.includes(request.requirement)) {
        claim.verificationRequirements.push(request.requirement);
      }
    }

    for (const claim of activeClaims) {
      if (claim.status === "CHALLENGED") {
        turn.ledger.transition(claim.id, "VERIFICATION_PENDING");
      }
      if (claim.status === "PROPOSED") turn.ledger.transition(claim.id, "CLASSIFIED");
      const requirements = Array.isArray(claim.verificationRequirements)
        ? claim.verificationRequirements
        : [];
      if (requirements.length === 0) continue;
      if (claim.status === "CLASSIFIED") {
        turn.ledger.transition(claim.id, "EVIDENCE_REQUIRED");
      }
      if (claim.status === "EVIDENCE_REQUIRED") {
        turn.ledger.transition(claim.id, "VERIFICATION_PENDING");
      }
    }

    const sessionBlocks = new Map();
    if (sessionLedger && typeof sessionLedger.canPromote === "function") {
      for (const claim of activeClaims) {
        const prior = sessionLedger.canPromote(claim.text, claim.evidenceIds ?? []);
        if (prior?.allowed === false) sessionBlocks.set(claim.id, prior);
      }
    }

    const verifierBudget = createVerifierBudget(
      Number.isInteger(turn.config.maxVerifierCallsPerTurn)
        ? turn.config.maxVerifierCallsPerTurn
        : 0
    );
    const verificationByClaim = new Map();
    for (const claim of activeClaims) {
      if (claim.status !== "VERIFICATION_PENDING") continue;
      const verification = await dispatchClaimVerifiers({
        claim,
        evidence: turn.evidence.items,
        client,
        executeSage,
        citationProviders,
        sourceContext,
        modelingBridge:
          turn.modelingBridges.find((bridge) => bridge?.claimId === claim.id) ?? null,
        config: turn.config,
        budget: verifierBudget,
        signal
      });
      verificationByClaim.set(claim.id, verification);

      for (const generated of verification.generatedEvidence ?? []) {
        if (!generated?.id) continue;
        if (!turn.evidence.items.some((item) => item.id === generated.id)) {
          turn.evidence.add(generated);
        }
      }
      for (const result of verification.results ?? []) {
        bindEvidenceToClaim({ turnEvidence: turn.evidence, claimId: claim.id, result });
        for (const evidenceId of result.evidenceIds ?? []) {
          if (turn.evidence.items.some((item) => item.id === evidenceId)) {
            turn.ledger.attachEvidence(claim.id, evidenceId);
          }
        }
        turn.ledger.recordVerifierResult(claim.id, result);
      }
      // REM-003: persist the bounded plan-reconciliation summary on the claim
      // so mandatory coverage is authoritative for promotion (F29 when a
      // mandatory check is missing/failed/unknown). Recorded AFTER the verifier
      // results so the F29 it propagates is not folded back into claim.severity
      // by recordVerifierResult's severity recompute. A claim with no plan gets
      // null — the promotion gate treats a null plan for a requirement-less
      // claim as not-an-error.
      if (verification.planReconciliation) {
        turn.ledger.recordVerificationPlanSummary(
          claim.id,
          {
            planId: verification.verificationPlan?.id ?? null,
            status: verification.planReconciliation.status,
            coverage: verification.planReconciliation.coverage,
            mandatoryPassed: verification.planReconciliation.mandatoryPassed,
            mandatoryFailedOrMissing: verification.planReconciliation.mandatoryFailedOrMissing,
            missingMandatoryCheckIds: verification.planReconciliation.missingMandatoryCheckIds ?? [],
            failedMandatoryCheckIds: verification.planReconciliation.failedMandatoryCheckIds ?? []
          }
        );
      }
    }

    // §35: "Lean proved P" needs a run whose dependencies were audited and
    // found to rest on nothing postulated. A file declaring `axiom P`
    // elaborates fine and proves nothing, so the codes land on the claim
    // before the promotion gate reads its severity.
    const leanAudits = Array.isArray(turn.leanAudits) ? turn.leanAudits : [];
    const leanSource = leanAudits.map((entry) => entry.source ?? "").join("\n");
    const dirtyAudit = leanAudits.some((entry) => entry.audit.status === PROOF_DEPENDENCY_STATUS.CLEAN)
      ? null
      : leanAudits[0]?.audit ?? null;
    if (leanAudits.length > 0) {
      for (const claim of activeClaims) {
        if (!assertsLeanProof(claim.text)) continue;
        const codes = dirtyAudit ? [...proofClaimFailureCodes(dirtyAudit)] : [];
        // §48: clean dependencies still do not make a proof about naturals a
        // proof about the physics the sentence names.
        const scope = certificateScopeMismatch({ claimText: claim.text, source: leanSource });
        codes.push(...scope.failureCodes);
        if (codes.length === 0) continue;
        turn.ledger.recordFailureCodes(claim.id, [...new Set(codes)]);
        try {
          turn.ledger.noteChallenge({
            claimId: claim.id,
            origin: "VERIFIER",
            text: dirtyAudit?.details[0] ?? scope.reason ?? "the Lean run does not establish this proposition",
            severity: 5
          });
        } catch {
          // The failure codes already carry the block; the debt is the record.
        }
      }
    }

    // Q2-008 (§11) — a Lean run that did not establish its locked target is
    // debt on the semantic claim, not silence. A timeout and a refutation are
    // not the same event, so the class distinguishes them: neither makes the
    // claim false, and neither lets the answer say Lean proved it.
    const leanCertificatesByClaim = new Map();
    for (const claim of activeClaims) {
      const contractRequiresLean = requiredMechanismsForClaim({
        claim,
        verificationContract: turn.verificationContract
      }).includes("lean_proof");
      if (!contractRequiresLean && !assertsLeanProof(claim.text)) continue;

      const certificates = leanAudits.map((entry) =>
        leanCertificateFromToolResult({
          claim,
          source: entry.source,
          result: entry.result ?? {}
        })
      );
      leanCertificatesByClaim.set(claim.id, certificates);
      if (certificates.some((certificate) => certificate.status === "PASSED")) continue;

      const challengeClass = leanChallengeClass(leanAudits, certificates);
      turn.ledger.recordFailureCodes(claim.id, ["F18"]);
      try {
        turn.ledger.noteChallenge({
          claimId: claim.id,
          origin: "VERIFIER",
          challengeClass,
          text: LEAN_CHALLENGE_TEXT[challengeClass],
          severity: 4
        });
      } catch {
        // The failure code already carries the block; the debt is the record.
      }
    }

    // §41, §55: what the claim says against what the domain and the
    // formalization allow. Both are decided without calling anything — a
    // refuted inference and a model that cannot state the claim are failures
    // of the answer, not questions for a verifier.
    for (const claim of activeClaims) {
      const codes = domainInvariantFailureCodes(claim.text);
      if (leanAudits.length > 0) {
        codes.push(...capabilityGaps({ claimText: claim.text, source: leanSource }).failureCodes);
      }
      if (codes.length > 0) turn.ledger.recordFailureCodes(claim.id, [...new Set(codes)]);
    }

    // §52: a proposition the paper only assumed does not become a fact about
    // the world by being quoted accurately.
    if (sourceContext && typeof sourceContext.forClaim === "function") {
      for (const claim of activeClaims) {
        const binding = sourceContext.forClaim(claim.id);
        const passage = (binding?.passages ?? []).join(" ");
        if (!passage.trim()) continue;
        const role = await classifySourceClaimRole({ claim, passage, client, signal });
        const promotion = sourceRolePromotion({ claimText: claim.text, role: role.role });
        if (promotion.promoted) {
          turn.ledger.recordFailureCodes(claim.id, promotion.failureCodes);
          try {
            turn.ledger.noteChallenge({
              claimId: claim.id,
              origin: "SOURCE",
              text: promotion.reason,
              severity: 4
            });
          } catch {
            // The failure code carries the block; the debt is the record.
          }
        }
      }
    }

    // §19: only a verifier that ran, passed and bound evidence closes a
    // challenge — and only when nothing else failed in the same turn.
    for (const claim of activeClaims) {
      const debt = openChallengeDebt({ claimId: claim.id, history: turn.ledger.history });
      if (debt.total === 0) continue;
      const results = verificationByClaim.get(claim.id)?.results ?? [];
      if (results.length === 0 || results.some((result) => result?.status === "FAILED")) continue;
      const evidenceIds = results
        .filter((result) => result?.status === "PASSED")
        .flatMap((result) => result.evidenceIds ?? []);
      if (evidenceIds.length === 0) continue;
      for (const item of debt.items) {
        try {
          turn.ledger.resolveChallenge({
            claimId: claim.id,
            challengeId: item.id,
            status: "RESOLVED_SUPPORTED",
            evidenceIds
          });
        } catch {
          // A debt that cannot be closed stays open, which is the safe side.
        }
      }
    }

    const promotions = [];
    for (const claim of activeClaims) {
      if (claim.status !== "VERIFICATION_PENDING") continue;
      let promotion = decideClaimPromotion({
        claim,
        verifierResults: claim.verifierResults,
        dependencyStates: dependencyStatesFor(turn.ledger, claim),
        evidence: turn.evidence.items,
        history: turn.ledger.history,
        policy: { blockSeverity: turn.config.blockSeverity }
      });
      if (sessionLedger && typeof sessionLedger.canPromote === "function") {
        const refreshed = sessionLedger.canPromote(claim.text, claim.evidenceIds ?? []);
        if (refreshed?.allowed === false) {
          sessionBlocks.set(claim.id, refreshed);
          promotion = sessionBlockedPromotion(promotion, refreshed);
        } else {
          sessionBlocks.delete(claim.id);
        }
      }
      const finalState = applyPromotionDecision(turn.ledger, claim, promotion);
      promotions.push({ claimId: claim.id, finalState, promotion });
    }

    const leanCertificates = [...leanCertificatesByClaim.values()].flat();
    const formalArtifacts = bindFormalArtifacts({
      assistantContent,
      certificates: leanCertificates
    });
    const claimCoverage = evaluateClaimCoverage({
      assistantContent,
      claims: turn.ledger.allClaims(),
      verificationContract: turn.verificationContract,
      extractionStatus: extraction.status
    });

    // Q2-011 (§25): only what a retrieval really returned reaches the gate. A
    // turn whose source context was never populated contributes nothing, which
    // leaves every bibliographic claim unsupported rather than certified.
    const sourceCertificates = activeClaims
      .map((claim) => {
        const record = sourceContext?.forClaim?.(claim.id)?.source;
        return record ? { ...record, claimId: claim.id } : null;
      })
      .filter(Boolean);

    const decision = evaluateEpistemicFinalCandidate({
      assistantContent,
      claims: turn.ledger.allClaims(),
      evidence: turn.evidence.items,
      challenges: turn.challenges,
      bridges: turn.modelingBridges,
      sourceCertificates,
      verificationContract: turn.verificationContract,
      extractionStatus: extraction.status,
      leanCertificates,
      formalArtifacts,
      repairState: turn.repairState,
      config: turn.config
    });

    // Q2-015 (§40): what a repair round still owes, as data rather than prose.
    const repairDebt = buildRepairDebt({
      claimCoverage,
      formalArtifacts,
      claims: turn.ledger.allClaims()
    });

    const result = {
      ...decision,
      extraction: { status: extraction.status, source: extraction.source },
      verificationContract: turn.verificationContract,
      claimCoverage,
      formalArtifacts,
      // Q2-018 (§33.1): the metric runner has to see which mechanism really
      // satisfied each claim, not re-derive it from prose.
      leanCertificates,
      repairDebt,
      verifierSummary: {
        budgetLimit: verifierBudget.limit,
        budgetUsed: verifierBudget.used,
        claimsProcessed: verificationByClaim.size,
        sessionBlocks: sessionBlocks.size
      },
      promotions,
      selfCritiqueAudit: {
        triggered: selfCritiquePlan.triggered,
        requests: selfCritiqueRequests.map(({ claimId, requirement, verifier, reason }) => ({
          claimId,
          requirement,
          verifier,
          reason
        })),
        stateChanges: activeClaims.map((claim) => ({
          claimId: claim.id,
          from: initialStates.get(claim.id),
          to: claim.status,
          verifierResults: (claim.verifierResults ?? []).map((verifierResult) => ({
            verifier: verifierResult.verifier,
            requirement: verifierResult.requirement,
            status: verifierResult.status,
            reasonCode: verifierResult.reasonCode,
            evidenceIds: [...(verifierResult.evidenceIds ?? [])]
          }))
        })),
        agreementWeight: selfCritiquePlan.agreementWeight,
        source: selfCritiquePlan.source
      },
      snapshot: turn.snapshot()
    };
    if (turn.config?.mode === "shadow") {
      result.shadowTrace = buildEpistemicShadowTrace({
        decision,
        extraction,
        claims: extraction.claims,
        evidence: turn.evidence.items,
        assistantContent,
        challengeTurn: turn.challenges.length > 0
      });
    }
    return result;
  } catch (err) {
    // In block mode an unrunnable gate is a failure, not a pass (§262). In
    // shadow it must not change the turn, so the error is reported and the
    // answer ships.
    const blocking = turn.config?.mode === "block";
    // Whatever broke above may well break here: the handler that exists so the
    // turn survives must not be the thing that takes it down.
    let snapshot = null;
    try {
      snapshot = turn.snapshot?.() ?? null;
    } catch {
      snapshot = null;
    }
    const result = {
      allowed: !blocking,
      terminal: false,
      mustContinue: blocking,
      code: "EPISTEMIC_GATE_ERROR",
      guidance: blocking
        ? `EPISTEMIC_GATE_ERROR: the epistemic gate could not run (${String(err?.message ?? err)}). ` +
          "Nothing was verified, so nothing may be published as verified."
        : "",
      finishReason: null,
      blockedClaimIds: [],
      wouldBlock: true,
      extraction: null,
      snapshot,
      error: String(err?.message ?? err)
    };
    if (turn.config?.mode === "shadow") {
      result.shadowTrace = buildEpistemicShadowTrace({
        decision: result,
        extraction: null,
        claims: [],
        evidence: turn.evidence?.items ?? [],
        assistantContent,
        challengeTurn: (turn.challenges?.length ?? 0) > 0
      });
    }
    return result;
  }
}
