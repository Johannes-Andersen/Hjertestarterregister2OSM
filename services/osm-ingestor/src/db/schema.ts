import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Singleton (`id = 1`) row tracking both the last imported planet build and the
 * minute replication cursor. One row is enough because the service follows a
 * single planet source and replication stream.
 */
export const osmSyncState = pgTable(
  "osm_sync_state",
  {
    id: smallint("id").primaryKey().default(1),

    // Minute replication cursor.
    replicationSequence: bigint("replication_sequence", { mode: "number" }),
    replicationTimestamp: timestamp("replication_timestamp", {
      withTimezone: true,
    }),
    replicationBaseUrl: text("replication_base_url"),

    // Last imported planet build.
    planetSourceUrl: text("planet_source_url"),
    planetFilePath: text("planet_file_path"),
    planetEtag: text("planet_etag"),
    planetLastModified: timestamp("planet_last_modified", {
      withTimezone: true,
    }),
    planetContentLength: bigint("planet_content_length", { mode: "number" }),
    planetImportedAt: timestamp("planet_imported_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("osm_sync_state_singleton_check", sql`${table.id} = 1`),
    check(
      "osm_sync_state_replication_sequence_check",
      sql`${table.replicationSequence} IS NULL OR ${table.replicationSequence} >= 0`,
    ),
  ],
);

export type OsmSyncStateRow = typeof osmSyncState.$inferSelect;
