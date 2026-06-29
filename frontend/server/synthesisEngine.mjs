/**
 * Synthesis engine — enforces the rule that tool output is internal evidence,
 * not the final answer (§13). After tools run, this turns the gathered evidence
 * into a synthesis brief: a directive plus a compact cross-source digest
 * (claims, source quality, limitations, unresolved follow-ups) that the model
 * must turn into a single cited answer instead of pasting raw content.
 */

import { SOURCE_TYPES } from "./sourceCritic.mjs";

function isUsable(item) {
  return item.sourceType !== SOURCE_TYPES.UNRELATED && item.status !== "EMPTY";
}

/**
 * @param {object[]} evidenceItems EvidenceItems (from evidenceStore builders)
 * @param {{ question?: string }} [opts]
 * @returns {string}
 */
export function buildSynthesisBrief(evidenceItems = [], { question = "" } = {}) {
  const usable = evidenceItems.filter(isUsable);

  if (!usable.length) {
    return "SYNTHESIS REQUIRED. No usable evidence was gathered (sources were empty, " +
      "errored, or unrelated). Tell the user plainly what failed and suggest a next step. " +
      "Do not fabricate sources or answers.";
  }

  const lines = [
    "SYNTHESIS REQUIRED — the crawled/fetched content above is internal evidence, not your answer.",
    "Write one synthesized answer to the user's request, citing sources by URL.",
    "Prefer PRIMARY_OFFICIAL and RANKING_DATABASE sources; explicitly flag SECONDARY_EDITORIAL rankings as not authoritative.",
    "Do not paste raw content. State any unresolved gaps."
  ];
  if (question) {
    lines.push("");
    lines.push(`User request: ${question}`);
  }
  lines.push("");
  lines.push("Evidence:");
  usable.forEach((item, i) => {
    const claims = item.extractedClaims.slice(0, 3).map((c) => c.claim).join(" | ");
    const limits = item.limitations.join("; ");
    lines.push(
      `[${i + 1}] ${item.url || "(no url)"} (${item.sourceType}, ${item.quality})` +
      (claims ? ` — claims: ${claims}` : "") +
      (limits ? ` — limits: ${limits}` : "")
    );
  });

  const followUps = evidenceItems
    .flatMap((item) => (item.nextLinks?.length ? item.nextLinks : item.nextAction === "seek_better_source" ? [item.url] : []))
    .filter(Boolean);
  if (followUps.length) {
    lines.push("");
    lines.push(`Unresolved (consider crawling next): ${[...new Set(followUps)].slice(0, 10).join(", ")}`);
  }

  return lines.join("\n");
}
