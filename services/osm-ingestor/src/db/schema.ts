import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const osmReplicationState = pgTable(
  "osm_replication_state",
  {
    source: text("source").primaryKey(),
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    baseUrl: text("base_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "osm_replication_state_sequence_number_check",
      sql`${table.sequenceNumber} >= 0`,
    ),
  ],
);

export const osmPlanetImportState = pgTable("osm_planet_import_state", {
  sourceUrl: text("source_url").primaryKey(),
  filePath: text("file_path").notNull(),
  remoteEtag: text("remote_etag"),
  remoteLastModified: timestamp("remote_last_modified", {
    withTimezone: true,
  }),
  remoteContentLength: bigint("remote_content_length", { mode: "number" }),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
