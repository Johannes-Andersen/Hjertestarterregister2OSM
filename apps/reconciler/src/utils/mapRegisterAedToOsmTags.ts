import type { AedTags } from "../types/aedTags.ts";
import type { RegisterAed } from "../types/registerAed.ts";
import { logger } from "./logger.ts";

const log = logger.child({ util: "mapRegisterAedToOsmTags" });

/** OSM enforces a 255 unicode character limit on tag values */
const OSM_MAX_TAG_VALUE_LENGTH = 255;

/**
 * Performs validation and normalization on a potential tag value from the register.
 * - Trims whitespace and collapses multiple spaces into one
 * - Ensures the value is a string and not empty after trimming
 * - Checks that the length does not exceed OSM limits
 * - Logs a warning and returns null if the value is invalid
 */
const validateTagValue = ({
  value,
  tagName,
  aedGuid,
}: {
  value?: string | number;
  tagName: string;
  aedGuid: string;
}): string | null => {
  if (value === undefined || value === null) return null;

  const normalizedValue =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value
        : null;

  if (!normalizedValue) return null;

  const cleanedValue = normalizedValue.trim().replace(/\s+/g, " "); // collapse multiple whitespace

  if (cleanedValue.length === 0) return null;

  if (cleanedValue.length >= OSM_MAX_TAG_VALUE_LENGTH) {
    log.warn(
      `Skipping ${tagName} for AED ${aedGuid}: value exceeds ${OSM_MAX_TAG_VALUE_LENGTH} chars (${cleanedValue.length} chars)`,
    );
    return null;
  }

  return cleanedValue;
};

type DayRange = { day: string; from?: number; to?: number };

const dayRangesFromRegister = (aed: RegisterAed): DayRange[] => [
  {
    day: "Mo",
    from: aed.OPENING_HOURS_MON_FROM,
    to: aed.OPENING_HOURS_MON_TO,
  },
  {
    day: "Tu",
    from: aed.OPENING_HOURS_TUE_FROM,
    to: aed.OPENING_HOURS_TUE_TO,
  },
  {
    day: "We",
    from: aed.OPENING_HOURS_WED_FROM,
    to: aed.OPENING_HOURS_WED_TO,
  },
  {
    day: "Th",
    from: aed.OPENING_HOURS_THU_FROM,
    to: aed.OPENING_HOURS_THU_TO,
  },
  {
    day: "Fr",
    from: aed.OPENING_HOURS_FRI_FROM,
    to: aed.OPENING_HOURS_FRI_TO,
  },
  {
    day: "Sa",
    from: aed.OPENING_HOURS_SAT_FROM,
    to: aed.OPENING_HOURS_SAT_TO,
  },
  {
    day: "Su",
    from: aed.OPENING_HOURS_SUN_FROM,
    to: aed.OPENING_HOURS_SUN_TO,
  },
];

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatRegisterTime = (value: number | undefined): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const normalized = Math.trunc(value);
  if (normalized < 0 || normalized > 2400) return null;

  const hour = Math.floor(normalized / 100);
  const minute = normalized % 100;

  if (hour > 24) return null;
  if (minute >= 60) return null;
  if (hour === 24 && minute !== 0) return null;

  return `${pad2(hour)}:${pad2(minute)}`;
};

const buildOpeningHours = (aed: RegisterAed): string | null => {
  const entries = dayRangesFromRegister(aed)
    .map(({ day, from, to }, index) => {
      const fromTime = formatRegisterTime(from);
      const toTime = formatRegisterTime(to);
      if (!fromTime || !toTime) return null;

      return { day, interval: `${fromTime}-${toTime}`, index };
    })
    .filter(
      (entry): entry is { day: string; interval: string; index: number } =>
        !!entry,
    );

  if (!entries.length) return null;

  const grouped: Array<{
    fromDay: string;
    toDay: string;
    interval: string;
    toIndex: number;
  }> = [];
  for (const entry of entries) {
    const lastGroup = grouped[grouped.length - 1];
    if (
      lastGroup &&
      lastGroup.interval === entry.interval &&
      lastGroup.toIndex + 1 === entry.index
    ) {
      lastGroup.toDay = entry.day;
      lastGroup.toIndex = entry.index;
      continue;
    }

    grouped.push({
      fromDay: entry.day,
      toDay: entry.day,
      interval: entry.interval,
      toIndex: entry.index,
    });
  }

  const parts = grouped.map(({ fromDay, toDay, interval }) => {
    const days = fromDay === toDay ? fromDay : `${fromDay}-${toDay}`;
    return `${days} ${interval}`;
  });

  if (aed.OPENING_HOURS_CLOSED_HOLIDAYS === "Y") parts.push("PH off");
  if (aed.OPENING_HOURS_CLOSED_HOLIDAYS === "N") parts.push("PH open");

  return parts.join("; ");
};

export const mapRegisterAedToOsmTags = (aed: RegisterAed): AedTags => {
  const tags: AedTags = {
    emergency: "defibrillator",
    "emergency:phone": "113",
    "ref:hjertestarterregister": aed.ASSET_GUID,
  };

  const name = validateTagValue({
    value: aed.SITE_NAME,
    tagName: "name",
    aedGuid: aed.ASSET_GUID,
  });
  if (name) tags.name = name;

  if (
    typeof aed.SITE_FLOOR_NUMBER === "number" &&
    Number.isFinite(aed.SITE_FLOOR_NUMBER)
  ) {
    tags.level = String(aed.SITE_FLOOR_NUMBER);
  }

  const location = validateTagValue({
    value: aed.SITE_DESCRIPTION,
    tagName: "defibrillator:location",
    aedGuid: aed.ASSET_GUID,
  });
  if (location) tags["defibrillator:location"] = location;

  const model = validateTagValue({
    value: aed.ASSET_TYPE_NAME,
    tagName: "model",
    aedGuid: aed.ASSET_GUID,
  });
  if (model) tags.model = model;

  const manufacturer = validateTagValue({
    value: aed.MANUFACTURER_NAME,
    tagName: "manufacturer",
    aedGuid: aed.ASSET_GUID,
  });
  if (manufacturer) tags.manufacturer = manufacturer;

  const openingHours = buildOpeningHours(aed);
  if (openingHours) tags.opening_hours = openingHours;

  return tags;
};
