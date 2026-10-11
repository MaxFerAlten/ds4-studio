# Certificazione riconciliazione 11 ottobre 2026

| | |
|---|---|
| Piano | [`riconciliazione11ott.md`](riconciliazione11ott.md) |
| Upstream | antirez/ds4 `0aaea5a238fb` → `fc80bd695da7` |
| Branch | `feature/riconciliazione11ott` |
| Base di confronto | `ecfb76d` (HEAD del branch prima della riconciliazione) |
| Sha certificato | `a4e64512c8e3` |
| Macchina | AMD Ryzen AI MAX+ 395 / Radeon 8060S (gfx1151), ROCm 7.2.4, gcc 13.3.0, kernel 7.2.0-rc2 |
| Prove | `evidence/NN_*.txt` (nuova), `evidence/BNN_*.txt` (base `ecfb76d`, stessa macchina, stessa sessione) |

Regola applicata, su indicazione dell'utente: **ciò che non si può verificare per mancanza di hardware o di risorse non viene certificato**, e la sezione 3 lo elenca con il motivo.

Esiti usati:
- **CERTIFICATO**: verificato con una prova riproducibile.
- **INVARIATO**: fallisce in modo identico sulla base. Non è una regressione, ma neanche un verde.
- **NON CERTIFICATO**: non verificabile su questa macchina.

---

## 1. Commit prodotti

```
a4e6451 overlay: retire qwen4-ngram-pread-bound
88247e1 overlay(cma-free-requires-cma-total): note CUDA scope since fc80bd6
59ebe95 overlay(model-span-bounds): re-derive engine_close on fc80bd6
3d51389 overlay(dsv41-expert-streaming): re-anchor on fc80bd6
5a32350 overlay(rocm-qwen4-enable): re-anchor on fc80bd6 linux_memory guard
8750950 overlay(rocm-deepseek41): re-anchor on fc80bd6 linux_memory guard
e89754d sync: upstream antirez/ds4 0aaea5a..fc80bd6
```

Nessun push.

---

## 2. Voci certificate

### 2.1 Sync del root — CERTIFICATO

| Controllo | Esito | Prova |
|---|---|---|
| Precondizione: ogni file cambiato upstream era byte-identico a `0aaea5a` | 42 `EQ_OLD` + 30 `MISSING`, 0 `DIVERGED` | `01_precondition.txt` |
| `git apply --check` + `git apply` del diff upstream esatto (binario, senza fuzz) | rc=0 | step 1 |
| `.gitignore` con `git merge-file` a 3 vie | rc=0, 0 conflitti | step 1 |
| Dopo il sync ogni file cambiato upstream è byte-identico a `fc80bd6` | 0 differenze | `02_postcheck.txt` |
| Commit `e89754d` | 73 file, +16198/−1297 (identico allo `--stat` upstream) | `git show --stat e89754d` |

### 2.2 Patch overlay — CERTIFICATO

| Controllo | Esito | Prova |
|---|---|---|
| Le 4 patch ri-derivate sono byte-identiche alle varianti verificate in scratchpad | identiche | step 2 |
| `rebase-check` (upstream pulito + anchor) | rc=0, "all anchors resolve" | `06_rebase_check.txt` |
| Compose reale su `e89754d` | **25 patch applicate**, rc=0 | `07_compose.txt` |
| Compose reale sullo sha certificato `a4e6451` | **25 patch applicate**, rc=0 | `21_final_compose_build.txt` |
| Invarianti dell'overlay (`tests/run_all.sh`: upstream immutabile, nessun hardlink, fail-closed sugli anchor, `generated/` live) | `run_all: PASS` su entrambi gli sha | `08_overlay_invariants.txt`, `21_*` |

### 2.3 Build ROCm Strix Halo — CERTIFICATO

| Controllo | Esito | Prova |
|---|---|---|
| `overlay-strix-halo` (ds4, ds4-server, ds4-bench, ds4-eval, ds4-agent) | rc=0, **0 warning**, 0 errori | `09_build_strix_halo.txt` |
| `overlay-strix-halo-wrapper` (ds4-wrapper) | rc=0, 2 warning | `10_build_wrapper.txt` |
| Gli stessi due build sullo sha certificato | rc=0 / rc=0 | `21_final_compose_build.txt` |
| Link senza simboli mancanti | tutti i binari linkati, quindi 0 simboli non risolti; confermato anche dal controllo `nm` del piano §0.3 | build log |
| Sorgenti testati = sorgenti certificati | 40/40 file reali (copie patchate e file overlay) identici fra gli shadow `e89754d` e `a4e6451`; il resto sono symlink allo stesso root | `22_shadow_equivalence.txt` |

I 2 warning del wrapper (`"_GNU_SOURCE" redefined` in `studio/ds4_openwiki_{client,policy}.c`) **esistevano già**: vengono da `CFLAGS += -D_GNU_SOURCE`, presente nel Makefile già a `0aaea5a`, e dal `#define _GNU_SOURCE` nei file OpenWiki di Studio. Il sync non li introduce.

### 2.4 Test ROCm e CPU, confrontati con la base

| Suite | Nuova | Base `ecfb76d` | Esito | Prova |
|---|---|---|---|---|
| `test-mmvq-rocm` (nuovo upstream; MMVQ dense e routed via HIP) | 84 PASS, 0 FAIL, rc=0 | non esiste | **CERTIFICATO** | `13_*` |
| `test-linux-memory` (con la patch CMA) | PASS | — | **CERTIFICATO** | `14_*` |
| `test-engram` (upstream ha cambiato `ds4_engram.c`) | PASS | — | **CERTIFICATO** | `14_*` |
| `test-quality-api` (`tests/test_quality_api.c` cambiato upstream) | PASS, rc=0 | — | **CERTIFICATO** | `17_*` |
| `overlay-test-deepseek41`, insieme | 121 PASS | 121 PASS | **CERTIFICATO** (0 PASS persi) | `12_*`, `B12_*` |
| ↳ `overlay-test-deepseek41-memory` | assert `test_deepseek41_memory.c:29` | stesso assert | **INVARIATO** | `12_*`, `B12_base_test_deepseek41_memory.txt` |
| `overlay-test-rocm` (= `test-rocm` upstream): parte TP/sessione | 23 PASS/ok | 20 PASS/ok | **CERTIFICATO** (+3 test nuovi upstream, 0 persi) | `11_*`, `B11_*` |
| ↳ link dentro `test-rocm` | `undefined symbol: ds4_engram_*` | identico | **INVARIATO** | `11_*`, `B11_*` |
| Unit test ROCm con gli oggetti dell'overlay: `ds4-eval --self-test-extractors`, `ds4_agent_test`, `test_layer_pack`, `test_engine_mgpu_placement`, `test_gpu_args`, `test_gpu_args_cli.sh` (86/86), `test_prompt_prefix` | 7/7 rc=0 | 7/7 rc=0 | **CERTIFICATO** | `19_*`, `B19_*` |

Note sui due **INVARIATO**:

- **`test-rocm` non linka** perché la sua ricetta upstream usa un `CORE_OBJS` senza `ds4_engram.o`, mentre la feature `rocm-deepseek41` lo richiede (lo dice il commento in `mk/overlay.mk`). Le ricette dell'overlay lo aggiungono, e infatti `overlay-strix-halo` linka. Per non perdere copertura ho eseguito a mano gli unit test di `test-rocm` con l'insieme di oggetti dell'overlay (riga "Unit test ROCm" sopra, script `rocm_units.sh` descritto in §4). Da sistemare a parte: `overlay-test-rocm` dovrebbe passare `DS4_OVERLAY_ROCM_VARS`.
- **`test_deepseek41_memory`** fallisce per un'aspettativa scritta su una formula di ammissione diversa da quella attuale ("V4.1 needs 156.50 GiB … safe budget 106.31 GiB"). Il test simula la memoria con un mock, quindi il risultato non dipende dallo stato della macchina, ed è identico sulla base. È un difetto preesistente della feature `deepseek41-harness` / `dsv41-expert-streaming`, fuori dallo scope di questa riconciliazione.

### 2.5 Test frontend Studio

Nessun file in `frontend/` cambia fra `ecfb76d` e `a4e6451` (`git diff --stat ecfb76d HEAD -- frontend` è vuoto).

| Suite | Nuova | Base (stesso albero, checkout `ecfb76d`) | Esito |
|---|---|---|---|
| `npm test` (server) | 2924 test: 2858 pass, 62 fail, 4 skip | identico | **0 regressioni** |
| `npm run test:frontend` (UI) | 254 test: 253 pass, 1 fail | identico | **0 regressioni** |

#### 2.5.1 Confronto

Base eseguita **nello stesso albero** (checkout temporaneo di `ecfb76d`, poi ritorno su `a4e6451`), con gli stessi file non tracciati, `node_modules` e binari. Un primo tentativo in un worktree separato è stato scartato: senza i file non tracciati i test andavano in timeout (240 s), e il confronto non sarebbe stato equo.

| Suite | Nuova | Base | Fallimenti solo nella nuova | Solo nella base |
|---|---|---|---|---|
| server | 2924 / 2858 pass / **62 fail** / 4 skip | 2924 / 2858 / **62** / 4 | **0** | 0 |
| UI | 254 / 253 / **1 fail** | 254 / 253 / **1** | **0** | 0 |

Gli insiemi dei nomi falliti sono **identici** (confronto con `comm` su `not ok …`). Fallimento UI: `OpenWiki workspace configuration is below Lean 4 and accepts an absolute path`. Fallimenti server: `legacy parity: *` (28), `regression gate *`, `perf matrix *`, `fast math guard *`, superfici Lean (`lean_check`), `LF000-033 *`, `§21.x`, `workspace preflight…`, `OpenWiki setup…`, e altri.

Esito: **CERTIFICATO "nessuna regressione"**. I 63 fallimenti sono **INVARIATI** (preesistenti) e restano fuori scope.

Effetto collaterale ripulito: le suite riscrivono 3 file di cache tracciati (`frontend/data/research/cache/search/wikipedia/*.json`). Li ho riportati a HEAD dopo ogni run.

### 2.6 Analisi di ridondanza (§5bis del piano) — CERTIFICATO

| Controllo | Esito |
|---|---|
| Nessuna patch abilitata è assorbita da upstream (lato post-patch assente su tutti gli hunk core/gpu/rocm/cuda; lato pre-patch ancora presente) | confermato, dettaglio nel piano §5bis |
| `qwen4-ngram-pread-bound` superflua: non applicava più già da `df6eedd`, e il warning non compare più (gcc 13.3, `-O3`, `_FORTIFY_SOURCE=3`, stderr vuoto) | ritirata in `a4e6451` |
| "qwen4" = Qwen3.8 Flash Next (README upstream, `df6eedd`, `docs/QWEN38_FLASH_NEXT.md`); `rocm-qwen4-enable` serve ancora (`ds4.c:53` esclude ancora ROCm) | confermato |
| `cuda-mmq-v41`: `pure-upstream-test` | rc=0 ma **vuoto**: la feature dichiara 0 test, e lo strumento stesso risponde "CANNOT be retired safely". La feature **resta**: non serve come prova di equivalenza | `23_*` |

### 2.7 GitNexus

| Controllo | Esito | Prova |
|---|---|---|
| `detect-changes` prima del commit di sync | risk **critical**, 43 file / 288 simboli. Atteso per un import upstream verbatim; scritto nel messaggio del commit | `03_*` |
| `detect-changes` prima dei commit overlay | 14 file, nessun simbolo indicizzato toccato (`.patch`, `.toml`); nessun flag partial/truncated | `20_*` |
| Indice aggiornato | ricostruito su `e89754d` (il primo run era fallito per buffer pool LadybugDB esaurito; rifatto con `GITNEXUS_LBUG_BUFFER_POOL_SIZE=3 GiB`) | `04_*` |
| `impact ds4_engine_close` | **UNKNOWN**: GitNexus salta `ds4.c` (> 512 KB, "likely generated"). Come chiede `CLAUDE.md` ho confermato con una ricerca testuale: 55 chiamate in `ds4.c`, più quelle in `ds4_wrapper.c`, `ds4_cli.c`, `ds4_eval.c`, `ds4_agent.c`, `ds4_server.c` e 14 file di test. Rischio considerato **HIGH** (entry point di tutti i binari e tutti i percorsi di errore di `ds4_engine_open`) | `05_*` |

---

## 3. NON CERTIFICATO

| Voce | Motivo | Cosa serve |
|---|---|---|
| **Percorsi CUDA** (build `cuda`/`cuda-spark`, i 24 nuovi `tests/test_cuda_*`, TP a due host, DSpark distribuito, MXFP4 nativo, side stream) | Su questa macchina non c'è CUDA (`nvcc` e `nvidia-smi` assenti) | Host NVIDIA, per DGX Spark due host con RDMA |
| **Patch CMA sulle build CUDA Linux** (§3.3 del piano: da `fc80bd6` `ds4_linux_memory.h` è incluso anche lì) | Niente CUDA. Il test di unità `test-linux-memory` passa, ma è indipendente dal backend | Startup `ds4-server` su host CUDA Linux, confrontando la riga del budget di memoria |
| **Test runtime con modello**: `ds4_test` (`cannot open model 'ds4flash.gguf'`), `tests/test_deepseek_indexer` (richiede `FLASH_GGUF`; inoltre la sua ricetta upstream linka `-lcudart`), smoke test V4.1 SSD streaming con shutdown (nuovo ordine di `ds4_engine_close`), DSpark A/B (cambio di allineamento gfx1151 upstream, piano §3.4), Qwen3.8 first-token, engram su disco, test Python `test_dspark_*` / `test_server_speculative_stop.py` | **Risorse**: i modelli sono da 81–91 GiB (V4 Flash), 165 GiB (Qwen3.8 Flash Next), 340 GiB (V4.1 Q2, streaming). Su 121 GiB, durante la sessione ne erano liberi 4–11, perché un `llama-server` di un altro progetto (vitronia, ~30 GiB RSS più memoria GPU) era attivo. Non l'ho fermato: non fa parte di questo lavoro | Macchina libera: fermare gli altri servizi GPU e rilanciare la §4.3 del piano |
| **Correttezza runtime del nuovo `ds4_engine_close`** (use-after-unmap evitato) | La feature stessa lo dichiara "NOT independently verified"; nessun test lo dimostra. Lo smoke test di shutdown rientra nel punto sopra | Smoke test di shutdown sotto ASan, o con un modello piccolo |
| **Build ROCm `-O0` / stub `ds4_gpu_side_join`** (piano §3.1) | Non fatto, per scelta: la build `-O0` è già rotta per altri 14 simboli (base inclusa), e lo stub da solo non la sistema | Un lavoro dedicato alla build di debug ROCm |
| **Frontend**: i fallimenti presenti su entrambi gli sha | Non sono regressioni di questa riconciliazione (vedi §2.5.1), ma non sono neanche verdi | Lavoro separato sul frontend |

---

## 4. Riproduzione

```bash
# compose + invarianti + build sullo sha certificato
cd ds4-overlay
python3 scripts/overlayctl.py rebase-check
python3 scripts/overlayctl.py compose            # atteso: 25 applied
bash tests/run_all.sh                            # atteso: run_all: PASS
SH=$(python3 scripts/overlayctl.py shadow-path)
make -C "$SH" -j6 -f Makefile.overlay overlay-strix-halo overlay-strix-halo-wrapper

# test
make -C "$SH" -f Makefile.overlay test-mmvq-rocm test-linux-memory test-engram test-quality-api
make -C "$SH" -f Makefile.overlay overlay-test-deepseek41   # atteso: solo l'assert preesistente
make -C "$SH" -f Makefile.overlay overlay-test-rocm         # atteso: solo il link engram preesistente
cd ../frontend && npm test && npm run test:frontend
```

Unit test ROCm con gli oggetti dell'overlay (sostituisce la parte di `test-rocm` che non linka): stesso elenco di target ed eseguibili di `test-rocm`, con
`CORE_OBJS="… ds4_layer_pack.o ds4_engram.o $(ROCM_MMQ_OBJS)"`, `DS4_LINK="hipcc … --offload-arch=gfx1151"`, `DS4_LINK_LIBS="-lm -pthread -lhipblas -lhipblaslt -lrocblas"`.

Accorgimento operativo: l'hook rtk riscrive `tail`, `grep`, `git` ecc. e a volte risponde `[rtk: No such file or directory]` senza eseguire il comando. Per tutto ciò che produce prove usare `rtk proxy <cmd>` oppure il path assoluto del binario.

---

## 5. Rimedi successivi (stesso giorno)

| Commit | Cosa | Esito |
|---|---|---|
| `eeae74b` | `dsv41-expert-streaming`: porting dal fork `ds4-v41-rocm` dell'ammissione di memoria V4.1 su ROCm. La formula upstream (RAM fisica × 7/8) lasciava inutilizzato `ds41_host_memory_baseline`, e `test_deepseek41_memory` falliva su qualsiasi host. Correzione rispetto alla §2.4: il test **dipendeva** dalla RAM fisica della macchina (budget 106.31 GiB = 121.5 GiB × 7/8) | `overlay-test-deepseek41` rc=0, compose 26/26, invarianti PASS, build verde (`25_*`) |
| `4e8bbb3` | `overlay-test-rocm` linka con l'insieme di oggetti dell'overlay (quindi con `ds4_engram.o`); `ds4_test` risulta SKIP esplicito se manca il GGUF | rc=0 (`24_*`) |
| `fb9b36b` | Rimossi i test orfani della cancellazione `989bf52`: 3 file di script (15 test), l'e2e Sage (5) e 2 casi del bridge Sage | Ripristinando i file cancellati in un worktree di prova, i 35 casi passano tutti: erano orfani e basta. Dopo la rimozione: 2902 test, 2858 pass (invariati), **40 fail** (prima 62) (`26_*`) |

Fallimenti frontend ancora aperti (40 server + 1 UI), con diagnosi ma senza correzione:
- **25** contratti cambiati e test non aggiornati: AG-UI attivo di default da `5bda80a`; `openwikiWorkspace` nello status da `ecfb76d`; l'harness parity legge il DB thread reale del repo.
- **9** test Lean leggono il `ds4_agent.c` del root (upstream) invece della copia patchata da Studio.
- **2** regex su `index.mjs` invecchiate dopo il refactor OpenWiki.
- **3** OpenWiki: 2 bug nei test, più un **difetto di sicurezza reale**: `validateWorkspaceRoot` non rifiuta le directory scrivibili dal gruppo.
- **1** `buildFlags`: policy `-ffast-math` da decidere.
