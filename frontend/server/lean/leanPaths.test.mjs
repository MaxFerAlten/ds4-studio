// Tests for leanPaths.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rmdir } from "fs/promises";
import { resolve } from "path";
import {
  sanitizeLeanSessionId,
  sanitizeLeanRunId,
  assertSafeLeanName,
  createLeanRunDirectory,
  cleanupLeanRunDirectory,
  createLeanRunId,
  leanArtifactRelativePath,
  RUN_ID_RE,
} from "./leanPaths.mjs";

const TMP = "/tmp/test-lean-paths-" + Date.now();

test("sanitizeLeanSessionId — valid", () => {
  assert.equal(sanitizeLeanSessionId("abc123_-"), "abc123_-");
});

test("sanitizeLeanSessionId — null/empty", () => {
  assert.equal(sanitizeLeanSessionId(null), null);
  assert.equal(sanitizeLeanSessionId(""), null);
});

test("sanitizeLeanSessionId — invalid chars", () => {
  assert.equal(sanitizeLeanSessionId("abc/def"), null);
  assert.equal(sanitizeLeanSessionId("../foo"), null);
});

test("sanitizeLeanRunId — valid", () => {
  const id = "lean-a1b2c3d4e5f6-1234567890-42";
  assert.equal(sanitizeLeanRunId(id), id);
});

test("sanitizeLeanRunId — invalid", () => {
  assert.equal(sanitizeLeanRunId("lean-xyz-123-45"), null);
  assert.equal(sanitizeLeanRunId(""), null);
  assert.equal(sanitizeLeanRunId("not-even-lean"), null);
});

test("createLeanRunId always satisfies the production sanitizer", () => {
  // Regression: the old route format used a hex last segment, which matched
  // the sanitizer ~2.3% of the time. The factory must match 100%.
  for (let i = 0; i < 500; i++) {
    const id = createLeanRunId();
    assert.match(id, RUN_ID_RE);
    assert.equal(sanitizeLeanRunId(id), id);
    assert.ok(id.split("-")[2] > 0, "timestamp segment is a positive decimal");
  }
});

test("createLeanRunId is injectable and deterministic", () => {
  let counter = 0;
  const rng = (n) => {
    const b = Buffer.alloc(n);
    b.fill(++counter);
    return b;
  };
  const now = () => 1780000000000;
  const a = createLeanRunId({ now, randomBytes: rng });
  const b = createLeanRunId({ now, randomBytes: rng });
  assert.match(a, RUN_ID_RE);
  assert.match(b, RUN_ID_RE);
  assert.notEqual(a, b);
  assert.ok(a.startsWith("lean-"));
  assert.ok(a.includes("-1780000000000-"));
  assert.match(a.split("-")[3], /^[0-9]+$/, "nonce is decimal, never hex");
  assert.notEqual(a.split("-")[3], b.split("-")[3]);
});

test("assertSafeLeanName — valid names", () => {
  assert.doesNotThrow(() => assertSafeLeanName("hello", "test"));
  assert.doesNotThrow(() => assertSafeLeanName("a-b_c", "test"));
});

test("assertSafeLeanName — path traversal", () => {
  assert.throws(() => assertSafeLeanName("..", "test"), /path traversal/);
  assert.throws(() => assertSafeLeanName("../foo", "test"), /path traversal/);
});

test("assertSafeLeanName — absolute paths and forbidden chars", () => {
  assert.throws(() => assertSafeLeanName("/etc", "test"), /absolute path/);
  // Backslash is caught by forbidden characters first
  assert.throws(() => assertSafeLeanName("\\windows", "test"), /forbidden characters/);
});

test("createLeanRunDirectory and cleanup", async () => {
  const config = { runsRoot: TMP };
  const dir = await createLeanRunDirectory(config, {
    sessionId: "session-test",
    runId: "lean-a1b2c3d4e5f6-1234567890-42",
  });
  assert.ok(dir.startsWith(TMP));
  // Cleanup
  await cleanupLeanRunDirectory(dir);
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

import { mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync, existsSync as exists } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir as osTmpdir } from "node:os";
import { resolve as res } from "node:path";
import { pruneExpiredLeanRuns } from "./leanPaths.mjs";

const HOUR = 3600 * 1000;

function makeRuns(layout) {
  const root = mkdtempSync(res(osTmpdir(), "ds4-lean-prune-"));
  for (const [path, ageHours] of Object.entries(layout)) {
    const dir = res(root, path);
    mkdirSync(dir, { recursive: true });
    const when = new Date(Date.now() - ageHours * HOUR);
    utimesSync(dir, when, when);
  }
  return root;
}

test("pruning removes runs older than retention and keeps recent ones", async () => {
  const root = makeRuns({ "sess-a/lean-old": 48, "sess-a/lean-new": 1 });
  try {
    const { removed } = await pruneExpiredLeanRuns({ runsRoot: root, retentionHours: 24 });
    assert.deepEqual(removed, ["sess-a/lean-old"]);
    assert.equal(exists(res(root, "sess-a/lean-old")), false);
    assert.equal(exists(res(root, "sess-a/lean-new")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruning ages runs, not sessions: an active session loses its old runs", async () => {
  // The session directory is fresh because a new run was just created in it.
  const root = makeRuns({ "sess-a/lean-old": 48 });
  const now = new Date();
  utimesSync(res(root, "sess-a"), now, now);
  try {
    const { removed } = await pruneExpiredLeanRuns({ runsRoot: root, retentionHours: 24 });
    assert.deepEqual(removed, ["sess-a/lean-old"], "a fresh session must not shelter stale runs");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruning drops a session directory once its last run is gone", async () => {
  const root = makeRuns({ "sess-empty/lean-old": 48, "sess-keep/lean-new": 1 });
  try {
    await pruneExpiredLeanRuns({ runsRoot: root, retentionHours: 24 });
    assert.equal(exists(res(root, "sess-empty")), false);
    assert.equal(exists(res(root, "sess-keep")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruning does not follow symlinks out of the runs root", async () => {
  const outside = mkdtempSync(res(osTmpdir(), "ds4-lean-outside-"));
  mkdirSync(res(outside, "precious"), { recursive: true });
  const old = new Date(Date.now() - 72 * HOUR);
  utimesSync(res(outside, "precious"), old, old);

  const root = makeRuns({ "sess-a/lean-new": 1 });
  symlinkSync(outside, res(root, "sess-link"));
  symlinkSync(res(outside, "precious"), res(root, "sess-a", "lean-link"));
  try {
    await pruneExpiredLeanRuns({ runsRoot: root, retentionHours: 24 });
    assert.equal(exists(res(outside, "precious")), true, "retention must not delete through a symlink");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("infrastructure evidence outlives ordinary runs of the same age", async () => {
  const root = makeRuns({ "sess-a/lean-plain": 48, "sess-a/lean-infra": 48 });
  writeFileSync(
    res(root, "sess-a/lean-infra/error.json"),
    JSON.stringify({ category: "infrastructure", errorCode: "LEAN_PROCESS_SPAWN_FAILED" })
  );
  const old = new Date(Date.now() - 48 * HOUR);
  utimesSync(res(root, "sess-a/lean-infra"), old, old);
  try {
    const { removed } = await pruneExpiredLeanRuns({
      runsRoot: root,
      retentionHours: 24,
      infraRetentionHours: 168,
    });
    assert.deepEqual(removed, ["sess-a/lean-plain"]);
    assert.equal(exists(res(root, "sess-a/lean-infra")), true, "an operator must still be able to diagnose it");

    // Past the infrastructure window it goes like anything else.
    const second = await pruneExpiredLeanRuns({ runsRoot: root, retentionHours: 24, infraRetentionHours: 1 });
    assert.deepEqual(second.removed, ["sess-a/lean-infra"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run with a non-infrastructure error.json is pruned normally", async () => {
  const root = makeRuns({ "sess-a/lean-lean": 48 });
  writeFileSync(res(root, "sess-a/lean-lean/error.json"), JSON.stringify({ category: "lean" }));
  const old = new Date(Date.now() - 48 * HOUR);
  utimesSync(res(root, "sess-a/lean-lean"), old, old);
  try {
    const { removed } = await pruneExpiredLeanRuns({
      runsRoot: root,
      retentionHours: 24,
      infraRetentionHours: 168,
    });
    assert.deepEqual(removed, ["sess-a/lean-lean"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruning is a no-op when retention is disabled or the root is missing", async () => {
  const root = makeRuns({ "sess-a/lean-old": 999 });
  try {
    assert.deepEqual((await pruneExpiredLeanRuns({ runsRoot: root, retentionHours: 0 })).removed, []);
    assert.equal(exists(res(root, "sess-a/lean-old")), true);
    assert.deepEqual((await pruneExpiredLeanRuns({ runsRoot: "/nonexistent", retentionHours: 24 })).removed, []);
    assert.deepEqual((await pruneExpiredLeanRuns({ retentionHours: 24 })).removed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
