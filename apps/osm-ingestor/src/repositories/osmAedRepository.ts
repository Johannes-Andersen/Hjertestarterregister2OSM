import type { TransactionSql } from "postgres";
import { sql } from "../clients/postgresClient.ts";
import { setupOsmAedSchema } from "../db/schema.ts";
import type { OsmAedKey, OsmAedRow } from "../utils/osmAed.ts";

export const osmMinuteReplicationSource = "minute";

export interface OsmAedPersistenceResult {
  upserted: number;
}

export interface OsmAedDeletionResult {
  deleted: number;
}

export interface OsmReplicationState {
  source: string;
  sequence_number: number;
  timestamp: Date;
  base_url: string;
}

export interface OsmPlanetImportState {
  source_url: string;
  file_path: string;
  remote_etag: string | null;
  remote_last_modified: Date | null;
  remote_content_length: number | null;
  imported_at: Date;
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const toDate = (value: Date | string): Date => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid OSM replication timestamp from database: ${value}`,
    );
  }
  return date;
};

const upsertOsmAed = async (
  db: TransactionSql,
  aed: OsmAedRow,
): Promise<boolean> => {
  const rows = await db<{ element_id: number }[]>`
    INSERT INTO osm_aed (
      element_type,
      element_id,
      latitude,
      longitude,
      version,
      changeset,
      uid,
      user_name,
      osm_timestamp,
      tags,
      "deletedAt"
    ) VALUES (
      ${aed.element_type},
      ${aed.element_id},
      ${aed.latitude},
      ${aed.longitude},
      ${aed.version},
      ${aed.changeset},
      ${aed.uid},
      ${aed.user_name},
      ${aed.osm_timestamp},
      ${sql.json(aed.tags)},
      NULL
    )
    ON CONFLICT (element_type, element_id) DO UPDATE SET
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      version = EXCLUDED.version,
      changeset = EXCLUDED.changeset,
      uid = EXCLUDED.uid,
      user_name = EXCLUDED.user_name,
      osm_timestamp = EXCLUDED.osm_timestamp,
      tags = EXCLUDED.tags,
      "deletedAt" = NULL,
      updated_at = NOW()
    WHERE
      osm_aed.latitude IS DISTINCT FROM EXCLUDED.latitude
      OR osm_aed.longitude IS DISTINCT FROM EXCLUDED.longitude
      OR osm_aed.version IS DISTINCT FROM EXCLUDED.version
      OR osm_aed.changeset IS DISTINCT FROM EXCLUDED.changeset
      OR osm_aed.uid IS DISTINCT FROM EXCLUDED.uid
      OR osm_aed.user_name IS DISTINCT FROM EXCLUDED.user_name
      OR osm_aed.osm_timestamp IS DISTINCT FROM EXCLUDED.osm_timestamp
      OR osm_aed.tags IS DISTINCT FROM EXCLUDED.tags
      OR osm_aed."deletedAt" IS NOT NULL
    RETURNING element_id
  `;

  return rows.length > 0;
};

export const upsertOsmAeds = async (
  aeds: OsmAedRow[],
): Promise<OsmAedPersistenceResult> => {
  await setupOsmAedSchema();

  let upserted = 0;

  await sql.begin(async (tx) => {
    for (const aed of aeds) {
      if (await upsertOsmAed(tx, aed)) upserted++;
    }
  });

  return { upserted };
};

export const markOsmAedsDeleted = async (
  keys: OsmAedKey[],
): Promise<OsmAedDeletionResult> => {
  await setupOsmAedSchema();

  if (keys.length === 0) return { deleted: 0 };

  return await sql.begin(async (tx) => {
    await tx`
      CREATE TEMP TABLE osm_aed_delete_keys (
        element_type TEXT NOT NULL,
        element_id BIGINT NOT NULL,
        PRIMARY KEY (element_type, element_id)
      ) ON COMMIT DROP
    `;

    for (const keyChunk of chunk(keys, 5000)) {
      await tx`
        INSERT INTO osm_aed_delete_keys ${tx(
          keyChunk,
          "element_type",
          "element_id",
        )}
        ON CONFLICT DO NOTHING
      `;
    }

    const deletedRows = await tx<{ element_id: number }[]>`
      UPDATE osm_aed
      SET
        "deletedAt" = NOW(),
        updated_at = NOW()
      WHERE "deletedAt" IS NULL
        AND EXISTS (
          SELECT 1
          FROM osm_aed_delete_keys
          WHERE osm_aed_delete_keys.element_type = osm_aed.element_type
            AND osm_aed_delete_keys.element_id = osm_aed.element_id
        )
      RETURNING element_id
    `;

    return { deleted: deletedRows.length };
  });
};

export const markMissingOsmAedsDeleted = async (
  foundKeys: OsmAedKey[],
): Promise<OsmAedDeletionResult> => {
  await setupOsmAedSchema();

  if (foundKeys.length === 0) {
    throw new Error(
      "Refusing to mark all OSM AEDs deleted after empty import.",
    );
  }

  return await sql.begin(async (tx) => {
    await tx`
      CREATE TEMP TABLE osm_aed_import_seen (
        element_type TEXT NOT NULL,
        element_id BIGINT NOT NULL,
        PRIMARY KEY (element_type, element_id)
      ) ON COMMIT DROP
    `;

    for (const keyChunk of chunk(foundKeys, 5000)) {
      await tx`
        INSERT INTO osm_aed_import_seen ${tx(
          keyChunk,
          "element_type",
          "element_id",
        )}
        ON CONFLICT DO NOTHING
      `;
    }

    const deletedRows = await tx<{ element_id: number }[]>`
      UPDATE osm_aed
      SET
        "deletedAt" = NOW(),
        updated_at = NOW()
      WHERE "deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM osm_aed_import_seen
          WHERE osm_aed_import_seen.element_type = osm_aed.element_type
            AND osm_aed_import_seen.element_id = osm_aed.element_id
        )
      RETURNING element_id
    `;

    return { deleted: deletedRows.length };
  });
};

export const getOsmReplicationState = async (
  source: string,
): Promise<OsmReplicationState | null> => {
  await setupOsmAedSchema();

  const [row] = await sql<
    {
      source: string;
      sequence_number: string | number;
      timestamp: Date | string;
      base_url: string;
    }[]
  >`
    SELECT source, sequence_number, timestamp, base_url
    FROM osm_replication_state
    WHERE source = ${source}
  `;

  if (!row) return null;

  return {
    source: row.source,
    sequence_number: Number(row.sequence_number),
    timestamp: toDate(row.timestamp),
    base_url: row.base_url,
  };
};

export const saveOsmReplicationState = async (
  state: OsmReplicationState,
): Promise<void> => {
  await setupOsmAedSchema();

  await sql`
    INSERT INTO osm_replication_state (
      source,
      sequence_number,
      timestamp,
      base_url
    ) VALUES (
      ${state.source},
      ${state.sequence_number},
      ${state.timestamp},
      ${state.base_url}
    )
    ON CONFLICT (source) DO UPDATE SET
      sequence_number = EXCLUDED.sequence_number,
      timestamp = EXCLUDED.timestamp,
      base_url = EXCLUDED.base_url,
      updated_at = NOW()
  `;
};

export const getOsmPlanetImportState = async (
  sourceUrl: string,
): Promise<OsmPlanetImportState | null> => {
  await setupOsmAedSchema();

  const [row] = await sql<
    {
      source_url: string;
      file_path: string;
      remote_etag: string | null;
      remote_last_modified: Date | string | null;
      remote_content_length: string | number | null;
      imported_at: Date | string;
    }[]
  >`
    SELECT
      source_url,
      file_path,
      remote_etag,
      remote_last_modified,
      remote_content_length,
      imported_at
    FROM osm_planet_import_state
    WHERE source_url = ${sourceUrl}
  `;

  if (!row) return null;

  return {
    source_url: row.source_url,
    file_path: row.file_path,
    remote_etag: row.remote_etag,
    remote_last_modified: row.remote_last_modified
      ? toDate(row.remote_last_modified)
      : null,
    remote_content_length:
      row.remote_content_length === null
        ? null
        : Number(row.remote_content_length),
    imported_at: toDate(row.imported_at),
  };
};

export const saveOsmPlanetImportState = async (
  state: OsmPlanetImportState,
): Promise<void> => {
  await setupOsmAedSchema();

  await sql`
    INSERT INTO osm_planet_import_state (
      source_url,
      file_path,
      remote_etag,
      remote_last_modified,
      remote_content_length,
      imported_at
    ) VALUES (
      ${state.source_url},
      ${state.file_path},
      ${state.remote_etag},
      ${state.remote_last_modified},
      ${state.remote_content_length},
      ${state.imported_at}
    )
    ON CONFLICT (source_url) DO UPDATE SET
      file_path = EXCLUDED.file_path,
      remote_etag = EXCLUDED.remote_etag,
      remote_last_modified = EXCLUDED.remote_last_modified,
      remote_content_length = EXCLUDED.remote_content_length,
      imported_at = EXCLUDED.imported_at,
      updated_at = NOW()
  `;
};
