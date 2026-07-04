import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";

const VALID_TOOLS = ["page_snapshot", "page_action"];

function buildHandler(mockExecuteTool) {
  return async (req, res) => {
    const { name, arguments: args, sessionId } = req.body || {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ content: "Tool error: name is required", isError: true });
      return;
    }
    if (!args || typeof args !== "object") {
      res.status(400).json({ content: "Tool error: arguments is required", isError: true });
      return;
    }
    if (!VALID_TOOLS.includes(name)) {
      res.status(400).json({ content: `Tool error: unknown page tool: ${name}`, isError: true });
      return;
    }

    const opts = { sessionId: sessionId || undefined };
    const result = await mockExecuteTool(name, args, opts);
    res.json(result);
  };
}

async function withServer(handler, body, route = "/api/pageagent/tool") {
  const app = express();
  app.use(express.json());
  app.post(route, handler);

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
    const res = await fetch(`http://127.0.0.1:${port}${route}`, fetchOpts);
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("POST /api/pageagent/tool returns 400 when body is empty", async () => {
  const handler = buildHandler(async () => ({ content: "ok", isError: false }));
  const { status, json } = await withServer(handler, undefined);
  assert.equal(status, 400);
  assert.equal(json.isError, true);
});

test("POST /api/pageagent/tool returns 400 when name is missing", async () => {
  const handler = buildHandler(async () => ({ content: "ok", isError: false }));
  const { status, json } = await withServer(handler, { arguments: {} });
  assert.equal(status, 400);
  assert.equal(json.isError, true);
});

test("POST /api/pageagent/tool returns 400 when arguments is missing", async () => {
  const handler = buildHandler(async () => ({ content: "ok", isError: false }));
  const { status, json } = await withServer(handler, { name: "page_snapshot" });
  assert.equal(status, 400);
  assert.equal(json.isError, true);
});

test("POST /api/pageagent/tool returns 400 for unknown tool name", async () => {
  const handler = buildHandler(async () => ({ content: "ok", isError: false }));
  const { status, json } = await withServer(handler, { name: "unknown_tool", arguments: {} });
  assert.equal(status, 400);
  assert.match(json.content, /unknown page tool/);
});

test("POST /api/pageagent/tool returns 200 with snapshot content on success", async () => {
  const mockExecuteTool = async (name, args, opts) => ({
    content: "Page Snapshot: DS4 Studio UI\n\nURL: http://127.0.0.1:5173\nTitle: DS4 Studio\nControls: [chat-input, send-button]",
    isError: false
  });

  const handler = buildHandler(mockExecuteTool);
  const { status, json } = await withServer(handler, {
    name: "page_snapshot",
    arguments: { includeControls: true }
  });

  assert.equal(status, 200);
  assert.equal(json.isError, false);
  assert.match(json.content, /Page Snapshot/);
});

test("POST /api/pageagent/tool returns 200 with action result on success", async () => {
  const mockExecuteTool = async (name, args, opts) => ({
    content: "Action: click\nTarget: chat-send-button\nResult: ok",
    isError: false
  });

  const handler = buildHandler(mockExecuteTool);
  const { status, json } = await withServer(handler, {
    name: "page_action",
    arguments: { action: "click", target: "chat-send-button" }
  });

  assert.equal(status, 200);
  assert.equal(json.isError, false);
  assert.match(json.content, /Result: ok/);
});

test("POST /api/pageagent/tool passes sessionId to opts", async () => {
  const captured = [];
  const mockExecuteTool = async (name, args, opts) => {
    captured.push({ name, args, opts });
    return { content: "ok", isError: false };
  };

  const handler = buildHandler(mockExecuteTool);
  await withServer(handler, {
    name: "page_snapshot",
    arguments: { includeControls: true },
    sessionId: "test-session-123"
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].name, "page_snapshot");
  assert.equal(captured[0].args.includeControls, true);
  assert.equal(captured[0].opts.sessionId, "test-session-123");
});

test("POST /api/pageagent/tool returns isError true on tool failure", async () => {
  const mockExecuteTool = async (name, args, opts) => ({
    content: "Tool error: BLOCKED_DOMAIN\nBlocked domain: evil.com\nRecovery: Use an allowed domain.",
    isError: true
  });

  const handler = buildHandler(mockExecuteTool);
  const { status, json } = await withServer(handler, {
    name: "page_action",
    arguments: { action: "click", target: "hack-button" }
  });

  assert.equal(status, 200);
  assert.equal(json.isError, true);
  assert.match(json.content, /Tool error/);
});

function withParseServer(handler, body) {
  return withServer(async (req, res) => {
    handler(req, res);
  }, body, "/api/pageagent/parse");
}

test("POST /api/pageagent/parse returns 400 when body is empty", async () => {
  const { parseTask } = await import("./pageAgentTask.mjs");
  const handler = async (req, res) => {
    const { task } = req.body || {};
    if (!task || typeof task !== "string") {
      res.status(400).json({ error: "task is required" });
      return;
    }
    const parsed = parseTask(task);
    if (!parsed) { res.status(400).json({ error: "Could not parse task" }); return; }
    res.json(parsed);
  };
  const { status, json } = await withServer(handler, undefined, "/api/pageagent/parse");
  assert.equal(status, 400);
  assert.equal(json.error, "task is required");
});

test("POST /api/pageagent/parse returns structured action for Italian task", async () => {
  const { parseTask } = await import("./pageAgentTask.mjs");
  const handler = async (req, res) => {
    const { task } = req.body || {};
    if (!task || typeof task !== "string") {
      res.status(400).json({ error: "task is required" });
      return;
    }
    const parsed = parseTask(task);
    if (!parsed) { res.status(400).json({ error: "Could not parse task" }); return; }
    res.json(parsed);
  };
  const { status, json } = await withServer(handler, { task: "fai click su Profile" }, "/api/pageagent/parse");
  assert.equal(status, 200);
  assert.equal(json.action, "click");
  assert.equal(json.target, "profile");
});

test("POST /api/pageagent/parse returns structured action for English task", async () => {
  const { parseTask } = await import("./pageAgentTask.mjs");
  const handler = async (req, res) => {
    const { task } = req.body || {};
    if (!task || typeof task !== "string") {
      res.status(400).json({ error: "task is required" });
      return;
    }
    const parsed = parseTask(task);
    if (!parsed) { res.status(400).json({ error: "Could not parse task" }); return; }
    res.json(parsed);
  };
  const { status, json } = await withServer(handler, { task: "click on Start" }, "/api/pageagent/parse");
  assert.equal(status, 200);
  assert.equal(json.action, "click");
  assert.equal(json.target, "start");
});

// ---------------------------------------------------------------------------
// Bridge endpoint tests (enable, disconnect, pending, resolve)
// ---------------------------------------------------------------------------

test("POST /api/pageagent/enable sets server enabled", async () => {
  const mod = {};
  const handler = async (req, res) => {
    const { enabled } = req.body || {};
    mod.pageAgentEnabled = Boolean(enabled);
    res.json({ ok: true, pageAgentEnabled: mod.pageAgentEnabled });
  };
  const { status, json } = await withServer(handler, { enabled: true }, "/api/pageagent/enable");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.pageAgentEnabled, true);
});

test("POST /api/pageagent/enable false disables server", async () => {
  const mod = {};
  const handler = async (req, res) => {
    const { enabled } = req.body || {};
    mod.pageAgentEnabled = Boolean(enabled);
    res.json({ ok: true, pageAgentEnabled: mod.pageAgentEnabled });
  };
  const { status, json } = await withServer(handler, { enabled: false }, "/api/pageagent/enable");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.pageAgentEnabled, false);
});

test("POST /api/pageagent/disconnect returns ok", async () => {
  const handler = async (req, res) => {
    res.json({ ok: true });
  };
  const { status, json } = await withServer(handler, {}, "/api/pageagent/disconnect");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test("GET /api/pageagent/pending returns tools array", async () => {
  const handler = async (req, res) => {
    res.json({ tools: [{ id: 1, name: "page_snapshot", args: {}, ts: Date.now() }] });
  };
  const app = express();
  app.get("/api/pageagent/pending", handler);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/pageagent/pending`);
    const json = await res.json();
    assert.equal(json.tools.length, 1);
    assert.equal(json.tools[0].name, "page_snapshot");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/pageagent/resolve with id returns ok", async () => {
  const handler = async (req, res) => {
    const { id, result } = req.body || {};
    if (!id) { res.status(400).json({ error: "id is required" }); return; }
    res.json({ ok: true });
  };
  const { status, json } = await withServer(handler, { id: 1, result: { content: "ok" } }, "/api/pageagent/resolve");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test("POST /api/pageagent/resolve without id returns 400", async () => {
  const handler = async (req, res) => {
    const { id } = req.body || {};
    if (!id) { res.status(400).json({ error: "id is required" }); return; }
    res.json({ ok: true });
  };
  const { status, json } = await withServer(handler, {}, "/api/pageagent/resolve");
  assert.equal(status, 400);
  assert.equal(json.error, "id is required");
});
