// WP9 of convergenza.loop.md: JS session persistence and session commands.
//
// The identity hash copies agent_session_identity_sha (studio/ds4_agent.c of
// the composed shadow, line 6806): SHA-1 over the title bytes followed by the
// 8-byte little-endian created_at.  The revision rule copies
// agent_worker_stage_manifest_skills (8212-8266): a changed revision refuses
// the switch, except for the Lean policy, which adopts the current text and
// reports drift.  The C KV files are never read: this is a JS-only format.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHash } from "node:crypto";

import {
  sessionIdentitySha,
  saveSession,
  listSessions,
  loadSession,
  restoreSessionSkills
} from "./agentSessionPersistence.mjs";
import { createSessionSkillState } from "./agentSystemText.mjs";
import { stageSkill, SkillRegistry, SKILL_KIND } from "./skillRegistry.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agent-sess-"));
  const skills = join(root, "skills");
  mkdirSync(skills, { recursive: true });
  const write = (name, body) => {
    mkdirSync(join(skills, name), { recursive: true });
    writeFileSync(join(skills, name, "SKILL.md"), body);
  };
  write("alpha", "# alpha one\n");
  write("lean", "# lean policy one\n");
  const dir = join(root, "js-sessions");
  return { root, skills, dir };
}

function skillStateWith(skills, names) {
  const state = createSessionSkillState({ env: { DS4_SKILL_AUTO: "0" }, skillsDir: skills });
  state.registry = new SkillRegistry({ skillsDir: skills });
  for (const name of names) {
    state.registry.upsert(stageSkill(skills, name));
  }
  state.dynamic = state.registry.render() || null;
  return state;
}

const BUILTIN_KINDS = {
  soul: SKILL_KIND.BUILTIN_SOUL,
  ethic: SKILL_KIND.BUILTIN_ETHIC,
  structure: SKILL_KIND.BUILTIN_STRUCTURE,
  sage: SKILL_KIND.BUILTIN_SAGE_POLICY,
  lean: SKILL_KIND.BUILTIN_LEAN_POLICY
};

function docFrom(skills, dir, names = ["alpha"], title = "work session") {
  const state = createSessionSkillState({ env: { DS4_SKILL_AUTO: "0" }, skillsDir: skills });
  state.registry = new SkillRegistry({ skillsDir: skills });
  const skillRevisions = {};
  const flags = { defaults: false, sage: false, lean: false };
  for (const name of names) {
    const kind = BUILTIN_KINDS[name] ?? SKILL_KIND.DYNAMIC;
    const entry = stageSkill(skills, name, kind);
    if (kind === SKILL_KIND.DYNAMIC) state.registry.upsert(entry);
    else state.entries.set(name, entry);
    skillRevisions[name] = entry.revision;
    if (name === "lean") flags.lean = true;
    if (name === "sage") flags.sage = true;
  }
  return saveSession({
    dir,
    title,
    createdAt: 1700000000000,
    savedAt: 1700000001000,
    messages: [{ role: "user", content: "ciao" }],
    skills: { registry: state.registry.toJSON(), ...flags },
    skillRevisions,
    evidence: null
  });
}

// ---------------------------------------------------------------- identity

test("sessionIdentitySha follows the C layout", () => {
  const sha = sessionIdentitySha("work session", 1700000000000);
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(sha, sessionIdentitySha("work session", 1700000000000)); // stable
  assert.notEqual(sha, sessionIdentitySha("other title", 1700000000000));
  assert.notEqual(sha, sessionIdentitySha("work session", 1700000000001));
  // The C hashes title bytes + the 8-byte little-endian timestamp: pin the
  // exact SHA-1 of a known vector so a wrong layout cannot pass.
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(42n);
  const expected = createHash("sha1").update(Buffer.from("t", "utf8")).update(buf).digest("hex");
  assert.equal(sessionIdentitySha("t", 42), expected);
});

// ---------------------------------------------------------------- save/list

test("save writes <sha>.json atomically and list reads it back", () => {
  const { skills, dir } = fixture();
  const saved = docFrom(skills, dir);
  assert.match(saved.sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(readdirSync(dir), [`${saved.sha}.json`]); // no tmp leftovers
  const onDisk = JSON.parse(readFileSync(join(dir, `${saved.sha}.json`), "utf8"));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.title, "work session");
  assert.equal(onDisk.evidence, null);
  assert.ok(onDisk.skillRevisions.alpha);

  // Same identity overwrites the same file (the C session is stable).
  docFrom(skills, dir);
  assert.equal(readdirSync(dir).filter((f) => f.endsWith(".json")).length, 1);

  docFrom(skills, dir, [], "second session");
  const listed = listSessions({ dir });
  assert.equal(listed.length, 2);
  assert.ok(listed.every((s) => s.short.length === 8));
  assert.ok(listed.every((s) => s.tokens > 0));
  const titles = listed.map((s) => s.title);
  assert.ok(titles.includes("work session") && titles.includes("second session"));
  // newest savedAt first
  for (let i = 1; i < listed.length; i += 1) {
    assert.ok(listed[i - 1].savedAt >= listed[i].savedAt);
  }
});

// ---------------------------------------------------------------- switch

test("load by unique prefix, refuse ambiguous and unknown", () => {
  const { skills, dir } = fixture();
  const saved = docFrom(skills, dir);
  const loaded = loadSession({ dir, prefix: saved.sha.slice(0, 6) });
  assert.equal(loaded.sha, saved.sha);
  assert.deepEqual(loaded.messages, [{ role: "user", content: "ciao" }]);

  // A deterministic ambiguity: brute-force two createdAt values whose shas
  // share the first hex digit (expected ~16 tries each).
  const findCreatedAt = (title, first) => {
    for (let i = 0; i < 65536; i += 1) {
      if (sessionIdentitySha(title, i).startsWith(first)) return i;
    }
    throw new Error("no createdAt found");
  };
  saveSession({ dir, title: "aaa", createdAt: findCreatedAt("aaa", "0"), savedAt: 1, messages: [{ role: "user", content: "x" }] });
  saveSession({ dir, title: "bbb", createdAt: findCreatedAt("bbb", "0"), savedAt: 2, messages: [{ role: "user", content: "y" }] });
  assert.throws(() => loadSession({ dir, prefix: "0" }), {
    code: "SESSION_PREFIX_AMBIGUOUS"
  });
  assert.throws(() => loadSession({ dir, prefix: "ffffffff" }), {
    code: "SESSION_NOT_FOUND"
  });
});

test("a malformed file is an explicit error", () => {
  const { dir } = fixture();
  mkdirSync(dir, { recursive: true });
  const fake = "0".repeat(40);
  writeFileSync(join(dir, `${fake}.json`), "{ this is not json");
  assert.throws(() => loadSession({ dir, prefix: fake.slice(0, 4) }), {
    code: "SESSION_FILE_INVALID"
  });
  // list must not die on it either, it just skips the unreadable entry
  assert.deepEqual(listSessions({ dir }), []);
});

// ---------------------------------------------------------------- skills

test("switch refuses a changed skill revision, lean drift only warns", () => {
  const { skills, dir } = fixture();
  const saved = docFrom(skills, dir, ["alpha", "lean"]);

  // Edit both skills on disk.
  writeFileSync(join(skills, "alpha", "SKILL.md"), "# alpha CHANGED\n");
  writeFileSync(join(skills, "lean", "SKILL.md"), "# lean CHANGED\n");

  const fresh = createSessionSkillState({ env: { DS4_SKILL_AUTO: "0" }, skillsDir: skills });
  const doc = loadSession({ dir, prefix: saved.sha.slice(0, 6) });
  assert.throws(
    () => restoreSessionSkills({ skillState: fresh, doc, skillsDir: skills }),
    { code: "SKILL_SESSION_REVISION_MISMATCH", message: /skill alpha changed/ }
  );
  // The failed restore left the fresh state untouched.
  assert.equal(fresh.registry ? fresh.registry.list().length : 0, 0);

  // Only lean changed: the session adopts the current text with a warning.
  const leanOnly = docFrom(skills, dir, ["lean"], "lean session");
  writeFileSync(join(skills, "lean", "SKILL.md"), "# lean CHANGED AGAIN\n");
  const state2 = createSessionSkillState({ env: { DS4_SKILL_AUTO: "0" }, skillsDir: skills });
  const doc2 = loadSession({ dir, prefix: leanOnly.sha.slice(0, 6) });
  const result = restoreSessionSkills({ skillState: state2, doc: doc2, skillsDir: skills });
  assert.equal(result.leanPromptDrifted, true);
  assert.match(result.warnings.join("\n"), /skill lean changed/);
  // The session adopted the current revision, not the saved one.
  const adopted = state2.entries.get("lean");
  assert.equal(adopted.revision, stageSkill(skills, "lean", SKILL_KIND.BUILTIN_LEAN_POLICY).revision);
});
