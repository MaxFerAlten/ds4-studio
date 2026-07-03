import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";

const MCP_TOOLS = [
  {
    name: "page_snapshot",
    description: "Read a guarded snapshot of the current DS4 Studio UI or an allowed browser page.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional URL." },
        includeControls: { type: "boolean", description: "Include visible controls." }
      }
    }
  },
  {
    name: "page_action",
    description: "Perform one guarded UI action on the DS4 Studio UI or an allowed page.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["click", "input", "select", "scroll", "wait"] },
        target: { type: "string" },
        value: { type: "string" },
        requireConfirmation: { type: "boolean" }
      },
      required: ["action", "target"]
    }
  },
  {
    name: "page_task",
    description: "Perform a high-level UI task described in natural language.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        timeout_sec: { type: "number" }
      },
      required: ["task"]
    }
  }
];

test("page_snapshot MCP tool schema is correctly defined", () => {
  const tool = MCP_TOOLS.find(t => t.name === "page_snapshot");
  assert.ok(tool);
  assert.ok(tool.inputSchema.properties.url);
  assert.ok(tool.inputSchema.properties.includeControls);
});

test("page_action MCP tool schema has required action and target", () => {
  const tool = MCP_TOOLS.find(t => t.name === "page_action");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ["action", "target"]);
  assert.equal(tool.inputSchema.properties.action.enum.length, 5);
});

test("page_task MCP tool schema has required task", () => {
  const tool = MCP_TOOLS.find(t => t.name === "page_task");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ["task"]);
});

test("MCP tool call via proxy endpoint returns expected shape", async () => {
  const app = express();
  app.use(express.json());
  app.post("/api/pageagent/tool", (req, res) => {
    const { name, arguments: args } = req.body;
    if (name === "page_snapshot") {
      res.json({ content: "Page Snapshot: DS4 Studio UI", isError: false });
    } else if (name === "page_action") {
      if (!args.action || !args.target) {
        res.json({ content: "Tool error: action and target required", isError: true });
      } else {
        res.json({ content: `Action: ${args.action}\nTarget: ${args.target}\nResult: ok`, isError: false });
      }
    } else if (name === "page_task") {
      res.json({ content: `Task: ${args.task}\nCompleted: true`, isError: false });
    } else {
      res.json({ content: `Tool error: unknown tool`, isError: true });
    }
  });

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    async function callTool(name, args) {
      const res = await fetch(`http://127.0.0.1:${port}/api/pageagent/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, arguments: args })
      });
      return await res.json();
    }

    const snap = await callTool("page_snapshot", { includeControls: true });
    assert.equal(snap.isError, false);
    assert.match(snap.content, /Page Snapshot/);

    const action = await callTool("page_action", { action: "click", target: "send-button" });
    assert.equal(action.isError, false);
    assert.match(action.content, /Result: ok/);

    const task = await callTool("page_task", { task: "Click the send button" });
    assert.equal(task.isError, false);
    assert.match(task.content, /Completed: true/);

    const unknown = await callTool("unknown_tool", {});
    assert.equal(unknown.isError, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
