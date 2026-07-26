import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "../../db/index.ts";
import type {
  OsmElementInfo,
  OsmNode,
  OsmNodeChange,
} from "../../osm/types.ts";
import type { OsmNodeHandler, OsmSource } from "../types.ts";
import {
  type OsmAedHistoryInsert,
  type OsmAedInsert,
  osmAed,
  osmAedHistory,
} from "./schema.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const CHUNK_SIZE = 5_000;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
};

const toInt = (value: unknown): number | null =>
  Number.isInteger(value) ? (value as number) : null;

const toDate = (value: OsmElementInfo["timestamp"]): Date | null => {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const hasAedTags = (tags: Record<string, string> | undefined): boolean =>
  tags?.emergency?.trim().toLowerCase() === "defibrillator";

const contentColumns = [
  osmAed.latitude,
  osmAed.longitude,
  osmAed.version,
  osmAed.changeset,
  osmAed.uid,
  osmAed.userName,
  osmAed.osmTimestamp,
  osmAed.tags,
];

const excluded = (column: PgColumn) => sql.raw(`excluded.${column.name}`);

// Only overwrite when the incoming version is newer/equal and something changed
// (or the row was previously soft-deleted and has reappeared).
const versionIsNotOlder = sql`(${osmAed.version} IS NULL OR excluded.version IS NULL OR excluded.version >= ${osmAed.version})`;
const somethingChanged = or(
  ...contentColumns.map((c) => sql`${c} IS DISTINCT FROM ${excluded(c)}`),
  isNotNull(osmAed.deletedAt),
);
const upsertSet = {
  ...Object.fromEntries(contentColumns.map((c) => [c.name, excluded(c)])),
  deletedAt: sql`null`,
  updatedAt: sql`now()`,
};

const insertHistory = (tx: Tx, values: OsmAedHistoryInsert): Promise<unknown> =>
  tx
    .insert(osmAedHistory)
    .values(values)
    .onConflictDoNothing({
      target: [
        osmAedHistory.elementType,
        osmAedHistory.elementId,
        osmAedHistory.version,
      ],
    });

const toAedRow = (node: OsmNode): OsmAedInsert => ({
  elementType: "node",
  elementId: node.id,
  latitude: node.lat,
  longitude: node.lon,
  version: toInt(node.info.version),
  changeset: toInt(node.info.changeset),
  uid: toInt(node.info.uid),
  userName: node.info.user?.trim() || null,
  osmTimestamp: toDate(node.info.timestamp),
  tags: node.tags,
});

const upsertOne = async (
  tx: Tx,
  node: OsmNode,
  source: OsmSource,
  sequence?: number,
): Promise<boolean> => {
  const row = toAedRow(node);

  if (row.version != null) {
    await insertHistory(tx, {
      elementType: "node",
      elementId: row.elementId,
      version: row.version,
      latitude: row.latitude,
      longitude: row.longitude,
      changeset: row.changeset,
      uid: row.uid,
      userName: row.userName,
      osmTimestamp: row.osmTimestamp,
      tags: row.tags,
      isAed: true,
      isDeleted: false,
      source,
      replicationSequence: sequence ?? null,
    });
  }

  const changed = await tx
    .insert(osmAed)
    .values(row)
    .onConflictDoUpdate({
      target: [osmAed.elementType, osmAed.elementId],
      set: upsertSet,
      setWhere: and(versionIsNotOlder, somethingChanged),
    })
    .returning({ id: osmAed.elementId });

  return changed.length > 0;
};

const upsert = async (
  nodes: OsmNode[],
  source: OsmSource,
  sequence?: number,
): Promise<number> => {
  if (nodes.length === 0) return 0;
  let upserted = 0;
  await db.transaction(async (tx) => {
    for (const node of nodes) {
      if (await upsertOne(tx, node, source, sequence)) upserted++;
    }
  });
  return upserted;
};

const markDeleted = async (
  changes: OsmNodeChange[],
  source: OsmSource,
  sequence?: number,
): Promise<number> => {
  if (changes.length === 0) return 0;

  return db.transaction(async (tx) => {
    const ids = [...new Set(changes.map((change) => change.id))];
    const existing = new Map<
      number,
      { version: number | null; deletedAt: Date | null }
    >();
    for (const part of chunk(ids, CHUNK_SIZE)) {
      const rows = await tx
        .select({
          elementId: osmAed.elementId,
          version: osmAed.version,
          deletedAt: osmAed.deletedAt,
        })
        .from(osmAed)
        .where(
          and(eq(osmAed.elementType, "node"), inArray(osmAed.elementId, part)),
        );
      for (const row of rows) existing.set(row.elementId, row);
    }

    let deleted = 0;
    for (const change of changes) {
      const current = existing.get(change.id);
      if (!current) continue;

      const version = toInt(change.info.version);
      if (
        current.version !== null &&
        version !== null &&
        version < current.version
      ) {
        continue;
      }

      const osmTimestamp = toDate(change.info.timestamp);
      if (version != null) {
        await insertHistory(tx, {
          elementType: "node",
          elementId: change.id,
          version,
          latitude: change.lat,
          longitude: change.lon,
          changeset: toInt(change.info.changeset),
          uid: toInt(change.info.uid),
          userName: change.info.user?.trim() || null,
          osmTimestamp,
          tags: change.tags,
          isAed: hasAedTags(change.tags),
          isDeleted: change.action === "delete",
          source,
          replicationSequence: sequence ?? null,
        });
      }

      const rows = await tx
        .update(osmAed)
        .set({
          version: version ?? undefined,
          changeset: toInt(change.info.changeset) ?? undefined,
          uid: toInt(change.info.uid) ?? undefined,
          userName: change.info.user?.trim() || undefined,
          osmTimestamp: osmTimestamp ?? undefined,
          deletedAt: current.deletedAt ?? osmTimestamp ?? new Date(),
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(osmAed.elementType, "node"), eq(osmAed.elementId, change.id)),
        )
        .returning({ id: osmAed.elementId });

      if (rows.length > 0 && current.deletedAt === null) deleted++;
    }

    return deleted;
  });
};

const reconcile = async (
  seenIds: number[],
  planetTimestamp: Date,
): Promise<number> => {
  if (seenIds.length === 0) {
    throw new Error("Refusing to reconcile an empty OSM AED snapshot.");
  }
  const ids = [...new Set(seenIds)];
  const rows = await db
    .update(osmAed)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        isNull(osmAed.deletedAt),
        or(
          isNull(osmAed.osmTimestamp),
          lte(osmAed.osmTimestamp, planetTimestamp),
        ),
        notInArray(osmAed.elementId, ids),
      ),
    )
    .returning({ id: osmAed.elementId });
  return rows.length;
};

export const aedHandler: OsmNodeHandler = {
  id: "aed",
  matches: hasAedTags,
  upsert,
  markDeleted,
  reconcile,
};
