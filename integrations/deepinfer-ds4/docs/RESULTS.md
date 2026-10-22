# Risultati Gate 0 / Modalità A e decisione (ADR-001)

Hardware: AMD Strix Halo gfx1151, 128 GB, ROCm 7.2.4, Linux 7.2.0-rc2.
Modello: `DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf`
(residente, 90.9 GiB) + `DeepSeek-V4-Flash-DSpark-support.gguf`.
Prompt: concatenazione di sorgenti C del repo (nessun dato utente). 512 token greedy,
7 run per configurazione, ordine randomizzato con seed, CI bootstrap al 95% (2000 ricampionamenti).
Report completi in `experiments/`.

## Misure

| Esperimento | Config | Decode Δ mediana | CI95 | TTFT p95 Δ (prefill + primo decode) | Draft accettati/ciclo | Gate |
|---|---|---:|---|---:|---:|---|
| ctx 4096 | `--dspark` (default) | +2.3% | +1.7 / +3.2 | -0.9% | n/d | INCONCLUSIVE |
| ctx 4096 | `--dspark-confidence 0.7` | +2.0% | +1.5 / +2.9 | +1.9% | n/d | INCONCLUSIVE |
| ctx 4096 | `--dspark-confidence 0.5` | +1.0% | +0.2 / +1.9 | -2.4% | n/d | INCONCLUSIVE |
| ctx 16384 | `--dspark` (default) | +0.6% | -1.8 / +0.7 | -2.4% | 1.48 | INCONCLUSIVE |
| ctx 16384 | `--dspark-confidence 0.7` | +0.2% | -0.1 / +0.7 | -1.2% | 1.48 | INCONCLUSIVE |
| ctx 4096 | `DS4_DSPARK_SCHEDULER=0` | **+11.0%** | +10.6 / +11.2 | +2.4% | 2.56 | **GO** |
| ctx 4096 | `DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1500` | **+10.0%** | +9.5 / +10.1 | +2.8% | 1.96 | **GO** |
| ctx 4096 | `DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1000` | +9.9% | +9.4 / +10.1 | +3.3% | 1.96 | GO |
| ctx 16384 | `DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1500` | **+12.6%** | +12.3 / +12.7 | +0.5% | 1.80 | **GO** |
| ctx 16384 | `DS4_DSPARK_SCHEDULER=0` | +10.9% | +10.8 / +11.2 | +0.7% | 2.30 | GO |

Baseline: 14.4 tok/s (ctx 4096) e 14.0 tok/s (ctx 16384).

## Diagnosi

Con i default, DSpark su gfx1151 esegue solo 25 cicli speculativi su 512 token: lo scheduler
mette in pausa i draft quando la media accettata scende sotto `MIN_AVG_MILLI`, che su
gfx1151 vale 4000 (`ds4.c:61413-61419`). È la leva che il principio DeepInfer
(`U(m) = (1+E_m)/T(m)`, piano §4.1) indica come tarabile: la soglia è più severa del
punto di pareggio misurato su questo device.

## Correttezza (piano §10.2)

- `--dspark --dspark-strict` produce output greedy identico byte per byte alla baseline, ma
  disattiva la preparazione dei draft (`ds4.c:86313-86322`): nessun guadagno possibile.
- DSpark opportunistico (default upstream e configurazioni GO) diverge dalla baseline greedy
  (qui al byte 398 di una risposta da 400 token). È la divergenza documentata upstream
  (stato del verificatore batched, ordine fp diverso; `docs/SPECULATIVE_DECODING.md`,
  `ds4.c:72451-72455`). I knob dello scheduler non cambiano la classe di equivalenza
  rispetto a `--dspark` default: aumentano solo quanto spesso DSpark gira.
- Non misurati: equivalenza statistica con temperatura > 0 (`--mtp-exact-sampling`),
  qualità su benchmark di task, contesti 64K/100K, carico server/agent.

## Decisione

1. **Nessun default cambiato.** Regola 4 del piano: DSpark opportunistico cambia l'output
   greedy, quindi non può diventare il default rispetto al decode ordinario.
   `config/deepinfer-overlay.defaults.json` resta tutto OFF.
2. **Per chi usa già `--dspark`** (che accetta già questa divergenza), la Modalità A raccomanda
   `DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1500`: è GO a 4K e 16K con il guadagno più costante,
   e mantiene il backoff dello scheduler, a differenza di `DS4_DSPARK_SCHEDULER=0`.
   Applicazione manuale al prossimo avvio:
   ```bash
   DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1500 ./ds4-server --dspark --mtp-model gguf/DeepSeek-V4-Flash-DSpark-support.gguf ...
   ```
3. **Prima di proporre il valore upstream** (default gfx1151 in `ds4.c`): ripetere con
   prompt di prosa e tool-use (l'accettazione dipende dal contenuto), con V4 Flash 0731 e
   V4.1, con `--mtp-exact-sampling`, e con contesti 64K. Il valore 4000 potrebbe essere stato
   scelto per altri carichi: un NO_GO su prosa è un risultato valido.
