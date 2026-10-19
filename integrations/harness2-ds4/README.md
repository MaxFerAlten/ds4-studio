# h2ds4 — Harness² sidecar per DS4 Studio (zero-patch)

Implementazione di `docs/feature/piano.harness2.md` (v1.0.0), isolata sotto `integrations/`:
nessun file DS4 viene scritto, patchato, ricompilato o avviato.

- Harness² vendorizzato e pinnato a `1cfe254e8d25b15f37048c3730134686abe60335` (Apache-2.0),
  usato solo tramite i suoi punti d'estensione pubblici (`BenchmarkAdapter`, sottoclassi di
  `Proposer`), mai monkeypatchato o modificato.
- Sidecar Python su **Unix socket** (`0600` in dir `0700`), spento di default
  (`service.enabled=false`, `mode=off`), mai avviato da `srun.sh`.
- Esecuzione dei rollout in **sandbox rootless** (bubblewrap `--unshare-all` dentro uno scope
  `systemd --user` con `TasksMax`/`MemoryMax`/`CPUQuota`, workspace tmpfs a dimensione fissa,
  nessuna rete; il modello è raggiungibile solo tramite proxy UDS whitelisted).
- La baseline è sempre candidata: un gate post-selezione deterministico decide
  `KEEP_BASE | QUARANTINE_CANDIDATE | INCONCLUSIVE | REJECTED_SECURITY`. Nessuna promozione
  automatica; approvato ≠ applicato (`APPROVED_NOT_APPLIED`).
- Substrate DS4 nativo: **BLOCKED_API** (documentato, non simulato).

## Stato in una riga

Pipeline deterministica testata senza modello; OpenCode v2.0.32 è verificato solo con il
digest allowlisted e lo smoke L5. WP20 include il protocollo A/B e criteri preregistrati;
l'esperimento model-backed resta da eseguire quando il modello DS4 già caricato è raggiungibile
(vedi `docs/OPERATIONS.md` e `reports/ab/criteria.v1.json`).

## Uso rapido

```bash
cd /mnt/crucial_ai/COPARATOR/riconciliazione-ds4-studio/ds4-studio/integrations/harness2-ds4
./scripts/install-local.sh            # .venv da uv.lock, verifica pin H2
.venv/bin/h2ds4 doctor                # config, pin, sandbox
./scripts/run-smoke.sh json-002       # 1 task end-to-end, nessun modello, stato effimero
.venv/bin/h2ds4 ab --split holdout --k 1 --output reports/ab/holdout
./scripts/audit-upstream.sh --root /mnt/crucial_ai/COPARATOR/ds4 \
    --compare reports/baseline/ds4-canonical.before.json
```

Sidecar (solo su richiesta esplicita): copiare `config/default.toml` in
`~/.config/h2ds4/config.toml`, impostare `enabled = true` e `mode = "lab"`, poi
`./scripts/start-sidecar.sh` (foreground) oppure la unit `systemd/h2ds4.service` (non abilitata).

## Test

```bash
.venv/bin/ruff check src tests && .venv/bin/mypy src/h2ds4
.venv/bin/pytest -q                       # unit + contract + security + integration
(cd node-client && npm test)
H2DS4_LIVE=1 .venv/bin/pytest -m model_live   # solo con modello già caricato + finestra
```

## Documenti

| File | Contenuto |
|---|---|
| `docs/ARCHITECTURE.md` | componenti, flussi, gap d'interfaccia H2 |
| `docs/API.md` | contratto HTTP-over-UDS effettivo |
| `docs/OPERATIONS.md` | install, start/stop, approvazione, export skill, rollback, disinstall |
| `docs/SECURITY.md` | threat model applicato, test negativi, limiti dichiarati |
| `docs/CAPABILITY_MATRIX.md` | capability verificate/assenti per checkout |
| `docs/DS4_NATIVE_BLOCKERS.md` | perché il substrate nativo è BLOCKED_API |
| `docs/ACCEPTANCE.md` | gate G00–G27 con stato ed evidenze |
| `docs/ADR/README.md` | ADR-001…013 |
| `reports/` | WP results, discovery, fingerprint before/after, A/B, CVE scan |
