import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Ds4ProcessManager, pickEnv } from "./processManager.mjs";

test("manager records command and captures child output", async () => {
  const manager = new Ds4ProcessManager({
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "console.log('ready'); setTimeout(() => {}, 2000)"]
    }),
    healthCheck: async () => true
  });
  try {
    await manager.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const status = manager.status();
    assert.equal(status.running, true);
    assert.equal(status.command[0], process.execPath);
    assert.equal(status.healthy, true);
    assert.ok(status.logs.some((line) => line.message.includes("ready")));
  } finally {
    await manager.stop();
  }
  assert.equal(manager.status().running, false);
});

test("startup retries a transient health-check connection reset", async () => {
  let checks = 0;
  const manager = new Ds4ProcessManager({
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 2000)"]
    }),
    healthCheck: async () => {
      checks += 1;
      if (checks === 1) {
        const error = new Error("read ECONNRESET");
        error.code = "ECONNRESET";
        throw error;
      }
      return true;
    }
  });
  try {
    const status = await manager.start();
    assert.equal(status.running, true);
    assert.equal(status.healthy, true);
    assert.equal(checks, 2);
  } finally {
    await manager.stop();
  }
});

test("restart replaces the child process", async () => {
  const manager = new Ds4ProcessManager({
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 2000)"]
    }),
    healthCheck: async () => true
  });
  try {
    await manager.start();
    const firstPid = manager.status().pid;
    await manager.restart();
    const secondPid = manager.status().pid;
    assert.notEqual(firstPid, secondPid);
  } finally {
    await manager.stop();
  }
});

test("manager starts child processes in the configured cwd", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ds4-process-cwd-"));
  await writeFile(path.join(tmp, "marker.txt"), "ok", "utf8");
  const manager = new Ds4ProcessManager({
    cwd: tmp,
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "console.log(process.cwd()); require('fs').accessSync('marker.txt'); setTimeout(() => {}, 2000)"]
    }),
    healthCheck: async () => true
  });
  try {
    await manager.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const status = manager.status();
    assert.equal(status.running, true);
    assert.ok(status.logs.some((line) => line.message === tmp));
  } finally {
    await manager.stop();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("manager passes compacted environment overrides to child process", async () => {
  const manager = new Ds4ProcessManager({
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "console.log(process.env.DS4_CUDA_Q8_F16_CACHE_MB || 'missing'); console.log(process.env.DS4_CUDA_NO_FD_CACHE || 'missing-empty'); setTimeout(() => {}, 2000)"]
    }),
    buildEnv: () => ({
      DS4_CUDA_Q8_F16_CACHE_MB: "512",
      DS4_CUDA_NO_FD_CACHE: ""
    }),
    healthCheck: async () => true
  });
  try {
    await manager.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const messages = manager.status().logs.map((line) => line.message);
    assert.ok(messages.includes("512"));
    assert.ok(messages.includes("missing-empty"));
  } finally {
    await manager.stop();
  }
});

test("spawn errors are reported without leaving a running process", async () => {
  const manager = new Ds4ProcessManager({
    buildCommand: () => ({
      command: "__definitely_missing_ds4_command__"
    }),
    healthCheck: async () => true
  });
  const errors = [];
  manager.on("processError", (error) => errors.push(error));

  await manager.start();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const status = manager.status();
  assert.equal(status.running, false);
  assert.equal(status.healthy, false);
  assert.equal(status.lastExit?.code, null);
  assert.equal(status.lastExit?.error, "ENOENT");
  assert.equal(errors.length, 1);
  assert.ok(status.logs.some((line) => {
    return line.stream === "error" &&
      line.message.includes("__definitely_missing_ds4_command__");
  }));
});

test("delayed health checks do not mark an exited process healthy", async () => {
  const manager = new Ds4ProcessManager({
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 220)"]
    }),
    healthCheck: async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
      return true;
    }
  });
  try {
    await manager.start();
    const status = manager.status();
    assert.equal(status.running, false);
    assert.equal(status.healthy, false);
  } finally {
    await manager.stop();
  }
});

test("pickEnv copies only the listed keys and never mutates its input", () => {
  const source = { PATH: "/usr/bin", SECRET: "x", EMPTY: "" };
  const picked = pickEnv(source, ["PATH", "EMPTY", "MISSING"]);
  assert.deepEqual(picked, { PATH: "/usr/bin", EMPTY: "" });
  assert.deepEqual(source, { PATH: "/usr/bin", SECRET: "x", EMPTY: "" });
});

test("resolveEnv defaults to the full parent environment", () => {
  const pm = new Ds4ProcessManager({
    buildCommand: () => ({ command: "true", args: [] }),
    buildEnv: () => ({ DS4_TEST_DELTA: "1" })
  });
  process.env.DS4_TEST_PARENT_MARKER = "parent";
  try {
    const env = pm.resolveEnv();
    assert.equal(env.DS4_TEST_PARENT_MARKER, "parent");
    assert.equal(env.DS4_TEST_DELTA, "1");
  } finally {
    delete process.env.DS4_TEST_PARENT_MARKER;
  }
});

test("resolveEnv honours an allowlisted base and lets buildEnv win", () => {
  process.env.DS4_TEST_SECRET = "leak";
  process.env.DS4_TEST_ALLOWED = "keep";
  try {
    const pm = new Ds4ProcessManager({
      buildCommand: () => ({ command: "true", args: [] }),
      buildEnv: () => ({ DS4_TEST_ALLOWED: "override" }),
      buildBaseEnv: () => pickEnv(process.env, ["DS4_TEST_ALLOWED"])
    });
    const env = pm.resolveEnv();
    assert.equal(env.DS4_TEST_SECRET, undefined);
    assert.equal(env.DS4_TEST_ALLOWED, "override");
  } finally {
    delete process.env.DS4_TEST_SECRET;
    delete process.env.DS4_TEST_ALLOWED;
  }
});
