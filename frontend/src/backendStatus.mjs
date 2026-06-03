function statusLogEntries(status) {
  return (status?.logs || [])
    .map((entry) => ({
      time: typeof entry === "string" ? null : entry?.time || null,
      message: typeof entry === "string" ? entry : entry?.message || ""
    }))
    .filter((entry) => entry.message);
}

function statusMessages(status) {
  return statusLogEntries(status).map((entry) => entry.message);
}

function elapsedSeconds(fromTime, now) {
  if (!fromTime) return null;
  const start = new Date(fromTime).getTime();
  const end = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

export function backendHealthLabel(status) {
  if (status?.healthy) return "Healthy";
  const messages = statusMessages(status);
  if (messages.some((message) => message.includes("CUDA chunk-copying"))) {
    return "Loading GPU model";
  }
  return "Waiting for backend";
}

export function backendStartupDetail(status, now = new Date()) {
  if (!status?.running || status?.healthy) return "";
  const entries = statusLogEntries(status);
  const copyIndex = entries.findLastIndex((entry) => entry.message.includes("CUDA chunk-copying"));
  if (copyIndex === -1) return "";

  const copyEntry = entries[copyIndex];
  const size = copyEntry.message.match(/CUDA chunk-copying\s+([0-9.]+\s+GiB)\s+model image/);
  const initEntry = entries
    .slice(0, copyIndex + 1)
    .findLast((entry) => entry.message.includes("CUDA backend initialized"));
  const seconds = elapsedSeconds(initEntry?.time || copyEntry.time, now);
  const parts = [`Copying ${size?.[1] || "model"} to GPU`];
  if (seconds !== null) parts.push(`${seconds}s elapsed`);
  return parts.join(" · ");
}

export function streamFailureNotice(error) {
  const message = error?.message || String(error || "");
  if (message.includes("terminated") || message.includes("Backend connection closed")) {
    return "Stream failed: backend connection ended. Wait for Healthy, then retry.";
  }
  return `Stream failed: ${message}`;
}
