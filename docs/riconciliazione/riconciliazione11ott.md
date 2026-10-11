# Riconciliazione 11 ottobre 2026 — upstream antirez/ds4 `0aaea5a..fc80bd6`

| | |
|---|---|
| Branch Studio | `feature/riconciliazione11ott` (staccato da `feature/performance-ds4.1-qwen3.8-halogen` @ `ecfb76d`) |
| Upstream | `/mnt/crucial_ai/antirez/ds4`, `0aaea5a` → `fc80bd6` (9 commit, 73 file, +16198/−1297) |
| Overlay | `ds4-overlay/` (compose shadow, patch esatte, niente fuzz) |
| Stato | **Eseguito** — vedi [`certificazione11ott.md`](certificazione11ott.md). Testo originale del piano: Le patch ri-derivate sono state **verificate in scratchpad** (apply 25/25 + compilazione ROCm host), non ancora scritte nel repo. |

Commit upstream inclusi:

```
fc80bd6 Avoid full context rebuilds at DSpark response boundaries
d6b516a Score API top choices independently of alternative order
b14bf62 Repair DSpark and ROCm regression tests
f0962e3 Stop tensor-parallel inference after a transport failure
b3afc8e Document dual-Spark inference and its release checks
63059b6 Optimize Spark attention and support native MXFP4 DSpark experts
43a91aa Distribute and accelerate Flash speculative decoding on Spark
77570b4 Add two-host CUDA tensor parallelism for DeepSeek V4 Flash
962ac19 Improve V4.1 CUDA attention and Spark RDMA exchanges
```

Il grosso è CUDA/DGX Spark (TP a due host, DSpark distribuito, MXFP4 nativo, side stream). Su ROCm l'impatto diretto è piccolo: quasi tutto il nuovo codice è chiuso da `!defined(DS4_ROCM_BUILD)`.

---

## 0. Fatti accertati (base del piano)

### 0.1 Il root di Studio è upstream `0aaea5a` non toccato

Ho classificato ogni file cambiato upstream rispetto al root di ds4-studio:

| Classe | N | Significato |
|---|---|---|
| `EQ_OLD` | 41 | Byte-identico a `0aaea5a:<file>` → basta copiare `fc80bd6` |
| `MISSING` | 30 | File nuovi upstream (`ds4_gpu_copy.h` + 29 test) |
| `DIVERGED` | 1 | `.gitignore` (Studio ha aggiunto righe in coda) |

Quindi **nessun merge di codice nel root**: le modifiche di Studio a `ds4.c`, `ds4_cuda.cu`, `ds4_server.c`… vivono solo in `ds4-overlay/patches/`.

Verificato: `git apply --check` del diff `0aaea5a..fc80bd6` (escluso `.gitignore`) sul root → rc=0. `git merge-file` su `.gitignore` → rc=0, 0 conflitti.

### 0.2 Patch overlay: 21/25 applicano, 4 no

Simulazione in ordine reale (`overlay_manifest.ordered_patches`: feature id ordinato, poi ordine di dichiarazione), con `exact_patch.apply_patch`, cioè lo stesso applicatore di `compose_shadow.py`:

| Base | Risultato |
|---|---|
| `0aaea5a` | 25/25 OK (conferma che la simulazione è fedele) |
| `fc80bd6` | 21/25 OK, **4 FAIL, tutte su `ds4.c`, 5 hunk in totale** |

`verify_anchors.py` dice "all anchors resolve" anche su `fc80bd6`: gli anchor sono troppo grossolani per vedere questi fallimenti. Non usarlo come check sufficiente.

Le patch `studio/*` (dichiarate con `from = …`, applicate a copie di `ds4_server.c`, `ds4_agent*.c`, `ds4_wrapper_http.c`) applicano tutte su `fc80bd6`.

### 0.3 Linkabilità ROCm verificata

Su tree `fc80bd6` + 25 patch (con le 4 ri-derivate di §2) ho compilato gli oggetti host ROCm con i flag reali del Makefile:

```
gcc -O3 -ffast-math -march=native -Wall -Wextra -std=c99 -D_GNU_SOURCE \
    -fno-finite-math-only -fPIC -DDS4_ROCM_BUILD -I. -c ds4.c | ds4_tp.c | ds4_engram.c
```

- Compilazione: rc=0, **0 warning**.
- Simboli `ds4_*|metal_*|qwen4_*|glm_*|ds41_*|g_*` non definiti, confrontati con i simboli definiti dagli oggetti ROCm attuali (`new-ds4-studio-build/5bda80ab…/src/ds4_rocm*.o`, `cuda/mmq/*.rocm.o`, `ds4_image.o`, `ds4_distributed.o`, `ds4_ssd.o`, `ds4_layer_pack.o`): **0 mancanti a `-O3`**.
- A `-O0`: 15 mancanti, **14 dei quali mancano già oggi** (baseline `5bda80ab` a `-O0`). Unico nuovo: `ds4_gpu_side_join` (vedi §3.1).

Il backend `ds4_rocm.cu` / `rocm/*.cuh` **non è cambiato upstream** in questo intervallo, quindi i suoi oggetti attuali sono un riferimento valido per il link.

---

## 1. Step 1 — Sync del root a `fc80bd6`

**Precondizione**: working tree pulito su `feature/riconciliazione11ott` (vero al momento della stesura).

```bash
cd /mnt/crucial_ai/COPARATOR/riconciliazione-ds4-studio/ds4-studio
U=/mnt/crucial_ai/antirez/ds4
W=$(mktemp -d)

# 1a. Ri-verifica la precondizione EQ_OLD (deve stampare solo EQ_OLD/MISSING)
for f in $(git -C $U diff --name-only 0aaea5a fc80bd6 -- . ':(exclude).gitignore'); do
  if [ ! -e "$f" ]; then echo "MISSING $f"
  elif git -C $U show 0aaea5a:"$f" | cmp -s - "$f"; then echo "EQ_OLD $f"
  else echo "DIVERGED $f   <-- STOP"; fi
done | grep -v '^EQ_OLD\|^MISSING' && echo "precondizione rotta" || echo "precondizione ok"

# 1b. Applica il diff upstream esatto (binario, nessun fuzz)
git -C $U diff --binary 0aaea5a fc80bd6 -- . ':(exclude).gitignore' > $W/up.diff
rtk proxy git apply --check $W/up.diff && rtk proxy git apply $W/up.diff

# 1c. .gitignore a 3 vie
git -C $U show 0aaea5a:.gitignore > $W/gi_base
rtk proxy git merge-file .gitignore $W/gi_base $U/.gitignore   # rc 0 atteso

# 1d. Verifica: ogni file cambiato upstream ora è identico a fc80bd6
for f in $(git -C $U diff --name-only 0aaea5a fc80bd6 -- . ':(exclude).gitignore'); do
  cmp -s $U/"$f" "$f" || echo "DIFF $f"
done
```

> Nota: l'hook rtk riassume/tronca l'output di `git`, `diff`, `grep`. Per i comandi il cui exit code o il cui output conta, usare `rtk proxy …`.

**Commit 1** (solo root, nessun file overlay):

```
sync: upstream antirez/ds4 0aaea5a..fc80bd6

Mechanical import of upstream fc80bd6 into the root. Every touched file
was byte-identical to 0aaea5a beforehand; .gitignore merged 3-way.
Overlay patches are re-derived in the following commits.
```

Dopo questo commit la build overlay è **rotta** (4 patch non applicano) fino allo Step 2: tenere i commit 1 e 2 adiacenti, senza build intermedia.

### 1.1 GitNexus dopo il sync

`ds4.c` cambia di +3022/−… righe: l'indice è stale.

```bash
node .gitnexus/run.cjs analyze --index-only
```

---

## 2. Step 2 — Ri-derivare le 4 patch rotte

Principio: **modifica minima**. Per tre patch cambiano solo righe di contesto; una sola (`model-span-bounds`) va rigenerata perché upstream ha inserito codice *dentro* la funzione che la patch riordina.

Tutte e quattro le varianti sotto sono state verificate così: 25/25 applicate in ordine con `exact_patch.apply_patch`, e il `ds4.c` risultante è byte-identico a quello compilato in §0.3.

Prima di toccare le patch (regola CLAUDE.md, impact su simboli del root interessati):

```bash
node .gitnexus/run.cjs impact "ds4_engine_close" --direction upstream --repo .
node .gitnexus/run.cjs impact "ds4_engine_open"  --direction upstream --repo .
```

`ds4_engine_close` è chiamato da tutti i percorsi di errore di `ds4_engine_open` e dagli entry point server/cli/agent: rischio atteso HIGH, documentarlo nel commit.

### 2.1 `patches/core/rocm-deepseek41-enable.patch` — hunk 1 (@48)

**Causa**: upstream `fc80bd6` ha cambiato la guardia dell'include di `ds4_linux_memory.h`, che la patch usa come contesto finale:

```c
-#ifdef DS4_ROCM_BUILD
+#if defined(DS4_ROCM_BUILD) || (!defined(__APPLE__) && !defined(DS4_NO_GPU))
 #include "ds4_linux_memory.h"
```

**Fix**: cambiare quella sola riga di contesto. Il contenuto della patch (`DS4_HAS_DEEPSEEK41_GPU` acceso su ROCm, `DS4_HAVE_V41_GPU`) resta identico. L'hunk 2 (@70224, gate `supported` del V4.1 con le restrizioni ROCm SSD) applica ancora così com'è.

```diff
--- ds4-overlay/patches/core/rocm-deepseek41-enable.patch
+++ ds4-overlay/patches/core/rocm-deepseek41-enable.patch
@@ -33,7 +33,7 @@
 +#define DS4_HAS_QWEN4_METAL 1
 +#endif
 +#endif
- #ifdef DS4_ROCM_BUILD
+ #if defined(DS4_ROCM_BUILD) || (!defined(__APPLE__) && !defined(DS4_NO_GPU))
  #include "ds4_linux_memory.h"
 @@ -70224,6 +70224,14 @@
          const bool supported = (e->backend == DS4_BACKEND_METAL ||
```

Comando:

```bash
python3 - <<'EOF'
p = "ds4-overlay/patches/core/rocm-deepseek41-enable.patch"
t = open(p).read()
old = '\n #ifdef DS4_ROCM_BUILD\n #include "ds4_linux_memory.h"'
new = '\n #if defined(DS4_ROCM_BUILD) || (!defined(__APPLE__) && !defined(DS4_NO_GPU))\n #include "ds4_linux_memory.h"'
assert t.count(old) == 1
open(p, "w").write(t.replace(old, new))
EOF
```

### 2.2 `patches/core/rocm-qwen4-enable.patch` (@53)

Stessa causa, stessa riga di contesto finale. La patch dichiara già "No leading context on purpose" (dipende dall'ordine rispetto a `rocm-deepseek41`); la variante minima **rispetta questa scelta**: niente contesto iniziale, cambia solo quello finale.

```diff
--- ds4-overlay/patches/core/rocm-qwen4-enable.patch
+++ ds4-overlay/patches/core/rocm-qwen4-enable.patch
@@ -26,6 +26,6 @@
 +#define DS4_HAS_QWEN4_METAL 1
 +#endif
 +#endif
- #ifdef DS4_ROCM_BUILD
+ #if defined(DS4_ROCM_BUILD) || (!defined(__APPLE__) && !defined(DS4_NO_GPU))
  #include "ds4_linux_memory.h"
  #endif
```

Comando: identico a §2.1 con `p = "ds4-overlay/patches/core/rocm-qwen4-enable.patch"`.

> Non usare `make_patch.py` qui: produrrebbe contesto iniziale preso dalle righe che `rocm-deepseek41-enable` ha appena scritto (`#else / #define DS4_HAVE_V41_GPU 0 / #endif`), contraddicendo il commento nella patch e creando un accoppiamento silenzioso tra le due feature.

### 2.3 `patches/core/dsv41-expert-streaming__ds4.c.patch` — hunk @70869 (1 su 38)

**Causa**: in `ds4_engine_open`, ramo GPU, upstream ha inserito subito dopo `ds4_gpu_set_ssd_streaming(e->ssd_streaming);` un blocco Spark:

```c
        ds4_gpu_set_quality(e->quality);
        ds4_gpu_set_glm_model(DS4_MODEL_FAMILY == DS4_MODEL_FAMILY_GLM_DSA);
        ds4_gpu_set_ssd_streaming(e->ssd_streaming);
#if !defined(__APPLE__) && !defined(DS4_ROCM_BUILD)
        /* Device selection must precede the Spark-specific default. Keep
         * unmeasured layouts and checkpoints on their existing policy. */
        if (e->dspark && !e->dspark_confidence_threshold_set && ...
        ...
#endif
        if (!ds4_engine_configure_streaming_auto_cache(e, opt->context_size)) {
```

Il contesto finale della patch (`if (!ds4_engine_configure_streaming_auto_cache…` + 2 righe) non è più adiacente.

**Fix**: togliere le 3 righe di contesto finale di quell'hunk e aggiornare l'header (`,6`→`,3` e `,15`→`,12`). Le 3 righe iniziali (`set_quality / set_glm_model / set_ssd_streaming`, con questa indentazione) sono uniche nel file: l'altra occorrenza di `ds4_gpu_set_quality(e->quality);` (riga ~72316) ha indentazione diversa e un seguito diverso.

Risultato: il blocco `#ifdef DS4_ROCM_BUILD` (V4.1 model flag + `ds41_rocm_stream_reserve_bytes` + `ds4_gpu_set_streaming_free_reserve`) finisce **prima** del blocco Spark `#if !defined(__APPLE__) && !defined(DS4_ROCM_BUILD)`. Le due guardie si escludono a vicenda, quindi l'ordine relativo non conta; conta che entrambi precedano `ds4_engine_configure_streaming_auto_cache`, e lo fanno (verificato: riga 72870 vs 72896 nel tree simulato).

```diff
--- ds4-overlay/patches/core/dsv41-expert-streaming__ds4.c.patch
+++ ds4-overlay/patches/core/dsv41-expert-streaming__ds4.c.patch
@@ -800,7 +800,7 @@
  #endif
      e->model.fd = -1;
      e->mtp_model.fd = -1;
-@@ -70869,6 +71309,15 @@
+@@ -70869,3 +71309,12 @@
          ds4_gpu_set_quality(e->quality);
          ds4_gpu_set_glm_model(DS4_MODEL_FAMILY == DS4_MODEL_FAMILY_GLM_DSA);
          ds4_gpu_set_ssd_streaming(e->ssd_streaming);
@@ -813,9 +813,6 @@
 +                    ds4_bytes_to_gib(reserve));
 +        }
 +#endif
-         if (!ds4_engine_configure_streaming_auto_cache(e, opt->context_size)) {
-             ds4_engine_close(e);
-             *out = NULL;
 @@ -71284,6 +71733,37 @@
          }
          free(load_offsets);
```

Comando:

```bash
python3 - <<'EOF'
p = "ds4-overlay/patches/core/dsv41-expert-streaming__ds4.c.patch"
t = open(p).read()
old_tail = """+#endif
         if (!ds4_engine_configure_streaming_auto_cache(e, opt->context_size)) {
             ds4_engine_close(e);
             *out = NULL;
@@ -71284,6 +71733,37 @@"""
assert t.count(old_tail) == 1
t = t.replace(old_tail, "+#endif\n@@ -71284,6 +71733,37 @@")
assert t.count("@@ -70869,6 +71309,15 @@") == 1
t = t.replace("@@ -70869,6 +71309,15 @@", "@@ -70869,3 +71309,12 @@")
open(p, "w").write(t)
EOF
```

Le altre 37 hunk restano intatte (il loro testo "old" compare esattamente una volta nel `ds4.c` di `fc80bd6` dopo le patch che le precedono). L'hunk @71284 (riserva dei due layer di esperti ammessi dopo `free(load_sizes);`) applica ancora: dopo `fc80bd6` ci sono 5 coppie `free(load_offsets); free(load_sizes);`, ma solo una è seguita dal commento `/* Also apply explicit optional Q8 preload settings…`.

### 2.4 `patches/core/model-span-bounds__ds4.c.patch` — `ds4_engine_close` (rigenerare)

**Causa**: upstream ha aggiunto in `ds4_engine_close`, tra `ds4_engine_tp_unbind(e);` e `ds4_expert_profile_close();`:

```c
#if !defined(DS4_NO_GPU) && !defined(__APPLE__) && !defined(DS4_ROCM_BUILD)
    /* Built at open but never bound. */
    if (e->tp.dspark_split_built) {
        ds4_gpu_release_dspark_tp_split();
        e->tp.dspark_split_built = false;
        e->tp.dspark_split_bytes = 0;
    }
#endif
```

La vecchia patch riscriveva l'intera funzione come un blocco unico `-`/`+`, quindi qualsiasi riga nuova la rompe.

**Il difetto che la feature corregge è ancora presente upstream**: in `fc80bd6` l'ordine è sempre `weights_free` → `vocab_free` → `ds4_threads_shutdown` → `model_close` → … → `ds4_gpu_cleanup()`. La memoria host viene liberata prima del teardown GPU, e i worker vengono fermati dopo `weights_free`. La feature resta necessaria.

**Semantica da preservare** (identica alla vecchia patch, più il blocco nuovo):

1. `ds4_threads_shutdown()` per primo, prima di `tp_unbind`.
2. Blocco upstream DSpark TP split invariato e nella sua posizione: è teardown lato GPU, quindi deve stare prima di `ds4_gpu_cleanup()`, e ci sta.
3. `weights_free`, `vocab_free`, `model_close(mtp/vision/model)` dopo `ds4_gpu_cleanup()`.

Patch nuova completa (generata con `scripts/make_patch.py` a partire dal file nello stato pre-patch, cioè dopo `accelerator-span-bounds` e `dsv41-expert-streaming`, poi verificata):

```diff
diff --git a/ds4.c b/ds4.c
--- a/ds4.c
+++ b/ds4.c
@@ -74307,6 +74307,9 @@
 
 void ds4_engine_close(ds4_engine *e) {
     if (!e) return;
+    /* overlay model-span-bounds: shut the workers down before anything they
+     * could still be reading is released. */
+    ds4_threads_shutdown();
     ds4_engine_tp_unbind(e);
 #if !defined(DS4_NO_GPU) && !defined(__APPLE__) && !defined(DS4_ROCM_BUILD)
     /* Built at open but never bound. */
@@ -74317,12 +74320,6 @@
     }
 #endif
     ds4_expert_profile_close();
-    weights_free(&e->weights);
-    vocab_free(&e->vocab);
-    ds4_threads_shutdown();
-    if (e->mtp_model.map) model_close(&e->mtp_model);
-    if (e->vision_model.map) model_close(&e->vision_model);
-    model_close(&e->model);
 #ifndef DS4_NO_GPU
 #ifdef DS4_HAS_QWEN4_GPU
     qwen4_state_pool_free(e);
@@ -74338,6 +74335,17 @@
     }
     ds4_gpu_cleanup();
 #endif
+    /* Host memory is released only after the accelerator has finished with it.
+     * Upstream frees the weights, the vocab and the model mappings first, so
+     * the GPU teardown above -- including the Qwen4 state pool and shared
+     * workspace added upstream after this feature was written, and the DSpark
+     * TP split release added at fc80bd6 -- could still hold views into memory
+     * the host had already unmapped. */
+    weights_free(&e->weights);
+    vocab_free(&e->vocab);
+    if (e->mtp_model.map) model_close(&e->mtp_model);
+    if (e->vision_model.map) model_close(&e->vision_model);
+    model_close(&e->model);
     ds4_ssd_memory_lock_release(&e->simulated_memory);
     ds4_release_instance_lock();
     free(e->directional_steering_dirs);
```

Vantaggio collaterale: ora sono 3 hunk piccoli invece di un blocco di 28 righe, quindi la prossima modifica upstream a una parte qualunque della funzione romperà solo l'hunk interessato.

Procedura riproducibile:

```bash
cd ds4-overlay
SH=$(./scripts/overlayctl.py shadow-path)          # oppure un tree scratch
# pre = ds4.c di fc80bd6 dopo accelerator-span-bounds + dsv41-expert-streaming
# post = pre con ds4_engine_close riordinata come sopra
python3 scripts/make_patch.py pre.c post.c --name ds4.c > patches/core/model-span-bounds__ds4.c.patch
sed -i '1i diff --git a/ds4.c b/ds4.c' patches/core/model-span-bounds__ds4.c.patch
```

### 2.5 Aggiornare i manifest delle feature toccate

In ognuno di questi `feature.toml` impostare `[upstream] reviewed_sha = "fc80bd6…"` (sha completo: `git -C /mnt/crucial_ai/antirez/ds4 rev-parse fc80bd6`):

| Feature | File | Modifica extra |
|---|---|---|
| `rocm-deepseek41` | `features/rocm-deepseek41/feature.toml:44` | — |
| `rocm-qwen4-enable` | `features/rocm-qwen4-enable/feature.toml:42` | La descrizione cita "the macro itself still excludes ROCm at ds4.c:53": è ancora vero (riga 53 in `fc80bd6`), nessuna modifica |
| `dsv41-expert-streaming` | `features/dsv41-expert-streaming/feature.toml:86` | — |
| `model-span-bounds` | `features/model-span-bounds/feature.toml:38` | Aggiungere alla descrizione che `fc80bd6` non ha corretto l'ordine di teardown e ha aggiunto il rilascio dello split DSpark TP, mantenuto prima di `ds4_gpu_cleanup()` |

Le altre feature applicano senza modifiche. Aggiornare il loro `reviewed_sha` solo dopo un passaggio di test verde (Step 4), in un commit separato, per non dichiarare "rivisto" ciò che è solo "applica".

### 2.6 Verifica dello Step 2

```bash
cd ds4-overlay
./scripts/overlayctl.py rebase-check      # verify_upstream_clean + anchors
./scripts/overlayctl.py compose           # deve terminare senza PATCH_FAIL/ANCHOR_FAIL
python3 -c "import json,sys;print(len(json.load(open(sys.argv[1]))['patches_applied']))" \
  "$(dirname "$(./scripts/overlayctl.py shadow-path)")/compose.json"   # atteso: 25
tests/run_all.sh                          # invarianti overlay (immutabilità, compose, exact_patch, make_patch)
```

**Commit 2a…2d**: un commit per feature (`overlay(rocm-deepseek41): re-anchor on fc80bd6 linux_memory guard`, ecc.), così ogni feature resta revertibile da sola.

---

## 3. Step 3 — Rischi non visibili dalle patch

### 3.1 `ds4_gpu_side_join` non definito su ROCm (solo build `-O0`)

`fc80bd6` aggiunge in `ds4_gpu.h` 13 entry point nuovi (`ds4_gpu_side_begin/end/join`, `ds4_gpu_side_dense_q8_ok`, `ds4_gpu_build/release_{mxfp4,dspark}_tp_split`, `ds4_gpu_tp_slab_alloc`, `ds4_gpu_tensor_copy_spans`, `ds4_gpu_compressor_verify_rows_tensor`, `ds4_gpu_dspark_markov_argmax_range_tensor`, `ds4_gpu_hc_pre_f32_mix_split_norm_tensor`). Nessuno è implementato in `ds4_rocm.cu` / `rocm/*.cuh` / `ds4_rocm_unavailable.cu`.

A `-O3` tutte le chiamate sono codice morto eliminato (verificato: 0 simboli mancanti). A `-O0` sopravvive solo:

```c
/* metal_graph_encode_layer_ffn_batch, ramo ROCm: shared_side è const false */
    if (shared_side && !ds4_gpu_side_join()) ok = false;
```

La build ROCm `-O0` è **già** rotta oggi per altri 14 simboli (`ds4_gpu_hc_rms_norm_mix_f16_tensor`, `ds4_gpu_kv_rope_fp8_store_raw_tensor`, …), quindi questo non è una regressione bloccante. Se si vuole tenere il delta pulito, aggiungere lo stub alla feature `rocm-deepseek41` estendendo `patches/rocm/rocm-deepseek41-tp-stubs.patch`:

```c
/* overlay rocm-deepseek41: the CUDA side stream (fc80bd6) has no ROCm
 * implementation and ds4_gpu_side_begin() is never reached here, so there is
 * never side work to join. Success, not ROCM_UNAVAILABLE_INT: callers test
 * !ds4_gpu_side_join() and a 0 would turn a no-op into a failed layer. */
extern "C" int ds4_gpu_side_join(void) { return 1; }
```

**Attenzione**: non usare `ROCM_UNAVAILABLE_INT(ds4_gpu_side_join)`. Quella macro ritorna 0, che il chiamante interpreta come errore (`ok = false`).

Decisione consigliata: **opzionale**, commit separato `overlay(rocm-deepseek41): side_join stub for -O0 links`. Se in futuro si sistemano anche gli altri 14 simboli per avere un build di debug ROCm, entra in quel lavoro.

### 3.2 `g_tp_block_ctx` e codice TP ora compilati su ROCm

Upstream:

```c
-#if !defined(DS4_NO_GPU) && defined(__APPLE__)
+#ifdef DS4_HAS_DEEPSEEK41_GPU
 static ds4_tp *g_tp_block_ctx;
 #endif
```

Upstream non definisce `DS4_HAS_DEEPSEEK41_GPU` su ROCm, ma l'overlay sì (`rocm-deepseek41-enable`). Quindi su Studio il contesto TP per la finestra RDMA del verify-block e il codice che lo usa (7 riferimenti nel preprocessato ROCm) vengono compilati.

Verificato: compila e linka a `-O3` (`ds4_tp.o` è già in `CORE_OBJS` ROCm, Makefile:315/331). A runtime il gate V4.1 rifiuta `opt->cuda_tensor_parallel` e `n_gpus > 1` prima di raggiungerlo, e gli stub `ds4_gpu_tp_*` di `rocm-deepseek41-tp-stubs` restituiscono fallimento (`ds4_gpu_tp_failed() == 1`). Nessuna azione; da coprire con lo smoke test di §4.3.

### 3.3 `ds4_linux_memory.h` ora entra anche nelle build CUDA Linux

Upstream:

```c
-#ifdef DS4_ROCM_BUILD
+#if defined(DS4_ROCM_BUILD) || (!defined(__APPLE__) && !defined(DS4_NO_GPU))
 #include "ds4_linux_memory.h"
```

e chiama `ds4_linux_nonmovable_memory()` in un ramo CUDA (`ds4.c:~71399`, sotto `#if !defined(DS4_NO_GPU) && !defined(__APPLE__) && !defined(DS4_ROCM_BUILD)`).

Conseguenza: la feature `cma-free-requires-cma-total` (che modifica `ds4_linux_nonmovable_memory_parse` per non sottrarre `CmaFree` quando `CmaTotal == 0`) **ora cambia anche il budget di memoria delle build CUDA Linux**. Il cambio è corretto anche lì (stessa logica `/proc/meminfo`), ma:

- aggiornare la `description` in `features/cma-free-requires-cma-total/feature.toml`, che oggi parla solo di ROCm/Strix Halo;
- se esiste una macchina CUDA Linux di riferimento, eseguire `make test-linux-memory` (o il test della feature, `tests/test_linux_memory.c`) e uno startup `ds4-server` su CUDA confrontando la riga "usable memory" prima/dopo.

### 3.4 Cambio di comportamento DSpark su ROCm gfx1151

Upstream rimuove `ds4_dspark_rocm_gfx1151_reference_alignment()` e `ds4_session_dspark_rocm_gfx1151_reference_alignment()`, che su ROCm gfx1151 spostavano la posizione delle feature del draft di −1 (`positions[0] = pos - 1u`), usavano il KV target diretto (`direct_target_kv`) e cambiavano il controllo `window_ok`. Rimuove anche un `#ifndef DS4_ROCM_BUILD` nello stesso percorso (commit `b14bf62` "Repair DSpark and ROCm regression tests" e `fc80bd6`).

L'overlay non referenzia questi simboli (verificato con grep su `patches/`, `src/`, `rocm/`, `ds4_rocm*.cu`), quindi niente rompe la build. Però **su Strix Halo il percorso DSpark cambia comportamento**: va misurato (§4.3), non dato per buono. Se l'accettazione del draft peggiora, la correzione va in una nuova feature overlay, non nel root.

`ds4_gpu_dspark_gfx1151_fast_path()` (lato `ds4_rocm.cu`) resta usato da `ds4_dspark_rocm_gfx1151_fast_path()`: nessun simbolo orfano.

### 3.5 Resto del delta upstream

- `ds4_cuda.cu` (+2760), `cuda/mmq/*`, `ds4_deepseek41_cuda.cuh`: non compilati su ROCm, tranne `cuda/mmq/*`, che ROCm compila via `vendors/hip.h`. Vedi §5 per `cuda-mmq-v41`.
- `ds4_tp.c` (+908): compilato su ROCm, compila pulito, nuovi percorsi raggiungibili solo con TP configurato (rifiutato su ROCm).
- `ds4_server.c` (+25): entra solo negli engine binary `ds4-server`; la copia Studio (`studio/ds4_server.c`, `from = "ds4_server.c"`) riceve il cambio tramite `studio__ds4_server.c.patch`, che applica ancora. Rivedere a mano le 25 righe (riguardano lo stop speculativo, `tests/test_server_speculative_stop.py`) per capire se toccano logiche che Studio ha modificato.
- `ds4.h` (+22): nuove opzioni (`dspark_confidence_threshold_set`, campi TP). Eventuali consumer Studio in `frontend/server` non leggono la struct C: nessun impatto.

---

## 4. Step 4 — Verifica

### 4.1 Build

```bash
cd ds4-overlay
./scripts/overlayctl.py compose
./scripts/overlayctl.py build --target strix-halo     # ds4, ds4-server, ds4-agent, ds4-wrapper
make -f "$(./scripts/overlayctl.py shadow-path)/Makefile.overlay" overlay-strix-halo-wrapper
```

Controllo di link esplicito (stessa tecnica di §0.3, sul tree compose reale):

```bash
SH=$(./scripts/overlayctl.py shadow-path)
nm -u $SH/ds4.o $SH/ds4_tp.o | awk '{print $NF}' | grep -E '^(ds4|metal|qwen4|glm|ds41)_' | sort -u > /tmp/u
nm --defined-only $SH/*.o $SH/cuda/mmq/*.rocm.o | awk 'NF==3{print $3}' | sort -u > /tmp/d
comm -23 /tmp/u /tmp/d      # atteso: vuoto
```

### 4.2 Test

| Suite | Comando | Copre |
|---|---|---|
| Invarianti overlay | `ds4-overlay/tests/run_all.sh` | immutabilità upstream, compose, exact/make_patch |
| V4.1 ROCm | `./scripts/overlayctl.py test --suite deepseek41` (= `overlay-test-deepseek41-memory`, `-cache-spans`, `-rocm`) | `dsv41-expert-streaming`, `model-span-bounds`, `rocm-deepseek41` |
| ROCm generale | `./scripts/overlayctl.py test --suite rocm` + `make test-rocm` | backend |
| MMVQ ROCm (nuovo upstream) | `make test-mmvq-rocm` | `cuda/mmq/mmvq.cu` cambiato, compilato via HIP |
| CPU upstream nuovi | `tests/test_session_state.c`, `tests/test_quality_api.c`, `tests/test_deepseek_indexer.c`, `tests/test_tp_commands.c`, `tests/test_tp_link.c`, `tests/test_tp_tcp.c` | logica host cambiata in `ds4.c`/`ds4_tp.c` |
| Studio | `make overlay-test-agent overlay-test-server overlay-test-openwiki`; `cd frontend && npm test` | `studio-app-layer`, `openwiki-transport` |

I test `tests/test_cuda_*` nuovi (24 file) sono CUDA-only: si importano con il sync ma non si eseguono su Strix Halo.

### 4.3 Smoke test runtime su Strix Halo

1. **V4.1 SSD streaming** (percorso `dsv41-expert-streaming` + `model-span-bounds`): avvio `ds4-server` V4.1 con `--ssd-streaming`. Verificare nei log:
   - `ds4: V4.1 ROCm SSD allocator reserve … GiB`
   - `ds4: V4.1 SSD prepared … static weights …`

   Poi una generazione breve e lo shutdown pulito (SIGINT), che esercita il nuovo ordine di `ds4_engine_close`: nessun crash e nessun accesso a memoria già liberata.
2. **DSpark** (§3.4): stesso prompt fisso, `--dspark`, confronto con la build attuale (`5bda80ab`): acceptance rate, tok/s, e output identico a temperatura 0. Upstream fornisce `tests/test_dspark_rewind.py`, `test_dspark_window.py`, `test_dspark_eos_contract.py`, `test_dspark_confidence_input.py` (richiedono server attivo): eseguirli contro il server ROCm.
3. **Qwen3.8** (`rocm-qwen4-enable`): `ds4 --first-token-test` col modello Qwen, confronto con `--cpu`.
4. **Engram disk-only** (`rocm-disk-only-engram`, upstream ha toccato `ds4_engram.c` +41): avvio con engram su disco.

---

## 5. Step 5 — Candidati al ritiro (solo dopo Step 4 verde)

| Feature | Perché valutarla | Comando |
|---|---|---|
| `cuda-mmq-v41` | Upstream ha aggiunto +788 righe a `cuda/mmq/ds4_mmq.cu`, ma §5bis mostra che sono un'altra cosa (GEMV Q8, MXFP4 staged/Blackwell). Il kernel compact IQ2_XXS gfx1151 dell'overlay non esiste upstream. Test di sola conferma, atteso rosso | `./scripts/overlayctl.py pure-upstream-test cuda-mmq-v41` |
| `qwen4-ngram-pread-bound` | Già disabilitata; non applica da `df6eedd`; warning assente con gcc 13.3 (§5bis) | rimozione diretta |

Regola dell'overlay: una sonda testuale non è una decisione. Si ritira solo se il `pure-upstream-test` è verde. Tutte le altre feature restano, perché upstream continua a escludere ROCm (`DS4_HAS_DEEPSEEK41_GPU`, `DS4_HAS_QWEN4_GPU`) e non ha corretto l'ordine di `ds4_engine_close`.

---

## 5bis. Verifica ridondanza: patch già assorbite da upstream?

Domanda: qualcuna delle patch overlay esistenti è diventata superflua perché `fc80bd6` include già lo stesso cambiamento?

### Metodo

Per ogni `shadow_patch` (25) e `overlay_file` di tutte le 16 feature, contro il tree `fc80bd6`:

1. **Lato "nuovo" presente?** Il testo post-patch dell'hunk (whitespace normalizzato) compare in upstream → upstream ha già il cambio.
2. **Lato "vecchio" presente?** Il testo pre-patch compare ancora → upstream ha ancora il codice che la patch corregge.
3. **Righe significative aggiunte** (> 12 caratteri, non commenti) presenti in upstream.
4. Per le feature che toccano file cambiati in questo intervallo, lettura manuale del diff upstream nella stessa regione.
5. `overlay_file`: il target esiste upstream ed è identico?

### Risultato: nessuna patch abilitata è assorbita

Per tutte le patch core/gpu/rocm/cuda: **lato nuovo presente = 0 hunk**, lato vecchio presente su tutti gli hunk tranne quelli spostati da upstream (§2). Nessun `overlay_file` è identico a un file upstream.

| Feature | Upstream `fc80bd6` | Verdetto |
|---|---|---|
| `rocm-qwen4-enable` | `ds4.c:53` ancora `#if !defined(DS4_NO_GPU) && !defined(DS4_ROCM_BUILD)` per `DS4_HAS_QWEN4_GPU`; `ds4_rocm.cu` non menziona qwen4 (0 occorrenze); nessun commit tocca `ds4_qwen4_cuda.cuh`/`ds4_rocm.cu`/`rocm/` | **resta** |
| `rocm-deepseek41` | `DS4_HAS_DEEPSEEK41_GPU` ancora escluso su ROCm; gate V4.1 senza restrizioni ROCm SSD; `ds4_rocm_unavailable.cu` invariato (niente `ds4_gpu_tp_init/shutdown/failed`) | **resta** |
| `dsv41-expert-streaming` | 0/15 delle API dichiarate dalla patch in `ds4_gpu.h` (`ds4_gpu_dsv41_*`, `ds4_gpu_set_deepseek41_model`, `ds4_gpu_set_streaming_free_reserve`, `ds4_gpu_stream_expert_cache_{quiesce,reserve_layers,…}`). Il cambio upstream di `ssd_streaming` ("glm-branch… always false" → "Routed experts are streamed from disk", `77570b4`) è **solo il commento**: i punti che lo assegnano sono gli stessi di `0aaea5a` | **resta** |
| `model-span-bounds` | `ds4_engine_close` libera ancora host prima della GPU (§2.4); `cuda_model_range_ptr` (`ds4_cuda.cu:815`) senza controllo `offset/bytes` contro `g_model_registered_size` | **resta** |
| `accelerator-span-bounds` | `ds4.c:3500` ancora `if (t->bytes == 0 \|\| t->type != DS4_TENSOR_Q8_0 \|\| t->ndim != 2) continue;` | **resta** |
| `rocm-disk-only-engram` | `ds4.c:3384` ancora esenzione per solo nome (`blk.1/14.engram_embd.weight`). Il +41 di `ds4_engram.c` è una LUT BF16 per la decodifica, non la validazione | **resta** |
| `cuda-mmq-v41` | Il +788 upstream è altro: GEMV Q8 (`DS4_Q8_GEMV_WARPS`), `ds4_mmq_moe_gate_up_mid_mxfp4_staged_kernel`, MXFP4 con attivazioni Q8_1 su Blackwell, fix bound MMVQ. La patch overlay aggiunge un kernel compact IQ2_XXS **solo HIP / gfx1151** (`ds4_mmq_compact::*`, `ds4_mmq_compact_mul_mat_q`): 0 occorrenze upstream. Il 58/96 di "righe uguali" viene dal corpo del kernel copiato da `mul_mat_q` | **resta**. Il `pure-upstream-test` di §5 non è più "probabile ritiro" ma una conferma: atteso rosso |
| `cma-free-requires-cma-total` | `ds4_linux_memory.h` invariato | **resta** (ambito esteso a CUDA, §3.3) |
| `rocm-strix-halo`, `rocm-vision-alpha-precision`, `vision-gpu-v41`, `docs-strix-halo`, `deepseek41-harness` | File target non toccati in questo intervallo; `overlay_file` assenti upstream | **restano** |
| `studio-app-layer`, `openwiki-transport` | Layer applicativo Studio, nessun equivalente upstream. Il +25 di `ds4_server.c` (rewind speculativo al boundary, `fc80bd6`) non si sovrappone ai 5 hunk Studio (metriche `timing_prefill_sec/decode_sec` nell'usage JSON) | **restano** |

Nota su `studio-app-layer`: il check segnala 16 hunk di `studio__ds4_agent.c.patch` con "lato nuovo presente". Sono falsi positivi: 15 aggiungono una riga vuota, che sparisce con la normalizzazione degli spazi, e 1 aggiunge una riga a un blocco ripetuto. `ds4_agent.c` non è cambiato in questo intervallo.

### Qwen3.8 = "qwen4" nel codice

Nel codice upstream, `qwen4` è il nome interno di **Qwen3.8 Flash Next**: README upstream riga 12, commit `df6eedd` "Add optimized CUDA inference for Qwen3.8 Flash Next", `docs/QWEN38_FLASH_NEXT.md`. Il supporto Qwen3.8 di Studio non è un'implementazione parallela:

- tutti i file Qwen nel root (`ds4_qwen4_cuda.cuh`, `metal/qwen4.metal`, `docs/QWEN38_FLASH_NEXT.md`, test, `gguf-tools/gen_qwen4_unicode.py`…) sono codice upstream, identici a `fc80bd6` (qwen non è cambiato in questo intervallo: 0 righe `qwen` nel diff di `ds4.c/ds4.h/ds4_server.c/ds4_gpu.h`);
- Studio aggiunge solo `rocm-qwen4-enable`, cioè gate ROCm, `src/rocm/ds4_rocm_qwen4_compat.cuh` e i ritocchi HIP in `ds4_qwen4_cuda.cuh`, `ds4_rocm.cu`. Upstream continua a escludere ROCm, quindi questa feature serve ancora.

### Unica feature superflua: `qwen4-ngram-pread-bound` (già `enabled = false`)

- La patch **non applica nemmeno su `0aaea5a`**: il contesto è cambiato con `df6eedd` (2026-09-15), che ha aggiunto `|| (size_t)n > bytes - done` dopo il `pread`.
- Il warning che silenziava (`-Wstringop-overflow` su `__pread_alias`) **non compare più**: compilando `ds4.c` di `fc80bd6` con gcc 13.3.0, `-O3`, `_FORTIFY_SOURCE=3` (default Ubuntu), stderr è vuoto (0 byte).
- La sua stessa descrizione dice: "Retire this when … the warning stops firing on the supported compilers". La condizione è soddisfatta.

Azione: commit `overlay: retire qwen4-ngram-pread-bound (warning gone upstream since df6eedd)` che rimuove `features/qwen4-ngram-pread-bound/` e `patches/core/qwen4-ngram-pread-bound.patch`. Da `disabled` a rimossa non cambia nulla nel build.

---

## 6. Sequenza dei commit

| # | Commit | Contenuto | Build verde? |
|---|---|---|---|
| 1 | `sync: upstream antirez/ds4 0aaea5a..fc80bd6` | root: 41 file + 30 nuovi + `.gitignore` | no (patch rotte) |
| 2a | `overlay(rocm-deepseek41): re-anchor on fc80bd6` | §2.1 + `reviewed_sha` | — |
| 2b | `overlay(rocm-qwen4-enable): re-anchor on fc80bd6` | §2.2 + `reviewed_sha` | — |
| 2c | `overlay(dsv41-expert-streaming): re-anchor on fc80bd6` | §2.3 + `reviewed_sha` | — |
| 2d | `overlay(model-span-bounds): re-derive engine_close on fc80bd6` | §2.4 + `reviewed_sha` + descrizione | **sì** (compose 25/25) |
| 3 | `overlay(cma-free-requires-cma-total): note CUDA scope since fc80bd6` | §3.3 descrizione | sì |
| 4 | (opz.) `overlay(rocm-deepseek41): side_join stub for -O0 links` | §3.1 | sì |
| 5 | `overlay: mark features reviewed at fc80bd6` | `reviewed_sha` delle feature rimanenti, dopo Step 4 | sì |
| 6 | `overlay: retire qwen4-ngram-pread-bound` | §5bis, rimuove feature disabilitata e patch morta | sì |
| 7 | (solo se smentisce §5bis) `overlay: retire cuda-mmq-v41` | §5, solo con pure-upstream verde | sì |

Prima di ogni commit (CLAUDE.md):

```bash
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

Un risultato `partial: true` o `truncated: true` va ripetuto: zero vuol dire "non visto", non "non toccato". Prima del merge su `main`:

```bash
node .gitnexus/run.cjs detect-changes --scope compare --base-ref main --repo .
```

---

## 7. Rollback

- Una sola feature: `git revert <commit 2x>`. Le feature sono indipendenti, a parte l'ordine 2a → 2b: `rocm-qwen4-enable` presuppone che `rocm-deepseek41-enable` abbia già riscritto la guardia DeepSeek, perché la sua patch non ha contesto iniziale.
- Tutto: `git reset --hard ecfb76d` sul branch (solo locale, prima del push) oppure abbandonare il branch: `feature/performance-ds4.1-qwen3.8-halogen` è intatto.
- La build precedente resta in `new-ds4-studio-build/5bda80ab…/` (shadow per sha): il binario funzionante non viene sovrascritto da un compose su `fc80bd6`, che finisce in un'altra directory.

---

## 8. Checklist

- [x] §1 precondizione EQ_OLD ri-verificata, `git apply` + `merge-file` ok, §1d nessun DIFF
- [x] commit 1 (`e89754d`)
- [x] `gitnexus analyze --index-only`; impact UNKNOWN (GitNexus salta `ds4.c` > 512 KB), confermato via testo, rischio HIGH
- [x] §2.1–2.4 applicati, `reviewed_sha` aggiornati, commit 2a–2d (`8750950`, `5a32350`, `3d51389`, `59ebe95`)
- [x] `overlayctl compose` senza PATCH_FAIL/ANCHOR_FAIL, 25 patch applicate
- [x] `tests/run_all.sh` verde
- [x] build strix-halo + wrapper, link senza simboli mancanti
- [x] suite deepseek41, rocm, test-mmvq-rocm, test CPU nuovi, test Studio: 0 regressioni rispetto a `ecfb76d`; fallimenti preesistenti invariati (vedi certificazione §2.4–2.5)
- [ ] smoke test runtime 4.3 — **NON CERTIFICATO**: RAM occupata da un altro servizio (vedi certificazione §3)
- [x] §3.3 descrizione cma aggiornata (`88247e1`); verifica CUDA **NON CERTIFICATA** (manca hardware)
- [ ] (opz.) §3.1 stub side_join — non fatto, per scelta motivata
- [x] §5bis rimozione `qwen4-ngram-pread-bound` (`a4e6451`)
- [x] §5 pure-upstream-test cuda-mmq-v41: verde **vuoto** (0 test dichiarati), la feature resta
- [x] `detect-changes` prima di ogni commit (sync: critical, atteso; overlay: nessun simbolo)
