CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    request_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    result_manifest_json TEXT,
    error_json TEXT
);

CREATE TABLE IF NOT EXISTS pages (
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    page_index INTEGER NOT NULL,
    url TEXT NOT NULL,
    state TEXT NOT NULL,
    result_json TEXT,
    error_json TEXT,
    PRIMARY KEY (job_id, page_index)
);

CREATE TABLE IF NOT EXISTS events (
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (job_id, event_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache (
    cache_key TEXT PRIMARY KEY,
    manifest_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    last_accessed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    digest TEXT NOT NULL UNIQUE,
    size_bytes INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    integrity_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_refs (
    artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    field_path TEXT NOT NULL,
    PRIMARY KEY (artifact_id, owner_type, owner_id, field_path)
);

CREATE INDEX IF NOT EXISTS events_job_created
    ON events(job_id, event_id);
CREATE INDEX IF NOT EXISTS artifact_refs_owner
    ON artifact_refs(owner_type, owner_id);
