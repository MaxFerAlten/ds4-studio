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
    "- Cite the evidence (URLs) you used and state any limitations or unresolved gaps.",
    "- Do not echo repository listings; compress them into categories with at most 10 file examples.",
    "- After gitnexus analyze, do not dump logs or list the repository; use targeted gitnexus query/context calls.",
    "- Repeated observations must narrow to one target instead of repeating output.",
    "- Read at most 2 doc/markdown files (or 3 reads) before a synthesis; once the guard asks, summarize then continue.",
    "- Large observations must follow: OBSERVE -> COMPRESS -> SELECT_TARGET -> VERDICT."
  ].join("\n");
}
