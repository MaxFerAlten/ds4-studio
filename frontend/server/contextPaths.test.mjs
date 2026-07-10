import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import {
  safeContextKey,
  workspaceHash,
  contextRoot,
  sessionContextDir,
  sessionLedgerPath
} from "./contextPaths.mjs";

test("same sessionKey yields same path", () => {
  assert.equal(sessionLedgerPath("abc"), sessionLedgerPath("abc"));
});

test("sessionKey with ../ does not produce path traversal", () => {
  const dir = sessionContextDir("../../../etc/passwd");
  const root = contextRoot();
  assert.ok(dir.startsWith(root + path.sep), `${dir} not under ${root}`);
  assert.ok(!dir.includes(".."));
  // hashed segment only, no raw traversal token
  assert.ok(/^[a-f0-9]{40}$/.test(path.basename(dir)));
});

test("final path is always under data/agent-context", () => {
  const root = contextRoot();
  assert.ok(root.endsWith(path.join("data", "agent-context")));
  for (const key of ["x", "y/z", "../../secret", "", null]) {
    assert.ok(sessionLedgerPath(key).startsWith(root + path.sep));
  }
});

test("workspace hash is stable", () => {
  assert.equal(workspaceHash("/a/b"), workspaceHash("/a/b"));
  assert.notEqual(workspaceHash("/a/b"), workspaceHash("/a/c"));
});

test("safeContextKey handles empty/undefined", () => {
  assert.equal(safeContextKey(""), safeContextKey("default"));
  assert.equal(safeContextKey(undefined), safeContextKey("default"));
});
