CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  mode TEXT NOT NULL CHECK (mode IN ('dry-run', 'live')),
  error_message TEXT,
  registry_aeds_count INTEGER NOT NULL DEFAULT 0,
  osm_aeds_count INTEGER NOT NULL DEFAULT 0,
  linked_aeds_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sync_runs_started_at_idx ON sync_runs (started_at DESC);

-- Partial index for successful runs - used by overview stats query
-- More efficient than filtering all rows when querying latest successful run
CREATE INDEX sync_runs_success_finished_idx
  ON sync_runs (finished_at DESC NULLS LAST) 
  WHERE status = 'success';

CREATE TABLE sync_run_issues (
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

-- Index for filtering issues by run_id and ordering by created_at
CREATE INDEX sync_run_issues_run_id_idx ON sync_run_issues (run_id, created_at DESC);

-- Index for issue type grouping/counting
CREATE INDEX sync_run_issues_type_idx ON sync_run_issues (issue_type);

-- Index for global issue listing (no run_id filter) ordered by created_at
CREATE INDEX sync_run_issues_created_idx ON sync_run_issues (created_at DESC);

-- Index for OSM node lookup
CREATE INDEX sync_run_issues_osm_node_idx ON sync_run_issues (osm_node_id)
  WHERE osm_node_id IS NOT NULL;
