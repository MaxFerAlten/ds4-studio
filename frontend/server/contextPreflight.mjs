import crypto from "node:crypto";
import { approxTokenCount } from "./fileIngestion.mjs";
import { estimateAgentMessagesTokens } from "./costLimits.mjs";
import { makeContextCapsuleMessage } from "./contextCapsule.mjs";

export function hashText(text) {
  return crypto.createHash("sha1").update(String(text || "")).digest("hex");
}

export function pruneCapsuleToBudget(text, hardTokens) {
  const input = String(text || "");
  if (approxTokenCount(input) <= hardTokens) return input;

  const lines = input.split(/\r?\n/);
  const keep = [];
  for (const line of lines) {
    const candidate = [...keep, line].join("\n");
    if (approxTokenCount(candidate) > hardTokens) break;
    keep.push(line);
  }
  if (!keep.includes("[/DS4_CONTEXT_CAPSULE]")) keep.push("[/DS4_CONTEXT_CAPSULE]");
  let out = keep.join("\n");
  while (approxTokenCount(out) > hardTokens && keep.length > 2) {
    keep.splice(keep.length - 2, 1);
    out = keep.join("\n");
  }
  return out;
}

export function preflightContextCapsule({
  session,
  baseMessages,
  tools,
  capsuleText,
  previousCapsuleMeta = null,
  config
}) {
  const rawText = String(capsuleText || "");
  const rawTokens = approxTokenCount(rawText);
  const prunedText = pruneCapsuleToBudget(rawText, config.hardTokens);
  const capsuleTokens = approxTokenCount(prunedText);
  const capsuleHash = hashText(prunedText);
  const previousTokens = Number(previousCapsuleMeta?.tokens || 0);
  const growthPct = previousTokens > 0 ? Math.round(((capsuleTokens - previousTokens) / previousTokens) * 100) : 0;

  const reasons = [];
  if (!rawText.trim()) reasons.push("empty_capsule");
  if (capsuleTokens > config.hardTokens) reasons.push("hard_token_limit");
  if (previousTokens > 0 && growthPct > config.maxGrowthPct) reasons.push("growth_limit");

  const inject = !reasons.length && capsuleHash !== previousCapsuleMeta?.hash;
  const candidateMessages = inject
    ? [...baseMessages, makeContextCapsuleMessage(prunedText)]
    : [...baseMessages];

  let payloadMode = "unknown";
  let payloadReason = "not_probed";
  let deltaMessages = null;
  let resetRisk = false;

  if (session && typeof session.choosePayload === "function") {
    const probe = session.choosePayload(
      { messages: candidateMessages, tools },
      { allowDelta: true, userTurnPolicy: "delta" }
    );
    payloadMode = probe?.mode || "unknown";
    payloadReason = probe?.reason || null;
    deltaMessages = probe?.payload?.delta?.messages?.length ?? null;
    const revision = Number(session.status?.().revision || 0);
    resetRisk = config.deltaRequired && revision > 0 && payloadMode !== "delta";
    if (resetRisk) reasons.push("reset_risk");
  }

  const estimatedPromptTokens = estimateAgentMessagesTokens(candidateMessages);

  return {
    ok: reasons.length === 0,
    reasons,
    inject,
    text: prunedText,
    rawTokens,
    capsuleTokens,
    capsuleHash,
    previousTokens,
    growthPct,
    payloadMode,
    payloadReason,
    deltaMessages,
    resetRisk,
    estimatedPromptTokens
  };
}
