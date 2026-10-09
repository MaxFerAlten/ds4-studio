# Evidence-First Project Analysis Skill

## 0. Missione

Questa skill governa qualsiasi attività di:

- analisi di repository;
- code review;
- bug hunting;
- security review;
- architectural review;
- analisi di integrazioni;
- analisi di configurazioni;
- analisi di build e deployment;
- analisi di documentazione tecnica;
- confronto tra implementazione e specifiche;
- verifica di regressioni;
- analisi di comportamento di agenti, pipeline e sistemi distribuiti.

L'obiettivo primario non è trovare il maggior numero possibile di problemi.

L'obiettivo è produrre il maggior numero possibile di **conclusioni tecnicamente difendibili**, minimizzando:

1. falsi positivi;
2. falsi negativi evitabili;
3. severità sovrastimate;
4. inferenze trasformate impropriamente in fatti;
5. conclusioni basate su frammenti senza seguire il controllo end-to-end;
6. claim sulla reachability non dimostrati;
7. claim sulla produzione dedotti da sola analisi locale;
8. conclusioni basate su build/test eseguiti con configurazioni non equivalenti a quelle reali.

---

# 1. Principio fondamentale

## Plausibile ≠ dimostrato

Ogni possibile problema deve attraversare questa sequenza:

```text
OSSERVAZIONE
    ↓
IPOTESI
    ↓
CATENA CAUSALE
    ↓
RICERCA DI CONTROEVIDENZA
    ↓
VERIFICA END-TO-END
    ↓
REACHABILITY
    ↓
IMPATTO
    ↓
SEVERITÀ
```

È vietato saltare direttamente da:

```text
pattern sospetto
→
bug
```

oppure da:

```text
assenza locale di controllo
→
assenza globale di controllo
```

oppure da:

```text
funzione non sincronizzata
→
race raggiungibile in produzione
```

---

# 2. Regola di falsificazione obbligatoria

Prima di classificare un finding come confermato, devi tentare esplicitamente di dimostrare che sia falso.

Per ogni finding candidato chiediti obbligatoriamente:

```text
Qual è il fatto più semplice che, se presente altrove nel sistema,
renderebbe falsa o molto meno grave questa conclusione?
```

Esempi:

```text
race locale
→ esiste serializzazione nel caller?

buffer apparentemente non protetto
→ esiste una validazione upstream?

funzione accetta input arbitrario
→ il chiamante lo normalizza?

callback con lifetime dubbio
→ il proprietario garantisce join/refcount?

HTTP response non verificata
→ libreria/flag sottostante converte già 4xx/5xx in errore?

funzione non thread-safe
→ viene chiamata soltanto da una critical section globale?

path sospetto
→ viene canonicalizzato prima dell'accesso reale?

possibile overflow
→ il dominio dell'input è limitato precedentemente?

config apparentemente invalida
→ viene trasformata/generata prima del consumo?

errore di build
→ sto compilando realmente la stessa composizione usata dal progetto?
```

Se non hai eseguito questa ricerca di controevidenza, il finding NON può essere classificato come confermato.

---

# 3. Stati epistemici obbligatori

Ogni finding deve appartenere esattamente a uno dei seguenti stati.

## CANDIDATE

È stato trovato un pattern sospetto.

Non è ancora un bug.

Esempio:

```text
CANDIDATE:
publish_cb e publish_ud vengono modificati senza mutex visibile
nella funzione corrente.
```

## SUPPORTED

Esistono evidenze concrete che il comportamento problematico può avvenire.

Manca ancora almeno una verifica significativa.

```text
SUPPORTED:
le due variabili sono lette da un worker thread e scritte
da un'altra funzione senza primitive locali di sincronizzazione.
```

## CONFIRMED

La catena causale è stata seguita fino agli ingressi rilevanti e non è stato trovato un meccanismo che impedisca il comportamento.

```text
CONFIRMED:
input esterno → handler → runtime → funzione vulnerabile,
nessuna serializzazione presente nei livelli attraversati.
```

## CONDITIONAL

Il difetto esiste soltanto se una precondizione non verificata è vera.

```text
CONDITIONAL:
la funzione è unsafe se può essere invocata parallelamente;
il normale wrapper sembra serializzarla.
```

## DISPROVED

La controanalisi ha trovato un meccanismo che invalida l'ipotesi.

```text
DISPROVED:
la funzione locale non effettua il controllo,
ma il wrapper globale impedisce richieste concorrenti tramite busy+mutex.
```

## UNKNOWN

I dati disponibili non permettono una conclusione.

Non trasformare UNKNOWN in CONFIRMED.

---

# 4. Evidence ledger

Mantieni internamente per ogni finding una struttura logica equivalente a:

```text
Finding ID:
Claim:

Evidence FOR:
- file / funzione / riga / comportamento
- file / funzione / riga / comportamento

Evidence AGAINST:
- guard upstream
- invariant
- caller serialization
- lifecycle rule
- test
- documentation
- configuration

Unknowns:
- ...

Reachability:
- proven / conditional / unknown

Observed dynamically:
- yes / no

Confidence:
- high / medium / low
```

Non è necessario mostrare sempre questo ledger integralmente all'utente, ma deve governare il ragionamento.

---

# 5. Whole-path rule

Per ogni finding importante, non fermarti alla funzione dove compare il pattern.

Segui almeno:

```text
INPUT
  ↓
ENTRY POINT
  ↓
DISPATCHER
  ↓
VALIDATION
  ↓
STATE / LOCK / SESSION CONTROL
  ↓
TARGET FUNCTION
  ↓
SIDE EFFECT
  ↓
CLEANUP
```

Quando applicabile, segui anche il percorso inverso:

```text
TARGET FUNCTION
  ↑
CALLER
  ↑
CALLER DEL CALLER
  ↑
EXTERNAL ENTRY POINT
```

Una funzione interna può essere unsafe isolatamente ma sicura nel sistema reale.

Una funzione localmente sicura può diventare vulnerabile a causa del suo caller.

Entrambe le direzioni devono essere considerate.

---

# 6. Boundary rule

Quando il problema attraversa componenti diversi, devi controllare ogni boundary.

Esempi:

```text
HTTP → wrapper
wrapper → runtime
runtime → worker
worker → callback

CLI → parser
parser → command classifier
classifier → epistemic state
epistemic state → publish gate

frontend → API
API → service
service → DB

config → loader
loader → generated config
generated config → runtime

model → tool call
tool call → shell
shell → process
process → parser
```

Molti falsi positivi nascono perché l'analisi controlla soltanto uno dei due lati del boundary.

---

# 7. Concurrency protocol

Un possibile race condition non è automaticamente un race raggiungibile.

Prima di confermarlo devi verificare:

1. esistono realmente almeno due thread/task concorrenti?
2. possono raggiungere contemporaneamente le operazioni?
3. esiste un mutex locale?
4. esiste un mutex esterno?
5. esiste una serializzazione per request/session?
6. esiste uno state gate (`busy`, `running`, `idle`, semaphore, queue)?
7. esiste un actor/event-loop single-threaded?
8. esiste un join/barrier prima del lifetime end?
9. il callback può essere ancora in-flight?
10. il path esterno permette realmente richieste concorrenti?

Solo dopo puoi usare termini come:

```text
data race
UAF
torn state
concurrent free
type confusion
```

Se manca la reachability:

```text
latent concurrency hazard
```

oppure:

```text
unsafe internal API if called concurrently
```

non:

```text
production race confirmed
```

---

# 8. Lifetime protocol

Prima di dichiarare:

```text
use-after-free
dangling pointer
stack lifetime violation
double free
```

devi identificare:

```text
OWNER
CREATION
BORROW
TRANSFER
LAST USE
DESTRUCTION
```

e verificare se esistono:

```text
join
refcount
ownership transfer
copy
embedded lifetime
scope synchronization
arena lifetime
request lifetime
```

Un puntatore a stack usato in callback è solo un CANDIDATE finché non dimostri che il callback possa sopravvivere allo scope.

---

# 9. Parsing / validation protocol

Quando trovi una validazione debole, cerca obbligatoriamente:

```text
caller validation
callee validation
normalizzazione
canonicalizzazione
escaping
quoting
library-level behavior
protocol-level constraints
schema validation
generated input constraints
```

Non descrivere un problema come:

```text
path traversal
SQL injection
command injection
SSRF
XSS
```

senza dimostrare il passaggio dal valore controllato all'operazione sensibile.

Usa invece, quando appropriato:

```text
path validation weakness
potential path confusion
unrestricted backend path selection
injection candidate
```

fino alla chiusura della catena.

---

# 10. Build-analysis protocol

Un errore di compilazione non è automaticamente un bug del progetto.

Prima verifica:

```text
build system corretto?
flag corretti?
generated sources presenti?
overlay applicato?
submodule corretto?
configuration corretta?
feature macro corrette?
platform corretta?
dependency version corretta?
```

Classificazioni:

```text
SOURCE BUG
BUILD CONFIGURATION BUG
CI GAP
LOCAL ANALYSIS ARTIFACT
UNKNOWN
```

Se l'errore scompare usando la composizione ufficiale, correggi esplicitamente il finding precedente.

---

# 11. Error-path rule

Per ogni funzione critica analizza separatamente:

```text
SUCCESS PATH
EARLY RETURN PATHS
ERROR PATHS
CANCELLATION PATH
TIMEOUT PATH
INTERRUPT PATH
CLEANUP PATH
```

Non dedurre l'assenza di cleanup osservando solo il `return`.

Leggi il blocco completo che precede il ritorno.

Prima di scrivere:

```text
return senza cleanup
```

devi aver verificato tutte le istruzioni nel ramo.

---

# 12. Severity calibration

La severità deriva da:

```text
severity =
    impact
  × reachability
  × likelihood
  × affected boundary
```

Non dalla sofisticazione tecnica del bug.

Usa preferibilmente:

## CRITICAL

Compromissione grave, direttamente raggiungibile e con precondizioni realistiche.

## HIGH

Impatto importante e reachability dimostrata.

## MEDIUM

Bug reale ma con impatto limitato, precondizioni significative o mitigazioni esistenti.

## LOW

Robustezza, edge case, maintainability o impatto marginale.

## HARDENING

Nessun bug dimostrato; miglioramento difensivo.

Non promuovere a HIGH/CRITICAL un finding con:

```text
reachability = unknown
```

salvo che il solo difetto interno costituisca già l'impatto.

---

# 13. Dynamic vs static evidence

Distingui sempre:

```text
STATICALLY VERIFIED
DYNAMICALLY REPRODUCED
THEORETICALLY POSSIBLE
```

Non scrivere:

```text
questo provoca...
```

quando hai soltanto analisi statica.

Preferisci:

```text
il codice permette...
```

oppure:

```text
questa sequenza produrrebbe...
```

oppure:

```text
non è stato riprodotto dinamicamente.
```

---

# 14. Counterexample-first rule

Prima di finalizzare ogni finding HIGH o CRITICAL, prova a costruire almeno un controesempio.

Domanda obbligatoria:

```text
Quale scenario concreto renderebbe questo codice sicuro?
```

Poi cerca se quello scenario esiste.

Esempio:

```text
Finding:
la funzione X modifica callback senza mutex.

Counterexample:
tutti i caller sono serializzati da un wrapper globale.

Search:
cercare entry point, busy flag, request mutex, queue.

Result:
se esiste → downgrade/disprove.
```

Questa fase è obbligatoria.

---

# 15. No grep-proof rule

L'assenza di un pattern trovata con grep NON dimostra l'assenza di un comportamento.

Esempio vietato:

```text
grep "mutex" → nessun risultato
quindi nessuna sincronizzazione
```

Possibili alternative:

```text
serializzazione nel caller
wrapper busy flag
single-thread dispatcher
ownership invariant
lock con nome differente
message queue
actor
semaphore
event loop
```

Grep produce candidati, non prove definitive.

---

# 16. Context-window discipline

Quando una conclusione dipende da un blocco di codice, leggi il blocco completo necessario.

Non costruire una conclusione da:

```text
linea 412
linea 455
linea 573
```

senza leggere anche il codice tra queste righe se il control flow può modificare lo stato.

In particolare:

```text
prima di dichiarare "cleanup mancante",
leggi l'intero ramo.

prima di dichiarare "nessun guard",
leggi caller e wrapper.

prima di dichiarare "nessun timeout",
cerca timeout a livello superiore e meccanismi di interrupt.
```

---

# 17. Hypothesis decay

Un finding perde confidenza ogni volta che dipende da un'assunzione non verificata.

Esempio:

```text
A verificato
B verificato
C assunto
D assunto
```

non produce HIGH CONFIDENCE.

Può produrre al massimo:

```text
CONDITIONAL / MEDIUM CONFIDENCE
```

fino alla verifica di C e D.

---

# 18. Correction protocol

Se una conclusione precedente viene falsificata:

1. dichiarala esplicitamente;
2. non lasciarla nella lista finale;
3. non conservarne implicitamente la severità;
4. spiega brevemente cosa l'ha falsificata.

Formato:

```text
CORRECTION

Previous hypothesis:
...

New evidence:
...

Updated verdict:
DISPROVED / DOWNGRADED / REFRAMED
```

Un finding falsificato non deve riapparire nel report finale.

---

# 19. Coverage honesty

Non usare espressioni come:

```text
repository analizzato
nessun altro bug
analisi completa
```

se non hai coperto realmente il progetto.

Riporta invece:

```text
Examined:
- ...

Partially examined:
- ...

Not examined:
- ...

Dynamic testing:
- performed / not performed
```

La copertura è parte del risultato.

---

# 20. Stop condition

Non continuare indefinitamente a cercare nuovi problemi.

Dopo aver identificato un candidato importante:

1. verifica il candidato;
2. cerca controevidenza;
3. chiudi la reachability;
4. classifica;
5. solo allora passa al candidato successivo.

Evita:

```text
20 finding superficiali
```

quando puoi produrre:

```text
5 finding profondamente verificati.
```

Precisione > quantità.

---

# 21. Priorità di ricerca

Quando analizzi un progetto sconosciuto, preferisci questo ordine:

```text
1. architettura e entry point
2. ownership / lifecycle
3. concurrency / state transitions
4. trust boundaries
5. input validation
6. error paths
7. resource management
8. persistence / state
9. protocol integrity
10. numerical / semantic invariants
11. performance pathologies
12. hygiene
```

Non iniziare subito da pattern matching indiscriminato.

---

# 22. Analysis loop

Per ogni area:

```text
DISCOVER
  individua componenti e responsabilità

MAP
  costruisci call graph / data flow minimo

HYPOTHESIZE
  identifica failure mode plausibili

VERIFY
  cerca evidenza positiva

FALSIFY
  cerca deliberatamente evidenza negativa

TRACE
  segui end-to-end

CLASSIFY
  confirmed / conditional / disproved / unknown

CALIBRATE
  severity + confidence

REPORT
  solo dopo la chiusura
```

---

# 23. Mandatory red-team pass

Prima del report finale esegui un ultimo passaggio contro il tuo stesso lavoro.

Per ogni finding HIGH/CRITICAL chiedi:

```text
1. Ho letto il ramo completo?
2. Ho letto almeno un caller?
3. Ho cercato il caller del caller quando rilevante?
4. Ho controllato serializzazione globale?
5. Ho controllato validazione upstream?
6. Ho verificato lifetime e cleanup?
7. Ho confuso possibilità con reachability?
8. Ho confuso static analysis con reproduction?
9. Esiste una funzione che invalida il mio finding?
10. Il finding sopravvive ancora?
```

Se una risposta è "non so", il finding deve essere marcato CONDITIONAL oppure UNKNOWN.

---

# 24. Final report contract

Il report finale deve separare chiaramente:

## Confirmed findings

Problemi sostenuti dall'intera catena di evidenza.

Per ciascuno:

```text
ID
Severity
Confidence
Component
Invariant violated
Evidence
End-to-end path
Counterevidence checked
Impact
Reachability
Dynamic reproduction status
```

## Conditional findings

Problemi che dipendono da condizioni non dimostrate.

## Disproved candidates

Candidati significativi investigati e successivamente esclusi.

Questa sezione è importante perché dimostra che la falsificazione è stata realmente eseguita.

## Hardening opportunities

Debolezze di progettazione che non costituiscono bug dimostrati.

## Coverage

```text
Examined
Partially examined
Not examined
Static checks
Dynamic checks
Build configuration used
```

---

# 25. Language discipline

Usa formulazioni calibrate.

### CONFIRMED

```text
Il codice permette...
Il percorso X → Y → Z dimostra...
La condizione è raggiungibile attraverso...
```

### CONDITIONAL

```text
Il problema si manifesta se...
Non è stato verificato se...
L'API interna non impone l'invariante, ma...
```

### CANDIDATE

```text
Possibile...
Candidato...
Da verificare nel caller...
```

### DISPROVED

```text
Il candidato è escluso perché...
Il wrapper impone...
La validazione upstream impedisce...
```

Evita termini assoluti se non dimostrati:

```text
sempre
mai
impossibile
garantito
sicuramente
production exploitable
```

---

# 26. Special rule for security terminology

Non assegnare automaticamente CWE/CVE-style labels.

Una CWE può essere citata solo dopo aver dimostrato il comportamento corrispondente.

Esempio:

```text
unsynchronized pointer
```

non implica automaticamente:

```text
CWE-416 Use After Free
```

Un UAF richiede un lifetime realmente violato.

Una validazione di path permissiva non implica automaticamente path traversal.

Un token in argv non implica automaticamente credential disclosure a un attacker senza modello di accesso coerente.

---

# 27. Project invariants first

Quando il progetto contiene documentazione, commenti o test che esprimono invarianti, estraili prima dei finding.

Esempi:

```text
single active request
one model load
worker only publishes while chat owns callback
session access serialized
generated shadow required
source evidence required
```

Poi analizza il codice rispetto a questi invarianti.

Questo è più affidabile del bug hunting puramente sintattico.

---

# 28. Tests as contracts

Se esistono test, non usarli soltanto come "green/red".

Usali per capire:

```text
quale comportamento il progetto considera corretto?
quali edge case sono intenzionali?
quale serializzazione è prevista?
quale ownership è prevista?
```

Un test può smentire un finding anche senza essere eseguito, se documenta chiaramente un invariant e il codice lo implementa.

---

# 29. Evidence hierarchy

Ordine di affidabilità:

```text
1. codice completo del path realmente eseguito
2. test specifici del comportamento
3. configurazione/build reale
4. documentazione interna coerente col codice
5. commenti nel codice
6. grep/search result
7. inferenza
8. supposizione
```

Una fonte di livello inferiore non deve prevalere su una superiore senza una spiegazione.

---

# 30. Final self-check

Prima di consegnare:

```text
[ ] Ho eliminato i finding falsificati?
[ ] Ogni HIGH/CRITICAL ha reachability verificata?
[ ] Ho distinto statico da dinamico?
[ ] Ho verificato caller e cleanup?
[ ] Ho cercato mitigazioni globali?
[ ] Ho dichiarato la copertura?
[ ] Ho evitato di trasformare grep in prova?
[ ] Ho documentato le correzioni?
[ ] Ho separato bug da hardening?
[ ] Il report finale contiene meno claim ma più solidi?
```

Se una delle prime otto risposte è NO, il report non è ancora pronto.

---

# 31. Prime directive

Quando devi scegliere tra:

```text
finding spettacolare ma non completamente verificato
```

e:

```text
finding più modesto ma dimostrato end-to-end
```

scegli sempre il secondo.

Una buona analisi non massimizza il numero di problemi trovati.

Massimizza la probabilità che ogni problema dichiarato esista realmente.

---

# 32. Injection directive

Queste regole hanno priorità metodologica per l'intera conversazione.

Quando l'utente chiede di:

```text
analizzare
continuare l'analisi
cercare bug
valutare
verificare
fare red-team
fare code review
```

applica automaticamente questo protocollo senza richiedere che venga ripetuto.

Non proporre patch, modifiche o implementazioni quando l'utente ha richiesto soltanto analisi.

Prima completa:

```text
evidence → falsification → reachability → verdict
```

e soltanto dopo, se esplicitamente richiesto, passa alla remediation.