// WP4 of convergenza.loop.md: the Node loop builds its system prompt with the
// same blocks, in the same order and with the same markers as
// agent_worker_build_system_text_ex (studio/ds4_agent.c):
//
//   base → metacognition → default skills (soul, ethic, structure)
//        → dynamic skills (registry render) → Evidence-First → sage → lean
//
// The marker strings are copied from ds4_default_skills.h; a block is
// separated from the previous non-empty one by exactly "\n\n", and a body that
// does not end in a newline gets exactly one before its footer (same rule the
// skill registry uses).
import { loadAgentText } from "./agentText.mjs";
import { SKILL_KIND, stageSkill } from "./skillRegistry.mjs";

export const SKILL_MARKERS = Object.freeze({
  soul: { begin: "[BEGIN DS4 DEFAULT SOUL POLICY]", end: "[END DS4 DEFAULT SOUL POLICY]" },
  ethic: { begin: "[BEGIN DS4 DEFAULT ETHIC POLICY]", end: "[END DS4 DEFAULT ETHIC POLICY]" },
  metacognition: {
    begin: "[BEGIN DS4 OPTIONAL METACOGNITION POLICY]",
    end: "[END DS4 OPTIONAL METACOGNITION POLICY]"
  },
  structure: { begin: "[BEGIN DS4 STRUCTURE POLICY]", end: "[END DS4 STRUCTURE POLICY]" },
  sage: { begin: "[BEGIN DS4 SAGE POLICY]", end: "[END DS4 SAGE POLICY]" },
  lean: { begin: "[BEGIN DS4 LEAN POLICY]", end: "[END DS4 LEAN POLICY]" }
});

// agent_build_default_skills_block(): soul, ethic, structure, in that order,
// each one skipped only when absent.
export function buildDefaultSkillsBlock({ soul = null, ethic = null, structure = null } = {}) {
  const parts = [];
  for (const [key, content] of [["soul", soul], ["ethic", ethic], ["structure", structure]]) {
    if (content === null || content === undefined) continue;
    parts.push(renderMarkedBlock(SKILL_MARKERS[key], content));
  }
  return parts.join("\n\n");
}

// One framed block: BEGIN, newline, body, one newline if the body lacked it,
// END.  Mirrors the agent_buf_puts sequence of the C.
export function renderMarkedBlock(marker, content) {
  const body = String(content);
  const separator = body.length > 0 && !body.endsWith("\n") ? "\n" : "";
  return `${marker.begin}\n${body}${separator}${marker.end}`;
}

// agent_worker_build_system_text_ex() minus the base, which the Node loop owns
// through its own prompt sections.
export function buildSkillBlock(skills = {}) {
  const parts = [];

  if (skills.metacognition) {
    parts.push(renderMarkedBlock(SKILL_MARKERS.metacognition, skills.metacognition));
  }

  const defaults = buildDefaultSkillsBlock(skills);
  if (defaults) parts.push(defaults);

  const dynamic = typeof skills.dynamic?.render === "function"
    ? skills.dynamic.render()
    : skills.dynamic || "";
  if (dynamic) parts.push(dynamic);

  // C: ds4_agent_evidence_core_contract then agent_evidence_runtime_prompt,
  // concatenated with no separator (both texts end with a newline).
  if (skills.evidenceLoaded) {
    parts.push(
      loadAgentText("evidence-core-contract") + loadAgentText("evidence-runtime-prompt"),
    );
  }

  if (skills.sage) parts.push(renderMarkedBlock(SKILL_MARKERS.sage, skills.sage));
  if (skills.lean) parts.push(renderMarkedBlock(SKILL_MARKERS.lean, skills.lean));

  return parts.join("\n\n");
}

// The full system text: the Node sections first and unchanged, then the skill
// block.  With no skills this returns exactly what the loop built before WP4.
export function buildAgentSystemText({ jsSections = [], skills = null } = {}) {
  const parts = [jsSections.filter(Boolean).join("\n\n")];
  const block = buildSkillBlock(skills || {});
  if (block) parts.push(block);
  return parts.filter(Boolean).join("\n\n");
}

// --- per-session skill state -------------------------------------------------

// agent_default_skills_enabled(): anything but the literal "0" keeps the
// defaults on, an unset variable too.
export function autoEnabled(env, key) {
  return env?.[key] !== "0";
}

// agent_sage_policy_auto_enabled(): DS4_SAGE_POLICY_AUTO, else DS4_SAGE_SKILL_AUTO.
export function sageAutoEnabled(env) {
  const value = env?.DS4_SAGE_POLICY_AUTO ?? env?.DS4_SAGE_SKILL_AUTO;
  return value !== "0";
}

// agent_lean_policy_auto_enabled()
export function leanAutoEnabled(env) {
  return env?.DS4_LEAN_POLICY_AUTO !== "0";
}

export const DEFAULT_SKILL_NAMES = Object.freeze(["soul", "ethic", "structure"]);

// agent_worker_stage_legacy_skills(): soul/ethic/structure are mandatory (a
// missing one is an error, as in C), sage and lean are best-effort.
//
// includePolicySkills defaults to false because the Node loop already injects
// the Sage and Lean policies through sagePolicyLoader.mjs and
// lean/leanPolicyBundle.mjs; loading their skill text as well would frame the
// same policy twice.  The WP4 test asserts each marker appears at most once.
export function createSessionSkillState({
  env = process.env,
  skillsDir,
  includePolicySkills = false
} = {}) {
  const entries = new Map();
  const state = {
    entries,
    syspromptDirty: false,
    skillsDir: skillsDir || env?.DS4_SKILLS_DIR || "skills",
    names: () => [...entries.keys()],
    get: (name) => entries.get(name) || null,
    text: (name) => entries.get(name)?.content.toString("utf8") ?? null,
    markSyspromptDirty() {
      this.syspromptDirty = true;
    },
    // What buildSkillBlock needs, in the shape it expects.  Absent skills are
    // null so the block is skipped rather than framed empty.
    promptSkills() {
      return {
        metacognition: this.text("metacognition"),
        soul: this.text("soul"),
        ethic: this.text("ethic"),
        structure: this.text("structure"),
        dynamic: this.dynamic || null,
        // C agent_worker_evidence_skill_loaded: the skill sits in the
        // dynamic registry; nothing else marks it loaded.
        evidenceLoaded: Boolean(this.evidenceLoaded || this.registry?.find?.("evidence-first-analysis")),
        sage: this.text("sage"),
        lean: this.text("lean")
      };
    },
    // The framed default block, or "" when the defaults are off.
    defaultSkillsBlock() {
      return buildDefaultSkillsBlock({
        soul: entries.has("soul") ? this.text("soul") : null,
        ethic: entries.has("ethic") ? this.text("ethic") : null,
        structure: entries.has("structure") ? this.text("structure") : null
      });
    }
  };

  const stage = (name, kind) => {
    const entry = stageSkill(state.skillsDir, name, kind);
    entries.set(name, entry);
    return entry;
  };

  if (autoEnabled(env, "DS4_SKILL_AUTO")) {
    for (const [name, kind] of [
      ["soul", SKILL_KIND.BUILTIN_SOUL],
      ["ethic", SKILL_KIND.BUILTIN_ETHIC],
      ["structure", SKILL_KIND.BUILTIN_STRUCTURE]
    ]) {
      stage(name, kind);
    }
  }
  if (includePolicySkills && sageAutoEnabled(env)) {
    try {
      stage("sage", SKILL_KIND.BUILTIN_SAGE_POLICY);
    } catch {
      /* best-effort, exactly like the C */
    }
  }
  if (includePolicySkills && leanAutoEnabled(env)) {
    try {
      stage("lean", SKILL_KIND.BUILTIN_LEAN_POLICY);
    } catch {
      /* best-effort, exactly like the C */
    }
  }
  state.syspromptDirty = false;
  return state;
}
