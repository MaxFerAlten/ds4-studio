/** Test origin: DS4 acceptance requirements BEH-EXEC-001..004, SEC-DOS-001..003, SEC-SECRET-001, SEC-SHELL-001..002. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EvolutionExecutor, buildSandboxCommand, redactExecutionText } from "./evolutionExecutor.mjs";

test("SEC-SHELL-001 sandbox invocation uses argv, prlimit, and no inherited shell", () => {
  const invocation = buildSandboxCommand({
    workspaceRoot: "/tmp/ds4-evo-fixture",
    writableBindings: [{ source: "/tmp/ds4-evo-fixture/src", target: "/workspace/src", writable: true }],
    command: "/usr/bin/node",
    args: ["-e", "process.exit(0)"],
    environment: { FIXTURE: "yes" },
    hostProcessCount: 500,
    limits: { timeoutMs: 1_000 }
  });
  assert.equal(invocation.executable, "/usr/bin/prlimit");
  assert.ok(invocation.args.includes("/usr/bin/bwrap"));
  assert.ok(invocation.args.includes("--unshare-net"));
  assert.ok(invocation.args.includes("--clearenv"));
  assert.ok(invocation.args.includes("--nproc=628:628"));
  assert.ok(invocation.args.some((value) => value.startsWith("--as=")));
  assert.ok(invocation.args.some((value) => value.startsWith("--fsize=")));
  assert.equal(invocation.args.at(-2), "-e");
  assert.equal(invocation.args.at(-1), "process.exit(0)");
});

test("SEC-SHELL-002 metacharacters remain literal argv data", () => {
  const marker = "; touch /workspace/src/owned";
  const invocation = buildSandboxCommand({
    workspaceRoot: "/tmp/ds4-evo-fixture",
    command: "/usr/bin/node",
    args: ["-e", "process.stdout.write(process.argv[1])", marker]
  });
  assert.equal(invocation.args.at(-1), marker);
  assert.equal(invocation.args.includes("/bin/sh"), false);
});

test("SEC-HID-001 hidden file and directory masks override the workspace view", () => {
  const invocation = buildSandboxCommand({
    workspaceRoot: "/tmp/ds4-evo-fixture",
    command: "/usr/bin/node",
    args: ["-e", "process.exit(0)"],
    maskedBindings: [
      { target: "/workspace/checks/private.json", type: "file" },
      { target: "/workspace/fixtures", type: "directory" }
    ]
  });
  assert.ok(invocation.args.some((value, index) => value === "/dev/null" && invocation.args[index + 1] === "/workspace/checks/private.json"));
  assert.ok(invocation.args.some((value, index) => value === "--tmpfs" && invocation.args[index + 1] === "/workspace/fixtures"));
  assert.throws(
    () => buildSandboxCommand({
      workspaceRoot: "/tmp/ds4-evo-fixture",
      command: "/usr/bin/node",
      args: [],
      maskedBindings: [{ target: "/workspace/../etc", type: "directory" }]
    }),
    (error) => error.code === "INVALID_SANDBOX_MASK"
  );
});

test("SEC-SECRET-003 redaction occurs before preview or persistence", () => {
  assert.equal(redactExecutionText("token=hunter2 data", ["hunter2"]), "token=[REDACTED] data");
  assert.equal(redactExecutionText("api_key=abc123"), "api_key=[REDACTED]");
});

test("SEC-SECRET-004 redaction preserves non-secret diagnostic semantics", () => {
  const redacted = redactExecutionText("failure at evaluator: token=hunter2 retry=3", ["hunter2"]);
  assert.equal(redacted, "failure at evaluator: token=[REDACTED] retry=3");
});

test("executor fails closed when the OS sandbox is unavailable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-no-sandbox-"));
  try {
    const executor = new EvolutionExecutor({ bwrapPath: path.join(directory, "missing") });
    await assert.rejects(
      () => executor.execute({ workspaceRoot: directory, revision: 1, command: process.execPath, args: [] }),
      (error) => error.code === "SANDBOX_UNAVAILABLE"
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
