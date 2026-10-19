# Gap e blocker (WP00 → WP24)

## BLOCKED_API (nessuna patch DS4, per mandato)

- Substrate DS4 nativo: niente iniezione per task, workspace isolato, export traiettoria,
  reservation busy (`docs/DS4_NATIVE_BLOCKERS.md`). WP17 = BLOCKED_API, WP18 = NOT_APPLICABLE.
- Attivazione skill senza restart: nessuna API ⇒ `APPROVED_NOT_APPLIED`; solo export per avvio
  volontario con `DS4_SKILLS_DIR`. Nel checkout canonico il loop JS non legge nemmeno
  `DS4_SKILLS_DIR`.
- UI DS4: nessuna route di estensione ⇒ solo CLI/UDS (ADR-007).

## Non verificato (richiede azione esplicita dell'utente)

- **L5 live smoke**: `test_l5_live_model_smoke` e `test_l5_opencode_local_proxy_smoke` passano
  con `deepseek-v4-flash`; provider offline, JSONL e 4 chiamate via proxy verificati nel
  sandbox. Le capacità non persistite dalla matrice restano `unknown`.
- **L6 A/B con modello reale**: l'A/B eseguito usa il solver deterministico; misura algoritmo
  H2 + gate, non il beneficio del modello. Criteri preregistrati in
  `reports/ab/criteria.v1.json`; il 2026-10-19 l'endpoint locale `127.0.0.1:8002` rifiuta
  la connessione. Non sono stati caricati modelli né avviati task live.
- OpenCode installato v2.0.32 ≠ pin H2 `23fb5e05` (v1.14.18 via bun, assente); mitigato con
  allowlist SHA-256 immutabile del solo binario L5 provato, ogni altro resta fail-closed.
- Python 3.13 non installato: test solo su 3.12.3.
- Validazione holdout per substrate model-backed non eseguita; WP20 model-backed resta parziale.

## Scostamenti dichiarati dal piano

| Piano | Implementato | Motivo |
|---|---|---|
| Podman rootless preferito | bwrap + `systemd-run --user --scope` | nessuna immagine da pinnare/scaricare; cgroup reali verificati (ADR-012) |
| dataset ≥40 task in 6 famiglie | 40 task in 3 famiglie (json, ledger, kv) con 8 trap | famiglie tool-orchestration/docs/error-recovery/memory hanno senso solo con un agente model-backed |
| `max_model_calls=16` | invariato, ma un esperimento opencode k=1 stimato eccede ⇒ rifiutato prima dell'avvio | va tarato al primo L5 (plan §11 nota) |
| `overlay activate --mode startup-only` | `activate` = solo pointer, sempre `APPROVED_NOT_APPLIED` | nessuna modalità runtime esiste |
| selector/reflection H2 | `library=None` (reflection H2 disattivata); experience library h2ds4 propria | evita sessioni extra non contabilizzate; provenance/TTL/conflitti propri |
| — | **aggiunto** gate holdout obbligatorio prima di approve (ADR-013) | l'A/B ha mostrato regressioni nel transfer dev→holdout |

## Rischi residui

- Same-UID attacker: può leggere token admin e scrivere il DB (limite dichiarato).
- Il gate d'inferenza non vede il traffico UI: affidato all'ack della finestra di manutenzione.
- Lo scan contenuti è denylist (tripwire), non barriera.
