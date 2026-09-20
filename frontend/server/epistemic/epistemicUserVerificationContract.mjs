/**
 * Q2-001 (remediation.Quantiom.002 §4) — the user's verification contract.
 *
 * RC-01: the request "ogni affermazione deve essere dimostrata con Lean" was
 * prose, so the agent could reason its way out of it ("that's extremely broad")
 * and substitute "for each major claim". A contract the assistant can reinterpret
 * is not a contract. This turns the request into state derived from one input —
 * the user's own text — and freezes it.
 *
 * Deliberately lexical and narrow. It recognises the strictness markers the DS4
 * conversations actually use, in Italian and English, and nothing else; an
 * unrecognised request is DEFAULT, which changes no existing behaviour.
 */

import { createHash } from "node:crypto";

export const VERIFICATION_COVERAGE_MODE = Object.freeze({
  DEFAULT: "DEFAULT",
  ALL_ASSERTIVE_CLAIMS: "ALL_ASSERTIVE_CLAIMS",
  SELECTED_CLAIMS: "SELECTED_CLAIMS"
});

export const USER_VERIFICATION_POLICY = Object.freeze({
  DEFAULT: "DEFAULT",
  LEAN_REQUIRED: "LEAN_REQUIRED",
  PRIMARY_SOURCE_REQUIRED: "PRIMARY_SOURCE_REQUIRED",
  SOURCE_ENTAILMENT_REQUIRED: "SOURCE_ENTAILMENT_REQUIRED",
  EVIDENCE_REQUIRED: "EVIDENCE_REQUIRED",
  EXPLICIT_ANALOGY: "EXPLICIT_ANALOGY",
  OMIT_OR_DISCLOSE: "OMIT_OR_DISCLOSE"
});

/** §4.4 — "every claim", in the two languages these conversations use. */
const UNIVERSAL_COVERAGE =
  /\b(?:ogni\s+(?:affermazione|claim|asserzione|frase|enunciato)|tutte\s+le\s+affermazioni|tutto\s+(?:deve|dev'essere|va)\s+(?:essere\s+)?(?:dimostrat|verificat|provat)\w*|every\s+(?:claim|statement|assertion|sentence)|all\s+claims|each\s+(?:and\s+every\s+)?claim|prove\s+every\s+\w+|verify\s+every\s+\w+)/iu;

/**
 * An imperative already IS the demand ("prove every statement in Lean"), so it
 * carries its own requirement and does not need a modal alongside it.
 */
const UNIVERSAL_IMPERATIVE =
  /\b(?:prove|verify|check|certify|dimostra|verifica|certifica)\s+(?:that\s+)?(?:every|each|all|ogni|tutte?\s+le|tutti\s+i)\b/iu;

/** A demand that the verification be done, not merely considered. */
const REQUIREMENT =
  /\b(?:deve|devono|dev'essere|va|vanno|obbligatori\w*|must|has to|have to|required|richiest\w+)\b/iu;

/** §4.4 — the mechanism the user named for mathematical content. */
const LEAN_REQUIRED =
  /\b(?:prove[nds]?|proof|verif\w+|check\w*|dimostrat\w*|dimostra\w*|provat\w*|certificat\w*)\b[^.]{0,60}\b(?:con|in|tramite|usando|attraverso|with|using)\s+lean\b|\blean\b[^.]{0,60}\b(?:required|obbligatori\w*|per\s+ogni|for\s+every|for\s+each)\b/iu;

/** §4.4 — the mechanism the user named for bibliography. */
const PRIMARY_SOURCE_REQUIRED =
  /\b(?:paper|articol\w+|font\w+|reference|riferiment\w+|citazion\w+|source)\w*\b[^.]{0,120}\b(?:certificat\w+|verificat\w+|esistenti|verified|verify|exist\w*|real|reali)\b|\b(?:certificat\w+|verificat\w+|verify|verified)\b[^.]{0,120}\b(?:paper|articol\w+|font\w+|reference|riferiment\w+|source)\w*\b/iu;

/** The channel the user named for that certification. */
const WEB_SEARCH =
  /\b(?:ricerca\s+sul\s+web|sul\s+web|ricerca\s+web|web\s+search|on\s+the\s+web|online|internet|arxiv|google\s+scholar)\b/iu;

function matches(pattern, text) {
  return pattern.test(text);
}

/**
 * Derive the governing verification contract from the user's own words.
 *
 * Only `userText` is read. Every other property of the input is ignored on
 * purpose (§4.3): the assistant's reasoning is not a party to this contract,
 * and an assistant that could pass `coverageMode` would be able to weaken it
 * exactly the way the QHO transcript did.
 *
 * @param {{userText?: string}} [input]
 * @returns {Readonly<object>} a frozen contract.
 */
export function deriveUserVerificationContract({ userText = "" } = {}) {
  const text = String(userText ?? "");
  const sourceTextHash = createHash("sha256").update(text).digest("hex");

  const universal =
    matches(UNIVERSAL_COVERAGE, text) &&
    (matches(REQUIREMENT, text) || matches(UNIVERSAL_IMPERATIVE, text));
  const lean = matches(LEAN_REQUIRED, text);
  const bibliographic =
    matches(PRIMARY_SOURCE_REQUIRED, text) &&
    (matches(WEB_SEARCH, text) ||
      matches(REQUIREMENT, text) ||
      matches(UNIVERSAL_IMPERATIVE, text));

  const coverageMode = universal
    ? VERIFICATION_COVERAGE_MODE.ALL_ASSERTIVE_CLAIMS
    : VERIFICATION_COVERAGE_MODE.DEFAULT;
  const strict = coverageMode === VERIFICATION_COVERAGE_MODE.ALL_ASSERTIVE_CLAIMS;

  return Object.freeze({
    // Stable across turns for the same request: the hash is the identity, so a
    // repair round can prove it is still governed by the contract it started
    // under (§5).
    id: `uvc_${sourceTextHash.slice(0, 16)}`,
    coverageMode,
    mathematicalClaims: lean
      ? USER_VERIFICATION_POLICY.LEAN_REQUIRED
      : USER_VERIFICATION_POLICY.DEFAULT,
    bibliographicIdentity: bibliographic
      ? USER_VERIFICATION_POLICY.PRIMARY_SOURCE_REQUIRED
      : USER_VERIFICATION_POLICY.DEFAULT,
    // A user who demands the paper be real is asking about identity; the
    // content claim drawn from it needs entailment, which is a different check.
    sourceContentClaims: bibliographic
      ? USER_VERIFICATION_POLICY.SOURCE_ENTAILMENT_REQUIRED
      : USER_VERIFICATION_POLICY.DEFAULT,
    empiricalClaims: strict
      ? USER_VERIFICATION_POLICY.EVIDENCE_REQUIRED
      : USER_VERIFICATION_POLICY.DEFAULT,
    analogyPolicy: strict
      ? USER_VERIFICATION_POLICY.EXPLICIT_ANALOGY
      : USER_VERIFICATION_POLICY.DEFAULT,
    unverifiablePolicy: strict
      ? USER_VERIFICATION_POLICY.OMIT_OR_DISCLOSE
      : USER_VERIFICATION_POLICY.DEFAULT,
    sourceTextHash,
    createdAt: new Date().toISOString()
  });
}

/** Whether this contract governs every assertive claim in the answer. */
export function isStrictContract(contract) {
  return contract?.coverageMode === VERIFICATION_COVERAGE_MODE.ALL_ASSERTIVE_CLAIMS;
}

/**
 * §20 — the mechanism matrix. Which verification a claim owes under this
 * contract, by claim class. Returns [] when the contract does not govern it,
 * which keeps every non-strict turn on its existing path.
 *
 * @returns {string[]} required verifier requirement names.
 */
export function requiredMechanismsForClaim({ claim, verificationContract } = {}) {
  const contract = verificationContract;
  if (!contract || !claim) return [];

  const text = String(claim.text ?? "").toLowerCase();
  const required = new Set();

  const mathematical =
    claim.epistemicType === "COMPUTED" ||
    claim.epistemicType === "DERIVED" ||
    /\b(?:theorem|teorema|spectrum|spettro|eigenvalue|autovalor\w+|operator|operatore|basis|base ortogonale|unitar\w+|commutation|orthogonal\w*|dimostra\w*|proof|prove[nd]?)\b/iu.test(
      text
    );
  if (
    mathematical &&
    contract.mathematicalClaims === USER_VERIFICATION_POLICY.LEAN_REQUIRED
  ) {
    required.add("lean_proof");
  }

  const bibliographic =
    /\b(?:paper|articolo|arxiv|doi|preprint|pubblicat\w+|published|peer[-\s]review\w*|journal|rivista)\b/iu.test(
      text
    );
  if (
    bibliographic &&
    contract.bibliographicIdentity === USER_VERIFICATION_POLICY.PRIMARY_SOURCE_REQUIRED
  ) {
    required.add("source_identity");
    if (contract.sourceContentClaims === USER_VERIFICATION_POLICY.SOURCE_ENTAILMENT_REQUIRED) {
      required.add("source_entailment");
    }
  }

  return [...required];
}

function resultSatisfiesRequirement(result, requirement) {
  if (String(result?.status ?? result?.verdict ?? "").toUpperCase() !== "PASSED") return false;
  return (
    result?.requirement === requirement ||
    result?.certificate?.requirement === requirement ||
    result?.certificate?.metadata?.requirement === requirement
  );
}

/**
 * §36 — a requirement is met by the mechanism it names, not by any passing check.
 *
 * A Lean requirement needs a Lean certificate that checked this claim's own
 * target (§8.3, §18): `checked` plus source integrity is not enough, and a Sage
 * pass is a different mechanism entirely.
 *
 * @param {object} claim
 * @param {string} requirement
 * @param {object[]} [leanCertificates]
 * @returns {boolean}
 */
export function claimSatisfiesMechanism(claim, requirement, leanCertificates = []) {
  if (requirement === "lean_proof") {
    return (Array.isArray(leanCertificates) ? leanCertificates : []).some(
      (certificate) =>
        certificate?.claimId === claim?.id &&
        String(certificate?.status ?? certificate?.verdict ?? "").toUpperCase() === "PASSED" &&
        certificate?.targetIdentityVerified === true &&
        certificate?.sourceIntegrityVerified === true
    );
  }
  return (Array.isArray(claim?.verifierResults) ? claim.verifierResults : []).some((result) =>
    resultSatisfiesRequirement(result, requirement)
  );
}
