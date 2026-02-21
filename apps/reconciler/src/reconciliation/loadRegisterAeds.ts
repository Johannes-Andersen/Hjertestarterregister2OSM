import type { RegistryAsset } from "@repo/hjertestarterregister-sdk";
import type { NewSyncIssue } from "@repo/sync-store";
import { type RegisterAed, toRegisterAed } from "../types/registerAed.ts";
import { isInNorwayPolygon } from "../utils/isInNorwayPolygon.ts";
import { reconciliationLogger } from "../utils/logger.ts";

interface RegisterAedSnapshot {
  registerAedsById: Map<string, RegisterAed>;
  issues: NewSyncIssue[];
}

const log = reconciliationLogger.child({ module: "loadRegisterAeds" });

const createOutsideNorwayIssue = (registerAed: RegisterAed): NewSyncIssue => ({
  type: "register_aed_outside_norway",
  severity: "warning",
  message: `Skipped register AED ${registerAed.ASSET_GUID}: location is outside Norway polygon.`,
  registerRef: registerAed.ASSET_GUID,
  details: {
    lat: registerAed.SITE_LATITUDE,
    lon: registerAed.SITE_LONGITUDE,
  },
});

export const loadRegisterAeds = (
  assets: RegistryAsset[],
): RegisterAedSnapshot => {
  const registerAedsById = new Map<string, RegisterAed>();
  const issues: NewSyncIssue[] = [];

  for (const asset of assets) {
    const registerAed = toRegisterAed(asset);
    if (!registerAed) continue;

    if (
      !isInNorwayPolygon({
        lat: registerAed.SITE_LATITUDE,
        lon: registerAed.SITE_LONGITUDE,
      })
    ) {
      issues.push(createOutsideNorwayIssue(registerAed));
      continue;
    }

    registerAedsById.set(registerAed.ASSET_GUID, registerAed);
  }

  if (issues.length > 0)
    log.warn(`Found ${issues.length} issues while loading register AEDs`);

  return {
    registerAedsById,
    issues,
  };
};
