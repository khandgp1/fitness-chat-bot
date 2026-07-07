-- 001_init: complete Phase 2 schema as amended by Phase 3 (P3-2, P3-8).
-- Source of truth: Claude/PHASE_2_DATA_MODEL.md §2.
-- schema_migrations is owned by the migration runner, not this file.

-- ==== Identity & lifecycle ====

CREATE TABLE clients (
  id                   TEXT PRIMARY KEY,
  display_name         TEXT NOT NULL,
  timezone             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending_verification'
                       CHECK (status IN ('pending_verification','active','blocked',
                                         'graduated','dropped')),
  created_at           TEXT NOT NULL,
  verified_at          TEXT,
  last_reconciled_date TEXT
);

CREATE TABLE channel_identities (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,
  external_id TEXT NOT NULL,
  handle      TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (channel, external_id)
);

-- ==== Conversation ====

CREATE TABLE batches (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','pending','processed')),
  primary_intent    TEXT CHECK (primary_intent IN
                    ('gm_checkin','coaching_question','status_update','other')),
  router_confidence REAL,
  needs_response    INTEGER NOT NULL DEFAULT 0,
  dismissed_at      TEXT,
  created_at        TEXT NOT NULL,
  processed_at      TEXT
);
CREATE INDEX idx_batches_client_status ON batches(client_id, status);

CREATE TABLE messages (
  id                  TEXT PRIMARY KEY,
  client_id           TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  direction           TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  text                TEXT NOT NULL,
  channel_message_ref TEXT,
  raw_payload         TEXT,
  batch_id            TEXT REFERENCES batches(id),
  draft_id            TEXT REFERENCES drafts(id),
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_messages_client_time ON messages(client_id, created_at);

-- ==== Compliance ====

CREATE TABLE compliance_days (
  client_id            TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (status IN ('unknown','compliant','miss','pending_review')),
  streak_after         INTEGER,
  resolved_at          TEXT,
  resolving_message_id TEXT REFERENCES messages(id),
  followup_state       TEXT CHECK (followup_state IN ('pending','handled','dismissed')),
  PRIMARY KEY (client_id, date)
);

CREATE TABLE classifications (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  batch_id    TEXT NOT NULL REFERENCES batches(id),
  is_valid_gm INTEGER,
  reasoning   TEXT,
  model       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_classifications_batch ON classifications(batch_id);

-- ==== Response ====

CREATE TABLE drafts (
  id                        TEXT PRIMARY KEY,
  client_id                 TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  covers_through_message_id TEXT NOT NULL REFERENCES messages(id),
  draft_text                TEXT NOT NULL,
  final_text                TEXT,
  response_type             TEXT NOT NULL,
  confidence                REAL,
  status                    TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','approved','sent','rejected','stale')),
  autonomy_level            INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL,
  resolved_at               TEXT
);
CREATE INDEX idx_drafts_client_status ON drafts(client_id, status);
-- One active draft per client (P2-6), enforced by the database.
CREATE UNIQUE INDEX idx_drafts_one_active ON drafts(client_id) WHERE status = 'draft';

-- ==== Narrative bookkeeping (content lives in files, D16) ====

CREATE TABLE narrative_meta (
  client_id    TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  watermark_ts TEXT
);

CREATE TABLE narrative_flags (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('agent','operator')),
  created_at TEXT NOT NULL,
  cleared_at TEXT
);

-- ==== Observability ====

CREATE TABLE llm_calls (
  id               TEXT PRIMARY KEY,
  client_id        TEXT REFERENCES clients(id) ON DELETE SET NULL,
  batch_id         TEXT REFERENCES batches(id),
  agent            TEXT NOT NULL,
  model            TEXT NOT NULL,
  prompt_file_hash TEXT,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  latency_ms       INTEGER,
  result           TEXT,
  error            TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_llm_calls_client_time ON llm_calls(client_id, created_at);

-- No FK on client_id: audit events survive client deletion (Phase 2 §2.6).
CREATE TABLE audit_events (
  id         TEXT PRIMARY KEY,
  client_id  TEXT,
  actor      TEXT NOT NULL CHECK (actor IN ('operator','system')),
  action     TEXT NOT NULL,
  details    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_client_time ON audit_events(client_id, created_at);
