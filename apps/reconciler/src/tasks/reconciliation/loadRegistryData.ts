import type { Logger } from "pino";
import { registerClient } from "../../clients/registerClient.ts";
import { syncStore } from "../../clients/syncStore.ts";
import { isInNorwayPolygon } from "../../utils/isInNorwayPolygon.ts";

interface LoadRegistryDataOptions {
  logger: Logger;
  runId: string;
}

const defaultRegisterMaxRows = 50_000;

export const loadRegistryData = async ({
  logger,
  runId,
}: LoadRegistryDataOptions) => {
  const log = logger.child({ task: "loadRegistryData" });
  log.info("Loading registry data...");

  const { API_MESSAGE, ASSETS, API_CURRENT_USER_ID } =
    await registerClient.searchAssets({
      max_rows: defaultRegisterMaxRows,
    });

  const metrics = {
    registryAeds: ASSETS.length,
  };

  log.trace({ metrics }, "Adding registry data metrics to database");
  await syncStore.addRunMetric({
    runId,
    metrics,
  });
  log.debug({ metrics }, "Registry data metrics added to database");

  const assets = ASSETS.filter((asset) => {
    if (!asset.ASSET_GUID) {
      log.warn({ asset }, "Register AED with missing ASSET_GUID skipped");
      syncStore.addRunIssue({
        runId,
        issue: {
          type: "register_missing_required_data",
          severity: "warning",
          message: `Register AED with missing ASSET_GUID is missing required data.`,
          registerRef: undefined,
        },
      });
      return false;
    }

    if (!asset.SITE_LATITUDE || !asset.SITE_LONGITUDE) {
      log.warn({ asset }, "Register AED is missing location data");
      syncStore.addRunIssue({
        runId,
        issue: {
          type: "register_missing_required_data",
          severity: "warning",
          message: `Register AED ${asset.ASSET_GUID} is missing location data.`,
          registerRef: asset.ASSET_GUID,
        },
      });
      return false;
    }

    if (!asset.SITE_NAME) {
      log.warn({ asset }, "Register AED is missing SITE_NAME");
      syncStore.addRunIssue({
        runId,
        issue: {
          type: "register_missing_required_data",
          severity: "warning",
          message: `Register AED ${asset.ASSET_GUID} is missing SITE_NAME.`,
          registerRef: asset.ASSET_GUID,
        },
      });
      return false;
    }

    if (
      !isInNorwayPolygon({
        lat: asset.SITE_LATITUDE,
        lon: asset.SITE_LONGITUDE,
      })
    ) {
      log.warn({ asset }, "Register AED is located outside Norway polygon");
      syncStore.addRunIssue({
        runId,
        issue: {
          type: "register_aed_outside_norway",
          severity: "warning",
          message: `Register AED ${asset.ASSET_GUID} is located outside Norway polygon.`,
          registerRef: asset.ASSET_GUID,
          details: {
            lat: asset.SITE_LATITUDE,
            lon: asset.SITE_LONGITUDE,
          },
        },
      });
      return false;
    }

    return true;
  });

  log.info(
    {
      apiCurrentUserId: API_CURRENT_USER_ID,
      apiMessage: API_MESSAGE,
      registryAssetsCount: ASSETS.length,
      validRegistryAssetsCount: assets.length,
    },
    "Loaded registry data",
  );

  return assets;
};
