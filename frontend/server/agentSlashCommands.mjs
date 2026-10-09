// WP5 of convergenza.loop.md: session and skill commands in the JS loop.
//
// Everything observable here is a copy of the C contract, not a reimagining:
//   - agent_parse_slash_command / agent_parse_skill_command_arg
//     (studio/ds4_agent.c of the composed shadow)
//   - runtime_apply_skill_command / runtime_skill_set_result /
//     runtime_skill_list / runtime_apply_legacy_skill_command /
//     runtime_skill_error_status / runtime_skill_error_code
//     (ds4_agent_runtime.c)
//
// Deviations from the C, all declared in docs/convergenza/WP5.md:
//   - JS has no autonomous fragments, no manifest and no policy-revision
//     drift, so fragmentLoaded/promptMode/orchestration/gates report the
//     truthful JS values (never a "base" session that cannot be saved).
//   - AUTHORITATIVE_MATH_MODE_CONFLICT cannot fire while no autonomous
//     fragment exists; the check is kept where the C has it.
//   - /lean preflight queries the Node side in the C; the JS loop does not
//     implement it yet (WP13/WP16 own the Lean runtime integration).
//   - Session commands (/save /list /switch /new /compact) and the remaining
//     C verbs answer NOT_IMPLEMENTED_YET instead of reaching the model.

import {
  SKILL_ACTIVE_MAX,
  SKILL_TOTAL_MAX,
  SKILL_KIND,
  SkillError,
  SkillRegistry,
  aggregateRevisionOf,
  skillKindName,
  skillNameValid,
  stageSkill
} from "./skillRegistry.mjs";

const SKILL_NAME_MAX = 64; // DS4_AGENT_SKILL_NAME_MAX

// agent_parse_slash_command's command table.  Kinds use the strings the C
// runtime logs map them to (ds4_agent_runtime.c:841-848).
const SIMPLE_KINDS = new Map(Object.entries({
  "/help": "help",
  "/save": "save",
  "/compact": "compact",
  "/list": "list",
  "/quit": "quit",
  "/exit": "exit",
  "/new": "new",
  "/switch": "switch",
  "/del": "del",
  "/strip": "strip"
}));
const ARG_KINDS = new Set([
  "skill",
  "metacognition",
  "soul",
  "ethic",
  "structure",
  "sage-pol",
  "sage",
  "lean",
  "crawl",
  "think"
]);
const HISTORY_DEFAULT_TURNS = 3; // AGENT_HISTORY_DEFAULT_TURNS
const HISTORY_MAX_TURNS = 200; // AGENT_HISTORY_MAX_TURNS

// AGENT_BUILTIN_SKILLS in studio/ds4_agent.c: metacognition, soul, ethic,
// structure, sage, lean.  evidence-first-analysis is a plain dynamic skill.
const BUILTIN_KIND_BY_NAME = new Map([
  ["metacognition", SKILL_KIND.BUILTIN_METACOGNITION],
  ["soul", SKILL_KIND.BUILTIN_SOUL],
  ["ethic", SKILL_KIND.BUILTIN_ETHIC],
  ["structure", SKILL_KIND.BUILTIN_STRUCTURE],
  ["sage", SKILL_KIND.BUILTIN_SAGE_POLICY],
  ["lean", SKILL_KIND.BUILTIN_LEAN_POLICY]
]);

// runtime_apply_legacy_skill_command's command -> skill name mapping.
const LEGACY_ALIASES = new Map([
  ["metacognition", "metacognition"],
  ["soul", "soul"],
  ["ethic", "ethic"],
  ["structure", "structure"],
  ["sage-pol", "sage"],
  ["sage", "sage"],
  ["lean", "lean"]
]);

function isSpace(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\v" ||
    ch === "\f" || ch === "\r";
}

// agent_parse_command_number()
function parseCommandNumber(text, min, max) {
  const match = /^([+-]?\d+)([\s\S]*)$/.exec(text || "");
  if (!match) return null;
  const value = Number(match[1]);
  let rest = match[2];
  while (rest && isSpace(rest[0])) rest = rest.slice(1);
  if (rest) return null;
  if (value < min || value > max) return null;
  return value;
}

// agent_parse_slash_command()
export function parseAgentSlashCommand(input) {
  if (typeof input !== "string") return null;
  let text = input;
  while (text && isSpace(text[0])) text = text.slice(1);
  while (text && isSpace(text[text.length - 1])) text = text.slice(0, -1);
  const len = Buffer.byteLength(text, "utf8");
  if (!len || len >= 256 || text[0] !== "/") return null;

  const space = text.search(/\s/);
  const command = space === -1 ? text : text.slice(0, space);
  let arg = space === -1 ? "" : text.slice(space + 1);
  while (arg && isSpace(arg[0])) arg = arg.slice(1);

  const out = { kind: null, arg, number: 0 };

  if (SIMPLE_KINDS.has(command)) {
    out.kind = SIMPLE_KINDS.get(command);
  } else if (command === "/power") {
    const value = parseCommandNumber(arg, 1, 100);
    if (value === null) return null;
    out.kind = "power";
    out.number = value;
  } else if (command === "/history") {
    if (arg) {
      const value = parseCommandNumber(arg, 1, HISTORY_MAX_TURNS);
      if (value === null) return null;
      out.number = value;
    } else {
      out.number = HISTORY_DEFAULT_TURNS;
    }
    out.kind = "history";
  } else if (command === "/skill") {
    if (!arg) return null; // C: the skill verb requires an argument
    out.kind = "skill";
  } else {
    const alias = command.slice(1);
    if (!ARG_KINDS.has(alias)) return null;
    out.kind = alias;
  }
  return out;
}

// agent_parse_skill_command_arg()
export function parseSkillCommandArg(arg) {
  if (typeof arg !== "string") {
    throw new SkillError("SKILL_USAGE_INVALID", "usage: /skill <name> start|stop|status");
  }
  let text = arg;
  while (text && (text[0] === " " || text[0] === "\t")) text = text.slice(1);
  if (text === "list") return { action: "list", name: "" };

  const nameMatch = /^([^\s]*)/.exec(text);
  const name = nameMatch[1];
  if (!name.length || Buffer.byteLength(name, "utf8") > SKILL_NAME_MAX) {
    throw new SkillError("SKILL_USAGE_INVALID", "usage: /skill <name> start|stop|status");
  }
  // ds4_agent_skill_name_valid() — throws SKILL_NAME_INVALID like the C.
  skillNameValid(name);

  let rest = text.slice(name.length);
  if (rest[0] !== " " && rest[0] !== "\t") {
    throw new SkillError("SKILL_USAGE_INVALID", "action is missing");
  }
  while (rest[0] === " " || rest[0] === "\t") rest = rest.slice(1);
  const actionMatch = /^([^\s]*)/.exec(rest);
  const action = actionMatch[1];
  rest = rest.slice(action.length);
  while (rest[0] === " " || rest[0] === "\t") rest = rest.slice(1);
  if (rest) throw new SkillError("SKILL_USAGE_INVALID", "unexpected extra input");

  if (action === "start" || action === "stop" || action === "status") {
    return { action, name };
  }
  throw new SkillError("SKILL_USAGE_INVALID", "action must be start, stop, or status");
}

// runtime_skill_error_status()
export function skillErrorStatus(err) {
  if (!err) return 500;
  const table = [
    [["SKILL_NAME_INVALID", "SKILL_USAGE_INVALID"], 400],
    [["SKILL_SYMLINK_REJECTED", "SKILL_PATH_OUTSIDE_ROOT"], 403],
    [["SKILL_NOT_FOUND", "SKILL_FRAGMENT_NOT_FOUND"], 404],
    [["SKILL_FILE_TOO_LARGE", "SKILL_TOTAL_TOO_LARGE"], 413],
    [
      [
        "SKILL_EMPTY", "SKILL_NUL_BYTE", "SKILL_UTF8_INVALID",
        "SKILL_RESERVED_MARKER", "SKILL_FILE_INVALID", "SKILL_FRAGMENT_INVALID",
        "SKILL_FRAGMENT_CONFIG_INVALID"
      ],
      422
    ],
    [
      [
        "SKILL_ACTIVE_LIMIT", "SKILL_CHANGED_DURING_READ",
        "SKILL_SESSION_REVISION_MISMATCH", "SKILL_ORCHESTRATOR_REQUIRED"
      ],
      409
    ]
  ];
  for (const [prefixes, status] of table) {
    for (const prefix of prefixes) {
      if (err.startsWith(prefix)) return status;
    }
  }
  return 500;
}

// ------------------------------------------------------------------ state

function ensureRegistry(skillState) {
  if (!skillState.registry) {
    skillState.registry = new SkillRegistry({ skillsDir: skillState.skillsDir });
  }
  return skillState.registry;
}

function syncDynamicRender(skillState) {
  const rendered = skillState.registry ? skillState.registry.render() : "";
  skillState.dynamic = rendered || null;
}

// runtime_skill_state(): loaded / bytes / revision of one active skill.
function skillStateOf(skillState, name, kind) {
  if (kind === SKILL_KIND.DYNAMIC) {
    const entry = skillState.registry ? skillState.registry.find(name) : null;
    return {
      loaded: Boolean(entry),
      bytes: entry ? entry.contentLen : 0,
      revision: entry ? entry.revision : ""
    };
  }
  const entry = skillState.entries.get(name) || null;
  return {
    loaded: Boolean(entry),
    bytes: entry ? entry.contentLen : 0,
    revision: entry ? entry.revision ? entry.revision : "" : ""
  };
}

// runtime_skill_active_count() + the byte accounting the C does before apply.
function activeView(skillState) {
  const registry = skillState.registry;
  const builtins = [...skillState.entries.values()].map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    loaded: true,
    bytes: entry.contentLen,
    revision: entry.revision
  }));
  const dynamic = (registry ? registry.list() : []).map((entry) => ({
    name: entry.name,
    kind: SKILL_KIND.DYNAMIC,
    loaded: true,
    bytes: entry.bytes,
    revision: entry.revision
  }));
  const all = [...builtins, ...dynamic];
  const count = all.length;
  const bytes = all.reduce((sum, entry) => sum + entry.bytes, 0);
  return { count, bytes, all };
}

// runtime_skill_aggregate_revision(): the manifest is always buildable in
// JS (sessions are in-memory), so this only reports healthy.
function aggregateRevision(skillState) {
  const { all } = activeView(skillState);
  all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return aggregateRevisionOf(
    all.map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      contentLen: entry.bytes,
      revision: entry.revision
    }))
  );
}

function activeCount(skillState) {
  return activeView(skillState).count;
}

// runtime_autonomous_math_mode_conflicts(): JS has no autonomous fragment
// (fragmentLoaded is always false), so the conflict cannot arise; kept where
// the C checks it so a future autonomous mode finds the gate in place.
function authoritativeMathModeConflicts(_skillState, _kind) {
  return false;
}

// ------------------------------------------------------------------ results

function okResult(command, message, data) {
  return {
    ok: true,
    status: 200,
    payload: { ok: true, command: "skill", message, data, active: true }
  };
}

function failResult(status, code, message) {
  return {
    ok: false,
    status,
    payload: {
      ok: false,
      command: "skill",
      message: `${code}: ${message}`,
      code,
      active: true
    }
  };
}

function failSkillError(error) {
  const message = error instanceof SkillError
    ? error.message
    : `SKILL_IO_FAILED: ${error?.message || "skill operation failed"}`;
  const code = error instanceof SkillError ? error.code : "SKILL_IO_FAILED";
  return failResult(skillErrorStatus(message), code,
    message.slice(code.length + 2) || "skill operation failed");
}

// runtime_skill_set_result()
function setResult(skillState, { action, name }, kind, available, loaded,
  changed, repaired, bytes, revision) {
  const coherent = true; // no policy-revision drift in the JS loop
  const manifestHealthy = true; // in-memory session: nothing to save
  const operational = loaded && coherent && manifestHealthy;
  const promptMode = !loaded ? "none" : "base"; // no autonomous fragments
  const orchestrationEnabled = false;
  const data = {
    action,
    name,
    kind: skillKindName(kind),
    available,
    loaded,
    changed,
    coherent,
    operational,
    repaired,
    manifestHealthy,
    degraded: loaded && !operational,
    errorCode: "",
    retryable: false,
    bytes,
    revision: revision || "",
    active_count: activeCount(skillState),
    aggregate_revision: aggregateRevision(skillState),
    promptMode,
    fragmentLoaded: false,
    assembledRevision: revision || "",
    orchestrationEnabled,
    finalizationGateEnabled: false,
    publicationGateEnabled: false,
    revalidationEnabled: false
  };
  const message = `Skill ${name} is ${
    !loaded ? "inactive" : operational ? "active" : "loaded but not operational"
  }${changed ? " (state changed)" : ""}${repaired ? " (repaired)" : ""}.`;
  return okResult("skill", message, data);
}

// runtime_skill_list()
function listResult(skillState) {
  const { all } = activeView(skillState);
  const skills = all
    .map((entry) => ({
      name: entry.name,
      kind: skillKindName(entry.kind),
      loaded: true,
      revision: entry.revision,
      bytes: entry.bytes
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return okResult("list", "Active skill state.", {
    action: "list",
    active_count: all.length,
    aggregate_revision: aggregateRevision(skillState),
    manifestHealthy: true,
    skills
  });
}

// ------------------------------------------------------------------ apply

// runtime_apply_skill_command()
function applySkillCommand(skillState, command, genericSyntax, env, sessionActive) {
  if (genericSyntax && env?.DS4_AGENT_DYNAMIC_SKILLS === "0") {
    return failResult(409, "DYNAMIC_SKILLS_DISABLED", "Dynamic skills are disabled.");
  }
  if (!sessionActive) {
    return failResult(409, "AGENT_MODE_REQUIRED", "The /skill command requires Agent Mode.");
  }

  if (command.action === "list") return listResult(skillState);

  const kind = BUILTIN_KIND_BY_NAME.get(command.name) ?? SKILL_KIND.DYNAMIC;
  if (command.action === "start" && authoritativeMathModeConflicts(skillState, kind)) {
    return failResult(409, "AUTHORITATIVE_MATH_MODE_CONFLICT",
      "Lean and Sage autonomous policies cannot be active together.");
  }

  let before = skillStateOf(skillState, command.name, kind);

  if (command.action === "status") {
    // C stages from disk only to answer "available"; the entry is freed.
    let available = false;
    try {
      stageSkill(skillState.skillsDir, command.name, kind);
      available = true;
    } catch {
      available = false;
    }
    return setResult(skillState, command, kind, available, before.loaded,
      false, false, before.bytes, before.revision);
  }

  let repairing = false;
  if (command.action === "start") {
    let staged;
    try {
      staged = stageSkill(skillState.skillsDir, command.name, kind);
    } catch (error) {
      return failSkillError(error);
    }
    const sameContent = before.revision !== "" && staged.revision === before.revision;
    const coherentNow = true; // no drift in the JS loop
    if (before.loaded && sameContent && coherentNow) {
      return setResult(skillState, command, kind, true, true, false, false,
        before.bytes, before.revision);
    }
    // repairing = loaded && sameContent && !coherentNow: impossible in JS.
    repairing = false;

    const { bytes } = activeView(skillState);
    if (!before.loaded && activeCount(skillState) >= SKILL_ACTIVE_MAX) {
      return failResult(409, "SKILL_ACTIVE_LIMIT", "at most 32 skills may be active");
    }
    const replaced = before.loaded ? before.bytes : 0;
    const retained = bytes > replaced ? bytes - replaced : 0;
    if (staged.contentLen > SKILL_TOTAL_MAX ||
      retained > SKILL_TOTAL_MAX - staged.contentLen) {
      return failResult(413, "SKILL_TOTAL_TOO_LARGE", "active skills exceed 1 MiB");
    }
    if (kind === SKILL_KIND.DYNAMIC) {
      ensureRegistry(skillState).upsert(staged);
      syncDynamicRender(skillState);
    } else {
      skillState.entries.set(command.name, staged);
    }
  } else if (!before.loaded) {
    // Stop of an inactive skill: idempotent success, as in the C.
    return setResult(skillState, command, kind, false, false, false, false, 0, "");
  } else if (kind === SKILL_KIND.DYNAMIC) {
    ensureRegistry(skillState).remove(command.name);
    syncDynamicRender(skillState);
  } else {
    skillState.entries.delete(command.name);
  }

  before = skillStateOf(skillState, command.name, kind);
  skillState.markSyspromptDirty();
  return setResult(skillState, command, kind,
    command.action === "start", before.loaded, true, repairing,
    before.bytes, before.revision);
}

// ------------------------------------------------------------------ entry

// handleAgentSlashCommand({ message, session, skillState, env }) ->
//   { ok, status, payload } ready for nativeCommandEvents(payload, ok).
//
// `session` is the AgentSessionManager (or null); `skillState` comes from
// agentSkillStateFor(sessionKey).  The route already answers 400 JSON when
// Agent Mode is off, so AGENT_MODE_REQUIRED mainly guards direct callers.
export function handleAgentSlashCommand({ message, session, skillState, env = {} } = {}) {
  const parsed = parseAgentSlashCommand(message);
  if (!parsed) {
    return failResult(400, "SLASH_COMMAND_UNSUPPORTED",
      "this slash command is not supported by the JS agent loop");
  }

  if (LEGACY_ALIASES.has(parsed.kind)) {
    const name = LEGACY_ALIASES.get(parsed.kind);
    // C intercepts /lean preflight before the generic skill parser; the JS
    // loop does not implement the preflight probe yet (declared deviation).
    if (name === "lean" && parsed.arg === "preflight") {
      return failResult(501, "NOT_IMPLEMENTED_YET",
        "/lean preflight is served by the native agent loop for now");
    }
    return applyLegacy(skillState, name, parsed.arg, env, session);
  }

  if (parsed.kind === "skill") {
    if (!skillState) {
      return failResult(500, "SKILL_IO_FAILED", "skill state unavailable");
    }
    let command;
    try {
      command = parseSkillCommandArg(parsed.arg);
    } catch (error) {
      return failSkillError(error);
    }
    return applySkillCommand(skillState, command, true, env, Boolean(session?.active));
  }

  if (parsed.kind === "think") {
    if (parsed.arg && !/^(?:100|[1-9]?\d)$/.test(parsed.arg)) {
      return {
        ok: false,
        status: 400,
        payload: {
          ok: false,
          command: "think",
          message: "usage: /think [0..100] (V4.1 only)",
          active: Boolean(session?.active)
        }
      };
    }
    if (!session?.active) {
      return {
        ok: false,
        status: 409,
        payload: {
          ok: false,
          command: "think",
          message: "AGENT_MODE_REQUIRED: /think requires Agent Mode",
          active: false
        }
      };
    }
    session.thinkMode = parsed.arg || "high";
    return {
      ok: true,
      status: 200,
      payload: {
        ok: true,
        command: "think",
        message: `Thinking effort set to ${session.thinkMode}; applies to the next agent turn.`,
        active: true
      }
    };
  }

  // Deferred session verbs (WP8/WP9) and the remaining C verbs: an explicit
  // error, never a model turn.
  return failResult(501, "NOT_IMPLEMENTED_YET",
    `/${parsed.kind} is handled by the native agent loop until WP8/WP9 of convergenza.loop.md`);
}

// runtime_apply_legacy_skill_command(): combine "<name> <arg>" and reuse the
// generic parser with generic_syntax = false.
function applyLegacy(skillState, name, arg, env, session) {
  if (!skillState) {
    return failResult(500, "SKILL_IO_FAILED", "skill state unavailable");
  }
  let command;
  try {
    command = parseSkillCommandArg(`${name} ${arg || ""}`);
  } catch (error) {
    return failSkillError(error);
  }
  return applySkillCommand(skillState, command, false, env, Boolean(session?.active));
}
