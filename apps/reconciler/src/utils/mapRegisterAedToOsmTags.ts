import type { AedTags } from "../types/aedTags.ts";
import type { RegisterAed } from "../types/registerAed.ts";
import { buildOpeningHours } from "./buildOpeningHours.ts";
import { logger } from "./logger.ts";

const log = logger.child({ util: "mapRegisterAedToOsmTags" });

const OSM_MAX_TAG_VALUE_LENGTH = 255;
const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;

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

  const cleanedValue = normalizedValue
    // Replace newlines with ". " to ensure separate sentences don't merge
    .replace(/[\r\n]+/g, ". ")
    .replace(/\s+/g, " ") // Collapse multiple whitespace
    .replace(/\s\./g, ".") // Remove space before period (e.g. " . " -> ". ")
    .replace(/\.+/g, ".") // Deduplicate periods (e.g. ".." -> ".")
    .trim();

  if (cleanedValue.length === 0) return null;

  // OSM enforces a 255 unicode character limit on tag values
  if (cleanedValue.length >= OSM_MAX_TAG_VALUE_LENGTH) {
    log.warn(
      `Skipping ${tagName} for AED ${aedGuid}: value exceeds ${OSM_MAX_TAG_VALUE_LENGTH} chars (${cleanedValue.length} chars)`,
    );
    return null;
  }

  return cleanedValue;
};

/**
 * Extracts emails from the description. Looks for common email patterns.
 * Returns an array of unique email addresses or null if none found.
 */
const extractEmails = ({
  description,
  aedGuid,
}: {
  description: string;
  aedGuid: string;
}): Array<string> | null => {
  const matches = description.match(emailRegex);
  if (!matches) return null;

  const emails = matches
    .map((email) =>
      validateTagValue({
        value: email,
        tagName: "email",
        aedGuid,
      }),
    )
    .filter((email): email is string => !!email);

  return emails.length > 0 ? Array.from(new Set(emails)) : null;
};

/**
 * Detect common AED cabinet information
 */
const detectCabinet = (
  description: string,
): { type: string; color: string; manufacturer: string } | null => {
  let type = "";
  let color = "";
  let manufacturer = "";

  if (/Rotaid/i.test(description)) {
    type = "twist";
    manufacturer = "Rotaid";
  }

  if (/\bgrønt(?:\s+rundt)?(?:\s+varme)?\s*skap\b/i.test(description)) {
    color = "green";
  }

  if (!type && !color && !manufacturer) return null;

  return { type, color, manufacturer };
};

/**
 * Extracts a Norwegian phone number from a description.
 * Looks for patterns:
 * - xx xx xx xx
 * - xxx xx xxx
 * - +47 xx xx xx xx
 * Returns deduplicated phone numbers in a standardized format or null if none found.
 */
const extractPhones = (description: string): Array<`+47 ${string}`> | null => {
  const phoneRegex =
    /(?:\+47\s?)?(\d{2}\s?\d{2}\s?\d{2}\s?\d{2}|\d{3}\s?\d{2}\s?\d{3})/g;
  const matches = description.match(phoneRegex);
  if (!matches) return null;

  const phones = matches
    .map((phone) => {
      const cleanedPhone = phone.replace(/\s/g, "");
      if (cleanedPhone.length === 8) {
        return `+47 ${cleanedPhone.replace(/(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4")}`;
      } else if (cleanedPhone.length === 9 && cleanedPhone.startsWith("4")) {
        return `+47 ${cleanedPhone.replace(/(\d{3})(\d{2})(\d{3})/, "$1 $2 $3")}`;
      } else {
        return null;
      }
    })
    .filter((phone): phone is `+47 ${string}` => !!phone);

  return phones.length > 0 ? Array.from(new Set(phones)) : null;
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

  const email = extractEmails({
    description: aed.SITE_DESCRIPTION || "",
    aedGuid: aed.ASSET_GUID,
  });
  if (email && email.length > 0) tags.email = email.join("; ");

  const phone = extractPhones(aed.SITE_DESCRIPTION || "");
  if (phone && phone.length > 0) tags.phone = phone.join("; ");

  const openingHours = buildOpeningHours(aed);
  if (openingHours) tags.opening_hours = openingHours;

  const cabinetInfo = detectCabinet(aed.SITE_DESCRIPTION || "");
  if (cabinetInfo) {
    if (cabinetInfo.type) tags["defibrillator:cabinet"] = cabinetInfo.type;
    if (cabinetInfo.color)
      tags["defibrillator:cabinet:colour"] = cabinetInfo.color;
    if (cabinetInfo.manufacturer) {
      tags["defibrillator:cabinet:manufacturer"] = cabinetInfo.manufacturer;
    }
  }

  return tags;
};
