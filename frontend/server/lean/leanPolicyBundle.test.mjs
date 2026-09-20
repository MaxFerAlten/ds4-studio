import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LEAN_AUTONOMOUS_BEGIN_MARKER,
  LEAN_AUTONOMOUS_END_MARKER,
  LEAN_AUTONOMOUS_FRAGMENT_NAME,
  composeLeanAutonomousBundle,
  getLeanPolicyState,
  invalidateLeanPolicyBundleCache,
  loadLeanPolicyBundle,
  resolveLeanPolicyMode,
} from "./leanPolicyBundle.mjs";

const SKILL = "# Lean policy\n\nUse lean_check.\n";
const FRAGMENT = "# Autonomous orchestration\n\nKeep going until checked.\n";

async function fixture({ skill = SKILL, fragment = FRAGMENT } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ds4-lean-bundle-"));
  await mkdir(join(root, "lean"), { recursive: true });
  if (skill !== null) await writeFile(join(root, "lean", "SKILL.md"), skill);
  if (fragment !== null) {
    await writeFile(join(root, "lean", LEAN_AUTONOMOUS_FRAGMENT_NAME), fragment);
  }
  return root;
}

const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");

test("base mode hashes SKILL.md verbatim, as the native loader does", async () => {
  const root = await fixture();
  const bundle = await loadLeanPolicyBundle({ mode: "base", skillsDir: root, force: true });
  assert.equal(bundle.loaded, true);
  assert.equal(bundle.mode, "base");
  assert.equal(bundle.prompt, SKILL);
  assert.equal(bundle.revision, sha1(Buffer.from(SKILL)));
  assert.equal(bundle.stale, false);
  assert.equal(bundle.components.length, 1);
  await rm(root, { recursive: true, force: true });
});

// The exact byte sequence from ds4_agent_skill_registry.c. Written out here
// rather than reusing composeLeanAutonomousBundle so a change to the composer is
// a test failure, not a silently agreeing test.
test("autonomous mode composes the marker-delimited assembly byte for byte", async () => {
  const root = await fixture();
  const bundle = await loadLeanPolicyBundle({
    mode: "autonomous",
    skillsDir: root,
    force: true,
  });

  const expected =
    SKILL +
    "\n\n" +
    LEAN_AUTONOMOUS_BEGIN_MARKER +
    "\n" +
    FRAGMENT +
    "\n" +
    LEAN_AUTONOMOUS_END_MARKER +
    "\n";

  assert.equal(bundle.prompt, expected);
  assert.equal(bundle.revision, sha1(Buffer.from(expected, "utf8")));
  assert.equal(bundle.components.length, 2);
  assert.notEqual(bundle.revision, sha1(Buffer.from(SKILL)), "base and autonomous must differ");
  await rm(root, { recursive: true, force: true });
});

test("the composer and the loader agree", async () => {
  const root = await fixture();
  const bundle = await loadLeanPolicyBundle({ mode: "autonomous", skillsDir: root, force: true });
  assert.equal(
    bundle.revision,
    sha1(composeLeanAutonomousBundle(SKILL, FRAGMENT))
  );
  await rm(root, { recursive: true, force: true });
});

test("both modes are deterministic across loads", async () => {
  const root = await fixture();
  for (const mode of ["base", "autonomous"]) {
    const a = await loadLeanPolicyBundle({ mode, skillsDir: root, force: true });
    const b = await loadLeanPolicyBundle({ mode, skillsDir: root, force: true });
    assert.equal(a.revision, b.revision);
  }
  await rm(root, { recursive: true, force: true });
});

test("markers are not duplicated when the bundle is loaded twice", async () => {
  const root = await fixture();
  const a = await loadLeanPolicyBundle({ mode: "autonomous", skillsDir: root, force: true });
  const b = await loadLeanPolicyBundle({ mode: "autonomous", skillsDir: root, force: true });
  const count = (s, m) => s.split(m).length - 1;
  for (const bundle of [a, b]) {
    assert.equal(count(bundle.prompt, LEAN_AUTONOMOUS_BEGIN_MARKER), 1);
    assert.equal(count(bundle.prompt, LEAN_AUTONOMOUS_END_MARKER), 1);
  }
  await rm(root, { recursive: true, force: true });
});

test("component hashes are the sha256 of the source files", async () => {
  const root = await fixture();
  const bundle = await loadLeanPolicyBundle({ mode: "autonomous", skillsDir: root, force: true });
  const [skill, fragment] = bundle.components;
  assert.equal(skill.sha256, createHash("sha256").update(SKILL).digest("hex"));
  assert.equal(skill.bytes, Buffer.byteLength(SKILL));
  assert.equal(fragment.sha256, createHash("sha256").update(FRAGMENT).digest("hex"));
  await rm(root, { recursive: true, force: true });
});

test("a SKILL.md that already carries a marker is stale, not composed", async () => {
  const root = await fixture({
    skill: `${SKILL}\n${LEAN_AUTONOMOUS_BEGIN_MARKER}\nsneaky\n`,
  });
  const bundle = await loadLeanPolicyBundle({ mode: "autonomous", skillsDir: root, force: true });
  assert.equal(bundle.loaded, false);
  assert.equal(bundle.stale, true);
  assert.match(bundle.staleReason, /reserved autonomous marker/);
  assert.equal(bundle.revision, "");
  await rm(root, { recursive: true, force: true });
});

test("a missing fragment in autonomous mode is stale, never a silent base bundle", async () => {
  const root = await fixture({ fragment: null });
  const bundle = await loadLeanPolicyBundle({ mode: "autonomous", skillsDir: root, force: true });
  assert.equal(bundle.loaded, false);
  assert.equal(bundle.stale, true);
  assert.match(bundle.staleReason, /LEAN_AUTONOMOUS_PROOF_ORCHESTRATION_PROMPT\.md unreadable/);
  await rm(root, { recursive: true, force: true });
});

test("a missing SKILL.md reports not loaded without throwing", async () => {
  const root = await fixture({ skill: null });
  const bundle = await loadLeanPolicyBundle({ mode: "base", skillsDir: root, force: true });
  assert.equal(bundle.loaded, false);
  assert.equal(bundle.revision, "");
  assert.match(bundle.staleReason, /SKILL\.md unreadable/);
  await rm(root, { recursive: true, force: true });
});

test("an empty or whitespace-only SKILL.md is refused like the native loader does", async () => {
  for (const skill of ["", "   \n\t\n"]) {
    const root = await fixture({ skill });
    const bundle = await loadLeanPolicyBundle({ mode: "base", skillsDir: root, force: true });
    assert.equal(bundle.loaded, false, `'${skill}' must not load`);
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveLeanPolicyMode needs the orchestrator, like the native gate", () => {
  assert.equal(resolveLeanPolicyMode({}), "base");
  assert.equal(resolveLeanPolicyMode({ DS4_LEAN_AUTONOMOUS_PROMPT: "0" }), "base");
  for (const on of ["1", "true", "yes", "on", "ON", " True "]) {
    assert.equal(
      resolveLeanPolicyMode({ DS4_LEAN_AUTONOMOUS_PROMPT: on }),
      "autonomous",
      `${on} must enable autonomous`
    );
  }
  for (const off of ["0", "false", "no", "off"]) {
    assert.equal(
      resolveLeanPolicyMode({ DS4_LEAN_AUTONOMOUS_PROMPT: off }),
      "base",
      `${off} must stay base`
    );
  }
  // The native side refuses this combination outright; base is the honest answer.
  assert.equal(
    resolveLeanPolicyMode({
      DS4_LEAN_AUTONOMOUS_PROMPT: "1",
      DS4_LEAN_AUTONOMOUS_ORCHESTRATION: "0",
    }),
    "base"
  );
});

test("getLeanPolicyState is the route shape and carries no prompt text", async () => {
  const root = await fixture();
  invalidateLeanPolicyBundleCache();
  const state = await getLeanPolicyState({ mode: "autonomous", skillsDir: root, force: true });
  assert.deepEqual(Object.keys(state).sort(), [
    "components",
    "loaded",
    "mode",
    "revision",
    "stale",
    "staleReason",
  ]);
  assert.equal(state.loaded, true);
  assert.equal(state.mode, "autonomous");
  assert.match(state.revision, /^[a-f0-9]{40}$/);
  assert.equal(state.components.length, 2);
  await rm(root, { recursive: true, force: true });
});

test("the repo's own policy loads in base mode", async () => {
  const state = await getLeanPolicyState({
    mode: "base",
    projectRoot: new URL("../../..", import.meta.url).pathname,
    env: {},
    force: true,
  });
  assert.equal(state.loaded, true, "skills/lean/SKILL.md must be readable");
  assert.match(state.revision, /^[a-f0-9]{40}$/);
});
