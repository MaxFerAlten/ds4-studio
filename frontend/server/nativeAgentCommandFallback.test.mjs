// Contract test for GAP-001 (docs/convergenza/gap.js.md):
// with the wrapper disabled, POST /api/native-agent/command must serve the
// slash commands the JS loop understands (WP5 contract,
// agentSlashCommands.mjs) instead of answering 400 "wrapper is not enabled".
// Commands the JS parser rejects keep the original wrapper-guard behavior.
//
// Like agentChatEndpoint.test.mjs, this asserts on the route source:
// index.mjs calls app.listen on import, so routes cannot be booted in tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAgentSlashCommand } from "./agentSlashCommands.mjs";

async function commandRouteSource() {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/native-agent/command"');
  assert.notEqual(start, -1, "route /api/native-agent/command exists");
  const end = source.indexOf('app.all("/api/native-agent/:cmd"', start);
  assert.notEqual(end, -1, "route block end found");
  return source.slice(start, end);
}

test("JS slash fallback is wired before the wrapper guard", async () => {
  const route = await commandRouteSource();
  const fallback = route.indexOf("handleAgentSlashCommand({");
  const guard = route.indexOf("wrapper is not enabled");
  assert.notEqual(fallback, -1, "route delegates recognized commands to handleAgentSlashCommand");
  assert.notEqual(guard, -1, "wrapper guard still present");
  assert.ok(fallback < guard, "the JS fallback must precede the wrapper guard");
  assert.match(route, /!wrapperEnabled\(\) && isAgentSlashCommand\(command\) && parseAgentSlashCommand\(command\)/,
    "fallback fires only without the wrapper, for slash commands the JS parser recognizes");
  assert.match(route, /session: agentSessions\.get\(sessionKey\)/,
    "session comes from the per-request agent session (drives AGENT_MODE_REQUIRED)");
  assert.match(route, /skillState: agentSkillStateFor\(sessionKey\)/);
  assert.match(route, /syncSageStateFromNativeCommand\(command, commandResult\.payload\)/,
    "legacy sage aliases keep syncing the sage turn state");
  assert.match(route, /commandResult\.payload\.active === false/,
    "payload.active === false stops the JS session, as the native path does");
});

test("wrapper passthrough is untouched when the wrapper is enabled", async () => {
  const route = await commandRouteSource();
  const proxy = route.indexOf("proxyNativeAgentCommand(");
  const guard = route.indexOf("wrapper is not enabled");
  assert.notEqual(proxy, -1);
  assert.ok(guard < proxy, "guard still protects the native passthrough");
});

test("parser gate: skill commands recognized, unknown verbs fall through", () => {
  assert.ok(parseAgentSlashCommand("/skill evidence-first-analysis start"));
  assert.ok(parseAgentSlashCommand("/skill list"));
  assert.ok(parseAgentSlashCommand("/soul start"), "legacy aliases ride the same parser");
  assert.equal(parseAgentSlashCommand("/definitely-not-a-command"), null);
  assert.equal(parseAgentSlashCommand("not a slash command"), null);
});
