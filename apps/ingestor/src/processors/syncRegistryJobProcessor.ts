import type { Job } from "bullmq";
import type { Logger } from "pino";
import { registerClient } from "../clients/registerClient.ts";
import { reconcileChangedAedQueue } from "../queues/reconcileChangedAedQueue.ts";
import { syncRegistryAeds } from "../repositories/aedRepository.ts";
import { prepareAedsForStorage } from "../utils/prepareAedsForStorage.ts";

export const syncRegistryJobProcessor = async (
  _job: Job,
  log: Logger,
  signal?: AbortSignal,
) => {
  log.info("Starting full registry sync");

  const { ASSETS, API_CURRENT_USER_ID } = await registerClient.searchAssets(
    {
      max_rows: 50_000,
    },
    { signal },
  );
  log.info(
    {
      apiUserId: API_CURRENT_USER_ID,
      assetCount: ASSETS.length,
    },
    "Fetched assets from registry",
  );

  if (signal?.aborted)
    throw new Error("Registry sync cancelled before persistence");

  const { aeds, foundAssetIds, invalid } = prepareAedsForStorage(ASSETS, log);
  log.debug(
    { prepared: aeds.length, foundAssetIds: foundAssetIds.length, invalid },
    "Prepared AEDs for storage",
  );

  const { upserted, deleted, changedAssetIds } = await syncRegistryAeds({
    aeds,
    foundAssetIds,
  });

  if (changedAssetIds.length > 0) {
    await reconcileChangedAedQueue.add("reconcile-changed-aed", {
      changedAssetIds,
      source: "sync-registry",
    });
    log.info(
      { changedAssetIds: changedAssetIds.length },
      "Emitted changed AEDs to reconciler",
    );
  }

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
