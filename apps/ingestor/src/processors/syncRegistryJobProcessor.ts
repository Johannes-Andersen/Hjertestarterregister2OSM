import type { Job } from "bullmq";
import { registerClient } from "../clients/registerClient.ts";
import { syncRegistryAeds } from "../repositories/aedRepository.ts";
import { prepareAedsForStorage } from "../utils/prepareAedsForStorage.ts";

export const syncRegistryJobProcessor = async (job: Job) => {
  console.log(`syncRegistryJobProcessor received job ${job.id},`);
  const { ASSETS, API_CURRENT_USER_ID } = await registerClient.searchAssets({
    max_rows: 3,
  });

  console.log(
    `Fetched using ${API_CURRENT_USER_ID} and got ${ASSETS.length} assets from the registry.`,
  );

  const { aeds, foundAssetIds, invalid } = prepareAedsForStorage(ASSETS);
  const { upserted, deleted } = await syncRegistryAeds({
    aeds,
    foundAssetIds,
  });

  console.log(
    `Stored ${upserted} AEDs, marked ${deleted} missing AEDs as deleted, skipped ${invalid} invalid AEDs.`,
  );
};
