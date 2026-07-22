import { eq, lte, sql } from "drizzle-orm";
import { db } from "../clients/postgresClient.ts";
import { osmPlanetImportState, osmReplicationState } from "../db/schema.ts";

export const osmMinuteReplicationSource = "minute";

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

export const getOsmReplicationState = async (
  source: string,
): Promise<OsmReplicationState | null> => {
  const [row] = await db
    .select()
    .from(osmReplicationState)
    .where(eq(osmReplicationState.source, source));
  if (!row) return null;
  return {
    source: row.source,
    sequence_number: row.sequenceNumber,
    timestamp: row.timestamp,
    base_url: row.baseUrl,
  };
};

export const saveOsmReplicationState = async (
  state: OsmReplicationState,
): Promise<void> => {
  await db
    .insert(osmReplicationState)
    .values({
      source: state.source,
      sequenceNumber: state.sequence_number,
      timestamp: state.timestamp,
      baseUrl: state.base_url,
    })
    .onConflictDoUpdate({
      target: osmReplicationState.source,
      set: {
        sequenceNumber: state.sequence_number,
        timestamp: state.timestamp,
        baseUrl: state.base_url,
        updatedAt: new Date(),
      },
      setWhere: lte(osmReplicationState.sequenceNumber, state.sequence_number),
    });
};

export const getOsmPlanetImportState = async (
  sourceUrl: string,
): Promise<OsmPlanetImportState | null> => {
  const [row] = await db
    .select()
    .from(osmPlanetImportState)
    .where(eq(osmPlanetImportState.sourceUrl, sourceUrl));
  if (!row) return null;
  return {
    source_url: row.sourceUrl,
    file_path: row.filePath,
    remote_etag: row.remoteEtag,
    remote_last_modified: row.remoteLastModified,
    remote_content_length: row.remoteContentLength,
    imported_at: row.importedAt,
  };
};

export const saveOsmPlanetImportState = async (
  state: OsmPlanetImportState,
): Promise<void> => {
  await db
    .insert(osmPlanetImportState)
    .values({
      sourceUrl: state.source_url,
      filePath: state.file_path,
      remoteEtag: state.remote_etag,
      remoteLastModified: state.remote_last_modified,
      remoteContentLength: state.remote_content_length,
      importedAt: state.imported_at,
    })
    .onConflictDoUpdate({
      target: osmPlanetImportState.sourceUrl,
      set: {
        filePath: state.file_path,
        remoteEtag: state.remote_etag,
        remoteLastModified: state.remote_last_modified,
        remoteContentLength: state.remote_content_length,
        importedAt: state.imported_at,
        updatedAt: sql`now()`,
      },
    });
};
