import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalLegacyCommand,
  isAgentSlashCommand,
  nativeCommandEvents,
  proxyNativeAgentCommand
} from "./nativeAgentCommands.mjs";

test("recognizes trimmed slash commands only", () => {
  assert.equal(isAgentSlashCommand(" /history 10 "), true);
  assert.equal(isAgentSlashCommand("/unknown"), true);
  assert.equal(isAgentSlashCommand("explain /history"), false);
  assert.equal(isAgentSlashCommand(""), false);
});

test("canonicalizes legacy native-agent routes", () => {
  assert.equal(canonicalLegacyCommand("save"), "/save");
  assert.equal(canonicalLegacyCommand("list"), "/list");
  assert.equal(canonicalLegacyCommand("new"), "/new");
  assert.equal(canonicalLegacyCommand("compact"), "/compact");
  assert.equal(canonicalLegacyCommand("switch", { sha: "abc123" }), "/switch abc123");
  assert.equal(canonicalLegacyCommand("strip", { sha: "deadbeef" }), "/strip deadbeef");
  assert.equal(canonicalLegacyCommand("switch", {}), null);
  assert.equal(canonicalLegacyCommand("unknown", {}), null);
});

test("converts successful native commands to SSE events", () => {
  assert.deepEqual(
    nativeCommandEvents({ ok: true, message: "saved", active: true }, true),
    [
      { event: "agent_text", data: { content: "saved" } },
      { event: "agent_done", data: { finish_reason: "command", active: true } }
    ]
  );
});

test("includes structured command data in the SSE text", () => {
  assert.deepEqual(
    nativeCommandEvents({
      ok: true,
      message: "Saved sessions.",
      data: [{ sha: "abc123", title: "demo" }],
      active: true
    }, true),
    [
      {
        event: "agent_text",
        data: {
          content: "Saved sessions.\n\n```json\n[\n  {\n    \"sha\": \"abc123\",\n    \"title\": \"demo\"\n  }\n]\n```"
        }
      },
      { event: "agent_done", data: { finish_reason: "command", active: true } }
    ]
  );
});

test("converts command failures to SSE error and done events", () => {
  assert.deepEqual(
    nativeCommandEvents({ ok: false, message: "bad command", active: true }, false),
    [
      { event: "agent_error", data: { error: "bad command" } },
      { event: "agent_done", data: { finish_reason: "error", active: true } }
    ]
  );
});

test("proxies a native command and preserves status and JSON", async () => {
  const calls = [];
  const result = await proxyNativeAgentCommand(
    async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify({ ok: true, command: "quit", message: "closed", active: false }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
    "http://127.0.0.1:8000",
    "/quit"
  );

  assert.equal(calls[0].url, "http://127.0.0.1:8000/api/native-agent/command");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { command: "/quit" });
  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.payload.active, false);
});

test("normalizes non-JSON wrapper errors", async () => {
  const result = await proxyNativeAgentCommand(
    async () => new Response("wrapper unavailable", { status: 503 }),
    "http://127.0.0.1:8000",
    "/help"
  );

  assert.equal(result.status, 503);
  assert.equal(result.ok, false);
  assert.deepEqual(result.payload, {
    ok: false,
    message: "wrapper unavailable",
    active: true
  });
});
