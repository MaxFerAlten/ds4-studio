import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNativeAgentNotice, parseAgentInput, formatDebugFrames } from "./utils.mjs";

test("parses agent control commands independently of agent mode", () => {
  assert.deepEqual(parseAgentInput("/agent start", false), {
    type: "control",
    action: "start"
  });
  assert.deepEqual(parseAgentInput(" /AGENT STOP ", true), {
    type: "control",
    action: "stop"
  });
  assert.deepEqual(parseAgentInput("/agent status", false), {
    type: "control",
    action: "status"
  });
});

test("parses every direct native command while agent mode is active", () => {
  const commands = [
    "/help",
    "/save",
    "/compact",
    "/list",
    "/switch abc",
    "/del abc",
    "/strip abc",
    "/history",
    "/history 10",
    "/power 80",
    "/new",
    "/quit",
    "/exit",
    "/crawl start https://example.com"
  ];
  for (const command of commands) {
    assert.deepEqual(parseAgentInput(command, true), {
      type: "native",
      command
    });
  }
});

test("does not intercept direct native commands outside agent mode except crawl", () => {
  assert.equal(parseAgentInput("/save", false), null);
  assert.equal(parseAgentInput("/unknown", false), null);
  assert.deepEqual(parseAgentInput("/crawl start https://example.com", false), {
    type: "native",
    command: "/crawl start https://example.com"
  });
});

test("/skill is blocked locally outside Agent Mode", () => {
  assert.deepEqual(parseAgentInput("/skill lean start", false), {
    type: "skill",
    action: "inactive",
    command: "/skill lean start"
  });
});

test("/skill is routed natively inside Agent Mode", () => {
  assert.deepEqual(parseAgentInput(" /skill lean start ", true), {
    type: "native",
    command: "/skill lean start"
  });
});

test("legacy /lean is routed natively inside Agent Mode", () => {
  for (const verb of ["start", "stop", "status", "preflight"]) {
    const command = `/lean ${verb}`;
    assert.deepEqual(parseAgentInput(command, true), {
      type: "native",
      command
    });
  }
  assert.deepEqual(parseAgentInput("/lean start", true), {
    type: "native",
    command: "/lean start"
  });
});

test("legacy /lean is blocked locally outside Agent Mode", () => {
  assert.deepEqual(parseAgentInput("/lean start", false), {
    type: "lean",
    action: "inactive",
    command: "/lean start"
  });
  assert.deepEqual(parseAgentInput("/lean preflight", false), {
    type: "lean",
    action: "inactive",
    command: "/lean preflight"
  });
});

test("parses pony controls only as agent-scoped commands", () => {
  assert.deepEqual(parseAgentInput("/pony", true), { type: "pony", action: "status" });
  assert.deepEqual(parseAgentInput("/pony status", true), { type: "pony", action: "status" });
  assert.deepEqual(parseAgentInput("/pony start", true), { type: "pony", action: "set", mode: "full" });
  assert.deepEqual(parseAgentInput("/pony stop", true), { type: "pony", action: "set", mode: "off" });
  assert.deepEqual(parseAgentInput("/pony ultra", true), { type: "pony", action: "set", mode: "ultra" });
  assert.deepEqual(parseAgentInput("/pony banana", true), { type: "pony", action: "invalid", mode: "banana" });
  assert.deepEqual(parseAgentInput("/pony start", false), { type: "pony", action: "inactive" });
});

test("routes sage policy controls through the native command endpoint", () => {
  for (const action of ["start", "stop", "status"]) {
    const command = `/sage-pol ${action}`;
    assert.deepEqual(parseAgentInput(command, false), {
      type: "native",
      command
    });
    assert.deepEqual(parseAgentInput(command.toUpperCase(), true), {
      type: "native",
      command
    });
  }
});

test("canonicalizes agent aliases and preserves arguments", () => {
  assert.deepEqual(parseAgentInput("/agent save", false), {
    type: "native",
    command: "/save"
  });
  assert.deepEqual(parseAgentInput("/agent HISTORY 10", true), {
    type: "native",
    command: "/history 10"
  });
  assert.deepEqual(parseAgentInput("/agent switch AbC123", true), {
    type: "native",
    command: "/switch AbC123"
  });
  assert.deepEqual(parseAgentInput("/agent unknown value", true), {
    type: "native",
    command: "/unknown value"
  });
});

test("intercepts unknown slash commands only in active agent mode", () => {
  assert.deepEqual(parseAgentInput(" /unknown value ", true), {
    type: "native",
    command: "/unknown value"
  });
  assert.equal(parseAgentInput("plain text", true), null);
  assert.equal(parseAgentInput("/agent", true), null);
});

test("formats native command success with structured data", () => {
  assert.equal(
    formatNativeAgentNotice("/list", {
      ok: true,
      message: "Saved sessions.",
      data: [{ sha: "abc" }]
    }, 200),
    "**/list** (HTTP 200)\n\nSaved sessions.\n\n```json\n[\n  {\n    \"sha\": \"abc\"\n  }\n]\n```"
  );
});

test("formats native command errors without requiring JSON data", () => {
  assert.equal(
    formatNativeAgentNotice("/power 0", {
      ok: false,
      message: "unknown or invalid native agent command"
    }, 400),
    "**/power 0** (HTTP 400)\n\nunknown or invalid native agent command"
  );
});

test("parses /pageagent status", () => {
  assert.deepEqual(parseAgentInput("/pageagent status", false), {
    type: "pageagent",
    action: "status"
  });
  assert.deepEqual(parseAgentInput(" /PAGEAGENT STATUS ", true), {
    type: "pageagent",
    action: "status"
  });
});

test("parses /pageagent stop", () => {
  assert.deepEqual(parseAgentInput("/pageagent stop", false), {
    type: "pageagent",
    action: "stop"
  });
});

test("parses /pageagent run with task", () => {
  assert.deepEqual(parseAgentInput("/pageagent run apri History", false), {
    type: "pageagent",
    action: "run",
    task: "apri History"
  });
});

test("parses /ui as alias for pageagent run", () => {
  assert.deepEqual(parseAgentInput("/ui apri History", false), {
    type: "pageagent",
    action: "run",
    task: "apri History",
    alias: "ui"
  });
  assert.deepEqual(parseAgentInput("/ui imposta temperature a 0", true), {
    type: "pageagent",
    action: "run",
    task: "imposta temperature a 0",
    alias: "ui"
  });
});

test("/pageagent commands work independently of agent mode", () => {
  assert.deepEqual(parseAgentInput("/pageagent status", false), {
    type: "pageagent",
    action: "status"
  });
  assert.deepEqual(parseAgentInput("/pageagent stop", true), {
    type: "pageagent",
    action: "stop"
  });
  assert.deepEqual(parseAgentInput("/ui apri Research", false), {
    type: "pageagent",
    action: "run",
    task: "apri Research",
    alias: "ui"
  });
});

test("parses /pageagent start and /pageagent on", () => {
  assert.deepEqual(parseAgentInput("/pageagent start", false), {
    type: "pageagent",
    action: "set",
    enabled: true
  });
  assert.deepEqual(parseAgentInput("/pageagent on", true), {
    type: "pageagent",
    action: "set",
    enabled: true
  });
  assert.deepEqual(parseAgentInput(" /PAGEAGENT START ", false), {
    type: "pageagent",
    action: "set",
    enabled: true
  });
});

test("parses /pageagent off", () => {
  assert.deepEqual(parseAgentInput("/pageagent off", false), {
    type: "pageagent",
    action: "set",
    enabled: false
  });
  assert.deepEqual(parseAgentInput(" /pageagent OFF ", true), {
    type: "pageagent",
    action: "set",
    enabled: false
  });
});

test("/debug toggles locally and never reaches the model", () => {
  assert.deepEqual(parseAgentInput("/debug start", true), {
    type: "debug", action: "set", enabled: true
  });
  assert.deepEqual(parseAgentInput("/debug stop", true), {
    type: "debug", action: "set", enabled: false
  });
  assert.deepEqual(parseAgentInput("/debug status", true), {
    type: "debug", action: "status"
  });
  // Same outside Agent Mode: the toggle is a client concern, not a native command.
  assert.deepEqual(parseAgentInput("/debug start", false), {
    type: "debug", action: "set", enabled: true
  });
});

test("formatDebugFrames renders a turn with its compression and guard block", () => {
  const out = formatDebugFrames([
    { stage: "turn", finishReason: "tool_calls", isFinalResponse: false, toolCalls: ["read_file"], contentLength: 0 },
    { stage: "compressed", tool: "read_file", blobId: "blob_7f3a", originalBytes: 48210, compressedBytes: 812 },
    {
      stage: "guard_block",
      guard: "STOP_MISSING_OBSERVATION_FLOW",
      isFinalResponse: true,
      finishReason: "stop",
      toolCalls: 0,
      contentLength: 42,
      markers: { observation: 0, compressed: -1, target: -1, verdict: -1 }
    }
  ]);
  assert.match(out, /turn 1/);
  assert.match(out, /finish_reason\s+: tool_calls/);
  assert.match(out, /tool_calls\s+: 1 \(read_file\)/);
  assert.match(out, /compressed\s+: read_file 48210B -> 812B \(blob_7f3a\)/);
  assert.match(out, /GUARD BLOCK\s+: STOP_MISSING_OBSERVATION_FLOW/);
  assert.match(out, /COMPRESSED=-1/);
  assert.ok(out.startsWith("\n\n```"));
});

test("formatDebugFrames stays silent with nothing to report", () => {
  assert.equal(formatDebugFrames([]), "");
  assert.equal(formatDebugFrames(undefined), "");
});
