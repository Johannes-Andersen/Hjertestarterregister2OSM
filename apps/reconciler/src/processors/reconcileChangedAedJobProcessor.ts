import type { Job } from "bullmq";
import type { Logger } from "pino";
import { reconcileAed } from "./reconcileAed.ts";

export interface ReconcileChangedAedJobData {
  changedAssetIds: number[];
  source: string;
}

export const reconcileChangedAedJobProcessor = async (
  job: Job<ReconcileChangedAedJobData>,
  log: Logger,
  signal?: AbortSignal,
) => {
  const { changedAssetIds, source } = job.data;

  log.info(
    { changedAssetIds, source, count: changedAssetIds.length },
    "Processing changed AEDs from registry ingestor",
  );

  for (const assetId of changedAssetIds) {
    if (signal?.aborted)
      throw new Error("Changed AED reconciliation cancelled");

    await reconcileAed(assetId, log);
  }

  log.info(
    { processedCount: changedAssetIds.length, source },
    "Changed AED reconciliation completed",
  );
};
