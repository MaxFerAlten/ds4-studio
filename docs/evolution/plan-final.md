# Piano finale DS4 Evolution — Level B

**Stato del piano:** automazione `Level B — Deterministic kernel` completata; `technical Level B PASS / release sign-off pending`
**Target:** rilascio tecnico `Level B — Deterministic kernel`
**Autorità normativa:** `clean-room-provenance.md`, `behavioral-specification.md`, `threat-model.md`, `acceptance-contract.md`
**Confine clean-room:** il checkout e il sorgente SIA non sono input di implementazione

## 1. Decisione di perimetro

Questo piano chiude il primo rilascio tecnico richiesto dal contratto. Non
introduce Critic o Proposer LLM, API/UI Evolution, scheduler, rete per i
candidati o promozione automatica. Queste capacità appartengono ai Level C–E e
richiedono piani, threat review e acceptance gate separati.

Il risultato finale deve rimanere:

- deterministico al confine di promozione;
- offline e senza dipendenza LLM;
- fail-closed per sicurezza, integrità e provenance;
- riproducibile con comandi stabili;
- versionabile senza includere artifact generati;
- non dichiarato “release approved” prima dei quattro sign-off umani.

## 2. Piano eseguibile

| ID | Attività | Evidenza richiesta | Stato |
|---|---|---|---|
| `FINAL-01` | Registrare questo piano e aggiornare il manifest clean-room | piano e manifest validati dallo scanner `CR-001..006` | `COMPLETE` |
| `FINAL-02` | Esporre alias npm stabili per unit, security e certificazione | script `test:evolution`, `test:evolution:security`, `certify:evolution` | `COMPLETE` |
| `FINAL-03` | Rieseguire unit, security e gate Level B | unit/security senza failure; gate `96/96` | `COMPLETE` |
| `FINAL-04` | Verificare non-regressione DS4 frontend/backend | suite frontend e backend con exit code `0` | `COMPLETE` |
| `FINAL-05` | Eseguire audit GitNexus e diff hygiene | rischio noto, nessun flusso inatteso, `diff --check` pulito | `COMPLETE` |
| `FINAL-06` | Creare un commit locale scoped | solo file Evolution, documenti normativi e alias; esclusi artifact e modifiche utente | `COMPLETE` |
| `FINAL-07` | Generare il bundle post-commit | otto JSON, decisione Level B `PASS`, source revision registrata | `COMPLETE` |
| `FINAL-08` | Raccogliere i quattro sign-off | firme vincolate a source revision e hash del bundle | `HUMAN_REQUIRED` |

## 3. Comandi stabili

Da `frontend/`:

```bash
npm run test:evolution
npm run test:evolution:security
npm run certify:evolution
```

La suite security e la certificazione devono essere eseguite su un host Linux
che consenta Bubblewrap/user namespace. Un sandbox dell'assistente che nega
processi, namespace o loopback può produrre `EPERM` infrastrutturali e non è un
ambiente di certificazione valido.

## 4. Strategia di versionamento

Il commit finale include esclusivamente:

- `frontend/server/evolution/`;
- `benchmarks/agentic/evolution/`;
- `docs/evolution/`;
- gli alias in `frontend/package.json`;
- la regola `.gitignore` per i bundle generati.

`artifacts/evolution-certification/` resta fuori dal commit: è evidenza
rigenerabile e deve essere conservata dal sistema di CI/release. Le modifiche
preesistenti a `AGENTS.md` e `CLAUDE.md` non appartengono a questo piano.

## 5. Gate tecnici

La chiusura automatizzata richiede congiuntamente:

1. tutti i moduli sintatticamente validi;
2. unit/integration Evolution verdi;
3. security suite reale Bubblewrap verde;
4. scanner clean-room verde;
5. gate Level B con `requiredTests = passed = 96` e zero skip;
6. suite DS4 esistenti senza regressioni;
7. audit GitNexus senza impatti inattesi;
8. bundle con gli otto artifact prescritti.

## 6. Sign-off non automatizzabili

| Ruolo | Stato iniziale | Oggetto della firma |
|---|---|---|
| Implementation reviewer | `PENDING` | source revision + bundle hash |
| Security reviewer | `PENDING` | source revision + security evidence |
| DS4 maintainer | `PENDING` | source revision + acceptance decision |
| Clean-room provenance reviewer | `PENDING` | source revision + provenance report |

L'agente implementatore non può sostituirsi a questi revisori né cambiare
`review_status` in approvato. Fino alle firme, l'esito corretto è
`technical Level B PASS / release sign-off pending`.

## 7. Criterio di uscita

Il piano è tecnicamente eseguito quando `FINAL-01..07` sono completati e il
bundle post-commit è riproducibile. `FINAL-08` è il solo gate esterno residuo e
non autorizza implicitamente Level C, D o E.

## 8. Registro di esecuzione pre-commit

| Verifica | Risultato |
|---|---|
| Alias unit/integration Evolution | exit `0`, 14 moduli test caricati |
| Security reale Bubblewrap | 12 pass, 0 fail, 0 skip |
| Acceptance gate Level B | 96 pass, 0 fail, 0 skip |
| Frontend DS4 | 19 pass, 0 fail |
| Backend DS4 | 1015 pass, 0 fail, 1 skip previsto |
| Provenance clean-room | `CR-001..006` pass |
| Whitespace e diff hygiene | nessuna anomalia |
| GitNexus staged aggregate | `CRITICAL` per ampiezza: 859 simboli, 41 flussi Evolution |
| GitNexus entrypoint pubblici | `LOW`; nessun consumatore DS4 preesistente |

Il risultato post-commit non viene incorporato nel sorgente per evitare una
dipendenza circolare tra modifica del piano e source revision certificata; è
registrato esclusivamente nel bundle finale.

L'etichetta aggregata `CRITICAL` non è stata ignorata: è stata scomposta con
impact analysis sugli entrypoint pubblici. I flussi rilevati appartengono al
nuovo namespace Evolution; nessun entrypoint è importato dall'applicazione
DS4, da API o da runtime preesistenti. L'ampiezza del nuovo sottosistema resta
comunque motivo di review manuale prima di qualsiasi futura integrazione.
