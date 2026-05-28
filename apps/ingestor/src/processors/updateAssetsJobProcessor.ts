import type { Job } from "bullmq";
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

const getUpdatedSince = async (): Promise<string> => {
  const latestModifiedDate = await getLatestAedModifiedDate();
  return latestModifiedDate
    ? formatRegistryDate(latestModifiedDate)
    : formatRegistryDate(new Date());
};

export const updateAssetsJobProcessor = async (job: Job) => {
  console.log(`updateAssetsJobProcessor received job ${job.id}`);
  const updatedSince = await getUpdatedSince();
  const { ASSETS, API_CURRENT_USER_ID } = await registerClient.searchAssets({
    updated_since: updatedSince,
  });

  console.log(
    `Fetched using ${API_CURRENT_USER_ID} and got ${ASSETS.length} assets updated since ${updatedSince}.`,
  );

  const { aeds, invalid } = prepareAedsForStorage(ASSETS);
  const { upserted } = await upsertAeds(aeds);

  console.log(
    `Stored ${upserted} updated AEDs and skipped ${invalid} invalid AEDs.`,
  );
};
