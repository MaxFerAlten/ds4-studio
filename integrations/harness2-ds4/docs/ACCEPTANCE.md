# Acceptance — gate G00–G27 (plan §42.1)

Eseguito il 2026-10-19 su questo host (Linux 7.2, Python 3.12.3, bwrap 0.9.0, systemd user).
`SKIP` non è `PASS`; `NOT RUN` indica ciò che richiede un'azione esplicita dell'utente.

| Gate | Esito | Evidenza |
|---|---|---|
| G00 hash DS4 tracciati identici before/after | PASS | `reports/upstream-fingerprint.json`: entrambi i checkout `identical: true`, 0 differenze (anche untracked) |
| G01 nessuna scrittura ds4-overlay/srun.sh/frontend/wrapper | PASS | G00 + nessun path DS4 scrivibile da config (`Settings.validate`) |
| G02 pin H2, licenze | PASS | submodule @`1cfe254e`, `LICENSES/provenance.lock.json`, notice, SBOM |
| G03 sidecar OFF di default, nulla da srun.sh | PASS | `enabled=false`, `mode=off`; `test_off_equivalence_no_ds4_hook` |
| G04 OFF equivalence | PASS (statico) | DS4 non ha alcun riferimento a h2ds4; run funzionale di DS4 non eseguito (non avviato per mandato) |
| G05 profilo modello locale validato | PASS | probe live `test_l5_live_model_smoke` (1 passed, 15.37s) e smoke `test_l5_opencode_local_proxy_smoke` (1 passed, 97.37s), modello già caricato `deepseek-v4-flash`; 4 chiamate via proxy, 9 eventi JSONL, deliverable creato |
| G06 niente provider remoti/credenziali nascoste | PASS | `test_ut005_*`, `trust_env=False`, `harness2[bridge]` non installato |
| G07 1 inflight, finestra di manutenzione | PASS | `test_ct012_*` (gate e proxy), ack obbligatorio su `run` |
| G08 sandbox rootless offline con test negativi | PASS | L3 19/19, 0 skip (`reports/verification/pytest.log`) |
| G09 socket 0600, owner verificato | PASS | `test_real_uds_server_0600_no_tcp`, smoke ops (`stat 600`, `ss` 0 listener) |
| G10 API tipizzata, idempotenza, auth, size cap | PASS | `tests/contract/test_api.py` |
| G11 tree candidato immutabile, allowlist | PASS | manifest verificato byte per byte, `test_policy.py` |
| G12 baseline sempre fallback | PASS | gate post-selezione; trap → KEEP_BASE; selezione senza artefatto → INCONCLUSIVE |
| G13 validator deterministico hard gate | PASS | `evidence/evaluator.py`, `test_wp13_gate_golden` |
| G14 nessuna sostituzione automatica skill DS4 | PASS | export solo dopo APPROVED, collisioni rifiutate, avvio solo manuale |
| G15 approval audit + CAS + rollback atomici | PASS | `test_overlay_gate.py`, ops smoke, `audit verify` ok |
| G16 experience library compatta, TTL, provenance, segregazione | PASS | `test_evidence_memory.py` |
| G17 token esatti vs stimati distinti | PASS | `usage_source` provider/unknown/none; gate INCONCLUSIVE se unknown |
| G18 ledger k=1 e test H2 upstream | PASS | R=4/P=3 (k=1), R=8/P=6 (k=2); upstream 5/5; demo k=1 |
| G19 crash recovery senza doppio tool-write | PASS | `test_sigkill_worker_recovers_without_rerun` (SIGKILL reale) |
| G20 100% security negative gates | PASS | tutti eseguiti su questo host; nessun SKIP |
| G21 A/B riproducibile, raw redatti | PASS (executor deterministico) | due run `val` → CSV identici per hash; nessun prompt/output grezzo salvato. A/B con modello: NOT RUN |
| G22 native READY o BLOCKED_API documentato | PASS | `docs/DS4_NATIVE_BLOCKERS.md` |
| G23 nessun socket stale / cleanup brutale | PASS | `--recover-stale` esplicito, stop graceful rimuove il socket, solo scope `h2ds4-run-*` |
| G24 user service non abilitato | PASS | unit fornita, mai installata/abilitata |
| G25 stop sidecar lascia DS4 usabile | PASS (statico) | nessuna dipendenza DS4→h2ds4; DS4 non era in esecuzione |
| G26 uninstall e rollback | PARTIAL | rollback R2 dimostrato; uninstall documentato (`OPERATIONS.md`), non eseguito |
| G27 report finale e limiti | PASS | questo file, `reports/gaps.md`, `reports/wp/*.result.json` |

## Esiti A/B (holdout, executor deterministico)

| Gruppo | Δ pass gated (CI95) | Regressioni critiche dopo gate |
|---|---|---|
| in-task k=1 | +0.64 [0.36, 0.86] | 0 (5 KEEP_BASE, 9 QUARANTINE) |
| in-task k=2 | +0.64 [0.36, 0.86] | 0 (costo doppio: 112 rollout vs 56) |
| transfer dev→holdout k=1 | +0.50 [0.07, 0.86] | **2** (trap kv/ledger) |

Lettura: k=2 non aggiunge nulla su questo set a costo doppio (plan §27: restare a k=1). Il
transfer mostra che una skill vincente sul task che l'ha generata può regredire altrove: da
qui il gate holdout obbligatorio (ADR-013), che blocca l'approvazione della skill kv.
Questi numeri descrivono l'algoritmo e il gate con un solver deterministico, **non** un
beneficio del modello DS4.

## Prossimi passi che richiedono l'utente

1. WP11 accetta solo il binario v2.0.32 con SHA-256 allowlisted dopo smoke L5; ogni altro
   binario resta UNVERIFIED e bloccato.
2. A/B model-backed (WP20/L6): criteri preregistrati in `reports/ab/criteria.v1.json`;
   eseguire solo quando il modello già caricato è raggiungibile sull'endpoint locale.
3. Eventuale richiesta separata di API DS4 per il substrate nativo (ADR-008).
