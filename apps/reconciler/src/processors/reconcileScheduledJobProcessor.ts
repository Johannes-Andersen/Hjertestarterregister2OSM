import type { Job } from "bullmq";
import type { Logger } from "pino";
import { sql } from "../clients/postgresClient.ts";
import { reconcileAed } from "./reconcileAed.ts";

export const reconcileScheduledJobProcessor = async (
  _job: Job,
  log: Logger,
  signal?: AbortSignal,
) => {
  log.info("Starting scheduled AED reconciliation");

  const aeds = await sql<{ asset_id: number }[]>`
    SELECT asset_id
    FROM aed
    WHERE "deletedAt" IS NULL
    ORDER BY asset_id
  `;

  log.info(
    { aedCount: aeds.length },
    "Fetched registry AEDs for reconciliation",
  );

  for (const aed of aeds) {
    if (signal?.aborted) throw new Error("Scheduled reconciliation cancelled");

    await reconcileAed(aed.asset_id, log);
  }

  log.info(
    { processedCount: aeds.length },
    "Scheduled reconciliation completed",
  );
};
