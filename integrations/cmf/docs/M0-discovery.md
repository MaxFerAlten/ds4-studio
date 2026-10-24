# CMF M0 — Discovery report (M0-01) and branch-constraint adaptations

Plan: `docs/feature/piano.DS4CognitiveMemoryFabric.md` v1.0.
Checkout: branch `feature/deepseek-infer`, HEAD `a144d7cfd45a42713e99bf17ae1ccd10ee608ec1`, clean at start.
Authors: Claude Code (discovery), Codex (peer review). Read-only: no upstream file touched.

## 1. Plan adaptations required by the user's constraint

The user requires **one branch only (`feature/deepseek-infer`), no other branch or worktree**.

| Plan section | Plan says | Adapted to |
|---|---|---|
| §57.1 | "Implementa M1 in un branch separato" | Atomic ticket commits on `feature/deepseek-infer` |
| §34 | distinct worktrees, coordinator promotes to `main` | single checkout, strictly sequential edits, no `main` promotion |
| §27.1 / §27.3 | `test_upstream_immutable.sh`, `test_compose_shadow.sh` | these create a temporary *clone*; not run under the constraint, recorded `NOT_RUN` |
| §57 / G0 | M1 only after G0 approved | M1 (standalone, no DS4 hook) proceeds after M0 **discovery** review; G0 stays **open** because the real-model baseline (M0-02) is `NOT_RUN` |
| §43 vs §55 | DAG makes M4→M5, M6→M7 blocking; §55 says M6 optional | core gates (M0–M3, M5) separated from extension gates (M4, M6) |
| §56 | single DoD | standalone M1 acceptance is distinct from integration/release acceptance (real model) |

## 2. Plan claims vs checkout (§1.1)

Legend: FOUND = matches; DIFFERENT = exists but differs from the plan; MISSING = absent.

| Plan claim | Status | Evidence |
|---|---|---|
| `agent_compact_tail_start` ~9724 | FOUND | `ds4_agent.c:9724` |
| `agent_worker_compact_transcript` ~9805 | FOUND | `ds4_agent.c:9805` |
| `agent_compact_make_prompt` ~9744 | FOUND | `ds4_agent.c` (static, before 9805) |
| `worker_run_turn` ~10291 | FOUND | `ds4_agent.c:10291` |
| `agent_worker_append_user` (§21.3 injection point) | FOUND | `ds4_agent.c:10124` |
| `agent_worker_sync_tokens` | FOUND | `ds4_agent.c:5286` (prototype 406) |
| runtime API chat/save/list/switch/strip/new/compact/interrupt | FOUND | `ds4_agent_runtime.h:64-81` |
| `ds4_agent_ext_chat` wraps runtime chat, ~69–107 | FOUND | `ds4-overlay/src/studio/ds4_agent_ext.c:69`; no project/session params (§21.2 confirmed) |
| `ds4_agent_ext_compact` | FOUND | `ds4_agent_ext.c:149` → `ds4_agent_runtime_compact` (`ds4_agent_runtime.c:745`) |
| `ds4_tool_compress_result_text`, `original_saved`, `blob_id` | FOUND | `ds4_tool_compress.h:22,25,39` |
| blob ids: format unproven (§23.1 warns) | **DIFFERENT (resolved)** | `ds4_context_blob.h`: id = `sha256:<lowercase hex>` of exact text, stored at `<base>/sha256/<hex>.txt`; `ds4_tool_compress.c:614-619` copies `ref.id` into `blob_id`. Mapping to `source_blobs.blob_sha256` is "strip `sha256:` prefix", still validated by `ds4_context_blob_id_valid` semantics |
| `ds4_context_blob` SHA-256 primitive | FOUND | `ds4_sha256_hex` exported |
| event types (§6.2 mapping) | FOUND | `ds4_agent_runtime.h:11-20`: TEXT, REASONING, TOOL_CALL, TOOL_RESULT, STATUS, USAGE, DONE, ERROR, SAGE_STATUS, SAGE_ARTIFACT |
| feature `studio-app-layer` with shadow patches | FOUND | `ds4-overlay/features/studio-app-layer/feature.toml`, strict anchors |
| `Makefile.studio` | FOUND | `ds4-overlay/src/studio/Makefile.studio` |
| `overlayctl.py` status/compose/build/rebase-check | FOUND | `status`: 15 features on, anchors all resolve, *no compose for this upstream SHA* |
| `srun.sh` `exec node frontend/server/index.mjs`, `DS4_LEAN_ENABLED` unset-not-exported precedent | FOUND | `srun.sh:10-16` |
| `tests/test_agent_compaction.py` | FOUND | requires real binary + GGUF |
| `scripts/certify_tool_compression*.sh` | FOUND | 6 scripts |
| `tests/test_srun_halogen_containers.sh`, `test_srun_vitronia_server.sh` | FOUND | `tests/` |
| Harness² `ExperienceLibrary` | FOUND | `integrations/harness2-ds4/src/h2ds4/memory/library.py:54` |
| `integrations/openwiki-gateway/` | FOUND | directory present |
| `agno_service/src/ds4_agno` (auth, run registry) | FOUND | `auth.py`, `db.py`, `events.py`, ... |
| frontend excluded from snapshots | FOUND (now visible) | `frontend/server/index.mjs` (6284 lines), `agentIdentity.mjs` (HMAC owner cookie), `agentCompaction.mjs` |
| `integrations/cmf/` | MISSING (expected, new) | — |
| feature `cmf-agent-bridge` | MISSING (expected, new) | — |
| Python ≥3.10 + SQLite FTS5 | FOUND | Python 3.12.3, SQLite 3.45.1, FTS5 available |

## 3. Findings that change later milestones

1. **Native compaction call sites (§16.4 coverage).** All paths end in
   `agent_worker_compact_transcript` (`ds4_agent.c:9805`):
   - automatic, via `agent_worker_compact_if_needed` (`10118`): soft limit before user turn
     (`10301`), soft limit before assistant continuation (`10352`);
   - automatic, via `agent_worker_compact`: make room for incoming user message (`10135`),
     tool result would exceed context (`10754`);
   - automatic, direct call: generation reached compaction reserve (`10668`);
   - explicit: CLI command "user requested compaction" (`11113`), and the API path
     `ds4_agent_ext_compact` → `ds4_agent_runtime_compact` → `agent_worker_compact`
     ("API requested compaction", `ds4_agent_runtime.c:755`; the runtime `#include`s the
     agent source via `DS4_AGENT_UPSTREAM_SRC`).
   The MVP external bridge (M5-02) sees **only the API path**; the five automatic triggers
   and the CLI command stay "not covered" until M5-03. (Corrected after Codex review: the
   first draft mislabelled `10121` and the API route.)
2. **Identity (§21.2).** Frontend already mints an HMAC-signed local owner (`agentIdentity.mjs`)
   distinct from `ds4SessionKey`. M2-04 must reuse it as the CMF principal source, not invent one.
3. **Blob mapping (§23.1).** DS4 blob ids are content SHA-256, so CMF can reference DS4 blobs
   without copying, after re-hashing the file to verify.
4. **Tooling.** GitNexus index was stale (built on another branch); reindexed in this session.

## 4. Not run (honest status)

| Item | Status | Reason |
|---|---|---|
| M0-02 real-model baseline (TTFT, compaction resume, RAM) | NOT_RUN | needs GGUF + long real-model runs |
| `test_upstream_immutable.sh`, `test_compose_shadow.sh` | NOT_RUN | create temporary clones (branch/worktree constraint) |
| M0-03 SBOM of the eight inspiration repos | NOT_RUN | repos not vendored; no code copied (see `LICENSES/SOURCE_MATRIX.md`) |
| M0-04 real anonymised corpus | NOT_RUN | synthetic fixtures only |

**G0: OPEN.** Discovery (M0-01) complete and reviewed; M1 standalone may start.
