# Build System

Prima di modificare `Makefile`, `srun.sh` o qualsiasi file di build, **leggi** `AGENTS_BUILD.md` — contiene regole critiche su header ROCm, flag del compilatore e sincronizzazione target.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ds4-studio** (15493 symbols, 26861 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/ds4-studio/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ds4-studio/clusters` | All functional areas |
| `gitnexus://repo/ds4-studio/processes` | All execution flows |
| `gitnexus://repo/ds4-studio/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- metacognition:start -->
# Metacognition — Decision Making Under Uncertainty

## Always Do

- **If uncertain after 3 internal reasoning steps, ASK the user.** Never speculate for more than 3 tokens about ambiguous intent. Use `question()` with 2-3 clear options.
- **If loop guard fires repeatedly, change strategy or ask for help.** Don't keep doing the same thing.
- **If internal reasoning contains phrases like "perhaps", "maybe", "the user said... but...", stop and ask.** That's a sign of unresolvable ambiguity.
- **If search returns empty but you expected results, retry with `bash grep` immediately.**
- **Use GitNexus before grep/search on project code.** Only fall back to grep if GitNexus is unavailable or returns nothing.

## Never Do

- NEVER spend >3 reasoning cycles on the same ambiguity without asking the user.
- NEVER skip GitNexus with rationalizations like "we're not modifying so we don't need it" — GitNexus is for understanding too.
- NEVER trust `search` tool results without verification — it can return false negatives on large files or complex patterns.

## Resources

| When | Read this |
|------|-----------|
| Full metacognition directives | `doc/improve-metacognition.md` |
| Metacognition skill (trigger: `/metacognition`) | `skills/metacognition/SKILL.md` |
| **Sage skill (trigger: `/sage`)**               | `skills/sage/SKILL.md`          |
<!-- metacognition:end -->

## OpenWiki

This repository has documentation located in the /openwiki directory.

Start here:
- [OpenWiki quickstart](openwiki/quickstart.md)

OpenWiki includes repository overview, architecture notes, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

When working in this repository, read the OpenWiki quickstart first, then follow its links to the relevant architecture, workflow, domain, operation, and testing notes.
