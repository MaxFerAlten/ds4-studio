# Operazioni

Nessun comando qui avvia, ferma, riavvia o riconfigura DS4, Agno, OpenWiki, Crawl, Vitronia o
Halogen (ADR-010). Nessun `pkill`/`killall`/`fuser -k`.

## Installazione (offline-capable dopo il primo sync)

```bash
cd /mnt/crucial_ai/COPARATOR/riconciliazione-ds4-studio/ds4-studio/integrations/harness2-ds4
./scripts/install-local.sh      # verifica pin H2 1cfe254e…, uv sync --frozen in .venv
.venv/bin/h2ds4 doctor
./scripts/verify-sandbox.sh     # L3: deve dare 19 passed, 0 skipped per certificare l'isolamento
```

## Configurazione

`~/.config/h2ds4/config.toml` (partire da `config/default.toml`; schema in
`config/h2ds4.schema.json`). Default: `enabled=false`, `mode="off"`. Ogni rilassamento delle
invarianti (`max_inflight≠1`, rete, provider remoto, auto-promozione, C5/C7/C8, raw prompt…)
viene rifiutato all'avvio. Override da env solo per `H2DS4_MODE`, `H2DS4_DS4_BASE_URL`,
`H2DS4_MODEL_ID`, `H2DS4_DATA_DIR`, `H2DS4_RUNTIME_DIR`, `H2DS4_CACHE_DIR`, `H2DS4_CONFIG`.

## Ciclo di lavoro

```bash
H="h2ds4 --config ~/.config/h2ds4/config.toml"
$H register --all                 # PRIMA di avviare il sidecar (prende il lock del data dir)
./scripts/start-sidecar.sh &      # oppure: systemctl --user start h2ds4.service
$H experiment create --spec examples/lab-job.json
$H experiment run <ID> --maintenance-window     # ack esplicito: nessuna sessione DS4 attiva
$H experiment status <ID>
$H experiment report <ID> --output reports/<ID>.md
$H overlay status
$H overlay diff <OVERLAY>
$H overlay validate <OVERLAY>     # paired su holdout stessa famiglia: obbligatorio per approve
$H overlay approve <OVERLAY> --reason "diff e holdout rivisti"
$H overlay activate <OVERLAY> --reason "prossimo avvio volontario"   # solo mode=approved
$H overlay export-skills <OVERLAY> --destination ~/.local/share/h2ds4/staged-skills
./scripts/stop-sidecar.sh
```

`activate` sposta solo il pointer esterno (`approved/current.json`) e risponde
`APPROVED_NOT_APPLIED`: DS4 non ha API per caricare skill per task né hot-reload.
`export-skills` crea una copia verificata (skill canoniche + approvate) e **stampa** il comando
di avvio manuale `DS4_SKILLS_DIR="<staged>" <DS4_ROOT>/srun.sh`; h2ds4 non lo esegue mai.
Eseguirlo solo dopo aver chiuso le sessioni attive. Nota WP16: nel checkout canonico
`/mnt/crucial_ai/COPARATOR/ds4` il loop JS non legge `DS4_SKILLS_DIR` (solo `srun.sh` la
esporta); in `riconciliazione-ds4-studio/ds4-studio` sì (`agentSystemText.mjs`).

## Modello reale (L5)

Prerequisiti: modello già caricato da DS4 su `127.0.0.1:8002`, finestra di manutenzione,
`ds4.model_id` letto da `curl -s http://127.0.0.1:8002/v1/models`.

```bash
H2DS4_LIVE=1 H2DS4_MODEL_ID=<id> .venv/bin/pytest -m model_live -q
```

Verificato il 2026-10-19 con `deepseek-v4-flash`: il probe L5 e lo smoke `opencode_local`
sono passati; provider offline, parsing JSONL e 4 chiamate instradate dal proxy sono stati
provati nel sandbox. Il binario v2.0.32 è ammesso solo con SHA-256
`489b51816a77809e841310e80c88e834c28c19ad1639e12ba8a19f08b47ab607`; qualunque altro digest
resta fail-closed. Il commit H2 upstream (`23fb5e05`, v1.14.18) non è stato sostituito.

## Rollback (plan §38.1)

| Livello | Azione |
|---|---|
| R0 | `./scripts/stop-sidecar.sh` — DS4 resta attivo |
| R1 | `h2ds4 experiment cancel <ID>` — termina solo lo scope `h2ds4-run-*` della run |
| R2 | `h2ds4 overlay rollback --expected-revision N --reason …` — pointer atomico |
| R3 | avviare DS4 senza `DS4_SKILLS_DIR` personalizzato — skill canoniche |
| R4 | DB: backup `state.sqlite3*` prima di upgrade; migrazioni con checksum, nessun drop automatico |
| R5 | disinstallazione: `rm -r` del repository e, su richiesta separata, di `~/.local/share/h2ds4`, `~/.cache/h2ds4`, `$XDG_RUNTIME_DIR/h2ds4` |

## Recovery

- Crash del sidecar: al riavvio il worker marca `FAILED WORKER_LOST` gli esperimenti con lease
  orfano; **non** rilancia rollout (tool con side effect).
- Socket stale: `start-sidecar.sh --recover-stale` (lo elimina solo se nessuno risponde e il
  lock del data dir è nostro). Socket estraneo o vivo: mai cancellato.
- `h2ds4 audit verify`: verifica la catena hash (non resiste a chi ha accesso in scrittura al DB:
  limite dichiarato).

## Prova zero-patch

```bash
./scripts/audit-upstream.sh --root /mnt/crucial_ai/COPARATOR/ds4 \
    --compare reports/baseline/ds4-canonical.before.json
```
Ogni esperimento rifà anche internamente il fingerprint dei checkout configurati prima/dopo.
