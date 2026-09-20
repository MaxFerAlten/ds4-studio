// quantiumCorpus.mjs — shared Quantium hardened-corpus runner (REM-010.3).
//
// The escape-rate and byte-leak evidence the e2e tests assert and the certifier
// reads must come from one source of truth. This module owns the corpus replay
// loop and metric derivation; both `quantiumHallucination.e2e.test.mjs` and
// `quantiumMetrics.mjs` (the certifier's metric runner) import it, so the corpus
// logic is never duplicated.

import { AuthoritativeOutputBuffer } from "../authoritativeOutputBuffer.mjs";
import { calculateEpistemicEscapeRate } from "./epistemicEscapeRate.mjs";
import { EpistemicSessionLedger } from "./epistemicSessionLedger.mjs";
import { createEpistemicTurn, evaluateEpistemicTurn, withholdsOutput } from "./epistemicTurn.mjs";
import { QUANTIUM_HARDENED_CONFIG, QUANTIUM_TURNS } from "./fixtures/quantiumConversation.mjs";
import { EpistemicSourceContext } from "./epistemicSourceContext.mjs";
import { measureStrictMetrics } from "./epistemicStrictMetrics.mjs";
import { QHO_LLM_ADVERSARIAL } from "./fixtures/qhoLlmAdversarialConversation.mjs";

export function extractionClient(claims) {
  return {
    async completeRole({ roleName }) {
      if (roleName !== "epistemic_claim_extractor") {
        throw new Error(`unexpected semantic role ${roleName}`);
      }
      return { json: { claims }, content: JSON.stringify({ claims }) };
    }
  };
}

export async function runFixture(fixture, config, session) {
  session.beginTurn();
  const turn = createEpistemicTurn({
    sessionKey: "quantium-regression",
    revision: Number(fixture.id.slice(1)),
    config,
    userText: fixture.user ?? ""
  });
  for (const claim of session.acceptedClaims()) turn.ledger.importSnapshotClaim(claim);
  if (fixture.challengeTurn) {
    turn.noteChallenges([{ id: `${fixture.id}_challenge`, targetClaimId: "prior_reference" }]);
  }

  const published = [];
  const publishedReasoning = [];
  const buffer = new AuthoritativeOutputBuffer();
  const reasoningBuffer = new AuthoritativeOutputBuffer();
  if (withholdsOutput(config)) {
    buffer.append(fixture.assistant);
    if (fixture.reasoning) reasoningBuffer.append(fixture.reasoning);
  } else {
    published.push(fixture.assistant);
    if (fixture.reasoning) publishedReasoning.push(fixture.reasoning);
  }
  const publishedBeforeGate = [...published];
  const publishedBeforeGateReasoning = [...publishedReasoning];

  const decision = await evaluateEpistemicTurn(turn, {
    assistantContent: fixture.assistant,
    client: extractionClient(fixture.claims),
    citationProviders: {},
    sessionLedger: session
  });
  const claims = turn.ledger.allClaims();
  session.stageClaims(claims);
  let sessionDelta = { accepted: [], rejected: [], unresolved: [] };
  if (decision.allowed) {
    sessionDelta = session.commitClaims(claims);
    buffer.flush((chunk) => published.push(chunk));
    reasoningBuffer.flush((chunk) => publishedReasoning.push(chunk));
  } else {
    session.discardCandidate(decision.code);
    buffer.discard();
    reasoningBuffer.discard();
  }

  return { turn, claims, decision, published, publishedBeforeGate, publishedBeforeGateReasoning, publishedReasoning, sessionDelta };
}

/**
 * Run the hardened Quantium corpus once and return escape-rate metrics.
 *
 * An optional `precomputed` outcomes array can be supplied so a test that already
 * ran the loop does not run it twice; when omitted the corpus is executed here.
 */
export async function runQuantiumHallucinationCorpus(precomputed = null) {
  const outcomes =
    precomputed ??
    (await (async () => {
      const s = new EpistemicSessionLedger();
      const o = [];
      for (const fixture of QUANTIUM_TURNS) {
        o.push({ fixture, ...(await runFixture(fixture, QUANTIUM_HARDENED_CONFIG, s)) });
      }
      return o;
    })());
  const escape = calculateEpistemicEscapeRate(
    outcomes
      .filter(({ fixture }) => fixture.invalidSeverity >= 4)
      .map(({ fixture, published }) => ({
        claim: {
          id: fixture.id,
          invalid: true,
          severity: fixture.invalidSeverity,
          published: published.length > 0
        }
      }))
  );
  return {
    outcomes,
    escape,
    generatedHighSeverity: escape.invalidHighSeverityClaimsGenerated,
    publishedHighSeverity: escape.invalidHighSeverityClaimsPublished,
    escapeRate: escape.escapeRate
  };
}

/**
 * JS no-byte-leak metrics (FI-PATCH-005 / FI-010). Bytes that reach the buffers
 * before the gate (and would otherwise leak to the user) must be zero for every
 * blocked turn — measured separately for candidate text and candidate reasoning.
 * Invariant: total = text + reasoning.
 */
export async function measureJsNoByteLeak() {
  const { outcomes } = await runQuantiumHallucinationCorpus();
  const blocked = outcomes.filter(({ fixture }) => fixture.shouldBlock);
  const candidateTextBytesBeforeGate = blocked.reduce(
    (sum, { publishedBeforeGate }) => sum + publishedBeforeGate.reduce((s, c) => s + c.length, 0),
    0
  );
  const candidateReasoningBytesBeforeGate = blocked.reduce(
    (sum, { publishedBeforeGateReasoning }) =>
      sum + publishedBeforeGateReasoning.reduce((s, c) => s + c.length, 0),
    0
  );
  const candidateBytesBeforeGate = candidateTextBytesBeforeGate + candidateReasoningBytesBeforeGate;
  return {
    // FI-008 — how many blocked turns produced the zero above: a zero measured
    // over an empty set of blocked turns is vacuous, so the count is evidence.
    blockedCases: blocked.length,
    candidateTextBytesBeforeGate,
    candidateReasoningBytesBeforeGate,
    candidateBytesBeforeGate,
    noByteLeak: candidateBytesBeforeGate === 0,
    schema: "ds4_quantium_js_no_byte_leak_v2"
  };
}

/** Q2-018 (§33, §58) — the strict-mode configuration the adversarial corpus runs under. */
export const QHO_LLM_STRICT_CONFIG = Object.freeze({
  enabled: true,
  mode: "block",
  withholdOutput: true,
  blockSeverity: 4,
  maxClaimsPerTurn: 64,
  maxVerifierCallsPerTurn: 8,
  verifyMath: true,
  verifyCitations: true,
  verifyExecutionClaims: true,
  verifyChallenges: true,
  verifyVerificationLanguage: true
});

/**
 * The four candidates the §33 rates are measured over.
 *
 * `toolEventIds` selects which of the conversation's Lean runs the turn saw, so
 * the compliant control is not handed a timeout it never triggered.
 */
const QHO_LLM_CANDIDATES = Object.freeze([
  Object.freeze({
    id: "qho_llm_original",
    content: QHO_LLM_ADVERSARIAL.finalCandidate,
    claims: QHO_LLM_ADVERSARIAL.finalClaims,
    toolEventIds: null,
    shouldBlock: true
  }),
  Object.freeze({
    id: "qho_llm_safe_repair",
    content: QHO_LLM_ADVERSARIAL.safeRepairCandidate,
    claims: [],
    toolEventIds: null,
    shouldBlock: false
  }),
  Object.freeze({
    id: "qho_llm_universal_coverage",
    content: QHO_LLM_ADVERSARIAL.universalCoverageCandidate,
    claims: [],
    toolEventIds: null,
    shouldBlock: true
  }),
  Object.freeze({
    id: "qho_llm_compliant",
    content: QHO_LLM_ADVERSARIAL.compliantCandidate,
    claims: QHO_LLM_ADVERSARIAL.compliantClaims,
    toolEventIds: ["energy_level_injective"],
    shouldBlock: false
  })
]);

async function runQhoLlmCandidate(candidate) {
  const turn = createEpistemicTurn({
    sessionKey: "qho-llm-adversarial",
    config: QHO_LLM_STRICT_CONFIG,
    userText: QHO_LLM_ADVERSARIAL.userRequest
  });
  const events = candidate.toolEventIds
    ? QHO_LLM_ADVERSARIAL.toolEvents.filter((e) => candidate.toolEventIds.includes(e.sourceId))
    : QHO_LLM_ADVERSARIAL.toolEvents;
  for (const event of events) {
    turn.addToolResult({
      callId: `call_${event.sourceId}`,
      toolName: "lean_check",
      arguments: { code: event.source },
      rawResult: {
        isError: event.status !== "CHECKED",
        content: `[lean] ${event.sourceId}: ${event.status}`,
        raw: event.raw
      }
    });
  }

  const sourceContext = new EpistemicSourceContext();
  const claimIds = new Set(candidate.claims.map((claim) => claim.id));
  const sourceCertificates = [];
  for (const record of QHO_LLM_ADVERSARIAL.sourceEvents) {
    if (!claimIds.has(record.claimId)) continue;
    sourceContext.bind(record.claimId, {
      evidenceId: `ev_${record.sourceId}`,
      source: record,
      passages: []
    });
    sourceCertificates.push(record);
  }

  const decision = await evaluateEpistemicTurn(turn, {
    assistantContent: candidate.content,
    reasoning: QHO_LLM_ADVERSARIAL.reasoningEvents.join("\n"),
    client: extractionClient(candidate.claims),
    sourceContext,
    sessionLedger: new EpistemicSessionLedger()
  });

  return {
    id: candidate.id,
    shouldBlock: candidate.shouldBlock,
    decision,
    published: decision.allowed === true,
    assistantContent: candidate.content,
    claims: turn.ledger.allClaims(),
    formalArtifacts: decision.formalArtifacts ?? [],
    leanCertificates: decision.leanCertificates ?? [],
    claimCoverage: decision.claimCoverage ?? null,
    verificationContract: decision.verificationContract ?? null,
    bridges: turn.modelingBridges,
    sourceCertificates
  };
}

/**
 * Q2-018/Q2-019 — replay the QHO→LLM adversarial corpus and measure §33.
 *
 * @returns {Promise<{runs: object[], metrics: object, blockedAsExpected: boolean}>}
 */
export async function runQhoLlmAdversarialCorpus() {
  const runs = [];
  for (const candidate of QHO_LLM_CANDIDATES) runs.push(await runQhoLlmCandidate(candidate));
  return {
    runs,
    metrics: measureStrictMetrics(runs),
    blockedAsExpected: runs.every((run) => run.published === !run.shouldBlock)
  };
}
