// WP5 of convergenza.loop.md: /skill and its aliases in the JS loop.
//
// Every expectation here was copied from the C sources, not from memory:
//   - agent_parse_slash_command / agent_parse_skill_command_arg
//     (studio/ds4_agent.c of the composed shadow)
//   - runtime_skill_set_result / runtime_apply_skill_command /
//     runtime_skill_list / runtime_apply_legacy_skill_command /
//     runtime_skill_error_status (ds4_agent_runtime.c)
//   - nativeCommandEvents (frontend/server/nativeAgentCommands.mjs)

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseAgentSlashCommand,
  parseSkillCommandArg,
  skillErrorStatus,
  handleAgentSlashCommand
} from "./agentSlashCommands.mjs";
import { createSessionSkillState } from "./agentSystemText.mjs";
import { nativeCommandEvents } from "./nativeAgentCommands.mjs";

// ---------------------------------------------------------------- fixtures

function fixtureRoot(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "agent-slash-"));
  const skills = join(root, "skills");
  mkdirSync(skills, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(skills, name), { recursive: true });
    writeFileSync(join(skills, name, "SKILL.md"), body);
  }
  return { root, skills };
}

function makeState(skillsDir, env = { DS4_SKILL_AUTO: "0" }) {
  return createSessionSkillState({ env, skillsDir });
}

const ACTIVE_SESSION = { active: true };

function run(message, { session = ACTIVE_SESSION, skillState, env = {} } = {}) {
  return handleAgentSlashCommand({ message, session, skillState, env });
}

// ---------------------------------------------------------------- parser

test("parseAgentSlashCommand copies the C grammar", () => {
  assert.deepEqual(parseAgentSlashCommand("/skill lean start"), { kind: "skill", arg: "lean start", number: 0 });
  assert.deepEqual(parseAgentSlashCommand("/skill list"), { kind: "skill", arg: "list", number: 0 });
  assert.deepEqual(parseAgentSlashCommand("  /save  "), { kind: "save", arg: "", number: 0 });
  assert.deepEqual(parseAgentSlashCommand("/sage-pol stop"), { kind: "sage-pol", arg: "stop", number: 0 });
  assert.deepEqual(parseAgentSlashCommand("/power 80"), { kind: "power", arg: "80", number: 80 });
  assert.deepEqual(parseAgentSlashCommand("/history"), { kind: "history", arg: "", number: 3 });
  assert.deepEqual(parseAgentSlashCommand("/help"), { kind: "help", arg: "", number: 0 });
  // /skill requires a non-empty argument (C returns false).
  assert.equal(parseAgentSlashCommand("/skill"), null);
  assert.equal(parseAgentSlashCommand("/skill   "), null);
  // Unknown commands, missing slash, oversized input.
  assert.equal(parseAgentSlashCommand("/foo"), null);
  assert.equal(parseAgentSlashCommand("plain text"), null);
  assert.equal(parseAgentSlashCommand(""), null);
  assert.equal(parseAgentSlashCommand("/" + "a".repeat(300)), null);
  // /power takes a number 1..100 only.
  assert.deepEqual(parseAgentSlashCommand("/power 100"), { kind: "power", arg: "100", number: 100 });
  assert.equal(parseAgentSlashCommand("/power 0"), null);
  assert.equal(parseAgentSlashCommand("/power 101"), null);
  assert.equal(parseAgentSlashCommand("/power x"), null);
  // /history takes an optional number 1..200.
  assert.deepEqual(parseAgentSlashCommand("/history 5"), { kind: "history", arg: "5", number: 5 });
  assert.equal(parseAgentSlashCommand("/history 201"), null);
});

test("parseSkillCommandArg copies the C usage errors", () => {
  assert.deepEqual(parseSkillCommandArg("list"), { action: "list", name: "" });
  assert.deepEqual(parseSkillCommandArg("formal-verification status"), {
    action: "status",
    name: "formal-verification"
  });
  assert.throws(() => parseSkillCommandArg("alpha"), {
    code: "SKILL_USAGE_INVALID",
    message: "SKILL_USAGE_INVALID: action is missing"
  });
  assert.throws(() => parseSkillCommandArg("alpha run"), {
    code: "SKILL_USAGE_INVALID",
    message: "SKILL_USAGE_INVALID: action must be start, stop, or status"
  });
  assert.throws(() => parseSkillCommandArg("alpha start extra"), {
    code: "SKILL_USAGE_INVALID",
    message: "SKILL_USAGE_INVALID: unexpected extra input"
  });
  assert.throws(() => parseSkillCommandArg("Alpha start"), { code: "SKILL_NAME_INVALID" });
  assert.throws(() => parseSkillCommandArg(`${"a".repeat(65)} start`), {
    code: "SKILL_USAGE_INVALID",
    message: "SKILL_USAGE_INVALID: usage: /skill <name> start|stop|status"
  });
});

test("skillErrorStatus mirrors runtime_skill_error_status", () => {
  assert.equal(skillErrorStatus("SKILL_NAME_INVALID: x"), 400);
  assert.equal(skillErrorStatus("SKILL_USAGE_INVALID: x"), 400);
  assert.equal(skillErrorStatus("SKILL_SYMLINK_REJECTED: x"), 403);
  assert.equal(skillErrorStatus("SKILL_NOT_FOUND: x"), 404);
  assert.equal(skillErrorStatus("SKILL_TOTAL_TOO_LARGE: x"), 413);
  assert.equal(skillErrorStatus("SKILL_FILE_TOO_LARGE: x"), 413);
  assert.equal(skillErrorStatus("SKILL_EMPTY: x"), 422);
  assert.equal(skillErrorStatus("SKILL_RESERVED_MARKER: x"), 422);
  assert.equal(skillErrorStatus("SKILL_ACTIVE_LIMIT: x"), 409);
  assert.equal(skillErrorStatus("whatever"), 500);
});

// ---------------------------------------------------------------- start/stop/status

test("start -> status -> stop -> status flips loaded like the C", () => {
  const { skills } = fixtureRoot({ alpha: "# alpha\n" });
  const skillState = makeState(skills);

  const started = run("/skill alpha start", { skillState });
  assert.equal(started.ok, true);
  assert.equal(started.payload.data.action, "start");
  assert.equal(started.payload.data.name, "alpha");
  assert.equal(started.payload.data.kind, "dynamic");
  assert.equal(started.payload.data.available, true);
  assert.equal(started.payload.data.loaded, true);
  assert.equal(started.payload.data.changed, true);
  assert.equal(started.payload.data.operational, true);
  assert.equal(started.payload.data.promptMode, "base");
  assert.equal(started.payload.message, "Skill alpha is active (state changed).");
  assert.equal(skillState.syspromptDirty, true);

  const status = run("/skill alpha status", { skillState });
  assert.equal(status.ok, true);
  assert.equal(status.payload.data.action, "status");
  assert.equal(status.payload.data.loaded, true);
  assert.equal(status.payload.data.changed, false);
  assert.equal(status.payload.message, "Skill alpha is active.");

  const stopped = run("/skill alpha stop", { skillState });
  assert.equal(stopped.payload.data.loaded, false);
  assert.equal(stopped.payload.data.changed, true);
  assert.equal(stopped.payload.message, "Skill alpha is inactive (state changed).");

  const status2 = run("/skill alpha status", { skillState });
  assert.equal(status2.payload.data.loaded, false);
  assert.equal(status2.payload.data.available, true); // still on disk
  assert.equal(status2.payload.message, "Skill alpha is inactive.");
});

test("the result data carries every runtime_skill_set_result key", () => {
  const { skills } = fixtureRoot({ alpha: "# alpha\n" });
  const skillState = makeState(skills);
  const result = run("/skill alpha status", { skillState });
  assert.deepEqual(
    Object.keys(result.payload.data).sort(),
    [
      "action", "active_count", "aggregate_revision", "assembledRevision",
      "available", "bytes", "changed", "coherent", "degraded", "errorCode",
      "finalizationGateEnabled", "fragmentLoaded", "kind", "loaded",
      "manifestHealthy", "name", "operational", "orchestrationEnabled",
      "promptMode", "publicationGateEnabled", "repaired", "retryable",
      "revalidationEnabled", "revision"
    ].sort()
  );
});

test("start is idempotent when the content is unchanged", () => {
  const { skills } = fixtureRoot({ alpha: "# alpha\n" });
  const skillState = makeState(skills);
  run("/skill alpha start", { skillState });
  const again = run("/skill alpha start", { skillState });
  assert.equal(again.ok, true);
  assert.equal(again.payload.data.changed, false);
  assert.equal(again.payload.message, "Skill alpha is active.");
});

test("stop of an inactive skill is an idempotent success", () => {
  const { skills } = fixtureRoot({ alpha: "# alpha\n" });
  const skillState = makeState(skills);
  const result = run("/skill alpha stop", { skillState });
  assert.equal(result.ok, true);
  assert.equal(result.payload.data.available, false);
  assert.equal(result.payload.data.loaded, false);
  assert.equal(result.payload.data.changed, false);
  assert.equal(result.payload.data.bytes, 0);
  assert.equal(result.payload.data.revision, "");
});

test("status of an unknown skill answers without loading it", () => {
  const { skills } = fixtureRoot({});
  const skillState = makeState(skills);
  const result = run("/skill ghost status", { skillState });
  assert.equal(result.ok, true);
  assert.equal(result.payload.data.available, false);
  assert.equal(result.payload.data.loaded, false);
});

test("start of a missing skill maps SKILL_NOT_FOUND to 404", () => {
  const { skills } = fixtureRoot({});
  const skillState = makeState(skills);
  const result = run("/skill ghost start", { skillState });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.match(result.payload.message, /^SKILL_NOT_FOUND/);
});

// ---------------------------------------------------------------- list

test("/skill list matches the C list shape", () => {
  const { skills } = fixtureRoot({ alpha: "# a\n", beta: "# b\n" });
  const skillState = makeState(skills);
  run("/skill beta start", { skillState });
  run("/skill alpha start", { skillState });
  const result = run("/skill list", { skillState });
  assert.equal(result.ok, true);
  assert.equal(result.payload.message, "Active skill state.");
  assert.equal(result.payload.data.action, "list");
  assert.equal(result.payload.data.active_count, 2);
  assert.equal(result.payload.data.manifestHealthy, true);
  assert.match(result.payload.data.aggregate_revision, /^[0-9a-f]{40}$/);
  assert.deepEqual(
    result.payload.data.skills.map((s) => s.name),
    ["alpha", "beta"]
  );
  assert.deepEqual(result.payload.data.skills[0], {
    name: "alpha",
    kind: "dynamic",
    loaded: true,
    revision: result.payload.data.skills[0].revision,
    bytes: Buffer.byteLength("# a\n")
  });
});

// ---------------------------------------------------------------- aliases

test("aliases combine like runtime_apply_legacy_skill_command", () => {
  const { skills } = fixtureRoot({ soul: "soul body\n", ethic: "ethic body\n" });
  const skillState = makeState(skills);

  const soul = run("/soul start", { skillState });
  assert.equal(soul.ok, true);
  assert.equal(soul.payload.data.name, "soul");
  assert.equal(soul.payload.data.kind, "builtin");
  assert.equal(soul.payload.data.loaded, true);

  // Aliases bypass the DYNAMIC_SKILLS_DISABLED gate (generic_syntax = false).
  const ethic = run("/ethic start", { skillState, env: { DS4_AGENT_DYNAMIC_SKILLS: "0" } });
  assert.equal(ethic.ok, true);
  assert.equal(ethic.payload.data.name, "ethic");

  const stopped = run("/soul stop", { skillState });
  assert.equal(stopped.payload.data.loaded, false);

  // "/soul" alone behaves like C: "soul " fails with the action error.
  const bare = run("/soul", { skillState });
  assert.equal(bare.ok, false);
  assert.equal(bare.status, 400);
  assert.match(bare.payload.message, /action must be start, stop, or status/);
});

test("/sage-pol is an alias of /sage", () => {
  const { skills } = fixtureRoot({ sage: "sage policy\n" });
  const skillState = makeState(skills);
  const result = run("/sage-pol start", { skillState });
  assert.equal(result.ok, true);
  assert.equal(result.payload.data.name, "sage");
  assert.equal(skillState.get("sage").kind, 5); // BUILTIN_SAGE_POLICY
});

test("/lean preflight is not implemented in the JS loop yet", () => {
  const { skills } = fixtureRoot({});
  const skillState = makeState(skills);
  const result = run("/lean preflight", { skillState });
  assert.equal(result.ok, false);
  assert.equal(result.payload.code, "NOT_IMPLEMENTED_YET");
});

// ---------------------------------------------------------------- error codes

test("DYNAMIC_SKILLS_DISABLED blocks only the generic /skill form", () => {
  const { skills } = fixtureRoot({ alpha: "# alpha\n" });
  const skillState = makeState(skills);
  const blocked = run("/skill alpha start", {
    skillState,
    env: { DS4_AGENT_DYNAMIC_SKILLS: "0" }
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 409);
  assert.match(blocked.payload.message, /^DYNAMIC_SKILLS_DISABLED/);

  const listBlocked = run("/skill list", {
    skillState,
    env: { DS4_AGENT_DYNAMIC_SKILLS: "0" }
  });
  assert.equal(listBlocked.status, 409);

  // Any other value keeps dynamic skills enabled.
  const allowed = run("/skill alpha start", {
    skillState,
    env: { DS4_AGENT_DYNAMIC_SKILLS: "1" }
  });
  assert.equal(allowed.ok, true);
});

test("AGENT_MODE_REQUIRED when the session is not active", () => {
  const { skills } = fixtureRoot({ alpha: "# alpha\n" });
  const skillState = makeState(skills);
  const result = run("/skill alpha start", {
    skillState,
    session: { active: false }
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.payload.message, /^AGENT_MODE_REQUIRED/);
  const missing = run("/skill list", { skillState, session: null });
  assert.equal(missing.status, 409);
});

test("SKILL_ACTIVE_LIMIT after 32 dynamic skills", () => {
  const files = {};
  for (let i = 0; i < 33; i += 1) files[`sk${String(i).padStart(2, "0")}`] = `# ${i}\n`;
  const { skills } = fixtureRoot(files);
  const skillState = makeState(skills);
  for (let i = 0; i < 32; i += 1) {
    const name = `sk${String(i).padStart(2, "0")}`;
    const ok = run(`/skill ${name} start`, { skillState });
    assert.equal(ok.ok, true, name);
  }
  const overflow = run("/skill sk32 start", { skillState });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.status, 409);
  assert.match(overflow.payload.message, /^SKILL_ACTIVE_LIMIT/);
});

test("SKILL_TOTAL_TOO_LARGE past 1 MiB of active skills", () => {
  // Four files of exactly 256 KiB fill the 1 MiB budget (WP3 uses the same
  // fixture); any further skill must be refused with 413.
  const pad = "x".repeat(256 * 1024);
  const { skills } = fixtureRoot({
    s0: pad, s1: pad, s2: pad, s3: pad, s4: "# tiny\n"
  });
  const skillState = makeState(skills);
  for (const name of ["s0", "s1", "s2", "s3"]) {
    assert.equal(run(`/skill ${name} start`, { skillState }).ok, true, name);
  }
  const overflow = run("/skill s4 start", { skillState });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.status, 413);
  assert.match(overflow.payload.message, /^SKILL_TOTAL_TOO_LARGE/);
});

test("an invalid skill name is a 400 SKILL_NAME_INVALID", () => {
  const { skills } = fixtureRoot({});
  const skillState = makeState(skills);
  const result = run("/skill Alpha start", { skillState });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.payload.message, /^SKILL_NAME_INVALID/);
});

// ---------------------------------------------------------------- deferred commands

test("session commands answer NOT_IMPLEMENTED_YET, never reach the model", () => {
  const { skills } = fixtureRoot({});
  const skillState = makeState(skills);
  for (const message of ["/save", "/list", "/switch abc", "/new", "/compact"]) {
    const result = run(message, { skillState });
    assert.equal(result.ok, false, message);
    assert.equal(result.payload.code, "NOT_IMPLEMENTED_YET", message);
    // nativeCommandEvents turns it into an explicit agent_error, not a model turn.
    const events = nativeCommandEvents(result.payload, result.ok);
    assert.equal(events[0].event, "agent_error");
  }
});

test("unknown slash commands are rejected, not forwarded", () => {
  const { skills } = fixtureRoot({});
  const skillState = makeState(skills);
  const result = run("/frobnicate now", { skillState });
  assert.equal(result.ok, false);
  assert.equal(result.payload.code, "SLASH_COMMAND_UNSUPPORTED");
});

test("a successful sage start feeds syncSageStateFromNativeCommand's contract", () => {
  const { skills } = fixtureRoot({ sage: "sage policy\n" });
  const skillState = makeState(skills);
  const result = run("/sage start", { skillState });
  assert.equal(result.payload.ok, true);
  const events = nativeCommandEvents(result.payload, result.ok);
  assert.equal(events[0].event, "agent_text");
  assert.match(events[0].data.content, /"loaded": true/);
  assert.equal(events.at(-1).event, "agent_done");
});

test("status and list do not dirty the system prompt, start and stop do", () => {
  const { skills } = fixtureRoot({ alpha: "# alpha\n" });
  const skillState = makeState(skills);
  run("/skill alpha status", { skillState });
  run("/skill list", { skillState });
  assert.equal(skillState.syspromptDirty, false);
  run("/skill alpha start", { skillState });
  assert.equal(skillState.syspromptDirty, true);
});
