export function buildGitnexusPolicy(enabled) {
  if (!enabled) return "";
  return [
    "## GitNexus mandatory impact analysis",
    "",
    "This session requires GitNexus code intelligence before every code change.",
    "",
    "Before modifying any function, class, or method:",
    "1. Run `gitnexus_impact({target: <symbol>, direction: 'upstream'})` and report the blast radius.",
    "2. If risk level is HIGH or CRITICAL, ask the user for confirmation before proceeding.",
    "3. Before committing, run `gitnexus_detect_changes()` to verify changes affect only expected symbols.",
    "4. If the index is stale, run `gitnexus analyze` first.",
    "",
    "Never skip GitNexus analysis. Never simplify away the impact/detect_changes workflow."
  ].join("\n");
}

export function checkPostGitnexusAnalyzeAction(action, state = {}) {
  if (!state.gitnexusAnalyzeSeen) return undefined;

  const tool = String(action?.tool || "");
  const command = String(action?.args?.command || "");
  const target = String(action?.target || action?.args?.path || "");
  const bad =
    /cat\s+\/tmp\/ds4_agent_output_/i.test(command) ||
    /tail\s+.*\/tmp\/ds4_agent_output_/i.test(command) ||
    /\bls\s+-R\b/.test(command) ||
    /\btree\b/.test(command) ||
    (tool === "list" && /\/mnt\/samsung_ai\/COPARATOR\/ds4-studio\/?$/.test(target));

  if (!bad) return undefined;

  return {
    block: true,
    type: "STOP_POST_GITNEXUS_DUMP",
    reason: "After gitnexus analyze, dumping logs or listing the whole repository is forbidden.",
    guidance: "Use targeted gitnexus query/context or a narrow grep/read."
  };
}

export function recordGitnexusAnalyzeResult(action, result, state = {}) {
  if (result?.isError) return state;

  const command = String(action?.args?.command || "");
  const output = String(result?.content || "");
  const analyzeCommand = /\bgitnexus\s+analyze\b/i.test(command);
  const completed =
    /Repository indexed successfully/i.test(output) ||
    (/\bnodes?\b/i.test(output) && /\bedges?\b/i.test(output) && /\bflows?\b/i.test(output));

  if (analyzeCommand && completed) {
    state.gitnexusAnalyzeSeen = true;
  }
  return state;
}
