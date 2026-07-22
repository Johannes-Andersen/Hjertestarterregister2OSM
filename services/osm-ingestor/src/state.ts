import { eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "./db/index.ts";
import { type OsmSyncStateRow, osmSyncState } from "./db/schema.ts";

export const getSyncState = async (): Promise<OsmSyncStateRow | null> => {
  const [row] = await db
    .select()
    .from(osmSyncState)
    .where(eq(osmSyncState.id, 1));
  return row ?? null;
};

/** Advance the minute replication cursor (never regresses to an older sequence). */
export const saveReplicationState = async (state: {
  sequence: number;
  timestamp: Date;
  baseUrl: string;
}): Promise<void> => {
  const values = {
    replicationSequence: state.sequence,
    replicationTimestamp: state.timestamp,
    replicationBaseUrl: state.baseUrl,
  };
  await db
    .insert(osmSyncState)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({
      target: osmSyncState.id,
      set: { ...values, updatedAt: sql`now()` },
      setWhere: or(
        isNull(osmSyncState.replicationSequence),
        lte(osmSyncState.replicationSequence, state.sequence),
      ),
    });
};

export const savePlanetImport = async (planet: {
  sourceUrl: string;
  filePath: string;
  etag: string | null;
  lastModified: Date | null;
  contentLength: number | null;
  importedAt: Date;
}): Promise<void> => {
  const values = {
    planetSourceUrl: planet.sourceUrl,
    planetFilePath: planet.filePath,
    planetEtag: planet.etag,
    planetLastModified: planet.lastModified,
    planetContentLength: planet.contentLength,
    planetImportedAt: planet.importedAt,
  };
  await db
    .insert(osmSyncState)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({
      target: osmSyncState.id,
      set: { ...values, updatedAt: sql`now()` },
    });
};
