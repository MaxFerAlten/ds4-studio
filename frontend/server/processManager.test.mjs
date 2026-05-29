import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Ds4ProcessManager } from "./processManager.mjs";

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
