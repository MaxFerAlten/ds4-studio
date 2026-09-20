/**
 * Q2-011 (remediation.Quantiom.002 §14, §24, §25, §52) — EPI-074.
 *
 * A paper mentioned in a search overview is not an identified paper, and an
 * arXiv posting is not a peer review. Both were published as "verificati e
 * peer-reviewed" in the QHO transcript.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SOURCE_RECORD_TYPE,
  IDENTITY_FIELD,
  assessSourceIdentityCertificate,
  assessBibliographicAuthorization
} from "./epistemicSourceIdentityAuthority.mjs";

const arxivRecord = Object.freeze({
  claimId: "C5",
  sourceType: SOURCE_RECORD_TYPE.ARXIV_ABSTRACT,
  retrievalStatus: "SUCCESS",
  canonicalUrl: "https://arxiv.org/abs/2504.13202",
  provider: "arxiv",
  title: "Quantum-inspired semantic representations",
  authors: ["A. Rossi", "B. Bianchi"],
  identifier: "arXiv:2504.13202",
  publicationVenue: null,
  peerReviewStatus: "UNKNOWN",
  retrievedAt: "2026-08-30T00:00:00.000Z"
});

const aiOverviewMention = Object.freeze({
  claimId: "C6",
  sourceType: SOURCE_RECORD_TYPE.AI_OVERVIEW,
  retrievalStatus: "SUCCESS",
  canonicalUrl: "https://scholar.google.com/scholar?q=quantum+semantics",
  provider: "google_scholar_ai_overview",
  title: "Quantum semantics for language models",
  authors: [],
  identifier: null,
  publicationVenue: null,
  peerReviewStatus: "UNKNOWN",
  retrievedAt: "2026-08-30T00:00:00.000Z"
});

test("Q2-011 (§25): a primary record verifies the identity fields it actually carries", () => {
  const assessment = assessSourceIdentityCertificate(arxivRecord);
  assert.equal(assessment.identityVerified, true);
  assert.deepEqual(assessment.failureCodes, []);
  assert.ok(assessment.identityFieldsVerified.includes(IDENTITY_FIELD.TITLE));
  assert.ok(assessment.identityFieldsVerified.includes(IDENTITY_FIELD.AUTHORS));
  assert.ok(assessment.identityFieldsVerified.includes(IDENTITY_FIELD.IDENTIFIER));
});

test("Q2-011 (§14): an arXiv identity is never a peer review", () => {
  const assessment = assessSourceIdentityCertificate(arxivRecord);
  assert.equal(assessment.peerReviewVerified, false);
  assert.ok(!assessment.identityFieldsVerified.includes(IDENTITY_FIELD.PEER_REVIEW));
  assert.ok(!assessment.identityFieldsVerified.includes(IDENTITY_FIELD.VENUE));
});

test("Q2-011 (§52): an AI-overview mention cannot verify a paper's identity", () => {
  const assessment = assessSourceIdentityCertificate(aiOverviewMention);
  assert.equal(assessment.identityVerified, false);
  assert.ok(assessment.failureCodes.includes("F13"));
});

test("Q2-011 (§25): a retrieval that did not succeed verifies nothing", () => {
  const assessment = assessSourceIdentityCertificate({
    ...arxivRecord,
    retrievalStatus: "FAILED"
  });
  assert.equal(assessment.identityVerified, false);
  assert.ok(assessment.failureCodes.includes("F01"));
});

test("Q2-011 (§14): a publisher record with a venue does verify peer review", () => {
  const assessment = assessSourceIdentityCertificate({
    ...arxivRecord,
    sourceType: SOURCE_RECORD_TYPE.JOURNAL_PAGE,
    canonicalUrl: "https://doi.org/10.1000/qsem.2026.4",
    identifier: "10.1000/qsem.2026.4",
    publicationVenue: "Journal of Quantum Semantics",
    peerReviewStatus: "PEER_REVIEWED"
  });
  assert.equal(assessment.peerReviewVerified, true);
  assert.ok(assessment.identityFieldsVerified.includes(IDENTITY_FIELD.PEER_REVIEW));
});

test("EPI-074 (§14): a secondary mention published as a certified arXiv paper is blocked", () => {
  const text =
    "Entrambi i paper sono pubblicati su arXiv e la loro identita e stata verificata.";
  const decision = assessBibliographicAuthorization({
    assistantContent: text,
    claims: [{ id: "C6", text, epistemicType: "SOURCE_FACT" }],
    sourceCertificates: [aiOverviewMention]
  });
  assert.ok(decision, "an unidentified paper published as verified must block");
  assert.equal(decision.code, "EPISTEMIC_SOURCE_IDENTITY_UNCERTIFIED");
  assert.ok(decision.failureCodes.includes("F13"));
  assert.ok(decision.failureCodes.includes("F18"));
  assert.deepEqual(decision.blockedClaimIds, ["C6"]);
});

test("EPI-074 (§14): an arXiv identity published as peer-reviewed is blocked", () => {
  const text = "Il paper e pubblicato su arXiv ed e peer-reviewed.";
  const decision = assessBibliographicAuthorization({
    assistantContent: text,
    claims: [{ id: "C5", text, epistemicType: "SOURCE_FACT" }],
    sourceCertificates: [arxivRecord]
  });
  assert.ok(decision, "arXiv identity does not authorise a peer-review claim");
  assert.ok(decision.failureCodes.includes("F11"));
  assert.deepEqual(decision.blockedClaimIds, ["C5"]);
});

test("EPI-074 (§14): the honest narrowing is allowed", () => {
  const text =
    "Il primo paper e identificato sulla pagina arXiv; lo stato di peer review resta non verificato.";
  const decision = assessBibliographicAuthorization({
    assistantContent: text,
    claims: [{ id: "C5", text, epistemicType: "SOURCE_FACT" }],
    sourceCertificates: [arxivRecord]
  });
  assert.equal(decision, null);
});

test("Q2-011 (§24, §37): a 'Riferimenti verificati' heading needs every listed identity verified", () => {
  const content = "## Riferimenti verificati\n\nRossi et al., Quantum semantics.";
  const decision = assessBibliographicAuthorization({
    assistantContent: content,
    claims: [],
    sourceCertificates: [arxivRecord, aiOverviewMention]
  });
  assert.ok(decision, "a verified-references heading over an unverified identity must block");
  assert.equal(decision.code, "EPISTEMIC_SOURCE_SECTION_TITLE_UNAUTHORIZED");
  assert.ok(decision.failureCodes.includes("F18"));
});

test("Q2-011 (§24): the neutral heading is allowed over the same references", () => {
  const content = "## Riferimenti e stato di verifica\n\nRossi et al., Quantum semantics.";
  assert.equal(
    assessBibliographicAuthorization({
      assistantContent: content,
      claims: [],
      sourceCertificates: [arxivRecord, aiOverviewMention]
    }),
    null
  );
});

test("Q2-011: a turn with no bibliographic claim is untouched", () => {
  assert.equal(
    assessBibliographicAuthorization({
      assistantContent: "The build completed successfully.",
      claims: [{ id: "C1", text: "The build completed successfully.", epistemicType: "EXECUTED" }],
      sourceCertificates: []
    }),
    null
  );
});
