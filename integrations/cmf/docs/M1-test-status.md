# M1 — Stato dei test

28 ottobre 2026, branch `feature/deepseek-infer`; HEAD prima delle correzioni
`bd38ef65`. Impronte e ambiente: `M1-verification.json`.

Comando dalla directory `integrations/cmf`:
`rtk proxy env PYTHONPATH=src python3 -m unittest discover -s tests`.

**84 test, 84 PASS, 0 FAIL, 0 SKIP; exit 0.** Tutti i 58 nomi del contratto
sono presenti. I 21 casi mancanti sono ora implementati e superati.
Review reciproca Codex completata, con prove indipendenti del peer.

**G1: PASS per il sidecar standalone.** G0 e i gate d'integrazione DS4
restano aperti: nessuna certificazione di TTFT/PSS con GGUF, compaction,
chat template o release. AF_UNIX reale e socketpair passati senza skip.

| Ticket | Caso previsto | Stato |
|---|---|---|
| M1-01 | `test_help_without_io_or_external_dependencies` | PASS (`test_bootstrap.py`) |
| M1-01 | `test_python_and_fts_capabilities` | PASS (`test_bootstrap.py`) |
| M1-01 | `test_default_off_and_config_precedence` | PASS (`test_bootstrap.py`) |
| M1-01 | `test_unix_only_permissions_and_peer` | PASS |
| M1-01 | `test_second_server_and_stale_socket` | PASS |
| M1-01 | `test_http_json_contract_roundtrip` | PASS (socketpair) |
| M1-01 | `test_request_bounds_and_framing` | PASS |
| M1-01 | `test_slow_client_timeout_and_shutdown` | PASS (`test_acceptance_gaps.py`) |
| M1-01 | `test_errors_and_logs_are_content_free` | PASS (`test_acceptance_gaps.py`) |
| M1-01 | `test_no_outbound_or_ds4_mutation` | PASS (`test_acceptance_gaps.py`) |
| M1-02 | `test_empty_database_and_reapply` | PASS |
| M1-02 | `test_dry_run_has_no_side_effects` | PASS |
| M1-02 | `test_checksum_drift_and_future_schema` | PASS |
| M1-02 | `test_crash_migration_and_restore_copy` | PASS |
| M1-02 | `test_pragmas_and_foreign_keys_per_connection` | PASS |
| M1-02 | `test_cross_scope_relations_and_updates` | PASS (`test_acceptance_gaps.py`) |
| M1-02 | `test_schema_has_only_m1_projections` | PASS (`test_acceptance_gaps.py`) |
| M1-03 | `test_text_digest_roundtrip_and_dedup` | PASS |
| M1-03 | `test_redaction_precedes_persistence` | PASS |
| M1-03 | `test_blob_limit_and_utf8_prefix` | PASS |
| M1-03 | `test_atomic_write_fsync_and_enospc` | PASS (`test_acceptance_gaps.py`) |
| M1-03 | `test_symlink_hardlink_and_traversal` | PASS |
| M1-03 | `test_ds4_id_format_hash_and_readonly` | PASS |
| M1-03 | `test_ds4_missing_corrupt_or_unsaved_source` | PASS (`test_acceptance_gaps.py`) |
| M1-03 | `test_digest_is_not_an_access_capability` | PASS (`test_acceptance_gaps.py`) |
| M1-04 | `test_principal_is_host_derived` | PASS |
| M1-04 | `test_project_agent_and_session_isolation` | PASS |
| M1-04 | `test_all_read_and_admin_paths_enforce_scope` | PASS |
| M1-04 | `test_first_append_commits_event_and_outbox` | PASS |
| M1-04 | `test_retry_same_payload_is_idempotent` | PASS |
| M1-04 | `test_retry_conflict_covers_full_envelope` | PASS |
| M1-04 | `test_identical_text_distinct_events_and_scopes` | PASS |
| M1-04 | `test_retry_survives_redaction_revision` | PASS (`test_acceptance_gaps.py`) |
| M1-04 | `test_concurrent_retry_and_busy_budget` | PASS (`test_acceptance_gaps.py`) |
| M1-04 | `test_crash_blob_sql_ack_windows` | PASS |
| M1-04 | `test_failure_rolls_back_event_and_outbox` | PASS (`test_acceptance_gaps.py`) |
| M1-04 | `test_reasoning_and_actor_spoofing_rejected` | PASS |
| M1-04 | `test_random_append_retry_invariants` | PASS (`test_acceptance_gaps.py`) |
| M1-05 | `test_episode_text_and_evidence_contract` | PASS |
| M1-05 | `test_checkpoint_blocks_on_earlier_pending` | PASS |
| M1-05 | `test_checkpoint_tolerates_numeric_seq_gaps` | PASS |
| M1-05 | `test_projection_crash_retry_is_atomic` | PASS |
| M1-05 | `test_rebuild_preserves_ids_and_evidence` | PASS |
| M1-05 | `test_rebuild_switch_and_failure` | PASS (`test_acceptance_gaps.py`) |
| M1-05 | `test_unicode_exact_paths_and_error_ids` | PASS |
| M1-05 | `test_quotes_operators_empty_and_term_caps` | PASS |
| M1-05 | `test_scope_precedes_limit_and_ranking` | PASS |
| M1-05 | `test_ties_limits_and_cli_project` | PASS (`test_acceptance_gaps.py`) |
| M1-05 | `test_recall_has_no_trust_or_write_effect` | PASS |
| M1-05 | `test_lag_and_source_integrity` | PASS |
| M1-05 | `test_projection_memory_is_bounded` | PASS (`test_acceptance_gaps.py`) |
| M1-06 | `test_online_wal_snapshot_consistent_cut` | PASS (`test_backup_hardening.py`) |
| M1-06 | `test_partial_copy_checksum_and_enospc` | PASS |
| M1-06 | `test_restore_new_directory_and_replay` | PASS |
| M1-06 | `test_restore_dry_run_and_existing_destination` | PASS |
| M1-06 | `test_backup_owner_and_no_credentials` | PASS |
| M1-06 | `test_external_ds4_dependencies_are_explicit` | PASS (`test_backup_hardening.py`) |
| M1-06 | `test_manifest_paths_and_version_untrusted` | PASS (`test_backup_hardening.py`) |

Casi aggiuntivi alla tabella contrattuale:

- `test_acceptance_gaps.py::TestStorageAcceptance.test_initial_blob_directories_are_durable` — PASS
- `test_acceptance_gaps.py::TestStorageAcceptance.test_future_migration_refusal_preserves_delete_database` — PASS
- `test_acceptance_gaps.py::TestStorageAcceptance.test_owner_readonly_uri_preserves_literal_store_path` — PASS
- `test_acceptance_gaps.py::TestTransportAcceptance.test_drip_client_cannot_extend_request_deadline` — PASS
- `test_acceptance_gaps.py::TestTransportAcceptance.test_cli_does_not_print_sensitive_error_detail` — PASS
- `test_acceptance_gaps.py::TestTransportAcceptance.test_unhandled_transport_error_is_content_free` — PASS
- `test_acceptance_gaps.py::TestTransportAcceptance.test_busy_store_returns_degraded` — PASS
- `test_backup.py::TestBackup.test_snapshot_manifest_cannot_omit_database_blob` — PASS
- `test_backup_hardening.py::TestBackupHardening.test_rejects_symlink_components_and_hardlinks` — PASS
- `test_backup_hardening.py::TestBackupHardening.test_manifest_types_and_duplicate_keys` — PASS
- `test_backup_hardening.py::TestBackupHardening.test_database_schema_and_checksum_checked_before_publish` — PASS
- `test_backup_hardening.py::TestBackupHardening.test_key_is_exactly_32_bytes` — PASS
- `test_backup_hardening.py::TestBackupHardening.test_copied_blob_is_reverified_after_validation` — PASS
- `test_backup_hardening.py::TestBackupHardening.test_schema_is_checked_on_the_bytes_copied` — PASS
- `test_backup_hardening.py::TestBackupHardening.test_enospc_snapshot_has_no_published_or_partial_copy` — PASS
- `test_backup_hardening.py::TestBackupHardening.test_restore_does_not_load_database_into_python_memory` — PASS
- `test_backup_hardening.py::TestBackupHardening.test_publish_does_not_replace_racing_empty_directory` — PASS
- `test_backup_hardening.py::TestBackupHardening.test_manifest_limit_refuses_without_publish` — PASS
- `test_eventlog.py::TestEventlog.test_client_cannot_claim_user_actor` — PASS
- `test_fts.py::TestFts.test_query_rejects_lone_surrogate` — PASS
- `test_projection.py::TestProjection.test_pending_survives_empty_server_cycle` — PASS
- `test_projection.py::TestProjection.test_not_due_rows_are_not_retried` — PASS
- `test_projection.py::TestProjection.test_projector_reschedules_pending_batch` — PASS
- `test_projection.py::TestProjection.test_projector_retries_after_unexpected_failure` — PASS
- `test_transport.py::TestTransport.test_scope_not_disclosed_over_transport` — PASS
- `test_transport.py::TestTransport.test_restart_projects_pending_without_observe` — PASS

Le regressioni coprono startup OFF/FTS, errori content-free anche fuori
handler, busy 503, deadline totale contro client drip, URI SQLite con ?/#,
migrazioni future senza mutazioni, fsync directory al primo ingest,
manifest/schema non fidati e race A/B/A nella copia del restore.
Backup: manifest limitato a 16 MiB, copia 128 KiB, publish Linux renameat2
no-replace e SQLite immutable via fd. Nessuna dipendenza Python aggiuntiva.
