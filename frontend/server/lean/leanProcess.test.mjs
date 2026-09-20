// Tests for leanProcess.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { runBoundedProcess } from "./leanProcess.mjs";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const FAKE_LEAN = new URL("./fixtures/fake-lean.mjs", import.meta.url).pathname;
const MARKER_DIR = resolve(tmpdir(), `ds4-lean-proc-${process.pid}`);

test.after(async () => {
  await rm(MARKER_DIR, { recursive: true, force: true });
});

test("runBoundedProcess — success exit", async () => {
  const result = await runBoundedProcess({
    command: process.execPath,
    args: [FAKE_LEAN, "success"],
    cwd: "/tmp",
    env: { PATH: process.env.PATH },
    timeoutMs: 5000,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.cancelled, false);
  assert.equal(result.sigtermSent, false);
  assert.equal(result.sigkillSent, false);
});

test("runBoundedProcess — syntax error exit", async () => {
  const result = await runBoundedProcess({
    command: process.execPath,
    args: [FAKE_LEAN, "syntax-error"],
    cwd: "/tmp",
    env: { PATH: process.env.PATH },
    timeoutMs: 10000,
  });
  assert.equal(result.exitCode, 1);
  // Lean reports elaboration diagnostics on stdout; the fixture mirrors that.
  assert.ok(result.stdout.includes("error"));
});

test("runBoundedProcess — timeout kills the process group", async () => {
  const start = Date.now();
  const result = await runBoundedProcess({
    command: process.execPath,
    args: [FAKE_LEAN, "sleep"],
    cwd: "/tmp",
    env: { PATH: process.env.PATH },
    timeoutMs: 200,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.equal(result.sigtermSent, true);
  assert.ok(Date.now() - start < 5000); // Should finish quickly
});

test("runBoundedProcess — abort signal cancels", async () => {
  const ac = new AbortController();
  const promise = runBoundedProcess({
    command: process.execPath,
    args: [FAKE_LEAN, "sleep"],
    cwd: "/tmp",
    env: { PATH: process.env.PATH },
    timeoutMs: 60000,
    abortSignal: ac.signal,
  });

  setTimeout(() => ac.abort(), 500);
  const result = await promise;
  assert.equal(result.cancelled, true);
  assert.equal(result.exitCode, null);
});

test("runBoundedProcess — stdout truncation drains without EPIPE", async () => {
  const result = await runBoundedProcess({
    command: process.execPath,
    args: [FAKE_LEAN, "spam-stdout"],
    cwd: "/tmp",
    env: { PATH: process.env.PATH },
    timeoutMs: 10000,
    stdoutLimit: 1024,
  });
  assert.equal(result.stdoutTruncated, true);
  // The fixture writes 10000 lines then exits 0. If the runner destroyed the
  // pipe, the child would hit EPIPE and exit non-zero; draining must let it
  // complete normally.
  assert.equal(result.exitCode, 0);
  // Byte-bounded: the captured payload is at most the limit.
  assert.ok(result.stdoutBytes <= 1024);
});

test("runBoundedProcess — stderr truncation", async () => {
  const result = await runBoundedProcess({
    command: process.execPath,
    args: [FAKE_LEAN, "spam-stderr"],
    cwd: "/tmp",
    env: { PATH: process.env.PATH },
    timeoutMs: 30000,
    stderrLimit: 4096,
  });
  assert.equal(result.stderrTruncated, true);
  assert.ok(result.stderrBytes <= 4096);
});

test("runBoundedProcess — unicode output round-trips byte-exactly", async () => {
  const result = await runBoundedProcess({
    command: process.execPath,
    args: [FAKE_LEAN, "unicode"],
    cwd: "/tmp",
    env: { PATH: process.env.PATH },
    timeoutMs: 10000,
  });
  assert.equal(result.exitCode, 0);
  const expected = "λ ∀ 定理 Mathlib — 你好 𝔸\ud83d\ude00\n";
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, expected);
  assert.equal(result.stdoutBytes, Buffer.byteLength(expected, "utf8"));
});

test("runBoundedProcess — a multibyte truncation boundary never emits U+FFFD", async () => {
  const result = await runBoundedProcess({
    command: process.execPath,
    args: [FAKE_LEAN, "unicode-spam"],
    cwd: "/tmp",
    env: { PATH: process.env.PATH },
    timeoutMs: 20000,
    stdoutLimit: 999, // odd — the boundary lands mid-λ
  });
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.exitCode, 0);
  // 999 bytes captured, the trailing partial λ is dropped -> 998 bytes = 499 λ.
  assert.equal(result.stdoutBytes, 999);
  assert.equal(result.stdout, "λ".repeat(499));
  assert.ok(!result.stdout.includes("\uFFFD"), "no replacement char at the boundary");
});

test("runBoundedProcess — a SIGTERM-stubborn child is SIGKILLed and reported honestly", async () => {
  const result = await runBoundedProcess({
    command: process.execPath,
    args: [FAKE_LEAN, "stubborn-sigterm"],
    cwd: "/tmp",
    env: { PATH: process.env.PATH },
    timeoutMs: 300,
    killGraceMs: 100,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.sigtermSent, true);
  assert.equal(result.sigkillSent, true);
  assert.equal(result.signal, "SIGKILL");
});

test("runBoundedProcess — timeout reaps the descendant process group", async () => {
  const marker = resolve(MARKER_DIR, "descendant.marker");
  const result = await runBoundedProcess({
    command: process.execPath,
    args: [FAKE_LEAN, "descendant", marker],
    cwd: "/tmp",
    env: { PATH: process.env.PATH },
    timeoutMs: 300,
    killGraceMs: 100,
  });
  assert.equal(result.timedOut, true);

  // Give the grandchild a generous window to (attempt to) write its marker.
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(
    existsSync(marker),
    false,
    "the whole process group must die with the child, not just the leader"
  );
});

test("runBoundedProcess — missing executable", async () => {
  try {
    await runBoundedProcess({
      command: "/nonexistent/binary",
      args: [],
      cwd: "/tmp",
      env: {},
      timeoutMs: 5000,
    });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err.code === "ENOENT" || err.message.includes("ENOENT"));
  }
});
