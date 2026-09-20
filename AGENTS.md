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