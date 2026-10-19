# Capability matrix (true | false | unknown)

Fonte: discovery statica read-only (`reports/discovery.json`) + stato del backend al momento
dell'implementazione (2026-10-19: nessun processo in ascolto su `127.0.0.1:8002`).

| Capability | ds4 canonico | ds4-studio | Fonte |
|---|---|---|---|
| `GET /v1/models` | true | true | `ds4_server.c` router |
| `POST /v1/chat/completions` | true | true | `ds4_server.c` router |
| altre route `/v1` | completions, messages, responses | idem | `ds4_server.c` |
| `tools` / `tool_choice` nel body chat | true | true | parser `ds4_server.c` |
| `stream_options.include_usage` | true | true | `ds4_server.c` |
| `/v1/token-count` | false | false | assente nel router |
| reservation busy via HTTP | false | false | `model_busy` solo interno |
| porta backend configurata | 8002 | 8002 | `frontend/ds4-ui.config.json` |
| modello raggiungibile ora | unknown (spento) | unknown (spento) | `curl /v1/models` → connection refused |
| tool calls strutturate vs DSML | unknown | unknown | richiede `probe_live` (L5) |
| usage affidabile su backend Vulkan | unknown | unknown | richiede L5 |
| `DS4_SKILLS_DIR` in `srun.sh` | true | true | `srun.sh:5` |
| `DS4_SKILLS_DIR` letto dal loop JS | false | true | `agentSystemText.mjs` |
| override skill per richiesta | false | false | nessuna API |
| `/api/runs/:runId` + cancel | false | true | `index.mjs` |
| workspace task isolato | false | false | nessuna API |

## Ambiente sidecar (verificato su questo host)

| Capability | Stato |
|---|---|
| bwrap userns + netns + loopback | true (bwrap 0.9.0) |
| `/dev/dri`, `/dev/kfd` nascosti nel sandbox | true |
| `systemd-run --user --scope` con cpu/memory/pids delegati | true |
| bind-mount di un singolo socket UDS nel sandbox | true (CIR-001) |
| Python 3.12 / 3.13 | 3.12.3 / assente (test solo 3.12) |
| OpenCode | v2.0.15 binario (H2 pinna `23fb5e05` v1.14.18) → UNVERIFIED |
| Podman rootless | presente, non usato (bwrap scelto: ADR-012) |
