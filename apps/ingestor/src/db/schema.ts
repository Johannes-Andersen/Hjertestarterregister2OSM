import { sql } from "../clients/postgresClient.ts";

let setupAedSchemaPromise: Promise<void> | undefined;

const setupAedSchemaOnce = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS aed (
      asset_id INTEGER PRIMARY KEY CHECK (asset_id > 0),
      asset_guid TEXT NOT NULL UNIQUE,

      site_name TEXT NOT NULL,
      site_address TEXT NOT NULL,
      site_latitude DOUBLE PRECISION NOT NULL CHECK (
        site_latitude >= -90 AND site_latitude <= 90
      ),
      site_longitude DOUBLE PRECISION NOT NULL CHECK (
        site_longitude >= -180 AND site_longitude <= 180
      ),
      site_floor_number DOUBLE PRECISION,
      site_post_code TEXT,
      site_post_area TEXT,
      site_description TEXT,

      is_mobile BOOLEAN NOT NULL,

      created_date TIMESTAMPTZ NOT NULL,
      modified_date TIMESTAMPTZ NOT NULL,

      active_from_date TIMESTAMPTZ,
      active_to_date TIMESTAMPTZ,

      opening_hours_limited BOOLEAN NOT NULL,
      opening_hours_closed_holidays BOOLEAN NOT NULL,
      opening_hours JSONB NOT NULL,

      "deletedAt" TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS aed_asset_guid__idx
    ON aed (asset_guid)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS aed_deleted_at_idx
    ON aed ("deletedAt")
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS aed_modified_date_idx
    ON aed (modified_date DESC)
  `;
};

export const setupAedSchema = async () => {
  setupAedSchemaPromise ??= setupAedSchemaOnce().catch((error) => {
    setupAedSchemaPromise = undefined;
    throw error;
  });

  await setupAedSchemaPromise;
};
