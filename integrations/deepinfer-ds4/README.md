# deepinfer-ds4

Integrazione mirata di [DeepInfer](https://github.com/deepseek-ai/DeepInfer)
(`9bd9cf2`, Apache-2.0) in DS4-Studio, secondo
[`docs/feature/piano.integrazione.deepinfer.ds4-studio.md`](../../docs/feature/piano.integrazione.deepinfer.ds4-studio.md).

**Non tocca il runtime DS4.** Nessun file di `ds4.c`, `ds4-overlay/` o upstream è
modificato; nessun codice DeepInfer è linkato in `ds4`, `ds4-server`, `ds4-agent`,
`ds4-wrapper`. Tutti i flag sono OFF (`config/deepinfer-overlay.defaults.json`).

## Perché così poco

L'inventario (`docs/INVENTORY.md`) ha mostrato che DS4 ha già uno scheduler DSpark
adattivo con confidence head e backoff (`ds4.c:61375-61660`), ma nessun hook per
impostare la lunghezza draft per step dall'esterno, nessun grammar engine e nessun
token mask pre-sample. Ciò che DeepInfer porta di trasferibile oggi è quindi
**Modalità A** del piano §4.1: scegliere *configurazioni intere* tra sessioni sulla
base di misure ripetute, con gate statistici. Il resto è documentato come
NO-GO / rinviato in `docs/CAPABILITY_MATRIX.md`.

## Contenuto

| Percorso | Cosa | Origine DeepInfer |
|---|---|---|
| `c/` | Libreria C11 senza dipendenze: `E_m`, scelta draft `U(m)=(1+E_m)/T(m)`, port di `MTPVarlen::schedule`, finestra mediana, state machine `DISABLED→SHADOW→CANARY→ENABLED/FALLBACK` | `csrc/engine/mtp_varlen.hpp` |
| `python/deepinfer_ds4/` | Control plane: perf-profile atomico (schema v1), ingest CSV `ds4-bench`, selettore Modalità A con bootstrap CI, CLI | `deepinfer/worker/decode_perf_cache.py` |
| `recipe-adapter/` | Processo Rust opt-in su deepseek-recipe (`encode`/`parse`), oracolo golden sul renderer DS4, validazione tool call; routing NO-GO (`docs/RECIPE_ADAPTER.md`) | deepseek-recipe (MIT) |
| `scripts/bench_matrix.sh` | Matrice benchmark Gate 0: ordine randomizzato con seed, un CSV per run, metadata senza prompt | — |
| `docs/` | Inventario `file:line`, capability matrix, operazioni | — |
| `LICENSES/` | Licenza Apache-2.0, notices, `third_party.lock.json` | — |

## Risultato

Su Strix Halo, con `--dspark` già attivo, abbassare la soglia dello scheduler
(`DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1500`) dà +10.0% decode a 4K, +12.6% a 16K e +25.1% a 64K,
con CI al 95% sopra il +5% e TTFT invariato. Nessun default cambiato: dettagli,
limiti e correttezza in [`docs/RESULTS.md`](docs/RESULTS.md).

## Verifica

```bash
integrations/deepinfer-ds4/tests/run_all.sh
```

Offline: niente GPU, modello o rete. I benchmark reali sono in `docs/OPERATIONS.md`.

## Rollback

Rimuovere la directory `integrations/deepinfer-ds4/`. Nessun altro file dipende da essa.
