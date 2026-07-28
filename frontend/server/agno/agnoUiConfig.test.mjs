import assert from "node:assert";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { describe, it } from "node:test";
import {
  resolveAgentUiRuntimeDir,
  readAgentUiReadyMarker,
  assertAgentUiBuildReady,
  agentUiUrl,
  agentUiAllowedOrigins
} from "./agnoUiConfig.mjs";

const PROJECT_ROOT = "/tmp/test-project";

describe("resolveAgentUiRuntimeDir", () => {
  it("resolves runtime dir under root", () => {
    const resolved = resolveAgentUiRuntimeDir({
      projectRoot: PROJECT_ROOT,
      config: { agno: { agentUi: { runtimeDir: ".runtime/agno-agent-ui" } } }
    });
    assert.strictEqual(resolved, path.join(PROJECT_ROOT, ".runtime/agno-agent-ui"));
  });

  it("rejects absolute runtime dir", () => {
    assert.throws(() => resolveAgentUiRuntimeDir({
      projectRoot: PROJECT_ROOT,
      config: { agno: { agentUi: { runtimeDir: "/etc/passwd" } } }
    }), /must be relative/i);
  });

  it("rejects .. escape", () => {
    assert.throws(() => resolveAgentUiRuntimeDir({
      projectRoot: PROJECT_ROOT,
      config: { agno: { agentUi: { runtimeDir: "../../tmp/evil" } } }
    }), /escapes project root/i);
  });

  it("rejects empty value", () => {
    assert.throws(() => resolveAgentUiRuntimeDir({
      projectRoot: PROJECT_ROOT,
      config: { agno: { agentUi: { runtimeDir: "" } } }
    }), /non-empty/i);
  });
});

describe("readAgentUiReadyMarker / assertAgentUiBuildReady", () => {
  async function makeFixture({ withBuild = true, commit = "abc123" } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agno-ui-test-"));
    await fs.writeFile(
      path.join(dir, ".ds4-ready"),
      `repository=agno-agi/agent-ui\ncommit=${commit}\n`
    );
    await fs.writeFile(path.join(dir, "package.json"), "{}");
    if (withBuild) {
      await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });
      await fs.mkdir(path.join(dir, ".next"), { recursive: true });
      await fs.writeFile(path.join(dir, ".next", "BUILD_ID"), "fake-build-id");
    }
    return dir;
  }

  it("reads marker", async () => {
    const dir = await makeFixture({ commit: "abc123" });
    try {
      const marker = await readAgentUiReadyMarker(dir);
      assert.strictEqual(marker.commit, "abc123");
      assert.strictEqual(marker.repository, "agno-agi/agent-ui");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed marker", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agno-ui-test-"));
    try {
      await fs.writeFile(path.join(dir, ".ds4-ready"), "not-a-valid-line\n");
      await assert.rejects(
        () => readAgentUiReadyMarker(dir),
        /invalid agent ui ready marker/i
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects wrong commit", async () => {
    const dir = await makeFixture({ commit: "abc123" });
    try {
      await assert.rejects(
        () => assertAgentUiBuildReady({ runtimeDir: dir, expectedCommit: "different-commit" }),
        /commit mismatch/i
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing build", async () => {
    const dir = await makeFixture({ withBuild: false, commit: "abc123" });
    try {
      await assert.rejects(
        () => assertAgentUiBuildReady({ runtimeDir: dir, expectedCommit: "abc123" })
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("agentUiUrl", () => {
  it("builds loopback URL", () => {
    const url = agentUiUrl({ agno: { agentUi: { host: "127.0.0.1", port: 3000 } } });
    assert.strictEqual(url, "http://127.0.0.1:3000");
  });

  it("rejects non-loopback URL", () => {
    assert.throws(
      () => agentUiUrl({ agno: { agentUi: { host: "0.0.0.0", port: 3000 } } }),
      /loopback/i
    );
  });
});

describe("agentUiAllowedOrigins", () => {
  it("returns both localhost and 127.0.0.1 origins", () => {
    const origins = agentUiAllowedOrigins({ agno: { agentUi: { port: 3000 } } });
    assert.deepStrictEqual(origins, ["http://127.0.0.1:3000", "http://localhost:3000"]);
  });
});
