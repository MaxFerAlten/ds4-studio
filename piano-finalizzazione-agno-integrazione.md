# Piano di finalizzazione dell’integrazione Agno in DS4-Studio

> Documento esecutivo, aggiornato sul codice presente il 28 luglio 2026.
>
> Questo piano è un delta operativo rispetto a
> `docs/agnos/piano-super-dettagliato-finalizzazione-integrazione-agno.md`:
> considera già realizzate le fondamenta Node delle fasi 1–11 e descrive
> con precisione ciò che manca per rendere l’integrazione realmente
> utilizzabile, verificabile e coerente con il modello DS4 sottostante.
>
> Vincolo principale: l’integrazione è esclusivamente testuale. Non deve
> essere introdotto OCR e non deve essere dichiarato supporto a immagini,
> audio, video o documenti.

---

# 0. Come usare questo documento

Il piano va eseguito in ordine. Ogni fase contiene:

- stato iniziale osservato;
- file e simboli da modificare;
- nuove classi o funzioni da creare;
- contratto da mantenere;
- test obbligatori;
- gate d’uscita;
- rollback locale.

Le etichette usate nell’inventario hanno questo significato:

| Stato | Significato |
|---|---|
| `COMPLETO` | codice presente, montato e coperto da test mirati |
| `PARZIALE` | struttura presente, ma contratto incompleto o non end-to-end |
| `MANCANTE` | componente necessario non presente |
| `DA VERIFICARE LIVE` | codice presente, ma serve uno smoke con processi reali |

Prima di modificare un simbolo:

1. eseguire `gitnexus_impact` sul simbolo in direzione `upstream`;
2. leggere i chiamanti diretti;
3. avvisare prima di procedere se il rischio è `HIGH` o `CRITICAL`;
4. applicare la modifica;
5. eseguire i test della fase;
6. eseguire `gitnexus_detect_changes()` prima di qualsiasi commit.

Il worktree corrente è già sporco e contiene lavoro Agno in corso. Non
usare `git reset`, non ripristinare file e non sovrascrivere modifiche
preesistenti. Il piano deve essere applicato per piccoli diff verificabili.

Prima di modificare `srun.sh`, leggere nuovamente `AGENTS_BUILD.md`. Non
sono previste modifiche a `Makefile`, ai target GPU o ai flag ROCm.

---

# 1. Decisione architetturale irrevocabile: input solo testuale

## 1.1 Cosa non deve essere implementato

Sono fuori scopo:

- OCR locale o remoto;
- estrazione testo da screenshot;
- modelli vision;
- `mmproj`;
- encoder immagini;
- invio di `image_url` al modello DS4;
- trascrizione audio;
- comprensione video;
- parsing automatico di PDF o documenti caricati in chat;
- un secondo modello dedicato a immagini o OCR;
- fallback verso OpenAI, Gemini, Ollama, LM Studio o altri provider;
- conversione silenziosa di allegati in testo;
- modifiche a `ds4_server.c`, `ds4.c`, `ds4_rocm.cu` o ai kernel GPU per
  introdurre capacità multimodali.

Lo screenshot che ha motivato questa revisione non deve quindi essere
“risolto” aggiungendo OCR. L’interfaccia deve spiegare che la modalità Agno
accetta testo e tool, ma non immagini.

## 1.2 Perché il solo flag UI non è sufficiente

Agno 2.8.0 espone nativamente un parametro:

```python
files: Optional[List[UploadFile]]
```

sulla route:

```text
POST /agents/{agent_id}/runs
```

Inoltre `Agent` ha i default:

```python
send_media_to_model=True
store_media=True
```

Nascondere un pulsante nel frontend non basta. La finalizzazione deve
imporre il vincolo in più livelli:

```text
UI DS4 / Agent UI
    ↓ dichiara text-only
route DS4 custom
    ↓ rifiuta campi media
Agent Agno
    ↓ send_media_to_model=False
    ↓ store_media=False
gateway modello Node
    ↓ rifiuta content part non testuali
ds4-server
    ↓ riceve solo contenuto testuale
```

## 1.3 Contratto pubblico della capacità

`GET /api/agno/status` e `GET /ds4/health` devono esporre:

```json
{
  "capabilities": {
    "text": true,
    "tools": true,
    "images": false,
    "ocr": false,
    "audio": false,
    "video": false,
    "files": false
  }
}
```

`tools` è `true` solo quando il sidecar ha realmente caricato almeno un
tool e il digest del catalogo coincide con quello Node. Non deve derivare
soltanto da `config.agno.tools.enabled`.

## 1.4 Codice Agno obbligatorio

In `agno_service/src/ds4_agno/agents.py`,
`build_default_agent()` deve impostare esplicitamente:

```python
send_media_to_model=False,
store_media=False,
```

Questi parametri non devono essere affidati ai default della libreria.

## 1.5 Comportamento degli endpoint

La route custom:

```text
POST /ds4/runs
```

accetta soltanto JSON con `message` stringa. Se sono presenti campi come:

```text
files
images
image
attachments
audio
video
documents
```

deve rispondere:

```http
HTTP/1.1 415 Unsupported Media Type
Content-Type: application/json

{
  "error": "AGNO_TEXT_ONLY",
  "message": "DS4 Agno accepts text input only; OCR and media input are not supported."
}
```

Se `message` è assente, non è una stringa o è vuoto dopo `strip()`, deve
rispondere `422 INVALID_RUN_MESSAGE`.

La route AgentOS nativa deve essere protetta da un guard dedicato descritto
nella fase 7. Non è accettabile caricare un file, ignorarlo silenziosamente
e produrre una risposta come se il modello lo avesse visto.

## 1.6 Stato della Agent UI fissata

La Agent UI al commit:

```text
6dad9593fca6756e1813e4f4b3b2620be6377691
```

usa attualmente un `ChatInput.tsx` testuale e invia una stringa. Non va
aggiunto un controllo allegati. Va aggiunta solo un’indicazione visibile
“Solo testo — immagini/OCR non supportati” se si decide di mantenere una
patch DS4 della UI; in assenza di patch, la stessa indicazione deve
comparire nel pannello DS4 prima dell’apertura della Agent UI.

---

# 2. Verdetto sullo stato corrente

L’integrazione non è ancora completa. Il percorso del modello funziona, il
bridge Node esiste, ma l’agente Python non registra i tool.

## 2.1 Matrice corrente

| Area | Stato | Evidenza |
|---|---|---|
| Sidecar FastAPI/AgentOS | `COMPLETO` | `agno_service/src/ds4_agno/app.py` costruisce `AgentOS` |
| Modello Agno → gateway DS4 | `COMPLETO` | `create_ds4_model()` usa `/api/agno-model/v1` |
| Unico modello DS4 | `PARZIALE` | gateway e gate presenti; manca smoke live finale |
| Guard conflitto agente nativo | `COMPLETO` | `AgnoExecutionGuard` usato da gateway e tool service |
| Gate modello single-flight | `COMPLETO` | `AgnoModelGate` con massimo 1 |
| Terzo token tool bridge | `COMPLETO` lato Node | `ensureAgnoTokens()` crea `tool-bridge.token` |
| Token tool bridge nel sidecar | `MANCANTE` | `createAgnoProcessManager().buildEnv()` non lo passa |
| Route bridge Node | `COMPLETO` | `/api/internal/agno-tools/{catalog,execute,cancel,status}` |
| Policy tool | `COMPLETO` | `AgnoToolPolicy` con profili `safe` e `full` |
| Gate tool | `COMPLETO` | `AgnoToolGate` |
| Sessioni tool | `PARZIALE` | registry presente; manca sweep periodico verificato |
| Audit tool | `COMPLETO` | JSONL con digest argomenti |
| Execution service | `COMPLETO` lato Node | delega a `executeTool()` |
| Client Python tool bridge | `MANCANTE` | nessun `tool_client.py` |
| Factory `Function` Agno | `MANCANTE` | nessun `tool_factory.py` |
| Tool registrati nell’agente | `MANCANTE` | `build_default_agent()` non riceve `tools` |
| Parità tool end-to-end | `MANCANTE` | lo status misura solo la policy Node |
| Catalogo pubblico | `PARZIALE` | `/api/agno/catalog` è statico |
| Eventi tool nel pannello | `MANCANTE` | enum presente, `_execute_run()` non li mappa |
| Correlazione tool call/result UI | `MANCANTE` | store appende eventi separati |
| Agent UI supervisionata | `PARZIALE` | process manager e launcher presenti; bootstrap da irrigidire |
| Input text-only | `PARZIALE` | pannello DS4 è testuale; Agent mantiene default media `True` |
| Test Node Agno | `COMPLETO` per componenti presenti | suite mirate esistenti |
| Test Python | `PARZIALE` | suite esistente; mancano test bridge/factory/eventi e va eliminato l’hang |
| Smoke reale | `MANCANTE` | nessuna certificazione completa tool → modello |

## 2.2 Difetto funzionale principale

Oggi il percorso reale è:

```text
Agno Agent
    ↓
OpenAILike
    ↓
gateway modello DS4
    ↓
risposta testuale
```

Il percorso desiderato è:

```text
Agno Agent
    ↓ tool call generata dal modello
Agno Function
    ↓
Ds4ToolBridgeClient
    ↓
/api/internal/agno-tools/execute
    ↓
AgnoToolExecutionService
    ↓
executeTool()
    ↓
risultato al modello
    ↓
risposta finale
```

Il secondo percorso non esiste ancora sul lato Python.

## 2.3 Difetto di osservabilità

`frontend/server/agno/agnoRoutes.mjs` calcola attualmente:

```javascript
parity: catalogCount === expectedFullCount
```

dove `catalogCount` viene da `AgnoToolPolicy.allowedToolNames()`. Questo
dimostra soltanto che Node conosce i nomi. Non dimostra che:

- il sidecar abbia scaricato il catalogo;
- le `Function` siano state create;
- l’agente le abbia registrate;
- il digest coincida;
- il bridge sia autenticato e raggiungibile.

Lo status finale deve distinguere configurazione, disponibilità del bridge
e registrazione reale nell’agente.

## 2.4 Duplicazione da rimuovere

`build_default_agent()` è definita sia in:

- `agno_service/src/ds4_agno/agents.py`;
- `agno_service/src/ds4_agno/model.py`.

La sola definizione autorevole deve restare in `agents.py`.

## 2.5 Debito bootstrap

`scripts/agno_agent_ui_bootstrap.sh`:

- è oggi un eseguibile standalone;
- esegue `pnpm install --no-frozen-lockfile --ignore-scripts`;
- ricostruisce anche quando il marker potrebbe consentire un fast path;
- viene chiamato indirettamente da `srun.sh` tramite funzioni presenti in
  `agno_bootstrap.sh`, rendendo poco chiara l’autorità.

La finalizzazione deve rendere il bootstrap riproducibile e idempotente,
senza modificare il checkout runtime se è sporco.

---

# 3. Architettura finale

## 3.1 Processi

```text
Browser
  ├─ DS4-Studio React                   127.0.0.1:5173
  └─ Agno Agent UI                     127.0.0.1:3000

DS4-Studio Node                         127.0.0.1:5173
  ├─ API pubblica /api/agno/*
  ├─ gateway modello /api/agno-model/v1/*
  ├─ bridge tool /api/internal/agno-tools/*
  ├─ AgnoModelGate
  ├─ AgnoToolGate
  ├─ AgnoExecutionGuard
  └─ autorità executeTool()

Agno AgentOS Python                     127.0.0.1:7777
  ├─ Agent ds4-assistant
  ├─ route AgentOS native
  ├─ route DS4 /ds4/*
  ├─ OpenAILike verso Node
  └─ Ds4ToolBridgeClient verso Node

ds4-server                              porta configurata
  └─ unico modello già caricato
```

## 3.2 Percorso modello

```text
Agent.arun()
  → OpenAILike
  → POST /api/agno-model/v1/chat/completions
  → autenticazione model-gateway.token
  → validazione text-only
  → AgnoExecutionGuard
  → AgnoModelGate
  → ds4-server /v1/chat/completions
```

## 3.3 Percorso tool

```text
Agno Function.entrypoint(run_context, **arguments)
  → build_bridge_context(run_context)
  → Ds4ToolBridgeClient.execute()
  → Bearer tool-bridge.token
  → POST /api/internal/agno-tools/execute
  → AgnoToolAuthenticator
  → AgnoToolPolicy
  → validateToolArguments()
  → AgnoExecutionGuard
  → AgnoToolSessionRegistry
  → AgnoToolGate
  → AgnoToolExecutionService
  → executeTool()
  → compressToolResultForModel()
  → sanitizeToolRaw()
  → ToolBridgeResult
  → stringa tool result ad Agno
```

## 3.4 Autorità uniche

| Oggetto | Autorità |
|---|---|
| Elenco e schema dei tool | `frontend/server/agentToolCatalog.mjs` |
| Validazione argomenti | `frontend/server/agentToolSchema.mjs` |
| Esecuzione tool | `frontend/server/agentTools.mjs::executeTool` |
| Policy Agno | `frontend/server/agno/agnoToolPolicy.mjs` |
| Concorrenza modello | `AgnoModelGate` |
| Concorrenza tool | `AgnoToolGate` |
| Agente Agno | `agno_service/src/ds4_agno/agents.py` |
| Modello Agno | `agno_service/src/ds4_agno/model.py` |
| Stato run custom | `RunRegistry` |
| Persistenza Agno | `SqliteDb` |

Python non deve contenere una copia manuale dei sedici schemi tool. Li
riceve dal catalogo Node al bootstrap e li trasforma in `Function`.

## 3.5 Token e confini di fiducia

Devono esistere tre token distinti:

| Token | Produttore | Consumatore | Uso |
|---|---|---|---|
| `service.token` | Node | sidecar/`AgnoClient` | route `/ds4/*` |
| `model-gateway.token` | Node | `OpenAILike` Python | gateway modello |
| `tool-bridge.token` | Node | `Ds4ToolBridgeClient` Python | bridge tool |

Il terzo token:

- entra soltanto nell’environment del sidecar;
- non entra nell’environment della Agent UI;
- non viene restituito da status, health o catalog;
- non viene scritto nei log;
- non viene inserito in `.env.example`;
- non viene messo in query string;
- non viene incluso nelle eccezioni;
- non viene passato a `NEXT_PUBLIC_*`.

---

# 4. Contratti end-to-end da congelare

## 4.1 Catalogo bridge

Richiesta:

```http
GET /api/internal/agno-tools/catalog
Authorization: Bearer <tool-bridge-token>
Accept: application/json
```

Risposta:

```json
{
  "protocolVersion": 1,
  "profile": "full",
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read",
        "description": "...",
        "parameters": {
          "type": "object",
          "properties": {}
        }
      }
    }
  ],
  "catalogDigest": "sha256:<hex>"
}
```

Invarianti:

- `protocolVersion === 1`;
- `profile` coincide con la configurazione Python;
- `tools` è una lista non vuota quando `tools_enabled=true`;
- nomi unici;
- ogni elemento ha `type === "function"`;
- `function.name`, `description` e `parameters` sono validi;
- il digest è presente e viene verificato;
- con profilo `full`, i nomi sono esattamente i sedici canonici;
- con profilo `safe`, il sottoinsieme è quello definito dalla policy Node.

## 4.2 Execute bridge

Richiesta:

```json
{
  "protocolVersion": 1,
  "callId": "agno-<uuid>",
  "toolName": "read",
  "arguments": {
    "path": "README.md"
  },
  "context": {
    "runId": "<agno-run-id>",
    "sessionId": "<agno-session-id>",
    "userId": null,
    "history": [
      {
        "role": "user",
        "content": "Leggi README.md"
      }
    ]
  }
}
```

Risposta:

```json
{
  "ok": true,
  "toolName": "read",
  "content": "...",
  "isError": false,
  "guarded": false,
  "compressed": false,
  "code": null,
  "raw": null,
  "durationMs": 12.4
}
```

## 4.3 Errori bridge

| Codice | HTTP | Significato |
|---|---:|---|
| `MISSING_TOOL_BRIDGE_TOKEN` | 401 | header assente |
| `INVALID_TOOL_BRIDGE_TOKEN` | 403 | token errato |
| `AGNO_TOOLS_DISABLED` | 503 | bridge disabilitato |
| `TOOL_NOT_ALLOWED` | 403 | policy nega il tool |
| `UNKNOWN_TOOL` | 404 | nome non canonico |
| `INVALID_TOOL_ARGUMENTS` | 422 | schema non valido |
| `INVALID_TOOL_CONTEXT` | 422 | run/session ID non validi |
| `NATIVE_AGENT_ACTIVE` | 409 | conflitto col runtime nativo |
| `WRAPPER_STATUS_UNAVAILABLE` | 503 | impossibile verificare il wrapper |
| `AGNO_TOOL_QUEUE_FULL` | 429 | coda piena |
| `AGNO_TOOL_WAIT_TIMEOUT` | 504 | attesa gate scaduta |
| `AGNO_TOOL_CANCELLED` | 408 | chiamata cancellata |
| `TOOL_EXECUTION_FAILED` | 502 | errore executor non strutturato |

Il client Python deve preservare `code` e `status_code`, senza interpolare
token o header nel messaggio.

## 4.4 Cancel bridge

```json
{
  "protocolVersion": 1,
  "runId": "<run-id>",
  "sessionId": "<session-id>"
}
```

La cancellazione è idempotente. Una coppia sconosciuta restituisce
comunque:

```json
{"ok": true}
```

## 4.5 Status finale

`GET /api/agno/status` deve usare una struttura simile:

```json
{
  "enabled": true,
  "process": {
    "running": true,
    "healthy": true
  },
  "model": {
    "id": "...",
    "nativeAgentActive": false
  },
  "tools": {
    "configured": true,
    "bridgeEnabled": true,
    "profile": "full",
    "nodeCatalogCount": 16,
    "agentToolCount": 16,
    "expectedFullCount": 16,
    "nodeCatalogDigest": "sha256:...",
    "agentCatalogDigest": "sha256:...",
    "digestMatch": true,
    "parity": true,
    "reason": null,
    "gate": {
      "inflight": 0,
      "queued": 0
    }
  },
  "capabilities": {
    "text": true,
    "tools": true,
    "images": false,
    "ocr": false,
    "audio": false,
    "video": false,
    "files": false
  }
}
```

Se AgentOS è spento:

```text
agentToolCount = 0
agentCatalogDigest = null
digestMatch = false
parity = false
reason = "AGENTOS_NOT_READY"
capabilities.tools = false
```

Non deve risultare `parity=true` in base alla sola configurazione Node.

---

# 5. Inventario esatto dei file

## 5.1 Nuovi file Python

Creare:

```text
agno_service/src/ds4_agno/tool_errors.py
agno_service/src/ds4_agno/tool_client.py
agno_service/src/ds4_agno/tool_context.py
agno_service/src/ds4_agno/tool_factory.py
agno_service/src/ds4_agno/tool_events.py
agno_service/src/ds4_agno/text_only.py
```

## 5.2 Nuovi test Python

Creare:

```text
agno_service/tests/test_tool_client.py
agno_service/tests/test_tool_context.py
agno_service/tests/test_tool_factory.py
agno_service/tests/test_tool_events.py
agno_service/tests/test_tool_parity.py
agno_service/tests/test_tool_e2e.py
agno_service/tests/test_text_only.py
agno_service/tests/test_lifespan.py
```

## 5.3 Nuovi test Node

Creare:

```text
frontend/server/agno/agnoToolParity.test.mjs
frontend/server/agno/agnoTextOnly.test.mjs
frontend/server/agno/agnoToolBridge.integration.test.mjs
frontend/src/agno/agnoToolTimeline.test.mjs
```

`agnoTextOnly.test.mjs` può testare funzioni esportate da
`agnoModelGateway.mjs`; non è necessario introdurre un modulo separato se
la funzione resta piccola.

## 5.4 File Python da modificare

```text
agno_service/src/ds4_agno/settings.py
agno_service/src/ds4_agno/model.py
agno_service/src/ds4_agno/agents.py
agno_service/src/ds4_agno/app.py
agno_service/src/ds4_agno/catalog.py
agno_service/src/ds4_agno/run_registry.py
agno_service/tests/test_settings.py
agno_service/tests/test_agents.py
agno_service/tests/test_model_contract.py
agno_service/tests/test_runs.py
agno_service/tests/test_health.py
agno_service/tests/test_agent_ui_contract.py
```

## 5.5 File Node da modificare

```text
frontend/server/defaultConfig.mjs
frontend/server/config.mjs
frontend/server/index.mjs
frontend/server/agno/agnoProcessManager.mjs
frontend/server/agno/agnoProcessManager.test.mjs
frontend/server/agno/agnoClient.mjs
frontend/server/agno/agnoClient.test.mjs
frontend/server/agno/agnoRoutes.mjs
frontend/server/agno/agnoRoutes.test.mjs
frontend/server/agno/agnoModelGateway.mjs
frontend/server/agno/agnoModelGateway.test.mjs
frontend/server/agno/agnoToolRoutes.mjs
frontend/server/agno/agnoToolRoutes.test.mjs
frontend/server/agno/agnoToolSession.mjs
frontend/server/agno/agnoToolSession.test.mjs
frontend/server/agno/agnoToolExecutionService.mjs
frontend/server/agno/agnoToolExecutionService.test.mjs
```

## 5.6 File frontend da modificare

```text
frontend/src/agno/AgnoPanel.jsx
frontend/src/agno/agnoEvents.mjs
frontend/src/agno/agnoEvents.test.mjs
frontend/src/agno/agnoStore.mjs
frontend/src/agno/agnoStore.test.mjs
frontend/src/styles.css
```

`frontend/src/agno/agnoApi.mjs` va modificato soltanto se cambia il payload
pubblico. Non deve mai ricevere o inviare token interni.

## 5.7 Bootstrap e documentazione

```text
scripts/agno_agent_ui_bootstrap.sh
scripts/agno_bootstrap.sh
srun.sh
tests/test_srun_agno_agent_ui_bootstrap.sh
tests/test_srun_agno_bootstrap.sh
tests/test_agno_agent_ui_upstream_lock.sh
README.md
docs/agnos/usage-agno-under-ds4studio.md
```

## 5.8 File vietati

Non modificare per questa finalizzazione:

```text
ds4.c
ds4_server.c
ds4_rocm.cu
ds4_metal.m
ds4_cuda.cu
Makefile
kernel GPU
formato GGUF
```

Non modificare direttamente:

```text
.runtime/agno-agent-ui/
```

È un checkout generato e ignorato da Git. Eventuali personalizzazioni
stabili devono essere una patch tracciata e applicata dal bootstrap, non un
edit manuale nel runtime. Per il vincolo text-only non è oggi necessaria
una patch, perché il `ChatInput` fissato è già solo testuale.

---

# 6. Blast radius noto

L’analisi GitNexus eseguita sulla snapshot corrente ha dato:

| Simbolo | Rischio | Chiamanti diretti |
|---|---|---|
| `build_default_agent` | `LOW` | `create_app` |
| `create_app` | `LOW` | nessuno indicizzato |
| `Settings` | `LOW` | `app.py`, `cli.py` |
| `createAgnoProcessManager` | `LOW` | `index.mjs`, test process manager |
| `createAgnoRouter` | `LOW` | `index.mjs`, test route |
| `createAgnoModelGateway` | `LOW` | `index.mjs`, factory/test gateway |
| `AgnoPanel` | `LOW` | nessuno indicizzato |

`AgnoToolExecutionService` non è ancora presente nell’indice GitNexus
della snapshot; va trattato come simbolo nuovo/non indicizzato. Prima di
modificarlo:

1. aggiornare l’indice con `npx gitnexus analyze` se consentito;
2. rieseguire impact;
3. in caso di mancata risoluzione, usare import, istanziazione in
   `index.mjs` e test dedicati come mappa manuale;
4. registrare questa eccezione nel report di implementazione.

---

# 7. Fase 0 — congelare baseline e test riproducibili

## 7.1 Obiettivo

Separare regressioni preesistenti da regressioni introdotte dalla
finalizzazione.

## 7.2 Azioni

Salvare nel report di lavorazione:

```text
branch
commit HEAD
git status --short
versione Node
versione Python
versione Agno
commit Agent UI
config Agno effettiva senza segreti
```

Comandi:

```bash
rtk git status --short
rtk git rev-parse HEAD
rtk git rev-parse --abbrev-ref HEAD
rtk proxy node --version
rtk proxy agno_service/.venv/bin/python --version
rtk proxy agno_service/.venv/bin/python -c "import agno; print(agno.__version__)"
```

Non stampare environment completo.

## 7.3 Baseline test

Eseguire separatamente:

```bash
rtk test node --test --test-concurrency=1 frontend/server/agno/*.test.mjs
rtk test node --test frontend/src/agno/*.test.mjs
rtk test agno_service/.venv/bin/python -m pytest agno_service/tests -q
rtk test bash tests/test_srun_agno_bootstrap.sh
rtk test bash tests/test_srun_agno_agent_ui_bootstrap.sh
rtk test bash tests/test_agno_agent_ui_upstream_lock.sh
```

Il test Python ha mostrato tendenza a restare appeso. Prima di aggiungere
funzionalità, isolare il primo test che non termina:

```bash
rtk proxy timeout 60s agno_service/.venv/bin/python -m pytest \
  agno_service/tests -vv -x -s
```

Poi eseguire il singolo file e il singolo test. Cause da verificare:

- `TestClient` non chiuso;
- lifespan AgentOS non terminato;
- task creati da `RunRegistry.start_task()` ancora vivi;
- generatori `agent.arun()` mock non drenati;
- database SQLite non chiuso;
- client HTTP async non chiuso;
- registry globale `_AGENT_REGISTRY` condiviso tra app di test.

## 7.4 Correzione minima dell’hang

Non mascherare l’hang con timeout globali. Il fix deve:

- usare sempre `with TestClient(app) as client`;
- chiudere `RunRegistry` nel lifespan;
- cancellare e attendere i task, non soltanto chiamare `task.cancel()`;
- chiudere `Ds4ToolBridgeClient`;
- eliminare registry globali tra istanze dell’app;
- lasciare zero task Agno pendenti a fine test.

## 7.5 Gate

La fase passa quando:

- ogni suite baseline termina;
- eventuali fallimenti sono registrati per nome;
- nessun test resta sospeso oltre 60 secondi;
- non è stato modificato codice funzionale non Agno.

---

# 8. Fase 1 — chiudere il bridge Node già presente

## 8.1 Simboli

Analizzare prima:

```text
AgnoToolExecutionService.execute
AgnoToolExecutionService.normalizeResult
createAgnoToolRoutes
AgnoToolSessionRegistry.getOrCreate
AgnoToolSessionRegistry.cancel
AgnoToolSessionRegistry.sweep
```

## 8.2 Limiti configurati, non costanti divergenti

`agnoToolRoutes.mjs` usa oggi:

```javascript
const MAX_TOOL_REQUEST_BYTES = 2 * 1024 * 1024;
```

ma la configurazione dichiara:

```javascript
maxRequestBytes: 262_144,
maxResponseBytes: 262_144,
```

Cambiare la firma:

```javascript
export function createAgnoToolRoutes({
  authenticator,
  policy,
  gate,
  sessionRegistry,
  service,
  maxRequestBytes,
  maxResponseBytes,
  asyncHandler
})
```

`readJsonBody(req, maxRequestBytes)` deve usare il valore validato.

`maxResponseBytes` deve essere applicato dopo la normalizzazione:

- se `content` supera il limite e il risultato è comprimibile, usare il
  percorso di compressione esistente;
- se resta oltre il limite, troncare con marker deterministico oppure
  restituire `TOOL_RESPONSE_TOO_LARGE`;
- non troncare JSON in modo da renderlo invalido;
- non includere `raw` oltre il limite.

Preferenza: limitare in `AgnoToolExecutionService.normalizeResult()` e
passare `maxResponseBytes` al costruttore del service.

## 8.3 Protezione da chiavi pericolose

Aggiungere a `agnoToolRoutes.mjs`:

```javascript
export function assertNoDangerousKeys(value, path = "$") {
  // rifiuta ricorsivamente __proto__, prototype, constructor
}
```

Applicarla a:

```text
body.arguments
body.context
```

prima di `service.execute()`.

Errore:

```text
code: INVALID_TOOL_REQUEST
status: 400
```

Testare oggetti annidati e array.

## 8.4 Validazione request envelope

La route `/execute` deve validare esplicitamente:

```text
protocolVersion === 1
callId stringa 1..128
toolName stringa 1..128
arguments plain object
context plain object
nessuna proprietà top-level sconosciuta
```

La validazione degli argomenti specifici resta in
`validateToolArguments()`.

## 8.5 Sweep sessioni

`AgnoToolSessionRegistry.sweep()` esiste ma non viene schedulato.

In `frontend/server/index.mjs` creare:

```javascript
const agnoToolSessionSweepTimer = setInterval(
  () => agnoToolSessions.sweep(),
  60_000
);
agnoToolSessionSweepTimer.unref?.();
```

In shutdown:

```javascript
clearInterval(agnoToolSessionSweepTimer);
agnoToolGate.cancelAll("DS4 shutdown");
agnoToolSessions.closeAll();
```

La route `/cancel` deve abortire e rimuovere la sessione:

```javascript
sessionRegistry.cancel({ sessionId, runId });
sessionRegistry.close({ sessionId, runId });
```

oppure introdurre un singolo metodo:

```javascript
cancelAndClose({ sessionId, runId })
```

Non lasciare due semantiche divergenti.

## 8.6 Audit lifecycle

`AgnoToolAudit` non ha buffer e non richiede `close()`. Non inventare un
metodo vuoto. Se in futuro viene aggiunto buffering, allora il contratto
di shutdown dovrà includere `await audit.close()`.

## 8.7 Test

Aggiungere casi per:

- request esattamente al limite;
- request oltre limite;
- response esattamente al limite;
- response oltre limite;
- `__proto__` annidato;
- `constructor.prototype`;
- `callId` troppo lungo;
- `arguments` array;
- cancel elimina sessione;
- sweep elimina soltanto sessioni scadute;
- timer non trattiene il processo;
- audit non riceve token o history.

## 8.8 Gate

La fase passa quando:

- limiti config e runtime coincidono;
- nessun payload pericoloso raggiunge `executeTool()`;
- cancel e shutdown riportano gate e sessioni a zero;
- i test Node Agno restano verdi.

---

# 9. Fase 2 — environment Node → sidecar

## 9.1 File

Modificare:

```text
frontend/server/agno/agnoProcessManager.mjs
frontend/server/agno/agnoProcessManager.test.mjs
```

## 9.2 Firma

Aggiornare la JSDoc di `createAgnoProcessManager()`:

```javascript
/**
 * @param {{
 *   serviceToken: string,
 *   modelGatewayToken: string,
 *   toolBridgeToken: string
 * }} options.tokens
 */
```

## 9.3 `buildEnv()`

Aggiungere:

```javascript
DS4_AGNO_TOOL_BRIDGE_TOKEN: tokens.toolBridgeToken,
DS4_AGNO_TOOL_BRIDGE_BASE_URL:
  `http://${controlHost}:${controlPort}/api/internal/agno-tools`,
DS4_AGNO_TOOLS_ENABLED:
  String(Boolean(ag.tools.enabled)).toLowerCase(),
DS4_AGNO_TOOL_PROFILE:
  ag.tools.profile,
DS4_AGNO_TOOL_REQUEST_TIMEOUT_SECONDS:
  String(ag.tools.requestTimeoutMs / 1000),
DS4_AGNO_TOOL_MAX_HISTORY_MESSAGES:
  String(ag.tools.maxHistoryMessages),
DS4_AGNO_TOOL_MAX_HISTORY_BYTES:
  String(ag.tools.maxHistoryBytes),
```

Non passare:

```text
DS4_AGNO_TOOL_BRIDGE_TOKEN
```

a `createAgentUiProcessManager().buildEnv()`.

## 9.4 Coerenza host

La base URL deve essere costruita dal control host/port già validato, non
da un valore client. Per IPv6 `::1`, usare una helper che inserisca le
parentesi:

```javascript
function loopbackOrigin(host, port) {
  const renderedHost = host === "::1" ? "[::1]" : host;
  return `http://${renderedHost}:${port}`;
}
```

Riutilizzare la stessa helper per `DS4_AGNO_DS4_STUDIO_BASE_URL`.

## 9.5 Test

Verificare:

- tutte le variabili sono stringhe;
- token corretto;
- URL termina esattamente con `/api/internal/agno-tools`;
- profilo `safe` e `full`;
- timeout millisecondi → secondi;
- IPv4, localhost e IPv6;
- environment UI privo del token;
- nessuna chiave `NEXT_PUBLIC_*`;
- il token non compare in snapshot di status o errori.

## 9.6 Gate

Il processo Python avviato da Node riceve il terzo token, il profilo e i
limiti; il processo Next.js no.

---

# 10. Fase 3 — Settings Python

## 10.1 Simbolo

Modificare:

```text
agno_service/src/ds4_agno/settings.py::Settings
```

## 10.2 Campi

Aggiungere:

```python
tool_bridge_token: str = Field(min_length=32)
tool_bridge_base_url: str = (
    "http://127.0.0.1:5173/api/internal/agno-tools"
)
tools_enabled: bool = False
tool_profile: Literal["safe", "full"] = "safe"
tool_request_timeout_seconds: float = 120.0
tool_max_history_messages: int = Field(default=64, ge=1, le=256)
tool_max_history_bytes: int = Field(
    default=65_536,
    ge=1_024,
    le=1_048_576,
)
```

Importare `Literal` da `typing`.

## 10.3 Token

Estendere:

```python
@field_validator(
    "service_token",
    "model_gateway_token",
    "tool_bridge_token",
)
```

Aggiungere un validator model-level che imponga tre token distinti:

```python
@model_validator(mode="after")
def internal_tokens_must_be_distinct(self) -> "Settings":
    values = {
        self.service_token,
        self.model_gateway_token,
        self.tool_bridge_token,
    }
    if len(values) != 3:
        raise ValueError("internal tokens must be distinct")
    return self
```

## 10.4 URL bridge

Il validator deve imporre:

```text
schema http
host 127.0.0.1, localhost o ::1
porta valida
path esatto /api/internal/agno-tools
query assente
fragment assente
userinfo assente
```

Normalizzare soltanto lo slash finale:

```python
return value.rstrip("/")
```

Non risolvere DNS e non accettare redirect.

## 10.5 Timeout

Validator:

```python
@field_validator("tool_request_timeout_seconds")
@classmethod
def valid_tool_timeout(cls, value: float) -> float:
    if not 0.1 <= value <= 7_200:
        raise ValueError(...)
    return value
```

## 10.6 Tools abilitabili

`tools_enabled` non deve entrare nel validator `must_be_false`. Quello resta
limitato a:

```text
telemetry
tracing
scheduler
mcp_enabled
```

## 10.7 Compatibilità test esistenti

Tutte le fixture `Settings(...)` devono ricevere un terzo token. Usare
valori distinti:

```python
service_token="s" * 32
model_gateway_token="m" * 32
tool_bridge_token="t" * 32
```

Non rendere il token opzionale: Node lo crea sempre, anche se i tool sono
disabilitati.

## 10.8 Test

Copertura:

- settings valida;
- token assente;
- token corto;
- token uguali;
- URL remoto;
- HTTPS;
- path errato;
- query;
- fragment;
- userinfo;
- profilo errato;
- timeout sotto/sopra limite;
- history cap sotto/sopra limite;
- `tools_enabled=true` accettato;
- `mcp_enabled=true` ancora rifiutato.

## 10.9 Gate

`Settings` deve fallire prima dell’avvio su qualunque configurazione del
bridge non locale o ambigua.

---

# 11. Fase 4 — client Python del bridge

## 11.1 `tool_errors.py`

Creare:

```python
from __future__ import annotations

from typing import Any


class Ds4ToolBridgeError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int | None = None,
        details: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.details = details
```

`__str__` ereditata deve contenere solo il messaggio sanitizzato.

## 11.2 `tool_client.py`

Creare due dataclass immutabili:

```python
@dataclass(frozen=True)
class ToolCatalog:
    protocol_version: int
    profile: str
    tools: tuple[dict[str, Any], ...]
    catalog_digest: str


@dataclass(frozen=True)
class ToolBridgeResult:
    tool_name: str
    content: str
    is_error: bool
    guarded: bool
    compressed: bool
    code: str | None
    raw: dict[str, Any] | list[Any] | str | None
    duration_ms: float | None
```

Classe:

```python
class Ds4ToolBridgeClient:
    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        ...

    async def get_catalog(self) -> ToolCatalog:
        ...

    async def execute(
        self,
        *,
        call_id: str,
        tool_name: str,
        arguments: dict[str, Any],
        context: dict[str, Any],
    ) -> ToolBridgeResult:
        ...

    async def cancel(
        self,
        *,
        run_id: str,
        session_id: str,
    ) -> None:
        ...

    async def status(self) -> dict[str, Any]:
        ...

    async def aclose(self) -> None:
        ...
```

## 11.3 Costruzione `httpx.AsyncClient`

Obbligatorio:

```python
self._client = httpx.AsyncClient(
    base_url=base_url.rstrip("/"),
    headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    },
    timeout=httpx.Timeout(timeout_seconds),
    transport=transport,
    trust_env=False,
    follow_redirects=False,
)
```

Non usare `requests`. Non usare proxy ambientali.

## 11.4 Fetch sincrono al bootstrap

Poiché `AgentOS` riceve la lista di agenti nel costruttore e
`create_app()` è sincrona, aggiungere:

```python
def get_catalog_sync(
    *,
    base_url: str,
    token: str,
    timeout_seconds: float,
    transport: httpx.BaseTransport | None = None,
) -> ToolCatalog:
    ...
```

È ammessa esclusivamente per il bootstrap. Le esecuzioni tool restano
asincrone.

Il client sincrono deve usare gli stessi:

```text
trust_env=False
follow_redirects=False
header
decoder
validator
```

Evitare due implementazioni divergenti: estrarre:

```python
def decode_json_response(response: httpx.Response) -> dict[str, Any]
def parse_catalog_payload(data: dict[str, Any]) -> ToolCatalog
```

## 11.5 Validazione catalogo

`parse_catalog_payload()` deve rifiutare:

- payload non object;
- versione diversa da 1;
- profilo non `safe|full`;
- `tools` non lista;
- lista vuota se tool abilitati;
- entry non object;
- `type` diverso da `function`;
- nome vuoto o duplicato;
- descrizione non stringa;
- `parameters` non object;
- schema senza `type: object`;
- digest non `sha256:` seguito da 64 cifre esadecimali.

Il digest va ricalcolato usando la stessa serializzazione Node. Per evitare
differenze fra `JSON.stringify()` e `json.dumps()`, scegliere una delle
due strategie e congelarla con test cross-language:

1. Node restituisce anche il JSON canonico e Python ne calcola SHA-256; oppure
2. entrambi usano chiavi ordinate e separatori compatti.

La scelta raccomandata è introdurre in Node una funzione
`stableCatalogDigest(tools)` con ordinamento ricorsivo delle chiavi e
replicare esattamente quella serializzazione in Python. Il test
cross-process è l’autorità finale.

## 11.6 Decodifica errori

```python
def decode_json_response(
    response: httpx.Response,
) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError as exc:
        raise Ds4ToolBridgeError(
            "INVALID_BRIDGE_RESPONSE",
            "tool bridge returned non-JSON",
            status_code=response.status_code,
        ) from exc

    if not isinstance(data, dict):
        raise Ds4ToolBridgeError(...)

    if not response.is_success:
        raise Ds4ToolBridgeError(
            code=str(data.get("error", "TOOL_BRIDGE_ERROR")),
            message=str(data.get("message", "tool bridge request failed")),
            status_code=response.status_code,
            details=data.get("details"),
        )
    return data
```

Non includere `response.request.headers` nelle eccezioni.

## 11.7 Test

Usare `httpx.MockTransport`.

Testare:

- bearer header;
- URL e path esatti;
- catalog valido;
- digest errato;
- tool duplicato;
- schema invalido;
- execute payload;
- execute result;
- cancel;
- status;
- 401, 403, 409, 422, 429, 504;
- JSON non object;
- non-JSON;
- redirect non seguito;
- timeout;
- `aclose()` idempotente;
- token assente da `str(exc)` e `repr(exc)`;
- proxy ambientale ignorato.

## 11.8 Gate

Il client deve funzionare contro mock senza rete e fallire chiuso su ogni
risposta non conforme.

---

# 12. Fase 5 — conversione `RunContext`

## 12.1 File

Creare:

```text
agno_service/src/ds4_agno/tool_context.py
```

## 12.2 API

```python
from agno.models.message import Message
from agno.run import RunContext


def build_bridge_context(
    run_context: RunContext,
    *,
    max_messages: int,
    max_bytes: int,
) -> dict[str, Any]:
    ...


def normalize_messages(
    messages: list[Message],
    *,
    max_messages: int,
    max_bytes: int,
) -> list[dict[str, Any]]:
    ...
```

Agno 2.8.0 espone realmente:

```text
RunContext.run_id
RunContext.session_id
RunContext.user_id
RunContext.messages
Message.get_content_string()
Message.tool_call_id
```

## 12.3 Payload consentito

Inoltrare soltanto:

```python
{
    "runId": run_context.run_id,
    "sessionId": run_context.session_id,
    "userId": run_context.user_id,
    "history": history,
}
```

Non inoltrare:

```text
dependencies
metadata
session_state
tools
knowledge
members
client_tools
```

## 12.4 Normalizzazione history

Per ogni messaggio:

- ruolo stringa non vuota;
- content stringa;
- `tool_call_id` solo se stringa e massimo 128 caratteri;
- nessuna immagine/audio/video/file;
- nessun campo extra;
- massimo `max_messages`;
- massimo `max_bytes` in UTF-8;
- eliminare prima i messaggi più vecchi;
- preservare ordine cronologico;
- non spezzare una stringa a metà byte.

Se `Message.get_content_string()` produce una rappresentazione di media o
se il messaggio ha `images`, `audio`, `videos` o `files`, scartare il
messaggio dalla history bridge.

## 12.5 ID

Se `run_id` o `session_id` sono vuoti:

- non generarli nella factory tool;
- sollevare `Ds4ToolBridgeError("INVALID_TOOL_CONTEXT", ...)`;
- correggere il chiamante che non ha fornito una sessione.

La route custom deve sempre passare un `session_id`; se il client non lo
fornisce, generarlo una volta all’ingresso della run e restituirlo nel
payload `202`.

## 12.6 Test

- ID validi;
- ID mancanti;
- user nullo;
- ordine;
- cap messaggi;
- cap byte con Unicode;
- `tool_call_id`;
- media scartata;
- metadata scartata;
- contenuto non stringa;
- lista vuota.

## 12.7 Gate

Il context bridge non contiene dati arbitrari e rispetta gli stessi limiti
configurati lato Node.

---

# 13. Fase 6 — factory delle `Function` Agno

## 13.1 File

Creare:

```text
agno_service/src/ds4_agno/tool_factory.py
```

## 13.2 API pubblica Agno

Usare:

```python
from agno.run import RunContext
from agno.tools import Function
```

Non creare subclass private di Agno.

## 13.3 Entrypoint generico

```python
async def _execute_ds4_tool(
    *,
    tool_name: str,
    client: Ds4ToolBridgeClient,
    max_history_messages: int,
    max_history_bytes: int,
    run_context: RunContext,
    **arguments: Any,
) -> str:
    context = build_bridge_context(
        run_context,
        max_messages=max_history_messages,
        max_bytes=max_history_bytes,
    )
    call_id = f"agno-{uuid4()}"

    try:
        result = await client.execute(
            call_id=call_id,
            tool_name=tool_name,
            arguments=arguments,
            context=context,
        )
    except asyncio.CancelledError:
        await asyncio.shield(
            client.cancel(
                run_id=context["runId"],
                session_id=context["sessionId"],
            )
        )
        raise
    except Ds4ToolBridgeError as exc:
        return format_bridge_error(tool_name, exc)

    return format_tool_result(result)
```

## 13.4 Formato errore per il modello

Il modello deve ricevere una stringa deterministica:

```text
[DS4_TOOL_ERROR code=TOOL_NOT_ALLOWED tool=bash]
Tool execution failed. Do not claim success.
<messaggio sanitizzato>
```

Non restituire traceback, token, header o `details` arbitrari.

Un risultato `is_error=true` non deve sollevare un’eccezione Python che
interrompe necessariamente tutta la run: deve diventare un tool result
esplicito così il modello può correggere argomenti o spiegare il blocco.

## 13.5 Closure, non late binding

Factory:

```python
def make_entrypoint(
    *,
    tool_name: str,
    client: Ds4ToolBridgeClient,
    max_history_messages: int,
    max_history_bytes: int,
):
    async def entrypoint(
        run_context: RunContext,
        **arguments: Any,
    ) -> str:
        return await _execute_ds4_tool(
            tool_name=tool_name,
            client=client,
            max_history_messages=max_history_messages,
            max_history_bytes=max_history_bytes,
            run_context=run_context,
            **arguments,
        )

    entrypoint.__name__ = f"ds4_{tool_name}"
    return entrypoint
```

Preferire questa closure a `functools.partial` finché un test non dimostra
che Agno 2.8.0 inietta correttamente `RunContext` nel `partial`.

## 13.6 `build_ds4_tools`

```python
def build_ds4_tools(
    *,
    client: Ds4ToolBridgeClient,
    catalog: ToolCatalog,
    max_history_messages: int,
    max_history_bytes: int,
) -> list[Function]:
    ...
```

Per ogni entry:

```python
Function(
    name=name,
    description=description,
    parameters=parameters,
    entrypoint=make_entrypoint(...),
    skip_entrypoint_processing=True,
    show_result=False,
    stop_after_tool_call=False,
)
```

`skip_entrypoint_processing=True` è obbligatorio: lo schema deve restare
quello canonico Node.

## 13.7 Validazioni

La factory deve:

- ricevere un `ToolCatalog` già validato;
- rifiutare nomi duplicati;
- preservare ordine catalogo;
- non modificare descrizione;
- non modificare schema;
- creare entrypoint distinti;
- non catturare l’ultimo nome del loop per tutti i tool;
- non registrare tool se `tools_enabled=false`.

## 13.8 Test

Testare:

- zero tool;
- sedici tool;
- nomi esatti;
- descrizioni esatte;
- schema deep-equal;
- `skip_entrypoint_processing`;
- entrypoint `read` chiama `read`;
- entrypoint `list` chiama `list`;
- due closure non condividono il nome;
- `RunContext` inoltrato;
- result positivo;
- result `is_error`;
- eccezione bridge;
- cancellazione chiama `/cancel` e rilancia `CancelledError`;
- token non compare;
- nessun oggetto media nel context.

## 13.9 Gate

Con un catalogo mock full, la factory crea esattamente sedici `Function`
eseguibili e schema-equivalenti.

---

# 14. Fase 7 — builder agente e garanzia text-only

## 14.1 Rimuovere il builder duplicato

In:

```text
agno_service/src/ds4_agno/model.py
```

lasciare soltanto:

```python
def create_ds4_model(settings: "Settings") -> OpenAILike:
    ...
```

Rimuovere import di `Agent` e `SqliteDb`.

Aggiornare `test_model_contract.py` affinché importi
`build_default_agent` da `ds4_agno.agents`.

Test statico:

```python
def test_model_module_does_not_define_agent_builder():
    import ds4_agno.model as module
    assert not hasattr(module, "build_default_agent")
```

## 14.2 Firma definitiva

In `agents.py`:

```python
def build_default_agent(
    *,
    model: OpenAILike,
    db: SqliteDb,
    tools: list[Function],
) -> Agent:
```

## 14.3 Costruttore

```python
return Agent(
    id="ds4-assistant",
    name="DS4 Assistant",
    model=model,
    db=db,
    tools=tools,
    tool_choice="auto" if tools else "none",
    tool_call_limit=32,
    instructions=[
        "You are running inside DS4-Studio through Agno AgentOS.",
        "The model accepts text input only.",
        "Images, OCR, audio, video, and file attachments are not supported.",
        "Use only tools explicitly provided in the tool catalog.",
        "Tool execution is delegated to the authoritative DS4 Node runtime.",
        "Never claim a tool succeeded unless its result reports success.",
        "Use read, search, or list instead of bash for file inspection.",
        "Use Sage for symbolic or exact mathematical computation.",
        "Use page_snapshot before page_action.",
        "Do not bypass DS4 filesystem, GitNexus, Sage, browser, or safety guards.",
    ],
    markdown=True,
    add_history_to_context=True,
    num_history_runs=3,
    max_tool_calls_from_history=32,
    add_datetime_to_context=True,
    store_tool_messages=True,
    store_events=True,
    send_media_to_model=False,
    store_media=False,
)
```

## 14.4 `tool_choice`

Verificare contro Agno 2.8.0 e il payload OpenAI-compatible:

- con tool: `"auto"`;
- senza tool: preferire `None` se `"none"` non è accettato dal provider;
- il test deve osservare il JSON diretto al gateway, non soltanto
  l’attributo Python.

Non impostare un tool obbligatorio per ogni risposta.

## 14.5 Team e workflow

Restano liste vuote. Non creare team o workflow dimostrativi.

## 14.6 Guard route AgentOS

Creare in `text_only.py`:

```python
class TextOnlyInputGuard:
    ERROR_CODE = "AGNO_TEXT_ONLY"

    @staticmethod
    def validate_ds4_payload(payload: object) -> str:
        ...

    @staticmethod
    def contains_media_fields(payload: object) -> bool:
        ...
```

Per la route native multipart introdurre:

```python
class RejectAgentOsMediaMiddleware:
    def __init__(
        self,
        app,
        *,
        max_inspection_bytes: int = 1_048_576,
    ) -> None:
        ...

    async def __call__(self, scope, receive, send) -> None:
        ...
```

Il middleware deve intervenire soltanto su:

```text
POST /agents/{id}/runs
POST /teams/{id}/runs
```

e soltanto quando il multipart contiene un file reale nel campo `files`.

Requisiti:

- limite fisso di ispezione;
- `413` oltre limite;
- `415 AGNO_TEXT_ONLY` se trova file;
- replay corretto del body se non trova file;
- nessuna lettura per GET o altre route;
- nessun log di filename o contenuto;
- nessuna dipendenza da simboli privati Agno;
- test ASGI con chunk multipli e disconnect.

Se l’implementazione middleware risulta fragile con Starlette 1.3.1,
l’alternativa ammessa è una route wrapper DS4 per la Agent UI che accetta
solo `message`, ma non è ammesso lasciare upload silenziosamente ignorati.

## 14.7 Guard gateway modello

In `agnoModelGateway.mjs` aggiungere:

```javascript
export function assertTextOnlyChatRequest(body) {
  // accetta content string
  // accetta array solo con parti testuali
  // rifiuta image_url, input_image, audio, file e oggetti sconosciuti
}
```

Eseguirla:

1. dopo parsing JSON;
2. prima di `executionGuard`;
3. prima di acquisire `AgnoModelGate`;
4. prima di contattare `ds4-server`.

Errore:

```text
HTTP 422
AGNO_TEXT_ONLY
```

Parti ammesse:

```json
{"type": "text", "text": "..."}
```

Parti rifiutate:

```json
{"type": "image_url", "image_url": {}}
{"type": "input_image", "image_url": "..."}
{"type": "input_audio", "input_audio": {}}
{"type": "file", "file": {}}
```

I messaggi tool testuali restano ammessi.

## 14.8 Test

- agent con zero tool;
- agent con sedici tool;
- `tool_choice`;
- `tool_call_limit`;
- `store_tool_messages`;
- `store_events`;
- `send_media_to_model is False`;
- `store_media is False`;
- istruzione text-only;
- custom route rifiuta media;
- AgentOS native rifiuta multipart file;
- gateway rifiuta ogni parte media;
- gateway non acquisisce il gate su input rifiutato;
- nessuna chiamata upstream su input rifiutato;
- content string ammesso;
- array di sole parti text ammesso;
- tool result testuale ammesso.

## 14.9 Gate

Nessun byte media arriva al modello e nessuna UI promette OCR.

---

# 15. Fase 8 — inizializzazione di `create_app`

## 15.1 Eliminare stato globale

Rimuovere:

```python
_AGENT_REGISTRY: dict = {}
```

Usare:

```python
agent_registry = {
    agent.id: agent
    for agent in agents_list
}
```

Passarlo esplicitamente:

```python
async def _execute_run(
    registry: RunRegistry,
    agent_registry: dict[str, Agent],
    run_id: str,
    target_type: str,
    target_id: str,
    message: str,
    stream: bool,
    session_id: str,
) -> None:
```

Questo isola le istanze di app nei test.

## 15.2 Dipendenze iniettabili

Firma raccomandata:

```python
def create_app(
    settings: Settings | None = None,
    *,
    catalog_fetcher: Callable[..., ToolCatalog] = get_catalog_sync,
    tool_client_factory: Callable[..., Ds4ToolBridgeClient] = Ds4ToolBridgeClient,
) -> FastAPI:
```

I test non devono aprire socket reali.

## 15.3 Ordine di bootstrap

```python
_settings = settings or Settings()
auth = ServiceAuthenticator(...)
db = create_db(_settings)
model = create_ds4_model(_settings)

tool_catalog = None
tool_client = None
tools: list[Function] = []

if _settings.tools_enabled:
    tool_catalog = catalog_fetcher(
        base_url=_settings.tool_bridge_base_url,
        token=_settings.tool_bridge_token,
        timeout_seconds=min(
            _settings.tool_request_timeout_seconds,
            5.0,
        ),
    )
    assert tool_catalog.profile == _settings.tool_profile
    tool_client = tool_client_factory(...)
    tools = build_ds4_tools(...)

agents_list = [
    build_default_agent(
        model=model,
        db=db,
        tools=tools,
    )
]
```

## 15.4 Fail-closed

Con `tools_enabled=true`, `create_app()` deve fallire su:

- bridge non raggiungibile;
- 401 o 403;
- catalogo non JSON;
- versione protocollo errata;
- profilo diverso;
- catalogo vuoto;
- digest assente o errato;
- tool duplicato;
- schema invalido;
- profilo `full` senza sedici tool.

Non avviare un agente degradato senza tool.

Con `tools_enabled=false`:

- non contattare il bridge;
- creare l’agente con `tools=[]`;
- esporre `capabilities.tools=false`;
- mantenere text-only.

## 15.5 Lifespan

```python
@asynccontextmanager
async def ds4_lifespan(_app: FastAPI):
    try:
        yield
    finally:
        await registry.shutdown()
        if tool_client is not None:
            await tool_client.aclose()
```

Passarlo a:

```python
AgentOS(..., lifespan=ds4_lifespan)
```

Agno 2.8.0 combina il lifespan utente con database e client HTTP. Aggiungere
un test che dimostri:

```text
startup una volta
shutdown una volta
RunRegistry chiuso
tool client chiuso
database AgentOS chiuso
nessun task pendente
```

## 15.6 `RunRegistry.shutdown`

Modificare:

```python
async def shutdown(self) -> None:
    async with self._lock:
        tasks = [
            record.task
            for record in self._runs.values()
            if record.task and not record.task.done()
        ]
        for task in tasks:
            task.cancel()

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    async with self._lock:
        self._runs.clear()
```

Non attendere task tenendo il lock.

## 15.7 App state

Dopo `agent_os.get_app()`:

```python
app.state.ds4_tool_client = tool_client
app.state.ds4_tool_count = len(tools)
app.state.ds4_tool_names = tuple(tool.name for tool in tools)
app.state.ds4_tool_catalog_digest = (
    tool_catalog.catalog_digest
    if tool_catalog is not None
    else None
)
app.state.ds4_tool_profile = _settings.tool_profile
app.state.ds4_text_only = True
```

## 15.8 Health

`/ds4/health`:

```json
{
  "tools": {
    "enabled": true,
    "profile": "full",
    "count": 16,
    "names": ["..."],
    "catalogDigest": "sha256:..."
  },
  "capabilities": {
    "text": true,
    "tools": true,
    "images": false,
    "ocr": false,
    "audio": false,
    "video": false,
    "files": false
  }
}
```

Health non richiede token perché Node lo usa per readiness; non deve
contenere segreti.

## 15.9 Catalogo DS4

`/ds4/catalog` deve costruire il catalogo runtime:

```json
{
  "agents": [
    {
      "id": "ds4-assistant",
      "kind": "agent",
      "name": "DS4 Assistant",
      "description": "Default assistant agent for DS4-Studio",
      "enabled": true,
      "toolCount": 16,
      "toolNames": ["..."],
      "toolCatalogDigest": "sha256:...",
      "inputMode": "text"
    }
  ],
  "teams": [],
  "workflows": []
}
```

Non mantenere `toolCount` statico in `catalog.py`.

## 15.10 Run custom

`POST /ds4/runs` deve:

1. autenticare;
2. leggere JSON con gestione errore;
3. validare text-only;
4. validare target;
5. creare o accettare `sessionId`;
6. creare `runId`;
7. avviare il task;
8. restituire entrambi gli ID.

Risposta:

```json
{
  "runId": "...",
  "sessionId": "...",
  "status": "queued",
  "eventsUrl": "/ds4/runs/.../events"
}
```

## 15.11 Gate

L’app non si dichiara healthy con tool abilitati se il catalogo non è stato
caricato e registrato.

---

# 16. Fase 9 — eventi tool

## 16.1 Classi reali Agno 2.8.0

La versione installata espone:

```text
ToolCallStartedEvent
ToolCallCompletedEvent
ToolCallErrorEvent
```

Non usare nomi ipotetici di altre versioni.

## 16.2 `tool_events.py`

Creare:

```python
def normalize_agno_tool_event(
    event: Any,
) -> tuple[Literal["tool_call", "tool_result"], dict[str, Any]] | None:
    ...
```

Helper:

```python
def extract_tool_call_id(event: Any) -> str | None: ...
def extract_tool_name(event: Any) -> str | None: ...
def extract_tool_arguments(event: Any) -> dict[str, Any]: ...
def extract_tool_content(event: Any) -> str: ...
```

## 16.3 Payload canonico

Start:

```json
{
  "callId": "...",
  "name": "read",
  "arguments": {
    "path": "README.md"
  },
  "status": "running"
}
```

Completamento:

```json
{
  "callId": "...",
  "name": "read",
  "content": "...",
  "isError": false,
  "status": "completed"
}
```

Errore:

```json
{
  "callId": "...",
  "name": "read",
  "content": "...",
  "isError": true,
  "status": "failed"
}
```

## 16.4 Sanitizzazione

Non includere:

- oggetti `Function`;
- callable;
- stack;
- request/response HTTP;
- token;
- media raw;
- `RunContext`;
- history completa.

Argomenti grandi per `bash`, `write`, `edit` vanno troncati nella
visualizzazione, non nell’esecuzione.

## 16.5 `_execute_run`

All’inizio del loop:

```python
seen_tool_events: set[tuple[str, str]] = set()
```

Prima dei rami terminali:

```python
tool_event = normalize_agno_tool_event(event)
if tool_event is not None:
    event_type, payload = tool_event
    dedupe_key = (event_type, payload["callId"])
    if dedupe_key not in seen_tool_events:
        seen_tool_events.add(dedupe_key)
        await registry.publish(
            run_id,
            Ds4AgnoEvent(
                type=event_type,
                run_id=run_id,
                target_type=target_type,
                target_id=target_id,
                seq=_next_seq(),
                content=payload,
            ).model_dump(),
        )
    continue
```

Non deduplicare `content_delta`.

## 16.6 Terminali

Conservare il fix corrente che drena `agent.arun()` fino alla conclusione
naturale. Non ritornare al primo `RunCompletedEvent`, perché una chiusura
prematura del generatore può essere persistita da Agno come cancellazione.

Garantire un solo terminale:

```text
run_completed
run_failed
run_cancelled
```

## 16.7 Test

- started;
- completed;
- error;
- call ID mancante;
- nome mancante;
- arguments dict;
- arguments JSON string;
- content object;
- deduplica;
- ordine seq;
- terminale unico;
- nessun token;
- generatore drenato.

## 16.8 Gate

Ogni tool call osservata dal pannello ha un ID, uno start e un risultato
correlabile.

---

# 17. Fase 10 — catalogo e status pubblici reali

## 17.1 `AgnoClient`

Il metodo esiste come:

```javascript
async catalog()
```

Usare questo nome ovunque; non introdurre `getCatalog()` senza una ragione.

Aggiungere errori tipizzati:

```javascript
export class AgnoClientError extends Error {
  constructor(code, status, message) { ... }
}
```

Almeno per:

```text
AGENTOS_NOT_READY
AGNO_SERVICE_UNAUTHORIZED
AGNO_SERVICE_BAD_RESPONSE
```

## 17.2 `/api/agno/catalog`

Sostituire il payload statico con:

```javascript
const result = await agnoClient.catalog();
res.json(result);
```

Se il sidecar è spento o non healthy:

```text
503 AGENTOS_NOT_READY
```

Nessun fallback statico.

## 17.3 Health sidecar nello status

Quando il processo è healthy, recuperare `/ds4/health` una volta e usare
il payload reale.

Non impostare:

```javascript
backendHealthy: agentOsHealth ? true : false
```

se `agentOsHealth` è un object generico. Validare:

```text
ok === true
service === "ds4-agno-service"
owner corretto
tools object valido
capabilities.text === true
capabilities.images === false
```

## 17.4 Calcolo parità

Estrarre funzione pura testabile:

```javascript
export function buildAgnoToolStatus({
  config,
  policy,
  gate,
  agentOsHealth,
  nodeCatalogDigest
}) {
  ...
}
```

`parity=true` soltanto se:

```text
config tools enabled
sidecar healthy
profile coincide
node count coincide con sidecar count
digest coincide
nomi coincidono
full → count atteso 16
```

Per evitare di esporre schemi nello status, è sufficiente esporre count e
digest. Il confronto nomi avviene internamente.

## 17.5 Fonte digest Node

Non ricalcolare su `allowedToolNames()` soltanto. Usare esattamente gli
schemi filtrati restituiti dalla route catalog:

```javascript
const allowedTools = listAgentTools().filter(...);
const nodeCatalogDigest = stableCatalogDigest(allowedTools);
```

Condividere la stessa helper fra:

```text
agnoToolRoutes.mjs
agnoRoutes.mjs
agnoToolParity.test.mjs
```

Se la terza occorrenza giustifica un modulo, creare:

```text
frontend/server/agno/agnoToolCatalogDigest.mjs
```

## 17.6 Capabilities

Aggiungere sempre:

```javascript
capabilities: {
  text: true,
  tools: toolStatus.parity,
  images: false,
  ocr: false,
  audio: false,
  video: false,
  files: false
}
```

## 17.7 Test

- sidecar spento;
- sidecar healthy senza tool;
- count diverso;
- digest diverso;
- profilo diverso;
- full 16/16;
- safe subset;
- catalog route proxy;
- catalog sidecar down;
- nessun fallback statico;
- nessun token nel payload.

## 17.8 Gate

Status e catalogo pubblici descrivono l’agente effettivo, non una
configurazione teorica.

---

# 18. Fase 11 — frontend DS4

## 18.1 `agnoEvents.mjs`

Normalizzare:

```javascript
case "tool_call":
  return {
    type: "tool_call",
    callId: event.content?.callId,
    name: event.content?.name,
    arguments: event.content?.arguments || {},
    status: "running"
  };

case "tool_result":
  return {
    type: "tool_result",
    callId: event.content?.callId,
    name: event.content?.name,
    content: event.content?.content || "",
    isError: Boolean(event.content?.isError),
    status: event.content?.isError ? "failed" : "completed"
  };
```

Separare parsing SSE da riduzione dello stato.

## 18.2 `agnoStore.mjs`

Sostituire:

```javascript
toolCalls: []
```

con:

```javascript
toolCallOrder: [],
toolCallsById: {}
```

Struttura:

```javascript
{
  [callId]: {
    callId,
    name,
    arguments,
    status: "running" | "completed" | "failed",
    result: "",
    isError: false
  }
}
```

Regole:

- `tool_call` crea o aggiorna;
- `tool_result` completa la stessa entry;
- result prima dello start crea placeholder;
- duplicati con stesso `seq` vengono ignorati;
- stesso `callId` non appare due volte nell’ordine;
- nuova run azzera la timeline;
- history archiviata conserva una copia immutabile.

## 18.3 `AgnoPanel.jsx`

Aggiungere:

```text
badge “Solo testo”
nota “Immagini e OCR non supportati”
stato “Tool pronti N/N”
warning se tools configurati ma parity=false
```

Disabilitare “Avvia run” se:

```text
servizio non ready
agente nativo attivo
tools configurati ma sidecar non allineato
message vuoto
run già in submit
```

Non disabilitare una run testuale quando i tool sono volutamente
disabilitati: mostrare “modalità chat senza tool”.

## 18.4 Card tool

Per ogni call:

```text
nome
stato
argomenti compatti
risultato espandibile
errore
```

Sanitizzazione UI:

- massimo 2.000 caratteri di preview;
- `bash`, `write`, `edit`: `<details>` chiuso;
- nessun rendering HTML non sanitizzato;
- JSON in `<pre>`;
- label accessibile;
- non stampare `raw`.

## 18.5 Agent UI

Il pulsante resta una nuova tab locale. Nel tooltip:

```text
Apri Agno-UI (solo testo; OCR e allegati non supportati)
```

La UI fissata non ha oggi un uploader, quindi non aggiungere una patch solo
per rimuovere una funzione inesistente.

## 18.6 Test

- badge text-only;
- status tools 16/16;
- mismatch digest;
- tools disabilitati;
- call running;
- result completed;
- result failed;
- result prima della call;
- duplicato;
- call ID mancante;
- reset nuova run;
- history immutabile;
- preview troncata;
- nessun token.

## 18.7 Gate

L’utente vede chiaramente capacità reali e ciclo completo dei tool.

---

# 19. Fase 12 — cancellazione end-to-end

## 19.1 Percorso

```text
click Cancella
  → POST /api/agno/runs/{id}/cancel
  → AgnoClient.cancelRun()
  → POST /ds4/runs/{id}/cancel
  → RunRegistry.request_cancel()
  → task.cancel()
  → Agent coroutine cancellata
  → Function coroutine cancellata
  → Ds4ToolBridgeClient request cancellata
  → Node rileva disconnect
  → AbortController
  → executeTool signal
  → child/fetch terminato
  → gate release
  → session close
  → run_cancelled terminale unico
```

## 19.2 Correzioni Python

`RunRegistry.request_cancel()` non deve impostare subito un terminale
se il task è ancora in esecuzione. Il terminale è pubblicato da
`_execute_run()` nel ramo `CancelledError`.

Se il task è già terminale, cancel è idempotente e restituisce lo stato
esistente.

## 19.3 Correzioni client

Nel ramo `CancelledError` dell’entrypoint:

```python
await asyncio.shield(client.cancel(...))
raise
```

Il cancel esplicito ha timeout corto, per esempio 2 secondi, separato dal
timeout tool.

## 19.4 Test bash

In workspace temporanea:

```text
tool bash con comando sleep 30
attesa 100 ms
cancel run
```

Entro 5 secondi:

```text
child terminato
gate inflight=0
gate queued=0
session rimossa
run status cancelled
un solo run_cancelled
nessun run_completed successivo
```

Non usare la root del repository per write/edit/bash E2E.

## 19.5 Crawl, Sage e browser

Usare mock che verificano il `signal`. Non richiedere rete reale nei test
automatici.

## 19.6 Gate

Zero processi orfani e zero lease dopo cancel.

---

# 20. Fase 13 — bootstrap e lifecycle processi

## 20.1 Autorità shell

Scegliere una struttura unica:

```text
scripts/agno_bootstrap.sh
  → funzioni virtualenv/config effettiva

scripts/agno_agent_ui_bootstrap.sh
  → ensure_agno_agent_ui()
  → eseguibile anche standalone

srun.sh
  → source di entrambi
  → chiama le funzioni
```

`agno_bootstrap.sh` non deve contenere una seconda implementazione
parziale delle funzioni Agent UI.

## 20.2 Rendere Agent UI bootstrap source-safe

```bash
ensure_agno_agent_ui() {
  local root_dir="${1:-...}"
  local config_path="${2:-}"
  ...
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ensure_agno_agent_ui "$@"
fi
```

`die()` dentro una funzione sourced deve `return 1` attraverso il chiamante,
non terminare inaspettatamente l’intero shell se la funzione è usata in un
test. Gestire questo con una helper che ritorna e con `|| return`.

## 20.3 Config effettiva

Le funzioni shell leggono oggi JSON grezzo e quindi possono ignorare
default o merge.

Creare:

```text
frontend/server/printEffectiveConfig.mjs
```

che usa `loadConfig()`/`mergeConfig()` autorevoli e stampa soltanto la
sezione richiesta, senza token.

Interfaccia:

```bash
node frontend/server/printEffectiveConfig.mjs \
  --config frontend/ds4-ui.config.json \
  --select agno
```

Le funzioni shell devono usare l’output effettivo.

## 20.4 Lock riproducibile

Sostituire:

```bash
pnpm install --no-frozen-lockfile --ignore-scripts
```

con:

```bash
pnpm install --frozen-lockfile
```

Prima verificare se l’upstream fissato richiede script. Se sì, consentire
solo quelli necessari e documentati; non disabilitarli alla cieca.

## 20.5 Fast path idempotente

Prima di fetch/install/build, verificare:

```text
.ds4-ready presente
commit marker corretto
git HEAD corretto
package version corretta
Next version corretta
pnpm version corretta
.next/BUILD_ID presente
node_modules presente
worktree pulito escluso .ds4-ready
```

Se tutto coincide:

```text
return 0 senza rete e senza build
```

## 20.6 Checkout sporco

Se il runtime esiste ed è sporco:

- fallire;
- non fare `rm -rf`;
- non fare checkout distruttivo;
- mostrare solo path e motivo, non contenuti.

La rimozione di un runtime rotto deve essere un’azione esplicita
dell’utente, non automatica.

## 20.7 Ordine avvio

```text
1 config effettiva
2 modello/backend DS4
3 virtualenv Agno se abilitato
4 Agent UI build se abilitata
5 Node DS4-Studio
6 AgentOS su autoStart o click
7 Agent UI su autoStart o click
```

## 20.8 Ordine shutdown

In `frontend/server/index.mjs`:

```text
1 smettere di accettare nuove richieste
2 cancellare gate tool
3 chiudere sessioni tool
4 fermare timer sweep
5 fermare crawl/research dipendenti
6 fermare Agent UI
7 fermare AgentOS
8 fermare ds4-server/wrapper
9 chiudere Vite
10 drenare/chiudere HTTP
```

## 20.9 Test shell

- source definisce funzione;
- esecuzione standalone;
- default effettivo;
- enabled;
- disabled;
- lock invalido;
- command substitution nel lock;
- origin inatteso;
- checkout sporco;
- build marker mancante;
- version mismatch;
- frozen lock;
- fast path senza network;
- marker atomico;
- nessun file temporaneo residuo.

## 20.10 Gate

Due avvii consecutivi non reinstallano né ricostruiscono e lo shutdown non
lascia processi.

---

# 21. Fase 14 — parità e test funzionali

## 21.1 Elenco canonico full

```text
bash
read
write
edit
search
list
retrieve_context_blob
sage
web_search
web_read
crawl
research_discover
chat_history_search
page_snapshot
page_action
page_task
```

## 21.2 Test Node di parità

`agnoToolParity.test.mjs`:

```javascript
assert.deepEqual(
  new AgnoToolPolicy({
    enabled: true,
    profile: "full"
  }).allowedToolNames(),
  AGENT_TOOL_NAMES
);
```

Inoltre:

- ogni nome ha metadata;
- ogni nome ha schema;
- nessun duplicato;
- digest deterministico;
- ordine stabile.

## 21.3 Test Python di parità

Con catalogo mock:

```python
assert [tool.name for tool in tools] == expected_names
assert len(tools) == 16
assert catalog.catalog_digest == expected_digest
```

Confrontare schema normalizzato per ogni tool.

## 21.4 Test cross-process

Avviare un server Node di test su loopback con porta effimera.

Python:

1. scarica `/catalog`;
2. valida digest;
3. costruisce le `Function`;
4. invoca almeno `read`;
5. verifica la chiamata a `executeTool`.

Artefatto:

```json
{
  "protocolVersion": 1,
  "nodeCatalogCount": 16,
  "pythonToolCount": 16,
  "missing": [],
  "extra": [],
  "digestMatch": true
}
```

Scriverlo in una directory temporanea, non nel repository.

## 21.5 Matrice funzionale

| Tool | Fixture | Oracle |
|---|---|---|
| `read` | `input.txt` | testo atteso |
| `list` | directory temp | nomi attesi |
| `search` | token unico | match e linea |
| `write` | path temp | file creato |
| `edit` | testo unico | sostituzione |
| `bash` | comando innocuo | stdout |
| `sage` | mock autorevole | richiesta e risultato |
| `web_search` | mock | query inoltrata |
| `web_read` | mock | URL e testo |
| `crawl` | mock service | manifest |
| `research_discover` | mock | fonti |
| `chat_history_search` | history fake | risultato |
| `retrieve_context_blob` | blob fixture | contenuto |
| `page_snapshot` | mock | snapshot |
| `page_action` | mock | action |
| `page_task` | mock | task |

Il test deve attraversare:

```text
Function → client Python → route Node → service → executeTool mock
```

Non è sufficiente chiamare direttamente `executeTool()`.

## 21.6 Negativi per ogni tool

- argomento mancante;
- tipo errato;
- tool negato;
- timeout;
- abort;
- errore executor.

Filesystem:

- `../`;
- path assoluto esterno;
- symlink escape.

Bash:

- tentativi di leggere file con `cat`, `head`, `tail`, `sed`, `awk`;
- devono seguire la stessa policy dell’agente nativo.

## 21.7 Nessuna rete nei test automatici

Mock obbligatori:

```text
web
crawl
research
PageAgent
Sage se richiede servizio esterno
```

## 21.8 Gate

Sedici tool passano almeno un percorso positivo end-to-end e uno negativo
di schema/policy.

---

# 22. Suite finale

## 22.1 Node Agno

```bash
cd frontend
rtk test node --test --test-concurrency=1 \
  server/agno/*.test.mjs
```

## 22.2 Node agent core

```bash
cd frontend
rtk test node --test \
  server/agentToolCatalog.test.mjs \
  server/agentToolSchema.test.mjs \
  server/agentTools.test.mjs \
  server/agentSession.test.mjs \
  server/toolOutputCompressor.test.mjs
```

## 22.3 Frontend

```bash
cd frontend
rtk test node --test src/agno/*.test.mjs
rtk npm run test:frontend
rtk npm run build
```

## 22.4 Python

```bash
cd agno_service
rtk test .venv/bin/python -m pytest tests -q
```

Ripetere con rilevamento task pendenti:

```bash
rtk proxy timeout 120s .venv/bin/python -m pytest tests -vv
```

Il timeout è una cintura di sicurezza, non il criterio di successo.

## 22.5 Shell

```bash
rtk test bash tests/test_srun_agno_bootstrap.sh
rtk test bash tests/test_srun_agno_agent_ui_bootstrap.sh
rtk test bash tests/test_agno_agent_ui_upstream_lock.sh
```

## 22.6 Statico

```bash
rtk proxy agno_service/.venv/bin/python -m compileall \
  agno_service/src/ds4_agno
rtk proxy node --check frontend/server/index.mjs
rtk proxy node --check frontend/server/agno/agnoToolRoutes.mjs
rtk proxy node --check frontend/server/agno/agnoModelGateway.mjs
rtk git diff --check
```

## 22.7 Regressione allargata

Eseguire i gruppi:

```text
agent
Sage
crawl
research
PageAgent
context
config
process manager
Agno
```

Non saltare un gruppo perché i test mirati sono verdi.

---

# 23. Smoke live massimo 120 secondi

## 23.1 Config temporanea

```json
{
  "agno": {
    "enabled": true,
    "autoStart": true,
    "tools": {
      "enabled": true,
      "profile": "full",
      "maxInflight": 1,
      "maxQueued": 8
    },
    "agentUi": {
      "enabled": true,
      "autoStart": false
    }
  }
}
```

Non committare la configurazione temporanea.

## 23.2 Avvio

```bash
rtk proxy timeout 120s ./srun.sh
```

## 23.3 Health

Verificare:

```text
Node running
AgentOS healthy
Agent UI build ready
native agent inactive
nodeCatalogCount=16
agentToolCount=16
digestMatch=true
parity=true
capabilities.text=true
capabilities.images=false
capabilities.ocr=false
```

## 23.4 Run `read`

Prompt:

```text
Usa il tool read per leggere le prime dieci righe di README.md.
Riporta il risultato del tool e poi sintetizzalo.
```

Oracle:

```text
tool_call read
tool_result read
risposta finale
nessuna bash
```

## 23.5 Run Sage

Prompt:

```text
Usa Sage per fattorizzare x^4 - 1 e verifica l’espansione.
```

Oracle:

```text
tool_call sage
tool_result sage
risposta finale coerente
```

## 23.6 Text-only

Dal pannello:

- nessun controllo allegati;
- badge “Solo testo” visibile.

Contro la route custom, inviare un campo `images`: atteso `415`.

Contro AgentOS native, inviare multipart con un file immagine: atteso:

```text
415 AGNO_TEXT_ONLY
```

Contro il gateway, inviare `image_url`: atteso:

```text
422 AGNO_TEXT_ONLY
zero richieste a ds4-server
```

Non verificare OCR, perché OCR non fa parte del sistema.

## 23.7 Concorrenza

Due tool simultanei:

```text
massimo inflight osservato = 1
secondo in coda
entrambi completano in ordine
```

## 23.8 Conflitto agente nativo

Avviare agente nativo DS4 e tentare una run Agno.

Atteso:

```text
409 NATIVE_AGENT_ACTIVE
zero chiamate modello
zero chiamate tool
```

## 23.9 Shutdown

Dopo stop:

```text
nessun processo Agent UI
nessun processo AgentOS
nessun child tool
gate modello 0/0
gate tool 0/0
sessioni tool 0
nessun file token nel frontend build
```

---

# 24. Sicurezza

## 24.1 Token

Controllare il valore reale dei token senza stamparlo:

- leggere in memoria;
- cercare il valore nei soli artefatti build/log;
- riportare solo conteggio match.

Target:

```text
frontend/dist
.runtime/agno-agent-ui/.next
data/agno/tool-audit
log di test
```

Atteso: zero.

## 24.2 Route interne

Per ogni route tool:

```text
token assente → 401
token errato → 403
token giusto → contratto normale
```

Confronto token timing-safe.

## 24.3 SSRF

Il base URL:

- viene generato da Node;
- viene validato da `Settings`;
- non è sovrascrivibile per singola call;
- non segue redirect;
- ignora proxy.

## 24.4 Payload

- request bounded;
- response bounded;
- history bounded;
- ID bounded;
- niente prototype pollution;
- niente media/base64;
- niente path costruiti da ID raw.

## 24.5 Audit

Ogni record contiene:

```text
timestamp
runId
sessionId
toolName
argumentDigest
isError
guarded
durationMs
contentBytes
```

Non contiene:

```text
argomenti raw
comando bash completo
contenuto write/edit
history
token
risultato completo
```

---

# 25. Gate di accettazione

| ID | Requisito |
|---|---|
| AGF-001 | il sidecar riceve tre token distinti |
| AGF-002 | il token tool non raggiunge browser o Agent UI |
| AGF-003 | URL bridge solo loopback e senza redirect/proxy |
| AGF-004 | builder duplicato eliminato |
| AGF-005 | catalogo canonico unico lato Node |
| AGF-006 | profilo full espone 16 tool |
| AGF-007 | Python valida protocollo, schemi e digest |
| AGF-008 | Agno registra 16 `Function` nel profilo full |
| AGF-009 | ogni `Function` chiama il tool corretto |
| AGF-010 | `build_default_agent` imposta `send_media_to_model=False` |
| AGF-011 | `build_default_agent` imposta `store_media=False` |
| AGF-012 | route custom rifiuta media |
| AGF-013 | route native rifiuta file |
| AGF-014 | gateway rifiuta content non testuale |
| AGF-015 | nessun OCR o modello vision introdotto |
| AGF-016 | status confronta count e digest end-to-end |
| AGF-017 | catalogo pubblico viene dal sidecar |
| AGF-018 | eventi tool start/result correlati |
| AGF-019 | terminale run unico |
| AGF-020 | cancellazione termina child e libera gate |
| AGF-021 | session sweep attivo e arrestabile |
| AGF-022 | request/response/history bounded |
| AGF-023 | prototype pollution bloccata |
| AGF-024 | audit privo di argomenti raw e token |
| AGF-025 | `read` E2E |
| AGF-026 | `write` E2E in sandbox temporanea |
| AGF-027 | `edit` E2E in sandbox temporanea |
| AGF-028 | `bash` E2E bounded |
| AGF-029 | `sage` E2E autorevole |
| AGF-030 | web/crawl/research/PageAgent con mock |
| AGF-031 | gate modello massimo 1 |
| AGF-032 | gate tool massimo 1 |
| AGF-033 | conflitto agente nativo fail-closed |
| AGF-034 | nessun secondo modello |
| AGF-035 | suite Node verde |
| AGF-036 | suite Python verde e senza hang |
| AGF-037 | suite frontend verde |
| AGF-038 | suite shell verde |
| AGF-039 | build frontend verde |
| AGF-040 | bootstrap Agent UI frozen e idempotente |
| AGF-041 | smoke live entro 120 secondi |
| AGF-042 | shutdown senza processi orfani |

Ogni gate deve essere marcato `PASS` con comando e risultato. `SKIP`,
`EXPECTED FAILURE` o “non testato” non valgono come completamento.

---

# 26. Sequenza di implementazione e commit

La sequenza consigliata riduce il rischio:

1. baseline e fix hang test Python;
2. limiti/sicurezza bridge Node;
3. environment sidecar;
4. Settings Python;
5. client e contratti Python;
6. conversione `RunContext`;
7. factory `Function`;
8. builder agente e text-only;
9. bootstrap `create_app` e lifespan;
10. eventi tool;
11. status/catalogo pubblico;
12. frontend;
13. cancellazione;
14. bootstrap Agent UI;
15. parità ed E2E;
16. smoke e report.

Commit suggeriti, solo dopo test e `gitnexus_detect_changes()`:

```text
agno: harden node tool bridge contracts
agno: pass tool bridge configuration to sidecar
agno: add authenticated python tool bridge client
agno: register canonical ds4 tools in agent
agno: enforce text-only model boundary
agno: expose real tool health and catalog
agno: correlate tool events in studio panel
agno: complete cancellation and session cleanup
agno: make agent ui bootstrap reproducible
agno: certify tool parity and end-to-end flows
```

Non includere nello stesso commit modifiche estranee già presenti nel
worktree.

---

# 27. Rollback

## 27.1 Rollback operativo

La prima leva è:

```json
{
  "agno": {
    "tools": {
      "enabled": false
    }
  }
}
```

Effetto:

- AgentOS resta disponibile per chat testuale;
- nessun catalog fetch;
- nessuna `Function`;
- nessuna route tool esegue;
- nessun secondo modello.

## 27.2 Disabilitare tutto Agno

```json
{
  "agno": {
    "enabled": false
  }
}
```

Il DS4 agent nativo deve continuare a funzionare.

## 27.3 Rollback per fase

| Fase | Rollback |
|---|---|
| Bridge Node | non montare route interne e tools disabled |
| Client Python | tools disabled; nessun fetch |
| Factory | agente con `tools=[]` |
| Eventi UI | mantenere risposta testuale, nascondere timeline |
| Agent UI | `agentUi.enabled=false` |
| Bootstrap | usare runtime già certificato, senza ricostruire |

Il rollback non deve mai riattivare input media o OCR.

---

# 28. Definition of Done

L’integrazione è finalizzata soltanto quando sono vere tutte queste
affermazioni:

1. Agno usa l’unico modello DS4 già caricato.
2. Il modello riceve soltanto testo.
3. Immagini, OCR, audio, video e file sono dichiarati non supportati.
4. Input media viene rifiutato, non ignorato silenziosamente.
5. Il profilo full registra sedici `Function`.
6. Schemi e descrizioni provengono dal catalogo canonico Node.
7. Le esecuzioni passano sempre da `executeTool()`.
8. Policy, GitNexus guard, bash guard, Sage, PageAgent e limiti restano
   quelli del runtime DS4.
9. Count, nomi e digest coincidono tra Node e sidecar.
10. Il pannello mostra call e result correlati.
11. Cancel libera processo, gate e sessione.
12. Nessun token raggiunge browser, build, audit o log.
13. Le suite terminano senza hang.
14. Il bootstrap è frozen, idempotente e non distruttivo.
15. Lo smoke live passa entro 120 secondi.
16. Lo shutdown lascia zero processi orfani.

Fino ad allora lo stato corretto da riportare è:

```text
Agno integrato a livello di lifecycle e modello,
ma finalizzazione agentica non ancora certificata.
```
