#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || "0", 10);
const BASE_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

async function callPageTool(name, args) {
  const res = await fetch(`${BASE_URL}/api/pageagent/tool`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args })
  });
  return await res.json();
}

const mcp = new McpServer({
  name: "ds4-studio-pageagent",
  version: "1.0.0"
});

mcp.registerTool(
  "page_snapshot",
  {
    description: "Read a guarded snapshot of the current DS4 Studio UI or an allowed browser page.",
    parameters: {
      url: z.string().optional().describe("Optional URL. If omitted, snapshots the current DS4 Studio UI."),
      includeControls: z.boolean().optional().describe("Include visible buttons, inputs, selects, links.")
    }
  },
  async ({ url, includeControls }) => {
    try {
      const result = await callPageTool("page_snapshot", { url, includeControls });
      return {
        content: [{ type: "text", text: result.content || "No output" }],
        isError: result.isError
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

mcp.registerTool(
  "page_action",
  {
    description: "Perform one guarded UI action on the DS4 Studio UI or an allowed page. Always inspect with page_snapshot first.",
    parameters: {
      action: z.enum(["click", "input", "select", "scroll", "wait"]).describe("Action to perform."),
      target: z.string().describe("data-agent-id, visible label, or stable selector."),
      value: z.string().optional().describe("Text/value for input or select."),
      requireConfirmation: z.boolean().optional().describe("Require user confirmation for potentially destructive action.")
    }
  },
  async ({ action, target, value, requireConfirmation }) => {
    try {
      const result = await callPageTool("page_action", { action, target, value, requireConfirmation });
      return {
        content: [{ type: "text", text: result.content || "No output" }],
        isError: result.isError
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

mcp.registerTool(
  "page_task",
  {
    description: "Perform a high-level UI task described in natural language. Automatically inspects the page, plans actions, executes them, and confirms the result.",
    parameters: {
      task: z.string().describe("Natural language description of the task (e.g., 'Click the send button')."),
      timeout_sec: z.number().optional().describe("Timeout in seconds. Default 30.")
    }
  },
  async ({ task, timeout_sec }) => {
    try {
      const result = await callPageTool("page_task", { task, timeout_sec });
      return {
        content: [{ type: "text", text: result.content || "No output" }],
        isError: result.isError
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
