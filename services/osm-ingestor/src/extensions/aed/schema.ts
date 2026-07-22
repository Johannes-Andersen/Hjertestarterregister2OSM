import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export type OsmTags = Record<string, string>;

export const osmAed = pgTable(
  "osm_aed",
  {
    elementType: text("element_type").notNull(),
    elementId: bigint("element_id", { mode: "number" }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    version: integer("version"),
    changeset: bigint("changeset", { mode: "number" }),
    uid: bigint("uid", { mode: "number" }),
    userName: text("user_name"),
    osmTimestamp: timestamp("osm_timestamp", { withTimezone: true }),
    tags: jsonb("tags").$type<OsmTags>().notNull(),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.elementType, table.elementId] }),
    check("osm_aed_element_type_check", sql`${table.elementType} = 'node'`),
    check("osm_aed_element_id_check", sql`${table.elementId} > 0`),
    check("osm_aed_latitude_check", sql`${table.latitude} BETWEEN -90 AND 90`),
    check(
      "osm_aed_longitude_check",
      sql`${table.longitude} BETWEEN -180 AND 180`,
    ),
    index("osm_aed_deleted_at_idx").on(table.deletedAt),
    index("osm_aed_osm_timestamp_idx").on(table.osmTimestamp.desc()),
    index("osm_aed_tags_gin_idx").using("gin", table.tags),
  ],
);

export const osmAedHistory = pgTable(
  "osm_aed_history",
  {
    historyId: bigserial("history_id", { mode: "number" }).primaryKey(),
    elementType: text("element_type").notNull(),
    elementId: bigint("element_id", { mode: "number" }).notNull(),
    version: integer("version").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    changeset: bigint("changeset", { mode: "number" }),
    uid: bigint("uid", { mode: "number" }),
    userName: text("user_name"),
    osmTimestamp: timestamp("osm_timestamp", { withTimezone: true }),
    tags: jsonb("tags").$type<OsmTags>().notNull(),
    isAed: boolean("is_aed").notNull(),
    isDeleted: boolean("is_deleted").notNull(),
    source: text("source").notNull(),
    replicationSequence: bigint("replication_sequence", { mode: "number" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("osm_aed_history_element_version_unique").on(
      table.elementType,
      table.elementId,
      table.version,
    ),
    check(
      "osm_aed_history_element_type_check",
      sql`${table.elementType} = 'node'`,
    ),
    check("osm_aed_history_element_id_check", sql`${table.elementId} > 0`),
    check("osm_aed_history_version_check", sql`${table.version} > 0`),
    check(
      "osm_aed_history_latitude_check",
      sql`${table.latitude} IS NULL OR ${table.latitude} BETWEEN -90 AND 90`,
    ),
    check(
      "osm_aed_history_longitude_check",
      sql`${table.longitude} IS NULL OR ${table.longitude} BETWEEN -180 AND 180`,
    ),
    check(
      "osm_aed_history_source_check",
      sql`${table.source} IN ('planet', 'minute')`,
    ),
    check(
      "osm_aed_history_replication_sequence_check",
      sql`${table.replicationSequence} IS NULL OR ${table.replicationSequence} >= 0`,
    ),
    index("osm_aed_history_element_idx").on(
      table.elementType,
      table.elementId,
      table.version.desc(),
    ),
    index("osm_aed_history_timestamp_idx").on(table.osmTimestamp.desc()),
  ],
);
