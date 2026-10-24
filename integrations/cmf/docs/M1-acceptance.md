# M1 — Contratto proposto e criteri di accettazione

24 ottobre 2026 — **PROPOSTA IN REVIEW**, non implementazione o test superati.
Owner: Codex; reviewer: Claude Code. Piano v1.0: §36, §5–8.3, §10.3,
§29, §32.1–32.2 e G1. Branch unico: `feature/deepseek-infer`.
M0 discovery richiede correzioni e review; G0 completo resta aperto per la
baseline real-model. L'avanzamento standalone M1 non certifica DS4.

## Scope e prova

- Solo Python 3.12 + stdlib, `sqlite3` con FTS5. Ambiente osservato:
  Python 3.12.3, SQLite 3.45.1; verificare capability a ogni startup.
- Nessuna dipendenza esterna, installazione da rete, hook DS4, UI, embedding,
  reflection, generazione, iniezione o mutazione dei blob DS4.
- Servizio HTTP/JSON esclusivamente AF_UNIX, con `http.server.BaseHTTPRequestHandler`
  e server Unix basato su `socketserver`. Nessun listener TCP o fallback remoto.
- I nomi `test_*` sotto sono i nomi previsti per pytest. Per mantenere zero
  dipendenze, implementarli come metodi `unittest.TestCase`, scopribili anche da
  pytest senza fixture/plugin obbligatori. Runner canonico: dalla directory
  `integrations/cmf`, `PYTHONPATH=src python3 -m unittest discover -s tests -v`.
- CLI da sorgente: `PYTHONPATH=src python3 -m ds4_cmf.cli --help`; launcher
  `scripts/cmf` equivalente, senza installare setuptools, build o pytest.
  `pyproject.toml` registra metadata/Python richiesto e dipendenze vuote;
  wheel/editable install non sono attestati da questo gate.
- Fixture locali e directory temporanee; niente clone, branch o worktree.
  Ogni caso produce PASS/FAIL/NOT_RUN con commit, digest dei file non committati
  e ambiente. Tutti i casi seguenti sono inizialmente NOT_RUN.

## Contratto

### Tipi, identità e confine di fiducia

Tipi immutabili (`dataclass(frozen=True)`; nessun dict mutabile nei grant):

```python
Grant(project_id: str, operation: str, agent_id: str | None)
Principal(principal_id: str, user_id: str, agent_id: str | None,
          instance_id: str, grants: frozenset[Grant])
SessionBinding(project_id: str, session_id: str, agent_id: str)
EventInput(event_key: str, project_id: str, session_id: str,
           event_type: str, occurred_at: str, text: str | None,
           ds4_blob_id: str | None)
BlobRef(sha256: str, byte_len: int, source_kind: str, root_id: str | None)
ObserveResult(event_id: str, seq: int, deduplicated: bool)
ProjectionResult(checkpoint: int, pending: int, blocked_seq: int | None)
SearchHit(memory_id: str, event_seq: int, text: str, source_sha256: str,
          truncated: bool, verification: str, trust_taint: str)
SearchResult(items: tuple[SearchHit, ...], as_of_seq: int, fts_checkpoint: int)
```

Operazioni: `observe`, `search`, `source.read`, `source.raw`, `admin`.
Un grant ordinario vale per un progetto **e un agente**; `agent_id=None` è
un grant di progetto per owner esplicitamente provisionato, non un wildcard
implicito. `admin` di progetto consente binding, export e replay di quel progetto;
backup/restore dell'intero store richiedono separata autorità store-owner.

AF_UNIX: directory 0700, socket 0600, controllo Linux `SO_PEERCRED` (UID del
servizio). Ulteriore credenziale opaca ad alta entropia in `Authorization: Bearer`
mappata a Principal da configurazione host protetta 0600, mai dal JSON client.
Credenziali non in argv, URL, log, DB o backup. Assenza/errore = 401; niente
principal owner implicito. La CLI usa lo stesso middleware, non grant autonomi.
UID/cookie/progetto da soli non bastano. Processi ostili con lo stesso UID e
accesso ai file di credenziali non sono isolati da questa soluzione single-user.
Nessuna integrazione cookie Node in M1; il mapping host Node è lavoro M2.

Project e session binding sono creati dall'owner mediante provisioning offline
a servizio fermo; un client observe non crea progetti/sessioni o cambia agent.
Origin, agent_id, recorded_at, trust, verification ed event_id sono assegnati
dal server; non sono campi accettati nel payload. M1 ammette eventi di testo
`USER_MESSAGE`, `AGENT_RESPONSE_FINAL`, `TOOL_RESULT`, `TOOL_ERROR` senza attribuire
autorità USER a un tipo dichiarato. Tutti restano UNVERIFIED e UNTRUSTED.
In M1 `USER_MESSAGE` produce `actor_type=EXTERNAL`: il tipo è dichiarato dal
client e non attesta un utente umano.
`REASONING` e tipi ignoti sono rifiutati; nessuna raccolta chain-of-thought.

### API minima e limiti

| Operazione | Endpoint | Risultato |
|---|---|---|
| health autenticato | `GET /v1/health` | versione, stato; niente testo, path, credenziali o statistiche di altri progetti |
| observe | `POST /v1/events` | 201 primo append; 200 retry identico; event_id, seq, deduplicated |
| ricerca manuale | `POST /v1/recall` | 200 SearchResult, evidence IDs e watermark, senza rinforzo |
| fonte autorizzata | `GET /v1/sources/{event_id}` | testo redatto completo; il digest da solo non concede accesso |

Nessuna route HTTP di snapshot in M1: backup e restore sono operazioni CLI
offline, con lock dello store e autorizzazione owner.

Payload observe: `schema_version=1` più EventInput, campi sconosciuti rifiutati.
Esattamente uno tra `text` e `ds4_blob_id`; limite testo UTF-8 1 MiB (1,048,576
byte), input e risultato della redazione. Body JSON massimo 8 MiB per consentire
escaping JSON del testo; lettura bounded prima del parse, non fidarsi solo di
Content-Length. Reject duplicate keys, NaN/Infinity, UTF-8 invalido, surrogate
isolati, JSON annidato oltre limite e valori scalari al posto dell'oggetto.
Timestamp UTC normalizzati con precisione microsecondi; niente date ambigue.
ID opachi non vuoti, massimo 128 byte; nessun ID usato come path arbitrario.
Recall: project_id, query <= 4096 byte, limit intero 1..64; scope agente dal
Principal. HTTP/1.0 con chiusura dopo risposta, timeout lettura/scrittura 2 s;
Content-Length unico obbligatorio sui POST, niente chunked/Transfer-Encoding,
limiti header e numero header. Servizio seriale iniziale, backlog bounded.

Envelope errori: `{"error":{"code":"SCHEMA","message":"invalid request"}}`;
nessuno stacktrace, payload, token, digest sensibile o esistenza cross-scope.

| HTTP | code | Significato |
|---|---|---|
| 400 | SCHEMA | JSON, campi, query o framing non validi |
| 401 | AUTH_REQUIRED | credenziale assente/non valida o peer non ammesso |
| 403 | SCOPE | operazione negata senza informazioni sulla risorsa |
| 404 | NOT_VISIBLE | risorsa inesistente oppure non visibile, stessa risposta |
| 409 | IDEMPOTENCY_CONFLICT / VERSION_CONFLICT | retry divergente / schema incompatibile |
| 413 | LIMIT | limiti body, testo o risposta |
| 429 | BUDGET | capacità richiesta esaurita |
| 503 | DEGRADED / SOURCE_UNAVAILABLE | storage occupato/pieno/corrotto o fonte non verificabile |
| 504 | DEADLINE | deadline applicativa scaduta |

Transport framing deve chiudere la connessione senza HTML default contenente
input. Le route sconosciute danno 404; metodi non supportati 405 JSON.
Errori interni: 500 INTERNAL generico. Le CLI restituiscono exit 0 solo su
successo, nonzero su errore; JSON su stdout, diagnostica redatta su stderr.

### Moduli e funzioni pubbliche proposte

Root: `integrations/cmf/src/ds4_cmf/`; `__init__.py` senza I/O/import side effects.
Tipi sopra in `domain/events.py` e `domain/identity.py`. Settings immutabile in
`config.py`; Context è un oggetto interno di servizio, non serializzabile dal client.
Le firme sono contratti, non snippet già implementati.

```python
# config.py
load_settings(path: Path) -> Settings  # tomllib; path canonici, limiti, auth
# domain/identity.py
ensure_scope(p: Principal, project_id: str, operation: str,
             agent_id: str | None = None) -> None
# api/auth.py
authenticate(peer_uid: int, authorization: str | None,
             settings: Settings) -> Principal
# api/errors.py
CmfError(code: str, status: int)  # messaggio pubblico da mapping fisso
# api/server.py
make_server(settings: Settings) -> socketserver.UnixStreamServer
# storage/sqlite.py
connect(path: Path, *, readonly: bool = False) -> sqlite3.Connection
provision_session(db: sqlite3.Connection, p: Principal,
                  binding: SessionBinding) -> None
# storage/migrations.py
migrate(path: Path, migrations_dir: Path, *, dry_run: bool = False) -> tuple[int, ...]
# ingest/redact.py
redact_text(text: str, *, revision: str) -> str
# storage/blobs.py
put_text(root: Path, text: str) -> BlobRef  # solo testo già redatto
read_text(root: Path, ref: BlobRef, *, max_bytes: int) -> str
resolve_ds4_blob(root: Path, blob_id: str, *, max_bytes: int) -> BlobRef
# storage/eventlog.py
observe(ctx: Context, p: Principal, event: EventInput) -> ObserveResult
get_source(ctx: Context, p: Principal, event_id: str) -> str
# storage/projection.py
project_pending(ctx: Context, *, max_events: int = 64) -> ProjectionResult
rebuild_fts(ctx: Context, p: Principal, *, project_id: str,
            dry_run: bool = False) -> ProjectionResult
# search/fts.py
build_match(query: str) -> str | None
search(ctx: Context, p: Principal, *, project_id: str,
       query: str, limit: int = 10) -> SearchResult
# storage/backup.py
snapshot(ctx: Context, owner: Principal, destination: Path) -> Path
restore(snapshot_dir: Path, destination: Path, *, settings: Settings,
        owner: Principal, dry_run: bool = False) -> None
# cli.py
main(argv: Sequence[str] | None = None) -> int
```

Storage helper senza Principal è **interno al servizio**, mai route/tool pubblico.
Chiamarlo soltanto dopo autorizzazione; ogni lettura esposta risolve l'evento e
lo scope prima del blob. Il resolver DS4 riceve root da configurazione owner
associata al progetto, non dalla richiesta. Nessun file:// fornito dal client.
CLI minima: help, serve, health, observe, search --project, source, admin
provision, check, rebuild --dry-run, snapshot, restore --dry-run. Amministrazione
diretta offline acquisisce lo stesso lock store; `snapshot` e `restore` sono solo
offline, senza route HTTP. Niente bypass implicito owner.

### Testo, blob, evento ed EPISODE

1. Autenticare e verificare grant/binding prima di leggere o creare fonti.
2. Testo inline: validare, redigere, conservare **tutto il testo redatto** in blob
   CMF immutabile `blobs/sha256/<64hex>.txt`. Hash sui byte UTF-8 conservati.
   La sorgente CMF è dichiarata `REDACTED_TEXT`, con redaction_revision; non è
   presentata come copia dell'originale. Originale inline non persistito.
   Redazione deterministica versionata (es. token canary, Bearer, blocchi PEM),
   senza promettere rilevamento universale PII; log privi di contenuti per default.
3. Fonte DS4: id esattamente `sha256:` + 64 cifre esadecimali minuscole;
   risolvere `<root>/sha256/<hex>.txt`, verificare file regolare, link, dimensione
   e digest; mai scrivere nella root DS4. Richiedere `source.raw` per ingest.
   In M1 limite di lettura/hash DS4 1 MiB: rifiuto esplicito oltre soglia, nessun
   ACK/indicizzazione parziale. Supporto streaming di log enormi rimandato.
   Salvare riferimento originale verificato e blob CMF redatto completo, con
   digest distinti; se original_saved=false dal futuro adapter, non accettare
   il riferimento come prova di originale disponibile.
4. Fsync file e directory prima del commit SQLite. In caso di crash precedente
   al commit è ammesso un blob orfano, mai un evento ACK con fonte CMF mancante.
5. In `BEGIN IMMEDIATE`: ricontrollare grant/binding e idempotenza, inserire
   evento + source refs + outbox FTS; COMMIT precede ogni ACK. Un writer logico,
   lock per store anche fra processi, retry SQLITE_BUSY bounded, foreign_keys=ON,
   WAL e synchronous=FULL. Errori = rollback completo, nessun falso successo.
6. `event_id` UUID assegnato al primo append; `event_key` stabile dall'host.
   **Adattamento proposto a §5.1:** UNIQUE(project_id, agent_id, event_key), per
   non collidere né rivelare eventi fra principal diversi. Sessione è nel digest
   di richiesta: riusare la chiave con altra sessione è conflitto. Due chiavi
   distinte con identico testo restano due eventi, pur condividendo il blob.
   Digest canonico server-side della richiesta valida (testo originale incluso,
   senza credenziali) per riconoscere anche retry con segreti diversi che la
   redazione renderebbe uguali. Salvare il digest, mai il testo originale;
   timestamp recorded_at/event_id generati sono esclusi dal confronto.
   Una nuova redaction_revision non trasforma un retry identico in un evento nuovo.
7. Proiettore deterministico: un `memory_unit` per evento, ID `episode:<event_id>`,
   kind EPISODE, owner_agent_id dal binding, UNVERIFIED, confidence=0, UNTRUSTED.
   `text` è il prefisso UTF-8 valido di massimo **N=16,384 byte** del blob redatto;
   `truncated`, dimensione completa e digest espliciti. Fonte completa recuperabile.
   Testo vuoto produce EPISODE/link ma nessun hit lessicale; nessuna estrazione LLM.
8. `evidence_link(memory_id,event_seq,OBSERVED_IN)` unico; span sul blob redatto
   `[0, byte_len_del_prefisso)`, non sull'originale DS4. Il link alla fonte DS4
   resta separato. Revision di redazione/proiezione e N salvati per replay.
9. memory_unit, link, DELETE+INSERT FTS, outbox DONE e checkpoint avanzano nella
   stessa transazione. Niente outbox graph/embedding placeholder in M1.

Una riga `PENDING` fallita attende `next_retry_at` con backoff; i poll prima della
scadenza non la riprovano e non scrivono. Altri eventi possono essere proiettati,
ma il checkpoint resta sul massimo `seq` committato precedente al primo pending.
Il servizio continua i poll finché esiste backlog e si ferma quando la coda è vuota.

`source_blobs` deduplica byte, non autorizzazioni: l'accesso dipende dai link a
eventi visibili. FK semplici non provano scope; verificare tutte le relazioni
session/event/memory/evidence e gli UPDATE, con constraint compositi o controlli
transazionali. Nessuna promozione di verità durante observe/search/rebuild.

### Checkpoint, ricerca, migrazione e backup

- Checkpoint FTS è la massima frontiera **contigua degli eventi committati** già
  proiettati. Non significa seq numericamente senza buchi: AUTOINCREMENT può
  saltare numeri. Un evento precedente pending/fallito impedisce l'avanzamento;
  nessun salto silenzioso in dead-letter. Retry/restart non duplicano righe/link.
- Ricerca filtra progetto e agente autorizzati prima di limit/ranking; non un
  filtro su top-k globale. MATCH parametrizzato, termini Unicode letterali con
  escape delle virgolette, massimo 12 termini/96 caratteri, phrase poi OR bounded;
  query senza termini dà zero hit. Ordine BM25 crescente, tie-break memory_id.
  Nessuna scrittura su recall. Watermark/lag sono relativi allo scope richiesto,
  calcolati sui suoi eventi, senza esporre backlog di altri progetti. Una sola
  snapshot SQLite per hit e watermark; fonte corrotta/mancante non restituita
  come valida. Nessun campo VERIFIED attribuito automaticamente.
- Migrazioni 0001_core/0002_fts, checksum e versione registrati, applicazione
  atomica e backup pre-migrazione verificato. Schema futuro/drift: rifiuto senza
  modifica. Dry-run non crea DB, directory, lock persistente o socket. Rollback
  su copia pre-migrazione, non DROP dei record durabili.
- Rebuild usa stage + switch transazionale, preserva IDs/evidenze canoniche e
  vecchia vista finché la nuova è verificata. Con writer serializzato, nessun
  evento acquisito durante rebuild può essere perso. Dati di altri scope invariati.
- Backup online con sqlite3.Connection.backup, manifest versionato, high-water
  dalla copia DB, digest/dimensioni di tutti e soli i blob referenziati da quella
  snapshot, poi publish atomico. Niente copia ingenua del solo file SQLite WAL.
  Credenziali e testo nei log esclusi. Restore in destinazione nuova, verifica
  integrale prima del publish; non sovrascrive DB vivo o destinazione esistente.
- Per fonti DS4 il backup include il riferimento e la copia CMF redatta, non
  esporta implicitamente raw DS4. Manifest dichiara dipendenze esterne e
  `portable=false`. Restore completo richiede root DS4 autorizzata e digest
  risolvibili; altrimenti fallisce senza pubblicare, non attesta recupero raw.
- Le prove M1 non attestano forget globale/erasure WAL-backup (M6), qualità
  semantica, TTFT, PSS con GGUF o compatibilità compaction/KV.

## Casi di accettazione

Ogni riga indica `tests/<file>.py::Classe.test_nome` (classe liberamente nominata).
I nomi qui riportati sono univoci; test negativi devono controllare sia errore
sia assenza di mutazioni o leakage. Ripetizioni/property test usano loop e seed
stdlib deterministici, senza Hypothesis. Nessuno skip vale come PASS.

### M1-01 — Bootstrap e trasporto (§36, §7, §29)

| File | Nome pytest previsto | Oracle |
|---|---|---|
| test_bootstrap.py | test_help_without_io_or_external_dependencies | Import e --help con solo src+stdlib, nessun file/socket/rete creato |
| test_bootstrap.py | test_python_and_fts_capabilities | Versione Python, SQLite e FTS5 registrate; FTS5 assente fallisce prima del servizio |
| test_bootstrap.py | test_default_off_and_config_precedence | Nessun autostart; CLI > env definita > TOML; unset distinto da false |
| test_transport.py | test_unix_only_permissions_and_peer | Directory/socket 0700/0600, peer UID verificato; nessun bind AF_INET/AF_INET6 |
| test_transport.py | test_second_server_and_stale_socket | Seconda istanza rifiutata senza unlink del socket vivo; stale socket rimosso solo dopo prova owner/tipo/inattività |
| test_transport.py | test_http_json_contract_roundtrip | Health/observe/recall/source con HTTP/JSON Unix; codici e Content-Length corretti |
| test_transport.py | test_request_bounds_and_framing | Limiti a confine e +1; duplicati CL, chunked, JSON invalido, duplicate key, profondità e UTF-8 rifiutati |
| test_transport.py | test_slow_client_timeout_and_shutdown | Client incompleto chiuso entro timeout; dopo il timeout un altro client funziona; shutdown libera solo socket proprio |
| test_transport.py | test_errors_and_logs_are_content_free | 4xx/5xx e log non espongono payload, token, traceback, path o altri scope |
| test_bootstrap.py | test_no_outbound_or_ds4_mutation | Suite con outbound negato; nessuna importazione servizi DS4 o modifica di config/upstream |

### M1-02 — Schema e migrazioni (§5, §32)

| File | Nome pytest previsto | Oracle |
|---|---|---|
| test_migrations.py | test_empty_database_and_reapply | 0001/0002 applicate una volta, versione/checksum stabili al retry |
| test_migrations.py | test_dry_run_has_no_side_effects | Piano leggibile, path assente resta assente, DB esistente byte-invariato |
| test_migrations.py | test_checksum_drift_and_future_schema | Rifiuto della migrazione alterata o DB più nuovo, senza scritture |
| test_migrations.py | test_crash_migration_and_restore_copy | Crash fra DDL/versione: vecchio stato valido o commit completo; copia pre-migrazione ripristinabile |
| test_migrations.py | test_pragmas_and_foreign_keys_per_connection | WAL/FULL e FK effettivi; connessioni readonly non modificano stato |
| test_migrations.py | test_cross_scope_relations_and_updates | Session, agent, event, evidence e memory non collegabili fuori scope anche tramite UPDATE |
| test_migrations.py | test_schema_has_only_m1_projections | Tabelle/indici richiesti presenti, nessun job/vector/graph fittizio necessario al replay |

### M1-03 — Blob e provenienza (§5, §8.3, §23, §29)

| File | Nome pytest previsto | Oracle |
|---|---|---|
| test_blobs.py | test_text_digest_roundtrip_and_dedup | UTF-8 inclusi vuoto/Unicode, SHA dei byte salvati, due fonti identiche condividono storage |
| test_blobs.py | test_redaction_precedes_persistence | Canarie Bearer/PEM/token non in DB/WAL/blob/log/backup; revision e sorgente REDACTED_TEXT esplicite |
| test_blobs.py | test_blob_limit_and_utf8_prefix | 1 MiB accettato, +1 rifiutato; prefisso N non spezza caratteri multibyte |
| test_blobs.py | test_atomic_write_fsync_and_enospc | Fault su write/fsync/rename: nessun evento ACK; blob finale assente o integro |
| test_blobs.py | test_symlink_hardlink_and_traversal | Link in root/componenti/finale, nlink>1 e traversal rifiutati; nessun accesso fuori root anche durante sostituzione concorrente |
| test_blobs.py | test_ds4_id_format_hash_and_readonly | Prefisso+64 lowercase hex, mapping esatto, rehash contenuto; raw DS4 byte/mtime invariati |
| test_blobs.py | test_ds4_missing_corrupt_or_unsaved_source | Digest errato, file mancante, oversized o original_saved=false non diventano fonte attestata |
| test_blobs.py | test_digest_is_not_an_access_capability | Conoscere hash di altro progetto non autorizza read/dedup disclosure |

### M1-04 — Ingest, auth e outbox (§6, §7, §8.3, §29)

| File | Nome pytest previsto | Oracle |
|---|---|---|
| test_acl.py | test_principal_is_host_derived | Token map+peer costruiscono principal; campi principal/grants/agent/origin client rifiutati |
| test_acl.py | test_project_agent_and_session_isolation | Progetto giusto ma agente/sessione altrui rifiutati; grant owner esplicito controllato |
| test_acl.py | test_all_read_and_admin_paths_enforce_scope | Search/source/rebuild/backup/restore/export non aggirano grant; inesistente e invisibile indistinguibili |
| test_eventlog.py | test_first_append_commits_event_and_outbox | 201 soltanto dopo blob durevole+event/outbox atomici; IDs server-side |
| test_eventlog.py | test_retry_same_payload_is_idempotent | Molti retry restituiscono stesso event_id/seq, una sola outbox |
| test_eventlog.py | test_retry_conflict_covers_full_envelope | Stessa chiave con testo, sessione, tempo, tipo o blob diversi: 409, nessun effetto; inclusi segreti redatti uguali |
| test_eventlog.py | test_identical_text_distinct_events_and_scopes | Chiavi distinte => eventi distinti; stessa chiave locale in scope diversi indipendente |
| test_eventlog.py | test_retry_survives_redaction_revision | Retry identico dopo aggiornamento redattore non crea evento o blob nuovo |
| test_eventlog.py | test_concurrent_retry_and_busy_budget | Due richieste stessa chiave: un append; busy esaurito dà errore bounded, mai ACK falso |
| test_eventlog.py | test_crash_blob_sql_ack_windows | Crash dopo blob/prima commit/dopo commit prima ACK: nessuna fonte mancante; retry recupera commit senza duplicare |
| test_eventlog.py | test_failure_rolls_back_event_and_outbox | Fault fra INSERT event/outbox elimina entrambi, nessuna mezza transazione |
| test_eventlog.py | test_reasoning_and_actor_spoofing_rejected | REASONING, VERIFIED e provenienza USER dichiarata non accettati; `USER_MESSAGE` è EXTERNAL e resta untrusted |
| test_eventlog.py | test_random_append_retry_invariants | Sequenze seeded con retry/out-of-order: unicità per scope/key e corrispondenza evento-outbox-fonte |

### M1-05 — Proiezione, FTS e replay (§10.3, §32, §46)

| File | Nome pytest previsto | Oracle |
|---|---|---|
| test_projection.py | test_episode_text_and_evidence_contract | ID stabile, text prefisso redatto, OBSERVED_IN/span corretto, fonte completa recuperabile |
| test_projection.py | test_checkpoint_blocks_on_earlier_pending | Evento precedente fallito impedisce avanzamento anche se successivo processato |
| test_projection.py | test_checkpoint_tolerates_numeric_seq_gaps | Gap senza evento committato non blocca; pending reale non viene saltato |
| test_projection.py | test_projection_crash_retry_is_atomic | Fault fra unit/link/FTS/checkpoint: rollback o commit completo, retry senza duplicati |
| test_projection.py | test_rebuild_preserves_ids_and_evidence | Replay versionato produce stessi IDs/testi/link e risultati; eventi canonici invariati |
| test_projection.py | test_rebuild_switch_and_failure | Stage fallita lascia vista attiva; switch verificato atomico, nessun evento perso e altri progetti invariati |
| test_fts.py | test_unicode_exact_paths_and_error_ids | Fixture IT/EN, path e codici errore recuperano evidence IDs attesi |
| test_fts.py | test_quotes_operators_empty_and_term_caps | Quote/operatori non diventano sintassi arbitraria; vuoto zero hit, 12 termini/96 caratteri rispettati |
| test_fts.py | test_scope_precedes_limit_and_ranking | Distrattori migliori di altro scope non occupano top-k; nessun contenuto vietato |
| test_fts.py | test_ties_limits_and_cli_project | Ordine stabile, limit 1..64; CLI richiede progetto esplicito e restituisce provenance |
| test_fts.py | test_recall_has_no_trust_or_write_effect | Recall ripetuti non cambiano confidence, verification, eventlog, feedback o pesi |
| test_fts.py | test_lag_and_source_integrity | Worker fermo espone lag del solo scope; fonte assente/corrotta non restituita come valida |
| test_fts.py | test_projection_memory_is_bounded | max_events/N/body/response limit rispettati con grande fixture; tracemalloc non cresce linearmente col corpus intero |

### M1-06 — Backup e restore (§36, §29, §32)

| File | Nome pytest previsto | Oracle |
|---|---|---|
| test_backup.py | test_online_wal_snapshot_consistent_cut | Writer attivo: backup.sqlite integro, manifest/high-water dalla copia, tutti i blob necessari presenti |
| test_backup.py | test_partial_copy_checksum_and_enospc | Backup incompleto/corrotto non pubblicato; restore rifiuta checksum/length mismatch |
| test_backup.py | test_restore_new_directory_and_replay | Restore in altra directory mantiene eventi, IDs, link, ricerca e integrità |
| test_backup.py | test_restore_dry_run_and_existing_destination | Dry-run zero scritture; destinazione occupata/live non sovrascritta |
| test_backup.py | test_backup_owner_and_no_credentials | Non-owner rifiutato, token/config auth esclusi, segreti canary assenti |
| test_backup.py | test_external_ds4_dependencies_are_explicit | Manifest portable=false; fonte DS4 non risolvibile impedisce restore completo senza publish |
| test_backup.py | test_manifest_paths_and_version_untrusted | Path traversal, symlink, file inattesi e manifest/schema incompatibili rifiutati prima di scrivere |

## G1 e punti da approvare

G1 standalone passa quando tutti i casi applicabili sopra sono PASS, la CLI e
il servizio Unix eseguono observe→ACK→FTS→source→backup→restore→replay, upstream
rimane identico e la review incrociata conferma assenza di accessi fuori scope.
Test non eseguiti o copertura dichiarata ma non implementata mantengono G1 aperto.
Il budget FTS p95 <=150 ms va misurato su corpus/dimensione/hardware dichiarati;
non sostituisce i test funzionali né certifica latenza con GGUF residente.
Annotare separatamente lint/typecheck esterni non eseguiti: nessuna dipendenza
aggiunta per simularli; compilazione/import e test stdlib obbligatori.

Richiesta review Claude: (1) token host+peer e grant per agente; (2) solo blob
redatto CMF, N=16 KiB e limite DS4 1 MiB; (3) unicità event_key scoped e digest
completo; (4) checkpoint contiguo su eventi committati; (5) backup con dipendenze
DS4 esplicite; (6) unittest/source launcher invece di pytest/build dependency.
Nessuno di questi adattamenti deve diventare una deviazione silenziosa dal piano.
