import type { PublicRegistryAsset } from "@repo/hjertestarterregister-sdk";
import z from "zod";

const ynBoolean = z.enum(["Y", "N"]).transform((value) => value === "Y");

const schema = z.object({
  ASSET_ID: z.int().positive(),
  ASSET_GUID: z.string().trim().min(1),
  SITE_LATITUDE: z.number().min(-90).max(90),
  SITE_LONGITUDE: z.number().min(-180).max(180),
  SITE_NAME: z.string().trim().min(1),
  SITE_ADDRESS: z.string().trim(),
  SITE_FLOOR_NUMBER: z.number().optional(), // TODO: Be stricter on half numbers (like 1.5) in the registry
  SITE_POST_CODE: z.string().trim().optional(), // TODO: Be stricter on non-valid post codes in the registry
  SITE_POST_AREA: z.string().trim().min(1).optional(),
  SITE_DESCRIPTION: z.string().trim().optional(),
  IS_MOBILE: ynBoolean,
  IS_OPEN: ynBoolean,
  IS_OPEN_DATE: z.coerce.date(),
  CREATED_DATE: z.coerce.date(),
  MODIFIED_DATE: z.coerce.date(),
  ACTIVE_FROM_DATE: z.coerce.date().optional(),
  ACTIVE_TO_DATE: z.coerce.date().optional(),
  OPENING_HOURS_TEXT: z.string().trim(),
  OPENING_HOURS_LIMITED: ynBoolean,
  ACTIVE_DATE_LIMITED: ynBoolean,
  OPENING_HOURS_CLOSED_HOLIDAYS: ynBoolean,
  OPENING_HOURS_MON_FROM: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_MON_TO: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_TUE_FROM: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_TUE_TO: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_WED_FROM: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_WED_TO: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_THU_FROM: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_THU_TO: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_FRI_FROM: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_FRI_TO: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_SAT_FROM: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_SAT_TO: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_SUN_FROM: z.number().int().min(0).max(2400).optional(),
  OPENING_HOURS_SUN_TO: z.number().int().min(0).max(2400).optional(),
});

export const validateAedData = (aedData: PublicRegistryAsset) => {
  const validatedData = schema.parse(aedData);
  return validatedData;
};
