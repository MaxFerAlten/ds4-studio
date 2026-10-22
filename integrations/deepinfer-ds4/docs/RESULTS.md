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
| ctx 65536 | `DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1500` | **+25.1%** | +25.0 / +25.4 | +0.5% | 2.38 | **GO** |
| prosa ctx 4096 | `--dspark` (default) | -2.2% | -2.4 / -1.3 | +3.7% | 0.27 | INCONCLUSIVE |
| prosa ctx 4096 | `DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1500` | -1.7% | -2.1 / -1.1 | +1.9% | 0.27 | INCONCLUSIVE |
| prosa ctx 4096 | `DS4_DSPARK_SCHEDULER=0` | **-18.7%** | -18.9 / -18.1 | +1.9% | 0.83 | **NO_GO** |

Righe "prosa": prompt formato dai Markdown del repo (`docs/*.md`, README, MODEL_CARD); le altre righe usano sorgenti C.
Baseline: 14.4 tok/s (ctx 4096), 14.0 tok/s (ctx 16384), 12.5 tok/s (ctx 65536).
A 64K è stato confrontato solo `minavg-1500` contro baseline (prefill ~300 s per run): `--dspark`
default non è misurato a questo contesto.

## Server: tool-use e sampling (`experiments/g0g-server.md`)

`ds4-server` fresco per ogni (config, round), 7 round in ordine randomizzato, ctx 32768.
Workload (`scripts/make_server_workload.py`): tre richieste agentiche con 5 tool, una
tool call precedente e il suo risultato (sorgenti del repo, 1.4K–8.6K token di prompt,
greedy, thinking high); `sampled-code` (temperatura 0.7, 384 token); `sample`
(temperatura 1.0, 16 token, 40 seed per round). Decode dal log del server
(`gen / (total - prefill)`), perché lo streaming trattiene i delta mentre classifica
thinking/DSML. TTFT dal client. Baseline tool-use: 14.5 tok/s.

| Scenario | `--dspark` | `+MIN_AVG_MILLI=1500` | `--mtp-exact-sampling` | `exact + 1500` |
|---|---|---|---|---|
| tool-use (3 pooled) | +9.1% GO | **+15.8% GO** | +10.2% GO | **+17.0% GO** |
| tool-next-step | -3.2% INC | +8.9% GO | -3.1% INC | +8.6% GO |
| tool-final-answer | +33.2% GO | +33.1% GO | +35.0% GO | +34.6% GO |
| tool-patch | +20.0% NO_GO (TTFT +5.5%) | +20.9% GO | +20.0% GO | +19.7% GO |
| sampled-code (T 0.7) | +2.6% NO_GO | +18.9% NO_GO | -1.0% NO_GO | +2.2% NO_GO |
| sample (T 1.0, 16 tok) | -12.4% NO_GO | -12.1% NO_GO | -9.9% NO_GO | -7.7% NO_GO |

Δ = decode mediano rispetto alla baseline. I NO_GO su `sampled-code` e `sample` vengono
dal TTFT, non dal decode. Con DSpark attivo il primo delta arriva più tardi, con una
mediana per richiesta da +25 a +300 ms secondo config e scenario e senza dipendere dal
knob. Sui prompt brevi (15–30 token) vale +19–29%. Sulle richieste agentiche
(1.4K–8.6K token) vale +1–4%, perché lì il TTFT è dominato dal prefill (7–40 s). Con
16 token di output DSpark perde anche in decode.

Confronto diretto 1500 contro `--dspark` default (`--baseline dspark`): tool-use pooled
+6.2% (CI +0.3 / +10.2), tool-next-step +12.5% (CI +2.2 / +16.8), `sampled-code`
+15.9% GO. Nessuno scenario peggiora oltre il rumore. Con `--mtp-exact-sampling`,
1500 non cambia `sampled-code` (-0.4%): l'accettazione esatta resta bassa a T 0.7
(1.05 draft per ciclo contro 1.76).

Distribuzione a temperatura 1.0: chi-quadro con permutazioni per posizione della
parola, 280 campioni per config, 250 output distinti nella baseline. Nessuna differenza
rilevata per nessuna config (p minimo 0.60, soglia Bonferroni 0.0083). A parità di
seed, `exact` riproduce il testo della baseline in 184 casi su 280, `--dspark` senza
exact in 90 su 280. Il test ha potenza limitata: esclude solo spostamenti grandi.
L'equivalenza in distribuzione resta una garanzia di progetto di
`--mtp-exact-sampling`, non di `--dspark` opportunistico.

Output greedy nelle tool call: tutte le config chiudono con `finish=tool_calls` in ogni
run. Su `tool-patch` DSpark produce in alcuni round una variante da 147/148 token invece
di 93: è la stessa divergenza greedy documentata sotto.

## Workload upstream (`experiments/g0h-ps-*.md`)

Il benchmark con cui upstream ha introdotto 4000 (`e532136`, `speed-bench/gfx1151-prefill-results.md`):
prompt `speed-bench/promessi_sposi.txt`, 128 token greedy, 7 run per config.

| Esperimento | `--dspark` (4000) vs baseline | 1500 vs baseline | 1500 vs 4000 | Draft accettati/ciclo 4000 → 1500 |
|---|---:|---:|---:|---|
| 2K | -7.1% NO_GO (TTFT) | -7.6% NO_GO (TTFT) | -0.5% (CI -3.0 / +3.1) | 0.04 → 0.04, stessi cicli |
| 16K | -5.9% NO_GO | -5.5% NO_GO | +0.5% (CI +0.0 / +1.5) | 0.10 → 0.10, stessi cicli |
| 2K, modello 0731 | -4.4% NO_GO (TTFT) | -4.8% NO_GO (TTFT) | -0.4% (CI -1.4 / +0.9) | 0.04 → 0.06 |

Su questo workload 1500 e 4000 prendono le stesse decisioni di scheduling: sul modello
principale cicli, skip e draft accettati sono identici. La protezione per cui è stato
scelto 4000 resta quindi invariata con 1500.

Non riprodotto: upstream riporta accettazione del 100% a 16K, qui sono 0.10 draft per
ciclo. Upstream usava `IQ2XXS-...-0731` con il suo drafter, qui il modello principale e
non-0731. L'overhead di DSpark su questi prompt va dal 4 al 7% invece dell'1.1%
riportato, ma è lo stesso per entrambe le soglie.

Modello 0731: in locale c'è la variante `Layers37-42Q4KExperts-...-0731`, che con DSpark
residente entra solo con `--ctx-alloc 4096`. Non è la `IQ2XXS-0731` di upstream.

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
- Temperatura > 0: nessuna differenza di distribuzione rilevata (sezione Server, potenza
  limitata).
- Non misurati: qualità su benchmark di task, contesti 100K+, sessioni batched o concorrenti.

## Decisione

1. **Nessun default cambiato.** Regola 4 del piano: DSpark opportunistico cambia l'output
   greedy, quindi non può diventare il default rispetto al decode ordinario.
   `config/deepinfer-overlay.defaults.json` resta tutto OFF.
Sulla prosa l'accettazione scende a 0.27 draft per ciclo. Con 1500 lo scheduler fa ancora
backoff: cicli e draft accettati sono identici al default, e la differenza sta nel rumore
rispetto a `--dspark` default. Senza scheduler (`=0`) la prosa perde il 18.7%: il backoff è
indispensabile, quindi `DS4_DSPARK_SCHEDULER=0` è scartato.

2. **Per chi usa già `--dspark`** (che accetta già questa divergenza), la Modalità A raccomanda
   `DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1500`: è GO a 4K, 16K e 64K (il guadagno cresce col contesto),
   e mantiene il backoff dello scheduler, a differenza di `DS4_DSPARK_SCHEDULER=0`.
   Applicazione manuale al prossimo avvio:
   ```bash
   DS4_DSPARK_SCHEDULER_MIN_AVG_MILLI=1500 ./ds4-server --dspark --mtp-model gguf/DeepSeek-V4-Flash-DSpark-support.gguf ...
   ```
3. **Prima di proporre il valore upstream** (default gfx1151 in `ds4.c`): prosa verificata
   (nessun peggioramento rispetto a `--dspark` default) e tool-use e sampling via server
   verificati (1500 non è mai peggiore di `--dspark` default, e su tool-use e
   `exact + 1500` è GO contro la baseline). Per chi usa `--mtp-exact-sampling` con
   temperatura > 0 il knob non porta guadagno. Sul workload upstream (`promessi_sposi`)
   1500 e 4000 prendono le stesse decisioni (sezione Workload upstream). Restano V4 Flash 0731 (con DSpark
   residente va in OOM su 128 GB: 91 GiB di modello + drafter, 2 GiB liberi) e V4.1 (manca
   localmente il GGUF di supporto DSpark V4.1). Il valore 4000 potrebbe essere stato
   scelto per altri carichi: un NO_GO su prosa è un risultato valido.
