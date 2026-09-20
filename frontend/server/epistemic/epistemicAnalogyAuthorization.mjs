/**
 * Q2-010 — rendering authority for ANALOGY and HYPOTHESIS claims.
 *
 * A cross-domain analogy may be published as a literal mechanism only when a
 * claim-bound, evidence-backed modeling bridge establishes every required
 * correspondence. Otherwise the prose must retain explicit analogy/hypothesis
 * framing.
 */
import { SEVERITY } from "./epistemicContracts.mjs";
import {
  MODELING_BRIDGE_STATUS,
  assessModelingBridge,
  requiredBridgeForClaim
} from "./epistemicModelingBridge.mjs";

export const ANALOGY_AUTHORITY = Object.freeze({
  FACT: "FACT",
  QUALIFIED_ANALOGY: "QUALIFIED_ANALOGY",
  HYPOTHESIS: "HYPOTHESIS"
});

const EXPLICIT_ANALOGY =
  /\b(?:analogia|analogy|quantum[- ]inspired|quantum[- ]ispirat\w+|si\s+pu[oò]\s+modellare|pu[oò]\s+essere\s+modellat\w+|we\s+(?:model|interpret)|interpretiamo|interpret(?:ed|iamo)?\s+as|is\s+compared\s+with)\b/iu;
const EXPLICIT_HYPOTHESIS =
  /\b(?:ipotesi|hypothesis|ipotizziamo|we\s+hypothesi[sz]e|congettura|conjecture|speculativ\w+|speculative)\b/iu;

function bridgeMatchesProfile(bridge, claim, profile) {
  if (!bridge || !profile) return false;
  if (claim?.id && bridge.claimId !== claim.id) return false;
  if (bridge.sourceDomain !== profile.sourceDomain) return false;
  if (bridge.targetDomain !== profile.targetDomain) return false;
  if (bridge.formalObject !== profile.formalObject) return false;
  if (bridge.intendedObject !== profile.intendedObject) return false;
  return (
    assessModelingBridge({
      bridge,
      requiredCorrespondence: profile.requiredCorrespondence
    }).status === MODELING_BRIDGE_STATUS.VERIFIED
  );
}

function hasVerifiedBridge(claim, bridges) {
  const profile = requiredBridgeForClaim(claim?.text ?? "");
  if (!profile) return false;
  return (Array.isArray(bridges) ? bridges : []).some((bridge) =>
    bridgeMatchesProfile(bridge, claim, profile)
  );
}

export function analogyAuthorityForClaim({ claim, bridges = [] } = {}) {
  const type = String(claim?.epistemicType ?? "").toUpperCase();
  if (type !== "ANALOGY" && type !== "HYPOTHESIS") return ANALOGY_AUTHORITY.FACT;
  if (hasVerifiedBridge(claim, bridges)) return ANALOGY_AUTHORITY.FACT;
  return type === "ANALOGY"
    ? ANALOGY_AUTHORITY.QUALIFIED_ANALOGY
    : ANALOGY_AUTHORITY.HYPOTHESIS;
}

function isExplicitlyQualified(claim) {
  const text = String(claim?.text ?? "");
  const type = String(claim?.epistemicType ?? "").toUpperCase();
  return type === "ANALOGY" ? EXPLICIT_ANALOGY.test(text) : EXPLICIT_HYPOTHESIS.test(text);
}

export function assessAnalogyAuthorization({ assistantContent = "", claims = [], bridges = [] } = {}) {
  const content = String(assistantContent ?? "");
  const offenders = [];
  const failureCodes = new Set();

  for (const claim of Array.isArray(claims) ? claims.filter(Boolean) : []) {
    const type = String(claim.epistemicType ?? "").toUpperCase();
    if (type !== "ANALOGY" && type !== "HYPOTHESIS") continue;
    const profile = requiredBridgeForClaim(claim.text ?? content);
    if (!profile || hasVerifiedBridge(claim, bridges) || isExplicitlyQualified(claim)) continue;

    offenders.push(claim.id);
    failureCodes.add(type === "ANALOGY" ? "F08" : "F09");
    failureCodes.add("F23");
  }

  if (offenders.length === 0) return null;
  return Object.freeze({
    decision: "EPISTEMIC_ANALOGY_PROMOTED_TO_FACT",
    code: "EPISTEMIC_ANALOGY_PROMOTED_TO_FACT",
    failureCodes: Object.freeze([...failureCodes]),
    severity: SEVERITY.CRITICAL,
    blockedClaimIds: Object.freeze([...new Set(offenders.filter(Boolean))]),
    guidance:
      "Keep the statement explicitly qualified as an analogy/hypothesis or provide a verified claim-bound modeling bridge."
  });
}
