/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/acceptance-contract.md Critic requirements.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: canonical hash evidence pattern.
 */

import { hashJson } from "./evolutionIntegrity.mjs";

export const EVOLUTION_EVIDENCE_PACKET_VERSION = "ds4_evolution_evidence_packet_v1";

function sortedStrings(values) {
  return [...new Set((values ?? []).map(String))].sort();
}

function metricObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function boundedJson(value, maxBytes) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    const error = new Error(`evidence packet exceeds ${maxBytes} bytes`);
    error.code = "EVIDENCE_PACKET_TOO_LARGE";
    throw error;
  }
  return value;
}

export function buildEvidencePacket(input, options = {}) {
  const runId = String(input?.runId ?? "");
  const revision = input?.revision;
  if (!/^evo_[a-f0-9]{20}$/.test(runId) || !Number.isSafeInteger(revision) || revision <= 0) {
    const error = new Error("valid runId and revision are required");
    error.code = "INVALID_EVIDENCE_OWNERSHIP";
    throw error;
  }
  const evidence = (input.evidence ?? []).slice(0, 64).map((entry) => {
    if (entry.runId !== runId || entry.revision !== revision) {
      const error = new Error("evidence reference is not owned by this run/revision");
      error.code = "CROSS_RUN_ACCESS_ATTEMPT";
      throw error;
    }
    return {
      runId,
      revision,
      artifactId: String(entry.artifactId ?? ""),
      path: String(entry.path ?? "").replaceAll("\\", "/"),
      summary: String(entry.summary ?? "").slice(0, 2_000)
    };
  }).sort((left, right) => `${left.path}:${left.artifactId}`.localeCompare(`${right.path}:${right.artifactId}`));
  const body = {
    packetVersion: EVOLUTION_EVIDENCE_PACKET_VERSION,
    runId,
    revision,
    objective: String(input.objective ?? "").slice(0, 20_000),
    baselineMetrics: metricObject(input.baselineMetrics),
    candidateMetrics: metricObject(input.candidateMetrics),
    violations: sortedStrings(input.violations),
    diffSummary: metricObject(input.diffSummary),
    evidence,
    rejectedStrategies: sortedStrings(input.rejectedStrategies).slice(0, 32),
    budget: metricObject(input.budget)
  };
  const packet = { ...body, packetHash: hashJson(body) };
  return Object.freeze(boundedJson(packet, options.maxBytes ?? 128_000));
}
