import type { TransactionSql } from "postgres";
import { sql } from "../clients/postgresClient.ts";
import { setupAedSchema } from "../db/schema.ts";
import type { AedRow } from "../utils/transformAed.ts";

interface AedPersistenceResult {
  upserted: number;
  changedAssetIds: number[];
}

interface AedRegistrySyncResult extends AedPersistenceResult {
  deleted: number;
}

const toDate = (value: Date | string): Date => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid AED modified_date from database: ${value}`);
  }
  return date;
};

const upsertAed = async (db: TransactionSql, aed: AedRow): Promise<boolean> => {
  const rows = await db<{ asset_id: number }[]>`
    INSERT INTO aed (
      asset_id,
      asset_guid,
      site_name,
      site_address,
      site_latitude,
      site_longitude,
      site_floor_number,
      site_post_code,
      site_post_area,
      site_description,
      is_mobile,
      created_date,
      modified_date,
      active_from_date,
      active_to_date,
      opening_hours_limited,
      opening_hours_closed_holidays,
      opening_hours,
      "deletedAt"
    ) VALUES (
      ${aed.asset_id},
      ${aed.asset_guid},
      ${aed.site_name},
      ${aed.site_address},
      ${aed.site_latitude},
      ${aed.site_longitude},
      ${aed.site_floor_number},
      ${aed.site_post_code},
      ${aed.site_post_area},
      ${aed.site_description},
      ${aed.is_mobile},
      ${aed.created_date},
      ${aed.modified_date},
      ${aed.active_from_date},
      ${aed.active_to_date},
      ${aed.opening_hours_limited},
      ${aed.opening_hours_closed_holidays},
      ${sql.json(aed.opening_hours as unknown as Parameters<typeof sql.json>[0])},
      NULL
    )
    ON CONFLICT (asset_id) DO UPDATE SET
      asset_guid = EXCLUDED.asset_guid,
      site_name = EXCLUDED.site_name,
      site_address = EXCLUDED.site_address,
      site_latitude = EXCLUDED.site_latitude,
      site_longitude = EXCLUDED.site_longitude,
      site_floor_number = EXCLUDED.site_floor_number,
      site_post_code = EXCLUDED.site_post_code,
      site_post_area = EXCLUDED.site_post_area,
      site_description = EXCLUDED.site_description,
      is_mobile = EXCLUDED.is_mobile,
      created_date = EXCLUDED.created_date,
      modified_date = EXCLUDED.modified_date,
      active_from_date = EXCLUDED.active_from_date,
      active_to_date = EXCLUDED.active_to_date,
      opening_hours_limited = EXCLUDED.opening_hours_limited,
      opening_hours_closed_holidays = EXCLUDED.opening_hours_closed_holidays,
      opening_hours = EXCLUDED.opening_hours,
      "deletedAt" = NULL,
      updated_at = NOW()
    WHERE
      aed.asset_guid IS DISTINCT FROM EXCLUDED.asset_guid
      OR aed.site_name IS DISTINCT FROM EXCLUDED.site_name
      OR aed.site_address IS DISTINCT FROM EXCLUDED.site_address
      OR aed.site_latitude IS DISTINCT FROM EXCLUDED.site_latitude
      OR aed.site_longitude IS DISTINCT FROM EXCLUDED.site_longitude
      OR aed.site_floor_number IS DISTINCT FROM EXCLUDED.site_floor_number
      OR aed.site_post_code IS DISTINCT FROM EXCLUDED.site_post_code
      OR aed.site_post_area IS DISTINCT FROM EXCLUDED.site_post_area
      OR aed.site_description IS DISTINCT FROM EXCLUDED.site_description
      OR aed.is_mobile IS DISTINCT FROM EXCLUDED.is_mobile
      OR aed.created_date IS DISTINCT FROM EXCLUDED.created_date
      OR aed.modified_date IS DISTINCT FROM EXCLUDED.modified_date
      OR aed.active_from_date IS DISTINCT FROM EXCLUDED.active_from_date
      OR aed.active_to_date IS DISTINCT FROM EXCLUDED.active_to_date
      OR aed.opening_hours_limited IS DISTINCT FROM EXCLUDED.opening_hours_limited
      OR aed.opening_hours_closed_holidays IS DISTINCT FROM EXCLUDED.opening_hours_closed_holidays
      OR aed.opening_hours IS DISTINCT FROM EXCLUDED.opening_hours
      OR aed."deletedAt" IS NOT NULL
    RETURNING asset_id
  `;

  return rows.length > 0;
};

const markMissingAedsDeleted = async (
  db: TransactionSql,
  foundAssetIds: number[],
): Promise<number> => {
  const deletedRows =
    foundAssetIds.length === 0
      ? await db<{ asset_id: number }[]>`
          UPDATE aed
          SET
            "deletedAt" = NOW(),
            updated_at = NOW()
          WHERE "deletedAt" IS NULL
          RETURNING asset_id
        `
      : await db<{ asset_id: number }[]>`
          UPDATE aed
          SET
            "deletedAt" = NOW(),
            updated_at = NOW()
          WHERE "deletedAt" IS NULL
            AND asset_id NOT IN ${db(foundAssetIds)}
          RETURNING asset_id
        `;

  return deletedRows.length;
};

export const upsertAeds = async (
  aeds: AedRow[],
): Promise<AedPersistenceResult> => {
  await setupAedSchema();

  const changedAssetIds: number[] = [];

  await sql.begin(async (tx) => {
    for (const aed of aeds) {
      if (await upsertAed(tx, aed)) changedAssetIds.push(aed.asset_id);
    }
  });

  return { upserted: changedAssetIds.length, changedAssetIds };
};

export const getLatestAedModifiedDate = async (): Promise<Date | null> => {
  await setupAedSchema();

  const [row] = await sql<{ modified_date: Date | string | null }[]>`
    SELECT MAX(modified_date) AS modified_date
    FROM aed
  `;

  return row?.modified_date ? toDate(row.modified_date) : null;
};

export const syncRegistryAeds = async ({
  aeds,
  foundAssetIds,
}: {
  aeds: AedRow[];
  foundAssetIds: number[];
}): Promise<AedRegistrySyncResult> => {
  await setupAedSchema();

  return await sql.begin(async (tx) => {
    const changedAssetIds: number[] = [];

    for (const aed of aeds) {
      if (await upsertAed(tx, aed)) changedAssetIds.push(aed.asset_id);
    }

    const deleted = await markMissingAedsDeleted(tx, foundAssetIds);

    return {
      upserted: changedAssetIds.length,
      changedAssetIds,
      deleted,
    };
  });
};
