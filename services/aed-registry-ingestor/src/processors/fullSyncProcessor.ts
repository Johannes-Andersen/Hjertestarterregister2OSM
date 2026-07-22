import type { Logger } from "pino";
import { registerClient } from "../clients/registerClient.ts";
import { runtimeEnv } from "../config.ts";
import { publishAedEvents } from "../queues/aedEventQueue.ts";
import {
  saveFullSyncCompleted,
  syncRegistrySnapshot,
} from "../repositories/aedRepository.ts";
import { prepareAedsForStorage } from "../utils/prepareAedsForStorage.ts";

export const fullSyncProcessor = async (log: Logger, signal?: AbortSignal) => {
  const startedAt = new Date();
  log.info("Starting full AED registry sync");

  const { ASSETS, API_CURRENT_USER_ID } = await registerClient.searchAssets(
    { max_rows: runtimeEnv.REGISTRY_MAX_ROWS },
    { signal },
  );
  if (ASSETS.length === 0) {
    throw new Error("Registry returned an empty full snapshot; refusing sync.");
  }
  if (ASSETS.length >= runtimeEnv.REGISTRY_MAX_ROWS) {
    throw new Error(
      `Registry full snapshot reached REGISTRY_MAX_ROWS=${runtimeEnv.REGISTRY_MAX_ROWS}; increase the limit before reconciling deletions.`,
    );
  }
  if (signal?.aborted) throw new Error("Full registry sync cancelled");

  const { aeds, foundAssetIds, invalid } = prepareAedsForStorage(ASSETS, log);
  const { events, ...changes } = await syncRegistrySnapshot({
    aeds,
    foundAssetIds,
  });
  await saveFullSyncCompleted(startedAt);
  const published = await publishAedEvents(events);

  log.info(
    {
      apiUserId: API_CURRENT_USER_ID,
      received: ASSETS.length,
      valid: aeds.length,
      invalid,
      ...changes,
      published,
    },
    "Full AED registry sync completed",
  );
};
