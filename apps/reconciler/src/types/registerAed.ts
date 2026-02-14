import type { RegistryAsset } from "@repo/hjertestarterregister-sdk";
import * as z from "zod";

const registerAedFieldsSchema = z.object({
  ASSET_GUID: z.string().trim().min(1),
  SITE_LATITUDE: z.number(),
  SITE_LONGITUDE: z.number(),
});

export type RegisterAed = RegistryAsset &
  z.output<typeof registerAedFieldsSchema>;

export const toRegisterAed = (asset: RegistryAsset): RegisterAed | null => {
  const parsed = registerAedFieldsSchema.safeParse(asset);
  if (!parsed.success) return null;

  return {
    ...asset,
    ...parsed.data,
  };
};
