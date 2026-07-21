/** Security test origin: DS4 acceptance requirements SEC-NET-001, SEC-SECRET-001..003, SEC-DOS-001..006, SEC-SHELL-002. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EvolutionExecutor } from "../evolutionExecutor.mjs";

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-executor-"));
  await fs.mkdir(path.join(root, "src"));
  return root;
}

function execute(root, args, overrides = {}) {
  return new EvolutionExecutor().execute({
    workspaceRoot: root,
    writableBindings: [{ source: path.join(root, "src"), target: "/workspace/src", writable: true }],
    revision: 1,
    command: "/usr/bin/node",
    args,
    limits: {
      timeoutMs: 3_000,
      maxOutputBytes: 100_000,
      maxProcesses: 128,
      maxMemoryBytes: 2_147_483_648,
      maxFileBytes: 10_000_000,
      maxDiskBytes: 10_000_000,
      diskPollMs: 25,
      killGraceMs: 100,
      previewBytes: 4_000,
      ...(overrides.limits ?? {})
    },
    ...overrides
  });
}

test("BEH-EXEC-001/002 captures successful and failed processes", async () => {
  const root = await workspace();
  try {
    const success = await execute(root, ["-e", "process.stdout.write('ok')"]);
    assert.equal(success.status, "success");
    assert.equal(success.exitCode, 0);
    assert.equal(success.stdoutPreview, "ok");
    const failure = await execute(root, ["-e", "process.stderr.write('bad'); process.exit(7)"]);
    assert.equal(failure.status, "failure");
    assert.equal(failure.exitCode, 7);
    assert.equal(failure.stderrPreview, "bad");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("BEH-EXEC-003 wall timeout terminates the process group", async () => {
  const root = await workspace();
  try {
    const result = await execute(root, ["-e", "setInterval(() => {}, 1000)"], { limits: { timeoutMs: 100 } });
    assert.equal(result.status, "timeout");
    assert.ok(result.violations.includes("WALL_TIME_LIMIT_EXCEEDED"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("BEH-EXEC-004 cancellation is captured", async () => {
  const root = await workspace();
  const controller = new AbortController();
  try {
    setTimeout(() => controller.abort(), 75);
    const result = await execute(root, ["-e", "setInterval(() => {}, 1000)"], { signal: controller.signal });
    assert.equal(result.status, "cancelled");
    assert.ok(result.violations.includes("CANCELLED"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SEC-DOS-002 output cap is enforced", async () => {
  const root = await workspace();
  try {
    const result = await execute(root, ["-e", "process.stdout.write('x'.repeat(200000))"], {
      limits: { maxOutputBytes: 1_024 }
    });
    assert.equal(result.status, "failure");
    assert.equal(Buffer.byteLength(result.stdoutPreview), 1_024);
    assert.ok(result.violations.includes("OUTPUT_LIMIT_EXCEEDED"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SEC-DOS-005 workspace disk growth cap is enforced", async () => {
  const root = await workspace();
  const script = "require('node:fs').writeFileSync('/workspace/src/large',Buffer.alloc(200000));setInterval(()=>{},1000)";
  try {
    const result = await execute(root, ["-e", script], {
      limits: { maxDiskBytes: 1_024, diskPollMs: 10 }
    });
    assert.equal(result.status, "failure");
    assert.ok(result.violations.includes("DISK_LIMIT_EXCEEDED"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SEC-NET-001 candidate network is disabled", async () => {
  const root = await workspace();
  const script = "const net=require('node:net');const s=net.connect(80,'1.1.1.1');s.on('connect',()=>process.exit(9));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(8),500)";
  try {
    const result = await execute(root, ["-e", script]);
    assert.equal(result.status, "success");
    assert.equal(result.exitCode, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SEC-SECRET-001 full parent environment and host home are inaccessible", async () => {
  const root = await workspace();
  const script = "const fs=require('node:fs');const leaked=process.env.SSH_AUTH_SOCK||process.env.OPENAI_API_KEY;let host=false;try{fs.readFileSync('/home/tendermachine/.ssh/id_rsa');host=true}catch{};process.stdout.write(JSON.stringify({leaked:Boolean(leaked),host,home:process.env.HOME}))";
  try {
    const result = await execute(root, ["-e", script]);
    assert.equal(result.status, "success");
    assert.deepEqual(JSON.parse(result.stdoutPreview), { leaked: false, host: false, home: "/tmp/home" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SEC-HID-001/002 private fixture contents are neither readable nor persisted", async () => {
  const root = await workspace();
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-hidden-"));
  const marker = "DS4_PRIVATE_FIXTURE_MARKER_7f3d";
  const hidden = path.join(privateRoot, "oracle.txt");
  await fs.writeFile(hidden, marker, "utf8");
  const script = "const fs=require('node:fs');let value='blocked';try{value=fs.readFileSync(process.argv[1],'utf8')}catch{};process.stdout.write(value)";
  try {
    const result = await execute(root, ["-e", script, hidden]);
    assert.equal(result.status, "success");
    assert.equal(result.stdoutPreview, "blocked");
    assert.equal(result.stdoutPreview.includes(marker), false);
    assert.equal(result.stderrPreview.includes(marker), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(privateRoot, { recursive: true, force: true });
  }
});

test("SEC-HID-001 workspace-private fixture is masked from candidate execution", async () => {
  const root = await workspace();
  const marker = "DS4_WORKSPACE_PRIVATE_MARKER_9ac1";
  await fs.mkdir(path.join(root, "checks"));
  await fs.writeFile(path.join(root, "checks", "oracle.txt"), marker, "utf8");
  const script = "const fs=require('node:fs');let value='blocked';try{value=fs.readFileSync('/workspace/checks/oracle.txt','utf8')||'blocked'}catch{};process.stdout.write(value)";
  try {
    const hidden = await execute(root, ["-e", script], {
      maskedBindings: [{ target: "/workspace/checks/oracle.txt", type: "file" }]
    });
    assert.equal(hidden.status, "success");
    assert.equal(hidden.stdoutPreview, "blocked");
    const evaluatorView = await execute(root, ["-e", script]);
    assert.equal(evaluatorView.stdoutPreview, marker);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SEC-GAME-001 trusted hidden evaluation catches a hardcoded candidate answer", async () => {
  const root = await workspace();
  await fs.mkdir(path.join(root, "checks"));
  await fs.writeFile(path.join(root, "checks", "answer.txt"), "7", "utf8");
  const candidateScript = "const fs=require('node:fs');let answer='42';try{answer=fs.readFileSync('/workspace/checks/answer.txt','utf8')}catch{};process.stdout.write(answer)";
  try {
    const candidate = await execute(root, ["-e", candidateScript], {
      maskedBindings: [{ target: "/workspace/checks/answer.txt", type: "file" }]
    });
    assert.equal(candidate.stdoutPreview, "42");
    const evaluatorScript = "const fs=require('node:fs');const expected=fs.readFileSync('/workspace/checks/answer.txt','utf8');process.exit(process.argv[1]===expected?0:9)";
    const evaluation = await execute(root, ["-e", evaluatorScript, candidate.stdoutPreview]);
    assert.equal(evaluation.status, "failure");
    assert.equal(evaluation.exitCode, 9);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SEC-SHELL-002 metacharacters cannot create a second command", async () => {
  const root = await workspace();
  const marker = "; /usr/bin/touch /workspace/src/owned";
  try {
    const result = await execute(root, ["-e", "process.stdout.write(process.argv[1])", marker]);
    assert.equal(result.status, "success");
    assert.equal(result.stdoutPreview, marker);
    await assert.rejects(() => fs.access(path.join(root, "src", "owned")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SEC-DOS-006 forced termination leaves no orphan candidate process", async () => {
  const root = await workspace();
  const script = "const {spawn}=require('node:child_process');spawn(process.execPath,['-e',\"setTimeout(()=>require('node:fs').writeFileSync('/workspace/src/orphan','bad'),500)\"]);setInterval(()=>{},1000)";
  try {
    const result = await execute(root, ["-e", script], { limits: { timeoutMs: 100 } });
    assert.equal(result.status, "timeout");
    await new Promise((resolve) => setTimeout(resolve, 650));
    await assert.rejects(() => fs.access(path.join(root, "src", "orphan")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
