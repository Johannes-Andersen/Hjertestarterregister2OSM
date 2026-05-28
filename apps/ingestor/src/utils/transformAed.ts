import type { validateAedData } from "./validateAed.ts";

type ValidatedAed = ReturnType<typeof validateAedData>;

/**
 * Per-weekday opening interval expressed in minutes since midnight (0–1440).
 * `null` means the registry did not provide hours for that day.
 */
export interface OpeningInterval {
  from: number;
  to: number;
}

export interface OpeningHours {
  mon: OpeningInterval | null;
  tue: OpeningInterval | null;
  wed: OpeningInterval | null;
  thu: OpeningInterval | null;
  fri: OpeningInterval | null;
  sat: OpeningInterval | null;
  sun: OpeningInterval | null;
}

/**
 * Shape of a row in the `aed` PostgreSQL table.
 */
export interface AedRow {
  asset_id: number;
  asset_guid: string;

  site_name: string;
  site_address: string;
  site_latitude: number;
  site_longitude: number;
  site_floor_number: number | null;
  site_post_code: string | null;
  site_post_area: string | null;
  site_description: string | null;

  is_mobile: boolean;

  created_date: Date;
  modified_date: Date;

  active_from_date: Date | null;
  active_to_date: Date | null;

  opening_hours_limited: boolean;
  opening_hours_closed_holidays: boolean;
  opening_hours: OpeningHours;
}

const emptyToNull = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Convert a registry `HHMM` integer (e.g. `0`, `830`, `1730`, `2400`) into
 * minutes since midnight (0–1440). Returns `null` when the value is malformed.
 */
const hhmmToMinutes = (value: number | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const normalized = Math.trunc(value);
  if (normalized < 0 || normalized > 2400) return null;

  const hours = Math.floor(normalized / 100);
  const minutes = normalized % 100;

  if (hours > 24) return null;
  if (minutes >= 60) return null;
  if (hours === 24 && minutes !== 0) return null;

  return hours * 60 + minutes;
};

const toInterval = (
  from: number | undefined,
  to: number | undefined,
): OpeningInterval | null => {
  const fromMinutes = hhmmToMinutes(from);
  const toMinutes = hhmmToMinutes(to);
  if (fromMinutes === null || toMinutes === null) return null;
  return { from: fromMinutes, to: toMinutes };
};

const buildOpeningHours = (aed: ValidatedAed): OpeningHours => ({
  mon: toInterval(aed.OPENING_HOURS_MON_FROM, aed.OPENING_HOURS_MON_TO),
  tue: toInterval(aed.OPENING_HOURS_TUE_FROM, aed.OPENING_HOURS_TUE_TO),
  wed: toInterval(aed.OPENING_HOURS_WED_FROM, aed.OPENING_HOURS_WED_TO),
  thu: toInterval(aed.OPENING_HOURS_THU_FROM, aed.OPENING_HOURS_THU_TO),
  fri: toInterval(aed.OPENING_HOURS_FRI_FROM, aed.OPENING_HOURS_FRI_TO),
  sat: toInterval(aed.OPENING_HOURS_SAT_FROM, aed.OPENING_HOURS_SAT_TO),
  sun: toInterval(aed.OPENING_HOURS_SUN_FROM, aed.OPENING_HOURS_SUN_TO),
});

// We do not store the following fields,
// as they are dynamic values at time of request from the registry:
// - IS_OPEN_DATE
// - IS_OPEN
// - ACTIVE_DATE_LIMITED
// - OPENING_HOURS_TEXT

/**
 * Transform a validated AED record into a row suitable for storing in PostgreSQL.
 */
export const transformAedForStorage = (aed: ValidatedAed): AedRow => ({
  asset_id: aed.ASSET_ID,
  asset_guid: aed.ASSET_GUID,

  site_name: aed.SITE_NAME.trim(),
  site_address: aed.SITE_ADDRESS.trim(),
  site_latitude: aed.SITE_LATITUDE,
  site_longitude: aed.SITE_LONGITUDE,
  site_floor_number: aed.SITE_FLOOR_NUMBER ?? null,
  site_post_code: emptyToNull(aed.SITE_POST_CODE),
  site_post_area: emptyToNull(aed.SITE_POST_AREA),
  site_description: emptyToNull(aed.SITE_DESCRIPTION),

  is_mobile: aed.IS_MOBILE,

  created_date: aed.CREATED_DATE,
  modified_date: aed.MODIFIED_DATE,

  active_from_date: aed.ACTIVE_FROM_DATE ?? null,
  active_to_date: aed.ACTIVE_TO_DATE ?? null,

  opening_hours_limited: aed.OPENING_HOURS_LIMITED,
  opening_hours_closed_holidays: aed.OPENING_HOURS_CLOSED_HOLIDAYS,
  opening_hours: buildOpeningHours(aed),
});
