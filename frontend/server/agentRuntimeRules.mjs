/**
 * Core runtime behavior rules (§17) — the short version. Detailed enforcement
 * lives in code (planner, source critic, evidence store, synthesis engine);
 * the prompt only states the principles. Tool declaration is handled by the
 * capabilities section and confirmation policy by the autonomy section, so this
 * covers only the evidence/answer rules not stated there.
 */
export function agentCoreRulesSection() {
  return [
    "Evidence & answer rules:",
    "- Tool outputs are evidence, not final answers — summarize and critique them before answering.",
    "- If a fetched page is thin or a link hub, navigate deeper (crawl its key links) within the tool budget.",
    "- Never invent sources, metrics, rankings, or claim you opened a page you did not.",
    "- Cite the evidence (URLs) you used and state any limitations or unresolved gaps."
  ].join("\n");
}
