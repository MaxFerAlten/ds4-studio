export const SAGE_MIXED_TOOL_BLOCK_FORBIDDEN = "SAGE_MIXED_TOOL_BLOCK_FORBIDDEN";

export function sageToolBlockDecision(toolCalls = []) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const sageCalls = calls.filter((call) => call?.name === "sage");
  if (sageCalls.length > 0 && calls.length !== 1) {
    return {
      allowed: false,
      code: SAGE_MIXED_TOOL_BLOCK_FORBIDDEN,
      message: "Sage must be the only tool call in its tool block."
    };
  }
  return { allowed: true };
}

export function guardSageFinalization(tracker) {
  if (!tracker?.snapshot().runId || tracker.canFinalize()) {
    return { blocked: false };
  }
  return { blocked: true, ...tracker.recordPrematureFinalization() };
}

export function authoritativeSageFinalFromResult(result = {}) {
  if (result?.publishable !== true ||
      result?.authoritative !== true ||
      result?.validationPassed !== true ||
      typeof result?.finalMarkdown !== "string" ||
      !result.finalMarkdown.trim()) {
    return null;
  }
  return {
    content: result.finalMarkdown,
    runId: result.runId ?? result.sageResult?.runId ?? null,
    sageResult: result.sageResult ?? null
  };
}

export function canonicalSageCommitPending(pending = {}) {
  const requestMessages = Array.isArray(pending?.fullMessages)
    ? pending.fullMessages
    : Array.isArray(pending?.requestMessages)
      ? pending.requestMessages
      : [];
  return {
    mode: "reset",
    parentRevision: 0,
    requestMessages: [...requestMessages],
    toolsHash: pending?.toolsHash,
    sessionId: pending?.sessionId
  };
}

export function sageArtifactKinds(result = {}) {
  const artifacts = Array.isArray(result?.artifacts)
    ? result.artifacts
    : Array.isArray(result?.sageResult?.artifacts)
      ? result.sageResult.artifacts
      : [];
  return artifacts.map((artifact) => String(artifact?.kind ?? "")).filter(Boolean);
}
