import {
  HjertestarterregisterApiClient,
  type PublicRegistryAsset,
} from "@repo/hjertestarterregister-sdk";
import type { Logger } from "pino";
import * as z from "zod";
import { env } from "./config.ts";
import type { AedInsert, OpeningInterval } from "./db/schema.ts";

export const registry = new HjertestarterregisterApiClient({
  clientId: env.HJERTESTARTERREGISTER_CLIENT_ID,
  clientSecret: env.HJERTESTARTERREGISTER_CLIENT_SECRET,
  baseUrl: env.HJERTESTARTERREGISTER_API_BASE_URL,
  oauthTokenUrl: env.HJERTESTARTERREGISTER_OAUTH_TOKEN_URL,
});

const yn = z.enum(["Y", "N"]).transform((value) => value === "Y");
const hhmm = z.number().int().min(0).max(2400).optional();

// The registry occasionally contains typo'd dates (e.g. year 0023 instead of
// 2023). These are valid JS Dates but round-trip to `Invalid Date` through a
// Postgres `timestamptz` (ancient dates emit a Local-Mean-Time offset Node
// cannot parse), so we constrain dates to a sane range.
const MIN_YEAR = 1990;
const MAX_YEAR = 9999;
const registryDate = z.coerce.date().refine((date) => {
  const year = date.getUTCFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR;
}, `Date must be between year ${MIN_YEAR} and ${MAX_YEAR}`);

// Optional active-period dates: an out-of-range value is dropped so the
// otherwise-valid AED is still stored.
const optionalRegistryDate = registryDate.optional().catch(() => undefined);

const emptyToNull = (value: string | undefined): string | null =>
  value && value.length > 0 ? value : null;

/** Convert a registry `HHMM` integer (e.g. `830`, `2400`) to minutes since midnight. */
const toMinutes = (value: number | undefined): number | null => {
  if (value === undefined) return null;
  const hours = Math.floor(value / 100);
  const minutes = value % 100;
  if (minutes >= 60 || hours > 24 || (hours === 24 && minutes !== 0)) {
    return null;
  }
  return hours * 60 + minutes;
};

const toInterval = (
  from: number | undefined,
  to: number | undefined,
): OpeningInterval | null => {
  const fromMinutes = toMinutes(from);
  const toMinutes_ = toMinutes(to);
  if (fromMinutes === null || toMinutes_ === null) return null;
  return { from: fromMinutes, to: toMinutes_ };
};

/**
 * Validate a raw registry asset and transform it into a row ready for storage.
 * Fields we do not persist (dynamic values such as IS_OPEN) are ignored.
 */
const registryAssetSchema = z
  .object({
    ASSET_ID: z.int().positive(),
    ASSET_GUID: z.string().trim().min(1),
    SITE_NAME: z.string().trim().min(1),
    SITE_ADDRESS: z.string().trim(),
    SITE_LATITUDE: z.number().min(-90).max(90),
    SITE_LONGITUDE: z.number().min(-180).max(180),
    // Whole floors only (e.g. -1, 0, 3). A fractional value (e.g. 2.5) is
    // dropped so the otherwise-valid AED is still stored.
    SITE_FLOOR_NUMBER: z
      .number()
      .int()
      .optional()
      .catch(() => undefined),
    SITE_POST_CODE: z.string().trim().optional(),
    SITE_POST_AREA: z.string().trim().min(1).optional(),
    SITE_DESCRIPTION: z.string().trim().optional(),
    IS_MOBILE: yn,
    CREATED_DATE: registryDate,
    MODIFIED_DATE: registryDate,
    ACTIVE_FROM_DATE: optionalRegistryDate,
    ACTIVE_TO_DATE: optionalRegistryDate,
    OPENING_HOURS_LIMITED: yn,
    OPENING_HOURS_CLOSED_HOLIDAYS: yn,
    OPENING_HOURS_MON_FROM: hhmm,
    OPENING_HOURS_MON_TO: hhmm,
    OPENING_HOURS_TUE_FROM: hhmm,
    OPENING_HOURS_TUE_TO: hhmm,
    OPENING_HOURS_WED_FROM: hhmm,
    OPENING_HOURS_WED_TO: hhmm,
    OPENING_HOURS_THU_FROM: hhmm,
    OPENING_HOURS_THU_TO: hhmm,
    OPENING_HOURS_FRI_FROM: hhmm,
    OPENING_HOURS_FRI_TO: hhmm,
    OPENING_HOURS_SAT_FROM: hhmm,
    OPENING_HOURS_SAT_TO: hhmm,
    OPENING_HOURS_SUN_FROM: hhmm,
    OPENING_HOURS_SUN_TO: hhmm,
  })
  .transform(
    (a): AedInsert => ({
      assetId: a.ASSET_ID,
      assetGuid: a.ASSET_GUID,
      siteName: a.SITE_NAME,
      siteAddress: a.SITE_ADDRESS,
      siteLatitude: a.SITE_LATITUDE,
      siteLongitude: a.SITE_LONGITUDE,
      siteFloorNumber: a.SITE_FLOOR_NUMBER ?? null,
      sitePostCode: emptyToNull(a.SITE_POST_CODE),
      sitePostArea: emptyToNull(a.SITE_POST_AREA),
      siteDescription: emptyToNull(a.SITE_DESCRIPTION),
      isMobile: a.IS_MOBILE,
      createdDate: a.CREATED_DATE,
      modifiedDate: a.MODIFIED_DATE,
      activeFromDate: a.ACTIVE_FROM_DATE ?? null,
      activeToDate: a.ACTIVE_TO_DATE ?? null,
      openingHoursLimited: a.OPENING_HOURS_LIMITED,
      openingHoursClosedHolidays: a.OPENING_HOURS_CLOSED_HOLIDAYS,
      openingHours: {
        mon: toInterval(a.OPENING_HOURS_MON_FROM, a.OPENING_HOURS_MON_TO),
        tue: toInterval(a.OPENING_HOURS_TUE_FROM, a.OPENING_HOURS_TUE_TO),
        wed: toInterval(a.OPENING_HOURS_WED_FROM, a.OPENING_HOURS_WED_TO),
        thu: toInterval(a.OPENING_HOURS_THU_FROM, a.OPENING_HOURS_THU_TO),
        fri: toInterval(a.OPENING_HOURS_FRI_FROM, a.OPENING_HOURS_FRI_TO),
        sat: toInterval(a.OPENING_HOURS_SAT_FROM, a.OPENING_HOURS_SAT_TO),
        sun: toInterval(a.OPENING_HOURS_SUN_FROM, a.OPENING_HOURS_SUN_TO),
      },
    }),
  );

export interface ParsedAssets {
  rows: AedInsert[];
  /** Every asset id present in the snapshot, including ones that failed validation. */
  foundAssetIds: number[];
  invalid: number;
}

export const parseAssets = (
  assets: PublicRegistryAsset[],
  log: Logger,
): ParsedAssets => {
  const rowsById = new Map<number, AedInsert>();
  const foundAssetIds = new Set<number>();
  let invalid = 0;

  for (const asset of assets) {
    if (Number.isInteger(asset.ASSET_ID) && asset.ASSET_ID > 0) {
      foundAssetIds.add(asset.ASSET_ID);
    }

    const result = registryAssetSchema.safeParse(asset);
    if (result.success) {
      rowsById.set(result.data.assetId, result.data);
    } else {
      invalid++;
      log.warn(
        { assetId: asset.ASSET_ID, assetGuid: asset.ASSET_GUID },
        "Skipping invalid AED",
      );
    }
  }

  return {
    rows: [...rowsById.values()],
    foundAssetIds: [...foundAssetIds],
    invalid,
  };
};

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/** Format a date as the registry's `DD-MON-YYYY` filter value. */
export const toRegistryDate = (date: Date): string => {
  const month = MONTHS[date.getUTCMonth()];
  if (!month || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid registry cursor date: ${date.toString()}`);
  }
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${day}-${month}-${date.getUTCFullYear()}`;
};
