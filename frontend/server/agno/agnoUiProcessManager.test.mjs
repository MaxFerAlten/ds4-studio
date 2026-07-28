import assert from "node:assert";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { describe, it } from "node:test";
import {
  createAgentUiProcessManager,
  createDisabledAgentUiProcessManager
} from "./agnoUiProcessManager.mjs";

const CONFIG = {
  agno: {
    agentUi: { host: "127.0.0.1", port: 3000 }
  }
};
const EXPECTED_COMMIT = "6dad9593fca6756e1813e4f4b3b2620be6377691";
const OTHER_COMMIT = "0000000000000000000000000000000000000000";

async function makeReadyFixture({ withBuild = true, commit = EXPECTED_COMMIT } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agno-ui-pm-test-"));
  await fs.writeFile(path.join(dir, ".ds4-ready"), `commit=${commit}\n`);
  await fs.writeFile(path.join(dir, "package.json"), "{}");
  if (withBuild) {
    await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });
    await fs.mkdir(path.join(dir, ".next"), { recursive: true });
    await fs.writeFile(path.join(dir, ".next", "BUILD_ID"), "fake-build-id");
  }
  return dir;
}

describe("createAgentUiProcessManager", () => {
  it("build command usa pnpm exec next start", async () => {
    const dir = await makeReadyFixture();
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      const { command, args } = pm.resolveCommand();
      assert.strictEqual(command, "pnpm");
      assert.deepStrictEqual(args, ["exec", "next", "start", "-H", "127.0.0.1", "-p", "3000"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("host è 127.0.0.1", async () => {
    const dir = await makeReadyFixture();
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      assert.strictEqual(pm.status().host, "127.0.0.1");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("porta è configurata", async () => {
    const dir = await makeReadyFixture();
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      assert.strictEqual(pm.status().port, 3000);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("status().url è canonico anche prima di start", async () => {
    const dir = await makeReadyFixture();
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      assert.strictEqual(pm.status().url, "http://127.0.0.1:3000");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("status().upstreamCommit riflette expectedCommit", async () => {
    const dir = await makeReadyFixture();
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      assert.strictEqual(pm.status().upstreamCommit, EXPECTED_COMMIT);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("status() non espone logs grezzi o command", async () => {
    const dir = await makeReadyFixture();
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      const status = pm.status();
      assert.strictEqual(status.logs, undefined);
      assert.strictEqual(status.command, undefined);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("cwd è runtimeDir", async () => {
    const dir = await makeReadyFixture();
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      assert.strictEqual(pm.cwd, dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("NODE_ENV=production", async () => {
    const dir = await makeReadyFixture();
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      assert.strictEqual(pm.buildEnv().NODE_ENV, "production");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("NEXT_TELEMETRY_DISABLED=1", async () => {
    const dir = await makeReadyFixture();
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      assert.strictEqual(pm.buildEnv().NEXT_TELEMETRY_DISABLED, "1");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("nessun segreto nell'env", async () => {
    const dir = await makeReadyFixture();
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      const env = pm.buildEnv();
      const secrets = [
        "DS4_AGNO_SERVICE_TOKEN",
        "DS4_AGNO_MODEL_GATEWAY_TOKEN",
        "OPENAI_API_KEY",
        "TAVILY_API_KEY",
        "SERPAPI_KEY",
        "NEXT_PUBLIC_OS_SECURITY_KEY"
      ];
      for (const secret of secrets) {
        assert.strictEqual(env[secret], undefined, `env leaked ${secret}`);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("health accetta title Agent UI", async () => {
    const dir = await makeReadyFixture();
    try {
      const fetchImpl = async () => ({ ok: true, text: async () => "<html><title>Agent UI</title></html>" });
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT, fetchImpl });
      assert.strictEqual(await pm.healthCheck(), true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("health rifiuta pagina generica sulla stessa porta", async () => {
    const dir = await makeReadyFixture();
    try {
      const fetchImpl = async () => ({ ok: true, text: async () => "<html><title>Some Other App</title></html>" });
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT, fetchImpl });
      assert.strictEqual(await pm.healthCheck(), false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("health rifiuta HTTP non 2xx", async () => {
    const dir = await makeReadyFixture();
    try {
      const fetchImpl = async () => ({ ok: false, text: async () => "" });
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT, fetchImpl });
      assert.strictEqual(await pm.healthCheck(), false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("health gestisce timeout", async () => {
    const dir = await makeReadyFixture();
    try {
      const fetchImpl = async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      };
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT, fetchImpl });
      assert.strictEqual(await pm.healthCheck(), false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("start rifiuta marker commit errato", async () => {
    const dir = await makeReadyFixture({ commit: OTHER_COMMIT });
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      await assert.rejects(() => pm.start(), /commit mismatch/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("start rifiuta build assente", async () => {
    const dir = await makeReadyFixture({ withBuild: false });
    try {
      const pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT });
      await assert.rejects(() => pm.start());
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("start restituisce URL canonico", async () => {
    const dir = await makeReadyFixture();
    let pm;
    try {
      const fetchImpl = async () => ({ ok: true, text: async () => "<title>Agent UI</title>" });
      pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT, fetchImpl });
      pm.setOverrideCommand(["node", "-e", "setInterval(() => {}, 1000)"]);
      const status = await pm.start();
      assert.strictEqual(status.url, "http://127.0.0.1:3000");
      assert.strictEqual(status.running, true);
      assert.strictEqual(status.healthy, true);
    } finally {
      if (pm) await pm.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("stop azzera running/healthy", async () => {
    const dir = await makeReadyFixture();
    let pm;
    try {
      const fetchImpl = async () => ({ ok: true, text: async () => "<title>Agent UI</title>" });
      pm = createAgentUiProcessManager({ config: CONFIG, runtimeDir: dir, expectedCommit: EXPECTED_COMMIT, fetchImpl });
      pm.setOverrideCommand(["node", "-e", "setInterval(() => {}, 1000)"]);
      await pm.start();
      const status = await pm.stop();
      assert.strictEqual(status.running, false);
      assert.strictEqual(status.healthy, false);
      assert.strictEqual(status.url, "http://127.0.0.1:3000");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("createDisabledAgentUiProcessManager", () => {
  it("disabled manager non spawna", async () => {
    const pm = createDisabledAgentUiProcessManager({ config: CONFIG });
    const status = await pm.start();
    assert.strictEqual(status.configured, false);
    assert.strictEqual(status.enabled, false);
    assert.strictEqual(status.running, false);
  });
});
