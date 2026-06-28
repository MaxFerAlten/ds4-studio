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

// Build the route handler in isolation so we can inject a mock toolSage.
function buildHandler(mockToolSage) {
  return async (req, res) => {
    const { code, timeout_sec, sessionId } = req.body || {};
    if (!code || typeof code !== "string" || !code.trim()) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    const args = {
      code,
      timeout_sec: Number(timeout_sec) || 60
    };
    const opts = {
      sageCallLog: null, // not needed for endpoint test
      sageWorkdir: sessionId
        ? mockSageSessionDir("/tmp/ws", sessionId)
        : undefined
    };

    const result = await mockToolSage(args, opts);
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
    return { status: res.status, json };
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
  const mockToolSage = async (args, opts) => ({
    content: "LaTeX: 8\nResult: 8",
    isError: false,
    latexOutput: "8",
    raw: { exit_code: 0, killed: false, stdout_bytes: 20, stderr_bytes: 0 }
  });

  const handler = buildHandler(mockToolSage);
  const { status, json } = await withServer(handler, { code: "2^3" });

  assert.equal(status, 200);
  assert.equal(json.isError, false);
  assert.match(json.content, /LaTeX:/);
  assert.equal(json.latexOutput, "8");
  assert.equal(json.raw.exit_code, 0);
});

test("POST /api/sage/exec passes timeout_sec to args", async () => {
  const captured = [];
  const mockToolSage = async (args, opts) => {
    captured.push({ args, opts });
    return { content: "ok", isError: false };
  };

  const handler = buildHandler(mockToolSage);
  const { status } = await withServer(handler, { code: "1+1", timeout_sec: 30 });

  assert.equal(status, 200);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].args.code, "1+1");
  assert.equal(captured[0].args.timeout_sec, 30);
});

test("POST /api/sage/exec defaults timeout_sec to 60 when omitted", async () => {
  const captured = [];
  const mockToolSage = async (args, opts) => {
    captured.push({ args, opts });
    return { content: "ok", isError: false };
  };

  const handler = buildHandler(mockToolSage);
  const { status } = await withServer(handler, { code: "1+1" });

  assert.equal(status, 200);
  assert.equal(captured[0].args.timeout_sec, 60);
});

test("POST /api/sage/exec constructs sageWorkdir when sessionId is given", async () => {
  const captured = [];
  const mockToolSage = async (args, opts) => {
    captured.push({ args, opts });
    return { content: "ok", isError: false };
  };

  const handler = buildHandler(mockToolSage);
  const { status } = await withServer(handler, { code: "1+1", sessionId: "sess1" });

  assert.equal(status, 200);
  assert(captured[0].opts.sageWorkdir.endsWith("/sage_sess1"));
});

test("POST /api/sage/exec does not set sageWorkdir when sessionId is omitted", async () => {
  const captured = [];
  const mockToolSage = async (args, opts) => {
    captured.push({ args, opts });
    return { content: "ok", isError: false };
  };

  const handler = buildHandler(mockToolSage);
  const { status } = await withServer(handler, { code: "1+1" });

  assert.equal(status, 200);
  assert.equal(captured[0].opts.sageWorkdir, undefined);
});

test("POST /api/sage/exec returns isError true on tool failure", async () => {
  const mockToolSage = async () => ({
    content: "sage error: something went wrong",
    isError: true,
    latexOutput: null,
    raw: { exit_code: 1, killed: false, stdout_bytes: 0, stderr_bytes: 42 }
  });

  const handler = buildHandler(mockToolSage);
  const { status, json } = await withServer(handler, { code: "bad_code" });

  assert.equal(status, 200);
  assert.equal(json.isError, true);
  assert.equal(json.raw.exit_code, 1);
});
