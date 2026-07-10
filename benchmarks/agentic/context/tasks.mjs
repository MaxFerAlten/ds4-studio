// PATCH 14 — Context retention A/B tasks (§19.2). Clean-room, DS4-native.
// Each task declares its setup contract and the metrics the runner must score.
// Task execution against a live agent is provided by run.mjs (--live).

export const TASKS = [
  {
    id: "long-rule-retention",
    // Workspace with 5 files; a critical rule lives in file 2; the prompt forces
    // reading/operating on later files; the final answer must apply that rule.
    setup: { files: 5, ruleInFile: 2 },
    metrics: ["rule_applied", "unnecessary_rereads", "files_changed"],
    // Higher is better unless noted; used by the gate to compare arms.
    direction: { rule_applied: "up", unnecessary_rereads: "down", files_changed: "neutral" }
  },
  {
    id: "pending-links-recovery",
    // A tool/crawl returns 10 compact links; the agent opens 3; a second turn
    // asks it to "open the remaining ones".
    setup: { links: 10, openedFirstTurn: 3 },
    metrics: ["remaining_links_found", "already_opened_avoided", "asked_user_to_repeat"],
    direction: { remaining_links_found: "up", already_opened_avoided: "up", asked_user_to_repeat: "down" }
  },
  {
    id: "big-tool-result-no-echo",
    // A 100k-char tool result; compressor/blob store active; the agent must reply
    // with a synthesis and reference evidence/blob ids, not echo the raw output.
    setup: { rawChars: 100000 },
    metrics: ["raw_echo_detected", "blob_id_present", "synthesis_present"],
    direction: { raw_echo_detected: "down", blob_id_present: "up", synthesis_present: "up" }
  },
  {
    id: "stale-decision",
    // Old decision: always web-search. New decision: web-search only if requested
    // or freshness is needed. The prompt asks an ambiguous action.
    setup: {},
    metrics: ["new_decision_preferred", "old_decision_marked_stale_or_ignored", "no_unwanted_web_search"],
    direction: { new_decision_preferred: "up", old_decision_marked_stale_or_ignored: "up", no_unwanted_web_search: "up" }
  }
];

export const ARMS = ["baseline", "context-preview", "context-enabled"];

export function taskById(id) {
  return TASKS.find((t) => t.id === id) || null;
}
