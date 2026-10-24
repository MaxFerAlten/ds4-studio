-- CMF 0001: canonical event log (plan §5.1), adapted per docs/M1-acceptance.md.
-- Deliberate deviation from §5.1: event_key is unique per (project, agent),
-- not globally, so keys never collide or leak across principals.

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','ARCHIVED','DELETED'))
);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  agent_id TEXT NOT NULL,
  model_fingerprint TEXT,
  ds4_kv_sha TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','ENDED')),
  UNIQUE (session_id, project_id, agent_id)
);

-- Redacted CMF copies only. Dedups bytes, never grants access: visibility
-- always goes through an event the principal may see.
CREATE TABLE source_blobs (
  blob_sha256 TEXT PRIMARY KEY CHECK (length(blob_sha256) = 64),
  storage_uri TEXT NOT NULL,
  byte_len INTEGER NOT NULL CHECK (byte_len >= 0),
  media_type TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('REDACTED_TEXT')),
  created_at TEXT NOT NULL
);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_key TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN
      ('USER','AGENT','TOOL','SYSTEM','EXTERNAL')),
  event_type TEXT NOT NULL CHECK (event_type IN
      ('USER_MESSAGE','AGENT_RESPONSE_FINAL','TOOL_RESULT','TOOL_ERROR')),
  source_blob_sha256 TEXT NOT NULL REFERENCES source_blobs(blob_sha256),
  ds4_blob_id TEXT,
  ds4_blob_sha256 TEXT,
  ds4_byte_len INTEGER,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  policy_label TEXT NOT NULL DEFAULT 'UNTRUSTED' CHECK (policy_label = 'UNTRUSTED'),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  content_sha256 TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  redaction_revision TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (project_id, agent_id, event_key),
  FOREIGN KEY (session_id, project_id, agent_id)
    REFERENCES sessions(session_id, project_id, agent_id),
  CHECK ((ds4_blob_id IS NULL AND ds4_blob_sha256 IS NULL AND ds4_byte_len IS NULL)
      OR (ds4_blob_id IS NOT NULL AND ds4_blob_sha256 IS NOT NULL AND ds4_byte_len IS NOT NULL))
);
CREATE INDEX idx_events_scope_time ON events(project_id, occurred_at, seq);
CREATE INDEX idx_events_session_seq ON events(session_id, seq);

-- The log is append-only in M1 (forget/erasure arrives with M6 tombstones).
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;

-- A session never moves to another project or agent.
CREATE TRIGGER sessions_binding_immutable BEFORE UPDATE OF session_id, project_id, agent_id ON sessions
BEGIN SELECT RAISE(ABORT, 'session binding is immutable'); END;

CREATE TABLE projection_outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_seq INTEGER NOT NULL REFERENCES events(seq),
  projection TEXT NOT NULL CHECK (projection IN ('fts')),
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','DONE')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error TEXT,
  UNIQUE (event_seq, projection)
);
CREATE INDEX idx_outbox_pending ON projection_outbox(projection, state, event_seq);

-- seq_committed: every committed event with seq <= this value is projected.
CREATE TABLE projection_checkpoints (
  projection TEXT PRIMARY KEY,
  seq_committed INTEGER NOT NULL DEFAULT 0,
  build_revision TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
