# Architettura

```text
 DS4 Studio (IMMUTATO)                      h2ds4 (repository esterno)
 ┌───────────────────────┐   GET /v1/models    ┌──────────────────────────────────────────┐
 │ ds4_server :8002      │◀──── POST /v1/chat ─┤ model/proxy.py  (UDS, whitelist, budget, │
 │ (modello già caricato)│   (solo loopback)   │   gate 1-inflight, check switch modello) │
 └───────────────────────┘                     │            ▲ AF_UNIX bind-mount            │
 skills/ (letto, mai scritto)                  │ sandbox/bwrap.py: bwrap --unshare-all     │
                                               │   in systemd-run --user --scope            │
                                               │   (TasksMax, MemoryMax, CPUQuota)          │
                                               │   workspace tmpfs, bridge 127.0.0.1→UDS    │
                                               │ orchestration/engine.py ── harness2 core   │
                                               │   run_task(k) → R=4k, P=3k (ledger H2)     │
                                               │ evidence/evaluator.py  (deterministico)    │
                                               │ policy/promotion.py  (gate con baseline)   │
                                               │ overlay/*  (quarantena, approve, pointer)  │
                                               │ store/sqlite.py WAL + blobs + audit chain  │
                                               │ protocol/api.py  HTTP su UDS 0600          │
                                               └──────────────────────────────────────────┘
```

## Flusso di un esperimento (`k=1`, modalità `agg`)

1. `POST /v1/experiments`: solo ID registrati (fixture, harness base, profilo modello,
   evaluator). Stima budget H2 (`4k` rollout, `3k` sessioni) e rifiuto preventivo se eccede.
2. `POST …/run` con ack esplicito della finestra di manutenzione → job persistente (`max_queued=1`).
3. Worker unico (lease + heartbeat in SQLite): `PREFLIGHT` (modo, digest fixture/evaluator/
   harness, sandbox, substrate, fingerprint DS4 *before*).
4. `harness2.core.schedule.run_task` con `Ds4BenchAdapter` + proposer:
   `base1` → `inv1`/`dom1` (proposte, validate da H2 **e** da `policy/mutation.py`) → probe →
   `agg1` (composizione) → probe. Lo stato avanza `BASELINE→PROPOSING→PROBING→COMPOSING` dai
   callback, solo in avanti, con CAS.
5. `EVALUATING`: evaluator deterministico su baseline e candidato selezionato (gold mai montati
   nel sandbox del solver), poi `decide()`; fingerprint DS4 *after*: se diverso → `FAILED
   INTEGRITY_FAILURE`.
6. `QUARANTINE_CANDIDATE` → overlay materializzato (`O_NOFOLLOW|O_EXCL`, fsync, rename
   atomico) in `$XDG_DATA_HOME/h2ds4/overlays/<digest>/`, record `QUARANTINED`, lezione in
   experience library. Ogni altro esito → `REJECTED` con decisione registrata.

## Gap d'interfaccia Harness² (H2_INTERFACE_GAP), risolti senza toccare upstream

| Gap | Soluzione |
|---|---|
| `OPENCODE_SURFACE.autotrigger_file = guardrails.md`, ma C2 è immutabile in fase 1 | `DS4_SURFACE` = stessa surface (stesso `name`, i prompt H2 sono indicizzati per nome) con trigger in `systemprompt.md` dopo il marker `H2DS4_DYNAMIC_GUIDANCE` e `plugin_dir=None` |
| Il proposer upstream è un subprocess con accesso ai file (Claude/OpenCode via Vertex) | `Ds4LocalProposer(Proposer)`: inline del context tree (cap), chiamata al modello locale via gate+budget, parsing di blocchi `<file path="harness/...">` |
| `selection_pool()` non contiene la baseline | gate post-selezione `policy/promotion.py`; test di regressione intenzionale `test_selection_pool_excludes_baseline_documented_gap` |
| Ledger H2 in USD | ignorato come costo; token/tempo dal proxy, marcati `provider`/`unknown`/`none` |
| OpenCode pinnato da H2 (`23fb5e05`, v1.14.18 via bun) assente; installato v2.0.32 binario | solo il digest SHA-256 allowlisted dopo smoke L5 è `VERIFIED`; altri binari restano `UNVERIFIED` |

## Substrate

| Nome | Stato | Uso |
|---|---|---|
| `scripted_local` | READY | solver deterministico senza modello nel sandbox reale: conformance L4, test, A/B dell'algoritmo e del gate |
| `opencode_local` | VERIFIED (digest allowlisted) | OpenCode nel sandbox, modello DS4 solo via proxy UDS + bridge loopback |
| `ds4_native` | BLOCKED_API | vedi `DS4_NATIVE_BLOCKERS.md` |

## Stato su disco (mai sotto DS4)

```text
$XDG_RUNTIME_DIR/h2ds4/h2ds4.sock            0600, dir 0700 (+ inf-*.sock per esperimento)
$XDG_DATA_HOME/h2ds4/state.sqlite3            0600, WAL, migrazioni con checksum
$XDG_DATA_HOME/h2ds4/blob/sha256/…            content-addressed
$XDG_DATA_HOME/h2ds4/overlays/<digest>/       quarantena immutabile + .manifest.json
$XDG_DATA_HOME/h2ds4/approved/current.json    pointer esterno (scritto dopo commit)
$XDG_DATA_HOME/h2ds4/staged-skills/<digest>/  export per avvio volontario
$XDG_DATA_HOME/h2ds4/admin.token              0600, bearer per approve/activate/rollback/audit
$XDG_CACHE_HOME/h2ds4/experiments/<id>/       lavoro H2 (contesti, harness, output rollout)
```
