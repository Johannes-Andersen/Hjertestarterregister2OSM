import * as z from "zod";

const interval = z.object({ from: z.number(), to: z.number() }).nullable();

export const openingHoursSchema = z.object({
  mon: interval,
  tue: interval,
  wed: interval,
  thu: interval,
  fri: interval,
  sat: interval,
  sun: interval,
});

export const registryAedSchema = z.object({
  assetId: z.number().int().positive(),
  assetGuid: z.string(),
  siteName: z.string(),
  siteLatitude: z.number(),
  siteLongitude: z.number(),
  siteFloorNumber: z.number().nullable(),
  siteDescription: z.string().nullable(),
  isMobile: z.boolean(),
  openingHoursLimited: z.boolean(),
  openingHoursClosedHolidays: z.boolean(),
  openingHours: openingHoursSchema,
});

export const aedEventSchema = z.object({
  eventId: z.string(),
  type: z.enum(["aed.created", "aed.updated", "aed.deleted"]),
  source: z.string(),
  occurredAt: z.string(),
  assetId: z.number().int().positive(),
  assetGuid: z.string(),
  aed: registryAedSchema,
});

export type OpeningHours = z.infer<typeof openingHoursSchema>;
export type RegistryAed = z.infer<typeof registryAedSchema>;
export type AedEvent = z.infer<typeof aedEventSchema>;
