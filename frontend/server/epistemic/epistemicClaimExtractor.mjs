/**
 * DS4 Quantum Fix — claim extraction.
 *
 * QF-06 §28. Turns a completed response into atomic claims a verifier can act
 * on. Two paths, and the difference between them is reported rather than
 * hidden: with a model the segmentation is semantic, without one it is a
 * lexical sweep for high-risk wording, and §28 is explicit that the second case
 * must not claim extraction succeeded — it returns EXTRACTION_PARTIAL.
 *
 * The reason that matters: a gate reading EXTRACTION_COMPLETE assumes the
 * claims it did not receive do not exist. Under the fallback that assumption is
 * false, and a silent downgrade would turn "we could not look" into "there was
 * nothing to find".
 *
 * Transport is StructuredModelClient (§10). No new HTTP client.
 */

import { createClaim } from "./epistemicLedger.mjs";
import { scanProtectedLanguage } from "../claimGuard.mjs";
import { CLAIM_EXTRACTOR_PROMPT, CLAIM_FLAGS, EXTRACTOR_TYPES } from "./epistemicPrompts.mjs";
import {
  CLAIM_CLASS,
  requirementsForClaimClasses
} from "./epistemicAuthorization.mjs";
import { inheritFromPriorClaims } from "./epistemicClaimEquivalence.mjs";
import { planVerificationTarget } from "./epistemicVerificationTargetPlanner.mjs";

export const EXTRACTION_STATUS = Object.freeze({
  /** A model segmented the response. */
  COMPLETE: "EXTRACTION_COMPLETE",
  /** No model, or the model failed: only high-risk wording was picked up. */
  PARTIAL: "EXTRACTION_PARTIAL",
  /** Nothing could be extracted at all. */
  FAILED: "EXTRACTION_FAILED"
});

const DEFAULT_MAX_CLAIMS = 64;
const MAX_CLAIM_CHARS = 1000;

/** Lexical flag detection, used by the fallback and to backfill model output. */
const FLAG_PATTERNS = Object.freeze({
  containsArithmetic: /\d\s*[+\-*/×÷^]\s*\d|\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?e[+-]?\d+\b/i,
  containsSymbolicDerivation: /\b(integral|derivative|d\/dx|∂|∫|∑|eigenvalue|hamiltonian|derivata|integrale)\b|\\frac|\\partial/i,
  containsCitation:
    /\b(arxiv\s*:\s*\d{4}\.\d{4,5}|doi\s*:\s*10\.|et al\.|\(\d{4}\)|(?:published|pubblicat\w+|disponibil\w+|available)\s+(?:on|su|in|nel|nella)\s+(?:arxiv|biorxiv|ssrn)|peer[-\s]?review\w*|sottopost\w+\s+a\s+revisione|refereed)/i,
  containsExternalFact: /\b(according to|reports that|states that|secondo|riporta che|dichiara che)\b/i,
  assertsExecution: /\b(ran|executed|running (?:it|the code)|working code|eseguito|eseguita|codice funzionante)\b/i,
  assertsTest: /\b(tests? (?:pass|passed|passes)|passes tests|test suite|i test passano|testato)\b/i,
  assertsBenchmark: /\b(benchmark(?:ed|s)?|throughput|latency|tokens\/s|benchmark mostra)\b/i,
  assertsObservation: /\b(we measured|i measured|measured|observed|spectrum shows|abbiamo misurato|misurato|osservato)\b/i
});

function detectFlags(text) {
  const content = String(text || "");
  const flags = {};
  for (const [name, re] of Object.entries(FLAG_PATTERNS)) flags[name] = re.test(content);
  flags.usesProtectedLanguage = scanProtectedLanguage(content).highRiskCandidate;
  return flags;
}

/** Every flag present, defaulting to false, in the order §28 lists them. */
function normalizeFlags(raw, text) {
  const detected = detectFlags(text);
  const flags = {};
  for (const name of CLAIM_FLAGS) {
    // A model may omit a flag; the lexical detector fills the gap. It may not
    // clear one the text plainly supports, so a detected true wins.
    flags[name] = detected[name] === true || raw?.[name] === true;
  }
  return flags;
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_CLAIM_CHARS);
}

/**
 * Q2-007 (§10) — independently provable properties are separate claims.
 *
 * "the QHO spectrum is discrete and non-degenerate" asserts two theorems. Left
 * whole it becomes one claim, and one certificate covering either half reads as
 * covering both — which is how a proof of constructor injectivity ended up
 * authorising non-degeneracy. Splitting is what makes coverage measurable.
 *
 * Narrow on purpose: it splits only when *every* conjunct is a recognised
 * mathematical property, so ordinary prose conjunctions are left alone.
 */
const MATHEMATICAL_PROPERTY =
  /^(?:non[-\s]?|not\s+|un|in)?(?:degener\w+|discret\w+|continu\w+|limitat\w+|bounded|unbounded|self[-\s]?adjoint|autoaggiunt\w+|hermitian|hermitian\w*|positiv\w+|negativ\w+|unitar\w+|ortogonal\w+|orthogonal\w*|orthonormal\w*|ortonormal\w+|linear\w*|lineare|invertibil\w+|compact\w*|compatt\w+|finit\w+|infinit\w+|complet\w+|separabil\w+|normalizzat\w+|normalised|normalized|simmetric\w+|symmetric|antisymmetric|antisimmetric\w+|stochastic|stocastic\w+|convess\w+|convex|closed|chius\w+|dens\w+|monoton\w+|surgettiv\w+|iniettiv\w+|injective|surjective|bijective)(?:\s+(?:dal\s+basso|from\s+below|dall'alto|from\s+above|in\s+n))?$/iu;

// `\b` is ASCII-only, so it never fires before `è`; the boundary is explicit.
const COPULA_SPLIT =
  /^(.*?(?:^|\s)(?:is|are|was|were|è|e|sono|era|erano|risulta|risultano)\s+)(.+?)([.!?]?)\s*$/iu;
const CONJUNCTION = /\s*(?:,|;|\band\b|\bed\b|\be\b)\s*/iu;

/**
 * Q2-011 (§14) — the same split for a bibliographic sentence.
 *
 * "Both papers are published on arXiv and peer-reviewed" bundles two records
 * that are checked in different places: an abstract page settles the first, and
 * only a venue settles the second. Left whole, one arXiv visit reads as
 * certifying both, which is what the QHO transcript published.
 */
const BIBLIOGRAPHIC_PROPERTY =
  /^(?:(?:pubblicat\w+|published|disponibil\w+|available|indicizzat\w+|indexed|present\w+)(?:\s+(?:su|on|in|nel|nella|presso|at)\s+[\w.\-/:]+)?|peer[-\s]?review\w*|refereed|sottopost\w+\s+a\s+revisione(?:\s+paritaria)?|revisionat\w+|citat\w+|verificat\w+|certificat\w+|esistent\w+|reali?)$/iu;

/** Split a copular sentence whose every conjunct is one recognised property. */
function atomizeConjunction(text, property) {
  const sentence = String(text ?? "").trim();
  const match = COPULA_SPLIT.exec(sentence);
  if (!match) return [sentence];

  const [, head, predicate, terminator] = match;
  const parts = predicate
    .split(CONJUNCTION)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [sentence];
  if (!parts.every((part) => property.test(part))) return [sentence];

  return parts.map((part) => `${head}${part}${terminator || "."}`);
}

/**
 * Split one sentence into its independently provable mathematical properties.
 *
 * @param {string} text
 * @returns {string[]} the atoms, or `[text]` when nothing splits.
 */
export function atomizeMathematicalClaim(text) {
  return atomizeConjunction(text, MATHEMATICAL_PROPERTY);
}

/**
 * Split one sentence into its independently checkable bibliographic properties.
 *
 * @param {string} text
 * @returns {string[]} the atoms, or `[text]` when nothing splits.
 */
export function atomizeBibliographicClaim(text) {
  return atomizeConjunction(text, BIBLIOGRAPHIC_PROPERTY);
}

/** Every atom a sentence yields, whichever vocabulary its conjuncts belong to. */
function atomizeClaimSentence(text) {
  const mathematical = atomizeMathematicalClaim(text);
  if (mathematical.length > 1) return mathematical;
  return atomizeBibliographicClaim(text);
}

/**
 * Deterministic extraction: sentences that use protected language.
 *
 * This is not segmentation. It cannot split a compound assertion, spot an
 * implicit dependency, or recognise a checkable proposition phrased without a
 * protected word. It finds the sentences most likely to need evidence, which is
 * why its result is PARTIAL and never COMPLETE.
 */
export function deterministicClaims(text, { maxClaims = DEFAULT_MAX_CLAIMS } = {}) {
  const claims = [];
  // §10: one sentence may carry several independently provable properties, and
  // each of them is its own claim.
  const sentenceAtoms = splitSentences(text).flatMap(atomizeClaimSentence);
  for (const sentence of sentenceAtoms) {
    if (claims.length >= maxClaims) break;
    const flags = detectFlags(sentence);
    const flagged = CLAIM_FLAGS.some((name) => flags[name]);
    if (!flagged) continue;
    claims.push(
      createClaim({
        text: sentence,
        // The lexical pass cannot tell a source fact from a derivation. Saying
        // UNKNOWN is accurate; guessing a type would invent a claim's nature.
        epistemicType: "UNKNOWN",
        verificationRequirements: requirementsForFlags(flags)
      })
    );
  }
  return claims
    .map((claim, i) => {
      const planned = planVerificationTarget({ claim });
      claim.verificationTarget = planned.verificationTarget;
      claim.expectedCertificateScope = planned.expectedCertificateScope;
      return { ...claim, flags: detectFlags(claim.text), localId: `D${i + 1}` };
    });
}

/** What a claim's flags say it will have to be checked against. */
export function requirementsForFlags(flags = {}) {
  const claimClasses = [];
  if (flags.containsArithmetic) claimClasses.push(CLAIM_CLASS.NONTRIVIAL_ARITHMETIC);
  if (flags.containsSymbolicDerivation) claimClasses.push(CLAIM_CLASS.SYMBOLIC_IDENTITY);
  if (flags.containsCitation) claimClasses.push(CLAIM_CLASS.EXACT_PAPER_METADATA);
  if (flags.containsExternalFact) claimClasses.push(CLAIM_CLASS.PAPER_SUPPORTS_CLAIM);
  if (flags.assertsExecution) claimClasses.push(CLAIM_CLASS.WORKING_CODE);
  if (flags.assertsTest) claimClasses.push(CLAIM_CLASS.TESTS_PASSED);
  if (flags.assertsBenchmark) claimClasses.push(CLAIM_CLASS.BENCHMARK);

  const requirements = requirementsForClaimClasses(claimClasses);
  if (flags.assertsObservation) requirements.push("observation_evidence");
  return [...new Set(requirements)];
}

/** Coerce one model-produced claim into a ledger claim. Never trusts a status. */
function claimFromModel(raw, index) {
  const text = String(raw?.text ?? "").slice(0, MAX_CLAIM_CHARS).trim();
  if (!text) return null;
  const epistemicType = EXTRACTOR_TYPES.includes(raw?.epistemicType) ? raw.epistemicType : "UNKNOWN";
  const flags = normalizeFlags(raw?.flags, text);

  // REM-013.3: the model cannot self-authorize a scope. Any scope the model
  // supplies is discarded; the predeclared scope (if any) is re-derived by the
  // deterministic planner below.
  const claim = {
    // createClaim forces PROPOSED and drops any status the model supplied, so
    // "Never output VERIFIED" is enforced by construction rather than by the
    // model obeying the prompt.
    ...createClaim({ text, epistemicType, verificationRequirements: requirementsForFlags(flags) }),
    flags,
    localId: String(raw?.id ?? `C${index + 1}`),
    modelDependencies: Array.isArray(raw?.dependencies) ? raw.dependencies.map(String) : []
  };

  // REM-013.4: predeclare the scope deterministically from the claim's own
  // properties (never from the model, never from a verifier result).
  const planned = planVerificationTarget({ claim });
  claim.verificationTarget = planned.verificationTarget;
  claim.expectedCertificateScope = planned.expectedCertificateScope;
  return claim;
}

/** Rewrite the model's local ids (C1, C2) into ledger claim ids. */
function resolveDependencies(claims) {
  const byLocalId = new Map(claims.map((c) => [c.localId, c.id]));
  for (const claim of claims) {
    claim.dependencies = (claim.modelDependencies ?? [])
      .map((localId) => byLocalId.get(localId))
      // A dangling reference is dropped rather than invented: a dependency on a
      // claim that does not exist would silently never invalidate anything.
      .filter((id) => id && id !== claim.id);
    delete claim.modelDependencies;
  }
  return claims;
}

/**
 * Extract claims from a completed response.
 *
 * @param {object} options
 * @param {string} options.text - the assistant's response.
 * @param {object} [options.client] - a StructuredModelClient, or null.
 * @param {number} [options.maxClaims]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{status: string, claims: object[], source: string, reason?: string}>}
 */
export async function extractEpistemicClaims({
  text,
  client = null,
  maxClaims = DEFAULT_MAX_CLAIMS,
  priorClaims = [],
  maxClaimComparisons = 32,
  signal
} = {}) {
  const content = String(text || "").trim();
  if (!content) {
    return { status: EXTRACTION_STATUS.COMPLETE, claims: [], source: "empty" };
  }

  if (!client || typeof client.completeRole !== "function") {
    const claims = deterministicClaims(content, { maxClaims });
    return {
      status: EXTRACTION_STATUS.PARTIAL,
      claims: await Promise.all(
        claims.map((claim) =>
          inheritFromPriorClaims({
            claim,
            priorClaims,
            maxComparisons: maxClaimComparisons,
            signal
          })
        )
      ),
      source: "lexical",
      reason: "no model client available; only high-risk wording was extracted"
    };
  }

  try {
    const response = await client.completeRole({
      roleName: "epistemic_claim_extractor",
      systemPrompt: CLAIM_EXTRACTOR_PROMPT,
      userPrompt: content,
      json: true,
      signal
    });
    const rawClaims = Array.isArray(response?.json?.claims) ? response.json.claims : null;
    if (!rawClaims) {
      return {
        status: EXTRACTION_STATUS.PARTIAL,
        claims: deterministicClaims(content, { maxClaims }),
        source: "lexical",
        reason: "model response contained no claims array"
      };
    }
    const extractedClaims = resolveDependencies(
      rawClaims.slice(0, maxClaims).map(claimFromModel).filter(Boolean)
    );
    const claims = await Promise.all(
      extractedClaims.map((claim) =>
        inheritFromPriorClaims({
          claim,
          priorClaims,
          client,
          maxComparisons: maxClaimComparisons,
          signal
        })
      )
    );
    return { status: EXTRACTION_STATUS.COMPLETE, claims, source: "model" };
  } catch (err) {
    // A model that errored tells us nothing about the response. Falling back
    // to the lexical sweep keeps the high-risk wording visible; reporting
    // COMPLETE here would claim we had looked everywhere.
    return {
      status: EXTRACTION_STATUS.PARTIAL,
      claims: deterministicClaims(content, { maxClaims }),
      source: "lexical",
      reason: `model extraction failed: ${String(err?.message ?? err)}`
    };
  }
}
