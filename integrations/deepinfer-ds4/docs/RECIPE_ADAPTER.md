# Protocol adapter deepseek-recipe (piano §5, PR-05) — ADR-002

Sorgente: `../deepseek-recipe` @ `935817c` (MIT), checkout locale di sola lettura.
Build autorizzata dall'utente il 2026-10-22; `cargo build --offline --locked`, nessun download.

## Componenti

| Percorso | Cosa |
|---|---|
| `recipe-adapter/src/main.rs` | Processo locale JSON-lines (contratto §5.1): `encode` (richiesta Chat Completions → prompt + `special_ranges`) e `parse` (chunk di testo del backend → chunk protocollo + validazione tool call) |
| `recipe-adapter/oracle/ds4_render_oracle.c` | Oracolo golden: include `ds4_server.c` invariato (come `tests/ds4_test.c`) e chiama `parse_messages`, `parse_tools_value`, `render_chat_prompt_text_for_syntax`. Build CPU-only in `oracle/build/`, nessun file DS4 toccato |
| `recipe-adapter/golden/render_cases.json` | 54 casi: 9 conversazioni × {none, high, max} × {V4, V4.1} |
| `python/deepinfer_ds4/recipe_golden.py` | Confronto byte per byte, template fingerprint, `route()` fail-closed |
| CLI | `python -m deepinfer_ds4 recipe-golden [--cases-detail]` |

Tokenizer: un solo owner, il GGUF di DS4. L'adapter non produce token ID
(`token_ids_available: false`); restituisce il prompt e i range byte dei token
speciali espliciti. Nessuna immagine: le richieste che renderizzano un placeholder
immagine sono rifiutate; il crate `deepseek-recipe-image` (fetch HTTP, OpenCV) non è una dipendenza.

## Risultato golden (render)

`recipe-golden` @ DS4 `c76ebdf`, template fingerprint `23ac9eff…27b5c5`:

| Famiglia | Casi identici | Golden pass |
|---|---:|---|
| `deepseek-v4` | 5 / 27 | no |
| `deepseek-v4.1` | 15 / 27 | no |

Identici: chat senza tool (singolo turno, senza system, storico multi-turno con
reasoning vecchio scartato, marker speciali come testo, Unicode), per V4.1 in tutti
i modi di thinking, per V4 solo senza thinking.

Divergenze verificate (prima differenza al byte indicato da `--cases-detail`):

1. **Prefisso reasoning effort V4.** Recipe 0.2.0 rende V4 con il template V4-Pro:
   `high` → "Absolute maximum…", `max` → "Beyond maximum…". DS4 (V4 Flash) non mette
   prefisso per `high` e usa "Absolute maximum…" per `max` (`ds4.c:61036`).
2. **Testo del prompt tool.** DS4 ha un testo proprio (regole di escape
   `&lt;/｜DSML｜parameter>`, "Use the exact parameter names", istruzione V4.1 più
   corta) e mette gli schemi tool *prima* del system del client, così
   `--kv-cache-boundary-trim-tokens` taglia la coda dinamica e non la regione tool
   (`ds4_server.c:3098-3103`). Recipe usa il testo ufficiale e l'ordine system → tool.
3. **Ruolo `developer`.** DS4 lo tratta come system; il parser Chat Completions di
   recipe lo rifiuta (`unknown variant developer`).

Sono scelte deliberate e testate di DS4, non bug: adattare recipe in silenzio
violerebbe §5.3 ("mismatch deve causare fallback"). Con questo corpus `route()`
restituisce `legacy` per entrambe le famiglie anche con il flag acceso.

## Risultato golden (parse, §5.3)

| Caso | Recipe da solo | Con validazione adapter |
|---|---|---|
| `</think>` spezzato fra chunk | reasoning/content separati correttamente | — |
| UTF-8 multibyte carattere per carattere | preservato | — |
| Argomenti tool progressivi (un carattere per chunk) | stessi argomenti del chunk unico | autorizzato |
| JSON escape nei parametri stringa | corretto (`Roma \"x\"`) | — |
| Tool **non dichiarato** (`rm_rf`) | emesso, `finish_reason: tool_calls` | **rifiutato** |
| Blocco DSML **non chiuso** + stop | emesso, `finish_reason: tool_calls` | **rifiutato** |
| Cancel prima della chiusura | argomenti parziali, `finish_reason: stop` | rifiutato |
| DSML malformato (`nam=`) | nessun tool, testo scartato | nessun tool |

Recipe non è un confine di autorizzazione: emette qualsiasi tool call scritta nel
testo. L'adapter autorizza una chiamata solo se lo stream finisce con `tool_calls`,
ogni blocco aperto è chiuso, il nome è dichiarato nella richiesta e gli argomenti
sono un oggetto JSON (`authorized_tool_calls` / `rejected_tool_calls`).

Limite: con chunk di testo i marker si riconoscono per spelling, quindi un
`</think>` letterale generato come token ordinari viene trattato come marker.
Recipe distingue i token speciali solo sul percorso `Tokens` con tokenizer
collegato, che richiede token ID dal backend DS4: non c'è un hook per farlo.

## Gate 3

- Semantica API sui trace legacy: invariata (nessun file DS4 modificato, flag OFF).
- Parse lineare: test di scala 4K → 40K caratteri (`test_parse_scales_linearly`).
- Zero richieste esterne: la suite gira in `unshare -rn` (namespace senza rete)
  quando disponibile. Il grafo contiene `ureq`/`hf-hub`/`rustls` tramite la feature
  `http` di `tokenizers`, abilitata nel workspace recipe; il binario non ne contiene
  simboli (`nm | grep ureq::` = 0) perché l'adapter non carica tokenizer.
- Ciclo completo con Agent: **non verificato** (richiede integrazione in
  `ds4-server`, fuori perimetro).

## Decisione

1. **Recipe non sostituisce il renderer DS4.** NO-GO per il routing dei prompt su
   V4 e V4.1: golden fallito per divergenze intenzionali di DS4.
2. L'adapter resta come **oracolo di riferimento** indipendente: segnala quando il
   renderer DS4 diverge dal template ufficiale sulla chat semplice (oggi identico su
   V4.1 e su V4 senza thinking) e come test di regressione via template fingerprint.
3. La validazione fail-closed delle tool call è il pezzo riusabile: qualunque
   parser a valle (DS4 o recipe) deve applicarla prima di eseguire un tool.
4. `recipe_adapter.enabled` resta `false`. Rollback: rimuovere `recipe-adapter/`,
   `recipe_golden.py` e il relativo test.
