# Capability matrix e decisioni (piano §2.3, §15)

Capability non dimostrata = `false`. Fonte: `INVENTORY.md`.

| Capability | Valore | Evidenza |
|---|---|---|
| gguf | true | runtime DS4 |
| mtp_draft (DSpark / MTP) | true | `ds4.h:133-159` |
| mtp_variable_length (impostabile per step dall'esterno) | **false** | nessun hook; solo scheduler interno |
| mtp_confidence_available (interno) | true | confidence head DSpark `ds4.c:8858` |
| mtp_confidence esportata all'esterno | **false** | non esposta da API |
| logits_token_mask | **false** | nessun hook pre-sample |
| grammar_native | **false** | solo euristica DSML greedy |
| kv_persist | true | `ds4_kvstore.h` |
| kv_restore_exact (fingerprint v2) | **false** | non verificato |
| bounded_swa_replay | **false** | piano §7.3: R&D |
| deterministic_sampling greedy | parziale | upstream: riduzioni batched ≠ one-token |

## Stato pacchetti di lavoro

| PR piano | Stato | Note |
|---|---|---|
| PR-00 inventory | **fatto** | `INVENTORY.md` |
| PR-01 overlay/hooks | **non necessario ora** | nessun hook richiesto per Modalità A |
| PR-02 telemetry/perf-cache | **fatto (control plane)** | `python/deepinfer_ds4/perf_profile.py`, `bench_ingest.py` |
| PR-03 speculation shadow | **fatto (libreria)** | `c/` policy + state machine, non collegata all'hot path |
| PR-04 canary ON/OFF | **fatto (Modalità A)** | `spec_select.py` con gate §10.2; nessun riavvio automatico |
| PR-05 recipe adapter | bloccato | serve clone esplicito deepseek-recipe |
| PR-06 grammar | NO-GO | manca hook token mask |
| PR-07 kv identity | rinviato | cambia formato on-disk |
| PR-08 swa spike | R&D | |
| PR-09 scheduler async prep | rinviato | single inference DS4 |
| PR-10 moe hotness | rinviato | richiede patch ds4.c |
| PR-11 hardening | parziale | test unit; benchmark baseline da catturare su HW |

## Gate

- Gate 0 (baseline ripetibile): **aperto** — richiede run reali `ds4-bench` su Strix Halo (>=7 run/scenario). Lo strumento è pronto (`OPERATIONS.md`).
- Gate 2: decisione automatica `GO/NO_GO/INCONCLUSIVE/INSUFFICIENT_DATA` da `spec_select`; nessun numero dichiarato senza misure.
