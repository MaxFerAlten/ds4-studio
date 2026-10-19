# API HTTP-over-UDS (protocollo 1)

Trasporto: HTTP/1.1 su `$XDG_RUNTIME_DIR/h2ds4/h2ds4.sock` (0600). Nessuna porta TCP.
Ogni route `/v1/*` richiede `X-H2DS4-Protocol: 1` (altrimenti `426 BAD_PROTOCOL`).
Body JSON ≤ 1 MiB con `Content-Length`; `Transfer-Encoding` rifiutato. Header > 8 KiB → 413.
Nessuna route `/docs`, `/openapi.json`, nessun endpoint di esecuzione generico.

| Metodo | Path | Ruolo | Note |
|---|---|---|---|
| GET | `/health/live` | – | anche in `off` |
| GET | `/health/ready` | – | solo storage, mai il modello |
| GET | `/v1/capabilities` | lettura | matrice substrate (nativo = BLOCKED_API) |
| POST | `/v1/experiments` | lettura+modo | `Idempotency-Key` obbligatoria; body = `ExperimentCreate` |
| GET | `/v1/experiments` | lettura | ultimi 50 |
| GET | `/v1/experiments/{id}` | lettura | stato, revisione, run, decisione sintetica |
| POST | `/v1/experiments/{id}/run` | modo | `Idempotency-Key`; body `{"maintenance_ack": "I confirm no DS4 chat or agent session is active"}` |
| POST | `/v1/experiments/{id}/cancel` | modo | idempotente |
| GET | `/v1/experiments/{id}/candidates` | lettura | manifest/validazione |
| GET | `/v1/experiments/{id}/evidence` | lettura | punteggi, ledger R/P, totali proxy (niente payload grezzi) |
| GET | `/v1/overlays` | lettura | pointer, revisione, `applied_status` |
| POST | `/v1/overlays/{id}/approve` | admin | `{expected_active_digest, reason}` — CAS |
| POST | `/v1/overlays/{id}/activate` | admin | `{expected_revision, reason}` — solo pointer, esito `APPROVED_NOT_APPLIED` |
| POST | `/v1/overlays/rollback` | admin | `{expected_revision, reason}` |
| GET | `/v1/audit?after=&limit=` | admin | catena hash |

Admin = `Authorization: Bearer <contenuto di $XDG_DATA_HOME/h2ds4/admin.token>`.

## Policy per modalità

| mode | create lab | create propose | run | approve | activate | rollback |
|---|---|---|---|---|---|---|
| off | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| observe | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| lab | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ |
| propose | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| approved | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Errori

Corpo `{"error": "<CODE>", "detail": "<testo breve>"}`, mai stacktrace o path.
`INVALID_INPUT 400`, `UNAUTHORIZED 401`, `FORBIDDEN 403`, `NOT_SUPPORTED 404`,
`METHOD_NOT_ALLOWED 405`, `CONFLICT 409`, `PROFILE_MISMATCH 409`, `TOO_LARGE 413`,
`POLICY_DENIED 422`, `BAD_PROTOCOL 426`, `BUDGET_EXCEEDED 429`, `INTERNAL_ERROR 500`,
`INTEGRITY_FAILURE 500`, `CAPABILITY_MISSING 501`, `BLOCKED_API 501`, `PROTOCOL_ERROR 502`,
`MODEL_BUSY 503`, `SANDBOX_UNAVAILABLE 503`, `UPSTREAM_UNAVAILABLE 503`, `DEADLINE_EXCEEDED 504`.

## Proxy d'inferenza (solo per il sandbox)

`GET /v1/models` (solo il modello pinnato), `POST /v1/chat/completions` (chiavi allowlist,
`model` = profilo, `n=1`, `max_tokens ≤ cap`, budget pre-addebitato, gate 1-inflight, ricontrollo
`/v1/models` upstream prima di ogni richiesta, redirect rifiutati, `Connection: close`).
Tutto il resto: 404/405.

Client: `src/h2ds4/client.py` (CLI) e `node-client/src/client.mjs` (strumenti esterni; non
va importato nel server Node di DS4).
