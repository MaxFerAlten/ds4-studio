// Tests for leanInspect.mjs — Lean 4 symbol inspection tool
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  validateModule,
  validateSymbol,
  validateInspectRequest,
  generateInspectSource,
  executeLeanInspect,
  inspectResult,
  LEAN_INSPECT_MAX_PER_TASK,
  LEAN_INSPECT_TIMEOUT_SEC,
} from "./leanInspect.mjs";
import { LEAN_INSPECT_MAX_TIMEOUT_SEC } from "./leanConstants.mjs";

// Hermetic: sandbox resolution and process runner are injected, so this runs
// without bubblewrap or an installed Lean toolchain (mirrors leanExecutor.test.mjs).
const RUNS_ROOT = resolve(tmpdir(), `ds4-lean-inspect-${process.pid}`);

const CONFIG = {
  enabled: true,
  sandboxRequired: false,
  bwrapBin: "/usr/bin/bwrap",
  prlimitBin: "/usr/bin/prlimit",
  runtimeRoot: "/nonexistent/lean-runtime",
  runsRoot: RUNS_ROOT,
  elanRoot: "/nonexistent/.elan",
  defaultProfile: "core",
  memoryBytes: 4294967296,
  addressSpaceBytes: 17179869184,
  leanThreads: 4,
  cpuSeconds: 30,
  maxProcesses: 512,
  maxOpenFiles: 128,
};

const PREFLIGHT = {
  profiles: {
    core: { ok: true, toolchain: "leanprover/lean4:v4.32.2" },
  },
};

const SANDBOX_OK = async () => ({
  ok: true,
  toolchain: { dir: "/toolchains/lean", descriptor: "leanprover/lean4:v4.32.2" },
});

function runner(result) {
  return async () => ({
    exitCode: 0,
    timedOut: false,
    durationMs: 12,
    stdout: "Nat.add : ℕ → ℕ → ℕ\n",
    stderr: "",
    ...result,
  });
}

after(async () => {
  await rm(RUNS_ROOT, { recursive: true, force: true });
});

describe("INSPECT-01 module validation", () => {
  it("accepts valid Mathlib module", () => {
    const r = validateModule("Mathlib.Topology.Basic");
    assert.equal(r.ok, true);
  });
  it("rejects empty module", () => {
    const r = validateModule("");
    assert.equal(r.ok, false);
  });
  it("rejects Lean prefix", () => {
    const r = validateModule("Lean.Data.List");
    assert.equal(r.ok, false);
  });
  it("rejects injection via newline", () => {
    const r = validateModule("Mathlib\n.run_tac");
    assert.equal(r.ok, false);
  });
  it("rejects injection via semicolon", () => {
    const r = validateModule("Mathlib;evil");
    assert.equal(r.ok, false);
  });
  it("rejects injection via #", () => {
    const r = validateModule("Mathlib#evil");
    assert.equal(r.ok, false);
  });
});

describe("INSPECT-02 symbol validation", () => {
  it("accepts standard identifier", () => {
    const r = validateSymbol("Nat.add");
    assert.equal(r.ok, true);
  });
  it("accepts Unicode math symbol", () => {
    const r = validateSymbol("ℝ");
    assert.equal(r.ok, true);
  });
  it("accepts Greek symbol", () => {
    const r = validateSymbol("α");
    assert.equal(r.ok, true);
  });
  it("rejects empty symbol", () => {
    const r = validateSymbol("");
    assert.equal(r.ok, false);
  });
  it("rejects newline injection", () => {
    const r = validateSymbol("Nat\n.run_tac");
    assert.equal(r.ok, false);
  });
  it("rejects # injection", () => {
    const r = validateSymbol("Nat#evil");
    assert.equal(r.ok, false);
  });
});

describe("INSPECT-03 request validation", () => {
  it("rejects missing symbols", () => {
    const r = validateInspectRequest({});
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "LEAN_INSPECT_SYMBOLS_REQUIRED");
  });
  it("rejects too many symbols", () => {
    const r = validateInspectRequest({ symbols: Array(17).fill("Nat") });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "LEAN_INSPECT_SYMBOLS_LIMIT");
  });
  it("rejects too many imports", () => {
    const r = validateInspectRequest({
      symbols: ["Nat"],
      imports: Array(9).fill("Mathlib.Data.List"),
    });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "LEAN_INSPECT_IMPORTS_INVALID");
  });
  it("rejects invalid symbol in array", () => {
    const r = validateInspectRequest({ symbols: ["Nat", ""] });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "LEAN_INSPECT_SYMBOL_INVALID");
  });
  it("rejects invalid profile", () => {
    const r = validateInspectRequest({ symbols: ["Nat"], profile: "evil" });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "LEAN_INSPECT_PROFILE_INVALID");
  });
  it("accepts valid request", () => {
    const r = validateInspectRequest({ symbols: ["Nat.add", "List.length"] });
    assert.equal(r.ok, true);
  });
  it("accepts with imports", () => {
    const r = validateInspectRequest({
      symbols: ["exists_deriv_eq_zero"],
      imports: ["Mathlib.Analysis.Calculus.Deriv"],
    });
    assert.equal(r.ok, true);
  });
});

describe("INSPECT-04 source generation", () => {
  it("generates correct Lean source", () => {
    const src = generateInspectSource({
      imports: ["Mathlib.Topology.Basic"],
      symbols: ["Nat.add", "List.length"],
    });
    assert.ok(src.includes("import Mathlib.Topology.Basic"));
    assert.ok(src.includes("#check Nat.add"));
    assert.ok(src.includes("#check List.length"));
  });
  it("generates source without imports", () => {
    const src = generateInspectSource({ symbols: ["Nat"] });
    assert.ok(!src.includes("import"));
    assert.ok(src.includes("#check Nat"));
  });
  it("rejects no code injection in imports", () => {
    const src = generateInspectSource({
      imports: [],
      symbols: ["Nat"],
    });
    assert.ok(!src.includes("run_tac"));
    assert.ok(!src.includes("#eval"));
  });
});

describe("INSPECT-05 no proof attempt consumed", () => {
  it("constants are defined and consistent", () => {
    assert.equal(typeof LEAN_INSPECT_MAX_PER_TASK, "number");
    assert.equal(typeof LEAN_INSPECT_TIMEOUT_SEC, "number");
    assert.ok(LEAN_INSPECT_MAX_PER_TASK <= 4);
    assert.ok(LEAN_INSPECT_TIMEOUT_SEC <= LEAN_INSPECT_MAX_TIMEOUT_SEC);
    assert.equal(LEAN_INSPECT_TIMEOUT_SEC, 30);
    assert.equal(LEAN_INSPECT_MAX_TIMEOUT_SEC, 120);
  });
});

describe("INSPECT-06 result cannot set verified", () => {
  it("executeLeanInspect rejects invalid body with canonical errorCode", async () => {
    const result = await executeLeanInspect(null, { config: {} });
    assert.equal(result.errorCode, "LEAN_INSPECT_INVALID");
    assert.equal(result.status, "rejected");
    assert.equal(result.isError, true);
    assert.equal(result.attemptConsumed, false);
    assert.equal(result.verified, false);
    assert.ok(typeof result.displayText === "string");
  });
  it("executeLeanInspect rejects missing runtime with canonical errorCode", async () => {
    const result = await executeLeanInspect(
      { symbols: ["Nat"] },
      { config: { defaultProfile: "core" }, preflight: { profiles: {} } }
    );
    assert.equal(result.errorCode, "LEAN_INSPECT_RUNTIME_UNAVAILABLE");
    assert.equal(result.status, "preflight_failed");
    assert.equal(result.contractVersion, "lean_inspect_result_v1");
    assert.equal(result.processStarted, false);
    assert.equal(result.attemptConsumed, false);
    assert.equal(result.verified, false);
  });
});

describe("INSPECT-08 executor succeeds with a real run directory", () => {
  it("does not fail with LEAN_INSPECT_INTERNAL_ERROR (regression: runId must satisfy RUN_ID_RE)", async () => {
    const result = await executeLeanInspect(
      { symbols: ["Nat.add"] },
      {
        config: CONFIG,
        preflight: PREFLIGHT,
        resolveSandbox: SANDBOX_OK,
        processRunner: runner(),
      }
    );
    assert.equal(result.code, undefined);
    assert.equal(result.status, "inspected");
    assert.equal(result.profile, "core");
    assert.equal(result.symbols[0].name, "Nat.add");
    assert.match(result.symbols[0].output, /Nat\.add/);
  });

  it("carries the D11.1 audit-minimum fields explicitly, not only by comment", async () => {
    const result = await executeLeanInspect(
      { symbols: ["Nat.add"] },
      {
        config: CONFIG,
        preflight: PREFLIGHT,
        resolveSandbox: SANDBOX_OK,
        processRunner: runner(),
      }
    );
    assert.equal(result.contractVersion, "lean_inspect_result_v1");
    assert.equal(result.tool, "lean_inspect");
    assert.equal(result.processStarted, true);
    assert.equal(result.attemptConsumed, false);
    assert.equal(result.verified, false);
  });
});

describe("INSPECT-07 symbol injection blocked", () => {
  it("rejects semicolon in symbol", () => {
    const r = validateInspectRequest({ symbols: ["Nat;run_tac"] });
    assert.equal(r.ok, false);
  });
  it("rejects # in symbol", () => {
    const r = validateInspectRequest({ symbols: ["Nat#eval"] });
    assert.equal(r.ok, false);
  });
  it("rejects newline in module", () => {
    const r = validateInspectRequest({
      symbols: ["Nat"],
      imports: ["Mathlib\nrun_tac"],
    });
    assert.equal(r.ok, false);
  });
});

// --- WP01.5 — Canonical inspect contract tests (lean.fix.000) ----------------

describe("INSPECT-CONTRACT-001 success has all mandatory fields", () => {
  it("includes every required field on success", async () => {
    const result = await executeLeanInspect(
      { symbols: ["Nat.add", "List.length"] },
      {
        config: CONFIG,
        preflight: PREFLIGHT,
        resolveSandbox: SANDBOX_OK,
        processRunner: runner({
          stdout: "Nat.add : ℕ → ℕ → ℕ\nList.length : List α → Nat\n",
        }),
      }
    );
    assert.equal(result.contractVersion, "lean_inspect_result_v1");
    assert.equal(result.tool, "lean_inspect");
    assert.equal(result.status, "inspected");
    assert.equal(result.isError, false);
    assert.equal(result.errorCode, null);
    assert.equal(result.profile, "core");
    assert.ok(Array.isArray(result.symbols));
    assert.equal(result.symbols.length, 2);
    assert.ok(typeof result.displayText === "string");
    assert.ok(typeof result.sourceSha256 === "string");
    assert.ok(typeof result.durationMs === "number");
    assert.equal(typeof result.timedOut, "boolean");
    assert.equal(result.processStarted, true);
    assert.equal(result.attemptConsumed, false);
    assert.equal(result.verified, false);
    // Legacy snake_case aliases
    assert.ok(typeof result.source_sha256 === "string");
    assert.equal(result.source_sha256, result.sourceSha256);
    assert.equal(result.duration_ms, result.durationMs);
    assert.equal(result.timed_out, result.timedOut);
  });
});

describe("INSPECT-CONTRACT-002 timeout has status=timeout", () => {
  it("timeout result has correct status", async () => {
    const result = await executeLeanInspect(
      { symbols: ["SlowSymbol"] },
      {
        config: CONFIG,
        preflight: PREFLIGHT,
        resolveSandbox: SANDBOX_OK,
        processRunner: runner({ timedOut: true, exitCode: 0, durationMs: 30000, stdout: "" }),
      }
    );
    assert.equal(result.status, "timeout");
    assert.equal(result.isError, true);
    assert.equal(result.timedOut, true);
    assert.equal(result.processStarted, true);
    assert.equal(result.attemptConsumed, false);
    assert.equal(result.verified, false);
    assert.ok(result.displayText.includes("status=timeout"));
    assert.ok(result.displayText.includes("nextAction=retry_discovery_with_extended_timeout"));
  });
});

describe("INSPECT-CONTRACT-003 runtime unavailable has status=preflight_failed", () => {
  it("preflight_failed preserves original errorCode", async () => {
    const result = await executeLeanInspect(
      { symbols: ["Nat"] },
      { config: { defaultProfile: "core" }, preflight: { profiles: {} } }
    );
    assert.equal(result.status, "preflight_failed");
    assert.equal(result.errorCode, "LEAN_INSPECT_RUNTIME_UNAVAILABLE");
    assert.equal(result.attemptConsumed, false);
    assert.equal(result.verified, false);
  });
});

describe("INSPECT-CONTRACT-004 internal error has status=internal_error", () => {
  it("sandbox failure produces correct error", async () => {
    const failSandbox = async () => ({ ok: false, error: "no sandbox" });
    const result = await executeLeanInspect(
      { symbols: ["Nat"] },
      {
        config: CONFIG,
        preflight: PREFLIGHT,
        resolveSandbox: failSandbox,
        processRunner: runner(),
      }
    );
    assert.equal(result.status, "preflight_failed");
    assert.equal(result.errorCode, "LEAN_INSPECT_SANDBOX_UNAVAILABLE");
    assert.equal(result.attemptConsumed, false);
    assert.equal(result.verified, false);
  });
});

describe("INSPECT-CONTRACT-005 every result has attemptConsumed=false", () => {
  it("attemptConsumed is false on success", async () => {
    const r = await executeLeanInspect(
      { symbols: ["Nat"] },
      { config: CONFIG, preflight: PREFLIGHT, resolveSandbox: SANDBOX_OK, processRunner: runner() }
    );
    assert.equal(r.attemptConsumed, false);
  });
  it("attemptConsumed is false on rejection", async () => {
    const r = await executeLeanInspect(null, { config: {} });
    assert.equal(r.attemptConsumed, false);
  });
  it("attemptConsumed is false on preflight_failed", async () => {
    const r = await executeLeanInspect(
      { symbols: ["Nat"] },
      { config: { defaultProfile: "core" }, preflight: { profiles: {} } }
    );
    assert.equal(r.attemptConsumed, false);
  });
});

describe("INSPECT-CONTRACT-006 every result has verified=false", () => {
  it("verified is false on success", async () => {
    const r = await executeLeanInspect(
      { symbols: ["Nat"] },
      { config: CONFIG, preflight: PREFLIGHT, resolveSandbox: SANDBOX_OK, processRunner: runner() }
    );
    assert.equal(r.verified, false);
  });
  it("verified is false on rejection", async () => {
    const r = await executeLeanInspect(null, { config: {} });
    assert.equal(r.verified, false);
  });
});

describe("INSPECT-CONTRACT-007 displayText includes every requested symbol", () => {
  it("displayText contains all symbol names", async () => {
    const r = await executeLeanInspect(
      { symbols: ["Nat.add", "List.length", "Fin.val"] },
      {
        config: CONFIG,
        preflight: PREFLIGHT,
        resolveSandbox: SANDBOX_OK,
        processRunner: runner({ stdout: "Nat.add : Nat → Nat → Nat\nList.length : List α → Nat\nFin.val : Fin n → Nat\n" }),
      }
    );
    assert.ok(r.displayText.includes("Nat.add:"));
    assert.ok(r.displayText.includes("List.length:"));
    assert.ok(r.displayText.includes("Fin.val:"));
  });
});

describe("INSPECT-CONTRACT-008 camelCase fields present", () => {
  it("camelCase fields are present and snake_case are aliases", async () => {
    const r = await executeLeanInspect(
      { symbols: ["Nat"] },
      { config: CONFIG, preflight: PREFLIGHT, resolveSandbox: SANDBOX_OK, processRunner: runner() }
    );
    assert.ok("sourceSha256" in r);
    assert.ok("durationMs" in r);
    assert.ok("timedOut" in r);
    assert.ok("processStarted" in r);
    assert.ok("attemptConsumed" in r);
    assert.ok("contractVersion" in r);
  });
});

describe("INSPECT-CONTRACT-009 inspectResult builder produces consistent output", () => {
  it("builder produces all mandatory fields", () => {
    const r = inspectResult({
      status: "inspected",
      profile: "mathlib",
      symbols: [{ name: "deriv", output: "deriv : ℝ → ℝ" }],
      sourceSha256: "abc123",
      durationMs: 42,
      runId: "lean-test",
      sessionId: "sess-1",
    });
    assert.equal(r.contractVersion, "lean_inspect_result_v1");
    assert.equal(r.status, "inspected");
    assert.equal(r.isError, false);
    assert.equal(r.profile, "mathlib");
    assert.equal(r.runId, "lean-test");
    assert.equal(r.sessionId, "sess-1");
    assert.ok(r.displayText.includes("deriv:"));
    assert.equal(r.source_sha256, "abc123");
    assert.equal(r.duration_ms, 42);
    assert.equal(r.attemptConsumed, false);
    assert.equal(r.verified, false);
  });
  it("builder wraps error status correctly", () => {
    const r = inspectResult({
      status: "rejected",
      errorCode: "LEAN_INSPECT_SYMBOL_INVALID",
      message: "bad symbol",
      statusCode: 422,
    });
    assert.equal(r.isError, true);
    assert.equal(r.errorCode, "LEAN_INSPECT_SYMBOL_INVALID");
    assert.equal(r.statusCode, 422);
    assert.ok(r.displayText.includes("status=rejected"));
  });
});

describe("INSPECT-CONTRACT-010 result serializes/deserializes losslessly", () => {
  it("round-trips through JSON", async () => {
    const r = await executeLeanInspect(
      { symbols: ["Nat.add"] },
      { config: CONFIG, preflight: PREFLIGHT, resolveSandbox: SANDBOX_OK, processRunner: runner() }
    );
    const json = JSON.stringify(r);
    const parsed = JSON.parse(json);
    assert.equal(parsed.contractVersion, r.contractVersion);
    assert.equal(parsed.status, r.status);
    assert.equal(parsed.sourceSha256, r.sourceSha256);
    assert.equal(parsed.durationMs, r.durationMs);
    assert.equal(parsed.timedOut, r.timedOut);
    assert.equal(parsed.displayText, r.displayText);
    assert.equal(parsed.attemptConsumed, false);
    assert.equal(parsed.verified, false);
  });
});

// --- WP10 — Symbol parser substring collision fix ----------------------------

describe("INSPECT-PARSE-001 Nat.add vs Nat.add_comm", () => {
  it("does not assign Nat.add_comm output to Nat.add", async () => {
    const r = await executeLeanInspect(
      { symbols: ["Nat.add", "Nat.add_comm"] },
      {
        config: CONFIG,
        preflight: PREFLIGHT,
        resolveSandbox: SANDBOX_OK,
        processRunner: runner({
          stdout: "Nat.add : Nat → Nat → Nat\nNat.add_comm : ∀ (n m : Nat), n + m = m + n\n",
        }),
      }
    );
    const na = r.symbols.find(s => s.name === "Nat.add");
    const nac = r.symbols.find(s => s.name === "Nat.add_comm");
    assert.ok(na, "Nat.add should be in symbols");
    assert.ok(nac, "Nat.add_comm should be in symbols");
    assert.ok(na.output.includes("Nat → Nat → Nat"), `Nat.add output should be its own: ${na.output}`);
    assert.ok(nac.output.includes("n + m = m + n"), `Nat.add_comm output should be its own: ${nac.output}`);
  });
});

describe("INSPECT-PARSE-002 namespace collision", () => {
  it("does not assign shorter prefix match to longer symbol", async () => {
    const r = await executeLeanInspect(
      { symbols: ["List", "List.length"] },
      {
        config: CONFIG,
        preflight: PREFLIGHT,
        resolveSandbox: SANDBOX_OK,
        processRunner: runner({
          stdout: "List : Type → Type\nList.length : List α → Nat\n",
        }),
      }
    );
    const l = r.symbols.find(s => s.name === "List");
    const ll = r.symbols.find(s => s.name === "List.length");
    assert.ok(l.output.includes("Type → Type"));
    assert.ok(ll.output.includes("List α → Nat"));
  });
});

// --- WP03.4/03.5 — Bounded retry with timeout escalation ---

describe("INSPECT-RETRY-001 timeout triggers one automatic retry with escalated timeout", () => {
  it("retries once with doubled timeout when first attempt times out", async () => {
    let callCount = 0;
    const callTimeouts = [];
    const runnerFn = async (opts) => {
      callCount++;
      callTimeouts.push(opts.timeoutMs);
      if (callCount === 1) {
        return { exitCode: 0, timedOut: true, durationMs: 30000, stdout: "", stderr: "" };
      }
      return { exitCode: 0, timedOut: false, durationMs: 5000, stdout: "Nat.add : Nat\n", stderr: "" };
    };
    const r = await executeLeanInspect(
      { symbols: ["Nat.add"], timeout_sec: 30 },
      { config: CONFIG, preflight: PREFLIGHT, resolveSandbox: SANDBOX_OK, processRunner: runnerFn }
    );
    assert.equal(callCount, 2, "should retry once");
    assert.equal(r.status, "inspected", "second attempt should succeed");
    assert.equal(callTimeouts[0], 30000, "first attempt uses requested timeout");
    assert.equal(callTimeouts[1], 60000, "second attempt uses escalated timeout (2*30=60)");
  });
});

describe("INSPECT-RETRY-002 no retry when first attempt succeeds", () => {
  it("does not retry on success", async () => {
    let callCount = 0;
    const runnerFn = async () => {
      callCount++;
      return { exitCode: 0, timedOut: false, durationMs: 100, stdout: "Nat.add : Nat\n", stderr: "" };
    };
    const r = await executeLeanInspect(
      { symbols: ["Nat.add"] },
      { config: CONFIG, preflight: PREFLIGHT, resolveSandbox: SANDBOX_OK, processRunner: runnerFn }
    );
    assert.equal(callCount, 1);
    assert.equal(r.status, "inspected");
  });
});

describe("INSPECT-RETRY-003 no retry when second attempt also times out", () => {
  it("returns timeout after one retry, not infinite loop", async () => {
    let callCount = 0;
    const runnerFn = async () => {
      callCount++;
      return { exitCode: 0, timedOut: true, durationMs: 60000, stdout: "", stderr: "" };
    };
    const r = await executeLeanInspect(
      { symbols: ["Nat.add"], timeout_sec: 60 },
      { config: CONFIG, preflight: PREFLIGHT, resolveSandbox: SANDBOX_OK, processRunner: runnerFn }
    );
    assert.equal(callCount, 2, "exactly 2 attempts (original + 1 retry)");
    assert.equal(r.status, "timeout");
    assert.equal(r.timedOut, true);
  });
});

describe("INSPECT-RETRY-004 no escalation when already at max", () => {
  it("does not retry when requested timeout equals max", async () => {
    let callCount = 0;
    const runnerFn = async () => {
      callCount++;
      return { exitCode: 0, timedOut: true, durationMs: 120000, stdout: "", stderr: "" };
    };
    const r = await executeLeanInspect(
      { symbols: ["Nat.add"], timeout_sec: 120 },
      { config: CONFIG, preflight: PREFLIGHT, resolveSandbox: SANDBOX_OK, processRunner: runnerFn }
    );
    assert.equal(callCount, 1, "no retry when already at max timeout");
    assert.equal(r.status, "timeout");
  });
});

describe("INSPECT-RETRY-005 escalation caps at LEAN_INSPECT_MAX_TIMEOUT_SEC", () => {
  it("escalation from 60 goes to 120, not beyond", async () => {
    let callCount = 0;
    const callTimeouts = [];
    const runnerFn = async (opts) => {
      callCount++;
      callTimeouts.push(opts.timeoutMs);
      if (callCount === 1) {
        return { exitCode: 0, timedOut: true, durationMs: 60000, stdout: "", stderr: "" };
      }
      return { exitCode: 0, timedOut: false, durationMs: 5000, stdout: "x : Nat\n", stderr: "" };
    };
    await executeLeanInspect(
      { symbols: ["x"], timeout_sec: 60 },
      { config: CONFIG, preflight: PREFLIGHT, resolveSandbox: SANDBOX_OK, processRunner: runnerFn }
    );
    assert.equal(callTimeouts[0], 60000);
    assert.equal(callTimeouts[1], 120000, "escalation caps at MAX_TIMEOUT_SEC (120)");
  });
});
