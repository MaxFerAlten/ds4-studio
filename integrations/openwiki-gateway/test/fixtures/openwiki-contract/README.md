# openwiki-contract fixture

Static repository used by `test/contract-openwiki.test.mjs` (WP07).

It is a miniature OpenWiki checkout: `openwiki/` holds authored Markdown pages
with OKF frontmatter and H1/H2 headings, exactly the shape the pinned upstream
`openwiki_search` / `openwiki_read` tools read.

The test copies only `openwiki/` into a throwaway directory, turns that copy
into a fresh Git worktree (`git init`), and runs the real pinned OpenWiki MCP
server against it. The committed fixture is never modified and no OpenWiki
artifacts (sidecars, indexes, runs) are written back here.

`tool-schemas.sha256` is the golden tool-schema manifest generated from the
pinned upstream (see `../../../compatibility-v0.7.1.json`). Each line is
`sha256(canonicalJson(entry))` for one `tools/list` entry, plus one
`tools/list` line for the aggregate fingerprint over all entries sorted by
name (`computeSchemaFingerprint` in `src/mcp-supervisor.mjs`).

Expected live behavior on this fixture:

- `openwiki_search` with `exponential backoff jitter` returns exactly the
  `Backoff Schedule` section of `architecture/retry-control.md`.
- `openwiki_search` with `retry` returns the `retry-control.md` sections and
  never the reserved `index.md`.
- `openwiki_read` returns the requested sections in request order.
- `openwiki_list_workspaces` reports the unregistered local wiki with no
  workspaces; `openwiki_list_wikis` and a `workspace` argument are rejected
  with `invalid_state` because the fixture is not linked.
