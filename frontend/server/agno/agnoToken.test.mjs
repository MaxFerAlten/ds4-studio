import assert from "node:assert";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { ensureAgnoTokens } from "./agnoToken.mjs";

/** In-memory fake filesystem for token tests. */
class FakeFs {
  constructor() {
    this._files = {};
    this._dirs = {};
    this._symlinks = {};
  }

  async mkdir(dir, opts) {
    this._dirs[dir] = { mode: opts?.mode || 0o700 };
    // Also make stat-able by registering a pseudo-entry in _files with dir mode
    this._files[dir] = { content: "", mode: opts?.mode || 0o700 };
  }

  async stat(target) {
    if (this._symlinks[target]) {
      return { isSymbolicLink: () => true, mode: 0o777 };
    }
    const entry = this._files[target];
    if (!entry) {
      const dirEntry = this._dirs[target];
      if (dirEntry) {
        return { isSymbolicLink: () => false, mode: dirEntry.mode };
      }
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    }
    return { isSymbolicLink: () => false, mode: entry.mode };
  }

  async readFile(target) {
    const entry = this._files[target];
    if (!entry) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    return entry.content;
  }

  async writeFile(target, content, opts) {
    this._files[target] = { content, mode: opts?.mode || 0o600 };
  }

  async rename(from, to) {
    if (!this._files[from]) throw new Error("source not found");
    this._files[to] = this._files[from];
    delete this._files[from];
  }

  async chmod(target, mode) {
    const entry = this._files[target];
    if (entry) entry.mode = mode;
  }
}

describe("ensureAgnoTokens", () => {
  it("creates directory and tokens", async () => {
    const fs = new FakeFs();
    const result = await ensureAgnoTokens({
      homeDir: "/tmp/test-home",
      fsImpl: fs,
    });
    assert(result.serviceToken.length >= 32);
    assert(result.modelGatewayToken.length >= 32);
    assert(result.serviceToken !== result.modelGatewayToken,
      "service and gateway tokens must differ");
  });

  it("preserves existing valid tokens", async () => {
    const fs = new FakeFs();
    const first = await ensureAgnoTokens({ homeDir: "/tmp/test-home2", fsImpl: fs });
    const second = await ensureAgnoTokens({ homeDir: "/tmp/test-home2", fsImpl: fs });
    assert(first.serviceToken === second.serviceToken,
      "service token should be preserved");
    assert(first.modelGatewayToken === second.modelGatewayToken,
      "model gateway token should be preserved");
  });

  it("rejects symlink token file", async () => {
    const fs = new FakeFs();
    const homeDir = "/tmp/test-home3";
    const agnoDir = homeDir + "/.config/ds4-studio/agno";
    const tokenFile = agnoDir + "/service.token";
    fs._symlinks[tokenFile] = true;
    await assert.rejects(
      () => ensureAgnoTokens({ homeDir, fsImpl: fs }),
      /symlink/,
    );
  });

  it("generates tokens with sufficient length", async () => {
    const fs = new FakeFs();
    const result = await ensureAgnoTokens({
      homeDir: "/tmp/test-home4",
      fsImpl: fs,
    });
    assert(result.serviceToken.length >= 32);
    assert(result.modelGatewayToken.length >= 32);
    // base64url: 32 bytes → 43 chars
    assert(result.serviceToken.length === 43);
  });

  it("creates third token (tool-bridge.token)", async () => {
    const fs = new FakeFs();
    const result = await ensureAgnoTokens({
      homeDir: "/tmp/test-home5",
      fsImpl: fs,
    });
    assert(result.toolBridgeToken !== undefined);
    assert(result.toolBridgeToken.length >= 32);
    assert(result.toolBridgeTokenPath.includes("tool-bridge.token"));
  });

  it("all three tokens are distinct", async () => {
    const fs = new FakeFs();
    const result = await ensureAgnoTokens({
      homeDir: "/tmp/test-home6",
      fsImpl: fs,
    });
    const tokens = new Set([
      result.serviceToken,
      result.modelGatewayToken,
      result.toolBridgeToken
    ]);
    assert.equal(tokens.size, 3,
      "all three tokens must be distinct");
  });

  it("preserves third token on subsequent calls", async () => {
    const fs = new FakeFs();
    const first = await ensureAgnoTokens({
      homeDir: "/tmp/test-home7",
      fsImpl: fs
    });
    const second = await ensureAgnoTokens({
      homeDir: "/tmp/test-home7",
      fsImpl: fs
    });
    assert.equal(first.toolBridgeToken, second.toolBridgeToken,
      "tool-bridge token should be preserved");
  });

  it("regenerates short tool-bridge token", async () => {
    const fs = new FakeFs();
    const homeDir = "/tmp/test-home8";
    const agnoDir = homeDir + "/.config/ds4-studio/agno";
    const toolBridgeFile = agnoDir + "/tool-bridge.token";

    // First call to create the directory and set up
    await ensureAgnoTokens({ homeDir, fsImpl: fs });

    // Write a short token (less than 32 chars)
    fs._files[toolBridgeFile].content = "short";

    // Second call should regenerate it
    const result = await ensureAgnoTokens({ homeDir, fsImpl: fs });
    assert(result.toolBridgeToken.length >= 32,
      "short token should be regenerated");
  });

  it("rejects symlink tool-bridge.token", async () => {
    const fs = new FakeFs();
    const homeDir = "/tmp/test-home9";
    const agnoDir = homeDir + "/.config/ds4-studio/agno";
    const toolBridgeFile = agnoDir + "/tool-bridge.token";
    fs._symlinks[toolBridgeFile] = true;
    await assert.rejects(
      () => ensureAgnoTokens({ homeDir, fsImpl: fs }),
      /symlink/,
    );
  });

  it("restricts tool-bridge.token permissions to 0600", async () => {
    const fs = new FakeFs();
    const result = await ensureAgnoTokens({
      homeDir: "/tmp/test-home10",
      fsImpl: fs,
    });
    const agnoDir = "/tmp/test-home10/.config/ds4-studio/agno";
    const toolBridgeFile = agnoDir + "/tool-bridge.token";
    const stat = fs._files[toolBridgeFile];
    assert.equal(stat.mode, 0o600,
      "tool-bridge.token must have 0600 permissions");
  });

  it("returns correct tool-bridge.token path", async () => {
    const fs = new FakeFs();
    const homeDir = "/tmp/test-home11";
    const result = await ensureAgnoTokens({ homeDir, fsImpl: fs });
    const expectedPath = homeDir + "/.config/ds4-studio/agno/tool-bridge.token";
    assert.equal(result.toolBridgeTokenPath, expectedPath);
  });
});
