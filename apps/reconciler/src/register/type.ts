import type { RegistryAsset } from "@repo/hjertestarterregister-api";

export interface RegisterAed extends RegistryAsset {
  ASSET_GUID: string;
  SITE_LATITUDE: number;
  SITE_LONGITUDE: number;
}
