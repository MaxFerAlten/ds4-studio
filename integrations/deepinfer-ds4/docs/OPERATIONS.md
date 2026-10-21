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
cd integrations/deepinfer-ds4/python
python3 -m deepinfer_ds4 select --baseline 'runs/X/baseline/*.csv' \
  --candidate 'dspark-c07=runs/X/dspark-c07/*.csv' --seed 1
```

Gate (default in `config/deepinfer-overlay.defaults.json`): GO solo se il limite
inferiore della CI 95% del miglioramento mediano di `gen_tps` è >= +5% e il p95 di
`gen_first_ms` non peggiora oltre il 5%; NO_GO se il limite superiore è < -3%.
Il selettore **raccomanda**: l'operatore applica la configurazione al prossimo avvio.
Nessun riavvio automatico.

## 4. Profilo

```bash
python3 -m deepinfer_ds4 profile write --dir ~/.cache/ds4/deepinfer-perf \
  --identity identity.json --csv runs/X/baseline/run-01.csv
```

Il profilo è invalidato da qualsiasi cambio di identità (modello, runtime, backend,
quantizzazione, contesto, MTP).
