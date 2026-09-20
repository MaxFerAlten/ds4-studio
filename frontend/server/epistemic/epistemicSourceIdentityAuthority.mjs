/**
 * Q2-011 (remediation.Quantiom.002 §14, §24, §25) — bibliographic identity authority.
 *
 * RC-08: the QHO transcript visited one arXiv abstract page, saw a second title
 * inside a search overview, and published both as "pubblicati su arXiv e
 * peer-reviewed". Two distinct promotions hide in that sentence — a secondary
 * mention becoming an identity, and an identity becoming a review — so this
 * module keeps them apart.
 *
 * epistemicCitationIdentity.mjs already answers "does this identifier resolve to
 * the paper the prose names". It cannot answer "was this record a primary one"
 * or "did anyone check the venue", because both are properties of the retrieval,
 * not of the resolved metadata. That is what this adds.
 */

import { SEVERITY } from "./epistemicContracts.mjs";

export const SOURCE_RECORD_TYPE = Object.freeze({
  /** §14 — canonical primary identity records. */
  ARXIV_ABSTRACT: "ARXIV_ABSTRACT",
  DOI_LANDING: "DOI_LANDING",
  PUBLISHER_PAGE: "PUBLISHER_PAGE",
  PROCEEDINGS: "PROCEEDINGS",
  JOURNAL_PAGE: "JOURNAL_PAGE",
  /** §14 — everything that only reports that a paper was seen somewhere. */
  AI_OVERVIEW: "AI_OVERVIEW",
  SEARCH_SNIPPET: "SEARCH_SNIPPET",
  SEARCH_RESULT: "SEARCH_RESULT",
  SECONDARY_MENTION: "SECONDARY_MENTION",
  LLM_SUMMARY: "LLM_SUMMARY",
  UNKNOWN: "UNKNOWN"
});

export const PRIMARY_SOURCE_RECORD_TYPES = Object.freeze(
  new Set([
    SOURCE_RECORD_TYPE.ARXIV_ABSTRACT,
    SOURCE_RECORD_TYPE.DOI_LANDING,
    SOURCE_RECORD_TYPE.PUBLISHER_PAGE,
    SOURCE_RECORD_TYPE.PROCEEDINGS,
    SOURCE_RECORD_TYPE.JOURNAL_PAGE
  ])
);

/** Record types that can carry a peer-review verdict at all (§14). */
const REVIEWED_VENUE_TYPES = Object.freeze(
  new Set([
    SOURCE_RECORD_TYPE.DOI_LANDING,
    SOURCE_RECORD_TYPE.PUBLISHER_PAGE,
    SOURCE_RECORD_TYPE.PROCEEDINGS,
    SOURCE_RECORD_TYPE.JOURNAL_PAGE
  ])
);

/** §14 — the separate propositions a single bibliographic sentence bundles. */
export const IDENTITY_FIELD = Object.freeze({
  TITLE: "TITLE",
  AUTHORS: "AUTHORS",
  YEAR: "YEAR",
  IDENTIFIER: "IDENTIFIER",
  VENUE: "VENUE",
  PEER_REVIEW: "PEER_REVIEW"
});

/** Wording that presents a cited work as an established, checked record. */
const IDENTITY_ASSERTED =
  /\b(?:verificat\w+|certificat\w+|confermat\w+|verified|certified|confirmed|esiston?o\s+realmente|realmente\s+esistent\w+|pubblicat\w+\s+su\s+arxiv|published\s+on\s+arxiv|disponibil\w+\s+su\s+arxiv)\b/iu;

/** Wording that additionally asserts a review process took place. */
const PEER_REVIEW_ASSERTED =
  /\b(?:peer[-\s]?review\w*|sottopost\w+\s+a\s+revisione|revision[ei]\s+paritari\w+|referaggio|refereed)\b/iu;

/** The subject has to be a cited work for either assertion to be bibliographic. */
const BIBLIOGRAPHIC_SUBJECT =
  /\b(?:paper|papers|articol\w+|preprint\w*|arxiv|doi|pubblicazion\w+|publication|journal|rivista|proceedings|reference|riferiment\w+|citazion\w+|studio|study|lavoro)\b/iu;

/** §24, §37 — a heading that claims the whole reference list was checked. */
const VERIFIED_REFERENCES_HEADING =
  /^\s*#{1,6}\s*(?:riferimenti|bibliografia|fonti|references|sources|bibliography)\b[^\n]*\b(?:verificat\w+|certificat\w+|verified|certified|confermat\w+)\b/imu;

/** Explicit disclosure that a field was not established (§6.2, §24). */
const EXPLICIT_UNVERIFIED =
  /\b(?:non\s+verificat\w+|non\s+(?:e|è)\s+(?:stato\s+)?(?:verificat|certificat|confermat)\w*|resta\s+(?:non\s+verificat\w+|ignot\w+|apert\w+)|not\s+verified|unverified|unknown|remains?\s+(?:unverified|unknown))\b/iu;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * What one retrieved record actually establishes.
 *
 * @param {object} certificate — a source-identity certificate (§14 fields).
 * @returns {{identityVerified: boolean, peerReviewVerified: boolean, identityFieldsVerified: string[], failureCodes: string[], reason: string}}
 */
export function assessSourceIdentityCertificate(certificate = {}) {
  const sourceType = String(certificate.sourceType ?? SOURCE_RECORD_TYPE.UNKNOWN);
  const retrieved =
    String(certificate.retrievalStatus ?? "").toUpperCase() === "SUCCESS" &&
    nonEmptyString(certificate.canonicalUrl);
  const primary = PRIMARY_SOURCE_RECORD_TYPES.has(sourceType);

  const failureCodes = [];
  let reason = "the record is a primary identity retrieval";
  if (!retrieved) {
    failureCodes.push("F01");
    reason = "no successful retrieval of a canonical record";
  } else if (!primary) {
    // §14: a mention is evidence that a string was seen, not that a paper is.
    failureCodes.push("F13");
    reason = `a ${sourceType} record reports a mention, not a primary identity`;
  }

  const identityVerified = retrieved && primary;

  const identityFieldsVerified = [];
  if (identityVerified) {
    if (nonEmptyString(certificate.title)) identityFieldsVerified.push(IDENTITY_FIELD.TITLE);
    if (Array.isArray(certificate.authors) && certificate.authors.length > 0) {
      identityFieldsVerified.push(IDENTITY_FIELD.AUTHORS);
    }
    if (certificate.year != null && String(certificate.year).trim() !== "") {
      identityFieldsVerified.push(IDENTITY_FIELD.YEAR);
    }
    if (nonEmptyString(certificate.identifier)) identityFieldsVerified.push(IDENTITY_FIELD.IDENTIFIER);
    if (nonEmptyString(certificate.publicationVenue)) identityFieldsVerified.push(IDENTITY_FIELD.VENUE);
  }

  // §14 — the peer-review rule. arXiv identity != peer reviewed, whatever the
  // metadata field says: a preprint server cannot report a review it never ran.
  const peerReviewVerified =
    identityVerified &&
    REVIEWED_VENUE_TYPES.has(sourceType) &&
    nonEmptyString(certificate.publicationVenue) &&
    String(certificate.peerReviewStatus ?? "").toUpperCase() === "PEER_REVIEWED";
  if (peerReviewVerified) identityFieldsVerified.push(IDENTITY_FIELD.PEER_REVIEW);

  return Object.freeze({
    identityVerified,
    peerReviewVerified,
    identityFieldsVerified: Object.freeze(identityFieldsVerified),
    failureCodes: Object.freeze(failureCodes),
    reason
  });
}

function certificatesForClaim(claim, certificates) {
  const bound = certificates.filter((certificate) => certificate?.claimId === claim?.id);
  // An unbound certificate is not evidence for this claim; with none bound the
  // claim stands on nothing, which the empty list already expresses.
  return bound;
}

/**
 * Whether the answer may present its bibliography as checked.
 *
 * @param {{assistantContent?: string, claims?: object[], sourceCertificates?: object[]}} input
 * @returns {null|{code: string, failureCodes: string[], severity: number, blockedClaimIds: string[], guidance: string}}
 */
export function assessBibliographicAuthorization({
  assistantContent = "",
  claims = [],
  sourceCertificates = []
} = {}) {
  const content = String(assistantContent ?? "");
  const certificates = (Array.isArray(sourceCertificates) ? sourceCertificates : []).filter(Boolean);
  const assessments = new Map(
    certificates.map((certificate) => [certificate, assessSourceIdentityCertificate(certificate)])
  );

  const offenders = [];
  const failureCodes = new Set();

  for (const claim of Array.isArray(claims) ? claims.filter(Boolean) : []) {
    const text = String(claim.text ?? "");
    if (!BIBLIOGRAPHIC_SUBJECT.test(text)) continue;
    if (EXPLICIT_UNVERIFIED.test(text)) continue;

    const assertsIdentity = IDENTITY_ASSERTED.test(text);
    const assertsPeerReview = PEER_REVIEW_ASSERTED.test(text);
    if (!assertsIdentity && !assertsPeerReview) continue;

    const bound = certificatesForClaim(claim, certificates).map((c) => assessments.get(c));
    if (assertsIdentity) {
      const identified = bound.some((assessment) => assessment.identityVerified);
      if (!identified) {
        offenders.push(claim.id);
        failureCodes.add("F18");
        for (const assessment of bound) {
          for (const code of assessment.failureCodes) failureCodes.add(code);
        }
        if (bound.length === 0) failureCodes.add("F01");
        continue;
      }
    }
    if (assertsPeerReview && !bound.some((assessment) => assessment.peerReviewVerified)) {
      offenders.push(claim.id);
      // §14: the identity may be sound; what is unknown is the review.
      failureCodes.add("F11");
      failureCodes.add("F18");
    }
  }

  if (offenders.length > 0) {
    return Object.freeze({
      code: "EPISTEMIC_SOURCE_IDENTITY_UNCERTIFIED",
      failureCodes: Object.freeze([...failureCodes]),
      severity: SEVERITY.CRITICAL,
      blockedClaimIds: Object.freeze([...new Set(offenders.filter(Boolean))]),
      guidance:
        "A cited work is presented as verified or peer-reviewed without a primary identity record. " +
        "Retrieve the canonical arXiv/DOI/publisher page, verify the venue separately, or report the " +
        "identity and the review status as unverified."
    });
  }

  // §24, §37 — the heading is itself an assertion about every row beneath it.
  if (VERIFIED_REFERENCES_HEADING.test(content)) {
    const unverified = certificates.filter(
      (certificate) => !assessments.get(certificate).identityVerified
    );
    if (certificates.length === 0 || unverified.length > 0) {
      return Object.freeze({
        code: "EPISTEMIC_SOURCE_SECTION_TITLE_UNAUTHORIZED",
        failureCodes: Object.freeze(["F18"]),
        severity: SEVERITY.CRITICAL,
        blockedClaimIds: Object.freeze([]),
        guidance:
          "A section titled as verified references lists an identity that was never certified from a " +
          "primary record. Retitle it to report per-row verification state, or certify every entry."
      });
    }
  }

  return null;
}
