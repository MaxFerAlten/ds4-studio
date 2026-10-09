# Agent Notes — overlay locale (non commitare su upstream)

## Context Budget

Keep tool output small so long agent sessions stay far from the context window.
Every token dumped into a tool result is a token the agent cannot spend on real
work, and it stays in context for the whole session.

- **grep**: use `-C ≤ 6` (never `-C 15/24`). If more context is needed, run 2-3
  targeted passes instead of one huge one.
- **file reads**: read at most ~100-120 lines per call (`rtk read` for exact
  files; avoid `nl -ba | sed` windows of 200+ lines). Cap `max_output_tokens`
  at ~4000 on every `exec_command`.
- **git**: prefer `rtk git diff --stat` or `--unified=8`; never `--unified=40`.
- **logs/builds**: use `rtk summary` / `rtk err` to extract the failure instead
  of dumping full output.
- **repetition**: if an earlier tool call already returned the relevant data, do
  not re-fetch it with a wider window.
- **GitNexus**: never run `ALL_TOOLS.filter(...gitnexus...)` (dumps every tool
  description, ~5k tokens); don't `list_repos` when only one repo is needed;
  keep `gitnexus_query` `limit ≤ 3`; prefer `gitnexus_context` on a single
  symbol over repeated full-process dumps.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ds4-studio** (36869 symbols, 90533 relationships, 780 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/ds4-studio/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ds4-studio/clusters` | All functional areas |
| `gitnexus://repo/ds4-studio/processes` | All execution flows |
| `gitnexus://repo/ds4-studio/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
