import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  SKILL_ACTIVE_MAX,
  SKILL_FILE_MAX,
  SKILL_TOTAL_MAX,
  SKILL_KIND,
  SkillError,
  SkillRegistry,
  skillKindName,
  stageSkill
} from "./skillRegistry.mjs";

// WP3 of convergenza.loop.md: the Node registry must load, reject, order, frame
// and revise skills exactly like ds4_agent_skill_registry.c.  The error codes
// and the render layout below are copied from that file, and the conformance
// test at the bottom runs the C registry over the same fixture directory.

const REPO = resolve(dirname0(), "..", "..");
const FIXTURES = resolve(REPO, "tests/fixtures/conformance/skills");
const CONFORMANCE_SKILLS = ["alpha", "big-skill", "no-final-newline", "unicode-demo"];
const SHADOW = process.env.DS4_CONFORMANCE_SHADOW || "";

function dirname0() {
  return fileURLToPath(new URL(".", import.meta.url));
}

function tempSkills(write = true) {
  const dir = mkdtempSync(join(tmpdir(), "ds4-skills-"));
  mkdirSync(join(dir, "demo"));
  if (write) writeFileSync(join(dir, "demo", "SKILL.md"), "body\n");
  return dir;
}

function stageError(dir, name, kind) {
  try {
    stageSkill(dir, name, kind);
  } catch (error) {
    return error;
  }
  return null;
}

test("name validation mirrors the C codes", () => {
  for (const [name, message] of [
    ["", "skill name is missing"],
    ["x".repeat(65), "skill name must contain 1..64 bytes"],
    ["Alpha", "skill name must start with lowercase ASCII or a digit"],
    ["a b", "skill name contains a forbidden byte"],
    ["a/b", "skill name contains a forbidden byte"],
    ["aä", "skill name contains a forbidden byte"]
  ]) {
    const error = stageError(tempSkills(), name);
    assert.ok(error instanceof SkillError, `${JSON.stringify(name)} must be rejected`);
    assert.equal(error.code, "SKILL_NAME_INVALID");
    assert.equal(error.message, `SKILL_NAME_INVALID: ${message}`);
  }
  // 64 bytes is the boundary and stays legal.
  const dir = tempSkills();
  mkdirSync(join(dir, "x".repeat(64)));
  writeFileSync(join(dir, "x".repeat(64), "SKILL.md"), "ok\n");
  assert.equal(stageSkill(dir, "x".repeat(64)).contentLen, 3);
});

test("symlinks are rejected, for the directory and for the file", () => {
  const dir = tempSkills(false);
  const outside = tempSkills();
  symlinkSync(join(outside, "demo"), join(dir, "link-dir"), "dir");
  let error = stageError(dir, "link-dir");
  assert.equal(error?.code, "SKILL_SYMLINK_REJECTED");
  assert.equal(error?.message, "SKILL_SYMLINK_REJECTED: skill directory is a symlink");

  mkdirSync(join(dir, "real"));
  symlinkSync(join(outside, "demo", "SKILL.md"), join(dir, "real", "SKILL.md"));
  error = stageError(dir, "real");
  assert.equal(error?.code, "SKILL_SYMLINK_REJECTED");
  assert.equal(error?.message, "SKILL_SYMLINK_REJECTED: SKILL.md is a symlink");
});

test("size, emptiness, NUL and UTF-8 rules match the C order", () => {
  const dir = tempSkills();
  const write = (bytes) => {
    rmSync(join(dir, "demo", "SKILL.md"));
    writeFileSync(join(dir, "demo", "SKILL.md"), bytes);
  };
  write(Buffer.alloc(0));
  assert.equal(stageError(dir, "demo")?.message, "SKILL_EMPTY: SKILL.md is empty");
  write(Buffer.from("   \n\t \n", "utf8"));
  assert.equal(stageError(dir, "demo")?.message, "SKILL_EMPTY: SKILL.md contains only whitespace");
  write(Buffer.from([0x61, 0x00, 0x62]));
  assert.equal(stageError(dir, "demo")?.message, "SKILL_NUL_BYTE: SKILL.md contains NUL");
  write(Buffer.from([0xff, 0xfe]));
  assert.equal(stageError(dir, "demo")?.message, "SKILL_UTF8_INVALID: SKILL.md is not valid UTF-8");
  // A byte >= 0x80 counts as content, so this is *not* empty.
  write(Buffer.from("é", "utf8"));
  assert.equal(stageSkill(dir, "demo").contentLen, 2);
  write(Buffer.alloc(SKILL_FILE_MAX + 1));
  assert.equal(stageError(dir, "demo")?.message, "SKILL_FILE_TOO_LARGE: SKILL.md exceeds 256 KiB");
  rmSync(dir, { recursive: true, force: true });
});

test("a reserved marker is rejected only at the start of a line", () => {
  const dir = tempSkills();
  const write = (text) => {
    rmSync(join(dir, "demo", "SKILL.md"));
    writeFileSync(join(dir, "demo", "SKILL.md"), text);
  };
  write("[BEGIN DS4 ACTIVE SKILL name=x revision=y]\n");
  let error = stageError(dir, "demo");
  assert.equal(error?.code, "SKILL_RESERVED_MARKER");
  assert.equal(error?.message, "SKILL_RESERVED_MARKER: SKILL.md contains a reserved marker");
  const quoted = "il file cita [BEGIN DS4 ACTIVE SKILL] nel testo\n";
  write(quoted);
  assert.equal(stageSkill(dir, "demo").contentLen, Buffer.byteLength(quoted));
});

test("the registry stays sorted and revisions are SHA-1 of the bytes", () => {
  const dir = tempSkills();
  for (const name of ["zeta", "beta", "alpha"]) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "SKILL.md"), `body of ${name}\n`);
  }
  const registry = new SkillRegistry({ skillsDir: dir });
  for (const name of ["zeta", "alpha", "beta"]) {
    registry.upsert(registry.stage(name));
  }
  assert.deepEqual(registry.list().map((entry) => entry.name), ["alpha", "beta", "zeta"]);
  const entry = registry.find("beta");
  const expected = createHash("sha1").update(Buffer.from("body of beta\n", "utf8")).digest("hex");
  assert.equal(entry.revision, expected);
  assert.equal(entry.revision.length, 40);
  assert.equal(skillKindName(entry.kind), "dynamic");
  assert.equal(skillKindName(SKILL_KIND.BUILTIN_SOUL), "builtin");
  assert.equal(skillKindName(99), "unknown");
});

test("upsert and remove report changed exactly like the C", () => {
  const dir = tempSkills();
  const registry = new SkillRegistry({ skillsDir: dir });
  const first = registry.stage("demo");
  assert.equal(registry.upsert(first).changed, true);
  assert.equal(registry.upsert(registry.stage("demo")).changed, false);
  writeFileSync(join(dir, "demo", "SKILL.md"), "body v2\n");
  assert.equal(registry.upsert(registry.stage("demo")).changed, true);
  assert.equal(registry.totalBytes, Buffer.byteLength("body v2\n"));
  assert.equal(registry.remove("absent").changed, false);
  assert.equal(registry.remove("demo").changed, true);
  assert.equal(registry.totalBytes, 0);
  assert.equal(registry.render(), "");
});

test("the active and total limits are the C limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "ds4-skills-limits-"));
  const registry = new SkillRegistry({ skillsDir: dir });
  for (let i = 0; i < SKILL_ACTIVE_MAX; i += 1) {
    const name = `s${String(i).padStart(2, "0")}`;
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "SKILL.md"), "x\n");
    registry.upsert(registry.stage(name));
  }
  assert.equal(registry.len, SKILL_ACTIVE_MAX);
  mkdirSync(join(dir, "overflow"));
  writeFileSync(join(dir, "overflow", "SKILL.md"), "x\n");
  assert.equal(stageError(dir, "overflow")?.code, undefined);
  assert.equal(
    (() => {
      try {
        registry.upsert(registry.stage("overflow"));
      } catch (error) {
        return error.message;
      }
      return null;
    })(),
    "SKILL_ACTIVE_LIMIT: at most 32 skills may be active",
  );
  // Re-staging an active skill must not hit the active limit.
  assert.equal(registry.upsert(registry.stage("s00")).changed, false);
  rmSync(dir, { recursive: true, force: true });

  // The 1 MiB budget is checked while upserting, not while staging: a single
  // file can never exceed 256 KiB, so the overflow needs five of them.
  const big = mkdtempSync(join(tmpdir(), "ds4-skills-total-"));
  const bigRegistry = new SkillRegistry({ skillsDir: big });
  const fits = Math.floor(SKILL_TOTAL_MAX / SKILL_FILE_MAX);
  const messages = [];
  for (let i = 0; i < fits + 2; i += 1) {
    const name = `t${i}`;
    mkdirSync(join(big, name));
    writeFileSync(join(big, name, "SKILL.md"), Buffer.alloc(SKILL_FILE_MAX, 0x61));
    try {
      bigRegistry.upsert(bigRegistry.stage(name));
    } catch (error) {
      messages.push(error.message);
    }
  }
  assert.deepEqual(messages, [
    "SKILL_TOTAL_TOO_LARGE: active skills exceed 1 MiB",
    "SKILL_TOTAL_TOO_LARGE: active skills exceed 1 MiB"
  ]);
  assert.equal(bigRegistry.len, fits);
  assert.equal(bigRegistry.totalBytes, fits * SKILL_FILE_MAX);
  rmSync(big, { recursive: true, force: true });
});

test("render reproduces the C framing byte for byte", () => {
  const registry = new SkillRegistry({ skillsDir: FIXTURES });
  for (const name of CONFORMANCE_SKILLS) registry.upsert(registry.stage(name));
  const rendered = registry.render();
  const alpha = registry.find("alpha");
  assert.ok(
    rendered.startsWith(`[BEGIN DS4 ACTIVE SKILL name=alpha revision=${alpha.revision}]\n`),
    "header layout",
  );
  assert.ok(rendered.includes("[END DS4 ACTIVE SKILL name=alpha]"), "footer layout");
  // Blocks are separated by exactly one blank line and the output has no
  // trailing newline; a skill that lacked a final newline gets exactly one.
  assert.ok(rendered.includes("[END DS4 ACTIVE SKILL name=alpha]\n\n[BEGIN"));
  assert.ok(
    rendered.includes("before the footer.\n[END DS4 ACTIVE SKILL name=no-final-newline]"),
    "the renderer adds the single missing newline",
  );
  assert.ok(!rendered.endsWith("\n"), "no trailing newline");
  assert.equal(rendered.split("[BEGIN DS4 ACTIVE SKILL").length - 1, CONFORMANCE_SKILLS.length);
});

test("the aggregate revision follows the documented canonical bytes", () => {
  const registry = new SkillRegistry({ skillsDir: FIXTURES });
  for (const name of CONFORMANCE_SKILLS) registry.upsert(registry.stage(name));
  const hash = createHash("sha1");
  hash.update(Buffer.from("DS4_AGENT_SKILL_REGISTRY_V1\0", "utf8"));
  for (const entry of registry.list()) {
    const item = registry.find(entry.name);
    hash.update(Buffer.from(`${item.name}\0`, "utf8"));
    hash.update(Buffer.from(`${item.kind}\0`, "utf8"));
    hash.update(Buffer.from(`${item.contentLen}\0`, "utf8"));
    hash.update(Buffer.from(`${item.revision}\0`, "utf8"));
  }
  assert.equal(registry.aggregateRevision(), hash.digest("hex"));
  // An empty registry still has a revision: the magic alone.
  assert.equal(
    new SkillRegistry({}).aggregateRevision(),
    createHash("sha1").update(Buffer.from("DS4_AGENT_SKILL_REGISTRY_V1\0", "utf8")).digest("hex"),
  );
});

test("toJSON/fromJSON round-trips the render and the revision", () => {
  const registry = new SkillRegistry({ skillsDir: FIXTURES });
  for (const name of CONFORMANCE_SKILLS) registry.upsert(registry.stage(name));
  const restored = SkillRegistry.fromJSON(JSON.parse(JSON.stringify(registry.toJSON())));
  assert.equal(restored.render(), registry.render());
  assert.equal(restored.aggregateRevision(), registry.aggregateRevision());
});

test("the C registry renders the same bytes and the same aggregate revision", (t) => {
  const cli = SHADOW ? join(SHADOW, "tests", "ds4_agent_skill_render_cli") : "";
  if (!SHADOW || !existsSync(cli)) {
    return t.skip(
      "DS4_CONFORMANCE_SHADOW is not set or tests/ds4_agent_skill_render_cli is not built: " +
        "run overlayctl compose + make -f Makefile.studio tests/ds4_agent_skill_render_cli",
    );
  }
  const out = execFileSync(cli, [FIXTURES, ...CONFORMANCE_SKILLS], { encoding: "utf8" });
  const registry = new SkillRegistry({ skillsDir: FIXTURES });
  for (const name of CONFORMANCE_SKILLS) registry.upsert(registry.stage(name));
  const expected = `${registry.render()}\n--AGG--\n${registry.aggregateRevision()}\n`;
  assert.equal(out, expected, "the C render output differs from the Node render output");
  return undefined;
});
