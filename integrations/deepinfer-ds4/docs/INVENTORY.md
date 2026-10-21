# Inventario DS4 — punti di innesto DeepInfer (Fase 0, PR-00)

Revisione DS4-Studio: vedi `LICENSES/third_party.lock.json` → `ds4_studio_base_commit`.
DeepInfer: `9bd9cf2` (studio read-only in `../DeepInfer`). Numeri di riga verificati
su questa revisione; vanno ricontrollati dopo ogni sync upstream.

## 1. Speculazione (MTP / DSpark)

| Elemento | Posizione | Note |
|---|---|---|
| Opzioni engine `mtp_path`, `mtp_draft_tokens`, `mtp_margin`, `dspark_confidence_threshold`, `dspark`, `dspark_strict`, `dspark_exact_sampling` | `ds4.h:133-159` | Lette solo all'avvio dell'engine |
| `ds4_engine_mtp_draft_tokens()`, `ds4_engine_has_mtp()`, `ds4_engine_mtp_exact_sampling()` | `ds4.h:615-617` | Getter read-only |
| CLI `--mtp-model/--mtp-timing/--dspark/--dspark-confidence/--dspark-strict/--mtp-exact-sampling/--quality` | `ds4_cli.c:2021-2057`, `ds4_server.c:15642-15704` | Default `mtp_draft_tokens=1`, `mtp_margin=3.0` (`ds4_server.c:15580`, `ds4_cli.c:1926`) |
| Scheduler DSpark adattivo (stato per sessione `dspark_sched_*`) | `ds4.c:61242-61262` | Già implementa backoff su bassa accettazione |
| Knob scheduler (`DS4_DSPARK_SCHEDULER`, `_WINDOW`, `_SKIP`, `_SLOW_SKIP`, `_MIN_AVG_MILLI`, `_MAX_MS_PER_ACCEPT_MILLI`, `_MAX_EXTRA_SAVED_RATIO_MILLI`, `_BREAK_EVEN_WINDOW`, `_NO_DRAFT_SKIP`, `_SHORT_ACCEPT_NO_DRAFT_SKIP`, `_COLD_LOW_CONFIDENCE_SKIP`, `_TAIL_MIN_TOKENS`, `_COLD_LOW_CONFIDENCE_MILLI`) | `ds4.c:61375-61460` | Tutti via `getenv`, letti per ciclo; default specifici gfx1151 |
| `ds4_session_dspark_scheduler_should_skip()` / `_note()` | `ds4.c:61489`, `ds4.c:61509` | Decisione skip/pausa e accounting; log su stderr (`ds4.c:61600/61637/61655`) |
| Timing-sensitive scheduling opt-in | `ds4.c:61463` | Commento upstream: tenuto OFF per riproducibilità greedy |
| Confidence head DSpark | `ds4.c:2943`, `ds4.c:3068`, `ds4.c:8858` | Confidence per-posizione esiste nel drafter DSpark |
| Draft max | `DS4_DSPARK_MAX_BLOCK_SIZE 16` `ds4.c:2914`; doc: fino a 5 draft | |
| Qwen MTP adattivo (`DS4_QWEN4_MTP_DEPTH`) | `docs/SPECULATIVE_DECODING.md` §Qwen3.8 | Policy adattiva upstream già presente |

**Conseguenza.** DS4 ha già un controller adattivo in-hot-path (count-based, deterministico)
con confidence pruning. Il principio DeepInfer `MTPVarlen::schedule` (U(m)=(1+E_m)/T(m))
è più generale ma *non esiste un hook stabile* per impostare la lunghezza draft per step
dall'esterno: `ds4.c` è upstream (antirez) e un patch ne cambierebbe il path aritmetico.
Applicazione scelta: **Modalità A** (piano §4.1) — selezione di configurazioni intere
(`--dspark-confidence`, knob env, OFF/ON) **tra sessioni**, su benchmark misurati.

## 2. Telemetria / benchmark

| Elemento | Posizione |
|---|---|
| `ds4-bench --csv FILE`, header `ctx_tokens,prefill_tokens,prefill_tps,gen_tokens,gen_tps,gen_first_ms,gen_steady_tokens,gen_steady_tps,kvcache_bytes` | `ds4_bench.c:302`, `ds4_bench.c:782` |
| `--dspark`, `--ctx-start/--ctx-max/--ctx-alloc`, `--gen-tokens` | `ds4_bench.c:273-302` |
| Contatori stderr DSpark (`--mtp-timing`) | `ds4.c:61600-61660` |
| Metriche wrapper | `ds4_wrapper_metrics.c` |

Nessun ring buffer di eventi per-step esposto: la telemetria per-step (piano §3.2) richiederebbe un patch a `ds4.c` → rinviata (vedi CAPABILITY_MATRIX).

## 3. Structured output

Nessun grammar engine / `json_schema` / `response_format` in `ds4_server.c`. `ds4_agent.c:10233`
decodifica greedy i byte DSML una volta entrati in tool stanza (euristica, non mask logits).
Nessun hook pre-sample per token mask → Fase 4 **NO-GO** fino a hook upstream.

## 4. KV / sessioni

| Elemento | Posizione |
|---|---|
| API `ds4_kvstore_*` (open/evict/key_kind/reason_code/…) | `ds4_kvstore.h:109-156` |
| Freeze/unfreeze sessione (RAM o disco) | `ds4_wrapper_state.c:115-154` |

Fingerprint v2 (piano §7.1) toccherebbe il formato on-disk di `ds4_kvstore.c`: rinviato a PR-07 dedicato.

## 5. Protocol adapter (deepseek-recipe)

Nessun checkout locale di deepseek-recipe; regola 6 del piano vieta fetch implicito. Toolchain Rust presente (`~/.cargo/bin`). PR-05 sbloccabile dopo clone esplicito e pin SHA.

## 6. Overlay

Overlay esistente `ds4-overlay/` (shadow tree, patch esatte, `git apply --check`). Questa
integrazione **non aggiunge feature all'overlay** e non patcha upstream: vive in
`integrations/deepinfer-ds4/` come control plane esterno (come `integrations/harness2-ds4/`).
