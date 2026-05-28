import { sql } from "../clients/postgresClient.ts";

let setupOsmAedSchemaPromise: Promise<void> | undefined;

const setupOsmAedSchemaOnce = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS osm_aed (
      element_type TEXT NOT NULL CHECK (
        element_type IN ('node', 'way', 'relation')
      ),
      element_id BIGINT NOT NULL CHECK (element_id > 0),

      latitude DOUBLE PRECISION NOT NULL CHECK (
        latitude >= -90 AND latitude <= 90
      ),
      longitude DOUBLE PRECISION NOT NULL CHECK (
        longitude >= -180 AND longitude <= 180
      ),

      version INTEGER,
      changeset BIGINT,
      uid BIGINT,
      user_name TEXT,
      osm_timestamp TIMESTAMPTZ,

      tags JSONB NOT NULL,

      "deletedAt" TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      PRIMARY KEY (element_type, element_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS osm_aed_deleted_at_idx
    ON osm_aed ("deletedAt")
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS osm_aed_osm_timestamp_idx
    ON osm_aed (osm_timestamp DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS osm_aed_tags_gin_idx
    ON osm_aed USING GIN (tags)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS osm_replication_state (
      source TEXT PRIMARY KEY,
      sequence_number BIGINT NOT NULL CHECK (sequence_number >= 0),
      timestamp TIMESTAMPTZ NOT NULL,
      base_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS osm_planet_import_state (
      source_url TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      remote_etag TEXT,
      remote_last_modified TIMESTAMPTZ,
      remote_content_length BIGINT,
      imported_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
};

export const setupOsmAedSchema = async () => {
  setupOsmAedSchemaPromise ??= setupOsmAedSchemaOnce().catch((error) => {
    setupOsmAedSchemaPromise = undefined;
    throw error;
  });

  await setupOsmAedSchemaPromise;
};
