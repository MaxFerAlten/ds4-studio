import { approxTokenCount } from "./fileIngestion.mjs";

export const DEFAULT_MAX_ANALYZE_CHUNKS = 64;
export const DEFAULT_MAX_AGENT_TOTAL_TOKENS = 120000;

export function readPositiveIntEnv(env, key, fallback) {
  const raw = env?.[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function maxAnalyzeChunks(env = process.env) {
  return readPositiveIntEnv(env, "DS4_MAX_ANALYZE_CHUNKS", DEFAULT_MAX_ANALYZE_CHUNKS);
}

export function maxAgentTotalTokens(env = process.env) {
  return readPositiveIntEnv(env, "DS4_AGENT_MAX_TOTAL_TOKENS", DEFAULT_MAX_AGENT_TOTAL_TOKENS);
}

export function analyzeChunkPlan(chunks, maxChunks = DEFAULT_MAX_ANALYZE_CHUNKS) {
  const count = Array.isArray(chunks) ? chunks.length : 0;
  return {
    phase: "plan",
    chunks: count,
    estimatedMapCalls: count,
    estimatedReduceCalls: count > 0 ? 1 : 0,
    maxChunks
  };
}

export function analyzeChunkLimitExceeded(chunks, maxChunks = DEFAULT_MAX_ANALYZE_CHUNKS) {
  const count = Array.isArray(chunks) ? chunks.length : 0;
  return count > maxChunks;
}

function estimateValueTokens(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "string") return approxTokenCount(value);
  return approxTokenCount(JSON.stringify(value));
}

export function estimateAgentMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    total += estimateValueTokens(message.content);
    total += estimateValueTokens(message.reasoning_content);
    total += estimateValueTokens(message.reasoning);
    total += estimateValueTokens(message.tool_calls);
    total += estimateValueTokens(message.name);
    total += estimateValueTokens(message.tool_call_id);
  }
  return total;
}

export function agentBudgetStatus(messages, usageTotals = {}, maxTokens = DEFAULT_MAX_AGENT_TOTAL_TOKENS) {
  const estimatedTokens = estimateAgentMessagesTokens(messages);
  const totalTokens = Number(usageTotals?.total_tokens) || 0;
  const status = {
    exceeded: false,
    reason: null,
    estimatedTokens,
    totalTokens,
    maxTokens
  };

  if (totalTokens >= maxTokens) {
    return { ...status, exceeded: true, reason: "backend_usage" };
  }
  if (estimatedTokens > maxTokens) {
    return { ...status, exceeded: true, reason: "estimated_messages" };
  }
  return status;
}

export function formatAgentBudgetError(status) {
  if (status?.reason === "backend_usage") {
    return `Agent token budget exceeded: ${status.totalTokens}/${status.maxTokens}`;
  }
  return `Agent token budget exceeded: estimated ${status?.estimatedTokens || 0}/${status?.maxTokens || 0}`;
}
