/**
 * Q2-004 (remediation.Quantiom.002 §7) — formal artifact binding.
 *
 * RC-03/RC-11: the Lean the reader sees and the Lean a checker ran are two
 * different objects, and the QHO transcript published the first under the
 * authority of the second — including code that ended in `sorry` and code whose
 * run timed out. Provenance is a hash comparison, so it is one here.
 *
 * This module says only where a rendered block came from. It never says what
 * the block means: that is scope (epistemicVerifierScope) and domain profile
 * work, and conflating the two is the failure this exists to stop (§7.5 FA-008).
 */

import { createHash } from "node:crypto";

import { auditLeanSource } from "./epistemicLeanAxiomAudit.mjs";

export const FORMAL_ARTIFACT_STATUS = Object.freeze({
  CHECKED_BOUND: "CHECKED_BOUND",
  CHECKED_DIFFERENT_SOURCE: "CHECKED_DIFFERENT_SOURCE",
  UNCHECKED: "UNCHECKED",
  INCOMPLETE: "INCOMPLETE",
  CONDITIONAL_AXIOM: "CONDITIONAL_AXIOM"
});

/** §18/§37 — headings and lead-ins that present a block as a checked proof. */
export const PROOF_SECTION_HEADINGS =
  /(?:dimostrazione\s+lean(?:\s+verificat\w+)?|prova\s+lean|lean\s+proof|formal\s+proof|machine[-\s]?checked\s+proof|dimostrazione\s+formale|proof\s+\(verified\)|verificat\w*\s+(?:con|in)\s+lean)/iu;

const LEAN_FENCE = /```[ \t]*(lean\d*)[ \t]*\r?\n([\s\S]*?)```/gi;

function sha256(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

/**
 * How much prose above a fence counts as its heading. One short lead-in, not
 * the whole answer: "Dimostrazione Lean (verificata)" sits directly above the
 * block it is lying about.
 */
const HEADING_LOOKBEHIND = 200;

/**
 * Pull every Lean block out of rendered assistant content, with the exact bytes
 * and their hash.
 *
 * @param {string} assistantContent
 * @returns {object[]}
 */
export function extractFormalArtifacts(assistantContent = "") {
  const content = String(assistantContent ?? "");
  const artifacts = [];
  let index = 0;
  // Where the previous fence ended: a heading only belongs to the block that
  // follows it, so the window never reaches back across an earlier block.
  let previousEnd = 0;

  for (const match of content.matchAll(LEAN_FENCE)) {
    const sourceText = match[2].replace(/\r\n/g, "\n").replace(/\n+$/, "");
    const start = match.index ?? 0;
    const preamble = content.slice(
      Math.max(previousEnd, start - HEADING_LOOKBEHIND),
      start
    );
    previousEnd = start + match[0].length;
    const audit = auditLeanSource(sourceText);

    artifacts.push({
      artifactId: `fa_${index}`,
      language: match[1].toLowerCase(),
      sourceText,
      sourceSha256: sha256(sourceText),
      renderedSpan: Object.freeze({ start, end: start + match[0].length }),
      renderedAsVerified: PROOF_SECTION_HEADINGS.test(preamble),
      containsSorry: /(?<![A-Za-z_])sorry(?![A-Za-z_])/.test(sourceText),
      containsAdmit: /(?<![A-Za-z_])admit(?![A-Za-z_])/.test(sourceText),
      containsAxiom: audit.localAxioms.length > 0
    });
    index += 1;
  }

  return artifacts;
}

/** The exact bytes a certificate says it checked, whatever field carries them. */
function checkedSourceOf(certificate) {
  return (
    certificate?.checkedSource ??
    certificate?.metadata?.checkedSource ??
    certificate?.source ??
    null
  );
}

function checkedHashOf(certificate) {
  const declared = certificate?.checkedSourceSha256 ?? certificate?.metadata?.checkedSourceSha256;
  if (typeof declared === "string" && /^[0-9a-f]{64}$/.test(declared)) return declared;
  const source = checkedSourceOf(certificate);
  return source === null ? null : sha256(String(source).replace(/\r\n/g, "\n").replace(/\n+$/, ""));
}

/**
 * Classify every rendered Lean block against the certificates this turn holds.
 *
 * Order matters. `sorry` and `admit` close nothing, so an INCOMPLETE artifact is
 * incomplete even when its bytes match a run that reported success — a checker
 * that accepts `sorry` reports elaboration, not proof (§7.4).
 *
 * @param {{assistantContent?: string, certificates?: object[]}} input
 * @returns {object[]} frozen artifacts with `status`, `boundCertificateId`, `failureCodes`.
 */
export function bindFormalArtifacts({ assistantContent = "", certificates = [] } = {}) {
  const certs = (Array.isArray(certificates) ? certificates : []).filter(Boolean);
  const byHash = new Map();
  for (const certificate of certs) {
    const hash = checkedHashOf(certificate);
    if (hash && !byHash.has(hash)) byHash.set(hash, certificate);
  }

  return extractFormalArtifacts(assistantContent).map((artifact) => {
    const certificate = byHash.get(artifact.sourceSha256) ?? null;
    const passed = String(certificate?.status ?? "").toUpperCase() === "PASSED";
    const failureCodes = new Set();

    let status;
    let boundCertificateId = null;
    if (artifact.containsSorry || artifact.containsAdmit) {
      status = FORMAL_ARTIFACT_STATUS.INCOMPLETE;
      failureCodes.add("F18");
      failureCodes.add("F35");
    } else if (artifact.containsAxiom) {
      status = FORMAL_ARTIFACT_STATUS.CONDITIONAL_AXIOM;
      failureCodes.add("F35");
      failureCodes.add("F40");
    } else if (certificate && passed) {
      status = FORMAL_ARTIFACT_STATUS.CHECKED_BOUND;
      boundCertificateId = certificate.id ?? null;
    } else if (certificate) {
      // Bytes match a run that did not succeed: rendering it as a proof is the
      // F19/F22 the transcript committed with the timed-out superposition proof.
      status = FORMAL_ARTIFACT_STATUS.UNCHECKED;
      failureCodes.add("F18");
      failureCodes.add("F22");
    } else if (certs.length > 0) {
      status = FORMAL_ARTIFACT_STATUS.CHECKED_DIFFERENT_SOURCE;
      failureCodes.add("F18");
      failureCodes.add("F19");
    } else {
      status = FORMAL_ARTIFACT_STATUS.UNCHECKED;
      failureCodes.add("F18");
    }

    return Object.freeze({
      ...artifact,
      boundCertificateId,
      checkedSourceSha256: certificate ? checkedHashOf(certificate) : null,
      checkedTargetStatementSha256:
        certificate?.checkedTargetStatementSha256 ??
        certificate?.metadata?.checkedTargetStatementSha256 ??
        null,
      status,
      failureCodes: Object.freeze([...failureCodes])
    });
  });
}

/**
 * §33.2 (UFAR numerator) — artifacts presented as verified proofs that no
 * certificate binds. Anything in this list is an escape.
 */
export function unboundVerifiedArtifacts(artifacts = []) {
  return (Array.isArray(artifacts) ? artifacts : []).filter(
    (artifact) =>
      artifact?.renderedAsVerified === true &&
      artifact.status !== FORMAL_ARTIFACT_STATUS.CHECKED_BOUND
  );
}
