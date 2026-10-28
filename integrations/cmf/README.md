# DS4 Cognitive Memory Fabric (CMF) — M1 core

Local, opt-in memory sidecar for DS4 Studio, built from
`docs/feature/piano.DS4CognitiveMemoryFabric.md`. This directory holds **M1**:
an event log with authenticated, idempotent ingest, redacted content-addressed
sources, an FTS5 projection, scoped lexical recall and backup/restore.

Not here yet (later milestones): DS4 hooks (M2), embeddings/temporal facts (M3),
graph (M4), compaction and context injection (M5), reflection/skills (M6).
Nothing in DS4 calls CMF; disabling it means not starting it.

- `docs/M0-discovery.md` — plan claims checked against this checkout.
- `docs/M1-acceptance.md` — contract and acceptance cases (Codex).
- `handoff/REVIEW_LOG.md` — Claude ⇄ Codex cross-review record.

## Properties

- Python 3.12 stdlib + SQLite FTS5. No dependencies, no network (`network_egress` must be `deny`).
- HTTP/1.0 JSON over an AF_UNIX socket only (dir 0700, socket 0600, peer UID checked)
  plus a bearer token mapped to a principal by a 0600 tokens file that stores only `sha256(token)`.
- One writer per store (`flock` on `<store>/lock`); WAL, `synchronous=FULL`, foreign keys on.
- Text is redacted (`redact-v1`) **before** anything is written; CMF keeps only the redacted
  copy. DS4 context blobs (`sha256:<hex>`) are read, verified by digest and never written.
- Every event stays `UNTRUSTED`/`UNVERIFIED`; recall never writes.

## Try it

```sh
export DS4_CMF_ENABLED=1
export DS4_CMF_STORE_ROOT=$HOME/.local/share/ds4-cmf
export DS4_CMF_TOKENS_FILE=$HOME/.config/ds4/cmf-tokens.json
C=integrations/cmf/scripts/cmf
$C admin init
$C admin provision --project proj-a --session s1 --agent agent-1
export DS4_CMF_TOKEN=$($C admin add-token --principal-id host-a --user-id me \
    --agent agent-1 --grant proj-a:observe --grant proj-a:search --grant proj-a:source.read)
$C serve &                      # socket: $XDG_RUNTIME_DIR/ds4-cmf/cmf.sock
$C observe --project proj-a --session s1 --event-key s1:1:user:1 \
    --event-type USER_MESSAGE --occurred-at 2026-10-24T00:00:00Z --text 'do not edit upstream'
$C search --project proj-a 'upstream'
$C source <event_id>
```

Offline admin (`admin check|project|rebuild|snapshot|restore|migrate`) takes the store lock,
so stop the service first (M1 has no online snapshot endpoint).

## Tests

`PYTHONPATH=src python3 -m unittest discover -s tests -v` (from this directory).

M1 verification: 84/84 tests pass, including all 58 acceptance cases; see
`docs/M1-test-status.md`. Backup manifests are capped at 16 MiB. Restore
validates the copied database and uses Linux renameat2 without replacement.
