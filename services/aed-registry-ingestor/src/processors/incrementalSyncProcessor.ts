import type { PublicRegistryAsset } from "@repo/hjertestarterregister-sdk";
import type { Logger } from "pino";
import { registerClient } from "../clients/registerClient.ts";
import { runtimeEnv } from "../config.ts";
import { publishAedEvents } from "../queues/aedEventQueue.ts";
import {
  type DeletedAssetReference,
  getIncrementalCursor,
  markDeletedAssets,
  saveIncrementalSyncCompleted,
  upsertIncrementalAeds,
} from "../repositories/aedRepository.ts";
import { prepareAedsForStorage } from "../utils/prepareAedsForStorage.ts";
import { formatRegistryDate } from "../utils/registryDate.ts";

const prepareDeletedAssets = (
  assets: PublicRegistryAsset[],
  log: Logger,
): DeletedAssetReference[] => {
  const deleted = new Map<number, DeletedAssetReference>();
  for (const asset of assets) {
    if (
      !Number.isInteger(asset.ASSET_ID) ||
      asset.ASSET_ID <= 0 ||
      typeof asset.ASSET_GUID !== "string" ||
      asset.ASSET_GUID.trim().length === 0
    ) {
      log.warn(
        { assetId: asset.ASSET_ID, assetGuid: asset.ASSET_GUID },
        "Ignoring malformed deleted AED reference",
      );
      continue;
    }
    deleted.set(asset.ASSET_ID, {
      assetId: asset.ASSET_ID,
      assetGuid: asset.ASSET_GUID,
    });
  }
  return [...deleted.values()];
};

export const incrementalSyncProcessor = async (
  log: Logger,
  signal?: AbortSignal,
) => {
  const startedAt = new Date();
  const cursor = await getIncrementalCursor();
  if (!cursor) {
    throw new Error(
      "Incremental sync requires a completed full sync; retrying later.",
    );
  }
  const sinceDate = formatRegistryDate(cursor);
  log.info({ sinceDate }, "Starting incremental AED registry sync");

  const [updatedResponse, deletedResponse] = await Promise.all([
    registerClient.searchAssets(
      {
        updated_since: sinceDate,
        max_rows: runtimeEnv.REGISTRY_MAX_ROWS,
      },
      { signal },
    ),
    registerClient.searchDeletedAssets({ since_date: sinceDate }, { signal }),
  ]);
  if (signal?.aborted) throw new Error("Incremental registry sync cancelled");
  if (updatedResponse.ASSETS.length >= runtimeEnv.REGISTRY_MAX_ROWS) {
    throw new Error(
      `Incremental response reached REGISTRY_MAX_ROWS=${runtimeEnv.REGISTRY_MAX_ROWS}; refusing to advance the cursor.`,
    );
  }

  const { aeds, invalid } = prepareAedsForStorage(updatedResponse.ASSETS, log);
  const deletedAssets = prepareDeletedAssets(deletedResponse.ASSETS, log);
  const upsertChanges = await upsertIncrementalAeds(aeds);
  const deletionChanges = await markDeletedAssets(deletedAssets);
  await saveIncrementalSyncCompleted(startedAt);
  const published = await publishAedEvents([
    ...upsertChanges.events,
    ...deletionChanges.events,
  ]);

  log.info(
    {
      sinceDate,
      updatedReceived: updatedResponse.ASSETS.length,
      deletedReceived: deletedResponse.ASSETS.length,
      invalid,
      created: upsertChanges.created,
      updated: upsertChanges.updated,
      deleted: deletionChanges.deleted,
      published,
    },
    "Incremental AED registry sync completed",
  );
};
