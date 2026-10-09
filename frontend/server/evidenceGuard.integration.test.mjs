// WP10 (convergenza.loop.md §13): Evidence-First wiring in the chat loop.
// The behavioural core lives in evidenceGuard.test.mjs; this file guards the
// integration points in index.mjs (source-guard pattern of
// agentSystemReminder.test.mjs) plus the invariants the plan demands:
// compaction never touches the ledger, a restored ledger is never finalized.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MODE as EVIDENCE_MODE,
  createEvidenceState,
  createEvidenceTurn,
  evidenceCheckFinal,
  evidenceCoreContract,
  evidenceDeserialize,
  evidenceDigest,
  evidenceGuardTool,
  evidenceSerialize
} from "./evidenceGuard.mjs";
import { EVIDENCE_GUARD_TOOL, AGENT_TOOLS, appendOptionalTools } from "./agentToolCatalog.mjs";

const INDEX_SOURCE = new URL("./index.mjs", import.meta.url);
const { readFileSync } = await import("node:fs");
const source = () => readFileSync(INDEX_SOURCE, "utf8");

test("catalog: evidence_guard is optional, never a base tool, action required", () => {
  assert.equal(EVIDENCE_GUARD_TOOL.function.name, "evidence_guard");
  assert.equal(AGENT_TOOLS.some((t) => t.function.name === "evidence_guard"), false);
  assert.deepEqual(EVIDENCE_GUARD_TOOL.function.parameters.required, ["action"]);
  assert.equal(Object.keys(EVIDENCE_GUARD_TOOL.function.parameters.properties).length, 15);
  const withEvidence = appendOptionalTools(
    AGENT_TOOLS.filter((t) => t.function.name !== "context_search"),
    [EVIDENCE_GUARD_TOOL]
  );
  assert.ok(withEvidence.some((t) => t.function.name === "evidence_guard"));
});

test("index.mjs: mode resolves at boot and advertising follows the skill", () => {
  const src = source();
  assert.match(src, /const EVIDENCE_MODE_BOOT = modeResolve\(process\.env\.DS4_EVIDENCE_MODE \|\| null, true\)/);
  assert.match(src, /return evidenceEnabled \? appendOptionalTools\(tools, \[EVIDENCE_GUARD_TOOL\]\) : tools/);
  // The three chat payload sites opt in; nothing else advertises the tool.
  assert.equal((src.match(/evidenceEnabled: evidenceActive/g) ?? []).length, 3);
  assert.match(src, /const evidenceActive = !dot && Boolean\(skillState\?\.promptSkills\?\.\(\)\.evidenceLoaded\)/);
});

test("index.mjs: dispatch, note, gate, repair and terminal are wired", () => {
  const src = source();
  assert.match(src, /evidenceNoteToolCall\(/);
  assert.match(src, /tc\.name === "evidence_guard" && tc\.arguments\?\.action === "status"/);
  assert.match(src, /const content = evidenceGuardTool\(/);
  // Gate: only a final answer owes a verdict.
  assert.match(src, /const evidenceGate = evidenceActive && isFinalResponse\s*\?\s*evidenceCheckFinal\(/);
  // One repair message: epistemic first, evidence second (plan §13.4).
  assert.match(src, /`\$\{repairGuidance\}\\n\$\{evidenceRepairGuidance\(evidenceGate\.result\)\}`/);
  // Exhausted budget: terminal status, no candidate bytes (the flush sites
  // live after the commit, which the terminal branch never reaches).
  assert.match(src, /code: "EVIDENCE_FINALIZATION_TERMINAL"/);
  assert.match(src, /agentSession\.evidenceTurn\.repairRounds < EVIDENCE_MAX_REPAIR_ROUNDS/);
  // Re-anchor counters (C 3469-3472 / 7762-7774).
  assert.match(src, /agentSession\.evidenceState\.metrics\.reinjectionsTotal\+\+/);
});

test("index.mjs: compaction re-anchors, persistence travels, restore is not finalized", () => {
  const src = source();
  assert.match(src, /evidence: evidenceActive\s*\?\s*\{ text: evidenceCoreContract\(\) \+ evidenceDigest\(agentSession\.evidenceState\) \}/);
  assert.match(src, /evidence: agentSession\.evidenceState\.enabled\s*\?\s*evidenceSerialize\(agentSession\.evidenceState\)/);
  assert.match(src, /evidenceDeserialize\(String\(doc\.evidence\), back\)/);
  assert.match(src, /Runtime evidence ledger restored from the saved session\. Any earlier finalize is void/);
  assert.match(src, /was not restored as authoritative state/);
});

test("invariants: digest is read-only and a restored ledger is never finalized", () => {
  const state = createEvidenceState();
  const turn = createEvidenceTurn();
  const fin = evidenceGuardTool(
    state, turn, { action: "finalize" },
    { skillLoaded: true, mode: EVIDENCE_MODE.BLOCK, policyRevision: "r" }
  );
  assert.match(fin, /EVIDENCE_FINALIZATION_READY/);
  assert.equal(state.finalizationValid, true);

  // Two compactions may run; the digest (and the ledger) must not budge.
  const before = evidenceDigest(state);
  assert.equal(evidenceDigest(state), before);
  assert.equal(evidenceDigest(state), before);

  const blob = evidenceSerialize(state);
  const restored = createEvidenceState();
  assert.equal(evidenceDeserialize(blob, restored).ok, true);
  // C fails closed: the finalize token never survives the round-trip.
  assert.equal(restored.finalizationValid, false);
  assert.equal(restored.finalized, false);
  const gate = evidenceCheckFinal(restored, EVIDENCE_MODE.BLOCK, true, "final answer");
  assert.equal(gate.allowed, false);
  assert.equal(gate.result.reasonCode, "EVIDENCE_NOT_FINALIZED");
  assert.ok(evidenceCoreContract().length > 0);
});
