import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "../clients/postgresClient.ts";
import { aed, aedRegistrySyncState } from "../db/schema.ts";
import type {
  AedEvent,
  AedEventJobData,
  AedEventSource,
  AedEventType,
  SerializedAed,
} from "../events/aedEvent.ts";
import type { AedRow } from "../utils/transformAed.ts";

export interface DeletedAssetReference {
  assetId: number;
  assetGuid: string;
}

export interface AedPersistenceResult {
  created: number;
  updated: number;
  deleted: number;
  events: AedEvent[];
}

interface UpsertResult {
  changed: boolean;
  created: boolean;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StoredAed = typeof aed.$inferSelect;

const toAedRow = (row: StoredAed): AedRow => ({
  asset_id: row.assetId,
  asset_guid: row.assetGuid,
  site_name: row.siteName,
  site_address: row.siteAddress,
  site_latitude: row.siteLatitude,
  site_longitude: row.siteLongitude,
  site_floor_number: row.siteFloorNumber,
  site_post_code: row.sitePostCode,
  site_post_area: row.sitePostArea,
  site_description: row.siteDescription,
  is_mobile: row.isMobile,
  created_date: row.createdDate,
  modified_date: row.modifiedDate,
  active_from_date: row.activeFromDate,
  active_to_date: row.activeToDate,
  opening_hours_limited: row.openingHoursLimited,
  opening_hours_closed_holidays: row.openingHoursClosedHolidays,
  opening_hours: row.openingHours,
});

const toInsertValues = (row: AedRow): typeof aed.$inferInsert => ({
  assetId: row.asset_id,
  assetGuid: row.asset_guid,
  siteName: row.site_name,
  siteAddress: row.site_address,
  siteLatitude: row.site_latitude,
  siteLongitude: row.site_longitude,
  siteFloorNumber: row.site_floor_number,
  sitePostCode: row.site_post_code,
  sitePostArea: row.site_post_area,
  siteDescription: row.site_description,
  isMobile: row.is_mobile,
  createdDate: row.created_date,
  modifiedDate: row.modified_date,
  activeFromDate: row.active_from_date,
  activeToDate: row.active_to_date,
  openingHoursLimited: row.opening_hours_limited,
  openingHoursClosedHolidays: row.opening_hours_closed_holidays,
  openingHours: row.opening_hours,
  deletedAt: null,
});

const serializeAed = (row: AedRow): SerializedAed => ({
  ...row,
  created_date: row.created_date.toISOString(),
  modified_date: row.modified_date.toISOString(),
  active_from_date: row.active_from_date?.toISOString() ?? null,
  active_to_date: row.active_to_date?.toISOString() ?? null,
});

const createEvent = ({
  type,
  source,
  row,
}: {
  type: AedEventType;
  source: AedEventSource;
  row: AedRow;
}): AedEvent => {
  const eventId = randomUUID();
  const occurredAt = new Date();
  const payload: AedEventJobData = {
    eventId,
    type,
    source,
    occurredAt: occurredAt.toISOString(),
    assetId: row.asset_id,
    assetGuid: row.asset_guid,
    aed: serializeAed(row),
  };

  return {
    eventId,
    type,
    payload,
  };
};

const upsertAed = async (
  tx: Transaction,
  row: AedRow,
): Promise<UpsertResult> => {
  const values = toInsertValues(row);
  const result = await tx
    .insert(aed)
    .values(values)
    .onConflictDoUpdate({
      target: aed.assetId,
      set: {
        assetGuid: values.assetGuid,
        siteName: values.siteName,
        siteAddress: values.siteAddress,
        siteLatitude: values.siteLatitude,
        siteLongitude: values.siteLongitude,
        siteFloorNumber: values.siteFloorNumber,
        sitePostCode: values.sitePostCode,
        sitePostArea: values.sitePostArea,
        siteDescription: values.siteDescription,
        isMobile: values.isMobile,
        createdDate: values.createdDate,
        modifiedDate: values.modifiedDate,
        activeFromDate: values.activeFromDate,
        activeToDate: values.activeToDate,
        openingHoursLimited: values.openingHoursLimited,
        openingHoursClosedHolidays: values.openingHoursClosedHolidays,
        openingHours: values.openingHours,
        deletedAt: null,
        updatedAt: sql`now()`,
      },
      setWhere: or(
        sql`${aed.assetGuid} IS DISTINCT FROM excluded.asset_guid`,
        sql`${aed.siteName} IS DISTINCT FROM excluded.site_name`,
        sql`${aed.siteAddress} IS DISTINCT FROM excluded.site_address`,
        sql`${aed.siteLatitude} IS DISTINCT FROM excluded.site_latitude`,
        sql`${aed.siteLongitude} IS DISTINCT FROM excluded.site_longitude`,
        sql`${aed.siteFloorNumber} IS DISTINCT FROM excluded.site_floor_number`,
        sql`${aed.sitePostCode} IS DISTINCT FROM excluded.site_post_code`,
        sql`${aed.sitePostArea} IS DISTINCT FROM excluded.site_post_area`,
        sql`${aed.siteDescription} IS DISTINCT FROM excluded.site_description`,
        sql`${aed.isMobile} IS DISTINCT FROM excluded.is_mobile`,
        sql`${aed.createdDate} IS DISTINCT FROM excluded.created_date`,
        sql`${aed.modifiedDate} IS DISTINCT FROM excluded.modified_date`,
        sql`${aed.activeFromDate} IS DISTINCT FROM excluded.active_from_date`,
        sql`${aed.activeToDate} IS DISTINCT FROM excluded.active_to_date`,
        sql`${aed.openingHoursLimited} IS DISTINCT FROM excluded.opening_hours_limited`,
        sql`${aed.openingHoursClosedHolidays} IS DISTINCT FROM excluded.opening_hours_closed_holidays`,
        sql`${aed.openingHours} IS DISTINCT FROM excluded.opening_hours`,
        sql`${aed.deletedAt} IS NOT NULL`,
      ),
    })
    .returning({ inserted: sql<boolean>`xmax = 0` });

  return {
    changed: result.length > 0,
    created: result[0]?.inserted === true,
  };
};

const persistAeds = async (
  tx: Transaction,
  rows: AedRow[],
  source: AedEventSource,
): Promise<Pick<AedPersistenceResult, "created" | "updated" | "events">> => {
  let created = 0;
  let updated = 0;
  const events: AedEvent[] = [];
  for (const row of rows) {
    const result = await upsertAed(tx, row);
    if (!result.changed) continue;
    const type = result.created ? "aed.created" : "aed.updated";
    if (result.created) created++;
    else updated++;
    events.push(createEvent({ type, source, row }));
  }
  return { created, updated, events };
};

const markDeletedWhere = async (
  tx: Transaction,
  condition: SQL,
  source: AedEventSource,
): Promise<Pick<AedPersistenceResult, "deleted" | "events">> => {
  const rows = await tx
    .update(aed)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(isNull(aed.deletedAt), condition))
    .returning();

  const events = rows.map((storedRow) =>
    createEvent({
      type: "aed.deleted",
      source,
      row: toAedRow(storedRow),
    }),
  );
  return { deleted: rows.length, events };
};

export const syncRegistrySnapshot = async ({
  aeds,
  foundAssetIds,
}: {
  aeds: AedRow[];
  foundAssetIds: number[];
}): Promise<AedPersistenceResult> => {
  if (foundAssetIds.length === 0) {
    throw new Error("Refusing to reconcile an empty registry snapshot.");
  }

  return await db.transaction(async (tx) => {
    const persisted = await persistAeds(tx, aeds, "full-sync");
    const deleted = await markDeletedWhere(
      tx,
      notInArray(aed.assetId, foundAssetIds),
      "full-sync",
    );
    return {
      created: persisted.created,
      updated: persisted.updated,
      deleted: deleted.deleted,
      events: [...persisted.events, ...deleted.events],
    };
  });
};

export const upsertIncrementalAeds = async (
  aeds: AedRow[],
): Promise<AedPersistenceResult> =>
  await db.transaction(async (tx) => ({
    ...(await persistAeds(tx, aeds, "incremental-sync")),
    deleted: 0,
  }));

export const markDeletedAssets = async (
  assets: DeletedAssetReference[],
): Promise<Pick<AedPersistenceResult, "deleted" | "events">> => {
  if (assets.length === 0) return { deleted: 0, events: [] };
  const assetIds = [...new Set(assets.map((asset) => asset.assetId))];
  return await db.transaction(async (tx) =>
    markDeletedWhere(tx, inArray(aed.assetId, assetIds), "incremental-sync"),
  );
};

export const getIncrementalCursor = async (): Promise<Date | null> => {
  const row = await db.query.aedRegistrySyncState.findFirst({
    where: eq(aedRegistrySyncState.singletonId, 1),
    columns: { lastIncrementalSyncAt: true },
  });
  return row?.lastIncrementalSyncAt ?? null;
};

export const saveFullSyncCompleted = async (startedAt: Date): Promise<void> => {
  await db
    .insert(aedRegistrySyncState)
    .values({
      singletonId: 1,
      lastFullSyncAt: startedAt,
      lastIncrementalSyncAt: startedAt,
    })
    .onConflictDoUpdate({
      target: aedRegistrySyncState.singletonId,
      set: {
        lastFullSyncAt: startedAt,
        lastIncrementalSyncAt: sql`greatest(
          ${aedRegistrySyncState.lastIncrementalSyncAt},
          excluded.last_incremental_sync_at
        )`,
        updatedAt: sql`now()`,
      },
    });
};

export const saveIncrementalSyncCompleted = async (
  startedAt: Date,
): Promise<void> => {
  await db
    .insert(aedRegistrySyncState)
    .values({ singletonId: 1, lastIncrementalSyncAt: startedAt })
    .onConflictDoUpdate({
      target: aedRegistrySyncState.singletonId,
      set: {
        lastIncrementalSyncAt: sql`greatest(
          ${aedRegistrySyncState.lastIncrementalSyncAt},
          excluded.last_incremental_sync_at
        )`,
        updatedAt: sql`now()`,
      },
    });
};
