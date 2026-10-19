-- h2ds4 schema v1 (plan §13.1). Applied inside one transaction by migrations.py.
CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY, applied_utc TEXT NOT NULL, checksum TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_profiles (
  id TEXT PRIMARY KEY CHECK(length(id) = 71),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  created_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evaluation_profiles (
  id TEXT PRIMARY KEY CHECK(length(id) = 71),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  created_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS harnesses (
  id TEXT PRIMARY KEY CHECK(length(id) = 71),
  blob_digest TEXT NOT NULL,
  created_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_fixtures (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
  source_digest TEXT NOT NULL,
  created_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task_fixtures(id),
  profile_id TEXT NOT NULL REFERENCES model_profiles(id),
  evaluator_id TEXT NOT NULL REFERENCES evaluation_profiles(id),
  base_overlay_id TEXT NOT NULL REFERENCES harnesses(id),
  substrate TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('lab','propose')),
  k INTEGER NOT NULL CHECK(k BETWEEN 1 AND 8),
  state TEXT NOT NULL CHECK(state IN
    ('CREATED','QUEUED','PREFLIGHT','BASELINE','PROPOSING','PROBING',
     'COMPOSING','EVALUATING','QUARANTINED','REJECTED','FAILED',
     'CANCEL_REQUESTED','CANCELLED')),
  revision INTEGER NOT NULL DEFAULT 1,
  seed INTEGER NOT NULL,
  budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
  decision_json TEXT CHECK(decision_json IS NULL OR json_valid(decision_json)),
  error_code TEXT,
  created_utc TEXT NOT NULL,
  updated_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL UNIQUE REFERENCES experiments(id),
  status TEXT NOT NULL CHECK(status IN ('QUEUED','LEASED','DONE','ABANDONED')),
  lease_owner TEXT,
  lease_expires_utc TEXT,
  heartbeat_utc TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  maintenance_ack TEXT NOT NULL,
  created_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  label TEXT NOT NULL,
  harness_digest TEXT NOT NULL,
  workspace_digest TEXT NOT NULL,
  model_profile_id TEXT NOT NULL,
  envelope_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN
    ('QUEUED','RUNNING','SUCCEEDED','FAILED','TIMED_OUT','CANCELLED')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt >= 1),
  started_utc TEXT,
  finished_utc TEXT,
  token_in INTEGER CHECK(token_in >= 0),
  token_out INTEGER CHECK(token_out >= 0),
  usage_source TEXT,
  model_calls INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER CHECK(duration_ms >= 0),
  trace_digest TEXT,
  deliverable_digest TEXT,
  failure_code TEXT,
  UNIQUE(experiment_id,label,attempt)
);
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  overlay_digest TEXT NOT NULL,
  parent_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('STAGED','VALID','INVALID','REJECTED','APPROVED')),
  validation_json TEXT NOT NULL CHECK(json_valid(validation_json)),
  evidence_digest TEXT,
  created_utc TEXT NOT NULL,
  UNIQUE(experiment_id, overlay_digest)
);
CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  evaluator_id TEXT NOT NULL REFERENCES evaluation_profiles(id),
  metric_json TEXT NOT NULL CHECK(json_valid(metric_json)),
  verdict TEXT NOT NULL CHECK(verdict IN ('PASS','FAIL','INCONCLUSIVE')),
  provenance_digest TEXT NOT NULL,
  created_utc TEXT NOT NULL,
  UNIQUE(run_id,evaluator_id)
);
CREATE TABLE IF NOT EXISTS overlay_versions (
  id TEXT PRIMARY KEY,
  digest TEXT NOT NULL UNIQUE,
  parent_id TEXT REFERENCES overlay_versions(id),
  state TEXT NOT NULL CHECK(state IN ('QUARANTINED','APPROVED','RETIRED')),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  created_utc TEXT NOT NULL,
  approved_utc TEXT,
  approved_by TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  overlay_id TEXT NOT NULL REFERENCES overlay_versions(id),
  expected_active_digest TEXT NOT NULL,
  actor TEXT NOT NULL,
  intent TEXT NOT NULL CHECK(intent IN ('APPROVE','ACTIVATE','ROLLBACK')),
  reason TEXT NOT NULL,
  created_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS active_overlay (
  slot TEXT PRIMARY KEY CHECK(slot='production'),
  overlay_id TEXT REFERENCES overlay_versions(id),
  previous_overlay_id TEXT REFERENCES overlay_versions(id),
  revision INTEGER NOT NULL,
  updated_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS experience_entries (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  profile_family TEXT NOT NULL,
  source_overlay_digest TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  lesson_digest TEXT NOT NULL,
  failure_mode TEXT NOT NULL,
  cue TEXT NOT NULL,
  lesson TEXT NOT NULL,
  tags_json TEXT NOT NULL CHECK(json_valid(tags_json)),
  score_delta REAL,
  confidence REAL CHECK(confidence BETWEEN 0 AND 1),
  observed_on_tasks INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL CHECK(state IN
    ('QUARANTINED','VALIDATED','CROSS_MODEL_UNVALIDATED','CONFLICT','RETIRED')),
  expires_utc TEXT NOT NULL,
  created_utc TEXT NOT NULL,
  UNIQUE(domain,profile_family,lesson_digest)
);
CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_utc TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  outcome TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL UNIQUE,
  detail_json TEXT NOT NULL CHECK(json_valid(detail_json))
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_experiments_state ON experiments(state,updated_utc);
CREATE INDEX IF NOT EXISTS ix_runs_exp ON runs(experiment_id,status);
CREATE INDEX IF NOT EXISTS ix_exp_family ON experience_entries(domain,profile_family,state);
CREATE INDEX IF NOT EXISTS ix_jobs_status ON jobs(status,created_utc);
