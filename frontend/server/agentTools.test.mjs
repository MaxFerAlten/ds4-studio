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
  checkBashLeanGuard,
  executeTool,
  formatLeanResult,
  sageSessionDir,
  sanitizeSessionId,
  toolLeanCheck
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

test("Sage dispatch always enters the authoritative gateway", async () => {
  let captured = null;
  const marker = {
    content: "gateway-marker",
    isError: false,
    contractVersion: "sage_result_v2",
    publishable: false
  };
  const result = await executeTool("sage", { code: "1+1", phase: "compute" }, {
    authoritativeSageExecutor: async (args, options) => {
      captured = { args, options };
      return marker;
    }
  });
  assert.equal(result, marker);
  assert.equal(captured.args.code, "1+1");
  assert.equal(captured.args.phase, "compute");
  assert.equal(typeof captured.options.rawExecutor, "function");
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

test("retrieve_context_blob returns an exact stored byte range", async () => {
  const calls = [];
  const toolBlobStore = {
    async get(id, offset, length) {
      calls.push({ id, offset, length });
      return "exact bytes";
    }
  };

  const result = await executeTool(
    "retrieve_context_blob",
    { id: `sha256:${"a".repeat(64)}`, offset: 7, length: 11 },
    { toolBlobStore }
  );

  assert.equal(result.isError, false);
  assert.match(result.content, /<context_blob_range>/);
  assert.match(result.content, /exact bytes/);
  assert.deepEqual(calls, [{ id: `sha256:${"a".repeat(64)}`, offset: 7, length: 11 }]);
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
    const result = await executeTool("sage", { code: "2^3", timeout_sec: 20 }, {
      cwd,
      authoritativeSageExecutor: (args, options) => options.rawExecutor(args, options)
    });

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
    }, {
      cwd,
      authoritativeSageExecutor: (args, options) => options.rawExecutor(args, options)
    });

    assert.equal(result.isError, false);
    assert.match(result.content, /value:\s*9/);
    assert.match(result.content, /LaTeX:\s*\\frac\{8\}\{3\}/);
    assert.match(result.content, /Result:\s*8\/3/);
  });
});

// ── web_search guard ──────────────────────────────────────────────────────

test("web_search blocks model reasoning before calling browser search", async () => {
  const result = await executeTool(
    "web_search",
    { query: "L'utente ha scritto si quindi devo cercare conferenze AI" },
    { cwd: process.cwd() }
  );

  assert.equal(result.isError, true);
  assert.match(result.content, /web_search blocked/);
  assert.match(result.content, /reasoning|metatext/i);
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
      {
        sageWorkdir,
        authoritativeSageExecutor: (args, options) => options.rawExecutor(args, options)
      }
    );
    assert.equal(result.isError, false);
    assert.match(result.content, /Result:\s*8/);
    // Public output confirms the isolated workdir without leaking its host path.
    assert.match(result.content, /CWD:\s*\[sage-session\]/);
    assert.doesNotMatch(
      result.content,
      new RegExp(sageWorkdir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
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

// ---------------------------------------------------------------------------
// lean_check
// ---------------------------------------------------------------------------

test("bash lean guard blocks the toolchain, by executable not by substring", () => {
  for (const command of [
    "lean Main.lean",
    "lake env lean Main.lean",
    "elan show",
    "/opt/lean/bin/lake build",
    "cd proj && lake build"
  ]) {
    const decision = checkBashLeanGuard({ command });
    assert.ok(decision?.block, `expected block for: ${command}`);
    assert.match(decision.reason, /lean_check/);
  }

  for (const command of [
    "grep -n lean README.md",
    "printf '%s\\n' lean",
    "ls docs/lean4",
    "git log --grep lake"
  ]) {
    assert.equal(checkBashLeanGuard({ command }), undefined, `should allow: ${command}`);
  }
});

test("bash lean guard ignores non-bash input shapes", () => {
  assert.equal(checkBashLeanGuard(undefined), undefined);
  assert.equal(checkBashLeanGuard({}), undefined);
  assert.equal(checkBashLeanGuard({ command: "   " }), undefined);
});

test("lean_check is unavailable when the server injects no executor", async () => {
  const result = await executeTool("lean_check", { code: "theorem t : True := trivial" }, {});
  assert.equal(result.isError, true);
  assert.match(result.content, /unavailable/i);
});

test("lean_check requires non-empty code", async () => {
  const result = await toolLeanCheck({ code: "  " }, { leanExecutor: async () => ({}) });
  assert.equal(result.isError, true);
  assert.match(result.content, /requires a non-empty 'code'/);
});

test("lean_check maps model arguments onto the request contract", async () => {
  let seen = null;
  await toolLeanCheck(
    {
      code: "theorem t : True := trivial",
      profile: "mathlib",
      timeout_sec: 45,
      expected_declarations: ["t"]
    },
    {
      sessionKey: "sess/ion 1",
      leanPolicyRevision: "c".repeat(40),
      leanExecutor: async (request) => {
        seen = request;
        return { status: "checked", isError: false, summary: "ok" };
      }
    }
  );

  assert.equal(seen.contractVersion, "lean_check_request_v1");
  assert.equal(seen.mode, "check");
  assert.equal(seen.profile, "mathlib");
  assert.equal(seen.timeoutSec, 45);
  assert.deepEqual(seen.expectedDeclarations, ["t"]);
  assert.equal(seen.proofPolicy, "typecheck");
  assert.equal(seen.policyRevision, "c".repeat(40));
  assert.equal(seen.sessionId, "sess_ion_1");
  // The model must not be able to smuggle a command, path or run mode through.
  assert.equal(seen.command, undefined);
  assert.equal(seen.args, undefined);
  assert.equal(seen.path, undefined);
});

test("lean_check returns dispatcher-shaped content, not the raw contract", async () => {
  const result = await toolLeanCheck(
    { code: "theorem t : True := trivial" },
    {
      leanExecutor: async () => ({
        contractVersion: "lean_result_v1",
        status: "checked",
        isError: false,
        profile: "core",
        toolchain: "leanprover/lean4:v4.32.2",
        summary: "Lean elaboration completed without errors.",
        diagnostics: [],
        certified: false
      })
    }
  );
  assert.equal(typeof result.content, "string");
  assert.equal(result.isError, false);
  assert.equal(result.raw.contractVersion, "lean_result_v1");
});

test("lean_inspect is unavailable when the server injects no executor", async () => {
  const result = await executeTool("lean_inspect", { symbols: ["Nat.add_comm"] }, {});
  assert.equal(result.isError, true);
  assert.match(result.content, /unavailable/i);
});

test("lean_inspect dispatches through the dedicated inspect executor, never lean_check's", async () => {
  // Regression guard: lean_inspect once bypassed executeLeanInspect (its own
  // validation, sandbox, #check parsing) and reused leanExecutor with a
  // hardcoded profile="core" lean_check_request_v1 contract instead.
  let seen = null;
  const leanExecutor = async () => {
    throw new Error("lean_inspect must not call the lean_check executor");
  };
  const result = await executeTool(
    "lean_inspect",
    { symbols: ["Nat.add_comm", "Nat.zero_add"], imports: ["Mathlib.Data.Nat.Basic"], timeout_sec: 10 },
    {
      leanExecutor,
      leanInspectExecutor: async (body) => {
        seen = body;
        return { status: "inspected", profile: "core", symbols: body.symbols.map((name) => ({ name, output: `#check ${name} : Prop` })) };
      }
    }
  );
  assert.deepEqual(seen, { symbols: ["Nat.add_comm", "Nat.zero_add"], imports: ["Mathlib.Data.Nat.Basic"], profile: undefined, timeout_sec: 10, sessionId: "default" });
  assert.equal(result.isError, false);
  assert.match(result.content, /attempt_consumed=false/);
  assert.match(result.content, /verified=false/);
  assert.match(result.content, /Nat\.add_comm: #check Nat\.add_comm : Prop/);
});

test("lean_inspect propagates profile to the executor (D3.3 parity with native)", async () => {
  let seen = null;
  const result = await executeTool(
    "lean_inspect",
    { symbols: ["exists_deriv_eq_slope"], imports: ["Mathlib.Analysis.Calculus.Deriv.MeanValue"], profile: "mathlib", timeout_sec: 30 },
    {
      leanInspectExecutor: async (body) => {
        seen = body;
        return { status: "inspected", profile: body.profile || "core", symbols: [{ name: "exists_deriv_eq_slope", output: "#check exists_deriv_eq_slope : ..." }] };
      }
    }
  );
  assert.deepEqual(seen, { symbols: ["exists_deriv_eq_slope"], imports: ["Mathlib.Analysis.Calculus.Deriv.MeanValue"], profile: "mathlib", timeout_sec: 30, sessionId: "default" });
  assert.equal(result.isError, false);
  assert.match(result.content, /profile=mathlib/);
});

test("lean_inspect surfaces a structured executor error as isError", async () => {
  const result = await executeTool(
    "lean_inspect",
    { symbols: ["Nat.add_comm"] },
    {
      leanInspectExecutor: async () => ({
        errorCode: "LEAN_INSPECT_SYMBOLS_LIMIT",
        message: "Maximum 16 symbols per inspect.",
        statusCode: 422
      })
    }
  );
  assert.equal(result.isError, true);
  assert.match(result.content, /Maximum 16 symbols per inspect/);
});

test("a checked result never reads as certified", () => {
  const content = formatLeanResult({
    status: "checked",
    profile: "core",
    toolchain: "leanprover/lean4:v4.32.2",
    summary: "Lean elaboration completed without errors.",
    diagnostics: [],
    certified: false
  });
  assert.match(content, /certified=false/);
  assert.match(content, /not a formal certification|not a certified proof/i);
});

test("failed results surface diagnostics with positions", () => {
  const content = formatLeanResult({
    status: "failed",
    isError: true,
    summary: "Lean elaboration failed with 1 error.",
    diagnostics: [
      { severity: "error", file: "Main.lean", line: 3, column: 17, message: "type mismatch" }
    ],
    certified: false
  });
  assert.match(content, /Main\.lean:3:17/);
  assert.match(content, /type mismatch/);
});

test("placeholder evidence is reported as not-a-proof", () => {
  const content = formatLeanResult({
    status: "checked",
    summary: "ok",
    diagnostics: [],
    containsPlaceholders: true,
    placeholderEvidence: ["sorry"],
    certified: false
  });
  assert.match(content, /placeholders detected/);
  assert.match(content, /not a proof/);
});

test("per-turn tool scope: allowedTools restricts dispatch", async () => {
  const result = await executeTool("bash", { command: "echo hi" }, { allowedTools: ["read", "search"] });
  assert.equal(result.isError, true);
  assert.match(result.content, /not permitted in this turn's scope/);
});

test("per-turn tool scope: allowedTools permits listed tools", async () => {
  // search is safe and always works regardless of workspace — verify it passes through
  const result = await executeTool("search", { query: "pattern", paths: "." }, { allowedTools: ["search"] });
  assert.equal(result.isError, false);
  assert.equal(result.content !== undefined, true);
});

test("per-turn tool scope: empty allowedTools blocks everything", async () => {
  const result = await executeTool("search", { query: "pattern" }, { allowedTools: [] });
  assert.equal(result.isError, true);
  assert.match(result.content, /not permitted in this turn's scope/);
});

test("per-turn tool scope: null/undefined allowedTools permits all", async () => {
  const result = await executeTool("search", { query: "pattern", paths: "." }, { allowedTools: null });
  assert.equal(result.isError, false);
});

// ---------------------------------------------------------------------------
// WP08 — task mode and target declaration adapter integrity.
// ---------------------------------------------------------------------------

test("ADAPTER-TASK-01 task_mode is forwarded as taskMode", async () => {
  let seen = null;
  await toolLeanCheck(
    { code: "theorem t : True := by trivial", task_mode: "proof", target_declaration: "t" },
    { leanExecutor: async (request) => { seen = request; return { isError: false }; } }
  );
  assert.equal(seen.taskMode, "proof");
});

test("ADAPTER-TASK-02 target_declaration is forwarded as targetDeclaration", async () => {
  let seen = null;
  await toolLeanCheck(
    { code: "theorem t : True := by trivial", task_mode: "proof", target_declaration: "cauchy_mean_value" },
    { leanExecutor: async (request) => { seen = request; return { isError: false }; } }
  );
  assert.equal(seen.targetDeclaration, "cauchy_mean_value");
});

test("ADAPTER-TASK-03 the locked statement hash may only come from options", async () => {
  let seen = null;
  await toolLeanCheck(
    { code: "theorem t : True := by trivial", task_mode: "proof", target_declaration: "t" },
    {
      leanExpectedTargetStatementSha256: "c".repeat(64),
      leanExecutor: async (request) => { seen = request; return { isError: false }; }
    }
  );
  assert.equal(seen.expectedTargetStatementSha256, "c".repeat(64));
});

test("ADAPTER-TASK-04 a model-supplied expectedTargetStatementSha256 is ignored", async () => {
  let seen = null;
  await toolLeanCheck(
    {
      code: "theorem t : True := by trivial",
      task_mode: "proof",
      target_declaration: "t",
      expectedTargetStatementSha256: "f".repeat(64)
    },
    { leanExecutor: async (request) => { seen = request; return { isError: false }; } }
  );
  assert.equal(seen.expectedTargetStatementSha256, undefined);
});

test("ADAPTER-TASK-05 proof without a target declaration never reaches the executor", async () => {
  let called = false;
  const result = await toolLeanCheck(
    { code: "theorem t : True := by trivial", task_mode: "proof" },
    {
      leanExecutor: async () => {
        called = true;
        return { isError: false };
      }
    }
  );
  assert.equal(called, false);
  assert.equal(result.isError, true);
  assert.match(result.content, /target_declaration/);
});

test("ADAPTER-TASK-06 profile mathlib round-trips through the adapter in proof mode", async () => {
  let seen = null;
  await toolLeanCheck(
    { code: "theorem t : True := by trivial", task_mode: "proof", target_declaration: "t", profile: "mathlib" },
    { leanExecutor: async (request) => { seen = request; return { isError: false }; } }
  );
  assert.equal(seen.profile, "mathlib");
  assert.equal(seen.taskMode, "proof");
});
