# DS4 native substrate — BLOCKED_API (WP17), WP18 NOT_APPLICABLE

Equazione di fattibilità (plan §A.3): API di run pubblica e stabile ∧ iniezione config per
task ∧ isolamento workspace ∧ export traiettoria ∧ cancellazione ∧ policy di concorrenza ∧
sicurezza indipendente dal prompt. Discovery statica read-only (`h2ds4 preflight`,
`reports/discovery.json`) sui due checkout:

| Requisito | `ds4` canonico (`0aaea5a2`) | `ds4-studio` riconciliazione (`acff3505`) | Stato |
|---|---|---|---|
| Iniezione harness/skill per task | `DS4_SKILLS_DIR` solo esportata da `srun.sh`; il server Node non la legge | letta all'avvio dello stato skill di sessione (`agentSystemText.mjs`), nessun override per richiesta | BLOCKED_API |
| Workspace isolato non legato alla UI | assente | `POST /api/agent/chat` e run ingress legati a session key / owner del thread | BLOCKED_API |
| Export traiettoria con eventi tool | assente | `GET /api/runs/:runId` = stato owner-scoped, nessun contratto di export | BLOCKED_API |
| Cancellazione | assente | `POST /api/runs/:runId/cancel` (owner-scoped) | PRESENT_UNVERIFIED |
| Reservation idle/busy | `model_busy` interno a `ds4_server.c`, nessun endpoint | idem | BLOCKED_API |
| Nessun mode switch durante il run | `POST /api/wrapper/switch-mode` esiste, nulla lo blocca | idem | BLOCKED_API |
| Plugin/extension route ufficiali in `frontend/server/index.mjs` | no | no | BLOCKED_API |

Conseguenza (ADR-008): solo POC OpenCode via inferenza DS4 + skill staging per avvio
volontario. `Ds4NativeSubstrate.preflight()` restituisce questi blocker; `execute()` solleva
`BLOCKED_API`; l'API rifiuta `substrate=ds4_native` con 501. Nessun endpoint DS4 è stato creato
per aggirare il blocco: aggiungere API a DS4 è un mandato separato (richiede ADR e
approvazione).

Test DN-001…DN-012: non eseguibili senza le API sopra (`NOT_APPLICABLE`).
