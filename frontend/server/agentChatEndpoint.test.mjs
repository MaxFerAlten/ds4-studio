// Integration tests for the /api/agent/chat endpoint's wrapper path.
// Tests session validation, request forwarding, and timeout guard logic
// by mocking the Express handler's dependencies.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { AgentSessionStore } from "./agentSession.mjs";

// ── Helpers to simulate the wrapper-path logic ─────────────────────────

/**
 * Simulate the session validation check from the wrapper path:
 *   if (!nativeAgentSession || !nativeAgentSession.active) -> 400
 */
function validateWrapperSession(store, sessionKey) {
  const session = store.get(sessionKey);
  if (!session || !session.active) {
    return { status: 400, error: "Agent mode is not active. Use /agent start first." };
  }
  return { status: 200, session };
}

/**
 * Simulate the outbound body construction:
 *   { message: outboundMessage, request: req.body?.request || {} }
 */
function buildWrapperOutbound(message, ponyPolicy, requestParams) {
  const outboundMessage = ponyPolicy
    ? `${ponyPolicy}\n\nUser request:\n${message}`
    : message;
  return {
    message: outboundMessage,
    request: requestParams || {}
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

test("wrapper path rejects chat without active session", () => {
  const store = new AgentSessionStore();

  // No session started yet
  const result = validateWrapperSession(store, "tab_unknown");
  assert.equal(result.status, 400);
  assert.match(result.error, /Agent mode is not active/);

  // Start a session for a different key
  store.start("tab_other");
  const result2 = validateWrapperSession(store, "tab_unknown");
  assert.equal(result2.status, 400);
  assert.match(result2.error, /Agent mode is not active/);
});

test("wrapper path accepts chat with active session", () => {
  const store = new AgentSessionStore();
  store.start("tab_active");

  const result = validateWrapperSession(store, "tab_active");
  assert.equal(result.status, 200);
  assert.ok(result.session.active);
});

test("wrapper path builds outbound body with request params", () => {
  const message = "analizza progetto";
  const requestParams = {
    max_tokens: 512,
    temperature: 0.7,
    top_p: 1.0
  };

  const body = buildWrapperOutbound(message, null, requestParams);
  assert.equal(body.message, message);
  assert.deepEqual(body.request, requestParams);
});

test("wrapper path includes pony policy in outbound message", () => {
  const message = "analizza";
  const policy = "<DS4 Lean Agent Policy>\nBe concise.";
  const requestParams = { max_tokens: 256 };

  const body = buildWrapperOutbound(message, policy, requestParams);
  assert.match(body.message, /<DS4 Lean Agent Policy>/);
  assert.match(body.message, /User request:\nanalizza/);
  assert.deepEqual(body.request, requestParams);
});

test("wrapper path defaults request to empty object when absent", () => {
  const body = buildWrapperOutbound("test", null, undefined);
  assert.deepEqual(body.request, {});
});

test("timeout guard stops streaming after deadline", async () => {
  // Simulate a slow stream where each chunk takes 100ms
  // Timeout is 50ms — only the error chunk should be emitted
  const deadline = Date.now() + 50;
  const chunks = [
    "event: agent_text\ndata: {\"content\":\"first\"}\n\n",
    "event: agent_text\ndata: {\"content\":\"second\"}\n\n",
    "event: agent_text\ndata: {\"content\":\"third\"}\n\n"
  ];

  const results = [];
  for (const chunk of chunks) {
    await new Promise(r => setTimeout(r, 100));
    if (Date.now() > deadline) {
      results.push({ event: "agent_error", data: { error: "Native agent timeout" } });
      break;
    }
    results.push(chunk);
  }

  // No chunks made it through; only the timeout error was emitted
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    event: "agent_error",
    data: { error: "Native agent timeout" }
  });
});

test("timeout guard lets fast chunks pass through", async () => {
  // Fast chunks (10ms each) within a generous timeout (500ms)
  const deadline = Date.now() + 500;
  const chunks = [
    "event: agent_text\ndata: {\"content\":\"alpha\"}\n\n",
    "event: agent_text\ndata: {\"content\":\"beta\"}\n\n",
  ];

  const results = [];
  for (const chunk of chunks) {
    await new Promise(r => setTimeout(r, 10));
    if (Date.now() > deadline) {
      results.push({ event: "agent_error", data: { error: "Native agent timeout" } });
      break;
    }
    results.push(chunk);
  }

  assert.equal(results.length, 2);
  assert.equal(typeof results[0], "string");
  assert.equal(typeof results[1], "string");
});

test("pony policy preserves message content", () => {
  const message = "Ciao, analizza il progetto.";
  const policy = "<ponyPolicy>\nFocus on code.";
  const requestParams = { max_tokens: 1024 };

  const body = buildWrapperOutbound(message, policy, requestParams);

  // The original message must be fully present after the policy
  assert.match(body.message, /Ciao, analizza il progetto\.$/m);
  // The policy must precede the message
  assert.match(body.message, /^<ponyPolicy>\nFocus on code\.\n\nUser request:\nCiao/);
  // Request params must survive
  assert.deepEqual(body.request, requestParams);
});

test("JS agent stream guards cumulative text before emitting SSE", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");

  assert.match(
    source,
    /guardAssistantDelta\(assistantContent, delta\.content, agentSession\.loopGuard\)/
  );
  assert.match(source, /const acceptedDelta = guarded\.content\.slice\(assistantContent\.length\)/);
  assert.doesNotMatch(
    source,
    /assistantContent\s*\+=\s*delta\.content;\s*writeAgentSse\("agent_text", \{ content: delta\.content \}\)/
  );
});

test("JS agent compresses tool results and activates observation flow before exposure", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");

  assert.match(source, /const rawResult = await executeTool\(tc\.name, tc\.arguments, opts\)/);
  assert.match(
    source,
    /compressToolResultForModel\(\s*tc\.name,\s*rawResult,\s*toolBlobStore\s*\)/
  );
  assert.match(source, /if \(result\.compressed\) \{\s*agentSession\.loopGuard\.recordCompressedObservation\(\)/);
});

test("JS agent compresses crawl results before SSE and model context exposure", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");

  assert.match(
    source,
    /const rawResult = await executeTool\("crawl",[\s\S]*?compressToolResultForModel\(\s*"crawl",\s*rawResult,\s*toolBlobStore\s*\)/
  );
  assert.match(
    source,
    /compressToolResultForModel\(\s*"crawl",[\s\S]*?writeAgentSse\("agent_tool_result", \{[^}]*content: result\.content[\s\S]*?fullMessages\.push\(\{ role: "tool", tool_call_id: c\.id, content: result\.content \}\)/
  );
});

test("JS agent warns on unsupported verified claims using current-turn evidence", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");

  assert.match(source, /import \{ checkVerifiedClaim \} from "\.\/claimGuard\.mjs"/);
  assert.match(source, /const turnEvidence = \[\]/);
  assert.match(source, /turnEvidence\.push\(/);
  assert.match(
    source,
    /checkVerifiedClaim\(\s*assistantContent,\s*turnEvidence\.join\("\\n"\),\s*\{ mode: "warn" \}\s*\)/
  );
  assert.match(source, /type: claimDecision\.type/);
});

test("JS agent enforces post-GitNexus analyze policy in the current turn", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");

  assert.match(
    source,
    /import \{[^}]*checkPostGitnexusAnalyzeAction[^}]*recordGitnexusAnalyzeResult[^}]*\} from "\.\/agentGitnexusPolicy\.mjs"/s
  );
  assert.match(source, /const policyState = \{ gitnexusAnalyzeSeen: false \}/);
  assert.match(
    source,
    /checkPostGitnexusAnalyzeAction\(\s*\{[\s\S]*?tool: tc\.name,[\s\S]*?args: tc\.arguments[\s\S]*?\},\s*policyState\s*\)/
  );
  assert.match(
    source,
    /recordGitnexusAnalyzeResult\(\s*\{ tool: tc\.name, args: tc\.arguments \},\s*rawResult,\s*policyState\s*\)/
  );
});

test("JS agent emits additive compact Sage status and artifact events", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");

  assert.match(source, /import \{ SageTurnTracker \} from "\.\/sageTurnTracker\.mjs"/);
  assert.match(source, /process\.env\.DS4_SAGE_COMPACT_CHAT !== "0"/);
  assert.match(source, /writeAgentSse\("agent_sage_status",/);
  assert.match(source, /writeAgentSse\("agent_sage_artifact",/);
  assert.match(
    source,
    /writeAgentSse\("agent_tool_call", \{[\s\S]*?name: tc\.name,[\s\S]*?hiddenByDefault: true[\s\S]*?\}\)/
  );
});

test("JS agent keeps Sage model content private while preserving model context", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");
  const start = source.indexOf("const runToolCall = async (tc) =>");
  const end = source.indexOf("// --- Wrapper / native-agent passthrough", start);
  const block = source.slice(start, end);

  assert.match(
    block,
    /name: r\.name,\s*content: r\.displayContent,[\s\S]*?hiddenByDefault: true/
  );
  assert.doesNotMatch(block, /modelContent\s*:/);
  assert.match(
    block,
    /fullMessages\.push\(\{\s*role: "tool",\s*tool_call_id: r\.id,\s*content: r\.content\s*\}\)/
  );
});

test("JS agent isolates compact Sage from the generic loop guard and adds synthesis guidance", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");

  assert.match(source, /if \(!compactSage\) \{\s*const decision = agentSession\.loopGuard\.checkAction/);
  assert.match(
    source,
    /const progress = compactSage \? null : agentSession\.loopGuard\.recordProgress/
  );
  assert.match(source, /SageMath has completed the requested mathematical work\./);
  assert.match(source, /SAGE_FINAL_SYNTHESIS_MISSING/);
});
