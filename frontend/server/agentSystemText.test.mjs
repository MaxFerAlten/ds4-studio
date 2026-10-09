import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  SKILL_MARKERS,
  autoEnabled,
  buildAgentSystemText,
  buildDefaultSkillsBlock,
  buildSkillBlock,
  createSessionSkillState,
  leanAutoEnabled,
  renderMarkedBlock,
  sageAutoEnabled
} from "./agentSystemText.mjs";
import { SkillRegistry } from "./skillRegistry.mjs";
import { loadAgentText } from "./agentText.mjs";

// WP4 of convergenza.loop.md: the Node loop must frame and order the skill
// blocks exactly like agent_worker_build_system_text_ex, and must build the
// identical prompt when no skill is loaded.

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const FIXTURES = resolve(REPO, "tests/fixtures/conformance/skills");

const SECTIONS = ["JS BASE", "CAPABILITIES", "CORE RULES"];

function tempSkillDir(names) {
  const dir = mkdtempSync(join(tmpdir(), "ds4-sysprompt-"));
  for (const name of names) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "SKILL.md"), `${name} policy text\n`);
  }
  return dir;
}

function allSkills() {
  const registry = new SkillRegistry({ skillsDir: FIXTURES });
  registry.upsert(registry.stage("alpha"));
  return {
    metacognition: "META TEXT\n",
    soul: "SOUL TEXT\n",
    ethic: "ETHIC TEXT\n",
    structure: "STRUCTURE TEXT\n",
    dynamic: registry,
    evidenceLoaded: true,
    sage: "SAGE TEXT\n",
    lean: "LEAN TEXT\n"
  };
}

test("the markers match ds4_default_skills.h", () => {
  const header = readFileSync(join(REPO, "ds4_default_skills.h"), "utf8");
  const found = new Map();
  const re = /#define DS4_(SOUL|ETHIC|METACOGNITION|STRUCTURE|SAGE|LEAN)_(BEGIN|END) \\\n\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(header)) !== null) {
    found.set(`${match[1].toLowerCase()}.${match[2].toLowerCase()}`, match[3]);
  }
  assert.equal(found.size, 12, "twelve markers expected in the header");
  for (const [key, value] of found) {
    const [name, edge] = key.split(".");
    assert.equal(SKILL_MARKERS[name][edge], value, `${name}.${edge} drifted from the header`);
  }
});

test("the blocks come in the C order, separated by one blank line", () => {
  const prompt = buildAgentSystemText({ jsSections: SECTIONS, skills: allSkills() });
  const order = [
    "JS BASE",
    "CAPABILITIES",
    "CORE RULES",
    SKILL_MARKERS.metacognition.begin,
    "META TEXT",
    SKILL_MARKERS.metacognition.end,
    SKILL_MARKERS.soul.begin,
    "SOUL TEXT",
    SKILL_MARKERS.soul.end,
    SKILL_MARKERS.ethic.begin,
    "ETHIC TEXT",
    SKILL_MARKERS.ethic.end,
    SKILL_MARKERS.structure.begin,
    "STRUCTURE TEXT",
    SKILL_MARKERS.structure.end,
    "[BEGIN DS4 ACTIVE SKILL name=alpha",
    "[END DS4 ACTIVE SKILL name=alpha]",
    "[BEGIN DS4 EVIDENCE",
    SKILL_MARKERS.sage.begin,
    "SAGE TEXT",
    SKILL_MARKERS.sage.end,
    SKILL_MARKERS.lean.begin,
    "LEAN TEXT",
    SKILL_MARKERS.lean.end
  ].filter((needle) => needle !== "[BEGIN DS4 EVIDENCE");
  let at = -1;
  for (const needle of order) {
    const next = prompt.indexOf(needle, at + 1);
    assert.ok(next > at, `${needle} missing or out of order`);
    at = next;
  }
  // The Evidence contract sits between the dynamic skills and the sage block.
  const evidence = loadAgentText("evidence-core-contract");
  assert.ok(prompt.includes(evidence));
  assert.ok(
    prompt.indexOf("[END DS4 ACTIVE SKILL name=alpha]") < prompt.indexOf(evidence),
    "Evidence comes after the dynamic skills",
  );
  assert.ok(prompt.indexOf(evidence) < prompt.indexOf(SKILL_MARKERS.sage.begin));
});

test("every marker appears exactly once", () => {
  const prompt = buildAgentSystemText({ jsSections: SECTIONS, skills: allSkills() });
  for (const marker of Object.values(SKILL_MARKERS)) {
    for (const edge of [marker.begin, marker.end]) {
      const count = prompt.split(edge).length - 1;
      assert.equal(count, 1, `${edge} must appear once, found ${count}`);
    }
  }
});

test("without skills the prompt is the one the loop built before WP4", () => {
  const before = SECTIONS.join("\n\n");
  assert.equal(buildAgentSystemText({ jsSections: SECTIONS }), before);
  assert.equal(buildAgentSystemText({ jsSections: SECTIONS, skills: {} }), before);
  assert.equal(buildAgentSystemText({ jsSections: SECTIONS, skills: null }), before);
  // Empty filters behave as they did: no leading or trailing separator.
  assert.equal(buildAgentSystemText({ jsSections: [null, "A", "", "B"] }), "A\n\nB");
});

test("the default block is soul, ethic, structure, skipping absent ones", () => {
  const block = buildDefaultSkillsBlock({ soul: "S\n", structure: "T\n" });
  assert.equal(
    block,
    `${SKILL_MARKERS.soul.begin}\nS\n${SKILL_MARKERS.soul.end}\n\n` +
      `${SKILL_MARKERS.structure.begin}\nT\n${SKILL_MARKERS.structure.end}`
  );
  assert.equal(buildDefaultSkillsBlock({}), "");
  assert.equal(buildDefaultSkillsBlock({ soul: null, ethic: undefined }), "");
});

test("a body without a final newline gets exactly one", () => {
  const block = renderMarkedBlock(SKILL_MARKERS.sage, "TAIL");
  assert.equal(block, `${SKILL_MARKERS.sage.begin}\nTAIL\n${SKILL_MARKERS.sage.end}`);
  assert.equal(
    renderMarkedBlock(SKILL_MARKERS.sage, "TAIL\n"),
    `${SKILL_MARKERS.sage.begin}\nTAIL\n${SKILL_MARKERS.sage.end}`
  );
  // An empty *string* is not absent: agent_build_default_skills_block only
  // skips NULL contents, so it frames an empty body as BEGIN\nEND.
  assert.equal(
    buildSkillBlock({ soul: "" }),
    `${SKILL_MARKERS.soul.begin}\n${SKILL_MARKERS.soul.end}`
  );
  assert.equal(buildSkillBlock({}), "");
});

test("the auto rules follow the C environment variables", () => {
  assert.equal(autoEnabled({}, "DS4_SKILL_AUTO"), true);
  assert.equal(autoEnabled({ DS4_SKILL_AUTO: "" }, "DS4_SKILL_AUTO"), true);
  assert.equal(autoEnabled({ DS4_SKILL_AUTO: "1" }, "DS4_SKILL_AUTO"), true);
  assert.equal(autoEnabled({ DS4_SKILL_AUTO: "0" }, "DS4_SKILL_AUTO"), false);
  assert.equal(sageAutoEnabled({}), true);
  assert.equal(sageAutoEnabled({ DS4_SAGE_SKILL_AUTO: "0" }), false);
  assert.equal(sageAutoEnabled({ DS4_SAGE_POLICY_AUTO: "0", DS4_SAGE_SKILL_AUTO: "1" }), false);
  assert.equal(sageAutoEnabled({ DS4_SAGE_POLICY_AUTO: "1", DS4_SAGE_SKILL_AUTO: "0" }), true);
  assert.equal(leanAutoEnabled({ DS4_LEAN_POLICY_AUTO: "0" }), false);
  assert.equal(leanAutoEnabled({}), true);
});

test("session state loads the defaults and can be disabled", () => {
  const dir = tempSkillDir(["soul", "ethic", "structure", "sage", "lean"]);
  const state = createSessionSkillState({ env: {}, skillsDir: dir });
  assert.deepEqual(state.names().sort(), ["ethic", "soul", "structure"]);
  assert.equal(state.syspromptDirty, false);
  assert.match(state.defaultSkillsBlock(), /\[BEGIN DS4 DEFAULT SOUL POLICY\]\nsoul policy text/);
  state.markSyspromptDirty();
  assert.equal(state.syspromptDirty, true);

  const off = createSessionSkillState({ env: { DS4_SKILL_AUTO: "0" }, skillsDir: dir });
  assert.deepEqual(off.names(), []);
  assert.equal(off.defaultSkillsBlock(), "");

  const withPolicies = createSessionSkillState({
    env: {},
    skillsDir: dir,
    includePolicySkills: true
  });
  assert.deepEqual(withPolicies.names().sort(), ["ethic", "lean", "sage", "soul", "structure"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a missing mandatory default is an error, a missing sage is not", () => {
  const dir = tempSkillDir(["ethic", "structure"]);
  assert.throws(
    () => createSessionSkillState({ env: {}, skillsDir: dir }),
    (error) => error.code === "SKILL_NOT_FOUND"
  );
  const withPolicies = tempSkillDir(["soul", "ethic", "structure"]);
  const state = createSessionSkillState({
    env: {},
    skillsDir: withPolicies,
    includePolicySkills: true
  });
  assert.deepEqual(state.names().sort(), ["ethic", "soul", "structure"], "sage/lean are best effort");
  rmSync(dir, { recursive: true, force: true });
  rmSync(withPolicies, { recursive: true, force: true });
});

test("the dynamic block is embedded without re-framing it", () => {
  const registry = new SkillRegistry({ skillsDir: FIXTURES });
  registry.upsert(registry.stage("alpha"));
  const block = buildSkillBlock({ dynamic: registry });
  assert.equal(block, registry.render());
  const prompt = buildAgentSystemText({ jsSections: ["BASE"], skills: { dynamic: registry } });
  assert.equal(prompt, `BASE\n\n${registry.render()}`);
});
