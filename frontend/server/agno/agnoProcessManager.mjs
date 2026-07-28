import path from "node:path";
import { Ds4ProcessManager } from "../processManager.mjs";
import { agentUiAllowedOrigins } from "./agnoUiConfig.mjs";

export function loopbackOrigin(host, port) {
  const renderedHost = host === "::1" ? "[::1]" : host;
  return `http://${renderedHost}:${port}`;
}

/**
 * Create a Ds4ProcessManager configured for the Agno sidecar Python process.
 *
 * @param {object} options
 * @param {string} options.projectRoot - absolute path to project root
 * @param {object} options.config - merged config (config.agno.*)
 * @param {object} options.tokens - { serviceToken, modelGatewayToken, toolBridgeToken }
 * @param {string} options.resolvedModel - resolved model ID
 * @param {string} options.resolvedServiceDir - resolved service directory path
 * @param {string} options.resolvedDbFile - resolved db file path
 * @param {string} options.ownerId - generated owner ID
 * @param {function} options.fetchImpl - fetch function (for testing)
 * @returns {Ds4ProcessManager}
 */
export function createAgnoProcessManager({
  projectRoot,
  config,
  tokens,
  resolvedModel,
  resolvedServiceDir,
  resolvedDbFile,
  ownerId,
  fetchImpl = fetch,
}) {
  const ag = config.agno || {};
  const pythonBin = ag.python
    ? path.resolve(ag.python)
    : path.join(resolvedServiceDir, ".venv", "bin", "python");
  const controlHost = config.control.host;
  const controlPort = config.control.port;
  const controlOrigin = loopbackOrigin(controlHost, controlPort);

  const buildCommand = () => ({
    command: pythonBin,
    args: ["-m", "ds4_agno.cli"],
  });

  const buildEnv = () => ({
    PYTHONUNBUFFERED: "1",
    PYTHONPATH: path.join(resolvedServiceDir, "src"),
    DS4_AGNO_HOST: ag.host,
    DS4_AGNO_PORT: String(ag.port),
    DS4_AGNO_OWNER_ID: ownerId,
    DS4_AGNO_SERVICE_TOKEN: tokens.serviceToken,
    DS4_AGNO_MODEL_GATEWAY_TOKEN: tokens.modelGatewayToken,
    DS4_AGNO_TOOL_BRIDGE_TOKEN: tokens.toolBridgeToken,
    DS4_AGNO_DS4_STUDIO_BASE_URL: controlOrigin,
    DS4_AGNO_TOOL_BRIDGE_BASE_URL: `${controlOrigin}/api/internal/agno-tools`,
    DS4_AGNO_TOOLS_ENABLED: String(Boolean(ag.tools?.enabled)).toLowerCase(),
    DS4_AGNO_TOOL_PROFILE: ag.tools?.profile || "safe",
    DS4_AGNO_TOOL_REQUEST_TIMEOUT_SECONDS: String(
      (ag.tools?.requestTimeoutMs || 120_000) / 1000
    ),
    DS4_AGNO_TOOL_MAX_HISTORY_MESSAGES: String(
      ag.tools?.maxHistoryMessages || 64
    ),
    DS4_AGNO_TOOL_MAX_HISTORY_BYTES: String(
      ag.tools?.maxHistoryBytes || 65_536
    ),
    DS4_AGNO_DS4_MODEL: resolvedModel,
    DS4_AGNO_DB_FILE: resolvedDbFile,
    DS4_AGNO_TELEMETRY: "false",
    DS4_AGNO_TRACING: "false",
    DS4_AGNO_SCHEDULER: "false",
    DS4_AGNO_MCP_ENABLED: "false",
    AGNO_TELEMETRY: "false",
    DS4_AGNO_CORS_ALLOWED_ORIGINS: JSON.stringify(
      ag.agentUi ? agentUiAllowedOrigins(config) : []
    ),
  });

  const healthCheck = async () => {
    const url = `${loopbackOrigin(ag.host, ag.port)}/ds4/health`;
    try {
      const resp = await fetchImpl(url, { signal: AbortSignal.timeout(2000) });
      if (!resp.ok) return false;
      const body = await resp.json();
      return (
        body.ok === true &&
        body.service === "ds4-agno-service" &&
        body.owner === ownerId &&
        body.telemetry === false
      );
    } catch {
      return false;
    }
  };

  return new Ds4ProcessManager({
    buildCommand,
    buildEnv,
    healthCheck,
    cwd: resolvedServiceDir,
  });
}

/**
 * Create a disabled (no-op) process manager for when Agno is not enabled.
 * @returns {object} status object that always reports disabled
 */
export function createDisabledAgnoProcessManager() {
  const disabled = {
    configured: false,
    enabled: false,
    running: false,
    healthy: false,
    pid: null,
    host: null,
    port: null,
    owner: null,
    startedAt: null,
    lastHealthAt: null,
    lastError: null,
    queue: { inflight: 0, queued: 0, maxQueued: 0 },
  };
  return {
    status: () => disabled,
    start: async () => disabled,
    stop: async () => disabled,
    restart: async () => disabled,
    refreshHealth: async () => false,
  };
}
