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
});
