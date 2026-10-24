-- CMF 0002: EPISODE memory units, evidence links and FTS5 view (plan §5.2).
-- memory_units/evidence_links/memory_fts are a projection of events: they
-- are rebuildable from the log and are written only by the projector.

CREATE TABLE memory_units (
  memory_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  owner_agent_id TEXT NOT NULL,
  memory_kind TEXT NOT NULL CHECK (memory_kind IN
    ('EPISODE','FACT','DECISION','CONSTRAINT','OBSERVATION',
     'PROCEDURE','TASK_STATE','ERROR','EVIDENCE')),
  text TEXT NOT NULL,
  truncated INTEGER NOT NULL CHECK (truncated IN (0,1)),
  full_byte_len INTEGER NOT NULL CHECK (full_byte_len >= 0),
  source_sha256 TEXT NOT NULL REFERENCES source_blobs(blob_sha256),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  verification TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification IN
    ('UNVERIFIED','CORROBORATED','VERIFIED','CONTRADICTED','SUPERSEDED','REVOKED')),
  salience REAL NOT NULL DEFAULT 0 CHECK (salience BETWEEN 0 AND 1),
  trust_taint TEXT NOT NULL DEFAULT 'UNTRUSTED',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retired_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  extractor_fingerprint TEXT NOT NULL
);
CREATE INDEX idx_memory_scope_kind
  ON memory_units(project_id, owner_agent_id, memory_kind, verification, retired_at);

CREATE TABLE evidence_links (
  memory_id TEXT NOT NULL REFERENCES memory_units(memory_id) ON DELETE CASCADE,
  event_seq INTEGER NOT NULL REFERENCES events(seq),
  support_type TEXT NOT NULL CHECK (support_type IN
    ('SUPPORTS','CONTRADICTS','DERIVED_FROM','OBSERVED_IN')),
  excerpt_start INTEGER,
  excerpt_end INTEGER,
  quality TEXT NOT NULL DEFAULT 'UNVERIFIED',
  PRIMARY KEY (memory_id, event_seq, support_type)
);
CREATE INDEX idx_evidence_event ON evidence_links(event_seq);

-- FKs alone do not prove scope (§5.3): a link must join a memory and an event
-- of the same project and agent, on insert and on update.
CREATE TRIGGER evidence_links_scope_insert BEFORE INSERT ON evidence_links
WHEN NOT EXISTS (
  SELECT 1 FROM memory_units m JOIN events e ON e.seq = NEW.event_seq
  WHERE m.memory_id = NEW.memory_id
    AND m.project_id = e.project_id AND m.owner_agent_id = e.agent_id)
BEGIN SELECT RAISE(ABORT, 'evidence link crosses scope'); END;

CREATE TRIGGER evidence_links_scope_update BEFORE UPDATE ON evidence_links
WHEN NOT EXISTS (
  SELECT 1 FROM memory_units m JOIN events e ON e.seq = NEW.event_seq
  WHERE m.memory_id = NEW.memory_id
    AND m.project_id = e.project_id AND m.owner_agent_id = e.agent_id)
BEGIN SELECT RAISE(ABORT, 'evidence link crosses scope'); END;

CREATE TRIGGER memory_units_scope_immutable
BEFORE UPDATE OF project_id, owner_agent_id ON memory_units
BEGIN SELECT RAISE(ABORT, 'memory scope is immutable'); END;

-- No triggers keep this in sync on purpose (§5.2): the projector writes it
-- with explicit DELETE + INSERT in the same transaction as the memory unit.
CREATE VIRTUAL TABLE memory_fts USING fts5(
  memory_id UNINDEXED, project_id UNINDEXED, owner_agent_id UNINDEXED, text,
  tokenize = 'unicode61 remove_diacritics 2'
);
