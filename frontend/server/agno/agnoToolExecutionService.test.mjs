import assert from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgnoToolExecutionService,
  AgnoToolExecutionError,
  combineSignals,
  sanitizeToolRaw
} from "./agnoToolExecutionService.mjs";
import { AgnoToolPolicyError } from "./agnoToolPolicy.mjs";
import { AgnoExecutionGuardError } from "./agnoExecutionGuard.mjs";
import { AgnoToolAudit, digestArgs } from "./agnoToolAudit.mjs";
import { ToolArgumentValidationError } from "../agentToolSchema.mjs";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makePolicy({ deny = new Set(), metadataByTool = {} } = {}) {
  return {
    assertAllowed(name) {
      if (deny.has(name)) {
        throw new AgnoToolPolicyError("TOOL_NOT_ALLOWED", `Tool is not allowed: ${name}`, 403);
      }
      return metadataByTool[name] || { class: "test", mutating: false, maxTimeoutMs: 5_000 };
    }
  };
}

function makeGate({ failAcquire } = {}) {
  const state = { acquireCalls: 0, releaseCalls: 0 };
  return {
    state,
    async acquire() {
      state.acquireCalls++;
      if (failAcquire) throw failAcquire;
      return { release: () => { state.releaseCalls++; } };
    }
  };
}

function makeExecutionGuard({ blockError } = {}) {
  const state = { calls: 0 };
  return {
    state,
    async ensureModelCallAllowed() {
      state.calls++;
      if (blockError) throw blockError;
    }
  };
}

function makeSessionRegistry() {
  const sessions = new Map();
  return {
    sessions,
    getOrCreate(context) {
      const key = `${context.sessionId}:${context.runId}`;
      let record = sessions.get(key);
      if (!record) {
        record = {
          sessionId: context.sessionId,
          runId: context.runId,
          controller: new AbortController(),
          history: [],
          gitnexusPolicyState: null,
          activeToolCalls: new Set()
        };
        sessions.set(key, record);
      }
      return record;
    }
  };
}

function makeAudit() {
  const records = [];
  return { records, async write(record) { records.push(record); } };
}

function makeService(overrides = {}) {
  return new AgnoToolExecutionService({
    policy: overrides.policy || makePolicy(),
    gate: overrides.gate || makeGate(),
    sessionRegistry: overrides.sessionRegistry || makeSessionRegistry(),
    executionGuard: overrides.executionGuard || makeExecutionGuard(),
    workspaceRoot: overrides.workspaceRoot || "/workspace",
    toolBlobStore: overrides.toolBlobStore ?? null,
    sageCallLog: overrides.sageCallLog ?? null,
    researchService: overrides.researchService ?? null,
    crawlBaseUrl: overrides.crawlBaseUrl ?? null,
    crawlToken: overrides.crawlToken ?? null,
    audit: overrides.audit || makeAudit(),
    executeToolImpl: overrides.executeToolImpl || (async () => ({ content: "ok", isError: false })),
    compressImpl: overrides.compressImpl || (async (_name, result) => ({ ...result, compressed: false }))
  });
}

function baseRequest(overrides = {}) {
  return {
    toolName: "read",
    arguments: { path: "a.txt" },
    callId: "call-1",
    context: { sessionId: "s1", runId: "r1" },
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// execute() — validation / gating order
// ---------------------------------------------------------------------------

describe("AgnoToolExecutionService.execute — validation and gating", () => {
  it("1. unknown tool -> throws AgnoToolExecutionError UNKNOWN_TOOL / 404", async () => {
    const service = makeService();
    await assert.rejects(
      () => service.execute(baseRequest({ toolName: "not_a_real_tool", arguments: {} })),
      (err) => {
        assert.ok(err instanceof AgnoToolExecutionError);
        assert.equal(err.code, "UNKNOWN_TOOL");
        assert.equal(err.status, 404);
        return true;
      }
    );
  });

  it("2. policy-denied tool -> propagates AgnoToolPolicyError as-is", async () => {
    const policy = makePolicy({ deny: new Set(["read"]) });
    const service = makeService({ policy });
    await assert.rejects(
      () => service.execute(baseRequest()),
      (err) => {
        assert.ok(err instanceof AgnoToolPolicyError);
        assert.equal(err.code, "TOOL_NOT_ALLOWED");
        return true;
      }
    );
  });

  it("3. invalid arguments -> propagates ToolArgumentValidationError", async () => {
    const service = makeService();
    await assert.rejects(
      () => service.execute(baseRequest({ arguments: {} })), // 'read' requires 'path'
      (err) => {
        assert.ok(err instanceof ToolArgumentValidationError);
        assert.equal(err.code, "INVALID_TOOL_ARGUMENTS");
        return true;
      }
    );
  });

  it("4. execution-guard block short-circuits before the gate or the tool ever runs", async () => {
    const guardError = new AgnoExecutionGuardError("NATIVE_AGENT_ACTIVE", "native agent active", 409);
    const executionGuard = makeExecutionGuard({ blockError: guardError });
    const gate = makeGate();
    let executeCalls = 0;
    const service = makeService({
      executionGuard,
      gate,
      executeToolImpl: async () => { executeCalls++; return { content: "x", isError: false }; }
    });

    await assert.rejects(() => service.execute(baseRequest()), (err) => err === guardError);
    assert.equal(gate.state.acquireCalls, 0);
    assert.equal(executeCalls, 0);
  });
});

// ---------------------------------------------------------------------------
// preflightPolicy — bash read-bypass guard
// ---------------------------------------------------------------------------

describe("AgnoToolExecutionService.execute — bash read-bypass guard", () => {
  it("5. blocks a bash cat-dump command with the §15.4 guarded/isError shape, never calling executeToolImpl", async () => {
    let executeCalls = 0;
    const service = makeService({
      executeToolImpl: async () => { executeCalls++; return { content: "x", isError: false }; }
    });

    const result = await service.execute(baseRequest({
      toolName: "bash",
      arguments: { command: "cat /etc/hosts" }
    }));

    assert.equal(result.isError, true);
    assert.equal(result.guarded, true);
    assert.equal(result.code, "BASH_FILE_READ_BYPASS_BLOCKED");
    assert.match(result.content, /Bash guard/);
    assert.equal(executeCalls, 0);
  });

  it("blocked call returns the full §15.6 envelope, not the bare guard shape", async () => {
    const service = makeService();
    const result = await service.execute(baseRequest({
      toolName: "bash",
      arguments: { command: "cat /etc/hosts" }
    }));
    assert.deepEqual(
      Object.keys(result).sort(),
      ["code", "compressed", "content", "durationMs", "guarded", "isError", "ok", "raw", "toolName"]
    );
    assert.equal(result.ok, false);
    assert.equal(result.toolName, "bash");
    assert.equal(result.compressed, false);
    assert.equal(result.raw, null);
    assert.equal(typeof result.durationMs, "number");
  });

  it("blocked call still writes an audit record ('tool_blocked')", async () => {
    const audit = makeAudit();
    const service = makeService({ audit });
    await service.execute(baseRequest({
      toolName: "bash",
      arguments: { command: "cat /etc/hosts" }
    }));
    assert.equal(audit.records.length, 1);
    const record = audit.records[0];
    assert.equal(record.type, "tool_blocked");
    assert.equal(record.toolName, "bash");
    assert.equal(record.isError, true);
    assert.equal(record.guarded, true);
    assert.equal(record.code, "BASH_FILE_READ_BYPASS_BLOCKED");
    assert.equal(typeof record.durationMs, "number");
  });

  it("does not block a safe bash command", async () => {
    let executeCalls = 0;
    const service = makeService({
      executeToolImpl: async () => { executeCalls++; return { content: "ok output", isError: false }; }
    });

    const result = await service.execute(baseRequest({
      toolName: "bash",
      arguments: { command: "echo hello" }
    }));

    assert.equal(result.code, null);
    assert.equal(executeCalls, 1);
  });
});

// ---------------------------------------------------------------------------
// preflightPolicy — GitNexus post-analyze guard
// ---------------------------------------------------------------------------

describe("AgnoToolExecutionService.execute — GitNexus post-analyze guard", () => {
  it("6. allows a would-be-bad action before gitnexus analyze has been seen, then blocks the same action after", async () => {
    const sessionRegistry = makeSessionRegistry();
    let executeCalls = 0;
    const executeToolImpl = async (_name, args) => {
      executeCalls++;
      if (args.command === "gitnexus analyze") {
        return {
          content: "Repository indexed successfully. 17015 nodes, 29380 edges, 300 flows.",
          isError: false
        };
      }
      return { content: `output for: ${args.command}`, isError: false };
    };
    const service = makeService({ sessionRegistry, executeToolImpl });

    // Before gitnexusAnalyzeSeen: 'ls -R' would be "bad" once seen, but must pass now.
    const before = await service.execute(baseRequest({
      toolName: "bash",
      arguments: { command: "ls -R" },
      callId: "before"
    }));
    assert.equal(before.isError, false);
    assert.equal(before.code, null);
    assert.equal(executeCalls, 1);

    // Run the actual analyze call, which flips gitnexusAnalyzeSeen -> true.
    await service.execute(baseRequest({
      toolName: "bash",
      arguments: { command: "gitnexus analyze" },
      callId: "analyze"
    }));
    assert.equal(executeCalls, 2);

    // Now the same 'ls -R' action must be blocked before executeToolImpl runs again.
    const after = await service.execute(baseRequest({
      toolName: "bash",
      arguments: { command: "ls -R" },
      callId: "after"
    }));
    assert.equal(after.isError, true);
    assert.equal(after.guarded, true);
    assert.equal(after.code, "STOP_POST_GITNEXUS_DUMP");
    assert.match(after.content, /STOP_POST_GITNEXUS_DUMP/);
    assert.equal(executeCalls, 2); // unchanged: blocked before executeToolImpl
  });
});

// ---------------------------------------------------------------------------
// normalizeResult — compression
// ---------------------------------------------------------------------------

describe("AgnoToolExecutionService.normalizeResult — compression", () => {
  it("7a. compresses a non-error result for a compressible tool", async () => {
    let compressCalls = 0;
    const service = makeService({
      compressImpl: async (_name, result) => { compressCalls++; return { ...result, content: "compressed!", compressed: true }; }
    });
    const result = await service.normalizeResult("bash", { content: "huge output", isError: false });
    assert.equal(compressCalls, 1);
    assert.equal(result.compressed, true);
    assert.equal(result.content, "compressed!");
  });

  it("7b. does not compress a non-compressible tool (e.g. write)", async () => {
    let compressCalls = 0;
    const service = makeService({
      compressImpl: async (_name, result) => { compressCalls++; return { ...result, compressed: true }; }
    });
    const result = await service.normalizeResult("write", { content: "wrote file", isError: false });
    assert.equal(compressCalls, 0);
    assert.equal(result.compressed, false);
    assert.equal(result.content, "wrote file");
  });

  it("7c. does not compress an error result even for a compressible tool", async () => {
    let compressCalls = 0;
    const service = makeService({
      compressImpl: async (_name, result) => { compressCalls++; return { ...result, compressed: true }; }
    });
    const result = await service.normalizeResult("bash", { content: "boom", isError: true });
    assert.equal(compressCalls, 0);
    assert.equal(result.isError, true);
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeToolRaw — redaction categories
// ---------------------------------------------------------------------------

describe("sanitizeToolRaw", () => {
  it("passes through null/undefined unchanged", () => {
    assert.equal(sanitizeToolRaw(null), null);
    assert.equal(sanitizeToolRaw(undefined), undefined);
  });

  it("redacts token/secret/password/apikey/credential-looking keys (does not recurse into them)", () => {
    const out = sanitizeToolRaw({
      apiToken: "sk-live-secret",
      dbPassword: "hunter2",
      apiKey: { nested: "still leaks if not redacted" },
      credential: "x",
      normal: "kept"
    });
    assert.equal(out.apiToken, "[redacted]");
    assert.equal(out.dbPassword, "[redacted]");
    assert.equal(out.apiKey, "[redacted]");
    assert.equal(out.credential, "[redacted]");
    assert.equal(out.normal, "kept");
  });

  it("drops keys named exactly env or environment", () => {
    const out = sanitizeToolRaw({ env: { SECRET: "x" }, environment: { A: "b" }, keep: 1 });
    assert.equal(out.env, undefined);
    assert.equal(out.environment, undefined);
    assert.equal(out.keep, 1);
  });

  it("drops Buffer values", () => {
    const out = sanitizeToolRaw({ blob: Buffer.from("hello") });
    assert.equal(out.blob, undefined);
  });

  it("drops Error values (which carry .stack)", () => {
    const out = sanitizeToolRaw({ err: new Error("boom") });
    assert.equal(out.err, undefined);
  });

  it("drops AbortController and AbortSignal values", () => {
    const controller = new AbortController();
    const out = sanitizeToolRaw({ controller, signal: controller.signal });
    assert.equal(out.controller, undefined);
    assert.equal(out.signal, undefined);
  });

  it("drops function values (e.g. child-process-like methods)", () => {
    const out = sanitizeToolRaw({ kill: () => {}, pid: 1234 });
    assert.equal(out.kill, undefined);
    assert.equal(out.pid, 1234);
  });

  it("caps huge arrays/manifests at the fan-out limit with a truncation marker", () => {
    const big = Array.from({ length: 80 }, (_, i) => i);
    const out = sanitizeToolRaw(big);
    assert.equal(out.length, 51); // 50 kept + 1 marker
    assert.match(out[50], /truncated/);
  });

  it("caps huge objects' key count with a truncation marker", () => {
    const big = {};
    for (let i = 0; i < 80; i++) big[`k${i}`] = i;
    const out = sanitizeToolRaw(big);
    assert.equal(Object.keys(out).length, 51); // 50 kept + __truncated marker
    assert.match(out.__truncated, /truncated/);
  });

  it("caps recursion depth", () => {
    let deep = { value: "bottom" };
    for (let i = 0; i < 10; i++) deep = { nested: deep };
    const out = sanitizeToolRaw(deep);
    // walk down until we hit the truncation marker
    let cursor = out;
    let steps = 0;
    while (cursor && typeof cursor === "object" && "nested" in cursor && steps < 10) {
      cursor = cursor.nested;
      steps++;
    }
    assert.match(String(cursor), /truncated/);
  });

  it("truncates very long strings", () => {
    const out = sanitizeToolRaw("x".repeat(5000));
    assert.ok(out.length < 5000);
    assert.match(out, /truncated/);
  });
});

// ---------------------------------------------------------------------------
// buildOptions
// ---------------------------------------------------------------------------

describe("AgnoToolExecutionService.buildOptions", () => {
  it("includes crawl-specific fields for 'crawl'", () => {
    const service = makeService({ crawlBaseUrl: "http://x", crawlToken: "tok" });
    const session = { sessionId: "s1", runId: "r1", history: [] };
    const opts = service.buildOptions({ toolName: "crawl", args: {}, session, signal: undefined });
    assert.equal(opts.cwd, "/workspace");
    assert.equal(opts.sessionKey, "s1");
    assert.equal(opts.crawlBaseUrl, "http://x");
    assert.equal(opts.crawlToken, "tok");
  });

  it("includes researchService for 'research_discover'", () => {
    const researchService = { gather: () => {} };
    const service = makeService({ researchService });
    const session = { sessionId: "s1", runId: "r1", history: [] };
    const opts = service.buildOptions({ toolName: "research_discover", args: {}, session, signal: undefined });
    assert.equal(opts.researchService, researchService);
  });

  it("includes toolBlobStore for 'retrieve_context_blob'", () => {
    const toolBlobStore = { get: () => {} };
    const service = makeService({ toolBlobStore });
    const session = { sessionId: "s1", runId: "r1", history: [] };
    const opts = service.buildOptions({ toolName: "retrieve_context_blob", args: {}, session, signal: undefined });
    assert.equal(opts.toolBlobStore, toolBlobStore);
  });

  it("includes sage-specific options (sageWorkdir/runId/sageAttempt) for 'sage'", () => {
    const service = makeService({ workspaceRoot: "/ws", sageCallLog: "log-ref" });
    const session = { sessionId: "sess1", runId: "run1", history: [] };
    const opts = service.buildOptions({ toolName: "sage", args: {}, session, signal: undefined });
    assert.equal(opts.sageCallLog, "log-ref");
    assert.equal(opts.runId, "run1");
    assert.equal(opts.sageAttempt, 1);
    assert.ok(opts.sageWorkdir.endsWith(path.join("sage_sess1")));
  });

  it("returns just the base fields for a tool with no special-case options", () => {
    const service = makeService();
    const session = { sessionId: "s1", runId: "r1", history: [{ role: "user", content: "hi" }] };
    const opts = service.buildOptions({ toolName: "read", args: {}, session, signal: undefined });
    assert.deepEqual(Object.keys(opts).sort(), ["cwd", "history", "sessionKey", "signal"]);
    assert.deepEqual(opts.history, [{ role: "user", content: "hi" }]);
  });
});

// ---------------------------------------------------------------------------
// combineSignals
// ---------------------------------------------------------------------------

describe("combineSignals", () => {
  it("returns undefined for an empty/all-falsy list", () => {
    assert.equal(combineSignals([]), undefined);
    assert.equal(combineSignals([undefined, null]), undefined);
  });

  it("returns the single defined signal unchanged", () => {
    const signal = new AbortController().signal;
    assert.equal(combineSignals([undefined, signal]), signal);
  });

  it("combines multiple signals; aborting any one aborts the combined signal", () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineSignals([a.signal, b.signal]);
    assert.equal(combined.aborted, false);
    a.abort();
    assert.equal(combined.aborted, true);
  });
});

// ---------------------------------------------------------------------------
// resource cleanup: gate lease + activeToolCalls always released
// ---------------------------------------------------------------------------

describe("AgnoToolExecutionService.execute — cleanup guarantees", () => {
  it("10. releases the gate lease even when executeToolImpl throws", async () => {
    const gate = makeGate();
    const service = makeService({
      gate,
      executeToolImpl: async () => { throw new Error("boom"); }
    });
    await assert.rejects(() => service.execute(baseRequest()));
    assert.equal(gate.state.acquireCalls, 1);
    assert.equal(gate.state.releaseCalls, 1);
  });

  it("11. always removes the callId from session.activeToolCalls, on success and on failure", async () => {
    const sessionRegistry = makeSessionRegistry();
    const okService = makeService({ sessionRegistry });
    await okService.execute(baseRequest({ callId: "ok-call" }));
    const session = sessionRegistry.getOrCreate({ sessionId: "s1", runId: "r1" });
    assert.equal(session.activeToolCalls.has("ok-call"), false);

    const failingService = makeService({
      sessionRegistry,
      executeToolImpl: async () => { throw new Error("boom"); }
    });
    await assert.rejects(() => failingService.execute(baseRequest({ callId: "fail-call" })));
    assert.equal(session.activeToolCalls.has("fail-call"), false);
  });
});

// ---------------------------------------------------------------------------
// audit — record shape and the digest-only guarantee (end-to-end with the
// real AgnoToolAudit writer, to prove execute() never leaks raw args to disk)
// ---------------------------------------------------------------------------

describe("AgnoToolExecutionService.execute — audit trail", () => {
  it("9a. calls audit.write with a successful call's shape", async () => {
    const audit = makeAudit();
    const service = makeService({ audit });
    await service.execute(baseRequest());
    assert.equal(audit.records.length, 1);
    const record = audit.records[0];
    assert.equal(record.toolName, "read");
    assert.equal(record.sessionId, "s1");
    assert.equal(record.runId, "r1");
    assert.deepEqual(record.args, { path: "a.txt" });
    assert.equal(record.isError, false);
    assert.equal(typeof record.durationMs, "number");
  });

  it("9b. end-to-end: the persisted JSONL record contains argumentDigest only, never raw args", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agno-exec-audit-"));
    try {
      const audit = new AgnoToolAudit({ auditDir: tmp });
      const service = makeService({ audit });
      const args = { path: "very/secret/path.txt" };
      await service.execute(baseRequest({ arguments: args }));

      const today = new Date().toISOString().slice(0, 10);
      const text = await fs.readFile(path.join(tmp, `${today}.jsonl`), "utf8");
      const record = JSON.parse(text.trim());

      assert.equal(record.args, undefined);
      assert.equal(record.arguments, undefined);
      assert.equal(record.argumentDigest, digestArgs(args));
      assert.equal(record.toolName, "read");
      assert.equal(record.isError, false);
      assert.equal(typeof record.contentBytes, "number");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("9c. an audit.write() throw does not affect a successful call's returned result", async () => {
    const audit = { records: [], async write() { throw new Error("disk full"); } };
    const service = makeService({ audit });
    const result = await service.execute(baseRequest());
    assert.equal(result.ok, true);
    assert.equal(result.isError, false);
    assert.equal(result.content, "ok");
  });
});
