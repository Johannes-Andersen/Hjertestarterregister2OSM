import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type OsmTags = Record<string, string>;

/**
 * Read-only view of the `osm_aed` table owned and migrated by the osm-ingestor
 * service. This service only ever SELECTs from it.
 */
export const osmAed = pgTable(
  "osm_aed",
  {
    elementType: text("element_type").notNull(),
    elementId: bigint("element_id", { mode: "number" }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    version: integer("version"),
    tags: jsonb("tags").$type<OsmTags>().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.elementType, table.elementId] })],
);

/** Read-only view of the history table owned by osm-ingestor. */
export const osmAedHistory = pgTable("osm_aed_history", {
  historyId: bigserial("history_id", { mode: "number" }).primaryKey(),
  elementType: text("element_type").notNull(),
  elementId: bigint("element_id", { mode: "number" }).notNull(),
  version: integer("version").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  userName: text("user_name"),
  isDeleted: boolean("is_deleted").notNull(),
});
