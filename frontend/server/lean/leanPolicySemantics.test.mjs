// R10 — the Lean semantics every model-facing surface must agree on.
//
// These surfaces (skill, system prompt, runtime rules, JS tool schema, C tool
// schema) drifted apart before: the docs claimed Lean "does not execute
// programs", which is false for elaboration and tempts an implementer to relax
// the sandbox, and they asserted a fixed Mathlib timing that depends on the
// machine. This file is what keeps them honest and identical.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { agentCoreRulesSection } from "../agentRuntimeRules.mjs";
import { AGENT_TOOLS } from "../agentToolCatalog.mjs";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

const SKILL_PATH = resolve(REPO_ROOT, "skills/lean/SKILL.md");
const skillBytes = await readFile(SKILL_PATH);
const skill = skillBytes.toString("utf8");
const cSource = await readFile(resolve(REPO_ROOT, "ds4_agent.c"), "utf8");
const { AGENT_SYSTEM_PROMPT } = await import("../agentSession.mjs");
const rules = agentCoreRulesSection();
const jsLeanTool = AGENT_TOOLS.find((t) => t.function?.name === "lean_check");

/** The lean_check description embedded in the native agent's tool prompt. */
function cLeanDescription() {
  const block = cSource.slice(cSource.indexOf("agent_tools_prompt_lean"));
  const m = block.match(/\\"description\\": \\"(.*?)\\",\\n/);
  assert.ok(m, "the C tool prompt must still declare a lean_check description");
  return m[1].replace(/\\\\"/g, '"');
}

const MODEL_FACING = () => [
  ["skills/lean/SKILL.md", skill],
  ["system prompt", AGENT_SYSTEM_PROMPT],
  ["runtime rules", rules],
  ["JS tool schema", jsLeanTool.function.description],
  ["C tool schema", cLeanDescription()],
];

test("no surface claims Lean does not execute code", () => {
  // "does not execute a Lean program" is the exact phrasing that was wrong.
  const forbidden = [
    /does not execute (a )?(Lean )?(program|code)/i,
    /non esegue (programmi|codice)(?! *: *`lean_check` non invoca)/i,
    /no code (is )?executed/i,
  ];
  for (const [name, text] of MODEL_FACING()) {
    for (const re of forbidden) {
      assert.doesNotMatch(text, re, `${name} still claims Lean does not execute code`);
    }
  }
});

test("the tool schemas state what is actually true about elaboration", () => {
  for (const [name, text] of [
    ["JS tool schema", jsLeanTool.function.description],
    ["C tool schema", cLeanDescription()],
  ]) {
    assert.match(text, /elaboration may execute metaprograms, tactics, #eval/i, `${name}`);
    assert.match(text, /mandatory sandbox/i, `${name}`);
    assert.match(text, /does not invoke a compiled main/i, `${name}`);
  }
});

test("the JS and C tool schemas describe lean_check identically", () => {
  assert.equal(cLeanDescription(), jsLeanTool.function.description);
});

test("the skill states the execution model instead of denying execution", () => {
  assert.match(skill, /metaprogrammi, tattiche, comandi `#eval` e IO/);
  assert.match(skill, /codice non fidato/);
  assert.match(skill, /sandbox obbligatoria/);
  assert.match(skill, /non invoca automaticamente un\n`main` compilato/);
});

test("no surface hardcodes how long Mathlib takes", () => {
  const timingClaims = [
    /always times out/i,
    /sempre in `?status=timeout`?/i,
    /finisce sempre in/i,
    /\b240 second/i,
    /circa \d+ secondi/i,
  ];
  for (const [name, text] of MODEL_FACING()) {
    for (const re of timingClaims) {
      assert.doesNotMatch(text, re, `${name} asserts a fixed Mathlib timing`);
    }
  }
  assert.match(skill, /Preferisci import mirati/);
  assert.match(AGENT_SYSTEM_PROMPT, /Prefer targeted imports/);
});

test("checked is separated from certified without denying what Lean did verify", () => {
  assert.match(skill, /`status=checked` significa che Lean ha elaborato il file senza errori/);
  assert.match(skill, /`certified=true` non è mai presente nell'MVP/);
  assert.match(skill, /policy aggiuntiva su `sorry`/);
});

test("axiom is evidence, sorry is a placeholder", () => {
  assert.match(skill, /`axiom` viene riportato come evidenza ma \*\*non\*\* è un placeholder/);
  assert.match(skill, /`sorry`, `admit` e\n`set_option warn\.sorry false`/);
});

test("every surface points Lean work at lean_check, never at bash", () => {
  assert.match(rules, /Use lean_check \(not bash\)/);
  assert.match(AGENT_SYSTEM_PROMPT, /Use lean_check, never bash/);
  assert.match(skill, /Non usare Bash, lake, lean, elan/);
  for (const [name, text] of [["JS tool schema", jsLeanTool.function.description], ["C tool schema", cLeanDescription()]]) {
    assert.doesNotMatch(text, /\bbash\b/i, `${name} must not suggest bash`);
  }
});

test("the attempt budget is policy, not a literal repeated in the prompt", () => {
  // A number written into the prompt is a number that drifts from the policy
  // the orchestrator actually enforces — and "I have reached three calls" was a
  // terminal state the model invented from exactly that sentence.
  // Written as \d+ on purpose: the point is that no count is promised at all,
  // and the literal sentence must not survive anywhere — including here, where
  // the certification greps for it.
  assert.doesNotMatch(skill, /max \d+ chiamate/i);
  assert.doesNotMatch(AGENT_SYSTEM_PROMPT, /at most \d+ lean_check calls/);
  assert.match(skill, /config\/lean-orchestration-policy\.json/);
  assert.match(skill, /attempt=N\/M/);
});
test("no model-facing Lean surface restores legacy fixed call limits", () => {
  const forbidden = [
    /Max 3/i,
    /at most 3/i,
    /maximum three/i,
    /Max 2 chiamate consecutive/i,
  ];
  for (const [name, text] of MODEL_FACING()) {
    for (const re of forbidden) {
      assert.doesNotMatch(text, re, `${name} restores a legacy fixed retry limit`);
    }
  }
  assert.match(skill, /runtime-provided proof budget/i);
  assert.match(skill, /Do not request a new\s+user turn to reset a budget/i);
});
test("proof diagnostics and transport retries have distinct semantics", () => {
  assert.match(
    AGENT_SYSTEM_PROMPT,
    /proof diagnostics with orchestration\.retryable=true, repair the Lean source/i
  );
  assert.match(AGENT_SYSTEM_PROMPT, /transport failures\s+explicitly marked retryable/i);
  assert.doesNotMatch(AGENT_SYSTEM_PROMPT, /only category=transport is worth one retry/i);
  assert.match(skill, /diagnostici della prova con `orchestration\.retryable=true`/i);
  assert.match(skill, /non\s+reinviare sorgente invariata dopo un fallimento della prova/i);
});

test("every surface states the autonomous completion contract", () => {
  assert.match(skill, /NO CHECKED RESULT, NO VERIFIED CLAIM/);
  assert.match(skill, /No checked, no proof claim/i);
  assert.match(
    AGENT_SYSTEM_PROMPT,
    /Continue autonomously until the current Lean candidate returns status=checked/
  );
  assert.match(AGENT_SYSTEM_PROMPT, /never ask the user to\n\s*send another message/);
  assert.match(rules, /publishable as verified only after status=checked/);
  assert.match(rules, /request a new.*turn.*reset.*budget/);
  assert.match(jsLeanTool.function.description, /retryable=true, repair the source immediately/);
});

test("the skill maps every failure class to a repair action", () => {
  for (const failureClass of [
    "syntax",
    "unknown_identifier",
    "rewrite_miss",
    "unsolved_goals",
    "type_mismatch",
    "timeout_repairable",
    "proof_failure",
    "infrastructure",
    "contract",
    "user_cancelled",
  ]) {
    assert.ok(
      skill.includes(`\`${failureClass}\``),
      `the skill must tell the model what to do with failureClass=${failureClass}`
    );
  }
});

test("the skill carries a Unicode example and survives a UTF-8 round trip", () => {
  assert.ok(skill.includes("∀"), "the skill must exercise the Unicode path it promises to preserve");
  assert.deepEqual(Buffer.from(skill, "utf8"), skillBytes, "the policy file must be byte-stable UTF-8");
});

test("the system prompt summarizes the policy instead of duplicating the skill", () => {
  const leanSection = AGENT_SYSTEM_PROMPT.slice(AGENT_SYSTEM_PROMPT.indexOf("- Lean 4:"));
  const lines = leanSection.split("\n").filter((l) => l.trim().startsWith("-"));
  assert.ok(lines.length <= 12, `the prompt's Lean section grew to ${lines.length} bullets; it must not restate the skill`);
  assert.ok(!AGENT_SYSTEM_PROMPT.includes("[BEGIN DS4 LEAN POLICY]"), "the skill is loaded as policy, not inlined");
});

// R2-09 — recovery guardrails. The chat invented `sudo ds4-admin /lean restart`,
// `/lean reset`, a Lean daemon and Docker because nothing said they do not
// exist and the tool error was too generic to point anywhere.

test("no surface invents a recovery command the code does not expose", () => {
  const invented = [
    /ds4-admin/i,
    /\/lean\s+restart/i,
    /\/lean\s+reset/i,
    /lean\s+daemon/i,
    /\bdocker\b/i,
    /\bsudo\b(?!\`? *)/i,
  ];
  // Line-level, not document-level: a surface may name these paths only in
  // the sentence that forbids them. A blanket "the file says never suggest"
  // exemption would let a real suggestion slip in three paragraphs later.
  const forbids = (line) =>
    /non esiste|non esistono|non serve|non inventar|Never suggest|never suggest|do not suggest/i.test(line);
  for (const [name, text] of MODEL_FACING()) {
    for (const line of String(text).split("\n")) {
      for (const re of invented) {
        if (!re.test(line)) continue;
        assert.ok(
          forbids(line),
          `${name} mentions an invented recovery path outside a prohibition: ${line.trim()}`
        );
      }
    }
  }
});

test("the supported Lean verbs are stated where the model can see them", () => {
  assert.match(skill, /`start`, `stop`, `status` e `preflight`/);
  assert.match(rules, /only \/lean start\|stop\|status\|preflight exist/);
  assert.match(AGENT_SYSTEM_PROMPT, /only Lean commands that exist are \/lean start, stop, status and preflight/);
});

test("an incoherent state is named as a state-coherence bug, not retried", () => {
  assert.match(skill, /coerenza dello stato/);
  assert.match(skill, /una sola volta/);
  assert.match(skill, /retryable=false/);
  assert.match(skill, /category=state-coherence/);
  assert.match(rules, /state-coherence bug/);
  assert.match(rules, /instead of retrying/);
  assert.match(AGENT_SYSTEM_PROMPT, /state-coherence bug/);
  assert.match(AGENT_SYSTEM_PROMPT, /do\s+not retry further/);
});

test("the status fields the model must read before acting are documented", () => {
  for (const field of ["coherent", "operational", "repaired", "manifestHealthy", "aggregate_revision", "active_count"]) {
    assert.ok(skill.includes(field), `the skill never mentions ${field}`);
  }
});

test("lean discovery enforcement rule is present in runtime rules", () => {
  assert.match(rules, /lean_inspect timeout is not permission to guess/);
  assert.match(rules, /nextAction/);
  assert.match(rules, /Malformed tool calls do not count/);
});
