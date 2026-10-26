// The Lean policy the JS loop puts in its system prompt.
//
// skills/lean/SKILL.md stays the source of truth (and of promptRevision, which
// hashes the whole bundle, C and Node alike). The dropped sections repeat what
// agentCoreRulesSection already states (read-only repository, execution model,
// /lean start recovery) or what every lean_check receipt reports (attempt and
// wall-clock budgets, size limits, preflight failures); the examples restate the
// response format. About a third of the policy's tokens, paid on every prefill.
const DROPPED_SECTIONS = [
  /^## Il repository non è spazio di lavoro\b/,
  /^## Modello di esecuzione\b/,
  /^## Recovery e stato incoerente\b/,
  /^## Due revisioni, non una\b/,
  /^## Limiti\b/,
  /^## Gestione errori\b/,
  /^## Esempi\b/
];
const headingLevel = (line) => (/^(#{2,3}) \S/.exec(line)?.[1].length ?? 0);

const REVISION_NOTE =
  "## Revisioni\n" +
  "`LEAN_POLICY_DRIFT blocking=false`: continua la stessa prova. " +
  "`LEAN_CONTRACT_REVISION_MISMATCH` è terminale: pubblica NOT_VERIFIED citando il codice.";

export function leanCorePolicy(full) {
  const lines = String(full ?? "").split("\n");
  const out = [];
  let fenced = false;
  let droppedLevel = 0;
  for (const line of lines) {
    if (/^```/.test(line)) fenced = !fenced;
    const level = fenced ? 0 : headingLevel(line);
    if (level && (!droppedLevel || level <= droppedLevel)) {
      droppedLevel = DROPPED_SECTIONS.some((pattern) => pattern.test(line)) ? level : 0;
    }
    if (!droppedLevel) out.push(line);
  }
  const core = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return core ? `${core}\n\n${REVISION_NOTE}\n` : "";
}
