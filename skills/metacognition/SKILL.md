---
name: metacognition
description: Decision-making under uncertainty — ambiguity resolution, loop detection, search fallback, GitNexus enforcement, and documentation claim verification against source code. Trigger when the agent is stuck in repetitive reasoning, uncertain about user intent, getting empty search results for expected patterns, skipping GitNexus in favor of manual grep, or reading documentation that references code symbols without verifying them. Also use when the user types /metacognition or asks about improving agent behavior.
---

# Metacognition Skill

## 1. Ambiguità: Chiedere Sempre, Mai Speculare

```
SE dopo 3 token di ragionamento interno SU UN DUBBIO AMBIENTALE
  (es. "path e doc/ o src/?", "l'utente intende X o Y?",
   "devo usare tool A o B?")
ALLORA:
  1. Fermati.
  2. Prepara UNA domanda all'utente (max 15 parole).
  3. Usa `question` con 2-3 opzioni chiare.
  4. NON procedere fino a risposta.
```

**Trigger specifici:**
- Il path non corrisponde al contenuto atteso (es. `.../doc/` ha solo .md ma si parla di "codebase")
- Due tool sembrano ugualmente validi per lo stesso compito
- Output di un tool e ambiguo o inaspettato
- Comando utente interpretabile in 2+ modi

## 2. Rilevamento Stallo

```
DOPO ogni 5 tool call consecutivi dello STESSO TIPO:
  SE i risultati sono FUNZIONALMENTE SIMILI:
    - Fermati. Sei in un loop.
    - Cambia strategia: se facevi grep -> passa a GitNexus.
      Se facevi read -> passa a search o gitnexus_query.
      Se facevi search -> passa a bash grep.
    - Se dopo 2 cambi strategia il loop NON si rompe:
      CHIEDI all'utente: "Non sto facendo progressi su <X>.
        Come vuoi procedere?"
```

## 3. Meta-Reflection Pattern

```
Prima di un ragionamento interno che supera 5 righe:
  SE contiene frasi come:
    - "the user said... but..."
    - "Perhaps the user means..."
    - "I think the user wants..."
    - "Given the ambiguity..."
    - "maybe... or maybe..."
  ALLORA:
    - Il dubbio NON e risolvibile internamente.
    - Usa SUBITO `question`. NON continuare a ragionare.
```

## 4. Search Vuoto: Fallback Obbligatorio

```
PRIMA di usare `search`:
  - Pattern semplici (nome funzione): OK usa `search`
  - Pattern con OR (|) o regex complesse: usa `bash grep` DIRETTAMENTE

DOPO ogni `search`:
  SE risultato = vuoto / "No matches" / "<system>":
    1. RIPROVA con bash + `grep -rn "pattern" --include="*.{c,h,mjs}"`
    2. Se grep trova -> search ha fallito. LOGGA il falso negativo.
    3. Se anche grep e vuoto -> il pattern non esiste.
```

## 5. GitNexus Obbligatorio

```
PRIMA di grep/search su codice del progetto:
  1. gitnexus_query("concetto") o gitnexus_context("simbolo")
  2. Se GitNexus da risultati: usali come base. grep solo per dettagli.
  3. Se GitNexus e vuoto: allora grep e ammesso. LOGGA l'assenza.

MAI:
  - Saltare GitNexus dicendo "non stiamo modificando codice"
  - Usare grep su ds4_*.c senza prima provare GitNexus
  - Ignorare un indice stale senza ri-analizzare
```

## 6. Verifica Documentale contro Codice Reale

```
Quando un documento .md menziona codice (nome funzione, file:linea, bug, fix, sintomo):
  SE non hai GIA letto il codice corrispondente in questa sessione:
    1. Identifica TUTTI i simboli menzionati.
    2. Per ogni simbolo: usa gitnexus_context() o gitnexus_query().
    3. Per riferimenti file:linea: usa grep o read per verificare.
    4. Se la verifica fallisce (il codice non corrisponde):
       - LOGGA come "bug di documentazione" nel tuo report.
       - NON riportare l'affermazione come vera.
    5. Se la verifica conferma: riporta con "verificato su <file>:<linea>".

MAI:
  - Copiare un bug da un report .md senza verificarlo sul codice reale.
  - Assumere che un fix documentato sia stato effettivamente applicato.
  - Usare un report .md come unica fonte di verita — e documentazione, non codice.

Trigger: stai leggendo file in doc/ e trovi riferimenti a:
  - "ds4_agent.c:6027", "index.mjs:1904"
  - "checkAssistantText()", "agent_tool_write"
  - "fix applicato in ...", "bug in ..."
```

## 7. Compatibilita con ds4 Agent

Questa skill e pensata per l'agente Claude (opencode), ma il suo contenuto
e utilizzabile anche con l'agente ds4 nativo via CLI:

```bash
# Iniettare le direttive metacognition nel ds4-agent:
./ds4-agent -sys "$(cat skills/metacognition/SKILL.md)"

# Oppure via wrapper:
./ds4-wrapper --agent-system-prompt "$(cat skills/metacognition/SKILL.md)"
```

Nota: il ds4-agent non ha un meccanismo di skill loading nativo.
L'iniezione via `-sys` e l'unico modo per passargli queste istruzioni.

## 8. Riferimenti

- AGENTS.md: sezione metacognition (direttive sempre attive per Claude)
