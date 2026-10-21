# Operazioni — Gate 0 e selezione Modalità A

Nessun numero di performance è dichiarato finché questa procedura non gira su
Strix Halo. Risultati negativi sono validi e producono NO-GO.

## 1. Configurazioni candidate

`configs.tsv` (una per riga, `label<TAB>argomenti`; knob `DS4_*` in testa):

```
baseline
dspark-c07	--dspark --dspark-confidence 0.7 --mtp-model gguf/DeepSeek-V4.1-Flash-DSpark.gguf
dspark-c05	--dspark --dspark-confidence 0.5 --mtp-model gguf/DeepSeek-V4.1-Flash-DSpark.gguf
dspark-w8	DS4_DSPARK_SCHEDULER_WINDOW=8 --dspark --dspark-confidence 0.7 --mtp-model gguf/DeepSeek-V4.1-Flash-DSpark.gguf
```

Una modifica alla volta rispetto alla baseline (piano §10.1).

## 2. Misura

Con server/agent fermi (un solo modello residente):

```bash
integrations/deepinfer-ds4/scripts/bench_matrix.sh \
  --configs configs.tsv --out runs/$(date +%Y%m%d) --rounds 7 --seed 1 --hash-model \
  --bench ./ds4-bench -- -m gguf/DeepSeek-V4.1-Flash-Q2.gguf \
  --ctx-start 4096 --ctx-max 4096 --gen-tokens 512
```

Ripetere per i contesti del piano §2.4 (512/4K/16K/64K/100K) entro i limiti di RAM.

## 3. Decisione

```bash
PYTHONPATH=integrations/deepinfer-ds4/python python3 -m deepinfer_ds4 select \
  --baseline 'runs/X/baseline/*.csv' \
  --candidate 'dspark-c07=runs/X/dspark-c07/*.csv' --ctx 4096 --seed 1
```

Comandi dalla root del repository. `--ctx N` seleziona solo le righe con
`ctx_tokens=N`; senza filtro resta l'errore se i CSV mescolano contesti. Un
contesto assente produce un errore. Anche `ingest` accetta il filtro opzionale:

```bash
PYTHONPATH=integrations/deepinfer-ds4/python python3 -m deepinfer_ds4 ingest \
  --csv 'runs/X/dspark-c07/run-*.csv' --label dspark-c07 --ctx 4096
```

Gate (default in `config/deepinfer-overlay.defaults.json`): GO solo se il limite
inferiore della CI 95% del miglioramento mediano di `gen_tps` è >= +5% e il p95 di
`gen_first_ms` non peggiora oltre il 5%; NO_GO se il limite superiore è < -3%.
Il selettore **raccomanda**: l'operatore applica la configurazione al prossimo avvio.
Nessun riavvio automatico.

## 4. Profilo

```bash
PYTHONPATH=integrations/deepinfer-ds4/python python3 -m deepinfer_ds4 profile write \
  --dir ~/.cache/ds4/deepinfer-perf \
  --identity identity.json --csv runs/X/baseline/run-01.csv
```

Il profilo è invalidato da qualsiasi cambio di identità (modello, runtime, backend,
quantizzazione, contesto, MTP).

## 5. Telemetria DSpark / MTP dai log

```bash
PYTHONPATH=integrations/deepinfer-ds4/python python3 -m deepinfer_ds4 dspark-log \
  --log runs/X/dspark-c07/run-01.log runs/X/dspark-c07/run-02.log
```

`--log` è ripetibile. L'output JSON contiene `event_counts`, `accepted_drafts`,
`cycles`, `acceptance_avg` (draft accettati per ciclo) e `unknown_lines`. Le righe
ignote o malformate vengono contate; nessun testo del log viene conservato.
`null` indica una misura non disponibile, distinto dallo zero misurato.

I totali usano prima i riepiloghi di sessione `DSpark stats` / Qwen MTP, poi i
timing per ciclo (V4.1 DSpark o MTP), poi le sole finestre scheduler stampate.
Le fonti sovrapposte non vengono sommate. `accepted_total` è cumulativo e non
viene sommato; un `bypass` non espone i cicli, quindi rende ignoti cicli e media
del fallback scheduler. La precedenza si applica separatamente a ogni file.

Se accanto a un CSV selezionato esiste il corrispondente `.log`, `select` aggiunge
`telemetry` per configurazione (baseline inclusa) e `telemetry_scope: whole_run`.
La telemetria non cambia le decisioni. Un log non espone il contesto: con CSV
multi-contesto descrive l'intero run, anche quando si usa `--ctx`.

Questi comandi leggono log già presenti. Durante future misure autorizzate,
`DS4_DSPARK_SPEC_LOG=1` abilita gli eventi scheduler e `DS4_DSPARK_STATS=1` il
riepilogo di sessione; i timing MTP dipendono dal path runtime (`--mtp-timing` /
`DS4_MTP_TIMING=1`). L'assenza di log non è una misura di accettazione zero.

## 6. Report dell'esperimento

```bash
python3 integrations/deepinfer-ds4/scripts/experiment_report.py runs/X > report.md
```

Il report Markdown include i campi previsti da `bench_matrix` in `metadata.json`,
numero di misure, mediane di `gen_tps` e `prefill_tps`, p95 nearest-rank di
`gen_first_ms`, riepilogo DSpark per configurazione e contesto, e decisioni
contro `baseline` per ogni contesto con i gate standard e il seed nei metadata.
Contesti mancanti o poche ripetizioni producono `INSUFFICIENT_DATA`.

Vengono letti solo i log abbinati a CSV presenti; i log di run falliti senza CSV
sono esclusi. La colonna DSpark è esplicitamente riferita all'intero run.
Il report stampa basenames e omette campi metadata arbitrari, prompt e comandi.
È una lettura offline: non avvia benchmark, runtime o modelli.
