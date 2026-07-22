import {
  and,
  eq,
  getTableColumns,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Logger } from "pino";
import { env } from "./config.ts";
import { db } from "./db/index.ts";
import { type AedInsert, aed, aedRegistrySyncState } from "./db/schema.ts";
import {
  type AedEvent,
  type AedEventSource,
  buildAedEvent,
  publishAedEvents,
} from "./events.ts";
import { parseAssets, registry, toRegistryDate } from "./registry.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const UPSERT_CHUNK_SIZE = 1_000;

const columns = getTableColumns(aed);

// Columns that carry registry data. A row is only rewritten (and an event
// emitted) when at least one of these differs from what we already store.
const contentColumns = [
  "assetGuid",
  "siteName",
  "siteAddress",
  "siteLatitude",
  "siteLongitude",
  "siteFloorNumber",
  "sitePostCode",
  "sitePostArea",
  "siteDescription",
  "isMobile",
  "createdDate",
  "modifiedDate",
  "activeFromDate",
  "activeToDate",
  "openingHoursLimited",
  "openingHoursClosedHolidays",
  "openingHours",
] as const satisfies readonly (keyof AedInsert)[];

const excluded = (column: PgColumn) => sql.raw(`excluded.${column.name}`);

const distinctFromExcluded = (column: PgColumn) =>
  sql`${column} IS DISTINCT FROM ${excluded(column)}`;

const updateSet = {
  deletedAt: sql`null`,
  updatedAt: sql`now()`,
  ...Object.fromEntries(
    contentColumns.map((key) => [key, excluded(columns[key])]),
  ),
};

// Re-emit a row when its content changed, or when it was previously soft-deleted
// and has now reappeared in the registry.
const rowChanged = or(
  ...contentColumns.map((key) => distinctFromExcluded(columns[key])),
  isNotNull(aed.deletedAt),
);

interface UpsertResult {
  created: number;
  updated: number;
  events: AedEvent[];
}

const upsertAeds = async (
  tx: Tx,
  rows: AedInsert[],
  source: AedEventSource,
): Promise<UpsertResult> => {
  const result: UpsertResult = { created: 0, updated: 0, events: [] };

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    const changed = await tx
      .insert(aed)
      .values(chunk)
      .onConflictDoUpdate({
        target: aed.assetId,
        set: updateSet,
        setWhere: rowChanged,
      })
      .returning({ ...columns, inserted: sql<boolean>`xmax = 0` });

    for (const { inserted, ...row } of changed) {
      if (inserted) result.created++;
      else result.updated++;
      result.events.push(
        buildAedEvent(inserted ? "aed.created" : "aed.updated", source, row),
      );
    }
  }

  return result;
};

const markMissingAsDeleted = async (
  tx: Tx,
  foundAssetIds: number[],
  source: AedEventSource,
): Promise<{ deleted: number; events: AedEvent[] }> => {
  if (foundAssetIds.length === 0) return { deleted: 0, events: [] };

  const rows = await tx
    .update(aed)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(isNull(aed.deletedAt), notInArray(aed.assetId, foundAssetIds)))
    .returning();

  return {
    deleted: rows.length,
    events: rows.map((row) => buildAedEvent("aed.deleted", source, row)),
  };
};

const getCursor = async (): Promise<Date | null> => {
  const state = await db.query.aedRegistrySyncState.findFirst({
    where: eq(aedRegistrySyncState.singletonId, 1),
    columns: { lastIncrementalSyncAt: true },
  });
  return state?.lastIncrementalSyncAt ?? null;
};

const saveSyncState = async (
  tx: Tx,
  values: { lastFullSyncAt?: Date; lastIncrementalSyncAt: Date },
): Promise<void> => {
  await tx
    .insert(aedRegistrySyncState)
    .values({ singletonId: 1, ...values })
    .onConflictDoUpdate({
      target: aedRegistrySyncState.singletonId,
      set: { ...values, updatedAt: sql`now()` },
    });
};

/**
 * Daily full sync: fetch the whole registry, upsert everything, and soft-delete
 * any stored AED that is missing from the snapshot.
 */
export const runFullSync = async (log: Logger): Promise<void> => {
  const startedAt = new Date();
  log.info("Starting full AED sync");

  const { ASSETS } = await registry.searchAssets({
    max_rows: env.REGISTRY_MAX_ROWS,
  });
  if (ASSETS.length === 0) {
    throw new Error("Registry returned an empty snapshot; refusing full sync");
  }
  if (ASSETS.length >= env.REGISTRY_MAX_ROWS) {
    throw new Error(
      `Snapshot reached REGISTRY_MAX_ROWS=${env.REGISTRY_MAX_ROWS}; increase it before reconciling deletions`,
    );
  }

  const { rows, foundAssetIds, invalid } = parseAssets(ASSETS, log);

  const { created, updated, deleted, events } = await db.transaction(
    async (tx) => {
      const upserted = await upsertAeds(tx, rows, "full-sync");
      const removed = await markMissingAsDeleted(
        tx,
        foundAssetIds,
        "full-sync",
      );
      await saveSyncState(tx, {
        lastFullSyncAt: startedAt,
        lastIncrementalSyncAt: startedAt,
      });
      return {
        created: upserted.created,
        updated: upserted.updated,
        deleted: removed.deleted,
        events: [...upserted.events, ...removed.events],
      };
    },
  );

  const published = await publishAedEvents(events, log);
  log.info(
    { received: ASSETS.length, invalid, created, updated, deleted, published },
    "Full AED sync completed",
  );
};

/**
 * Incremental sync: fetch only AEDs changed since the last cursor and upsert
 * them. Deletions are handled exclusively by the full sync.
 */
export const runIncrementalSync = async (log: Logger): Promise<void> => {
  const startedAt = new Date();
  const cursor = await getCursor();
  if (!cursor) {
    log.info("No cursor yet; awaiting the first full sync");
    return;
  }

  const since = toRegistryDate(cursor);
  log.info({ since }, "Starting incremental AED sync");

  const { ASSETS } = await registry.searchAssets({
    updated_since: since,
    max_rows: env.REGISTRY_MAX_ROWS,
  });
  if (ASSETS.length >= env.REGISTRY_MAX_ROWS) {
    throw new Error(
      `Incremental response reached REGISTRY_MAX_ROWS=${env.REGISTRY_MAX_ROWS}; refusing to advance the cursor`,
    );
  }

  const { rows, invalid } = parseAssets(ASSETS, log);

  const { created, updated, events } = await db.transaction(async (tx) => {
    const upserted = await upsertAeds(tx, rows, "incremental-sync");
    await saveSyncState(tx, { lastIncrementalSyncAt: startedAt });
    return upserted;
  });

  const published = await publishAedEvents(events, log);
  log.info(
    { since, received: ASSETS.length, invalid, created, updated, published },
    "Incremental AED sync completed",
  );
};
