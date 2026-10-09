import { compressToolResultForModel } from "./toolOutputCompressor.mjs";

export async function compressAgentToolResult({
  enabled,
  toolName,
  result,
  blobStore,
  metrics
}) {
  if (!enabled || result?.isError) return { ...result, compressed: false };
  const compressed = await compressToolResultForModel(toolName, result, blobStore);
  if (compressed.compressed) metrics?.recordCompression?.(compressed.compression);
  return compressed;
}
