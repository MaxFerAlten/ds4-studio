import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";

// Minimal mock of sageSessionDir
function mockSageSessionDir(base, sessionId) {
  // sanitize: replace non-alphanumeric chars, default empty to "default"
  const sanitized = String(sessionId || "")
    .replace(/[^a-zA-Z0-9_\-.]/g, "_")
    .slice(0, 128) || "default";
  return `${base}/sage_${sanitized}`;
}

function mockSageRunDir(base, runId) {
  const sanitized = String(runId || "").replace(/[^a-zA-Z0-9_-]/g, "_") || "invalid-run";
  return `${base}/sage_runs/${sanitized}`;
}

// Build the route handler in isolation so we can inject the common gateway.
function buildHandler(mockExecuteTool, activePolicyRevision = "a".repeat(40)) {
  return async (req, res) => {
    res.setHeader("X-DS4-Sage-Contract", "sage_result_v2");
    const {
      code,
      timeout_sec,
      sessionId,
      runId: requestedRunId,
      run_id,
      task_type,
      phase,
      output_mode,
      attempt,
      policyRevision: requestedPolicyRevision
    } = req.body || {};
    if (!code || typeof code !== "string" || !code.trim()) {
      res.status(400).json({ error: "code is required" });
      return;
    }
    const runId = String(requestedRunId || run_id || "generated-run");
    if (requestedPolicyRevision && requestedPolicyRevision !== activePolicyRevision) {
      res.status(409).json({
        content: "SAGE_POLICY_REVISION_MISMATCH",
        isError: true,
        contractVersion: "sage_result_v2",
        publishable: false,
        authoritative: false,
        validationPassed: false,
        reportReady: false,
        finalMarkdown: "",
        runId,
        state: "failed"
      });
      return;
    }

    const args = {
      code,
      timeout_sec: Number(timeout_sec) || 60,
      task_type,
      phase,
      output_mode
    };
    const opts = {
      sageCallLog: null, // not needed for endpoint test
      sessionKey: sessionId || undefined,
      sageAttempt: Number(attempt) || 1,
      runId,
      phase,
      policyRevision: requestedPolicyRevision || activePolicyRevision,
      sageWorkdir: mockSageRunDir("/tmp/ws", runId)
    };

    const result = await mockExecuteTool("sage", args, opts);
    res.json(result);
  };
}

// Helper: start a temporary HTTP server, call it, close it.
async function withServer(handler, body) {
  const app = express();
  app.use(express.json());
  app.post("/api/sage/exec", handler);

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const fetchOpts = {
      method: "POST"
    };
    if (body !== undefined) {
      fetchOpts.body = JSON.stringify(body);
      fetchOpts.headers = { "Content-Type": "application/json" };
    }
    const res = await fetch(`http://127.0.0.1:${port}/api/sage/exec`, fetchOpts);
    const json = await res.json().catch(() => null);
    return {
      status: res.status,
      json,
      contract: res.headers.get("x-ds4-sage-contract")
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("POST /api/sage/exec returns 400 when body is empty (no body sent)", async () => {
  const handler = buildHandler(async () => ({ content: "ok", isError: false }));
  const { status, json } = await withServer(handler, undefined);
  assert.equal(status, 400);
  assert.equal(json.error, "code is required");
});

test("POST /api/sage/exec returns 400 when code is missing", async () => {
  const handler = buildHandler(async () => ({ content: "ok", isError: false }));
  const { status, json } = await withServer(handler, {});
  assert.equal(status, 400);
  assert.equal(json.error, "code is required");
});

test("POST /api/sage/exec returns 400 when code is empty string", async () => {
  const handler = buildHandler(async () => ({ content: "ok", isError: false }));
  const { status, json } = await withServer(handler, { code: "  " });
  assert.equal(status, 400);
  assert.equal(json.error, "code is required");
});

test("POST /api/sage/exec returns 200 with content on success", async () => {
  const mockExecuteTool = async () => ({
    content: "LaTeX: 8\nResult: 8",
    isError: false,
    latexOutput: "8",
    raw: { exit_code: 0, killed: false, stdout_bytes: 20, stderr_bytes: 0 }
  });

  const handler = buildHandler(mockExecuteTool);
  const { status, json } = await withServer(handler, { code: "2^3" });

  assert.equal(status, 200);
  assert.equal(json.isError, false);
  assert.match(json.content, /LaTeX:/);
  assert.equal(json.latexOutput, "8");
  assert.equal(json.raw.exit_code, 0);
});

test("POST /api/sage/exec passes timeout_sec to args", async () => {
  const captured = [];
  const mockExecuteTool = async (name, args, opts) => {
    assert.equal(name, "sage");
    captured.push({ args, opts });
    return { content: "ok", isError: false };
  };

  const handler = buildHandler(mockExecuteTool);
  const { status } = await withServer(handler, { code: "1+1", timeout_sec: 30 });

  assert.equal(status, 200);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].args.code, "1+1");
  assert.equal(captured[0].args.timeout_sec, 30);
});

test("POST /api/sage/exec defaults timeout_sec to 60 when omitted", async () => {
  const captured = [];
  const mockExecuteTool = async (name, args, opts) => {
    assert.equal(name, "sage");
    captured.push({ args, opts });
    return { content: "ok", isError: false };
  };

  const handler = buildHandler(mockExecuteTool);
  const { status } = await withServer(handler, { code: "1+1" });

  assert.equal(status, 200);
  assert.equal(captured[0].args.timeout_sec, 60);
});

test("POST /api/sage/exec forwards optional Sage workflow metadata", async () => {
  const captured = [];
  const mockExecuteTool = async (name, args, opts) => {
    assert.equal(name, "sage");
    captured.push({ args, opts });
    return { content: "ok", isError: false };
  };

  const handler = buildHandler(mockExecuteTool);
  const { status } = await withServer(handler, {
    code: "1+1",
    sessionId: "sess-meta",
    task_type: "validation",
    phase: "validate",
    output_mode: "structured",
    attempt: 2
  });

  assert.equal(status, 200);
  assert.equal(captured[0].args.task_type, "validation");
  assert.equal(captured[0].args.phase, "validate");
  assert.equal(captured[0].args.output_mode, "structured");
  assert.equal(captured[0].opts.sessionKey, "sess-meta");
  assert.equal(captured[0].opts.sageAttempt, 2);
  assert.equal(captured[0].opts.phase, "validate");
  assert.equal(captured[0].opts.runId, "generated-run");
});

test("POST /api/sage/exec rejects a native policy revision mismatch", async () => {
  let called = false;
  const handler = buildHandler(async () => {
    called = true;
    return { content: "unexpected", isError: false };
  }, "a".repeat(40));
  const { status, json } = await withServer(handler, {
    code: "1+1",
    runId: "native-run",
    policyRevision: "b".repeat(40)
  });
  assert.equal(status, 409);
  assert.equal(json.content, "SAGE_POLICY_REVISION_MISMATCH");
  assert.equal(json.runId, "native-run");
  assert.equal(called, false);
});

test("POST /api/sage/exec keeps legacy requests valid but non-publishable", async () => {
  const captured = [];
  const handler = buildHandler(async (name, args, opts) => {
    assert.equal(name, "sage");
    captured.push({ args, opts });
    return { content: "2", isError: false, publishable: false };
  });

  const { status, contract, json } = await withServer(handler, { code: "1+1" });
  assert.equal(status, 200);
  assert.equal(contract, "sage_result_v2");
  assert.equal(json.publishable, false);
  assert.equal(captured[0].args.task_type, undefined);
  assert.equal(captured[0].args.phase, undefined);
  assert.equal(captured[0].args.output_mode, undefined);
  assert.equal(captured[0].opts.sageAttempt, 1);
});

test("POST /api/sage/exec returns sageResult without changing legacy fields", async () => {
  const handler = buildHandler(async () => ({
    content: "validated",
    isError: false,
    sageResult: {
      contractVersion: "sage_result_v2",
      tool: "sage",
      status: "ok"
    }
  }));

  const { status, json } = await withServer(handler, { code: "1+1" });
  assert.equal(status, 200);
  assert.equal(json.content, "validated");
  assert.equal(json.isError, false);
  assert.equal(json.sageResult.contractVersion, "sage_result_v2");
});

test("POST /api/sage/exec constructs an immutable per-run sageWorkdir", async () => {
  const captured = [];
  const mockExecuteTool = async (name, args, opts) => {
    assert.equal(name, "sage");
    captured.push({ args, opts });
    return { content: "ok", isError: false };
  };

  const handler = buildHandler(mockExecuteTool);
  const { status } = await withServer(handler, {
    code: "1+1",
    sessionId: "sess1",
    runId: "run-123"
  });

  assert.equal(status, 200);
  assert(captured[0].opts.sageWorkdir.endsWith("/sage_runs/run-123"));
  assert.equal(captured[0].opts.runId, "run-123");
});

test("POST /api/sage/exec allocates a run even when sessionId is omitted", async () => {
  const captured = [];
  const mockExecuteTool = async (name, args, opts) => {
    assert.equal(name, "sage");
    captured.push({ args, opts });
    return { content: "ok", isError: false };
  };

  const handler = buildHandler(mockExecuteTool);
  const { status } = await withServer(handler, { code: "1+1" });

  assert.equal(status, 200);
  assert(captured[0].opts.sageWorkdir.endsWith("/sage_runs/generated-run"));
  assert.equal(captured[0].opts.runId, "generated-run");
});

test("POST /api/sage/exec returns isError true on tool failure", async () => {
  const mockExecuteTool = async () => ({
    content: "sage error: something went wrong",
    isError: true,
    latexOutput: null,
    raw: { exit_code: 1, killed: false, stdout_bytes: 0, stderr_bytes: 42 }
  });

  const handler = buildHandler(mockExecuteTool);
  const { status, json } = await withServer(handler, { code: "bad_code" });

  assert.equal(status, 200);
  assert.equal(json.isError, true);
  assert.equal(json.raw.exit_code, 1);
});
