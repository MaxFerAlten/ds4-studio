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
| PR-05 recipe adapter | bloccato | checkout di studio `../recipe-study` @ `935817c` (MIT); integrazione delle dipendenze Rust di terze parti negata dal classificatore permessi: richiede approvazione utente |
| PR-06 grammar | NO-GO | manca hook token mask |
| PR-07 kv identity | **fatto (derivazione offline)**; persistenza rinviata | `identity.py` / CLI `identity`: header GGUF, hash separati, fingerprint campionato o hash completo esplicito; campi KV non verificati a `null`. Formato KV on-disk invariato; restore esatto e manifest verificati ancora rinviati |
| PR-08 swa spike | R&D | |
| PR-09 scheduler async prep | rinviato | single inference DS4 |
| PR-10 moe hotness | **parser offline fatto**; cattura bloccata su ROCm | `expert_heat.py` / CLI `expert-heat` (hotlist v1, profilo JSON). Profiler DS4 solo Metal (`ds4.c:72002`): su Strix Halo serve hook upstream. Vedi `EXPERT_HEAT.md` |
| PR-11 hardening | parziale | test unit + Gate 0 reale; restano prosa/tool-use, V4.1, 64K, exact sampling |

## Gate

- Gate 0 (baseline ripetibile): **chiuso** per V4 Flash IQ2XXS su gfx1151, ctx 4K e 16K, 7 run/scenario (`RESULTS.md`, `experiments/`).
- Gate 2 (beneficio >5% con CI): **GO** per `DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1500` con `--dspark` (+10.0% a 4K, +12.6% a 16K); **non promosso a default**: DSpark opportunistico cambia l'output greedy (regola 4). Vedi ADR-001 in `RESULTS.md`.
