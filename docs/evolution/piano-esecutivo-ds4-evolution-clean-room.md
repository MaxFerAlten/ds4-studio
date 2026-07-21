# Piano esecutivo DS4 Evolution — clean room

**Stato:** incremento iniziale Level B
**Fonti normative:** `clean-room-provenance.md`, `behavioral-specification.md`, `threat-model.md`, `acceptance-contract.md`
**Codice SIA consultato dall'implementatore:** no
**Prompt o test SIA consultati/coperti:** no

## 1. Confine clean-room registrato

La nota esterna `analisi-chatgpt.md` è stata trattata come output della fase di
osservazione. Da essa sono stati trattenuti soltanto fatti comportamentali già
normalizzati nei quattro documenti normativi. Il checkout
`/mnt/crucial_ai/COPARATOR/sia` non è stato aperto né indicizzato.

Da questo punto l'implementazione usa esclusivamente:

- i quattro documenti normativi DS4;
- il repository DS4-Studio;
- le API pubbliche dei componenti DS4 riusati;
- test derivati dagli ID dell'acceptance contract.

## 2. Perimetro dell'incremento

Questo incremento implementa il **Level B — deterministic kernel**:

- contratto task rigorosamente validato;
- macchina a stati esplicita;
- ledger append-only verificabile e recuperabile;
- baseline immutabile e riproducibile;
- workspace candidato separato con policy sui path;
- executor con sandbox OS fail-closed, rete disabilitata e budget;
- evaluator deterministici;
- candidate builder per patch manuali;
- promotion gate puro e deterministico;
- applicazione atomica e rollback;
- orchestratore senza dipendenza LLM;
- telemetry derivata dal ledger;
- harness offline e bundle di certificazione.

Non rientrano in questo incremento:

- Critic LLM (Level C);
- Proposer LLM (Level D);
- promozione automatica in produzione (Level E);
- API/UI Evolution;
- modifiche a runtime C, kernel, build system o moduli di sicurezza esistenti.

## 3. Gap analysis e riuso DS4

| Meccanismo DS4 | Decisione | Motivazione |
|---|---|---|
| `ToolBlobStore` | riuso diretto | output content-addressed e lettura bounded già conformi |
| `contextJsonl` | non riusato per stato canonico | il cap elimina eventi storici e viola il ledger append-only |
| `ResearchStateStore` | pattern osservato, nessun riuso | non verifica sequence/hash e non ricostruisce lo stato dal ledger |
| `Ds4ProcessManager` | non riusato | eredita l'intero ambiente e non applica sandbox/rete/risorse/output cap |
| `agentTools.resolveToolPath` | non riusato direttamente | è privato e protegge singole tool call, non l'intero processo candidato |
| GitNexus | preflight tramite adapter obbligatorio per simboli | mantiene la policy DS4 senza accoppiare il kernel a un trasporto MCP |

Impact analysis pre-implementazione: `ToolBlobStore` avrebbe rischio MEDIUM se
modificato (10 consumatori diretti, 0 processi indicizzati); questo piano lo
importa senza modificarlo. I nuovi simboli Evolution non hanno chiamanti
preesistenti. L'integrazione HTTP viene rinviata per mantenere il blast radius
iniziale LOW.

## 4. Matrice requisito → file → simbolo → test → rischio

| Requirement | File / simboli | Test obbligatori | Rischio e controllo |
|---|---|---|---|
| `BEH-CONTRACT-001..005`, `SEC-SCHEMA-001..002` | `evolutionContracts.mjs`: `validateEvolutionTask`, `validateProposal`, `validateProvenanceRecord` | contratti validi, versione, path overlap, evaluator/metriche, campi ignoti e limiti | configurazione ambigua; fail closed |
| `BEH-STATE-001..004` | `evolutionStateMachine.mjs`: `assertTransition`, `nextRunState` | ogni arco valido, archi invalidi, terminali, un solo evento | riapertura terminale; tabella immutable |
| `BEH-LEDGER-001`, `SEC-LEDGER-001..005`, `BEH-BASE-001..002`, `SEC-BASE-002` | `evolutionRunStore.mjs`: `EvolutionRunStore` | sequence, duplicati, tail parziale, hash, restart, baseline mutation | perdita/corruzione; fsync, hash e recovery |
| `SEC-PATH-001..005`, `SEC-ISOLATION-001..003`, `SEC-BASE-001` | `evolutionWorkspace.mjs`: `EvolutionWorkspaceManager`, `assertInside`, `auditWorkspace` | traversal, assoluti, symlink, immutable, workspace separati | escape; realpath/lstat e namespace OS |
| `BEH-EXEC-001..004`, `SEC-DOS-001..006`, `SEC-SECRET-001..004`, `SEC-NET-001` | `evolutionExecutor.mjs`: `EvolutionExecutor`, `buildSandboxCommand` | successo, failure, timeout, cancel, output, env, rete, cleanup | processo ostile; bubblewrap + prlimit, fail closed |
| `BEH-EVAL-001..004`, `SEC-EVAL-001..004` | `evolutionEvaluator.mjs`: `EvolutionEvaluatorRegistry` | aggregazione, direction, errori required, reproducibility, risultato fake ignorato | scorer manipolato; adapter server-side e hash |
| `BEH-GATE-001..007`, `SEC-AUTH-001..002`, `SEC-RISK-001..003`, `SEC-SIMPLIFY-001..002` | `evolutionPromotionGate.mjs`: `decidePromotion`, `classifyRisk` | hard gate, regressioni, budget, rollback, neutral, determinismo, high risk | falsa promozione; funzione pura |
| `BEH-PROMOTE-001..002`, `SEC-ROLLBACK-001..003`, `SEC-TOCTOU-001..002`, `SEC-APPROVAL-001..002` | `evolutionPromotion.mjs`: `EvolutionPromotionService` | hash candidate/parent, apply atomico, smoke/revert, rollback | TOCTOU; hash recheck e staging copy |
| scope/diff, `SEC-SUPPLY-001..004`, GitNexus preflight | `evolutionCandidateBuilder.mjs`: `EvolutionCandidateBuilder` | patch fuori scope, budget, dependency, impact HIGH, patch valida | patch malevola; parser + `git apply --check` argv-only |
| ciclo Level B e recovery | `evolutionOrchestrator.mjs`: `EvolutionOrchestrator` | baseline → candidate → evaluation → gate; reject/retry; restart | stato implicito; solo transizioni persistite |
| observability | `evolutionTelemetry.mjs`: `summarizeEvolutionRun` | conteggi, durate, no raw output/segreti | leakage; solo campi strutturati |
| `CR-001..006` | `provenance-manifest.json`, headers, scanner benchmark | dependency/import/header/manifest/attestazioni | contaminazione; scan automatico |

Ogni modulo di produzione ha un file `.test.mjs` corrispondente. I test di
isolamento avversariale risiedono anche in `evolution/security/`.

## 5. Ordine delle patch

1. Contratti e state machine.
2. Ledger, artifact persistence e baseline.
3. Workspace e candidate builder.
4. Executor sandboxed.
5. Evaluator e promotion gate.
6. Promotion/rollback.
7. Orchestratore e telemetry.
8. Harness offline, scanner clean-room e certificazione.

Ogni passaggio deve essere testato prima di procedere al successivo.

## 6. Comandi di verifica stabili

```bash
node --test frontend/server/evolution/*.test.mjs
node --test frontend/server/evolution/security/*.test.mjs
node benchmarks/agentic/evolution/run.mjs --selftest --gate
```

I test live e l'autopromotion Level E restano intenzionalmente indisponibili
finché Level B non produce un bundle di certificazione senza hard failure.

## 7. Rollback dell'incremento

Tutto il codice runtime dell'incremento è confinato in
`frontend/server/evolution/` e `benchmarks/agentic/evolution/`; non modifica
entrypoint o runtime esistenti. Il rollback sorgente consiste quindi nella
rimozione dei soli file nuovi. Gli artifact di certificazione non sono sorgente
e possono essere rigenerati.
