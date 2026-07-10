import { summarizeToolResultForEvidence, appendContextEvidence, markEvidenceStaleByTarget } from "./contextEvidence.mjs";
import { appendContextEvent } from "./contextLedger.mjs";
import { recordProjectActiveFile } from "./contextProject.mjs";

/**
 * Persist synthetic evidence + a ledger event for one executed tool call.
 * Never persists raw output: only the compressed/lossy summary and blob ids
 * (§15.3). Best-effort — resolves to null and swallows errors so the tool flow
 * is never broken. No-op unless context is enabled or in preview-only mode.
 */
export async function recordToolContext({ sessionKey, tool, args, rawResult, compressed, config, workspace }) {
  if (!config || (!config.enabled && !config.previewOnly)) return null;
  const isError = Boolean(rawResult?.isError);
  const maxEvents = config.maxLedgerEvents;
  const blobIds = compressed?.blobId ? [compressed.blobId] : [];
  const evidence = summarizeToolResultForEvidence({
    tool,
    args,
    resultText: String(rawResult?.content ?? ""),
    compressedText: compressed?.content || rawResult?.content || "",
    blobIds
  });
  await appendContextEvidence(sessionKey, evidence, { maxEvents }).catch(() => {});
  await appendContextEvent(sessionKey, {
    type: isError ? "error" : (evidence.kind === "file_read" ? "file_read" : "tool_result"),
    source: tool,
    target: evidence.target,
    summary: evidence.summary,
    evidenceIds: [evidence.id],
    blobIds: evidence.blobIds,
    meta: { compressed: Boolean(compressed?.compressed) }
  }, { maxEvents }).catch(() => {});

  if (!isError && (tool === "write" || tool === "edit") && evidence.target) {
    // File changed: prior read/crawl snapshots of it are now stale.
    await markEvidenceStaleByTarget(sessionKey, evidence.target).catch(() => {});
  }
  if (!isError && workspace && evidence.kind === "file_read" && evidence.target) {
    await recordProjectActiveFile(workspace, evidence.target).catch(() => {});
  }
  return evidence;
}
