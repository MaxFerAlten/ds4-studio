import { Ds4ProcessManager } from "../processManager.mjs";
import { agentUiUrl, assertAgentUiBuildReady } from "./agnoUiConfig.mjs";

async function readLimitedText(response, limit = 4096) {
  const text = await response.text();
  return text.slice(0, limit);
}

export function createAgentUiProcessManager({ config, runtimeDir, expectedCommit, fetchImpl = fetch }) {
  const { host, port } = config.agno.agentUi;

  const buildCommand = () => ({
    command: "pnpm",
    args: ["exec", "next", "start", "-H", host, "-p", String(port)]
  });

  const buildEnv = () => ({
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1"
  });

  const healthCheck = async () => {
    try {
      const response = await fetchImpl(agentUiUrl(config), { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return false;
      const body = await readLimitedText(response);
      return /<title>\s*Agent UI\s*<\/title>/i.test(body);
    } catch {
      return false;
    }
  };

  const manager = new Ds4ProcessManager({
    buildCommand,
    buildEnv,
    healthCheck,
    cwd: runtimeDir
  });

  const publicStatus = () => {
    const { running, pid, healthy, lastExit } = manager.status();
    return { running, pid, healthy, lastExit, host, port, url: agentUiUrl(config), upstreamCommit: expectedCommit };
  };

  return {
    cwd: runtimeDir,
    resolveCommand: () => manager.resolveCommand(),
    buildEnv,
    setOverrideCommand: (argv) => manager.setOverrideCommand(argv),
    healthCheck,
    status: publicStatus,
    async start() {
      await assertAgentUiBuildReady({ runtimeDir, expectedCommit });
      await manager.start();
      return publicStatus();
    },
    async stop() {
      await manager.stop();
      return publicStatus();
    },
    async refreshHealth() {
      await manager.refreshHealth();
      return publicStatus();
    }
  };
}

export function createDisabledAgentUiProcessManager({ config }) {
  const status = () => ({
    configured: false,
    enabled: false,
    running: false,
    healthy: false,
    pid: null,
    host: config?.agno?.agentUi?.host ?? null,
    port: config?.agno?.agentUi?.port ?? null
  });

  return {
    status,
    async start() {
      return status();
    },
    async stop() {
      return status();
    },
    async refreshHealth() {
      return status();
    }
  };
}
