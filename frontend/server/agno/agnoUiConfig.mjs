import fs from "node:fs/promises";
import path from "node:path";

export function resolveAgentUiRuntimeDir({ projectRoot, config }) {
  const relative = config?.agno?.agentUi?.runtimeDir;

  if (typeof relative !== "string" || !relative.trim()) {
    throw new Error("agno.agentUi.runtimeDir must be a non-empty string");
  }

  if (path.isAbsolute(relative)) {
    throw new Error("agno.agentUi.runtimeDir must be relative");
  }

  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, relative);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("agno.agentUi.runtimeDir escapes project root");
  }

  return resolved;
}

export async function readAgentUiReadyMarker(runtimeDir) {
  const markerPath = path.join(runtimeDir, ".ds4-ready");
  const raw = await fs.readFile(markerPath, "utf8");
  const result = {};

  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const index = line.indexOf("=");
    if (index <= 0) throw new Error("invalid Agent UI ready marker");
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    result[key] = value;
  }

  return result;
}

export async function assertAgentUiBuildReady({ runtimeDir, expectedCommit }) {
  const marker = await readAgentUiReadyMarker(runtimeDir);

  if (marker.commit !== expectedCommit) {
    throw new Error(
      `Agent UI commit mismatch: expected ${expectedCommit}, got ${marker.commit || "missing"}`
    );
  }

  await fs.access(path.join(runtimeDir, ".next", "BUILD_ID"));
  await fs.access(path.join(runtimeDir, "node_modules"));
  await fs.access(path.join(runtimeDir, "package.json"));

  return marker;
}

export function agentUiUrl(config) {
  const { host, port } = config.agno.agentUi;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("Agent UI host is not loopback");
  }
  const browserHost = host === "::1" ? "[::1]" : host;
  return `http://${browserHost}:${port}`;
}

export function agentUiAllowedOrigins(config) {
  const port = config.agno.agentUi.port;
  return [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`
  ];
}
