import { appendContextEvent } from "./contextLedger.mjs";
import { buildContextCapsule, makeContextCapsuleMessage } from "./contextCapsule.mjs";
import { preflightContextCapsule } from "./contextPreflight.mjs";
import { readCapsuleMeta, writeCapsuleMeta } from "./contextCapsuleMeta.mjs";
import { appendContextTelemetry } from "./contextTelemetry.mjs";

/**
 * Shape the read-only diagnostics payload (§15). Pure: never includes the raw
 * sessionKey, full capsule text, raw evidence, or blob ids/content — only
 * sanitized summaries safe to expose over the debug endpoint.
 */
export function contextStatusPayload({ config, meta, telemetry, events }) {
  return {
    enabled: Boolean(config?.enabled),
    previewOnly: Boolean(config?.previewOnly),
    capsule: meta ? { tokens: meta.tokens, hash: meta.hash, updatedAt: meta.updatedAt } : null,
    recentTelemetry: Array.isArray(telemetry) ? telemetry : [],
    recentEvents: (Array.isArray(events) ? events : []).map((e) => ({
      id: e.id, at: e.at, type: e.type, target: e.target, summary: e.summary
    }))
  };
}

/**
 * Build the context capsule, run the delta-safe preflight, log telemetry, and
 * return a capsule message ONLY when the injection gate (§14.1) allows it.
 *
 * Pure w.r.t. the transcript: it never mutates `fullMessages`; the caller pushes
 * `capsuleMessage` when present. Always resolves — on any failure it falls back
 * to baseline (no capsule), never throws, never resets the session.
 */
export async function prepareContextInjection({ sessionKey, session, fullMessages, tools, userMessage, config }) {
  const result = { capsuleMessage: null, preflight: null, injected: false, config };
  if (!config || (!config.enabled && !config.previewOnly)) return result;

  const maxEvents = config.maxLedgerEvents;
  await appendContextEvent(sessionKey, {
    type: "user_goal",
    source: "user",
    summary: userMessage || "",
    meta: { route: "/api/agent/chat" }
  }, { maxEvents }).catch(() => {});

  const capsuleText = await buildContextCapsule({ sessionKey, userMessage, config }).catch(() => "");
  const previousMeta = await readCapsuleMeta(sessionKey).catch(() => null);

  let preflight;
  try {
    preflight = preflightContextCapsule({
      session,
      baseMessages: fullMessages,
      tools,
      capsuleText,
      previousCapsuleMeta: previousMeta,
      config
    });
  } catch {
    return result; // §3.4 preflight failed → baseline, no capsule, no reset
  }
  result.preflight = preflight;

  const revision = Number(session?.status?.().revision || 0);
  // Mirror the preflight verdict into the ledger (telemetry has the full metrics).
  await appendContextEvent(sessionKey, {
    type: "context_preflight",
    source: "context",
    summary: `ok=${preflight.ok} inject=${preflight.inject} mode=${preflight.payloadMode} tokens=${preflight.capsuleTokens}`,
    meta: { reasons: preflight.reasons, resetRisk: preflight.resetRisk }
  }, { maxEvents }).catch(() => {});
  await appendContextTelemetry(sessionKey, {
    event: "context_preflight",
    revision,
    ok: preflight.ok,
    reasons: preflight.reasons,
    inject: preflight.inject,
    capsuleTokens: preflight.capsuleTokens,
    rawTokens: preflight.rawTokens,
    growthPct: preflight.growthPct,
    payloadMode: preflight.payloadMode,
    payloadReason: preflight.payloadReason,
    deltaMessages: preflight.deltaMessages,
    resetRisk: preflight.resetRisk,
    estimatedPromptTokens: preflight.estimatedPromptTokens,
    previewOnly: config.previewOnly
  }, { enabled: config.telemetry, maxEvents }).catch(() => {});

  // §14.1 injection gate — every condition must hold.
  const canInject =
    config.enabled === true &&
    config.previewOnly === false &&
    preflight.ok === true &&
    preflight.inject === true &&
    preflight.resetRisk === false &&
    preflight.capsuleTokens <= config.hardTokens;

  if (canInject) {
    result.capsuleMessage = makeContextCapsuleMessage(preflight.text);
    result.injected = true;
    await writeCapsuleMeta(sessionKey, {
      hash: preflight.capsuleHash,
      tokens: preflight.capsuleTokens,
      updatedAt: new Date().toISOString(),
      lastPayloadMode: preflight.payloadMode,
      lastReason: null
    }).catch(() => {});
  }
  return result;
}
