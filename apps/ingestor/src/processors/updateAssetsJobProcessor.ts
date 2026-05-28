import type { Job } from "bullmq";
import type { Logger } from "pino";
import { registerClient } from "../clients/registerClient.ts";
import {
  getLatestAedModifiedDate,
  upsertAeds,
} from "../repositories/aedRepository.ts";
import { prepareAedsForStorage } from "../utils/prepareAedsForStorage.ts";

const registryMonthNames = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const pad2 = (value: number): string => String(value).padStart(2, "0");

const formatRegistryDate = (date: Date): string => {
  const month = registryMonthNames[date.getUTCMonth()];
  if (month === undefined) {
    throw new Error(`Invalid AED modified_date month: ${date.toISOString()}`);
  }

  return `${pad2(date.getUTCDate())}-${month}-${date.getUTCFullYear()}`;
};

const getUpdatedSince = async (log: Logger): Promise<string> => {
  const latestModifiedDate = await getLatestAedModifiedDate();
  if (!latestModifiedDate) {
    log.warn(
      "No latest AED modified_date in database; falling back to today's date",
    );
    return formatRegistryDate(new Date());
  }
  return formatRegistryDate(latestModifiedDate);
};

export const updateAssetsJobProcessor = async (_job: Job, log: Logger) => {
  log.info("Starting incremental asset update");

  const updatedSince = await getUpdatedSince(log);
  log.debug({ updatedSince }, "Resolved updated_since cursor");

  const { ASSETS, API_CURRENT_USER_ID } = await registerClient.searchAssets({
    updated_since: updatedSince,
  });

  log.info(
    {
      apiUserId: API_CURRENT_USER_ID,
      assetCount: ASSETS.length,
      updatedSince,
    },
    "Fetched updated assets from registry",
  );

  if (ASSETS.length === 0) {
    log.info({ updatedSince }, "No updated assets to persist");
    return;
  }

  const { aeds, invalid } = prepareAedsForStorage(ASSETS, log);
  const { upserted } = await upsertAeds(aeds);

  log.info(
    {
      upserted,
      invalid,
      total: ASSETS.length,
      updatedSince,
    },
    "Asset update completed",
  );
};
