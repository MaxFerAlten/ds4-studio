[BEGIN DS4 LEAN POLICY]

# Lean 4 Integration Skill — ds4-studio

## Missione
Fornire all'agente un metodo sicuro, riproducibile e strutturato per verificare codice Lean 4 in un progetto Lake pinato con sandbox obbligatoria.

## Quando usare Lean
- Per scrivere e verificare dichiarazioni e dimostrazioni in Lean 4.
- Per controllare che un file `.lean` sia sintatticamente ed elaborato correttamente.
- Per utilizzare Mathlib quando il problema richiede librerie matematiche avanzate.

## Quando non usare Lean
- Non usare Lean per eseguire programmi: `lean_check` non invoca un `main` compilato.
- Non usare Bash, `lake`, `lean`, `elan` direttamente.
- Non usare `lean_check` per certificazione formale (MVP: solo typecheck).
- Non tentare di aggirare la sandbox con opzioni CLI non documentate.

## Tool obbligatorio
- `lean_check task_mode=proof`: prova autoritativa richiesta dall'utente.
- `lean_check task_mode=utility`: typecheck diagnostico/ausiliario, mai prova finale.
- `lean_inspect`: discovery opzionale di firme, mai prerequisito e mai prova.

Non usare Bash, lake, lean, elan o un eseguibile generato direttamente.

## Proof task identity

Per `task_mode=proof` devi impostare **due** campi sulla prima chiamata:

- `target_declaration` — il nome esatto del theorem/lemma;
- `target_statement` — l'enunciato come header di dichiarazione Lean fino a
  `:= by` escluso, per esempio
  `theorem cauchy_mvt (f g : ℝ → ℝ) (hab : a < b) : ∃ c ∈ Set.Ioo a b, ...`.

`target_statement` sigilla il significato del task **prima** che venga eseguito
un solo candidato. Senza di esso la chiamata è rifiutata e non consuma tentativi.

Il motivo è una regressione reale: quando il target veniva dedotto dal primo
`lean_check`, un primo candidato come

```lean
theorem cauchy_mvt : True := by trivial
```

sigillava sé stesso come target, corrispondeva a sé stesso e arrivava a
VERIFIED. Lean non aveva sbagliato nulla — quel termine è davvero verificato —
ma il task era stato soddisfatto ridefinendolo. Il target non può derivare dal
candidato che deve dimostrarlo.

Il target deve essere scritto con proof body `:= by`.
Dopo il sigillo non puoi cambiare:

- `target_declaration`;
- binders;
- hypotheses;
- conclusion;
- quantifier order;
- domain/types.

Puoi cambiare:

- proof body;
- helper lemmas;
- imports;
- tactic strategy,

purché il target statement hash resti identico.

Un risultato utility `status=checked` significa che quel sorgente è stato
elaborato; non autorizza frasi come «il teorema richiesto è verificato» se il
proof task non è arrivato a VERIFIED.

Un candidato `status=checked` che enuncia qualcos'altro rispetto al target
sigillato è una sostituzione, non una riparazione: viene rifiutato prima ancora
di lanciare Lean e non consuma tentativi.

## Il repository non è spazio di lavoro

Mentre un task Lean è attivo il workspace è in sola lettura:

- `write` e `edit` sono bloccati;
- i comandi shell che possono scrivere (`cat >`, `tee`, `sed -i`, `rm`, `mv`,
  `cp`, `git apply`) sono bloccati; la discovery read-only (`grep`, `rg`,
  `find`, `cat`, `sed -n`, `head`, `tail`, `ls`, `git status|log|diff`) resta
  disponibile;
- il candidato va passato direttamente a `lean_check(code=...)`, non scritto su
  file di appoggio.

Un sorgente `.lean` che contiene `sorry`, `admit` o `by?` non viene mai
persistito, dentro o fuori da un task Lean. Una fixture committata da uno
sviluppatore è un'altra cosa rispetto a un file di scarto lasciato dall'agente.

## Integrità della presentazione

Il sorgente pubblicato deve essere byte per byte quello verificato. Se compare
il replacement character `U+FFFD` nel sorgente ritenuto o nella risposta, la
pubblicazione è bloccata con `LEAN_PRESENTATION_INTEGRITY_FAILED`: non
rigenerare la dimostrazione, ripubblica i byte ritenuti. `U+FFFD` non si ripara
per sostituzione — l'informazione è già persa, e tre replacement character
consecutivi possono venire da `ℝ`, `→`, `∃`, `∈`, `✓` o `€`.

Questo file non contiene mai il carattere letterale: lo nomina soltanto, perché
il gate di certificazione tratta la sua presenza nelle policy come corruzione.

## Profili
- `core`: profilo minimo senza dipendenze esterne (solo la toolchain base).
- `mathlib`: profilo con Mathlib incluso per dimostrazioni che richiedono la libreria.

Specifica `profile=mathlib` solo quando il codice importa moduli da Mathlib.

### Regola sugli import Mathlib
**Preferisci import mirati** per ridurre latenza e memoria. Usa `import Mathlib`
solo quando è davvero giustificato e rientra nel budget configurato; non dare
per scontato un tempo fisso: la durata dipende da versione, cache, hardware e
stato della build. Importare la radice carica l'intera libreria ed è
tipicamente molto più lento del budget di default.

Importa i moduli specifici che servono. Esempi:

```lean
import Mathlib.Data.Nat.Prime.Basic
import Mathlib.Analysis.SpecialFunctions.Log.Basic
import Mathlib.Tactic.Ring
```

Un import mirato tipico si verifica in pochi secondi. Se non conosci il modulo
esatto, parti dal ramo più plausibile e correggi con il diagnostico
`unknown identifier` restituito da `lean_check`.

## Autonomous completion contract

Il turno Lean finisce in uno solo di questi modi:

```text
CHECKED
    oppure
NOT_VERIFIED con causa terminale strutturata
```

Non sono stati terminali validi: «la versione dovrebbe passare», «l'unico errore
era…», «scrivimi di nuovo per verificare», «ho raggiunto tre chiamate»,
«teorema dimostrato» senza `status=checked`.

```text
NO CHECKED RESULT, NO VERIFIED CLAIM.
NO RETRYABLE FAILURE, NO PLAIN-TEXT FINALIZATION.
NO NEW USER MESSAGE REQUIRED TO CONTINUE A REPAIRABLE PROOF.
```

Ogni risultato di `lean_check` inizia con un blocco normativo:

```text
LEAN_ORCHESTRATION
state=repair_required
attempt=4/6
retryable=true
failureClass=rewrite_miss
strategyChangeRequired=true
nextAction=Replace the rw chain with calc or simp only and retry now.
FINALIZATION_ALLOWED=false
```

`FINALIZATION_ALLOWED=false` significa che una risposta in prosa verrebbe
scartata dall'orchestratore: correggi e richiama `lean_check` **nello stesso
turno**. Non chiedere all'utente di scrivere «continua».

## Ciclo generate/check/repair
1. Scrivi una dichiarazione Lean 4 completa e sintatticamente valida.
2. Invia con `lean_check`.
3. Se il risultato è `status=checked`, la elaborazione è riuscita.
4. Se ci sono diagnostici di errore, correggi il codice seguendo `nextAction`.
5. Continua finché non arrivi a `checked` o a un terminale non verificato.
6. Non reinviare mai sorgente byte-identico dopo un fallimento: viene rifiutato
   prima dello spawn con `LEAN_SOURCE_UNCHANGED_AFTER_FAILURE`.
7. Dopo due fingerprint diagnostici identici cambia strategia di dimostrazione,
   non tattica dentro la stessa strategia.

## Failure-class response table

| `failureClass` | Terminale | Cosa fare |
|---|---|---|
| `syntax` | no | correggi solo gli errori del parser; non toccare l'enunciato |
| `unknown_identifier` | no | verifica namespace/import/nome; preferisci un import mirato |
| `rewrite_miss` | no | sostituisci la catena `rw` con `calc`, `change`, `conv`, `nth_rewrite`, `simp only`, `ring` o `omega` |
| `unsolved_goals` | no | chiudi esattamente il goal residuo; non riscrivere tutta la prova |
| `type_mismatch` | no | riconcilia tipo atteso e tipo effettivo |
| `timeout_repairable` | no | prima restringi gli import, poi riduci l'automazione, poi cambia strategia |
| `proof_failure` | no | ripara il termine di prova a partire dagli errori riportati |
| `infrastructure` | sì | non modificare il codice: pubblica NOT_VERIFIED con il codice runtime esatto |
| `contract` | sì | correggi gli argomenti di `lean_check`, non la dimostrazione |
| `user_cancelled` | sì | pubblica NOT_VERIFIED; nessuna prova è stata completata |

## No checked, no proof claim

Una risposta può dichiarare la dimostrazione verificata **solo** dopo un
risultato `status=checked` con `exitCode=0`, `timedOut=false`, `cancelled=false`.
In ogni altro caso la risposta deve dire `STATO: NOT_VERIFIED` e riportare la
causa terminale. Un timeout non è una prova falsa: è un fallimento riparabile.

## TERMINAL MEANS TERMINAL

Quando il runtime Lean riporta `terminal=true` o `retryable=false` con un
`terminalReason`, **non invocare nessun altro tool** nel tentativo di salvare
quella prova. Il runtime entrerà in `FINALIZATION_ONLY` e producirà il risultato
automaticamente.

In particolare:

- no `lean_check` aggiuntivo dopo budget_exhausted, infrastructure_block, o
  contract_revision_mismatch;
- no `crawl`, no web search, no file read per la stessa prova;
- no DSML tool call; produci soltanto il testo di finalizzazione.

```text
TOOL_PROTOCOL_TERMINAL o FINALIZATION_ONLY
→ nessuna nuova chiamata tool in questo task
```

Non inferire il budget rimanente dalla somma dei timeout per-chiamata.
Leggi `elapsedWallClockMs` / `remainingWallClockMs` dal runtime.

## Non sostituire il teorema richiesto

Se il teorema richiesto è irraggiungibile con i profili disponibili (es. serve
`mathlib` ma il preflight riporta `infrastructure`), non sostituirlo con un
teorema diverso senza dirlo. Rispondi prima con `STATO: NOT_VERIFIED` e la
causa, poi — solo se utile — offri un esempio più semplice **etichettato
esplicitamente** come sostituto, mai come se fosse la dimostrazione richiesta.

## Candidate preflight (sorry/admit)

Se il sorgente contiene `sorry` o `admit`, il runtime restituisce
`errorCode=LEAN_CANDIDATE_PREFLIGHT_BLOCKED` con `attemptConsumed=false`.
Questo **non** è un errore terminale: è un gate di riparazione.

Quando ricevi `LEAN_CANDIDATE_PREFLIGHT_BLOCKED`:

- non finalizzare;
- rimuovi i placeholder segnalati (`sorry`, `admit`);
- preserva l'assertion del teorema;
- chiama `lean_check` di nuovo;
- questo preflight non consuma un tentativo della prova.

`failureClass=candidate_preflight` è `retryable=true` e `terminal=false`.

Lo stesso vale per `errorCode=LEAN_CODE_INVALID_UTF8` (il campo `code` conteneva
un carattere di sostituzione Unicode U+FFFD, segno di una generazione
corrotta): rigenera il sorgente senza il carattere corrotto e richiama
`lean_check`. Anche questo non consuma un tentativo della prova.

## Lean API discovery

Se un simbolo Mathlib non familiare è incerto, **ispezionalo prima** di
costruire una lunga dimostrazione:

```
lean_inspect symbols=["<simbolo>"] imports=["<modulo>"]
```

Non chiamare `lean_inspect` soltanto per sbloccare `lean_check`: non esiste più
alcun gate inspect-before-check.

`lean_inspect` è discovery opzionale: non consuma tentativi della prova, non
imposta `verified`, non crea un proof task e non autorizza la finalizzazione.
Restituisce la firma `#check` del simbolo confermato dal compilatore Lean.

Il web search può suggerire un nome di simbolo, ma **non** stabilire la firma
esatta Lean/Mathlib. Ogni API non familiare deve essere confermata da Lean o
da un indice locale ufficiale.

## Interpretazione del risultato
- `status=checked` significa che Lean ha elaborato il file senza errori: la
  verifica dell'elaborazione secondo la toolchain pinata è reale, non nominale.
- Ciò che manca per parlare di certificazione è la policy aggiuntiva su `sorry`,
  assiomi e dichiarazioni attese: per questo `certified=false` sempre.
- `certified=true` non è mai presente nell'MVP; eventuale certificazione richiede un audit separato.
- I diagnostici strutturati contengono posizioni (`file:line:col`) e messaggi.
- `declarationsObserved` elenca le dichiarazioni trovate nel sorgente; se avevi
  indicato `expected_declarations` e una manca, il risultato è `failed`.

## Policy placeholder
Il sistema cerca automaticamente i token `sorry`, `admit` e
`set_option warn.sorry false`: sono **placeholder** e alzano
`containsPlaceholders`. Non usarli come sostituto di una dimostrazione.

`axiom` viene riportato come evidenza ma **non** è un placeholder: dichiarare un
assioma è una scelta esplicita e visibile. Se il risultato dipende da assiomi
dichiarati nel sorgente, dillo esplicitamente all'utente.

## Modello di esecuzione
L'elaborazione Lean può eseguire metaprogrammi, tattiche, comandi `#eval` e IO.
Il servizio tratta quindi ogni sorgente come codice non fidato e lo verifica
soltanto dentro la sandbox obbligatoria. Il tool non invoca automaticamente un
`main` compilato — che è cosa diversa dall'assenza di esecuzione durante
l'elaborazione.

Qualsiasi effetto collaterale tentato dal sorgente (filesystem, processi, rete)
è bloccato dalla sandbox, non dall'assunzione che Lean "non esegua nulla".

## Recovery e stato incoerente
I verbi supportati sono esattamente `start`, `stop`, `status` e `preflight`
(`/lean ...` legacy oppure `/skill lean ...`). Non inventarne altri:

- non esistono `/lean restart` e `/lean reset`;
- non esiste `ds4-admin` e non serve `sudo`;
- non esiste un daemon Lean da riavviare;
- non esiste un container Docker da riavviare.

Se un comando di stato dichiara `loaded=true` ma `lean_check` risponde con un
codice `LEAN_POLICY_*`, il problema è di coerenza dello stato, non di ambiente:

1. leggi `coherent`, `operational`, `repaired`, `manifestHealthy`,
   `aggregate_revision` e `active_count` nel payload del comando;
2. esegui `/lean start` **una sola volta**: ripara una revisione mancante o
   stale e risponde `repaired=true`;
3. se dopo il repair il tool fallisce ancora, fermati e riporta il codice
   ricevuto (`retryable=false`, `category=state-coherence`): è un bug da
   correggere nel codice, non da aggirare con altri tentativi.

## Due revisioni, non una

`lean_check` porta due identificatori distinti, e confonderli è un errore:

- `promptRevision` — SHA-1 (40 hex) del testo esatto delle istruzioni Lean
  iniettate in **questa** sessione;
- `contractRevision` — SHA-256 (64 hex) della semantica machine-readable del
  protocollo `lean_check`.

Nessuno dei due è una versione di Lean o di Mathlib. Non sono revisioni della
toolchain. Se hai bisogno della toolchain, la riporta `/lean preflight`.

Se il tool result si apre con:

```text
LEAN_POLICY_DRIFT
blocking=false
```

il server ha istruzioni editoriali più recenti di quelle con cui la sessione è
stata primed, e il protocollo è compatibile. **Continua la prova nello stesso
proof task.** Non chiedere all'utente di riavviare, non chiedere un nuovo turno,
non modificare il teorema per questo motivo. La policy si aggiorna con
`/lean start` quando conviene, non prima di finire la prova in corso.

`LEAN_CONTRACT_REVISION_MISMATCH` è invece terminale: client e server
implementano contratti `lean_check` incompatibili, Lean non è stato eseguito e
il codice del teorema non è la causa. Non riscriverlo: pubblica NOT_VERIFIED
citando il codice.

Ogni errore di `lean_check` porta con sé la sua classificazione:

| `category` | Significato | Cosa fare |
|---|---|---|
| `contract` | argomenti o risposta fuori contratto | correggi gli argomenti |
| `budget` | tentativi o wall-clock esauriti | pubblica NOT_VERIFIED con la causa terminale |
| `transport` | il backend non ha risposto | se esplicitamente retryable, il runtime può consentire un solo retry byte-identical |
| `runtime` | il runtime Lean non è utilizzabile sul server | `/lean preflight`, poi fermati |
| `state-coherence` | il server ha risposto per una revisione del prompt diversa da quella spedita | un solo `/lean start`, poi fermati |
| `infrastructure` | contratto `lean_check` incompatibile fra client e server | pubblica NOT_VERIFIED, non toccare il teorema |
| `internal` | difetto del codice | riporta il codice, non ritentare |

Per `LEAN_POLICY_*` e gli altri errori di coerenza dello stato, non entrare in
loop: tenta una sola riparazione documentata della skill, poi riporta il codice
strutturato. Per i diagnostici della prova con `orchestration.retryable=true`,
correggi invece la sorgente Lean e richiama `lean_check` nello stesso proof task.
Non chiedere un nuovo turno utente per azzerare il budget. Un errore transport
esplicitamente retryable può autorizzare un solo retry byte-identical; non
reinviare sorgente invariata dopo un fallimento della prova.

Non ripetere lo stesso comando sullo stesso stato più di una volta e non
proporre `sudo`.

## Formato risposta
### Successo
```
- stato: verificato da Lean
- profilo: core/mathlib
- dichiarazione: nome, se nota
- nota: typecheck riuscito; certificazione formale avanzata non eseguita
- sorgente Lean in code fence
```

### Fallimento
```
- stato: non verificato
- primo diagnostico rilevante
- posizione
- spiegazione della correzione tentata
- non presentare il codice come prova valida
```

## Limiti
- Use the runtime-provided proof budget. A retryable failure requires repaired
  source and another `lean_check` in the same proof task. Do not request a new
  user turn to reset a budget.
- Budget di tentativi per dimostrazione: definito da
  `config/lean-orchestration-policy.json` (default 6), non da un numero fisso nel
  prompt. Il blocco `LEAN_ORCHESTRATION` riporta `attempt=N/M` reale.
- Budget di wall-clock per dimostrazione: default 6 minuti.
- Esaurito il budget lo stato è `budget_exhausted`: terminale e **non verificato**.
- Timeout massimo 120 secondi per chiamata.
- Sorgente max 512 KB.
- Output stdout limitato a 64 KB, stderr a 128 KB.
- Max 200 diagnostici strutturati.

## Gestione errori
Se la sandbox o il runtime non sono disponibili, il tool restituisce `preflight_failed`.  
Non proseguire se i prerequisiti non sono soddisfatti.  
Segnala all'utente che l'ambiente Lean non è pronto e fermati.

## Esempi

Check diagnostico (**utility** — mai una prova per l'utente):
```
lean_check task_mode=utility code="theorem one_plus_one : 1 + 1 = 2 := by
  decide"
```

Proof autoritativa con target dichiarato:
```
lean_check task_mode=proof target_declaration="add_zero_unicode" code="
theorem add_zero_unicode : ∀ n : Nat, n + 0 = n := by
  intro n
  exact Nat.add_zero n"
```

Con notazione Unicode (il sorgente arriva a Lean byte-identico):
```lean
theorem add_zero_unicode : ∀ n : Nat, n + 0 = n := by
  intro n
  exact Nat.add_zero n
```

Con Mathlib, import mirato:
```lean
import Mathlib.Data.Nat.Prime.Basic

theorem prime_two : Nat.Prime 2 := by
  norm_num
```

[END DS4 LEAN POLICY]
