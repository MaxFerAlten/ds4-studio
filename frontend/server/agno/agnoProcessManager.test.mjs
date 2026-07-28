import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createAgnoProcessManager,
  createDisabledAgnoProcessManager,
  loopbackOrigin,
} from "./agnoProcessManager.mjs";

const PROJECT_ROOT = "/tmp/test-project";

describe("createAgnoProcessManager", () => {
  const config = {
    control: { host: "127.0.0.1", port: 5173 },
    agno: {
      host: "127.0.0.1",
      port: 7777,
      startupTimeoutMs: 30_000,
      shutdownTimeoutMs: 5_000,
      tools: {
        enabled: true,
        profile: "safe",
        requestTimeoutMs: 45_000,
        maxHistoryMessages: 48,
        maxHistoryBytes: 32_768,
      },
    },
  };
  const tokens = {
    serviceToken: "x".repeat(43),
    modelGatewayToken: "y".repeat(43),
    toolBridgeToken: "z".repeat(43),
  };

  it("creates a Ds4ProcessManager with correct build command", () => {
    const pm = createAgnoProcessManager({
      projectRoot: PROJECT_ROOT,
      config,
      tokens,
      resolvedModel: "deepseek-v4-flash",
      resolvedServiceDir: path.join(PROJECT_ROOT, "agno_service"),
      resolvedDbFile: path.join(PROJECT_ROOT, "data/agno/agno.db"),
      ownerId: "test-owner-id",
    });
    const { command, args } = pm.resolveCommand();
    assert(command.endsWith("/python"), `expected python, got ${command}`);
    assert(args[0] === "-m");
    assert(args[1] === "ds4_agno.cli");
  });

  it("builds environment with required variables", () => {
    const pm = createAgnoProcessManager({
      projectRoot: PROJECT_ROOT,
      config,
      tokens,
      resolvedModel: "deepseek-v4-flash",
      resolvedServiceDir: path.join(PROJECT_ROOT, "agno_service"),
      resolvedDbFile: path.join(PROJECT_ROOT, "data/agno/agno.db"),
      ownerId: "test-owner-id",
    });
    const env = pm.buildEnv();
    assert(env.DS4_AGNO_HOST === "127.0.0.1");
    assert(env.DS4_AGNO_PORT === "7777");
    assert(env.DS4_AGNO_OWNER_ID === "test-owner-id");
    assert(env.DS4_AGNO_SERVICE_TOKEN === tokens.serviceToken);
    assert(env.DS4_AGNO_TOOL_BRIDGE_TOKEN === tokens.toolBridgeToken);
    assert(env.DS4_AGNO_DS4_STUDIO_BASE_URL === "http://127.0.0.1:5173");
    assert(env.DS4_AGNO_TOOL_BRIDGE_BASE_URL === "http://127.0.0.1:5173/api/internal/agno-tools");
    assert(env.DS4_AGNO_TOOLS_ENABLED === "true");
    assert(env.DS4_AGNO_TOOL_PROFILE === "safe");
    assert(env.DS4_AGNO_TOOL_REQUEST_TIMEOUT_SECONDS === "45");
    assert(env.DS4_AGNO_TOOL_MAX_HISTORY_MESSAGES === "48");
    assert(env.DS4_AGNO_TOOL_MAX_HISTORY_BYTES === "32768");
    assert(env.DS4_AGNO_DS4_MODEL === "deepseek-v4-flash");
    assert(env.DS4_AGNO_TELEMETRY === "false");
    assert(env.AGNO_TELEMETRY === "false");
  });

  it("renders IPv4, localhost and IPv6 loopback origins safely", () => {
    assert.strictEqual(loopbackOrigin("127.0.0.1", 5173), "http://127.0.0.1:5173");
    assert.strictEqual(loopbackOrigin("localhost", 5173), "http://localhost:5173");
    assert.strictEqual(loopbackOrigin("::1", 5173), "http://[::1]:5173");
  });

  it("CORS origins empty when agentUi not configured", () => {
    const pm = createAgnoProcessManager({
      projectRoot: PROJECT_ROOT,
      config,
      tokens,
      resolvedModel: "deepseek-v4-flash",
      resolvedServiceDir: path.join(PROJECT_ROOT, "agno_service"),
      resolvedDbFile: path.join(PROJECT_ROOT, "data/agno/agno.db"),
      ownerId: "test-owner-id",
    });
    const env = pm.buildEnv();
    assert.strictEqual(env.DS4_AGNO_CORS_ALLOWED_ORIGINS, JSON.stringify([]));
  });

  it("CORS origins set from agentUi port when configured", () => {
    const configWithAgentUi = {
      ...config,
      agno: { ...config.agno, agentUi: { host: "127.0.0.1", port: 3000 } },
    };
    const pm = createAgnoProcessManager({
      projectRoot: PROJECT_ROOT,
      config: configWithAgentUi,
      tokens,
      resolvedModel: "deepseek-v4-flash",
      resolvedServiceDir: path.join(PROJECT_ROOT, "agno_service"),
      resolvedDbFile: path.join(PROJECT_ROOT, "data/agno/agno.db"),
      ownerId: "test-owner-id",
    });
    const env = pm.buildEnv();
    assert.strictEqual(
      env.DS4_AGNO_CORS_ALLOWED_ORIGINS,
      JSON.stringify(["http://127.0.0.1:3000", "http://localhost:3000"])
    );
  });

  it("health check rejects foreign owner", async () => {
    let callCount = 0;
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        service: "ds4-agno-service",
        owner: "foreign-owner",
        telemetry: false,
      }),
    });
    const pm = createAgnoProcessManager({
      projectRoot: PROJECT_ROOT,
      config,
      tokens,
      resolvedModel: "deepseek-v4-flash",
      resolvedServiceDir: path.join(PROJECT_ROOT, "agno_service"),
      resolvedDbFile: path.join(PROJECT_ROOT, "data/agno/agno.db"),
      ownerId: "test-owner-id",
      fetchImpl,
    });
    const healthy = await pm.healthCheck();
    assert(healthy === false, "should reject foreign owner");
  });

  it("health check accepts matching owner", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        service: "ds4-agno-service",
        owner: "test-owner-id",
        telemetry: false,
      }),
    });
    const pm = createAgnoProcessManager({
      projectRoot: PROJECT_ROOT,
      config,
      tokens,
      resolvedModel: "deepseek-v4-flash",
      resolvedServiceDir: path.join(PROJECT_ROOT, "agno_service"),
      resolvedDbFile: path.join(PROJECT_ROOT, "data/agno/agno.db"),
      ownerId: "test-owner-id",
      fetchImpl,
    });
    const healthy = await pm.healthCheck();
    assert(healthy === true);
  });

  it("rejects telemetry not false", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        service: "ds4-agno-service",
        owner: "test-owner-id",
        telemetry: true,
      }),
    });
    const pm = createAgnoProcessManager({
      projectRoot: PROJECT_ROOT,
      config,
      tokens,
      resolvedModel: "deepseek-v4-flash",
      resolvedServiceDir: path.join(PROJECT_ROOT, "agno_service"),
      resolvedDbFile: path.join(PROJECT_ROOT, "data/agno/agno.db"),
      ownerId: "test-owner-id",
      fetchImpl,
    });
    const healthy = await pm.healthCheck();
    assert(healthy === false, "telemetry true should be rejected");
  });
});

describe("createDisabledAgnoProcessManager", () => {
  it("returns disabled status", () => {
    const pm = createDisabledAgnoProcessManager();
    const status = pm.status();
    assert(status.enabled === false);
    assert(status.running === false);
    assert(status.healthy === false);
  });

  it("start/stop/restart return disabled status", async () => {
    const pm = createDisabledAgnoProcessManager();
    const s1 = await pm.start();
    assert(s1.enabled === false);
    const s2 = await pm.stop();
    assert(s2.enabled === false);
    const s3 = await pm.restart();
    assert(s3.enabled === false);
  });
});
