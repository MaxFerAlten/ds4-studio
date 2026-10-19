# Architecture Decision Records

ADR-001…010 sono quelli del piano (§41), confermati dall'implementazione. ADR-011…013 nascono
dall'implementazione.

| ADR | Stato | Decisione | Conseguenza osservata |
|---|---|---|---|
| 001 Nessuna patch a DS4 | ACCEPTED | sidecar esterno, zero shadow patch | fingerprint before/after identici (reports/upstream-fingerprint.json) |
| 002 Un solo modello residente | ACCEPTED | `max_inflight=1`, gate + proxy unico | `max_observed_inflight == 1` nei test di concorrenza |
| 003 H2 upstream come core di riferimento | ACCEPTED | pin SHA, solo punti d'estensione pubblici | vendor `git status` pulito; test upstream verdi |
| 004 Non-regressione e conservatività | ACCEPTED | baseline sempre candidata, hard prima di soft, no auto-adoption | rafforzato da ADR-013 |
| 005 Sandbox rootless obbligatoria | ACCEPTED | rete assente, UDS whitelisted, cap risorse | L3 19/19 |
| 006 Memoria esperienze separata | ACCEPTED | store con provenance/TTL/conflitti | nessuna interazione con compaction/KV DS4 |
| 007 UI DS4 non modificata | ACCEPTED | CLI + UDS | – |
| 008 API native per task | CONDITIONAL → **BLOCKED_API** | solo POC OpenCode + staging skill | DS4_NATIVE_BLOCKERS.md |
| 009 Privacy, niente cloud | ACCEPTED | solo endpoint loopback numerici | `harness2[bridge]` (LiteLLM/Google auth) non installato |
| 010 Nessuna gestione di altre integrazioni | ACCEPTED | h2ds4 non tocca Agno/OpenWiki/Crawl/Vitronia/Halogen | – |
| 011 Surface DS4 derivata | ACCEPTED | `DS4_SURFACE` = OpenCode surface con trigger in `systemprompt.md` dopo `H2DS4_DYNAMIC_GUIDANCE`, `plugin_dir=None`, stesso `name` (prompt H2 indicizzati per nome) | `guardrails.md` resta byte-identico anche con l'autotrigger H2 |
| 012 bwrap + `systemd-run --user --scope` invece di Podman | ACCEPTED | nessuna immagine da scaricare/pinnare; cgroup reali per pids/memoria/CPU; `RLIMIT_NPROC` scartato (conta per UID su tutto il sistema) | preflight fail-closed se manca la delega cgroup |
| 013 Validazione holdout obbligatoria prima di approve | ACCEPTED | `overlay validate` (paired, stessa famiglia, task generatore escluso): 0 regressioni critiche e CI95 inferiore ≥ −tolleranza | A/B: skill imparate su dev regrediscono trap holdout (2 regressioni nel transfer); approve ora le blocca |
