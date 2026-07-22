import {
  and,
  eq,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../../clients/postgresClient.ts";
import type { OsmAedKey, OsmAedRemovalRow, OsmAedRow } from "./osmAed.ts";
import { osmAed, osmAedHistory } from "./schema.ts";

export interface OsmAedPersistenceResult {
  upserted: number;
}

export interface OsmAedDeletionResult {
  deleted: number;
}

export interface OsmHistoryContext {
  source: "planet" | "minute";
  replicationSequence?: number | null;
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const insertHistory = async (
  tx: DbTransaction,
  row: OsmAedRow | OsmAedRemovalRow,
  context: OsmHistoryContext,
  isAed: boolean,
  isDeleted: boolean,
): Promise<void> => {
  if (row.version === null) return;

  await tx
    .insert(osmAedHistory)
    .values({
      elementType: row.element_type,
      elementId: row.element_id,
      version: row.version,
      latitude: row.latitude,
      longitude: row.longitude,
      changeset: row.changeset,
      uid: row.uid,
      userName: row.user_name,
      osmTimestamp: row.osm_timestamp,
      tags: row.tags,
      isAed,
      isDeleted,
      source: context.source,
      replicationSequence: context.replicationSequence ?? null,
    })
    .onConflictDoNothing({
      target: [
        osmAedHistory.elementType,
        osmAedHistory.elementId,
        osmAedHistory.version,
      ],
    });
};

const upsertOsmAed = async (
  tx: DbTransaction,
  aed: OsmAedRow,
  context: OsmHistoryContext,
): Promise<boolean> => {
  await insertHistory(tx, aed, context, true, false);

  const rows = await tx
    .insert(osmAed)
    .values({
      elementType: aed.element_type,
      elementId: aed.element_id,
      latitude: aed.latitude,
      longitude: aed.longitude,
      version: aed.version,
      changeset: aed.changeset,
      uid: aed.uid,
      userName: aed.user_name,
      osmTimestamp: aed.osm_timestamp,
      tags: aed.tags,
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: [osmAed.elementType, osmAed.elementId],
      set: {
        latitude: sql`excluded.latitude`,
        longitude: sql`excluded.longitude`,
        version: sql`excluded.version`,
        changeset: sql`excluded.changeset`,
        uid: sql`excluded.uid`,
        userName: sql`excluded.user_name`,
        osmTimestamp: sql`excluded.osm_timestamp`,
        tags: sql`excluded.tags`,
        deletedAt: null,
        updatedAt: new Date(),
      },
      setWhere: sql`
        (${osmAed.version} IS NULL OR excluded.version IS NULL OR excluded.version >= ${osmAed.version})
        AND (
          ${osmAed.latitude} IS DISTINCT FROM excluded.latitude
          OR ${osmAed.longitude} IS DISTINCT FROM excluded.longitude
          OR ${osmAed.version} IS DISTINCT FROM excluded.version
          OR ${osmAed.changeset} IS DISTINCT FROM excluded.changeset
          OR ${osmAed.uid} IS DISTINCT FROM excluded.uid
          OR ${osmAed.userName} IS DISTINCT FROM excluded.user_name
          OR ${osmAed.osmTimestamp} IS DISTINCT FROM excluded.osm_timestamp
          OR ${osmAed.tags} IS DISTINCT FROM excluded.tags
          OR ${osmAed.deletedAt} IS NOT NULL
        )
      `,
    })
    .returning({ elementId: osmAed.elementId });

  return rows.length > 0;
};

export const upsertOsmAeds = async (
  aeds: OsmAedRow[],
  context: OsmHistoryContext,
): Promise<OsmAedPersistenceResult> => {
  let upserted = 0;
  await db.transaction(async (tx) => {
    for (const aed of aeds) {
      if (await upsertOsmAed(tx, aed, context)) upserted++;
    }
  });
  return { upserted };
};

export const markOsmAedsDeleted = async (
  removals: OsmAedRemovalRow[],
  context: OsmHistoryContext,
): Promise<OsmAedDeletionResult> => {
  if (removals.length === 0) return { deleted: 0 };

  return await db.transaction(async (tx) => {
    const existing = new Map<
      number,
      { version: number | null; deletedAt: Date | null }
    >();
    for (const removalChunk of chunk(removals, 5000)) {
      const rows = await tx
        .select({
          elementId: osmAed.elementId,
          version: osmAed.version,
          deletedAt: osmAed.deletedAt,
        })
        .from(osmAed)
        .where(
          and(
            eq(osmAed.elementType, "node"),
            inArray(
              osmAed.elementId,
              removalChunk.map((removal) => removal.element_id),
            ),
          ),
        );
      for (const row of rows) existing.set(row.elementId, row);
    }

    let deleted = 0;
    for (const removal of removals) {
      const current = existing.get(removal.element_id);
      if (!current) continue;
      if (
        current.version !== null &&
        removal.version !== null &&
        removal.version < current.version
      ) {
        continue;
      }

      await insertHistory(
        tx,
        removal,
        context,
        removal.is_aed,
        removal.is_deleted,
      );
      const rows = await tx
        .update(osmAed)
        .set({
          version: removal.version ?? undefined,
          changeset: removal.changeset ?? undefined,
          uid: removal.uid ?? undefined,
          userName: removal.user_name ?? undefined,
          osmTimestamp: removal.osm_timestamp ?? undefined,
          deletedAt: current.deletedAt ?? removal.osm_timestamp ?? new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(osmAed.elementType, removal.element_type),
            eq(osmAed.elementId, removal.element_id),
          ),
        )
        .returning({ elementId: osmAed.elementId });
      if (rows.length > 0 && current.deletedAt === null) deleted++;
    }

    return { deleted };
  });
};

export const markMissingOsmAedsDeleted = async (
  foundKeys: OsmAedKey[],
  planetTimestamp: Date,
): Promise<OsmAedDeletionResult> => {
  if (foundKeys.length === 0) {
    throw new Error(
      "Refusing to mark all OSM AEDs deleted after empty import.",
    );
  }

  const foundIds = [...new Set(foundKeys.map((key) => key.element_id))];
  const rows = await db
    .update(osmAed)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        isNull(osmAed.deletedAt),
        or(
          isNull(osmAed.osmTimestamp),
          lte(osmAed.osmTimestamp, planetTimestamp),
        ),
        notInArray(osmAed.elementId, foundIds),
      ),
    )
    .returning({ elementId: osmAed.elementId });

  return { deleted: rows.length };
};
