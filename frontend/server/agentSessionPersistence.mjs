// WP9 of convergenza.loop.md: JS session persistence and session commands.
//
// The C KV files are never read and never written here: the JS loop gets its
// own format (plan §12).  What is copied from the C is the observable
// contract:
//   - agent_session_identity_sha (studio/ds4_agent.c:6806-6816): SHA-1 over
//     the title bytes followed by the 8-byte little-endian created_at;
//   - agent_worker_stage_manifest_skills (8212-8266): re-stage every saved
//     skill from disk; a changed revision refuses the switch, except for the
//     Lean policy, which adopts the current text and reports drift.  The C
//     comment is explicit that the relaxation is "deliberately not extended
//     to any other skill";
//   - the /save, /list and /switch message shapes of ds4_agent_runtime.c
//     ("Saved session %.8s (%d tokens).", "Saved sessions.", "Switched to
//     session %.8s.").
//
// Declared deviations:
//   - config.mjs has no cache_dir/kvCacheDir key, so the directory falls back
//     to data/agent-sessions, exactly as the plan's "se non esiste" branch
//     prescribes; DS4_AGENT_SESSIONS_DIR overrides for tests;
//   - evidence is stored as null and restored with finalize invalid: the
//     ledger itself arrives with WP10;
//   - listSessions skips unreadable files instead of failing the listing;
//     loadSession refuses them with an explicit code.

import {
  mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, openSync, fsyncSync, closeSync
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { SkillError, SkillRegistry, stageSkill, SKILL_KIND } from "./skillRegistry.mjs";
import { estimateMessagesTokens } from "./agentSystemReminder.mjs";

export const SESSION_DOC_VERSION = 1;
const SHA_NAME = /^[0-9a-f]{40}\.json$/;

// AGENT_BUILTIN_SKILLS names (metacognition, soul, ethic, structure, sage,
// lean): a saved skill with one of these names is always re-staged as its
// builtin kind, whatever the document claims, like the C manifest check.
const BUILTIN_KIND_BY_NAME = new Map([
  ["metacognition", SKILL_KIND.BUILTIN_METACOGNITION],
  ["soul", SKILL_KIND.BUILTIN_SOUL],
  ["ethic", SKILL_KIND.BUILTIN_ETHIC],
  ["structure", SKILL_KIND.BUILTIN_STRUCTURE],
  ["sage", SKILL_KIND.BUILTIN_SAGE_POLICY],
  ["lean", SKILL_KIND.BUILTIN_LEAN_POLICY]
]);

export function sessionsDir(config = {}, env = process.env) {
  // Plan §12: the wrapper's cache dir if the config ever grows one, else the
  // prescribed fallback.
  return config?.agent?.sessionsDir
    || env?.DS4_AGENT_SESSIONS_DIR
    || "data/agent-sessions";
}

// agent_session_identity_sha(): title bytes + 8-byte little-endian created_at.
export function sessionIdentitySha(title, createdAt) {
  const hash = createHash("sha1");
  hash.update(Buffer.from(title || "", "utf8"));
  const ts = Buffer.alloc(8);
  let value = BigInt(createdAt ?? 0);
  if (value < 0n) value = 0n; // C stores unsigned 64-bit timestamps
  ts.writeBigUInt64LE(value);
  hash.update(ts);
  return hash.digest("hex");
}

// Atomic write in one directory: temp file, fsync, rename.
function writeJsonAtomic(path, doc) {
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, JSON.stringify(doc, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch {}
    throw error;
  }
}

// saveSession({ dir, title, createdAt, savedAt, messages, skills, skillRevisions, evidence })
// -> { sha, path, tokens }
export function saveSession({
  dir,
  title = "",
  createdAt,
  savedAt = Date.now(),
  messages = [],
  skills = { registry: { version: 1, aggregateRevision: "", skills: [] }, defaults: false, sage: false, lean: false },
  skillRevisions = {},
  evidence = null
} = {}) {
  const sha = sessionIdentitySha(title, createdAt);
  const doc = {
    version: SESSION_DOC_VERSION,
    sha,
    title,
    createdAt,
    savedAt,
    messages,
    skills,
    evidence,
    skillRevisions
  };
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sha}.json`);
  writeJsonAtomic(path, doc);
  return { sha, path, tokens: estimateMessagesTokens(messages) };
}

function sessionFiles(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => SHA_NAME.test(name));
}

// /list: short ids, title, estimated tokens, date, newest savedAt first.
// Unreadable files are skipped (listing must stay usable).
export function listSessions({ dir } = {}) {
  const items = [];
  for (const name of sessionFiles(dir)) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (doc?.version !== SESSION_DOC_VERSION || doc?.sha !== name.slice(0, 40)) continue;
    } catch {
      continue;
    }
    items.push({
      sha: doc.sha,
      short: doc.sha.slice(0, 8),
      title: doc.title || "(untitled)",
      tokens: estimateMessagesTokens(Array.isArray(doc.messages) ? doc.messages : []),
      createdAt: doc.createdAt,
      savedAt: doc.savedAt
    });
  }
  items.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  return items;
}

// /switch <prefix>: unique 40-hex prefix; explicit codes for the failures.
export function loadSession({ dir, prefix } = {}) {
  const needle = String(prefix || "").trim().toLowerCase();
  if (!/^[0-9a-f]{1,40}$/.test(needle)) {
    throw new SkillError("SESSION_NOT_FOUND", "session prefix must be hexadecimal");
  }
  const matches = sessionFiles(dir).filter((name) => name.startsWith(needle));
  if (!matches.length) throw new SkillError("SESSION_NOT_FOUND", `no session matches ${needle}`);
  if (matches.length > 1) {
    throw new SkillError("SESSION_PREFIX_AMBIGUOUS", `prefix ${needle} matches ${matches.length} sessions`);
  }
  const path = join(dir, matches[0]);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new SkillError("SESSION_FILE_INVALID", `session file ${matches[0]} is not readable`);
  }
  if (doc?.version !== SESSION_DOC_VERSION || doc?.sha !== matches[0].slice(0, 40) || !Array.isArray(doc.messages)) {
    throw new SkillError("SESSION_FILE_INVALID", `session file ${matches[0]} is not a valid session`);
  }
  return doc;
}

// restoreSessionSkills({ skillState, doc, skillsDir }): the manifest rule of
// agent_worker_stage_manifest_skills.  Everything is staged and validated
// before anything is applied, so a refusal leaves the live state untouched.
// -> { ok, warnings, leanPromptDrifted }
export function restoreSessionSkills({ skillState, doc, skillsDir: skillsDirPath } = {}) {
  const revisions = doc?.skillRevisions ?? {};
  const warnings = [];
  const staged = [];
  let leanPromptDrifted = false;

  for (const [name, savedRevision] of Object.entries(revisions)) {
    const kind = BUILTIN_KIND_BY_NAME.get(name) ?? SKILL_KIND.DYNAMIC;
    const entry = stageSkill(skillsDirPath, name, kind); // stage errors propagate like the C
    if (savedRevision && entry.revision !== savedRevision) {
      if (kind !== SKILL_KIND.BUILTIN_LEAN_POLICY) {
        throw new SkillError("SKILL_SESSION_REVISION_MISMATCH", `skill ${name} changed`);
      }
      // The one exception: adopt the current text, report the drift.
      warnings.push(`SKILL_SESSION_REVISION_MISMATCH: skill ${name} changed (adopted current text)`);
      leanPromptDrifted = true;
    }
    staged.push({ name, kind, entry });
  }

  // Apply: nothing below this line can fail on skill content.
  for (const { name, kind, entry } of staged) {
    if (kind === SKILL_KIND.DYNAMIC) {
      if (!skillState.registry) skillState.registry = new SkillRegistry({ skillsDir: skillsDirPath });
      skillState.registry.upsert(entry);
    } else {
      skillState.entries.set(name, entry);
    }
  }
  if (skillState.registry) {
    const rendered = skillState.registry.render();
    skillState.dynamic = rendered || null;
  }
  skillState.markSyspromptDirty?.();
  return { ok: true, warnings, leanPromptDrifted };
}
