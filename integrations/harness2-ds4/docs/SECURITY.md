# Sicurezza

## Barriere effettive (non affidate al prompt)

| Minaccia (plan §8) | Barriera | Test |
|---|---|---|
| T01 prompt injection | policy fuori dal prompt; contenuti task/osservazioni = dati; scan contenuti candidati | `test_sec014_016_*`, `test_policy_rejects_injected_candidate` |
| T02 path traversal / TOCTOU | `validate_relpath` (NFC, no `..`, no `//`, no backslash/NUL/ctrl) + scrittura `dirfd`/`O_NOFOLLOW`/`O_EXCL`; letture rifiutano symlink/hardlink/device | `test_ut006_*`, `test_sec001_002_003_*` |
| T03 sandbox escape | bwrap `--unshare-all --cap-drop ALL --clearenv`, `/usr` ro, niente home/DS4/GPU/socket demoni | `test_sec007_008_*`, `test_home_ssh_and_host_proc_invisible` |
| T04 exfiltration | netns senza rete; solo socket d'inferenza bind-mountato; proxy whitelist, niente redirect, `trust_env=False` | `test_sec004_005_006_*`, `test_sec023_*`, `test_sec024_*` |
| T05 supply chain | pin SHA H2, `uv.lock`, SBOM CycloneDX, notice licenze, pip-audit 0 vuln | `LICENSES/`, `reports/cve-scan.json` |
| T06 candidate poisoning | manifest immutabile verificato byte per byte; nessun token d'approvazione scritto dal modello | `test_manifest_validation_rejects_tampering` |
| T07 benchmark leakage | gold/evaluator mai montati nel sandbox solver; giudizio dopo il freeze | `test_sec017_*`, `test_sec018_*` |
| T08 DoS | cgroup `TasksMax`/`MemoryMax`/`CPUQuota`, workspace tmpfs con ENOSPC, timeout + stop dello scope | `test_sec011/012/013/028_*` |
| T09 local spoofing | socket 0600 in dir 0700 di proprietà; lock esclusivo; nessun unlink di socket estranei/vivi; bearer admin 0600 | `test_sec019/020_*`, `test_ct016_*`, `test_double_sidecar_refused` |
| T10 segreti nei log | allowlist campi evento + pattern di redazione; nessun raw prompt/output salvato | `test_ut019_*`, `test_parse_events_*` |
| T11 eval gaming | evaluator deterministico host-side; il giudice LLM non c'è in fase 1 | `test_sec018_*` |
| T12 race | CAS su stato esperimento, approvazione e pointer, dentro `BEGIN IMMEDIATE` | `test_ut016_*`, `test_approval_requires_valid_candidate_and_cas` |

Bug reali trovati dai test e corretti: (1) il proxy rifiutava richieste senza consumare il
body e riusava la connessione keep-alive → desincronizzazione del framing (stile request
smuggling); ora `Connection: close` su ogni risposta. (2) uvicorn ri-solleva SIGTERM dopo lo
shutdown e saltava la pulizia (socket orfano); ora il segnale viene catturato senza re-raise.

## Limiti dichiarati

- Un processo malevolo con **lo stesso UID** può leggere il token admin e il DB: la catena
  hash dell'audit rileva manomissioni accidentali, non un attaccante con scrittura sul DB.
- Il sandbox monta in sola lettura `/usr` dell'host e (solo per `opencode_local`) la directory
  del pacchetto OpenCode; nessun'altra parte di `$HOME`.
- Lo scan dei contenuti è un tripwire a denylist, non la barriera: la barriera è il sandbox.
- Il gate d'inferenza serializza solo il traffico del sidecar; non vede la UI DS4. Da qui
  l'ack obbligatorio della finestra di manutenzione (opzione B del plan §18.2).
- `systemd --user` con controller `cpu memory pids` delegati è un prerequisito: senza,
  `preflight()` fallisce e nessun rollout parte (fail closed).
- Il test L3 è stato eseguito su questo host (Linux 7.2, bwrap 0.9.0, systemd user):
  19/19 PASS, 0 SKIPPED. Su un altro host va rieseguito (`scripts/verify-sandbox.sh`).
