# DSpark su Strix Halo: fatti verificati per agenti

Stato al 2026-10-23, branch `feature/deepseek-infer`. `ds4.c` è identico byte per byte a
`upstream/main` 5379c1c (antirez/ds4, 2026-10-19). Le funzioni sono citate per nome. I numeri
di riga sono indicativi e cambiano a ogni sync: verificarli con `grep` prima di usarli.
Misure complete: `RESULTS.md` e `experiments/`.

## 1. Soglia dello scheduler DSpark (solo V4 Flash)

- Funzione: `ds4_dspark_scheduler_min_avg_milli()` in `ds4.c` (~61413).
- Default:
  - **4000 su gfx1151**: introdotto upstream in `e532136` (2026-08-28, "fix(rocm): adapt
    DSpark scheduling on gfx1151");
  - 1000 con Spark TP;
  - 1500 su tutti gli altri device.
- Override: `DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=<n>`, letto da `ds4_dspark_env_u32()`. Un
  valore vuoto, non numerico o oltre UINT32_MAX ricade in silenzio sul default, senza errori.
- Effetto: dopo una finestra di cicli, lo scheduler sospende i draft se la media dei draft
  accettati per ciclo è sotto `n/1000`. Su gfx1151 codice e tool-use accettano 1.8–2.4
  draft per ciclo, quindi con 4000 DSpark viene sospeso proprio dove conviene.
- Misurato su gfx1151, IQ2XXS non-0731, 7 run per config, CI bootstrap al 95%:
  - ds4-bench su codice, 1500 contro baseline: +10.0% a 4K, +12.6% a 16K, +25.1% a 64K
    (tutti GO). Il default 4000 dà +2.3% a 4K e +0.6% a 16K.
  - ds4-server tool-use: 1500 +15.8% contro baseline e +6.2% contro 4000.
  - Prosa e `promessi_sposi.txt` (il workload upstream): 1500 e 4000 producono gli stessi
    cicli e gli stessi draft accettati. La protezione per accettazione bassa resta.
  - `DS4_DSPARK_SCHEDULER=0` (scheduler spento): prosa -18.7%. Da non usare.
  - Con DSpark il TTFT sale di 25–300 ms per richiesta (+19–29% sui prompt brevi). Con
    output di 16 token DSpark perde anche in decode.
  - Con `--mtp-exact-sampling` e temperatura > 0 il knob non porta guadagno.
- Regola 4 del piano: DSpark opportunistico cambia l'output greedy rispetto al decode
  ordinario. Il knob non cambia questa classe di equivalenza, aumenta solo quanto spesso
  DSpark gira. Per questo **nessun default di DS4 va cambiato**: il knob vale solo per chi
  usa già `--dspark`.

## 2. DeepSeek V4.1: la soglia non ha effetto

- `ds4_session_eval_speculative()` instrada le sessioni V4.1 (`ds4_session_is_ds41`) verso
  `ds41_session_speculate()` prima di arrivare al percorso V4 Flash.
- `ds41_session_speculate()` non chiama lo scheduler. La soglia la legge solo
  `ds4_session_dspark_scheduler_note()`, che viene chiamata soltanto da:
  - `ds4_session_eval_dspark_speculative_argmax`;
  - `ds4_session_eval_dspark_speculative_stochastic`;
  - `ds4_session_eval_speculative_argmax_impl`.
- V4.1 è controllato solo da questi meccanismi:
  - controllo di disponibilità (drafter presente, niente `--dspark-strict`, 128 token di
    riscaldamento dopo un restore);
  - `--dspark-confidence`;
  - `DS4_DSPARK_VERIFY_CAP`.

  Non sospende i draft quando l'accettazione è bassa.
- **Nessuna misura su V4.1.** Non scrivere che conviene o che non conviene: è aperto.
  - Su 128 GB, V4.1 Q2/IQ2 (341 GiB) gira solo con `--ssd-streaming`, un regime diverso
    da V4 residente.
  - La verifica batched di 5 token potrebbe ammortizzare le letture degli expert, oppure
    toccare più expert.
  - Il drafter (8 GiB residenti) toglie memoria alla cache degli expert.
- Il drafter V4.1 (`DeepSeek-V4.1-Flash-DSpark.gguf`, 8.04 GiB) **non è presente in
  locale**, e i drafter V4 non sono intercambiabili. Si costruisce con
  `gguf-tools/deepseek41_dspark.py` a partire da `deepseek-ai/DeepSeek-V4.1-Flash` alla
  revisione `df42c109f1defefcbfcedbe7d905718a12266e40`. Servono config, indice dei tensori
  e solo gli shard 44–46 (`mtp.*`). Il download richiede l'approvazione dell'utente.

## 3. DS4 Studio (`srun.sh`, ds4-wrapper sulla porta 8002)

- Config: `frontend/ds4-ui.config.json`. Non è tracciato da git.
- `server.env` accetta qualunque chiave `DS4_*` (`validateConfig` in
  `frontend/server/config.mjs`). Viene passato al backend da `buildEnv()` in
  `frontend/server/index.mjs`. `Ds4ProcessManager.resolveEnv()` unisce l'intero
  `process.env` del processo Node con `server.env`; in caso di conflitto vince `server.env`.
  `compactEnv()` scarta i valori vuoti, quindi una chiave con `""` non viene esportata.
  `KEY=… ./srun.sh` funziona una tantum; le impostazioni persistenti vanno in
  `server.env`.
- Dal 2026-10-23 la config contiene `"DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI": "1500"`. È
  innocua con qualunque modello: senza DSpark V4 nessuno la legge. Il backup precedente è
  `frontend/ds4-ui.config.json.bak-before-minavg`.
- La GUI di tuning (`scripts/srun_tuning_gui.py`) mostra le chiavi non note nel riquadro
  "Extra DS4_* environment variables". Se la riga viene cancellata da lì, la chiave sparisce
  dalla config.
- **Non impostare `server.dspark: true` senza un `mtp` valido per quel modello**:
  `ds4_engine_open` rifiuta `--dspark` senza drafter. Il modello V4 con drafter già
  configurato è `DeepSeek-V4-Flash-Vision-Exp-Layers37-42Q4K…`, con
  `perModel[...].mtp = …Vision-Exp-DSpark-support.gguf`.

## 4. Come misurare (lezioni apprese)

- Prima di misurare, fermare il ds4-wrapper dell'utente (porta 8002). Lo ferma e lo
  riavvia l'utente: chiedere sempre.
- Benchmark offline: `scripts/bench_matrix.sh` (ds4-bench, un processo per run, ordine
  randomizzato con seed) e poi `scripts/experiment_report.py`.
- Server: `scripts/make_server_workload.py`, `scripts/server_matrix.py` (server fresco per
  ogni run, nonce contro il riuso del prefisso) e `scripts/server_report.py`.
  - Il decode va preso dal log del server (`gen / (total - prefill)`): lo streaming
    trattiene i delta durante la classificazione thinking/DSML, quindi il tps misurato dal
    client è falsato.
- Gate: GO se il limite inferiore del CI è almeno +5% e il TTFT p95 peggiora al massimo del
  5%. NO_GO se il limite superiore del CI è sotto -3%. Minimo 7 run.
- Il limite dei task in background è 2 h. Per job più lunghi usare
  `setsid nohup … & disown` più un watcher.
- L'hook rtk riscrive `cat`/`grep`/`tail` e ne riassume l'output. Per output da leggere con
  uno script usare `rtk proxy <cmd>`. `rtk read` non esiste.
- Nei report committati non devono comparire percorsi `/home` o `/mnt`.

## 5. Upstream

- Bozza dell'issue sulla soglia per gfx1151: `deepinfer-runs/issue-gfx1151-min-avg.md`,
  nella directory accanto al checkout `ds4-studio/`, fuori dal repo. Accanto ci sono i
  dati grezzi delle misure. **Non pubblicata, per decisione dell'utente.** Non pubblicarla senza una
  nuova richiesta esplicita.
- Issue upstream correlate: #597 (proposer ROCm, risolta) e #695 (break-even dello scheduler
  su Metal).
- `git fetch upstream` aggiorna solo `upstream/*`. Il `main` locale e `origin/main` restano
  `1dee11c`. Il fork sincronizza il contenuto, non la storia (merge-base di maggio): un
  merge con upstream va pianificato.

## 6. Aperti

- V4.1 con DSpark: download degli shard 44–46, conversione, misura in SSD streaming.
- Il modello `IQ2XXS-0731` usato da upstream non è disponibile in locale. Con DSpark
  residente la variante `Layers37-42Q4K-0731` entra solo con `--ctx-alloc 4096`.
- Non misurati: sessioni concorrenti o batched, contesti oltre 64K.
- PR di `feature/deepseek-infer` verso main: porta con sé 34 commit di base che non sono
  su origin/main.
