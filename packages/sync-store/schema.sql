CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  mode TEXT NOT NULL CHECK (mode IN ('dry-run', 'live')),
  error_message TEXT,
  registry_aeds_count INTEGER NOT NULL DEFAULT 0,
  osm_aeds_count INTEGER NOT NULL DEFAULT 0,
  managed_osm_aeds_count INTEGER NOT NULL DEFAULT 0,
  unique_managed_osm_aeds_count INTEGER NOT NULL DEFAULT 0,
  linked_aeds_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  skipped_create_nearby_count INTEGER NOT NULL DEFAULT 0,
  skipped_delete_not_aed_only_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sync_runs_started_at_idx ON sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS sync_runs_status_idx ON sync_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS sync_run_issues (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES sync_runs (id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
  message TEXT NOT NULL,
  register_ref TEXT,
  osm_node_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sync_run_issues
  DROP CONSTRAINT IF EXISTS sync_run_issues_status_check;

ALTER TABLE sync_run_issues
  DROP COLUMN IF EXISTS issue_key;

ALTER TABLE sync_run_issues
  DROP COLUMN IF EXISTS status;

ALTER TABLE sync_run_issues
  DROP COLUMN IF EXISTS closed_at;

ALTER TABLE sync_run_issues
  DROP COLUMN IF EXISTS close_note;

DROP INDEX IF EXISTS sync_run_issues_status_idx;
DROP INDEX IF EXISTS sync_run_issues_issue_key_idx;
DROP INDEX IF EXISTS sync_run_issues_open_issue_key_uidx;

TRUNCATE TABLE sync_run_issues;

CREATE INDEX IF NOT EXISTS sync_run_issues_run_id_idx ON sync_run_issues (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sync_run_issues_type_idx ON sync_run_issues (issue_type, created_at DESC);
CREATE INDEX IF NOT EXISTS sync_run_issues_osm_node_idx ON sync_run_issues (osm_node_id);
