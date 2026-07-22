import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/** Per-weekday opening interval in minutes since midnight (0–1440). */
export interface OpeningInterval {
  from: number;
  to: number;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** `null` means the registry did not provide hours for that day. */
export type OpeningHours = Record<Weekday, OpeningInterval | null>;

export const aed = pgTable(
  "aed",
  {
    assetId: integer("asset_id").primaryKey(),
    assetGuid: text("asset_guid").notNull(),
    siteName: text("site_name").notNull(),
    siteAddress: text("site_address").notNull(),
    siteLatitude: doublePrecision("site_latitude").notNull(),
    siteLongitude: doublePrecision("site_longitude").notNull(),
    siteFloorNumber: integer("site_floor_number"),
    sitePostCode: text("site_post_code"),
    sitePostArea: text("site_post_area"),
    siteDescription: text("site_description"),
    isMobile: boolean("is_mobile").notNull(),
    createdDate: timestamp("created_date", { withTimezone: true }).notNull(),
    modifiedDate: timestamp("modified_date", { withTimezone: true }).notNull(),
    activeFromDate: timestamp("active_from_date", { withTimezone: true }),
    activeToDate: timestamp("active_to_date", { withTimezone: true }),
    openingHoursLimited: boolean("opening_hours_limited").notNull(),
    openingHoursClosedHolidays: boolean(
      "opening_hours_closed_holidays",
    ).notNull(),
    openingHours: jsonb("opening_hours").$type<OpeningHours>().notNull(),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("aed_asset_guid_unique").on(table.assetGuid),
    check("aed_asset_id_check", sql`${table.assetId} > 0`),
    check(
      "aed_site_latitude_check",
      sql`${table.siteLatitude} BETWEEN -90 AND 90`,
    ),
    check(
      "aed_site_longitude_check",
      sql`${table.siteLongitude} BETWEEN -180 AND 180`,
    ),
    index("aed_deleted_at_idx").on(table.deletedAt),
    index("aed_modified_date_idx").on(table.modifiedDate.desc()),
  ],
);

export const aedRegistrySyncState = pgTable(
  "aed_registry_sync_state",
  {
    singletonId: smallint("singleton_id").primaryKey().default(1),
    lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
    lastIncrementalSyncAt: timestamp("last_incremental_sync_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "aed_registry_sync_state_singleton_check",
      sql`${table.singletonId} = 1`,
    ),
  ],
);

export type AedInsert = typeof aed.$inferInsert;
export type AedRow = typeof aed.$inferSelect;
