# M1 — Stato dei test

24 ottobre 2026. Eseguito sul branch `feature/deepseek-infer`, HEAD `a144d7cfd45a42713e99bf17ae1ccd10ee608ec1`.

Comando: `cd integrations/cmf && PYTHONPATH=src python3 -m unittest discover -s tests -v`.

**Risultato reale:** 46 test; 46 PASS, 0 FAIL, 0 SKIP; exit code 0. Claude ha eseguito 45/45 fuori sandbox; Codex ha aggiunto il caso di riavvio ed eseguito 46/46 sul checkout corrente. G1 **OPEN** per i casi `NOT_RUN`.

AF_UNIX `bind` ha funzionato in questa esecuzione: permessi del socket, peer credential, secondo server e socket stale sono stati verificati. Il roundtrip HTTP su `socketpair` e i test diretti del parser sono passati. I casi non implementati restano `NOT_RUN` per G1.

| Ticket | Caso previsto | Stato |
|---|---|---|
| M1-01 | `test_help_without_io_or_external_dependencies` | NOT_RUN (non implementato) |
| M1-01 | `test_python_and_fts_capabilities` | NOT_RUN (non implementato) |
| M1-01 | `test_default_off_and_config_precedence` | NOT_RUN (non implementato) |
| M1-01 | `test_unix_only_permissions_and_peer` | PASS |
| M1-01 | `test_second_server_and_stale_socket` | PASS |
| M1-01 | `test_http_json_contract_roundtrip` | PASS (socketpair) |
| M1-01 | `test_request_bounds_and_framing` | PASS |
| M1-01 | `test_slow_client_timeout_and_shutdown` | NOT_RUN (non implementato) |
| M1-01 | `test_errors_and_logs_are_content_free` | NOT_RUN (non implementato) |
| M1-01 | `test_no_outbound_or_ds4_mutation` | NOT_RUN (non implementato) |
| M1-02 | `test_empty_database_and_reapply` | PASS |
| M1-02 | `test_dry_run_has_no_side_effects` | PASS |
| M1-02 | `test_checksum_drift_and_future_schema` | PASS |
| M1-02 | `test_crash_migration_and_restore_copy` | PASS |
| M1-02 | `test_pragmas_and_foreign_keys_per_connection` | PASS |
| M1-02 | `test_cross_scope_relations_and_updates` | NOT_RUN (non implementato) |
| M1-02 | `test_schema_has_only_m1_projections` | NOT_RUN (non implementato) |
| M1-03 | `test_text_digest_roundtrip_and_dedup` | PASS |
| M1-03 | `test_redaction_precedes_persistence` | PASS |
| M1-03 | `test_blob_limit_and_utf8_prefix` | PASS |
| M1-03 | `test_atomic_write_fsync_and_enospc` | NOT_RUN (non implementato) |
| M1-03 | `test_symlink_hardlink_and_traversal` | PASS |
| M1-03 | `test_ds4_id_format_hash_and_readonly` | PASS |
| M1-03 | `test_ds4_missing_corrupt_or_unsaved_source` | NOT_RUN (non implementato) |
| M1-03 | `test_digest_is_not_an_access_capability` | NOT_RUN (non implementato) |
| M1-04 | `test_principal_is_host_derived` | PASS |
| M1-04 | `test_project_agent_and_session_isolation` | PASS |
| M1-04 | `test_all_read_and_admin_paths_enforce_scope` | PASS |
| M1-04 | `test_first_append_commits_event_and_outbox` | PASS |
| M1-04 | `test_retry_same_payload_is_idempotent` | PASS |
| M1-04 | `test_retry_conflict_covers_full_envelope` | PASS |
| M1-04 | `test_identical_text_distinct_events_and_scopes` | PASS |
| M1-04 | `test_retry_survives_redaction_revision` | NOT_RUN (non implementato) |
| M1-04 | `test_concurrent_retry_and_busy_budget` | NOT_RUN (non implementato) |
| M1-04 | `test_crash_blob_sql_ack_windows` | PASS |
| M1-04 | `test_failure_rolls_back_event_and_outbox` | NOT_RUN (non implementato) |
| M1-04 | `test_reasoning_and_actor_spoofing_rejected` | PASS |
| M1-04 | `test_random_append_retry_invariants` | NOT_RUN (non implementato) |
| M1-05 | `test_episode_text_and_evidence_contract` | PASS |
| M1-05 | `test_checkpoint_blocks_on_earlier_pending` | PASS |
| M1-05 | `test_checkpoint_tolerates_numeric_seq_gaps` | PASS |
| M1-05 | `test_projection_crash_retry_is_atomic` | PASS |
| M1-05 | `test_rebuild_preserves_ids_and_evidence` | PASS |
| M1-05 | `test_rebuild_switch_and_failure` | NOT_RUN (non implementato) |
| M1-05 | `test_unicode_exact_paths_and_error_ids` | PASS |
| M1-05 | `test_quotes_operators_empty_and_term_caps` | PASS |
| M1-05 | `test_scope_precedes_limit_and_ranking` | PASS |
| M1-05 | `test_ties_limits_and_cli_project` | NOT_RUN (non implementato) |
| M1-05 | `test_recall_has_no_trust_or_write_effect` | PASS |
| M1-05 | `test_lag_and_source_integrity` | PASS |
| M1-05 | `test_projection_memory_is_bounded` | NOT_RUN (non implementato) |
| M1-06 | `test_online_wal_snapshot_consistent_cut` | NOT_RUN (non implementato) |
| M1-06 | `test_partial_copy_checksum_and_enospc` | PASS |
| M1-06 | `test_restore_new_directory_and_replay` | PASS |
| M1-06 | `test_restore_dry_run_and_existing_destination` | PASS |
| M1-06 | `test_backup_owner_and_no_credentials` | PASS |
| M1-06 | `test_external_ds4_dependencies_are_explicit` | NOT_RUN (non implementato) |
| M1-06 | `test_manifest_paths_and_version_untrusted` | NOT_RUN (non implementato) |

Casi aggiuntivi alla tabella contrattuale:

- `test_client_cannot_claim_user_actor` — PASS
- `test_pending_survives_empty_server_cycle` — PASS
- `test_not_due_rows_are_not_retried` — PASS
- `test_projector_reschedules_pending_batch` — PASS
- `test_projector_retries_after_unexpected_failure` — PASS
- `test_restart_projects_pending_without_observe` — PASS
- `test_query_rejects_lone_surrogate` — PASS
- `test_scope_not_disclosed_over_transport` — PASS (socketpair)
- `test_snapshot_manifest_cannot_omit_database_blob` — PASS

Nessun fallimento nella suite eseguita. Restano 21 casi `NOT_RUN` della matrice di
accettazione; nessun test real-model/compaction DS4 è compreso in M1.

Il riavvio con outbox `PENDING` è coperto dal test aggiuntivo: il server riprende
la proiezione senza un nuovo observe e mantiene schedulata la riga in backoff.
