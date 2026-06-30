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
