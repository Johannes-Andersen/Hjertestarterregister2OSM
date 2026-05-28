import type { Job } from "bullmq";
import type { Logger } from "pino";
import { registerClient } from "../clients/registerClient.ts";
import { syncRegistryAeds } from "../repositories/aedRepository.ts";
import { prepareAedsForStorage } from "../utils/prepareAedsForStorage.ts";

export const syncRegistryJobProcessor = async (_job: Job, log: Logger) => {
  log.info("Starting full registry sync");

  const { ASSETS, API_CURRENT_USER_ID } = await registerClient.searchAssets({
    max_rows: 50_000,
  });
  log.info(
    {
      apiUserId: API_CURRENT_USER_ID,
      assetCount: ASSETS.length,
    },
    "Fetched assets from registry",
  );

  const { aeds, foundAssetIds, invalid } = prepareAedsForStorage(ASSETS, log);
  log.debug(
    { prepared: aeds.length, foundAssetIds: foundAssetIds.length, invalid },
    "Prepared AEDs for storage",
  );

  const { upserted, deleted } = await syncRegistryAeds({
    aeds,
    foundAssetIds,
  });

  log.info(
    {
      upserted,
      deleted,
      invalid,
      total: ASSETS.length,
    },
    "Registry sync completed",
  );
};
