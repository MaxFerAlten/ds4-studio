import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ReadGuard,
  bashFileReadFallbackReason,
  checkBashFileReadFallback,
  executeTool,
  sageSessionDir,
  sanitizeSessionId
} from "./agentTools.mjs";

const HAS_SAGE = spawnSync("sage", ["--version"], { encoding: "utf8" }).status === 0;

async function withTmpWorkspace(fn) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ds4-agent-tools-"));
  try {
    return await fn(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

test("read resolves relative paths from the configured workspace root", async () => {
  await withTmpWorkspace(async (cwd) => {
    await writeFile(path.join(cwd, "ds4.h"), "alpha\nbeta\ngamma\n", "utf8");

    const result = await executeTool("read", { path: "ds4.h", start_line: 2, max_lines: 1 }, { cwd });

    assert.equal(result.isError, false);
    assert.match(result.content, /ds4\.h/);
    assert.match(result.content, /2: beta/);
    assert.doesNotMatch(result.content, /1: alpha/);
  });
});

test("read prefixes and suffixes the result with a visible RANGE tag", async () => {
  await withTmpWorkspace(async (cwd) => {
    await writeFile(path.join(cwd, "ds4.h"), "alpha\nbeta\ngamma\ndelta\n", "utf8");

    const result = await executeTool("read", { path: "ds4.h", start_line: 2, max_lines: 2 }, { cwd });

    assert.equal(result.isError, false);
    // First line is the RANGE banner before any file content.
    assert.match(result.content.split("\n")[0], /^RANGE: 2-3 of 5$/);
    // Closing banner repeats the range so a top-down scan never misses it.
    assert.match(result.content, /\[RANGE: 2-3 of 5\]$/);
    assert.equal(result.raw.start_line, 2);
    assert.equal(result.raw.end_line, 3);
  });
});

test("read caps output to 20 KB and reports byte_truncated", async () => {
  await withTmpWorkspace(async (cwd) => {
    // Build a file of ~120 KB to exceed the byte cap regardless of max_lines.
    const big = Array.from({ length: 1500 }, (_, i) => `${i}: ${"x".repeat(80)}`).join("\n");
    await writeFile(path.join(cwd, "big.txt"), big, "utf8");

    const result = await executeTool("read", { path: "big.txt", whole: true }, { cwd });

    assert.equal(result.isError, false);
    assert.equal(result.raw.byte_truncated, true);
    assert.match(result.content, /truncated at \d+ bytes/);
    // Ensure the result actually stayed within ~the cap (20 KB + bookkeeping).
    assert.ok(Buffer.byteLength(result.content, "utf8") < 30 * 1024,
      `expected read result under 30 KB, got ${Buffer.byteLength(result.content, "utf8")}`);
  });
});

test("bash runs in the configured workspace root", async () => {
  await withTmpWorkspace(async (cwd) => {
    await writeFile(path.join(cwd, "marker.txt"), "ok", "utf8");

    const result = await executeTool("bash", { command: "pwd && test -f marker.txt", timeout_sec: 2 }, { cwd });

    assert.equal(result.isError, false);
    assert.match(result.content, new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

test("write and edit update files under the workspace root", async () => {
  await withTmpWorkspace(async (cwd) => {
    const write = await executeTool("write", { path: "nested/file.txt", content: "one\ntwo\n" }, { cwd });
    assert.equal(write.isError, false);

    const edit = await executeTool("edit", { path: "nested/file.txt", old: "two", new: "three" }, { cwd });
    assert.equal(edit.isError, false);

    assert.equal(await readFile(path.join(cwd, "nested/file.txt"), "utf8"), "one\nthree\n");
  });
});

test("search and list use the configured workspace root", async () => {
  await withTmpWorkspace(async (cwd) => {
    await writeFile(path.join(cwd, "a.txt"), "needle\n", "utf8");
    await writeFile(path.join(cwd, "b.log"), "needle\n", "utf8");

    const search = await executeTool("search", { query: "needle", path: ".", glob: "*.txt" }, { cwd });
    const list = await executeTool("list", { path: "." }, { cwd });

    assert.equal(search.isError, false);
    assert.match(search.content, /a\.txt:1:needle/);
    assert.doesNotMatch(search.content, /b\.log/);
    assert.equal(list.isError, false);
    assert.match(list.content, /a\.txt/);
    assert.match(list.content, /b\.log/);
  });
});

test("sandbox blocks reads that escape the workspace via traversal", async () => {
  await withTmpWorkspace(async (cwd) => {
    const result = await executeTool("read", { path: "../../etc/passwd" }, { cwd });
    assert.equal(result.isError, true);
    assert.match(result.content, /outside workspace/);
  });
});

test("sandbox blocks absolute paths outside the workspace root", async () => {
  await withTmpWorkspace(async (cwd) => {
    const result = await executeTool("read", { path: "/etc/passwd" }, { cwd });
    assert.equal(result.isError, true);
    assert.match(result.content, /outside workspace/);
  });
});

test("sandbox can be disabled via env var for read-only inspection", async () => {
  await withTmpWorkspace(async (cwd) => {
    const prev = process.env.DS4_AGENT_SANDBOX;
    process.env.DS4_AGENT_SANDBOX = "0";
    try {
      // A relative path that escapes is now permitted, but we still get a
      // not-found rather than a sandbox block.
      const result = await executeTool("read", { path: "../missing" }, { cwd });
      assert.equal(result.isError, true);
      assert.match(result.content, /not found/);
    } finally {
      if (prev === undefined) delete process.env.DS4_AGENT_SANDBOX;
      else process.env.DS4_AGENT_SANDBOX = prev;
    }
  });
});

test("bash AbortSignal terminates a long-running command", async () => {
  await withTmpWorkspace(async (cwd) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 80);
    const result = await executeTool(
      "bash",
      { command: "sleep 5", timeout_sec: 10 },
      { cwd, signal: controller.signal }
    );
    assert.equal(result.isError, true);
    assert.match(result.content, /aborted/);
  });
});

test("bash streams stdout to onProgress while running", async () => {
  await withTmpWorkspace(async (cwd) => {
    const chunks = [];
    const result = await executeTool(
      "bash",
      { command: "printf 'hello\\n'", timeout_sec: 2 },
      { cwd, onProgress: (s) => chunks.push(s) }
    );
    assert.equal(result.isError, false);
    assert.ok(chunks.join("").includes("hello"));
  });
});

test("ReadGuard blocks duplicate reads of the same range", () => {
  const guard = new ReadGuard();
  const args = { path: "ds4.h", start_line: 1, max_lines: 50 };
  assert.equal(guard.checkRead(args), undefined);
  guard.rememberRead(args, { next_offset: 51, total_lines: 200 });
  const block = guard.checkRead({ ...args });
  assert.ok(block?.block);
  assert.match(block.reason, /Duplicate read blocked/);
});

test("ReadGuard blocks reads covered by an earlier larger range", () => {
  const guard = new ReadGuard();
  guard.rememberRead({ path: "ds4.h", start_line: 1, max_lines: 200 }, { next_offset: 201 });
  const block = guard.checkRead({ path: "ds4.h", start_line: 10, max_lines: 20 });
  assert.ok(block?.block);
  assert.match(block.reason, /Covered read blocked/);
});

test("ReadGuard forgets a path after an edit/write invalidation", () => {
  const guard = new ReadGuard();
  const args = { path: "ds4.h", start_line: 1, max_lines: 50 };
  guard.rememberRead(args, { next_offset: 51 });
  guard.invalidatePath("ds4.h");
  assert.equal(guard.checkRead({ ...args }), undefined);
});

test("ReadGuard strict mode blocks follow-up reads on a path with a prior block", () => {
  const guard = new ReadGuard();
  const seen = { path: "ds4.h", start_line: 1, max_lines: 50 };
  guard.rememberRead(seen, { next_offset: 51 });
  guard.beginTurn();
  // First duplicate triggers the standard block + records turn-block.
  const dup = guard.checkRead(seen, "strict");
  assert.ok(dup?.block);
  // Different range on the same path: blocked under strict mode but not exact.
  const followup = { path: "ds4.h", start_line: 200, max_lines: 10 };
  assert.equal(guard.checkRead({ ...followup }, "exact"), undefined);
  const strictBlock = guard.checkRead({ ...followup }, "strict");
  assert.ok(strictBlock?.block);
  assert.match(strictBlock.reason, /Strict read guard/);
});

test("bashFileReadFallbackReason flags cat/head/tail/sed/awk dumps", () => {
  assert.match(bashFileReadFallbackReason({ command: "cat /etc/hosts" }), /cat/);
  assert.match(bashFileReadFallbackReason({ command: "head -n 50 ds4.h" }), /head/);
  assert.match(bashFileReadFallbackReason({ command: "tail -n 200 logs/app.log" }), /tail/);
  assert.match(bashFileReadFallbackReason({ command: "sed -n '1,20p' ds4.h" }), /sed/);
  assert.match(bashFileReadFallbackReason({ command: "awk '{print $1}' data.csv" }), /awk/);
});

test("bashFileReadFallbackReason flags find -exec cat and xargs cat", () => {
  assert.match(bashFileReadFallbackReason({ command: "find . -name '*.c' -exec cat {} \\;" }), /find/);
  assert.match(bashFileReadFallbackReason({ command: "ls *.txt | xargs cat" }), /xargs/);
});

test("bashFileReadFallbackReason flags python/node file reads", () => {
  assert.match(
    bashFileReadFallbackReason({ command: "python3 -c 'open(\"ds4.h\").read()'" }),
    /python/
  );
  assert.match(
    bashFileReadFallbackReason({ command: "node -e 'fs.readFileSync(\"ds4.h\",\"utf8\")'" }),
    /node/
  );
});

test("bashFileReadFallbackReason flags sage even after shell control operators", () => {
  assert.match(bashFileReadFallbackReason({ command: "sage script.sage" }), /sage/);
  assert.match(bashFileReadFallbackReason({ command: "cd repo && sage script.sage" }), /sage/);
  assert.match(bashFileReadFallbackReason({ command: "printf ok; Sage -c '2+2'" }), /sage/);
});

test("bashFileReadFallbackReason leaves safe commands alone", () => {
  assert.equal(bashFileReadFallbackReason({ command: "ls -la" }), undefined);
  assert.equal(bashFileReadFallbackReason({ command: "grep -rn foo src/" }), undefined);
  assert.equal(bashFileReadFallbackReason({ command: "make test" }), undefined);
  assert.equal(bashFileReadFallbackReason({ command: "echo hello" }), undefined);
});

test("checkBashFileReadFallback returns a stronger reason after a read-guard block", () => {
  const decision = checkBashFileReadFallback({ command: "cat ds4.h" }, true);
  assert.ok(decision?.block);
  assert.match(decision.reason, /after a read guard block/);
});

test("sage tool evaluates a single Sage expression with preparsing", { skip: !HAS_SAGE }, async () => {
  await withTmpWorkspace(async (cwd) => {
    const result = await executeTool("sage", { code: "2^3", timeout_sec: 20 }, { cwd });

    assert.equal(result.isError, false);
    assert.match(result.content, /LaTeX:\s*8/);
    assert.match(result.content, /Result:\s*8/);
  });
});

test("sage tool executes multi-statement Sage scripts and renders result", { skip: !HAS_SAGE }, async () => {
  await withTmpWorkspace(async (cwd) => {
    const result = await executeTool("sage", {
      code: [
        "var('x')",
        "f(x) = x^2",
        "print('value:', f(3))",
        "result = integral(x^2, x, 0, 2)"
      ].join("\n"),
      timeout_sec: 20
    }, { cwd });

    assert.equal(result.isError, false);
    assert.match(result.content, /value:\s*9/);
    assert.match(result.content, /LaTeX:\s*\\frac\{8\}\{3\}/);
    assert.match(result.content, /Result:\s*8\/3/);
  });
});

// ── per-session sage working directory ───────────────────────────────────

test("sanitizeSessionId keeps safe chars, collapses the rest, and bounds length", () => {
  assert.equal(sanitizeSessionId("abc-123_X.y"), "abc-123_X.y");
  assert.equal(sanitizeSessionId("a/b c:d*e"), "a_b_c_d_e");
  assert.equal(sanitizeSessionId(""), "default");
  assert.equal(sanitizeSessionId(null), "default");
  assert.equal(sanitizeSessionId("   "), "default");
  assert.equal(sanitizeSessionId("../../etc"), "_.._etc"); // leading dots stripped, slashes collapsed
  assert.equal(sanitizeSessionId("x".repeat(200)).length, 128);
});

test("sageSessionDir builds <base>/sage_<sessionId> with an absolute base", () => {
  assert.equal(sageSessionDir("/ws", "sess1"), path.join("/ws", "sage_sess1"));
  assert.equal(sageSessionDir("/ws/history/..", "sess1"), path.join("/ws", "sage_sess1"));
  // unsafe ids are sanitised into the directory name
  assert.equal(sageSessionDir("/ws", "a/b"), path.join("/ws", "sage_a_b"));
  // blank id still yields a directory
  assert.equal(sageSessionDir("/ws", ""), path.join("/ws", "sage_default"));
});

test("sage tool creates and runs inside the per-session workdir", { skip: !HAS_SAGE }, async () => {
  await withTmpWorkspace(async (base) => {
    const sageWorkdir = sageSessionDir(base, "sessABC");
    const result = await executeTool(
      "sage",
      { code: "import os\nprint('CWD:', os.getcwd())\nresult = 2^3", timeout_sec: 30 },
      { sageWorkdir }
    );
    assert.equal(result.isError, false);
    assert.match(result.content, /Result:\s*8/);
    // Sage actually ran in the per-session directory…
    assert.match(result.content, new RegExp(`CWD:\\s*${sageWorkdir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    // …and the directory exists under the workspace base, not the project tree.
    const dirStat = await stat(sageWorkdir);
    assert.equal(dirStat.isDirectory(), true);
  });
});

test("sage tool creates the per-session workdir even when sage is absent", { skip: HAS_SAGE }, async () => {
  await withTmpWorkspace(async (base) => {
    const sageWorkdir = sageSessionDir(base, "sessNoSage");
    // sage binary missing → tool reports an error, but the workdir must still
    // be created (mkdir happens before spawn), proving artifacts would be
    // isolated there rather than in the project tree.
    await executeTool("sage", { code: "2^3" }, { sageWorkdir });
    const dirStat = await stat(sageWorkdir);
    assert.equal(dirStat.isDirectory(), true);
  });
});
