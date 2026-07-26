import OpeningHoursParser, { type nominatim_object } from "opening_hours";
import { REF_TAG } from "./config.ts";
import type { OpeningHours, RegistryAed } from "./events.ts";

/**
 * Tags this service owns and keeps in sync with the registry. Other tags on a
 * node (name, community additions, etc.) are always preserved.
 */
export const MANAGED_TAG_KEYS = [
  "emergency",
  "emergency:phone",
  REF_TAG,
  "opening_hours",
  "level",
  "description",
  "defibrillator:location",
] as const;

// OSM rejects a whole changeset if any tag value exceeds 255 characters.
const MAX_TAG_VALUE_LENGTH = 255;

// Feature keys whose presence means the node is more than just an AED, so it
// must never be deleted (only its AED tags may be stripped).
const PRIMARY_FEATURE_KEYS = new Set([
  "aerialway",
  "aeroway",
  "amenity",
  "barrier",
  "building",
  "craft",
  "healthcare",
  "highway",
  "historic",
  "landuse",
  "leisure",
  "man_made",
  "natural",
  "office",
  "power",
  "public_transport",
  "railway",
  "shop",
  "tourism",
  "waterway",
]);

const setTag = (
  tags: Record<string, string>,
  key: string,
  value: string,
): void => {
  if (value.length <= MAX_TAG_VALUE_LENGTH) tags[key] = value;
};

/**
 * Registry site labels are frequently stored ALL-CAPS (e.g.
 * "KLEPPESTØSENTER HOVEDINNGANG"). When a value is entirely uppercase, fold it
 * to sentence case; mixed-case values (already human-edited) are left untouched.
 */
const normalizeCaps = (value: string): string => {
  const trimmed = value.trim();
  const hasLetters = /\p{L}/u.test(trimmed);
  const isAllCaps =
    hasLetters &&
    trimmed === trimmed.toUpperCase() &&
    trimmed !== trimmed.toLowerCase();
  if (!isAllCaps) return trimmed;
  return trimmed.toLowerCase().replace(/\p{L}/u, (c) => c.toUpperCase());
};

const WEEKDAYS: { key: keyof OpeningHours; label: string }[] = [
  { key: "mon", label: "Mo" },
  { key: "tue", label: "Tu" },
  { key: "wed", label: "We" },
  { key: "thu", label: "Th" },
  { key: "fri", label: "Fr" },
  { key: "sat", label: "Sa" },
  { key: "sun", label: "Su" },
];

const toHHMM = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

// The parser resolves Norwegian public holidays for the `PH` selector.
const NORWAY_NOMINATIM: nominatim_object = {
  lat: 0,
  lon: 0,
  address: { country_code: "no", state: "" },
};

/**
 * Whether `value` is syntactically valid OSM `opening_hours`. The parser throws
 * on malformed values (bad times, unparseable ranges), which guards us against
 * emitting a broken tag from unexpected registry data.
 */
const isValidOpeningHours = (value: string): boolean => {
  try {
    // Defaults to the `opening_hours` tag grammar; throws on invalid input.
    new OpeningHoursParser(value, NORWAY_NOMINATIM);
    return true;
  } catch {
    return false;
  }
};

// A day's interval, treating a zero-length range (from === to) as closed.
const dayInterval = (
  aed: RegistryAed,
  key: keyof OpeningHours,
): { from: number; to: number } | null => {
  const iv = aed.openingHours[key];
  return iv && iv.from !== iv.to ? iv : null;
};

/** Build an OSM `opening_hours` value, collapsing consecutive identical days. */
const buildOpeningHours = (aed: RegistryAed): string | null => {
  if (!aed.openingHoursLimited) {
    return aed.openingHoursClosedHolidays ? "24/7; PH off" : "24/7";
  }

  const parts: string[] = [];
  let i = 0;
  while (i < WEEKDAYS.length) {
    const day = WEEKDAYS[i];
    const iv = day ? dayInterval(aed, day.key) : null;
    if (!day || !iv) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < WEEKDAYS.length) {
      const next = WEEKDAYS[j + 1];
      const nextIv = next ? dayInterval(aed, next.key) : null;
      if (!next || !nextIv || nextIv.from !== iv.from || nextIv.to !== iv.to) {
        break;
      }
      j++;
    }
    const range = `${toHHMM(iv.from)}-${toHHMM(iv.to)}`;
    const end = WEEKDAYS[j];
    const label = j > i && end ? `${day.label}-${end.label}` : day.label;
    parts.push(`${label} ${range}`);
    i = j + 1;
  }

  if (parts.length === 0) return null;
  const value = parts.join("; ");
  const withHolidays = aed.openingHoursClosedHolidays
    ? `${value}; PH off`
    : value;
  return isValidOpeningHours(withHolidays) ? withHolidays : null;
};

/** Derive the OSM tags this service manages for a registry AED. */
export const registryAedToTags = (aed: RegistryAed): Record<string, string> => {
  const tags: Record<string, string> = {
    emergency: "defibrillator",
    "emergency:phone": "113",
  };
  setTag(tags, REF_TAG, aed.assetGuid);

  const openingHours = buildOpeningHours(aed);
  if (openingHours) setTag(tags, "opening_hours", openingHours);

  if (aed.siteFloorNumber !== null) {
    setTag(tags, "level", String(aed.siteFloorNumber));
  }

  // TODO: Replace this with description
  // const description = normalizeCaps(aed.siteName);
  // if (description) setTag(tags, "description", description);
  const description = normalizeCaps(aed.siteName);
  if (description) setTag(tags, "name", description);

  // Free-text hint for where the AED is located within the site.
  if (aed.siteDescription !== null) {
    const location = normalizeCaps(aed.siteDescription);
    if (location) setTag(tags, "defibrillator:location", location);
  }

  return tags;
};

/** A node is "AED-only" when it carries no other primary-feature tag. */
export const isAedOnlyNode = (
  tags: Record<string, string> | undefined,
): boolean => {
  for (const key of Object.keys(tags ?? {})) {
    if (PRIMARY_FEATURE_KEYS.has(key)) return false;
  }
  return true;
};

/** Remove only the unambiguous AED tags, leaving host-feature tags intact. */
export const stripAedTags = (
  tags: Record<string, string>,
): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (key === "emergency" && value === "defibrillator") continue;
    if (key === "emergency:phone") continue;
    if (key === REF_TAG) continue;
    if (key === "defibrillator" || key.startsWith("defibrillator:")) continue;
    next[key] = value;
  }
  return next;
};

/** Whether stripping AED tags would actually remove anything from `tags`. */
export const hasStrippableAedTags = (tags: Record<string, string>): boolean =>
  Object.keys(stripAedTags(tags)).length !== Object.keys(tags).length;

/**
 * Merge managed tags onto an existing node's tags. Returns the new tag set and
 * whether any managed tag actually changed.
 */
export const applyManagedTags = (
  existing: Record<string, string>,
  managed: Record<string, string>,
): { tags: Record<string, string>; changed: boolean } => {
  const tags = { ...existing };
  let changed = false;
  for (const [key, value] of Object.entries(managed)) {
    if (tags[key] !== value) {
      tags[key] = value;
      changed = true;
    }
  }
  return { tags, changed };
};

export const hasNoteOrFixme = (
  tags: Record<string, string> | undefined,
): boolean => Boolean(tags && ("note" in tags || "fixme" in tags));
