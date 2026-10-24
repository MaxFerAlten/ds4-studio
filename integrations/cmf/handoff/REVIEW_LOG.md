# CMF cross-review log (Claude Code ⇄ Codex)

Rule (user): every step of one agent is reviewed by the other. Single branch
`feature/deepseek-infer`, no worktrees. Files are never edited by both at once.

| # | Step | Author | Reviewer | Verdict | Notes |
|---|---|---|---|---|---|
| 1 | Plan reading + work split | Codex | Claude | ACCEPTED with change | Codex writes its own files (tests, LICENSES, specs) instead of handing diffs over chat |
| 2 | `docs/M0-discovery.md` | Claude | Codex | ERRORS FOUND → FIXED | Compaction map mislabelled `ds4_agent.c:10121` (it is `agent_worker_compact_if_needed`, automatic) and missed the API route `ds4_agent_runtime.c:755`; §3.1 rewritten, verified against source |
| 3 | `docs/M1-acceptance.md`, `LICENSES/*` | Codex | Claude | ACCEPTED with 2 changes | see below |

## Step 3 — Claude review of the M1 contract

Accepted as proposed: (1) bearer token + `SO_PEERCRED`, per-agent grants;
(2) CMF stores only the redacted blob, N = 16 KiB EPISODE prefix, DS4 read cap 1 MiB;
(3) `UNIQUE(project_id, agent_id, event_key)` — recorded as a deliberate deviation from §5.1;
(4) contiguous checkpoint over committed events; (5) backup with explicit DS4 dependencies,
`portable=false`; (6) stdlib `unittest` + `PYTHONPATH=src` launcher, no pytest/build deps.

Changes requested:

- **C1 — request digest must be keyed.** The idempotency digest covers the *original*
  (pre-redaction) text. A plain SHA-256 of a short secret is guessable offline from a
  stolen DB. Use `HMAC-SHA256(store_key, canonical_request)` with a per-store 32-byte key
  in `<store>/keys/idempotency.key` (0600). The key is part of every backup (a restored
  store must keep detecting conflicts) and is never logged.
- **C2 — tokens file stores hashes, not tokens.** Host config maps
  `sha256(token) -> principal`; comparison with `hmac.compare_digest`.
  The plaintext token exists only in the client's env/file.

Licences: `SOURCE_MATRIX.md` correctly says "inspiration, no code copied", SHA `NOT_VERIFIED`.

## Step 4 — Claude: M1 implementation (awaiting Codex review)

Codex hit its usage limit after step 3 (resets 05:21). Claude implemented the
M1 code it owns while Codex was unavailable; **nothing is committed** until
Codex reviews it and lands `tests/**` from `docs/M1-acceptance.md`.

Files: `migrations/0001_core.sql`, `0002_fts.sql`; `src/ds4_cmf/**`; `scripts/cmf`;
`config/`; `pyproject.toml`; `README.md`.

C1/C2 applied: keyed HMAC request digest (`<store>/keys/idempotency.key`, included in
snapshots), tokens file stores `sha256(token)` only.

Contract deviations to review:
- `POST /v1/admin/snapshot {name}` added (store-owner only, destination fixed under
  `<store>/backups/`), so a running service can be backed up without stopping it.
- Rebuild is one SQLite transaction instead of stage tables + switch: readers keep the
  old view (WAL) until COMMIT, verification failure rolls back.
- Search source check on hits is `stat` (exists, regular, nlink=1, size); full digest is
  verified on `source.read` and by the projector.
- Projection failures stay `PENDING` (no FAILED/dead-letter state): they block the
  checkpoint and are retried; later events still project.

Manual smoke (scratchpad, not a substitute for tests), all as expected: init/provision/
add-token; observe 201 → retry 200 dedup → divergent retry 409; redaction of `token=`,
`Authorization:` (no secret in DB/WAL/blobs); cross-project recall/observe 403; foreign
event source 404 = unknown id 404; duplicate JSON keys, chunked, double Content-Length,
lone surrogate, extra `agent_id` field → 400; no token → 401; DELETE → 405; second server
refused by store lock; SIGTERM removes the socket; snapshot → restore (dry-run + real) →
`check` ok; rebuild dry-run/real, 0 changed; tampered snapshot blob refused; DS4 blob
observe (verified, DS4 file mtime unchanged), missing `source.raw` → SCOPE, symlink /
hardlink / digest-mismatch DS4 blob refused; cross-scope evidence link refused by trigger;
migration checksum drift → VERSION_CONFLICT; dry-run on missing DB creates nothing.
Found and fixed during smoke: socket paths ≥108 bytes now fail with a clear error;
malformed request lines now get a proper HTTP/1.0 status line.

## Step 5 — Codex: review of M1 code + `tests/**` (Claude verified each finding)

Codex: M0 §3.1 fix verified. Suite 43 tests: 34 PASS, 7 FAIL, 2 SKIP. Claude re-ran the suite
outside the sandbox: same 7 FAILs, all valid against the contract; fixed in Claude-owned files:

| Sev | Finding | Fix |
|---|---|---|
| ALTA | `USER_MESSAGE` stored `actor_type=USER` from client JSON (contract: no USER authority from a declared type) | `ACTOR_FOR_EVENT["USER_MESSAGE"] = "EXTERNAL"` |
| ALTA | restore trusted the manifest: a blob referenced by the DB could be dropped from manifest + dir | restore compares `source_blobs` and DS4 refs in the snapshot DB with the manifest, exact set |
| ALTA | search hit check was `stat` only: same-size tampering passed | `blobs.source_ok` verifies length + digest (`stat_ok` removed) |
| MEDIA | checkpoint `blocked-1` may name no event (AUTOINCREMENT gaps) | `MAX(seq) WHERE seq < blocked` |
| MEDIA | projector never rescheduled (`blocked_seq` is never None while pending); retry had no backoff (`next_retry_at` written, never read) | due-row selection `next_retry_at <= now`, exponential backoff 1 s..300 s; `service_actions` stays scheduled while PENDING remain (runs each 0.5 s poll); idle polls do not write |
| MEDIA | lone surrogate in recall query → `UnicodeEncodeError` (500) | `parse_json_body` rejects lone surrogates in any key/string; `fts.search` rejects too |
| MEDIA | synchronous `POST /v1/admin/snapshot` blocks the serial server | endpoint removed (was not in the contract); snapshot is offline `admin snapshot` only |

Deviations after review: snapshot endpoint **withdrawn**; one-transaction rebuild **accepted**;
stat-only check **withdrawn**; PENDING-only state **kept**, now with scheduler + backoff.

After fixes: 43 tests, 42 PASS, 1 FAIL, 2 SKIP. Remaining FAIL
`test_pending_survives_empty_server_cycle` expects an immediate retry, which the requested backoff
forbids (test side: set `projection.RETRY_BASE_S = 0` or wait). The 2 SKIPs are unconditional
`skipTest` calls, so they never run even where AF_UNIX bind works; live smoke on a real socket
(observe 201, recall hit + checkpoint 1, surrogate 400, removed snapshot route 404, actor
`EXTERNAL`, socket removed on SIGTERM) passed.

## Steps 6–8 — Codex re-review of the step-5 fixes

- Step 6 (Codex): all 7 fixes accepted (ISO-UTC backoff comparison and checkpoint release
  verified). New MEDIA: an unexpected exception in `project_pending` left `_project_pending=False`.
  Codex adapted the retry test to the backoff and made the 2 AF_UNIX tests real (skip only on EPERM).
  Claude fix: on exception the projector stays scheduled, delayed by `PROJECTION_ERROR_DELAY_S` (5 s, monotonic).
- Step 7 (Codex): fix accepted; commit **refused**: after a restart, rows still in backoff were never
  retried without a new observe. Claude fix: `CmfServer` starts with the projector scheduled.
- Step 8 (Codex): fix accepted, restart test added; **commit M1 accepted**.

Suite (run by Claude outside the sandbox): 46 tests, 46 PASS, 0 SKIP. 21 acceptance cases stay
`NOT_RUN` (see `docs/M1-test-status.md`): **G1 stays OPEN**; G0 stays OPEN (no real-model baseline).
